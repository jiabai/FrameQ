# Release Reliability Hardening

- Date: 2026-07-22
- Status: Proposed; implementation required before broad consumer release
- Scope: authoritative task persistence and supervised worker execution

## Summary

Before FrameQ is distributed to a broad non-technical audience, two runtime failure modes must be
closed:

1. an interrupted write must not leave a transcript, AI artifact, or task manifest truncated or in
   a product-visible mixed revision; and
2. a worker process that hangs or stops making observable progress must not keep the desktop task in
   a processing state forever.

These are release-reliability requirements, not optional refactors. The implementation is split
into two independently reviewable ExecPlans so persistence and process-lifecycle changes do not
share one large risk surface.

## User Problem

Ordinary users cannot be expected to diagnose a half-written JSON file, manually kill an orphaned
Python process, or decide whether a task that has shown the same progress for hours is still safe.
Power loss, forced shutdown, full disks, antivirus/file locks, native-library hangs, broken network
calls, and child-process bugs are normal operating conditions at consumer scale.

Without hardening, those conditions can produce one of two bad experiences:

- a previously usable task becomes unreadable, or different files describe different revisions;
- the UI remains busy indefinitely and blocks retry, cancellation, or the next task.

## Product Requirements

### Authoritative persistence

- Every authoritative text/JSON artifact is installed through a same-directory staging file,
  flush/sync, validation where applicable, and atomic replacement. Production code must not write
  directly to its final authoritative path.
- The protected set includes worker transcript TXT/Markdown/segments, summary/mermaid, insight
  JSON/Markdown, preference snapshot, `frameq-task.json`, and Rust transcript-edit outputs.
- A failed replacement keeps the previous valid file. A failed first write leaves no authoritative
  final file.
- A new task remains product-invisible until its atomically written manifest records only completed
  artifacts.
- A multi-file update to an existing task uses one task-local transaction journal and recovery
  protocol. Product readers must see either the previous committed revision or the new committed
  revision after recovery, never trust an unfinished revision, and never expose staging/journal
  files as artifacts.
- The transaction protocol keeps the current official artifact paths and task manifest schema. It
  does not silently migrate or reinterpret unsupported legacy tasks.
- One-time user transcript backups remain independent recovery artifacts and must not be confused
  with internal transaction rollback files.
- Recovery is automatic on the next supported task open/edit/scan or worker task access. If safe
  recovery cannot be completed, the task fails closed with a stable non-echoing code and leaves
  source media and previous recovery material untouched.

### Worker watchdog

- The Rust `worker_runtime` owns all worker deadlines because it already owns spawn, registration,
  cancellation, process-tree termination, wait/reap, and terminal classification.
- Every semantic `WorkerJob` and ASR model-download operation receives a closed internal timeout
  policy. React, Tauri command callers, request JSON, and Python must not supply arbitrary timeout
  values.
- The watchdog uses a monotonic clock and distinguishes:
  - an idle deadline for operations with validated progress, based only on validated progress
    activity; and
  - an absolute hard deadline that cannot be extended by output or progress.
- The source-identity preflight has no progress protocol and therefore uses only a short absolute
  deadline.
- When a deadline expires, FrameQ terminates and reaps the complete supervised process tree using
  the existing Windows/macOS cancellation primitives, clears only the matching supervisor
  instance, and returns a distinct timeout result.
- A valid structured terminal result observed at the timeout boundary wins. Otherwise the first
  terminal claim between explicit user cancellation and timeout determines the result; stale
  watchdogs must never terminate a newer worker instance.
- A timeout never triggers an automatic LLM retry, never spends another AI Credit, and never
  deletes already committed local artifacts.

## Initial Timeout Policy

The initial release uses conservative fixed limits. They are internal constants with test-only
injection, not user settings or wire fields.

| Operation | Idle deadline | Absolute deadline |
|---|---:|---:|
| URL/local media processing | 45 minutes without validated progress | 8 hours |
| Summary or inspiration generation | 10 minutes without validated progress | 30 minutes |
| Source-identity preflight | Disabled because the route emits no progress | 3 minutes |
| ASR model download | 10 minutes without validated download progress | 4 hours |

The future local-media worker job inherits the media-processing policy when its runtime variant is
implemented. Changing production values requires a documented reliability decision and focused
tests; it must not require a desktop-worker contract change.

## User-Visible Failure Behavior

- Task processing timeout: the task leaves its busy state and shows localized guidance that the
  worker exceeded its safe execution time and may be retried.
- AI timeout: the task remains `partial_completed`; the local transcript and any previously
  committed AI target remain available. The user chooses whether to retry.
- Model-download timeout: the download leaves its busy state, preserves any non-authoritative
  resumable bytes under the existing model-download policy, and offers retry.
- Persistence/recovery failure: FrameQ must not claim that a save succeeded. The previous committed
  task remains preferred; if recovery is not provably safe, task access fails closed and offers
  localized guidance plus sanitized technical details.
- Stable public codes distinguish idle timeout, absolute timeout, atomic write failure, and
  transaction recovery failure. Raw paths, request bodies, URLs, credentials, transcripts,
  prompts, generated text, and operating-system error prose are never primary UI content.

## Acceptance Criteria

- Failure injection before and after every stage/write/replace/commit-marker step proves that a
  supported task recovers to one complete revision.
- Corrupt, linked, escaping, unknown-version, and path-containing transaction journals fail closed
  without touching external paths.
- Existing valid files survive ENOSPC, permission, sharing-violation, serialization, validation,
  replace, and simulated process-crash failures.
- Watchdog tests use injected short durations and deterministic clocks/signals; the production test
  suite never waits for real minute/hour deadlines.
- Tests cover blocked stdin delivery, silent worker, progress-then-stall, endless valid progress,
  normal completion, malformed output, cancellation/timeout races, stale instance IDs, reader
  cleanup, and descendant-process termination.
- Windows and macOS native-host validation confirms that timed-out parent and child processes are
  gone and a second task can start.
- Existing contracts, task manifest schema, artifact names, cancellation behavior, AI Credits,
  cache behavior, History support predicate, local-media v4 planning, and user content remain
  unchanged except for the new fixed failure outcomes.

## Release Gate

Broad consumer publication is blocked until both linked ExecPlans are implemented, reviewed, and
their automated and available native acceptance evidence is recorded in the active release plan.
An unavailable macOS or Windows environment must be recorded as unverified residual risk, not
treated as a pass.

The server's OTP/ticket/quota concurrency and production operations boundary is a separate release
blocker. This specification does not claim to make server-side check-then-write flows atomic.

## Non-Goals

- No background task queue, worker restart/resume after app relaunch, distributed transaction,
  database migration, new dependency, user-configurable timeout, or automatic retry.
- No translation or rewriting of historical user content.
- No change to permanent task deletion's explicitly accepted non-transactional semantics.
- No implementation of the planned local-media runtime in these reliability plans.
