import json
import os
import wave
from pathlib import Path

import pytest
from frameq_worker.asr import (
    ASRDependencyError,
    ASRRuntimeError,
    QwenAsrTranscriber,
    SenseVoiceTranscriber,
    Transcript,
    TranscriptSegment,
    build_asr_transcriber,
    build_qwen_asr_transcriber,
    resolve_model_cache_dir,
    supported_asr_model_names,
    transcribe_and_write,
    write_transcript_files,
)
from frameq_worker.models import TranscriptMetadata
from frameq_worker.source_identity import SourceIdentity, SourceIdentityError, identify_source


class FakeTranscriber:
    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        return Transcript(text=f"来自 {audio_path.name} 的文字稿", language=language)


def test_write_transcript_files_creates_non_empty_txt_and_markdown(tmp_path: Path) -> None:
    artifacts = write_transcript_files(
        text="这里是从视频语音中识别出的完整文字内容。",
        output_dir=tmp_path / "outputs",
        output_stem="7524373044106677544",
        metadata=TranscriptMetadata(
            source="asr",
            engine="Qwen/Qwen3-ASR-0.6B",
            source_identity=identify_source(
                "https://www.douyin.com/video/7524373044106677544",
                allow_network=False,
            ),
        ),
    )

    assert (
        artifacts.txt_path.read_text(encoding="utf-8")
        == "这里是从视频语音中识别出的完整文字内容。\n"
    )
    markdown = artifacts.md_path.read_text(encoding="utf-8")
    assert "# 视频文字稿" in markdown
    assert "Qwen/Qwen3-ASR-0.6B" in markdown
    assert "这里是从视频语音中识别出的完整文字内容。" in markdown
    assert artifacts.txt_path.stat().st_size > 0
    assert artifacts.md_path.stat().st_size > 0


def test_write_transcript_files_records_platform_subtitle_metadata(
    tmp_path: Path,
) -> None:
    artifacts = write_transcript_files(
        text="subtitle transcript",
        output_dir=tmp_path,
        output_stem="",
        metadata=TranscriptMetadata(
            source="subtitle",
            language="zh-Hans",
            engine=None,
            source_identity=identify_source(
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                allow_network=False,
            ),
        ),
    )

    markdown = artifacts.md_path.read_text(encoding="utf-8")
    assert "- Transcript Source: Platform subtitle" in markdown
    assert "- Subtitle Language: zh-Hans" in markdown
    assert "- Source URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ" in markdown
    assert "Model:" not in markdown


def test_write_transcript_files_rejects_unsafe_source_identity_before_writing(
    tmp_path: Path,
) -> None:
    unsafe_identity = SourceIdentity(
        platform="xiaohongshu",
        stable_id="64a1b2c3d4e5f67890123456",
        canonical_url=(
            "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456"
            "?xsec_token=review-secret"
        ),
    )

    with pytest.raises(SourceIdentityError, match="safe for persistence"):
        write_transcript_files(
            text="official transcript",
            output_dir=tmp_path,
            output_stem="",
            metadata=TranscriptMetadata(
                source="subtitle",
                source_identity=unsafe_identity,
            ),
        )

    assert not (tmp_path / "transcript.txt").exists()
    assert not (tmp_path / "transcript.md").exists()


def test_transcribe_and_write_uses_transcriber_and_outputs_files(tmp_path: Path) -> None:
    audio_path = tmp_path / "cache" / "demo.wav"
    audio_path.parent.mkdir()
    audio_path.write_bytes(b"fake wav")

    artifacts = transcribe_and_write(
        audio_path=audio_path,
        output_dir=tmp_path / "outputs",
        output_stem="demo",
        transcriber=FakeTranscriber(),
    )

    assert artifacts.text == "来自 demo.wav 的文字稿"
    assert artifacts.txt_path.exists()
    assert artifacts.md_path.exists()
    assert artifacts.segments_path is None


def test_write_transcript_files_creates_segments_sidecar_when_segments_exist(
    tmp_path: Path,
) -> None:
    artifacts = write_transcript_files(
        text="first block second block",
        output_dir=tmp_path / "outputs",
        output_stem="demo",
        model="iic/SenseVoiceSmall",
        segments=(
            TranscriptSegment(id="seg-0001", start_ms=0, end_ms=1200, text="first block"),
            TranscriptSegment(
                id="seg-0002",
                start_ms=1200,
                end_ms=2500,
                text="second block",
                speaker="spk0",
            ),
        ),
    )

    assert artifacts.segments_path == tmp_path / "outputs" / "demo_transcript_segments.json"
    payload = json.loads(artifacts.segments_path.read_text(encoding="utf-8"))
    assert payload == {
        "segments": [
            {"id": "seg-0001", "start_ms": 0, "end_ms": 1200, "text": "first block"},
            {
                "id": "seg-0002",
                "start_ms": 1200,
                "end_ms": 2500,
                "text": "second block",
                "speaker": "spk0",
            },
        ]
    }


