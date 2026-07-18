# Rust Worker Runtime Lifecycle Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Replace the duplicated Rust worker/model-download process lifecycles with one private,
tested `WorkerLane::run` boundary without changing Tauri commands, worker contracts, user-visible
results, artifacts, cancellation behavior, or AI billing.

**Architecture:** Split the current `worker_command.rs` responsibilities into command construction,
supervisor/process-tree state, and one supervised runner. Application modules keep cache,
entitlement, request, and result semantics but receive only typed runner outcomes and can no longer
spawn, wait, finish, or terminate worker processes directly.

**Tech Stack:** Rust 2021, Tauri 2, `std::process`, `std::sync`, Serde JSON, existing contract-backed
progress validators, Cargo tests/rustfmt, Node workflow contract tests, GitHub Actions macOS runners.

---

## Purpose / Big Picture

Users should observe no new workflow or output. Video extraction, AI retry, source cache preflight,
ASR model download, progress, cancellation, and terminal results continue to behave as documented.
Internally, every Rust-owned Python child uses one lifecycle implementation, so a future fix to a
cancellation race, progress validator, stdin cleanup, or log-redaction rule applies to every worker
operation automatically. Local media, source URLs, credentials, transcripts, prompts, generated
content, cache files, task artifacts, and model files keep their existing ownership and privacy
boundaries.

## Progress

- [x] 2026-07-18: Inspected `worker_command.rs`, the process-video/retry/source-identity flows in
  `video_processing.rs`, the ASR model-download flow, current supervisor tests, architecture rules,
  security rules, and the code-audit UML finding. Validation: direct source inspection and
  `rg -n "spawn_supervised_worker_command|ProcessSupervisor|wait_with_output" app/src-tauri/src`.
- [x] 2026-07-18: User approved a single supervised runner, closed progress routes, typed terminal
  outcomes, private low-level process operations, and a behavior-preserving staged migration.
  Validation: `docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md`.
- [x] 2026-07-18: Completed Task 1 characterization without changing production behavior. Added
  successful-exit/malformed-stdout protocol coverage and fixed public process/retry lifecycle failure
  shape coverage; the complete Rust suite passed 136/136 and rustfmt passed. Validation:
  `cargo test --manifest-path app\src-tauri\Cargo.toml` and
  `cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check`.
- [x] 2026-07-18: Established the isolated Windows Rust baseline. The first sandboxed run failed
  only because two controlled fixture tests could not invoke `taskkill`; rerunning the same tests
  with process-tree permission passed 2/2, then the complete suite passed 134/134 and rustfmt passed.
  Validation: `cargo test --manifest-path app\src-tauri\Cargo.toml` and
  `cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check`.
- [x] 2026-07-18: Completed Task 2 without lifecycle behavior changes. Extracted command
  construction into `worker_runtime/command.rs`, supervision and process-tree termination into
  `worker_runtime/supervisor.rs`, and retained temporary crate-private compatibility exports in
  `worker_runtime/mod.rs`. Focused command tests passed 5/5, supervisor tests passed 6/6, and the
  complete Rust suite passed 136/136. Validation: the Task 2 focused/full Cargo commands, rustfmt,
  responsibility-boundary `rg` scans, and `git diff --check`.
- [x] 2026-07-18: Completed Task 3 with a single tested runner boundary. Added typed operations,
  closed progress routes, terminal classification, instance-guard cleanup, concurrent stdout/stderr
  readers, fixed safe lifecycle diagnostics, and compatibility re-exports for unmigrated callers.
  Runner tests passed 10/10 and the complete Rust suite passed 146/146. Validation:
  `cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime::runner::tests`, the complete
  Cargo suite, rustfmt, and `git diff --check`.
- [x] 2026-07-18: Completed Task 4 and migrated every video-lane operation: process-video, AI retry,
  and source-identity preflight. Source preflight moved in this task so changing `video` to
  `WorkerLane` did not require exposing its internal supervisor as a temporary application bypass.
  Video adapter tests passed 16/16, runner tests passed 10/10, and the complete Rust suite passed
  146/146. Validation: the Task 4 focused/full Cargo commands and a source scan proving
  `video_processing.rs` has no raw wait, stderr reader, supervisor finish, or process termination.
- [x] 2026-07-18: Completed Task 5 by migrating ASR model download to the model progress route and
  changing both managed process slots to `WorkerLane`. Model adapter tests passed 7/7, runner tests
  passed 10/10, and the complete Rust suite passed 147/147. The model module still owns availability,
  structured message mapping, and the single synthetic cancellation event; it no longer owns raw
  spawn/register/stderr/wait/finish logic.
