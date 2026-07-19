# Video Processing Task-Result Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract process-video and AI-retry task outcome adaptation from `video_processing.rs` into one focused private Rust module without changing any command, contract, result, diagnostic, cache, cancellation, or user-visible behavior.

**Architecture:** `video_processing.rs` remains the Tauri command adapter and application orchestrator. A private `video_processing/task_result.rs` module receives only typed worker runtime outcomes plus a closed process/retry context, then either passes through a validated task result or creates the existing fixed synthetic task failure. Worker execution, terminal parsing, cache lookup, source preflight, settings, logging, and future local-media contract v4 stay outside this module.

**Tech Stack:** Rust 2021, Tauri v2, Serde/serde_json, Cargo tests, existing FrameQ worker-runtime closed DTOs, Markdown governance documents.

---

> This ExecPlan is a living document. Keep Progress, Surprises & Discoveries, Decision Log, and
> Outcomes & Retrospective current while executing it.

## Progress

- [x] 2026-07-19: Inspected `video_processing.rs`, the typed worker facade, terminal-result protocol,
  diagnostics boundary, active local-media plan, and current audit evidence.
- [x] 2026-07-19: Established a green focused baseline in the isolated
  `codex/video-processing-result-boundary` worktree. Validation: all 18 existing
  `video_processing::tests` passed.
- [x] 2026-07-19: Compared big-bang extraction, focused task-result extraction, and deferral until
  local-media completion; selected the focused adapter and received user approval. Persistent
  design: `docs/design-docs/2026-07-19-video-processing-task-result-boundary.md`.
- [x] 2026-07-19: Converted the approved design into this test-first active ExecPlan and synchronized
  the design status, active indexes, task tracking, and local-media prerequisite order. Validation:
  plan self-review found no placeholder/type/scope gap; governance reported 0 errors and 0 warnings,
  and the tracked diff check passed.
- [ ] Add focused RED tests that require the new child-module API and fail only because the adapter
  does not yet exist.
- [ ] Implement the adapter, migrate process-video/retry call sites, and remove the superseded parent
  helpers/tests while keeping cache and preflight code in place.
- [ ] Run focused and full regression gates, synchronize architecture/security/audit/local-media
  governance, record evidence, and archive this plan.

## Surprises & Discoveries

- `video_processing.rs` must continue importing `ValidatedWorkerResult`, `WorkerRunOutcome`, and
  `WorkerRunErrorKind` after this increment because source-identity preflight still has a distinct,
  deliberately tolerant outcome policy. Their remaining presence is not evidence that task-result
  extraction failed.
- `closed_task_result` must remain in the parent after the extraction because the unsupported-ASR
  configuration path still constructs a trusted closed task result there. Moving that request
  failure is outside this plan.
- Existing `summarize_task_result_for_log` is a diagnostics projection that may preserve sanitized
  task/error metadata. It stays in the parent rather than giving the new adapter a second logging
  responsibility.
- The active local-media plan will eventually add `ProcessLocalMedia`, but neither its worker job nor
  result context may be reserved in this refactor. They land only with contract v4 and the real
  Python consumer.

## Decision Log

- Decision: Expose one `TaskCommandContext` with exactly `ProcessVideo` and `RetryInsights` plus one
  `map_task_worker_result` function. Rationale: callers can no longer supply arbitrary
  status/stage/message tuples, while the adapter remains smaller than another execution facade.
  Date/Author: 2026-07-19, User + Codex.
- Decision: Keep cache materialization, source preflight, request resolution, retry diagnostics, and
  ASR-configuration failure construction in `video_processing.rs`. Rationale: each has a different
  dependency or failure boundary and does not need to move to prove this extraction.
  Date/Author: 2026-07-19, User + Codex.
- Decision: Keep `PipeUnavailable` and `WaitFailed` as command errors carrying the runner-owned fixed
  `&'static str` detail. Rationale: converting them into a task failure would change current Tauri
  error behavior, while broadening the detail type would weaken the security boundary.
  Date/Author: 2026-07-19, User + Codex.
- Decision: Require focused adapter tests plus the full Rust suite and app contract regressions, but
  do not run or modify the Python worker solely for this Rust-only refactor. Rationale: worker code,
  wire schemas, packaged resources, and producer behavior are explicit non-goals; any such diff is
  scope drift requiring renewed review. Date/Author: 2026-07-19, Codex.

