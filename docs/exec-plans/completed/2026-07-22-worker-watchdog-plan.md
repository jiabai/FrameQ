# Rust Worker Watchdog Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for each
> lifecycle change, systematic-debugging for race failures, and verification-before-completion
> before removing the release blocker. Keep this plan current after every checkpoint.

**Goal:** Ensure every supervised FrameQ worker has a fixed bounded deadline and, when supported OS
process-control primitives succeed, leaves the busy state after its complete process tree is killed
and reaped, returning a distinct safe timeout outcome without changing explicit cancellation or
valid-result precedence. An OS termination failure must stay supervised and truthful rather than
fabricating cleanup.

**Architecture:** Keep deadline policy, monotonic activity tracking, instance-safe timeout claims,
and tree termination inside the existing Rust `worker_runtime`. Add idle and absolute policies
derived from `WorkerOperation`, a watchdog thread able to act while the runner blocks, and exhaustive
adapter/UI mappings for timeout results.

**Tech Stack:** Rust/std process/thread/synchronization/time APIs, existing `ProcessSupervisor`,
Cargo fixture tests, TypeScript/i18next/Vitest, browser smoke, native Windows/macOS process tests.

---

## Purpose / Big Picture

After this plan is complete, a hung worker cannot leave FrameQ busy forever. The Rust runtime
terminates and reaps the matching process tree at a conservative fixed deadline, returns localized
retry guidance, preserves committed local artifacts, and never silently repeats an AI call. Normal
completion and explicit cancellation retain their existing meaning.

## Progress

- [x] 2026-07-22: Verified the shared production runner blocks on unbounded `child.wait()` and has
  no runtime watchdog or operation deadline. Validation: source inspection of
  `worker_runtime/runner.rs` and supervisor ownership.
- [x] 2026-07-22: Approved fixed operation-owned idle/absolute policies and registered watchdog
  completion as a broad-release blocker. Validation: durable design, active-plan, release-plan, and
  debt-index registration.
- [x] 2026-07-22: Synchronized completed atomic-persistence status on `main` at `5a34b99`, created
  `codex/worker-watchdog-hardening` in an isolated worktree, and established a green baseline.
  Validation: worker-runtime Rust 35/35 and app 551/551. The process-tree Rust tests require an
  unsandboxed host because restricted `taskkill` produces a known false failure.
- [x] Add RED closed-policy and supervisor state-machine tests. Validation: RED produced 18 expected
  missing-API compile errors; the complete unsandboxed worker-runtime suite passed 40/40, followed
  by the added spoofed-payload regression at 1/1. Process-fixture, adapter, and UI RED tests remain
  in later tasks.
- [x] 2026-07-22: Implemented the instance-bound watchdog, closed operation policies, validated
  activity tracking, timeout/cancel/cleanup first-claim ordering, termination leases, bounded
  signal-failure retry, early-return cleanup, and structured-result-first classification.
  Validation: the focused worker-runtime suite passed 56/56, including blocked stdin, signal
  rollback, cancellation/timeout races, and watchdog startup failure.
- [x] 2026-07-22: Mapped closed timeout outcomes through process/retry, source preflight, and ASR
  model-download adapters; added three-locale process/model guidance and target-specific AI timeout
  guidance while preserving the transcript and preventing automatic retry. Validation: focused
  frontend tests passed 93/93 and real Chromium smoke passed 28/28.
- [x] 2026-07-22: Completed local and available Windows acceptance. Validation: Rust 208/208,
  App 567/567, worker 563 passed / 2 skipped, scripts 25/25, lint, Ruff, rustfmt, frontend build,
  and Tauri `--no-bundle` passed. The native Windows watchdog fixture killed a parent plus
  descendant and admitted a second task. The same portable fixture is required by the macOS hosted
  Cargo workflow, but an actual macOS run was unavailable and remains residual release evidence.

## Surprises & Discoveries

- Evidence: `WorkerLane::run` registers the child before `deliver_worker_stdin`, allowing an
  instance-bound watchdog to terminate a child even if the runner thread blocks writing the
  one-shot request.
- Evidence: `worker_runtime/supervisor.rs` already exposes private instance-safe cancellation and
  platform process-tree termination. The watchdog should reuse those private primitives, not
  introduce a second kill implementation.
- Evidence: `runner.rs::read_stderr` routes only closed validated progress; source-identity preflight
  uses `ProgressRoute::None`. Therefore only validated stderr progress is trustworthy activity and
  source identity emits no progress, so it requires an absolute-only policy.
- Evidence: `video_processing/task_result.rs` exhaustively matches the current
  `WorkerRunOutcome`/`WorkerRunErrorKind` sets and has no timeout outcome; adding one requires an
  exhaustive mapping update rather than allowing a generic raw Rust error to leak through.
