from __future__ import annotations

import sys
import types
from pathlib import Path

import numpy as np
import pytest


def _install_pcm(
    monkeypatch: pytest.MonkeyPatch,
    module: object,
    *,
    duration_seconds: float = 1.0,
    sample_rate: int = 16000,
) -> np.ndarray:
    samples = np.zeros(int(duration_seconds * sample_rate), dtype=np.float32)
    monkeypatch.setattr(
        module,
        "_read_pcm_wav_mono_float32",
        lambda _path, _np: (samples, sample_rate),
    )
    return samples


def test_onnx_transcriber_loads_direct_quantized_asr_and_online_vad(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    class FakeSenseVoiceSmall:
        def __init__(self, **kwargs: object) -> None:
            calls.append(("asr", kwargs))

    class FakeFsmnVadOnline:
        def __init__(self, **kwargs: object) -> None:
            calls.append(("vad", kwargs))

    monkeypatch.setitem(
        sys.modules,
        "funasr_onnx",
        types.SimpleNamespace(
            SenseVoiceSmall=FakeSenseVoiceSmall,
            Fsmn_vad_online=FakeFsmnVadOnline,
        ),
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


def test_onnx_transcriber_streams_bounded_vad_and_calls_asr_per_segment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx

    samples = _install_pcm(
        monkeypatch,
        sensevoice_onnx,
        duration_seconds=25.0,
    )
    vad_results = iter(
        [
            [[[0, -1]]],
            [],
            [[[-1, 1000], [1000, 2000]]],
        ]
    )
    vad_calls: list[tuple[np.ndarray, dict[str, object], bool]] = []
    asr_calls: list[tuple[np.ndarray, dict[str, object]]] = []

    class CallableVad:
        def __call__(self, audio: object, **kwargs: object) -> object:
            assert isinstance(audio, np.ndarray)
            state = kwargs["param_dict"]
            assert isinstance(state, dict)
            vad_calls.append((audio, state, bool(state["is_final"])))
            return next(vad_results)

    class CallableAsr:
        def __call__(self, audio: object, **kwargs: object) -> list[str]:
            assert isinstance(audio, np.ndarray)
            asr_calls.append((audio, kwargs))
            return [f"segment {len(asr_calls)}"]

    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: CallableAsr(),
        vad_factory=lambda **_kwargs: CallableVad(),
    )

    transcript = transcriber.transcribe(tmp_path / "audio.wav", language="Chinese")

    assert transcript.text == "segment 1 segment 2"
    assert [(segment.start_ms, segment.end_ms) for segment in transcript.segments] == [
        (0, 1000),
        (1000, 2000),
    ]
    assert [len(audio) for audio, _state, _final in vad_calls] == [
        160000,
        160000,
        80000,
    ]
    assert [is_final for _audio, _state, is_final in vad_calls] == [False, False, True]
    assert len({id(state) for _audio, state, _final in vad_calls}) == 1
    assert all(np.shares_memory(audio, samples) for audio, _state, _final in vad_calls)
    assert [len(audio) for audio, _kwargs in asr_calls] == [16000, 16000]
    assert [kwargs for _audio, kwargs in asr_calls] == [
        {"language": "zh", "textnorm": "withitn"},
        {"language": "zh", "textnorm": "withitn"},
    ]


def test_onnx_vad_failure_is_terminal_without_asr_call(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASRRuntimeError

    _install_pcm(monkeypatch, sensevoice_onnx)
    asr_calls: list[object] = []

    def recording_asr(audio: object, **_kwargs: object) -> list[str]:
        asr_calls.append(audio)
        return ["ASR should not run"]

    def failing_vad(_audio: object, **_kwargs: object) -> object:
        raise RuntimeError("vad failed")

    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: recording_asr,
        vad_factory=lambda **_kwargs: failing_vad,
    )

    with pytest.raises(ASRRuntimeError, match="ONNX VAD inference failed"):
        transcriber.transcribe(tmp_path / "audio.wav")

    assert asr_calls == []


@pytest.mark.parametrize(
    "vad_result",
    [
        [[]],
        [{"value": [[0, 1000]]}],
        [[[0, 1000]], [[1000, 2000]]],
        [["invalid event"]],
        [[[-2, 1000]]],
        [[[-1, -1]]],
        [[[-1, 1000]]],
        [[[0, -1], [1000, -1]]],
        [[[1000, 1000]]],
        [[[1000, 2000], [500, 800]]],
        [[[0, -1]]],
    ],
)
def test_onnx_invalid_vad_event_stream_is_terminal_without_asr_call(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    vad_result: object,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASRRuntimeError

    _install_pcm(monkeypatch, sensevoice_onnx)
    asr_calls: list[object] = []

    def recording_asr(audio: object, **_kwargs: object) -> list[str]:
        asr_calls.append(audio)
        return ["ASR should not run"]

    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: recording_asr,
        vad_factory=lambda **_kwargs: lambda _audio, **_call_kwargs: vad_result,
    )

    with pytest.raises(ASRRuntimeError, match="invalid event stream"):
        transcriber.transcribe(tmp_path / "audio.wav")

    assert asr_calls == []


def test_onnx_completed_empty_vad_stream_returns_empty_transcript_without_asr_call(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASREmptyTranscriptError

    _install_pcm(monkeypatch, sensevoice_onnx)
    asr_calls: list[object] = []

    def recording_asr(audio: object, **_kwargs: object) -> list[str]:
        asr_calls.append(audio)
        return ["ASR should not run"]

    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: recording_asr,
        vad_factory=lambda **_kwargs: lambda _audio, **_call_kwargs: [],
    )

    with pytest.raises(ASREmptyTranscriptError, match="detected no speech"):
        transcriber.transcribe(tmp_path / "audio.wav")

    assert asr_calls == []


def test_onnx_pcm_read_failure_is_terminal_without_provider_calls(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASRRuntimeError

    provider_calls: list[str] = []
    monkeypatch.setattr(
        sensevoice_onnx,
        "_read_pcm_wav_mono_float32",
        lambda _path, _np: None,
    )

    def recording_asr(_audio: object, **_kwargs: object) -> list[str]:
        provider_calls.append("asr")
        return ["ASR should not run"]

    def recording_vad(_audio: object, **_kwargs: object) -> object:
        provider_calls.append("vad")
        return [[[0, 1000]]]

    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: recording_asr,
        vad_factory=lambda **_kwargs: recording_vad,
    )

    with pytest.raises(ASRRuntimeError, match="could not read normalized PCM WAV"):
        transcriber.transcribe(tmp_path / "audio.wav")

    assert provider_calls == []


def test_onnx_unusable_slices_are_terminal_without_asr_call(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASRRuntimeError

    _install_pcm(monkeypatch, sensevoice_onnx)
    asr_calls: list[object] = []

    def recording_asr(audio: object, **_kwargs: object) -> list[str]:
        asr_calls.append(audio)
        return ["ASR should not run"]

    monkeypatch.setattr(
        sensevoice_onnx,
        "_slice_audio_by_milliseconds",
        lambda **_kwargs: ([], []),
    )
    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: recording_asr,
        vad_factory=lambda **_kwargs: lambda _audio, **_call_kwargs: [[[0, 1000]]],
    )

    with pytest.raises(ASRRuntimeError, match="no usable audio segments"):
        transcriber.transcribe(tmp_path / "audio.wav")

    assert asr_calls == []


def test_onnx_all_empty_blocks_return_empty_transcript(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASREmptyTranscriptError

    _install_pcm(monkeypatch, sensevoice_onnx, duration_seconds=2.0)
    asr_calls: list[np.ndarray] = []

    def empty_asr(audio: object, **_kwargs: object) -> list[str]:
        assert isinstance(audio, np.ndarray)
        asr_calls.append(audio)
        return ["<|zh|>"] if len(asr_calls) == 1 else [""]

    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: empty_asr,
        vad_factory=lambda **_kwargs: lambda _audio, **_call_kwargs: [
            [[0, 1000], [1000, 2000]]
        ],
    )

    with pytest.raises(ASREmptyTranscriptError, match="empty transcript"):
        transcriber.transcribe(tmp_path / "audio.wav")

    assert [len(audio) for audio in asr_calls] == [16000, 16000]


def test_onnx_segment_failure_does_not_fall_back_to_full_audio(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASRRuntimeError

    _install_pcm(monkeypatch, sensevoice_onnx)
    calls: list[object] = []

    class FailingSegmentAsr:
        def __call__(self, audio: object, **_kwargs: object) -> list[str]:
            calls.append(audio)
            raise RuntimeError("segment inference failed")

    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: FailingSegmentAsr(),
        vad_factory=lambda **_kwargs: lambda _audio, **_call_kwargs: [[[0, 1000]]],
    )
    audio_path = tmp_path / "long-audio.wav"

    with pytest.raises(ASRRuntimeError, match="segment inference failed"):
        transcriber.transcribe(audio_path, language="Chinese")

    assert len(calls) == 1
    assert isinstance(calls[0], np.ndarray)


def test_onnx_provider_never_imports_or_calls_full_audio_or_pytorch() -> None:
    provider_source = (
        Path(__file__).parents[1]
        / "frameq_worker"
        / "asr_runtime"
        / "sensevoice_onnx.py"
    ).read_text(encoding="utf-8")

    assert "AutoModel" not in provider_source
    assert "from funasr import" not in provider_source
    assert "from funasr_onnx import Fsmn_vad\n" not in provider_source
    assert "_transcribe_full_audio" not in provider_source
