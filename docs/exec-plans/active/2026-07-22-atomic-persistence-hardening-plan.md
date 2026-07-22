# Atomic Persistence Hardening Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while
> implementing each task and superpowers:verification-before-completion before claiming the release
> blocker is closed. Keep this plan current after every checkpoint.

**Goal:** Make every authoritative transcript, AI, and Rust task-manifest/edit write crash-safe, and
make multi-file updates to an existing task recover to one complete committed revision.

**Architecture:** Extend the existing Python same-directory atomic writer, add a narrow Rust
equivalent, and implement one closed task-local transaction journal shared by Python worker and Rust
task access. Individual files use staging + sync + atomic replace; existing-task bundles use a
prepared/committed journal so FrameQ readers recover before trusting artifacts.

**Tech Stack:** Python 3.12, pytest, Rust/std filesystem APIs, Cargo tests, Serde, existing task
access facades, Vitest/script ownership gates, Markdown governance.

---

## Purpose / Big Picture

After this plan is complete, a power loss, full disk, process crash, or file replacement failure
cannot turn a previously usable supported task into a product-visible half revision. Users keep the
last complete transcript/AI/task state or receive the complete new one after automatic recovery;
they never need to inspect internal transaction files. No successful content bytes, task schema,
History behavior, provider calls, or AI Credits policy changes.

## Progress

- [x] 2026-07-22: Verified direct final-path writes in Python transcript/AI producers and Rust task
  manifest/transcript edit owners; confirmed existing media/worker-manifest atomic primitive covers
  only Phase 1. Validation: source inspection with `rg` plus the named production owners.
- [x] 2026-07-22: Approved the product boundary and durable Phase 2 design; registered this work as
  a broad-release blocker. Validation: documentation diff and governance index registration.
- [ ] Add RED characterization, failure-injection, and production-write ownership tests.
- [ ] Extend Python atomic writes and task transaction recovery.
- [ ] Add Rust atomic writes and task transaction recovery.
- [ ] Integrate transcript and AI target commits without changing product formats or Credits.
- [ ] Run complete local, packaging-mirror, and available native acceptance gates.

## Surprises & Discoveries

- Evidence: `worker/frameq_worker/atomic_files.py` already provides unique same-directory
  staging, file `fsync`, `os.replace`, and best-effort directory sync. Reuse and extend it rather
  than introducing another worker persistence helper.
- Evidence: `worker/frameq_worker/task_store.py` already writes `frameq-task.json` and the preference
  snapshot atomically, but
  Python transcript and AI producers bypass that helper.
- Evidence: Rust `task_manifest/storage.rs::write_task_manifest`, transcript edit storage, and
  segments still
  use direct writes. Transcript edit can change several already-visible fixed files while manifest
  bytes remain unchanged, so “manifest last” alone is not a sufficient commit marker.
- Evidence: `task_manifest/access.rs` is the existing validated supported-task entry point and is
  therefore the correct recovery gate. Recovery must not create a second
  raw-manifest or path-validation owner.

## Decision Log

- Decision: Keep official paths and task schema v3; use a task-local prepared/committed journal
  rather than versioned artifact directories. Rationale: changing artifact paths/schema immediately
  before broad release would expand History, AI, cache, locate-file, and legacy compatibility risk.
  Date/Author: 2026-07-22, User + Codex.
- Decision: The atomic journal state, not manifest byte replacement, is the existing-task commit
  point. Rationale: a transcript text edit may not change manifest artifact declarations. Date/Author:
  2026-07-22, Codex.
- Decision: Summary/mindmap and insights JSON/Markdown commit as two independent target
  transactions. Rationale: this preserves existing `partial_completed` behavior and does not roll
  back a successful target when the other target fails. Date/Author: 2026-07-22, Codex.
- Decision: Do not add a third-party filesystem transaction/locking dependency. Rationale: current
  application ownership already prevents conflicting mutations; a narrow per-task Rust guard plus
  recovery-before-read closes product-visible races without inventing a general database. Date/Author:
  2026-07-22, Codex.

