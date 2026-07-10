# macOS ProcessSupervisor CI Validation Implementation Plan

> **For agentic workers:** Execute inline with TDD. Keep this plan active until the GitHub-hosted macOS job is green and its run URL is recorded.

**Goal:** Obtain reproducible macOS evidence that the real `cfg(unix)` ProcessSupervisor parent/child process-group TERM-to-KILL fixture passes as part of the complete Tauri Cargo suite.

**Architecture:** Use one isolated GitHub Actions workflow with a single `macos-latest` job and read-only permissions. It checks out the repository, installs stable Rust, and runs the complete Tauri Cargo test command. A Node contract test statically locks the supported runner, command, least-privilege/no-secret boundary, exclusion of unsupported Linux, and continued presence of the Unix-gated fixture used by macOS.

**Tech Stack:** GitHub Actions YAML, Rust/Cargo, Node `node:test`, Tauri v2 system dependencies.

---

## Progress

- [x] 2026-07-11: Confirmed clean `8c968bf`, read governance/architecture/security/debt, inspected existing workflows and the `cfg(unix)` fixture, and archived the two already-completed ExecPlans.
- [x] 2026-07-11: Selected an isolated hosted validation workflow; no installer, signing, release, provider, LLM, media download, or payment steps are in scope.
- [x] 2026-07-11: Added the workflow contract test first and observed the expected red result: 1 pass, 1 failure because `.github/workflows/unix-process-supervisor.yml` did not exist.
- [x] 2026-07-11: Added the minimal read-only workflow and observed the focused contract test green: 2/2 passed. No Rust or ProcessSupervisor source changed.
- [x] 2026-07-11: Ran the existing Windows Cargo suite and all local project gates: Rust 90, app 205, worker 249, server 57, scripts 9, builds, Ruff, Rustfmt, docs, and focused workflow checks passed. The Unix fixture remained correctly unexecuted on Windows.
- [x] 2026-07-11: After user authorization, committed and pushed `08032c9`; run `29108030194` executed both original matrix jobs. The real parent-child process-group fixture passed on macOS and Ubuntu, while each full Cargo job failed on the same six Windows-only test fixtures.
- [x] 2026-07-11: User clarified Linux is not a supported FrameQ platform. Changed the workflow contract red→green and reduced the workflow to one `macos-latest` job; no Linux dependency installation remains.
- [x] 2026-07-11: Replaced Windows-drive test paths with platform-native fixture paths and made the packaged Python layout assertion use `bundled_python_path`; no production runtime or ProcessSupervisor implementation changed.
- [ ] Push the minimal follow-up and record a complete green macOS Cargo job URL/ID.
- [ ] Only after the hosted macOS job passes, close the macOS cancellation verification debt and archive this plan.

## Task 1: Workflow contract TDD

**Files:**

- Create: `scripts/tests/unix-process-supervisor-workflow.test.mjs`
- Create after red: `.github/workflows/unix-process-supervisor.yml`

- [x] Write a Node test that originally required the requested Ubuntu/macOS matrix, then update it by TDD after the product decision to require only `macos-latest`, `contents: read`, `workflow_dispatch`, the full Cargo test command, bounded timeout, no Linux setup, and no secrets/release/installer/provider commands.
- [x] Assert the Rust source still contains the `#[cfg(unix)]` parent-plus-child fixture named `unix_termination_stops_a_parent_and_child_in_the_managed_process_group`.
- [x] Run `node --test scripts/tests/unix-process-supervisor-workflow.test.mjs`; observed red result was the missing workflow file while the existing fixture assertion passed.
- [x] Add the minimal workflow without changing Rust or ProcessSupervisor behavior.
- [x] Re-run the focused Node test; observed 2/2 green.

## Task 2: Local regression gates

**Files:** no functional production changes; test fixture portability changes are allowed only where the hosted full suite exposed Windows-only assumptions.

- [x] Run `cargo test --manifest-path app/src-tauri/Cargo.toml` on Windows and confirm all 90 existing tests pass; the `cfg(unix)` fixture was skipped locally by platform configuration.
- [x] Run app, worker, server, script, build, lint/format, and docs gates from AGENTS/WORKFLOW. Final diff/status checks are repeated immediately before handoff.
- [x] Confirm `WECHAT_PAY_ENABLED` remains opt-in only (`=== "1"`, example value `0`) and the workflow contains no payment credentials or real external-service calls.

