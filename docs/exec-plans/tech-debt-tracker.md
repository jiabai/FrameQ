# Tech Debt Tracker

Last updated: 2026-07-22

## High Priority

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| Supervised worker execution has no watchdog | The shared Rust runner can wait forever on a hung Python/native/provider child, leaving ordinary users stuck in a busy state and potentially retaining descendants. | `app/src-tauri/src/worker_runtime/runner.rs`; `docs/design-docs/2026-07-22-rust-worker-watchdog.md`; watchdog ExecPlan | Fixed operation-owned idle/absolute deadlines, instance-safe tree termination, closed timeout mappings, deterministic race tests, and available Windows/macOS evidence pass. |
| Broad-release server concurrency and operations boundary is not closed | Existing entitlement transaction work does not by itself prove OTP/ticket/quota check-then-write correctness under concurrent multi-instance traffic or provide rate-limit, observability, backup/restore, and deployment runbooks. | `server/src/`; `docs/product-specs/2026-07-10-server-entitlement-transaction-safety.md`; 2026-07-22 release review | Complete and accept a separate product/design/ExecPlan with database-level concurrency tests and production operations evidence before broad publication. |

## Completed / Resolved

### P1 Atomic Authoritative Persistence

- Status: completed and merged to `main` at `61d489a`.
- Resolution: All FrameQ-owned authoritative transcript, AI, preference, manifest, and Rust
  transcript-edit writers use reviewed same-directory atomic replacement. Existing-task multi-file
  updates use the closed prepared/committed journal and recovery-before-read boundary in Python and
  Rust.
- Evidence: Worker 563 passed / 2 skipped, App 551 passed, Windows Rust 185 passed, scripts 25
  passed, packaged-worker 63-file equality and Tauri `--no-bundle` passed; the implementation plan
  is archived at `docs/exec-plans/completed/2026-07-22-atomic-persistence-hardening-plan.md`.
