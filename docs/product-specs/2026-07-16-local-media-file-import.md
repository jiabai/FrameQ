# Local Video and Audio File Import

## Status

Approved for implementation planning on 2026-07-16. This specification defines the user-visible
behavior and safety boundary; implementation has not started.

## Problem

FrameQ currently starts a task from a supported public video URL. Users also have recordings and
downloaded media that already exist on their computer. They need to select one local video or audio
file, keep the media local, and run the same transcript-first workflow without first uploading it to
another service or manufacturing a URL.

In this feature, “upload” means local file import into FrameQ. FrameQ must not upload the selected
video or audio to the FrameQ server, an LLM provider, or any other remote service.

## Goals

- Accept one supported local video or audio file as the source of a new task.
- Preserve the existing URL workflow and make URL and local-file input mutually exclusive.
- Normalize every local source into the official `media/audio.wav` used by SenseVoice.
- Preserve an imported video's original container without transcoding the video stream.
- Represent an audio-only task truthfully, with no video artifact or disabled video action.
- Keep the complete source path out of React, persistence, logs, diagnostics, prompts, and cloud
  requests.
- Make local tasks available to the existing transcript, History, playback, editing, deletion, and
  independently confirmed AI workflows.

## Non-goals

- Drag and drop, batch import, multiple files in one task, playlists, concatenation, or a queue.
- Embedded or sidecar subtitle import for local videos; local media always uses audio ASR.
- Product-level maximum file size or duration limits.
- Reusing or deduplicating a prior local task by filename, path, hash, or media content.
- Transcoding or recompressing the imported video.
- Uploading local media to the server or LLM provider.
- Adding a new ASR model, changing AI Credits, or automatically starting AI generation.

## User Experience

### Choosing a source

The existing input composer keeps its URL field and confirmation action. A `+` button appears at
the left edge, following the familiar attachment pattern used by products such as ChatGPT and
Google. Activating it opens a one-item menu for adding a video or audio file. Selecting that item
opens an operating-system file dialog restricted to supported media extensions.

The dialog accepts one file only. Cancelling the dialog changes no state and displays no error.
Choosing a file does not start processing and does not consume AI Credits.

After selection, the composer shows a removable file chip containing:

- a source-kind icon;
- a safe basename;
- a localized formatted file size; and
- an accessible remove action.

The current URL draft remains in memory while the chip is present but is inactive and cannot be
submitted. Removing the chip restores the draft. Choosing another file replaces the current
selection. A new task clears the selection. Language changes must not clear either the inactive URL
draft or the selected-file chip.

The menu, dialog trigger, chip, and remove action support keyboard navigation, visible focus,
Escape, and outside-click dismissal where applicable. At `720x640`, all three locales remain usable
without horizontal overflow or unreachable actions.

### Starting processing

The user starts a local task through the existing confirmation action. The same account entitlement
and `can_process` gate used by URL submission applies. If entitlement is unavailable, the existing
account guidance is shown before a worker starts.

The task owns exactly one source:

- a URL; or
- a selected local file.

Frontend application state expresses that exclusivity with closed source types rather than optional
URL/path flags:

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

The workflow application controller accepts `TaskSubmission`, performs an exhaustive `kind`
dispatch, and keeps DOM events and native-picker presentation outside the command. The URL and local
wire requests remain independent closed commands; neither is represented by a bag of optional
`url`, `path`, `token`, or `isAudio` fields.

The composer also uses a discriminated source state so it can retain a URL draft while a local file
is active without creating a state in which URL and local media are both submitted:

```ts
type TaskComposerSource =
  | { kind: "url"; urlDraft: string }
  | {
      kind: "local_media";
      selection: LocalMediaSelectionView;
      retainedUrlDraft: string;
    };
```

`WorkflowState` stores `composerSource` plus `taskSource: TaskSourceSummary | null`; it does not keep
parallel `url`, `submittedUrl`, or `showUrlInput` source fields. The active input control is derived
from `composerSource.kind`, and the running/completed/restored task identity is derived only from
`taskSource`.

Submitting the same local file again always creates a new task. FrameQ does not compare paths,
timestamps, names, hashes, or content to reuse a prior local task.

### Supported formats

The initial closed allowlist is:

| Kind | Extensions |
|---|---|
| Video | MP4, M4V, MOV, MKV, AVI, WMV, WebM |
| Audio | MP3, WAV, M4A, AAC, FLAC, OGG, Opus, WMA |

The file dialog filter is convenience only. Tauri validates the extension and local file boundary,
and the worker probes the content and streams before creating task artifacts. Renaming an unsupported
or malformed file to an allowed extension must not bypass validation.

