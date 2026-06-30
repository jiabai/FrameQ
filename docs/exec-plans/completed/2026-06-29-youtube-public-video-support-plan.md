# YouTube Public Video Support Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Add YouTube public single-video support to FrameQ without changing the product shape. Users can paste a normal YouTube watch URL, a `youtu.be` short link, or a Shorts URL and continue through the existing local download, audio extraction, ASR transcript, and optional AI整理 flow. Users should not see YouTube login, cookie import, playlist batching, live-stream handling, stream selection, or a download center.

## Progress

- [x] 2026-06-29: Reviewed the requested YouTube v1 plan and existing FrameQ frontend/worker/docs boundaries. Validation: targeted `Get-Content`, `rg`, and baseline worker/frontend tests.
- [x] 2026-06-29: Added RED tests for YouTube URL acceptance/rejection, worker command policy, failure classification, sanitization, and stdout-path pipeline reuse. Validation: targeted worker tests failed on missing YouTube helpers; targeted frontend test failed on YouTube URL/error behavior.
- [x] 2026-06-29: Implemented frontend URL validation, worker YouTube `yt-dlp` format policy, sanitized `YOUTUBE_*` failure mapping, and UI recovery copy. Validation: `uv run pytest worker\tests\test_media.py worker\tests\test_cli.py -q` and `npm --prefix app test -- src/workflow.test.ts` passed.
- [x] 2026-06-29: Updated product, architecture, security, design, tasks, and active ExecPlan docs. Validation: `python scripts\validate_agents_docs.py --level WARN` passed.
- [x] 2026-06-29: Ran full implementation gates and archived this ExecPlan. Validation: worker ruff/tests, frontend tests/build, Rust tests, docs gate, and `git diff --check` passed.

## Surprises & Discoveries

Evidence: `worker/frameq_worker/media.py` already centralizes the generic `yt-dlp --no-playlist -o <template> <url>` command, so YouTube can be implemented as a command-policy branch without adding new pipeline fields.

Evidence: `worker/frameq_worker/pipeline.py` already prefers the stdout path returned by `download_video()`, then falls back to stem/latest-file discovery. This lets YouTube downloads flow into existing `ffprobe`, audio extraction, ASR, history, summary, mindmap, and insight logic.

Evidence: `app/src/workflow.ts` already performs host-aware URL validation and structured error mapping for other platforms. YouTube can follow the same pattern while rejecting lookalike hosts and unsupported page types before worker launch.

Evidence: `yt-dlp` commonly reports login, age, private/unavailable, and format-selection failures with messages that may include cookie guidance or signed media URLs. FrameQ needs a worker-side sanitizer before surfacing those messages.

Evidence: `app/src-tauri/resources/worker` is ignored and kept as a `.gitkeep` placeholder in the repository. `scripts/build-installer.mjs` resets that directory and copies `worker/frameq_worker` during installer packaging, so the committed source worker remains the packaging source of truth.

## Decision Log

Decision: Keep YouTube v1 on `yt-dlp` only, with no custom crawler or YouTube API client. Rationale: The requested scope is ordinary public-video support and FrameQ already depends on `yt-dlp`; custom extraction would expand maintenance and platform-risk surface. Date/Author: 2026-06-29 / User + Codex.

Decision: Use a transcription-first 720p format selector for YouTube. Rationale: FrameQ optimizes for ASR throughput and local artifact size rather than archiving maximum-quality video. Date/Author: 2026-06-29 / User + Codex.

Decision: Keep the existing worker result contract and encode YouTube causes inside `VIDEO_DOWNLOAD_FAILED` messages with `YOUTUBE_*` prefixes. Rationale: No downstream contract, Rust type, history schema, or UI artifact changes are needed for download-source support. Date/Author: 2026-06-29 / Codex.

Decision: Strip YouTube cookie hints and signed Google media URLs from surfaced errors. Rationale: The product explicitly does not guide cookie/login use and must not persist volatile media CDN URLs or signed query material. Date/Author: 2026-06-29 / Codex.

## Outcomes & Retrospective

