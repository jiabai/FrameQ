# ASR Model Download Job Capability Boundary Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make ASR model download enter the Rust worker runtime through a closed semantic job so
application modules can no longer construct or submit arbitrary child-process specifications.

**Architecture:** Keep model availability and app-local `.env` extraction in `asr_model.rs`.
Introduce an opaque `AsrModelDownloadJob` containing only four allowlisted override values, and let
`worker_runtime::command` derive the fixed Python executable, argv, stdin, environment, removals,
and cwd. `ProcessSupervisors` accepts the semantic job, while `WorkerCommandSpec` becomes visible
only inside `worker_runtime`.

**Tech Stack:** Rust, Tauri v2, Cargo unit/source-boundary tests, repository Node governance tests.

**Durable design:**
`docs/design-docs/2026-07-24-asr-model-download-job-capability-boundary.md`

---

## Purpose / Big Picture

Valid FrameQ behavior remains unchanged. Users still see the same first-run model availability,
download progress, cancellation, timeouts, completion status, cache paths, and fallback behavior.
The improvement is an internal capability boundary: application code can ask the runtime to
download the ASR model but cannot choose a program, argv, stdin, environment key, environment
removal, cwd, operation, progress route, or lane.

This is a behavior-neutral Rust refactor. It does not change Tauri IPC, the desktop-worker
contract, Python CLI, `.env` schema, model files, product copy, network calls, LLM behavior, or AI
Credits.

## Progress

- [x] 2026-07-24: Inspected the current Rust process boundary and confirmed that
  `asr_model.rs` constructs a crate-visible `WorkerCommandSpec` while task execution already uses
  the closed `WorkerJob + TaskWorkerFacade` path. Validation: source inspection of
  `asr_model.rs`, `worker_runtime/{command,facade,mod,runner}.rs`, and `lib.rs`.
- [x] 2026-07-24: User approved the opaque four-value `AsrModelDownloadJob` architecture, nested
  preparation/runtime error boundary, compatibility invariants, and TDD strategy. Validation:
  reviewed design conversation and durable design document.
- [x] 2026-07-24: Wrote the accepted durable design, this active ExecPlan, and architecture,
  security, audit, debt, task, and index registrations without changing production code.
  Validation: `python scripts/validate_agents_docs.py --level WARN` and `git diff --check`.
- [x] 2026-07-24: Added the semantic job and runtime-owned command-policy tests before caller
  migration. RED failed only for missing `AsrModelDownloadJob` and
  `build_asr_model_download_command_spec`; GREEN passed command 7/7 and facade 5/5, with rustfmt
  clean. The non-test library reported the expected temporary dead-code warnings until Task 3
  connects the new policy. Validation: focused Cargo output recorded in the implementation session.
- [x] 2026-07-24: Migrated the model-download execution entry and application caller while
  preserving operation, progress, lane, and product-result mapping. RED failed only for the missing
  `prepare_asr_model_download_request`; GREEN passed composition 1/1, ASR product mapping and
  availability 7/7, command policy 7/7, and rustfmt. The only remaining warning is the deliberately
  not-yet-removed crate-root raw-spec re-export targeted by Task 4. Validation: focused Cargo output
  recorded in the implementation session.
- [x] 2026-07-24: Made the raw command specification and run request runtime-private, removed both
  raw-spec re-exports, narrowed the test preparation seam, and added a permanent source-ownership
  gate. RED failed on the old `pub(crate)` visibility; GREEN passed the boundary 1/1,
  worker-runtime 63/63, complete Rust 226/226, and rustfmt. Validation: process-tree suites were run
  outside the restricted sandbox after a same-test sandbox/non-sandbox comparison proved
  `taskkill` permission was the only cause of the sandbox timeout.
- [x] 2026-07-24: Completed verification, recorded evidence/residual platform risk, updated
  governance, and archived the plan. Validation: command 7/7, ASR 7/7, runtime 63/63, Rust 226/226,
  App 637/637, scripts 27/27, frontend production build, rustfmt, Tauri release `--no-bundle`,
  governance 0 errors / 0 warnings, and `git diff --check` all pass.

## Surprises & Discoveries

- Evidence: `app/src-tauri/src/worker_runtime/command.rs` declares `WorkerCommandSpec` and all six
  fields as `pub(crate)`, `worker_runtime/mod.rs` re-exports it, and `lib.rs` re-exports it again at
  the crate root.
