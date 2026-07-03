from __future__ import annotations

import json
import os
import re
import wave
from collections.abc import Callable
from dataclasses import dataclass
from os import PathLike
from pathlib import Path
from typing import Any, Protocol

QWEN_ASR_MODEL = "Qwen/Qwen3-ASR-0.6B"
SENSEVOICE_SMALL_MODEL = "iic/SenseVoiceSmall"
DEFAULT_ASR_MODEL = SENSEVOICE_SMALL_MODEL
DEFAULT_MODEL_CACHE_ENV = "FRAMEQ_MODEL_DIR"
MODELSCOPE_CACHE_ENV = "MODELSCOPE_CACHE"
SENSEVOICE_VAD_MODEL = "fsmn-vad"
SENSEVOICE_VAD_MAX_SEGMENT_TIME_MS = 30000
SENSEVOICE_TAG_PATTERN = re.compile(r"<\|[^|>]+?\|>")


class ASRError(RuntimeError):
    code = "ASR_ERROR"


class ASRDependencyError(ASRError):
    code = "ASR_DEPENDENCY_MISSING"


class ASRRuntimeError(ASRError):
    code = "ASR_RUNTIME_ERROR"


class ASREmptyTranscriptError(ASRRuntimeError):
    code = "ASR_EMPTY_TRANSCRIPT"


class ASRUnsupportedModelError(ASRRuntimeError):
    code = "ASR_MODEL_UNSUPPORTED"


@dataclass(frozen=True)
class TranscriptSegment:
    id: str
    start_ms: int
    end_ms: int
    text: str
    speaker: str | None = None

    def to_json(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "id": self.id,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "text": self.text,
        }
        if self.speaker:
            payload["speaker"] = self.speaker
        return payload


@dataclass(frozen=True)
class Transcript:
    text: str
    language: str = "Chinese"
    segments: tuple[TranscriptSegment, ...] = ()


@dataclass(frozen=True)
class TranscriptArtifacts:
    text: str
    txt_path: Path
    md_path: Path
    segments_path: Path | None = None


class Transcriber(Protocol):
    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        pass


ModelFactory = Callable[..., Any]


@dataclass(frozen=True)
class AsrModelSpec:
    name: str
    family: str
    display_name: str


SUPPORTED_ASR_MODELS: tuple[AsrModelSpec, ...] = (
    AsrModelSpec(SENSEVOICE_SMALL_MODEL, "sensevoice", "SenseVoice Small"),
    AsrModelSpec(QWEN_ASR_MODEL, "qwen", "Qwen3-ASR-0.6B"),
)


def supported_asr_model_names() -> list[str]:
    return [model.name for model in SUPPORTED_ASR_MODELS]


def resolve_asr_model_name(model_name: str | None) -> str:
    candidate = (model_name or "").strip() or DEFAULT_ASR_MODEL
    if candidate in supported_asr_model_names():
        return candidate
    raise ASRUnsupportedModelError(f"Unsupported ASR model: {candidate}")


def asr_model_display_name(model_name: str) -> str:
    resolved = resolve_asr_model_name(model_name)
    for model in SUPPORTED_ASR_MODELS:
        if model.name == resolved:
            return model.display_name
    return resolved


def asr_model_family(model_name: str) -> str:
    resolved = resolve_asr_model_name(model_name)
    for model in SUPPORTED_ASR_MODELS:
        if model.name == resolved:
            return model.family
    raise ASRUnsupportedModelError(f"Unsupported ASR model: {model_name}")


def resolve_model_cache_dir(
    project_root: Path,
    environ: dict[str, str] | None = None,
) -> Path:
    env = environ if environ is not None else {}
    configured_path = env.get(DEFAULT_MODEL_CACHE_ENV)
    if configured_path:
        return Path(configured_path)
    return project_root / "models"


def build_qwen_asr_transcriber(
    model_name: str = QWEN_ASR_MODEL,
    cache_dir: str | PathLike[str] | Path | None = None,
) -> QwenAsrTranscriber:
    model_kwargs: dict[str, Any] = {}
    if cache_dir is not None:
        resolved_cache_dir = Path(cache_dir)
        resolved_cache_dir.mkdir(parents=True, exist_ok=True)
        model_kwargs["cache_dir"] = resolved_cache_dir.as_posix()

    return QwenAsrTranscriber(model_name=model_name, model_kwargs=model_kwargs)


def build_sensevoice_transcriber(
    model_name: str,
    cache_dir: str | PathLike[str] | Path | None = None,
) -> SenseVoiceTranscriber:
    model_kwargs: dict[str, Any] = {
        "vad_model": SENSEVOICE_VAD_MODEL,
        "vad_kwargs": {"max_single_segment_time": SENSEVOICE_VAD_MAX_SEGMENT_TIME_MS},
    }
    if cache_dir is not None:
        configure_modelscope_cache_dir(cache_dir)

    return SenseVoiceTranscriber(model_name=model_name, model_kwargs=model_kwargs)