def test_write_transcript_files_removes_stale_segments_sidecar_when_segments_are_absent(
    tmp_path: Path,
) -> None:
    output_dir = tmp_path / "outputs"
    output_dir.mkdir()
    stale_segments_path = output_dir / "demo_transcript_segments.json"
    stale_segments_path.write_text(
        '{"segments":[{"id":"seg-0001","start_ms":0,"end_ms":1000,"text":"stale"}]}',
        encoding="utf-8",
    )

    artifacts = write_transcript_files(
        text="fresh transcript without timing",
        output_dir=output_dir,
        output_stem="demo",
        model="iic/SenseVoiceSmall",
    )

    assert artifacts.segments_path is None
    assert not stale_segments_path.exists()


def test_qwen_asr_transcriber_uses_injected_model_factory() -> None:
    class FakeResult:
        text = "模型返回的文字稿"

    class FakeModel:
        def transcribe(self, audio: str, language: str) -> list[FakeResult]:
            assert audio == "cache/demo.wav"
            assert language == "Chinese"
            return [FakeResult()]

    received_kwargs: dict[str, object] = {}

    def fake_factory(**kwargs: object) -> FakeModel:
        received_kwargs.update(kwargs)
        return FakeModel()

    transcriber = QwenAsrTranscriber(
        model_factory=fake_factory,
        max_new_tokens=4096,
        max_inference_batch_size=4,
    )

    transcript = transcriber.transcribe(Path("cache/demo.wav"))

    assert transcript == Transcript(text="模型返回的文字稿", language="Chinese")
    assert received_kwargs == {
        "model_name": "Qwen/Qwen3-ASR-0.6B",
        "max_inference_batch_size": 4,
        "max_new_tokens": 4096,
    }


def test_resolve_model_cache_dir_defaults_to_project_models(tmp_path: Path) -> None:
    cache_dir = resolve_model_cache_dir(project_root=tmp_path, environ={})

    assert cache_dir == tmp_path / "models"


def test_resolve_model_cache_dir_uses_explicit_env_path(tmp_path: Path) -> None:
    cache_dir = resolve_model_cache_dir(
        project_root=tmp_path,
        environ={"FRAMEQ_MODEL_DIR": str(tmp_path / "custom-model-cache")},
    )

    assert cache_dir == tmp_path / "custom-model-cache"


def test_build_qwen_asr_transcriber_creates_cache_dir_and_passes_it(
    tmp_path: Path,
) -> None:
    cache_dir = tmp_path / "models"

    transcriber = build_qwen_asr_transcriber(
        model_name="Qwen/Qwen3-ASR-0.6B",
        cache_dir=cache_dir,
    )

    assert cache_dir.is_dir()
    assert transcriber.model_kwargs["cache_dir"] == cache_dir.as_posix()


def test_supported_asr_models_include_qwen_and_available_sensevoice_models() -> None:
    assert supported_asr_model_names() == [
        "iic/SenseVoiceSmall",
        "Qwen/Qwen3-ASR-0.6B",
    ]