- Evidence: `app/src-tauri/src/asr_model.rs::build_model_download_command_spec` currently owns the
  bundled Python path, `--download-asr-model` argv, fixed/optional environment, legacy LLM removal,
  null stdin, and cwd.
- Evidence: `ProcessSupervisors::run_asr_model_download` accepts the raw specification and derives
  only `DownloadAsrModel`, the model progress route, and the private lane.
- Evidence: no other production application module currently constructs `WorkerCommandSpec`; the
  capability is broader than its present use rather than an observed arbitrary-spawn exploit.
- Evidence: task execution already separates command-preparation errors from supervised runtime
  errors through `Result<Result<WorkerRunOutcome, WorkerRunError>, String>`, providing a compatible
  model for the new model-download entry.
- Evidence: the current model command-policy test lives in `asr_model.rs`, so ownership is enforced
  only behaviorally. It must move to `worker_runtime::command` when command construction moves.
- Evidence: runner fixtures inside `worker_runtime` legitimately construct raw specifications.
  The visibility change must preserve those private tests while removing crate-root imports.
- Evidence: starting two first-build Cargo commands concurrently against one new worktree target
  caused one dependency `rustc` process to exit without a diagnostic. Serial reruns compiled the
  target and passed the facade and command baselines 5/5 each; subsequent Cargo commands reuse the
  healthy target.
- Evidence: the first full `worker_runtime` run inside the restricted sandbox passed 54 tests
  before cancellation/watchdog process-tree fixtures failed or waited past 60 seconds. The exact
  blocked-stdin cancellation test failed in-sandbox after 30.07 seconds with
  `RequestDeliveryFailed`, while the unchanged test passed outside the sandbox in 0.17 seconds;
  the complete privileged runtime suite then passed 63/63 in 4.89 seconds.
- Evidence: narrowing `WorkerCommandSpec` exposed compiler `private_interfaces` warnings for the
  crate-visible `WorkerRunRequest::command` field and test-only `prepare_for_test`. Both values have
  no application consumer, so they were narrowed to the runtime boundary/private test owner rather
  than suppressing warnings.
- Evidence: the isolated worktree initially had no `app/node_modules`, so the first App command
  stopped before Vitest with `vitest is not recognized`. Installing the existing lockfile added the
  local dependency tree without changing `package.json` or `package-lock.json`; the rerun passed
  68 files / 637 tests.

## Decision Log

- Decision: Keep model availability and `.env` parsing in `asr_model.rs`; pass only four
  allowlisted optional values to the runtime. Rationale: configuration persistence is application
  policy, while executable/argv/env/cwd construction is runtime policy. Date/Author: 2026-07-24,
  User + Codex.
- Decision: Define an opaque `AsrModelDownloadJob` rather than a generic environment map or process
  builder. Rationale: the application needs one semantic capability, not arbitrary child-process
  construction. Date/Author: 2026-07-24, User + Codex.
- Decision: Keep the task and model-download lanes separate. Rationale: model download has distinct
  progress, timeout, cancellation, and concurrency semantics, and the issue is raw command
  capability rather than lane count. Date/Author: 2026-07-24, User + Codex.
- Decision: Return `Result<Result<WorkerRunOutcome, WorkerRunError>, String>` from model-download
  execution. Rationale: command preparation can fail before a supervised process exists and must
  not be mislabeled as a runner failure. Date/Author: 2026-07-24, User + Codex.
- Decision: Make `WorkerCommandSpec` visible only inside `crate::worker_runtime` and remove both
  re-exports. Rationale: file relocation without capability closure would not solve the audit
  finding. Date/Author: 2026-07-24, User + Codex.
- Decision: Narrow `WorkerRunRequest` to `crate::worker_runtime` and make `prepare_for_test`
  private to `facade.rs`. Rationale: the raw request contains the newly private spec and has no
  application consumer; suppressing compiler visibility warnings would leave a misleading broader
  interface. Date/Author: 2026-07-24, Codex.
- Decision: Add no product-spec or contract revision. Rationale: valid wire shapes, UI behavior,
  worker CLI, persisted files, and network activity remain unchanged. Date/Author: 2026-07-24,
  User + Codex.

## Outcomes & Retrospective

Outcome: ASR model download now crosses the application/runtime boundary only as an opaque
`AsrModelDownloadJob` with four private optional override values. `asr_model.rs` still owns model
availability and app-local `.env` extraction; `worker_runtime::command` now owns the exact bundled
Python program, `-m frameq_worker --download-asr-model` argv, null stdin, fixed/allowlisted
environment, legacy removal set, and cwd. `ProcessSupervisors` fixes the model operation, progress
route, and separate lane, while preparation errors remain outside typed runner errors.

