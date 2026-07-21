# Local video and audio file import Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ users can select one supported video or audio file already on their computer and run the
existing local transcript-first workflow. A video task keeps the original video container, creates a
standard local WAV, and transcribes it. An audio task creates the same standard WAV and transcript
without pretending a video exists. The existing public-URL path remains unchanged.

The complete local source path stays inside Rust and the bundled worker only long enough to open the
file. It does not enter React, command-line arguments, environment variables, manifests, History,
logs, progress, errors, AI prompts, or cloud requests. Selecting a file is local and free; AI Credits
remain governed by the existing separate summary/inspiration confirmation.

## Progress

- [x] 2026-07-16: Approved the product behavior, local-path secrecy boundary, artifact rules,
  manifest/source union, strict contract direction, error/progress registry, and acceptance scope.
  Validation: section-by-section user review completed in the planning conversation.
- [x] 2026-07-16: Published the product specification, ADR, active ExecPlan, and synchronized
  governance entry points for pre-implementation review. Validation: `python
  scripts/validate_agents_docs.py --level WARN` passed with 0 errors and 0 warnings; tracked-file
  `git diff --check` passed and the three new documents contain no trailing whitespace.
- [x] 2026-07-18: Reserved contract v3 for process-video request cleanup and revised local media to
  build on that minimal URL request as contract v4. Validation: approved process-video contract v3
  product specification and ADR.
- [x] 2026-07-18: Consolidated current task trust and persistence access behind Rust
  `SupportedTask`/`TaskEditSession` and Python `TaskStoreFacade` before adding the local source
  variant. Validation: Rust facade RED tests then 146 Rust tests passed; Python facade RED tests then
  394 worker tests passed; focused Ruff passed. Final formatting/governance/diff gates remain in the
  implementation closeout record.
- [x] 2026-07-19: Consolidated current video-worker execution policy behind Rust `WorkerJob` and
  `VideoWorkerFacade` before adding the local-media operation. Validation: three RED policy tests
  preceded implementation, then all 149 Rust tests passed; application modules no longer import or
  compose invocation, operation, progress route, request, credentials, or lane policy.
- [x] 2026-07-19: Consolidated current URL download, media validation/copy, audio extraction/reuse,
  and subtitle discovery behind Python `MediaPreparationFacade` before extending the source union.
  Validation: facade and pipeline-boundary RED tests preceded implementation; 397 worker tests and
  focused Ruff passed with existing URL artifacts, progress, subtitles, errors, and manifests
  unchanged.
- [x] 2026-07-19: Made current URL media plus task manifest/preference writes crash-safe before
  adding local producers. Validation: focused RED runs exposed direct-write, missing-validation,
  artifact-allowlist, and exception-cause failures; 14 focused tests, all 406 worker tests, Ruff,
  governance validation, and diff checks passed. Contract v4 and local source variants remain
  intentionally absent.
- [x] 2026-07-19: Approved a focused Rust task-result adapter boundary before adding the local-media
  command, implemented it without contract-v4 behavior, and archived its ExecPlan. Validation:
  architecture review accepted `docs/design-docs/2026-07-19-video-processing-task-result-boundary.md`;
  focused/cross-layer gates and the native Rust 159/159 suite passed.
- [x] 2026-07-20: Split the remaining video-processing application hotspot before contract-v4
  implementation. Validation: root reduced from 1,118 to 68 lines; preflight matrix 4/4 and all
  `video_processing` 24/24 passed; complete Rust 163/163, App 542/542, scripts 23/23, dependency
  scans, rustfmt, lint, app/Tauri no-bundle builds, governance, and diff gates passed.
- [x] 2026-07-20: Added Contract v4 RED tests before implementation. TypeScript failed on global v3,
  absent `localMedia`, absent progress codes, and the missing frontend-safe module; Python failed on
  absent v4 constants/parser; Rust failed on the absent contract module. The mirror test remained
  green and proved recursive file-set plus byte equality after synchronization.
- [x] 2026-07-20: Locked the Contract v4 and source-type foundation without adding runtime local
  processing. The canonical contract, TypeScript safe selection/token parsers, Rust pure
  selection/IPC/worker-request validators, Python strict worker-request parser/model, progress
  registries, fixed errors, and path/token transport rules now agree. Focused GREEN: TypeScript
  25/25, Python 156/156, Rust local-media 6/6 plus contract parity 1/1.
