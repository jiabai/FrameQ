# Rust Worker Runner Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Use superpowers:test-driven-development for characterization and the ownership
> RED/GREEN gate, and use superpowers:verification-before-completion before claiming completion.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 2,162-line Rust worker runner into private process-I/O, watchdog, progress, and
terminal owners behind the unchanged `WorkerLane` lifecycle surface without changing worker
behavior, concurrency, protocol handling, diagnostics, or application callers.

**Architecture:** `worker_runtime/runner.rs` remains the sole lifecycle orchestrator and the source
of every existing `super::runner::*` path. Four private child modules own narrow implementation
details; topic-focused tests move under `runner/tests/`. The two existing model-download progress
transport constants move unchanged to `progress_event.rs` and remain available from
`asr_model.rs` by re-export, preventing the progress child from importing an application module.
`supervisor.rs` remains the only OS process-tree signalling implementation, while the runner root
alone chooses spawn/register/stdin/read/wait/finish/classify order.

**Tech Stack:** Rust 2021, Tauri v2 `Window`/`Emitter`, Serde JSON, standard-library
`Command`/threads/synchronization, Cargo tests, rustfmt, Node test runner, existing FrameQ
architecture/security/governance documents.

---

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds. Do not implement production
> changes, create implementation commits, merge, push, or clean up the worktree without the
> corresponding user authorization.

## Purpose / Big Picture

FrameQ users should observe no change. Process-video, source preflight, AI retry, and ASR model
download continue using the same operation-specific command, stdin, progress, timeout, cancellation,
terminal-result, and error behavior. Existing task artifacts, AI Credits, UI state, and local-first
privacy boundaries remain unchanged.

The improvement is internal: process I/O, watchdog timing, progress validation, and terminal
classification become separately reviewable without creating another executor. The accepted
`WorkerLane` and `VideoWorkerFacade` boundaries remain the only lifecycle/semantic entries.

This plan does not implement local-media import, alter a worker contract, change timeout values,
redesign `ProcessSupervisor`, add a runtime dependency, update a product specification, or change a
user-visible error.

## Progress

- [x] 2026-07-23: Re-inspected the current `runner.rs`, all direct worker-runtime callers, the
  lifecycle/watchdog designs, architecture/security invariants, existing module-boundary tests, and
  the hosted macOS ProcessSupervisor source gate. Validation: source maps and caller searches
  recorded the current 2,162-line root, 1,006-line production region, 1,156-line inline test region,
  and 26 runner tests.
- [x] 2026-07-23: User approved the private-owner approach and the detailed design; an accuracy
  review corrected dependency edges, Rust visibility, stderr/stdout reader behavior, termination
  provenance, and test seams. Validation: design commits `3a3d532` and `4b2f241`; governance
  reported 0 errors / 0 warnings.
- [x] 2026-07-23: Established the focused behavior baseline under normal Windows process
  permissions. Validation: `cargo test --manifest-path app/src-tauri/Cargo.toml
  worker_runtime::runner::tests` passed 26/26 with 182 filtered tests.
- [x] 2026-07-23: Registered this active ExecPlan in `AGENTS.md`, `TASKS.md`, and
  `docs/exec-plans/active/index.md`; corrected the design/plan to place the two existing
  model-download progress transport constants in `progress_event.rs` rather than allowing the new
  progress child to depend on `asr_model.rs`. Validation: governance reported 0 errors / 0
  warnings; required-section, placeholder, balanced-fence, type/path/scope, tracked-diff, and new
  file whitespace checks passed.
- [x] 2026-07-23: User reviewed and approved this ExecPlan. Validation: approval was explicitly
  recorded in the Codex thread; test and production implementation remain pending separate start
  authorization.
- [ ] Task 1 locks stdout-reader failure behavior and records the final ownership RED. Validation:
  the new behavior test passes, all 27 non-boundary runner tests pass, and the boundary test fails
  only because the approved owner tree is absent.
- [ ] Tasks 2-4 extract watchdog, progress, and terminal owners move-first while all 27
  non-boundary runner tests remain green after each task.
- [ ] Task 5 extracts process-I/O helpers, moves tests by topic, updates the hosted-workflow source
  test, and turns the ownership gate GREEN. Validation: all 28 runner tests and the focused Node
  workflow test pass.
- [ ] Task 6 completes full regression, protected-scope proof, durable documentation, plan
  archival, and exact residual-risk recording.

## Surprises & Discoveries

- `runner.rs` is 2,162 physical lines, not the 1,144 lines previously recorded by the audit. Lines
  1-1,006 are production and lines 1,007-2,162 are the inline test module.
  Evidence: `Get-Content app/src-tauri/src/worker_runtime/runner.rs` and the corrected
  `docs/design-docs/frameq-code-audit-uml.md`.
- `WorkerOperation::watchdog_policy()` is not purely local to runner tests. `facade.rs` tests call it
  and inspect the inferred `WatchdogPolicy` through idle/absolute accessors.
  Evidence: `app/src-tauri/src/worker_runtime/facade.rs`, lines 132-149.
- A child-level `pub(super)` is narrower than the current runner-level `pub(super)`.
  `WatchdogPolicy` moved into `runner/watchdog.rs` therefore needs
  `pub(in crate::worker_runtime)` plus a root re-export to preserve the existing effective test
  surface. `ProgressRoute` and `WorkerExitSummary` retain their current `pub(crate)` definitions
  behind a private child path.
- Stderr and stdout reader failures have different current behavior. A stderr reader failure/panic
  retains terminal classification with `stderr=reader_failed`; a stdout reader join/read failure
  finishes the lane and returns fixed `ProtocolViolation` / `Worker stdout reader failed.` before
  terminal classification.
  Evidence: `runner.rs` lines 716-743 and
  `stderr_reader_panic_keeps_terminal_outcome_and_uses_fixed_marker`.
- The progress owner needs the watchdog's validated-activity seam and the terminal owner needs the
  progress owner's fixed `StderrSummary`; terminal safe-start formatting also depends on
  `command::js_runtime_diagnostics`. These are deliberate one-way private dependencies, not new
  application surfaces.
- `scripts/tests/unix-process-supervisor-workflow.test.mjs` directly searches `runner.rs` for
  `configure_child_process_group` and the watchdog parent/descendant test. It must follow the moved
  production/test owners or the unchanged hosted workflow gate will fail for a stale path.
- Current progress routing directly references
  `asr_model::{ASR_MODEL_DOWNLOAD_EVENT_NAME, MODEL_DOWNLOAD_EVENT_PREFIX}`. Copying those strings
  into `runner/progress.rs` would create a second protocol owner, while retaining the import would
  violate the approved no-application-child dependency. Moving the definitions unchanged to
  `progress_event.rs` and re-exporting them from `asr_model.rs` resolves the existing boundary debt
  without changing values, callers, events, or product behavior.
- A child rejected because another lane instance is already running is spawned before
  `ProcessSupervisor::start` returns `None`. Its termination target comes from that runner-owned
  `Child::id()` rather than the active supervisor record. Every other cleanup/cancel/timeout target
  comes from a matching `ProcessInstance`; none comes from IPC, worker output, task data, or logs.
- The cold sandboxed focused command reached 14 passing tests but exceeded the 121-second tool
  limit after dependency compilation. The identical already-built command passed 26/26 in 13.2
  seconds with normal Windows process permissions, including blocked-stdin and parent/descendant
  termination fixtures.