`WorkerCommandSpec`, all of its fields, and `WorkerRunRequest` are visible only inside
`crate::worker_runtime`; crate/root re-exports are gone. The test-only preparation method is private
to its facade owner. The new recursive source gate prevents application references to raw request,
invocation, or command-spec types and prevents the model-download CLI flag from moving outside the
runtime owner.

TDD evidence was captured in three slices: missing job/builder RED to command 7/7 and facade 5/5
GREEN; missing request-composition RED to composition 1/1 plus ASR 7/7 GREEN; and old visibility
RED to source boundary 1/1, runtime 63/63, and complete Rust 226/226 GREEN. Complete App 637/637,
repository scripts 27/27, frontend production build, Tauri release `--no-bundle`, rustfmt,
governance, and diff gates pass. Implementation commits are `7826521`, `ea45bbc`, and `0e7c5e9`;
approved planning was recorded in `d55aca6`.

Residual risk: no real model download or macOS-host execution was rerun because executable, argv,
environment, progress, lifecycle, and wire behavior are compatibility invariants and the change
adds no network path. Windows process-tree fixtures passed with the required host permission; the
restricted sandbox cannot deliver `taskkill`, as proved by the exact 30.07-second failure versus
0.17-second privileged pass. Vite continues to report the existing post-minification chunk-size
advisory, unrelated to this Rust-only refactor.

## Context and Orientation

### Durable decisions and governance

- `docs/design-docs/2026-07-24-asr-model-download-job-capability-boundary.md`
- `docs/design-docs/2026-07-19-typed-worker-job-facade.md`
- `docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md`
- `docs/design-docs/2026-07-23-rust-worker-runner-module-split.md`
- `docs/design-docs/frameq-code-audit-uml.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `TASKS.md`

### Rust application and configuration owners

- `app/src-tauri/src/asr_model.rs`
- `app/src-tauri/src/settings.rs`
- `app/src-tauri/src/runtime.rs`
- `app/src-tauri/src/lib.rs`

### Worker runtime owners

- `app/src-tauri/src/worker_runtime/mod.rs`
- `app/src-tauri/src/worker_runtime/facade.rs`
- `app/src-tauri/src/worker_runtime/command.rs`
- `app/src-tauri/src/worker_runtime/runner.rs`
- `app/src-tauri/src/worker_runtime/runner/tests.rs`
- `app/src-tauri/src/worker_runtime/runner/tests/fixtures.rs`
- `app/src-tauri/src/worker_runtime/runner/tests/lifecycle.rs`
- `app/src-tauri/src/worker_runtime/runner/tests/terminal.rs`

## File Responsibility Map

| File | Responsibility after implementation |
|------|-------------------------------------|
| `asr_model.rs` | availability, `.env` parsing, four override extractions, Tauri orchestration, product-result mapping |
| `worker_runtime/facade.rs` | opaque `AsrModelDownloadJob` plus existing task job/facade |
| `worker_runtime/command.rs` | all fixed task and ASR model-download process specifications |
| `worker_runtime/mod.rs` | separate lane composition, semantic model execution entry, runtime boundary tests |
| `worker_runtime/runner.rs` and children | unchanged supervised lifecycle over runtime-private specifications |
| `lib.rs` | runtime service/cancel exports only; no raw specification export |
| design/governance files | approved boundary, active debt, task status, and implementation evidence |

No new Rust source file or dependency is needed.

## Plan of Work

### Task 1: Register the Approved Boundary

**Files:**

- Create:
  `docs/design-docs/2026-07-24-asr-model-download-job-capability-boundary.md`
- Create:
  `docs/exec-plans/active/2026-07-24-asr-model-download-job-capability-plan.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`

- [x] **Step 1: Record the accepted ADR and compatibility invariants**

The design explicitly supersedes only the old exception that left model-download command
construction in `asr_model.rs`. It preserves the task facade, two lanes, worker lifecycle, command
bytes, result mapping, and public protocols.

- [x] **Step 2: Register the gap as active rather than describing the target as implemented**

Architecture, security, audit, debt, and task text must say that the current raw capability remains
until this ExecPlan is executed.

- [x] **Step 3: Run documentation validation**

Run:

```powershell
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Expected: zero governance errors/warnings and no whitespace errors.

