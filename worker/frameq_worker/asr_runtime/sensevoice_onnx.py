from __future__ import annotations

from pathlib import Path
from typing import Any

from frameq_worker.asr_runtime.sensevoice import (
    _clean_sensevoice_text,
    _extract_vad_segments,
    _read_pcm_wav_mono_float32,
    _sensevoice_language,
    _slice_audio_by_milliseconds,
)
from frameq_worker.asr_runtime.types import (
    ASRDependencyError,
    ASREmptyTranscriptError,
    ASRRuntimeError,
    ModelFactory,
    Transcript,
    TranscriptSegment,
    extract_provider_text,
    missing_dependency_message,
)

SENSEVOICE_SMALL_ONNX_MODEL = "iic/SenseVoiceSmall-onnx"


def _extract_onnx_text(results: object) -> str:
    if isinstance(results, str):
        return results
    if isinstance(results, list) and all(isinstance(result, str) for result in results):
        return " ".join(results)
    return extract_provider_text(results)


class SenseVoiceOnnxTranscriber:
    """Direct local `funasr_onnx` adapter with an ONNX-only VAD fallback."""

    def __init__(
        self,
        asr_model_dir: Path,
        vad_model_dir: Path,
        asr_factory: ModelFactory | None = None,
        vad_factory: ModelFactory | None = None,
    ) -> None:
        self.asr_model_dir = Path(asr_model_dir)
        self.vad_model_dir = Path(vad_model_dir)
        self._asr_factory = asr_factory or self._load_default_asr
        self._vad_factory = vad_factory or self._load_default_vad
        self._asr: Any | None = None
        self._vad: Any | None = None

    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        asr = self._get_asr()
        segmented = self._transcribe_vad_segments(asr, audio_path, language)
        if segmented is not None:
            return segmented
        return self._transcribe_full_audio(asr, audio_path, language)

    def _get_asr(self) -> Any:
        if self._asr is None:
            try:
                self._asr = self._asr_factory(
                    model_dir=self.asr_model_dir.as_posix(),
                    quantize=True,
                    batch_size=1,
                    device_id="-1",
                )
            except ModuleNotFoundError as exc:
                raise ASRDependencyError(
                    missing_dependency_message(exc, runtime_name="SenseVoice ONNX ASR")
                ) from exc
        return self._asr

    def _get_vad(self) -> Any:
        if self._vad is None:
            try:
                self._vad = self._vad_factory(
                    model_dir=self.vad_model_dir.as_posix(),
                    quantize=True,
                    device_id="-1",
                )
            except ModuleNotFoundError as exc:
                raise ASRDependencyError(
                    missing_dependency_message(exc, runtime_name="SenseVoice ONNX VAD")
                ) from exc
        return self._vad

    def _load_default_asr(self, **kwargs: Any) -> Any:
        from funasr_onnx import SenseVoiceSmall

        return SenseVoiceSmall(**kwargs)

    def _load_default_vad(self, **kwargs: Any) -> Any:
        from funasr_onnx import Fsmn_vad

        return Fsmn_vad(**kwargs)

    def _transcribe_vad_segments(
        self,
        asr: Any,
        audio_path: Path,
        language: str,
    ) -> Transcript | None:
        try:
            import numpy as np

            vad_results = self._get_vad()(audio_path.as_posix())
            vad_segments = _extract_vad_segments(vad_results)
            audio_samples = _read_pcm_wav_mono_float32(audio_path, np)
            if not vad_segments or audio_samples is None:
                return None
            samples, sample_rate = audio_samples
            blocks, valid_segments = _slice_audio_by_milliseconds(
                samples=samples,
                sample_rate=sample_rate,
                vad_segments=vad_segments,
            )
            if not blocks:
                return None
        except ASRDependencyError:
            raise
        except Exception:
            return None

        segments: list[TranscriptSegment] = []
        total_blocks = len(blocks)
        for index, (timing, block) in enumerate(
            zip(valid_segments, blocks, strict=True),
            start=1,
        ):
            try:
                result = asr(
                    block,
                    language=_sensevoice_language(language),
                    textnorm="withitn",
                )
            except Exception as exc:  # noqa: BLE001 - wraps third-party ONNX errors.
                raise ASRRuntimeError(
                    f"ONNX ASR segment {index} of {total_blocks} failed: {exc}"
                ) from exc
            text = _clean_sensevoice_text(_extract_onnx_text(result))
            if text:
                segments.append(
                    TranscriptSegment(
                        id=f"seg-{len(segments) + 1:04d}",
                        start_ms=timing[0],
                        end_ms=timing[1],
                        text=text,
                    )
                )
        if not segments:
            raise ASREmptyTranscriptError("ASR returned an empty transcript.")
        return Transcript(
            text=" ".join(segment.text for segment in segments),
            language=language,
            segments=tuple(segments),
        )

    def _transcribe_full_audio(self, asr: Any, audio_path: Path, language: str) -> Transcript:
        try:
            results = asr(
                audio_path.as_posix(),
                language=_sensevoice_language(language),
                textnorm="withitn",
            )
        except Exception as exc:  # noqa: BLE001 - wraps third-party ONNX errors.
            raise ASRRuntimeError(str(exc)) from exc
        text = _clean_sensevoice_text(_extract_onnx_text(results))
        if not text:
            raise ASREmptyTranscriptError("ASR returned an empty transcript.")
        return Transcript(text=text, language=language)