There is no product hard limit on file size or duration. Operating-system, disk-space, FFmpeg,
decoder, and model constraints may still fail honestly through structured errors.

## Processing Behavior

### Shared normalization

Every supported local source produces the official task artifact `media/audio.wav` before ASR. The
WAV must be 16 kHz, mono, 16-bit PCM (`pcm_s16le`). SenseVoice reads only that normalized artifact;
it must not read the original source directly.

The WAV is written through a temporary/partial path, validated, and atomically installed as the
official artifact where supported by the existing task-store boundary. An incomplete or invalid WAV
must not be registered in the manifest.

### Video input

A file selected as video must contain a valid video stream and a valid audio stream. FrameQ:

1. validates the local source;
2. copies the original file into the task as `media/video.<ext>` using the validated lowercase
   extension;
3. does not transcode the copied video;
4. extracts and normalizes its audio into `media/audio.wav`; and
5. runs the existing ASR/transcript pipeline from that WAV.

The artifact uses a generic filename rather than the source basename. Embedded subtitles and
sidecar subtitle files are ignored; local video always follows audio ASR.

### Audio input

A file selected as audio must contain a valid audio stream. A cover-art video stream in formats such
as MP3 does not make the source a video. FrameQ:

1. validates the local source;
2. normalizes it into `media/audio.wav`;
3. does not retain a second original-audio copy in the task; and
4. runs the existing ASR/transcript pipeline from the WAV.

An audio task has no video artifact. The UI must not render a disabled or placeholder “Locate
Video” action.

### Progress and completion

Local import uses structured localized progress. Contract v4 registers at least:

- `local.media.validating`;
- `local.video.copying`;
- `local.audio.normalizing`;
- the existing `audio.extract.running`; and
- the existing `asr.transcribe.starting` and `asr.transcribe.running` states.

The shared wire-stage enum retains `video_extracting` and `video_transcribing` for compatibility
with the existing task state model; presentation copy is source-aware. Completion for a local video
states that video, audio, and transcript are stored locally. Completion for local audio states only
that audio and transcript are stored locally.

Cancellation uses the existing ProcessSupervisor lifecycle, renamed internally from video-lane to
task-lane vocabulary when the local runtime becomes executable, and preserves truthful terminal
behavior. Cancellation must not manufacture success or delete already valid task artifacts.

## Desktop and Worker Interface

### Frontend-safe selection view

React receives only opaque, display-safe metadata:

```ts
type LocalMediaKind = "video" | "audio";

type LocalMediaSelectionView = {
  selectionToken: string;
  displayName: string;
  mediaKind: LocalMediaKind;
  extension: string;
  sizeBytes: number;
};

type ProcessLocalMediaRequest = {
  selectionToken: string;
};
```

New Tauri commands are:

- `select_local_media()`;
- `clear_local_media_selection({ selectionToken })`; and
- `process_local_media({ request })`.

The clear command is idempotent and only clears the matching current token. Existing
`process_video` URL behavior and its cleaned v3 request remain unchanged.

### Opaque token lifecycle

Rust owns one in-memory active selection containing the complete path plus validated metadata. The
frontend holds a random opaque UUID token, not a path. A new selection replaces the prior one.

- Chip removal and new-task reset clear the current matching selection.
- Terminal success clears it.
- Cancellation and retryable processing failure retain it so the user may retry.
- A missing, changed, invalid, or linked source clears it and requires reselection.
- Application exit clears it naturally; selections are never persisted.

At selection and again at processing, Rust requires an absolute ordinary file, an allowlisted
extension, nonzero size, and no symlink, junction, or reparse point. It stores and compares size and
modification time; a removed or changed file fails before worker processing and requires reselection.

### One-shot worker request

Rust sends the complete source path only in a one-shot bounded stdin request to the bundled worker:

```ts
type ProcessLocalMediaWorkerRequest = {
  contract_version: 4;
  source_path: string;
  media_kind: LocalMediaKind;
  safe_display_name: string;
  source_extension: string;
  asr_model: "iic/SenseVoiceSmall";
};
```

The worker entry point is `--process-local-media-stdin`. The path must never appear in argv,
environment variables, worker results, progress, errors, logs, task manifests, transcripts, AI
prompts, or cloud requests.

After parsing and validating the request, Python opens the original path itself and copies the bytes
to a task-owned generic staging name before spawning ffprobe or FFmpeg. Media-tool argv may contain
only that generic task staging path, never the original selected path. For video, the validated
staged container is atomically installed as `media/video.<ext>` and becomes the decode source. For
audio, the generic staging copy is temporary, is used for probe/normalization, and is removed after
the official WAV is committed or the operation fails. This preserves seekable-container behavior
without exposing the original path to child-process arguments.