- Evidence: model download already uses the shared lane but is not represented by `WorkerJob` in
  `facade.rs`; exhaustive production policy coverage must therefore stay on `WorkerOperation`, with
  typed-job tests covering the three facade jobs and a direct runner test covering model download.
- Evidence: OS tree termination can fail or be blocked by a restricted host. A failed signal cannot
  safely clear the lane; timeout must roll back only the matching phase, retry with bounded backoff,
  and retain a truthful supervised state until the child exits or termination succeeds.
- Evidence: stopping the watchdog alone does not close the race between an early runner cleanup and
  a concurrent cancel command. The supervisor therefore needs an internal instance-matching
  `CleaningUp` claim; only its winner may send the early-cleanup tree signal, and cancellation or
  timeout that already owns termination remains authoritative.
- Evidence: Unix cancellation can observe child exit after TERM while its 500 ms escalation window
  is still active. Without a termination-in-flight lease, runner `finish` could admit a new worker
  before the old numeric PGID check/KILL completed. Synchronized RED tests reproduced this ordering
  for cancellation success and timeout failure rollback.

## Decision Log

- Decision: Rust `worker_runtime` owns the watchdog. Rationale: it is the only layer that owns all
  supervised operations, PID/PGID, cancellation, wait/reap, and structured-result precedence.
  Date/Author: 2026-07-22, User + Codex.
- Decision: Use fixed operation policies with private test injection and no request/UI/env override.
  Rationale: arbitrary timeouts would weaken the closed typed job boundary and make support behavior
  unpredictable. Date/Author: 2026-07-22, Codex.
- Decision: Validated progress resets idle time; diagnostics and malformed output do not. Rationale:
  an unhealthy or malicious worker must not keep itself alive with arbitrary stderr. Date/Author:
  2026-07-22, Codex.
- Decision: Preserve structured-result-first and first terminal claim between cancellation and
  timeout. Rationale: a result already durably produced should not be discarded, and users must not
  see an explicit cancellation relabeled later. Date/Author: 2026-07-22, Codex.
- Decision: No automatic LLM retry or Credit action follows timeout. Rationale: watchdog recovery is
  process reliability, not permission to incur another external call. Date/Author: 2026-07-22,
  User + Codex.
- Decision: An exact idle/absolute deadline tie is classified as `Absolute`; unequal deadlines use
  the earlier instant. Rationale: deterministic tests and diagnostics must not depend on scheduler
  ordering. Date/Author: 2026-07-22, Codex.
- Decision: Signal failure rolls the same terminal claim back to `Running`, keeps the watchdog
  stoppable, and retries with bounded backoff. FrameQ never clears the supervisor or reports timeout
  while the child is known alive. Rationale: release reliability cannot be obtained by fabricating
  successful cleanup. Date/Author: 2026-07-22, Codex.
- Decision: Early runner failures use a private `CleaningUp` terminal claim. Rationale: a phase read
  followed by an unconditional signal has a check-then-act race with cancellation; an atomic claim
  prevents duplicate tree signals while keeping user cancellation and timeout labels truthful.
  Date/Author: 2026-07-22, Codex.
- Decision: Cancellation and timeout OS calls hold an instance-bound termination lease, not the
  supervisor mutex. `finish` waits for the lease to complete before clearing the instance. Rationale:
  process-tree termination must stay outside locks, but numeric PID/PGID reuse is unsafe until the
  whole terminator sequence returns. Date/Author: 2026-07-22, Codex.

## Outcomes & Retrospective

Implemented. Every current supervised operation now receives an exhaustive Rust-owned policy; only
validated progress extends idle time, the absolute limit never moves, and the watchdog can act
while stdin delivery or `child.wait()` blocks. Timeout, cancellation, early cleanup, and finish are
instance-safe, and a termination-in-flight lease prevents a completed child from releasing its lane
while an OS tree terminator can still act on the old numeric PID/PGID. Closed adapter/UI outcomes
leave the busy state, preserve committed results, and never authorize an automatic AI retry.

Local evidence: worker-runtime 56/56, complete Rust 208/208, App 567/567, worker 563 passed / 2
skipped, scripts 25/25, Chromium smoke 28/28, lint, Ruff, rustfmt, frontend production build, and
Tauri `--no-bundle` all passed on Windows. The real Windows parent/descendant timeout fixture passed
and the source-level workflow guard requires the same fixture in full hosted macOS Cargo tests.

Residual risk: this session had no macOS host, so the new watchdog-triggered parent/descendant path
has not yet produced hosted macOS runtime evidence. If a supported OS tree-termination primitive
refuses or itself fails to return, FrameQ deliberately keeps the instance supervised rather than
claiming a false timeout; that exceptional OS failure cannot be bounded by an in-process watchdog.
The conservative durations may need later field calibration, but request-controlled deadlines stay
out of scope.

