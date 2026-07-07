# Tauri Lib Module Split Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

This plan reduces `app/src-tauri/src/lib.rs` from a catch-all Tauri boundary file into focused Rust modules without changing user-visible behavior. The desktop app should still expose the same Tauri command names, request and response JSON shapes, worker spawning behavior, local-first data boundaries, account/quota behavior, ASR model download behavior, and result caching behavior. The user should see no UI or workflow difference; the benefit is lower review risk and a clearer architecture for future Tauri command work.

This is an internal architecture refactor, so it does not require a product spec. It does require tight verification because `lib.rs` currently sits on several security-sensitive paths: app-local data resolution, worker subprocess environment construction, diagnostics redaction, process cancellation, ASR model download, task artifact reuse, and server-managed LLM checkout injection.

## Progress

- [x] 2026-07-07: Diagnosed `app/src-tauri/src/lib.rs` size, responsibilities, and existing module dependencies before planning. Validation: `(Get-Content app/src-tauri/src/lib.rs).Count` reported 2670 lines; `Get-ChildItem app/src-tauri/src -File` showed `lib.rs` as the largest Rust source file at 92830 bytes; `rg -n "^(const |struct |enum |impl |fn |pub\(crate\) fn|async fn|#\[tauri::command\]|mod tests|    #\[test\])" app/src-tauri/src/lib.rs` mapped runtime, diagnostics, worker command, cache, ASR model, deep-link, bootstrap, and test sections.

## Surprises & Discoveries

Evidence: `app/src-tauri/src/lib.rs` is 2670 lines and 92830 bytes. The next largest Rust modules are around 20KB (`transcript_detail.rs`, `insight_preferences.rs`, `account.rs`), so `lib.rs` is materially larger than the rest of the Tauri modules.

Evidence: `lib.rs` owns at least seven Tauri commands directly: `process_video`, `retry_insights`, `cancel_process`, `check_first_run`, `download_asr_model`, `cancel_asr_model_download`, and `greet`. It also registers many already-extracted module commands from `account`, `settings`, `history`, `transcript_detail`, `insight_preferences`, `updates`, and `window_chrome`.

Evidence: Existing modules import root-level runtime helpers and constants through `crate::{ensure_runtime_dirs, resolve_runtime_paths, RuntimePaths}` and `crate::OUTPUT_DIR_ENV` / `crate::DEFAULT_ASR_MODEL`. The first extraction must preserve those call sites with re-exports or update all callers in one small step.

Evidence: `lib.rs` test coverage is broad but clustered by responsibility. Tests already characterize runtime paths, diagnostics redaction, process state, cached task reuse, structured insight parsing, worker command env construction, worker stdout parsing, ASR model availability, model download command construction, account URL helpers, settings dotenv behavior, and desktop worker contract constants.

Evidence: `docs/exec-plans/active/index.md` currently lists only the installer distribution runtime plan. Adding this plan makes the `lib.rs` refactor explicit active work without disturbing the installer release validation plan.

## Decision Log

- Decision: Treat this as a no-behavior-change Rust module extraction, not a product feature. Rationale: the request is maintainability-focused, and changing product spec, UI behavior, command schema, worker behavior, server behavior, or local data contracts would make the refactor hard to review and risky to ship. Date/Author: 2026-07-07 / Codex.
- Decision: Extract from lowest-dependency utilities toward command orchestration: `runtime`, `diagnostics`, `worker_command`, `asr_model`, `video_processing`, and then optional `deep_link`. Rationale: existing modules already depend on runtime helpers, and command modules depend on runtime plus diagnostics plus worker command helpers. Date/Author: 2026-07-07 / Codex.
- Decision: Preserve root-level compatibility with `pub(crate) use` re-exports during the split. Rationale: modules such as `settings.rs`, `task_manifest.rs`, `history.rs`, `transcript_detail.rs`, `insight_preferences.rs`, and `account.rs` currently import runtime helpers from `crate::...`; re-exports keep each extraction small and reduce churn. Date/Author: 2026-07-07 / Codex.
- Decision: Move tests with the module they characterize, but keep cross-module bootstrap and contract tests in `lib.rs` until the final cleanup. Rationale: moving tests with code gives focused ownership, while command registration and contract constants still belong near the Tauri app entry point until all modules settle. Date/Author: 2026-07-07 / Codex.

## Outcomes & Retrospective

Not implemented yet. Expected outcome after implementation: `app/src-tauri/src/lib.rs` keeps only module declarations, root-level compatibility re-exports, `run()`, plugin setup, command registration, and any truly cross-module bootstrap tests. Residual risk to resolve during implementation: Rust visibility and circular dependencies can easily grow if command modules reach back into `lib.rs`; each extraction must be verified independently before moving to the next module.

## Context and Orientation