## Decision Log

- Decision: Keep `runner.rs` as the sole lifecycle orchestrator and extract only private
  `process_io`, `watchdog`, `progress`, and `terminal` owners. Rationale: the current facade,
  supervisor, and result-protocol boundaries are correct; a second executor or state machine would
  change resource ownership and race behavior. Date/Author: 2026-07-23, User + Codex.
- Decision: Preserve every existing runner-facing type path and effective visibility through narrow
  root re-exports. Rationale: `facade.rs`, `result_protocol.rs`, `worker_runtime/mod.rs`, and
  test-only application adapters must compile unchanged, while private child paths must not become
  caller surfaces. Date/Author: 2026-07-23, User + Codex.
- Decision: Put `StderrSummary` and its fixed marker in `progress.rs`; let `terminal.rs` consume it.
  Rationale: the summary is produced by stderr reading, and this creates a one-way
  terminal-to-progress dependency rather than making progress depend on terminal policy.
  Date/Author: 2026-07-23, Codex.
- Decision: Add a stdout-reader failure characterization before moving production code. Rationale:
  stderr panic is covered, but the distinct fixed stdout protocol-error branch currently has no
  direct regression test. Date/Author: 2026-07-23, Codex.
- Decision: Keep `WorkerTimeoutKind`, `WorkerOperation`, request/error/outcome types,
  `WorkerLane`, `InstanceGuard`, `RunnerHooks`, and `ReaderJoinGate` in the root. Rationale: they are
  stable orchestration/coordination types and retaining them keeps the root as the only lifecycle
  owner while staying below the approved 500-line review alarm. Date/Author: 2026-07-23, Codex.
- Decision: Move production code before physically relocating tests, run the unchanged focused
  tests after every owner extraction, and defer the one-time test-tree move until all four private
  owner paths exist in Task 5. Rationale: behavior regressions must stop each extraction, while
  moving the test module repeatedly would create import-path churn unrelated to behavior; the
  exact-tree test remains intentionally RED until the complete owner and test trees exist.
  Date/Author: 2026-07-23, Codex.
- Decision: Update the existing Node macOS-workflow source assertion to the new private owners
  without changing `.github/workflows/unix-process-supervisor.yml`. Rationale: the workflow and
  hosted behavior are unchanged; only the test's source locations move. Date/Author: 2026-07-23,
  Codex.
- Decision: Move the two model-download progress transport constants unchanged from `asr_model.rs`
  to `progress_event.rs`, with a crate-visible `asr_model.rs` re-export preserving the former path.
  Rationale: progress parsing already depends on the values, and the approved child dependency
  direction forbids importing an application module or duplicating protocol strings.
  Date/Author: 2026-07-23, Codex.
- Decision: Do not update a product specification. Rationale: the plan changes no user-visible
  behavior, wire contract, artifact, timeout, event, error, or supported platform.
  Date/Author: 2026-07-23, User + Codex.

## Outcomes & Retrospective

Planning outcome only: the approved design has been converted into six implementation batches with
explicit RED/GREEN evidence, symbol ownership, caller/visibility constraints, platform process
tests, rollback points, and documentation closeout. Production and test implementation has not
started.

Residual risk at planning time: Rust source-boundary assertions can prove physical ownership and
forbidden imports, but they cannot prove semantic equivalence by themselves. Existing behavior,
process-tree, progress, terminal, and cross-layer tests remain mandatory after every move. Native
macOS execution is not available in the current Windows workspace and must remain unverified unless
the unchanged hosted workflow is run for the implementation commit.

## Context and Orientation

- Approved design:
  `docs/design-docs/2026-07-23-rust-worker-runner-module-split.md`.
- Stable lifecycle root and current tests:
  `app/src-tauri/src/worker_runtime/runner.rs`.
- Fixed command/environment construction:
  `app/src-tauri/src/worker_runtime/command.rs`.
- Semantic video-job facade:
  `app/src-tauri/src/worker_runtime/facade.rs`.
- Closed stdout terminal parser:
  `app/src-tauri/src/worker_runtime/result_protocol.rs`.
- Instance state, cancellation/timeout claims, and OS process-tree signalling:
  `app/src-tauri/src/worker_runtime/supervisor.rs`.
- Runtime root/re-exports and model-download lane:
  `app/src-tauri/src/worker_runtime/mod.rs`.
- Progress payload validators:
  `app/src-tauri/src/progress_event.rs`.
- Model-download application mapping and compatibility re-export:
  `app/src-tauri/src/asr_model.rs`.
- Application result consumers:
  `app/src-tauri/src/asr_model.rs` and `app/src-tauri/src/video_processing/`.
- Hosted macOS workflow source assertion:
  `scripts/tests/unix-process-supervisor-workflow.test.mjs`.
- Durable lifecycle/watchdog decisions:
  `docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md` and
  `docs/design-docs/2026-07-22-rust-worker-watchdog.md`.
- Durable architecture/security:
  `docs/ARCHITECTURE.md`, section `2026-07-10 Desktop Process Supervision and Cancellation
  Boundary`, and `docs/SECURITY.md`, section `2026-07-10 Desktop Process-Tree Cancellation
  Boundary`.
- Current structural audit:
  `docs/design-docs/frameq-code-audit-uml.md`.

## Target File Responsibility Map

| File | Responsibility after implementation |
|---|---|
| `app/src-tauri/src/worker_runtime/runner.rs` | stable runner-facing types/re-exports, `WorkerLane`, lifecycle order, instance guard, test-hook composition |
| `app/src-tauri/src/worker_runtime/runner/process_io.rs` | process-group setup, fixed-spec spawn, stdin delivery, stdout read helper, matching-child terminate/reap cleanup |
| `app/src-tauri/src/worker_runtime/runner/watchdog.rs` | operation-owned timeout policy, deadlines, validated activity, watchdog thread/handle, timeout claim/retry |
| `app/src-tauri/src/worker_runtime/runner/progress.rs` | `ProgressRoute`, progress protocol/record, stderr reader, `StderrSummary`, validation, safe invalid-event logging, emission |
| `app/src-tauri/src/worker_runtime/runner/terminal.rs` | safe start/exit details, closed terminal classification, `WorkerExitSummary` |
| `app/src-tauri/src/worker_runtime/runner/tests.rs` | test-module declarations, exact-tree/ownership/dependency test |
| `app/src-tauri/src/worker_runtime/runner/tests/fixtures.rs` | cross-platform command/scripts, requests, runtime paths, wait helpers, exit status |
| `app/src-tauri/src/worker_runtime/runner/tests/lifecycle.rs` | spawn/pipe/wait/stdin/reader/lane cleanup behavior |
| `app/src-tauri/src/worker_runtime/runner/tests/watchdog.rs` | policy, activity, timeout, stale-instance, process-tree behavior |
| `app/src-tauri/src/worker_runtime/runner/tests/progress.rs` | progress protocol validation/routing behavior |
| `app/src-tauri/src/worker_runtime/runner/tests/terminal.rs` | structured/cancel/timeout precedence, terminal matrix, safe diagnostics |
| `app/src-tauri/src/progress_event.rs` | existing progress validation plus the unchanged model-download event name/prefix definitions |
| `app/src-tauri/src/asr_model.rs` | existing model-download behavior plus a compatibility re-export of those two constants |
| `scripts/tests/unix-process-supervisor-workflow.test.mjs` | unchanged hosted workflow assertions pointed at the new process-I/O and watchdog-test owners |

