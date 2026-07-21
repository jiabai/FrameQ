# Security and Compliance

## 2026-07-21 Server HTTP Capability Boundary

- Administrator session and CSRF cookie names, attributes, issuance, verification, and clearing are
  private to `server/src/routes/admin.ts`. The split deliberately preserves the current successful
  login wire behavior, including its duplicate administrator-session `Set-Cookie` header; changing
  that compatibility detail requires a separate behavior/security change and provider/client
  validation.
- The root Fastify instance still captures exact JSON bytes before parsing. Only
  `server/src/routes/billing.ts` consumes `rawBody` for WeChat signature verification, and neither
  the parser nor the route adds logging, persistence, or response echo of the raw payload.
- Desktop LLM checkout remains private to its authenticated route owner and preserves the existing
  bearer-token hashing, entitlement/quota checks, server-managed secret handling, and fixed failure
  mapping. The route split does not widen supplier credentials or add a diagnostic path.
- Private route modules do not import Prisma or coordinate multi-write persistence. Payment
  settlement, activation redemption, and administrator entitlement adjustment remain atomic
  `Store`/`PrismaStore` operations behind application services.
- Server boundary tests lock all 20 method/path pairs, exact raw webhook forwarding, cookie/CSRF
  ownership, route-to-capability ownership, absence of feature-to-feature/Prisma/plugin imports,
  and root-only service/parser construction.

## 2026-07-20 ASR application module boundary

- `frameq_worker.asr` remains the only supported production import surface. The private
  `asr_runtime/` owners cannot import the root, CLI, pipeline, worker service, task store, LLM, or
  InsightFlow layers, and production callers cannot bypass the stable root.
- Qwen and SenseVoice SDK imports remain inside their default loaders; optional `numpy` and
  `funasr` VAD utilities remain inside the VAD path. Importing ASR contracts or registry functions
  does not load a provider SDK, initialize a model, download weights, or make a network request.
- `registry.py` alone owns `MODELSCOPE_CACHE` mutation. `sensevoice.py` alone owns provider/VAD/WAV
  effects, and `artifacts.py` alone owns source-identity projection plus transcript filesystem
  output. Source identity is still validated before the output directory is created.
- This extraction adds no prompt, transcript, path, model result, telemetry, or provider-error log.
  Existing provider exceptions remain wrapped with the current text and cause for compatibility;
  this layer does not claim that third-party exception text is sanitized, so it must not be added
  to a new diagnostic or persistence path without a separate security review.
- Canonical worker source remains under `worker/frameq_worker/`. The ignored Tauri worker resource
  was refreshed only through the established build path, and recursive relative-path plus SHA-256
  comparison proved all 56 files byte-equal. No dependency, credential, contract, manifest, or
  model-download boundary changed.

## 2026-07-20 Contract v4 local-media request boundary

- Global desktop-worker contract v4 is not permission to widen the stable URL request: URL
  processing still accepts only its v3 `contract_version + url + asr_model` stdin payload.
- React/TypeScript may hold only a canonical UUID selection token and validated display-safe name,
  kind, lowercase extension, and positive integer byte count. Its local-media module contains
  no complete-path field and rejects missing, extra, wrong-type, wrong-kind, or unsafe metadata with
  the fixed `LOCAL_MEDIA_SELECTION_INVALID` code.
- Rust path-bearing serialization is available only as a pure contract constructor for the later
  native command. It requires an absolute path, matching source/display extensions, a closed media
  kind/extension pair, the supported ASR model, and a safe basename; failures return one fixed
  non-echoing message. Token-bearing Rust DTOs deliberately do not implement `Debug`.
- Python parses the exact six-field local worker request into a path-bearing model whose path and
  safe display name are excluded from repr. Missing, additional, wrong-version/type/kind/extension,
  relative-path, unsafe-basename, or unsupported-model inputs fail before any filesystem or media
  operation with the same fixed non-echoing message.
- The shared registry explicitly forbids `full_path` and `selection_token` in progress. Contract
  transport policy permits a full path only in Rust selection memory, bounded worker stdin, and
  worker memory; the token is forbidden from worker input/output, diagnostics, persistence, prompts,
  and cloud traffic.
- No picker, selection store, worker CLI consumer, FFmpeg/ffprobe execution, manifest producer, log,
  or network path exists in this step, so no local media bytes or paths can yet leave these pure
  validation boundaries.

## 2026-07-20 Video-Processing Application Module Boundary

- The root Tauri adapter delegates to focused URL and retry modules without changing strict command
  inputs or public terminal results. Tauri's generated handler symbols remain at the existing root
  paths; `lib.rs` command registration is unchanged.
- URL cache reuse accepts only a requested URL or validated `SourceIdentity` plus ASR model and reads
  task data exclusively through `SupportedTask`. It cannot spawn workers, resolve settings, log, or
  access arbitrary manifest paths.
- Source-identity preflight remains a best-effort cache optimization for failed, wrong-family,
  unstructured, or protocol-invalid outcomes. Only completed identities influence cache matching;
  cancellation, busy, and transport categories retain fixed closed process failure mapping.
- Retry diagnostics contain only validated target, output language, status, and bounded safe error
  code. They never include task ID, preference snapshot, prompt, transcript, generated body, raw
  worker detail, URL, path, or credentials.
- The split introduces no new input/output field, worker invocation, persistence, network access,
  facade, local-path flow, or local-media placeholder. Contract v3 and the existing result/privacy
  validators remain authoritative.

## 2026-07-19 Video-Processing Task-Result Adapter Boundary

- Only `video_processing/task_result.rs` may turn typed process-video or retry-insights worker
  outcomes into synthetic public task failures. Callers select a closed context and cannot inject
  arbitrary status, stage, code, or fallback prose.
- A validated structured task result passes through unchanged. Wrong result families, protocol
  failures, raw unstructured stderr, and runtime error details never enter synthetic public errors;
  fixed safe codes and messages are used instead.
- Process-video failures keep `failed/video_extracting`; retry failures keep
  `partial_completed/insights_generating`. Pipe and wait failures retain the runner-owned fixed
  command-error behavior and are not converted into user-content-bearing task values.
- Cache/preflight, diagnostics, lifecycle supervision, terminal parsing, commands, contract v3, and
  local-media v4 remain separate boundaries. This extraction adds no logging, persistence, worker,
  network, prompt, transcript, or artifact access to the adapter.

## 2026-07-19 Closed Worker Terminal-Result Boundary

- Python-to-Rust stdout and Rust-to-TypeScript IPC results are untrusted runtime values. Consumers
  must validate the operation-specific closed top-level and nested shapes before reading any field.
