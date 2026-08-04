# RetryInsights Progress-Aware Watchdog

- Date: 2026-08-04
- Status: Design approved; written specification pending review
- Related product specifications:
  - `docs/product-specs/2026-07-22-release-reliability-hardening.md`
  - `docs/product-specs/2026-07-31-transcript-dissection.md`
- Related design: `docs/design-docs/2026-07-22-rust-worker-watchdog.md`

## Problem

`WorkerOperation::RetryInsights` currently has a 10-minute idle deadline and a 30-minute absolute
deadline. The retry CLI does not pass a progress callback into the Python application path, so a
summary, inspiration, or transcript-dissection run produces no validated activity while its LLM
calls execute.

The managed server permits one supplier request timeout of up to 600 seconds. Transcript
dissection can make up to six sequential map/reduce/repair calls. A valid request configured near
the supplier maximum can therefore reach the desktop idle deadline before Python can return its
typed LLM timeout. Field evidence on 2026-08-04 recorded one dissection starting at monotonic log
timestamp `1785839582926` and terminating as `idle_timeout` at `1785840183193`, 600,267 ms later.

## Decision

`RetryInsights` uses a 30-minute idle deadline and a 90-minute absolute deadline. The idle value is
longer than the maximum supported single supplier request and checkout overhead. The absolute value
bounds the six-call dissection plan plus local parsing and atomic commit without making the worker
unbounded.

The retry CLI passes its existing validated worker-progress callback through
`retry_insights_once()`, `run_insight_generation_step()`, and the dissection pipeline. Transcript
dissection emits one progress event immediately before each planned map, reduce, or optional repair
supplier call. Completing a call and beginning the next call therefore refreshes idle activity;
Python does not emit timer-based heartbeats while a supplier call is blocked.

The new closed worker progress code is `ai.generation.running`. It uses stage
`insights_generating`, carries only integer `attempt` and `total` arguments, and uses deterministic
progress values derived from the bounded call plan. It contains no transcript, prompt, task ID,
supplier response, URL, path, credential, model name, or error prose. Rust validates the event
through the existing shared progress registry before it can reset the watchdog or reach the UI.

Because worker progress message codes are declared in the global desktop-worker contract, the
contract is advanced as required by its existing strict-version policy. No request envelope, task
manifest, terminal result, artifact, or AI Credit semantics change.

## Data Flow

1. The Tauri retry command starts one `RetryInsights` worker with the fixed 30/90-minute policy.
2. The retry CLI provides `print_progress_event` to the Python retry application.
3. The application passes the callback only through the selected AI generation path.
4. Dissection computes its frozen bounded call plan and emits `ai.generation.running` before each
   supplier attempt with `attempt <= total <= 6`.
5. Rust accepts only contract-valid events, records watchdog activity, and forwards the safe event.
6. The existing structured terminal result, cancellation, timeout precedence, and atomic artifact
   commit rules remain authoritative.

Summary and inspiration receive the callback plumbing but do not gain invented call-boundary
events in this change. Their execution remains protected by the longer fixed policy. Adding their
own accurate attempt events requires a separate generator-specific decision and tests.

## Failure Semantics

- A supplier call that blocks for less than 30 minutes is allowed to return its own typed outcome.
- Thirty minutes without one validated progress event produces `WORKER_IDLE_TIMEOUT`.
- Ninety minutes after worker registration produces `WORKER_EXECUTION_TIMEOUT` even if progress
  continues.
- An invalid, malformed, or unknown progress line cannot extend either deadline.
- A valid structured result at the timeout boundary still wins under existing terminal precedence.
- Timeout never triggers an automatic retry or Credit refund and preserves previously committed
  artifacts.

## Testing

Implementation follows test-first development:

- Rust policy tests first require 30-minute idle and 90-minute absolute values.
- Contract/worker protocol tests first require the closed `ai.generation.running` code and exact
  `attempt/total` argument rules.
- Python CLI/application tests first prove retry progress is wired without placing request content
  on stderr.
- Dissection tests first prove one event per actual map/reduce/repair attempt, bounded and ordered,
  including the no-repair path.
- Existing watchdog lifecycle, cancellation, terminal precedence, Credits, artifact, worker,
  frontend, lint, and build gates are rerun in proportion to the touched boundaries.

## Non-Goals

- No user-configurable timeout, request field, environment override, automatic retry, background
  queue, resumable LLM call, or timer-based keepalive.
- No weakening of progress validation and no arbitrary stderr activity.
- No progress event containing user or supplier content.
- No change to server request timeout limits, call-plan limit, quota accounting, or artifacts.
