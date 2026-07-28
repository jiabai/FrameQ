# ONNX VAD Result Contract Hardening Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` and execute these
> checkbox steps in order. The user selected inline execution; subagent delegation is not in scope.

**Goal:** Decode the real ONNX VAD contract, require one audio-array ASR call per interval, and
remove every full-audio ONNX retry.

**Architecture:** Keep the provider-specific nested-list decoder in `sensevoice_onnx.py` while
retaining shared PCM reading, slicing, language, and text normalization helpers. Convert the ONNX
pipeline from optional preparation plus compatibility fallback into a terminal segmented
pipeline with typed errors at every boundary.

**Tech Stack:** Python 3.12, pytest, NumPy, `funasr_onnx 0.4.2`, ONNX Runtime, Ruff.

---

## Purpose / Big Picture

SenseVoiceSmall-ONNX will reliably transcribe long audio through independent VAD blocks. A VAD
provider mismatch or preparation failure will stop with a truthful typed ASR error instead of
silently retrying the complete audio and exhausting system commit space. Users keep the same task
stages, error-code family, local-only ASR processing, and transcript artifacts.

## Progress

- [x] 2026-07-29: Reproduced the provider-contract mismatch with the bundled runtime: real
  `Fsmn_vad` output is a nested list batch while the shared PyTorch decoder accepts only a
  dictionary result, producing zero parsed intervals.
  Validation: bundled-Python VAD probe printed `raw_type=list`, `first_type=list`, and
  `parsed_count=0`.
- [x] 2026-07-29: User approved the fail-closed design with mandatory ONNX VAD and no full-audio
  compatibility path.
  Validation: user confirmation “确认方案1”.
- [ ] 2026-07-29: Add RED regression coverage for the real provider shape and every preparation
  failure boundary.
  Validation: pending focused pytest evidence.
- [ ] 2026-07-29: Implement the ONNX-owned VAD decoder and fail-closed segmented pipeline.
  Validation: pending focused/full worker evidence.
- [ ] 2026-07-29: Run bundled-runtime and 95-minute operational acceptance, then complete all
  repository gates.
  Validation: pending real-model and quality-gate evidence.

## Surprises & Discoveries

Evidence: `funasr_onnx 0.4.2` `Fsmn_vad.__call__` returns `segments`, initialized as one list per
batch, directly. It does not wrap intervals in an AutoModel-style
`{"value": [[start_ms, end_ms]]}` dictionary.

Evidence: `SenseVoiceOnnxTranscriber._transcribe_vad_segments` currently converts zero parsed
intervals, PCM read failures, empty slices, and all broadly caught preparation exceptions into
`None`; `transcribe` interprets that value as permission to call `_transcribe_full_audio`.

Evidence: the 2026-07-28 regression test monkeypatched `_extract_vad_segments` and therefore proved
per-block invocation only after prepared blocks existed. It did not exercise the actual
`Fsmn_vad` result contract or the pre-block fallback boundary.

## Decision Log

Decision: remove the ONNX full-audio compatibility path for every audio duration.
Rationale: the direct ONNX runner is safe only behind bounded VAD segments; duration-gated or
preparation-triggered fallbacks retain a second path that can allocate unbounded logits.
Date/Author: 2026-07-29, User + Codex.

Decision: keep the ONNX nested-list decoder provider-local instead of broadening the shared
PyTorch decoder.
Rationale: the two libraries expose different contracts; a shared permissive decoder would blur
provider ownership and could hide future upstream changes.
Date/Author: 2026-07-29, Codex.

Decision: preserve existing worker error codes and distinguish empty speech from malformed or
failed preparation.
Rationale: valid no-speech output is semantically empty, while malformed/provider/audio failures
are runtime faults; neither requires a desktop contract or UI schema change.
Date/Author: 2026-07-29, Codex.

## Outcomes & Retrospective

Implementation is pending.

Residual risk: until the real 95-minute acceptance completes, automated fakes prove call shape and
failure boundaries but do not prove the bundled provider completes every real segment.

## Context and Orientation

- Product specification:
  `docs/product-specs/2026-07-27-selectable-asr-model-on-demand-download.md`
- Durable design:
  `docs/design-docs/2026-07-29-onnx-vad-result-contract-hardening.md`
- Architecture summary: `docs/ARCHITECTURE.md`
- ONNX runtime owner: `worker/frameq_worker/asr_runtime/sensevoice_onnx.py`
- Shared PyTorch VAD helpers: `worker/frameq_worker/asr_runtime/sensevoice.py`
- Focused tests: `worker/tests/test_sensevoice_onnx.py`
- Previously failing task:
  `C:/Users/bicho/AppData/Local/com.frameq.desktop/outputs/tasks/20260728-151835-youtube-6fQGTf7cTmo`

