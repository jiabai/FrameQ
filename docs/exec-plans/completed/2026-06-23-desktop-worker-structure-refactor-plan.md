# Desktop Client / Worker Structure Refactor ExecPlan

## Goal

Make desktop client, Tauri bridge, and Python worker code easier to change by splitting oversized entry files into focused modules without changing user-visible behavior, Tauri command names, worker CLI flags, or JSON wire shapes.

## Decisions

- Treat this as an internal zero-behavior-change refactor; do not add a product spec.
- Keep React state behavior, Tauri commands, worker CLI options, updater behavior, ASR model download behavior, and account/session behavior compatible.
- Add a small contract fixture used only by tests to prevent TS/Rust/Python constants and worker result keys from drifting.
- Prefer extraction over rewriting; move existing code into focused modules and keep tests green after each subsystem.

## Implementation Tasks

- Add contract fixture and tests for shared desktop/worker constants.
- Split `App.tsx` into feature controllers and sheet/result components.
- Split Tauri `lib.rs` into runtime path, worker process, settings, history, updates, account, and window chrome modules.
- Split worker orchestration from `cli.py` into service, request parsing, history, and pipeline modules.
- Run frontend, Tauri, worker, docs, and diff verification.

## Progress

- [x] ExecPlan and contract safety added.
- [x] Frontend shell split completed.
- [x] Tauri modules split completed.
- [x] Worker orchestration split completed.
- [x] Full verification completed.
- [x] 2026-07-09: P2 God Component follow-up completed for the frontend shell. `App.tsx` now composes extracted account, task processing, transcript detail, settings, history, window chrome, and insight generation controllers while preserving behavior. Validation: `npm --prefix app test`, `npm --prefix app run build`, and `git diff --check`.
- [x] 2026-07-09: P2 hook-level testing first round completed for the extracted orchestration hooks. Added main-path and key-gate coverage for `useHistoryController`, `useSettingsController`, and `useInsightGenerationController`; remaining hook error branches and lightweight harness limitations are tracked in `docs/exec-plans/tech-debt-tracker.md`.
- [x] 2026-07-10: P2 hook-level testing second round completed for error branches. Added focused coverage for `useInsightGenerationController` key error branches and `useSettingsController` load/save/cache/location/profile error branches; remaining history concurrency and lightweight harness limitations are tracked in `docs/exec-plans/tech-debt-tracker.md`.

## Validation

- `npm --prefix app test`
- `npm --prefix app run build`
- `npm --prefix app run lint`
- `cargo test --manifest-path app\src-tauri\Cargo.toml`
- `npm --prefix app run tauri -- build --no-bundle`
- `uv run ruff check worker`
- `uv run pytest worker\tests`
- `python scripts\validate_agents_docs.py --level WARN`
- `git diff --check`

## Notes

- Baseline `cargo test --manifest-path app\src-tauri\Cargo.toml` passed in the isolated worktree.
- Baseline focused browser test `npm --prefix app test -- tests/app-input.browser.test.ts` passed after an initial Windows Chrome profile cleanup lock.
- Baseline worker `uv` commands hung in this worktree during environment initialization; full worker verification remains required after the refactor with a longer timeout.
- Tauri extraction added focused `account`, `settings`, `history`, `updates`, and `window_chrome` modules while preserving command names and payload shapes.
- Worker extraction leaves `cli.py` as an argparse/stdout facade and moves service orchestration, request parsing, history writing, and the media/ASR/insight pipeline into focused modules.
- Validation passed: `npm --prefix app test` (80 tests), `npm --prefix app run build`, `cargo test --manifest-path app\src-tauri\Cargo.toml` (29 tests), `npm --prefix app run tauri -- build --no-bundle`, `python -m ruff check worker`, `python -m pytest worker\tests` (85 tests), `python scripts\validate_agents_docs.py --level WARN`, and `git diff --check`.
- Validation gaps: `npm --prefix app run lint` is unavailable because `app/package.json` has no `lint` script; `uv run ruff check worker` and `uv run pytest worker\tests` timed out again during environment initialization in this worktree, so worker validation used the already available Python environment instead.

2026-06-26 re-verification gates passed:

- `npm --prefix app test` — 84 passed.
- `npm --prefix app run build` — passed.
- `cargo test --manifest-path app/src-tauri/Cargo.toml` — 31 passed.
- `npm --prefix server test` — 32 passed.
- `uv run pytest worker\tests` — 99 passed.
- `uv run ruff check worker` — passed.
- `python scripts/validate_agents_docs.py --level WARN` — 0 errors, 0 warnings.

## Outcomes & Retrospective

Delivered the zero-behavior-change structure split for the React shell, Tauri bridge, and Python worker orchestration while preserving command names, CLI flags, and JSON wire shapes. Contract fixtures and cross-language tests now help prevent TS/Rust/Python drift.

Residual risk: `npm --prefix app run lint` remains unavailable because the app package has no `lint` script; future large UI or Tauri changes should continue the modularization instead of rebuilding monolithic files.

2026-07-09 P2 frontend follow-up: The God Component split is closed. `App.tsx` remains the composition root and still owns startup/deep-link effects, `openCard` / `locateArtifact`, global `actionNotice`, and Sheet/Flow composition. Remaining risk is tracked in `docs/exec-plans/tech-debt-tracker.md`: automated UI/E2E smoke coverage is missing, and orchestration hooks still need hook-level tests before future wiring-heavy changes.

2026-07-09 P2 hook testing follow-up: The first hook-level testing round closed main-path and key-gate coverage for `useHistoryController`, `useSettingsController`, and `useInsightGenerationController`. At that point, insight generation and settings error branches remained deferred.

2026-07-10 P2 hook testing second-round follow-up: The error-branch testing round is closed. `useInsightGenerationController` now covers key preference read/save/retry/profile save-skip failure paths, and `useSettingsController` covers load/save/cache/location/profile failure paths. Deferred testing risk remains for `useHistoryController` concurrent/repeated open behavior and the fact that the lightweight hook harness does not exercise real React scheduling, DOM/Sheet interactions, or end-to-end UI behavior.
