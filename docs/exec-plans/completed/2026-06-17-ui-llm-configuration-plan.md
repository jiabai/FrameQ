# UI LLM Configuration Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ users should be able to configure InsightFlow LLM settings from the desktop UI instead of editing `.env` by hand. After this change, a user can open a settings panel, enter an OpenAI-compatible base URL, API key, model, and timeout, save the configuration, and then run or retry topic generation using the saved values.

## Progress

- [x] 2026-06-17: Scoped the feature to LLM configuration only. ASR model directory, output directory, and installer user-data redirection remain part of the separate installer/distribution work.
- [x] 2026-06-17: Product spec, task list, and durable docs are updated before code changes. Validation: `python scripts\validate_agents_docs.py --level ERROR`.
- [x] 2026-06-17: Tauri commands can read and save sanitized LLM configuration in the local `.env`. Validation: Rust tests cover hidden API key reads, preserving existing keys on blank save, and rejecting initial saves without a key.
- [x] 2026-06-17: Frontend client and tests cover reading, saving, and error mapping for settings. Validation: `npm --prefix app test -- settingsClient.test.ts`.
- [x] 2026-06-17: App UI exposes a settings panel with warning copy about transcript text being sent to the configured LLM service. Validation: `npm --prefix app test` and `npm --prefix app run build`.
- [x] 2026-06-17: Focused frontend/Rust/doc validation passes. Validation: `uv run ruff check worker`, `uv run pytest worker\tests`, `npm --prefix app test`, `cargo test --manifest-path app\src-tauri\Cargo.toml`, `python scripts\validate_agents_docs.py --level WARN`, and `npm --prefix app run tauri -- build --no-bundle`.

## Surprises & Discoveries

- Evidence: Current UI only exposes a video URL field. LLM config is currently `.env` / environment-variable only.
- Evidence: A separate draft installer distribution document already describes a future first-run wizard and user-data `.env`; this plan implements only the development/runtime UI configuration surface for the current project-root `.env`.
- Evidence: `README.md`, `.gitignore`, and `docs/design-docs/2026-06-17-installer-distribution-plan.md` have pre-existing local changes in the worktree. This feature should not stage unrelated local changes unless they are intentionally folded in later.
- Evidence: The first Rust TDD run failed with unresolved config helper imports, then passed after implementing `LlmConfigInput`, `LlmConfigView`, `get_llm_config`, and `save_llm_config`.
- Evidence: The first frontend client TDD run failed because `settingsClient` did not exist, then passed after adding `getLlmConfig` and `saveLlmConfig`.

## Decision Log

- Decision: Save UI-entered LLM settings to the existing project-root `.env` for this iteration. Rationale: current worker already reads project-root `.env`, so this adds user-facing configuration without changing packaged resource/user-data architecture. Date/Author: 2026-06-17 / Codex.
- Decision: Store the API key but never return it from `get_llm_config`; instead return `has_api_key`. Rationale: the UI needs to show whether a key exists without exposing secrets after save. Date/Author: 2026-06-17 / Codex.
- Decision: Keep provider fixed to `openai_compatible` in the UI for now. Rationale: the existing backend only supports OpenAI-compatible chat completions and this covers SiliconFlow/OpenAI-compatible providers. Date/Author: 2026-06-17 / Codex.

## Outcomes & Retrospective

Completed. FrameQ now exposes an LLM settings panel from the desktop top bar. The panel loads sanitized configuration through Tauri, never returns the saved API key, allows users to preserve an existing key by leaving the field blank, validates saves through Rust, and writes the existing project-root `.env` so the current worker config path can use it immediately. Remaining risk: this session verified TypeScript build and Tauri release compilation, but did not perform a manual click-through smoke of the settings modal in the running desktop app.

## Context and Orientation

- `app/src/App.tsx` currently renders the single-window processing UI.
- `app/src/workerClient.ts` currently hardcodes the ASR model and has no settings client.
- `app/src-tauri/src/lib.rs` owns Tauri commands and is the right place to add `get_llm_config` / `save_llm_config`.
- `worker/frameq_worker/config.py` already parses `.env`.
- `worker/frameq_worker/llm.py` already reads `FRAMEQ_LLM_*` keys from environment mappings.

## Plan of Work

1. Update product, design, security, architecture, and task docs to reflect user-facing LLM configuration.
2. Add Rust tests for `.env` parsing/writing behavior around LLM settings.
3. Add Tauri commands:
   - `get_llm_config` returns base URL, model, timeout, provider, and `has_api_key`.
   - `save_llm_config` validates and writes `FRAMEQ_LLM_*` values while preserving unrelated `.env` lines.
4. Add frontend settings client methods and focused tests.
5. Add a settings panel in the main UI:
   - toolbar settings button.
   - fields for base URL, API key, model, timeout.
   - warning copy that transcript text will be sent to the configured service.
   - save / close controls and save status.
6. Run focused and broad validation.

## Validation and Acceptance

- `cargo test --manifest-path app\src-tauri\Cargo.toml` passes and covers config helpers.
- `npm --prefix app test` passes and covers settings client behavior.
- `npm --prefix app run build` passes.
- `python scripts/validate_agents_docs.py --level WARN` passes.
- Manual UI smoke should verify the settings panel opens, saves config, closes, and does not reveal the existing API key after reload.