- [x] 2026-07-18: Completed Task 6 and closed the lifecycle boundary. Removed the compatibility
  spawn/parser/fallback/log APIs, restricted supervisor mutation and process-tree termination to
  `worker_runtime`, migrated the remaining stdin privacy/cleanup tests to `WorkerLane::run`, and
  updated the native macOS workflow contract to the split runtime files. Runtime tests passed 24/24,
  the complete Rust suite passed 141/141 without warnings, and the workflow contract passed 2/2.
  Boundary scanning found worker lifecycle primitives only under `worker_runtime`; the two
  `history_deletion.rs` `cmd.exe` matches are Windows file-lock test fixtures.

## Surprises & Discoveries

- Evidence: duplication extends beyond the two reported video paths. Source-identity preflight at
  `app/src-tauri/src/video_processing.rs` and ASR model download at
  `app/src-tauri/src/asr_model.rs` also own partial spawn/wait/finish/parse sequences.
- Evidence: `finish_retry_after_reader` and its test encode an important race rule: after the child
  exits, the supervisor must finish before a potentially slow stderr reader joins, otherwise a late
  cancel can target an already-exited operation.
- Evidence: source-identity preflight currently checks `Cancelling` before parsing stdout, while the
  documented process-supervision rule and the main process/retry paths preserve a structured result
  that wins the race. The shared runner must make this precedence explicit and tested.
- Evidence: `download_asr_model` calls the unsupervised spawn helper and then registers the PID
  separately. It has no stdin payload today, but this is still another lifecycle assembly point and
  can drift from the video lane.
- Evidence: current start logging can derive detail from raw command args and full executable/current
  directory paths. The new lifecycle boundary should log fixed `WorkerOperation` fields and treat
  sanitization as defense in depth rather than the primary privacy mechanism.
- Evidence: the original Task 1 wording expected a new source-preflight precedence test to remain
  RED and then be committed before the runner existed. A permanently failing characterization
  commit would break staged execution, so current behavior stays covered by GREEN characterization;
  the desired structured-result-first rule becomes the first RED runner test in Task 3.
- Evidence: moving the outer test module from `worker_command` to `worker_runtime` changed the exact
  subprocess fixture filter names. The stale names matched zero child tests, which surfaced as empty
  stdout, failed stdin delivery, and cancellation assertions; updating the fixed test paths restored
  all three behaviors without production changes.
- Evidence: making `tauri::Window::emit` reachable from Windows unit tests pulled GUI imports such
  as `comctl32!TaskDialogIndirect` into the manifest-free Rust test executable, which then failed at
  loader startup with `STATUS_ENTRYPOINT_NOT_FOUND`. Production routes still own `Window`; test
  builds use the same closed route discriminators with unit payloads and validate protocol routing
  without loading the GUI stack.
- Evidence: the native macOS workflow contract still opened the retired `worker_command.rs` even
  though the workflow itself runs the complete Cargo suite. The contract now verifies the real Unix
  fixture and TERM/KILL implementation in `supervisor.rs` plus production `process_group(0)` setup
  in `runner.rs`.

## Decision Log

- Decision: Introduce `worker_runtime/{command,supervisor,runner}.rs` and retire
  `worker_command.rs` after migration. Rationale: splitting by owned responsibility makes process
  lifecycle review and tests local while preserving one cohesive runtime module. Date/Author:
  2026-07-18, User + Codex.
- Decision: Keep `std::process` plus the existing Tauri `spawn_blocking` adapter. Rationale: the
  problem is ownership duplication, not a need for background persistence or a new async runtime;
  an async/actor rewrite would increase cancellation and platform risk without product benefit.
  Date/Author: 2026-07-18, User + Codex.
- Decision: Expose only `WorkerLane::run`, `WorkerLane::cancel`, and the existing activity query to
  application modules. Rationale: compiler-enforced module privacy prevents later call sites from
  rebuilding spawn/wait/finish logic. Date/Author: 2026-07-18, User + Codex.
- Decision: Use closed `WorkerOperation` and `ProgressRoute` enums rather than arbitrary callbacks
  for protocol selection and lifecycle event names. Rationale: progress validation and diagnostic
  policy are security contracts and must remain auditable. Date/Author: 2026-07-18, User + Codex.
