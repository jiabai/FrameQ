# ADR-2026-07-16: Local media import and path-secrecy boundary

## Status

Accepted for implementation planning on 2026-07-16.

## Context

FrameQ currently accepts a public video URL, creates one local task, prepares audio, and runs local
ASR before any independently confirmed cloud AI action. Users also need to process files already on
their computer, including common video containers such as MP4 and WMV and audio containers such as
MP3 and WAV.

Local file support introduces a more sensitive source identifier than a public canonical URL: a
complete local path can reveal a user name, organization, project, directory structure, and file
title. Passing that path through React, command-line arguments, task manifests, logs, or errors would
expand exposure far beyond the process that must open the file.

The design must preserve these existing boundaries:

- media and transcripts are local by default;
- the bundled desktop and worker are versioned and released together;
- ProcessSupervisor owns the single local-processing lane and cancellation semantics;
- SenseVoice consumes the official task WAV;
- History accepts only a closed safe manifest predicate;
- AI generation is separately confirmed and receives transcript data only under its existing rules;
  and
- the existing URL workflow, cache reuse, subtitle behavior, and cleaned v3 request contract remain
  unchanged.

## Decision 1: Add an independent local-file command with an opaque selection token

The URL command remains `process_video` with its cleaned URL-only IPC request. Local selection and processing use
three new Tauri commands: `select_local_media`, `clear_local_media_selection`, and
`process_local_media`.

The operating-system picker runs on the Rust side through the official Tauri dialog capability and
accepts one allowlisted file. Rust stores the complete absolute path in one in-memory selection and
returns React only an opaque random token plus safe display metadata. React submits the token; Rust
resolves it to the current selection immediately before starting the worker.

Only one selection exists. A new selection replaces the old one. Matching removal/new-task reset and
terminal success clear it; cancellation and retryable processing failure retain it. A missing,
changed, invalid, or linked source invalidates and clears it. App exit loses it because it is never
persisted.

Rust validates ordinary-file status, extension, nonzero size, no symlink/junction/reparse point, and
records size and modification time. It repeats validation and metadata comparison at processing so
a token cannot silently refer to a replaced file.

### Consequences

Positive:

- The browser/React boundary never receives the local path.
- URL and local requests remain explicit capabilities rather than an ambiguous optional-source DTO.
- A stale, replaced, or fabricated token fails before worker launch.
- Picker cancellation has no product-state or error side effect.

Negative:

- Refreshing/restarting the app loses an unprocessed selection and requires reselection.
- Rust owns a small concurrent selection state with lifecycle and race tests.
- Desktop UI tests need a picker bridge mock because browser automation cannot use the real native
  dialog reliably.

Neutral:

- The selected safe basename may be displayed and persisted locally in History because the user
  explicitly approved that local-only behavior; it is still forbidden from logs and cloud prompts.

## Decision 2: Send the path once through bounded worker stdin and upgrade to contract v4

Rust starts the bundled worker with the fixed mode `--process-local-media-stdin` and sends one strict,
bounded JSON request through stdin. The complete path is present only in Rust memory, the stdin pipe,
and worker memory while opening/copying/transcoding the source. It is forbidden from argv,
environment variables, progress, results, errors, logs, persistence, prompts, and cloud traffic.

`contracts/desktop-worker-contract.json` advances from version 3 to version 4 and declares a closed
local request, progress/error codes, and forbidden-content rules. The cleaned URL request remains
unchanged.
TypeScript, Rust, and Python reject missing, illegal, additional, or wrong-kind values without
echoing the payload. The packaged Tauri worker mirror must exactly match the canonical worker.

Local processing shares the existing ProcessSupervisor video lane and cancellation command. The two
commands cannot run concurrently and do not create a second cancellation model.

### Consequences

Positive:

- The path avoids process listings, shell parsing, environment inheritance, and frontend developer
  tools.
- A strict contract fails loudly if desktop and bundled worker drift.
- Existing supervision and truthful cancellation behavior remain one implementation.

Negative:

- Desktop, Rust, Python, tests, examples, and the packaged mirror must ship the v4 change together.
- Raw FFmpeg and ffprobe stderr cannot be forwarded directly because it may contain the input path.
- Every new local progress or error state requires contract and three-locale resource registration.

Neutral:

- Rust resolves the same app-local `asr_model` used by URL processing before constructing the local
  worker request. UI language and confirmation-time AI `output_language` remain unrelated contracts.