## Plan of Work

### Task 1: Decode the real ONNX VAD batch contract

**Files:**

- Modify: `worker/tests/test_sensevoice_onnx.py`
- Modify: `worker/frameq_worker/asr_runtime/sensevoice_onnx.py`

- [ ] **Step 1: Replace the prepared-block test's decoder monkeypatch with the real provider shape**

Make `CallableVad.__call__` return the actual `batch_size=1` result and remove the
`_extract_vad_segments` monkeypatch:

```python
class CallableVad:
    def __call__(self, audio: object, **kwargs: object) -> object:
        calls.append(("vad", audio, kwargs))
        return [[[0, 1000], [1000, 2000]]]
```

Keep the existing assertions that two timing intervals produce two ordered ASR calls with
`"first audio block"` and `"second audio block"`.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
uv run pytest worker/tests/test_sensevoice_onnx.py::test_onnx_transcriber_uses_callable_vad_and_asr_apis_for_segments -q
```

Expected: FAIL because the PyTorch dictionary decoder returns zero intervals and the old code
performs one full-audio call.

- [ ] **Step 3: Add the strict provider-local decoder**

Import `_coerce_milliseconds` from the shared SenseVoice helpers and add:

```python
def _decode_onnx_vad_segments(results: object) -> list[list[int]]:
    if (
        not isinstance(results, list)
        or len(results) != 1
        or not isinstance(results[0], list)
    ):
        raise ASRRuntimeError("ONNX VAD returned an invalid segment result.")

    segments: list[list[int]] = []
    for item in results[0]:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            raise ASRRuntimeError("ONNX VAD returned an invalid segment result.")
        start_ms = _coerce_milliseconds(item[0])
        end_ms = _coerce_milliseconds(item[1])
        if start_ms is None or end_ms is None or end_ms <= start_ms:
            raise ASRRuntimeError("ONNX VAD returned an invalid segment result.")
        segments.append([start_ms, end_ms])
    return segments
```

Replace the ONNX call to shared `_extract_vad_segments` with
`_decode_onnx_vad_segments(vad_results)`. Do not change the shared PyTorch decoder.

- [ ] **Step 4: Run the focused test and verify GREEN**

```powershell
uv run pytest worker/tests/test_sensevoice_onnx.py::test_onnx_transcriber_uses_callable_vad_and_asr_apis_for_segments -q
```

Expected: `1 passed`.

### Task 2: Make every ONNX preparation boundary fail closed

**Files:**

- Modify: `worker/tests/test_sensevoice_onnx.py`
- Modify: `worker/frameq_worker/asr_runtime/sensevoice_onnx.py`

- [ ] **Step 1: Add failure-first tests**

Add these complete focused tests with recording ASR fakes:

```python
def test_onnx_vad_failure_is_terminal_without_asr_call(tmp_path: Path) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASRRuntimeError

    asr_calls: list[object] = []

    def recording_asr(audio: object, **_kwargs: object) -> list[str]:
        asr_calls.append(audio)
        return ["ASR should not run"]

    def failing_vad(_audio: object) -> object:
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
        [],
        [{"value": [[0, 1000]]}],
        [[[0, 1000]], [[1000, 2000]]],
        [["invalid segment"]],
        [[[1000, 1000]]],
    ],
)
def test_onnx_invalid_vad_result_is_terminal_without_asr_call(
    tmp_path: Path,
    vad_result: object,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASRRuntimeError

    asr_calls: list[object] = []

    def recording_asr(audio: object, **_kwargs: object) -> list[str]:
        asr_calls.append(audio)
        return ["ASR should not run"]

    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: recording_asr,
        vad_factory=lambda **_kwargs: lambda _audio: vad_result,
    )

    with pytest.raises(ASRRuntimeError, match="invalid segment result"):
        transcriber.transcribe(tmp_path / "audio.wav")

    assert asr_calls == []


def test_onnx_empty_vad_batch_returns_empty_transcript_without_asr_call(
    tmp_path: Path,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASREmptyTranscriptError

    asr_calls: list[object] = []

    def recording_asr(audio: object, **_kwargs: object) -> list[str]:
        asr_calls.append(audio)
        return ["ASR should not run"]

    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: recording_asr,
        vad_factory=lambda **_kwargs: lambda _audio: [[]],
    )

    with pytest.raises(ASREmptyTranscriptError, match="detected no speech"):
        transcriber.transcribe(tmp_path / "audio.wav")

    assert asr_calls == []