- Unknown fields, missing fields, wrong types, invalid enums, unsafe codes, incoherent status/error
  combinations, multiple terminal lines, and operation-family mismatches fail with the fixed
  `WORKER_PROTOCOL_VIOLATION` code.
- Protocol failures must never echo or stringify rejected stdout/IPC payloads in public errors,
  technical details, diagnostics, or logs. This includes task paths, artifact paths, source URLs,
  transcript text, prompts, generated content, credentials, and raw exception text.
- Unknown error codes may cross the boundary only when they match the bounded safe-code grammar;
  they continue to use generic localized UI guidance. This forward-safe behavior does not permit
  unknown object fields or arbitrary error values.
- Model-download terminal results must not contain `model_dir`; raw HTTP, archive, filesystem, or
  downloader exceptions are converted to fixed safe code/message pairs before serialization.
- The shared contract and cross-language negative tests are release gates. Python producer checks do
  not replace independent Rust and TypeScript consumer validation.

## 2026-07-19 Worker Atomic Artifact Commit Boundary

- Official task video, audio, manifest, and preference-snapshot paths must never be used as scratch
  outputs. Copies, FFmpeg output, and JSON text are staged beside the destination and installed only
  through a same-directory atomic replacement after required validation succeeds.
- Media staging names must be unique, retain a tool-compatible final suffix, stay inside the owning
  task directory, and remain outside the manifest artifact allowlist. Cleanup is best effort, but a
  leftover staging file is never authoritative and must not be returned to UI or History.
- A failed write, sync, probe, decode, or replace preserves any previous official file. Raw operating
  system, source URL, ffprobe, FFmpeg, staging-path, and destination-path text must not cross the
  structured worker error boundary.
- `frameq-task.json` is installed atomically after its complete payload is serialized. It may record
  only committed ordinary files at known task-owned paths; existence of an arbitrary or partial file
  is insufficient evidence for registration.
- Per-file atomicity does not promise a cross-file transaction. A failure may retain a previously
  committed valid artifact, matching existing partial-task preservation, while never claiming a
  partial artifact succeeded.

## 2026-07-18 Process-video request contract v3 boundary

- React may send only the raw submitted URL in the strict `process_video` IPC request. It must not
  send model settings, locale, output-format choices, worker modes, credentials, or derived source
  identity.
- Rust resolves the configured ASR model once and sends a bounded worker-stdin request containing
  exactly contract version, URL, and allowlisted `asr_model`. The same resolved model is used for
  cache matching and worker execution.
- Python rejects missing, legacy, additional, wrong-version, empty-URL, and unsupported-model fields
  before source resolution or task mutation. Fixed invalid-request errors must not echo payloads,
  URLs, userinfo, query values, fragments, settings paths, environment values, or parser details.
- The process path has no model compatibility fallback and Python must not override the explicit
  worker model from `FRAMEQ_ASR_MODEL`. Desktop and bundled worker remain an atomic release unit.
- Shared schema and cross-language tests are security gates: adding a field requires a closed type,
  explicit owner and consumer, safe failure policy, and non-echoing negative tests.

## 2026-07-16 Local Media Path and Artifact Boundary

- The complete local source path is sensitive. It may exist only in the Rust selection store, the
  bounded one-shot worker stdin pipe, and worker memory while opening the source. It is forbidden in
  React/JavaScript, IPC responses, argv, environment variables, manifests, task IDs, artifact names,
  History, progress, errors, technical details, logs, transcript exports, prompts, and cloud traffic.
- The native picker is not an authorization by path string. Rust returns a random opaque UUID token
  and keeps one non-persisted matching selection. Processing rejects stale/fabricated tokens and
  revalidates absolute ordinary-file status, allowlisted extension, nonzero size, no symlink,
  junction, or reparse point, plus unchanged size and modification time before worker launch.
- A safe display name is basename-only, strips separators, control characters, and Unicode
  bidi/directional formatting controls, is bounded to 160 characters while preserving extension, and
  falls back when empty. It may be displayed/persisted locally for History but is forbidden from
  diagnostics and AI prompts. Tokens are never persisted or logged.
- Contract v4 local requests are closed and non-echoing. Rust and Python reject missing, additional,
  invalid, mismatched-kind, changed, linked, malformed, or missing-stream sources through fixed codes.
  Raw ffprobe/FFmpeg commands, stdout/stderr, payloads, and operating-system errors must pass the
  existing sanitizer and cannot be returned as primary or technical UI text if they expose a path.
- File-dialog filters and extensions are not trusted content validation. The worker probes stream
  structure and requires video+audio for a video source or audio for an audio source. Cover art does
  not grant video classification. No shell interpolation is permitted for copy, probe, or conversion.
- Video and WAV outputs use generic task-root-derived names and partial/temporary writes. Only
  validated final artifacts enter the manifest. Path resolution, link/reparse checks, deletion,
  playback, and file-location commands retain the existing strict task-root boundary.
- A local manifest is accepted only when exactly one safe source variant holds. URL requires the
  existing canonical SourceIdentity predicate; local requires empty URL/null identity and closed safe
  metadata. Unrecognized variants remain product-isolated and physically untouched.
- Media never goes to FrameQ server or the LLM provider. Existing confirmed AI may read the saved
  transcript but receives no local filename, path, selection token, media bytes, or manifest. Logs may
  record only safe aggregate kind/extension/size-or-duration buckets, stage, elapsed time, and code.

## 2026-07-15 Localization and AI Output-Language Boundary

- `ui-preferences.json` must remain app-local and contain only schema version plus the closed language
  preference enum. It must not contain account/session data, source URLs, output/model paths,
  inspiration preferences, transcripts, prompts, or generated content, and it must never be sent to
  FrameQ server.
- All locale resources must be bundled. UI locale selection and switching must make no
  translation-resource network request or introduce a remote translation or telemetry provider.
- Worker/model progress producers must accept only contract-registered codes and closed per-key
  argument schemas. Public model IDs must be enumerated; language must be a 2-35 character safe tag;
  attempt/total must be integers from 1 through 100; unknown args must be rejected. `current_file`
  must be 1-255 characters, reject separators/control characters/`.`/`..`, be required only by the
  two model-file codes, and be forbidden otherwise. Consumers must drop an invalid event and record
  only its safe code; they must not render worker prose as fallback.
- URL, full path, Cookie, credential, request headers, prompt, transcript, preference prose, and
  generated content must remain forbidden in events and diagnostics; the shared registry names these
  as `url`, `full_path`, `cookie`, `credential`, `transcript_content`, `prompt`, `generated_content`,
  `request_headers`, and `preference_prose`.
- `output_language` must be one of three enum values in a closed request whose target is
  `summary | insights`; only `insights` may carry the optional object preference snapshot. The worker
  must map the enum to fixed internal prompt instructions; arbitrary UI strings must never be used.
  Missing, invalid, target-incompatible, or additional fields must fail with a fixed non-echoing error.