- Tauri root and bootstrap: `app/src-tauri/src/lib.rs`, `app/src-tauri/src/main.rs`.
- Existing extracted Tauri modules: `app/src-tauri/src/account.rs`, `app/src-tauri/src/settings.rs`, `app/src-tauri/src/history.rs`, `app/src-tauri/src/task_manifest.rs`, `app/src-tauri/src/transcript_detail.rs`, `app/src-tauri/src/insight_preferences.rs`, `app/src-tauri/src/updates.rs`, `app/src-tauri/src/window_chrome.rs`.
- Worker contracts and artifacts: `contracts/desktop-worker-contract.json`, `worker/frameq_worker/models.py`, `worker/frameq_worker/requests.py`, `worker/frameq_worker/pipeline.py`, `worker/frameq_worker/task_store.py`.
- Governance and boundaries: `AGENTS.md`, `WORKFLOW.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/exec-plans/index.md`.
- Current active plan index: `docs/exec-plans/active/index.md`.

## Plan of Work

1. Establish a clean baseline and characterization gates.
   - Confirm the worktree is clean with `git status --short`.
   - Run `cargo test --manifest-path app\src-tauri\Cargo.toml` before the first extraction.
   - Record the starting `lib.rs` line count with `(Get-Content app/src-tauri/src/lib.rs).Count`.
   - Do not change frontend, worker, server, product specs, or Tauri command names in this plan.

2. Extract runtime and app-local path helpers into `app/src-tauri/src/runtime.rs`.
   - Move `RuntimePaths`, `resolve_runtime_paths`, `normalize_resource_dir`, `resource_dir_has_runtime`, `ensure_runtime_dirs`, `remove_legacy_app_local_temp_dir`, `path_to_env_string`, `bundled_python_path`, `prepend_to_path`, and runtime/env constants that are shared by other modules.
   - Keep compatibility re-exports in `lib.rs`, such as `pub(crate) use runtime::{ensure_runtime_dirs, path_to_env_string, resolve_runtime_paths, RuntimePaths, OUTPUT_DIR_ENV};`, so existing modules do not need a broad import rewrite in the same step.
   - Move focused tests: `ensure_runtime_dirs_creates_app_local_cache_dir`, `normalize_resource_dir_uses_packaged_resources_subdir_when_tauri_returns_install_root`.
   - Run `cargo test --manifest-path app\src-tauri\Cargo.toml ensure_runtime_dirs normalize_resource_dir`.
   - Then run `cargo test --manifest-path app\src-tauri\Cargo.toml`.

3. Extract diagnostics and log redaction into `app/src-tauri/src/diagnostics.rs`.
   - Move `desktop_log_path`, `append_desktop_log`, `diagnostic_timestamp`, `sanitize_log_token`, `sanitize_diagnostic_text`, `redact_sensitive_line`, `redact_youtube_media_urls`, `redact_cookie_cli_hints`, `collapse_log_whitespace`, `summarize_worker_result_for_log`, and `truncate_for_log`.
   - Keep worker-command-specific formatting in `lib.rs` or `worker_command.rs` until `WorkerCommandSpec` has moved.
   - Move focused tests: `desktop_log_path_lives_under_app_local_logs`, `desktop_log_redacts_sensitive_values_before_writing`, `worker_result_log_summary_includes_status_task_and_sanitized_error`, `diagnostic_text_redacts_llm_and_cookie_material`.
   - Run `cargo test --manifest-path app\src-tauri\Cargo.toml diagnostic desktop_log worker_result_log_summary`.
   - Then run `cargo test --manifest-path app\src-tauri\Cargo.toml`.

4. Extract worker command construction, subprocess spawning, stdout parsing, and process state into `app/src-tauri/src/worker_command.rs`.
   - Move `WorkerInvocation`, `WorkerCommandSpec`, `WorkerProcessState`, `build_worker_command_spec`, `worker_invocation_uses_server_managed_llm`, `process_video_request_generates_insights`, `worker_command_log_detail`, `redact_worker_args_for_log`, `worker_exit_log_detail`, `js_runtime_diagnostics`, `executable_available_on_path`, `windows_subprocess_creation_flags`, `hide_child_console_window`, `spawn_worker_command`, `parse_worker_stdout`, `parse_worker_output_or_fallback`, `run_blocking_worker_command`, and platform-specific `terminate_process_tree`.
   - Preserve sanitized logging semantics and legacy local LLM env removals.
   - Move focused tests: process state tests, `worker_command_spec_uses_bundled_python_and_app_local_data`, `worker_command_spec_includes_server_managed_llm_checkout_env`, `worker_command_spec_skips_server_managed_llm_for_transcript_only_process`, `windows_worker_subprocesses_suppress_console_window`, `blocking_worker_command_runs_on_background_thread`, `parse_worker_stdout_uses_last_json_result_when_stdout_contains_logs`, `parse_worker_output_prefers_structured_stdout_even_when_exit_fails`, and `parse_worker_output_fallback_includes_task_artifact_fields`.
   - Run `cargo test --manifest-path app\src-tauri\Cargo.toml worker_command_spec parse_worker worker_process_state blocking_worker_command windows_worker_subprocesses`.
   - Then run `cargo test --manifest-path app\src-tauri\Cargo.toml`.

