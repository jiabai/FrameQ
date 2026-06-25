# Local Media Reuse Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Make FrameQ deterministic after a repeat URL submission. The worker still calls `yt-dlp`, but it then selects the media file by the URL video ID instead of by mtime in the output directory, and skips `ffmpeg` audio extraction when an existing WAV for the same video is already valid. This removes the silent "wrong video attached" and "WAV regenerated for no reason" failure modes without changing the user-facing pipeline or the request/result schema.

## Progress

- [x] 2026-06-17: Added media helpers for extracting a Douyin video ID from URL text and validating audio-only media. Validation: focused worker tests cover the helpers.
- [x] 2026-06-17: Added regression tests showing `yt-dlp` is still called, output selection prefers the URL ID, and a valid existing WAV skips `ffmpeg`. Validation: `uv run pytest worker\tests`.
- [x] 2026-06-17: Updated `run_worker_pipeline` to prefer URL-ID-matched video files after `yt-dlp` returns, falling back to newest video only when no ID-specific file exists. Validation: focused worker tests.
- [x] 2026-06-17: Updated audio extraction to reuse `work/<video_stem>.wav` when `ffprobe` confirms a valid audio stream. Validation: focused worker tests cover the reuse path and the regenerate path.
- [x] 2026-06-17: Ran worker tests, ruff, and the docs validation gate. Validation: `uv run pytest worker\tests` (55 passed), `uv run ruff check worker`, and `python scripts/validate_agents_docs.py --level WARN` (0 errors, 0 warnings).

## Surprises & Discoveries

- Evidence: `yt-dlp` already has an existing-file fast path for repeat URLs, so FrameQ did not need to skip the call; the bug was entirely in how FrameQ picked a file from the output directory afterwards.
- Evidence: the output directory is shared across tasks, so a "newest file" heuristic can attach a different task's video to a fresh URL submission when the user clears the cache and runs jobs back-to-back.
- Evidence: the audio path lives in `work/<video_stem>.wav`, which is keyed by the video ID and is naturally scoped per task, so the same WAV can be safely reused for repeat URLs.
- Evidence: `ffprobe` returns a fast negative result on a missing or truncated WAV, so the existing-WAV check is cheap to add before the `ffmpeg` invocation.
- Evidence: the `douyin_video_download_solution.md` already documents that the sample URL produces a stable video ID (`7524373044106677544`), so the ID-keyed selection is testable on a fixed fixture.

## Decision Log

- Decision: Keep the `yt-dlp` call and only change the post-download selection and the audio extraction step. Rationale: `yt-dlp` is the canonical extractor and re-implementing the call would lose cookie and extractor handling; the actual bug is in FrameQ's own selection logic. Date/Author: 2026-06-17 / Codex.
- Decision: Select the output file by URL video ID, not by newest mtime. Rationale: the output directory is shared across tasks and a "newest" heuristic can attach a previous task's video; the video ID is the only key that is stable across repeat submissions. Date/Author: 2026-06-17 / Codex.
- Decision: Fall back to newest video in the output directory when no ID-specific file exists. Rationale: keeps the original behavior for first-time downloads while only changing the repeat-URL case. Date/Author: 2026-06-17 / Codex.
- Decision: Reuse `work/<video_stem>.wav` when `ffprobe` confirms a valid audio stream, otherwise rerun `ffmpeg`. Rationale: the work directory is gitignored and per-task, so reuse is safe; `ffprobe` makes the check cheap and unambiguous. Date/Author: 2026-06-17 / Codex.
- Decision: Extract the Douyin video ID from the URL text rather than parsing the `yt-dlp` output. Rationale: the URL is the only input we control before the extractor runs, and the URL parser is unit-testable without a network call. Date/Author: 2026-06-17 / Codex.

## Outcomes & Retrospective

Implemented. Repeat URL submissions now deterministically select the URL-ID-matched video and skip `ffmpeg` when the existing WAV is already valid; first-time downloads keep the previous behavior. No user-visible surface changed: the request/result schema, progress events, and history records are unchanged. Validation passed (`uv run pytest worker\tests` 55 passed, `uv run ruff check worker`, `python scripts/validate_agents_docs.py --level WARN`). Residual risk: the ID parser is URL-shape based; if Douyin ever moves to opaque share tokens without a numeric ID the fallback "newest video" path keeps the pipeline alive, but the optimization is lost until the parser is taught the new shape.

## Context and Orientation

- `worker/frameq_worker/cli.py` — `run_worker_pipeline` is the entry point that now prefers URL-ID-matched video files after `yt-dlp` returns.
- `worker/frameq_worker/media.py` — media helpers, including the URL video ID extractor and the audio-only validation probe.
- `worker/frameq_worker/asr.py` — ASR adapter that consumes the WAV that the audio extraction step now reuses.
- `work/<video_stem>.wav` — the per-task WAV cache that is reused when valid.
- `outputs/<video_id>.mp4` — the per-task video file the selection logic now targets.
- `worker/tests/test_media.py` — regression coverage for the selection and reuse paths.
- `douyin_video_download_solution.md` — the design source that documents the stable video ID fixture.

## Plan of Work

1. Add a `video_id_from_url` helper that extracts the Douyin numeric ID from URL text, and an `is_valid_audio_file` probe based on `ffprobe`.
2. Update `run_worker_pipeline` to look up the URL-ID file in the output directory first, falling back to newest video only when the lookup fails.
3. Update audio extraction to check `work/<video_stem>.wav` with `ffprobe` before invoking `ffmpeg`, and skip `ffmpeg` when the existing WAV validates.
4. Cover both paths with focused worker tests so the deterministic selection and the reuse path are pinned.
5. Run `uv run pytest worker\tests`, `uv run ruff check worker`, and `python scripts/validate_agents_docs.py --level WARN` to confirm the change is clean.

## Validation and Acceptance

- `uv run pytest worker\tests` passes (55 tests at the time of the change).
- `uv run ruff check worker` passes.
- `python scripts/validate_agents_docs.py --level WARN` passes (0 errors, 0 warnings).
- A repeat URL submission on a sample URL reuses the existing `outputs/<video_id>.mp4` and `work/<video_stem>.wav` instead of redownloading or re-extracting audio.
- A first-time URL submission still downloads and extracts audio through the original path.
- The selected video on a repeat URL is the same file the original submission produced, verified by file size and `ffprobe` JSON.