- Diagnostic logs may record target, validated output locale, stable message/error code, and safe
  aggregate values only. They must not record the LLM prompt, transcript snippets, generated body,
  full preference snapshot, or raw request payload.
- Raw worker/provider errors require the existing sanitization boundary before they can appear in an
  optional technical-details disclosure. Unknown progress natural language is discarded rather than
  displayed or logged as a fallback.
- AI language compliance must add no detection, translation, or retry call. The LLM supplier must
  receive no new user content beyond the already confirmed target data; AI Credits and server
  checkout must stay on the existing per-call boundary.

## 2026-07-12 Open-Source macOS Release Boundary

- FrameQ v0.2.16 may use ad-hoc-signed, non-notarized macOS DMGs only for the explicitly approved
  personal-development, small-user, and open-source distribution model. The release page must
  disclose the one-time Gatekeeper approval before presenting feature highlights.
- Ad-hoc signing is an integrity seal, not Apple identity verification. Release notes and UI/docs
  must not claim Developer ID signing, notarization, App Store review, or silent enterprise
  deployment support.
- The macOS build must verify the final `.app` with `codesign --verify --deep --strict` before DMG
  upload. Runtime import smoke must not mutate the signed bundle with `.pyc` or `__pycache__` files.
- Release artifacts must not contain Apple signing/notarization credentials, Tauri updater private
  keys, `.env` files, LLM keys, payment credentials, ASR model weights, user configuration, logs,
  history tasks, transcripts, or other user artifacts.
- Apple Developer ID signing plus notarization and stapling remain required before removing the
  Gatekeeper disclosure or expanding to a no-manual-step consumer/commercial distribution.

## 2026-07-11 Workspace Data-Flow Disclosure

- The local and AI workspaces are two UI projections of one task, not two storage or network
  pipelines. Video, audio, raw source URL, complete transcript, task manifest, and local
  preferences remain on the desktop and must not be sent to FrameQ server.
- The local workspace may read local media/transcript artifacts only through existing
  validated task-root Tauri commands. Extracting `TranscriptReviewPanel` must not duplicate
  path resolution, relax link/reparse checks, or bypass expected-task save guards.
- The AI workspace may initiate cloud generation only after target-specific confirmation.
  The worker rereads the saved official `transcript/transcript.txt` and sends only allowed
  transcript chunks to the checked-out LLM supplier. Video and audio are never uploaded.
- Preference snapshots are allowed only for the confirmed inspiration target. Summary and
  its attached Mermaid generation must always receive no preference snapshot.
- While AI uses the saved transcript, the editor and save action are disabled to prevent UI
  ambiguity about which version was sent. Playback, scrolling, and local file location do
  not alter the prompt input and remain available.
- Target status, errors, logs, browser fixtures, screenshots, and accessibility labels must
  not include raw source URLs, credentials, complete prompt text, or complete transcript
  content.
- Local processing and AI generation are separate command capabilities, not a boolean mode.
  `process_video` must not define, parse, normalize, or forward a `generate_insights` field and
  must never construct an LLM client. Explicit use of the retired field is rejected with fixed
  `INVALID_REQUEST_PAYLOAD` semantics without echoing the request or source URL.
- Only confirmed `retry_insights` may receive checkout material, construct an AI client, write AI
  artifacts, or consume quota. A direct worker invocation cannot recover the retired automatic-AI
  branch through a compatibility parser or environment setting.

## 2026-07-12 Permanent History Deletion Boundary

- Product deletion accepts only a strict task ID for a currently supported History vNext task.
  IPC must reject frontend-supplied task/output/cache paths, URLs, manifests, commands, or unknown
  fields.
- Rust must derive and canonicalize the configured roots, prove the target is exactly
  `<output>/tasks/<task-id>`, and reject root or descendant symlink, junction, and reparse-point
  storage before mutation. It must never delete the output root, tasks root, another task, models,
  settings, auth state, diagnostics, update state, or global cache.
- Unsupported legacy, malformed, quarantined, missing-marker, or invalid-identity directories
  remain physically untouched and unavailable to the delete UI.
- Playback cache deletion is limited to `.frameq-audio-review/<task-id>` and precedes authoritative
  task deletion. Cache failure aborts before task mutation; primary recursive deletion failure may
  partially complete and cannot be rolled back.
- Deletion diagnostics expose only fixed outcome/error codes and elapsed time. They must not
  include task IDs, discovered filenames, local paths, canonical/source URLs, manifest content, or
  raw operating-system errors.
- The frontend disables deletion during local processing, AI generation, cancellation, transcript
  save, or another deletion; Rust independently rejects an active video/AI supervisor lane.

## 2026-07-11 Unsupported Legacy Task Isolation Boundary

- Only a schema v3 manifest with the current source-privacy marker, a present and
  allowlisted canonical SourceIdentity matching `source_url`, and no quarantine flag may
  enter history, cache reuse, transcript load/save, detail, or AI retry.
- Schema v1/v2, missing-marker, quarantined, malformed, invalid-identity, symlink,
  junction, and reparse-point tasks are unsupported legacy data. Product code fails closed
  before artifact reads and must not return their task id, directory name, source URL,
  error detail, preview, or artifact content to UI, logs, or diagnostics.
- Unsupported directories remain physically untouched. FrameQ does not start a migration
  worker, rewrite manifests/artifacts, add markers, rename directories, backfill indexes,
  quarantine data, or delete files. Users may back up or delete those directories manually
  outside the product.
- History list diagnostics may contain only the fixed stage name, aggregate supported and
  ignored counts, and elapsed milliseconds. They must not identify ignored entries. History
  list and repeated opens are Rust-only and must never create a Python process.
- `get_history_detail(taskId)` reads only the latest explicitly selected supported task,
  after strict task-id and no-link validation. Stale responses are discarded before they
  reach the workflow controller.

## 2026-07-10 Desktop Task-Identity Isolation Boundary

- Desktop workflow state is task-scoped user data. A history selection must not replace task identity while a worker, AI retry, or cancellation operation is active, because late callbacks could otherwise expose one task's transcript, artifacts, summary, or insights in another task's UI.
- The workflow controller owns operation invalidation and complete history restoration. App, history loading, and detail features must use narrow semantic actions rather than a generic workflow-state setter.
- Task-local transcript saves must include the expected task ID and are ignored if the visible task changed before the save returns. Resetting for a permitted history restore closes detail/preference transient UI, preventing task-local controls from continuing to act on a prior task.

## 2026-07-10 Desktop Process-Tree Cancellation Boundary

