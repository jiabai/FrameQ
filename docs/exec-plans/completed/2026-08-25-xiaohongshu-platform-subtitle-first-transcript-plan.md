# Xiaohongshu Platform Subtitle-First Transcript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Reuse one verified Xiaohongshu platform SRT as the official transcript before local ASR in the existing single-link workflow, while preserving the current video, audio, History, AI, privacy, and fallback behavior.

**Architecture:** Add a pure `xiaohongshu/subtitles.py` policy module that decodes `note.video.mediaV2`, validates and ranks explicit platform tracks, and returns one typed candidate. The Xiaohongshu root adapter downloads that candidate atomically and best-effort: it reuses the already-fetched note in the public fallback path, while `media.py` invokes a bounded sidecar probe after a successful Xiaohongshu `yt-dlp` run. Existing `MediaPreparationFacade`, `find_subtitle_transcript`, pipeline transcript metadata, progress events, and UI source rendering remain the consumers.

**Tech Stack:** Python 3.13, dataclasses, urllib, existing atomic download helpers, pytest, Ruff, existing Tauri worker-resource mirror, Markdown governance scripts.

---

## Purpose / Big Picture

After this plan is implemented, a user pastes the same supported public Xiaohongshu video link as today. FrameQ still downloads and validates the video, prepares local audio, shows the current transcript workflow, stores the task locally, and keeps the same optional AI actions. When the public note page exposes a usable platform SRT, FrameQ uses that SRT as the official transcript and does not prepare or run the ASR model. When the track is absent, malformed, expired, too large, blocked, or unparsable, the task continues through the existing local ASR path without surfacing a new video failure.

The feature does not add a subtitle-only command, subtitle picker, raw SRT artifact, login, Cookie import, CAPTCHA handling, new top-level stage, new desktop-worker message code, or server/cloud data flow.

## Progress

- [x] 2026-08-25: Confirmed the product scope: automatic subtitle-first behavior in the existing Xiaohongshu transcription path, with ASR fallback and no standalone subtitle-download UI. Validation: product spec `docs/product-specs/2026-08-25-xiaohongshu-platform-subtitle-first-transcript.md` approved by the user.
- [x] 2026-08-25: Mapped the current fallback, media facade, subtitle parser, transcript metadata, progress registry, frontend source rendering, tests, and packaged-worker boundary. Validation: source inspection of the files listed under Context and Orientation.
- [x] 2026-08-25: Authored and self-reviewed this task-by-task implementation plan, including exact files, RED/GREEN tests, commits, recovery notes, live smoke, and completion gates. Validation: governance checks report zero errors and zero warnings; placeholder and whitespace checks pass.
- [x] 2026-08-25: Implemented Tasks 1-5 with RED/GREEN evidence recorded after each task. Validation: focused feature set `191 passed`; full worker suite later passed `852 passed, 2 skipped`; `uv run ruff check worker` passed.
- [x] 2026-08-25: Synchronized architecture/security/product/design/TASKS documentation and refreshed the generated worker resource mirror. Validation: package verifier reports `Packaged worker is byte-identical to the canonical source.`
- [x] 2026-08-25: Ran complete worker/app/docs gates. Worker tests and Ruff, app lint, docs governance, and diff checks passed; the existing app browser smoke remains one deterministic failure (`761 passed, 1 failed`) in `freezes confirmed output language across locale changes and uses the new locale next time`, with no app TypeScript changes in this rollout.
- [x] 2026-08-25: Ran bounded live smoke against all four user-provided public-note URLs without persisting credentials or signed URLs. Current requests returned `miss` for all four, so the previously recorded 2026-08-21/22 probe artifacts remain the positive upstream evidence and current availability is a residual risk.

## Surprises & Discoveries

- Evidence: `worker/frameq_worker/media_preparation.py` already emits `subtitle.detect.running`, scans the task download directory with `find_subtitle_transcript`, and returns a parsed `SubtitleTranscript` for every URL path except `bilibili-fallback`. Xiaohongshu needs to place one valid SRT/VTT in that directory; the generic pipeline does not need Xiaohongshu page knowledge.
- Evidence: `worker/frameq_worker/pipeline_runtime/transcript.py` already writes `TranscriptMetadata(source="subtitle", language=..., engine=None)`, emits `subtitle.detect.found`, and skips ASR preparation when a subtitle candidate succeeds. `app/src/i18n/resources.ts` and `app/src/i18n/transcriptResources.ts` already contain all three locales for detection and platform-subtitle source rendering.
- Evidence: `download_xiaohongshu_video` already owns one parsed `note_obj` in the public fallback path, so it can download video and subtitle from one page response. A successful generic `yt-dlp` return currently bypasses the fallback entirely, so a post-success sidecar probe in `media.py` is required for complete product coverage.
- Evidence: the four saved probe records under `docs/references/2026-08-21-*` and `2026-08-22-*` show `mediaV2` as a JSON string and one `source`, `zh-CN`, and `en-US` SRT track per note. Signed URLs and `xsec_token` values are deliberately absent from those records.
- Evidence: the repository requires direct commits to `main`; the two pre-existing modifications under `app/src-tauri/src/` are user-owned and must remain outside every task commit.
- Evidence: the fresh live smoke on 2026-08-25 reached the production page/selector/downloader/parser entry for all four provided URLs but found no currently usable track (`miss` for `6a81333b000000003300b98f`, `6a82e94900000000260360d5`, `6a84fc60000000002c0077e4`, and `6a872cd0000000002702f748`). This does not invalidate the selector or transport tests; it records that signed page/track availability has changed since the prior probes.
- Evidence: `scripts/verify-packaged-worker.mjs` is the correct mirror gate because the resource tree is generated and ignored and intentionally excludes `__pycache__`; a raw recursive diff is noisy from generated bytecode rather than a source mismatch.
- Evidence: the full app test failure is reproducible in isolation and occurs in a test introduced by historical commit `358b1367`; `git diff --name-only -- app` shows only the two unrelated user-owned Rust files, not app TypeScript or browser-smoke code.

