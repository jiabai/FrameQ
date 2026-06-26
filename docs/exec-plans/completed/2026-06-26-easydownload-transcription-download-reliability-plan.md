# EasyDownload Transcription Download Reliability Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Improve FrameQ's ability to turn public or user-authorized share links into local media that can be transcribed, while keeping FrameQ a transcription and AI整理 desktop app rather than a general downloader. Users should see fewer recoverable link-download failures for Douyin and Xiaohongshu video links, but they should not see a download center, cookie-login workflow, proxy setup, CAPTCHA bypass, or new privacy exposure.

## Progress

- [x] 2026-06-26: Reviewed the local EasyDownload reference project and selected the transcription-oriented migration scope. Validation: `docs/references/easydownload-transcription-migration.md`.
- [x] 2026-06-26: Recorded product, architecture, security, and active-plan boundaries before implementation. Validation: `python scripts\validate_agents_docs.py --level WARN` and `git diff --check` passed during the documentation landing change.
- [x] 2026-06-26: Implement worker download reliability helpers and tests. Validation: `uv run pytest worker\tests\test_download_reliability.py -q` and `uv run pytest worker\tests -q` passed.
- [x] 2026-06-26: Implement Douyin input parsing enhancements and tests. Validation: `uv run pytest worker\tests\test_douyin_fallback.py -q` and `uv run pytest worker\tests -q` passed.
- [x] 2026-06-26: Implement Xiaohongshu public-video fallback and tests. Validation: `uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_media.py -q` and `uv run pytest worker\tests -q` passed.
- [x] 2026-06-26: Run full worker/app documentation gates and update Outcomes & Retrospective. Validation: `uv run pytest worker\tests -q`, `uv run ruff check worker`, `npm --prefix app test`, `npm --prefix app run build`, `cargo test --manifest-path app\src-tauri\Cargo.toml`, `python scripts\validate_agents_docs.py --level WARN`, and `git diff --check` passed.

## Surprises & Discoveries

Evidence: `lib-external/EasyDownload/internal/download/` contains platform-specific logic for Douyin, Xiaohongshu, Bilibili, and WeChat, but FrameQ only needs the small subset that improves single-link media acquisition before ASR.

Evidence: `lib-external/EasyDownload/internal/proxy/` and `lib-external/EasyDownload/internal/download/wechat/` rely on MITM/system proxy style behavior. That conflicts with FrameQ's local-first, low-permission desktop boundary and must remain out of scope.

Evidence: FrameQ already has `worker/frameq_worker/douyin_fallback.py` and `docs/references/easydownload-douyin-fallback.md`; the next migration should extend and harden worker-owned strategy code instead of introducing a second downloader subsystem.

Evidence: `docs/product-specs/2026-06-16-douyin-video-transcription-client.md` already accepts Xiaohongshu short links through `yt-dlp`, so a Xiaohongshu fallback can be scoped as a failure recovery path without changing the UI contract.

Evidence: A shared Python helper can validate response status, `Content-Range`, content type, positive size, and maximum-size limits before atomically promoting a `.part` file. This keeps Douyin and Xiaohongshu fallback downloads consistent without changing the worker result contract.

Evidence: Douyin fallback triggering also needed media-layer host detection for share text, not only fallback-layer ID parsing. Otherwise copied share text containing `v.douyin.com` would still stop at the failed `yt-dlp` stage.

Evidence: Xiaohongshu public note data appears in both array and codec-keyed stream shapes under `window.__INITIAL_STATE__`. The worker fallback now handles both shapes but still rejects image-only notes as out of transcription scope.

## Decision Log

Decision: Keep FrameQ transcription-first and do not add a general download-center product surface. Rationale: The user-selected direction is "转写优先"; extra downloader UI would expand scope, storage behavior, and security review without improving the core transcription path. Date/Author: 2026-06-26 / User + Codex.

Decision: Port algorithms into the Python worker instead of depending on the EasyDownload Go/Wails application at runtime. Rationale: The worker already owns media download, validation, ASR, history, and structured errors; keeping the boundary there avoids cross-runtime coupling and preserves installer simplicity. Date/Author: 2026-06-26 / Codex.

Decision: Explicitly exclude WeChat MITM/proxy, Bilibili login/DASH workflows, browser cookies, login automation, CAPTCHA handling, proxy pools, and user-agent rotation. Rationale: These capabilities conflict with FrameQ's public-link-only and local-first safety boundary. Date/Author: 2026-06-26 / User + Codex.