- Only `worker_runtime::supervisor` may signal a PID/PGID, and only one recorded by the private `ProcessSupervisor` for the current in-process worker or model-download instance. Application modules receive semantic typed-job execution, cancellation, activity, and model-download methods; the lanes themselves and all supervisor mutation/OS termination functions remain private.
- `WorkerLane::run` is the sole owner of FrameQ worker spawn, register-before-stdin, pipe ownership, reader startup, wait/reap, finish-before-reader-join, terminal classification, and lifecycle diagnostics. It must not accept a PID, PGID, executable, command, environment key, or shell fragment from IPC, UI, worker output, task data, or a log entry.
- `VideoWorkerFacade::execute(WorkerJob)` is the only application-facing video-lane execution entry.
  It must derive the fixed invocation, lifecycle operation, progress route, lane, and credential
  policy exhaustively. Only `RetryInsights` may resolve server-managed LLM invocation material;
  process-video and source-identity jobs cannot receive it through their API.
- Windows cancellation uses the fixed `taskkill /T /F` argument vector. Unix cancellation uses a fixed `kill` argument vector directed at the worker-created process group, first `TERM` and then bounded-grace `KILL` only if the group remains. No shell interpolation is permitted.
- A delivered termination signal is not proof of a final cancelled state. State rollback after a signal error and terminal cleanup after child observation must match the same instance ID, so stale cancellation/exit handling cannot hide a real result or interfere with a newer process.
- A valid structured worker result wins a concurrent cancellation claim. Without a structured result, only the matching `Cancelling` terminal phase becomes cancelled; malformed success is a protocol violation and malformed failure remains a typed unstructured failure.
- Cancellation must preserve existing task artifacts, cache, and model files. Lifecycle logs use fixed operation/status markers and must not include raw worker arguments, stdin, environment values, full executable/current-directory paths, source/local-media paths, URLs, credentials, descendant command lines, stderr bodies, transcripts, prompts, preferences, generated content, or arbitrary termination diagnostics.
- Worker and ASR model progress may cross Tauri only through the closed runtime routes and their existing contract validators. Typed job/model-download execution derives the route; application modules cannot supply or select an arbitrary parser, event name, route, or unvalidated progress payload.
- The Unix parent-plus-child fixture is conditional on a Unix host. Windows command/state coverage does not prove macOS signal delivery, so the supported macOS release requires native-host validation. Linux is not a supported release platform and is not a release gate.

## 2026-07-10 Entitlement Transaction Integrity Boundary

- A payment webhook, activation-code redemption, and administrator entitlement adjustment are security-sensitive state transitions. Their related data changes must commit or roll back together; partial-write compensation is not an acceptable consistency mechanism.
- Store-level semantic operations must validate current state and make all related writes in one transaction. Prisma transaction callbacks must remain inside PrismaStore; routes and services must not compose a persistence transaction from generic read/write calls.
- Webhook replays are safe only when provider event, order binding, and transaction identity agree. Conflicts must return a structured public error without overwriting the recorded transaction; unique-event handling must inspect Prisma known error codes, never fragile exception text.
- Administrator compensation audit records are required evidence, not best-effort telemetry. A failure to write the append-only audit record rolls back the entitlement mutation. Logs may identify record IDs and users but must not include payment payloads, activation-code plaintext, session tokens, or free-form support notes.
- All administrator quota grants are additive, require an audit reason, preserve `llmQuotaUsed`, and use the same entitlement-adjustment transaction. Direct remaining-quota edits, reductions, and resets are not supported without a separately approved audited operation.
- Historical automatic recovery is limited to a verified, deterministic payment replay. Ambiguous redeemed-code and missing-audit states require an administrator `manual_repair` adjustment so the repair itself is append-only and auditable.
- WeChat Pay routes are disabled by default and must not be represented as production payment support. Local billing tests exercise only internal state transitions; they do not use provider credentials, call the provider, validate a live callback, or establish end-to-end payment readiness.

## 2026-07-10 Source URL Secret Boundary

- A submitted source URL is credential-bearing input even when it points to public content. `xsec_token`, access/session/auth tokens, signatures, expiries, cookies encoded in queries, URL userinfo, and fragments must be treated as secrets or volatile request material.
- `SourceRequest.download_url` is transient request material for frontend-to-Tauri IPC, the one-shot worker stdin pipe, and the downloader/fallback argument. A cache-only worker preflight may also receive the raw submission through stdin but may return only validated `SourceIdentity`. Neither request object has a persistence/result serialization path; the raw URL must not enter worker argv, worker environment variables, `frameq-task.json`, transcript files, results, progress events, history, desktop logs, UI errors, cloud prompts, or server requests.
- Production worker argv contains fixed mode flags only. Payload-bearing child stdin is piped, capped at 1 MiB, written once, and closed before waiting; fixed no-payload commands use null stdin. Empty, oversized, malformed, unreadable, or undeliverable input fails with fixed messages that do not include parser text or payload fragments.
- Request transport never uses a shell and does not accept a command, executable, PID, or environment key from the request payload. `WorkerLane::run` registers payload-bearing production workers before stdin delivery, so Windows tree termination and Unix process-group TERM-to-KILL escalation remain available even while a pipe write is blocked. Delivery failure or cancellation terminates and reaps the matching child and must not create a fallback argv/environment path.
- `canonical_url` is reconstructed from an allowlisted platform identifier and is the only source URL allowed beyond the current download boundary. Canonicalization must drop userinfo, fragments, and every query field except Bilibili's non-default part selector.
- Downloader stderr and fallback exceptions are untrusted because tools may echo the original URL. Only structured error codes and source-identity-sanitized public messages may cross into results or diagnostics.
- Cloud AI receives only the saved task-root `transcript/transcript.txt` text selected by the user action after exact-path and link/reparse-point validation. Transcript Markdown metadata, alternate same-named text files, source URLs, manifest contents, local paths, and downloader diagnostics are forbidden prompt inputs.
- Unsupported legacy task data is never migrated or inspected beyond the minimum manifest
  eligibility check. Physical legacy files, exported copies, backups, and old logs remain
  outside automatic product mutation and require user-managed backup or deletion.

## 2026-07-06 Insight Preference Privacy Boundary

- `我的灵感档案` and per-run generation preferences are local desktop data by default and must not be uploaded to FrameQ server.
- The inspiration profile should be stored under app-local data as a constrained JSON file, not in app-local `.env`, because it is product data rather than runtime configuration.
- A skipped inspiration profile may be represented locally by a marker such as `profileSkipped: true`, but skipped means `no profile / unspecified`; the app must not synthesize, log, upload, or send a default persona in its place.
- Each AI generation confirmation must state that transcript snippets will be sent to the administrator-configured cloud LLM supplier for that output, while the selected preference snapshot is sent only with the `启发灵感` generation request and must not be sent with `要点总结` or Mermaid mindmap requests.
- Logs, diagnostics, UI errors, server requests, and quota checkout metadata must not include full inspiration profiles, full generation preferences, complete prompts, transcripts, or generated insight content.
- The account service must not add API fields for storing profiles, generation preferences, transcripts, insight topics, or local task manifest contents.
- Users must be able to clear the local inspiration profile. Clearing it affects future generation only and must not delete existing local task artifacts.

