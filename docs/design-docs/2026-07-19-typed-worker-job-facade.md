# Typed Worker Job Execution Facade

## Status

Accepted and implemented on 2026-07-19. Delivery evidence is recorded in
`docs/exec-plans/completed/2026-07-19-typed-worker-job-facade-plan.md`.

## Context

`WorkerLane::run` already owns the complete child-process lifecycle, but application callers still
construct one execution from several independent values: `WorkerInvocation`, `WorkerOperation`,
`ProgressRoute`, a selected `WorkerLane`, and optional server-managed LLM checkout material. Rust
does not currently prevent a valid value from each enum being combined into an invalid job.

The approved local-media feature will add another operation to the video lane. Leaving this
coordination in each caller would make it possible for a local-media job to use the wrong CLI mode,
progress protocol, lifecycle log operation, credential policy, or lane while still compiling.

## Decision

Add a typed application-facing execution boundary inside `worker_runtime`:

- `WorkerJob` is a closed enum for the currently executable video-lane jobs: process URL video,
  resolve source identity, and retry insights.
- Job variants that publish worker progress carry the Tauri window; the source-identity variant
  cannot carry one and therefore always derives `ProgressRoute::None`.
- `VideoWorkerFacade` owns references to the resolved runtime paths and the video `WorkerLane`.
  `execute(job)` exhaustively derives the `WorkerInvocation`, `WorkerOperation`, progress route,
  fixed command specification, and server-managed LLM policy before delegating to
  `WorkerLane::run`.
- Only retry-insights resolves and supplies server-managed LLM invocation material. URL processing
  and source preflight cannot receive it through the job API.
- `ProcessSupervisors` keeps its two `WorkerLane` instances private and exposes semantic video
  facade, cancellation/activity, and ASR-model-download execution methods. Model download remains a
  separate narrow policy because it has its own command builder and lane.
- `WorkerLane::{run,cancel,is_active}` and the existing runner/supervisor lifecycle stay intact as
  the lower-level runtime facade, but application modules no longer receive raw request-composition
  types.

`ProcessLocalMedia` is deliberately not added as a dead variant. Contract v4 must add that variant,
its fixed CLI invocation, operation/log name, worker progress route, no-LLM policy, and tests in one
atomic change. Exhaustive matching then makes omissions a compile failure.

## 2026-07-23 Approved local-media extension

Contract-v4 pure validators now exist, but the local-media CLI and runtime consumer still do not.
When that consumer lands, the same vertical slice must:

- add the real `WorkerJob::ProcessLocalMedia` variant and its fixed stdin/progress/watchdog/no-LLM
  policy;
- rename `VideoWorkerFacade` to `TaskWorkerFacade`;
- rename the private `ProcessSupervisors.video`, `video_worker()`, and `is_video_active()` vocabulary
  to `task`, `task_worker()`, and `is_task_active()`; and
- preserve the public Tauri `process_video` command name and separate model-download lane.

The rename adds no new lifecycle owner. It makes the existing serialized lane's name match its
closed URL/local/AI job responsibility. All callers and tests move atomically; compatibility aliases
are rejected because they would leave two names for one policy boundary.

## Consequences

### Positive

- Invocation, operation, progress, credential, and video-lane policy have one owner.
- New video-lane jobs must update one exhaustive mapping and its table-driven tests.
- Application modules retain domain orchestration and result mapping without seeing raw lifecycle
  configuration.
- Existing cancellation, terminal precedence, progress validation, diagnostics, wire contracts,
  artifacts, and AI Credits behavior remain unchanged.

### Negative

- The runtime gains one additional module and a small typed wrapper around `WorkerLane`.
- Job payloads remain serialized JSON at the final Rust/Python boundary; strict contract validation
  is still required in the worker.

### Neutral

- ASR model download keeps its existing command-policy owner in `asr_model.rs`, but its
  operation/progress/lane pairing is submitted through a narrow `ProcessSupervisors` method.
- Adding local media still requires the separately approved contract-v4 and product implementation.

## Failure and Security Considerations

- Preparation failures retain their existing non-echoing fixed messages and remain separate from
  typed runner failures.
- Serialized payloads stay on bounded stdin and never enter argv, environment values, or lifecycle
  logs.
- LLM checkout material can be resolved only while preparing a retry-insights job and continues to
  be removed from all other worker environments.
- No facade API accepts an executable, arbitrary progress callback, event name, PID, lane, command
  fragment, or environment key from application or IPC input.

## Alternatives Considered

### Keep caller composition

Rejected because code review remains the only protection against valid-but-inconsistent tuples.

### Add `WorkerRunRequest` factory methods only

Rejected because callers would still select a command invocation, factory, credential input, and
lane independently.

### One general facade including model download and future local media now

Rejected for this step. Model download has a distinct command policy and lane, while local media has
no implemented contract-v4/CLI consumer yet. Adding either as a generic or dead variant would expand
scope without improving the immediate video-lane boundary.

## References

- `docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md`
- `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`
- `app/src-tauri/src/worker_runtime/`
- `app/src-tauri/src/video_processing.rs`
