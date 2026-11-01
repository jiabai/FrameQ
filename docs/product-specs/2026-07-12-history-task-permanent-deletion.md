# History Task Permanent Deletion

## Product Decision

FrameQ allows users to permanently delete a supported current History vNext task in order to
release local disk space immediately. Deletion removes the complete task directory, including
video, extracted audio, transcript text and segment data, transcript backups, AI summary,
mindmap, insights, manifest, and any other task-local artifacts. It also removes that task's
rebuildable audio-review cache.

Deletion does not use the Windows Recycle Bin or macOS Trash and cannot be undone. The product
accepts that recursive filesystem deletion is not transactional: an operating-system error,
file lock, permission change, or interruption may leave a partially deleted task. FrameQ must
report that outcome honestly and must never claim success before the task directory is absent.

## Supported Scope

Only a task already eligible for History vNext may be deleted through the product:

- `schema_version` is exactly `3`.
- `source_privacy_migration_version` is current.
- `source_privacy_quarantined` is not true.
- SourceIdentity is present, allowlisted, canonical, and agrees with `source_url`.
- The strict requested task ID, manifest, task directory, and every inspected storage entry are
  beneath the configured task root and are not symlinks, junctions, or Windows reparse points.

Unsupported legacy, malformed, quarantined, missing-marker, invalid-identity, or linked task
directories remain outside product mutation. FrameQ must not expose a legacy cleanup UI or use
deletion to scan, migrate, repair, rename, or inspect unsupported artifacts.

## User Experience

History rows expose a separate accessible delete icon; the restore/select control and delete
control must be siblings rather than nested buttons. Activating delete opens a confirmation
dialog whose default focus is Cancel and whose destructive action says `永久删除`.

The confirmation states that video, audio, transcript, AI results, and playback cache will be
deleted immediately and cannot be recovered. No task name entry is required.

Deletion is unavailable while local processing, AI generation, cancellation, transcript save,
or another deletion is active. A stable completed, partially completed, or failed task may be
deleted. If the deleted task is the task currently installed in the workspace, success closes
task-local detail/preference UI, invalidates stale operations, and returns the main workspace to
the input state. Deleting another task leaves the current workspace untouched.

Before deleting the current task, FrameQ pauses playback and releases the audio element's file
handle. This preparation does not itself reset task identity; if deletion fails, the task remains
visible and playback remains paused.

## Desktop Command Boundary

The frontend sends only a strict task ID to `delete_history_task`. It must not send a directory,
artifact path, output root, URL, manifest, PID, or deletion command. Rust acquires the global data
permit, resolves one current storage snapshot and derives all deletion paths from that snapshot
plus the validated task ID. Unavailable storage or migration exclusivity rejects the operation;
accepted deletion recovery completes before a migration inventory is prepared.

The command performs these operations in order:

1. Reject an active video/AI ProcessSupervisor lane and any overlapping delete request.
2. Strictly load and validate the current History vNext manifest.
3. Prove that the target is exactly `<output-root>/tasks/<task-id>` and is neither the output root
   nor the tasks root.
4. Reject symlink, junction, reparse-point, or otherwise linked storage before mutation.
5. Validate and remove only `<current-data-root>/cache/.frameq-audio-review/<task-id>` when present.
6. Recursively remove the validated task directory.
7. Return only the safe task ID and a completed result after the task directory no longer exists.

The implementation uses Rust filesystem APIs and never invokes a shell, PowerShell, Command
Prompt, AppleScript, Finder command, Python worker, server endpoint, LLM, or payment path.

## State and Failure Semantics

- Confirmation cancellation performs no IPC and changes no task state.
- Starting deletion invalidates pending History detail installation for that task.
- The History card remains until the command confirms success.
- Playback-cache deletion happens first because it is rebuildable. If cache deletion fails, the
  primary task directory must remain untouched.
- If primary recursive deletion fails, FrameQ reloads History from disk, retains the current
  workflow identity, and shows a fixed explanation that some files may remain or have been
  removed. The UI must not promise rollback.
- A late History detail response, transcript-save response, progress event, or worker result may
  not reinstall a task after successful deletion.
- Two delete requests are serialized. They may produce one success and one fixed unavailable/not
  found result, but must never broaden the target or affect another task.

Errors and diagnostics use fixed codes and aggregate outcomes such as `HISTORY_DELETE_BUSY`,
`HISTORY_DELETE_UNAVAILABLE`, `HISTORY_DELETE_UNSAFE_STORAGE`, and `HISTORY_DELETE_FAILED`.
They must not include task paths, URLs, manifest fields, filenames discovered during traversal,
or raw operating-system error text.

## Non-Goals

- No Recycle Bin, Trash, undo, restore, retention window, or app-owned trash directory.
- No batch deletion, select-all, automatic age-based cleanup, quota-based cleanup, or background
  deletion.
- No deletion of unsupported legacy directories.
- No permanent-delete control for the global output directory, models, settings, auth data,
  diagnostics, update state, or another task's cache.
- No change to worker, SourceIdentity, server, LLM, entitlement, billing, or payment behavior.

## Acceptance

- A supported v3 fixture loses its complete task directory and only its own playback cache.
- Another task, its cache, models, config, logs, auth state, and output root remain byte-for-byte
  untouched.
- Legacy, malformed, quarantined, traversal, symlink, junction, and reparse-point fixtures are
  rejected before filesystem mutation and without leaking fixture values.
- Active processing, AI generation, cancellation, transcript save, and duplicate deletion reject
  deletion without changing workflow identity.
- Cache deletion failure leaves the primary task intact. Injected primary deletion failure
  returns a sanitized error and tests assert the actual remaining filesystem state.
- A current stable task resets only after successful deletion; a non-current task deletion does
  not change the current workspace; failure preserves the current workflow.
- Pending detail/save callbacks cannot restore deleted task state.
- Component and Chromium tests cover accessible sibling controls, confirmation/cancel/failure,
  keyboard behavior, narrow layout, and active-state disabled copy.