## Context and Orientation

- Product specification:
  `docs/product-specs/2026-07-22-release-reliability-hardening.md`.
- Durable watchdog decision:
  `docs/design-docs/2026-07-22-rust-worker-watchdog.md`.
- Existing lifecycle decision:
  `docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md`.
- Runner: `app/src-tauri/src/worker_runtime/runner.rs`.
- Supervisor and OS tree termination: `app/src-tauri/src/worker_runtime/supervisor.rs`.
- Typed semantic job policy: `app/src-tauri/src/worker_runtime/facade.rs`.
- Task adapter: `app/src-tauri/src/video_processing/task_result.rs`.
- Source preflight adapter: `app/src-tauri/src/video_processing/url_processing.rs`.
- Model-download adapter: `app/src-tauri/src/asr_model.rs`.
- Frontend error localization: `app/src/i18n/errorResources.ts` and
  `app/src/i18n/errorResources.test.ts`.

## Required Invariants

- Every production supervised child has an absolute deadline after registration.
- Idle time advances only on contract-validated progress and is disabled for the no-progress route.
- A timeout can terminate while the runner is blocked in stdin delivery or wait.
- Timeout/cancel/finish/rollback transitions match the monotonically increasing instance ID.
- Exactly one terminal claimant sends a termination signal; stale watchdogs cannot touch newer
  children.
- A failed termination claim rolls back only its matching phase and is retried with bounded backoff;
  it never spins, disables the watchdog, clears the lane, or reports a false timeout.
- Every normal and early return stops and joins its instance watchdog before supervisor finish, and
  runner cleanup does not send a second signal after cancellation/timeout already owns termination.
- The main runner remains the only reap, pipe-join, parse, classify, and supervisor-finish owner.
- A valid typed structured result wins a concurrent timeout or cancellation claim.
- Timeout never echoes raw worker/request/path/content data and never automatically retries AI.
- Existing successful, failed, malformed, cancellation, local-media planning, and model-download
  behavior remains unchanged except for formerly unbounded executions.

## Plan of Work

### Task 1: Add RED Closed Policy and State-Machine Tests

**Files:**
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `app/src-tauri/src/worker_runtime/supervisor.rs`
- Modify: `app/src-tauri/src/worker_runtime/facade.rs`

- [x] Add policy tests for exact production values: process 45m/8h, retry 10m/30m, identity
  absolute-only 3m, model download 10m/4h. Assert callers and payloads cannot override policy.
- [x] Add supervisor RED tests for `Running -> TimingOut(kind)`, cancellation/timeout first-claim
  ordering, repeated claims, signal-failure rollback, matching finish, and stale instance rejection.
- [x] Extend typed-job ownership tests so every current semantic job derives a policy and a future
  enum variant fails compilation until exhaustively mapped.
- [x] Run focused Cargo tests and record the expected failures before production changes.

### Task 2: Build Deterministic Worker Fixture Coverage

**Files:**
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `scripts/tests/unix-process-supervisor-workflow.test.mjs`

- [x] Add fixture modes for silent sleep, validated-progress cadence then stall, endless validated
  progress, delayed valid terminal result, blocked/unread stdin, spawned descendant, malformed
  progress spam, and controlled signal handling.
- [x] Add a private injectable `WatchdogPolicy`/clock-or-duration hook. Production code must use real
  `Instant`; tests must complete in milliseconds and avoid flaky wall-clock equality assertions.
- [x] Add RED runner tests for idle timeout, absolute timeout despite progress, absolute-only source
  identity, blocked stdin termination, descendant cleanup, and second-task admission.
- [x] Keep fixture payloads free of real paths, URLs, credentials, transcripts, and prompts.

### Task 3: Implement Runtime-Owned Watchdog and Timeout Claims

**Files:**
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `app/src-tauri/src/worker_runtime/supervisor.rs`
- Modify: `app/src-tauri/src/worker_runtime/mod.rs`

- [x] Add `WorkerTimeoutKind`, closed `WatchdogPolicy`, and `TimingOut` supervisor phase without
  exposing raw process primitives to application modules.
- [x] Start one instance-bound watchdog after registration and before stdin delivery. Store only
  monotonic timing state plus supervisor-owned IDs.
- [x] Let validated progress notify the watchdog through narrow shared activity state. Do not count
  diagnostics, invalid progress, stdout, or arbitrary stderr.
- [x] On expiry, claim only the matching running instance and reuse `terminate_process_tree`. Do not
  finish the supervisor or parse output from the watchdog thread.
- [x] Stop/join the watchdog on every runner return path. Watchdog setup failure terminates/reaps the
  child and returns a fixed safe runtime error.
