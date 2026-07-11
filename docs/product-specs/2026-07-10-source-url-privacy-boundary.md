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
    value crosses frontend-to-Tauri IPC and a one-shot desktop-to-worker stdin pipe solely
    for the current processing or cache-only identity-resolution call. It must not appear
    in worker argv or environment variables.
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
- Before a full worker starts, Tauri may pass the submitted URL through stdin to a
  separate transient, cache-only identity preflight. That process returns only a
  validated `SourceIdentity`; its raw payload is absent from argv, environment variables,
  and logs, and its result is never injected into the full processing request.

## Desktop-to-Worker Request Transport

- Production Tauri worker command specifications carry only fixed mode flags in argv.
  Serialized process-video, source-identity preflight, and AI-retry request objects are
  held in the desktop process, written once to a child stdin pipe after spawn, and then
  the pipe is closed before waiting for output.
- Request JSON must never be placed in a worker argument, environment variable, command
  log detail, spawn error, or process-termination diagnostic. Command construction uses
  an argument vector and never invokes a shell.
- The worker CLI exposes explicit stdin modes for controlled development use. URL-bearing
  legacy JSON argv modes are not a production fallback and are removed from the supported
  request path; fixed no-payload model download remains an ordinary flag. There is no
  production or development migration mode for legacy task source data.
- Empty, oversized, unreadable, or malformed stdin is rejected with a fixed structured
  error that does not echo the payload or parser input. The desktop likewise maps stdin
  pipe/write failures to fixed sanitized errors and terminates the just-spawned process
  group before returning.
- Stdin ownership does not change `ProcessSupervisor`: Windows keeps tree termination,
  Unix keeps the isolated process group and TERM-to-KILL escalation, and `wait_with_output`
  must never retain an open request pipe that can block worker completion or cancellation.

## Persistence and AI Input

- `transcript/transcript.md` may show only `canonical_url` as its Source URL.
- New `frameq-task.json` files use schema version 3. `source_url` stores only
  `canonical_url`, and `source_identity` stores the exact allowlisted identity fields.
  Schema versions 1 and 2 are unsupported legacy data and are never read by history,
  cache, transcript actions, or AI retry.
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

## Cache and History

- Request-to-task matching compares the structured identity key
  `(platform, stable_id, effective_part)`, not raw submitted URL strings. An exact safe
  canonical URL can hit before worker launch; URL variants and supported short links may
  run a lightweight source-identity preflight, but a cache hit must never enter media
  download, audio extraction, or ASR.
- Product reads accept only schema v3 manifests with the current privacy marker, a valid
  canonical SourceIdentity, and no quarantine flag. Legacy, incomplete, quarantined, or
  malformed manifests remain physically untouched and are excluded from history, cache,
  transcript actions, and AI retry.
- Source-identity preflight output is advisory for desktop cache lookup only. It is never
  injected into the full processing request; on a cache miss, the worker independently
  resolves the submitted download URL before creating a task or persisting identity.
- FrameQ does not canonicalize, rewrite, mark, rename, redact, index, or delete unsupported
  legacy directories. Users may back up or delete those physical files themselves. Normal
  diagnostics report only aggregate ignored counts and elapsed time, never legacy task ids,
  paths, URLs, manifest fields, or artifact content.

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
- Cache reuse, history loading, and existing current safe URLs remain functional after
  canonicalization; legacy manifests are deliberately unsupported.
- A recursive scan of persisted task results finds no original sensitive URL,
  `xsec_token`, or fixture token value.
- Rust command-spec and real-child probes show that a request containing
  `xsec_token=review-secret` reaches worker stdin while neither argv nor environment
  contains the raw URL, parameter name, or token value. Success, structured failure, and
  cancellation retain the existing terminal semantics with stdin closed.
