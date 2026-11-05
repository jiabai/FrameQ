# Release Readiness Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Close the formal installer, macOS, and commit-specific CI evidence gaps for the approved processing workspace and native webpage fix. Produce reviewable internal acceptance artifacts and verify real installed behavior while preserving the user's local data. Public release publication remains a separate action.

## Progress

- [x] 2026-11-05: Inspect the project release gates, native acceptance records, installer builder, and available workflows. Validation: current changes are on main; release artifacts require bundled runtime preparation and native packaging.
- [x] 2026-11-05: Run complete frontend and Windows native checks. Validation: frontend 1503 passed / 1 skipped with lint passed; Rust 557 passed / 29 ignored, followed by the final socket shutdown regression passing with a single build job. Node scripts 55 and Python scripts 1 passed; documentation validation and diff checks passed.
- [x] 2026-11-05: Complete the final serial Worker regression. Validation: Ruff passed; complete Worker suite 1265 passed / 4 skipped, with all skips requiring Windows symbolic-link support. Hosted frontend/Worker gates and both macOS architecture jobs are defined for the final source.
- [x] 2026-11-05: Build, install, and replace the Windows release installer and verify installed behavior. Validation: optimized NSIS and `/S` installation succeeded; final `/S /UPDATE` exited 0, all 50 prior files retained their SHA-256 hashes, and installed Worker bytes match final source. Final native task `20261105-100804-web-6b22ab445fb54821` opened the exact verified article in the installed reader.
- [x] 2026-11-05: Install the optimized Windows NSIS candidate and complete the real native webpage flow. Validation: installer exited 0; task `20261105-094047-web-f4d95af120b149a6` completed with the exact verified 42,777-byte article; all 47 pre-existing task files retained their original SHA-256 hashes. The final resource refresh and replacement check are in progress.
- [x] 2026-11-05: Prepare and independently review internal macOS Intel/Apple Silicon packaging and native acceptance coverage. Validation: workflow/YAML and source review passed; read-only permissions and internal artifact boundaries are preserved.
- [x] 2026-11-05: Commit and push reviewed source `c92d2b7c812921fb51783fa0f809be315f710853` and start hosted acceptance. Validation: Script CI `42000704372` and Server CI `42000704493` passed; Native ProcessSupervisor `42000704525` and macOS artifacts `42000759848` are being followed to completion.
- [x] 2026-11-05: Complete final desktop and script hosted gates for `5e9b0d5db58b5d7ecc6964ed2293e3d2ec05cfab`. Validation: Native CI `42006858417` passed all four jobs, both platforms frontend 1503 passed / 1 skipped and Worker 1269 passed; Windows Cargo 557 passed / 29 ignored, macOS Cargo 533 passed / 28 ignored. Script CI `42006858589` passed. Same-commit Server CI `42008457731` and macOS artifact acceptance `42007067038` are being followed to completion.
- [ ] Complete corresponding server checks and macOS internal artifact acceptance, recording exact commit and run identities.
- [x] 2026-11-05: Add real subprocess/open-pipe regressions for short controls and 96 KiB initialization records, and implement incremental macOS stdin reads. Validation: the actual Swift test binary compiled and exercised the owned child process; final-source protocol and complete macOS acceptance are being run through hosted checks.
- [ ] Record remaining platform limitations and determine whether formal release gates are satisfied.

## Surprises & Discoveries

Evidence: `desktop-release.yml` publishes only through explicit tags/dispatch; the existing Intel acceptance workflow creates an internal artifact with read-only repository permission. Native process and script CI run on main. Current Windows acceptance used an unbundled debug application; the configured identifier and source data remain the production ones.

Evidence: final source behavior waits for the current task's draft detail before accepting regeneration. Native proxy tests configure bounded socket reads before stopping the proxy, then retain the EOF and cleanup assertions. The installed-runtime acceptance uses a clean official CPython archive and lock-derived requirements.

Evidence: the Windows clean runtime uses official CPython archive SHA-256 `590dfcbe3a34c07301e6332e13e2188b98655cd072b08afa45a7998dc4c22bc5`; the executable reports Python 3.12.16 and yt-dlp 2026.10.21. The bundled runtime excludes PyTorch, and its lock fingerprint is `96c66789b3bc1c19dd9dfd8566a37b31f2ce1d43e79bcf6a948c9f2ca90ede80`. Canonical Worker bytes match the prepared resource mirror.

Evidence: complete Worker checks require the real PyTorch extra for the optional ASR path. Transcript link checks precede authority reads and retain the existing `TRANSCRIPT_TEXT_PATH_INVALID` contract. The native connection shutdown check accepts only EOF or explicit reset/abort, while bounded waits and unexpected-data rejection remain enforced. Browser readiness waits for the actual navigation document.