The only production changes outside `runner.rs` and
`runner/{process_io,watchdog,progress,terminal}.rs` are the two constant definitions moving to
`progress_event.rs` and their compatibility re-export in `asr_model.rs`. All other application
behavior/callers, `command.rs`, `facade.rs`, `result_protocol.rs`, `supervisor.rs`,
`worker_runtime/mod.rs`, `lib.rs`, Tauri registration, Cargo/package manifests, Python worker,
contracts, server, and frontend production files are protected scope.

## Stable Root Shape

The final root must remain equivalent to this ownership surface, with imports and rustfmt formatting
adjusted as required:

```rust
mod process_io;
mod progress;
mod terminal;
mod watchdog;

#[cfg(test)]
mod tests;

pub(crate) use progress::ProgressRoute;
pub(crate) use terminal::WorkerExitSummary;
pub(super) use watchdog::WatchdogPolicy;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WorkerOperation {
    ProcessVideo,
    RetryInsights,
    ResolveSourceIdentity,
    DownloadAsrModel,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WorkerTimeoutKind {
    Idle,
    Absolute,
}

pub(crate) struct WorkerRunRequest {
    pub(crate) operation: WorkerOperation,
    pub(crate) command: WorkerCommandSpec,
    pub(crate) progress: ProgressRoute,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WorkerRunErrorKind {
    AlreadyRunning,
    SpawnFailed,
    WatchdogStartFailed,
    RequestDeliveryFailed,
    PipeUnavailable,
    WaitFailed,
    ProtocolViolation,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct WorkerRunError {
    pub(crate) kind: WorkerRunErrorKind,
    pub(crate) detail: &'static str,
}

#[derive(Debug, PartialEq)]
pub(crate) enum WorkerRunOutcome {
    Structured(ValidatedWorkerResult),
    Cancelled,
    TimedOut(WorkerTimeoutKind),
    UnstructuredFailure(WorkerExitSummary),
}

#[derive(Default)]
pub(crate) struct WorkerLane {
    supervisor: Arc<ProcessSupervisor>,
}
```

`WorkerOperation::as_str/event`, `WorkerTimeoutKind::as_str`,
`WorkerOperation::watchdog_policy`, `WorkerRunError` constructors, `WorkerLane` methods,
`InstanceGuard`, `RunnerHooks`, and `ReaderJoinGate` remain root implementation. The watchdog-policy
method may be implemented in `watchdog.rs`, but its method path and effective
`crate::worker_runtime` test visibility remain unchanged.

## Plan of Work

### Task 1: Lock Stdout Reader Failure and the Final Ownership Boundary

**Files:**

- Modify: `app/src-tauri/src/worker_runtime/runner.rs` test hook and inline test module only

- [ ] Add `stdout_reader_panic_finishes_lane_and_returns_fixed_protocol_error` before changing the
  stdout reader. The test uses the existing terminal fixture and asserts the current fixed result:

  ```rust
  #[test]
  fn stdout_reader_panic_finishes_lane_and_returns_fixed_protocol_error() {
      let lane = WorkerLane::default();
      let paths = test_paths("stdout-reader-panic");
      let error = lane
          .run_with_hooks(
              &paths,
              terminal_fixture_request(None, false),
              RunnerHooks {
                  panic_stdout_reader: true,
                  ..RunnerHooks::default()
              },
          )
          .expect_err("stdout reader panic must remain a protocol error");

      assert_eq!(error.kind, WorkerRunErrorKind::ProtocolViolation);
      assert_eq!(error.detail, "Worker stdout reader failed.");
      assert!(!lane.is_active());
  }
  ```

- [ ] Run the single new test before adding the hook:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml stdout_reader_panic_finishes_lane
  ```

  Expected RED: Rust reports that `RunnerHooks` has no field named `panic_stdout_reader`. Any
  unrelated compile/test failure must be fixed or returned to review before proceeding.

- [ ] Add only the private test hook and forced panic branch:

  ```rust
  #[derive(Clone, Default)]
  struct RunnerHooks {
      force_missing_stderr: bool,
      force_wait_failure: bool,
      panic_stdout_reader: bool,
      panic_stderr_reader: bool,
      reader_join_gate: Option<ReaderJoinGate>,
      #[cfg(test)]
      watchdog_policy: Option<WatchdogPolicy>,
      #[cfg(test)]
      watchdog_retry_backoff: Option<Duration>,
      #[cfg(test)]
      force_watchdog_start_failure: bool,
  }

  let panic_stdout_reader = hooks.panic_stdout_reader;
  let stdout_reader = std::thread::spawn(move || {
      if panic_stdout_reader {
          panic!("forced stdout reader failure");
      }
      let mut stdout = stdout;
      let mut bytes = Vec::new();
      stdout.read_to_end(&mut bytes).map(|_| bytes)
  });
  ```

  Do not add an IPC/config/environment input, production setter, new error, or alternate terminal
  path.

- [ ] Re-run the new test and the existing stderr-reader test:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml stdout_reader_panic_finishes_lane
  cargo test --manifest-path app/src-tauri/Cargo.toml stderr_reader_panic_keeps_terminal_outcome
  ```

  Expected GREEN: 1/1 for each filter. Stdout returns the fixed protocol error after clearing the
  lane; stderr retains the structured result and fixed marker.

