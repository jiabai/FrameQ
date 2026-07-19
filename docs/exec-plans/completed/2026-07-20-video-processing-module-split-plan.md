# Video Processing Application Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Use test-driven-development for the preflight classifier and preserve green
> characterization coverage during each pure move.

**Goal:** Split the remaining URL processing, URL cache, and AI-retry responsibilities out of
`video_processing.rs` without changing contracts, commands, results, cache/preflight semantics,
diagnostics, cancellation, or user-visible behavior.

**Architecture:** The parent becomes a private module root and cancellation owner. Three focused
children own retry orchestration, URL cache policy, and URL process/config/preflight orchestration;
the existing `task_result.rs` remains the only typed task-outcome adapter. No new facade or
local-media placeholder is introduced.

**Tech Stack:** Rust 2021, Tauri v2, Serde/serde_json, Cargo tests, rustfmt, existing FrameQ
worker-runtime and task-access capabilities, Markdown governance documents.

---

> This ExecPlan is a living document. Keep Progress, Surprises & Discoveries, Decision Log, and
> Outcomes & Retrospective current while executing it.

## Progress

- [x] 2026-07-20: Re-inspected the 1,118-line module, existing task-result boundary, worker result
  types, active local-media plan, architecture, security, design rules, workflow, execution gates,
  and audit evidence; reconciled earlier split proposals into the approved workflow-boundary design.
- [x] 2026-07-20: Created isolated worktree
  `.worktrees/refactor-video-processing-modules` on branch
  `codex/refactor-video-processing-modules`; the main worktree remains untouched.
- [x] 2026-07-20: Established the pre-change baseline. All 20 focused `video_processing` tests and
  rustfmt passed. The complete suite passed 159/159 with native Windows process permission; the
  sandbox-only run passed 158 and failed only the known blocked-stdin cancellation fixture because
  `taskkill` could not terminate the child process.
- [x] 2026-07-20: Recorded the approved boundary in
  `docs/design-docs/2026-07-20-video-processing-module-split.md` and this active ExecPlan.
- [x] 2026-07-20: Added the source-identity preflight classification matrix. The first RED also
  exposed that the closed failed-identity error type needed a test-only re-export; after adding that
  non-production test seam, RED failed only with `E0432` for the intentionally missing classifier.
  GREEN passed all 4 new matrix tests and all 24 `video_processing` tests.
- [x] 2026-07-20: Extracted strict retry parsing, execution, safe diagnostics, and all 6 existing
  tests into `retry_insights.rs`. A thin root Tauri delegate preserves the original handler path;
  retry-focused 6/6 and all `video_processing` 24/24 tests passed, and the retry dependency scan
  found no task-manifest, source-identity, URL-cache, ASR-setting, or local-media dependency.
- [x] 2026-07-20: Extracted the URL cache policy and all 5 existing cache tests into
  `url_cache.rs`; narrowed inputs to URL or `SourceIdentity` plus ASR model. Cache 5/5 and the
  dependency scan passed with matching behavior unchanged.
- [x] 2026-07-20: Extracted process DTO/config, two-step cache orchestration, preflight, job
  submission, diagnostics, and 9 tests into `url_processing.rs`; reduced the Tauri root from 1,118
  to 68 lines. URL 9/9 and all `video_processing` 24/24 tests passed; URL/retry/cache dependency
  scans passed.
- [x] 2026-07-20: Completed implementation regression gates. Native-permission Rust passed 163/163,
  rustfmt passed, App passed 63 files / 542 tests, TypeScript/i18n lint passed, Vite transformed
  2,123 modules and built with the existing 659.62 kB chunk warning, scripts passed 23/23, and the
  Tauri release profile built successfully with `--no-bundle`.
- [x] 2026-07-20: Synchronized architecture, security, measured audit evidence, local-media
  prerequisite 0.3, task tracking, indexes, and design status; archived this plan. Final governance
  reported 0 errors and 0 warnings, and `git diff --check` passed.