- [x] 2026-07-20: Completed the Contract v4 step gates. Validation: App 549/549, Worker 436/436,
  Rust 169/169, scripts 23/23, full Ruff, app lint/build, rustfmt check, Tauri release
  `--no-bundle`, governance 0 errors/0 warnings, and `git diff --check` passed. The Rust suite ran
  outside the sandbox because its existing Windows blocked-stdin cancellation test requires real
  `taskkill`; the sandbox failure was reproduced and isolated as permission-only. Existing
  `audioop` deprecation and Vite chunk-size warnings remain non-blocking and unrelated.
- [ ] 2026-07-16: Implement Rust selection, strict IPC, worker local-media pipeline, source-aware
  task persistence/History, and UI composition. Validation: focused suites and packaged-worker
  equality must pass.
- [ ] 2026-07-16: Complete full automated gates and Windows/macOS manual acceptance, record residual
  risk, and archive this plan. Validation: all commands and native evidence listed below.

## Surprises & Discoveries

- Evidence: `app/src/features/workflow/useTaskProcessingController.ts` currently submits only a URL
  through `processVideo`, while `app/src/workerClient.ts` owns the desktop worker client. Local input
  therefore requires an explicit source union and command, not only a file-picker visual control.
- Evidence: `app/src-tauri/src/video_processing.rs` is the current ProcessSupervisor-backed desktop
  bridge, while `worker/frameq_worker/pipeline.py`, `media.py`, and `task_store.py` own preparation and
  artifacts. The local path must cross this existing Rust/Python boundary once without being added to
  argv or frontend state.
- Evidence: `app/src-tauri/src/task_manifest.rs` and `app/src-tauri/src/history.rs` enforce the current
  History vNext manifest predicate. Local tasks cannot be made visible safely by leaving URL fields
  partially populated; the predicate and returned source model must become closed unions.
- Evidence: the desktop-worker contract is version 2 after output-language localization. The
  prerequisite process-video cleanup advances it to v3; local media then adds a new strict wire
  request and code registry entries through a synchronized version 4 release.
- Evidence: the canonical desktop-worker contract is now v4 while the existing URL worker request
  intentionally remains v3. Separate constants and assertions are required; equating the global
  contract version with every operation's request version would silently break the stable URL path.
- Evidence: `app/src-tauri/resources/worker/frameq_worker` is absent because it is an ignored generated
  mirror. The refresh-path test now compares the complete filtered relative file set and bytes, so
  the later real mirror copy has an equality gate without hand-editing generated resources.
- Evidence: local progress codes must be registered before producers exist. The producer-source test
  therefore names exactly three reserved local codes; no URL module emits fabricated local progress.
- Evidence: the Windows blocked-stdin cancellation test fails inside the filesystem/process sandbox
  because `taskkill` is denied, but the identical isolated and full Rust runs pass outside that
  sandbox. No runtime change was made for this environmental false failure.
- Evidence: the approved scope deliberately has no product file-size or duration maximum. Tests must
  exercise truthful disk/probe/decoder failures and must not silently introduce a hidden cap.
- Evidence: History, cache reuse, transcript read/edit, and deletion previously reconstructed the
  manifest privacy/path sequence independently. The implemented task-access facade now makes the
  future URL/local source predicate a single Rust ownership point while retaining per-task scan
  isolation. Python pipeline/retry persistence now shares one lifecycle facade as well.
- Evidence: `video_processing.rs` also previously selected `WorkerInvocation`, `WorkerOperation`,
  `ProgressRoute`, retry-only LLM material, and `WorkerLane` independently. The implemented typed
  worker facade now owns that tuple. A `ProcessLocalMedia` job is intentionally absent until contract
  v4 and its Python CLI consumer exist, so the variant and all policies can land atomically.
- Evidence: `run_worker_pipeline` previously reconstructed URL download, output selection, ffprobe,
  task video copying, audio extraction, and subtitle discovery. The implemented media-preparation
  facade now returns task-owned media plus a parsed subtitle candidate while leaving task finalize,
  transcript writing, ASR, and AI in the pipeline.
