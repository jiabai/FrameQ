# Rust Worker Watchdog and Deadline Boundary

- Date: 2026-07-22
- Status: Proposed; release blocker
- Related lifecycle design:
  `docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md`
- ExecPlan: `docs/exec-plans/active/2026-07-22-worker-watchdog-plan.md`

## Context

The shared Rust `WorkerLane::run` now owns spawn, process-group setup, supervisor registration,
stdin delivery, stderr/progress reading, `child.wait()`, finish, parsing, and terminal
classification for process video, AI retry, source identity, and ASR model download. Cancellation
can terminate the supervised process tree from another command, but no production deadline exists.

If a Python worker, FFmpeg/native library, provider request, pipe operation, or descendant process
hangs without exiting, `child.wait()` can block forever. The UI remains in a processing state and
ordinary users must kill FrameQ or the child manually. A broad consumer release requires a runtime
owner that turns an unbounded wait into a truthful terminal outcome.

## Decision

The watchdog is part of `worker_runtime`; it is not a React timer, a Tauri-command timeout, a Python
business timeout, or a caller-supplied request field. `WorkerOperation` derives one closed
`WatchdogPolicy`, and `WorkerLane::run` applies it to every supervised child.

```rust
enum WorkerTimeoutKind {
    Idle,
    Absolute,
}

struct WatchdogPolicy {
    idle_timeout: Option<Duration>,
    absolute_timeout: Duration,
}

enum ProcessPhase {
    Running,
    Cancelling,
    TimingOut(WorkerTimeoutKind),
}
```

Production policies are fixed internal constants:

| `WorkerOperation` | Idle deadline | Absolute deadline |
|---|---:|---:|
| `ProcessVideo` and future `ProcessLocalMedia` | 45 minutes | 8 hours |
| `RetryInsights` | 10 minutes | 30 minutes |
| `ResolveSourceIdentity` | disabled | 3 minutes |
| `DownloadAsrModel` | 10 minutes | 4 hours |

Tests inject millisecond policies through private test hooks. No production environment variable,
IPC field, CLI flag, UI setting, or desktop-worker request may override these values.

## Activity Definition

Idle activity advances only when Rust accepts a progress line through the existing closed progress
validator. Arbitrary stderr, malformed progress, stdout bytes, or diagnostic prose cannot keep a
worker alive.

`ResolveSourceIdentity` uses `ProgressRoute::None`, so it has no idle deadline and relies on its
short absolute deadline. The absolute deadline always starts after supervisor registration and can
never be extended.

The conservative media-processing idle duration accounts for long local ASR/native inference gaps
between progress events. If field evidence shows valid consumer workloads exceed it, the value is
changed by a reviewed runtime decision; weakening activity validation or allowing request-controlled
timeouts is not an acceptable workaround.

## Ownership and Lifecycle

After the child is spawned and registered, the runner creates one instance-bound watchdog control
with:

- the monotonic start instant;
- an atomic/locked last-validated-progress instant;
- the closed policy;
- the supervisor instance ID and PID/PGID; and
- a stop signal used when normal terminal observation finishes.

The watchdog must be able to act while the runner thread is blocked in stdin delivery or
`child.wait()`. A small runtime-owned thread waits on a condition variable until the next deadline,
normal completion, or activity update. On expiry it attempts an instance-matching timeout claim in
`ProcessSupervisor`. Only the winner of that state transition may call the existing
`terminate_process_tree` with the supervisor-owned numeric PID/PGID.

The main runner continues to reap the child, stops and joins the watchdog, finishes the matching
supervisor instance, joins pipe readers, and applies terminal precedence. The watchdog never parses
stdout, maps business results, emits arbitrary progress, or clears supervisor state itself.

An internal guard still clears exactly one matching instance on early setup/wait failure. Watchdog
thread startup failure is a fixed runtime failure: FrameQ terminates and reaps the newly supervised
child rather than running it without the required release safety boundary.

## State and Race Semantics

`ProcessSupervisor` owns the first-terminal-claim rule:

- `Running -> Cancelling` when the user cancellation claim wins;
- `Running -> TimingOut(kind)` when the matching watchdog claim wins;
- a cancel request during `TimingOut` reports the task is already terminating and sends no second
  signal;