## Outcomes & Retrospective

Implementation has not started. The approved design and this executable plan define the boundary;
the current branch contains documentation only.

## Context and Orientation

- Approved design:
  `docs/design-docs/2026-07-19-video-processing-task-result-boundary.md`.
- Current application module: `app/src-tauri/src/video_processing.rs`.
- New private module: `app/src-tauri/src/video_processing/task_result.rs`.
- Typed execution facade: `app/src-tauri/src/worker_runtime/facade.rs`.
- Runtime outcome/error types: `app/src-tauri/src/worker_runtime/runner.rs`.
- Closed task result and protocol parser:
  `app/src-tauri/src/worker_runtime/result_protocol.rs`.
- Existing safe result diagnostics: `app/src-tauri/src/diagnostics.rs`.
- Future consumer:
  `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`.
- Architecture audit: `docs/design-docs/frameq-code-audit-uml.md`.

## File Responsibility Map

| File | Responsibility after implementation |
|---|---|
| `app/src-tauri/src/video_processing.rs` | Tauri commands, runtime path/config preparation, URL cache/preflight orchestration, retry diagnostics, worker job submission, cancellation |
| `app/src-tauri/src/video_processing/task_result.rs` | Closed process/retry context policy and typed worker outcome-to-task-result adaptation only |
| `app/src-tauri/src/worker_runtime/result_protocol.rs` | Worker stdout parsing and closed terminal DTO validation; unchanged |
| `app/src-tauri/src/worker_runtime/runner.rs` | Spawn/stdin/progress/wait/cancellation precedence and typed runtime outcomes; unchanged |

No dependency, contract, worker, manifest, frontend source, Tauri command registration, or packaged
resource file is created or modified by the production refactor.

## Task 1: Establish the RED Task-Result Adapter Contract

**Files:**

- Create: `app/src-tauri/src/video_processing/task_result.rs`
- Modify: `app/src-tauri/src/video_processing.rs`
- Test: `app/src-tauri/src/video_processing/task_result.rs`

- [ ] **Step 1: Register the private child module**

Add this declaration before the imports in `app/src-tauri/src/video_processing.rs`:

```rust
mod task_result;
```

- [ ] **Step 2: Create the test-only RED module**

Create `app/src-tauri/src/video_processing/task_result.rs` with the following tests and no production
items yet. The unresolved `map_task_worker_result` and `TaskCommandContext` imports are the intended
RED failure.