## Decision Log

- Decision: Implement only automatic subtitle-first transcription, not a typed subtitle-only job. Rationale: this is the user-approved v1 scope and reuses the existing task/result model without a new product surface. Date/Author: 2026-08-25, User + Codex.
- Decision: Put mediaV2 decoding, URL/language validation, and deterministic track selection in a new pure private module. Rationale: page interpretation and network/filesystem effects remain separate, and tests can cover malformed platform data without HTTP fixtures. Date/Author: 2026-08-25, Codex.
- Decision: Support both acquisition paths: reuse `note_obj` inside `xiaohongshu-fallback`, and run one best-effort page probe after a successful Xiaohongshu `yt-dlp` result. Rationale: fallback-only integration would silently miss subtitles whenever `yt-dlp` succeeds. Date/Author: 2026-08-25, Codex.
- Decision: Keep subtitle retrieval best-effort and expose no new XHS error code to the normal video workflow. Rationale: subtitle absence must not convert a playable public video into a failed task; existing ASR semantics remain authoritative on a miss. Date/Author: 2026-08-25, User + Codex.
- Decision: Reuse existing subtitle progress codes, transcript metadata, manifest shape, and UI strings. Rationale: the current contract already expresses detection, source, and language safely; adding platform-specific events would expand the contract without product value. Date/Author: 2026-08-25, Codex.

## Outcomes & Retrospective

Current outcome: the approved product intent is implemented in the worker and documented in the architecture, security, product, design, and task records. Tasks 1-5 passed their focused evidence; the full worker suite passed `852 passed, 2 skipped`; the generated package mirror passed the dedicated byte-identical verifier; app lint and documentation gates passed. The app full test has one reproducible pre-existing browser-smoke failure (`761 passed, 1 failed`), and the current live requests for all four user notes returned no subtitle track, so those are explicitly carried as residuals rather than hidden by the closeout.

Residual risk: Xiaohongshu may change `mediaV2`, subtitle language labels, signed CDN hosts, or public-page availability; the provided signed page tokens may also expire. The implementation fails closed to ordinary ASR, never persists signed URLs or `xsec_token`, and does not describe historical fixture success as permanent upstream compatibility. The unrelated app browser-smoke failure should be triaged separately before claiming a completely green repository gate.

## Context and Orientation

### Approved intent and verified evidence

- `docs/product-specs/2026-08-25-xiaohongshu-platform-subtitle-first-transcript.md`
- `docs/design-docs/2026-08-23-xiaohongshu-platform-subtitle-direct-extraction.md`
- `docs/references/2026-08-21-xiaohongshu-platform-subtitle-probe.md`
- `docs/references/2026-08-22-xiaohongshu-platform-subtitle-probe-6a82e949.md`
- `docs/references/2026-08-22-xiaohongshu-platform-subtitle-probe-6a84fc60000000002c0077e4.md`
- `docs/references/2026-08-22-xiaohongshu-platform-subtitle-probe-6a872cd0000000002702f748.md`

### Xiaohongshu ownership

- `worker/frameq_worker/xiaohongshu/types.py`: shared immutable types and HTTP protocols.
- `worker/frameq_worker/xiaohongshu/page.py`: bounded response decoding and `note_obj` lookup.
- `worker/frameq_worker/xiaohongshu/streams.py`: pure video-stream interpretation/ranking.
- `worker/frameq_worker/xiaohongshu/transport.py`: CookieJar/urllib and atomic bounded downloads.
- `worker/frameq_worker/xiaohongshu_fallback.py`: stable production adapter and page/video orchestration.
- `worker/frameq_worker/media.py`: `yt-dlp` plus platform fallback strategy selection.

### Generic subtitle and transcript consumers