- Decision: A valid structured worker result wins a concurrent cancellation claim for every
  operation; only an unstructured termination observed in the matching `Cancelling` phase becomes
  `Cancelled`. Rationale: this is the existing documented ProcessSupervisor contract and removes the
  source-preflight ordering inconsistency. Date/Author: 2026-07-18, User + Codex.
- Decision: Do not change the desktop-worker JSON contract or add a product specification. Rationale:
  the intended user-visible and wire behavior is unchanged; this is a Rust ownership and security
  refactor governed by the design document, architecture/security docs, and this ExecPlan.
  Date/Author: 2026-07-18, Codex.

## Outcomes & Retrospective

Current outcome: command construction, supervision, spawn/stdin/pipe ownership, progress routing,
terminal parsing, and lifecycle diagnostics now live in separate tested runtime modules. All four
operations call `WorkerLane::run`; compatibility APIs are gone, and application modules cannot
mutate `ProcessSupervisor` or terminate a process tree. Local Rust and workflow-contract gates pass.
Task 7 documentation, complete cross-stack gates, manual desktop regression, and native hosted
macOS evidence remain.

Residual risk: process cancellation is platform-sensitive. Windows unit tests cannot prove macOS
PGID/TERM/KILL delivery, so native GitHub macOS runner evidence remains mandatory even if every local
Rust test passes. The refactor must also avoid accidentally broadening lifecycle logs while moving
stderr handling.

## Context and Orientation

- Approved design: `docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md`.
- Code-audit baseline: `docs/design-docs/frameq-code-audit-uml.md`.
- Current combined runtime: `app/src-tauri/src/worker_command.rs`.
- Video, source-preflight, and retry orchestration: `app/src-tauri/src/video_processing.rs`.
- Model-download orchestration: `app/src-tauri/src/asr_model.rs`.
- Progress validation: `app/src-tauri/src/progress_event.rs`.
- Diagnostic sanitization/logging: `app/src-tauri/src/diagnostics.rs`.
- Tauri composition root/re-exports: `app/src-tauri/src/lib.rs`.
- Process/cancellation product contract:
  `docs/product-specs/2026-07-10-desktop-process-supervision-cancellation.md`.
- Architecture rules: `docs/ARCHITECTURE.md`, especially Desktop Process Supervision and
  Cancellation Boundary.
- Security rules: `docs/SECURITY.md`, especially Desktop Process-Tree Cancellation Boundary and
  Source URL Secret Boundary.
- Native macOS workflow: `.github/workflows/unix-process-supervisor.yml`.
- Workflow contract test: `scripts/tests/unix-process-supervisor-workflow.test.mjs`.

## Target File Map

- Create: `app/src-tauri/src/worker_runtime/mod.rs` for the narrow crate-visible runtime surface and
  `ProcessSupervisors`/lane composition.
- Create: `app/src-tauri/src/worker_runtime/command.rs` for invocation/spec/environment construction.
- Create: `app/src-tauri/src/worker_runtime/supervisor.rs` for state, cancellation, and platform tree
  termination.
- Create: `app/src-tauri/src/worker_runtime/runner.rs` for the complete supervised execution
  lifecycle and terminal outcome classification.
- Modify: `app/src-tauri/src/lib.rs` to register `worker_runtime` and remove low-level re-exports.
- Modify: `app/src-tauri/src/video_processing.rs` to call the lane runner for process-video,
  source-identity, and retry while retaining domain mapping.
- Modify: `app/src-tauri/src/asr_model.rs` to call the model-download lane runner.
- Modify: `app/src-tauri/src/progress_event.rs` only if a small pure routing helper is needed; do not
  weaken existing validators.
- Modify: `app/src-tauri/src/diagnostics.rs` for fixed safe lifecycle summaries and privacy tests.
- Delete: `app/src-tauri/src/worker_command.rs` only after all call sites and tests have migrated.
- Modify: `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, this ExecPlan, active/completed indexes,
  `AGENTS.md`, and `TASKS.md` during implementation closeout.

## Plan of Work

### Task 1: Freeze Lifecycle Semantics Before Moving Code

**Files:**

- Modify: `app/src-tauri/src/worker_command.rs` tests.
- Modify: `app/src-tauri/src/video_processing.rs` tests.
- Modify: `app/src-tauri/src/asr_model.rs` tests.

- [x] Record a clean baseline with the current Rust suite and rustfmt before edits.

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml
  cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
  ```

  Expected: both commands pass; record the exact test count in Progress.

