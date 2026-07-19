# Rust Worker Runtime Lifecycle Boundary

## Status

Implemented and accepted on 2026-07-18. All four operations use the shared runner, low-level
compatibility APIs are removed, local cross-stack gates pass, and hosted macOS run `29640471857`
executed the real Unix parent-child process-group fixture successfully at commit
`481b4d7841566bab172cd77694b43e734e137333`. The user also confirmed the native Windows desktop
cancel, terminal confirmation, URL retention, second-task start, and stale-callback isolation flow.

Follow-up hardening on 2026-07-19 added the typed application execution boundary described in
`docs/design-docs/2026-07-19-typed-worker-job-facade.md`. Application modules no longer construct
`WorkerRunRequest` or select an invocation, operation, progress route, LLM policy, or lane; the
shared lifecycle and native cancellation behavior below are unchanged.

## Problem

The Rust desktop layer has one documented `ProcessSupervisor` state machine per process lane, but
the complete child-process lifecycle is not owned by one runtime boundary.

- `app/src-tauri/src/worker_command.rs` owns command/environment construction, process-group setup,
  stdin delivery, supervisor state, cancellation, operating-system termination, stdout parsing, and
  lifecycle log helpers.
- `process_video` and `retry_insights` in `app/src-tauri/src/video_processing.rs` each take stderr,
  start a progress reader, wait for the child, finish the supervisor instance, join the reader,
  parse stdout, resolve cancellation races, and map failures.
- The source-identity preflight in `video_processing.rs` implements a smaller third wait/finish/parse
  sequence.
- `download_asr_model` in `app/src-tauri/src/asr_model.rs` implements another spawn/register,
  progress, wait, finish, parse, and cancellation sequence.

As a result, a change to cancellation precedence, stdin cleanup, progress validation, diagnostic
redaction, or terminal cleanup requires auditing several flows. The compiler does not prevent a
new command from bypassing part of the intended lifecycle.

The problem is therefore not file size by itself. The problem is split ownership: supervisor state
is centralized, while terminal observation and cleanup remain caller-controlled.

## Goals

- Establish exactly one reusable runner for every supervised Python worker and ASR model-download
  child process.
- Make spawn, process-group setup, supervisor registration, stdin delivery, stderr handling, wait,
  matching-instance finish, terminal classification, and lifecycle diagnostics one ordered
  operation.
- Keep cache lookup, entitlement gates, request validation, task manifests, and public result
  mapping in their existing application modules; the later typed facade owns retry-only checkout
  material as execution policy.
- Preserve the current desktop-worker JSON contract, Tauri commands, frontend states, output files,
  and cancellation behavior.
- Make low-level process operations private so future application code cannot assemble another
  lifecycle accidentally.
- Preserve the existing local-first and diagnostic privacy boundaries.

## Non-Goals

- Do not add background execution, restart recovery, a task queue, multiple concurrent video jobs,
  or worker hot updates.
- Do not rewrite the desktop process layer to Tokio, async process streams, actors, or an external
  process-management dependency.
- Do not change Python worker CLI flags, stdin JSON, stdout JSON, progress-event schemas, model
  download behavior, AI Credits, or server-managed LLM checkout.
- Do not combine video and ASR model-download lanes; they remain separate mutually exclusive lanes
  backed by the same implementation.
- Do not make the runner understand business statuses such as `partial_completed`, task manifests,
  cache hits, transcript artifacts, or AI targets.

## Decision

Create a focused `worker_runtime` Rust module and expose a typed application execution boundary
rather than raw process primitives.

```text
app/src-tauri/src/worker_runtime/
  mod.rs
  command.rs
  facade.rs
  supervisor.rs
  runner.rs
```

### Module Responsibilities

| Module | Owns | Must Not Own |
|---|---|---|
| `worker_runtime/command.rs` | `WorkerInvocation`, `WorkerCommandSpec`, fixed CLI modes, bounded stdin payload, environment construction | spawning, waiting, cancellation state, result mapping |
| `worker_runtime/facade.rs` | closed `WorkerJob`, exhaustive video-job invocation/operation/progress/LLM/lane policy, `VideoWorkerFacade::execute` | cache, task manifests, public result mapping, child lifecycle implementation |
| `worker_runtime/supervisor.rs` | lane state, instance IDs, PID/PGID, `Running`/`Cancelling`, cancellation claim/rollback, fixed Windows/macOS tree termination | worker JSON, progress events, task/AI semantics |
| `worker_runtime/runner.rs` | spawn configuration, supervisor registration, stdin delivery, stderr reader, progress routing, wait/reap, finish ordering, stdout parsing, terminal classification, lifecycle diagnostics | cache, manifests, entitlement, public `ProcessVideoResult` construction |
| `progress_event.rs` | pure contract-backed validation and safe invalid-event summaries | process ownership and Tauri command orchestration |
| `diagnostics.rs` | app-local log sink, sanitization, truncation, safe result summaries | deciding child lifecycle or cancellation precedence |
| `video_processing.rs` | process-video cache/preflight policy, semantic job submission, retry request validation, domain result mapping | invocation/operation/progress/lane/LLM execution policy, `Command`, `Child`, raw stderr threads, direct `finish()` or process-tree termination |
| `asr_model.rs` | model availability/configuration and model-download product result/event mapping | raw spawn/register/wait/finish implementation |

