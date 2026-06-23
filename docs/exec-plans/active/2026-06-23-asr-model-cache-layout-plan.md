# ASR Model Cache Layout Plan

## Goal

Unify SenseVoice ASR model cache layout so ModelScope download and FunASR runtime both use `<FRAMEQ_MODEL_DIR>/models/iic/...`, then safely migrate or clean old duplicate top-level `iic/...` caches.

## Progress

- [x] Add worker regression coverage for canonical ModelScope download cache root.
- [x] Add worker regression coverage for legacy-only migration, duplicate cleanup, unknown-directory preservation, and stale temp cleanup.
- [x] Download ModelScope snapshots into the canonical `models/iic/...` subtree.
- [x] Normalize ASR model cache layout after model download.
- [x] Normalize ASR model cache layout before real ASR model load.
- [x] Keep Tauri model availability compatible with both canonical and legacy layouts.
- [x] Add stalled-download UI feedback so a frozen ModelScope transfer is visible instead of looking silently stuck.
- [x] Add a frontend regression that the ignored local bundled worker resource keeps the canonical cache layout when present.
- [x] Update product, architecture, security, and plan docs.
- [x] Run final validation gates and record outcomes.

## Decisions

- Canonical layout is `<FRAMEQ_MODEL_DIR>/models/iic/...` because FunASR uses `MODELSCOPE_CACHE=<FRAMEQ_MODEL_DIR>` and resolves snapshots below the `models/` child.
- `MODEL_VERSION.txt` remains at `<FRAMEQ_MODEL_DIR>/MODEL_VERSION.txt`.
- Legacy top-level `iic/SenseVoiceSmall` and `iic/speech_fsmn_vad_zh-cn-16k-common-pytorch` are migrated or deleted only after canonical cache is complete.
- Unknown legacy `iic/*` directories are preserved.
- `._____temp` directories are removed only when they contain no `model.pt`; cleanup failures are logged and do not block transcription.

## Verification

- `uv run pytest worker\tests\test_model_download.py worker\tests\test_asr.py` - passed, 20 tests.
- `uv run pytest worker\tests\test_model_download.py worker\tests\test_cli.py::test_run_worker_once_normalizes_legacy_asr_cache_before_model_load` - passed, 9 tests.
- `uv run ruff check worker` - passed.
- `uv run pytest worker\tests` - passed, 83 tests.
- `cargo test --manifest-path app/src-tauri/Cargo.toml` - passed, 27 tests.
- `npm --prefix app test` - passed, 63 tests.
- `npm --prefix app run build` - passed.
- `npm --prefix app test -- src/modelDownloadState.test.ts tests/tauri-window-config.test.ts` - passed, 17 tests.
- `npm --prefix app test` - passed, 66 tests.
- `npm --prefix app run build` - passed.
- `python scripts/validate_agents_docs.py --level WARN` - passed, 0 errors and 0 warnings.
- `git diff --check` - passed; only CRLF conversion warnings were reported.
