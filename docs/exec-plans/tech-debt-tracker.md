# Tech Debt Tracker

Last updated: 2026-07-11

## High Priority

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| None | No high-priority MVP debt remains after final validation | N/A | N/A |

## Completed / Resolved

### P2 God Component Split

- Status: completed.
- Resolution: `app/src/App.tsx` is now a composition root after extracting account, task processing, transcript detail, settings, history, window chrome, and insight generation controllers. `InsightPreferenceFlow` and summary confirmation JSX remain composed in `App.tsx`, while orchestration state/actions moved into focused feature hooks.
- Evidence: commits `0ceb997`, `eaa852a`, `c1c195d`, `ba733c1`, `0dbfb3f`, `56339d3`, and `5310a48`; final review showed `App.tsx` at 800 lines with only `actionNotice` as local React state; `npm --prefix app test`, `npm --prefix app run build`, and `git diff --check` passed.
- Residual risk: accepted as tracked deferred debt below rather than continuing P2 micro-splitting.

### P2 Orchestration Hook Main-Path Tests

- Status: completed for the first hook-level testing round.
- Resolution: Added focused hook tests for `useHistoryController`, `useSettingsController`, and `useInsightGenerationController` using the existing lightweight Vitest harness without adding browser/E2E dependencies.
- Coverage added: history open/load/empty/error/select behavior; settings open/load, insight preference unavailable fallback, save, cache clear, config locate, and profile clear paths; insight generation summary gate, account AI gate, insight preference flow creation, detail direction editing, and retry dispatch with preference snapshot.
- Evidence: commits `398eecd`, `d5c7341`, and `e0ae940`; stage review passed `npm --prefix app test` with 27 files / 170 tests, `npm --prefix app run build`, and `git diff --check`.
- Residual risk: later reduced by the second hook testing round below; remaining history concurrency and real React/component interaction coverage are tracked as deferred debt below.

### P2 Orchestration Hook Error-Branch Tests

- Status: completed for the second hook-level testing round.
- Resolution: Extended focused hook tests for `useInsightGenerationController` and `useSettingsController` error branches without changing production code or adding dependencies.
- Coverage added: `useInsightGenerationController` preference read failure, preference save failure, retry failure, profile skip failure, and profile save failure paths; `useSettingsController` load, save, cache clear, config locate, and profile clear failure paths.
- Evidence: commits `c4a8e92` and `137231e`; stage review passed `npm --prefix app test` with 27 files / 184 tests, `npm --prefix app run build`, and `git diff --check`.
- Residual risk: history concurrency/repeated-open behavior and real React/component interaction coverage remain tracked as deferred debt below.

### P2 Worker Pipeline / Media Structure Refactor

- Status: completed.
- Resolution: `run_worker_pipeline` is now a high-level orchestration layer. Media download/selection, video validation, audio preparation, subtitle/ASR transcript stages, and optional AI finalization were moved into focused stage functions while preserving worker CLI flags, progress events, error codes/messages, task manifest output, artifacts, and result wire shapes.
- Download strategy cleanup: `worker/frameq_worker/media.py` now drives platform fallback dispatch through `DownloadStrategy` and `FALLBACK_DOWNLOAD_STRATEGIES`. The fallback order remains Douyin -> Xiaohongshu -> Bilibili, and YouTube keeps the existing yt-dlp failure classification path.
- Evidence: commits `4dcb5c9`, `acb6e16`, `f8409e9`, and `3a60dc6`; stage review passed `uv run pytest worker\tests` with 154 tests, `uv run ruff check worker`, and `git diff --check`.
- Next-stage recommendation: run real platform smoke for Douyin / Xiaohongshu / Bilibili / YouTube with stable public samples; re-evaluate `download_strategies.py` only before adding another platform or when the strategy table grows; keep worker tests plus ruff as the refactor gate.
- Residual risk: accepted as tracked deferred debt below rather than continuing P2 worker/media micro-splitting.

### Manual Audio Playback Cache Management

- Status: completed.
- Resolution: Settings now shows the app-local audio playback cache size and provides a clear action backed by canonicalized Tauri commands.
- Safety boundary: clearing removes only app-local `cache/.frameq-audio-review`, preserves source task artifacts under `<FRAMEQ_OUTPUT_DIR>/tasks/<task_id>/`, and the cache regenerates when transcript detail is opened again.
- Evidence: `app/src/App.tsx`, `app/src/settingsClient.ts`, `app/src-tauri/src/settings.rs`, `app/src-tauri/src/transcript_detail.rs`, and focused audio cache tests.