- Residual risk: macOS/Unix native permission, symlink and forced-exit fixtures plus real Tauri
  transcript/AI smoke were unavailable and remain explicitly unverified. External programs that
  bypass FrameQ task access are outside the transaction guarantee.

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
- Resolution: `run_worker_pipeline` is now a high-level orchestration layer. Media download/selection, video validation, audio preparation, subtitle/ASR transcript stages, and local-task finalization were moved into focused stage functions while preserving worker CLI flags, progress events, error codes/messages, task manifest output, artifacts, and result wire shapes. AI generation is a separate `retry_insights` path.
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
| Permanent task deletion can partially complete | The user explicitly chose immediate irreversible disk release. Recursive directory removal is not transactional, so file locks, permissions, interruption, or storage errors may leave a supported task partially deleted. The product must report actual failure and never promise rollback. | `docs/product-specs/2026-07-12-history-task-permanent-deletion.md`; active deletion ExecPlan | Revisit only if the product adopts system Trash, an app-owned retention area, or a transactional storage layer; otherwise retain fault injection and truthful failure copy. |
| Ambiguous pre-transaction activation/admin entitlement history requires manual repair | Old sequential writes can leave a redeemed activation code without a deterministically attributable entitlement, or entitlement changes with no audit. Automatic compensation could double grant access or quota. | `docs/product-specs/2026-07-10-server-entitlement-transaction-safety.md`; server transaction-safety ExecPlan | Run the bounded detection checks, repair confirmed incidents through the audited `manual_repair` adjustment path, and retain evidence per support incident. |
| Raw source remains transient in process and pipe memory | Worker request JSON no longer enters argv or environment variables, but a sufficiently privileged local debugger, process-memory dump, or OS crash dump may capture the value while it exists in desktop memory, the stdin pipe buffer, or worker memory. This is outside FrameQ persistence/logging and cannot be eliminated while the downloader needs the original request. | `app/src-tauri/src/worker_runtime/command.rs`; `app/src-tauri/src/worker_runtime/runner.rs`; `worker/frameq_worker/cli.py`; `docs/product-specs/2026-07-10-source-url-privacy-boundary.md` | Keep lifetimes bounded, never persist/log payloads, and evaluate OS-protected inherited handles or crash-dump exclusion only if the threat model expands beyond same-user local process isolation. |
| Unsupported legacy task data remains physically present | Product policy deliberately rejects schema v1/v2, missing-marker, quarantined, malformed, invalid-identity, and linked tasks without migration, repair, rename, indexing, scanning, or deletion. Those directories may still contain raw URLs or sensitive historical fields, but no product history/cache/detail/edit/retry path may read or expose them. | `docs/product-specs/2026-07-11-history-vnext-strict-boundary.md`; `docs/SECURITY.md` | This is an accepted retention boundary, not a future compatibility project. Users who need the files may back them up or delete them manually outside FrameQ; revisit only through a new explicit product/security decision. |
| App shell glue remains after P2 | `App.tsx` still owns app startup/deep-link effects, `openCard` / `locateArtifact`, global `actionNotice`, and top-level Sheet/Flow composition. This is acceptable for a composition root but should not grow new feature state. | `app/src/App.tsx`; P2 commits listed above | Keep new feature state/actions in focused controllers. Revisit only if App shell glue starts accumulating business rules again. |
| History loading request ordering remains deferred | Controller-owned history restoration now rejects active task switches and invalidates stale worker callbacks, but `useHistoryController` still has no request ordering for concurrent or repeated panel-open fetches. Current behavior is simple enough to defer until history loading gains cancellation, request ordering, or more complex state rules. | `app/src/features/history/useHistoryController.ts`; `app/src/features/history/useHistoryController.test.ts`; `docs/product-specs/2026-07-10-history-task-restore-ownership.md` | Add focused hook tests and request sequencing for duplicate open calls if history loading behavior becomes more complex. |
| Lightweight hook harness coverage remains partial | Focused controller unit tests still use a minimal Vitest `useState` / `useCallback` harness. The new CDP smoke now covers real React scheduling/DOM wiring for the main settings, history, transcript-save, cancellation, and AI target paths, but it does not cover every controller error branch, keyboard/focus permutation, or native Tauri WebView behavior. | `app/src/features/history/useHistoryController.test.ts`; `app/src/features/settings/useSettingsController.test.ts`; `app/src/features/insightPreferences/useInsightGenerationController.test.ts`; `app/tests/app-input.browser.test.ts` | Add a smoke only when a remaining high-risk interaction depends on real React/DOM semantics; use packaged/native Tauri validation for WebView, OS dialog, filesystem, and installer behavior rather than expanding the mock browser into a full E2E framework. |
| Real platform download smoke coverage remains manual | Unit tests cover worker pipeline/media contracts, fallback dispatch, and error mapping, but real Douyin, Xiaohongshu, Bilibili, and YouTube pages/APIs can change outside the repository. | `worker/frameq_worker/pipeline_runtime/orchestration.py`; `worker/frameq_worker/media.py`; P2 worker/media stage review | Run real platform smoke with one stable public sample per platform before risky download changes or release validation. |
| Download strategy table remains in `media.py` | `DownloadStrategy` centralizes platform fallback dispatch, but `media.py` still imports platform fallback modules and their error types. This is acceptable while the strategy table is small. | `worker/frameq_worker/media.py` | Re-evaluate extracting `worker/frameq_worker/download_strategies.py` only when adding another platform or when the strategy table starts carrying more platform-specific behavior. |
| Frontend/worker URL support rule drift | `app/src/urlSupport.ts` and `worker/frameq_worker/media.py` both encode platform URL support rules across TypeScript UI validation and Python worker download capability. This is a cross-language/process contract concern; changing it can alter user-visible input acceptance. | `app/src/urlSupport.ts`; `worker/frameq_worker/media.py`; `worker/frameq_worker/*_fallback.py` | Add a shared platform URL support contract and dual frontend/worker contract tests, or at minimum drift-detection tests, before changing platform URL admission behavior. |
| `pydub` / `audioop` Python 3.13 compatibility watch | Worker tests pass on Python 3.12, but the suite emits a `pydub.utils` `audioop` deprecation warning; Python 3.13 removes `audioop`. | `worker/tests/test_asr.py`; `pydub` dependency warning during `uv run pytest worker\tests` | Before moving the packaged worker runtime to Python 3.13, replace or upgrade the affected audio dependency path, or pin the runtime to a compatible Python version. |
| macOS notarization deferred | macOS DMGs are ad-hoc signed only (`bundle.macOS.signingIdentity = "-"`, `hardenedRuntime = false`), so first launch still shows a one-time Gatekeeper prompt that users must bypass manually. Full removal needs a paid Apple Developer ID + notarization. Ad-hoc signing is the approved free mitigation for personal-development, small-user, and open-source distribution and avoids the non-recoverable "app is damaged" failure, but it is not Apple identity verification. | `app/src-tauri/tauri.conf.json`; README "macOS install and Gatekeeper"; `docs/product-specs/2026-07-12-v0.2.16-open-source-release.md`; `docs/releases/v0.2.16.md` | Desktop app expands beyond the approved small/open-source audience or must remove the manual Gatekeeper step → buy Apple Developer Program, add Developer ID signing + `notarytool` notarization + stapling to the macOS release jobs. |
| macOS in-app auto-update deferred (UI gated) | `latest.json` only carries Windows platform entries and the macOS jobs upload DMGs without `.app.tar.gz` updater artifacts. The UI now gates on `get_update_delivery`: macOS skips the silent check and shows a "前往下载页" action instead of falsely reporting "up to date". Real in-app auto-update is still not wired. | `app/src-tauri/src/updates.rs` (`get_update_delivery`), `app/src/features/updates/useAppUpdateController.ts`, `.github/workflows/desktop-release.yml` | Publish signed `.app.tar.gz` + `.sig` from the macOS jobs and merge `darwin-x86_64` / `darwin-aarch64` entries into `latest.json`, then flip `in_app_updates` on for macOS. Works even ad-hoc-signed because updater downloads bypass Gatekeeper quarantine. |