- [x] Add focused behavior tests for this terminal matrix without asserting implementation file
  placement:

  ```text
  structured stdout + Running       -> Structured
  structured stdout + Cancelling    -> Structured
  malformed stdout + Cancelling     -> Cancelled
  malformed stdout + success exit   -> ProtocolViolation
  malformed stdout + failed exit    -> UnstructuredFailure
  child exited, stderr reader open   -> cancel reports NotRunning
  stale instance finish             -> cannot clear newer instance
  ```

- [x] Add adapter characterization assertions for existing public mappings:

  ```text
  process_video cancellation       -> status=failed, stage=video_extracting
  retry cancellation               -> status=partial_completed, stage=insights_generating
  source preflight ordinary failure -> cache advisory None
  model cancellation               -> status=cancelled plus validated cancellation event
  ```

- [x] Run the focused tests and require all current characterization assertions to pass. Record the
  source-preflight ordering inconsistency in Surprises & Discoveries without committing a failing
  test; Task 3 introduces the desired structured-result-first assertion against the new runner API
  and verifies RED before implementation.

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml worker_command::tests
  cargo test --manifest-path app\src-tauri\Cargo.toml video_processing::tests
  cargo test --manifest-path app\src-tauri\Cargo.toml asr_model::tests
  ```

- [x] Commit only the characterization tests and Progress evidence.

  ```powershell
  git add app/src-tauri/src/worker_command.rs app/src-tauri/src/video_processing.rs app/src-tauri/src/asr_model.rs docs/exec-plans/active/2026-07-18-rust-worker-runtime-lifecycle-refactor-plan.md
  git commit -m "test(app): characterize worker runtime lifecycle"
  ```

### Task 2: Extract Command and Supervisor Boundaries Without Behavior Change

**Files:**

- Create: `app/src-tauri/src/worker_runtime/mod.rs`.
- Create: `app/src-tauri/src/worker_runtime/command.rs`.
- Create: `app/src-tauri/src/worker_runtime/supervisor.rs`.
- Modify: `app/src-tauri/src/lib.rs`.
- Modify: `app/src-tauri/src/worker_command.rs` temporarily.

- [x] Create the `worker_runtime` module and move `WorkerInvocation`, `WorkerCommandSpec`, stdin size
  validation, environment construction, and JavaScript runtime detection into `command.rs`.

- [x] Move `ProcessPhase`, instance/cancel types, `ProcessSupervisor`, `ProcessSupervisors`, fixed
  termination command construction, process-group signalling, and their existing tests into
  `supervisor.rs`.

- [x] Keep temporary crate-private compatibility re-exports in `worker_runtime/mod.rs` so production
  call sites still compile before the runner migration. Do not duplicate any moved implementation.

- [x] Require `command.rs` to contain no `Command::spawn`, `Child`, `wait_with_output`, supervisor
  mutation, or process termination. Require `supervisor.rs` to contain no worker JSON parsing,
  progress parsing, task result, or Tauri window logic.

- [x] Run focused and full Rust gates.

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime::command::tests
  cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime::supervisor::tests
  cargo test --manifest-path app\src-tauri\Cargo.toml
  cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
  ```

- [x] Commit the responsibility-preserving extraction.

  ```powershell
  git add app/src-tauri/src/worker_runtime app/src-tauri/src/worker_command.rs app/src-tauri/src/lib.rs
  git commit -m "refactor(app): separate worker command and supervision"
  ```

### Task 3: Build the Single Supervised Runner

**Files:**

- Create: `app/src-tauri/src/worker_runtime/runner.rs`.
- Modify: `app/src-tauri/src/worker_runtime/mod.rs`.
- Modify: `app/src-tauri/src/progress_event.rs` only if required by pure routing reuse.
- Modify: `app/src-tauri/src/diagnostics.rs`.

