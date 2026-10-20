# Windows Installer Security Software Warning

## Intent

When a local security product is running, the Windows installer tells the user before it writes any file. Field report on 2026-10-20: a first install stopped at `resources/python/Lib/site-packages/sklearn/.libs/msvcp140.dll` with `Error opening file for writing`, and the reporter confirmed 360 Total Security as the cause. The payload writes 36,588 files, so the realtime scanner holds the install open for minutes and the first refused write ends the run with an English dialog naming a file the user has never seen.

The installer now detects 360 Total Security, 火绒, and Tencent PC Manager by process name, then shows one Chinese message before the copy step: which product was found, that it may block the write, that the install directory should be added to its trust list, that `忽略` must not be used, and that the default install location is preferable to Program Files.

## Boundaries

Detection is advisory. It never blocks the install, never changes the install path, never reorders or delays file writes, and never attempts to evade the scanner. A failed detection is treated as "no security software found" so the install continues.

The check covers Windows NSIS only. The macOS DMG is unaffected. It is skipped for silent installs (`/S`) and for the updater's passive mode (`/P`) and `/UPDATE`, because a message box would stall an unattended upgrade.

Paths, defaults, and the NSIS template stay untouched. The install location is still chosen by the user in the directory page, and the default remains the per-user application directory.

## Acceptance

The message appears before the first file is written and only when a listed process is running; it names the detected product and the resolved `$INSTDIR`. No message appears on a machine without those processes, in silent mode, or during a passive update, and the install completes in each of those cases. The installer builds locally with the hook in place. A machine with 360 running is the only environment that exercises the message branch end to end.
