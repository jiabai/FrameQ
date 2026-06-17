# History and Output Configuration Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ should remember completed or failed local processing tasks and let users choose where future generated result files are saved. After this change, users can open a history panel, inspect past task status and result paths, reopen available transcript or insight details, and edit an output directory setting in the existing settings panel.

## Progress

- [x] 2026-06-17: User selected方案 A: local `work/history.json` plus `.env` `FRAMEQ_OUTPUT_DIR`.
- [x] 2026-06-17: Product, architecture, design, security, task list, `.env.example`, and active plan are updated before feature implementation.
- [x] 2026-06-17: Implemented worker output directory resolution and history append behavior. Validation: `uv run pytest worker\tests\test_cli.py -k "configured_output_dir or records_history"`.
- [x] 2026-06-17: Added Tauri settings/history support. Validation: `cargo test --manifest-path app\src-tauri\Cargo.toml`.
- [x] 2026-06-17: Added frontend settings output directory field, history client, top-bar history modal, and history restore behavior. Validation: `npm --prefix app test`, `npm --prefix app run build`.
- [x] 2026-06-17: Ran full validation and recorded outcomes.

## Surprises & Discoveries

- Evidence: `worker/frameq_worker/cli.py` currently hardcodes `output_dir = project_root / "outputs"` and `work_dir = project_root / "work"`.
- Evidence: `work/` is already ignored by git, so `work/history.json` stays local by default.
- Evidence: Settings and detail modal scrolling bugs share the same root cause: flex/grid children need `min-height: 0` and their own overflow region.
- Evidence: `FRAMEQ_OUTPUT_DIR` can be resolved in worker runtime env without changing request JSON, keeping Tauri request schema stable for processing.

## Decision Log

- Decision: Store history in `work/history.json`. Rationale: it is local-first, already ignored, easy to inspect, and does not add a database dependency. Date/Author: 2026-06-17 / Codex.
- Decision: Store output directory in `.env` as `FRAMEQ_OUTPUT_DIR`; blank means project-root `outputs/`. Rationale: the worker already reads project `.env`, and this keeps config consistent with LLM settings. Date/Author: 2026-06-17 / Codex.
- Decision: Output directory changes affect only new tasks; old history keeps actual saved paths. Rationale: moving or rewriting old files would be surprising and risks data loss. Date/Author: 2026-06-17 / Codex.

## Outcomes & Retrospective

Implemented Plan A end to end. New tasks can save generated artifacts to a user-configured `FRAMEQ_OUTPUT_DIR`; blank keeps the existing project-root `outputs/` behavior, and the output directory can be saved even when LLM credentials are not configured. Worker runs append local task records to `work/history.json`, and the desktop UI can open a scrollable history panel, inspect previous status/path metadata, and restore available transcript or insight details into the existing result viewer. Detail, settings, and history dialogs now each provide their own scrollable content region.

Validation passed: `uv run pytest worker\tests`, `cargo test --manifest-path app\src-tauri\Cargo.toml`, `npm --prefix app test`, `npm --prefix app run build`, `npm --prefix app run tauri -- build --no-bundle`, and `python scripts\validate_agents_docs.py --level WARN`.

Validation notes: `cargo fmt --manifest-path app\src-tauri\Cargo.toml --check` could not run because the local Rust toolchain lacks `rustfmt`; `npm --prefix app run lint` could not run because `app/package.json` has no `lint` script.

## Context and Orientation

- `worker/frameq_worker/config.py` loads project `.env` and merges it with process environment.
- `worker/frameq_worker/cli.py` orchestrates download, media validation, audio extraction, ASR, InsightFlow, and final `ProcessResult`.
- `app/src-tauri/src/lib.rs` owns commands for process execution and settings persistence.
- `app/src/settingsClient.ts` maps Tauri setting commands to frontend-friendly camelCase fields.
- `app/src/App.tsx` owns the single-window UI and is currently the place to add history/settings presentation.
- `app/tests/app-input.browser.test.ts` now covers browser-level regressions for paste and modal scrolling.

## Plan of Work

1. Worker:
   - Add output directory resolution from `FRAMEQ_OUTPUT_DIR`.
   - Keep intermediate WAVs in project-root `work/`.
   - Append a sanitized history item to `work/history.json` when a processing run returns.
   - Cover default output directory, configured output directory, and history persistence with Python tests.
2. Tauri:
   - Extend LLM settings view/input with `output_dir`.
   - Preserve unrelated `.env` entries and save `FRAMEQ_OUTPUT_DIR`.
   - Add `get_history` command that reads `work/history.json` and returns newest-first records.
   - Cover config read/save and history read behavior with Rust tests.
3. Frontend:
   - Add output directory field to settings panel.
   - Add history client and top-bar history button.
   - Render a scrollable history modal with task URL, status, timestamp, output directory, and result buttons.
   - Opening a history result should reuse the existing detail modal and export paths.
   - Cover clients and browser/UI behavior with Vitest.
4. Validation:
   - Run worker, Rust, frontend, docs, web build, and Tauri no-bundle build checks.

## Validation and Acceptance

- `uv run pytest worker\tests` passes.
- `cargo test --manifest-path app\src-tauri\Cargo.toml` passes.
- `npm --prefix app test` passes.
- `npm --prefix app run build` passes.
- `npm --prefix app run tauri -- build --no-bundle` passes.
- `python scripts\validate_agents_docs.py --level WARN` passes.
- Manual follow-up: restart `npm --prefix app run tauri dev`, save a custom output directory, run a task, then confirm history shows the record and generated files point at the configured path.