`worker_command.rs` is retired after migration. Its command construction, supervision, and runner
tests move with the responsibility they verify.

## Public Runtime Surface

Application modules receive semantic execution and typed terminal mapping only. Low-level request
composition, supervisor mutation, and operating-system process functions stay private to
`worker_runtime`.

```rust
pub(crate) enum WorkerJob {
    ProcessVideo { /* payload + progress target */ },
    ResolveSourceIdentity { /* payload */ },
    RetryInsights { /* payload + progress target */ },
}

VideoWorkerFacade::execute(job)
ProcessSupervisors::{cancel_video, is_video_active}
ProcessSupervisors::{run_asr_model_download, cancel_asr_model_download}

pub(crate) enum WorkerRunOutcome {
    Structured(serde_json::Value),
    Cancelled,
    UnstructuredFailure(WorkerExitSummary),
}

pub(crate) enum WorkerRunErrorKind {
    AlreadyRunning,
    SpawnFailed,
    RequestDeliveryFailed,
    PipeUnavailable,
    WaitFailed,
    ProtocolViolation,
}
```

`WorkerInvocation`, `WorkerOperation`, `ProgressRoute`, `WorkerRunRequest`, and `WorkerLane` are
internal implementation types. `VideoWorkerFacade` derives them through one exhaustive match; ASR
model download uses a separate narrow method that derives its fixed operation, progress route, and
lane.

The exact error carrier may include a sanitized bounded diagnostic for the desktop log, but it must
never carry the stdin payload, raw command line, raw source URL, complete local source path,
credential, transcript, prompt, or generated result body.

`ProcessSupervisors` remains a collection of private `WorkerLane` values. Application modules may
submit semantic jobs, cancel/query the video lane, or execute/cancel model download; they cannot call
`WorkerLane::run`, `start`, `finish`, `restore_running`, or `terminate_process_tree` directly.

## Lifecycle Order

Every `WorkerLane::run` follows one sequence:

1. Build the operating-system child from a prevalidated `WorkerCommandSpec` without a shell.
2. Apply the hidden-window flag on Windows or create a fresh process group on macOS/Unix.
3. Spawn the child with piped stdout/stderr and piped stdin only when a payload exists.
4. Register the child PID/PGID in the lane before writing the one-shot stdin payload.
5. Deliver and close stdin. A blocked delivery remains cancellable because registration already
   happened.
6. Take stderr and start the route-specific reader. The reader validates progress through the
   existing closed contract and collects only bounded diagnostic input.
7. Wait for the child and capture stdout.
8. Immediately finish the matching supervisor instance after terminal observation and before
   waiting for the stderr reader to join. A child that has exited is no longer cancellable merely
   because reader cleanup is still running.
9. Join the reader, sanitize/truncate diagnostics, parse the final structured stdout result, and
   classify the terminal outcome.
10. Emit fixed, safe lifecycle diagnostics and return one typed outcome to the application module.

An internal guard ensures a matching supervisor instance is cleared exactly once on every early
return. Setup failures after spawn explicitly terminate and reap the child before releasing the
instance. The guard is not allowed to fabricate a completed cancellation result; only terminal
classification after child observation can do that.

## Terminal Precedence

The runner applies one rule to every operation:

1. A valid structured worker result wins, including when cancellation was claimed concurrently.
2. If no structured result exists and the matching terminal phase was `Cancelling`, return
   `WorkerRunOutcome::Cancelled`.
3. A successful exit without a structured result is a protocol violation.
4. A nonzero/signal exit without a structured result is an unstructured worker failure.

This is the cancellation contract already documented for FrameQ. The source-identity preflight must
receive a characterization test because its current implementation checks `Cancelling` before
parsing stdout. The migration intentionally aligns it with the documented structured-result-first
rule instead of preserving an inconsistent local ordering.

## Progress Routing

Progress policy is a closed enum, not a caller-provided arbitrary parser or log-event name.

- `ProgressRoute::Worker` recognizes only `FRAMEQ_PROGRESS `, validates with
  `validate_worker_progress_event`, and emits only `worker-progress`.
- `ProgressRoute::AsrModelDownload` recognizes only the model-download prefix, validates with
  `validate_model_download_event`, and emits only the model-download event.
- `ProgressRoute::None` emits no progress and treats stderr only according to the bounded diagnostic
  policy.
- Invalid JSON or invalid contract events are dropped. Diagnostics record only the existing safe
  `message_code` summary and never worker prose.

The enum keeps the set of wire protocols auditable. Adding a third progress protocol requires an
explicit runtime and contract change rather than passing a permissive callback from a command.

