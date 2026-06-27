# Xiaohongshu Video Fallback Completion Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Complete FrameQ's Xiaohongshu public video note handling by porting the EasyDownload Xiaohongshu parser, page compatibility, stream selection, and download-reliability ideas that matter for transcription. Users should be able to paste a public Xiaohongshu video share text, short link, or full note URL and get the same local video, audio, transcript, and optional AI整理 flow. Users should not see a Xiaohongshu download center, image-album ZIP workflow, login flow, cookie import, proxy setup, or CAPTCHA bypass.

## Progress

- [x] 2026-06-27: Reviewed FrameQ's existing `xiaohongshu_fallback.py`, media integration, frontend URL validation, and the EasyDownload Xiaohongshu parser/client/downloader reference. Validation: `rg` and targeted `Get-Content` inspection in the side conversation.
- [x] 2026-06-27: Created this active ExecPlan and synchronized product, architecture, security, task, and reference documentation before implementation. Validation: `python scripts\validate_agents_docs.py --level WARN` and `git diff --check` passed.
- [ ] 2026-06-27: Extend frontend input acceptance for Xiaohongshu share text, full note URLs, and short links. Validation: `npm --prefix app test -- app/src/workflow.test.ts`.
- [ ] 2026-06-27: Port EasyDownload parser parity into worker fallback. Validation: `uv run pytest worker\tests\test_xiaohongshu_fallback.py -q`.
- [ ] 2026-06-27: Add Brotli/page-response compatibility and richer `__INITIAL_STATE__` parsing tests. Validation: `uv run pytest worker\tests\test_xiaohongshu_fallback.py -q`.
- [ ] 2026-06-27: Add stream model parity, ranking, and note-id-based output selection. Validation: `uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_media.py -q`.
- [ ] 2026-06-27: Add streaming/resumable safe video download behavior and XHS error mapping. Validation: `uv run pytest worker\tests\test_download_reliability.py worker\tests\test_xiaohongshu_fallback.py -q` and `npm --prefix app test`.
- [ ] 2026-06-27: Run full validation and record results before moving this plan to completed. Validation: commands listed in Validation and Acceptance.

## Surprises & Discoveries

Evidence: FrameQ already has `worker/frameq_worker/xiaohongshu_fallback.py` and tests, but frontend validation currently accepts only `xhslink.com/o/<code>` and does not fully represent EasyDownload's accepted inputs such as full note URLs, share text, direct `note_id`, and `xsec_token`-preserving flows.

Evidence: EasyDownload's parser resolves short links through both standard `3xx` `Location` and non-`3xx` HTML bodies that contain the real Xiaohongshu URL. FrameQ has an HTML embedded URL fallback, but the plan should explicitly cover redirect-depth limits and `http` to `https` retry parity.

Evidence: EasyDownload's client handles `gzip`, Brotli `br`, and zlib/raw `deflate` responses from the note page. FrameQ currently handles `gzip` and `deflate`, so Brotli support is a concrete compatibility gap for real Xiaohongshu pages.

Evidence: EasyDownload parses a richer stream model, including `format`, `fps`, audio/video codec and bitrate, `streamDesc`, `duration`, `defaultStream`, `hdrType`, and `rotate`. FrameQ currently stores enough to choose a stream, but the plan should align the scoring model and retain metadata useful for debugging without changing the worker JSON result shape.

Evidence: EasyDownload distinguishes image albums and Live Photo assets, but FrameQ's transcription product only needs playable video. Image albums and Live Photo sidecars should remain structured failures, not new download artifacts.

## Decision Log

Decision: Keep Xiaohongshu support video-only and transcription-first. Rationale: FrameQ needs playable media for ASR; image ZIPs, Live Photo sidecars, and archive workflows would expand the product into a general downloader. Date/Author: 2026-06-27 / User + Codex.

Decision: Use EasyDownload as an MIT-licensed algorithm reference, but port behavior into the Python worker rather than adding a Go/Wails runtime dependency. Rationale: The worker already owns download, validation, ASR, history, and structured error contracts. Date/Author: 2026-06-27 / Codex.

Decision: Expand frontend input acceptance only for Xiaohongshu inputs that can still enter the existing single-URL transcription workflow. Rationale: Users copy share text and full note URLs; supporting those improves usability without adding a new UI surface. Date/Author: 2026-06-27 / Codex.

Decision: Add explicit `XHS_*` guidance in UI error copy. Rationale: Current generic download guidance does not clearly distinguish image-only notes, private/login-gated notes, no playable streams, rate limits, or page compatibility failures. Date/Author: 2026-06-27 / Codex.

## Outcomes & Retrospective

Implementation has not started. This plan currently captures the intended scope, safety boundary, implementation tasks, and validation gates. Residual risk: Xiaohongshu public page structure and short-link behavior may change; FrameQ must surface structured recoverable errors instead of adding login, CAPTCHA, proxy, browser-cookie, or private-content bypass behavior.

## Context and Orientation

Product/spec:

- `docs/product-specs/2026-06-16-douyin-video-transcription-client.md`
- `docs/references/easydownload-xiaohongshu-fallback.md`
- `docs/references/easydownload-transcription-migration.md`

Frontend:

- `app/src/workflow.ts`
- `app/src/workflow.test.ts`
- `app/src/App.tsx`