- [ ] Add `collect_runner_rust_sources` and
  `worker_runner_module_boundary_matches_approved_private_owners` to the inline test module:

  ```rust
  fn collect_runner_rust_sources(dir: &Path, sources: &mut Vec<PathBuf>) {
      for entry in std::fs::read_dir(dir).expect("read Rust source directory") {
          let path = entry.expect("read Rust source entry").path();
          if path.is_dir() {
              collect_runner_rust_sources(&path, sources);
          } else if path.extension().and_then(|value| value.to_str()) == Some("rs") {
              sources.push(path);
          }
      }
  }

  fn direct_rust_file_names(dir: &Path) -> Vec<String> {
      let mut names = std::fs::read_dir(dir)
          .expect("read Rust owner directory")
          .map(|entry| entry.expect("read Rust owner entry").path())
          .filter(|path| path.is_file())
          .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("rs"))
          .map(|path| {
              path.file_name()
                  .and_then(|value| value.to_str())
                  .expect("UTF-8 Rust file name")
                  .to_string()
          })
          .collect::<Vec<_>>();
      names.sort();
      names
  }

  #[test]
  fn worker_runner_module_boundary_matches_approved_private_owners() {
      let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
      let runtime_dir = src.join("worker_runtime");
      let root_path = runtime_dir.join("runner.rs");
      let module_dir = runtime_dir.join("runner");
      let root = std::fs::read_to_string(&root_path).expect("read runner root");
      let progress_event = std::fs::read_to_string(src.join("progress_event.rs"))
          .expect("read shared progress boundary");
      let asr_model =
          std::fs::read_to_string(src.join("asr_model.rs")).expect("read ASR model owner");
      let process_io = std::fs::read_to_string(module_dir.join("process_io.rs"))
          .expect("read process I/O owner");
      let watchdog = std::fs::read_to_string(module_dir.join("watchdog.rs"))
          .expect("read watchdog owner");
      let progress = std::fs::read_to_string(module_dir.join("progress.rs"))
          .expect("read progress owner");
      let terminal = std::fs::read_to_string(module_dir.join("terminal.rs"))
          .expect("read terminal owner");

      assert_eq!(
          direct_rust_file_names(&module_dir),
          vec![
              String::from("process_io.rs"),
              String::from("progress.rs"),
              String::from("terminal.rs"),
              String::from("tests.rs"),
              String::from("watchdog.rs"),
          ]
      );
      assert_eq!(
          direct_rust_file_names(&module_dir.join("tests")),
          vec![
              String::from("fixtures.rs"),
              String::from("lifecycle.rs"),
              String::from("progress.rs"),
              String::from("terminal.rs"),
              String::from("watchdog.rs"),
          ]
      );

      assert!(root.lines().count() <= 500, "runner root exceeds 500 lines");
      for (name, source) in [
          ("process_io", process_io.as_str()),
          ("watchdog", watchdog.as_str()),
          ("progress", progress.as_str()),
          ("terminal", terminal.as_str()),
      ] {
          assert!(
              source.lines().count() <= 400,
              "{name} exceeds the approved 400-line review alarm"
          );
      }
      for relative in [
          "tests.rs",
          "tests/fixtures.rs",
          "tests/lifecycle.rs",
          "tests/progress.rs",
          "tests/terminal.rs",
          "tests/watchdog.rs",
      ] {
          let source = std::fs::read_to_string(module_dir.join(relative))
              .unwrap_or_else(|_| panic!("read test owner {relative}"));
          assert!(
              source.lines().count() <= 500,
              "{relative} recreates a test hotspot"
          );
      }

      for module in [
          "process_io",
          "progress",
          "terminal",
          "watchdog",
          "tests",
      ] {
          let declaration = format!("mod {module};");
          assert!(
              root.lines().any(|line| line.trim() == declaration.as_str()),
              "missing private {declaration}"
          );
      }
      assert!(root.contains("pub(crate) use progress::ProgressRoute;"));
      assert!(root.contains("pub(crate) use terminal::WorkerExitSummary;"));
      assert!(root.contains("pub(super) use watchdog::WatchdogPolicy;"));

      for moved in [
          "fn configure_child_process_group",
          "struct WatchdogControl",
          "pub(crate) enum ProgressRoute",
          "fn read_stderr",
          "fn safe_start_log_detail",
          "fn classify_terminal",
      ] {
          assert!(!root.contains(moved), "runner root still owns {moved}");
      }
      assert!(root.contains("pub(crate) struct WorkerLane"));
      assert!(root.contains("fn run_inner"));
      assert!(root.contains("struct InstanceGuard"));
      assert!(root.contains("struct RunnerHooks"));

      for required in [
          "pub(super) fn configure_child_process_group",
          "pub(super) fn spawn_worker_process",
          "pub(super) fn deliver_worker_stdin",
          "pub(super) fn read_worker_stdout",
          "pub(super) fn terminate_and_reap",
          "pub(super) fn cleanup_registered_child",
      ] {
          assert!(process_io.contains(required), "process_io missing {required}");
      }
      for required in [
          "pub(in crate::worker_runtime) struct WatchdogPolicy",
          "pub(in crate::worker_runtime) fn idle_timeout",
          "pub(in crate::worker_runtime) fn absolute_timeout",
          "pub(in crate::worker_runtime) fn watchdog_policy",
          "pub(super) struct WatchdogControl",
          "pub(super) fn record_validated_progress",
          "pub(super) struct WatchdogHandle",
          "pub(super) fn start_watchdog",
          "pub(super) fn run_watchdog_with_terminator",
      ] {
          assert!(watchdog.contains(required), "watchdog missing {required}");
      }
      for required in [
          "pub(crate) enum ProgressRoute",
          "pub(super) struct StderrSummary",
          "pub(super) fn read_stderr",
          "pub(super) fn inspect_progress_line",
      ] {
          assert!(progress.contains(required), "progress missing {required}");
      }
      for required in [
          "pub(crate) struct WorkerExitSummary",
          "pub(super) fn safe_start_log_detail",
          "pub(super) fn safe_exit_log_detail",
          "pub(super) fn classify_terminal",
      ] {
          assert!(terminal.contains(required), "terminal missing {required}");
      }

      assert!(progress.contains("super::watchdog"));
      assert!(terminal.contains("super::progress"));
      for constant in [
          "ASR_MODEL_DOWNLOAD_EVENT_NAME",
          "MODEL_DOWNLOAD_EVENT_PREFIX",
      ] {
          let definition = format!("pub(crate) const {constant}");
          assert!(
              progress_event.contains(definition.as_str()),
              "shared progress boundary must define {constant}"
          );
          assert!(
              asr_model.contains("pub(crate) use crate::progress_event")
                  && asr_model.contains(constant),
              "ASR model compatibility path must re-export {constant}"
          );
          assert!(
              !asr_model.contains(definition.as_str()),
              "ASR model must not define {constant}"
          );
      }
      for (name, source, forbidden_edges) in [
          (
              "process_io",
              process_io.as_str(),
              ["super::watchdog", "super::progress", "super::terminal"].as_slice(),
          ),
          (
              "watchdog",
              watchdog.as_str(),
              ["super::process_io", "super::progress", "super::terminal"].as_slice(),
          ),
          (
              "progress",
              progress.as_str(),
              ["super::process_io", "super::terminal"].as_slice(),
          ),
          (
              "terminal",
              terminal.as_str(),
              ["super::process_io", "super::watchdog"].as_slice(),
          ),
      ] {
          for &forbidden in forbidden_edges {
              assert!(
                  !source.contains(forbidden),
                  "{name} has forbidden dependency {forbidden}"
              );
          }
          for forbidden in [
              "crate::worker_runtime::runner::",
              "crate::account",
              "crate::asr_model",
              "crate::history",
              "crate::insight_preferences",
              "crate::settings",
              "crate::task_manifest",
              "crate::transcript_detail",
              "crate::ui_preferences",
              "crate::updates",
              "crate::video_processing",
              "termination_command_spec",
              "send_process_group_signal",
              "ProcessSignal",
              "taskkill",
              "tauri::command",
              "struct WorkerLane",
              "fn run_inner",
              "fn cancel(",
              "fn is_active(",
          ] {
              assert!(
                  !source.contains(forbidden),
                  "{name} contains forbidden ownership {forbidden}"
              );
          }
      }

      let mut sources = Vec::new();
      collect_runner_rust_sources(&src, &mut sources);
      for path in sources {
          if path == root_path || path.starts_with(&module_dir) {
              continue;
          }
          let source = std::fs::read_to_string(&path).expect("read Rust caller");
          for forbidden in [
              "runner::process_io",
              "runner::watchdog",
              "runner::progress",
              "runner::terminal",
          ] {
              assert!(
                  !source.contains(forbidden),
                  "{} bypasses the stable runner through {forbidden}",
                  path.display()
              );
          }
      }
  }
  ```

- [ ] Run the new ownership test:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml worker_runner_module_boundary
  ```

  Expected RED: the test panics with `read process I/O owner` because
  `runner/process_io.rs` does not exist. It must compile first and fail for this missing approved
  owner only.

- [ ] Keep the ownership test enabled but skip only that named test while proving all behavior
  remains green:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::runner::tests -- --skip worker_runner_module_boundary
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  git diff --check
  ```

  Expected: 27 non-boundary runner tests pass; rustfmt and diff checks pass.

### Task 2: Extract the Watchdog Owner