## Decision 3: Normalize all local sources to one official WAV

Every local source is decoded into `media/audio.wav` at 16 kHz, mono, signed 16-bit PCM. SenseVoice
reads only this artifact. The file is built through a partial path, validated, and then installed as
the official artifact; incomplete files are never registered.

For video, the worker requires video and audio streams, copies the original container unchanged to
`media/video.<ext>`, and generates the WAV. It does not transcode the video and does not use embedded
or sidecar subtitles. For audio, the worker requires an audio stream, generates the WAV, and retains
no separate original-audio artifact. Cover art does not classify audio as video.

The extension allowlist is closed:

- video: MP4, M4V, MOV, MKV, AVI, WMV, WebM;
- audio: MP3, WAV, M4A, AAC, FLAC, OGG, Opus, WMA.

The picker filter and extension check are not trusted as content validation. ffprobe must validate
the actual media kind and required streams. There is no product hard size/duration limit.

### Consequences

Positive:

- ASR has one stable media contract regardless of the selected container or codec.
- Audio playback, transcript review, and downstream AI reuse existing task artifacts.
- Video import preserves the user's original media bytes and avoids quality loss.
- Audio-only tasks truthfully contain no video artifact.

Negative:

- Normalization requires additional disk space and processing time even for an already compatible
  WAV.
- Large or long files can exhaust disk or encounter decoder limits; errors must remain structured and
  honest rather than introducing an arbitrary product cap.
- Video copy can fail after validation and before ASR, requiring careful partial-artifact cleanup.

Neutral:

- Importing the same file again creates a new task; no path/hash/content cache is introduced.

## Decision 4: Extend manifest schema v3 with a closed local source variant

The manifest schema version stays at 3. Existing or absent `source_kind` keeps the current strict URL
predicate: safe canonical SourceIdentity matching `source_url`. A local task uses
`source_kind: "local_file"`, empty `source_url`, null `source_identity`, and a validated
`local_source` containing only kind, safe basename, and lowercase extension.

The safe basename removes separators, control characters, and bidi/directional formatting controls;
is bounded to 160 characters while preserving its extension; and falls back to a generic local media
label if empty. Task IDs contain timestamp, `local`, and randomness only. They do not contain a path,
name, token, or content hash.

History exposes a source union rather than inventing a URL. Local tasks participate in strict
History detail, restore, deletion, transcript editing, audio playback, and AI retry. Older clients
must ignore the unrecognized local variant without mutation. Transcript Markdown and AI prompts do
not receive local filename/path source metadata.

### Consequences

Positive:

- Existing supported URL tasks need no migration or rewrite.
- History can identify a local task usefully without persisting the source path.
- The source predicate remains closed and auditable rather than accepting partially populated URL
  fields.

Negative:

- Rust, Python, and TypeScript task/source types must become explicit unions.
- Every History/cache/delete/retry predicate must handle URL and local variants consistently.
- Older releases will not display new local tasks; this is intentional fail-closed behavior.

Neutral:

- The safe basename is local History metadata, not an artifact filename, log field, or cloud field.

## Decision 5: Present one mutually exclusive composer and source-aware task workspace

The current URL composer gains an accessible `+` attachment menu. A selected local file replaces the
active URL control with a removable chip while retaining the URL draft in memory. The existing
confirmation action and account gate start either the URL command or local command according to the
active source.

Progress stays within the existing workflow state stages but uses registered source-aware message
codes. Video completion names video, audio, and transcript; audio completion names audio and
transcript. An audio task does not render a Locate Video action at all.

All copy, accessible names, errors, sizes, and progress are available in `zh-CN`, `zh-TW`, and
`en-US`. Switching locale does not clear source state. The menu/chip preserve keyboard focus,
dismissal, and `720x640` reachability requirements.

### Consequences

Positive:

- Users learn one composer and one confirmation/account model.
- The workspace tells the truth about the artifacts actually present.
- Local import does not imply a cloud upload or automatic AI charge.

Negative:

- Workflow state and History view models must become source-aware without letting App regain domain
  ownership.
- Browser smoke must cover mutual exclusion, focus, replacement, native-dialog cancellation mocks,
  and English expansion.

## Decision 6: Model source intent and source projection as closed unions

The frontend application boundary uses separate discriminated unions for the command being submitted
and the source being rendered:

