# Windows Installer Preflight and Step Log Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision
> Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Give the Windows NSIS installer a free-space and writability preflight before the first
payload write, plus a bounded step log the user can attach to a report, without changing the install
path, the elevation model, or the updater flow.

**Architecture:** All behavior lives in `app/src-tauri/windows/installer-hooks.nsh`, which the Tauri
template includes before its own defines and inserts at the top of `Section Install` (`NSIS_HOOK_PREINSTALL`)
and at the end of that section (`NSIS_HOOK_POSTINSTALL`). The hook reads the compile-time
`${ESTIMATEDSIZE}` (KB) that Tauri already emits, measures free space with `kernel32::GetDiskFreeSpaceExW`
through `System::Call`, probes `$INSTDIR` with a create/write/delete of one file, appends plain-text
lines to `$TEMP\FrameQ-install.log`, and shows a Chinese message plus `Abort` only when an interactive
install cannot proceed. No Rust, TypeScript, worker, or server code changes.

**Tech Stack:** NSIS 3 (Tauri-bundled `makensis`), `LogicLib.nsh`, `FileFunc.nsh`, `System` plugin.

---

## Purpose / Big Picture

The installer writes roughly 824 MB in 16,810 files. When that fails, the user sees an English
`Error opening file for writing` dialog naming a file deep inside `resources/python`, with no way to
tell whether the cause was free space, permissions, or a scanner. The security-software advisory from
2026-10-20 covers the scanner case; the other two stay invisible until the write fails.

After this change the installer measures both before writing, tells the user in Chinese which one
failed, and leaves one log with the numbers and the steps that ran. Field reports become diagnosable
without reproducing the machine.

## Progress

- [x] 2026-11-09: Implement preflight, log helper, and the two hook macros in `installer-hooks.nsh`.
  Validation: `makensis` compiles the file with no warnings through a harness that mirrors the
  template's include order (hooks first, `ESTIMATEDSIZE` after).
- [x] 2026-11-09: Build and run a scratch NSIS harness that compiles the real hook file with the same
  defines Tauri emits, exercises the writable path and an unwritable path, and inspects the log.
  Validation: three silent runs (`writable`, `C:\Windows\System32\...`, `ESTIMATEDSIZE=999999999`)
  produced `writability result=ok`, `writability result=fail` and `freespace result=fail` with
  `required_mb=976818`, and none blocked.
- [x] 2026-11-09: Sync product spec index, tech-debt tracker, and `TASKS.md`. Validation: doc gate
  0 errors / 0 warnings, `git diff --check` clean.
- [x] 2026-11-09: Recompiled the real `app/src-tauri/target/release/nsis/x64/installer.nsi`
  (2026-11-05, v0.4.3 defines) with the edited hook: 209,808,676-byte installer in 9m40s, no
  warnings. The produced installer was deleted after the check; it is not published.

## Plan of Work

1. In `app/src-tauri/windows/installer-hooks.nsh`, add a `FrameQLog` macro that appends one
   `time=... step=... key=value` line to `$TEMP\FrameQ-install.log`, deleting the file first when it
   exceeds 64 KB. Logging must never abort the install: every write failure is ignored.
2. Add `FrameQCheckFreeSpace`: resolve the volume with `${GetRoot}` on `$INSTDIR`, call
   `kernel32::GetDiskFreeSpaceExW` with three `*l` pairs for the three `LARGE_INTEGER` outputs, convert
   the 64-bit result to MB, and compare against `${ESTIMATEDSIZE}` plus 256 MB. Anything other than a
   successful call is "unknown" and proceeds.
3. Add `FrameQCheckWritable`: `CreateDirectory $INSTDIR`, create `.frameq-install-probe`, write one
   byte, close, delete. Track whether the directory existed before, so a failed probe removes the
   directory it created only when it is empty.
4. Run both checks at the top of `NSIS_HOOK_PREINSTALL`, keeping the existing security advisory first
   and its register save/restore discipline intact. On an interactive definitive failure show one
   Chinese message naming the check, the numbers or path, and the log path, then `Abort`. Silent,
   passive (`/P`), and `/UPDATE` runs log and continue.
5. Log `copy start` at the end of the preinstall hook and `install done` at the start of
   `NSIS_HOOK_POSTINSTALL`.
6. Verify by compiling and running a scratch harness (see Validation), then confirm the real
   generated installer still compiles against the same hook file.

## Surprises & Discoveries

- `app/src-tauri/target/release/nsis/x64/installer.nsi` from the 2026-11-05 native build shows the
  exact insertion points: `NSIS_HOOK_PREINSTALL` at `Section Install` top (before the first
  `CreateDirectory`), `NSIS_HOOK_POSTINSTALL` at the end of the same section, so it also runs for
  silent installs. `ESTIMATEDSIZE "844310"` is already a compile-time define in KB.