**Files:**

- Create: `app/src-tauri/src/worker_runtime/runner/watchdog.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`

- [ ] Declare private `mod watchdog;` and move these existing definitions without changing timing,
  mutex/condvar ordering, thread name, retry behavior, or log text:

  - `WatchdogPolicy` and its accessors;
  - `WorkerOperation::watchdog_policy`;
  - `select_watchdog_deadline`;
  - `WatchdogTiming`;
  - `WatchdogControl`;
  - `WatchdogHandle`;
  - `start_watchdog`; and
  - `run_watchdog_with_terminator`.

- [ ] Preserve the existing worker-runtime test surface and narrow parent composition:

  ```rust
  // runner/watchdog.rs
  pub(in crate::worker_runtime) struct WatchdogPolicy {
      idle_timeout: Option<Duration>,
      absolute_timeout: Duration,
  }

  impl WatchdogPolicy {
      pub(in crate::worker_runtime) fn idle_timeout(self) -> Option<Duration> {
          self.idle_timeout
      }

      pub(in crate::worker_runtime) fn absolute_timeout(self) -> Duration {
          self.absolute_timeout
      }
  }

  impl WorkerOperation {
      #[allow(dead_code)]
      pub(in crate::worker_runtime) fn watchdog_policy(self) -> WatchdogPolicy {
          match self {
              Self::ProcessVideo => WatchdogPolicy {
                  idle_timeout: Some(Duration::from_secs(45 * 60)),
                  absolute_timeout: Duration::from_secs(8 * 60 * 60),
              },
              Self::RetryInsights => WatchdogPolicy {
                  idle_timeout: Some(Duration::from_secs(10 * 60)),
                  absolute_timeout: Duration::from_secs(30 * 60),
              },
              Self::ResolveSourceIdentity => WatchdogPolicy {
                  idle_timeout: None,
                  absolute_timeout: Duration::from_secs(3 * 60),
              },
              Self::DownloadAsrModel => WatchdogPolicy {
                  idle_timeout: Some(Duration::from_secs(10 * 60)),
                  absolute_timeout: Duration::from_secs(4 * 60 * 60),
              },
          }
      }
  }

  // runner.rs
  pub(super) use watchdog::WatchdogPolicy;
  use watchdog::{start_watchdog, WatchdogControl};
  ```

  Use `pub(super)` only for `WatchdogControl`, `WatchdogHandle`, `start_watchdog`,
  `select_watchdog_deadline`,
  `run_watchdog_with_terminator`, and `record_validated_progress`, because the root/progress/test
  modules compose them. Keep the child module private. Do not add timeout constants, configuration,
  request inputs, or a second thread owner.

- [ ] Update the still-inline test imports to reach private watchdog test seams through
  `super::watchdog::{...}`. Do not root-re-export `WatchdogControl`,
  `select_watchdog_deadline`, or `run_watchdog_with_terminator`.

- [ ] Run watchdog policy/state behavior and all non-boundary runner tests:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml worker_operations_own_exact_closed_production_watchdog_policies
  cargo test --manifest-path app/src-tauri/Cargo.toml watchdog_deadline_selection
  cargo test --manifest-path app/src-tauri/Cargo.toml failed_timeout_signal_rolls_back
  cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::runner::tests -- --skip worker_runner_module_boundary
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  git diff --check
  ```

  Expected: focused tests and all 27 non-boundary runner tests pass; the ownership test remains RED
  only because later owners/test files are absent.

- [ ] Review the diff and stop if any timeout value, validated-activity clock, instance ID,
  termination closure, log event/detail, thread stop/join, or public visibility changed.

### Task 3: Extract the Progress Owner

**Files:**

- Create: `app/src-tauri/src/worker_runtime/runner/progress.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `app/src-tauri/src/progress_event.rs`
- Modify: `app/src-tauri/src/asr_model.rs`

- [ ] Before moving runner progress code, relocate only the two existing model-download transport
  constant definitions to the shared progress boundary:

  ```rust
  // progress_event.rs
  pub(crate) const ASR_MODEL_DOWNLOAD_EVENT_NAME: &str = "asr-model-download-progress";
  pub(crate) const MODEL_DOWNLOAD_EVENT_PREFIX: &str = "FRAMEQ_MODEL_DOWNLOAD ";

  // asr_model.rs
  pub(crate) use crate::progress_event::{
      ASR_MODEL_DOWNLOAD_EVENT_NAME, MODEL_DOWNLOAD_EVENT_PREFIX,
  };
  ```

  Keep `cancelled_model_download_event` as the existing normal import. Delete only the two former
  constant definitions from `asr_model.rs`; do not change their values, the existing lib test
  re-export, event emission, cancellation mapping, worker contract, or model-download behavior.

- [ ] Run the existing contract/value and model-download mapping characterizations:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml desktop_worker_contract_matches_tauri_constants
  cargo test --manifest-path app/src-tauri/Cargo.toml typed_runner_outcomes_preserve_model_download_product_mapping
  cargo test --manifest-path app/src-tauri/Cargo.toml model_download_runtime_errors_use_closed_safe_messages
  ```

  Expected: each filter passes without assertion changes. The existing crate-visible
  `asr_model::{ASR_MODEL_DOWNLOAD_EVENT_NAME, MODEL_DOWNLOAD_EVENT_PREFIX}` path continues to
  compile through the re-export.

- [ ] Declare private `mod progress;` and move these existing definitions without changing event
  names, prefixes, validators, invalid-detail construction, or reader behavior:

  - both cfg-specific `ProgressRoute` definitions and their implementation;
  - `ProgressProtocol`;
  - `ProgressRecord`;
  - `StderrSummary`;
  - `read_stderr`; and
  - `inspect_progress_line`.

- [ ] Keep the current crate-visible route path and only the private stderr-summary seam:

  ```rust
  // runner/progress.rs
  #[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
  pub(super) struct StderrSummary {
      pub(super) had_diagnostic_output: bool,
      pub(super) reader_failed: bool,
  }

  impl StderrSummary {
      pub(super) fn marker(self) -> &'static str {
          if self.reader_failed {
              "reader_failed"
          } else if self.had_diagnostic_output {
              "present"
          } else {
              "empty"
          }
      }
  }

  // runner.rs
  pub(crate) use progress::ProgressRoute;
  use progress::{read_stderr, StderrSummary};
  ```

  `progress.rs` imports both model-download constants and both validators from
  `crate::progress_event`; it must not import `crate::asr_model`. It may use
  `super::watchdog::WatchdogControl` only to call `record_validated_progress`. All other watchdog
  control methods stay inaccessible to progress. Give `ProgressProtocol`, `ProgressRecord`,
  `StderrSummary`, `read_stderr`, and `inspect_progress_line` only `pub(super)` visibility needed by
  the parent, terminal sibling, and focused tests; do not re-export them from the root.

- [ ] Move Tauri `Window`/`Emitter`, `BufRead`/`BufReader`, progress validators, safe invalid-event
  logging, and reader-wait imports with their owner. Keep `RunnerHooks` and `ReaderJoinGate` in the
  root; the child may access them as ancestor-private coordination types.

- [ ] Update inline test imports to reach `ProgressProtocol`, `ProgressRecord`,
  `StderrSummary`, and `inspect_progress_line` through `super::progress`; keep `ProgressRoute`
  available from the stable root path.

- [ ] Run progress/reader/watchdog behavior and all non-boundary runner tests:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml progress_protocols_validate_before_routing
  cargo test --manifest-path app/src-tauri/Cargo.toml stderr_reader_panic_keeps_terminal_outcome
  cargo test --manifest-path app/src-tauri/Cargo.toml validated_progress_resets_idle_activity
  cargo test --manifest-path app/src-tauri/Cargo.toml malformed_diagnostic_empty_and_stdout_spam
  cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::runner::tests -- --skip worker_runner_module_boundary
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  git diff --check
  ```

  Expected: focused tests and all 27 non-boundary runner tests pass. Invalid/diagnostic/empty lines
  emit nothing and never refresh idle activity; validated lines retain existing payload/event
  behavior.