## Outcomes & Retrospective

Not implemented. Completion requires recorded RED/GREEN evidence, cross-language journal fixtures,
full local gates, packaging mirror equality, and available native filesystem fault acceptance.
Residual risk: until then, interruption can still truncate or mix the currently identified
authoritative paths; external programs that bypass FrameQ task access are outside the planned
product transaction guarantee.

## Context and Orientation

- Product specification:
  `docs/product-specs/2026-07-22-release-reliability-hardening.md`.
- Durable design:
  `docs/design-docs/2026-07-19-worker-atomic-artifact-commit.md` Phase 2.
- Existing Python primitive: `worker/frameq_worker/atomic_files.py`.
- Python authoritative producers:
  `worker/frameq_worker/asr_runtime/artifacts.py`,
  `worker/frameq_worker/insightflow/summary.py`, and
  `worker/frameq_worker/insightflow/generator.py`.
- Python task access/manifest owner: `worker/frameq_worker/task_store.py`.
- Rust task trust/storage owners: `app/src-tauri/src/task_manifest/access.rs` and
  `app/src-tauri/src/task_manifest/storage.rs`.
- Rust transcript edit owners: `app/src-tauri/src/transcript_detail/edit_storage.rs` and
  `app/src-tauri/src/transcript_detail/segments.rs`.
- Canonical worker source is `worker/frameq_worker/`; the Tauri resource worker is generated and
  must never be edited directly.

## Required Invariants

- No authoritative production destination is opened for truncating write.
- Staging and rollback paths stay beside/inside the validated task directory, use unpredictable
  names, reject links/reparse points, and remain outside artifact allowlists.
- Every payload is completely serialized/formatted and validated before the first authoritative
  replacement.
- A `prepared` transaction recovers the complete previous revision; a `committed` transaction keeps
  the complete new revision.
- Recovery never interprets arbitrary paths from disk. Journal fields are closed, relative,
  normalized, deduplicated, and checked against exact supported destination patterns.
- A failed or invalid recovery never deletes source media, original transcript backups, or external
  paths and never returns raw path/content/error material.
- Existing user-visible bytes, artifact names, schemas, progress, History, cancellation, cache,
  local-media planning, provider calls, and AI Credits remain unchanged.

## Plan of Work

### Task 1: Freeze Current Bytes and Add RED Ownership Gates

**Files:**
- Create: `worker/tests/test_atomic_files.py`
- Modify: `worker/tests/test_asr.py`
- Modify: `worker/tests/test_insights.py`
- Modify: `worker/tests/test_task_store.py`
- Modify: `app/src-tauri/src/task_manifest/tests.rs`
- Modify: `app/src-tauri/src/transcript_detail/tests.rs`
- Create: `scripts/tests/atomic-persistence-boundary.test.mjs`

- [ ] Characterize exact transcript TXT/Markdown/segments, summary/mindmap, insights JSON/Markdown,
  manifest, backup, and saved-edit bytes before changing writers.
- [ ] Add a source ownership test that rejects direct authoritative `Path.write_text`, `fs::write`,
  `File::create`, or truncating `OpenOptions` in the listed production owners while allowing test
  fixtures and reviewed atomic modules.
- [ ] Add RED tests showing a simulated replace failure preserves the old destination and a failed
  first write leaves no destination.
- [ ] Run focused tests and record the expected failures in this Progress section.

### Task 2: Complete the Python Per-File Atomic Primitive

**Files:**
- Modify: `worker/frameq_worker/atomic_files.py`
- Modify: `worker/tests/test_atomic_files.py`

- [ ] Keep `staged_file` as the single low-level owner. Add byte-writing and staged-content
  validation APIs only if required; do not duplicate staging/replace logic in artifact modules.
- [ ] Reject linked/reparse/irregular destinations or parents according to the current task-root
  boundary before replacement. Preserve Windows closed-handle semantics.
