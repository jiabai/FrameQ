# History vNext Strict Boundary

## Product Decision

FrameQ supports history only for tasks created by the current safe task contract. Historical
schema v1/v2 data and tasks that do not prove the current source-privacy contract are unsupported
external legacy data. The product keeps their directories physically untouched but never
migrates, repairs, displays, reuses, retries, edits, or deletes them automatically.

Users who need old files may back up or delete those directories themselves outside FrameQ.
FrameQ must not inspect legacy artifacts in order to explain why an entry was excluded, because
those artifacts may contain raw source URLs or credential-like values.

## Supported Task Contract

A task is eligible for every product read only when all conditions hold:

- `schema_version` is exactly `3`.
- `source_privacy_migration_version` equals the current source-privacy version.
- `source_privacy_quarantined` is not `true`.
- `source_identity` is present, uses the current SourceIdentity version, passes the platform
  allowlist, and reconstructs the same canonical URL stored in `source_url`.
- The requested `task_id`, task directory, manifest, and requested artifact paths remain beneath
  the configured task root and are not symlinks, junctions, or Windows reparse points.

Missing markers, invalid identities, malformed manifests, schema v1/v2, quarantined tasks, and
linked storage are unsupported. They are excluded without returning their source URL, error text,
directory name, or artifact contents to UI, logs, diagnostics, cache, detail, editing, or retry.

## History API

`get_history` returns only `HistoryListItem` values built from supported manifests. The list DTO
contains task id, creation time, canonical URL, status, manifest text preview, sanitized error
code, safe artifact summary, insight count, and safe task/output display paths. Listing must not
read transcript, summary, insight, transcript-metadata sidecars, or any other artifact file, and
must never start Python.

`get_history_detail(taskId)` accepts a strict task id and reads exactly one supported task after
the user selects it. Only this command may read that task's transcript text, summary, structured
insights, and manifest transcript metadata. Missing optional AI artifacts degrade to empty detail;
unsafe paths and unsupported tasks fail with fixed non-echoing errors.

The history controller owns list loading and detail request sequencing. It forwards a complete
detail to `useTaskProcessingController` only after the latest selected task finishes loading.
The workflow controller remains the sole owner allowed to install a task identity. Processing,
AI retry, and cancelling continue to make history rows read-only. A stale detail response must
not replace a newer selection or the current workflow.

## Cache, Transcript, and Retry

- Cache reuse considers only supported current manifests and canonical SourceIdentity equality.
- Transcript load/save accepts only a supported current task before touching artifacts.
- AI retry accepts only a supported current task and rereads its official validated
  `transcript/transcript.txt`.
- No path may invoke a legacy migration worker or attempt to canonicalize an old manifest.
- Reopening history repeatedly performs bounded Rust manifest reads only and creates no Python
  child process. Diagnostics may record sanitized stage name, supported/ignored counts, and
  elapsed milliseconds, but not excluded task ids, directory names, URLs, manifest fields, or
  artifact contents.

## Explicit Non-Goals

- No schema v1/v2 compatibility reader.
- No migration marker repair, manifest rewrite, index backfill, directory rename, quarantine
  mutation, or automatic deletion.
- No Python history reader or migration CLI.
- No product UI for inspecting unsupported legacy tasks.

## Acceptance

- Schema v1/v2, missing-marker, quarantined, malformed, linked, and invalid-identity fixtures are
  absent from history, cache, transcript actions, and retry without leaking fixture values.
- A supported v3 manifest appears in the list even when all listed artifact files are missing or
  very large, proving list loading is manifest-only.
- Large transcript/summary/insight fixtures are read only by `get_history_detail` for the selected
  task; another task's files remain unread.
- Two overlapping detail selections install only the newest response, while active workflow
  states still reject selection.
- First and repeated history opens start no Python process and expose only sanitized timing/count
  diagnostics.
- Existing legacy directories remain byte-for-byte untouched in temporary-directory tests.