## 2026-07-05 Desktop Diagnostics Log Boundary

- Desktop diagnostics are written only to app-local data `logs/frameq-desktop.log`.
- Worker lifecycle logs may include only fixed operation kind, supervisor-owned PID, safe process exit/status markers, structured status/error/stage fields, and closed safe summaries. They must not include raw command vectors, stdin, environment values, full executable/current-directory paths, source/local-media paths, URL material, raw stderr, transcripts, prompts, preferences, or generated bodies.
- Non-lifecycle desktop logs may include task id, structured error code, validated target/locale, cache outcomes, and sanitized short error text. Any local path diagnostic must be explicitly justified and constrained; lifecycle code must not log full resource or app-local paths.
- Logs must not include LLM API keys, desktop session tokens, cookies, sensitive request headers, complete volatile YouTube media/CDN URLs, or Google/YouTube login material.
- YouTube JavaScript runtime support must not introduce browser cookie import, account login automation, CAPTCHA solving, proxy bypass, remote component fetching, or private-content scraping.
- Diagnostic logs are not uploaded to FrameQ server and are not exposed through normal result artifact actions.
- Deno is bundled only as a local `yt-dlp` JavaScript runtime. It must not be used for browser cookie import, account login automation, CAPTCHA solving, proxy bypass, remote app-code loading, or private-content scraping.

## 2026-07-18 Task Access Facade Enforcement

- Raw Rust `TaskManifest` parsing, support-predicate checks, artifact-key lookup, relative-path
  validation, canonical containment checks, and manifest writes remain private to
  `task_manifest.rs`. History, cache, transcript, and deletion code must enter through
  `SupportedTask::scan/open` and must not reconstruct those checks locally.
- `SupportedTask` means the current storage and source-privacy predicate already passed. A scan
  isolates and counts an invalid individual entry without returning its identity or content;
  inability to enumerate the configured task root remains an operation failure.
- Artifact access uses the closed `TaskArtifact` enum. Transcript mutation uses `TaskEditSession`;
  deletion and playback may receive only the validated task-local path capability required for
  their filesystem operation. No facade method may turn task access into an arbitrary path browser.
- Python pipeline and retry persistence must use `TaskStoreFacade`. `OpenedTask` may expose a
  validated `TaskContext` and normalized transcript metadata, but not the raw manifest payload.
- Adding the future local-file source variant must change the central support predicate and its
  contract tests. It must not reintroduce caller-specific URL/local manifest acceptance rules.

## 2026-07-19 Media Preparation Facade Enforcement

- `run_worker_pipeline` must not reconstruct download, downloaded-file selection, ffprobe, video
  copy, audio extraction/reuse, or subtitle-discovery flows. Those operations enter through
  `MediaPreparationFacade` and return only `PreparedMedia` or a typed sanitized failure.
- `MediaPreparationFacade` may receive a validated `TaskContext` for bounded task-owned paths, but
  it must not import `TaskStoreFacade`, finalize a result, write a task manifest, invoke ASR, or enter
  InsightFlow/AI.
- The current facade accepts only `UrlMediaSource`. Future local variants must land together with
  contract v4 and its real CLI consumer, and must keep the complete local path out of argv, progress,
  results, errors, logs, manifests, transcripts, prompts, and UI state.
- A local audio result must expose no video path; local video/audio results expose no subtitle
  candidate. Partial media remains unregistered until the task persistence boundary validates the
  final artifact.

## 2026-07-05 Task Artifact Path Boundary

- Task-manifest artifact-path fields may contain local paths only as relative paths under the owning task directory. Absolute paths, `..`, path traversal, remote URLs, cookies, headers, or credentials must be rejected; the allowlisted `source_identity.canonical_url` is source metadata, not an artifact path.
- Tauri task commands must resolve `task_id` to a manifest under the configured output root and must verify every resolved artifact path remains inside that task directory.
- Repeated URL task reuse may read only local manifests and manifest-relative artifacts under the configured output root. It must not trust failed tasks, missing artifacts, traversal paths, remote URLs, cookies, headers, or credentials.
- Transcript review and save commands should receive `task_id`, not arbitrary transcript/audio paths. The audio player and text editor may access only manifest-declared artifacts for that task.
- App-local `cache/tasks/<task_id>/` may store temporary or diagnostic files, but the UI should not expose it as a browseable artifact folder.
- Legacy flat output files, old app-local history records, and non-current task manifests
  are not trusted task authorities and have no compatibility reader.

## 2026-07-05 Platform Subtitle Safety Boundary

- Subtitle-first reuse may request only public subtitle files exposed through the same no-login `yt-dlp` flow used for public YouTube and Bilibili video downloads.
- Subtitle support must not add `--cookies`, `--cookies-from-browser`, browser cookie stores, account login automation, QR login, CAPTCHA solving, proxies for access-control bypass, private-content scraping, or member/age/private bypass.
- Raw `.vtt` and `.srt` files belong to `cache/tasks/<task_id>/download/` and must not be exposed as normal result artifacts or written into manifest artifact paths.
- `frameq-task.json` may record transcript source metadata and text preview, but must not store complete raw subtitle files, cookies, credential-bearing headers, or volatile media CDN URLs.
- Subtitle parse failures, missing files, unsupported formats, and unusable text must degrade to local ASR rather than surfacing platform bypass instructions or asking users for cookies/login material.

## 2026-07-03 Transcript Audio Review Local File Boundary