Completed. FrameQ now accepts public YouTube watch links, `youtu.be` short links, and Shorts links in the existing single-input workflow. The worker keeps generic platform behavior unchanged, adds a YouTube-specific `yt-dlp --no-playlist` command policy with a 720p transcription-first MP4/M4A format selector, and returns sanitized `YOUTUBE_*` failure causes under the existing `VIDEO_DOWNLOAD_FAILED` contract. Successful YouTube downloads continue into the existing ffprobe, audio extraction, local ASR, history, transcript, summary, Mermaid mindmap, and insight pipeline without new result fields.

The UI now rejects playlist-only, channel, handle, `music.youtube.com`, empty short-link, lookalike-host, and unsupported-scheme inputs before processing. YouTube failure copy asks users to retry with publicly accessible videos and does not ask for cookies or login. Worker sanitization strips signed Google media URLs and cookie guidance from surfaced errors.

Automated validation passed on 2026-06-29:

- `uv run ruff check worker`
- `uv run pytest worker\tests`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app\src-tauri\Cargo.toml`
- `python scripts\validate_agents_docs.py --level WARN`
- `git diff --check`

Residual risk: live public YouTube watch/short/Shorts smoke was not executed in this session, so external extractor/CDN behavior remains a platform-availability risk. The implementation must not compensate by adding login, cookie import, proxy, age/member/private bypass, playlist batching, live-stream handling, or download-center behavior.

## Context and Orientation

Product/spec:

- `docs/product-specs/2026-06-16-douyin-video-transcription-client.md`

Frontend:

- `app/src/workflow.ts`
- `app/src/workflow.test.ts`

Worker:

- `worker/frameq_worker/media.py`
- `worker/frameq_worker/pipeline.py`
- `worker/tests/test_media.py`
- `worker/tests/test_cli.py`

Bundled runtime mirror:

- `app/src-tauri/resources/worker/frameq_worker/media.py`

Docs and governance:

- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/DESIGN.md`
- `TASKS.md`
- `docs/exec-plans/active/index.md`

## Plan of Work

1. Extend frontend URL validation.
   - Accept YouTube watch, `youtu.be`, and Shorts links.
   - Accept watch links that include playlist context but process only `v`.
   - Reject playlist-only, channel, handle, music, empty short links, lookalike hosts, and unsupported schemes.

2. Add YouTube worker command policy.
   - Keep generic platforms unchanged.
   - Add `--no-playlist`, a 720p-oriented format selector, MP4 merge preference, and the existing output template for YouTube.
   - Do not add cookie, login, proxy, or account-state flags.

3. Add YouTube failure classification and sanitization.
   - Map common `yt-dlp` failures to `YOUTUBE_LOGIN_REQUIRED`, `YOUTUBE_AGE_RESTRICTED`, `YOUTUBE_PRIVATE_OR_UNAVAILABLE`, `YOUTUBE_NO_PLAYABLE_STREAM`, and `YOUTUBE_DOWNLOAD_FAILED`.
   - Strip signed `googlevideo.com`/`videoplayback` URLs and cookie guidance from user-visible messages.

4. Preserve pipeline behavior.
   - Ensure successful stdout paths enter existing media validation, audio extraction, ASR, transcript, summary, mindmap, insights, and history handling.
   - Preserve existing completed local files when a new download fails.

5. Sync bundled worker resources, docs, tests, and validation.
   - Mirror changed worker source into `app/src-tauri/resources/worker`.
   - Run worker, frontend, build, Rust, docs, and diff gates.
   - Move this ExecPlan to `completed/` after gates pass.

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

- Paste a public `youtube.com/watch?v=...` URL and confirm the existing workflow produces local video, audio, transcript, and optional AI整理 outputs.
- Paste a public `youtu.be/...` short link and confirm the same workflow.
- Paste a public `youtube.com/shorts/...` URL and confirm the same workflow.
- Paste `watch?v=...&list=...` and confirm only the single `v` video is processed.
- Paste playlist/channel/handle/music/private/login-required/age-restricted links and confirm FrameQ returns clear recoverable copy without asking for cookies or login.
- Confirm history, logs, and UI errors do not contain cookies, Authorization material, full signed Google media URLs, or bypass instructions.