- [x] Write RED runner tests for the complete terminal matrix, setup-error cleanup, blocked stdin
  cancellation, missing stderr, reader panic marker, finish-before-reader-join, both closed progress
  routes, and invalid progress dropping.

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime::runner::tests
  ```

  Expected: compile/test failures because `WorkerLane::run`, `WorkerRunRequest`, closed routes, and
  typed outcomes are not implemented.

- [x] Implement the design-approved crate-visible API:

  ```rust
  pub(crate) enum WorkerOperation {
      ProcessVideo,
      RetryInsights,
      ResolveSourceIdentity,
      DownloadAsrModel,
  }

  pub(crate) enum ProgressRoute {
      None,
      Worker(tauri::Window),
      AsrModelDownload(tauri::Window),
  }

  pub(crate) enum WorkerRunOutcome {
      Structured(serde_json::Value),
      Cancelled,
      UnstructuredFailure(WorkerExitSummary),
  }
  ```

- [x] Implement one runner sequence: spawn/configure, register, deliver stdin, take pipes, read
  stderr, wait, finish matching instance before reader join, parse, classify, and emit safe lifecycle
  diagnostics. Use an internal guard so every early return clears only its own instance exactly once.

- [ ] After the application migrations, keep `ProcessSupervisor::start`, `finish`, rollback, and OS
  termination accessible only inside `worker_runtime`; expose lane-level `run`, `cancel`, and
  `is_active` behavior. This privacy closeout is deferred to Task 6 while compatibility callers
  remain.

- [x] Replace raw command/path lifecycle details with fixed operation summaries. Add diagnostics tests
  containing sentinel URL, token, stdin JSON, full local path, prompt, transcript, and generated text;
  assert none survives in lifecycle logs.

- [x] Run runner, diagnostics, supervisor, and complete Rust tests until GREEN.

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime::runner::tests
  cargo test --manifest-path app\src-tauri\Cargo.toml diagnostics::tests
  cargo test --manifest-path app\src-tauri\Cargo.toml
  cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
  ```

- [x] Commit the runner before migrating application flows.

  ```powershell
  git add app/src-tauri/src/worker_runtime app/src-tauri/src/progress_event.rs app/src-tauri/src/diagnostics.rs
  git commit -m "refactor(app): add supervised worker runner"
  ```

### Task 4: Migrate Process Video and AI Retry

**Files:**

- Modify: `app/src-tauri/src/video_processing.rs`.
- Modify: `app/src-tauri/src/worker_runtime/runner.rs` tests if an application-neutral gap is found.

- [x] Change `process_video_blocking` to retain runtime setup, ASR request configuration, both cache
  checks, source preflight, and public failure construction while replacing direct child/stderr/wait/
  finish/parse code with `process_state.video.run(...)` using `WorkerOperation::ProcessVideo` and
  `ProgressRoute::Worker`.

- [x] Change `retry_insights_blocking` to retain strict request parsing, server-managed checkout,
  target/locale diagnostics, and `partial_completed` mapping while using the same lane runner with
  `WorkerOperation::RetryInsights`.

- [x] Delete the duplicated stderr reader blocks and `finish_retry_after_reader`; move its race test
  to the runner test module instead of weakening or dropping it.

- [x] Verify that structured worker success/failure still wins cancellation and that unstructured
  cancellation preserves the existing stage/status/error code for both flows.

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml video_processing::tests
  cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime::runner::tests
  cargo test --manifest-path app\src-tauri\Cargo.toml
  ```

- [x] Commit both same-lane migrations together.

  ```powershell
  git add app/src-tauri/src/video_processing.rs app/src-tauri/src/worker_runtime/runner.rs
  git commit -m "refactor(app): route video workers through shared runner"
  ```

### Task 5: Migrate Source Preflight and ASR Model Download

**Files:**

- Modify: `app/src-tauri/src/video_processing.rs`.
- Modify: `app/src-tauri/src/asr_model.rs`.
- Modify: `app/src-tauri/src/worker_runtime/runner.rs` tests.

- [x] Route source-identity preflight through `ProgressRoute::None`. Preserve ordinary preflight
  failure as cache miss/advisory `None`, but make a valid structured identity win a concurrent cancel
  claim according to the approved terminal precedence.

- [x] Route ASR model download through `process_supervisors.asr_model_download.run(...)` with
  `WorkerOperation::DownloadAsrModel` and `ProgressRoute::AsrModelDownload`.

- [x] Keep model availability checks and its product-level completed/cancelled/error mapping in
  `asr_model.rs`. Emit the existing validated synthetic cancellation event exactly once only after a
  confirmed cancelled runner outcome.

- [x] Remove the remaining application-level calls to spawn/register/wait/finish/terminate and run
  focused/full tests.

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml video_processing::tests
  cargo test --manifest-path app\src-tauri\Cargo.toml asr_model::tests
  cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime::runner::tests
  cargo test --manifest-path app\src-tauri\Cargo.toml
  cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
  ```

- [x] Commit the final production call-site migration.

  ```powershell
  git add app/src-tauri/src/video_processing.rs app/src-tauri/src/asr_model.rs app/src-tauri/src/worker_runtime/runner.rs
  git commit -m "refactor(app): unify worker and model lifecycles"
  ```

### Task 6: Close Bypass Paths and Retire `worker_command.rs`