```rust
#[cfg(test)]
mod tests {
    use super::{map_task_worker_result, TaskCommandContext};
    use crate::worker_runtime::{
        ModelDownloadTerminalResult, TaskTerminalResult, ValidatedWorkerResult, WorkerExitSummary,
        WorkerRunError, WorkerRunErrorKind, WorkerRunOutcome,
    };

    fn task_value(result: &TaskTerminalResult) -> serde_json::Value {
        serde_json::to_value(result).expect("serialize closed task result")
    }

    fn completed_task_result() -> TaskTerminalResult {
        TaskTerminalResult::from_value(serde_json::json!({
            "status": "completed",
            "task_id": "task-1",
            "task_dir": "C:/frameq/task-1",
            "artifacts": {},
            "text": "private transcript",
            "summary": "private summary",
            "insights": [],
            "transcript": null,
            "error": null
        }))
        .expect("valid task result")
    }

    #[test]
    fn structured_task_result_passes_through_unchanged() {
        let expected = completed_task_result();
        let actual = map_task_worker_result(
            Ok(WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(
                expected.clone(),
            ))),
            TaskCommandContext::ProcessVideo,
        )
        .expect("map task result");

        assert_eq!(actual, expected);
    }

    #[test]
    fn process_and_retry_contexts_keep_fixed_cancellation_and_unstructured_shapes() {
        for (context, status, stage, message) in [
            (
                TaskCommandContext::ProcessVideo,
                "failed",
                "video_extracting",
                "Worker process failed before returning a structured result.",
            ),
            (
                TaskCommandContext::RetryInsights,
                "partial_completed",
                "insights_generating",
                "AI generation worker failed before returning a structured result.",
            ),
        ] {
            let cancelled = map_task_worker_result(
                Ok(WorkerRunOutcome::Cancelled),
                context,
            )
            .expect("map cancellation");
            let cancelled = task_value(&cancelled);
            assert_eq!(cancelled["status"], status);
            assert_eq!(cancelled["error"]["stage"], stage);
            assert_eq!(cancelled["error"]["code"], "WORKER_CANCELLED");

            let unstructured = map_task_worker_result(
                Ok(WorkerRunOutcome::UnstructuredFailure(WorkerExitSummary {
                    exit_code: Some(1),
                    stderr: "review-secret https://secret.example",
                })),
                context,
            )
            .expect("map unstructured failure");
            let unstructured = task_value(&unstructured);
            assert_eq!(unstructured["status"], status);
            assert_eq!(unstructured["error"]["stage"], stage);
            assert_eq!(unstructured["error"]["code"], "WORKER_PROCESS_FAILED");
            assert_eq!(unstructured["error"]["message"], message);
            assert!(!unstructured.to_string().contains("review-secret"));
            assert!(!unstructured.to_string().contains("https://"));
        }
    }

    #[test]
    fn mismatched_family_and_runtime_failures_use_fixed_safe_task_errors() {
        let mismatched = map_task_worker_result(
            Ok(WorkerRunOutcome::Structured(
                ValidatedWorkerResult::ModelDownload(ModelDownloadTerminalResult::Completed {
                    model: "iic/SenseVoiceSmall".to_string(),
                }),
            )),
            TaskCommandContext::ProcessVideo,
        )
        .expect("map mismatched family");
        let mismatched = task_value(&mismatched);
        assert_eq!(
            mismatched["error"]["code"],
            "WORKER_PROTOCOL_VIOLATION"
        );
        assert_eq!(mismatched["error"]["message"], "");

        for (kind, expected_code) in [
            (WorkerRunErrorKind::AlreadyRunning, "WORKER_ALREADY_RUNNING"),
            (
                WorkerRunErrorKind::SpawnFailed,
                "WORKER_REQUEST_TRANSPORT_FAILED",
            ),
            (
                WorkerRunErrorKind::RequestDeliveryFailed,
                "WORKER_REQUEST_TRANSPORT_FAILED",
            ),
            (
                WorkerRunErrorKind::ProtocolViolation,
                "WORKER_PROTOCOL_VIOLATION",
            ),
        ] {
            let result = map_task_worker_result(
                Err(WorkerRunError {
                    kind,
                    detail: "review-secret https://secret.example",
                }),
                TaskCommandContext::ProcessVideo,
            )
            .expect("map runtime error");
            let result = task_value(&result);
            assert_eq!(result["error"]["code"], expected_code);
            assert!(!result.to_string().contains("review-secret"));
            assert!(!result.to_string().contains("https://"));
        }
    }

    #[test]
    fn pipe_and_wait_failures_preserve_fixed_command_errors() {
        for (kind, detail) in [
            (WorkerRunErrorKind::PipeUnavailable, "fixed pipe failure"),
            (WorkerRunErrorKind::WaitFailed, "fixed wait failure"),
        ] {
            let error = map_task_worker_result(
                Err(WorkerRunError { kind, detail }),
                TaskCommandContext::RetryInsights,
            )
            .expect_err("pipe/wait failures remain command errors");

            assert_eq!(error, detail);
        }
    }
}
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml video_processing::task_result::tests
```

Expected: compilation fails with unresolved imports for `map_task_worker_result` and
`TaskCommandContext`. It must not fail because of missing dependencies, unrelated source errors, or
an unavailable test runtime.

- [ ] **Step 4: Record RED evidence in this plan**

Add one dated Progress entry naming the exact compiler error and confirming that the failure is
limited to the intentionally missing adapter API. Do not commit the non-compiling state separately.

## Task 2: Implement and Adopt the Focused Adapter

**Files:**

- Modify: `app/src-tauri/src/video_processing/task_result.rs`
- Modify: `app/src-tauri/src/video_processing.rs`
- Test: `app/src-tauri/src/video_processing/task_result.rs`
- Test: `app/src-tauri/src/video_processing.rs`

- [ ] **Step 1: Add the minimal production implementation above the RED tests**

Insert this implementation before `#[cfg(test)] mod tests` in
`app/src-tauri/src/video_processing/task_result.rs`:

```rust
use crate::worker_runtime::{
    TaskTerminalResult, ValidatedWorkerResult, WorkerRunError, WorkerRunErrorKind, WorkerRunOutcome,
    WORKER_PROTOCOL_VIOLATION,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum TaskCommandContext {
    ProcessVideo,
    RetryInsights,
}

struct TaskFailurePolicy {
    status: &'static str,
    stage: &'static str,
    unstructured_message: &'static str,
}

impl TaskCommandContext {
    fn failure_policy(self) -> TaskFailurePolicy {
        match self {
            Self::ProcessVideo => TaskFailurePolicy {
                status: "failed",
                stage: "video_extracting",
                unstructured_message:
                    "Worker process failed before returning a structured result.",
            },
            Self::RetryInsights => TaskFailurePolicy {
                status: "partial_completed",
                stage: "insights_generating",
                unstructured_message:
                    "AI generation worker failed before returning a structured result.",
            },
        }
    }
}

pub(super) fn map_task_worker_result(
    result: Result<WorkerRunOutcome, WorkerRunError>,
    context: TaskCommandContext,
) -> Result<TaskTerminalResult, String> {
    match result {
        Ok(WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(value))) => Ok(value),
        Ok(WorkerRunOutcome::Structured(_)) => Ok(worker_protocol_failure_result(context)),
        Ok(WorkerRunOutcome::Cancelled) => Ok(worker_failure_result(
            context,
            "WORKER_CANCELLED",
            "Worker process was cancelled.",
        )),
        Ok(WorkerRunOutcome::UnstructuredFailure(_)) => {
            let message = context.failure_policy().unstructured_message;
            Ok(worker_failure_result(
                context,
                "WORKER_PROCESS_FAILED",
                message,
            ))
        }
        Err(error) => match error.kind {
            WorkerRunErrorKind::AlreadyRunning => Ok(worker_failure_result(
                context,
                "WORKER_ALREADY_RUNNING",
                "Another worker process is already running.",
            )),
            WorkerRunErrorKind::SpawnFailed | WorkerRunErrorKind::RequestDeliveryFailed => {
                Ok(worker_failure_result(
                    context,
                    "WORKER_REQUEST_TRANSPORT_FAILED",
                    "Worker request could not be delivered.",
                ))
            }
            WorkerRunErrorKind::ProtocolViolation => Ok(worker_protocol_failure_result(context)),
            WorkerRunErrorKind::PipeUnavailable | WorkerRunErrorKind::WaitFailed => {
                Err(error.detail.to_string())
            }
        },
    }
}

fn worker_failure_result(
    context: TaskCommandContext,
    code: &'static str,
    message: &'static str,
) -> TaskTerminalResult {
    let policy = context.failure_policy();
    TaskTerminalResult::from_value(serde_json::json!({
        "status": policy.status,
        "task_id": null,
        "task_dir": null,
        "artifacts": {},
        "text": "",
        "summary": "",
        "insights": [],
        "transcript": null,
        "error": {
            "code": code,
            "message": message,
            "stage": policy.stage
        }
    }))
    .expect("trusted desktop task result must satisfy the terminal contract")
}

fn worker_protocol_failure_result(context: TaskCommandContext) -> TaskTerminalResult {
    worker_failure_result(context, WORKER_PROTOCOL_VIOLATION, "")
}
```

Do not import Tauri, task manifests, settings, runtime paths, process supervisors, diagnostics,
`WorkerJob`, or `VideoWorkerFacade` into this module.

- [ ] **Step 2: Run the focused adapter tests and verify GREEN**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml video_processing::task_result::tests
```

Expected: all four new adapter tests pass.

- [ ] **Step 3: Migrate the two task-producing call sites**

Use these imports in `app/src-tauri/src/video_processing.rs`:

```rust
mod task_result;

