# Douyin Share Page Fallback Implementation Plan

## Goal

Add a Douyin-specific fallback so FrameQ can download public or user-authorized Douyin videos when `yt-dlp` fails on empty web detail JSON or cookie/challenge-like extractor errors, while preserving the highest-quality local video file.

## Architecture

The worker keeps `yt-dlp` as the first attempt. On matching Douyin failures, `worker/frameq_worker/media.py` delegates to a new focused Douyin fallback module that parses the public `iesdouyin.com` share page, probes playable streams, selects the largest valid candidate, downloads it to the configured output directory, and returns control to the existing `ffprobe`, audio extraction, ASR, history, and UI result pipeline.

## Tech Stack

- Python worker using stdlib HTTP/JSON parsing plus existing `ffprobe`/`ffmpeg` validation.
- Existing Tauri/React workflow and worker JSON contract.
- EasyDownload MIT-licensed Go implementation as an algorithm reference only.

## Decisions

- Do not embed or invoke the EasyDownload Go/Wails app at runtime.
- Do not require or persist browser cookies for this fallback.
- Use a fixed mobile Safari public share-page `User-Agent` by default: `Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1`.
- Keep request compatibility minimal: fixed headers only, no UA rotation, proxy pool, browser fingerprint spoofing, CAPTCHA solving, login automation, or account-authenticated scraping.
- Allow an in-memory cookie jar for anonymous share-page cookies such as `ttwid`, but discard it after the worker invocation and never write it to logs, history, or app-local settings.
- Do not add a stream picker in MVP.
- Select the largest valid stream by byte size, then tie-break by quality or resolution, because FrameQ users may keep the saved video.
- If the selected stream fails download or media validation, retry the next candidate before returning `VIDEO_DOWNLOAD_FAILED`.
- Keep source URL submission, result paths, local history, and UI artifact behavior unchanged.

## Implementation Tasks

### Task 1: Douyin Fallback Parser and Stream Model

**Files:**
- Create: `worker/frameq_worker/douyin_fallback.py`
- Test: `worker/tests/test_douyin_fallback.py`
- Modify if needed: `worker/frameq_worker/media.py`

- [x] Add `DouyinStreamCandidate` with `quality`, `url`, `size_bytes`, `width`, `height`, and `headers`.
- [x] Add `extract_aweme_id` support for canonical `/video/<id>` links and resolved short-link outputs.
- [x] Add `parse_share_page_router_data(html)` that extracts `window._ROUTER_DATA` and returns the first `videoInfoRes.item_list[0]`.
- [x] Add tests for canonical URL ID extraction, missing router data, malformed JSON, and a minimal SSR fixture containing `video.play_addr.uri`.

### Task 2: Share Page Fetch and Ratio Probe

**Files:**
- Modify: `worker/frameq_worker/douyin_fallback.py`
- Test: `worker/tests/test_douyin_fallback.py`

- [x] Build `https://www.iesdouyin.com/share/video/{aweme_id}/?app=aweme` from the extracted ID.
- [x] Fetch the share page with the fixed mobile Safari public headers, timeout, and process-local cookie jar.
- [x] Build candidates from `video.bit_rate` when present.
- [x] When `bit_rate` is empty, probe `play_addr.uri` against `1080p`, `720p`, `540p`, `480p`, and `360p` using `Range: bytes=0-1`.
- [x] Accept only probes with `206 Partial Content`, a positive total from `Content-Range`, and `video/*` or `application/octet-stream` content type.
- [x] Add tests using fake HTTP responses for fixed headers, valid probes, duplicate sizes, invalid content type, missing content range, and request timeout/failure handling.

### Task 3: Candidate Selection and Download

**Files:**
- Modify: `worker/frameq_worker/douyin_fallback.py`
- Modify: `worker/frameq_worker/media.py`
- Test: `worker/tests/test_douyin_fallback.py`
- Test: `worker/tests/test_media.py`

- [x] Sort candidates by `size_bytes` descending.
- [x] Tie-break by quality rank, preferring `1080p`, `720p`, `540p`, `480p`, then `360p`.
- [x] Download the selected candidate to `<output_dir>/<aweme_id>.mp4` with the candidate headers.
- [x] If download fails, try the next candidate.
- [x] Keep the existing `ffprobe` validation after the download, and allow the pipeline to reject files without video or audio streams.
- [x] Add tests proving the largest stream wins, equal-size streams choose the higher quality, and failed first candidate falls back to the next candidate.

### Task 4: Strategy Chain Integration

**Files:**
- Modify: `worker/frameq_worker/media.py`
- Modify: `worker/frameq_worker/pipeline.py` only if the existing `download_video` return path cannot preserve the current contract.
- Test: `worker/tests/test_media.py`
- Test: `worker/tests/test_cli.py`

- [x] Detect Douyin `yt-dlp` failures that should trigger fallback: empty JSON parse, `Fresh cookies`, web detail JSON, or equivalent Douyin extractor failures.
- [x] Invoke the fallback only for Douyin hosts.
- [x] Preserve current behavior for non-Douyin URLs and unsupported failures.
- [x] Return structured `VIDEO_DOWNLOAD_FAILED` only after both `yt-dlp` and all fallback candidates fail.
- [x] Ensure output selection still prefers files whose stem matches the Douyin video ID.
- [x] Do not trigger fallback for login/CAPTCHA/private-content failures unless the public share page path independently returns parseable, playable public media.