Do not commit the planning documents until the user has reviewed them or explicitly requests a
commit.

### Task 2: Add the Semantic Job and Fixed Command Policy with TDD

**Files:**

- Modify: `app/src-tauri/src/worker_runtime/facade.rs`
- Modify: `app/src-tauri/src/worker_runtime/command.rs`

- [x] **Step 1: Confirm the focused baseline is green**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::facade
cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::command
```

Expected: existing typed-job and command-policy tests pass before adding the model job.

- [x] **Step 2: Write failing command-policy tests**

In `worker_runtime/command.rs`, extend the test module to import the not-yet-implemented job and
builder:

```rust
use super::{
    build_asr_model_download_command_spec, build_worker_command_spec, WorkerCommandSpec,
    WorkerInvocation,
};
use crate::worker_runtime::facade::AsrModelDownloadJob;
```

Add one exact complete-policy test:

```rust
#[test]
fn asr_model_download_job_derives_fixed_command_and_allowlisted_overrides() {
    let paths = command_test_paths();
    let job = AsrModelDownloadJob::new(
        Some("https://cdn.example/sensevoice.zip".to_string()),
        Some("abc123".to_string()),
        Some("https://modelscope.example".to_string()),
        Some("revision-1".to_string()),
    );

    let spec =
        build_asr_model_download_command_spec(&paths, &job).expect("prepare ASR download command");
    let env = spec.env_map();

    assert_eq!(spec.program, bundled_python_path(&paths.resource_dir));
    assert_eq!(
        spec.args,
        vec!["-m", "frameq_worker", "--download-asr-model"]
    );
    assert_eq!(spec.stdin_payload, None);
    assert_eq!(spec.current_dir, paths.user_data_dir);
    assert_eq!(
        env.get("FRAMEQ_MODEL_DIR"),
        Some(&path_to_env_string(
            PathBuf::from("frameq-test")
                .join("user-data")
                .join("models")
        ))
    );
    assert_eq!(
        env.get("FRAMEQ_ASR_MODEL_DOWNLOAD_URL"),
        Some(&"https://cdn.example/sensevoice.zip".to_string())
    );
    assert_eq!(
        env.get("FRAMEQ_ASR_MODEL_DOWNLOAD_SHA256"),
        Some(&"abc123".to_string())
    );
    assert_eq!(
        env.get("FRAMEQ_MODELSCOPE_ENDPOINT"),
        Some(&"https://modelscope.example".to_string())
    );
    assert_eq!(
        env.get("FRAMEQ_SENSEVOICE_REVISION"),
        Some(&"revision-1".to_string())
    );
    assert_removes_legacy_local_llm_env(&spec);
}
```

Add a second complete test:

```rust
#[test]
fn asr_model_download_job_omits_optional_overrides_and_keeps_fixed_environment() {
    let paths = command_test_paths();
    let job = AsrModelDownloadJob::new(None, None, None, None);

    let spec =
        build_asr_model_download_command_spec(&paths, &job).expect("prepare ASR download command");
    let env = spec.env_map();

    for key in [
        "FRAMEQ_ASR_MODEL_DOWNLOAD_URL",
        "FRAMEQ_ASR_MODEL_DOWNLOAD_SHA256",
        "FRAMEQ_MODELSCOPE_ENDPOINT",
        "FRAMEQ_SENSEVOICE_REVISION",
    ] {
        assert!(!env.contains_key(key), "unexpected optional key {key}");
    }
    for key in [
        "PYTHONPATH",
        "PYTHONUTF8",
        "PYTHONIOENCODING",
        "PATH",
        "FRAMEQ_MODEL_DIR",
        "FRAMEQ_RESOURCE_DIR",
        "FRAMEQ_USER_DATA_DIR",
    ] {
        assert!(env.contains_key(key), "missing fixed key {key}");
    }
    assert_eq!(spec.stdin_payload, None);
    assert_removes_legacy_local_llm_env(&spec);
}
```

- [x] **Step 3: Run the tests and capture RED**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml asr_model_download_job_derives_fixed_command_and_allowlisted_overrides
```

Expected: compilation fails because `AsrModelDownloadJob` and
`build_asr_model_download_command_spec` do not exist. Record that exact failure in `Progress`.

- [x] **Step 4: Add the minimal opaque semantic job**

In `worker_runtime/facade.rs`, add:

```rust
pub(crate) struct AsrModelDownloadJob {
    download_url: Option<String>,
    download_sha256: Option<String>,
    modelscope_endpoint: Option<String>,
    sensevoice_revision: Option<String>,
}

impl AsrModelDownloadJob {
    pub(crate) fn new(
        download_url: Option<String>,
        download_sha256: Option<String>,
        modelscope_endpoint: Option<String>,
        sensevoice_revision: Option<String>,
    ) -> Self {
        Self {
            download_url,
            download_sha256,
            modelscope_endpoint,
            sensevoice_revision,
        }
    }

    pub(super) fn download_url(&self) -> Option<&str> {
        self.download_url.as_deref()
    }

    pub(super) fn download_sha256(&self) -> Option<&str> {
        self.download_sha256.as_deref()
    }

    pub(super) fn modelscope_endpoint(&self) -> Option<&str> {
        self.modelscope_endpoint.as_deref()
    }

    pub(super) fn sensevoice_revision(&self) -> Option<&str> {
        self.sensevoice_revision.as_deref()
    }
}
```

Do not add setters, `HashMap`, public fields, `Default`, a generic override method, raw paths, or
execution-policy fields.

- [x] **Step 5: Add the minimal runtime-owned command builder**

In `worker_runtime/command.rs`, import the four settings constants and
`AsrModelDownloadJob`. Add:

```rust
pub(super) fn build_asr_model_download_command_spec(
    paths: &RuntimePaths,
    job: &AsrModelDownloadJob,
) -> Result<WorkerCommandSpec, String> {
    let path_value = prepend_to_path(&paths.resource_dir.join("bin"))?;
    let mut env = vec![
        (
            "PYTHONPATH".to_string(),
            path_to_env_string(paths.resource_dir.join("worker")),
        ),
        ("PYTHONUTF8".to_string(), "1".to_string()),
        ("PYTHONIOENCODING".to_string(), "utf-8".to_string()),
        ("PATH".to_string(), path_value),
        (
            MODEL_DIR_ENV.to_string(),
            path_to_env_string(paths.user_data_dir.join("models")),
        ),
        (
            RESOURCE_DIR_ENV.to_string(),
            path_to_env_string(&paths.resource_dir),
        ),
        (
            USER_DATA_DIR_ENV.to_string(),
            path_to_env_string(&paths.user_data_dir),
        ),
    ];

    for (key, value) in [
        (ASR_MODEL_DOWNLOAD_URL_ENV, job.download_url()),
        (ASR_MODEL_DOWNLOAD_SHA256_ENV, job.download_sha256()),
        (MODELSCOPE_ENDPOINT_ENV, job.modelscope_endpoint()),
        (SENSEVOICE_REVISION_ENV, job.sensevoice_revision()),
    ] {
        if let Some(value) = value {
            env.push((key.to_string(), value.to_string()));
        }
    }

    Ok(WorkerCommandSpec {
        program: bundled_python_path(&paths.resource_dir),
        args: vec![
            "-m".to_string(),
            "frameq_worker".to_string(),
            "--download-asr-model".to_string(),
        ],
        stdin_payload: None,
        env,
        env_remove: legacy_local_llm_env_removals(),
        current_dir: paths.user_data_dir.clone(),
    })
}
```

Reuse the existing `WorkerCommandSpec`; do not create a second spec or generic builder.

- [x] **Step 6: Run focused GREEN and formatting**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::command
cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::facade
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
```

Expected: all focused tests pass; formatting is clean. The new builder may still be unused until
Task 3, but the existing application path remains unchanged.

- [x] **Step 7: Commit the semantic policy slice**

```powershell
git add app/src-tauri/src/worker_runtime/facade.rs app/src-tauri/src/worker_runtime/command.rs
git commit -m "refactor(worker): add ASR model download job policy"
```

### Task 3: Route Model Download Through the Semantic Execution Entry

**Files:**

- Modify: `app/src-tauri/src/worker_runtime/mod.rs`
- Modify: `app/src-tauri/src/asr_model.rs`

- [x] **Step 1: Write the failing request-composition test**

In `worker_runtime/mod.rs`, extend the existing test imports to:

```rust
use super::{
    prepare_asr_model_download_request, run_blocking_worker_command, AsrModelDownloadJob,
    ProgressRoute, WorkerOperation,
};
use crate::RuntimePaths;
use std::path::PathBuf;
```

Then add:

```rust
#[test]
fn asr_model_download_job_derives_operation_progress_and_command() {
    let paths = RuntimePaths {
        resource_dir: PathBuf::from("frameq-test").join("resources"),
        user_data_dir: PathBuf::from("frameq-test").join("user-data"),
    };
    let job = AsrModelDownloadJob::new(None, None, None, None);

    let request = prepare_asr_model_download_request(
        &paths,
        job,
        ProgressRoute::asr_model_download(()),
    )
    .expect("prepare model-download request");

    assert_eq!(request.operation, WorkerOperation::DownloadAsrModel);
    assert!(matches!(request.progress, ProgressRoute::AsrModelDownload));
    assert_eq!(
        request.command.args,
        vec!["-m", "frameq_worker", "--download-asr-model"]
    );
    assert_eq!(request.command.stdin_payload, None);
}
```

Import the exact private runtime types through `super`, plus `RuntimePaths` and `PathBuf`.

- [x] **Step 2: Run the test and capture RED**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml asr_model_download_job_derives_operation_progress_and_command
```