- [ ] Review the diff and stop if any raw stderr is retained/forwarded, any unvalidated payload is
  emitted, any invalid detail begins echoing input, or any activity other than validated progress
  refreshes the watchdog.

### Task 4: Extract the Terminal Owner

**Files:**

- Create: `app/src-tauri/src/worker_runtime/runner/terminal.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`

- [ ] Declare private `mod terminal;` and move:

  - `WorkerExitSummary`;
  - `safe_start_log_detail`;
  - `safe_exit_log_detail`; and
  - `classify_terminal`.

  Keep `WorkerRunError::protocol_violation`, `WorkerRunOutcome`, `WorkerOperation`, and
  `WorkerTimeoutKind` in the root.

- [ ] Preserve the current type path and exact one-way dependencies:

  ```rust
  // runner/terminal.rs
  use super::progress::StderrSummary;
  use super::{
      WorkerOperation, WorkerRunError, WorkerRunOutcome, WorkerTimeoutKind,
  };
  use crate::worker_runtime::command::{js_runtime_diagnostics, WorkerCommandSpec};
  use crate::worker_runtime::result_protocol::{
      parse_terminal_result, TerminalResultError,
  };
  use crate::worker_runtime::supervisor::ProcessPhase;
  use std::process::Output;

  #[derive(Clone, Debug, Eq, PartialEq)]
  pub(crate) struct WorkerExitSummary {
      pub(crate) exit_code: Option<i32>,
      pub(crate) stderr: &'static str,
  }

  // runner.rs
  pub(crate) use terminal::WorkerExitSummary;
  use terminal::{classify_terminal, safe_exit_log_detail, safe_start_log_detail};
  ```

  Give the three terminal functions only `pub(super)` visibility for root/test composition. Keep
  `WorkerExitSummary` exactly `pub(crate)` because its existing root path is re-exported unchanged.
  Do not move closed DTO validation out of `result_protocol.rs` or application error/result mapping
  out of `asr_model.rs` / `video_processing/task_result.rs`.

- [ ] Update inline terminal-test imports through `super::terminal`; do not expose the functions
  from the runner root.

- [ ] Run the complete terminal matrix, safe-log behavior, both reader-failure behaviors, and all
  non-boundary runner tests:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml structured_result_wins
  cargo test --manifest-path app/src-tauri/Cargo.toml terminal_matrix_is_closed_and_deterministic
  cargo test --manifest-path app/src-tauri/Cargo.toml lifecycle_log_details_exclude
  cargo test --manifest-path app/src-tauri/Cargo.toml stdout_reader_panic_finishes_lane
  cargo test --manifest-path app/src-tauri/Cargo.toml stderr_reader_panic_keeps_terminal_outcome
  cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::runner::tests -- --skip worker_runner_module_boundary
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  git diff --check
  ```

  Expected: focused tests and all 27 non-boundary runner tests pass. A valid structured result wins
  concurrent cancel/timeout; missing nonzero output is unstructured failure; invalid/multiple
  output is a fixed protocol violation.

- [ ] Review the diff and stop if operation/result family matching, parse order, cancellation or
  timeout precedence, exit/stderr marker, fixed error detail, or safe diagnostic content changes.

### Task 5: Extract Process I/O, Split Tests, and Turn Ownership GREEN

**Files:**

- Create: `app/src-tauri/src/worker_runtime/runner/process_io.rs`
- Create: `app/src-tauri/src/worker_runtime/runner/tests.rs`
- Create: `app/src-tauri/src/worker_runtime/runner/tests/fixtures.rs`
- Create: `app/src-tauri/src/worker_runtime/runner/tests/lifecycle.rs`
- Create: `app/src-tauri/src/worker_runtime/runner/tests/progress.rs`
- Create: `app/src-tauri/src/worker_runtime/runner/tests/terminal.rs`
- Create: `app/src-tauri/src/worker_runtime/runner/tests/watchdog.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `scripts/tests/unix-process-supervisor-workflow.test.mjs`

- [ ] Declare private `mod process_io;` and move these helpers without changing commands, Stdio,
  process groups, payload bytes, cleanup claim loops, sleep interval, or wait/reap behavior:

  - `configure_child_process_group`;
  - `spawn_worker_process`;
  - `deliver_worker_stdin`;
  - the stdout `Read::read_to_end` helper;
  - `terminate_and_reap`; and
  - `cleanup_registered_child`.

  Use this narrow root composition:

  ```rust
  use process_io::{
      cleanup_registered_child, deliver_worker_stdin, read_worker_stdout, spawn_worker_process,
      terminate_and_reap,
  };

  let panic_stdout_reader = hooks.panic_stdout_reader;
  let stdout_reader = std::thread::spawn(move || {
      if panic_stdout_reader {
          panic!("forced stdout reader failure");
      }
      read_worker_stdout(stdout)
  });
  ```

  `read_worker_stdout` accepts only `ChildStdout` and returns `std::io::Result<Vec<u8>>`. The root
  retains thread start/join and all lifecycle ordering. Give moved helpers only `pub(super)`
  visibility for root/test composition; do not re-export a process-I/O helper from `runner.rs`.

- [ ] Keep process target provenance closed:

  - newly spawned lane-rejected cleanup receives only `child.id()`;
  - registered cleanup receives only its `ProcessInstance`;
  - all OS signal construction/execution remains in `supervisor.rs`; and
  - no child helper accepts a PID/PGID, executable, environment key, or shell fragment from IPC,
    task data, worker output, or logs.

- [ ] Before moving any test file, run the process-I/O/lifecycle filters and the complete
  non-boundary runner suite:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml spawn_failure_is_typed
  cargo test --manifest-path app/src-tauri/Cargo.toml missing_required_pipe
  cargo test --manifest-path app/src-tauri/Cargo.toml wait_failure_terminates
  cargo test --manifest-path app/src-tauri/Cargo.toml sensitive_request_is_delivered_only
  cargo test --manifest-path app/src-tauri/Cargo.toml stdin_delivery_failure
  cargo test --manifest-path app/src-tauri/Cargo.toml blocked_stdin_delivery
  cargo test --manifest-path app/src-tauri/Cargo.toml terminal_observation_finishes_lane
  cargo test --manifest-path app/src-tauri/Cargo.toml stdout_reader_panic_finishes_lane
  cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::runner::tests -- --skip worker_runner_module_boundary
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  git diff --check
  ```

  Expected: every focused filter passes and all 27 non-boundary runner tests remain green while the
  ownership gate is RED only because the approved external test tree is not complete.

- [ ] Replace the inline test module with `#[cfg(test)] mod tests;`. Put declarations and the
  ownership test in `runner/tests.rs`, move all helper/fixture functions to `tests/fixtures.rs`, and
  distribute the 27 behavior tests exactly as follows:

  - `tests/progress.rs`: `progress_protocols_validate_before_routing_and_drop_invalid_payloads`;
  - `tests/terminal.rs`: the two structured-result precedence tests, timeout-only classification,
    closed terminal matrix, and lifecycle safe-log test;
  - `tests/lifecycle.rs`: spawn, missing pipe, wait, stdin-only, stdin delivery failure,
    blocked-stdin cancellation, finish-before-stderr-join, stderr reader panic, and stdout reader
    panic tests;
  - `tests/watchdog.rs`: policy/deadline/signal retry plus all silent/progress/absolute/idle/
    blocked-stdin/process-tree/result-before-timeout/watchdog-start tests; and
  - `tests/fixtures.rs`: every request/command/script/runtime-path/PID wait/exit-status helper.

  Each test module imports production seams through `super::super` and fixtures through
  `super::fixtures`. Do not widen production visibility beyond the design's exact restricted
  surface solely to simplify test imports.