5. Extract ASR model state and model download commands into `app/src-tauri/src/asr_model.rs`.
   - Move `FirstRunStatusView`, `AsrModelDownloadResult`, `ModelDownloadProcessState`, `MODEL_VERSION_FILE_NAME`, `DEFAULT_ASR_MODEL`, `SENSEVOICE_VAD_MODEL`, `SUPPORTED_ASR_MODELS`, `asr_model_dir`, `asr_model_available`, `model_marker_exists`, `required_model_files_exist`, `build_model_download_command_spec`, `check_first_run`, `download_asr_model`, `download_asr_model_blocking`, and `cancel_asr_model_download`.
   - Keep root-level re-exports for `DEFAULT_ASR_MODEL` and `SUPPORTED_ASR_MODELS` until `settings.rs` imports them from `asr_model`.
   - Ensure `run()` still manages `Arc<ModelDownloadProcessState>` and registers `download_asr_model`, `cancel_asr_model_download`, and `check_first_run` with the same command names.
   - Move focused tests: ASR model availability tests, `release_supported_asr_models_only_exposes_bundled_sensevoice`, and `model_download_command_spec_uses_bundled_python_and_user_model_dir`.
   - Run `cargo test --manifest-path app\src-tauri\Cargo.toml asr_model model_download release_supported_asr_models`.
   - Then run `cargo test --manifest-path app\src-tauri\Cargo.toml`.

6. Extract process/retry video command orchestration and cache reuse into `app/src-tauri/src/video_processing.rs`.
   - Move `ProcessVideoRequest`, `RetryInsightsRequest`, `WorkerError`, `ProcessVideoResult`, `CancelProcessResult`, `process_video`, `process_video_blocking`, `cached_process_result_for_request`, `reusable_task_manifest_matches`, `cached_process_result_from_manifest`, `cached_existing_artifacts`, `read_cached_text_artifact`, `read_cached_insights_artifact`, `normalize_cache_source_url`, `retry_insights`, `retry_insights_blocking`, `cancel_process`, and `apply_configured_asr_model_to_request`.
   - Preserve command names, JSON field names, partial-completed handling, cache hit behavior, task manifest path validation, and server-managed LLM checkout injection.
   - Move focused tests: cached process result tests, `retry_insights_request_round_trips_preference_snapshot_payload`, and `apply_configured_asr_model_overrides_worker_request_model`.
   - Run `cargo test --manifest-path app\src-tauri\Cargo.toml cached_process_result retry_insights_request apply_configured_asr_model`.
   - Then run `cargo test --manifest-path app\src-tauri\Cargo.toml`.

7. Extract deep-link activation helpers into `app/src-tauri/src/deep_link.rs` if `lib.rs` remains large after the command extraction.
   - Move `DeepLinkActivationWindow`, its `WebviewWindow` implementation, and `activate_main_window_for_deep_link`.
   - Keep `tauri_plugin_single_instance::init` setup in `lib.rs`, calling the extracted helper.
   - Move focused test: `deep_link_activation_brings_existing_main_window_forward`.
   - Run `cargo test --manifest-path app\src-tauri\Cargo.toml deep_link_activation`.
   - Then run `cargo test --manifest-path app\src-tauri\Cargo.toml`.

8. Clean up `lib.rs` to be a Tauri app composition root.
   - Keep module declarations, root-level compatibility re-exports needed by existing modules, `greet` if it is still used by scaffold tests, plugin setup, state management, and `tauri::generate_handler!`.
   - Verify `invoke_handler` still registers every pre-refactor command name.
   - Keep the desktop-worker contract constants visible either via root re-exports or direct module paths, and update `desktop_worker_contract_matches_tauri_constants` only if constant locations changed.
   - Run `cargo test --manifest-path app\src-tauri\Cargo.toml desktop_worker_contract`.
   - Run `cargo test --manifest-path app\src-tauri\Cargo.toml`.

9. Final verification and documentation closeout.
   - Run `cargo test --manifest-path app\src-tauri\Cargo.toml`.
   - Run `npm --prefix app test` because the frontend invokes Tauri commands whose names must remain stable.
   - Run `python scripts/validate_agents_docs.py --level WARN`.
   - Run `git diff --check`.
   - Record the final `lib.rs` line count and summarize module sizes in this ExecPlan Progress.
   - If the refactor reveals remaining large-file debt in a different module, record it in `docs/exec-plans/tech-debt-tracker.md` instead of expanding this plan.

## Validation and Acceptance

- Rust:
  - `cargo test --manifest-path app\src-tauri\Cargo.toml`
  - Focused commands listed in each Plan of Work step must pass immediately after that extraction.
- Frontend command contract:
  - `npm --prefix app test`
- Documentation and diff hygiene:
  - `python scripts/validate_agents_docs.py --level WARN`
  - `git diff --check`
- Manual review checklist:
  - `app/src-tauri/src/lib.rs` no longer owns runtime, diagnostics, worker command, ASR download, and process/retry orchestration implementations.
  - `tauri::generate_handler!` still contains the same command names as before the refactor.
  - No product spec, server endpoint, worker schema, frontend UI, or task artifact contract changed.
  - No new log path exposes secrets, transcripts, full prompts, LLM keys, cookies, or volatile media URLs.