`contracts/desktop-worker-contract.json` advances from version 3 to strict version 4. It keeps the
cleaned URL request unchanged and adds a closed local request. TypeScript, Rust, and Python reject
missing, unknown, or invalid values. The desktop and bundled worker ship at the same contract
version, and the canonical worker must match its Tauri packaged mirror.

## Task Manifest and History

Task manifest schema remains version 3 and gains a closed local-source variant. This avoids
rewriting existing supported URL tasks.

Existing or absent `source_kind` continues to mean URL and requires the current strict
`source_identity + canonical_url` predicate. A local task uses:

```json
{
  "source_kind": "local_file",
  "source_url": "",
  "source_identity": null,
  "local_source": {
    "media_kind": "video",
    "display_name": "访谈.wmv",
    "extension": "wmv"
  }
}
```

The local variant requires an empty `source_url`, no URL identity, and a validated `local_source`.
The task ID is timestamp plus `local` plus a random ID; it must not contain a filename, path, hash,
or token. Older clients must ignore an unrecognized local task without mutating it.

`display_name` is a local-only safe basename used for History. It strips path separators, control
characters, and Unicode bidi/directional formatting characters; is limited to 160 characters while
preserving the extension; and falls back to a localized generic media label if empty. The complete
path is never persisted.

History projects the same source union:

```ts
type TaskSourceSummary =
  | { kind: "url"; url: string }
  | {
      kind: "local_file";
      displayName: string;
      mediaKind: LocalMediaKind;
    };
```

Local tasks support History list/detail/restore/delete, transcript editing, normalized-audio
playback, artifact location, and independently confirmed summary/inspiration. A local transcript
Markdown export does not add a Source URL. AI prompts receive neither the local filename nor path.

## Errors and Diagnostics

Contract v4 registers fixed errors including:

- `LOCAL_MEDIA_SELECTION_INVALID`;
- `LOCAL_MEDIA_SELECTION_CHANGED`;
- `LOCAL_MEDIA_UNSUPPORTED_FORMAT`;
- `LOCAL_MEDIA_UNAVAILABLE`;
- `LOCAL_MEDIA_LINKED`;
- `LOCAL_MEDIA_VALIDATION_FAILED`;
- `LOCAL_MEDIA_KIND_MISMATCH`;
- `LOCAL_VIDEO_STREAM_MISSING`;
- `LOCAL_VIDEO_AUDIO_STREAM_MISSING`;
- `LOCAL_AUDIO_STREAM_MISSING`;
- `LOCAL_VIDEO_COPY_FAILED`; and
- `AUDIO_NORMALIZATION_FAILED`.

Failure while creating the generic staging copy maps to `LOCAL_VIDEO_COPY_FAILED` for video and to
the existing `AUDIO_NORMALIZATION_FAILED` preparation boundary for audio; it does not introduce an
unregistered code or reveal the source path.

Primary UI guidance is localized. Optional technical details must pass the existing sanitization
boundary and must not expose the path, filename, token, raw request, or raw FFmpeg/ffprobe output.
Logs may include only safe aggregate fields such as media kind, extension, byte/duration bucket,
stage, elapsed time, and result/error code. They must not include filename, complete path,
selection token, transcript, prompt, or generated content.

## Acceptance Criteria

- MP4 and WMV imports preserve `media/video.<ext>`, produce the required WAV, and create a usable
  transcript.
- MP3 and WAV imports produce the required WAV and transcript, create no video artifact, and render
  no Locate Video action.
- All allowlisted extensions are filtered and validated; wrong-kind, missing-stream, renamed,
  missing, changed, linked, and malformed files fail with fixed non-echoing errors.
- URL submission remains behaviorally and contractually unchanged.
- The frontend and browser command ledger contain a token but never a complete local path.
- Captured ffprobe/FFmpeg invocations contain only generic task-owned staging or official artifact
  paths and never the original selected directory or basename.
- Recursive manifest/result/progress/error/log inspection finds no complete path or token.
- Local tasks survive restart and work through History, transcript review, audio playback, deletion,
  and confirmed AI generation without sending media or filenames to the cloud.
- Reimporting the same file creates a new task.
- Three-language UI and accessibility copy cover the menu, chip, progress, completion, and errors.
- Windows and macOS manual acceptance record actual results; an unavailable platform is explicitly
  unverified rather than assumed to pass.

## References

- `docs/design-docs/2026-07-16-local-media-file-import.md`
- `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`
- `contracts/desktop-worker-contract.json`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN.md`
- `docs/SECURITY.md`
