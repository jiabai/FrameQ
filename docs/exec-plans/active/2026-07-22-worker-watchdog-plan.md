# Rust Worker Watchdog Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for each
> lifecycle change, systematic-debugging for race failures, and verification-before-completion
> before removing the release blocker. Keep this plan current after every checkpoint.

**Goal:** Ensure every supervised FrameQ worker leaves the busy state within a bounded time, kills
and reaps its complete process tree on deadline, and returns a distinct safe timeout outcome without
changing explicit cancellation or valid-result precedence.

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
- [ ] Add RED policy, state-machine, process-fixture, adapter, and UI tests.
- [ ] Implement instance-bound watchdog lifecycle and timeout claims.
- [ ] Map timeout outcomes through task/model/preflight adapters and localized UI.
- [ ] Run complete local and available Windows/macOS native acceptance gates.

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

## Outcomes & Retrospective

Not implemented. Completion requires deterministic short-deadline fixture evidence, complete
regression gates, and native Windows/macOS parent-child termination evidence where available.
Residual risk: until then, a hung worker can still keep the UI busy indefinitely; final timing
values may need field calibration after safe telemetry/support evidence, but request-controlled
deadlines remain out of scope.

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

- [ ] Add policy tests for exact production values: process 45m/8h, retry 10m/30m, identity
  absolute-only 3m, model download 10m/4h. Assert callers and payloads cannot override policy.
- [ ] Add supervisor RED tests for `Running -> TimingOut(kind)`, cancellation/timeout first-claim
  ordering, repeated claims, signal-failure rollback, matching finish, and stale instance rejection.
- [ ] Extend typed-job ownership tests so every current semantic job derives a policy and a future
  enum variant fails compilation until exhaustively mapped.
- [ ] Run focused Cargo tests and record the expected failures before production changes.

### Task 2: Build Deterministic Worker Fixture Coverage

**Files:**
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `scripts/tests/unix-process-supervisor-workflow.test.mjs`

- [ ] Add fixture modes for silent sleep, validated-progress cadence then stall, endless validated
  progress, delayed valid terminal result, blocked/unread stdin, spawned descendant, malformed
  progress spam, and controlled signal handling.
- [ ] Add a private injectable `WatchdogPolicy`/clock-or-duration hook. Production code must use real
  `Instant`; tests must complete in milliseconds and avoid flaky wall-clock equality assertions.
- [ ] Add RED runner tests for idle timeout, absolute timeout despite progress, absolute-only source
  identity, blocked stdin termination, descendant cleanup, and second-task admission.
- [ ] Keep fixture payloads free of real paths, URLs, credentials, transcripts, and prompts.

### Task 3: Implement Runtime-Owned Watchdog and Timeout Claims

**Files:**
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `app/src-tauri/src/worker_runtime/supervisor.rs`
- Modify: `app/src-tauri/src/worker_runtime/mod.rs`

- [ ] Add `WorkerTimeoutKind`, closed `WatchdogPolicy`, and `TimingOut` supervisor phase without
  exposing raw process primitives to application modules.
- [ ] Start one instance-bound watchdog after registration and before stdin delivery. Store only
  monotonic timing state plus supervisor-owned IDs.
- [ ] Let validated progress notify the watchdog through narrow shared activity state. Do not count
  diagnostics, invalid progress, stdout, or arbitrary stderr.
- [ ] On expiry, claim only the matching running instance and reuse `terminate_process_tree`. Do not
  finish the supervisor or parse output from the watchdog thread.
- [ ] Stop/join the watchdog on every runner return path. Watchdog setup failure terminates/reaps the
  child and returns a fixed safe runtime error.
- [ ] Preserve current finish-before-reader-join and structured-result-first behavior. Extend
  terminal classification with idle/absolute timeout outcomes only when no valid result exists.
- [ ] Run focused tests repeatedly enough to expose race flakes, then run full Cargo tests and
  rustfmt.

### Task 4: Map Closed Timeout Outcomes at Application Boundaries

**Files:**
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `app/src-tauri/src/video_processing/task_result.rs`
- Modify: `app/src-tauri/src/video_processing/url_processing.rs`
- Modify: `app/src-tauri/src/asr_model.rs`
- Modify: the inline `#[cfg(test)]` modules in the four Rust files above

- [ ] Map process/retry timeout to fixed `WORKER_IDLE_TIMEOUT` or
  `WORKER_EXECUTION_TIMEOUT`, preserving context-owned status/stage.
- [ ] Keep source-identity timeout tolerant: record the safe internal code, return no identity, and
  continue normal URL processing unless explicit cancellation won.
- [ ] Map model download to its two fixed timeout codes and ensure the model-download busy state
  clears without fabricating success.
- [ ] Exhaustively test every `WorkerRunErrorKind`/outcome mapping and prove rejected diagnostic
  detail is not echoed.
- [ ] Keep `contracts/desktop-worker-contract.json` request/progress/result schemas unchanged. Runtime
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

- [ ] Add Simplified Chinese, Traditional Chinese, and US English guidance for worker idle,
  execution, and model-download timeout codes. Keep timeout as the primary guidance and sanitized
  technical details optional.
- [ ] Prove process timeout clears processing state and enables retry/new-task behavior.
- [ ] Prove AI timeout remains `partial_completed`, keeps transcript/previous artifacts, and makes
  no automatic second desktop command or Credits request.
- [ ] Prove explicit cancellation retains cancellation copy when it wins the race.
- [ ] Run focused i18n/controller/browser tests, then the complete app suite, lint, and build.

### Task 6: Native Process-Tree and Release Validation

**Files:**
- Modify: `.github/workflows/unix-process-supervisor.yml`
- Modify: this ExecPlan and active release-plan evidence

- [ ] Extend existing Windows/macOS process-supervisor fixtures to let a watchdog—not a manual cancel
  command—terminate a parent and descendant and then admit a second task.
- [ ] Verify no orphan PID/PGID remains after timeout and no stale watchdog can terminate the second
  fixture.
- [ ] Run all validation commands below. Record exact totals, warnings, unavailable host evidence,
  and residual risk before marking this plan complete.
- [ ] Keep tag, release publication, external provider smoke, and local-media runtime outside this
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