use crate::settings::{env_path, parse_dotenv_values, resolve_asr_model_value, ASR_MODEL_ENV};
use crate::task_manifest;
use crate::worker_runtime::{
    SourceIdentityTerminalResult, TaskTerminalResult, ValidatedWorkerResult, WorkerJob,
    WorkerRunErrorKind, WorkerRunOutcome,
};
use task_result::{map_task_worker_result, TaskCommandContext};
```

Change the process-video mapping call to:

```rust
map_task_worker_result(
    process_state
        .video_worker(&paths)
        .execute(WorkerJob::process_video(request_json, window))?,
    TaskCommandContext::ProcessVideo,
)
```

Change the retry-insights mapping call to:

```rust
let parsed = map_task_worker_result(
    process_state
        .video_worker(&paths)
        .execute(WorkerJob::retry_insights(request_json, window))?,
    TaskCommandContext::RetryInsights,
)?;
```

Do not alter the surrounding cache-hit logging, preflight behavior, retry start/result diagnostics,
or command return types.

- [ ] **Step 4: Delete superseded parent helpers and tests**

Delete these functions from `app/src-tauri/src/video_processing.rs`:

```text
map_worker_run_result
worker_failure_result
cancelled_worker_result
worker_already_running_result
worker_transport_failure_result
worker_protocol_failure_result
```

Keep `closed_task_result` because the unsupported-ASR path still uses it. Keep
`summarize_task_result_for_log` because diagnostics remain outside the adapter.

Remove the following two superseded parent tests; their behavior is now covered beside the new
module:

```text
worker_lifecycle_failures_keep_process_and_retry_public_shapes
typed_runner_outcomes_preserve_process_and_retry_adapter_shapes
```

Reduce the parent test imports to the symbols still used there. In particular, remove
`WorkerExitSummary`, `WorkerRunError`, `WorkerRunErrorKind`, and `WorkerRunOutcome` from the parent
test module; the production parent still keeps the outcome/error-kind imports needed by source
preflight.

- [ ] **Step 5: Run all video-processing tests**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml video_processing
```

Expected: adapter, cache, IPC request, retry request, retry diagnostic, and request-resolution tests
all pass.

- [ ] **Step 6: Verify the dependency boundary**

Run:

```powershell
$matches = rg -n "tauri::|task_manifest|settings::|RuntimePaths|ProcessSupervisors|append_desktop_log|WorkerJob|VideoWorkerFacade" app/src-tauri/src/video_processing/task_result.rs
if ($LASTEXITCODE -eq 0) { $matches; exit 1 }
if ($LASTEXITCODE -gt 1) { exit $LASTEXITCODE }
Write-Output "task_result dependency boundary passed"
```

Expected: `task_result dependency boundary passed` and no forbidden match.

