# RetryInsights Progress-Aware Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Prevent valid transcript-dissection runs from being killed at the old ten-minute idle boundary while keeping validated progress, cancellation, and a hard execution limit.

**Architecture:** Keep timeout ownership in Rust and change only the closed `RetryInsights` policy to 30-minute idle / 90-minute absolute. Carry the existing Python progress callback into dissection and emit one contract-valid, content-free `ai.generation.running` event before each real map/reduce/optional-repair call; no timer heartbeat is introduced.

**Tech Stack:** Rust/Tauri worker supervision, Python worker/pytest, TypeScript/Vitest, shared JSON desktop-worker contract.

---

## Purpose / Big Picture

Long transcript dissection remains visibly active across its bounded sequence of cloud LLM calls.
One supplier call may remain quiet for up to the administrator-configured request timeout, and each
subsequent call boundary proves new activity to the desktop watchdog. A genuinely silent worker is
still stopped after 30 minutes and every retry worker is stopped after 90 minutes. Progress carries
only attempt counters; transcripts, prompts, responses, task IDs, paths, URLs, credentials, and
supplier errors remain excluded.

## Progress

- [x] 2026-08-04: Reproduced and traced the field failure to `RetryInsights` idle timeout at 600,267 ms; approved design committed as `4fb2dab`. Validation: `C:\Users\bicho\AppData\Local\com.frameq.desktop\logs\frameq-desktop.log` plus source inspection.
- [x] 2026-08-04: Registered contract v6 `ai.generation.running`, closed `attempt/total` args, runtime constants, and three-locale copy. Validation: Python 107 passed; Vitest 19 passed; Rust contract constant 1 passed.
- [x] 2026-08-04: Wired retry progress through CLI/application/pipeline and emitted bounded dissection attempt events after cancellation checks. Validation: focused 3 passed; complete CLI/dissection 59 passed.
- [ ] 2026-08-04: Changed the Rust RetryInsights policy to 30-minute idle / 90-minute absolute; integration/full gates remain. Validation: both focused policy tests passed; serialized native runner suite 28 passed.

## Surprises & Discoveries

- Evidence: `app/src-tauri/src/worker_runtime/runner/watchdog.rs` gives `RetryInsights` a 600-second idle deadline, while `server/src/routes/admin.ts` permits `timeout_seconds` up to 600.
- Evidence: `worker/frameq_worker/cli.py` passes progress callbacks for URL/local-media/model-download modes but not `--retry-insights-stdin`, so Rust receives no validated activity during AI retry.
- Evidence: progress message codes are a closed shared registry in `contracts/desktop-worker-contract.json`, `worker/frameq_worker/progress_events.py`, and `app/src/desktopWorkerContract.test.ts`; a truthful AI progress code requires a global contract version advance.
- Evidence: sandboxed direct pytest could not scan the user-level default temporary root, so focused runs used the worktree-local `--basetemp .pytest-tmp`; test behavior was otherwise unchanged.
- Evidence: native watchdog process-tree fixtures cannot terminate their controlled children inside the command sandbox and degrade into protocol failures after 30 seconds; the same fixture passed in 1.9 seconds with approved native process control, and the complete serialized runner suite passed 28/28.
- Evidence: the first cross-boundary protocol run caught the TypeScript literal `WORKER_MESSAGE_CODE_RULES` missing the new contract code; adding the exact closed rule restored shared-contract parity, and the full focused group passed.

## Decision Log

- Decision: Use 30-minute idle and 90-minute absolute deadlines for all `RetryInsights` targets. Rationale: dissection shares the operation and can make six sequential calls; fixed operation-owned policy avoids request-controlled timeouts and preserves the watchdog boundary. Date/Author: 2026-08-04, User + Codex.
- Decision: Emit progress only immediately before actual dissection calls, using the call plan's `maximum_calls` as `total`. Rationale: optional repair cannot be known before validation, and using the bounded maximum is deterministic without claiming a call completed or inventing heartbeats. Date/Author: 2026-08-04, Codex.
- Decision: Add `ai.generation.running` with only `attempt` and `total` and advance the global contract from v5 to v6. Rationale: reusing media/ASR codes would be semantically false; arbitrary stderr must not reset idle. Date/Author: 2026-08-04, User + Codex.

## Outcomes & Retrospective

Implementation has not started. Residual risk: an individual supplier/checkout implementation that ignores
its own request timeout can remain blocked until the 30-minute desktop idle deadline; the watchdog
is intentionally the final bound for that case.

## Context and Orientation