- The template includes `installer-hooks.nsh` **before** it defines `ESTIMATEDSIZE`, `PRODUCTNAME` and
  the rest. A `!ifndef ESTIMATEDSIZE` fallback placed at file scope therefore pre-defines the symbol
  and makes the template's later `!define` a redefinition; the fallback has to sit inside the hook
  macro so it is evaluated at insertion time.
- NSIS `FileOpen ... a` does **not** position the write pointer at the end in this build: two
  appends overwrote the beginning of the file. `FileOpen ... a` followed by `FileSeek $handle 0 END`
  appends correctly, and that is what the log helper does.
- Macro parameters are textual, so a line like `!insertmacro FrameQLog "... free_mb=$R1"` is
  interpolated where the macro body runs. Taking the timestamp through `${GetTime}` in the same
  register range first turned `required_mb` into the current year; the line is now copied into `$R8`
  before `${GetTime}` runs.
- `${DriveSpace} "$path" "/D=F /S=M"` from `FileFunc.nsh` reports free megabytes directly and returns
  an empty string when the path does not exist, which is exactly the "unknown, continue" signal
  needed here. A hand-written `GetDiskFreeSpaceW` call through `System::Call` failed to return data
  in this environment and needed 64-bit splitting; the built-in macro is both simpler and verified
  against the operating system's own figure (95,716–95,719 MB versus 95,718 MB from PowerShell).
- `SetOutPath` on an unwritable directory only sets the error flag; it does not abort the install, so
  the preflight after it still runs and can report the failure.
- The repository's `INSTALLMODE` is `currentUser`, so `RequestExecutionLevel` is `user` and the
  default `$INSTDIR` is `$LOCALAPPDATA\FrameQ`. A per-machine install elevates and would pass the
  writability probe; the failure this preflight catches is a non-elevated install pointed at a
  protected directory.

## Decision Log

- Decision: free-space margin is 256 MB over `${ESTIMATEDSIZE}`.
  Rationale: the estimate covers the payload only; installer scratch and the WebView2 bootstrapper sit
  outside it. A larger margin would reject installs that would have succeeded.
- Decision: silent, passive, and `/UPDATE` runs never block.
  Rationale: an unattended upgrade that stops on a measurement is worse than one that fails later
  with the existing write error, and the update path has no UI to explain a stop. The log still
  records the numbers.
- Decision: an inconclusive probe is a pass.
  Rationale: this matches the advisory precedent — a failed detection must not block a legitimate
  install.
- Decision: log to `$TEMP\FrameQ-install.log` rather than the app data directory.
  Rationale: the installer may run before app data exists and may install into a directory the user
  later removes; `$TEMP` is writable in every mode and the path is short enough to show in a dialog.
  The file is outside the diagnostics bundle, so it adds no export surface.

## Outcomes & Retrospective

Delivered in `installer-hooks.nsh` only: the preflight runs before the first payload write, the log
records every step, and silent/upgrade installs never block. Verified locally with the Tauri-bundled
`makensis` and three silent harness runs plus a real-template compile; the interactive message and
`Abort` branch still need a human at the screen, and the installer that ships must still come from the
release workflow so it is signed.

## Validation

- Compile the hook file inside a scratch harness with the same defines Tauri emits
  (`PRODUCTNAME`, `ESTIMATEDSIZE`, `INSTALLMODE currentUser`, `RequestExecutionLevel user`), using the
  Tauri-bundled `makensis`. Result: compiled with no warnings.
- Run the harness silently against a writable `$INSTDIR` and assert the log records
  `step=preflight`, `step=freespace result=ok`, `step=writability result=ok`, `step=copy start`,
  `step=install done`, and that the logged free-space figure matches the value PowerShell reports for
  the same volume. Result: `free_mb=95717` / `required_mb=1080` against 95,718 MB from PowerShell.
- Run the harness silently against a path that cannot be created without elevation and assert the log
  records `step=writability result=fail` and no message box blocks the run. Result: `result=fail`,
  install continued, exit code 0.
- Low-space branch: compiled with `ESTIMATEDSIZE=999999999`; log recorded
  `freespace result=fail free_mb=95716 required_mb=976818` and the silent install continued.
- Recompile `app/src-tauri/target/release/nsis/x64/installer.nsi` (2026-11-05 defines, version 0.4.3)
  with the edited hook to prove the hook still integrates with the real template; the produced
  installer is not published. Result: 209,808,676 bytes, 9m40s, no warnings.
- Run `uv run python scripts/validate_agents_docs.py --level WARN` and `git diff --check`.

## Risks

A false negative in the free-space conversion would block installs that used to work; the harness
compares the measured value against the operating system's own report for the same volume. NSIS
cannot be exercised on macOS, but the hook file is Windows-only. The real installer build still has
to come from the release workflow, so this plan verifies compilation and runtime logic, not a
signed, installed artefact.
