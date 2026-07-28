# ONNX Segment Inference Hardening Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

SenseVoiceSmall-ONNX now transcribes prepared VAD blocks through independent ONNX calls. If one
block fails, FrameQ reports the existing ASR runtime failure instead of silently retrying the
original long audio as one full-audio inference and risking a multi-gigabyte logits allocation.
The PyTorch SenseVoiceSmall path and all task, artifact, model-download, and UI contracts remain
unchanged.

## Progress

- [x] 2026-07-28: Confirmed the root cause: `sensevoice_onnx.py` passed one `list[ndarray]` to the
  ONNX runner, broadly caught its exception, and returned `None` to the full-audio caller.
  Validation: source trace and the focused RED tests below.
- [x] 2026-07-28: Added regression tests for one-call-per-block behavior and terminal block
  failures that never reach the full-audio call.
  Validation: both tests failed for the intended old behavior before the production edit.
- [x] 2026-07-28: Implemented independent block calls, preserved block order/timing, and mapped
  block exceptions/all-empty results to terminal ASR errors.
  Validation: `uv run pytest worker/tests/test_sensevoice_onnx.py -q` (`5 passed`).
- [x] 2026-07-28: Completed worker, lint, governance, and diff gates.
  Validation: full worker suite `611 passed, 2 skipped`; ruff passed; docs validation reported
  `0 errors, 0 warnings`; `git diff --check` exited zero.

## Surprises & Discoveries

- Evidence: commit `c3b1a43` corrected the `funasr_onnx` callable API but retained the batched
  `blocks` input and the broad fallback boundary, so callable correctness and input-shape
  correctness were separate issues.
- Evidence: `SenseVoiceOnnxTranscriber.transcribe` treats `None` from `_transcribe_vad_segments`
  as authorization to call `_transcribe_full_audio`; therefore the provider exception had to be
  moved outside the best-effort segmentation-preparation catch.
- Evidence: the existing PyTorch adapter intentionally has its own best-effort VAD behavior in
  `sensevoice.py`; no shared helper or PyTorch behavior needed to change for this ONNX-only fix.

## Decision Log

- Decision: retain full-audio ONNX compatibility only when segmentation preparation returns no
  usable blocks before ASR block inference starts.
  Rationale: preserve the existing compatibility case without allowing an attempted segmented
  long-audio inference to escalate into a much larger allocation.
  Date/Author: 2026-07-28, User + Codex.
- Decision: a provider exception from any block and an all-empty set of block results are terminal.
  Rationale: retrying the source as one full-audio input can conceal the original failure and
  allocate full-length logits.
  Date/Author: 2026-07-28, User + Codex.
- Decision: keep the existing `ASR_RUNTIME_ERROR`/`ASR_EMPTY_TRANSCRIPT` codes and add segment
  position only to the wrapped runtime message.
  Rationale: the worker/UI contract already handles these errors and needs no schema expansion.
  Date/Author: 2026-07-28, Codex.

## Outcomes & Retrospective

The ONNX adapter no longer submits `list[ndarray]` as one SenseVoiceSmall-ONNX input. It calls the
runner once per prepared block and cannot cross from a block inference failure back into the
full-audio compatibility path. Automated validation passed: focused ONNX tests `5 passed`; full
worker tests `611 passed, 2 skipped`; ruff passed; governance validation found no errors or
warnings; diff checking passed.

Residual risk: the tests use injected ONNX/VAD fakes and do not run the original 95-minute media
through the real model. A failure before any block inference begins may still use the retained
full-audio compatibility path; the protected failure mode is an attempted block inference.

## Context and Orientation

- Runtime owner: `worker/frameq_worker/asr_runtime/sensevoice_onnx.py`
- Focused tests: `worker/tests/test_sensevoice_onnx.py`
- Product boundary:
  `docs/product-specs/2026-07-27-selectable-asr-model-on-demand-download.md`
- Runtime design:
  `docs/design-docs/2026-07-27-selectable-asr-model-on-demand-download.md`
- Architecture summary: `docs/ARCHITECTURE.md`

## Plan of Work

1. [x] Characterize the existing ONNX segment input and fallback data flow.
2. [x] Add RED tests proving desired per-block invocation and terminal error behavior.
3. [x] Make the minimal ONNX-only exception-boundary and invocation change.
4. [x] Synchronize the product, design, architecture, task, and plan records.
5. [x] Run focused/full worker validation and repository quality gates.

## Validation and Acceptance

```powershell
uv run pytest worker/tests/test_sensevoice_onnx.py -q
uv run pytest worker/tests
uv run ruff check worker
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Acceptance is satisfied when two or more prepared blocks produce two ordered ASR calls and when a
block exception raises `ASRRuntimeError` with no call that receives the original audio path. A
real-model 95-minute rerun remains optional operational evidence rather than an automated gate.