## Surprises & Discoveries

- The full Rust suite's Windows blocked-stdin fixture requires permission to execute the fixed
  `taskkill /T /F` cancellation command. The sandboxed baseline therefore failed 1/159 after 30
  seconds, while the same complete suite passed 159/159 with native permission. This is baseline
  environment evidence, not a production defect or scope for this refactor.
- The cache currently accepts a complete `ProcessVideoWorkerRequest` even though it uses only URL
  and ASR model. Narrowing that input removes an unnecessary dependency on the worker wire DTO while
  preserving the same matching rule.
- Source-identity preflight is deliberately best-effort only for cache optimization. Protocol,
  identity-resolution, or unstructured failures continue normal URL processing; cancellation,
  busy, and transport failures remain terminal. This asymmetry requires an explicit matrix before
  moving code.
- Tauri's `#[command]` macro generates hidden handler symbols in the function's defining module.
  Re-exporting only the function therefore failed `generate_handler!` compilation. The root must
  retain a thin macro-annotated delegate while the child owns parsing and orchestration, preserving
  the original command path and registration.

## Decision Log

- Decision: Split by workflow/failure boundary into `retry_insights.rs`, `url_cache.rs`, and
  `url_processing.rs`, retaining the existing `task_result.rs`. Rationale: these modules have stable
  and distinct dependencies; helper/request/service buckets do not. Date/Author: 2026-07-20, User +
  Codex.
- Decision: Do not add another facade. Rationale: `VideoWorkerFacade`, `SupportedTask`, and
  `MediaPreparationFacade` already hide the complex subsystem boundaries; the remaining code needs
  cohesion and composition, not another object layer. Date/Author: 2026-07-20, User + Codex.
- Decision: Characterize preflight through one private pure classifier before extraction.
  Rationale: process spawning is already covered by the worker runtime; the risk here is preserving
  the tolerant-versus-terminal outcome policy. Date/Author: 2026-07-20, User + Codex.
- Decision: Keep contract v3, Tauri command paths, task results, manifests, worker sources, packaged
  resources, and frontend production untouched. Rationale: this prerequisite must not mix
  local-media v4 behavior or user-visible change into a structural review. Date/Author: 2026-07-20,
  User + Codex.
- Decision: Keep thin Tauri command delegates in the root rather than change `lib.rs` registration
  or attempt to re-export macro internals. Rationale: this preserves the exact command surface while
  keeping workflow logic inside focused child modules. Date/Author: 2026-07-20, Codex.

## Outcomes & Retrospective

The approved split is implemented. `video_processing.rs` is now a 68-line Tauri adapter and
cancellation root. `retry_insights.rs` owns strict retry parsing/execution/safe diagnostics;
`url_cache.rs` owns validated model-aware URL/identity task reuse; `url_processing.rs` owns strict
process DTO/config, the explicit source-preflight matrix, two-step cache orchestration, safe
cache-hit logging, and process job submission. The existing `task_result.rs` remains the sole closed
task-outcome mapper.

The source-preflight RED failed only on the missing classifier after adding a test-only closed DTO
type re-export; GREEN passed 4/4. Existing retry 6, cache 5, URL/process 5, and task-result 4 tests
plus the new matrix produce 24 focused tests. Complete Rust passed 163/163 with native Windows
process permission; App passed 542/542, scripts 23/23, lint/build/rustfmt passed, and the build kept
only the pre-existing 659.62 kB chunk warning. The Tauri release profile also built successfully
with `--no-bundle`. No command registration, contract, worker, packaged
resource, manifest schema, frontend production source, cache behavior, diagnostic policy,
cancellation behavior, or user-visible behavior changed. The only Rust diff outside the
`video_processing` module tree is a `#[cfg(test)]` re-export of `SourceIdentityFailure`, required to
construct the closed failed-identity matrix case; it is absent from production builds.

