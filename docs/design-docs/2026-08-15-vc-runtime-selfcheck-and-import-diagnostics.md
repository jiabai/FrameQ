# VC++ Runtime Self-Check and Import-Stage Diagnostics Design

- Date: 2026-08-15
- Status: Implemented with the active ExecPlan
- Product spec: `docs/product-specs/2026-08-15-vc-runtime-selfcheck-and-import-diagnostics.md`
- ExecPlan: `docs/exec-plans/completed/2026-08-15-vc-runtime-selfcheck-and-import-diagnostics-plan.md`

## Background

A user's Windows PC failed ASR model download on every attempt (12+ tries, 5-8 s each). The
exported diagnostics ZIP contained zero structured diagnostic events and only sanitized stderr
placeholders, localizing the crash to the worker's module-import stage (before the download try
block). Two environment-dependent causes matched: missing VC++ 2015-2022 runtime
(`ImportError: DLL load failed` from C extensions such as numpy/onnxruntime/pycryptodome) and
security-software quarantine (`ModuleNotFoundError`). The previous diagnostics could not
distinguish them because import-stage exceptions bypassed the diagnostic callback entirely.

## Decisions

1. **App-local VC++ runtime DLLs.** The Windows installer copies `msvcp140.dll`,
   `vcruntime140_1.dll`, and (when absent) `vcruntime140.dll` into `resources/python/` from the
   build machine's redist. Microsoft permits app-local deployment; no UAC, no redist install, no
   installer-size jump beyond ~1 MB. The standalone Python already ships `vcruntime140.dll`, so
   that file is only copied when missing.
2. **Rust pre-flight self-check.** `download_asr_model` checks the DLLs before spawning the
   worker and returns the closed error `ASR_MODEL_RUNTIME_MISSING` (frontend maps it to localized
   actionable copy). A `SystemMissing` state (app-local complete, System32 absent) exists only to
   refine guidance; the error code is a single closed value.
3. **Import-stage diagnostic fallback.** `frameq_worker/__main__.py` and `cli.py::main` gained
   outer guards. The `__main__` guard uses a stdlib-only emitter module
   (`import_stage_diagnostics.py`) with a hard-coded prefix so it works even when the package
   itself cannot import; it emits one closed structured diagnostic event
   (`operation=download_asr_model`, `phase=preparing`, `category=dependency`,
   `exception_type=<class name>` only) and re-raises. `cli.py::main` reuses
   `classify_model_download_exception` for exceptions outside business try blocks
   (SystemExit/KeyboardInterrupt pass through untouched).
4. **Safety unchanged.** The guard never emits exception messages, tracebacks, paths, URLs, or
   variable values; the Rust stderr reader records structured events only for the
   `DownloadAsrModel` lane, so unconditional emission from `__main__` is safe for other lanes.

## Contracts

### Installer (scripts/build-installer.mjs)

- `bundleWindowsVcRuntimeDlls(pythonRoot, systemRoot = defaultWindowsSystemRoot())` copies the
  three DLLs from `System32` into `resources/python/`; fails loudly with an actionable message
  when the build machine lacks the redist.
- `assertBundledWindowsVcRuntimeDlls(pythonRoot)` guards packaged-artifact presence.
- Called for `windows-x64` after runtime pruning and before the Python import smoke test.
- Exported constants: `WINDOWS_VC_RUNTIME_DLLS`.

### Rust (app/src-tauri/src/vc_runtime.rs)

- `check_vc_runtime(paths) -> VcRuntimeStatus` (Windows only; other platforms return `Ok`).
- `check_vc_runtime_at(python_root, system_root) -> VcRuntimeStatus` is the path-injected core:
  any missing app-local DLL → `AppLocalMissing`; else missing System32 `msvcp140.dll` →
  `SystemMissing`; else `Ok`.
- `download_asr_model_blocking` fails early with `"ASR_MODEL_RUNTIME_MISSING"` when the status is
  not `Ok`.

### Python (worker)

- `import_stage_diagnostics.py`: stdlib-only (`json`, `sys`), hard-coded
  `DIAGNOSTIC_EVENT_PREFIX = "FRAMEQ_DIAGNOSTIC "` kept in sync with `desktop_contract.py`;
  `emit_import_stage_diagnostic(exception)` prints one validated-shape event and never leaks
  message text.
- `__main__.py`: guard around `from frameq_worker.cli import main`; emits then re-raises.
- `cli.py::main`: guard around `_main_inner`; emits `classify_model_download_exception(exc,
  "preparing")` then re-raises.

### Frontend (app)

- `asrModelResources.ts` `notice.runtimeMissing` in zh-CN / zh-TW / en-US (merged guidance:
  install VC++ 2015-2022 redist, or check security software and reinstall).
- `useAsrModelDownload.ts` maps `ASR_MODEL_RUNTIME_MISSING` in `modelDownloadTimeoutNotice`.

## Verification

- Installer: focused 12/12; full scripts suite 34/34.
- Rust: vc_runtime 4/4; asr_model 16/16; full lib 320/320 (watchdog suites included).
- Python: new import-stage diagnostics 5/5 (incl. subprocess import-failure black box);
  full worker suite 790/790; Ruff clean.
- Frontend: useAsrModelDownload 17/17; full suite 728 passed (browser CDP smoke file remains an
  environment residual: Chrome profile EBUSY); lint + i18n literal checks + production build
  passed.
- Governance: `validate_agents_docs.py --level ERROR` 0 errors (1 pre-existing AGENTS.md line
  warning); `git diff --check` clean; canonical worker byte-identical to packaged resources
  (excluding `__pycache__`).
- Residual: full Windows installer build with real DLL sources and a clean-Windows (no VC++
  runtime) smoke test remain CI/manual acceptance items; AGENTS.md entry-map update goes through
  the Hermes proposal flow.