- [ ] Map create/write/sync/validation/replace failures to fixed non-echoing exceptions and always
  attempt staging cleanup without replacing the primary error.
- [ ] Test existing destination, absent destination, Unicode content, JSON serialization, nonregular
  staging, sync failure, replace failure, cleanup failure, and parent-directory sync fallback.
- [ ] Run `uv run pytest worker\tests\test_atomic_files.py -q` and require GREEN.

### Task 3: Define and Cross-Test Transaction Journal v1

**Files:**
- Create: `contracts/task-artifact-transaction-v1.json`
- Create: `worker/frameq_worker/task_transaction.py`
- Create: `worker/tests/test_task_transaction.py`
- Create: `app/src-tauri/src/task_manifest/transaction.rs`
- Modify: `app/src-tauri/src/task_manifest.rs`
- Modify: `app/src-tauri/src/task_manifest/tests.rs`
- Create: `scripts/tests/task-artifact-transaction-contract.test.mjs`

- [ ] Define exact closed fields for schema version, transaction ID, state, and entries. Entries may
  contain only normalized relative destination/staging/rollback names and `existed_before`.
- [ ] Register the exact allowed destination set/patterns for transcript and AI artifacts plus
  `frameq-task.json`; forbid source media, configuration, logs, original backups, and external paths.
- [ ] Implement identical Python/Rust parse and validation semantics from shared valid/invalid JSON
  fixtures. Unknown fields/schema/state, duplicates, separators outside normalized relative paths,
  links, missing rollback files, and unsupported targets fail closed.
- [ ] Implement `prepared` rollback and `committed` cleanup idempotently. A second recovery pass must
  make no further authoritative change.
- [ ] Do not expose the raw journal DTO outside the Python task facade or Rust task-manifest module.
- [ ] Run focused Python, Rust, and script contract tests and require GREEN.

### Task 4: Move Python Transcript and AI Producers Behind Transactions

**Files:**
- Modify: `worker/frameq_worker/asr_runtime/artifacts.py`
- Modify: `worker/frameq_worker/insightflow/summary.py`
- Modify: `worker/frameq_worker/insightflow/generator.py`
- Modify: `worker/frameq_worker/pipeline_runtime/transcript.py`
- Modify: `worker/frameq_worker/pipeline_runtime/insights.py`
- Modify: `worker/frameq_worker/worker_service.py`
- Modify: `worker/frameq_worker/task_store.py`
- Modify: `worker/tests/test_asr.py`
- Modify: `worker/tests/test_insights.py`
- Modify: `worker/tests/test_pipeline.py`
- Modify: `worker/tests/test_task_store.py`

- [ ] Make transcript generation build and validate every payload before committing TXT/Markdown and
  optional segments. New task manifest remains the visibility boundary.
- [ ] Move existing-task transaction ownership high enough that the selected AI target files and
  the final manifest participate in one commit. Summary/mindmap form one target transaction and
  insights JSON/Markdown another; lower InsightFlow formatters must not commit early. Commit only
  the target that completed, preserving `partial_completed` and returned artifact maps.
- [ ] Recover an unresolved journal before Python opens, retries, or finalizes an existing task.
- [ ] Ensure an LLM response is never repeated because disk commit failed. Return the fixed storage
  error and let the user decide whether to retry.
- [ ] Add failure injection after every destination replace and both journal states; assert complete
  old/new revision, unchanged provider-call count, unchanged Credits count, and hidden internal
  files.
- [ ] Run focused worker suites and then `uv run pytest worker\tests` plus
  `uv run ruff check worker`.

### Task 5: Add Rust Atomic Manifest and Transcript Transactions

**Files:**
- Create: `app/src-tauri/src/atomic_files.rs`
- Create: `app/src-tauri/src/task_manifest/coordinator.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/src/task_manifest/storage.rs`
- Modify: `app/src-tauri/src/task_manifest/access.rs`
- Modify: `app/src-tauri/src/task_manifest/tests.rs`
- Modify: `app/src-tauri/src/video_processing/retry_insights.rs`
- Modify: `app/src-tauri/src/transcript_detail/edit_storage.rs`
- Modify: `app/src-tauri/src/transcript_detail/segments.rs`
- Modify: `app/src-tauri/src/transcript_detail/tests.rs`