Residual risk is limited to structural maintenance: the three child files include 20 moved tests
and 4 new tests, so their physical line counts overstate production size. Future local media must
still add its real source/command boundary atomically with contract v4 rather than growing
`url_processing.rs` or adding a dead variant. Optional `cargo clippy` was not a project gate and
could not run because the installed Rust toolchain lacks the Clippy component; Cargo test and
rustfmt remain the required Rust gates.

## Context and Orientation

- Approved design:
  `docs/design-docs/2026-07-20-video-processing-module-split.md`.
- Current parent: `app/src-tauri/src/video_processing.rs`.
- Existing result adapter: `app/src-tauri/src/video_processing/task_result.rs`.
- Typed worker execution: `app/src-tauri/src/worker_runtime/facade.rs` and
  `app/src-tauri/src/worker_runtime/runner.rs`.
- Closed terminal DTOs: `app/src-tauri/src/worker_runtime/result_protocol.rs`.
- Validated task/cache capabilities: `app/src-tauri/src/task_manifest.rs`.
- Future consumer: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`.
- Audit: `docs/design-docs/frameq-code-audit-uml.md`.

## File Responsibility Map

| File | Responsibility after implementation |
|---|---|
| `app/src-tauri/src/video_processing.rs` | child declarations, thin Tauri command delegates, cancellation command, narrowly shared trusted desktop result DTO construction |
| `app/src-tauri/src/video_processing/task_result.rs` | existing closed process/retry worker-outcome mapping; unchanged in responsibility |
| `app/src-tauri/src/video_processing/retry_insights.rs` | strict retry request parsing, command/blocking orchestration, safe diagnostics, retry tests |
| `app/src-tauri/src/video_processing/url_cache.rs` | exact/canonical URL cache matching, model compatibility, validated cached task projection, cache tests |
| `app/src-tauri/src/video_processing/url_processing.rs` | process DTO/config resolution, v3 serialization, preflight classifier/execution, two-step cache/process orchestration, process tests |

## Task 1: Lock the Source-Preflight Behavior Matrix

**Files:**

- Modify: `app/src-tauri/src/video_processing.rs`
- Test: `app/src-tauri/src/video_processing.rs`

- [x] Add tests for completed identity, failed identity, wrong structured family, unstructured
  failure, protocol violation, cancellation, already-running, and every remaining transport error
  family. Assert only the classification decision; never compare raw worker content.
- [x] Call a not-yet-existing private `classify_source_identity_preflight_result` from those tests.
- [x] Run:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml source_identity_preflight
  ```

  Require RED to be an unresolved classifier symbol, not a dependency or unrelated compile failure.
- [x] Implement the smallest pure classifier preserving the current match semantics, then route
  `resolve_source_identity_for_cache` through it.
- [x] Re-run the focused classifier tests and all `video_processing` tests; require GREEN.
- [x] Record exact RED/GREEN evidence in Progress.

## Task 2: Extract Retry Insights

**Files:**

- Create: `app/src-tauri/src/video_processing/retry_insights.rs`
- Modify: `app/src-tauri/src/video_processing.rs`
- Test: `app/src-tauri/src/video_processing/retry_insights.rs`

- [x] Move `RetryInsightsTarget`, `OutputLanguage`, strict wire/request DTOs,
  `parse_retry_insights_request`, the async/blocking command orchestration, and safe diagnostic
  helpers without semantic edits.
- [x] Move the six existing retry parsing/diagnostic tests beside their owner.
- [x] Keep a thin root `retry_insights` Tauri delegate so `lib.rs` and command registration remain
  unchanged; the child owns its implementation without duplicating parsing or orchestration.
- [x] Run retry-focused tests and all `video_processing` tests.
- [x] Verify `retry_insights.rs` has no `task_manifest`, source-identity, URL-cache, ASR-setting, or
  local-media dependency.
- [x] Review the move-only diff before continuing and record evidence in Progress.

## Task 3: Extract URL Cache Policy