- a timeout attempt during `Cancelling` does nothing and cannot relabel cancellation;
- stale instance IDs cannot claim, restore, finish, or terminate a newer process.

Signal failure follows the existing rollback principle. If timeout tree termination fails, the
supervisor restores `Running` only for the same instance, the runner remains responsible for the
eventual child outcome, and a fixed sanitized runtime error is recorded. It must not report a
timeout as completed while the process is still known to be running.

## Terminal Precedence

The existing structured-result-first rule is preserved and extended:

1. A valid operation-matching structured result wins, including at the cancellation/timeout
   boundary.
2. Without a valid structured result, terminal phase `Cancelling` returns `Cancelled`.
3. Without a valid structured result, `TimingOut(Idle)` returns `TimedOut(Idle)` and
   `TimingOut(Absolute)` returns `TimedOut(Absolute)`.
4. Otherwise the existing protocol-violation and unstructured-failure rules apply.

The application adapters map timeouts to stable safe outcomes:

| Context | Status/stage | Code |
|---|---|---|
| process video/local media | `failed` / current processing stage policy | `WORKER_IDLE_TIMEOUT` or `WORKER_EXECUTION_TIMEOUT` |
| summary/inspiration retry | `partial_completed` / `insights_generating` | same two codes |
| model download | failed download result | `ASR_MODEL_DOWNLOAD_IDLE_TIMEOUT` or `ASR_MODEL_DOWNLOAD_EXECUTION_TIMEOUT` |
| source-identity preflight | tolerant cache miss, then normal process flow | internal `WORKER_EXECUTION_TIMEOUT`; no raw error is exposed |

Source-identity timeout does not make the whole URL task fail because the existing preflight policy
already treats ordinary preflight transport failure as “continue without canonical cache lookup.”
The subsequent process job has its own independent policy.

## User Experience

- Timeout exits the busy state and renders localized retry guidance through the existing known-error
  mapping. Unknown raw runtime prose is never displayed.
- Explicit cancellation remains cancellation; a later watchdog cannot change its label.
- AI timeout preserves the official transcript and previously committed AI artifacts. FrameQ does
  not automatically retry the LLM and does not check out or spend another AI Credit.
- Process and model-download timeout preserve already committed artifacts according to their
  existing product rules. Staging files remain non-authoritative and are handled by their owning
  cleanup/recovery path.

## Diagnostics and Privacy

Safe logs may record operation, timeout kind, configured duration, elapsed-duration bucket,
supervisor instance ID, numeric PID, termination success/failure code, and final outcome. They must
not contain worker request JSON, argv/environment values, source URL, local-media path or token,
Cookie/credential, transcript, prompt, generated content, complete stderr, or arbitrary OS error
text.

Timeout codes and localized copy are contract-tested across Rust and TypeScript. No new natural
language progress event is added. Because timeout policy is desktop-runtime behavior rather than a
worker request field, this design does not bump the desktop-worker request version.

## Verification

Focused Rust tests use real fixture children plus private short policies to cover:

- normal completion before either deadline;
- valid progress resetting idle but never absolute time;
- malformed/diagnostic stderr not resetting idle;
- silent worker idle timeout;
- endless valid progress absolute timeout;
- source identity absolute-only timeout;
- timeout during blocked stdin delivery;
- stdout structured result racing timeout;
- user cancellation before/after timeout claim;
- signal failure rollback;
- stale watchdog instance safety;
- stderr-reader failure and join ordering;
- parent plus descendant termination and successful second-task admission.

Adapter, model-download, frontend parser/i18n, browser smoke, complete app/Rust/worker/script suites,
packaging, and governance gates must pass. Native Windows and macOS acceptance must prove no parent
or child remains after a timeout. An unavailable platform is recorded as residual risk.

## Non-Goals

- No task queue, background resume, automatic restart, distributed lease, OS service, async/Tokio
  process rewrite, arbitrary per-stage timer, or user-configurable deadline.
- No attempt to prove that an LLM or ASR result is semantically correct before accepting its valid
  structured terminal result.
- No automatic AI retry, refund, or additional Credits call.
- No implementation of the local-media worker job; its future semantic variant must opt into the
  existing media policy in the same implementation change.
