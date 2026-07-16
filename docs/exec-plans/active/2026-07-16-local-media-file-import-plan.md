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
  manifest/source union, strict contract-v3 direction, error/progress registry, and acceptance scope.
  Validation: section-by-section user review completed in the planning conversation.
- [x] 2026-07-16: Published the product specification, ADR, active ExecPlan, and synchronized
  governance entry points for pre-implementation review. Validation: `python
  scripts/validate_agents_docs.py --level WARN` passed with 0 errors and 0 warnings; tracked-file
  `git diff --check` passed and the three new documents contain no trailing whitespace.
- [ ] 2026-07-16: Add RED contract, frontend, Rust, and worker tests before implementation.
  Validation: focused tests must fail for the intended missing local-media behavior, not unrelated
  setup errors.
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
- Evidence: the desktop-worker contract is currently version 2 after output-language localization.
  Local media adds a new strict wire request and code registry entries, so the packaged desktop and
  worker require a synchronized version 3 release.
- Evidence: the approved scope deliberately has no product file-size or duration maximum. Tests must
  exercise truthful disk/probe/decoder failures and must not silently introduce a hidden cap.

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
  the strict desktop-worker contract to v3. Rationale: stdin avoids process-list/environment exposure,
  and desktop/worker ship together so compatibility defaults would hide drift.
  Date/Author: 2026-07-16, User + Codex.
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

## Outcomes & Retrospective

Planning is complete and implementation has not started. This document records the approved product,
architecture, security, contract, persistence, test, and native-acceptance scope so review can occur
before code changes.

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
- Shared wire protocol: `contracts/desktop-worker-contract.json`,
  `app/src/desktopWorkerContract.test.ts`, and `worker/tests/test_contract.py`.
- Frontend composition and source state: `app/src/App.tsx`, `app/src/workflowState.ts`,
  `app/src/workerClient.ts`, `app/src/features/workflow/useTaskProcessingController.ts`,
  `app/src/taskWorkspaceViewModel.ts`, and the i18n resources under `app/src/i18n/`.
- Desktop command/supervision boundary: `app/src-tauri/src/lib.rs` and
  `app/src-tauri/src/video_processing.rs`.
- Desktop task and History boundary: `app/src-tauri/src/task_manifest.rs`,
  `app/src-tauri/src/history.rs`, and `app/src-tauri/src/history_deletion.rs`.
- Canonical worker: `worker/frameq_worker/desktop_contract.py`,
  `worker/frameq_worker/pipeline.py`, `worker/frameq_worker/media.py`,
  `worker/frameq_worker/task_store.py`, and worker CLI/service entry points discovered during
  implementation.
- Packaged worker: the Tauri worker resource mirror, synchronized only by the repository's existing
  mirror script and verified by equality/hash tests.
- UI/browser acceptance: existing app unit tests and `scripts/tests/`, including the current browser
  smoke/command ledger harness.
- Governance: `AGENTS.md`, `TASKS.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`,
  `docs/SECURITY.md`, and this active plan.

## Plan of Work

1. [ ] Lock contract v3 and source types through RED tests.
   - Extend the shared contract without changing the existing `process_video` request.
   - Declare `LocalMediaKind`, frontend selection metadata, strict local worker stdin request,
     registered progress codes, registered errors, and forbidden path/token content.
   - Add TypeScript, Rust, and Python rejection tests for missing, unknown, wrong-type, wrong-kind,
     additional, and path-echoing values.
   - Add canonical/mirror equality expectations before copying implementation.

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
   - Apply the existing account/config/model/output-format preparation and the same
     ProcessSupervisor video-lane busy/cancel/instance semantics.
   - Resolve the token only in Rust and write the full path once to bounded worker stdin using the
     fixed `--process-local-media-stdin` mode.
   - Never place the request/path in argv, env, startup diagnostics, worker log lines, or raw errors.
   - Map worker events/results through the same strict validators and clear/retain selection according
     to the approved terminal state.

4. [ ] Implement the worker local-media parser and probe boundary.
   - Parse a closed request with `source_path`, `media_kind`, safe display name, extension, ASR
     language, formats, model, and embedded mode; reject extra or invalid fields without echo.
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