**Files:**

- Create: `app/src-tauri/src/video_processing/url_cache.rs`
- Modify: `app/src-tauri/src/video_processing.rs`
- Modify: `app/src-tauri/src/video_processing/url_processing.rs` when adopted in Task 4
- Test: `app/src-tauri/src/video_processing/url_cache.rs`

- [x] Move cache scan/match/projection functions and the five existing cache tests.
- [x] Replace the complete worker-request argument with explicit `requested_url` or
  `SourceIdentity` plus `asr_model` inputs. Preserve trimming, status, transcript-artifact,
  identity-safety, newest-created-at, and model-compatibility behavior exactly.
- [x] Keep `TaskTerminalResult::from_value` fallibility for cached projections; invalid cached task
  values remain a cache miss rather than a trusted panic.
- [x] Run cache-focused tests and all `video_processing` tests.
- [x] Verify `url_cache.rs` has no `tauri`, runtime-path, supervisor, `WorkerJob`, settings,
  diagnostics/logging, or local-media dependency.
- [x] Review the diff and record evidence in Progress.

## Task 4: Extract URL Process Orchestration and Reduce the Root

**Files:**

- Create: `app/src-tauri/src/video_processing/url_processing.rs`
- Modify: `app/src-tauri/src/video_processing.rs`
- Test: `app/src-tauri/src/video_processing/url_processing.rs`

- [x] Move `ProcessVideoIpcRequest`, the strict worker DTO, contract-v3 constant, async/blocking
  command, request serialization/config resolution, preflight error/classifier/execution,
  cache-hit diagnostics, and five process/request tests.
- [x] Adopt the narrow `url_cache` APIs for exact-URL and canonical-identity lookups.
- [x] Keep a thin root `process_video` Tauri delegate and expose the
  `PROCESS_VIDEO_CONTRACT_VERSION` test alias under its existing parent path. Do not modify `lib.rs` command
  registration or contract assertions.
- [x] Leave the root owning only child declarations/delegates, `cancel_process`, and the narrowly
  shared trusted desktop result DTO/helper still used by URL cache/config failure.
- [x] Run preflight/process-focused tests, all `video_processing` tests, complete Rust tests with the
  required native Windows cancellation permission, and rustfmt.
- [x] Run dependency scans and record measured line counts/responsibilities.

## Task 5: Cross-Layer Regression and Closeout

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/2026-07-20-video-processing-module-split.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Move this plan from `active/` to `completed/`.

- [x] Run:

  ```powershell
  npm --prefix app test
  npm --prefix app run lint
  npm --prefix app run build
  cargo test --manifest-path app/src-tauri/Cargo.toml
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  node --test scripts/tests/*.test.mjs
  python scripts/validate_agents_docs.py --level WARN
  git diff --check
  ```

- [x] Prove no production diff exists under `worker/`, `contracts/`, `app/src/`, packaged worker
  resources, task-manifest implementation, or Tauri command registration.
- [x] Update architecture/security with the final module and trust boundaries; update the audit with
  measured line counts and resolve the hotspot entry without claiming local-media v4 exists.
- [x] Mark local-media prerequisite 0.3 complete with exact evidence, update `TASKS.md`, set the
  design status to implemented, complete Outcomes, archive this plan, and update both indexes and
  `AGENTS.md`.
- [x] Re-run governance, formatting, diff, and status checks after closeout.

## Final Acceptance

- Every source-preflight outcome is locked by the behavior matrix.
- All moved tests pass beside their owning modules; no test is deleted without equivalent coverage.
- Root/retry/cache/process dependencies match the approved design.
- Tauri command paths, contract-v3 constant, request/result shapes, cache and preflight semantics,
  diagnostics, cancellation, and task-result mapping are unchanged.
- Complete Rust/app/script/docs/build/format/diff gates pass with exact totals recorded.
- Contract v4 and local-media behavior remain pending after this prerequisite.
