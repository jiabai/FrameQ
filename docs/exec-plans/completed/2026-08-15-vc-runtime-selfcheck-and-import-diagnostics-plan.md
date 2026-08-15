# Desktop VC++ Runtime Self-Check and Import-Stage Diagnostics Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision
> Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Remove the most common clean-Windows cause of ASR model-download failure (missing
VC++ 2015-2022 runtime for bundled C extensions), surface a clear user-visible error when runtime
DLLs are missing, and make worker import-stage crashes remotely diagnosable through the existing
structured diagnostic pipeline.

**Architecture:** The Windows installer bundles `msvcp140.dll` / `vcruntime140_1.dll` /
`vcruntime140.dll` app-local under `resources/python/` (Microsoft app-local deployment, no UAC, no
redist install). Rust performs a pre-flight self-check in `download_asr_model` before spawning the
worker and returns the closed error `ASR_MODEL_RUNTIME_MISSING` with localized actionable copy.
Python adds two outer guards (`frameq_worker/__main__.py` with only stdlib imports and hard-coded
diagnostic prefix; `cli.py::main` reusing `render_diagnostic_event`) so module-import-stage
exceptions emit one closed structured diagnostic event consumed by the existing Rust stderr
diagnostic sink — no schema, sanitization, or ZIP changes.

**Tech Stack:** Python 3/pytest/Ruff, Rust/Tauri 2, TypeScript/React/Vitest/i18next, Node
build-installer script, app-local packaging.

---

## Purpose / Big Picture

A user's Windows PC failed ASR model download on every attempt (12+ tries, each crashing 5-8
seconds in). Exported diagnostics showed zero structured events and only sanitized traceback
placeholders, because the crash happened at module-import stage, outside the download try block.
The two environment-dependent suspects are missing VC++ 2015-2022 runtime
(`ImportError: DLL load failed` from numpy/onnxruntime/pycryptodome) and security-software
quarantine (`ModuleNotFoundError`). This plan removes the first root cause, gives users an
actionable message when runtime DLLs are missing, and makes the second remotely diagnosable.

## Progress

- [x] 2026-08-15: Field diagnosis completed from exported diagnostics ZIP (three log files
  cross-checked): all attempts `unstructured_failure` in 5-8 s, zero structured diagnostic
  events, no network-class keywords in sanitized stderr. Root cause localized to worker
  import-stage crash. Validation: log evidence + source inspection of
  `worker/frameq_worker/cli.py`, `model_download.py`, `diagnostic_events.py`,
  `app/src-tauri/src/diagnostics/*`, `worker_runtime/*`, and `scripts/build-installer.mjs`.
- [x] 2026-08-15: Product spec approved by user; spec written to
  `docs/product-specs/2026-08-15-vc-runtime-selfcheck-and-import-diagnostics.md` and indexed in
  `docs/product-specs/index.md`. Validation: `git diff --check`; spec covers goals, non-goals,
  UX, contracts, verification, and open questions.
