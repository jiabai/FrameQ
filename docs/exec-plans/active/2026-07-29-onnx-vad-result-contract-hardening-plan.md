# ONNX VAD Result Contract Hardening Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

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
batch, directly. It does not wrap intervals in an AutoModel-style `{"value": ...}` dictionary.

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

1. Add a focused test that supplies `[[[0, 1000], [1000, 2000]]]` directly from the fake ONNX VAD,
   uses deterministic audio slicing, and proves two independent ASR calls in timing order.
2. Add focused failure tests for VAD exceptions, invalid nested shapes, valid empty output, PCM
   read failure, empty slices, block exceptions, and all-empty block text. Every pre-block failure
   must prove the ASR fake received no original path.
3. Add an ONNX-local strict VAD decoder and replace optional segmented preparation with a terminal
   segmented pipeline. Remove the full-audio ONNX call.
4. Keep the existing PyTorch decoder and behavior unchanged; run the affected ASR and pipeline
   regression suites.
5. Refresh the generated Tauri worker mirror through the established build path and prove
   canonical/resource byte equality.
6. Probe the bundled VAD sample with the new decoder, then transcribe the retained 95-minute task
   audio with the real local ONNX ASR/VAD models and verify a non-empty segmented result.
7. Complete worker, lint, governance, packaging, and diff gates; update this living plan and move
   it to `completed/`.

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
