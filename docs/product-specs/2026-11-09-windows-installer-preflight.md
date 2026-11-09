# Windows Installer Preflight and Step Log

## Intent

The NSIS installer writes a large payload — `ESTIMATEDSIZE` is 844,310 KB in the current bundle — into a directory the user chooses, and today the first sign of a bad choice is an English `Error opening file for writing` dialog naming an arbitrary deep `.dll`. The security-software warning added on 2026-10-20 covers the most common cause, but two other causes still fail the same way: not enough free space on the target volume, and a target directory the non-elevated installer cannot write to (for example `Program Files` after switching the install mode to per-user).

This change adds a preflight before any file is written: it measures free space on the target volume, probes that `$INSTDIR` is writable, and records both results plus the surrounding install steps in one plain-text log that a user can attach to a report.

## Behavior

The preflight runs inside `NSIS_HOOK_PREINSTALL`, which the Tauri template inserts at the top of `Section Install` after `SetOutPath $INSTDIR` and before the first `CreateDirectory` or `File`. Two checks run there:

- Free space: the volume holding `$INSTDIR` must report at least `ESTIMATEDSIZE` plus a 256 MB margin. The margin covers installer scratch space and the WebView2 bootstrapper, neither of which is part of the estimated payload.
- Writability: the installer creates `$INSTDIR` if needed, creates and deletes a probe file inside it, and treats any failure as not writable. A directory the installer created only for the probe is removed again when the probe fails and the directory is empty.

In interactive mode a definitive failure shows one Chinese message naming the failed check, the measured numbers or the path, and the log file path, then aborts the install so the user can pick another location or free space. In silent, passive and `/UPDATE` runs the same checks run and are logged but never block, because an unattended upgrade that stops on a measurement is worse than one that fails later with the existing write error.

Unknown probe results — a failed `GetDiskFreeSpaceEx` call, an unreadable path — are treated as "no finding", so the install continues exactly as it does today.

## Step log

Every install appends to `$TEMP\FrameQ-install.log` (truncated first when it exceeds 64 KB):

```
time=2026-11-09 16:55:01 step=preinstall start mode=interactive instdir=...
time=2026-11-09 16:55:01 step=security product=360 安全卫士
time=2026-11-09 16:55:01 step=freespace result=ok free_mb=95716 required_mb=1080
time=2026-11-09 16:55:01 step=writability result=ok
time=2026-11-09 16:55:02 step=copy start
time=2026-11-09 16:55:09 step=install done
```

The log holds the install directory and the measured numbers only. It never records command-line switches, credentials, account data, or file contents, and it is not part of the diagnostics bundle.

## Boundaries

The preflight never changes the install path, never elevates, never retries, and never attempts to bypass a scanner. It does not replace the security-software advisory, which still runs first and stays advisory. Uninstall, the updater payload, and the macOS DMG are untouched. A user who deliberately installs into an unusual location can still do so when the probe succeeds.

## Acceptance

With a healthy volume the install proceeds with no new dialog and `FrameQ-install.log` shows all recorded steps. With a target directory that cannot be written, the interactive installer shows one Chinese message naming the path and the log file, and no payload file is written before it. A silent install with an unwritable target logs the failure and still attempts the install as before. The installer compiles with `makensis` from the Tauri NSIS distribution, and a scratch harness reproduces the free-space and writability results on the build machine.