- Evidence: the current facade formerly copied and decoded directly into official task paths, while
  task JSON used direct `write_text` and artifact discovery trusted existence. The implemented
  shared atomic-file boundary now stages, syncs, validates media, replaces per file, removes handled
  partials, and restricts artifact discovery to known ordinary official files.
- Evidence: the task-result adapter now closes typed process/retry failure policy, but the remaining
  `video_processing.rs` still combines strict AI retry, model-aware URL cache, source-identity
  preflight, ASR request preparation, diagnostics, and Tauri command orchestration. The approved
  follow-up split isolates those current workflows before contract-v4 adds a separate local source.

## Decision Log

- Decision: Accept exactly one active source and keep URL/local-file requests independent.
  Rationale: URL identity, cache reuse, platform subtitles, and canonicalization are different from
  local token/path validation; mutually exclusive commands keep both request schemas strict.
  Date/Author: 2026-07-16, User + Codex.
- Decision: Add a `+` attachment menu with one local-media action, then show a removable file chip
  while retaining the inactive URL draft. Rationale: this is a familiar, compact composer interaction
  and does not destroy unfinished URL input. Date/Author: 2026-07-16, User + Codex.
- Decision: Use a Rust-side native single-file picker and return only an opaque UUID token plus safe
  metadata to React. Rationale: a complete path exposes sensitive local directory information and is
  not required by presentation code. Date/Author: 2026-07-16, User + Codex.
- Decision: Revalidate file type, ordinary-file/no-link status, nonzero size, size, and modification
  time at processing. Rationale: a valid selection can be replaced or changed before confirmation;
  the token must not authorize different bytes silently. Date/Author: 2026-07-16, User + Codex.
- Decision: Pass the full path only through a bounded `--process-local-media-stdin` payload and raise
  the strict desktop-worker contract from v3 to v4. Rationale: stdin avoids process-list/environment exposure,
  and desktop/worker ship together so compatibility defaults would hide drift.
  Date/Author: 2026-07-16, User + Codex.
- Decision: Keep `process_video.contract_version = 3` while setting the canonical desktop-worker
  contract and local worker request to v4. Rationale: the global release contract gained a new
  operation, but the already-cleaned URL request did not change and must not be version-bumped for
  cosmetic consistency. Date/Author: 2026-07-20, Codex.
- Decision: Land only pure local-media source/transport types and validators in this contract step;
  do not add a Tauri command, `WorkerJob`/facade variant, Python CLI switch, or media source variant
  until each has a real consumer. Rationale: cross-language rejection behavior can be locked now
  without creating an executable half-path or weakening the earlier no-dead-variant decision.
  Date/Author: 2026-07-20, Codex.
- Decision: Register the three local progress codes now and explicitly reserve them in the producer
  coverage test until the real pipeline lands. Rationale: fake emissions would misstate product
  behavior, while leaving the registry implicit would allow desktop/worker drift.
  Date/Author: 2026-07-20, Codex.
- Decision: Normalize every source to 16 kHz mono 16-bit PCM `media/audio.wav`, which is the only ASR
  input. Rationale: one deterministic artifact contract isolates codec/container differences from
  SenseVoice and existing playback/transcript behavior. Date/Author: 2026-07-16, User + Codex.
- Decision: Preserve an imported video's original container as `media/video.<ext>` without
  transcoding, but retain no separate original-audio file for audio tasks. Rationale: video is an
  existing user-facing artifact, while the normalized WAV fully serves audio playback and ASR.
  Date/Author: 2026-07-16, User + Codex.
- Decision: Ignore local embedded/sidecar subtitles and always run audio ASR.
  Rationale: subtitle discovery and selection would add a separate product/trust contract and make
  behavior inconsistent across local containers. Date/Author: 2026-07-16, User + Codex.
- Decision: Keep task manifest schema v3 and add a closed `local_file` source variant; existing or
  missing `source_kind` remains URL. Rationale: current URL tasks need no rewrite, while History can
  fail closed on unrecognized local variants. Date/Author: 2026-07-16, User + Codex.