Expected: compilation fails because `prepare_asr_model_download_request` does not exist. Record the
failure in `Progress`.

- [x] **Step 3: Add private preparation and change the semantic method signature**

In `worker_runtime/mod.rs`, import `build_asr_model_download_command_spec`, re-export
`AsrModelDownloadJob` only at the `worker_runtime` semantic surface, and add:

```rust
fn prepare_asr_model_download_request(
    paths: &RuntimePaths,
    job: AsrModelDownloadJob,
    progress: ProgressRoute,
) -> Result<WorkerRunRequest, String> {
    Ok(WorkerRunRequest {
        operation: WorkerOperation::DownloadAsrModel,
        command: build_asr_model_download_command_spec(paths, &job)?,
        progress,
    })
}
```

Change the method to:

```rust
pub(crate) fn run_asr_model_download(
    &self,
    paths: &RuntimePaths,
    job: AsrModelDownloadJob,
    window: Window,
) -> Result<Result<WorkerRunOutcome, WorkerRunError>, String> {
    let request = prepare_asr_model_download_request(
        paths,
        job,
        ProgressRoute::asr_model_download(window),
    )?;
    Ok(self.asr_model_download.run(paths, request))
}
```

The method must still select the private `asr_model_download` lane; do not expose a facade that
lets callers select a lane.

- [x] **Step 4: Migrate `asr_model.rs` to extract and submit the job**

Delete `build_model_download_command_spec` and its raw command-policy test. Remove imports for
`WorkerCommandSpec`, `bundled_python_path`, `prepend_to_path`, child environment constants,
`legacy_local_llm_env_removals`, and production `HashMap`.

After parsing `.env`, construct:

```rust
let job = AsrModelDownloadJob::new(
    configured_env_value(&config_values, ASR_MODEL_DOWNLOAD_URL_ENV),
    configured_env_value(&config_values, ASR_MODEL_DOWNLOAD_SHA256_ENV),
    configured_env_value(&config_values, MODELSCOPE_ENDPOINT_ENV),
    configured_env_value(&config_values, SENSEVOICE_REVISION_ENV),
);
let run_result =
    process_supervisors.run_asr_model_download(&paths, job, window.clone())?;

match map_model_download_run_result(run_result)? {
    ModelDownloadRunResult::Completed => Ok(AsrModelDownloadResult {
        started: true,
        status: "completed".to_string(),
    }),
    ModelDownloadRunResult::Cancelled => {
        let _ = window.emit(
            ASR_MODEL_DOWNLOAD_EVENT_NAME,
            cancelled_model_download_event(),
        );
        Ok(AsrModelDownloadResult {
            started: false,
            status: "cancelled".to_string(),
        })
    }
}
```

Keep `configured_env_value` behavior unchanged, including trimming and process-environment fallback.
Do not move `.env` parsing into `worker_runtime`.

- [x] **Step 5: Run focused GREEN and regression mapping tests**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml asr_model_download_job_derives_operation_progress_and_command
cargo test --manifest-path app/src-tauri/Cargo.toml asr_model::
cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::command
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
```

Expected: request composition, command policy, availability, cancellation, timeout, protocol, and
safe error mapping tests pass. The removed application-level command test is covered by its moved
runtime-owned replacement.

- [x] **Step 6: Commit the semantic execution slice**

```powershell
git add app/src-tauri/src/worker_runtime/mod.rs app/src-tauri/src/asr_model.rs
git commit -m "refactor(worker): route ASR download through semantic job"
```

### Task 4: Close Raw Process-Spec Visibility and Add a Permanent Gate

**Files:**

- Modify: `app/src-tauri/src/worker_runtime/mod.rs`
- Modify: `app/src-tauri/src/worker_runtime/facade.rs`
- Modify: `app/src-tauri/src/worker_runtime/command.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner/tests/fixtures.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner/tests/lifecycle.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner/tests/terminal.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [x] **Step 1: Write the failing source-ownership test**