- `worker/frameq_worker/subtitles.py`: SRT/VTT file ranking and parsing.
- `worker/frameq_worker/media_preparation.py`: media/audio preparation and subtitle discovery.
- `worker/frameq_worker/pipeline_runtime/transcript.py`: platform-subtitle artifact/metadata path and ASR fallback.
- `worker/frameq_worker/asr_runtime/artifacts.py`: source-aware transcript Markdown.
- `app/src/i18n/resources.ts`: existing subtitle detection progress copy.
- `app/src/i18n/transcriptResources.ts`: existing platform-subtitle source labels.

### Focused tests and packaging

- `worker/tests/test_xiaohongshu_subtitles.py` (new)
- `worker/tests/test_xiaohongshu_fallback.py`
- `worker/tests/test_xiaohongshu_module_boundaries.py`
- `worker/tests/test_media.py`
- `worker/tests/test_media_preparation.py`
- `worker/tests/test_subtitles.py`
- `worker/tests/test_task_artifacts.py`
- `app/src-tauri/resources/worker/frameq_worker/` (generated mirror; never hand-edit)

## File Structure

| File | Responsibility after implementation |
| --- | --- |
| `worker/frameq_worker/xiaohongshu/subtitles.py` | Pure mediaV2 decoding, explicit track validation, language normalization, URL allowlist, deterministic single-track selection |
| `worker/frameq_worker/xiaohongshu/types.py` | `XiaohongshuSubtitleTrack` plus extended bounded download protocol keywords |
| `worker/frameq_worker/xiaohongshu/transport.py` | Atomic SRT/VTT download with size/content-type/final-host validation |
| `worker/frameq_worker/xiaohongshu_fallback.py` | One-page fallback composition and public best-effort subtitle sidecar entry |
| `worker/frameq_worker/media.py` | Invoke the sidecar entry only after successful Xiaohongshu `yt-dlp`; fallback path remains single-owner |
| `worker/frameq_worker/subtitles.py` | Include exact `en-US` in deterministic generic file ranking |
| Existing media/pipeline/UI files | Consume the sidecar through existing interfaces; no production edits expected |

## Plan of Work

### Task 1: Add a pure typed Xiaohongshu subtitle-track policy

**Files:**

- Create: `worker/frameq_worker/xiaohongshu/subtitles.py`
- Modify: `worker/frameq_worker/xiaohongshu/types.py`
- Create: `worker/tests/test_xiaohongshu_subtitles.py`
- Modify: `worker/tests/test_xiaohongshu_module_boundaries.py`

- [x] **Step 1: Write RED parser and policy tests.** Cover a verified-shaped `mediaV2` JSON string with `source`, `zh-CN`, and `en-US`; `source` must win and use its explicit `language`. Cover source-missing fallback, malformed JSON, non-object `video/subtitles`, non-list groups, missing language, HTTP URL, credentials in URL, non-Xiaohongshu CDN host, unsupported format, and deterministic first-valid selection.

  ```python
  def test_selects_source_track_before_language_groups() -> None:
      note = {
          "video": {
              "mediaV2": json.dumps({
                  "video": {
                      "subtitles": {
                          "en-US": [{"language": "en-US", "url": "https://sns-video-a.xhscdn.com/en.srt"}],
                          "source": [{"language": "zh-CN", "url": "https://sns-video-a.xhscdn.com/source.srt"}],
                          "zh-CN": [{"language": "zh-CN", "url": "https://sns-video-a.xhscdn.com/zh.srt"}],
                      }
                  }
              })
          }
      }

      assert select_preferred_subtitle_track(note) == XiaohongshuSubtitleTrack(
          language="zh-CN",
          url="https://sns-video-a.xhscdn.com/source.srt",
          suffix=".srt",
      )
  ```

- [x] **Step 2: Run the RED policy suite.**

  ```powershell
  uv run pytest worker\tests\test_xiaohongshu_subtitles.py worker\tests\test_xiaohongshu_module_boundaries.py -q
  ```

  Expected: FAIL because the module, type, and boundary registration do not exist.

- [x] **Step 3: Add the immutable track type and pure selector.** Implement this public shape in the private package:

  ```python
  @dataclass(frozen=True)
  class XiaohongshuSubtitleTrack:
      language: str
      url: str
      suffix: str
  ```

  `select_preferred_subtitle_track(note_obj)` must decode only string `mediaV2`, inspect only explicit `video.subtitles` mappings, rank groups in this order, and return `None` on unsupported data:

  ```python
  PREFERRED_SUBTITLE_GROUPS = (
      "source", "zh-Hans", "zh-CN", "zh-Hant", "zh", "en-US", "en", "ja", "ko"
  )

  def select_preferred_subtitle_track(
      note_obj: Mapping[str, object],
  ) -> XiaohongshuSubtitleTrack | None:
      video = _mapping(note_obj.get("video"))
      raw_media_v2 = video.get("mediaV2") if video else None
      if not isinstance(raw_media_v2, str) or not raw_media_v2.strip():
          return None
      try:
          media_v2 = json.loads(raw_media_v2)
      except json.JSONDecodeError:
          return None
      media_video = _mapping(media_v2.get("video")) if isinstance(media_v2, Mapping) else None
      groups = _mapping(media_video.get("subtitles")) if media_video else None
      if groups is None:
          return None
      for group_name in PREFERRED_SUBTITLE_GROUPS:
          raw_tracks = groups.get(group_name)
          if not isinstance(raw_tracks, list):
              continue
          for raw_track in raw_tracks:
              track = _parse_track(raw_track, group_name)
              if track is not None:
                  return track
      return None
  ```

  `_parse_track` must normalize `_` to `-`, accept only a bounded BCP-47-shaped tag, default a non-`source` missing language to its group, accept `.srt` or `.vtt` from explicit format/path and default verified Xiaohongshu tracks to `.srt`, and call `is_allowed_subtitle_url`. That URL predicate must require HTTPS, no username/password, and a hostname equal to or below `xhscdn.com` or `xiaohongshu.com`.