- Specs/design: `docs/design-docs/2026-08-04-retry-insights-progress-aware-watchdog.md`, `docs/product-specs/2026-07-22-release-reliability-hardening.md`, `docs/product-specs/2026-07-31-transcript-dissection.md`.
- Contract/progress: `contracts/desktop-worker-contract.json`, `worker/frameq_worker/progress_events.py`, `app/src/desktopWorkerContract.test.ts`, `app/src/i18n/resources.ts`.
- Python entry/application: `worker/frameq_worker/cli.py`, `worker/frameq_worker/worker_application/insight_retry.py`, `worker/frameq_worker/pipeline_runtime/insights.py`, `worker/frameq_worker/pipeline_runtime/dissection.py`.
- Python generation/tests: `worker/frameq_worker/insightflow/dissection.py`, `worker/tests/test_cli.py`, `worker/tests/test_progress_events.py`, `worker/tests/test_dissection.py`.
- Rust watchdog/tests: `app/src-tauri/src/worker_runtime/runner/watchdog.rs`, `app/src-tauri/src/worker_runtime/runner/tests/watchdog.rs`, `app/src-tauri/src/worker_runtime/facade.rs`.

## Plan of Work

### Task 1: Register the closed AI progress event

**Files:**
- Modify: `contracts/desktop-worker-contract.json`
- Modify: `worker/tests/test_contract.py`
- Modify: `worker/tests/test_progress_events.py`
- Modify: `worker/frameq_worker/desktop_contract.py`
- Modify: `worker/frameq_worker/progress_events.py`
- Modify: `app/src/desktopWorkerContract.test.ts`
- Modify: `app/src/i18n/resources.ts`
- Modify: `app/src/i18n/resources.test.ts`
- Modify: `app/src-tauri/src/lib.rs`

- [x] **Step 1: Write failing contract and registry tests**

Change the Python, Rust, and TypeScript global contract-version expectations from 5 to 6. Add
`ai.generation.running` to the expected worker specifications with stage
`insights_generating`, progress `70`, and `{"attempt": 1, "total": 3}`. Change TypeScript contract
version expectations from 5 to 6 and require the code directly after the ASR codes. Add three-locale
resource expectations for the stable generic copy.

```python
"ai.generation.running": (
    "insights_generating",
    70,
    {"attempt": 1, "total": 3},
),
```

- [x] **Step 2: Run tests and verify RED**

Run: `uv run pytest worker/tests/test_contract.py worker/tests/test_progress_events.py -q`

Expected: FAIL because `ai.generation.running` is absent from the Python/shared registries.

Run: `npm --prefix app test -- --run src/desktopWorkerContract.test.ts src/i18n/resources.test.ts`

Expected: FAIL because the contract is still v5 and the AI code/resources are absent.

- [x] **Step 3: Implement the minimal closed contract**

Advance the JSON, Python, and Rust global `contractVersion` constants to 6, add the new message code with exact
`["attempt", "total"]` arguments, mirror it in `WORKER_PROGRESS_REGISTRY`, and add these resource
keys under all three `progress.worker` maps:

```ts
ai_generation_running: "正在生成 AI 结果。"
ai_generation_running: "正在產生 AI 結果。"
ai_generation_running: "Generating AI results."
```

- [x] **Step 4: Run the focused tests and verify GREEN**

Run the two commands from Step 2. Expected: both PASS.

- [x] **Step 5: Commit Task 1**

Stage only the nine Task 1 files and commit `feat: register AI generation progress`.

### Task 2: Wire retry progress and emit exact call-boundary events

**Files:**
- Modify: `worker/tests/test_cli.py`
- Modify: `worker/tests/test_dissection.py`
- Modify: `worker/frameq_worker/cli.py`
- Modify: `worker/frameq_worker/worker_application/insight_retry.py`
- Modify: `worker/frameq_worker/pipeline_runtime/insights.py`
- Modify: `worker/frameq_worker/pipeline_runtime/dissection.py`
- Modify: `worker/frameq_worker/insightflow/dissection.py`

- [x] **Step 1: Write failing callback-plumbing and generation tests**

Require `test_main_reads_retry_request_from_stdin` to observe
`captured["progress_callback"] is cli.print_progress_event`. Add a dissection test that captures
events and verifies map/reduce/repair attempts are ordered, bounded, content-free, and use the
plan maximum:

```python
assert events == [
    {"stage": "insights_generating", "progress": 70,
     "message_code": "ai.generation.running", "message_args": {"attempt": 1, "total": 3}},
    {"stage": "insights_generating", "progress": 76,
     "message_code": "ai.generation.running", "message_args": {"attempt": 2, "total": 3}},
    {"stage": "insights_generating", "progress": 83,
     "message_code": "ai.generation.running", "message_args": {"attempt": 3, "total": 3}},
]
```

Also cover the valid no-repair path, which emits attempts 1 and 2 only while retaining `total=3`.

