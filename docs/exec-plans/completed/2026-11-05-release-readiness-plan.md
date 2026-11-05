# Release Readiness Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Close the formal installer, macOS, and commit-specific CI evidence gaps for the approved processing workspace and native webpage fix. Produce reviewable internal acceptance artifacts and verify real installed behavior while preserving the user's local data. Public release publication remains a separate action.

## Progress

- [x] 2026-11-05: Inspect the project release gates, native acceptance records, installer builder, and available workflows. Validation: current changes are on main; release artifacts require bundled runtime preparation and native packaging.
- [x] 2026-11-05: Run complete frontend and Windows native checks. Validation: frontend 1503 passed / 1 skipped with lint passed; Rust 557 passed / 29 ignored, followed by the final socket shutdown regression passing with a single build job. Final local Node scripts 57 and Python scripts 1 passed; documentation validation and diff checks passed.
- [x] 2026-11-05: Complete the serial Worker regression. Validation: Ruff passed; local complete Worker suite 1265 passed / 4 skipped, with all skips requiring Windows symbolic-link support. Final hosted suites exercised those real filesystem cases on both platforms and each passed all 1269 tests.
- [x] 2026-11-05: Build, install, and replace the Windows release installer from final product commit `ff225385312e735d7cbe9d01e230646b450b80d6` and verify installed behavior. Validation: optimized NSIS build and `/S /UPDATE` exited 0; all 53 prior task files retained their SHA-256 hashes, and installed Worker bytes match canonical source. Final native task `20261105-113145-web-50ee1d9826284b5d` opened the exact verified article in the installed reader.
- [x] 2026-11-05: Exercise the final installed default ONNX recognizer against the complete real YouTube audio. Validation: installed Python 3.12.16 with no discoverable PyTorch processed 5161.611 seconds of audio in 299.14 seconds, producing 80,951 characters and 300 valid ordered segments. The new transcript SHA-256 `213e2fcd1bd8ac60d4dde6399a0316b96e45d8f893c77e056206b0d3c7942031` exactly matches the earlier native result. Source audio and all 53 prior task files remain unchanged; no title, checkout, network request, or paid AI operation ran.
- [x] 2026-11-05: Install the optimized Windows NSIS candidate and complete the real native webpage flow. Validation: installer exited 0; task `20261105-094047-web-f4d95af120b149a6` completed with the exact verified 42,777-byte article; all 47 pre-existing task files retained their original SHA-256 hashes. Final replacement and the second installed native task also passed.
- [x] 2026-11-05: Prepare and independently review internal macOS Intel/Apple Silicon packaging and native acceptance coverage. Validation: workflow/YAML and source review passed; read-only permissions and internal artifact boundaries are preserved.
- [x] 2026-11-05: Commit and push reviewed product source `ff225385312e735d7cbe9d01e230646b450b80d6` and complete corresponding hosted gates. Validation: Native CI `42017204405` passed all four jobs; each platform passed frontend 1503 / 1 skipped and Worker 1269 / 0 skipped. Windows Cargo passed 557 / 29 ignored and native host 18 / 9 ignored; macOS Cargo passed 534 / 28 ignored. Script CI `42017204256` passed on both platforms with zero documentation errors/warnings. Server CI `42017204288` passed 400 tests, eight migrations, preflight, and isolated restore.
- [x] 2026-11-05: Add real subprocess/open-pipe regressions for short controls and 96 KiB initialization records, and implement incremental macOS stdin reads. Validation: the actual Swift binary exercised both owned child processes while their stdin remained open; both responses arrived within the unchanged five-second deadline and matched the submitted bytes. Native CI and both architecture artifact jobs passed the protocol checks.
- [x] 2026-11-05: Complete macOS internal artifact acceptance `42017205151` for the exact product commit. Validation: both Intel and Apple Silicon jobs succeeded, each passing 534 native tests / 28 ignored and the opt-in real static/JavaScript extraction, save, and reopen test. Both final applications passed architecture, installed runtime imports, resource integrity, strict ad-hoc signature, and helper checks; both DMGs passed checksum verification, read-only mounting, and contained application/helper checks. Internal artifacts `13413796078` (Intel) and `13410683200` (Apple Silicon) uploaded successfully.
- [x] 2026-11-05: Verify Unix storage-manager ownership releases its process lock while a duplicated descriptor remains open. Validation: the actual macOS kernel-lock regression, successor-manager exclusion after restart handoff, and original interrupted-merge recovery all passed in the complete 534-test hosted native suite. The local Windows storage suite passed 76 tests / 5 ignored, including the extended restart handoff assertions.
- [x] 2026-11-05: Record the completed installer, dual-architecture, and exact-source CI acceptance, together with remaining platform limits. Validation: the three requested evidence gaps are closed; native macOS graphical interaction, the remaining dedicated WebView security/permission canaries, and complete public signed-update distribution remain unverified. Public release publication was not performed.

## Surprises & Discoveries

Evidence: `desktop-release.yml` publishes only through explicit tags/dispatch; the dual-architecture macOS acceptance workflow creates internal artifacts with read-only repository permission. Native process and script CI run on main. Windows acceptance uses the optimized NSIS installer and the actual installed application with the production identifier and local data layout.

Evidence: final source behavior waits for the current task's draft detail before accepting regeneration. Native proxy tests configure bounded socket reads before stopping the proxy, then retain the EOF and cleanup assertions. The installed-runtime acceptance uses a clean official CPython archive and lock-derived requirements.