## Task 3: Hosted macOS evidence gate

**Files:** update this plan and `docs/exec-plans/tech-debt-tracker.md` only after hosted success.

- [x] Wait for explicit user authorization before the initial commit or push.
- [x] Inspect run `29108030194`: the macOS Unix fixture passed; the full job failed 84 passed / 6 failed because test-only paths encoded Windows drive syntax and `python.exe`. The original Ubuntu job showed the same six failures and also passed the Unix fixture, but Linux evidence is not a product gate.
- [ ] Push the follow-up and inspect the macOS job log for both the named fixture and successful full Cargo result.
- [ ] Record workflow run URL, run ID, commit SHA, and macOS job result.
- [ ] Close the macOS verification technical debt only when the complete hosted job is green; otherwise keep it open with failure evidence and remediation status.

## Decisions

- Decision: Use a dedicated workflow instead of adding jobs to `desktop-release.yml`. Rationale: validation needs no release permissions, secrets, installer resources, signing, packaging, or provider smoke. Date: 2026-07-11.
- Decision: Run the complete Cargo test command rather than a name filter. Rationale: this proves the Unix fixture executes in the same suite while catching platform compilation or cancellation regressions around it. Date: 2026-07-11.
- Decision: Keep `contents: read` and avoid caches initially. Rationale: the workflow is small, auditable, and has no reason to write repository or release state. Date: 2026-07-11.
- Decision: Do not close debt based on YAML review or Windows tests. Rationale: acceptance requires real hosted macOS execution. Date: 2026-07-11.
- Decision: Remove Ubuntu from the workflow after the user clarified that FrameQ does not support Linux. Rationale: unsupported platforms must not become release gates or imply a support claim. Date: 2026-07-11.
- Decision: Fix only test fixture portability exposed by run `29108030194`. Rationale: the macOS process-group fixture already passed; full-suite failures came from Windows drive syntax and packaged-Python test layout, so production cancellation behavior does not need redesign. Date: 2026-07-11.

## Validation

- `node --test scripts/tests/unix-process-supervisor-workflow.test.mjs`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `npm --prefix app test`
- `npm --prefix app run build`
- `uv run pytest worker/tests`
- `uv run ruff check worker`
- `npm --prefix server test`
- `npm --prefix server run build`
- `node --test scripts/tests/*.test.mjs`
- `python scripts/validate_agents_docs.py --level WARN`
- `cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check`
- `git diff --check`
- `git status --short`
- GitHub Actions: macOS job green, with run URL recorded after push.

### Local validation record (2026-07-11)

- `node --test scripts/tests/unix-process-supervisor-workflow.test.mjs`: red before workflow (1 passed, 1 expected missing-file failure), then 2/2 passed after the minimal workflow.
- `cargo test --manifest-path app/src-tauri/Cargo.toml`: 90/90 passed on Windows; the `cfg(unix)` fixture was not executed locally.
- `npm --prefix app test`: 205/205 passed.
- `npm --prefix app run build`: passed.
- `uv run pytest worker/tests`: 249/249 passed with one existing dependency deprecation warning.
- `uv run ruff check worker`: passed.
- `npm --prefix server test`: 57/57 passed with Node's existing experimental SQLite warning.
- `npm --prefix server run build`: passed.
- `node --test scripts/tests/*.test.mjs`: 9/9 passed.
- `python scripts/validate_agents_docs.py --level WARN`: 0 errors, 0 warnings.
- `cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check`: passed.
- Initial GitHub run `29108030194` at `08032c9`: macOS fixture passed, but the full macOS job failed 84/90 due to six test-only Windows path assumptions. Ubuntu produced the same six failures and also passed the Unix fixture; it was removed after Linux was declared unsupported.
- After the macOS-only/test-fixture follow-up: Windows Rust 90/90, app 205/205 plus build, worker 249/249 plus Ruff, server 57/57 plus build, scripts 9/9, Rustfmt, docs, and diff checks passed locally.
- Follow-up GitHub-hosted macOS run: pending push and green result.

## Residual Risk

- Until one complete hosted macOS Cargo job is green, macOS TERM-to-KILL verification remains open release debt. The named fixture passing inside a failed full job is useful evidence but does not satisfy the complete gate.
- GitHub-hosted macOS runner image changes may later expose an OS-specific race; the workflow should remain a release-readiness signal after initial evidence.