**Files:**

- Delete: `app/src-tauri/src/worker_command.rs`.
- Modify: `app/src-tauri/src/worker_runtime/mod.rs`.
- Modify: `app/src-tauri/src/lib.rs`.
- Modify: all Rust imports identified by the boundary scan.

- [x] Remove temporary compatibility exports and expose only command construction, typed lane
  outcomes/errors, cancellation result, `ProcessSupervisors`, and the blocking adapter required by
  Tauri commands.

- [x] Make raw spawn, stdin delivery, `ProcessSupervisor` mutation, `terminate_process_tree`, and raw
  child output parsing private to `worker_runtime`.

- [x] Run this production boundary scan and require no matches outside `worker_runtime`:

  ```powershell
  rg -n "Command::new|\.spawn\(|wait_with_output|\.start\(|\.finish\(|terminate_process_tree|std::process::Child" app/src-tauri/src -g "*.rs"
  ```

  Expected: worker/model process lifecycle matches occur only under
  `app/src-tauri/src/worker_runtime/`; unrelated fixed OS commands must be reviewed explicitly rather
  than hidden by weakening the scan.

- [x] Verify source URL/stdin privacy and workflow contract tests.

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml
  node --test scripts\tests\unix-process-supervisor-workflow.test.mjs
  cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
  ```

- [x] Commit removal of the old boundary.

  ```powershell
  git add app/src-tauri/src app/src-tauri/src/lib.rs
  git commit -m "refactor(app): close worker process lifecycle boundary"
  ```

### Task 7: Documentation, Full Gates, and Native macOS Evidence

**Files:**

- Modify: `docs/ARCHITECTURE.md`.
- Modify: `docs/SECURITY.md`.
- Modify: `docs/exec-plans/active/2026-07-18-rust-worker-runtime-lifecycle-refactor-plan.md`.
- Modify: `docs/exec-plans/active/index.md` and later `docs/exec-plans/completed/index.md`.
- Modify: `AGENTS.md`.
- Modify: `TASKS.md`.

- [ ] Update architecture/security docs from planned to implemented ownership. Record that
  `WorkerLane::run` is the sole lifecycle owner and application modules cannot signal arbitrary
  processes or emit unvalidated progress.

- [ ] Run all local gates:

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml
  cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
  npm --prefix app test
  npm --prefix app run lint
  npm --prefix app run build
  node --test scripts\tests\*.test.mjs
  python scripts\validate_agents_docs.py --level WARN
  git diff --check
  git status --short
  ```

- [ ] Push the reviewed implementation branch and run `.github/workflows/unix-process-supervisor.yml`
  on that exact commit. Require the native macOS parent-plus-child process-group fixture and complete
  Rust suite to pass; record run URL, SHA, job conclusion, and test count in Progress.

- [ ] Perform a manual desktop regression on Windows: start video processing, cancel during worker
  activity, verify `cancelling` remains until terminal confirmation, verify the URL draft is retained,
  start a second task, and confirm no first-task result/progress overwrites it.

- [ ] Fill Outcomes & Retrospective with exact local/hosted evidence and residual risk, move this
  plan to `completed/`, update indexes/AGENTS/TASKS, and commit closeout documentation.

## Validation and Acceptance

The implementation is accepted only when all conditions hold:

- `process_video`, `retry_insights`, source-identity preflight, and ASR model download all use one
  `WorkerLane::run` implementation.
- No application module directly spawns, waits for, finishes, or terminates a FrameQ worker child.
- Register-before-stdin, finish-before-reader-join, matching-instance cleanup, and structured-result-
  first cancellation precedence have focused tests.
- Both progress routes validate through the closed desktop-worker contract before emitting.
- Lifecycle logs contain no stdin payload, raw args, source/local paths, URL, credential, transcript,
  prompt, preference prose, or generated body.
- Existing Tauri command names, worker invocation flags, JSON request/result/progress contracts,
  cache behavior, artifacts, model files, frontend workflow, and AI Credits behavior are unchanged.
- Full local gates and the native macOS ProcessSupervisor workflow pass on the final commit.

## Rollback Strategy

Tasks 2 through 5 are intentionally separate commits. If a migrated operation regresses, revert only
that operation's migration while keeping the tested runtime foundation; do not restore duplicate
helpers inside a partially migrated application module. Before Task 6, temporary compatibility
exports allow unmigrated operations to continue using the old path. After Task 6, rollback must
revert the boundary-closing commit together with any affected call-site migration so production
never has two owners for one operation.