- Transcript review may read only the transcript path and audio path associated with the current task or a local history record. It must not become an arbitrary file browser, text editor, or media player.
- Tauri transcript commands must validate path shape, file extension, existence, and relationship to known transcript/audio artifacts before returning a playable path or writing edits.
- `transcript_detail.rs` remains the sole Tauri/runtime-root boundary. Its private `audio_playback`, `segments`, and `edit_storage` children may receive only `SupportedTask` / `TaskEditSession` capabilities and fixed internal roots; they must not parse raw manifests, accept frontend paths, resolve app runtime directories, add network access, or log transcript/path content.
- Audio-cache replacement and canonical containment stay in `audio_playback`; tolerant optional-sidecar reads and strict edited-sidecar writes stay in `segments`; linked-target checks, official-path enforcement, one-time backups, ordered transcript writes, preview updates, and manifest save stay in `edit_storage`.
- `load_transcript_detail` may return transcript text, optional segment metadata, backup status, and a validated local audio path. It must not return cookies, request headers, remote media CDN URLs, LLM keys, or private signing material.
- `save_transcript_edit` may write the official transcript `.txt`, matching `.md`, optional segment sidecar, and local history preview. The first save should create an original backup once and must not overwrite that backup later.
- Empty transcript saves, path traversal, non-transcript files, and unrelated local paths must fail recoverably.
- Segment metadata is local-only review data. It must not be sent to FrameQ server unless a future product spec explicitly adds a server workflow.
- The audio player should use Tauri-validated local paths only. Missing audio must degrade to text editing without attempting remote downloads or network lookups.
- For custom output roots, Tauri may create a playback copy under app-local `cache/.frameq-audio-review/<task_id>/` only after validating the original manifest-declared audio artifact. This cache is not an authority and must be rebuildable from the original task artifact.
- Manual playback-cache cleanup must not accept arbitrary paths. It must canonicalize the target, delete only app-local `cache/.frameq-audio-review`, and never delete `<FRAMEQ_OUTPUT_DIR>/tasks/<task_id>/` artifacts, app-local `cache/tasks/`, `models/`, `auth/`, `.env`, logs, or update preferences.
- Playback-cache size reporting is local UI state only. It must not upload audio paths, source paths, transcripts, or cache metadata to FrameQ server.
- The Tauri asset protocol may be enabled only for reviewed audio artifacts under app-local `outputs/tasks/<task_id>/` or Tauri-controlled playback copies under app-local `cache/.frameq-audio-review/<task_id>/`; it must not expose `auth/`, `models/`, `.env`, update preferences, task scratch files under `cache/tasks/`, or arbitrary user directories.

## 2026-06-29 YouTube Public Video Safety Boundary

- YouTube v1 may request only user-submitted public ordinary video or Shorts links through `yt-dlp`, and only to create one local media file for transcription.
- FrameQ must not read browser cookies, persist cookies, request cookie files, use `--cookies`, use `--cookies-from-browser`, store Google/YouTube login material, automate login, solve CAPTCHA, bypass age/member/private restrictions, use proxies for access control bypass, or process playlists as a batch.
- `watch?v=...&list=...` may be accepted only as a single-video request with `--no-playlist`; playlist/channel/handle/music/live/login-gated inputs must fail recoverably.
- YouTube/Google volatile media CDN URLs, signed query strings, cookies, Authorization headers, and login or bypass instructions must not be stored in app-local history, UI errors, logs, settings, or FrameQ server requests.
- Worker error sanitization should remove `googlevideo.com`/`videoplayback` signed URLs and cookie guidance before messages reach the UI.
- Existing completed local media files must be preserved if a new YouTube download attempt fails.

## 2026-06-27 Bilibili Public Video Fallback Safety Boundary

- Bilibili fallback may request only user-submitted public or user-authorized ordinary video links, safe `b23.tv` redirects, public video metadata APIs, public playurl APIs, and public DASH media URLs needed to create one local MP4 for transcription.
- The fallback must not read browser cookies, persist cookies, collect or store `SESSDATA`, automate login, show QR login, solve CAPTCHA, scrape private videos, bypass member-only access, decrypt DRM, rotate user agents, use proxy pools, or spoof browser fingerprints.
- PGC/bangumi/movie links, VIP/member-only streams, login-required streams, private/unavailable videos, CAPTCHA/risk-control pages, malformed API responses, DRM-protected streams, and no-playable-stream cases must return structured recoverable errors rather than attempting to bypass platform controls.
- Fixed compatibility headers such as `User-Agent`, `Referer`, `Origin`, and `Accept-Language` are allowed for public Bilibili API/media requests. Credential-bearing headers and cookies are not allowed.
- The stable root adapter is the only production entry point outside the private `bilibili/` package. `transport.py` owns urllib, bounded response decoding, Range restart, and safe streaming; `artifacts.py` owns candidate attempts and FFmpeg execution. AST gates reject child-to-root/application/ASR/AI back-edges and direct production imports of private modules.
- Compressed response input and decoded gzip/Brotli/deflate output are both checked against the fixed response limit before JSON interpretation. Oversized decoded output fails with `BILIBILI_VIDEO_INFO_UNAVAILABLE` without including the response URL, encoding header, body, or decoder exception text. This post-decode rejection is not a strict compression-library peak-memory guarantee.
- Streaming/resumable video and audio download helpers must enforce max-size and no-progress limits, keep partial files scoped to destination `.part`/temporary `.m4s` files, and preserve any existing completed media file if the new download or FFmpeg merge fails.
- Full volatile Bilibili CDN URLs, cookies, `SESSDATA`, sensitive request headers, authorization material, and DRM key material must not be stored in local history, UI errors, logs, app-local settings, or FrameQ server requests. Logs may keep short causes, hostnames, Bilibili IDs, part index, quality labels, byte sizes, and local output paths.

## 2026-06-27 Xiaohongshu Public Video Fallback Safety Boundary

- Xiaohongshu fallback may request only user-submitted public or user-authorized share links, short links, full note URLs, and their public media URLs.
- The fallback must not read browser cookies, persist cookies, upload cookies, automate login, solve CAPTCHA, scrape private notes, rotate user agents, use proxy pools, or spoof browser fingerprints.
- Process-local anonymous cookies naturally issued by a public Xiaohongshu page may exist for one worker invocation only and must not be written to app-local settings, history, logs, UI errors, or FrameQ server requests.
- The stable root adapter is the only production entry point outside the private `xiaohongshu/` package. `source.py` owns allowlisted host/path and bounded short-link policy; `page.py` owns status/decompression/state interpretation; `streams.py` is deterministic and side-effect-free; `transport.py` alone owns CookieJar, raw urllib, Range restart, and safe writes. AST gates reject child-to-root/application/ASR/AI back-edges and direct production imports of private modules.
- Brotli/gzip/deflate decoding keeps the existing post-decompression size cap and fixed non-echoing failures. Compression libraries may allocate expanded output before that rejection, so this boundary does not claim a strict peak-memory guarantee.
- Streaming/resumable video download helpers must enforce max-size and no-progress limits, keep partial files scoped to the destination `.part`, and preserve any existing completed media file if the new download fails.
- Full volatile media CDN URLs, cookies, sensitive request headers, `xsec_token`, and authorization material must not be stored in manifests, History, progress, diagnostics, AI prompts, FrameQ server requests, or UI error text. Logs may keep short fixed causes, hostnames, quality labels, byte sizes, and local output paths.
- Image-only notes, unavailable notes, login-gated notes, CAPTCHA-gated notes, private notes, rate-limited pages, malformed page state, oversized videos, stalled downloads, and no-playable-stream cases must return structured recoverable errors rather than attempting to bypass platform controls.

