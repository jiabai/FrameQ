# Task Access Facade

## Status

Accepted and implemented on 2026-07-18; private physical owners implemented on 2026-07-21 without
changing the facade or behavior.

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

- Rust keeps raw `TaskManifest` and its load/path/write helpers private to the `task_manifest`
  module tree. `task_manifest.rs` is the sole crate-visible import surface; private
  `source_identity`, `schema`, `storage`, and `access` children separate policy and effects without
  becoming caller entry points.
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
- Python installs the manifest and preference snapshot through the shared atomic artifact-commit
  boundary. `finalize` registers only committed ordinary official artifacts; task-local staging
  files remain outside the manifest even if best-effort cleanup cannot remove them.
- This is an internal refactor. Manifest schema v3, desktop-worker contract v3, IPC/result DTOs,
  task identity, History output, cache matching, transcript backup behavior, and AI retry behavior
  remain unchanged.

## Alternatives considered

1. Add wrapper methods without migrating callers. Rejected because callers could continue bypassing
   the strict predicate and path validation.
2. Split manifest DTO, source policy, artifact storage, and editing before the facade was proven.
   Deferred on 2026-07-18; implemented on 2026-07-21 after callers were centralized and a
   RED/GREEN ownership gate could preserve one non-bypassable root.
3. Keep Python module-level primitives only. Rejected for production orchestration because the
   pipeline and retry service would continue to assemble different task lifecycles.

## Consequences

- A future URL/local-file manifest union changes one Rust support predicate rather than every
  History/cache/transcript/deletion caller.
- Artifact key typos become compile-time errors at application call sites.
- Python retry loads and validates one manifest instead of independently loading it twice.
- A failed manifest or snapshot replacement preserves the previous valid JSON rather than exposing
  a truncated authoritative file.
- The physical split leaves a 26-line stable root plus private source, schema, storage, and access
  owners. The ownership/dependency gate, not line count, protects the non-bypassable trust boundary.

## Verification

- Rust facade tests cover supported open/read, corrupt/unsupported scan isolation, and safe artifact
  errors that do not echo untrusted path material.
- The module-boundary test records the old-layout RED and private-tree GREEN, requires the root to
  stay below 100 lines, verifies owner dependency constraints, and recursively rejects private-child
  imports from production callers.
- Existing Rust History, cache, transcript edit/playback, deletion, privacy, and worker lifecycle
  tests remain the behavioral characterization suite.
- Python facade tests cover create/open/finalize/preference-snapshot ownership and unsupported task
  rejection without a raw manifest view.
- Full Rust and worker test suites, Rust formatting, Ruff, governance validation, and diff checks are
  required before handoff.