- [x] 2026-08-15: Task 1 completed. `scripts/build-installer.mjs` now bundles `msvcp140.dll`, `vcruntime140_1.dll`, and (when absent) `vcruntime140.dll` app-local into `resources/python/` for `windows-x64` before the Python runtime smoke test, failing loudly when the build machine lacks the VC++ 2015-2022 runtime; `assertBundledWindowsVcRuntimeDlls` guards the packaged artifact. Validation: build-installer focused tests 12/12 passed; full scripts suite 34/34 passed; `git diff --check` passed.
- [x] 2026-08-15: Task 2 completed. New `app/src-tauri/src/vc_runtime.rs` pre-flight self-check (Windows-only, path-injected core) returns `Ok` / `AppLocalMissing` / `SystemMissing`; `download_asr_model` fails early with the closed error `ASR_MODEL_RUNTIME_MISSING` when the runtime DLLs are absent. Validation: vc_runtime focused tests 4/4 passed (plus non-Windows skip test); asr_model suite 16/16 passed; `cargo check` passed.
- [x] 2026-08-15: Task 3 completed. New stdlib-only `worker/frameq_worker/import_stage_diagnostics.py` emitter; `frameq_worker/__main__.py` guard emits one closed structured diagnostic event (operation=download_asr_model, phase=preparing, category=dependency, exception_type only) when importing `frameq_worker.cli` fails; `cli.py::main` gained an outer guard reusing `classify_model_download_exception` and re-raising (SystemExit/KeyboardInterrupt pass through untouched). Validation: new test_import_stage_diagnostics.py 5/5 passed (including a subprocess black-box import-failure test and no-message-leak invariants); test_cli 30/30, diagnostic/model-download/facade/import-boundary 114/114 passed; Ruff passed.
- [x] 2026-08-15: Task 4 completed. `asrModelResources.ts` gained `notice.runtimeMissing` in zh-CN / zh-TW / en-US (merged guidance: install VC++ 2015-2022 redist, or check security-software quarantine and reinstall); `modelDownloadTimeoutNotice` maps `ASR_MODEL_RUNTIME_MISSING` to the new copy. Validation: useAsrModelDownload focused tests 17/17 passed (including two new runtime-missing table cases); `tsc --noEmit` + i18n literal checks passed; production build passed.
- [x] 2026-08-15: Task 5 completed. Full gates: worker suite 790/790; Rust lib 320/320 (watchdog suites included this run); frontend 728 passed / 14 skipped (browser CDP smoke file `tests/app-input.browser.test.ts` remains an environment residual — Chrome profile EBUSY, unrelated to this change); `tsc --noEmit`, i18n literal checks, and production build passed; `validate_agents_docs.py --level ERROR` 0 errors (1 pre-existing AGENTS.md line warning, Hermes-managed); `git diff --check` clean; canonical worker refreshed into `app/src-tauri/resources/worker/frameq_worker` and byte comparison passed (excluding `__pycache__`). Full Windows installer build with real DLL sources and a clean-Windows smoke test remain CI/manual acceptance items.
- [x] 2026-08-15: Task 6 completed. Design document written to `docs/design-docs/2026-08-15-vc-runtime-selfcheck-and-import-diagnostics.md`; spec status advanced to Implemented; this plan archived to `docs/exec-plans/completed/` with both indexes updated; AGENTS.md entry-map update deferred to the Hermes proposal flow (protected file). Validation: `validate_agents_docs.py --level WARN` re-run; `git diff --check` clean.

## Task 1: Windows packaging bundles VC++ runtime DLLs app-local

**Goal:** `scripts/build-installer.mjs` copies `msvcp140.dll`, `vcruntime140_1.dll` (and
`vcruntime140.dll` if absent) from the build machine's VC++ 2015-2022 runtime into
`resources/python/` for `windows-x64`, and the packaging gate asserts their presence.

**Implementation notes:**

- Locate source DLLs from the build machine's VC++ redist install (search
  `%SystemRoot%\System32` and the VC redist directory; `msvcp140.dll` / `vcruntime140_1.dll` /
  `vcruntime140.dll` must be found or the packaging step fails with a clear message).
- Copy into `resources/python/` after the python standalone archive is installed into the build
  tree, before installer assembly.
- App-local deployment keeps original file names; no version spoofing.
- Add a packaging assertion (installer test or post-build check) that the three DLLs exist in the
  produced `resources/python/` directory.

**Validation:** scripts unit/integration tests pass (installer suite); run the Windows packaging
step and assert DLL presence; `git diff --check`.

## Task 2: Rust pre-flight runtime self-check and error code

**Goal:** `download_asr_model` checks runtime DLLs before spawning the worker on Windows; missing
DLLs return the closed error `ASR_MODEL_RUNTIME_MISSING` without spawning the worker.

**Implementation notes:**

- Add a Windows-only check function (new small module or `asr_model.rs` helper):
  - `resources/python/msvcp140.dll` exists (app-local);
  - `resources/python/vcruntime140_1.dll` exists (app-local);
  - `%SystemRoot%\System32\msvcp140.dll` exists (system-level, refines guidance only).
