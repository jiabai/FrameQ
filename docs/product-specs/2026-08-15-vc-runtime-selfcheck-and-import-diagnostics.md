# Desktop VC++ Runtime Self-Check and Import-Stage Diagnostics Spec

- Date: 2026-08-15
- Status: Implemented (ExecPlan archived to `docs/exec-plans/completed/2026-08-15-vc-runtime-selfcheck-and-import-diagnostics-plan.md`); full Windows installer build and clean-Windows smoke test remain CI/release acceptance items
- Related product specs:
  - `docs/product-specs/2026-08-09-desktop-diagnostic-export.md`
  - `docs/product-specs/2026-07-27-selectable-asr-model-on-demand-download.md`
- Related design: ExecPlan stage will add `docs/design-docs/2026-08-15-vc-runtime-selfcheck-and-import-diagnostics.md`

## Background

A user's Windows PC failed ASR model download on every attempt (12+ tries over seven days, each
crashing in 5-8 seconds). The exported diagnostics ZIP contained only sanitized stderr placeholders
(`[traceback]`, `[text]`, `[exception]`) and **zero structured diagnostic events**, even though the
diagnostic callback is wired for every exception inside the download business logic. Cross-checking
the desktop log (`unstructured_failure` every time, no network-class keywords in the sanitized
stderr) localizes the failure to **worker process startup / module import stage**, before the
download try block runs.

Two environment-dependent root causes match the evidence, and the current diagnostics cannot
distinguish them:

1. **Missing VC++ runtime on a clean Windows machine.** The worker ships python-build-standalone
   (`scripts/build-installer.mjs`, `pythonStandaloneUrl`). `python.exe` itself carries
   `vcruntime140.dll`, but third-party C extensions (numpy, onnxruntime, pycryptodome via
   modelscope, etc.) link against system-level `msvcp140.dll` / `vcruntime140_1.dll`
   (Microsoft Visual C++ 2015-2022 Redistributable). When those are absent, extension imports fail
   with `ImportError: DLL load failed` during worker startup.
2. **Security software quarantine.** Antivirus (360 / Huorong / PC Manager) deleting or locking
   bundled `.pyd` / `.dll` / `.py` files produces `ModuleNotFoundError` / `ImportError` at the same
   stage.

This spec removes the most common root cause by shipping the runtime DLLs app-local, adds a
pre-flight runtime self-check with a user-visible actionable error, and makes the remaining
import-stage failures diagnosable through the existing structured diagnostic pipeline.

## Goals

- Windows installers bundle `msvcp140.dll` and `vcruntime140_1.dll` app-local under
  `resources/python/` so the worker no longer depends on the system VC++ Redistributable state.
- The desktop performs a pre-flight runtime self-check before spawning the ASR model-download
  worker; on missing runtime DLLs it returns the closed error code `ASR_MODEL_RUNTIME_MISSING` and
  the frontend shows an actionable message (install VC++ Redistributable / reinstall FrameQ), not
  the generic "model download failed".
- The Python worker emits a structured diagnostic event for exceptions outside the business try
  block (module import stage) in model-download mode, so the exported diagnostics ZIP can
  distinguish `ImportError: DLL load failed` from `ModuleNotFoundError`.
- The diagnostics contract (schema v1, sanitization, seven-day window, ZIP shape) is unchanged.
- All changes are local-first: no upload, no telemetry, no network probe, no new installer
  downloads, no UAC elevation.

## Non-goals

- Do not silently install the VC++ Redistributable; do not bundle `vc_redist.x64.exe`.
- Do not extend import-stage diagnostics to video processing, local-media, retry-insights, or
  source-identity worker modes in this iteration (the diagnostic event schema fixes
  `operation=download_asr_model`, and only the model-download lane creates a diagnostic sink).
- Do not change model source order, endpoint, revision, retry, resume, cancellation, cache
  promotion, progress, watchdog, terminal-result, or product error semantics.
- Do not add a general error-code-to-copy mapping beyond the single new `ASR_MODEL_RUNTIME_MISSING`
  scenario.
- Do not assign a release version in this spec.

## User Experience

### Normal machines (no change)

Bundled DLLs are present; self-check passes silently; download behavior is unchanged.

### Missing runtime DLLs

The ASR model-download attempt (manual download or first-task auto-download) shows a message such
as:

> FrameQ 缺少 Windows 运行组件（Microsoft Visual C++ 2015-2022 运行库）。请安装
> Microsoft Visual C++ Redistributable (x64) 后重试；若已安装，请检查安全软件是否拦截了
> FrameQ 的安装文件，必要时重新安装 FrameQ。

with the existing retry action. The message is offered in zh-CN, zh-TW, and en. Raw DLL paths are
not rendered.

### Import-stage crash (security-software quarantine etc.)

The download fails as today, but the exported diagnostics ZIP now contains a structured
`asr-model-download.log` record (`category=dependency` / `unexpected`,
`exception_type=ModuleNotFoundError` or `ImportError`), enabling remote diagnosis without manual
reproduction.

## Runtime Self-Check Contract

- Owner: Rust (`app/src-tauri`), evaluated in `download_asr_model` before spawning the worker.
- Platform: Windows only; macOS and Linux skip the check.
- Checks:
  1. `resources/python/msvcp140.dll` exists (app-local);
  2. `resources/python/vcruntime140_1.dll` exists (app-local);
  3. `%SystemRoot%\System32\msvcp140.dll` exists (system-level indicator, used only to refine the
     guidance copy).
- Result mapping:
  - Any app-local DLL missing → `ASR_MODEL_RUNTIME_MISSING` (copy: check security software
    quarantine / reinstall FrameQ).
  - App-local present but System32 missing → `ASR_MODEL_RUNTIME_MISSING` (copy: install Microsoft
    Visual C++ Redistributable 2015-2022 x64).
- The check returns the closed code; it never renders paths or versions in the UI.

## Packaging Contract (Windows)

- `scripts/build-installer.mjs` copies `msvcp140.dll`, `vcruntime140_1.dll` (and
  `vcruntime140.dll` if absent) from the build machine's VC++ 2015-2022 runtime into
  `resources/python/` for the `windows-x64` target.
- App-local deployment keeps original file names and does not fake versions (per Microsoft
  redistribution guidance).
- Installer verification asserts the three DLLs exist in the produced package.

## Import-Stage Diagnostics Contract (Python)

- Two-layer fallback:
  1. `frameq_worker/__main__.py` outer guard: imports only `sys` / `json` (hard-coded
     `DIAGNOSTIC_EVENT_PREFIX` constant kept in sync with `desktop_contract.py`), catches module
     import-stage exceptions, writes one structured diagnostic line to stderr, exits 1.
  2. `frameq_worker/cli.py` `main()` outer guard: catches exceptions outside the business call
     (current `run_worker_business` does not catch), reusing `render_diagnostic_event`.
- Emitted record: `version=1`, `operation=download_asr_model`, `phase=preparing`,
  `category=dependency|unexpected`, `code=dependency_unavailable|unexpected_failure`,
  `exception_type=<exception class name>` (existing allow-list regex).
- Never emit: exception message text, traceback frames, paths, URLs, hostnames, variable values.
- The Rust `read_stderr` diagnostic sink consumes the line as today; no Rust-side schema change.
- Only the model-download lane creates a sink, so unconditional emission from `__main__` is safe
  for other modes.

## Frontend Contract

- New closed error code `ASR_MODEL_RUNTIME_MISSING` mapped in the frontend notice layer
  (`modelDownloadTimeoutNotice`-style mapping) with zh-CN / zh-TW / en copy.
- No other UI changes.

## Verification

- Rust unit tests: self-check for present / app-local-missing / system-missing cases; error-code
  mapping; macOS skip.
- Python unit tests: `__main__` guard output shape with injected import failure; `cli.main` guard
  output shape; sanitization invariants (no message text, no paths).
- Frontend unit tests: error code to copy mapping.
- Packaging verification: Windows build output contains the three DLLs under
  `resources/python/`.
- Regression: worker, ASR, model-download, and diagnostics test suites stay green.

## Residual Risk

- Security-software quarantine still produces failures; the import-stage diagnostic covers remote
  identification, but the user must resolve the quarantine manually.
- A truly clean Windows VM without VC++ runtime cannot be fully automated in the current CI; the
  self-check unit tests and packaging assertions cover the contract, and a manual clean-machine
  smoke test is recommended before release.

## Open Questions

- DLL source for the build step: copy from the build machine's installed redist vs. a pinned
  download URL — **Decided: copy from the build machine's installed redist** (simple, no external
  dependency); a pinned URL remains an option if reproducibility demands it.
- Whether the import-stage guard should later extend to other worker modes via a schema
  `operation` extension — **Deferred** (requires a diagnostic schema version bump).