Worker:

- `worker/frameq_worker/xiaohongshu_fallback.py`
- `worker/frameq_worker/download_reliability.py`
- `worker/frameq_worker/media.py`
- `worker/frameq_worker/pipeline.py`
- `worker/tests/test_xiaohongshu_fallback.py`
- `worker/tests/test_download_reliability.py`
- `worker/tests/test_media.py`
- `worker/tests/test_cli.py`

Bundled runtime mirror:

- `app/src-tauri/resources/worker/frameq_worker/xiaohongshu_fallback.py`
- `app/src-tauri/resources/worker/frameq_worker/download_reliability.py`
- `app/src-tauri/resources/worker/frameq_worker/media.py`

External reference:

- `lib-external/EasyDownload/internal/download/xiaohongshu/parser.go`
- `lib-external/EasyDownload/internal/download/xiaohongshu/client.go`
- `lib-external/EasyDownload/internal/download/xiaohongshu/model.go`
- `lib-external/EasyDownload/internal/download/xiaohongshu/downloader.go`
- `lib-external/EasyDownload/docs/xiaohongshu-link-download-principle.md`

Docs and governance:

- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `TASKS.md`
- `AGENTS.md`
- `docs/exec-plans/active/index.md`

## Plan of Work

1. Update frontend input acceptance.
   - Allow Xiaohongshu share text containing one acceptable URL.
   - Allow `https://www.xiaohongshu.com/explore/{24-hex-note-id}` with optional query parameters such as `xsec_token`.
   - Allow `http` or `https` `xhslink.com` and `www.xhslink.com` non-empty short links.
   - Keep rejecting empty links, non-Xiaohongshu hosts, lookalike hosts, and unsupported schemes.

2. Complete worker parser parity.
   - Preserve direct 24-character `note_id` parsing.
   - Extract the first acceptable Xiaohongshu URL from share text.
   - Resolve short links through `3xx` `Location`, relative `Location`, and HTML embedded URL fallback.
   - Retry `http` short links as `https` when the first path fails.
   - Enforce a finite redirect depth and preserve `xsec_token`.

3. Complete page compatibility.
   - Add explicit Brotli dependency or optional Brotli decoding path that is available in release runtime.
   - Send browser-like navigation headers from EasyDownload's client, including `Accept-Encoding`, `Sec-Fetch-*`, and `Upgrade-Insecure-Requests`.
   - Keep the 10 MB decompressed HTML cap.
   - Preserve current detection for blocked/error pages and map malformed state to structured `XHS_INITIAL_STATE_*` errors.

4. Align stream parsing and ranking.
   - Parse stream list and codec-keyed stream object shapes.
   - Keep stream metadata fields that help deterministic selection and debugging.
   - Deduplicate by quality key and select by EasyDownload's ranking order.
   - Reject image-only notes as `XHS_IMAGE_ONLY` and no-stream videos as `XHS_NO_PLAYABLE_STREAM`.

5. Improve video download reliability.
   - Add streaming `.part` writes so large videos do not require loading the whole MP4 into memory.
   - Support resume-safe `Range` behavior where the server validates `Content-Range`.
   - Enforce the 2 GiB max-video guardrail and a no-progress timeout.
   - Try backup URLs before returning `XHS_STREAM_DOWNLOAD_FAILED`.
   - Preserve existing files on failed downloads.

6. Integrate with media selection and UI errors.
   - Add Xiaohongshu note-id extraction for output selection so old videos in `outputs/` are not selected by accident.
   - Keep `yt-dlp` as the first attempt and use fallback only after a Xiaohongshu-related failure.
   - Add user-facing Chinese guidance for `XHS_IMAGE_ONLY`, `XHS_NOTE_BLOCKED`, `XHS_RATE_LIMITED`, `XHS_NO_PLAYABLE_STREAM`, `XHS_INITIAL_STATE_MISSING`, `XHS_INITIAL_STATE_MALFORMED`, `XHS_RESPONSE_DECODE_FAILED`, `XHS_VIDEO_TOO_LARGE`, `XHS_DOWNLOAD_STALLED`, and `XHS_STREAM_DOWNLOAD_FAILED`.

7. Sync docs, tests, and bundled worker resources.
   - Update source worker and bundled `app/src-tauri/resources/worker` copies together or run the existing resource sync path if available.
   - Update tests before implementation where practical.
   - Record all validation results in this plan before moving it to `completed/`.

## Validation and Acceptance

Repeatable commands:

- `uv run ruff check worker`
- `uv run pytest worker\tests`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app\src-tauri\Cargo.toml`
- `python scripts\validate_agents_docs.py --level WARN`
- `git diff --check`

Manual acceptance:

- Paste a public Xiaohongshu video share text and confirm the existing FrameQ workflow produces local video, audio, transcript, and optional AI整理 outputs.
- Paste a full `xiaohongshu.com/explore/{note_id}?xsec_token=...` URL and confirm it follows the same workflow.
- Paste a supported `xhslink.com` short link and confirm short-link resolution preserves the public note context.
- Try an image-only note and confirm the UI clearly says FrameQ currently supports Xiaohongshu video notes only.
- Confirm `work/history.json`, logs, and UI errors do not contain cookies, sensitive request headers, login material, or full volatile media CDN URLs.