- Non-Windows targets skip the check (no behavior change on macOS).
- Return value is a closed outcome used by `download_asr_model_blocking` to fail early with
  `ASR_MODEL_RUNTIME_MISSING`; the Rust error string is the fixed code only (existing
  map-to-safe-message pattern).
- The check must not render paths or versions to the UI.

**Validation:** Rust unit tests for present / app-local-missing / system-missing / macOS-skip
cases; existing `asr_model` tests stay green; `cargo check`, `cargo fmt --check`,
`git diff --check`.

## Task 3: Python import-stage diagnostic fallback

**Goal:** module-import-stage crashes in model-download mode emit one closed structured
diagnostic event so the diagnostics ZIP can distinguish `ImportError: DLL load failed` from
`ModuleNotFoundError`.

**Implementation notes:**

- `frameq_worker/__main__.py` outer guard: wrap `from frameq_worker.cli import main` in
  try/except; on failure emit a single diagnostic line to stderr and exit 1. Only `sys`/`json`
  imports; hard-code the `DIAGNOSTIC_EVENT_PREFIX` constant with a sync comment referencing
  `desktop_contract.py`.
- `frameq_worker/cli.py::main` outer guard: wrap the dispatch body (argparse onward) so any
  exception outside the business try blocks emits one diagnostic event via
  `render_diagnostic_event` and exits 1.
- Emitted record: `version=1`, `operation=download_asr_model`, `phase=preparing`,
  `category=dependency|unexpected`, `code=dependency_unavailable|unexpected_failure`,
  `exception_type=<exception class name>` only.
- Never emit exception message text, traceback frames, paths, URLs, hostnames, or variable
  values. The existing `diagnostic_events.validate_diagnostic_event` schema is the contract;
  unit tests must assert the emitted line validates and contains no forbidden content.
- Safe by construction for other worker modes: only the `DownloadAsrModel` lane creates a Rust
  diagnostic sink, so unconditional emission from `__main__` cannot leak into other operations.

**Validation:** focused Python tests (injected import failure for `__main__` guard; injected
exception for `cli.main` guard; sanitization invariants); Ruff; existing worker/asr/download
tests stay green; `git diff --check`.

## Task 4: Frontend localized copy and error-code mapping

**Goal:** `ASR_MODEL_RUNTIME_MISSING` maps to actionable zh-CN / zh-TW / en copy in the model
download notice layer.

**Implementation notes:**

- Add copy to `app/src/i18n/asrModelResources.ts` (three locales) covering both guidance
  branches: install Microsoft Visual C++ Redistributable 2015-2022 x64, and check security
  software quarantine / reinstall FrameQ.
- Extend the existing notice mapping (alongside `modelDownloadTimeoutNotice`) so the new code
  renders the runtime message instead of the generic download-failed message.
- No other UI changes; no raw paths rendered.

**Validation:** focused frontend tests for the mapping (zh-CN/zh-TW/en); `npm --prefix app test`;
`npm --prefix app run lint`; production build; `git diff --check`.

## Task 5: Full verification and packaging gates

**Goal:** complete repo gates and packaged-artifact verification.

**Implementation notes:**

- Run focused suites (worker Python, Rust, frontend) plus full suites where feasible per
  `docs/EXECUTION_GATES.md`.
- Refresh the canonical worker into the packaged resource and re-run the recursive byte
  comparison (remove generated `__pycache__` first, per prior plan practice).
- Build the Windows package and verify: three runtime DLLs present under `resources/python/`;
  `app.exe` starts; ASR model status surface responds.
- Run `python scripts/validate_agents_docs.py --level ERROR` and `--level WARN`.
- Record Passed / Not run / Residual risk, including the known Windows watchdog/child-process
  fixture contention residual and that a fully clean Windows VM without VC++ runtime remains a
  manual acceptance item.

**Validation:** all gates recorded in Progress with evidence.

## Task 6: Documentation and governance sync

**Goal:** durable docs stay consistent with the implemented behavior.

**Implementation notes:**

- Write `docs/design-docs/2026-08-15-vc-runtime-selfcheck-and-import-diagnostics.md` capturing
  the self-check contract, DLL bundling decision, guard structure, and error-code chain.