- Decision: Persist a sanitized local basename and kind for local History, but never the full path;
  use timestamp + `local` + randomness for task identity. Rationale: users need a recognizable local
  task without exposing directory structure or binding identity to mutable file metadata.
  Date/Author: 2026-07-16, User + Codex.
- Decision: Create a new task on every local submission and impose no product hard size/duration
  limit. Rationale: path/hash deduplication introduces privacy and stale-cache complexity, while
  resource capacity depends on the user's machine and should fail truthfully.
  Date/Author: 2026-07-16, User + Codex.
- Decision: Reuse the existing ProcessSupervisor video lane, workflow stages, account gate, and
  separately confirmed AI flows. Rationale: local media is a new source, not a parallel lifecycle,
  entitlement model, cancellation model, or AI billing path. Date/Author: 2026-07-16, User + Codex.
- Decision: Make raw Rust task manifests and artifact-path primitives private and require
  `SupportedTask::scan/open`; use `TaskEditSession` for transcript manifest mutation and
  `TaskStoreFacade` for Python create/open/finalize/snapshot persistence. Rationale: the local source
  union must not require every History/cache/transcript/deletion caller to reproduce a security
  predicate, while deletion and playback still need narrowly validated filesystem capabilities.
  Date/Author: 2026-07-18, User + Codex.
- Decision: Add local-media execution as a new `WorkerJob::ProcessLocalMedia` variant only together
  with contract v4 and the real worker CLI consumer. `VideoWorkerFacade` must then derive its fixed
  invocation, lifecycle operation, worker progress route, video lane, and no-LLM policy in one
  exhaustive match. Rationale: current application callers can no longer build inconsistent policy
  tuples, while avoiding an untestable dead variant. Date/Author: 2026-07-19, User + Codex.
- Decision: Add local source variants to `MediaPreparationFacade` only with contract v4 and the real
  worker consumer; contract v3 exposes only `UrlMediaSource`. Return a parsed subtitle candidate for
  URL sources so pipeline code does not rescan cache files. Rationale: the facade remains exhaustive
  and useful now without shipping dead local-path handling or leaking media subsystem details.
  Date/Author: 2026-07-19, User + Codex.
- Decision: Install official worker media and task JSON through unique same-directory staging files,
  validation where applicable, and `os.replace`; preserve per-file rather than promise cross-file
  atomicity. Rationale: official names must mean committed content, while an audio failure may still
  truthfully retain an already validated video under existing partial-task behavior.
  Date/Author: 2026-07-19, User + Codex.
- Decision: Extract current process-video/retry task outcome adaptation into one private Rust child
  module before contract v4, using a closed command context rather than caller-supplied failure
  strings. Rationale: local media should join an explicit tested result policy without expanding the
  worker runtime facade or mixing path-sensitive implementation into this refactor.
  Date/Author: 2026-07-19, User + Codex.
- Decision: Split current retry, URL cache, and URL process/config/preflight responsibilities into
  focused private child modules before contract v4, without adding another facade or a dead local
  source module. Rationale: local-media implementation should enter a small composition boundary,
  while current cache tolerance and safe diagnostics remain independently testable.
  Date/Author: 2026-07-20, User + Codex.

## Outcomes & Retrospective

The local-media Contract v4 and cross-language source-type foundation are complete. Product runtime
implementation has not started: there is still no picker, selection store, Tauri local command,
`WorkerJob::ProcessLocalMedia`, Python CLI consumer, FFmpeg/ffprobe local pipeline, manifest variant,
History/UI support, or native acceptance. The earlier task-access, typed-worker-execution,
media-preparation facade, crash-safe file-commit, task-result, and video-processing module-boundary
prerequisites remain complete.

Residual risk: actual codec/container support depends on the packaged FFmpeg/ffprobe build and must be
proven with representative fixtures. Very large media may exhaust disk or processing resources because
the product intentionally has no arbitrary hard cap. Windows and macOS native picker, filesystem-link,
and path behavior require platform evidence; an unavailable host must remain explicitly unverified.
Older FrameQ releases intentionally ignore local-source manifests. The source basename remains local
History metadata and therefore still reveals the selected filename to anyone with access to the task
directory, even though the complete path is never stored.

## Context and Orientation

