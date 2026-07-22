# Worker Atomic Artifact Commit

- Date: 2026-07-19
- Status: Phase 1 implemented; release-hardening Phase 2 planned on 2026-07-22
- Related plan: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`
- Release-hardening plan:
  `docs/exec-plans/active/2026-07-22-atomic-persistence-hardening-plan.md`

## Context

`MediaPreparationFacade` currently copies a validated download directly to the official task video
path and asks FFmpeg to write directly to the official WAV path. `TaskStoreFacade` writes
`frameq-task.json` and the preference snapshot directly and discovers artifacts through file
existence. A disk, decoder, permission, or process failure can therefore leave a truncated file at a
name that the task lifecycle treats as authoritative.

The local-media specification already requires partial media to remain unregistered until
validation. The same invariant is required for the current URL flow before contract v4 adds more
media producers.

## Decision

Introduce one small worker-owned atomic-file module with two responsibilities:

1. stage an externally produced or copied file beside its destination, preserve the destination
   suffix for media tools, flush the completed staging file, and install it with `os.replace`; and
2. serialize and atomically write UTF-8 text through the same-directory staging/replace sequence.

Media preparation follows this sequence for each official artifact:

```text
produce task-local staging file
-> flush/fsync staging bytes
-> ffprobe staging file
-> validate required streams, duration, and nonzero size
-> os.replace staging file into the official task path
```

The video and audio files are independent per-file commits, not a simulated multi-file transaction.
A failure preparing audio may leave an already validated video available, but it must never install
or register a partial WAV. Existing valid official files remain untouched until their replacement is
ready.

`TaskStoreFacade` serializes the complete manifest or preference snapshot before opening a staging
file, flushes and syncs it, and atomically replaces the destination. A failed update therefore keeps
the previous JSON intact; a failed first write leaves no authoritative JSON file. The manifest is
the final commit record for the task result.

Artifact registration accepts only committed ordinary files at known official paths. Staging names
are unique, hidden, task-local, and outside the artifact allowlist. Cleanup is best effort; a
leftover staging file is never promoted by existence scanning.

## Failure and Privacy Semantics

- Copy, staging, sync, validation, and replace failures become fixed `MediaPreparationError` codes
  and safe messages. Raw `OSError`, FFmpeg, ffprobe, source URL, and local path text do not enter the
  public result.
- Staging files are removed on every handled failure. Cleanup failure does not replace the primary
  error and does not make the file authoritative.
- `os.replace` always uses paths in the same directory. All Python file handles are closed before
  replacement so Windows can apply its normal replacement semantics.
- A successful replace is atomic visibility, while `fsync` of the staging file provides byte
  durability before installation. Parent-directory sync is attempted only where the platform
  supports opening and syncing directories.
- Cancellation and failed tasks may retain already committed artifacts under existing product
  behavior, but partial staging files are never returned or registered.

## Implemented Phase 1 Scope

This change hardens the current URL `MediaPreparationFacade`, task manifest, and preference snapshot.
It does not add local source variants, contract v4, new progress codes, transcript/AI artifact
transactions, a cleanup daemon, or a cross-file transaction protocol.

That exclusion described the completed 2026-07-19 implementation, not the final release posture.
The remaining transcript, AI, and Rust manifest/edit paths are addressed by the Phase 2 decision
below.

## 2026-07-22 Phase 2: Authoritative Persistence and Task Transactions

### Problem

The worker still writes transcript TXT/Markdown/segments and AI summary/mindmap/insight files
directly to their final names. Rust `task_manifest/storage.rs`, transcript Markdown/segments, and
transcript editing also use direct or sequential final-path writes. A write failure can therefore
truncate one file, while a crash between writes can expose a mixed revision of one logical update.

Per-file atomic replacement closes truncation but cannot by itself make several fixed paths change
at the same instant. FrameQ therefore needs two distinct guarantees:

1. **file atomicity:** every individual final file is either its previous complete bytes or its new
   complete bytes; and
2. **product transaction consistency:** FrameQ readers do not trust a partly applied multi-file
   update and deterministically roll it back or finish it before exposing the task.

### Decision

Extend the existing Python atomic-file primitive and add one equivalent Rust primitive. Both use a
unique same-directory staging file, exclusive creation, complete serialization before mutation,
file flush/sync, optional staged-content validation, atomic replacement, and best-effort parent
directory sync. Link/reparse and task-root validation happen before staging and again before
replacement where the platform permits.

The following production owners must use the primitive rather than direct final-path writes:

- Python `asr_runtime/artifacts.py`: transcript TXT, Markdown, and optional segments JSON;
- Python `insightflow/summary.py`: summary Markdown and Mermaid;
- Python `insightflow/generator.py`: insights JSON and Markdown;
- Python `task_store.py`: manifest and preference snapshot, retaining current behavior;
- Rust `task_manifest/storage.rs`: `frameq-task.json`;
- Rust `transcript_detail/edit_storage.rs` and `segments.rs`: edited transcript files, one-time
  backups, and segments.

Multi-file updates to an existing supported task use a closed task-local journal named
`.frameq-artifact-transaction.json`. Its schema version is `1`; it contains only a random transaction
ID, `prepared | committed` state, and a closed list of task-relative allowlisted destination,
staging, rollback-backup, and existed-before markers. It never contains artifact bytes, absolute
paths, URLs, credentials, transcript text, prompts, generated text, or arbitrary error prose.

The transaction sequence is:

```text
validate task + all destination paths
-> serialize/format/validate every new payload in memory
-> create same-directory staging files and rollback backups
-> atomically install a prepared journal
-> replace each destination from its complete staging file
-> atomically install the updated manifest last when it changed
-> atomically change the journal state to committed (commit point)
-> remove rollback material and journal best effort
```

The journal's `committed` state is the product commit point because a transcript edit may keep
manifest bytes unchanged. On recovery, `prepared` means restore every existed-before destination
from a preserved rollback copy and remove destinations that did not previously exist. Rollback must
copy through a new atomic staging file rather than consume the only backup, so a crash during
recovery remains retryable. `committed` means keep the installed destinations and only remove
transaction material. Recovery validates the journal and every listed relative path against a
closed destination set before touching anything; invalid or unsafe journals fail closed and remain
available for diagnosis. Closed-name orphan staging/rollback files created before journal install
are non-authoritative and removed on a later safe cleanup pass only after task-root/link validation.

Task readers must not trust a task while a transaction is unresolved. Rust task scan/open/edit and
Python task open/retry/finalize enter recovery before reading authoritative artifacts. The
implementation adds a narrow Rust per-task coordinator: direct task reads/edits acquire it, History
skips a busy task, and `retry_insights` holds the matching mutation lease across the supervised
Python child invocation. This prevents product readers from crossing an existing-task worker commit;
an app crash releases the in-process lease and leaves the journal for deterministic recovery.
Worker invocation and transcript editing remain mutually exclusive at the application layer. The
plan does not introduce a general external-program/database lock or claim consistency for programs
that open task files behind FrameQ's back.

New task creation keeps manifest-last visibility: transcript/media/AI files may be committed
individually, but the task is unsupported and absent from product History until the atomic manifest
exists. An AI retry against an existing task and a Rust transcript edit use the journal protocol
because they can replace already visible artifacts.

Summary/mindmap plus their manifest update form one target transaction; insights JSON/Markdown plus
their manifest update form another. Lower InsightFlow formatters stage/return complete payloads but
do not make an existing target visible before the task-store transaction commits. A failure in one
target must not undo a previously committed other target, preserving the existing
`partial_completed` semantics. The transaction layer does not combine an LLM request and disk commit
or retry a provider call.

### Compatibility and Failure Semantics

- Official artifact filenames, task schema v3, contract v3 URL execution, reserved local-media v4,
  History support rules, AI Credits, and public content formats stay unchanged.
- Internal staging, rollback, and journal names are outside artifact allowlists, History, task
  results, cache discovery, file-location actions, logs, and AI prompts.
- The original user-edit backup under `transcript/original/` remains a durable product feature.
  Transaction rollback copies use hidden unique internal names and are removed after recovery.
- Atomic write failure uses a fixed safe storage code. Unrecoverable or invalid journal state uses a
  separate fixed recovery code and never echoes paths or content.
- Cleanup failure after a committed state does not invalidate the user-visible save. The next safe
  recovery pass removes leftovers.
- Permanent task deletion remains explicitly non-transactional and outside this design.

### Verification Extension

- Add Python and Rust failure-injection matrices for serialize, stage, sync, validate, replace,
  journal prepare, every destination replacement, manifest replacement, commit marker, and cleanup.
- Prove every injected pre-commit failure recovers the complete previous revision and every
  post-commit failure preserves the complete new revision.
- Reject malformed, unknown-schema, linked, escaping, additional-field, duplicate-destination, and
  unsupported-destination journals without touching external paths.
- Assert production authoritative writers contain no direct final-path `write_text`, `fs::write`,
  or equivalent bypass outside the reviewed atomic modules.
- Re-run the complete worker, Rust, app, script, packaging-mirror, governance, and diff gates before
  removing the release blocker.

## Verification

- RED/GREEN tests cover copy, FFmpeg, validation, sync/replace, cleanup, and existing-file
  preservation failures.
- Manifest and preference-snapshot tests prove a failed replacement keeps the previous valid JSON.
- Artifact tests prove staging files and non-ordinary official paths are not registered.
- The focused and complete worker suites, Ruff, governance validation, and `git diff --check` are
  required before handoff.
