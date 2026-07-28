from __future__ import annotations

import sys
import types
from pathlib import Path


def test_onnx_transcriber_loads_direct_quantized_asr_and_vad(
    tmp_path: Path,
    monkeypatch,
) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    class FakeSenseVoiceSmall:
        def __init__(self, **kwargs: object) -> None:
            calls.append(("asr", kwargs))

    class FakeFsmnVad:
        def __init__(self, **kwargs: object) -> None:
            calls.append(("vad", kwargs))

    monkeypatch.setitem(
        sys.modules,
        "funasr_onnx",
        types.SimpleNamespace(SenseVoiceSmall=FakeSenseVoiceSmall, Fsmn_vad=FakeFsmnVad),
    )

    from frameq_worker.asr_runtime.sensevoice_onnx import SenseVoiceOnnxTranscriber

    asr_dir = tmp_path / "SenseVoiceSmall-onnx"
    vad_dir = tmp_path / "vad"
    transcriber = SenseVoiceOnnxTranscriber(asr_model_dir=asr_dir, vad_model_dir=vad_dir)

    transcriber._get_asr()
    transcriber._get_vad()

    assert calls == [
        (
            "asr",
            {
                "model_dir": asr_dir.as_posix(),
                "quantize": True,
                "batch_size": 1,
                "device_id": "-1",
            },
        ),
        (
            "vad",
            {
                "model_dir": vad_dir.as_posix(),
                "quantize": True,
                "device_id": "-1",
            },
        ),
    ]


def test_onnx_transcriber_uses_callable_asr_api_and_string_results(
    tmp_path: Path,
    monkeypatch,
) -> None:
    calls: list[tuple[object, dict[str, object]]] = []

    class CallableAsr:
        def __call__(self, audio: object, **kwargs: object) -> list[str]:
            calls.append((audio, kwargs))
            return ["<|zh|>你好"]

    from frameq_worker.asr_runtime.sensevoice_onnx import SenseVoiceOnnxTranscriber

    transcriber = SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: CallableAsr(),
    )
    monkeypatch.setattr(transcriber, "_transcribe_vad_segments", lambda *_args: None)
    audio_path = tmp_path / "audio.wav"

    transcript = transcriber.transcribe(audio_path, language="Chinese")

    assert transcript.text == "你好"
    assert calls == [
        (
            audio_path.as_posix(),
            {"language": "zh", "textnorm": "withitn"},
        )
    ]


def test_onnx_transcriber_uses_callable_vad_and_asr_apis_for_segments(
    tmp_path: Path,
    monkeypatch,
) -> None:
    calls: list[tuple[str, object, dict[str, object]]] = []

    class CallableAsr:
        def __call__(self, audio: object, **kwargs: object) -> list[str]:
            calls.append(("asr", audio, kwargs))
            return ["片段文字"]

    class CallableVad:
        def __call__(self, audio: object, **kwargs: object) -> object:
            calls.append(("vad", audio, kwargs))
            return object()

    from frameq_worker.asr_runtime import sensevoice_onnx

    monkeypatch.setattr(sensevoice_onnx, "_extract_vad_segments", lambda _result: [[0, 1000]])
    monkeypatch.setattr(
        sensevoice_onnx,
        "_read_pcm_wav_mono_float32",
        lambda _path, _np: (object(), 16000),
    )
    monkeypatch.setattr(
        sensevoice_onnx,
        "_slice_audio_by_milliseconds",
        lambda **_kwargs: (["audio block"], [(0, 1000)]),
    )
    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: CallableAsr(),
        vad_factory=lambda **_kwargs: CallableVad(),
    )
    audio_path = tmp_path / "audio.wav"

    transcript = transcriber.transcribe(audio_path, language="Chinese")

    assert transcript.text == "片段文字"
    assert transcript.segments[0].start_ms == 0
    assert transcript.segments[0].end_ms == 1000
    assert calls == [
        ("vad", audio_path.as_posix(), {}),
        ("asr", ["audio block"], {"language": "zh", "textnorm": "withitn"}),
    ]


def test_onnx_provider_never_imports_or_calls_pytorch_automodel() -> None:
    provider_source = (
        Path(__file__).parents[1]
        / "frameq_worker"
        / "asr_runtime"
        / "sensevoice_onnx.py"
    ).read_text(encoding="utf-8")

    assert "AutoModel" not in provider_source
    assert "from funasr import" not in provider_source