## 2026-06-27 Admin Entitlement Adjustment Boundary

- Manual entitlement and quota adjustments are restricted to the configured Admin Web account and must reuse HttpOnly admin session cookies plus `x-frameq-csrf` validation.
- Every successful adjustment must be auditable with administrator email, target user, reason, before/after values, and timestamp. Corrections should create another audit record instead of rewriting the original event.
- Adjustment notes are operational metadata only. They must not include LLM API keys, cookies, transcripts, private video URLs, local file paths, activation-code plaintext beyond the creation response, or sensitive support chat contents.
- Server logs should identify adjustment IDs and target users, but should avoid logging free-form notes in full.
- Manual compensation must never require users to upload videos, audio, transcripts, histories, local model caches, cookies, or desktop configuration files.

## 2026-06-26 Public Link Fallback Safety Boundary

- EasyDownload-derived work may improve FrameQ's handling of public or user-authorized share links, but it must not introduce browser cookie import, persistent cookie storage, account login automation, QR login, CAPTCHA solving, private-content scraping, proxy pools, user-agent rotation, or browser fingerprint spoofing.
- FrameQ must not migrate EasyDownload's WeChat MITM, certificate authority installation, system proxy changes, or administrator-elevation behavior.
- Worker fallbacks may use fixed compatibility headers and process-local anonymous cookies naturally issued by a public share page for one invocation only. Those cookies must not be read from browser stores, written to disk, sent to FrameQ server, or stored in history/logs.
- Bilibili ordinary public-video DASH assembly is allowed only when it can run without login or cookies and produces one local MP4 for transcription. Bilibili login, QR login, SESSDATA handling, PGC/bangumi, member-only behavior, DRM, and downloader-oriented workflows remain out of scope.
- Safe download helpers must avoid logging cookies, sensitive headers, authorization material, submitted/download URLs, or full volatile media CDN URLs. Logs may keep platform names, hostnames, short sanitized error causes, quality labels, byte sizes, task ids, and local output paths; history may keep only canonical source identities.
- When a link is unavailable, login-gated, CAPTCHA-gated, private, image-only, or has no playable video stream, the worker must return structured recoverable errors rather than attempting to bypass access controls.

## 2026-06-25 Douyin Share Page Fallback Boundary

- The Douyin fallback may request public `iesdouyin.com` share pages and public media CDN URLs for user-submitted public or user-authorized links.
- The fallback must not require, collect, persist, or upload browser cookies. Exported cookie files are not part of the supported product path for this fallback.
- The fallback may use a fixed mobile Safari user agent and minimal public-page headers for compatibility with public share pages. It must not use user-agent rotation, proxy pools, browser fingerprint spoofing, CAPTCHA solving, login automation, or account-authenticated scraping.
- A process-local cookie jar may accept anonymous cookies naturally set by the public share page, such as `ttwid`, but those cookies must be discarded after the worker invocation and must not be written to history, logs, app-local settings, or server requests.
- The stable root adapter is the only production entry point outside the private `douyin/` package.
  `source.py` owns allowlisted ID/host/short-link policy; `page.py` owns in-memory Router Data
  interpretation; `streams.py` owns deterministic bit-rate and bounded ratio-probe policy;
  `transport.py` alone owns CookieJar, raw urllib, Range removal, and atomic candidate writes. AST
  gates reject child-to-root/application/ASR/AI back-edges and direct production imports of private
  modules.
- Candidate request or safe-write failure may advance to the next ordered stream, but arbitrary
  filesystem exceptions still propagate. The shared atomic writer keeps `.part` scoped beside the
  destination and preserves an existing completed MP4 until a valid replacement succeeds.
- The fallback must not attempt to solve CAPTCHA, defeat login gates, bypass private content restrictions, or automate account-authenticated scraping.
- Worker logs, history records, and UI errors must not store submitted/download URLs, cookies, sensitive request headers, or full media CDN URLs when those URLs contain volatile request tokens. Logs may keep canonical platform identifiers, short sanitized error summaries, hostnames, stream quality labels, byte sizes, task ids, and local output paths.
- Downloaded video, extracted audio, transcripts, summaries, mindmaps, and topic outputs remain local artifacts under the configured output/cache directories; no fallback media data is sent to the FrameQ server.
- The packaged worker must be generated from canonical source and compared recursively by file set
  and bytes; the private package must never be maintained through hand-edited resource copies.

## 2026-06-23 Desktop Update Boundary

- Desktop updates must use Tauri updater signature verification before installation.
- The updater public key may be bundled in `tauri.conf.json`; the private signing key and signing password must never be committed, bundled, or stored on FrameQ server runtime hosts unless that host is the intended signing environment.
- The public update endpoint returns only release metadata and artifact URLs; it must not require desktop authentication and must not return user data, account data, LLM keys, or ASR model credentials.
- `updates.json` may store `lastCheckedAt`, `postponedUntil`, and `skippedVersion` only. It must not store downloaded installers, signatures, private keys, session tokens, video URLs, transcripts, or model cache paths beyond generic update preferences.
- Updating the app must preserve app-local `models/`, `outputs/`, `cache/`, `auth/`, `.env`, and `updates.json`.
- Waiving mainland China live updater testing does not relax the signature-verification requirement. It only means the GitHub Releases network path is not a v1 release blocker; unsigned or malformed updater artifacts must still be rejected by configuration and release checks.

## 2026-06-23 LLM Secret Boundary

- Desktop clients must not read repository-root `.env` files for LLM configuration.
- Local dotenv files must not be treated as a supported place for `FRAMEQ_LLM_PROVIDER`, `FRAMEQ_LLM_BASE_URL`, `FRAMEQ_LLM_API_KEY`, `FRAMEQ_LLM_MODEL`, or `FRAMEQ_LLM_TIMEOUT_SECONDS`.
- Tauri worker subprocesses remove legacy local LLM environment variables before launch.
- Server-managed checkout environment variables remain allowed only for the insight-generation invocation.
- App-local data `.env` remains limited to non-LLM local settings such as output directory, ASR model, and model download overrides.

## 2026-06-23 ASR Model Cache Cleanup Boundary

- Automatic ASR cache cleanup may only touch FrameQ's known SenseVoice Small and VAD model cache directories plus stale `._____temp` directories without `model.pt`.
- Unknown model directories or user-created files under app-local `models/` must be preserved.
- Cleanup failures must not delete broader app-local data, block transcription, or hide the original ASR model availability state.

## Account and Billing Service

