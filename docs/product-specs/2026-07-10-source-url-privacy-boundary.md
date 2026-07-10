# Source URL Privacy Boundary

## Purpose

FrameQ must keep a user-submitted URL usable for the current download without allowing
credential-like query parameters, signatures, or volatile share metadata to enter local
task artifacts, history, diagnostics, UI errors, or cloud LLM prompts.

## Source Identity Contract

- The process-local `SourceRequest` and persistable `SourceIdentity` are separate types:
  - `SourceRequest.download_url` is the original request used only by the current worker
    download and platform fallback calls. It may temporarily contain parameters such as
    `xsec_token`, has no durable/result serializer, and must not be copied into results,
    manifests, transcript metadata, history, logs, progress events, or errors. The raw
    value still crosses frontend-to-Tauri IPC and the redacted full-worker command
    transport solely for the current processing call.
  - `SourceIdentity` contains only `version`, `platform`, `stable_id`, optional
    `effective_part`, and `canonical_url`. It is the only source object that may be
    persisted, displayed, returned to history, or compared for task reuse.
- Canonicalization is an allowlist, not a blacklist-only string replacement:
  - Xiaohongshu keeps the 24-character note ID and emits
    `https://www.xiaohongshu.com/explore/<note_id>` with no query.
  - Bilibili keeps the normalized BV or av video ID and emits
    `https://www.bilibili.com/video/<video_id>`; `p=1` is the default identity and the
    canonical URL keeps `?p=N` only for `N > 1`.
  - YouTube keeps the video ID only and emits
    `https://www.youtube.com/watch?v=<video_id>`.
  - Douyin keeps the numeric aweme ID and emits
    `https://www.douyin.com/video/<aweme_id>`.
  - URL userinfo and fragments are always removed. Unknown query parameters, including
    credential-, token-, signature-, session-, and authorization-like parameters, are
    never copied to canonical output.
- For supported platform short links, the worker resolves the public redirect first when
  resolution is available and derives `canonical_url` from the resolved stable ID. A
  failed short-link resolution must not make the original short URL persistable.
- Before a full worker starts, Tauri may pass the submitted URL to a separate transient,
  cache-only identity preflight. That process returns only a validated `SourceIdentity`;
  its raw payload is redacted from logs and its result is never injected into the full
  processing request.

## Persistence and AI Input

- `transcript/transcript.md` may show only `canonical_url` as its Source URL.
- New `frameq-task.json` files use schema version 3. `source_url` stores only
  `canonical_url`, and `source_identity` stores the exact allowlisted identity fields.
  Schema versions 1 and 2 remain readable but are never treated as proof that their
  `source_url` is already safe.
- Every AI generation starts by rereading the complete official saved
  task-root `transcript/transcript.txt` body after exact-path and link/reparse-point
  validation. The current invocation may derive bounded chunks or excerpts from that
  body, but must not read transcript Markdown metadata, an alternate same-named file,
  manifest previews, or stale request text as prompt input.
- `retry_insights` reads `transcript/transcript.txt` again for every retry so a user's
  saved transcript edits become the next prompt source.
- Error and diagnostic boundaries use structured codes and sanitized public messages;
  downloader stderr or command arguments containing the original URL must not be copied
  into manifests, UI errors, or desktop logs.

## Cache, History, and Compatibility

- Request-to-task matching compares the structured identity key
  `(platform, stable_id, effective_part)`, not raw submitted URL strings. An exact safe
  canonical URL can hit before worker launch; URL variants and supported short links may
  run a lightweight source-identity preflight, but a cache hit must never enter media
  download, audio extraction, or ASR.
- Existing schema-version 1 or 2 manifests without source-identity metadata remain
  readable. When a legacy `source_url` can be safely canonicalized, FrameQ rewrites that
  field in place at the bounded manifest-read boundary before returning history or using
  it for cache matching.
- Source-identity preflight output is advisory for desktop cache lookup only. It is never
  injected into the full processing request; on a cache miss, the worker independently
  resolves the submitted download URL before creating a task or persisting identity.
- If a legacy URL cannot be mapped to a supported stable identity, FrameQ exposes an
  unavailable/no-link placeholder and disables source-based reuse for that manifest. It
  must not return a merely stripped arbitrary host/path as a canonical identity.
- Migration is limited to local `frameq-task.json` files discovered under the configured
  output root, FrameQ's declared or conventional task-local transcript Markdown files,
  and declared or conventional FrameQ AI artifacts (`summary`, `mindmap`, `insights`, and
  `insights_md`). It removes the legacy raw source URL and known credential parameter
  names/values without scanning arbitrary transcript body text, media, old diagnostic
  logs, exported copies, user-managed backups, or arbitrary directories.
- Manifest supplemental values and standalone credential assignments inside the bounded
  migration scope are sanitized even when the old manifest has no recoverable
  `source_url`. Read, write, or interruption failures must preserve a retryable original
  manifest state, and linked/junction/reparse-point artifacts must not be followed.
- `source_privacy_migration_version: 2` represents this final cleanup contract. Tasks
  marked by the earlier version 1 cleanup are rechecked once so the stronger supplemental
  field and standalone-assignment sanitation is actually applied.
- A legacy task whose directory/task id itself contains a recovered sensitive parameter
  value is quarantined from history, reuse, transcript actions, and AI retry. FrameQ does
  not automatically rename that directory because task/cache references and concurrent
  readers make an in-place rename unsafe.

## Acceptance

- A Xiaohongshu request containing `xsec_token=review-secret` reaches `yt-dlp` and the
  Xiaohongshu fallback unchanged for the current call, while every task artifact,
  manifest, history value, UI error, diagnostic detail, and captured LLM prompt excludes
  both `xsec_token` and `review-secret`.
- Captured summary, mindmap, topic-planner, and insight prompt inputs are derived only from
  the complete saved transcript body read at invocation start and contain no transcript
  Markdown metadata.
- Canonicalization regression cases cover Xiaohongshu, Douyin, Bilibili, YouTube,
  supported short links, userinfo, fragments, and credential/signature query parameters.
- Insight retry uses user-edited `transcript.txt` content.
- Cache reuse, history loading, legacy manifests, and existing non-sensitive URLs remain
  functional after canonicalization.
- A recursive scan of persisted task results finds no original sensitive URL,
  `xsec_token`, or fixture token value.