Extend `worker_runtime/mod.rs` tests with this recursive `.rs` source collector:

```rust
fn collect_rust_sources(dir: &Path, sources: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("read Rust source directory") {
        let path = entry.expect("read Rust source entry").path();
        if path.is_dir() {
            collect_rust_sources(&path, sources);
        } else if path.extension().and_then(|value| value.to_str()) == Some("rs") {
            sources.push(path);
        }
    }
}
```

Add `Path` to the existing `std::path` test import. Then add a test that reads `command.rs`,
`worker_runtime/mod.rs`, `lib.rs`, and every production Rust source outside `worker_runtime`:

```rust
#[test]
fn raw_worker_process_capability_stays_inside_worker_runtime() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let runtime_dir = src.join("worker_runtime");
    let command = std::fs::read_to_string(runtime_dir.join("command.rs"))
        .expect("read worker command owner");
    let runtime_root =
        std::fs::read_to_string(runtime_dir.join("mod.rs")).expect("read runtime root");
    let crate_root = std::fs::read_to_string(src.join("lib.rs")).expect("read crate root");
    let asr_model =
        std::fs::read_to_string(src.join("asr_model.rs")).expect("read ASR model owner");

    assert!(command.contains(
        "pub(in crate::worker_runtime) struct WorkerCommandSpec"
    ));
    assert!(!runtime_root.contains("pub(crate) use command::WorkerCommandSpec"));
    assert!(!crate_root.contains("WorkerCommandSpec"));
    assert!(asr_model.contains("AsrModelDownloadJob"));
    for forbidden in [
        "WorkerCommandSpec",
        "WorkerInvocation",
        "WorkerRunRequest",
        "build_model_download_command_spec",
        "bundled_python_path",
        "prepend_to_path",
    ] {
        assert!(
            !asr_model.contains(forbidden),
            "ASR application owner retains raw process capability {forbidden}"
        );
    }
    assert!(command.contains("--download-asr-model"));

    let mut sources = Vec::new();
    collect_rust_sources(&src, &mut sources);
    for path in sources {
        if path.starts_with(&runtime_dir) {
            continue;
        }
        let source = std::fs::read_to_string(&path).expect("read Rust application source");
        for forbidden in ["WorkerCommandSpec", "WorkerInvocation", "WorkerRunRequest"] {
            assert!(
                !source.contains(forbidden),
                "{} imports raw worker capability {forbidden}",
                path.display()
            );
        }
        assert!(
            !source.contains("--download-asr-model"),
            "{} owns the model-download CLI outside worker_runtime",
            path.display()
        );
    }
}
```

The collector scans `app/src-tauri/src` only. Do not ban ordinary result types,
`std::process::Command` globally, or test fixtures inside `worker_runtime`.

- [x] **Step 2: Run the boundary test and capture RED**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml raw_worker_process_capability_stays_inside_worker_runtime
```

Expected: FAIL because `WorkerCommandSpec` remains `pub(crate)` and is still re-exported by
`worker_runtime/mod.rs` and `lib.rs`.

- [x] **Step 3: Restrict visibility and remove re-exports**

In `worker_runtime/command.rs`, change the raw type and fields to:

```rust
#[derive(Clone)]
pub(in crate::worker_runtime) struct WorkerCommandSpec {
    pub(in crate::worker_runtime) program: PathBuf,
    pub(in crate::worker_runtime) args: Vec<String>,
    pub(in crate::worker_runtime) stdin_payload: Option<String>,
    pub(in crate::worker_runtime) env: Vec<(String, String)>,
    pub(in crate::worker_runtime) env_remove: Vec<String>,
    pub(in crate::worker_runtime) current_dir: PathBuf,
}
```

Narrow the test-only helper at the same time:

```rust
#[cfg(test)]
pub(in crate::worker_runtime) fn env_map(&self) -> HashMap<String, String> {
    self.env.iter().cloned().collect()
}
```

Delete:

```rust
pub(crate) use command::WorkerCommandSpec;
```

from `worker_runtime/mod.rs`, and remove `WorkerCommandSpec` from the crate-root runtime re-export
in `lib.rs`.

- [x] **Step 4: Update only internal runner test imports**

Change the three runtime test files from:

```rust
use crate::worker_runtime::WorkerCommandSpec;
```

to:

```rust
use crate::worker_runtime::command::WorkerCommandSpec;
```

No production application import may replace the removed re-export.

- [x] **Step 5: Run GREEN boundary and complete Rust tests**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml raw_worker_process_capability_stays_inside_worker_runtime
cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
```