- [ ] **Step 7: Run Rust regression and formatting gates**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
```

Expected: the complete Rust suite passes and rustfmt reports no diff.

- [ ] **Step 8: Commit the production refactor**

```powershell
git add app/src-tauri/src/video_processing.rs app/src-tauri/src/video_processing/task_result.rs docs/exec-plans/active/2026-07-19-video-processing-task-result-boundary-plan.md
git commit -m "refactor(tauri): extract task result adapter"
```

## Task 3: Run Cross-Layer Regression Gates

**Files:**

- Modify: `docs/exec-plans/active/2026-07-19-video-processing-task-result-boundary-plan.md`

- [ ] **Step 1: Run the complete app test suite**

Run:

```powershell
npm --prefix app test
```

Expected: every frontend/IPC contract test passes; the current baseline before implementation is 63
files and 542 tests.

- [ ] **Step 2: Run frontend lint and production build**

Run:

```powershell
npm --prefix app run lint
npm --prefix app run build
```

Expected: TypeScript and i18n literal checks pass, and Vite builds successfully. Record the existing
main-chunk warning if it remains; do not treat it as caused by this Rust-only refactor.

- [ ] **Step 3: Run repository script and documentation gates**

Run:

```powershell
node --test scripts/tests/*.test.mjs
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Expected: all script tests pass, governance validation reports 0 errors and 0 warnings, and the diff
check emits no errors.

- [ ] **Step 4: Prove worker, contract, manifest, and frontend production sources are untouched**

Run:

```powershell
git diff --name-only main...HEAD
git status --short
```

Review the output and require that production changes are limited to:

```text
app/src-tauri/src/video_processing.rs
app/src-tauri/src/video_processing/task_result.rs
```

Documentation/governance files from this design and plan are allowed. Any path under `worker/`,
`contracts/`, `app/src/`, `app/src-tauri/resources/worker/`, or manifest schema implementation is
scope drift and must be reverted or returned to design review.

- [ ] **Step 5: Record exact verification evidence**

Update Progress with exact test totals, lint/build outcome, rustfmt outcome, script totals,
governance result, diff result, and any pre-existing warning. Update Surprises & Discoveries only
for facts observed during execution; do not invent a surprise entry when none occurred.

## Task 4: Synchronize Governance and Archive the Plan

**Files:**

- Modify: `docs/design-docs/2026-07-19-video-processing-task-result-boundary.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Move: `docs/exec-plans/active/2026-07-19-video-processing-task-result-boundary-plan.md` to `docs/exec-plans/completed/2026-07-19-video-processing-task-result-boundary-plan.md`

- [ ] **Step 1: Record the implemented architecture and security boundary**

Change the design status to `Implemented and accepted on 2026-07-19`. Add concise dated sections to
`docs/ARCHITECTURE.md` and `docs/SECURITY.md` that state:

```text
- video_processing.rs remains the Tauri/application orchestrator;
- video_processing/task_result.rs alone maps typed task worker outcomes;
- process-video and retry contexts fix status, stage, code, and public messages;
- structured task results pass through unchanged;
- wrong result families and protocol failures never echo rejected values;
- worker runtime lifecycle, terminal parsing, diagnostics, commands, contract v3, and local-media v4 remain unchanged.
```

- [ ] **Step 2: Update the audit with measured current facts**

Measure both production files:

```powershell
(Get-Content app/src-tauri/src/video_processing.rs).Count
(Get-Content app/src-tauri/src/video_processing/task_result.rs).Count
```

Update `docs/design-docs/frameq-code-audit-uml.md` with the measured line counts. In the hotspot table,
remove task-result adaptation from `video_processing.rs` responsibilities but retain request parsing,
cache, preflight, diagnostics, and command orchestration. Add the implemented adapter to the resolved
audit evidence while explicitly stating that the parent remains a maintenance hotspot and that cache
or preflight extraction requires separate review.

- [ ] **Step 3: Close the prerequisite and task tracking**

In the local-media ExecPlan, mark task `0.2` complete and record the actual focused/full verification
evidence. In `TASKS.md`, mark this refactor complete and replace prospective acceptance text with the
actual totals. Do not mark any contract-v4 or local-media product task complete.

- [ ] **Step 4: Complete and archive this ExecPlan**

Update Outcomes & Retrospective with the delivered boundary, unchanged behavior, exact gates, and
residual risks. Move this file from `active/` to `completed/`, remove it from the active index, add it
to the completed index, remove the active-refactor entry from `AGENTS.md`, and make it the most recent
completed plan entry if it is still chronologically latest.

- [ ] **Step 5: Re-run final documentation and diff gates**

Run:

```powershell
python scripts/validate_agents_docs.py --level WARN
git diff --check
git status --short
```

Expected: 0 documentation errors, 0 warnings, no whitespace errors, and only the reviewed closeout
files remain uncommitted.

- [ ] **Step 6: Commit closeout documentation**

```powershell
git add AGENTS.md TASKS.md docs/ARCHITECTURE.md docs/SECURITY.md docs/design-docs/2026-07-19-video-processing-task-result-boundary.md docs/design-docs/frameq-code-audit-uml.md docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md docs/exec-plans/active/index.md docs/exec-plans/completed/index.md docs/exec-plans/completed/2026-07-19-video-processing-task-result-boundary-plan.md
git commit -m "docs(tauri): close task result boundary"
```

## Final Acceptance

Automated acceptance requires:

- focused adapter tests prove structured passthrough and every current outcome/error branch;
- process-video and retry keep their exact existing status, stage, code, and message policy;
- unstructured stderr and rejected result-family data never enter synthetic public errors;
- `PipeUnavailable` and `WaitFailed` retain fixed command-error behavior;
- the adapter has no Tauri, settings, manifest, runtime-path, supervisor, execution-facade, or
  diagnostics dependency;
- all `video_processing`, full Rust, rustfmt, app, lint/build, scripts, docs, and diff gates pass;
- worker, contract, manifest schema, Tauri command registration, frontend production code, and
  packaged worker remain unchanged; and
- local-media task `0.2` alone closes, while contract-v4 implementation remains pending.

No separate native Windows/macOS interaction is required because this plan changes no command,
worker process lifecycle, cancellation implementation, path handling, UI, or filesystem behavior.
The existing native lifecycle evidence remains applicable; any observed native behavior change is a
release blocker and requires investigation rather than a documentation waiver.