- [ ] Implement one private same-directory Rust atomic writer with exclusive unique staging,
  `write_all`, `sync_all`, validation, rename/replace, parent sync where supported, and safe cleanup.
  Keep platform replacement details inside this module.
- [ ] Replace `write_task_manifest` direct writing while preserving exact pretty JSON plus newline.
- [ ] Stage transcript text, preserved-prefix Markdown, optional segments, one-time original backups,
  and manifest bytes before mutation; then commit them through journal v1.
- [ ] Add a narrow per-task Rust coordinator around recovery/read/edit and hold the matching mutation
  lease across the complete supervised `retry_insights` child invocation. History skips a busy task;
  direct open/edit returns a fixed busy result. Do not add a second global workflow lock.
- [ ] Recover before supported task scan/open/edit and skip/fail closed according to existing scan
  versus direct-open policy.
- [ ] Add Windows sharing-violation and Unix permission/fault fixtures where deterministic, plus the
  complete crash-point matrix using injected hooks rather than killing the test process.
- [ ] Run focused Rust tests, full Cargo tests, and rustfmt.

### Task 6: Close Cross-Language and Product Regression Gates

**Files:**
- Modify: `app/src/i18n/errorResources.ts`
- Modify: `app/src/i18n/errorResources.test.ts`
- Modify: `app/src/i18n/resources.test.ts`
- Modify: `app/src/workerErrorCopy.ts`
- Modify: `app/src/workerErrorCopy.test.ts`
- Modify: `app/src/features/transcript/useTranscriptDetailController.test.ts`
- Modify: `app/tests/app-input.browser.test.ts`
- Modify: this ExecPlan and release-plan evidence

- [ ] Add localized stable guidance for atomic write and recovery failures through the existing
  `errorResources` and `workerErrorCopy` mapping. Preserve sanitized technical-details behavior.
- [ ] Prove task History/detail/AI retry never lists or locates staging, journal, or rollback files.
- [ ] Prove existing task bytes and manifest schema remain compatible on all successful paths.
- [ ] Refresh the packaged worker only through the established build helper and prove recursive
  canonical/mirror equality.
- [ ] Run all validation commands below. Record exact totals, warnings, unavailable native evidence,
  and residual risk before marking this plan complete.

## Validation and Acceptance

```powershell
uv run pytest worker\tests\test_atomic_files.py worker\tests\test_task_transaction.py -q
uv run pytest worker\tests
uv run ruff check worker
cargo test --manifest-path app\src-tauri\Cargo.toml
cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
node --test scripts\tests\*.test.mjs
python scripts\validate_agents_docs.py --level WARN
node --input-type=module -e "import { prepareFreshWorkerResource } from './scripts/tauri-dev-fresh-worker.mjs'; await prepareFreshWorkerResource();"
npm --prefix app run tauri -- build --no-bundle
git diff --check
git status --short
```

Manual/native acceptance:

- Save a transcript repeatedly while exercising long text, segments present/absent, file locks, and
  forced app termination; reopen and verify one complete revision plus intact original backup.
- Generate each AI target with a fake provider, force termination at controlled commit points, and
  reopen History to verify deterministic recovery without another provider/Credits call.
- On available Windows and macOS hosts, verify replacement/recovery behavior on the actual app-local
  filesystem and record any unavailable platform explicitly.

## Release Completion Conditions

- All authoritative production writes enter reviewed atomic owners.
- Every transaction crash point recovers deterministically and idempotently.
- Full validation is GREEN and evidence is recorded here and in the active release plan.
- The atomic-persistence high-priority debt entry is moved to completed only after review.
- No tag, push, PR, or public release is part of this ExecPlan without separate authorization.