Expected: the boundary test and complete Rust suite pass. Current runner lifecycle, model
availability/result mapping, and task facade tests remain green.

- [x] **Step 6: Commit the capability closure**

```powershell
git add app/src-tauri/src/worker_runtime app/src-tauri/src/lib.rs
git commit -m "refactor(worker): make process specs runtime-private"
```

### Task 5: Complete Verification and Close Governance

**Files:**

- Modify:
  `docs/design-docs/2026-07-24-asr-model-download-job-capability-boundary.md`
- Move:
  `docs/exec-plans/active/2026-07-24-asr-model-download-job-capability-plan.md`
  to
  `docs/exec-plans/completed/2026-07-24-asr-model-download-job-capability-plan.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`

- [x] **Step 1: Run the complete implementation gate**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
npm --prefix app test
npm --prefix app run build
node --test scripts/tests/*.test.mjs
python scripts/validate_agents_docs.py --level WARN
npm --prefix app run tauri -- build --no-bundle
git diff --check
```

Expected:

- all Rust, App, and repository tests pass;
- Rust formatting and frontend production build pass;
- governance reports zero errors and warnings;
- the Tauri application builds without bundling;
- no whitespace errors remain.

No real model download, network request, LLM request, or AI Credit consumption is required because
the command bytes and public behavior are unchanged. If the native Tauri build is unavailable,
record the exact blocker and do not mark the plan completed without explicit acceptance.

- [x] **Step 2: Review the final diff against protected scope**

Run:

```powershell
git diff --name-only
git diff -- app/src-tauri/src/asr_model.rs app/src-tauri/src/worker_runtime app/src-tauri/src/lib.rs
```

Confirm:

- no Python, TypeScript, contract, product-spec, dependency, `.env` schema, or UI file changed;
- no command/env/path value changed;
- no new process entry, lane, retry, network request, or logging field exists; and
- the application can submit only `WorkerJob` or `AsrModelDownloadJob`.

- [x] **Step 3: Record evidence and archive**

Update this plan with exact RED/GREEN/full-suite counts and discoveries. Change the design status to
implemented, update Architecture/Security from pending target to current fact, move the audit/debt
item to resolved with evidence, check the task, archive the ExecPlan, and update active/completed
indexes.

- [x] **Step 4: Commit the verified closeout**

```powershell
git add AGENTS.md TASKS.md docs
git commit -m "docs: record ASR model capability boundary"
```

Do not push, merge, tag, publish, or create a PR without separate user authorization.

## Validation and Acceptance

### Required automated acceptance

The implementation is accepted only when:

1. a captured RED proves the command/job API was missing;
2. a captured RED proves raw `WorkerCommandSpec` visibility/re-exports still violated the target;
3. command-policy tests prove exact program, argv, null stdin, cwd, fixed environment, four optional
   overrides, and legacy LLM removal;
4. composition tests prove fixed operation and ASR progress route;
5. application result tests prove completion, cancellation, timeout, unstructured failure,
   protocol failure, and safe runtime mapping are unchanged;
6. the source gate proves no production module outside `worker_runtime` owns raw process types or
   the model-download CLI flag; and
7. every complete command in Task 5 passes.

### Manual review

Review the final Rust diff and verify:

- `asr_model.rs` visibly reads configuration and constructs only `AsrModelDownloadJob`;
- `worker_runtime::command` visibly owns all process details;
- `ProcessSupervisors` visibly fixes operation, progress, and model lane;
- `WorkerCommandSpec` cannot be imported outside `worker_runtime`; and
- no public Tauri/worker protocol changed.

A real model download is not required for this behavior-neutral capability refactor. Existing
native model-download acceptance remains valid because executable, argv, env, cwd, progress,
watchdog, and terminal mappings are exact compatibility invariants. Platform evidence not rerun
must be stated as residual evidence, not silently claimed.