def build_asr_transcriber(
    model_name: str = DEFAULT_ASR_MODEL,
    cache_dir: str | PathLike[str] | Path | None = None,
) -> Transcriber:
    resolved_model = resolve_asr_model_name(model_name)
    family = asr_model_family(resolved_model)
    if family == "qwen":
        return build_qwen_asr_transcriber(model_name=resolved_model, cache_dir=cache_dir)
    if family == "sensevoice":
        return build_sensevoice_transcriber(model_name=resolved_model, cache_dir=cache_dir)
    raise ASRUnsupportedModelError(f"Unsupported ASR model: {resolved_model}")


def configure_modelscope_cache_dir(cache_dir: str | PathLike[str] | Path) -> Path:
    resolved_cache_dir = Path(cache_dir)
    resolved_cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ[MODELSCOPE_CACHE_ENV] = resolved_cache_dir.as_posix()
    return resolved_cache_dir


class QwenAsrTranscriber:
    def __init__(
        self,
        model_name: str = QWEN_ASR_MODEL,
        model_factory: ModelFactory | None = None,
        max_inference_batch_size: int = 4,
        max_new_tokens: int = 4096,
        model_kwargs: dict[str, Any] | None = None,
    ) -> None:
        self.model_name = model_name
        self._model_factory = model_factory or self._load_default_model
        self.max_inference_batch_size = max_inference_batch_size
        self.max_new_tokens = max_new_tokens
        self.model_kwargs = model_kwargs or {}
        self._model: Any | None = None

    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        model = self._get_model()
        try:
            results = model.transcribe(audio=audio_path.as_posix(), language=language)
        except Exception as exc:  # noqa: BLE001 - wraps third-party model failures.
            raise ASRRuntimeError(str(exc)) from exc

        text = _extract_text(results)
        if not text.strip():
            raise ASREmptyTranscriptError("ASR returned an empty transcript.")

        return Transcript(text=text.strip(), language=language)

    def _get_model(self) -> Any:
        if self._model is None:
            try:
                self._model = self._model_factory(
                    model_name=self.model_name,
                    max_inference_batch_size=self.max_inference_batch_size,
                    max_new_tokens=self.max_new_tokens,
                    **self.model_kwargs,
                )
            except ModuleNotFoundError as exc:
                raise ASRDependencyError(
                    _missing_dependency_message(exc, runtime_name="Qwen ASR")
                ) from exc
        return self._model

    def _load_default_model(
        self,
        model_name: str,
        max_inference_batch_size: int,
        max_new_tokens: int,
        **model_kwargs: Any,
    ) -> Any:
        from qwen_asr import Qwen3ASRModel

        return Qwen3ASRModel.from_pretrained(
            model_name,
            max_inference_batch_size=max_inference_batch_size,
            max_new_tokens=max_new_tokens,
            **model_kwargs,
        )


class SenseVoiceTranscriber:
    def __init__(
        self,
        model_name: str = SENSEVOICE_SMALL_MODEL,
        model_factory: ModelFactory | None = None,
        model_kwargs: dict[str, Any] | None = None,
    ) -> None:
        self.model_name = model_name
        self._model_factory = model_factory or self._load_default_model
        self.model_kwargs = {
            "vad_model": SENSEVOICE_VAD_MODEL,
            "vad_kwargs": {"max_single_segment_time": SENSEVOICE_VAD_MAX_SEGMENT_TIME_MS},
            **(model_kwargs or {}),
        }
        self._model: Any | None = None

    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        model = self._get_model()
        segmented_transcript = _transcribe_sensevoice_vad_blocks(
            model=model,
            audio_path=audio_path,
            language=language,
        )
        if segmented_transcript is not None:
            return segmented_transcript

        try:
            results = model.generate(
                input=audio_path.as_posix(),
                language=_sensevoice_language(language),
                use_itn=True,
                batch_size_s=60,
                merge_vad=True,
                merge_length_s=15,
                cache={},
            )
        except Exception as exc:  # noqa: BLE001 - wraps third-party model failures.
            raise ASRRuntimeError(str(exc)) from exc

        text = _clean_sensevoice_text(_extract_text(results))
        if not text.strip():
            raise ASREmptyTranscriptError("ASR returned an empty transcript.")

        segments = _extract_sensevoice_segments(results)

        return Transcript(text=text.strip(), language=language, segments=segments)

    def _get_model(self) -> Any:
        if self._model is None:
            try:
                self._model = self._model_factory(
                    model=self.model_name,
                    trust_remote_code=True,
                    **self.model_kwargs,
                )
            except ModuleNotFoundError as exc:
                raise ASRDependencyError(
                    _missing_dependency_message(exc, runtime_name="SenseVoice ASR")
                ) from exc
        return self._model

    def _load_default_model(
        self,
        model: str,
        trust_remote_code: bool,
        **model_kwargs: Any,
    ) -> Any:
        from funasr import AutoModel

        return AutoModel(model=model, trust_remote_code=trust_remote_code, **model_kwargs)