- [ ] Update the Node hosted-workflow source assertion to follow the moved owners:

  ```javascript
  const processIoPath = resolve(
    repositoryRoot,
    "app/src-tauri/src/worker_runtime/runner/process_io.rs",
  );
  const watchdogTestsPath = resolve(
    repositoryRoot,
    "app/src-tauri/src/worker_runtime/runner/tests/watchdog.rs",
  );

  const processIo = await readFile(processIoPath, "utf8");
  const watchdogTests = await readFile(watchdogTestsPath, "utf8");

  assert.match(processIo, /fn configure_child_process_group/);
  assert.match(processIo, /command\.process_group\(0\)/);

  const watchdogFixture = watchdogTests.indexOf(
    "watchdog_timeout_terminates_parent_and_descendant_then_admits_second_task",
  );
  assert.notEqual(watchdogFixture, -1);
  ```

  Retain every workflow permission/runner/toolchain/no-secret/no-Linux assertion and the
  supervisor direct parent/child fixture checks. Do not modify the workflow file.

- [ ] Run the previously RED ownership gate and require GREEN:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml worker_runner_module_boundary
  ```

  Expected: 1/1 passes. The exact four production children and complete test tree exist; root/child
  line alarms, symbol owners, private declarations/re-exports, and recursive no-bypass scan pass.

- [ ] Run the complete runner and hosted-workflow source tests:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::runner::tests
  node --test scripts/tests/unix-process-supervisor-workflow.test.mjs
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  git diff --check
  ```

  Expected: 28 runner tests pass (26 baseline + stdout characterization + ownership gate); the Node
  file passes both tests; rustfmt and diff checks pass.

- [ ] Measure final files and record exact physical counts in Progress. Require root <= 500 lines
  and each production child <= 400 lines. Require the test aggregator and each test child <= 500
  lines so no replacement hotspot exists. Record every count separately; do not treat line counts
  as a substitute for behavior or dependency tests.

- [ ] Review the production diff under `runner.rs` and the four production children. Stop if
  `WorkerLane::run/cancel/is_active`, root-facing type identity/path/visibility, lifecycle order,
  operation mapping, command/env/stdin, progress, terminal, error, diagnostic, timeout, cleanup, or
  any existing application caller changes.

### Task 6: Complete Regression, Scope Proof, Durable Docs, and Archival

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md`
- Modify: `docs/design-docs/2026-07-22-rust-worker-watchdog.md`
- Modify: `docs/design-docs/2026-07-23-rust-worker-runner-module-split.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Move: this plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/`

- [ ] Run focused and complete Rust gates under normal Windows process permissions and record exact
  counts:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::runner::tests
  cargo test --manifest-path app/src-tauri/Cargo.toml
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  ```

  Expected at the current baseline: 28 focused runner tests and 210 complete Rust tests. If another
  accepted branch legitimately changes the count before implementation, record the new pre-change
  baseline and require exactly the two planned new tests rather than editing assertions to match a
  failure.

- [ ] Run cross-layer/runtime source regression:

  ```powershell
  npm --prefix app test
  npm --prefix app run lint
  npm --prefix app run build
  node --test scripts/tests/*.test.mjs
  python scripts/validate_agents_docs.py --level WARN
  npm --prefix app run tauri -- build --no-bundle
  git diff --check
  ```

  Record exact App/script counts and build outcomes. Worker, server, Ruff, Prisma, and provider tests
  are not required because protected-scope proof forbids changes in those regions; if scope expands
  into one of them, stop and return to plan review before running substitute gates.

- [ ] Prove the Rust production diff is the exact approved tree:

  ```powershell
  $expectedProduction = @(
    'app/src-tauri/src/asr_model.rs'
    'app/src-tauri/src/progress_event.rs'
    'app/src-tauri/src/worker_runtime/runner.rs'
    'app/src-tauri/src/worker_runtime/runner/process_io.rs'
    'app/src-tauri/src/worker_runtime/runner/progress.rs'
    'app/src-tauri/src/worker_runtime/runner/terminal.rs'
    'app/src-tauri/src/worker_runtime/runner/watchdog.rs'
  )
  $actualProduction = @(
    git diff --name-only main...HEAD -- app/src-tauri/src |
      Where-Object {
        $_ -notmatch '^app/src-tauri/src/worker_runtime/runner/tests(?:\.rs|/)'
      }
  )
  Compare-Object $expectedProduction $actualProduction

  $expectedTests = @(
    'app/src-tauri/src/worker_runtime/runner/tests.rs'
    'app/src-tauri/src/worker_runtime/runner/tests/fixtures.rs'
    'app/src-tauri/src/worker_runtime/runner/tests/lifecycle.rs'
    'app/src-tauri/src/worker_runtime/runner/tests/progress.rs'
    'app/src-tauri/src/worker_runtime/runner/tests/terminal.rs'
    'app/src-tauri/src/worker_runtime/runner/tests/watchdog.rs'
  )
  $actualTests = @(
    git diff --name-only main...HEAD -- `
      app/src-tauri/src/worker_runtime/runner/tests.rs `
      app/src-tauri/src/worker_runtime/runner/tests
  )
  Compare-Object $expectedTests $actualTests
  ```

  Expected: neither comparison prints output. The first comparison excludes the test aggregator and
  test children from the exact production list; the second comparison proves the complete approved
  test tree separately.

- [ ] Prove protected runtime/contract/dependency/workflow scope remains unchanged:

  ```powershell
  git diff --quiet main...HEAD -- app/src-tauri/src/worker_runtime/command.rs app/src-tauri/src/worker_runtime/facade.rs app/src-tauri/src/worker_runtime/result_protocol.rs app/src-tauri/src/worker_runtime/supervisor.rs app/src-tauri/src/worker_runtime/mod.rs app/src-tauri/src/lib.rs app/src-tauri/Cargo.toml app/package.json app/package-lock.json worker contracts server .github/workflows
  if ($LASTEXITCODE -ne 0) { throw 'Protected scope changed' }
  ```

  Expected: exit 0. Outside the runner tree, the only approved Rust production edits are the
  two-constant owner/re-export changes in `progress_event.rs` and `asr_model.rs`; the only non-Rust
  implementation test change is `scripts/tests/unix-process-supervisor-workflow.test.mjs`.

- [ ] Update durable documents to describe `runner.rs` as the sole orchestrator above four private
  owners, not as one file owning every helper. Preserve `supervisor.rs` signalling,
  result-protocol, validated-progress, structured-result-first, register-before-stdin, and
  finish-before-reader-join language.