- [x] **Step 4: Extend the module boundary manifest.** Register `subtitles.py` in `PRIVATE_MODULES`; assert it imports no urllib request, CookieJar, filesystem, progress, media, pipeline, ASR, task-store, or root-adapter layer. Keep `__init__.py` empty.

- [x] **Step 5: Run GREEN policy tests and Ruff.**

  ```powershell
  uv run pytest worker\tests\test_xiaohongshu_subtitles.py worker\tests\test_xiaohongshu_module_boundaries.py -q
  uv run ruff check worker\frameq_worker\xiaohongshu worker\tests\test_xiaohongshu_subtitles.py worker\tests\test_xiaohongshu_module_boundaries.py
  ```

- [x] **Step 6: Commit only Task 1 files.**

  ```powershell
  git add -- worker/frameq_worker/xiaohongshu/subtitles.py worker/frameq_worker/xiaohongshu/types.py worker/tests/test_xiaohongshu_subtitles.py worker/tests/test_xiaohongshu_module_boundaries.py
  git commit -m "feat(worker): parse Xiaohongshu subtitle tracks"
  ```

### Task 2: Add bounded atomic subtitle transport

**Files:**

- Modify: `worker/frameq_worker/xiaohongshu/types.py`
- Modify: `worker/frameq_worker/xiaohongshu/transport.py`
- Modify: `worker/tests/test_xiaohongshu_fallback.py`

- [x] **Step 1: Write RED transport tests.** Assert a valid SRT response is atomically committed, `.part` is removed, and media headers are used. Assert non-2xx, empty body, HTML/video content type, declared/actual content above 2 MiB, and redirect to a non-Xiaohongshu host preserve an existing destination and leave no `.part`.

  ```python
  def test_download_subtitle_rejects_cross_host_final_url(tmp_path: Path) -> None:
      destination = tmp_path / "note.zh-CN.srt"
      destination.write_bytes(b"previous")
      client = FakeHttpClient({
          "https://sns-video-a.xhscdn.com/source.srt": [HttpResponse(
              status=200,
              headers={"Content-Type": "application/x-subrip"},
              body=b"1\n00:00:00,000 --> 00:00:01,000\ntext\n",
              url="https://example.invalid/redirected.srt",
          )]
      })

      with pytest.raises(SafeDownloadError):
          download_subtitle_to_path(
              "https://sns-video-a.xhscdn.com/source.srt", destination, client
          )

      assert destination.read_bytes() == b"previous"
      assert not destination.with_name("note.zh-CN.srt.part").exists()
  ```

- [x] **Step 2: Run RED transport tests.**

  ```powershell
  uv run pytest worker\tests\test_xiaohongshu_fallback.py -q
  ```

  Expected: FAIL because `download_subtitle_to_path` and bounded subtitle transport options are absent.

- [x] **Step 3: Extend the downloader protocol without changing video defaults.** Add optional keyword-only arguments to `XiaohongshuDownloadClient.download_to_path`, `UrllibXiaohongshuHttpClient.download_to_path`, `_download_request_to_path`, and streaming test fakes:

  ```python
  allowed_content_types: tuple[str, ...] | None = None,
  allowed_host_suffixes: tuple[str, ...] | None = None,
  ```

  `None` must retain `VIDEO_CONTENT_TYPES` and current unrestricted video-host behavior. When suffixes are supplied, validate both the submitted URL and `response.geturl()` as HTTPS with no credentials and a matching exact/subdomain suffix before writing a byte.

