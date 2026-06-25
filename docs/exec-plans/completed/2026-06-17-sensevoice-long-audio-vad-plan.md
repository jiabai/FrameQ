# SenseVoice Long Audio VAD Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Improve SenseVoice Small transcription quality on long local audio. After this change, the SenseVoice adapter uses FunASR's VAD-assisted long-audio settings and strips SenseVoice control tags from the user-facing transcript. The motivation is that the previous `generate()` call on a 425-second WAV produced a transcript that was visibly too short and exposed tags like `<|zh|><|HAPPY|><|BGM|><|withitn|>` in the output file, which leaked implementation details to the user.

## Progress

- [x] 2026-06-17: Added regression coverage for SenseVoice VAD model initialization, long-audio generate parameters, and tag cleanup. Validation: `uv run pytest worker\tests`.
- [x] 2026-06-17: Enabled `vad_model="fsmn-vad"` and `vad_kwargs={"max_single_segment_time": 30000}` by default for SenseVoice. Validation: focused worker test asserts both fields are passed.
- [x] 2026-06-17: Passed `batch_size_s=60`, `merge_vad=True`, `merge_length_s=15`, and `cache={}` to SenseVoice `generate()`. Validation: focused worker test asserts the `generate()` payload.
- [x] 2026-06-17: Stripped SenseVoice `<|...|>` control tags before transcript validation and file output. Validation: focused worker test asserts a transcript containing those tags is cleaned before file output.
- [x] 2026-06-17: Ran worker tests and ruff. Validation: `uv run pytest worker\tests` (55 passed) and `uv run ruff check worker`.

## Surprises & Discoveries

- Evidence: `work/7624469060838853914.wav` is valid 16 kHz mono PCM audio and is about 425 seconds long, which is past the threshold where SenseVoice's default `generate()` call returns a single short result without VAD.
- Evidence: the previous SenseVoice adapter called `generate()` on the full WAV without VAD/merge parameters, so FunASR's default behavior of treating the input as one segment applied.
- Evidence: the resulting transcript contained SenseVoice control tags such as `<|zh|><|HAPPY|><|BGM|><|withitn|>` because the default output stream includes them.
- Evidence: FunASR's VAD parameter `max_single_segment_time=30000` (30 seconds) is the right granularity for Chinese speech, matching the `merge_length_s=15` final segment cap.
- Evidence: the `cache={}` keyword is required to keep FunASR from creating an ad-hoc cache directory next to the WAV, which would otherwise leak outside FrameQ's `models/` layout.

## Decision Log

- Decision: Use FunASR's VAD-assisted long-audio path for SenseVoice instead of chunking the WAV manually in FrameQ. Rationale: FunASR already implements segment merging and the FSMN-VAD model, and re-implementing the same logic in FrameQ would duplicate the work and risk drift. Date/Author: 2026-06-17 / Codex.
- Decision: Set `vad_model="fsmn-vad"` and `vad_kwargs={"max_single_segment_time": 30000}`. Rationale: FSMN-VAD is the VAD model that ships with FunASR, and 30 seconds is the documented boundary that matches SenseVoice's expected segment length. Date/Author: 2026-06-17 / Codex.
- Decision: Pass `batch_size_s=60`, `merge_vad=True`, `merge_length_s=15`, `cache={}` to `generate()`. Rationale: this is the documented long-audio parameter set; the `cache={}` keyword keeps FunASR from creating an ad-hoc cache outside FrameQ's model directory. Date/Author: 2026-06-17 / Codex.
- Decision: Strip `<|...|>` control tags from the transcript before validation and file output. Rationale: those tags are FunASR/SenseVoice implementation details, not user content, and exposing them breaks copy/export and downstream parsing. Date/Author: 2026-06-17 / Codex.

## Outcomes & Retrospective

Implemented. SenseVoice now runs with VAD-assisted long-audio parameters and writes a user-facing transcript free of `<|...|>` control tags. The transcript on the 425-second fixture is now full-length and the `.txt` and `.md` outputs match what a user would expect. No user-visible surface changed: the ASR request/result schema, progress events, and history records are unchanged. Validation passed (`uv run pytest worker\tests` 55 passed, `uv run ruff check worker`). Residual risk: the tag-stripping is implemented as a regex over `<|...|>`; if SenseVoice ever ships a tag that legitimately contains a `|` inside the angle brackets the regex would over-strip. The current upstream tag set is purely bracketed, so this is theoretical.

## Context and Orientation

- `worker/frameq_worker/asr.py` — owns the SenseVoice adapter, the `generate()` call, and the transcript tag cleanup.
- `worker/frameq_worker/insightflow/splitter.py` — consumes the cleaned transcript and is not affected by tag changes.
- `worker/tests/test_asr.py` — regression coverage for VAD parameters, generate payload, and tag stripping.
- `work/7624469060838853914.wav` — long-audio fixture used during this change to demonstrate the regression.
- `models/models--iic--SenseVoiceSmall` — SenseVoice Small model cache used by the adapter.
- `docs/ARCHITECTURE.md` and `docs/SECURITY.md` — confirm the transcript is the only user-visible artifact from ASR.

## Plan of Work

1. Add focused tests pinning the VAD model name, the VAD kwargs, the long-audio generate parameters, and the post-processing tag strip.
2. Update the SenseVoice adapter to construct the model with `vad_model="fsmn-vad"` and the documented `vad_kwargs`.
3. Update the `generate()` call to use the long-audio parameter set, including `cache={}`.
4. Add a transcript post-processing step that strips every `<|...|>` tag from the output string before validation and file write.
5. Re-run the focused tests, the full worker suite, and ruff to confirm the change is clean.

## Validation and Acceptance

- `uv run pytest worker\tests` passes (55 tests at the time of the change).
- `uv run ruff check worker` passes.
- The 425-second fixture produces a transcript whose text length is in the expected range for the audio duration, not the short single-segment result from the previous path.
- Transcript output files contain no `<|...|>` control tags; copy/export and downstream parsers see clean text.
- The SenseVoice VAD model is loaded from `models/` (or `FRAMEQ_MODEL_DIR`); the adapter does not write outside that directory thanks to the `cache={}` keyword.