- [x] Preserve current finish-before-reader-join and structured-result-first behavior. Extend
  terminal classification with idle/absolute timeout outcomes only when no valid result exists.
- [x] Run focused tests repeatedly enough to expose race flakes, then run full Cargo tests and
  rustfmt.

### Task 4: Map Closed Timeout Outcomes at Application Boundaries

**Files:**
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `app/src-tauri/src/video_processing/task_result.rs`
- Modify: `app/src-tauri/src/video_processing/url_processing.rs`
- Modify: `app/src-tauri/src/asr_model.rs`
- Modify: the inline `#[cfg(test)]` modules in the four Rust files above

- [x] Map process/retry timeout to fixed `WORKER_IDLE_TIMEOUT` or
  `WORKER_EXECUTION_TIMEOUT`, preserving context-owned status/stage.
- [x] Keep source-identity timeout tolerant: record the safe internal code, return no identity, and
  continue normal URL processing unless explicit cancellation won.
- [x] Map model download to its two fixed timeout codes and ensure the model-download busy state
  clears without fabricating success.
- [x] Exhaustively test every `WorkerRunErrorKind`/outcome mapping and prove rejected diagnostic
  detail is not echoed.
- [x] Keep `contracts/desktop-worker-contract.json` request/progress/result schemas unchanged. Runtime
  timeout codes use the existing safe-code terminal field and become known localized UI mappings;
  add a regression assertion that no timeout request field or contract-version bump was introduced.

### Task 5: Localize and Test User Recovery Guidance

**Files:**
- Modify: `app/src/i18n/errorResources.ts`
- Modify: `app/src/i18n/errorResources.test.ts`
- Modify: `app/src/i18n/resources.test.ts`
- Modify: `app/src/i18n/asrModelResources.ts`
- Modify: `app/src/workerErrorCopy.ts`
- Modify: `app/src/workerErrorCopy.test.ts`
- Modify: `app/src/features/workflow/useTaskProcessingController.test.ts`
- Modify: `app/src/features/asrModel/useAsrModelDownload.test.ts`
- Modify: `app/tests/app-input.browser.test.ts`

- [x] Add Simplified Chinese, Traditional Chinese, and US English guidance for worker idle,
  execution, and model-download timeout codes. Keep timeout as the primary guidance and sanitized
  technical details optional.
- [x] Prove process timeout clears processing state and enables retry/new-task behavior.
- [x] Prove AI timeout remains `partial_completed`, keeps transcript/previous artifacts, and makes
  no automatic second desktop command or Credits request.
- [x] Prove explicit cancellation retains cancellation copy when it wins the race.
- [x] Run focused i18n/controller/browser tests, then the complete app suite, lint, and build.

### Task 6: Native Process-Tree and Release Validation

**Files:**
- Modify: `.github/workflows/unix-process-supervisor.yml`
- Modify: this ExecPlan and active release-plan evidence

- [x] Extend existing Windows/macOS process-supervisor fixtures to let a watchdog—not a manual cancel
  command—terminate a parent and descendant and then admit a second task.
- [x] Verify no orphan PID/PGID remains after timeout and no stale watchdog can terminate the second
  fixture.
- [x] Run all validation commands below. Record exact totals, warnings, unavailable host evidence,
  and residual risk before marking this plan complete.
- [x] Keep tag, release publication, external provider smoke, and local-media runtime outside this
  plan unless separately authorized.

## Validation and Acceptance

```powershell
cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime
cargo test --manifest-path app\src-tauri\Cargo.toml
cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
uv run pytest worker\tests
uv run ruff check worker
node --test scripts\tests\*.test.mjs
python scripts\validate_agents_docs.py --level WARN
npm --prefix app run tauri -- build --no-bundle
git diff --check
git status --short
```

Deterministic acceptance matrix:

| Fixture | Expected result |
|---|---|
| completes before deadlines | existing structured result |
| valid progress then silence | idle timeout |
| valid progress forever | absolute timeout |
| arbitrary stderr forever | idle timeout; stderr does not extend life |
| no-progress source preflight | absolute timeout, then URL flow continues |
| blocked stdin/child tree | timeout kills/reaps tree and unblocks runner |
| valid result at deadline boundary | valid structured result wins |
| cancellation claim first | cancelled |
| timeout claim first | timeout; later cancel sends no second signal |
| stale watchdog after new start | new instance remains alive |

## Release Completion Conditions

- Every supervised operation has the documented closed policy.
- Timeout releases the lane, terminates/reaps descendants, and preserves terminal precedence.
- User-visible codes/copy and AI no-auto-retry behavior are covered in all three locales.
- Full local gates and available Windows/macOS native evidence are recorded here and in the active
  release plan.
- The watchdog high-priority debt entry is moved to completed only after review.
- No tag, push, PR, or public release is part of this ExecPlan without separate authorization.