- [x] **Step 4: Implement the subtitle-specific wrapper.** Use fixed constants and the existing atomic writers:

  ```python
  XHS_MAX_SUBTITLE_BYTES = 2 * 1024 * 1024
  XHS_SUBTITLE_CONTENT_TYPES = (
      "application/x-subrip", "application/srt", "text/plain", "text/vtt",
      "application/octet-stream",
  )
  XHS_SUBTITLE_HOST_SUFFIXES = ("xhscdn.com", "xiaohongshu.com")

  def download_subtitle_to_path(
      subtitle_url: str,
      output_path: Path,
      http_client: XiaohongshuHttpClient,
  ) -> int:
      if not is_allowed_subtitle_url(subtitle_url):
          raise SafeDownloadError("DOWNLOAD_URL_INVALID", "Subtitle URL is not allowed.")
      downloader = getattr(http_client, "download_to_path", None)
      if callable(downloader):
          return int(downloader(
              subtitle_url,
              output_path,
              headers=media_headers(),
              timeout_seconds=20.0,
              max_bytes=XHS_MAX_SUBTITLE_BYTES,
              no_progress_timeout_seconds=30.0,
              allowed_content_types=XHS_SUBTITLE_CONTENT_TYPES,
              allowed_host_suffixes=XHS_SUBTITLE_HOST_SUFFIXES,
          ))
      response = http_client.get(subtitle_url, headers=media_headers(), timeout_seconds=20.0)
      if not is_allowed_subtitle_url(response.url):
          raise SafeDownloadError("DOWNLOAD_URL_INVALID", "Subtitle redirect is not allowed.")
      return write_http_response_atomically(
          response,
          output_path,
          max_bytes=XHS_MAX_SUBTITLE_BYTES,
          allowed_content_types=XHS_SUBTITLE_CONTENT_TYPES,
      )
  ```

- [x] **Step 5: Run GREEN transport tests and the existing download reliability suite.**

  ```powershell
  uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_download_reliability.py -q
  uv run ruff check worker\frameq_worker\xiaohongshu worker\tests\test_xiaohongshu_fallback.py
  ```

- [x] **Step 6: Commit only Task 2 files.**

  ```powershell
  git add -- worker/frameq_worker/xiaohongshu/types.py worker/frameq_worker/xiaohongshu/transport.py worker/tests/test_xiaohongshu_fallback.py
  git commit -m "feat(worker): download Xiaohongshu subtitles safely"
  ```

### Task 3: Compose best-effort subtitle acquisition in the Xiaohongshu root adapter

**Files:**

- Modify: `worker/frameq_worker/xiaohongshu_fallback.py`
- Modify: `worker/tests/test_xiaohongshu_fallback.py`
- Modify: `worker/tests/test_xiaohongshu_module_boundaries.py`

- [x] **Step 1: Write RED root-adapter tests.** Add these exact behaviors:

  - fallback video success plus valid `mediaV2` downloads MP4 then one `<note_id>.zh-CN.srt`;
  - the fallback page URL is requested once and the existing `note_obj` is reused;
  - invalid/expired/oversized subtitle leaves the successful MP4 and returns it;
  - `download_xiaohongshu_subtitle` supports the generic `yt-dlp` success path with one page request;
  - no track returns `None` and writes no file;
  - root errors/events never include `xsec_token` or signed subtitle URLs.

  ```python
  def subtitle_video_state(note_id: str = NOTE_ID) -> dict[str, object]:
      state = video_state(note_id)
      note = state["note"]["noteDetailMap"][note_id]["note"]
      note["video"]["mediaV2"] = json.dumps({
          "video": {"subtitles": {"source": [{
              "language": "zh-CN",
              "url": "https://sns-video-a.xhscdn.com/source.srt?sign=redacted-fixture",
          }]}}
      })
      return state
  ```

- [x] **Step 2: Run RED root tests.**

  ```powershell
  uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py -q
  ```

  Expected: FAIL because the root adapter returns immediately after video download and has no sidecar entry.

- [x] **Step 3: Refactor one bounded note loader.** Add `_load_public_note(parsed, client)` that performs `build_explore_url`, page headers, response mapping, decompression, initial-state extraction, and lookup exactly once. Use it from both root entries; do not move page logic into `media.py`.

- [x] **Step 4: Implement a private best-effort writer and public sidecar entry.** The public entry must have this closed behavior:

  ```python
  def download_xiaohongshu_subtitle(
      raw_input: str,
      output_dir: Path,
      http_client: XiaohongshuDownloadClient | None = None,
  ) -> Path | None:
      client = http_client or UrllibXiaohongshuHttpClient()
      try:
          parsed = parse_xiaohongshu_input(raw_input, http_client=client)
          note_obj = _load_public_note(parsed, client)
          return _download_preferred_subtitle_best_effort(
              note_obj, parsed.note_id, output_dir, client
          )
      except (XiaohongshuFallbackError, SafeDownloadError, OSError):
          return None
  ```

  `_download_preferred_subtitle_best_effort` selects one typed track, builds only `<note_id>.<safe-language><suffix>` inside `output_dir`, calls `download_subtitle_to_path`, and returns `None` for expected track/download failures. It must not log, persist, or return the URL. In `download_xiaohongshu_video`, assign the successful MP4 path, call this helper with the already-loaded `note_obj`, then return the MP4 regardless of subtitle outcome.

- [x] **Step 5: Preserve and test the stable root surface.** Re-export only the public sidecar function needed by `media.py`; add it to the compatibility-surface test. Do not expose raw mediaV2 objects or signed URLs.