## Diagnostics Boundary

Lifecycle logs use a closed `WorkerOperation` mapping to fixed event names. They may record:

- operation kind;
- supervisor-owned PID and safe exit code/signal marker;
- structured status, stable error code, and stage;
- validated retry target/output locale where already allowed;
- bundled JavaScript runtime availability;
- sanitized, truncated diagnostic text where the operation policy permits it.

They must not log raw `WorkerCommandSpec.args`, stdin, environment values, full executable/current
directory paths, source/local-media paths, URLs, credentials, request JSON, complete stderr,
transcripts, prompts, preference snapshots, or generated content. Sanitization remains defense in
depth; safe structured fields are preferred over attempting to redact arbitrary strings later.

Application modules retain safe business diagnostics such as cache hits and retry target/result
summaries. The runner owns only process lifecycle start/exit/cancel/protocol diagnostics.

## Application Mapping

- `process_video` keeps both cache checks, ASR-model request preparation, and the existing public
  `failed` result/status/stage mapping.
- `retry_insights` keeps strict request parsing, server-managed LLM invocation, safe target/locale
  diagnostics, and `partial_completed` mapping.
- Source-identity preflight maps structured safe identity data to `Some(SourceIdentity)`, ordinary
  unstructured preflight failure to `None`, and a confirmed cancellation to the existing cancelled
  task result.
- ASR model download keeps model availability checks, completed/cancelled product results, and its
  synthetic validated cancellation progress event.

No application module receives raw stderr or constructs an operating-system termination command.

## Failure Handling

| Failure | Required runner behavior |
|---|---|
| Spawn fails | Return `SpawnFailed`; no supervisor instance exists |
| Lane already active | Terminate/reap the newly spawned child and return `AlreadyRunning` |
| Stdin delivery fails | Terminate/reap, finish matching instance, return `Cancelled` only if cancellation was already claimed; otherwise `RequestDeliveryFailed` |
| Required pipe unavailable | Terminate/reap, finish matching instance, return `PipeUnavailable` |
| Wait fails | Perform bounded best-effort termination/reap, finish matching instance, return `WaitFailed` |
| Stderr reader panics | Keep the observed child outcome and use a fixed safe diagnostic marker |
| Structured stdout exists | Return it regardless of concurrent cancellation claim |
| No structured stdout while cancelling | Return `Cancelled` |
| Successful exit without structured stdout | Return `ProtocolViolation` |
| Failed exit without structured stdout | Return `UnstructuredFailure` with safe exit summary |

Stale finish or rollback calls remain harmless because every transition matches the monotonically
increasing instance ID.

## Migration Strategy

1. Add characterization tests for the lifecycle/terminal matrix before moving code.
2. Extract supervisor and operating-system termination behavior without changing its API semantics.
3. Extract command construction without changing CLI flags, stdin size, environment policy, or
   JavaScript runtime detection.
4. Build the shared runner and migrate `process_video` plus `retry_insights` together.
5. Migrate source-identity preflight and explicitly align its race ordering with the documented
   structured-result-first rule.
6. Migrate ASR model download to the model-download progress route.
7. Make low-level spawn, supervisor mutation, and process termination private; remove the old
   `worker_command.rs` exports and duplicated helpers.
8. Update architecture/security documentation and archive the completed ExecPlan only after all
   platform and privacy gates pass.

Each migration step must leave tests green and preserve Tauri/worker contracts. No step introduces a
temporary second production runner for already-migrated operations.

## Gates

- Runner tests cover spawn/setup failure cleanup, stdin cancellation, missing pipe, wait failure,
  finish-before-reader-join, stale instance protection, structured-result precedence, cancellation,
  malformed successful stdout, and unstructured failed exit.
- Progress tests prove both closed routes validate before emitting and log only safe invalid-code
  summaries.
- Privacy tests prove sensitive stdin reaches neither argv, environment, lifecycle logs, nor public
  errors; lifecycle logs contain no full paths or raw command vectors.
- Application tests prove process-video, retry, source-identity, and model-download adapters retain
  their existing public result/status/stage behavior.
- Existing Windows termination-vector tests and the native macOS process-group parent/child fixture
  remain required.
- Full Rust tests, rustfmt, app tests/build, governance validation, and `git diff --check` pass.

## Acceptance

- Production calls to `Command::spawn`, `Child::wait_with_output`, supervisor `start`/`finish`, and
  process-tree termination for FrameQ workers exist only inside `worker_runtime`.
- All four operations use `WorkerLane::run` and one terminal-classification implementation.
- `video_processing.rs` and `asr_model.rs` contain no stderr reader threads or direct process cleanup.
- Cancellation races and structured result precedence match the documented desktop process
  supervision contract.
- Worker/Tauri JSON, progress contracts, user-visible workflow, artifacts, cache, model files, and
  AI billing behavior remain unchanged.
- Logs expose only fixed safe lifecycle fields and bounded sanitized diagnostics.
