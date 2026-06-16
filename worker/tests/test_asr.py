from pathlib import Path

import pytest
from frameq_worker.asr import (
    ASRDependencyError,
    ASRRuntimeError,
    QwenAsrTranscriber,
    Transcript,
    build_qwen_asr_transcriber,
    resolve_model_cache_dir,
    transcribe_and_write,
    write_transcript_files,
)


class FakeTranscriber:
    def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
        return Transcript(text=f"来自 {audio_path.name} 的文字稿", language=language)


def test_write_transcript_files_creates_non_empty_txt_and_markdown(tmp_path: Path) -> None:
    artifacts = write_transcript_files(
        text="这里是从视频语音中识别出的完整文字内容。",
        output_dir=tmp_path / "outputs",
        output_stem="7524373044106677544",
        model="Qwen/Qwen3-ASR-0.6B",
        source_url="https://www.douyin.com/video/7524373044106677544",
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


def test_transcribe_and_write_uses_transcriber_and_outputs_files(tmp_path: Path) -> None:
    audio_path = tmp_path / "work" / "demo.wav"
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


def test_qwen_asr_transcriber_uses_injected_model_factory() -> None:
    class FakeResult:
        text = "模型返回的文字稿"

    class FakeModel:
        def transcribe(self, audio: str, language: str) -> list[FakeResult]:
            assert audio == "work/demo.wav"
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

    transcript = transcriber.transcribe(Path("work/demo.wav"))

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


def test_qwen_asr_transcriber_reports_missing_dependency() -> None:
    def missing_factory(**kwargs: object) -> object:
        raise ModuleNotFoundError("No module named 'qwen_asr'")

    transcriber = QwenAsrTranscriber(model_factory=missing_factory)

    with pytest.raises(ASRDependencyError) as error:
        transcriber.transcribe(Path("work/demo.wav"))

    assert error.value.code == "ASR_DEPENDENCY_MISSING"


def test_qwen_asr_transcriber_rejects_empty_text() -> None:
    class EmptyResult:
        text = " "

    class EmptyModel:
        def transcribe(self, audio: str, language: str) -> list[EmptyResult]:
            return [EmptyResult()]

    transcriber = QwenAsrTranscriber(model_factory=lambda **kwargs: EmptyModel())

    with pytest.raises(ASRRuntimeError) as error:
        transcriber.transcribe(Path("work/demo.wav"))

    assert error.value.code == "ASR_EMPTY_TRANSCRIPT"