### Task 5: User-Facing Error and Progress Copy

**Files:**
- Modify: `worker/frameq_worker/pipeline.py`
- Modify: `app/src/workflow.ts`
- Test: `app/src/workflow.test.ts`
- Test: `worker/tests/test_cli.py`

- [x] Emit optional progress messages for fallback parsing, stream probing, highest-quality download, and stream retry.
- [x] Keep these messages within the existing `video_extracting` stage.
- [x] Add Chinese guidance for fallback exhaustion: public share page unavailable, playable media stream unavailable, or all candidate streams failed.
- [x] Preserve the short original error summary without logging full media CDN URLs or sensitive headers.
- [x] Map fallback failures to short causes such as `DOUYIN_ID_PARSE_FAILED`, `DOUYIN_SHARE_PAGE_UNAVAILABLE`, `DOUYIN_ROUTER_DATA_MISSING`, `DOUYIN_NO_PLAYABLE_STREAM`, `DOUYIN_STREAM_DOWNLOAD_FAILED`, and `MEDIA_VALIDATION_FAILED`.

### Task 6: Verification and Docs

**Files:**
- Modify as needed: `docs/product-specs/2026-06-16-douyin-video-transcription-client.md`
- Modify as needed: `docs/ARCHITECTURE.md`
- Modify as needed: `docs/SECURITY.md`
- Modify as needed: `docs/DESIGN.md`
- Modify as needed: `docs/references/easydownload-douyin-fallback.md`

- [x] Run `uv run pytest worker\tests`.
- [x] Run `uv run ruff check worker`.
- [x] Run `npm --prefix app test` if UI copy or workflow formatting changes.
- [x] Run `python scripts/validate_agents_docs.py --level WARN`.
- [x] Manually verify `https://www.douyin.com/video/7653372612151692594` downloads via fallback and produces a valid local MP4 with audio.

## Progress

- [x] Investigated `yt-dlp` failure mode and confirmed current extractor cannot handle this link via cookies alone.
- [x] Verified EasyDownload's share page SSR plus ratio probing can discover valid MP4 streams for `7653372612151692594`.
- [x] Product, architecture, design, security, and reference docs updated for the proposed behavior.
- [x] Worker fallback parser implemented.
- [x] Candidate probing, selection, and download implemented.
- [x] Strategy chain integrated with existing `yt-dlp` download path.
- [x] UI/workflow error copy updated if needed.
- [x] Automated verification completed.
- [x] Live Douyin fallback smoke completed.

## Validation

- Documentation setup attempted: `python scripts\validate_agents_docs.py --level ERROR` and `python scripts\validate_agents_docs.py --level WARN` currently fail before implementation because the validator recursively checks `lib-external/EasyDownload/AGENTS.md`, whose external-project format lacks FrameQ-required sections.
- Documentation setup passed: `git diff --check`.
- Passed: `uv run pytest worker\tests` (98 tests)
- Passed: `uv run ruff check worker`
- Passed: `npm --prefix app test` (84 tests)
- Passed: `python scripts\validate_agents_docs.py --level WARN`
- Planned: manual fallback run for `https://www.douyin.com/video/7653372612151692594`

## Validation Results

2026-06-26 implementation gates so far:

- `uv run pytest worker\tests\test_douyin_fallback.py worker\tests\test_media.py -q` - 19 passed.
- `uv run pytest worker\tests` - 99 passed.
- `uv run ruff check worker` - passed.
- `npm --prefix app test` - 84 passed.
- `npm --prefix app run build` - passed.
- `cargo test --manifest-path app\src-tauri\Cargo.toml` - 31 passed.
- `python scripts\validate_agents_docs.py --level WARN` - passed after fixing the validator to ignore vendored `lib-external/` AGENTS files.
- `uv run pytest scripts\tests\test_validate_agents_docs.py -q` - 1 passed.

Live fallback smoke with the public Douyin URL remains pending because it depends on external network/platform availability and may download the media file.

2026-06-26 live smoke completed:

- `https://www.douyin.com/video/7653372612151692594` → aweme_id `7653372612151692594` ✅
- Share page `https://www.iesdouyin.com/share/video/7653372612151692594/?app=aweme` → HTTP 200, 44470 bytes ✅
- Stream candidates probed, selected, and downloaded → `7653372612151692594.mp4` ✅
- ffprobe: MOV/MP4 container, 201.9 MB, 1321 s (22 min), 1282 kbps, 2 streams (video + AAC HE-AACv2 audio) ✅

## Notes

- Direct `www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7653372612151692594` returned `200 application/json` with an empty body in local verification.
- `https://www.iesdouyin.com/share/video/7653372612151692594/?app=aweme` returned SSR data containing the target `aweme_id` and `play_addr.uri`.
- Ratio probing returned valid ranged MP4 responses for `1080p`, `720p`, and `540p`; highest-quality policy should choose the largest valid stream and tie-break toward `1080p`.
- The fallback remains bounded to public or user-authorized links and must not add CAPTCHA, login bypass, or cookie persistence behavior.