Evidence: final Windows installer `FrameQ_0.4.3_x64-setup.exe` is 209,835,790 bytes with SHA-256 `3fd4636781f747594b871435bd7967085166a55a33a085ddfa29c9bd6f099cfe`. It uses the production identifier and default current-user installation location. The internal acceptance override disables updater signature sidecars; it leaves application behavior and resource paths intact. Actual installed-library checks and native accessibility records are in the ignored evidence directory.

## Decision Log

Decision: Use internal acceptance artifacts and preserve the existing product identity and data format. Rationale: installed behavior must exercise production resource paths and local-history compatibility. Date/Author: 2026-11-05, User + Codex.

Decision: Keep public release creation and tag publication outside this acceptance task. Rationale: the user requested completion of release-readiness gaps. Date/Author: 2026-11-05, Codex.

Decision: Include both macOS architectures in the internal acceptance matrix and add hosted frontend/Worker gates alongside native checks. Rationale: evidence must apply to the final source commit and actual platform artifacts. Date/Author: 2026-11-05, Codex.

Decision: Copy standard macOS Python launchers from the discovered versioned interpreter into independent ordinary executable files. Rationale: the launcher stays in the same bin directory and retains interpreter bytes and permissions while satisfying native file/process identity checks. Date/Author: 2026-11-05, Codex.

Decision: Read macOS host stdin with bounded single POSIX reads and deliver each complete NDJSON record immediately. Rationale: the parent keeps stdin open for subsequent start, policy, and cancellation commands; record delivery must proceed independently of EOF. Preserve framing limits, interrupted-read handling, and the existing failure callbacks. Date/Author: 2026-11-05, Codex.

## Outcomes & Retrospective

Acceptance is in progress. Residual risk: no local macOS host is available; hosted runner capabilities and actual native evidence must be recorded separately from build success.

## Context and Orientation

- Gates: `docs/EXECUTION_GATES.md`.
- Approved changes: `docs/exec-plans/completed/2026-11-05-processing-workspace-plan.md`, `2026-11-05-web-note-native-acceptance-plan.md`.
- Packaging: `scripts/build-installer.mjs`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/windows/installer-hooks.nsh`.
- CI: `.github/workflows/desktop-release.yml`, `macos-intel-acceptance.yml`, `unix-process-supervisor.yml`, `scripts-ci.yml`.
- Evidence: `build/release-readiness-20261105/` (ignored).

## Plan of Work

Run independent checks concurrently. Complete native Rust checks before refreshing bundled resources. Prepare locked installer resources, build a Windows NSIS artifact, inspect its contents, and exercise installation and actual saved-note workflows. Extend internal artifact acceptance only where current workflows omit a required architecture or operation. Review the complete source and workflow changes before committing and triggering corresponding hosted checks.

## Concrete Steps

- `npm --prefix app test`; `npm --prefix app run lint`.
- `uv run ruff check worker`; `uv run pytest worker/tests`.
- `cargo test --manifest-path app/src-tauri/Cargo.toml` with an explicit real Python process fixture and permission to clean owned child processes.
- `node --test scripts/tests/*.test.mjs`; `python -m pytest scripts/tests`.
- Run the installer preparation and NSIS build with the existing local runtime archives and locked requirements.
- Verify the actual installed executable, bundled Worker/runtime, manifest fingerprints, and native input/result behavior.
- Run hosted checks against the final commit and retain internal macOS artifacts with architecture/signature/runtime evidence.
- `python scripts/validate_agents_docs.py --level ERROR`; `git diff --check`.

## Validation and Acceptance

Tests report actual failures and ignored cases. Installed runtime imports and fingerprints agree with the locked package and canonical Worker. The Windows installed application preserves existing notes and completes the requested webpage path. macOS evidence identifies both architecture, final app/DMG signature checks, and native process results. Hosted results correspond to the exact reviewed commit; unavailable native capabilities remain explicit release limitations.

## Idempotence and Recovery

All acceptance artifacts and local test directories stay under the ignored project build directory. Preserve production local history and configuration; verify source/installed artifact identity before changing the installed application. Never overwrite public release assets or push release tags during acceptance.

## Artifacts and Notes

Keep test logs, artifact hashes, runtime checks, accessibility evidence, and hosted run summaries in the ignored evidence directory. Source-controlled records contain no credentials, user notes, or extracted article content.

## Interfaces and Dependencies

Use existing Tauri/NSIS, locked Python runtime, system WebView helpers, and GitHub Actions capabilities. Preserve current IPC contracts, task manifest schema, storage ownership, and user-confirmed AI billing boundaries.