def test_onnx_pcm_read_failure_is_terminal_without_asr_call(
    tmp_path: Path,
    monkeypatch,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASRRuntimeError

    asr_calls: list[object] = []

    def recording_asr(audio: object, **_kwargs: object) -> list[str]:
        asr_calls.append(audio)
        return ["ASR should not run"]

    monkeypatch.setattr(
        sensevoice_onnx,
        "_read_pcm_wav_mono_float32",
        lambda _path, _np: None,
    )
    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: recording_asr,
        vad_factory=lambda **_kwargs: lambda _audio: [[[0, 1000]]],
    )

    with pytest.raises(ASRRuntimeError, match="could not read normalized PCM WAV"):
        transcriber.transcribe(tmp_path / "audio.wav")

    assert asr_calls == []


def test_onnx_unusable_slices_are_terminal_without_asr_call(
    tmp_path: Path,
    monkeypatch,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASRRuntimeError

    asr_calls: list[object] = []

    def recording_asr(audio: object, **_kwargs: object) -> list[str]:
        asr_calls.append(audio)
        return ["ASR should not run"]

    monkeypatch.setattr(
        sensevoice_onnx,
        "_read_pcm_wav_mono_float32",
        lambda _path, _np: (object(), 16000),
    )
    monkeypatch.setattr(
        sensevoice_onnx,
        "_slice_audio_by_milliseconds",
        lambda **_kwargs: ([], []),
    )
    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: recording_asr,
        vad_factory=lambda **_kwargs: lambda _audio: [[[0, 1000]]],
    )

    with pytest.raises(ASRRuntimeError, match="no usable audio segments"):
        transcriber.transcribe(tmp_path / "audio.wav")

    assert asr_calls == []


def test_onnx_all_empty_blocks_return_empty_transcript(
    tmp_path: Path,
    monkeypatch,
) -> None:
    from frameq_worker.asr_runtime import sensevoice_onnx
    from frameq_worker.asr_runtime.types import ASREmptyTranscriptError

    first_block = object()
    second_block = object()
    asr_calls: list[object] = []

    def empty_asr(audio: object, **_kwargs: object) -> list[str]:
        asr_calls.append(audio)
        return ["<|zh|>"] if audio is first_block else [""]

    monkeypatch.setattr(
        sensevoice_onnx,
        "_read_pcm_wav_mono_float32",
        lambda _path, _np: (object(), 16000),
    )
    monkeypatch.setattr(
        sensevoice_onnx,
        "_slice_audio_by_milliseconds",
        lambda **_kwargs: (
            [first_block, second_block],
            [(0, 1000), (1000, 2000)],
        ),
    )
    transcriber = sensevoice_onnx.SenseVoiceOnnxTranscriber(
        asr_model_dir=tmp_path / "SenseVoiceSmall-onnx",
        vad_model_dir=tmp_path / "vad",
        asr_factory=lambda **_kwargs: empty_asr,
        vad_factory=lambda **_kwargs: lambda _audio: [
            [[0, 1000], [1000, 2000]]
        ],
    )

    with pytest.raises(ASREmptyTranscriptError, match="empty transcript"):
        transcriber.transcribe(tmp_path / "audio.wav")

    assert asr_calls == [first_block, second_block]
```

Extend the provider source guard with:

```python
assert "_transcribe_full_audio" not in provider_source
```

- [ ] **Step 2: Run the focused module and verify RED**

```powershell
uv run pytest worker/tests/test_sensevoice_onnx.py -q
```

Expected: the new preparation-failure tests fail because the current broad catch returns `None`,
and the source guard fails because `_transcribe_full_audio` still exists.

- [ ] **Step 3: Replace optional preparation with a terminal segmented pipeline**

Change `transcribe` to:

```python
def transcribe(self, audio_path: Path, language: str = "Chinese") -> Transcript:
    return self._transcribe_vad_segments(self._get_asr(), audio_path, language)
```

Make `_transcribe_vad_segments` return `Transcript`, and implement these exact boundaries:

```python
try:
    import numpy as np
except ModuleNotFoundError as exc:
    raise ASRDependencyError(
        missing_dependency_message(exc, runtime_name="SenseVoice ONNX ASR")
    ) from exc

try:
    vad_results = self._get_vad()(audio_path.as_posix())
except ASRDependencyError:
    raise
except Exception as exc:
    raise ASRRuntimeError("ONNX VAD inference failed.") from exc