```ts
type TaskSubmission =
  | { kind: "url"; url: string }
  | { kind: "local_media"; selectionToken: string };

type TaskSourceSummary =
  | { kind: "url"; url: string }
  | {
      kind: "local_file";
      displayName: string;
      mediaKind: LocalMediaKind;
    };
```

The composer state is also discriminated. Its local branch retains the inactive URL draft alongside
one validated `LocalMediaSelectionView`, but only the active branch can become a `TaskSubmission`.
`useTaskProcessingController` accepts that domain command, exhaustively dispatches by `kind`, and
never accepts a `FormEvent`. The form adapter owns `preventDefault`; the native-picker adapter owns
dialog presentation and cancellation.

`WorkflowState` replaces its parallel `url`, `submittedUrl`, and `showUrlInput` source fields with
`composerSource: TaskComposerSource` and `taskSource: TaskSourceSummary | null`. The composer
discriminator determines which input is active; `taskSource` is frozen when processing starts and is
restored directly from History. AI retries preserve it. Terminal local success clears the now-stale
selection token from the composer while retaining the safe `taskSource`; cancellation/retryable
failure retains the still-valid local selection according to the token lifecycle.

URL and local media continue to cross two independent strict IPC requests. No layer may replace the
union with optional `url`, `localPath`, `selectionToken`, `mediaKind`, or `isAudio` fields that permit
meaningless combinations.

### Consequences

Positive:

- TypeScript makes URL/local exclusivity and exhaustive handling compiler-visible.
- React presentation events no longer leak into workflow application commands.
- History and the active workspace can render source truth without inferring it from artifacts.

Negative:

- Current URL-only workflow, History, test-fixture, and view-model constructors must migrate
  together; temporary compatibility fields would recreate the invalid states this decision removes.

## Decision 7: Rename the shared execution vocabulary when local media becomes executable

Local media is another task-producing source in the existing serialized worker lifecycle, not a
second lane. In the same change that adds the real `WorkerJob::ProcessLocalMedia` consumer, internal
Rust names move from `video` to task semantics:

- `VideoWorkerFacade` becomes `TaskWorkerFacade`;
- `ProcessSupervisors.video` becomes `ProcessSupervisors.task`;
- `video_worker()` becomes `task_worker()`; and
- `is_video_active()` becomes `is_task_active()`.

`WorkerLane` remains the single private lifecycle state machine, the ASR-model-download lane remains
separate, and the public Tauri `process_video` command keeps its compatibility name. The rename must
land atomically with all internal callers and tests; aliases retaining both vocabularies are not part
of the design.

### Consequences

Positive:

- The facade and lane names describe their actual URL/local/AI responsibility.
- Local media reuses existing busy, cancellation, watchdog, cleanup, and terminal-result rules.

Negative:

- The implementation touches otherwise behavior-preserving internal call sites and architecture
  tests, so focused rename characterization is required before adding the new job variant.

## Decision 8: Copy into a generic task-owned staging path before invoking media tools

Python is the only layer that opens the original selected path. It copies the source in bounded
chunks into a generic task-owned staging filename before spawning ffprobe or FFmpeg. Child-process
argv may contain only the generic staging path; the original directory and basename never enter a
media-tool command.

For video, the staging file is probed, validated, and atomically promoted to
`media/video.<extension>`; that official task artifact becomes the decode source. For audio, the
staging file is probed and normalized to the official WAV, then removed on success. Failed and
cancelled operations run the existing best-effort staging cleanup/recovery policy, and no staging
path enters the manifest.

### Consequences

Positive:

- Seekable containers remain compatible with packaged media tools without exposing the original
  path through child-process inspection.
- Video source preservation and audio-source disposal use the same task-owned commit boundary.

Negative:

- Import temporarily needs space for a source-sized staging copy, and large files add a local copy
  phase before probe/normalization.
- Python file-open/copy failures can contain sensitive operating-system text internally and must
  still map to fixed non-echoing errors.

## Decision 9: Activate local media only as one tested vertical slice

The picker/selection store, strict Tauri command, `WorkerJob::ProcessLocalMedia`, bounded worker
stdin CLI consumer, media preparation, manifest source union, History/workspace projection, and
composer dispatch become executable together. Contract-v4 pure validators may exist beforehand, but
there must be no registered picker command, dead job variant, callable CLI switch, or UI affordance
whose downstream consumer is absent.

### Consequences

Positive:

- Every newly reachable branch has one complete lifecycle and acceptance path.
- URL behavior remains independently testable throughout the change.

Negative:

- The implementation cannot be released or merged as several partially executable slices; review
  checkpoints use tests and commits on one feature branch until the whole boundary is coherent.

## Failure Modes and Mitigations

| Failure mode | Required behavior |
|---|---|
| Native picker cancelled | Keep current URL/selection state and show no error. |
| Token missing, fabricated, replaced, or stale | Fail with `LOCAL_MEDIA_SELECTION_INVALID`; do not start worker or reveal metadata. |
| Source deleted or size/mtime changed | Clear selection, return `LOCAL_MEDIA_SELECTION_CHANGED` or `LOCAL_MEDIA_UNAVAILABLE`, require reselection. |
| Source is a symlink/junction/reparse point | Reject with `LOCAL_MEDIA_LINKED`; do not follow it. |
| Allowed extension but invalid media | Worker probe returns `LOCAL_MEDIA_VALIDATION_FAILED` without raw stderr/path. |
| Selected media kind does not match content | Return `LOCAL_MEDIA_KIND_MISMATCH`. |
| Video lacks video or audio stream | Return the corresponding fixed stream-missing code; do not register artifacts. |
| Audio lacks audio stream | Return `LOCAL_AUDIO_STREAM_MISSING`; do not register artifacts. |
| Video staging copy fails | Clean the stage, do not register a video, and return `LOCAL_VIDEO_COPY_FAILED`. |
| Audio staging copy fails | Clean the stage and return the existing non-echoing `AUDIO_NORMALIZATION_FAILED`. |
| WAV conversion/validation fails | Do not register a partial WAV; return `AUDIO_NORMALIZATION_FAILED`. |
| User cancels processing | Retain a still-valid selection for retry and preserve only valid artifacts. |
| Disk space is exhausted | Fail truthfully with sanitized local guidance; do not claim completion or impose a fake product limit. |
| Older app sees local manifest | Ignore it as unsupported without reading artifacts, rewriting, quarantining, or deleting it. |

## Alternatives Considered

### Pass the local path to React and back through IPC

Rejected because the path would enter browser state, developer tools, serialization, screenshots,
and error surfaces without product benefit.

### Send the path as a worker CLI argument or environment variable

Rejected because process listings, diagnostics, inherited environments, and shell/argument handling
create unnecessary disclosure and parsing risks. One-shot bounded stdin matches the existing privacy
direction.

### Pass the original path directly to ffprobe or FFmpeg after worker stdin parsing

Rejected because stdin would protect only the Rust-to-Python hop while the path would reappear in a
descendant process command. Copying to a generic task-owned staging path preserves seekability and
keeps the original path out of media-tool argv.

### Stream every source through an anonymous pipe into media tools

Rejected because MP4, MOV, WMV, and other supported containers may require seeking and packaged
cross-platform tools cannot be assumed to decode all of them reliably from a non-seekable stream.

### Add local-file fields to the existing `process_video` request

Rejected because URL identity/caching/subtitles and local path/token validation are different
capabilities. A union with optional URL/path/token fields would weaken strict validation and increase
regression risk for URL processing.

### Persist the source path for convenient re-open or deduplication

Rejected because paths are sensitive, become stale, and are unnecessary after artifacts are copied
or normalized. Reimport intentionally creates a new task.

### Keep the original audio file in addition to the normalized WAV

Rejected because it doubles storage without serving the current playback/ASR workflow. The official
WAV is sufficient; video retains its original container because Locate Video is an existing product
artifact.

### Reuse embedded subtitles for local videos

Rejected for this scope because subtitle discovery/selection adds a separate trust and UX contract.
Local files consistently follow audio ASR.

### Impose a product size or duration maximum

Rejected because user hardware, codec, and available disk vary. The product reports real resource
or decoder failures and may add a separately specified limit if operational evidence requires it.

### Upgrade the task manifest schema number

Rejected because schema v3 already represents the supported secure task family and can add a closed
source discriminator while preserving URL default semantics. Contract v4 changes the desktop/worker
wire protocol, not the persisted task schema version.

## References

- `docs/product-specs/2026-07-16-local-media-file-import.md`
- `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`
- `contracts/desktop-worker-contract.json`
- `app/src-tauri/src/video_processing.rs`
- `app/src-tauri/src/task_manifest.rs`
- `worker/frameq_worker/media.py`
- `worker/frameq_worker/pipeline.py`
- `worker/frameq_worker/task_store.py`
- Tauri dialog plugin: <https://v2.tauri.app/plugin/dialog/>