- Update spec status to Implemented and remove/keep open questions as resolved.
- Update `docs/exec-plans/active/index.md`; move this plan to `docs/exec-plans/completed/` on
  completion.
- `AGENTS.md` entry-map update is a Hermes-managed protected file change: create the proposal via
  the post-turn evolution flow rather than editing directly.
- Update the diagnostic-export spec cross-references if behavior descriptions are affected.

**Validation:** `python scripts/validate_agents_docs.py --level WARN`; `git diff --check`.

---

## Surprises & Discoveries

- Evidence: `scripts/build-installer.mjs` bundles python-build-standalone
  (`pythonStandaloneUrl`); that distribution carries `vcruntime140.dll` for `python.exe` itself
  but not the system-level `msvcp140.dll` / `vcruntime140_1.dll` required by C extensions such as
  numpy, onnxruntime, and pycryptodome. This explains why the friend's machine produced a Python
  traceback (python started) yet crashed at extension import.
- Evidence: `frameq_worker/cli.py` imports the entire worker module tree at top level
  (`from frameq_worker import worker_service`), so any import-stage failure crashes before the
  download try block and before `print_diagnostic_event` can run — the exact hole this plan
  closes.
- Evidence: the Rust stderr reader creates the ASR diagnostic sink only for
  `WorkerOperation::DownloadAsrModel`; unconditional fallback emission from `__main__.py` is
  therefore safe for other worker modes without schema changes.
- Evidence: `diagnostic_events.validate_diagnostic_event` pins `operation=download_asr_model`,
  so the import-stage fallback must reuse that operation value; extending other operations
  requires a schema version bump and is out of scope.

## Decision Log

- Decision: Bundle the VC++ runtime DLLs app-local in `resources/python/` instead of silently
  installing the redist or prompting the user. Rationale: no UAC, no network dependency, no
  installer size jump beyond ~1 MB, and Microsoft permits app-local deployment. Source: build
  machine's installed redist; a pinned download URL remains an option if reproducibility demands
  it. Date/Author: 2026-08-15, User + FrameQ.
- Decision: Rust performs the pre-flight self-check (not Python). Rationale: it runs before
  spawning the worker, so it also covers missing/corrupted Python environments, and the error
  path reuses the existing safe closed-code message chain. Date/Author: 2026-08-15, User + FrameQ.
- Decision: Import-stage diagnostics are limited to model-download mode with
  `operation=download_asr_model`. Rationale: the schema and Rust sink are ASR-download-specific;
  extending other modes needs a schema version bump and is deferred. Date/Author: 2026-08-15,
  User + FrameQ.
- Decision: The import-stage guard emits only the exception class name, never the message text or
  traceback. Rationale: preserves the v0.3.2 sanitization boundary while making the failure
  category remotely identifiable. Date/Author: 2026-08-15, User + FrameQ.
- Decision: No release version is assigned in this plan; release packaging policy is decided
  separately. Date/Author: 2026-08-15, User + FrameQ.

## Verification Gates

- Hard gates per `docs/EXECUTION_GATES.md`: affected paths inspected; docs validation
  (`--level ERROR`); touched ExecPlan Progress/Decision Log updated; durable docs synced; worker
  changes covered by focused Python tests; app changes covered by lint/build/test; download/ASR
  changes record failure paths and recoverable behavior.
- Soft gates: full regression suites; packaged-artifact verification; manual clean-Windows smoke
  test (recorded as residual if not run).

## Outcomes & Retrospective

Completed on 2026-08-15. The three-part change (app-local VC++ DLL bundling, Rust pre-flight
self-check with `ASR_MODEL_RUNTIME_MISSING`, import-stage diagnostic fallback) is implemented and
green across installer scripts, Rust, Python worker, and frontend suites. The field case that
motivated the work is now diagnosable in two ways: clean machines no longer need the system VC++
redist, and any remaining import-stage crash appears in the diagnostics ZIP as a structured event
with the exception class name. Residual items are recorded in Task 5: full Windows installer
build verification and a clean-Windows smoke test belong to CI/release acceptance, and the
AGENTS.md entry map needs the Hermes proposal flow.