- Product intent: `docs/product-specs/2026-07-16-local-media-file-import.md`.
- Persistent decisions: `docs/design-docs/2026-07-16-local-media-file-import.md`.
- Task access prerequisite: `docs/design-docs/2026-07-18-task-access-facade.md`.
- Task-manifest private-owner prerequisite:
  `docs/design-docs/2026-07-21-task-manifest-module-split.md`.
- Worker execution prerequisite: `docs/design-docs/2026-07-19-typed-worker-job-facade.md`.
- Task-result adapter prerequisite:
  `docs/design-docs/2026-07-19-video-processing-task-result-boundary.md`.
- Video-processing module-split prerequisite:
  `docs/design-docs/2026-07-20-video-processing-module-split.md`.
- Media preparation prerequisite: `docs/design-docs/2026-07-19-media-preparation-facade.md`.
- Shared wire protocol: `contracts/desktop-worker-contract.json`,
  `app/src/desktopWorkerContract.test.ts`, and `worker/tests/test_contract.py`.
- Frontend composition and source state: `app/src/App.tsx`, `app/src/workflowState.ts`,
  `app/src/workerClient.ts`, `app/src/features/workflow/useTaskProcessingController.ts`,
  `app/src/taskWorkspaceViewModel.ts`, and the i18n resources under `app/src/i18n/`.
- Desktop command/supervision boundary: `app/src-tauri/src/lib.rs` and
  `app/src-tauri/src/video_processing.rs`.
- Desktop task and History boundary: stable `app/src-tauri/src/task_manifest.rs`, private
  `task_manifest/source_identity.rs`, `schema.rs`, `storage.rs`, and `access.rs`, plus
  `app/src-tauri/src/history.rs` and `history_deletion.rs`. Application callers continue importing
  only the stable root.
- Canonical worker: `worker/frameq_worker/desktop_contract.py`,
  `worker/frameq_worker/pipeline.py`, `worker/frameq_worker/media_preparation.py`,
  `worker/frameq_worker/atomic_files.py`, `worker/frameq_worker/media.py`,
  `worker/frameq_worker/task_store.py`, and worker CLI/service entry points discovered during
  implementation.
- Packaged worker: the Tauri worker resource mirror, synchronized only by the repository's existing
  mirror script and verified by equality/hash tests.
- UI/browser acceptance: existing app unit tests and `scripts/tests/`, including the current browser
  smoke/command ledger harness.
- Governance: `AGENTS.md`, `TASKS.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`,
  `docs/SECURITY.md`, and this active plan.

## Plan of Work

0. [x] Centralize current task access, worker execution, and media preparation policy before
   extending the source union.
   - Keep raw Rust manifest/path helpers private and migrate History, cache, transcript, and deletion
     to `SupportedTask`, with transcript mutation through `TaskEditSession`.
   - Make Python pipeline and retry use `TaskStoreFacade` for task lifecycle persistence.
   - Route current video/source/AI jobs through `WorkerJob + VideoWorkerFacade`; keep both lanes
     private and expose only semantic execution/cancel/activity methods.
   - Route current URL download, validation/copy, audio preparation, and subtitle discovery through
     `MediaPreparationFacade`; keep task persistence, transcript writing, ASR, and AI outside it.
   - Preserve current schema/contract/result behavior and prove it with existing characterization
     suites plus focused facade tests.

0.1. [x] Make existing worker file commits crash-safe before local-media contract v4.
   - Add RED tests for interrupted/invalid video copy, partial/invalid WAV extraction, atomic JSON
     replacement failure, prior-file preservation, staging cleanup, and artifact exclusion.
   - Add one focused atomic-file module for unique same-directory staging, file sync, optional
     directory sync, replacement, UTF-8 text writes, and best-effort cleanup.
   - Make `MediaPreparationFacade` validate staged video/audio before replacement and map filesystem
     or media-tool failures to fixed safe errors without paths or command output.
   - Make `TaskStoreFacade` atomically install manifest and preference snapshot, and register only
     committed ordinary files at known official paths.
   - Run focused tests after every RED/GREEN step, then the complete worker suite, Ruff, governance
     validation, and diff checks. Keep contract v4, local source variants, transcript/AI writer
     transactions, and automatic orphan cleanup outside this prerequisite.