- [ ] Update the split design with final line/test evidence and status. Update the audit map and
  source-location table to the implemented private tree. Mark the root TASKS item complete only
  after all gates pass.

- [ ] Complete Progress, Surprises, Decision Log, and Outcomes with exact evidence; move this plan
  to completed, remove it from the active index, add it to the completed index, and update AGENTS
  from active to completed.

- [ ] Re-run WARN governance, rustfmt, `git diff --check`, protected-scope proof, and clean-status
  inspection after archival.

- [ ] Native macOS execution is optional for this behavior-neutral move. If the unchanged
  `.github/workflows/unix-process-supervisor.yml` is not run for the implementation commit, record
  macOS process-group execution as unverified residual risk; do not infer it from Windows or the
  Node source test.

## Concrete Steps

Run every command from the isolated worktree root:

```text
D:\Github\FrameQ\.worktrees\p1-rust-worker-runner-split-design
```

The canonical execution sequence is:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::runner::tests
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
node --test scripts/tests/*.test.mjs
python scripts/validate_agents_docs.py --level WARN
npm --prefix app run tauri -- build --no-bundle
git diff --check
git status --short --branch
```

Run the focused commands in Tasks 1-5 immediately after each move; do not wait for the final batch
to discover a regression. The ownership test is the only intentionally failing test and only until
Task 5. No complete or focused test may be disabled, ignored, rewritten to accept changed behavior,
or removed to make extraction pass.

Commit policy: implementation commits require user authorization. If authorized, use these
reviewable checkpoints after the corresponding task and validation are complete:

```powershell
git add app/src-tauri/src/worker_runtime/runner.rs
git commit -m "test(runtime): lock runner split boundaries"

git add app/src-tauri/src/worker_runtime/runner.rs app/src-tauri/src/worker_runtime/runner/watchdog.rs
git commit -m "refactor(runtime): extract worker watchdog owner"

git add app/src-tauri/src/asr_model.rs app/src-tauri/src/progress_event.rs app/src-tauri/src/worker_runtime/runner.rs app/src-tauri/src/worker_runtime/runner/progress.rs
git commit -m "refactor(runtime): extract worker progress owner"

git add app/src-tauri/src/worker_runtime/runner.rs app/src-tauri/src/worker_runtime/runner/terminal.rs
git commit -m "refactor(runtime): extract worker terminal owner"

git add app/src-tauri/src/worker_runtime/runner.rs app/src-tauri/src/worker_runtime/runner/process_io.rs app/src-tauri/src/worker_runtime/runner/tests.rs app/src-tauri/src/worker_runtime/runner/tests scripts/tests/unix-process-supervisor-workflow.test.mjs
git commit -m "refactor(runtime): complete runner private owner split"
```

Documentation/archival commit commands are chosen only after the plan has moved to its final path;
do not stage both active and completed copies.

## Validation and Acceptance

### Required automated evidence

- The stdout-reader test records compile RED before the hook and GREEN after the minimal test seam.
- The final ownership test records missing-owner RED and complete-tree GREEN.
- All 27 non-boundary runner tests pass after each production move.
- All 28 final runner tests and the complete Rust suite pass under normal Windows process
  permissions.
- `scripts/tests/unix-process-supervisor-workflow.test.mjs` passes against the moved process-I/O and
  watchdog-test owners without workflow changes.
- Complete App tests, TypeScript/i18n lint, frontend build, Node scripts, rustfmt, Tauri no-bundle
  build, governance, and diff checks pass.
- Scope proof shows only the seven approved Rust production paths changed and no protected caller,
  supervisor, contract, dependency manifest, workflow, frontend, worker, or server production path
  changed.

### Behavioral acceptance

- `WorkerLane::run/cancel/is_active`, `WorkerRunRequest/Outcome/Error`, `ProgressRoute`,
  `WorkerTimeoutKind`, and all current import paths/effective visibility remain unchanged.
- Spawn, process-group setup, supervisor registration, watchdog start, stdin delivery, pipe/reader
  startup, wait/reap, watchdog stop/join, matching finish, reader join, safe log, and terminal
  classification remain in the same order.
- Spawn/already-running/watchdog-start/stdin/pipe/wait/reader failure behavior and cleanup remain
  exact.
- Structured results still win concurrent cancellation/timeout; cancellation and typed timeout
  classify only without a valid structured result.
- Only validated progress emits and refreshes idle activity; arbitrary/malformed stderr/stdout never
  extends the deadline.
- Absolute deadlines, timeout values, retry backoff, process-tree termination, stale-instance
  exclusion, and second-task admission remain unchanged.
- Lifecycle logs retain fixed safe operation/PID/exit/stderr/outcome markers and never include
  request, path, URL, credential, transcript, prompt, AI result, or raw process output.

### Structural acceptance

- `runner.rs` is the only lifecycle orchestrator, <= 500 physical lines, and owns no moved helper.
- The exact four private production owners exist and are each <= 400 physical lines.
- The test tree is split by topic and its aggregator/children are each <= 500 physical lines, so no
  single replacement test file recreates the 1,156-line hotspot.
- Application production code imports no private runner child path.
- `supervisor.rs` remains the only OS signal implementation; `result_protocol.rs` remains the only
  closed terminal DTO validator; `command.rs` remains the only fixed invocation/environment owner.

### Manual and residual validation

No real provider, Python worker, ASR model, LLM/Credits, download, server, updater, or native WebView
smoke is relevant because their production paths and contracts are protected from change. Windows
runner tests exercise real blocked-stdin and parent/descendant termination when run with normal
process permission. macOS process-group execution remains unverified unless the unchanged hosted
workflow is run for the final implementation commit.

## Rollback and Recovery

This is a move-first refactor behind an unchanged root. After Tasks 2-4, a failing owner can be moved
back into `runner.rs` while retaining the new stdout characterization and ownership test. After Task
5, tests can be returned to the inline module independently of production movement if only test
module paths fail.

Do not use `git reset --hard`, discard unrelated work, adapt a caller, widen visibility, alter an
error/event/timeout, weaken a test, or change a process rule to make extraction easier. Stop at the
last green boundary and record the mismatch in Surprises & Discoveries before requesting design
review.

If cancellation/timeout cleanup behaves differently, terminate any still-running fixture through
the existing safe test cleanup path, verify the lane is inactive, and do not start subsequent tasks
until process state is known. If a restricted sandbox denies `taskkill`, rerun the unchanged command
with normal process permissions and record both results rather than modifying production code.

## Final Acceptance

- User approved the design and this ExecPlan before production/test implementation.
- The stable runner root and exact four private owners match the approved design and effective
  visibility.
- All current callers, types, operation policies, lifecycle ordering, failures, races, progress,
  terminal results, and safe diagnostics remain unchanged.
- Stdout/stderr reader behavior and the ownership/dependency tree have explicit RED/GREEN evidence.
- Required focused, complete, cross-layer, build, governance, scope, and diff gates pass with exact
  counts recorded.
- No new executor, state machine, facade, dependency, contract, product behavior, local-media
  runtime, timeout policy, network/log surface, or platform-support claim exists.
- Durable docs, audit/task tracking, indexes, and the archived ExecPlan match implemented reality.
- Unrun native macOS evidence is recorded as residual risk rather than inferred as passed.
