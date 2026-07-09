# Tech Debt Tracker

Last updated: 2026-07-10

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

### Manual Audio Playback Cache Management

- Status: completed.
- Resolution: Settings now shows the app-local audio playback cache size and provides a clear action backed by canonicalized Tauri commands.
- Safety boundary: clearing removes only app-local `cache/.frameq-audio-review`, preserves source task artifacts under `<FRAMEQ_OUTPUT_DIR>/tasks/<task_id>/`, and the cache regenerates when transcript detail is opened again.
- Evidence: `app/src/App.tsx`, `app/src/settingsClient.ts`, `app/src-tauri/src/settings.rs`, `app/src-tauri/src/transcript_detail.rs`, and focused audio cache tests.

## Accepted / Deferred

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| App shell glue remains after P2 | `App.tsx` still owns app startup/deep-link effects, `openCard` / `locateArtifact`, global `actionNotice`, and top-level Sheet/Flow composition. This is acceptable for a composition root but should not grow new feature state. | `app/src/App.tsx`; P2 commits listed above | Keep new feature state/actions in focused controllers. Revisit only if App shell glue starts accumulating business rules again. |
| Automated UI/E2E smoke coverage missing | P2 relied on focused unit tests/build plus manual smoke for history, settings, transcript detail, window chrome, and AI flow. Future wiring changes could regress UI interactions without an automated browser/Tauri smoke harness. | P2 manual smoke confirmations; no committed E2E harness | Add automated smoke coverage for history, settings, transcript, window chrome, and AI flow main paths. |
| History controller concurrency coverage deferred | `useHistoryController` covers open/load/empty/error/select behavior, but concurrent or repeated open calls are still untested. Current behavior is simple enough to defer until history loading gains cancellation, request ordering, or more complex state rules. | `app/src/features/history/useHistoryController.ts`; `app/src/features/history/useHistoryController.test.ts` | Add focused hook tests for duplicate open calls or request ordering if history loading behavior becomes more complex. |
| Lightweight hook harness limitations | The current hook tests use a minimal Vitest `useState` / `useCallback` harness. This keeps dependency weight low but does not exercise real React scheduling, DOM rendering, component interactions, focus/keyboard behavior, Sheet/Flow wiring, or end-to-end UI behavior. | `app/src/features/history/useHistoryController.test.ts`, `app/src/features/settings/useSettingsController.test.ts`, `app/src/features/insightPreferences/useInsightGenerationController.test.ts` | Add real component or UI smoke coverage for interactions that depend on React rendering semantics or DOM behavior. |
| macOS notarization deferred | macOS DMGs are ad-hoc signed only (`bundle.macOS.signingIdentity = "-"`, `hardenedRuntime = false`), so first launch still shows a one-time Gatekeeper prompt that users must bypass manually. Full removal needs a paid Apple Developer ID + notarization. Ad-hoc signing is the free mitigation that avoids the non-recoverable "app is damaged" failure. | `app/src-tauri/tauri.conf.json`, README "macOS install and Gatekeeper" | Desktop app shows commercial demand → buy Apple Developer Program, add Developer ID signing + `notarytool` notarization + stapling to the macOS release jobs. |
| macOS in-app auto-update deferred (UI gated) | `latest.json` only carries Windows platform entries and the macOS jobs upload DMGs without `.app.tar.gz` updater artifacts. The UI now gates on `get_update_delivery`: macOS skips the silent check and shows a "前往下载页" action instead of falsely reporting "up to date". Real in-app auto-update is still not wired. | `app/src-tauri/src/updates.rs` (`get_update_delivery`), `app/src/features/updates/useAppUpdateController.ts`, `.github/workflows/desktop-release.yml` | Publish signed `.app.tar.gz` + `.sig` from the macOS jobs and merge `darwin-x86_64` / `darwin-aarch64` entries into `latest.json`, then flip `in_app_updates` on for macOS. Works even ad-hoc-signed because updater downloads bypass Gatekeeper quarantine. |

2026-07-03 note: ad-hoc signing avoids the non-recoverable damaged-app path only when the signed `.app` is not modified after signing. The release workflow now runs packaged-runtime smoke tests with `PYTHONDONTWRITEBYTECODE=1`, rejects `__pycache__` / `.pyc` files inside packaged resources, and verifies `codesign --deep --strict` before creating the DMG.

## Recently Closed

| Topic | Evidence | Closed |
|------|----------|--------|
| Historical InsightFlow LLM live smoke | Closed by the 2026-06-17 smoke, but the project-root `.env` path is now retired. Current live LLM validation must use FrameQ server Admin Web config plus server-managed checkout; desktop `.env` is limited to non-LLM local settings. | 2026-06-17 |

## Debt Handling Rules

- Add debt here when it spans more than one file or more than one task.
- Remove or downgrade debt when a change clearly addresses it.
- Link back to the plan, design doc, or code path that best explains the issue.
