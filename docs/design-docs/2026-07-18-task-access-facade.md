# Task Access Facade

## Status

Accepted and implemented on 2026-07-18.

## Context

Rust History, cache reuse, transcript read/edit, and deletion previously combined the same low-level
operations independently: parse `frameq-task.json`, enforce the current privacy predicate, resolve a
declared relative artifact, canonicalize it, and prove that it remains under the requested task.
This made the local-media source union risky because one caller could accept a new manifest variant
while another continued to apply URL-only assumptions.

The Python pipeline and retry application service also coordinated task creation/opening, directory
preparation, result enrichment, manifest persistence, and preference-snapshot persistence through
separate low-level calls.

## Decision

- Rust keeps raw `TaskManifest` and its load/path/write helpers private to `task_manifest.rs`.
- Rust callers enter through `SupportedTask::scan` or `SupportedTask::open`. A `SupportedTask` exists
  only after storage validation and the strict current-task predicate succeed.
- Artifact access uses the closed `TaskArtifact` enum. History receives safe declared artifacts;
  cache receives validated existing artifacts; transcript editing uses a restricted
  `TaskEditSession` that owns manifest mutation and persistence.
- Per-entry scan failures are isolated and counted. Failure to enumerate the configured task root
  remains a whole-operation error.
- Deletion and transcript playback may receive a validated task-local path capability because they
  must call filesystem APIs, but they no longer receive or mutate the raw manifest.
- Python exposes `TaskStoreFacade.create/open/finalize/save_preference_snapshot`. `OpenedTask`
  returns the validated `TaskContext` and normalized transcript metadata, not the raw manifest.
- This is an internal refactor. Manifest schema v3, desktop-worker contract v3, IPC/result DTOs,
  task identity, History output, cache matching, transcript backup behavior, and AI retry behavior
  remain unchanged.

## Alternatives considered

1. Add wrapper methods without migrating callers. Rejected because callers could continue bypassing
   the strict predicate and path validation.
2. Split manifest DTO, source policy, artifact storage, and editing into several new Rust modules in
   one change. Rejected as unnecessarily broad before the local-media source variant exists.
3. Keep Python module-level primitives only. Rejected for production orchestration because the
   pipeline and retry service would continue to assemble different task lifecycles.

## Consequences

- A future URL/local-file manifest union changes one Rust support predicate rather than every
  History/cache/transcript/deletion caller.
- Artifact key typos become compile-time errors at application call sites.
- Python retry loads and validates one manifest instead of independently loading it twice.
- `task_manifest.rs` remains physically large because DTO parsing and the facade are colocated. A
  later file split is optional; preserving one non-bypassable trust boundary is more important than
  reducing line count.

## Verification

- Rust facade tests cover supported open/read, corrupt/unsupported scan isolation, and safe artifact
  errors that do not echo untrusted path material.
- Existing Rust History, cache, transcript edit/playback, deletion, privacy, and worker lifecycle
  tests remain the behavioral characterization suite.
- Python facade tests cover create/open/finalize/preference-snapshot ownership and unsupported task
  rejection without a raw manifest view.
- Full Rust and worker test suites, Rust formatting, Ruff, governance validation, and diff checks are
  required before handoff.