- The account service stores only email accounts, OTP metadata, session token hashes, activation-code hashes/prefixes, entitlements, admin sessions, LLM config metadata, and quota events.
- Desktop session tokens are opaque random values. The server stores SHA-256 hashes only; the desktop client stores the raw token in app-local data under `auth/session.json`.
- Email OTP codes expire after 10 minutes, allow at most 5 attempts, and must be rate-limited by email and IP.
- Login deep-link tickets expire after 5 minutes, are single-use, and must be bound to a desktop-generated `state` value.
- SMTP credentials and server encryption keys must only be configured through the server environment. They must not be bundled into the desktop installer.
- Activation codes must be high-entropy, single-use, and stored as hashes only. The full code is displayed once when an administrator creates it.
- Admin Web access is restricted to `FRAMEQ_ADMIN_EMAIL`, defaults to `lantianye@163.com`, and uses HttpOnly 12-hour sessions. Admin write routes must validate CSRF tokens.
- The service must not accept uploads or API fields containing video, audio, transcript, insight, cookie, or user-local configuration data.
- The service may store a dedicated FrameQ client LLM API key. It must be encrypted at rest with `FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY`, never displayed in full, and treated as revocable client runtime material rather than a supplier master key.
- The dedicated client LLM key is delivered to authenticated entitled desktop clients during checkout. This improves out-of-box setup but does not prevent extraction from a compromised client; supplier-side key rotation and quota controls remain required.

<!-- 由 vibe-coding-launcher 生成。 -->

## Scope

FrameQ 涉及公开视频 URL、下载文件、本地音频、ASR 文字稿、可选 LLM API 和导出文件。本文件定义默认安全边界。

## Content Boundary

- 仅用于公开视频、用户自己发布的视频、已授权视频、内部研究或内容归档。
- 不实现绕过平台访问限制、批量抓取未授权内容、规避版权或隐私规则的能力。
- 当前产品路径不支持浏览器 cookie 导入、浏览器 cookie 文件、平台账号登录或 Cookie 辅助下载。worker fallback 只能使用公开视频页面自然下发的进程内匿名 cookie，且必须在本次 worker 调用结束后丢弃，不得上传、持久化、写入历史、日志或 app-local settings。

## Local Data

- `outputs/tasks/<task_id>/` 存放用户最终产物和 `frameq-task.json`，默认不提交仓库。
- 用户可通过 `FRAMEQ_OUTPUT_DIR` 将最终任务目录写入自定义本地目录；该目录内容不由仓库管理，用户需要自行保护其中的公开视频、音频、文字稿和灵感文件。
- `cache/tasks/<task_id>/` 存放下载缓存、中间文件和调试产物，默认不提交仓库；它不得作为历史或正式产物真相源。
- 只有满足当前 schema v3、source-privacy marker 和 canonical SourceIdentity 契约的
  `frameq-task.json` 才是任务库索引和 artifact 真相源；旧版记录与目录仅物理留存，
  不再被新版本读取、迁移或信任。
- `models/` 存放模型权重缓存，默认不提交仓库。
- `updates.json` 只存放更新检查偏好，默认不提交仓库；不得包含用户内容、账号 session、release signing private key 或下载包二进制。
- 对外分发安装包不内置 ASR 模型权重；首启下载的核心本地 ASR 模型（首版 SenseVoice Small）和运行期可写缓存、输出、历史、`.env` 必须写入 app-local data，不得写入安装目录。
- 取消任务会终止当前 worker 进程树；已写入的 `outputs/`、`cache/` 和 `models/` 文件默认保留，不做自动清理。

## Secrets

- LLM API Key、代理地址和云端配置不得硬编码到桌面端或 worker；管理员在 server Admin Web 中配置，server 负责加密保存。
- LLM 配置不得从 app-local data `.env` 或项目根 `.env` 读取；真实 `.env` 被 `.gitignore` 忽略，仓库只保留不含 LLM key 的 `.env.example` 和安装包 `.env.template` 占位模板。
- 旧本地 InsightFlow LLM 键名 `FRAMEQ_LLM_PROVIDER`、`FRAMEQ_LLM_BASE_URL`、`FRAMEQ_LLM_API_KEY`、`FRAMEQ_LLM_MODEL` 和 `FRAMEQ_LLM_TIMEOUT_SECONDS` 必须被 dotenv 加载链路忽略。
- 输出目录键名为 `FRAMEQ_OUTPUT_DIR`，不得用于写入网络路径凭据或敏感 token。
- 日志不得输出完整密钥、cookies 或敏感请求头。

## External Services

- LLM-generated Markdown rendered in the desktop UI must go through the sanitized Markdown renderer. Raw HTML from `summary.md` must be skipped or sanitized and must not be rendered with `dangerouslySetInnerHTML`.
- 下载、转码和 ASR 默认本地处理。
- 首启 ASR 模型下载的官方网络边界固定为先访问 ModelScope（`iic/SenseVoiceSmall`），失败或达到有界超时后才访问 Hugging Face（`FunAudioLLM/SenseVoiceSmall`）；不得根据 UI 语言、locale 或账号地区改变顺序。
- 发布方配置 `FRAMEQ_ASR_MODEL_DOWNLOAD_URL` 时只访问该自定义归档源，不得再访问 ModelScope 或 Hugging Face；该配置不得包含凭据、URL 查询 token 或敏感请求头。
- 模型下载事件、日志和技术详情只允许保留源名称、主机名、公开模型 ID、尝试次数及超时/失败分类；不得保留带 token 的完整 URL、凭据、Cookie、请求头或完整原始下载器输出。
- ASR 模型选择通过 `FRAMEQ_ASR_MODEL` 保存到本地 `.env`；该键只允许选择受支持的本地 ASR 模型标识，不得携带凭据、URL 查询 token 或敏感请求头。
- 要点总结和启发灵感会分别通过 server-managed checkout 使用管理员配置的云端 LLM；worker 会把文字稿片段发送到 checkout 返回的服务地址，用于生成用户确认的目标，确认面板必须明确提示这一点。偏好快照只允许随启发灵感目标发送。
- 桌面更新检查会访问 GitHub Releases 上的公开 `latest.json` updater manifest；该请求不上传本地文件、历史、模型缓存或账号 session。
- UI 设置面板只管理本机 ASR 和输出目录；云端 LLM 是否就绪由账号状态展示，文字稿主流程不依赖 LLM。
- worker 对外部服务错误必须返回结构化错误码，不得吞掉失败。

## Validation

涉及安全边界的改动至少需要：

- 检查 `.gitignore` 是否覆盖模型、输出、中间文件和密钥。
- 检查日志中不包含密钥、cookies 或完整敏感头。
- 在 spec 或 ExecPlan 中说明云端 LLM 数据流和用户提示。