vad_segments = _decode_onnx_vad_segments(vad_results)
if not vad_segments:
    raise ASREmptyTranscriptError("ONNX VAD detected no speech.")

audio_samples = _read_pcm_wav_mono_float32(audio_path, np)
if audio_samples is None:
    raise ASRRuntimeError("ONNX ASR could not read normalized PCM WAV audio.")

try:
    blocks, valid_segments = _slice_audio_by_milliseconds(
        samples=audio_samples[0],
        sample_rate=audio_samples[1],
        vad_segments=vad_segments,
    )
except Exception as exc:
    raise ASRRuntimeError("ONNX ASR segment preparation failed.") from exc

if not blocks or len(blocks) != len(valid_segments):
    raise ASRRuntimeError("ONNX VAD returned no usable audio segments.")
```

Keep the existing one-call-per-block loop and terminal block/all-empty behavior. Delete
`_transcribe_full_audio`; do not add any duration-based alternative.

- [ ] **Step 4: Run the focused module and verify GREEN**

```powershell
uv run pytest worker/tests/test_sensevoice_onnx.py -q
```

Expected: all focused ONNX tests pass.

### Task 3: Regression, packaged runtime, and real-media acceptance

**Files:**

- Modify while executing:
  `docs/exec-plans/active/2026-07-29-onnx-vad-result-contract-hardening-plan.md`
- Modify after acceptance: `TASKS.md`
- Move after acceptance:
  `docs/exec-plans/active/2026-07-29-onnx-vad-result-contract-hardening-plan.md`
  to `docs/exec-plans/completed/2026-07-29-onnx-vad-result-contract-hardening-plan.md`
- Modify after move: `docs/exec-plans/active/index.md`
- Modify after move: `docs/exec-plans/completed/index.md`
- Generated verification target:
  `app/src-tauri/target/debug/resources/worker/frameq_worker/asr_runtime/sensevoice_onnx.py`

- [ ] **Step 1: Run focused neighboring and full worker regression**

```powershell
uv run pytest worker/tests/test_asr.py worker/tests/test_pipeline.py -q
uv run pytest worker/tests
uv run ruff check worker
```

Expected: all tests pass (with only the repository's established skips) and Ruff exits zero.

- [ ] **Step 2: Refresh and verify the packaged worker**

```powershell
npm --prefix app run build
uv run pytest worker/tests/test_packaging.py -q
```

Expected: frontend/package preparation exits zero and the generated worker matches the canonical
worker byte-for-byte.

- [ ] **Step 3: Run the bundled-provider VAD smoke**

Use bundled Python, bundled `funasr_onnx`, the official cached ONNX VAD, and the official VAD sample.
Pass the raw result to `_decode_onnx_vad_segments`.

Expected: the raw first element is a list and the decoder returns at least one valid interval.

- [ ] **Step 4: Run the retained 95-minute audio through an instrumented real transcriber**

Wrap the real `SenseVoiceSmall` callable with a recorder that rejects `str` and `list` ASR inputs,
accepts only one `numpy.ndarray`, and counts calls. Invoke `SenseVoiceOnnxTranscriber.transcribe`
against:

```text
C:/Users/bicho/AppData/Local/com.frameq.desktop/outputs/tasks/
20260728-151835-youtube-6fQGTf7cTmo/media/audio.wav
```

Expected: completion with non-empty transcript text, ordered transcript segments, more than one ASR
call, zero path/list ASR inputs, and no full-audio allocation failure.

- [ ] **Step 5: Complete governance and archive the plan**

Update Progress, Surprises & Discoveries, Outcomes & Retrospective, `TASKS.md`, and both plan
indexes with exact test/real-media evidence. Move this plan from active to completed, then run:

```powershell
python scripts/validate_agents_docs.py --level WARN
git diff --check
git status --short
```

Expected: zero document errors/warnings, zero whitespace errors, and only intended files changed.

## Validation and Acceptance

```powershell
uv run pytest worker/tests/test_sensevoice_onnx.py -q
uv run pytest worker/tests/test_asr.py worker/tests/test_pipeline.py -q
uv run pytest worker/tests
uv run ruff check worker
npm --prefix app run build
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Bundled-provider smoke acceptance:

```text
Run the bundled Python and packaged worker against the official VAD sample. The ONNX-owned decoder
must return one or more intervals from the real nested-list result.
```

Long-audio operational acceptance:

```text
Run the retained 95-minute audio through SenseVoiceSmall-ONNX. Completion requires a non-empty
Transcript with ordered segments, no ASR call receiving the original audio path or a block list,
and no full-audio logits/commit-space failure.
```