- [x] **Step 2: Run tests and verify RED**

Run: `uv run pytest worker/tests/test_cli.py::test_main_reads_retry_request_from_stdin worker/tests/test_dissection.py -q`

Expected: FAIL because the retry CLI omits the callback and generation accepts no callback.

- [x] **Step 3: Implement minimal typed plumbing and event emission**

Add optional `ProgressCallback` parameters from `retry_insights_once()` through the two pipeline
functions to `generate_transcript_dissection()`. In the CLI pass `print_progress_event`. Before each
`_generate_json` call increment one local attempt counter and call:

```python
progress_callback(
    build_worker_progress_event(
        "ai.generation.running",
        stage="insights_generating",
        progress=70 + ((attempt - 1) * 20 // total),
        message_args={"attempt": attempt, "total": total},
    )
)
```

Use `plan.maximum_calls` as `total`; do nothing when the callback is `None`. Do not emit after a
call, on a timer, or from summary/inspiration generators.

- [x] **Step 4: Run tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [x] **Step 5: Commit Task 2**

Stage only the seven Task 2 files and commit `fix: report dissection call progress`.

### Task 3: Extend the RetryInsights watchdog budget

**Files:**
- Modify: `app/src-tauri/src/worker_runtime/runner/tests/watchdog.rs`
- Modify: `app/src-tauri/src/worker_runtime/facade.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner/watchdog.rs`

- [x] **Step 1: Write failing policy expectations**

Change both exhaustive policy test sites to require:

```rust
idle_timeout: Some(Duration::from_secs(30 * 60)),
absolute_timeout: Duration::from_secs(90 * 60),
```

- [x] **Step 2: Run Rust tests and verify RED**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml worker_operations_own_exact_closed_production_watchdog_policies
cargo test --manifest-path app/src-tauri/Cargo.toml retry_insights_job_derives_worker_progress_and_resolves_llm_once
```

Expected: FAIL with the existing 600/1800-second values.

- [x] **Step 3: Implement the minimal policy change**

Change only `WorkerOperation::RetryInsights` in `watchdog.rs` to 30/90 minutes. Keep all other
operations and lifecycle logic byte-for-byte unchanged.

- [x] **Step 4: Run Rust tests and verify GREEN**

Run both commands from Step 2, then
`cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime::runner::tests`.

Expected: PASS.

- [x] **Step 5: Commit Task 3**

Stage only the three Task 3 files and commit `fix: extend retry worker watchdog`.

### Task 4: Integrate, validate, and archive

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/exec-plans/active/2026-08-04-retry-insights-progress-aware-watchdog-plan.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Move: active plan to `docs/exec-plans/completed/2026-08-04-retry-insights-progress-aware-watchdog-plan.md`

- [x] **Step 1: Run focused cross-boundary tests**

Run:

```powershell
uv run pytest worker/tests/test_progress_events.py worker/tests/test_cli.py worker/tests/test_dissection.py -q
npm --prefix app test -- --run src/desktopWorkerContract.test.ts src/desktopWorkerProtocol.test.ts src/i18n/resources.test.ts
cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime
```

Expected: all PASS with no unexpected warnings.

- [ ] **Step 2: Run repository gates**

Run:

```powershell
uv run ruff check worker
uv run pytest worker/tests
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
python scripts/validate_agents_docs.py --level WARN
```

Expected: all PASS; pre-existing environment skips must be recorded exactly.

- [ ] **Step 3: Update durable documentation and living evidence**

Add the implemented 30/90-minute policy and validated dissection attempt events to
`docs/ARCHITECTURE.md`. Replace incomplete Progress entries with dated commands/results, record any
discoveries/decisions, and complete Outcomes with residual risks.

- [ ] **Step 4: Archive and validate governance**

Move this plan to `completed/`, remove its active-index row, add a completed-index row, then run
`python scripts/validate_agents_docs.py --level WARN`. Expected: 0 errors and 0 warnings.

- [ ] **Step 5: Commit Task 4**

Stage only integration documentation/index changes and commit
`docs: complete progress-aware watchdog plan`.

## Validation and Acceptance

- The 2026-08-04 field signature can no longer occur at ten minutes because production
  `RetryInsights` idle is exactly 30 minutes.
- A dissection produces one contract-valid attempt event immediately before every real supplier
  attempt; no repair means no repair event.
- Unknown/arbitrary stderr still cannot reset idle, and 90-minute absolute remains non-extendable.
- Progress and logs contain no user/supplier content.
- Cancellation, structured-result precedence, Credits, and atomic artifact behavior remain covered
  by existing suites.
- Manual regression: start a dissection with a delayed fake supplier, confirm generic AI progress
  renders without content, cancel it, and confirm the old result/transcript remains available.