2026-07-03 note: ad-hoc signing avoids the non-recoverable damaged-app path only when the signed `.app` is not modified after signing. The release workflow now runs packaged-runtime smoke tests with `PYTHONDONTWRITEBYTECODE=1`, rejects `__pycache__` / `.pyc` files inside packaged resources, and verifies `codesign --deep --strict` before creating the DMG.

## Recently Closed

| Topic | Evidence | Closed |
|------|----------|--------|
| GitHub Actions Node.js 20 action runtime warning | Checkout v5, setup-node v5, immutable setup-uv v8.3.2, and upload-artifact v6 use Node.js 24. Contract tests passed 6/6; final hosted ProcessSupervisor run `29199050303` and Intel acceptance run `29199051507` passed at `04b2a92` with no Node.js 20 annotations. No Desktop Release was triggered. | 2026-07-12 |
| Automated React/UI smoke coverage missing | `app/tests/app-input.browser.test.ts` now drives the real React tree through isolated CDP pages and a deterministic test-only Tauri bridge. It covers settings loading/failure/cache clearing; history selection during processing, retry, and cancelling; stable restore and stale transcript-save isolation; and separate summary/insights confirmation targets. Focused browser 16/16 and full app 211/211 passed. | 2026-07-11 |
| macOS process-group cancellation native-host verification | Read-only run `29108659472`, job `86415372457`, at `b3cc6b3e2fc0ed31b98deeecb5ae7f6917de6d58` passed the complete 90-test Cargo suite on `macos-latest`; the log explicitly records `unix_termination_stops_a_parent_and_child_in_the_managed_process_group ... ok`. Linux is not a supported release target. | 2026-07-11 |
| Raw source URL in worker command line | Production process-video, source-identity preflight, and retry requests now use fixed argv mode flags plus a capped one-shot stdin payload. Rust command-spec and real-child probes verify the sensitive fixture reaches stdin but not argv/environment/log output; worker CLI tests cover bounded safe parsing and non-echoing failures. | 2026-07-10 |
| Historical InsightFlow LLM live smoke | Closed by the 2026-06-17 smoke, but the project-root `.env` path is now retired. Current live LLM validation must use FrameQ server Admin Web config plus server-managed checkout; desktop `.env` is limited to non-LLM local settings. | 2026-06-17 |

## Debt Handling Rules

- Add debt here when it spans more than one file or more than one task.
- Remove or downgrade debt when a change clearly addresses it.
- Link back to the plan, design doc, or code path that best explains the issue.