def test_build_asr_transcriber_selects_sensevoice_for_small(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache_dir = tmp_path / "models"
    monkeypatch.delenv("MODELSCOPE_CACHE", raising=False)

    small = build_asr_transcriber("iic/SenseVoiceSmall", cache_dir=cache_dir)

    assert isinstance(small, SenseVoiceTranscriber)
    assert small.model_name == "iic/SenseVoiceSmall"
    assert os.environ["MODELSCOPE_CACHE"] == cache_dir.as_posix()
    assert "model_cache_dir" not in small.model_kwargs


def test_sensevoice_transcriber_uses_funasr_generate_api() -> None:
    class FakeModel:
        def generate(self, **kwargs: object) -> list[dict[str, str]]:
            assert kwargs["input"] == "cache/demo.wav"
            assert kwargs["language"] == "zh"
            assert kwargs["use_itn"] is True
            assert kwargs["batch_size_s"] == 60
            assert kwargs["merge_vad"] is True
            assert kwargs["merge_length_s"] == 15
            assert kwargs["cache"] == {}
            return [{"text": "<|zh|><|HAPPY|><|BGM|><|withitn|>SenseVoice 识别出的文字稿"}]

    received_kwargs: dict[str, object] = {}

    def fake_factory(**kwargs: object) -> FakeModel:
        received_kwargs.update(kwargs)
        return FakeModel()

    transcriber = SenseVoiceTranscriber(
        model_name="iic/SenseVoiceSmall",
        model_factory=fake_factory,
        model_kwargs={"model_cache_dir": "models"},
    )

    transcript = transcriber.transcribe(Path("cache/demo.wav"))

    assert transcript == Transcript(text="SenseVoice 识别出的文字稿", language="Chinese")
    assert received_kwargs == {
        "model": "iic/SenseVoiceSmall",
        "trust_remote_code": True,
        "model_cache_dir": "models",
        "vad_model": "fsmn-vad",
        "vad_kwargs": {"max_single_segment_time": 30000},
    }


def test_sensevoice_transcriber_extracts_valid_segments_without_relying_on_speaker() -> None:
    class FakeModel:
        def generate(self, **kwargs: object) -> list[dict[str, object]]:
            return [
                {
                    "text": "first second third",
                    "sentence_info": [
                        {"start": 0, "end": 1000, "text": "first", "speaker": "solo"},
                        {"start": 1000, "end": 2300, "text": "second"},
                        {"start": 2300, "end": 3600, "text": "third", "spk": "speaker-b"},
                        {"start": 4000, "end": 3900, "text": "invalid"},
                        {"start": 4500, "end": 5000, "text": "   "},
                    ],
                }
            ]

    transcriber = SenseVoiceTranscriber(model_factory=lambda **kwargs: FakeModel())

    transcript = transcriber.transcribe(Path("cache/demo.wav"))

    assert transcript.text == "first second third"
    assert transcript.segments == (
        TranscriptSegment(id="seg-0001", start_ms=0, end_ms=1000, text="first", speaker="solo"),
        TranscriptSegment(id="seg-0002", start_ms=1000, end_ms=2300, text="second"),
        TranscriptSegment(
            id="seg-0003",
            start_ms=2300,
            end_ms=3600,
            text="third",
            speaker="speaker-b",
        ),
    )


def test_sensevoice_transcriber_builds_segments_from_vad_blocks_when_sentence_info_is_absent(
    tmp_path: Path,
) -> None:
    audio_path = tmp_path / "speech.wav"
    with wave.open(str(audio_path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0" * 16000 * 33)

    class FakeFrontend:
        fs = 16000

    class FakeModel:
        def __init__(self) -> None:
            self.vad_model = object()
            self.model = object()
            self.vad_kwargs: dict[str, object] = {}
            self.kwargs: dict[str, object] = {
                "frontend": FakeFrontend(),
                "device": "cpu",
                "batch_size": 1,
            }

        def _reset_runtime_configs(self) -> None:
            return None

        def inference(
            self,
            input: object,
            model: object,
            **kwargs: object,
        ) -> list[dict[str, object]]:
            if model is self.vad_model:
                return [{"key": "speech", "value": [[0, 16000], [16000, 33000]]}]

            assert isinstance(input, list)
            assert len(input) == 2
            return [
                {"text": "<|zh|><|withitn|>第一段"},
                {"text": "<|zh|><|withitn|>第二段"},
            ]

        def generate(self, **kwargs: object) -> list[dict[str, object]]:
            raise AssertionError("full-audio fallback should not run when VAD blocks succeed")

    transcriber = SenseVoiceTranscriber(model_factory=lambda **kwargs: FakeModel())

    transcript = transcriber.transcribe(audio_path)

    assert transcript.text == "第一段 第二段"
    assert transcript.segments == (
        TranscriptSegment(id="seg-0001", start_ms=0, end_ms=16000, text="第一段"),
        TranscriptSegment(id="seg-0002", start_ms=16000, end_ms=33000, text="第二段"),
    )


def test_qwen_asr_transcriber_reports_missing_dependency() -> None:
    def missing_factory(**kwargs: object) -> object:
        raise ModuleNotFoundError("No module named 'qwen_asr'")

    transcriber = QwenAsrTranscriber(model_factory=missing_factory)

    with pytest.raises(ASRDependencyError) as error:
        transcriber.transcribe(Path("cache/demo.wav"))

    assert error.value.code == "ASR_DEPENDENCY_MISSING"


def test_sensevoice_transcriber_reports_missing_transitive_dependency() -> None:
    def missing_factory(**kwargs: object) -> object:
        raise ModuleNotFoundError("No module named 'torchaudio'")

    transcriber = SenseVoiceTranscriber(model_factory=missing_factory)

    with pytest.raises(ASRDependencyError) as error:
        transcriber.transcribe(Path("cache/demo.wav"))

    assert error.value.code == "ASR_DEPENDENCY_MISSING"
    assert str(error.value) == (
        "Missing ASR runtime dependency: torchaudio. "
        "Install project dependencies with `uv sync` before running SenseVoice ASR."
    )


def test_qwen_asr_transcriber_rejects_empty_text() -> None:
    class EmptyResult:
        text = " "

    class EmptyModel:
        def transcribe(self, audio: str, language: str) -> list[EmptyResult]:
            return [EmptyResult()]

    transcriber = QwenAsrTranscriber(model_factory=lambda **kwargs: EmptyModel())

    with pytest.raises(ASRRuntimeError) as error:
        transcriber.transcribe(Path("cache/demo.wav"))

    assert error.value.code == "ASR_EMPTY_TRANSCRIPT"