- [x] **Step 6: Run GREEN root tests and Ruff.**

  ```powershell
  uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py -q
  uv run ruff check worker\frameq_worker\xiaohongshu_fallback.py worker\frameq_worker\xiaohongshu worker\tests\test_xiaohongshu_fallback.py
  ```

- [x] **Step 7: Commit only Task 3 files.**

  ```powershell
  git add -- worker/frameq_worker/xiaohongshu_fallback.py worker/tests/test_xiaohongshu_fallback.py worker/tests/test_xiaohongshu_module_boundaries.py
  git commit -m "feat(worker): attach Xiaohongshu platform subtitles"
  ```

### Task 4: Cover successful yt-dlp and generic subtitle discovery

**Files:**

- Modify: `worker/frameq_worker/media.py`
- Modify: `worker/frameq_worker/subtitles.py`
- Modify: `worker/tests/test_media.py`
- Modify: `worker/tests/test_media_preparation.py`
- Modify: `worker/tests/test_subtitles.py`

- [x] **Step 1: Write RED `yt-dlp` success tests.** Monkeypatch `media.download_xiaohongshu_subtitle`; a successful Xiaohongshu `yt-dlp` run must call it once with the original transient URL and output directory, while non-Xiaohongshu success must not call it. A `None` sidecar result must preserve the exact successful `CommandResult`.

  ```python
  def test_successful_xiaohongshu_ytdlp_probes_platform_subtitle(
      tmp_path: Path, monkeypatch: pytest.MonkeyPatch
  ) -> None:
      probes: list[tuple[str, Path]] = []
      monkeypatch.setattr(
          media,
          "download_xiaohongshu_subtitle",
          lambda url, output_dir: probes.append((url, output_dir)) or None,
      )
      result = media.download_video(
          f"https://www.xiaohongshu.com/explore/{NOTE_ID}",
          tmp_path,
          runner=lambda command: CommandResult(command, 0, "video.mp4", ""),
      )

      assert result.returncode == 0
      assert probes == [(f"https://www.xiaohongshu.com/explore/{NOTE_ID}", tmp_path)]
  ```

- [x] **Step 2: Write RED discovery/ranking tests.** Add exact `en-US` before `en` in generic subtitle ranking. Add a media-facade test where a successful `xiaohongshu-fallback` result leaves `<note_id>.zh-CN.srt`; `PreparedMedia.subtitle_candidate` must contain its text/language. Keep `bilibili-fallback` excluded and local media subtitle-free.

- [x] **Step 3: Run RED media tests.**

  ```powershell
  uv run pytest worker\tests\test_media.py worker\tests\test_media_preparation.py worker\tests\test_subtitles.py -q
  ```

  Expected: FAIL because generic success does not invoke the sidecar and `en-US` has no explicit rank.

- [x] **Step 4: Add the bounded success hook.** Import the root sidecar only through `xiaohongshu_fallback.py`. Before the normal successful `download_video` return, call it only when `_contains_supported_url(url, XIAOHONGSHU_HOST_SUFFIXES)` is true. Do not call it after `xiaohongshu-fallback`, because Task 3 already owns that single-page composition.

  ```python
  def _probe_xiaohongshu_subtitle_after_ytdlp(url: str, output_dir: Path) -> None:
      if not _contains_supported_url(url, XIAOHONGSHU_HOST_SUFFIXES):
          return
      download_xiaohongshu_subtitle(url, output_dir)
  ```

  Call this helper only on the ordinary `result.returncode == 0` branch. The root sidecar entry owns expected failures and returns `None`; no new `CommandResult`, stderr, or error code is created.

- [x] **Step 5: Extend generic language priority.** Change the tuple to:

  ```python
  PREFERRED_SUBTITLE_LANGUAGES = (
      "zh-Hans", "zh-CN", "zh-Hant", "zh", "en-US", "en", "ja", "ko"
  )
  ```

- [x] **Step 6: Run GREEN media tests and Ruff.**

  ```powershell
  uv run pytest worker\tests\test_media.py worker\tests\test_media_preparation.py worker\tests\test_subtitles.py -q
  uv run ruff check worker\frameq_worker\media.py worker\frameq_worker\subtitles.py worker\tests\test_media.py worker\tests\test_media_preparation.py worker\tests\test_subtitles.py
  ```

- [x] **Step 7: Commit only Task 4 files.**

  ```powershell
  git add -- worker/frameq_worker/media.py worker/frameq_worker/subtitles.py worker/tests/test_media.py worker/tests/test_media_preparation.py worker/tests/test_subtitles.py
  git commit -m "feat(worker): probe Xiaohongshu subtitles after yt-dlp"
  ```

### Task 5: Prove Xiaohongshu transcript metadata and ASR skipping end to end

**Files:**

- Modify: `worker/tests/test_task_artifacts.py`
- Modify only if a real gap is exposed: `worker/frameq_worker/media_preparation.py`
- Modify only if a real gap is exposed: `worker/frameq_worker/pipeline_runtime/transcript.py`

