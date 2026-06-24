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
- [ ] Full verification completed.

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