0.2. [x] Extract current Rust task-result adaptation before local-media contract v4.
   - Add RED tests for structured task passthrough, mismatched result families, cancellation,
     unstructured failures, busy/transport/protocol failures, and fixed pipe/wait command errors.
   - Move only task outcome/error classification into
     `app/src-tauri/src/video_processing/task_result.rs` behind a closed process/retry context.
   - Keep cache lookup, source preflight, request parsing, diagnostics, worker execution, and local
     media outside the module; do not add `ProcessLocalMedia` until its real contract and consumer.
   - Run the focused/full Rust, rustfmt, app, scripts, governance, and diff gates recorded in the
     dedicated task-result ExecPlan before starting contract-v4 RED tests.
   - Implemented in `1fa2f37`: 4 adapter tests and all 20 `video_processing` tests passed; the
     dependency boundary, rustfmt, app 542, scripts 23, lint/build, governance, and diff/scope gates
     passed. The complete native-permission Rust suite passed 159/159, including the Windows
     blocked-stdin cancellation fixture. The earlier sandbox-only failure was traced to `taskkill`
     receiving `Access denied`; no worker-runtime source change was required. Dedicated ExecPlan:
     `docs/exec-plans/completed/2026-07-19-video-processing-task-result-boundary-plan.md`.

0.3. [x] Split current Rust video-processing application responsibilities before contract v4.
   - Add a pure classifier and complete behavior matrix for source-identity preflight before moving
     the orchestration.
   - Extract strict retry request/execution/diagnostics, model-aware URL cache policy, and URL
     request/config/preflight/process orchestration into focused private modules.
   - Keep the existing task-result adapter, Tauri command paths, contract v3, worker, manifest,
     cache, cancellation, diagnostics, and user-visible behavior unchanged.
   - Add no generic facade, `ProcessLocalMedia` variant, or empty local-media module; those remain
     atomic with contract v4 and the real worker consumer.
   - Complete the focused/full Rust and cross-layer gates in the dedicated ExecPlan before starting
     contract-v4 RED tests.
   - Implemented on 2026-07-20: root 68 lines; retry/cache/URL modules own their approved boundaries;
     focused 24/24, Rust 163/163, App 542/542, scripts 23/23, dependency, formatting, build,
     Tauri no-bundle release, governance, and diff gates passed. Dedicated ExecPlan:
     `docs/exec-plans/completed/2026-07-20-video-processing-module-split-plan.md`.

1. [x] Lock contract v4 and source types through RED tests.
   - Extend the shared contract without changing the cleaned v3 `process_video` request.
   - Declare `LocalMediaKind`, frontend selection metadata, strict local worker stdin request,
     registered progress codes, registered errors, and forbidden path/token content.
   - Add TypeScript, Rust, and Python rejection tests for missing, unknown, wrong-type, wrong-kind,
     additional, and path-echoing values.
   - Add canonical/mirror equality expectations before copying implementation.
   - Implemented 2026-07-20 without changing the cleaned v3 URL request or adding runtime local
     consumers. Focused RED evidence and GREEN counts are recorded in Progress.

2. [ ] Implement the Rust-side native selection capability.
   - Add the official Tauri dialog plugin and a single-file filter for the closed video/audio
     extension allowlists.
   - Add one mutex-protected current selection with a cryptographically random UUID token, complete
     path, media kind, lowercase extension, safe display name, size, and modification time.
   - Validate absolute ordinary-file status, no symlink/junction/reparse component, nonzero size, and
     allowlisted extension at selection.
   - Implement idempotent matching-token clear, replacement, app-exit loss, terminal-success clear,
     cancellation/retry retention, and invalid-source clear behavior.
   - Revalidate the path, link status, size, and modification time immediately before processing.
   - Ensure command responses and errors contain safe metadata/codes only.

3. [ ] Add the independent supervised local worker command.
   - Add `process_local_media({request})` without changing URL `process_video`.
   - Apply the existing account/config/model preparation and the same
     ProcessSupervisor video-lane busy/cancel/instance semantics.
   - Resolve the token only in Rust and write the full path once to bounded worker stdin using the
     fixed `--process-local-media-stdin` mode.
   - Never place the request/path in argv, env, startup diagnostics, worker log lines, or raw errors.
   - Map worker events/results through the same strict validators and clear/retain selection according
     to the approved terminal state.