Evidence: the Windows clean runtime uses official CPython archive SHA-256 `590dfcbe3a34c07301e6332e13e2188b98655cd072b08afa45a7998dc4c22bc5`; the executable reports Python 3.12.16 and yt-dlp 2026.10.21. The bundled runtime excludes PyTorch, and its lock fingerprint is `96c66789b3bc1c19dd9dfd8566a37b31f2ce1d43e79bcf6a948c9f2ca90ede80`. Canonical Worker bytes match the prepared resource mirror.

Evidence: complete Worker checks require the real PyTorch extra for the optional ASR path. Transcript link checks precede authority reads and retain the existing `TRANSCRIPT_TEXT_PATH_INVALID` contract. The native connection shutdown check accepts only EOF or explicit reset/abort, while bounded waits and unexpected-data rejection remain enforced. Browser readiness waits for the actual navigation document.

Evidence: final Windows installer `FrameQ_0.4.3_x64-setup.exe` is 209,814,953 bytes with SHA-256 `aaaf1e0f2d3a2d3fd966d5da0b383ba63f090ece5708678a2222f286497d0c9b`. It uses the production identifier and default current-user installation location. The internal acceptance override disables updater signature sidecars; it leaves application behavior and resource paths intact. Actual installed-library checks and native accessibility records are in the ignored evidence directory.

## Decision Log

Decision: Use internal acceptance artifacts and preserve the existing product identity and data format. Rationale: installed behavior must exercise production resource paths and local-history compatibility. Date/Author: 2026-11-05, User + Codex.

Decision: Keep public release creation and tag publication outside this acceptance task. Rationale: the user requested completion of release-readiness gaps. Date/Author: 2026-11-05, Codex.

Decision: Include both macOS architectures in the internal acceptance matrix and add hosted frontend/Worker gates alongside native checks. Rationale: evidence must apply to the final source commit and actual platform artifacts. Date/Author: 2026-11-05, Codex.

Decision: Copy standard macOS Python launchers from the discovered versioned interpreter into independent ordinary executable files. Rationale: the launcher stays in the same bin directory and retains interpreter bytes and permissions while satisfying native file/process identity checks. Date/Author: 2026-11-05, Codex.

Decision: Read macOS host stdin with bounded single POSIX reads and deliver each complete NDJSON record immediately. Rationale: the parent keeps stdin open for subsequent start, policy, and cancellation commands; record delivery must proceed independently of EOF. Preserve framing limits, interrupted-read handling, and the existing failure callbacks. Date/Author: 2026-11-05, Codex.

Decision: Explicitly unlock the Unix storage manager's owned process lock when its lifetime ends. Rationale: duplicated or temporarily inherited descriptors share the original open-file description; owner destruction must release that lock independently of their close timing. A successor manager opens an independent description whose lock remains protected through old-owner destruction and old-descriptor closure. Date/Author: 2026-11-05, Codex.

## Outcomes & Retrospective

Internal candidate acceptance is complete for product commit `ff225385312e735d7cbe9d01e230646b450b80d6`. The optimized Windows installer passed actual replacement, preservation of all 53 pre-existing task files, native webpage extraction/reading, and complete installed default ONNX recognition of the real 86-minute audio. Intel and Apple Silicon hosted jobs passed actual system-WebView static/dynamic note persistence, native process and storage recovery tests, final application/runtime checks, and final DMG read-back. Native, Script, and Server CI passed for the same product commit. Independent source/workflow review found no implementation blocker.

Not run and residual risk: no local macOS device was available for graphical interaction, Gatekeeper/permission interaction, or the remaining specialized WebView security canaries. The hosted webpage test exercises the built helper/Worker resources; separate final-bundle checks establish their packaged identities and signatures. macOS signatures are ad-hoc. Internal bundles disable updater sidecars; complete public signed-update distribution was not exercised. These boundaries remain explicit in the technical-debt tracker. No tag or public release was created.

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

Hosted product-source evidence:

- Native CI: `https://github.com/jiabai/FrameQ/actions/runs/42017204405`.
- Script CI: `https://github.com/jiabai/FrameQ/actions/runs/42017204256`.
- Server CI: `https://github.com/jiabai/FrameQ/actions/runs/42017204288`.
- macOS acceptance: `https://github.com/jiabai/FrameQ/actions/runs/42017205151`.
- Intel artifact `frameq-macos-x64-11-ff225385312e`: 341,052,865 bytes; artifact ZIP SHA-256 `f29496fc12eb5ed5fe3083c69fc6f79e0b77c9da2121436d2a2fb3e0ca4f77c5`.
- Apple Silicon artifact `frameq-macos-arm64-11-ff225385312e`: 295,682,984 bytes; artifact ZIP SHA-256 `203bcfa448c559821eb00321e84f3346878c9e76dc3158be598b274b12aedfed`.

The macOS digests above identify the uploaded artifact ZIPs. Each ZIP contains the DMG and its separate SHA-256 file; the workflow verified the actual DMG and mounted contents before upload. Internal artifacts have seven-day retention.

## Interfaces and Dependencies

Use existing Tauri/NSIS, locked Python runtime, system WebView helpers, and GitHub Actions capabilities. Preserve current IPC contracts, task manifest schema, storage ownership, and user-confirmed AI billing boundaries.
