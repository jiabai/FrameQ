# ASR Model Download Startup Recovery Plan

**Goal:** Fix the Windows app-local VC++ pre-flight false negative and make the zero-percent startup failure truthful in the UI.

**Root cause:** `check_vc_runtime_at` rejected a complete app-local runtime bundle when the system `System32` copy was absent, even though the installer contract explicitly bundles those DLLs beside Python.

### Task 1: Reproduce with narrow regression tests

- [x] Add the Rust test for app-local runtime sufficiency without system redist.
- [x] Add frontend assertions for `start_failed` and localized startup-failure copy.
- [x] Observe the expected RED result before the fix.

### Task 2: Fix runtime pre-flight and UI semantics

- [x] Make app-local VC++ DLL presence the sole packaged-runtime pre-flight requirement.
- [x] Make `tauri:dev:fresh-worker` stage missing Windows VC++ DLLs beside the dev Python runtime.
- [x] Add the local `start_failed` phase and localized fallback copy.
- [x] Preserve ordinary timeout/transfer failures as `failed`.
- [x] Keep retry behavior available after startup failure.

### Task 3: Verification

- [x] Run focused frontend and Rust tests.
- [x] Run full app tests, lint, build, docs ERROR validation, and `git diff --check`.
- [x] Confirm no worker Python, model protocol, or persistence behavior changed.

### Task 4: Close the task-triggered model guide without weakening modal semantics

- [x] Add a regression test where the `completed` progress event arrives before the Tauri command result and the download still resolves successfully after status verification.
- [x] Add a regression test where task-triggered preparation closes the guide after verified success.
- [x] Preserve the open guide for manual download success, failure, startup failure, and cancellation.
- [x] Keep `AnimatedSheet` focus trapping and background `inert` behavior unchanged.
- [x] Run focused and full frontend verification plus lint, build, docs validation, and whitespace checks.

## Progress

- 2026-08-16: User-reported screenshot reproduced semantically: 0% progress plus runtime guidance while no download process could start.
- 2026-08-16: Root cause confirmed by the failing Rust pre-flight test and frontend state test.
- 2026-08-16: Implemented app-local-only runtime validation and explicit `start_failed` UI semantics.
- 2026-08-16: Reproduced the remaining dev-mode failure: `resources/python/msvcp140.dll` was absent while only a nested `sklearn/.libs` copy existed; the dev launcher now stages the same app-local DLL set as the installer.
- 2026-08-16: Traced the reported unresponsive new-task control to a task-triggered model guide that remained modal after successful preparation while processing continued behind it. Review also found a race where a terminal progress event could mark the operation finished before the matching Tauri command result was verified.
- 2026-08-16: Implemented the approved lifecycle repair. A completed progress event now keeps the matching command eligible for cache verification, cancelled remains terminal, and successful task-triggered preparation closes the guide before processing continues. Manual success and all non-success terminal paths keep the guide open.
- 2026-08-16: Independent code review found no Critical or Important issues. Its single Minor suggestion was addressed by directly asserting that failure, `start_failed`, and cancellation keep the model guide open.

## Decision Log

- Do not require users to install system VC++ when the installer has successfully bundled app-local runtime DLLs.
- Keep dev and packaged runtime layout equivalent by staging missing dev DLLs from the build machine's System32 only before launching Tauri.
- Keep missing app-local DLLs as a closed startup failure; this points to packaging or security-software quarantine rather than a network transfer problem.
- Do not expose raw Rust/OS error text in the UI.
- Do not weaken global modal focus isolation or allow toolbar interaction through a modal backdrop.
- Treat progress events as presentation updates and the matching command result plus refreshed cache status as the authoritative preparation outcome.
- Auto-close the guide only for successful preparation initiated by task submission; preserve manual and failure review flows.

## Verification Record

- Focused frontend tests: pass (7 files, 84 tests), including ASR download lifecycle, model guide, modal focus, AnimatedSheet, workflow controller, download state, and progress copy.
- Full frontend tests: two fresh runs each had 748/749 passing; the only failure was the pre-existing/flaky Motion browser smoke `freezes confirmed output language across locale changes...`, waiting for `save_default_generation_preferences`. The same test passes when run alone (1/1).
- Focused Rust VC runtime tests: pass (4 tests); ASR-related Rust tests also pass (16 tests).
- Rust `cargo check`: pass; `cargo fmt -- --check`: pass.
- Installer runtime tests: pass (12 tests), including app-local VC++ DLL bundling and presence assertions.
- Dev launcher tests: pass (3 tests), including Windows VC++ staging; the real `npm.cmd --prefix app run tauri:dev:fresh-worker` run logged staging of `msvcp140.dll` and `vcruntime140_1.dll` before Tauri launch.
- App lint: pass; app production build: pass; docs ERROR validation: 0 errors / 1 existing warning; `git diff --check`: pass.
- A separate Rust full-suite run reached worker runner/watchdog stress fixtures with multiple timeout/termination failures and was stopped after hanging. This is outside the changed VC++ pre-flight path; it is not recorded as a passing full Rust-suite result.

## Residual Risk

- A previously installed package built before the app-local runtime fix may still lack DLLs; it must be rebuilt/reinstalled before retesting.
- A fresh packaged Windows smoke remains necessary to verify the actual installer resource tree and Python extension loading. Existing installations built before this fix must be rebuilt/reinstalled. The local bundled-Python import smoke now passes after dev staging.