4. [ ] Implement the worker local-media parser and probe boundary.
   - Parse a closed request with `contract_version`, `source_path`, `media_kind`, safe display name,
     extension, and resolved `asr_model`; reject extra or invalid fields without echo.
   - Recheck extension, ordinary local file expectations available to Python, and ffprobe content.
   - Classify MP3/other cover art as audio and require video+audio streams for video.
   - Open or stream the source for media-tool probing/decoding without placing the complete path in a
     spawned ffprobe/FFmpeg argv. If the packaged tools cannot support the approved seekable formats
     reliably through a cross-platform safe handle/stream strategy, stop for architecture review
     rather than weakening the path-secrecy boundary silently.
   - Sanitize ffprobe/FFmpeg exceptions before progress, result, and log boundaries.
   - Emit only contract-registered message/error codes and safe args.

5. [ ] Implement source-specific artifact preparation with one shared ASR path.
   - For video, copy bytes to a partial `media/video.<ext>`, validate/install the final artifact, then
     decode audio; do not transcode video or inspect embedded/sidecar subtitles.
   - For audio, do not retain the original source and proceed directly to normalization.
   - Decode every source to a partial 16 kHz mono `pcm_s16le` WAV, validate it, then install
     `media/audio.wav` before SenseVoice reads it.
   - Reuse the existing transcription, segment, transcript, cancellation, and completion path after
     WAV preparation.
   - Preserve valid partial task artifacts on cancellation but never register incomplete files or
     manufacture a successful terminal state.

6. [ ] Extend manifest schema-v3 validation with closed URL/local source variants.
   - Change the closed source union, safe local metadata, and support predicate in private
     `task_manifest/schema.rs`; keep canonical URL identity rules in `source_identity.rs` and make
     `access.rs` admit tasks only through the shared schema predicate.
   - Keep `storage.rs` source-agnostic: it may validate task IDs and task-local filesystem
     containment but must never receive or persist the original selected local path.
   - Keep absent/current `source_kind` URL semantics and the existing strict SourceIdentity match.
   - Add local `source_kind`, empty URL, null identity, and required bounded safe local metadata.
   - Generate local task IDs from timestamp + `local` + randomness, never path/name/token/hash.
   - Add basename sanitization for separators, controls, bidi/directional controls, 160-character
     preservation of extension, and empty fallback.
   - Update the source privacy marker/predicate and recursive privacy tests to accept exactly one safe
     URL or local variant.
   - Ensure transcript Markdown, diagnostics, prompts, and worker results do not gain filename/path.

7. [ ] Make History, artifacts, transcript review, and AI source-aware.
   - Replace URL-only history source fields with a discriminated `TaskSourceSummary` while retaining
     URL display/canonical behavior.
   - List, load, restore, delete, play normalized audio, edit transcript, locate existing artifacts,
     and retry AI for a supported local task through the current strict task-root checks.
   - Do not render Locate Video for audio tasks; locate the generic original-container artifact for
     video tasks.
   - Keep older-client behavior fail-closed: unrecognized local manifests are ignored without reads,
     migration, rewrite, quarantine, or deletion.
   - Ensure summary/inspiration receive the saved transcript under existing confirmation and output
     language rules but never receive source name/path/manifest.

8. [ ] Implement the composer and localized source-aware presentation.
   - Add the left `+` button, one-item attachment menu, native picker action, local chip, size
     formatting, replacement/removal behavior, and mutual exclusion with the retained URL draft.
   - Route the existing submit confirmation/account gate to URL or local processing according to the
     active source; selection alone starts nothing and consumes no Credits.
   - Preserve source state across locale changes and preserve unrelated ASR/output/settings drafts.
   - Add three-locale menu/chip/progress/completion/error/accessibility copy and source-aware workspace
     artifact actions.
   - Cover keyboard focus, Escape, outside click, dialog cancellation, disabled/busy behavior, and
     English expansion at `720x640`.

