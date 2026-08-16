# ASR Model Download Startup Recovery

## Goal

Make Windows ASR model preparation work with the app-local VC++ runtime bundled by the installer or staged by the dev launcher, and distinguish a download process that never started from a transfer that started and later failed.

## Root Cause

The installer intentionally copies `msvcp140.dll`, `vcruntime140_1.dll`, and `vcruntime140.dll` beside bundled Python. The Rust pre-flight nevertheless required `System32\msvcp140.dll` even when the app-local DLLs were complete. On a clean Windows machine this returned `RuntimeUnavailable` before the worker process was spawned, leaving the UI at 0% with a generic download-failed message.

The Windows `tauri:dev:fresh-worker` launcher refreshed only the worker source mirror. Its local Python runtime could therefore contain `vcruntime140.dll` and nested package copies of `msvcp140.dll`, but still lack the app-local root DLL expected by the same pre-flight.

## Scope

- Treat a complete app-local VC++ runtime bundle as sufficient for worker startup.
- Have the Windows dev launcher stage missing VC++ DLLs beside its local Python runtime before starting Tauri.
- Keep the pre-flight failure closed when an app-local runtime DLL is missing.
- Add a local `start_failed` model-download phase for the runtime-missing path.
- Show localized copy that explicitly says the model download process could not start and recommends reinstalling the app when packaged files are missing or quarantined.
- Keep progress events responsible for presentation only; the matching Tauri command result and refreshed model status remain authoritative for whether preparation succeeded.
- When a submitted task prepares a missing model successfully, close the model guide before continuing into task processing.
- Keep the guide open for manual downloads, startup/transfer failures, and cancellation so completion details, retry, diagnostics, and dismissal remain available.

No model URL, download protocol, worker progress event, model cache location, or installer payload policy changes are included.

## Acceptance Criteria

1. The Rust pre-flight returns `Ok` when required app-local DLLs exist even if the synthetic/system VC++ path is absent.
2. The Windows dev launcher stages missing VC++ DLLs beside its local Python runtime before Tauri starts.
3. A runtime-missing rejection produces `start_failed`, not ordinary `failed`, in the frontend model-download state.
4. The progress copy says the download process could not start in all supported locales.
5. Ordinary timeout and transfer failures retain their existing failed semantics.
6. App and focused Rust tests, lint, build, docs validation, and whitespace checks pass.
7. A `completed` progress event arriving before the matching Tauri command resolves does not turn a successful download into a false result.
8. Task-triggered successful preparation closes the model guide before processing continues.
9. Manual successful preparation keeps the model guide open.
10. Startup failure, transfer failure, and cancellation keep the model guide open and do not start task processing.

## Modal Boundary

The model guide remains a real modal while it is present. Its focus trap and background `inert` behavior must not be weakened to make toolbar controls clickable through the backdrop. The task-triggered lifecycle owns closing the guide after verified success; terminal failures remain explicitly dismissible from inside the guide.