Decision: Treat Xiaohongshu fallback as video-only failure recovery. Rationale: FrameQ needs playable media for ASR, not image albums or platform archival workflows. Date/Author: 2026-06-26 / Codex.

Decision: Share the safe atomic download helper across platform fallbacks. Rationale: Response validation, `.part` cleanup, max-size guardrails, and retry behavior should be consistent and testable without broadening UI or history contracts. Date/Author: 2026-06-26 / Codex.

Decision: Let the Xiaohongshu fallback attempt any `yt-dlp` failure only after a Xiaohongshu or `xhslink.com` URL is detected in the submitted text. Rationale: Xiaohongshu share text often fails generic URL extraction before a platform-specific parser can resolve it, while host gating prevents non-Xiaohongshu failures from entering this path. Date/Author: 2026-06-26 / Codex.

## Outcomes & Retrospective

Completed. Added `download_reliability.py`, extended Douyin share-text/short-link ID parsing, and added a video-only Xiaohongshu fallback that resolves share text or `xhslink.com`, parses public `window.__INITIAL_STATE__`, chooses a transcription-suitable stream, and stores the MP4 locally through the shared safe writer. Full worker, frontend, build, Rust, docs, and whitespace gates passed on 2026-06-26. Residual risk: public platform page structures may change, so worker fallbacks return structured recoverable errors and must not compensate by adding login, CAPTCHA, proxy, or cookie-persistence behavior.

## Context and Orientation

Product/spec:

- `docs/product-specs/2026-06-16-douyin-video-transcription-client.md`
- `docs/references/easydownload-transcription-migration.md`
- `docs/references/easydownload-douyin-fallback.md`

Worker:

- `worker/frameq_worker/media.py`
- `worker/frameq_worker/douyin_fallback.py`
- `worker/frameq_worker/models.py`
- `worker/frameq_worker/pipeline.py`
- `worker/tests/test_media.py`
- `worker/tests/test_douyin_fallback.py`

External reference:

- `lib-external/EasyDownload/internal/download/downloader.go`
- `lib-external/EasyDownload/internal/download/http_resumable.go`
- `lib-external/EasyDownload/internal/download/douyin/`
- `lib-external/EasyDownload/internal/download/xiaohongshu/`
- `lib-external/EasyDownload/docs/security-and-download-reliability.md`

Docs and safety:

- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `AGENTS.md`
- `docs/exec-plans/active/index.md`

## Plan of Work

1. Add contract-preserving worker download reliability helpers.
   - Stream downloads through `.part` files and atomically promote completed files.
   - Validate `Range`, `Content-Range`, content type, positive byte size, and `ffprobe` media readability.
   - Add retry/fallback hooks that avoid logging sensitive CDN URLs or headers.

2. Extend Douyin input parsing.
   - Accept share text containing canonical links or short links.
   - Resolve supported short links before ID extraction.
   - Recognize `/video/{id}`, `/note/{id}`, `/share/slides/{id}`, `modal_id`, and `aweme_id` when they produce public playable video metadata.
   - Keep existing `yt-dlp` first-attempt behavior and structured `VIDEO_DOWNLOAD_FAILED` errors.

3. Add Xiaohongshu video fallback.
   - Resolve `xhslink.com` share links and parse public page state such as `__INITIAL_STATE__`.
   - Extract and probe only video streams suitable for transcription.
   - Return clear structured errors when the note is image-only, login-gated, CAPTCHA-gated, unavailable, or has no playable media.

4. Keep UI and Tauri behavior unchanged.
   - Do not add a batch download manager, stream picker, platform login, cookie import, or proxy controls.
   - Reuse existing workflow stages and result shape.
   - Add user-facing copy only if new structured worker causes require it.

5. Update tests and documentation as implementation proceeds.
   - Add focused worker tests for parsing, safe download behavior, fallback ordering, and error mapping.
   - Run the validation commands below.
   - Update Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective before moving this plan to completed.

## Validation and Acceptance

Repeatable commands:

- `uv run ruff check worker`
- `uv run pytest worker\tests`
- `npm --prefix app test`
- `python scripts/validate_agents_docs.py --level WARN`
- `git diff --check`

Manual acceptance:

- Submit a supported public Douyin share text or short link and confirm the existing transcription workflow still produces local video, audio, transcript, and optional AI整理 artifacts without exposing a downloader UI.
- Submit a supported public Xiaohongshu video share link and confirm fallback only handles playable video, not image albums or login-gated content.
- Confirm logs and `work/history.json` do not contain cookies, sensitive request headers, login material, or full volatile media CDN URLs.