def transcribe_and_write(
    audio_path: Path,
    output_dir: Path,
    output_stem: str,
    transcriber: Transcriber,
    language: str = "Chinese",
    model: str = DEFAULT_ASR_MODEL,
    source_url: str | None = None,
) -> TranscriptArtifacts:
    transcript = transcriber.transcribe(audio_path, language=language)
    return write_transcript_files(
        text=transcript.text,
        output_dir=output_dir,
        output_stem=output_stem,
        model=model,
        source_url=source_url,
        segments=transcript.segments,
    )


def write_transcript_files(
    text: str,
    output_dir: Path,
    output_stem: str,
    model: str,
    source_url: str | None = None,
    segments: tuple[TranscriptSegment, ...] = (),
) -> TranscriptArtifacts:
    cleaned_text = text.strip()
    if not cleaned_text:
        raise ASREmptyTranscriptError("ASR returned an empty transcript.")

    output_dir.mkdir(parents=True, exist_ok=True)
    txt_path = output_dir / f"{output_stem}_transcript.txt"
    md_path = output_dir / f"{output_stem}_transcript.md"
    segments_path = output_dir / f"{output_stem}_transcript_segments.json"

    txt_path.write_text(f"{cleaned_text}\n", encoding="utf-8")
    md_path.write_text(
        _format_transcript_markdown(
            text=cleaned_text,
            model=model,
            source_url=source_url,
        ),
        encoding="utf-8",
    )

    written_segments_path: Path | None = None
    if segments:
        segments_path.write_text(
            json.dumps(
                {"segments": [segment.to_json() for segment in segments]},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        written_segments_path = segments_path
    else:
        segments_path.unlink(missing_ok=True)

    return TranscriptArtifacts(
        text=cleaned_text,
        txt_path=txt_path,
        md_path=md_path,
        segments_path=written_segments_path,
    )


def _extract_text(results: object) -> str:
    if isinstance(results, list) and results:
        first = results[0]
        if isinstance(first, dict):
            return str(first.get("text", ""))
        return str(getattr(first, "text", ""))
    if isinstance(results, dict):
        return str(results.get("text", ""))
    return str(getattr(results, "text", ""))


def _sensevoice_language(language: str) -> str:
    normalized = language.strip().lower()
    if normalized in {"chinese", "zh", "zh-cn", "mandarin"}:
        return "zh"
    if normalized in {"english", "en"}:
        return "en"
    return "auto"


def _clean_sensevoice_text(text: str) -> str:
    return SENSEVOICE_TAG_PATTERN.sub("", text).strip()


def _extract_sensevoice_segments(results: object) -> tuple[TranscriptSegment, ...]:
    sentence_info = _extract_sentence_info(results)
    segments: list[TranscriptSegment] = []
    for sentence in sentence_info:
        if not isinstance(sentence, dict):
            continue
        start_ms = _coerce_milliseconds(sentence.get("start", sentence.get("start_ms")))
        end_ms = _coerce_milliseconds(sentence.get("end", sentence.get("end_ms")))
        if start_ms is None or end_ms is None or end_ms <= start_ms:
            continue
        text = _clean_sensevoice_text(str(sentence.get("text", "")))
        if not text:
            continue
        speaker = sentence.get("speaker", sentence.get("spk"))
        speaker_text = str(speaker).strip() if speaker is not None else None
        segments.append(
            TranscriptSegment(
                id=f"seg-{len(segments) + 1:04d}",
                start_ms=start_ms,
                end_ms=end_ms,
                text=text,
                speaker=speaker_text or None,
            )
        )
    return tuple(segments)


def _transcribe_sensevoice_vad_blocks(
    model: Any,
    audio_path: Path,
    language: str,
) -> Transcript | None:
    if getattr(model, "vad_model", None) is None or not hasattr(model, "inference"):
        return None

    try:
        import copy

        import numpy as np
        from funasr.utils.vad_utils import merge_vad
    except ModuleNotFoundError:
        return None

    generate_cfg: dict[str, Any] = {
        "language": _sensevoice_language(language),
        "use_itn": True,
        "batch_size_s": 60,
        "merge_vad": True,
        "merge_length_s": 15,
        "cache": {},
    }

    try:
        if hasattr(model, "_reset_runtime_configs"):
            model._reset_runtime_configs()
        vad_kwargs = copy.deepcopy(getattr(model, "vad_kwargs", {}) or {})
        vad_results = model.inference(
            audio_path.as_posix(),
            model=model.vad_model,
            kwargs=vad_kwargs,
            **generate_cfg,
        )
        vad_segments = _extract_vad_segments(vad_results)
        if not vad_segments:
            return None
        if generate_cfg["merge_vad"]:
            vad_segments = merge_vad(
                vad_segments,
                int(generate_cfg["merge_length_s"]) * 1000,
            )
        audio_samples = _read_pcm_wav_mono_float32(audio_path, np)
        if audio_samples is None:
            return None
        samples, sample_rate = audio_samples
        audio_blocks, valid_segments = _slice_audio_by_milliseconds(
            samples=samples,
            sample_rate=sample_rate,
            vad_segments=vad_segments,
        )
        if not audio_blocks:
            return None

        if hasattr(model, "_reset_runtime_configs"):
            model._reset_runtime_configs()
        asr_kwargs = copy.deepcopy(getattr(model, "kwargs", {}) or {})
        asr_kwargs["batch_size"] = max(1, int(asr_kwargs.get("batch_size", 1) or 1))
        asr_results = model.inference(
            audio_blocks,
            model=model.model,
            kwargs=asr_kwargs,
            language=generate_cfg["language"],
            use_itn=generate_cfg["use_itn"],
            cache={},
        )
    except Exception:
        return None

    segments: list[TranscriptSegment] = []
    for vad_segment, result in zip(valid_segments, asr_results, strict=False):
        text = _clean_sensevoice_text(_extract_text(result))
        if not text:
            continue
        segments.append(
            TranscriptSegment(
                id=f"seg-{len(segments) + 1:04d}",
                start_ms=vad_segment[0],
                end_ms=vad_segment[1],
                text=text,
            )
        )

    if not segments:
        return None

    return Transcript(
        text=" ".join(segment.text for segment in segments).strip(),
        language=language,
        segments=tuple(segments),
    )


def _extract_vad_segments(results: object) -> list[list[int]]:
    if not isinstance(results, list) or not results:
        return []
    first = results[0]
    if not isinstance(first, dict):
        return []
    value = first.get("value", [])
    if not isinstance(value, list):
        return []

    segments: list[list[int]] = []
    for item in value:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        start_ms = _coerce_milliseconds(item[0])
        end_ms = _coerce_milliseconds(item[1])
        if start_ms is None or end_ms is None or end_ms <= start_ms:
            continue
        segments.append([start_ms, end_ms])
    return segments


def _read_pcm_wav_mono_float32(audio_path: Path, np: Any) -> tuple[Any, int] | None:
    try:
        with wave.open(str(audio_path), "rb") as wav_file:
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            frames = wav_file.readframes(wav_file.getnframes())
    except (wave.Error, OSError):
        return None

    if sample_width == 1:
        samples = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif sample_width == 2:
        samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        samples = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        return None

    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, sample_rate


def _slice_audio_by_milliseconds(
    samples: Any,
    sample_rate: int,
    vad_segments: list[list[int]],
) -> tuple[list[Any], list[tuple[int, int]]]:
    audio_blocks: list[Any] = []
    valid_segments: list[tuple[int, int]] = []
    sample_count = len(samples)
    for start_ms, end_ms in vad_segments:
        start_index = max(0, int(start_ms * sample_rate / 1000))
        end_index = min(sample_count, int(end_ms * sample_rate / 1000))
        if end_index <= start_index:
            continue
        audio_blocks.append(samples[start_index:end_index])
        valid_segments.append((start_ms, end_ms))
    return audio_blocks, valid_segments


def _extract_sentence_info(results: object) -> list[object]:
    if isinstance(results, list) and results:
        first = results[0]
        if isinstance(first, dict):
            sentence_info = first.get("sentence_info", [])
            return sentence_info if isinstance(sentence_info, list) else []
        sentence_info = getattr(first, "sentence_info", [])
        return sentence_info if isinstance(sentence_info, list) else []
    if isinstance(results, dict):
        sentence_info = results.get("sentence_info", [])
        return sentence_info if isinstance(sentence_info, list) else []
    sentence_info = getattr(results, "sentence_info", [])
    return sentence_info if isinstance(sentence_info, list) else []


def _coerce_milliseconds(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _missing_dependency_message(exc: ModuleNotFoundError, runtime_name: str) -> str:
    missing_name = exc.name or str(exc).removeprefix("No module named ").strip("'\"")
    return (
        f"Missing ASR runtime dependency: {missing_name}. "
        f"Install project dependencies with `uv sync` before running {runtime_name}."
    )


def _format_transcript_markdown(text: str, model: str, source_url: str | None) -> str:
    source_line = f"\n- Source: {source_url}" if source_url else ""
    return f"""# 视频文字稿

## Metadata

- Model: {model}{source_line}

## Transcript

{text}
"""