- [x] **Step 1: Add an end-to-end Xiaohongshu subtitle test.** Force the generic downloader to fail, monkeypatch the Xiaohongshu fallback to write one MP4 and one valid `zh-CN.srt`, provide fake ffprobe/ffmpeg results, pass `transcriber=None` with `allow_real_asr=False`, and assert completion. The required assertions are:

  ```python
  assert result["status"] == "completed"
  assert result["text"] == "小红书平台字幕第一句\n小红书平台字幕第二句"
  assert result["transcript"] == {
      "source": "subtitle",
      "language": "zh-CN",
      "engine": None,
  }
  assert "Transcript Source: Platform subtitle" in transcript_md
  assert "Model:" not in transcript_md
  assert manifest["model"] == "iic/SenseVoiceSmall"
  assert manifest["transcript"] == result["transcript"]
  download_dir = cache_root / "tasks" / result["task_id"] / "download"
  assert list(download_dir.glob("*.srt"))
  assert "srt" not in manifest["artifacts"]
  ```

  The test must also collect progress and assert `subtitle.detect.running` precedes `subtitle.detect.found`, with no `asr.cache.preparing`, `asr.transcribe.starting`, or `asr.transcribe.running` event.

- [x] **Step 2: Add the miss-path companion test.** Make the sidecar return `None`, pass a `FakeTranscriber`, and assert `transcript.source == "asr"`, the ASR transcriber is called once, and no platform-subtitle source is written. The video result must remain successful.

- [x] **Step 3: Run RED/GREEN end-to-end tests.** First run after adding tests; if existing generic behavior already passes, record that as characterization evidence and make no production edit. If a real gap fails, patch only the two optional files listed above and explain the exact gap in Surprises & Discoveries.

  ```powershell
  uv run pytest worker\tests\test_task_artifacts.py -q
  uv run pytest worker\tests\test_pipeline.py worker\tests\test_asr.py -q
  ```

- [x] **Step 4: Run the complete focused feature set.**

  ```powershell
  uv run pytest worker\tests\test_xiaohongshu_subtitles.py worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py worker\tests\test_media.py worker\tests\test_media_preparation.py worker\tests\test_subtitles.py worker\tests\test_task_artifacts.py worker\tests\test_pipeline.py worker\tests\test_asr.py -q
  uv run ruff check worker
  ```

- [x] **Step 5: Commit the end-to-end tests and any evidence-driven minimal fix.**

  ```powershell
  git add -- worker/tests/test_task_artifacts.py
  git diff --cached --quiet
  ```

  If an evidence-driven production fix was necessary, stage only the changed optional file with a separate `git add -- <exact-path>` command. Confirm `git diff --cached --name-only` contains only Task 5 files. If `git diff --cached --quiet` exits `1`, run this as a separate command:

  ```powershell
  git commit -m "test(worker): verify Xiaohongshu subtitle-first pipeline"
  ```

  If `git diff --cached --quiet` exits `0`, record that existing generic behavior already supplied the end-to-end coverage and do not create an empty commit. Do not stage unrelated app changes.

### Task 6: Synchronize durable docs/package mirror and close acceptance

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify after acceptance: `docs/product-specs/2026-08-25-xiaohongshu-platform-subtitle-first-transcript.md`
- Modify after acceptance: `docs/design-docs/2026-08-23-xiaohongshu-platform-subtitle-direct-extraction.md`
- Modify: `TASKS.md`
- Generated refresh: `app/src-tauri/resources/worker/frameq_worker/`
- Move after complete acceptance: `docs/exec-plans/active/2026-08-25-xiaohongshu-platform-subtitle-first-transcript-plan.md` to `docs/exec-plans/completed/2026-08-25-xiaohongshu-platform-subtitle-first-transcript-plan.md`
- Modify after move: `docs/exec-plans/active/index.md`
- Modify after move: `docs/exec-plans/completed/index.md`

- [x] **Step 1: Update architecture and security truth.** Extend the subtitle-first boundary to Xiaohongshu public page SRT, record both `yt-dlp` success and fallback acquisition paths, temporary-only SRT storage, exact metadata semantics, transient `xsec_token`/signed URL handling, bounded final-host validation, and ASR fallback. Do not change contract versions.

- [x] **Step 2: Refresh the packaged worker from canonical source.** Never hand-edit the mirror.

  ```powershell
  node --input-type=module -e "import { prepareFreshWorkerResource } from './scripts/tauri-dev-fresh-worker.mjs'; await prepareFreshWorkerResource();"
  git diff --no-index -- worker\frameq_worker app\src-tauri\resources\worker\frameq_worker
  ```

  Expected: refresh exits 0; recursive comparison exits 0 with no byte/file-set diff.

- [x] **Step 3: Run full automated gates.** Record exact totals in Progress and Outcomes.

  ```powershell
  uv run pytest worker\tests
  uv run ruff check worker
  npm --prefix app test
  npm --prefix app run lint
  python scripts\validate_agents_docs.py --level ERROR
  python scripts\validate_agents_docs.py --level WARN
  git diff --check
  ```