## Accepted / Deferred

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| Ambiguous pre-transaction activation/admin entitlement history requires manual repair | Old sequential writes can leave a redeemed activation code without a deterministically attributable entitlement, or entitlement changes with no audit. Automatic compensation could double grant access or quota. | `docs/product-specs/2026-07-10-server-entitlement-transaction-safety.md`; server transaction-safety ExecPlan | Run the bounded detection checks, repair confirmed incidents through the audited `manual_repair` adjustment path, and retain evidence per support incident. |
| Raw source remains transient in process and pipe memory | Worker request JSON no longer enters argv or environment variables, but a sufficiently privileged local debugger, process-memory dump, or OS crash dump may capture the value while it exists in desktop memory, the stdin pipe buffer, or worker memory. This is outside FrameQ persistence/logging and cannot be eliminated while the downloader needs the original request. | `app/src-tauri/src/worker_command.rs`; `worker/frameq_worker/cli.py`; `docs/product-specs/2026-07-10-source-url-privacy-boundary.md` | Keep lifetimes bounded, never persist/log payloads, and evaluate OS-protected inherited handles or crash-dump exclusion only if the threat model expands beyond same-user local process isolation. |
| Quarantined legacy task directory names are not renamed | A legacy Xiaohongshu task created when a 24-character token was mistaken for a note ID may retain that value in its physical task/cache directory name. Product reads, history, cache reuse, transcript access, and retry are blocked, but automatic rename is unsafe without a transactional task/cache reference migration. | `worker/frameq_worker/source_identity.py`; `app/src-tauri/src/task_manifest.rs`; source URL privacy ExecPlan | Add an explicit user-confirmed cleanup/rename operation that coordinates output and cache directories, or document manual deletion after backup. |
| Historical copies outside known task artifacts are not scrubbed | Bounded migration cleans manifests plus known transcript/AI artifacts, but old desktop log archives, exported copies, user-managed backups, and arbitrary files are intentionally outside automatic mutation scope. | `docs/SECURITY.md`; source URL privacy ExecPlan | Provide an opt-in scanner with preview/backup semantics if field evidence shows these copies need product-managed cleanup. |
| App shell glue remains after P2 | `App.tsx` still owns app startup/deep-link effects, `openCard` / `locateArtifact`, global `actionNotice`, and top-level Sheet/Flow composition. This is acceptable for a composition root but should not grow new feature state. | `app/src/App.tsx`; P2 commits listed above | Keep new feature state/actions in focused controllers. Revisit only if App shell glue starts accumulating business rules again. |
| Automated UI/E2E smoke coverage missing | P2 relied on focused unit tests/build plus manual smoke for history, settings, transcript detail, window chrome, and AI flow. Future wiring changes could regress UI interactions without an automated browser/Tauri smoke harness. | P2 manual smoke confirmations; no committed E2E harness | Add automated smoke coverage for history, settings, transcript, window chrome, and AI flow main paths. |
| History loading request ordering remains deferred | Controller-owned history restoration now rejects active task switches and invalidates stale worker callbacks, but `useHistoryController` still has no request ordering for concurrent or repeated panel-open fetches. Current behavior is simple enough to defer until history loading gains cancellation, request ordering, or more complex state rules. | `app/src/features/history/useHistoryController.ts`; `app/src/features/history/useHistoryController.test.ts`; `docs/product-specs/2026-07-10-history-task-restore-ownership.md` | Add focused hook tests and request sequencing for duplicate open calls if history loading behavior becomes more complex. |
| Lightweight hook harness limitations | The current hook tests use a minimal Vitest `useState` / `useCallback` harness. This keeps dependency weight low but does not exercise real React scheduling, DOM rendering, component interactions, focus/keyboard behavior, Sheet/Flow wiring, or end-to-end UI behavior. | `app/src/features/history/useHistoryController.test.ts`, `app/src/features/settings/useSettingsController.test.ts`, `app/src/features/insightPreferences/useInsightGenerationController.test.ts` | Add real component or UI smoke coverage for interactions that depend on React rendering semantics or DOM behavior. |
| Real platform download smoke coverage remains manual | Unit tests cover worker pipeline/media contracts, fallback dispatch, and error mapping, but real Douyin, Xiaohongshu, Bilibili, and YouTube pages/APIs can change outside the repository. | `worker/frameq_worker/pipeline.py`; `worker/frameq_worker/media.py`; P2 worker/media stage review | Run real platform smoke with one stable public sample per platform before risky download changes or release validation. |
| Download strategy table remains in `media.py` | `DownloadStrategy` centralizes platform fallback dispatch, but `media.py` still imports platform fallback modules and their error types. This is acceptable while the strategy table is small. | `worker/frameq_worker/media.py` | Re-evaluate extracting `worker/frameq_worker/download_strategies.py` only when adding another platform or when the strategy table starts carrying more platform-specific behavior. |
| Frontend/worker URL support rule drift | `app/src/urlSupport.ts` and `worker/frameq_worker/media.py` both encode platform URL support rules across TypeScript UI validation and Python worker download capability. This is a cross-language/process contract concern; changing it can alter user-visible input acceptance. | `app/src/urlSupport.ts`; `worker/frameq_worker/media.py`; `worker/frameq_worker/*_fallback.py` | Add a shared platform URL support contract and dual frontend/worker contract tests, or at minimum drift-detection tests, before changing platform URL admission behavior. |
| `pydub` / `audioop` Python 3.13 compatibility watch | Worker tests pass on Python 3.12, but the suite emits a `pydub.utils` `audioop` deprecation warning; Python 3.13 removes `audioop`. | `worker/tests/test_asr.py`; `pydub` dependency warning during `uv run pytest worker\tests` | Before moving the packaged worker runtime to Python 3.13, replace or upgrade the affected audio dependency path, or pin the runtime to a compatible Python version. |
| macOS notarization deferred | macOS DMGs are ad-hoc signed only (`bundle.macOS.signingIdentity = "-"`, `hardenedRuntime = false`), so first launch still shows a one-time Gatekeeper prompt that users must bypass manually. Full removal needs a paid Apple Developer ID + notarization. Ad-hoc signing is the free mitigation that avoids the non-recoverable "app is damaged" failure. | `app/src-tauri/tauri.conf.json`, README "macOS install and Gatekeeper" | Desktop app shows commercial demand → buy Apple Developer Program, add Developer ID signing + `notarytool` notarization + stapling to the macOS release jobs. |
| macOS in-app auto-update deferred (UI gated) | `latest.json` only carries Windows platform entries and the macOS jobs upload DMGs without `.app.tar.gz` updater artifacts. The UI now gates on `get_update_delivery`: macOS skips the silent check and shows a "前往下载页" action instead of falsely reporting "up to date". Real in-app auto-update is still not wired. | `app/src-tauri/src/updates.rs` (`get_update_delivery`), `app/src/features/updates/useAppUpdateController.ts`, `.github/workflows/desktop-release.yml` | Publish signed `.app.tar.gz` + `.sig` from the macOS jobs and merge `darwin-x86_64` / `darwin-aarch64` entries into `latest.json`, then flip `in_app_updates` on for macOS. Works even ad-hoc-signed because updater downloads bypass Gatekeeper quarantine. |

