# Disable Repository Root Dotenv for Desktop Worker Plan

## Goal

Stop applying `D:/Github/FrameQ/.env` to desktop worker runtime configuration after InsightFlow LLM configuration moved to the FrameQ server. Keep app-local settings for ASR/output paths, and keep server-managed LLM checkout environment variables for insight generation.

## Progress

- [x] Add regression coverage that repository-root `.env` is ignored.
- [x] Keep `FRAMEQ_USER_DATA_DIR/.env` for non-LLM desktop settings.
- [x] Filter legacy local `FRAMEQ_LLM_*` dotenv keys.
- [x] Remove legacy local LLM environment variables from Tauri worker subprocesses.
- [x] Update local templates and docs to describe server-managed LLM config.
- [x] Run final validation gates and record outcomes.

## Decisions

- The real local `D:/Github/FrameQ/.env` is not deleted automatically; it is simply no longer a desktop worker config source.
- Desktop user settings remain in app-local data `.env` for output directory, ASR model selection, and model download overrides.
- Legacy local LLM keys are ignored when read from dotenv files.
- Explicit server checkout keys (`FRAMEQ_LLM_SOURCE=server`, checkout URL, session token, and request ID) remain valid process environment inputs.

## Verification

- `uv run pytest worker\tests\test_config.py worker\tests\test_cli.py::test_retry_insights_once_ignores_project_dotenv_llm_config worker\tests\test_cli.py::test_retry_insights_once_reports_missing_markdown_when_process_env_client_exists worker\tests\test_cli.py::test_run_worker_once_uses_configured_asr_model_from_user_data_env worker\tests\test_llm.py::test_openai_compatible_client_reports_timeout_with_actionable_message` - passed, 8 tests.
- `uv run pytest worker\tests` - passed, 80 tests.
- `uv run ruff check worker` - passed.
- `cargo test --manifest-path app/src-tauri/Cargo.toml` - passed, 25 tests.
- `npm --prefix app test` - passed, 63 tests. First full run had one browser-test timeout; focused rerun and full rerun both passed.
- `npm --prefix app run build` - passed.
- `python scripts/validate_agents_docs.py --level WARN` - passed, 0 errors and 0 warnings.
- `git diff --check` - passed; only CRLF conversion warnings were reported.