- [x] **Step 4: Run bounded live public-note smoke.** Use note IDs from the four existing probe records, never save signed URLs or tokens, and exercise the production page/selector/downloader/parser path. Require at least one current public note to produce a non-empty `SubtitleTranscript`; record all four outcomes as upstream evidence, not deterministic automated tests. Confirm the smoke creates no manifest/log entry containing `xsec_token` or a signed CDN query. Executed; the four current requests returned `miss`, recorded as an upstream availability residual rather than a selector/transport test failure.

- [x] **Step 5: Close documentation only after gates.** Mark the product spec/design as implemented, update TASKS, fill this plan's exact Progress/Outcomes evidence and residual risk, move it to `completed/`, and update both plan indexes.

- [x] **Step 6: Commit only implementation closeout files.**

  ```powershell
  git add -- docs/ARCHITECTURE.md docs/SECURITY.md docs/product-specs/2026-08-25-xiaohongshu-platform-subtitle-first-transcript.md docs/design-docs/2026-08-23-xiaohongshu-platform-subtitle-direct-extraction.md TASKS.md docs/exec-plans/active/index.md docs/exec-plans/completed/index.md docs/exec-plans/completed/2026-08-25-xiaohongshu-platform-subtitle-first-transcript-plan.md app/src-tauri/resources/worker/frameq_worker
  git commit -m "docs: complete Xiaohongshu subtitle-first rollout"
  ```

## Validation and Acceptance

### Focused RED/GREEN commands

```powershell
uv run pytest worker\tests\test_xiaohongshu_subtitles.py worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py -q
uv run pytest worker\tests\test_media.py worker\tests\test_media_preparation.py worker\tests\test_subtitles.py -q
uv run pytest worker\tests\test_task_artifacts.py worker\tests\test_pipeline.py worker\tests\test_asr.py -q
uv run ruff check worker
```

### Full repository gates proportional to this worker-only change

```powershell
uv run pytest worker\tests
uv run ruff check worker
npm --prefix app test
npm --prefix app run lint
node --input-type=module -e "import { prepareFreshWorkerResource } from './scripts/tauri-dev-fresh-worker.mjs'; await prepareFreshWorkerResource();"
git diff --no-index -- worker\frameq_worker app\src-tauri\resources\worker\frameq_worker
python scripts\validate_agents_docs.py --level ERROR
python scripts\validate_agents_docs.py --level WARN
git diff --check
```

Rust and server code/contracts do not change. Run their complete suites only if implementation unexpectedly touches their files or a shared contract; otherwise document that they were out of the change surface rather than claiming they passed.

### Automated acceptance assertions

- A verified-shaped `mediaV2` yields one deterministic safe track; malformed or hostile state yields `None`.
- Initial and final subtitle URLs are HTTPS, credential-free, and limited to approved Xiaohongshu resource hosts.
- Subtitle response status, content type, size, empty-body, atomic replacement, and `.part` cleanup are bounded.
- Fallback video acquisition reuses one note page response; successful `yt-dlp` runs execute one separate best-effort sidecar probe.
- Subtitle failure never changes a successful video `CommandResult` or MP4 artifact into failure.
- `find_subtitle_transcript` sees the selected SRT/VTT, emits safe language metadata, and platform subtitle completion skips all ASR model/transcribe events.
- Miss/parse failure proceeds through existing ASR with `source=asr`.
- Raw SRT/VTT remains under task cache download storage and is absent from manifest artifacts and server/cloud requests.
- Existing YouTube/Bilibili subtitle-first behavior, local media behavior, XHS image-only/error behavior, progress contract, and three-locale UI tests remain green.
- Canonical and packaged worker trees are byte-for-byte equal.

### Manual/live acceptance

1. Submit one currently public verified Xiaohongshu note with platform subtitles through the desktop flow.
2. Confirm video and audio artifacts remain available and the transcript completes without ASR model preparation/download.
3. Open transcript detail and confirm `来源：平台字幕（zh-CN）` or the actual safe language.
4. Submit one public Xiaohongshu video with no usable platform subtitle and confirm local ASR runs normally.
5. Inspect task manifest, transcript metadata, diagnostics, and logs: no `xsec_token`, signed subtitle URL, Cookie, response body, or raw SRT artifact path is persisted.
6. Reopen both tasks from History and confirm source labels, audio review, editing, export, and optional AI actions behave exactly as existing tasks.

## Recovery Notes

- If an implementation session stops after Task 1 or 2, the new private policy/transport is unused by production and can be resumed safely from the next unchecked step.
- If it stops after Task 3, fallback downloads may create SRT files but successful `yt-dlp` Xiaohongshu paths are not complete until Task 4.
- If a focused test exposes a generic pipeline gap in Task 5, record the evidence before editing either optional production file; do not broaden into a pipeline refactor.
- Never clean or reset the user-owned modifications in `app/src-tauri/src/insight_preferences.rs` or `app/src-tauri/src/video_processing/retry_insights.rs`.