2026-07-03 note: ad-hoc signing avoids the non-recoverable damaged-app path only when the signed `.app` is not modified after signing. The release workflow now runs packaged-runtime smoke tests with `PYTHONDONTWRITEBYTECODE=1`, rejects `__pycache__` / `.pyc` files inside packaged resources, and verifies `codesign --deep --strict` before creating the DMG.

## Recently Closed

| Topic | Evidence | Closed |
|------|----------|--------|
| macOS process-group cancellation native-host verification | Read-only run `29108659472`, job `86415372457`, at `b3cc6b3e2fc0ed31b98deeecb5ae7f6917de6d58` passed the complete 90-test Cargo suite on `macos-latest`; the log explicitly records `unix_termination_stops_a_parent_and_child_in_the_managed_process_group ... ok`. Linux is not a supported release target. | 2026-07-11 |
| Raw source URL in worker command line | Production process-video, source-identity preflight, and retry requests now use fixed argv mode flags plus a capped one-shot stdin payload. Rust command-spec and real-child probes verify the sensitive fixture reaches stdin but not argv/environment/log output; worker CLI tests cover bounded safe parsing and non-echoing failures. | 2026-07-10 |
| Historical InsightFlow LLM live smoke | Closed by the 2026-06-17 smoke, but the project-root `.env` path is now retired. Current live LLM validation must use FrameQ server Admin Web config plus server-managed checkout; desktop `.env` is limited to non-LLM local settings. | 2026-06-17 |

## Debt Handling Rules

- Add debt here when it spans more than one file or more than one task.
- Remove or downgrade debt when a change clearly addresses it.
- Link back to the plan, design doc, or code path that best explains the issue.