9. [ ] Add security and regression coverage.
   - Assert frontend state, browser command ledger, screenshots/fixtures, and IPC responses contain a
     token/safe basename only where intended and never a full path.
   - Recursively inspect manifests, results, progress, errors, technical details, logs, transcript
     exports, and prompt captures for absence of full path/token/raw stderr.
   - Cover all allowlisted formats at the declaration level and representative MP4, WMV, MP3, WAV,
     cover-art, malformed, renamed, missing-stream, changed/deleted, and linked fixtures.
   - Prove URL cache, URL subtitle selection, URL contract, cancellation, task deletion, transcript
     editing, i18n, AI output language, and Credits call counts are unchanged.
   - Refresh the packaged worker only through the existing synchronization path and prove canonical
     equality.

10. [ ] Complete automated and native acceptance, then archive.
    - Run every gate below and record exact test counts/results in Progress and Outcomes.
    - On Windows and macOS where available, import MP4/WMV/MP3/WAV, inspect the WAV with ffprobe,
      restart/restore History, locate allowed artifacts, test changed/deleted sources, cancellation,
      disk failure, keyboard navigation, and path secrecy.
    - Use fake AI clients for required automation so no real Credits are consumed; record optional
      real-provider checks separately.
    - Record unavailable platforms/codecs as unverified residual risk rather than inferred success.
    - Update product/governance docs, move this plan to `completed/`, update indexes/TASKS, and leave
      cross-cutting residual debt in the shared tracker if any remains.

## Validation and Acceptance

Automated gates:

- `npm --prefix app test`
- `npm --prefix app test -- tests/app-input.browser.test.ts`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check`
- `uv run pytest worker/tests`
- `uv run ruff check worker`
- `node --test scripts/tests/*.test.mjs`
- `python scripts/validate_agents_docs.py --level WARN`
- `npm --prefix app run tauri -- build --no-bundle`
- `git diff --check`

Focused automated acceptance must prove:

- Three extension sets/types stay identical across UI filter, Rust validation, contract declaration,
  and Python validation.
- Missing/invalid/additional contract fields fail consistently in TypeScript, Rust, and Python.
- A complete local path is absent from frontend state, argv, env, results, progress, errors, logs,
  manifests, transcript exports, prompt captures, and browser command ledger.
- Token replacement/clear/retention plus changed/deleted/linked source behavior matches the lifecycle
  in the product spec.
- Every representative source generates a validated 16 kHz mono 16-bit PCM WAV before ASR.
- Video keeps generic `video.<ext>` and requires video+audio; audio keeps no video and accepts cover
  art without misclassification.
- Local source manifests pass only their closed predicate; current URL manifests and behavior remain
  unchanged; older/unrecognized local tasks fail closed without mutation.
- Local tasks restore, delete, play audio, edit transcripts, locate real artifacts, and run separately
  confirmed AI targets without source metadata reaching the prompt.
- The `+` menu, chip, source replacement, dialog-cancel mock, account gate, audio-only artifact UI,
  keyboard focus, three locales, and `720x640` English layout pass browser smoke.
- Canonical worker and packaged Tauri mirror files match exactly.

Manual acceptance:

1. On a real Windows Tauri build, select and process representative MP4, WMV, MP3, and WAV files.
   Verify file-dialog filters, chip/removal, progress, cancellation/retry, completion copy, artifacts,
   transcript, History restart, and no path in diagnostics.
2. Inspect each resulting `media/audio.wav` using ffprobe and confirm 16 kHz, mono, signed 16-bit PCM.
   Confirm video bytes/container are preserved and audio tasks contain/render no video.
3. Between selection and submission, rename/delete/replace the source and verify FrameQ requires
   reselection without revealing the path. Check invalid, wrong-kind, missing-audio, and linked files.
4. Exercise low-disk/copy/normalization failure where safely reproducible and verify partial artifacts
   never appear as completed manifest entries.
5. Repeat native picker/filesystem acceptance on macOS. If no macOS host is available, record it as
   unverified. WMV decoding support must be recorded from the packaged FFmpeg build, not assumed.
6. Use fake AI for required acceptance. Do not spend real AI Credits merely to validate local media;
   any real-provider smoke is optional and separately recorded.
