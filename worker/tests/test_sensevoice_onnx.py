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


def test_onnx_provider_never_imports_or_calls_pytorch_automodel() -> None:
    provider_source = (
        Path(__file__).parents[1]
        / "frameq_worker"
        / "asr_runtime"
        / "sensevoice_onnx.py"
    ).read_text(encoding="utf-8")

    assert "AutoModel" not in provider_source
    assert "from funasr import" not in provider_source
