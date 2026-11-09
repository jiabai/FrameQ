# Tech Debt Tracker

Last updated: 2026-11-10

## High Priority

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| System WebView platform acceptance | Independent system-WebView hosts, version 2 article handoff and browser-component retirement are implemented. Windows Runtime 156.0.4314.58 passed real static/JavaScript saves, recovery, SDK cancellation, close/reopen, old-note reading and optimized installer/startup; final installed acceptance preserved all 53 prior task files and reopened the exact requested article. Product commit ff225385312e735d7cbe9d01e230646b450b80d6 passed macOS Intel/Apple Silicon native suites, real static/JavaScript note saves/reopening, packaged runtime imports, strict ad-hoc application signatures, and final read-only DMG/helper/resource checks in hosted run 42017205151. Graphical macOS, Gatekeeper/permission interaction and remaining security canaries are unverified. Ordinary system WebView APIs do not provide a complete private-network firewall or uniform system-process control. | `docs/product-specs/2026-11-01-web-page-notes.md`; `docs/exec-plans/completed/2026-11-05-release-readiness-plan.md` | Complete graphical macOS acceptance and platform-specific authentication, permission, file/account and private-network/WS/RTC canaries. Re-run the complete three-locale interaction matrix and old migration-phase combinations. Retain old control-file compatibility; do not publish the retired Chromium component. Paid supplier testing remains skipped by the user. |

## Medium Priority

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| Three runner lifecycle tests are timing-sensitive on the hosted Windows runner | `worker_runtime::runner::tests::lifecycle::web_cancellation_reaps_real_root_and_pipe_inheriting_descendant`, `web_root_success_without_protocol_still_reaps_inherited_pipe_descendant`, `web_root_crash_reaps_inherited_pipe_descendant_before_readers_join` and `watchdog::endless_validated_progress_cannot_extend_the_absolute_deadline` assert wall-clock bounds (`started.elapsed() < 10s`, `Instant::now() < deadline`). Native run `42658397616` failed exactly these four with 556 passed; `gh run rerun --failed` passed the whole job, and the rename that triggered the run touched no runner logic. | `app/src-tauri/src/worker_runtime/runner/tests/lifecycle.rs`; `app/src-tauri/src/worker_runtime/runner/tests/watchdog.rs` | Replace the wall-clock assertions with event signals from the supervisor (child reaped, lane cleared), and reopen only if a rerun still fails. |
| `TaskComposer` focus-restore assertion flakes on the hosted macOS runner | `app/src/features/workflow/TaskComposer.test.tsx:201-211` asserts `document.activeElement` once, immediately after the failure alert text appears. During the v0.5.1 gate (Native run `42601635875`, `Desktop checks (macos-latest)`) the alert matched while focus was still on `body`, producing `AssertionError: expected <body>… to be <button …>`. The ship set contained no frontend change, and `gh run rerun --failed` passed all four jobs, so this is timing rather than a product regression. | `app/src/features/workflow/TaskComposer.test.tsx` | Move the focus assertion inside `waitFor`, or expose an explicit signal emitted after the restore effect, and reopen only if a rerun still fails. |
| Douyin share page attempt count is an unvalidated judgment call | `SHARE_PAGE_ATTEMPTS` is three, derived from a measured one-in-three degradation rate with a worst case of roughly 20 seconds of added latency. The change reached `main` on 2026-09-16 and no desktop release contains it yet, so the constant has no field data behind it. | `docs/exec-plans/completed/2026-09-16-douyin-share-page-retry-plan.md` | Ship it in a desktop release, then revisit the constant if field reports still show share page failures. |
| Douyin stream download budgets are reasoned defaults | The 60-second no-progress budget, the one-resume-per-candidate policy, and the 8 MB progress interval come from the 2026-10-22 field report rather than measurements across networks. v0.4.2 shipped them on 2026-10-23 and no field feedback exists yet, so a too-tight budget would surface as premature `DOUYIN_STREAM_DOWNLOAD_FAILED` on slow connections while a too-loose one restores long silent waits. | `worker/worker_core/douyin/transport.py`; `worker/worker_core/douyin_fallback.py`; `docs/exec-plans/completed/2026-10-22-douyin-stream-download-reliability-plan.md` | Collect field reports from v0.4.2 onward; revisit the three constants only if users report premature failures or silent waits, and add a stall-frequency diagnostic when the download path next changes. |
| `app-input.browser.test.ts` is intermittently flaky on a timing-sensitive assertion | The locale-freeze test waits on `window.__APP_UI_SMOKE__.pending.save_default_generation_preferences?.length === 1`, and under CPU contention the React update does not land inside the wait budget. During the v0.3.7 release gate the same file content produced both `1 failed / 33 passed` and `34 passed` on separate runs, with the activation copy reverted and applied, so the flake is content-independent. It cost release-gate reruns and could either mask a real regression or falsely block a release. A second flake facet was observed on 2026-10-10 during the draft-generation merge: `AnimatedSheet` unmounts on `onAnimationComplete`, so a still-closing sibling confirmation sheet (same `.preference-flow-sheet` class, earlier DOM order) could capture a class-scoped `.sheet-footer .primary-button` click and misroute it; scoping clicks by aria-label (`[aria-label="確認靈感啟發"] ...`) removed the ambiguity, but the component's animation-callback-dependent unmount remains load-sensitive. On 2026-10-22 the wait was changed to poll every 20 ms with an 8 second default budget, and the reasoning lives in a comment next to the constants. Four consecutive runs of the file, 34 tests each, passed in 24 to 26 seconds against roughly 52 seconds before, because the tighter poll resolves conditions earlier instead of sleeping through the window. **Rechecked 2026-11-09:** the file has since been rewritten as five storage-unavailability boundary cases; the locale-freeze wait on `window.__APP_UI_SMOKE__.pending.save_default_generation_preferences` no longer exists anywhere in `app/tests/`, and `__APP_UI_SMOKE__` now appears only as a negative assertion in `app-input.browser.test.ts` plus the mock bridge. The generic `waitFor` helper at `app/tests/support/productionBrowser.ts:147-155` still polls every 25 ms with an 8-second budget, so only that optional event-driven improvement remains; no currently failing assertion depends on it. | `app/tests/app-input.browser.test.ts`; `app/src/features/modal/AnimatedSheet.tsx`; `docs/exec-plans/completed/2026-10-10-draft-generation-anysearch-merge-plan.md` | Optional: replace the generic `waitFor` polling loop with an event-driven signal and make sheet action targeting independent of unmount timing. Reopen only if a new flake appears in the rewritten browser suite; the 2026-10-22 budget and interval change already removed the missed-window failure mode. |
| The dev app-data directory was wiped once by the host environment, not by Locus | On 2026-10-22 between 13:44 and 14:05 the whole `%LOCALAPPDATA%\pro.8xf.app` tree disappeared: model cache, task records, and session, with nothing in the Recycle Bin. No Locus code path deletes that root. An instrumented dev run with an incremental build did not reproduce it, and the WebView2 crash dumps from the same session show the WorkBuddy sandbox DLL (`tsbx.dll`) loaded into the browser process, so the evidence points at the host tooling rather than this repository. `scripts/snapshot-appdata.mjs` now copies `.env`, `ui-preferences.json`, `auth/`, and `outputs/**/*.json` into `build/appdata-snapshot/` before a dev run, keeping the five most recent. | `scripts/snapshot-appdata.mjs`; `app/package.json`; investigation on 2026-10-22 | Reproduce the wipe with the host tooling detached, or get confirmation from the host vendor; then either fix the cause or retire the mitigation. |

## Completed / Resolved

### Windows Installer Preflight and Step Log

- Status: resolved on 2026-11-09.
- Resolution: `app/src-tauri/windows/installer-hooks.nsh` now measures free space on the `$INSTDIR` volume with `FileFunc`'s `${DriveSpace}` and probes `$INSTDIR` for writability before the first payload write, then appends a fixed-format step log to `$TEMP\install.log` (reset when it exceeds 64 KB). Interactive installs get one Chinese message naming the failed check, the numbers or path, and the log path, then `Abort` returns to the components page; silent, passive and `/UPDATE` runs log and continue. The 2026-10-20 security-software advisory still runs first and stays advisory.
- Evidence: the Tauri-bundled `makensis` compiled the hook file with no warnings in a harness that mirrors the template include order, and three silent harness runs produced `freespace result=ok free_mb=95717 required_mb=1080` + `writability result=ok`, `writability result=fail` for `C:\Windows\System32\app-deny-probe` (confirmed unwritable by the shell), and `freespace result=fail free_mb=95716 required_mb=976818` with `ESTIMATEDSIZE=999999999`; none of the three blocked. The logged free-space figure matched PowerShell's 95,718 MB for the same volume. Recompiling the real 2026-11-05 `installer.nsi` (v0.4.3 defines) with the edited hook produced a 209,808,676-byte installer in 9m40s with no warnings.
- Boundary: an inconclusive probe (missing path, failed `${DriveSpace}`) is treated as a pass, matching the advisory precedent. `SetOutPath` only sets the error flag on an unwritable directory, so the probe still runs and reports; a per-machine install elevates and would pass. The installer produced here is unsigned and unpublished, and the interactive dialog itself was not exercised because it needs a human at the screen. Payload trimming stays conditional on future field reports.
- Plan: `docs/exec-plans/completed/2026-11-09-windows-installer-preflight-plan.md` (archived 2026-11-09).

### Douyin Share Page Retry Diagnostic Visibility

- Status: resolved on 2026-11-09.
- Resolution: the worker already reported `douyin.page.retrying` through the closed progress contract; the desktop dropped it for diagnostics because the desktop log only recorded its own whitelisted events. `app/src-tauri/src/worker_runtime/runner/progress.rs` now recognizes that one message code when routing a validated progress event and appends a fixed desktop log record `worker.douyin.share_page.retry`; `app/src-tauri/src/diagnostics/export.rs` whitelists it as `worker_douyin_share_page_retry`. The exported `desktop.log` therefore carries one record per retry, so a first-try success is distinguishable from a run that needed one or two retries.
- Evidence: `cargo test --lib share_page` reported 2 passed, one being a real `ProcessVideo` run whose stderr carries a contract-valid `douyin.page.retrying` event (desktop log gains `event=worker.douyin.share_page.retry`) and one control run with `video.download.preparing` (no such record). Full `cargo test --lib` reported 510 passed / 50 failed / 29 ignored against a `git stash` HEAD baseline of 508 passed / 50 failed / 29 ignored; all failures sit in the `data_storage`, `history_deletion` and `web_page` file-permission suites, no `progress`, `diagnostics` or `export` case fails, and a representative failure reproduced identically at HEAD.
- Boundary: the record proves a retry happened and nothing more; `attempt`/`total`, the randomized delay and the URL are deliberately not persisted, so the count of exported records is the only signal. No `APP_DIAGNOSTIC` DTO change, no contract version bump and no worker change were needed, and ordinary worker stderr remains persisted only for model downloads. The 50 script-created workspace failures are a host ACL/scanner artifact of this Windows machine, not a code baseline; they were present before this change.

### Markdown Splitter Child Process Test Flake

- Status: resolved on 2026-11-09.
- Resolution: `worker/tests/test_insights.py` waits on two child signals instead of a fixed `join(4)`. A `started` message bounded by 30 seconds covers spawn interpreter startup; the result bounded by 10 seconds covers only the splitter itself. Both waits terminate the child and raise an explicit `AssertionError` on timeout, so deadlock detection for a splitter that never advances is retained. A new regression case starts a genuinely stalled child with a 0.2-second result budget and asserts it is reported and terminated.
- Evidence: local spawn-to-first-signal measured 0.19 / 0.27 / 0.19 seconds across three runs, while hosted CI `42044874583` attempt 1 exceeded the old four-second budget under load. `uv run ruff check worker` clean; `uv run pytest worker/tests/test_insights.py -q` 13 passed; `uv run pytest worker/tests -q` 1276 passed / 4 skipped; `node --test scripts/tests/*.test.mjs` 57 passed; `uv run python -m pytest scripts/tests -q` 1 passed.
- Boundary: the 30-second startup budget is a generous upper bound, not a measured CI worst case; a hung interpreter is still terminated and reported. The `.pytest_cache` write-permission warning seen in these runs is unrelated.

### Bounded yt-dlp Download Execution

- Status: resolved on 2026-11-09.
- Resolution: `worker/worker_core/media.py` applies a 20-minute `subprocess.run` budget only to commands shaped `sys.executable -m yt_dlp ...`. `ffprobe` and `ffmpeg` keep their existing execution. On expiry `run_command` returns a `VIDEO_DOWNLOAD_TIMEOUT` result and `download_video` raises immediately, skipping subtitle retry, the YouTube single retry and all platform fallbacks; `MediaPreparationFacade` reports it through the existing `VIDEO_DOWNLOAD_FAILED` path with no new frontend code.
- Evidence: `uv run ruff check worker` clean; `uv run pytest worker/tests/test_media.py` 40 passed, including five new cases with one real hung child process terminated inside a short injected budget; `uv run pytest worker/tests` 1275 passed / 4 skipped; `node --test scripts/tests/*.test.mjs` 57 passed; `uv run python -m pytest scripts/tests` 1 passed; `validate_agents_docs.py --level WARN` 0 errors / 0 warnings; `git diff --check` clean. A real `yt-dlp 2026.10.21` child completed `run_command` with returncode 0 under the 1200-second default budget.
- Boundary: the public-network YouTube download regression passed on 2026-11-09 with `https://www.youtube.com/shorts/nnV9a4w2WjQ` (`returncode=0`, 1,557,058 bytes / 59.44 s, av1 video + aac audio by `ffprobe`). The earlier `502 Bad Gateway` came from the WorkBuddy session proxy being read inside `uv run`, not from the download code; see the archived plan for the reusable proxy fix. Python terminates the yt-dlp parent only, so an ffmpeg merge child may briefly remain until the desktop `ProcessSupervisor` terminates the worker tree. A fixed budget can end a very slow large download early.
- Plan: `docs/exec-plans/completed/2026-11-09-bounded-ytdlp-download-plan.md` (archived 2026-11-09 after the public YouTube download regression passed).

### Hosted Linux Server Signal Evidence

- Status: resolved on 2026-11-05.
- Resolution: final product commit `ff225385312e735d7cbe9d01e230646b450b80d6` passed Native,
  Script, and Hosted Linux Server CI. Server run `42017204288` passed 400 tests, eight migrations,
  preflight, TypeScript build, and isolated restore. Its real POSIX child-process test verified
  SIGTERM, clean exit, draining events, and release of the listening port; a separate lifecycle
  test used a real Prisma client and SQLite file to verify disconnection.
- Boundary: the signal fixture records its disconnect event; the real Prisma test is independent.
  Production SMTP, systemd/Nginx, off-host backups, and deployment recovery retain the existing
  2026-09-19 acceptance records and were not rerun in this task.
- Evidence: `server/tests/lifecycle.test.ts`; hosted run
  `https://github.com/jiabai/FrameQ/actions/runs/42017204288`;
  `docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md`.

### Pinned yt-dlp Drift and Real Download Acceptance

- Status: resolved on 2026-11-05.
- Resolution: the weekly local check compares the locked version against PyPI and distinguishes
  version drift from an unavailable feed. The locked `2026.10.21` runtime completed the requested
  public YouTube download through the actual native application.
- Evidence: task `20261105-071421-youtube-RmnWHz8HD74` completed download, media validation,
  86:01.61 audio recognition, 15,085 transcript words, and 300 timestamped segments. Runtime wheel
  identity was checked against `uv.lock`; acceptance is recorded in
  `docs/exec-plans/completed/2026-11-05-processing-workspace-plan.md`. Each future pin upgrade
  continues to require a real download check.

### YouTube Rejection Reason Codes

- Status: resolved on 2026-10-20.
- Resolution: `classify_youtube_download_failure` separates HTTP 429 into `YOUTUBE_RATE_LIMITED`
  before the login branch, and a marker-free HTTP 403 into `YOUTUBE_STREAM_FORBIDDEN` after the
  private/unavailable branch. Both codes are registered in `VIDEO_DOWNLOAD_REASON_CODES`, mapped in
  `VIDEO_DOWNLOAD_REASON_MESSAGE_CODES`, and carry copy in `zh-CN`, `zh-TW`, and `en-US`. The single
  retry covers `YOUTUBE_DOWNLOAD_FAILED` and `YOUTUBE_STREAM_FORBIDDEN`; `YOUTUBE_RATE_LIMITED`
  returns immediately.
- Evidence: worker `test_media.py` 34 passed, app `workerErrorCopy` 63 passed, and two ordering
  guards pin the precedence decisions. Ruff, app lint, and the docs governance gate are clean.
  Plan: `docs/exec-plans/completed/2026-10-20-youtube-rejection-reason-codes-plan.md`.

### Python Worker Application Facade and CLI Boundary

- Status: resolved on 2026-07-24.
- Resolution: `cli.py` is a 176-line process adapter without compatibility exports, broad wrappers,
  or production factories; `worker_service.py` is a 25-line exact five-function direct-import
  facade; five private handlers and one defaults owner contain application composition; AI retry
  uses `TaskPaths` fields directly.
- Evidence: seven TDD slices captured characterization and boundary RED before implementation;
  complete Worker 600 passed / 2 skipped, Ruff, repository scripts 27/27, Tauri release
  `--no-bundle`, governance, diff, and 70-file canonical/mirror byte equality passed. Exact-tree,
  dependency, factory-owner, direct-reexport, and typed-path gates prevent regression. Design and
  archived execution evidence:
  `docs/design-docs/2026-07-24-python-worker-application-facade.md` and
  `docs/exec-plans/completed/2026-07-24-python-worker-application-facade-plan.md`.

### ASR Model Download Process Capability

- Status: resolved on 2026-07-24.
- Resolution: `asr_model.rs` submits only an opaque four-value `AsrModelDownloadJob`;
  `worker_runtime::command` owns the complete fixed command policy; `ProcessSupervisors` derives the
  operation, progress route, and private model lane; raw `WorkerCommandSpec` and
  `WorkerRunRequest` no longer cross the runtime boundary.
- Evidence: three captured RED/GREEN slices; command 7/7, ASR 7/7, runtime 63/63, complete Rust
  226/226, App 637/637, scripts 27/27, frontend/Tauri release builds, rustfmt, governance, and diff
  gates pass. The source-ownership test prevents raw type/re-export/CLI ownership regression.
  Design and archived execution evidence:
  `docs/design-docs/2026-07-24-asr-model-download-job-capability-boundary.md` and
  `docs/exec-plans/completed/2026-07-24-asr-model-download-job-capability-plan.md`.

### General Tauri IPC Runtime Decoding

- Status: resolved on 2026-07-24.
- Resolution: five Locus-owned client domains now receive `Promise<unknown>` and decode closed
  top-level and nested DTOs through domain-owned parsers. The shared primitive only performs safe
  data-property inspection and emits stable non-echoing domain codes; specialized worker,
  local-media, UI-preference, model-download, and cancellation protocols remain unchanged.
- Evidence: focused App 64/64, full App 637/637, Rust 223/223, repository scripts 27/27, lint,
  build, rustfmt, governance, and diff checks pass. The explicit source-boundary test keeps generic
  `invoke<T>`, direct response assertions, and non-`unknown` runners out of the reviewed clients.
  Design and archived execution evidence:
  `docs/design-docs/2026-07-24-tauri-ipc-runtime-decoding-boundary.md` and
  `docs/exec-plans/completed/2026-07-24-tauri-ipc-runtime-decoding-plan.md`.

### Server Production Operations — Local Implementation

- Status: implementation and disposable local rehearsal complete; external release evidence remains
  in High Priority and the ExecPlan intentionally stays active.
- Resolution: production runtime config/SMTP fails closed, console OTP is explicit non-production
  only, Fastify logs closed fields with generated request IDs, proxy trust is loopback-only, health
  and bounded lifecycle have dedicated owners, and deployment uses reviewed migrations plus
  preflight/WAL-safe backup/read-only restore/rollback contracts and a path-filtered Server CI.
- Evidence: secret-seeded log/response tests, IPv4/IPv6 proxy tests, health/lifecycle tests, real
  listener and SQLite release, migrated-schema readiness, disposable fresh/baseline/invalid/restore
  checks, Prisma generation, 142 passing Server tests plus one Windows-only POSIX-signal skip,
  TypeScript build, 25/25 repository scripts, governance, and diff checks pass locally. The real
  POSIX child signal test remains mandatory in hosted Linux CI.

### Server Authentication and AI Credit Concurrency

- Status: implemented and locally verified; production operations remain a separate release gate.
- Resolution: purpose-scoped OTP issuance and database dispatch limits, atomic attempt/artifact and
  ticket/session operations, and conditional quota/event checkout now live behind semantic Store
  outcomes with MemoryStore parity and bounded recognized-conflict retry.
- Evidence: baseline plus forward migration fixtures pass fresh/existing/invalid/restore/status
  cases; independent Prisma-client concurrency and failure injection pass; complete server suite is
  97/97 and TypeScript/Prisma generation gates pass.

### P1 Supervised Worker Watchdog

- Status: completed; feature branch ready for integration.
- Resolution: Every current supervised Rust operation derives a fixed idle/absolute policy from
  `WorkerOperation`. An instance-bound watchdog can terminate during blocked stdin delivery or
  wait, reuses the process-tree boundary, preserves structured-result/cancellation precedence, and
  returns closed localized timeout outcomes without automatically retrying AI.
- Evidence: worker-runtime 56/56, complete Rust 208/208, App 567/567, worker 563 passed / 2 skipped,
  scripts 25/25, Chromium smoke 28/28, lint, Ruff, rustfmt, build, and Tauri `--no-bundle` passed.
  The native Windows fixture removed the worker parent and descendant and admitted a second task.
- Residual risk: no macOS host was available for this implementation session. The portable fixture
  is required by the hosted macOS full-Cargo workflow, but actual runtime evidence remains pending.
  If an OS tree-termination primitive refuses or itself fails to return, Locus keeps the instance
  supervised and cannot promise a bounded exit without falsely claiming cleanup.

### P1 Atomic Authoritative Persistence

- Status: completed and merged to `main` at `61d489a`.
- Resolution: All Locus-owned authoritative transcript, AI, preference, manifest, and Rust
  transcript-edit writers use reviewed same-directory atomic replacement. Existing-task multi-file
  updates use the closed prepared/committed journal and recovery-before-read boundary in Python and
  Rust.
- Evidence: Worker 563 passed / 2 skipped, App 551 passed, Windows Rust 185 passed, scripts 25
  passed, packaged-worker 63-file equality and Tauri `--no-bundle` passed; the implementation plan
  is archived at `docs/exec-plans/completed/2026-07-22-atomic-persistence-hardening-plan.md`.
- Residual risk: macOS/Unix native permission, symlink and forced-exit fixtures plus real Tauri
  transcript/AI smoke were unavailable and remain explicitly unverified. External programs that
  bypass Locus task access are outside the transaction guarantee.

### P1 Frontend Transcript Controller Ownership

- Status: completed and verified on isolated branch `codex/transcript-controller-split`.
- Resolution: the former 509-line mixed transcript-detail hook is now a 126-line stable facade.
  Artifact-detail actions, task-scoped document persistence, and browser audio/edit review live in
  focused 139/199/250-line private owners. The 41-key public surface, presentation consumers,
  task-stale guards, IPC, paths, localized notices, and workflow task owner remain unchanged.
- Evidence: characterization grew from 4 to 18 tests before extraction; final facade 19/19,
  ownership 1/1, selected Chromium 4/4, complete App 583/583, repository scripts 25/25, lint,
  build, governance, protected-scope diff, and whitespace checks passed. The source boundary
  enforces owner existence, dependency direction, stable consumers, `ReturnType`, and size limits.
- Residual risk: native Tauri load/play/edit/save smoke was not rerun because no native IPC, asset
  scope, permission, or packaged-runtime code changed. The review owner sits exactly at the
  approved 250-line ceiling and must not absorb unrelated transcript-document or artifact actions.

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
- Download strategy cleanup: `worker/worker_core/media.py` now drives platform fallback dispatch through `DownloadStrategy` and `FALLBACK_DOWNLOAD_STRATEGIES`. The fallback order remains Douyin -> Xiaohongshu -> Bilibili, and YouTube keeps the existing yt-dlp failure classification path.
- Evidence: commits `4dcb5c9`, `acb6e16`, `f8409e9`, and `3a60dc6`; stage review passed `uv run pytest worker\tests` with 154 tests, `uv run ruff check worker`, and `git diff --check`.
- Next-stage recommendation: run real platform smoke for Douyin / Xiaohongshu / Bilibili / YouTube with stable public samples; re-evaluate `download_strategies.py` only before adding another platform or when the strategy table grows; keep worker tests plus ruff as the refactor gate.
- Residual risk: accepted as tracked deferred debt below rather than continuing P2 worker/media micro-splitting.

### Manual Audio Playback Cache Management

- Status: completed.
- Resolution: Settings now shows the app-local audio playback cache size and provides a clear action backed by canonicalized Tauri commands.
- Safety boundary: clearing removes only app-local `cache/.app-audio-review`, preserves source task artifacts under `<APP_OUTPUT_DIR>/tasks/<task_id>/`, and the cache regenerates when transcript detail is opened again.
- Evidence: `app/src/App.tsx`, `app/src/settingsClient.ts`, `app/src-tauri/src/settings.rs`, `app/src-tauri/src/transcript_detail.rs`, and focused audio cache tests.

### Live Activation Email Path

- Status: resolved on 2026-09-19.
- Resolution: the self-service activation path was executed end to end against production with a
  real test mailbox, covering the three things that no earlier evidence had exercised -- minting a
  code, delivering the activation email, and the redeem-once semantics that follow it.
- Evidence: `POST /auth/email/start` 200, `POST /auth/email/verify` 200, `POST
  /api/desktop/sessions/exchange` 200, and `GET /api/desktop/account` reporting
  `entitlement_status=inactive` with `can_request_activation_code=true`. `POST
  /api/desktop/activation-codes/request` returned 200, wrote `sentAt`, and moved the ledger from
  zero to one `self_service_email` code; the delivered code was legible in the mailbox. `POST
  /api/desktop/activation-codes/redeem` returned 200 and the same response flipped the account to
  `entitlement_status=active`, `can_process=true`, and `can_generate_ai=true`. The persisted
  entitlement is `status=active`, `llmQuotaLimit=20`, `llmQuotaUsed=0`,
  `expiresAt - redeemedAt = 31 days`, and `redeemBy - sentAt = 30 days`. Replaying the consumed
  code and redeeming an unknown code both returned 400 with the same generic message, confirming
  single-use enforcement and the absence of an oracle.
- Scope note (2026-11-09): this resolution covers the production happy path only, from authenticated
  OTP login through request, inbox delivery, redemption and entitlement persistence, plus consumed-code
  replay and unknown-code rejection. It does not cover the three-locale template inspection, live
  `409`/`429` plus `Retry-After`, Admin Web activation-code metadata and plaintext checks,
  administrator login, or post-login dynamic log redaction. `TASKS.md` still tracks those as
  remaining acceptance items; the 2026-08-24 and 2026-09-19 archived plans keep their original
  "still open" wording as the historical record of that day's state.

## Accepted / Deferred

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| App-local generation preferences are not key-exact | TypeScript `validateGenerationPreferences` validates the six known values but does not reject additional own keys, and the nested Rust `GenerationPreferences` DTO lacks `deny_unknown_fields` (the top-level `InsightPreferencesFile` already has it); a valid six-step object with an extra property is therefore accepted and later serialized without that property. This state never crosses the strict worker snapshot and does not reintroduce Profile style/avoid ownership, but tightening released v1/v2 file handling could change recovery or migration outcomes. | `app/src/insightPreferences.ts`; `app/src-tauri/src/insight_preferences.rs`; completed Inspiration Profile v2 boundary ExecPlan | Add TypeScript exact-key acceptance/rejection tests and Rust v1/v2 extra-key migration/recovery tests, define whether the affected default alone is cleared or the file is reset, and prove an extra generation-preference key cannot cause collateral reset of an otherwise valid profile before tightening both boundaries together. |
| Preference label IDs permit whitespace-only JSON-schema strings | Runtime TypeScript/Rust/Python boundaries close label field identities and require label values to be strings, but the shared JSON schema currently expresses label IDs with `minLength: 1` rather than a non-whitespace pattern. Current option IDs are fixed safe registries and producer tests prevent a practical malformed ID, so this does not weaken the six-field profile or seed boundary; it is a schema precision mismatch. | `contracts/desktop-worker-contract.json`; `app/src-tauri/src/video_processing/retry_insights.rs`; `worker/worker_core/requests.py`; completed Inspiration Profile v2 boundary ExecPlan | Tighten the shared label-ID schema and all three runtime validators together, with cross-language whitespace-only RED tests, when the label snapshot contract next changes. |
| Permanent task deletion can partially complete | The user explicitly chose immediate irreversible disk release. Recursive directory removal is not transactional, so file locks, permissions, interruption, or storage errors may leave a supported task partially deleted. The product must report actual failure and never promise rollback. | `docs/product-specs/2026-07-12-history-task-permanent-deletion.md`; active deletion ExecPlan | Revisit only if the product adopts system Trash, an app-owned retention area, or a transactional storage layer; otherwise retain fault injection and truthful failure copy. |
| Ambiguous pre-transaction activation/admin entitlement history requires manual repair | Old sequential writes can leave a redeemed activation code without a deterministically attributable entitlement, or entitlement changes with no audit. Automatic compensation could double grant access or quota. | `docs/product-specs/2026-07-10-server-entitlement-transaction-safety.md`; server transaction-safety ExecPlan | Run the bounded detection checks, repair confirmed incidents through the audited `manual_repair` adjustment path, and retain evidence per support incident. |
| Raw source remains transient in process and pipe memory | Worker request JSON no longer enters argv or environment variables, but a sufficiently privileged local debugger, process-memory dump, or OS crash dump may capture the value while it exists in desktop memory, the stdin pipe buffer, or worker memory. This is outside Locus persistence/logging and cannot be eliminated while the downloader needs the original request. | `app/src-tauri/src/worker_runtime/command.rs`; `app/src-tauri/src/worker_runtime/runner.rs`; `worker/worker_core/cli.py`; `docs/product-specs/2026-07-10-source-url-privacy-boundary.md` | Keep lifetimes bounded, never persist/log payloads, and evaluate OS-protected inherited handles or crash-dump exclusion only if the threat model expands beyond same-user local process isolation. |
| Unsupported legacy task data remains physically present | Product policy deliberately rejects schema v1/v2, missing-marker, quarantined, malformed, invalid-identity, and linked tasks without migration, repair, rename, indexing, scanning, or deletion. Those directories may still contain raw URLs or sensitive historical fields, but no product history/cache/detail/edit/retry path may read or expose them. | `docs/product-specs/2026-07-11-history-vnext-strict-boundary.md`; `docs/SECURITY.md` | This is an accepted retention boundary, not a future compatibility project. Users who need the files may back them up or delete them manually outside Locus; revisit only through a new explicit product/security decision. |
| App shell glue remains after P2 | `App.tsx` still owns app startup/deep-link effects, `openCard` / `locateArtifact`, global `actionNotice`, and top-level Sheet/Flow composition. This is acceptable for a composition root but should not grow new feature state. | `app/src/App.tsx`; P2 commits listed above | Keep new feature state/actions in focused controllers. Revisit only if App shell glue starts accumulating business rules again. |
| History loading request ordering remains deferred | Controller-owned history restoration now rejects active task switches and invalidates stale worker callbacks, but `useHistoryController` still has no request ordering for concurrent or repeated panel-open fetches. Current behavior is simple enough to defer until history loading gains cancellation, request ordering, or more complex state rules. | `app/src/features/history/useHistoryController.ts`; `app/src/features/history/useHistoryController.test.ts`; `docs/product-specs/2026-07-10-history-task-restore-ownership.md` | Add focused hook tests and request sequencing for duplicate open calls if history loading behavior becomes more complex. |
| Lightweight hook harness coverage remains partial | Focused controller unit tests still use a minimal Vitest `useState` / `useCallback` harness. The new CDP smoke now covers real React scheduling/DOM wiring for the main settings, history, transcript-save, cancellation, and AI target paths, but it does not cover every controller error branch, keyboard/focus permutation, or native Tauri WebView behavior. | `app/src/features/history/useHistoryController.test.ts`; `app/src/features/settings/useSettingsController.test.ts`; `app/src/features/insightPreferences/useInsightGenerationController.test.ts`; `app/tests/app-input.browser.test.ts` | Add a smoke only when a remaining high-risk interaction depends on real React/DOM semantics; use packaged/native Tauri validation for WebView, OS dialog, filesystem, and installer behavior rather than expanding the mock browser into a full E2E framework. |
| Real platform download smoke coverage remains manual | Unit tests cover worker pipeline/media contracts, fallback dispatch, and error mapping, but real Douyin, Xiaohongshu, Bilibili, and YouTube pages/APIs can change outside the repository. | `worker/worker_core/pipeline_runtime/orchestration.py`; `worker/worker_core/media.py`; P2 worker/media stage review | Run real platform smoke with one stable public sample per platform before risky download changes or release validation. |
| Download strategy table remains in `media.py` | `DownloadStrategy` centralizes platform fallback dispatch, but `media.py` still imports platform fallback modules and their error types. This is acceptable while the strategy table is small. | `worker/worker_core/media.py` | Re-evaluate extracting `worker/worker_core/download_strategies.py` only when adding another platform or when the strategy table starts carrying more platform-specific behavior. |
| Frontend/worker URL support rule drift | `app/src/urlSupport.ts` and `worker/worker_core/media.py` both encode platform URL support rules across TypeScript UI validation and Python worker download capability. This is a cross-language/process contract concern; changing it can alter user-visible input acceptance. | `app/src/urlSupport.ts`; `worker/worker_core/media.py`; `worker/worker_core/*_fallback.py` | Add a shared platform URL support contract and dual frontend/worker contract tests, or at minimum drift-detection tests, before changing platform URL admission behavior. |
| `pydub` / `audioop` Python 3.13 compatibility watch | Worker tests pass on Python 3.12, but the suite emits a `pydub.utils` `audioop` deprecation warning; Python 3.13 removes `audioop`. | `worker/tests/test_asr.py`; `pydub` dependency warning during `uv run pytest worker\tests` | Before moving the packaged worker runtime to Python 3.13, replace or upgrade the affected audio dependency path, or pin the runtime to a compatible Python version. |
| macOS notarization deferred | macOS DMGs are ad-hoc signed only (`bundle.macOS.signingIdentity = "-"`, `hardenedRuntime = false`), so first launch still shows a one-time Gatekeeper prompt that users must bypass manually. Full removal needs a paid Apple Developer ID + notarization. Ad-hoc signing is the approved free mitigation for personal-development, small-user, and open-source distribution and avoids the non-recoverable "app is damaged" failure, but it is not Apple identity verification. | `app/src-tauri/tauri.conf.json`; README "macOS install and Gatekeeper"; `docs/product-specs/2026-07-12-v0.2.16-open-source-release.md`; `docs/releases/v0.2.16.md` | Desktop app expands beyond the approved small/open-source audience or must remove the manual Gatekeeper step → buy Apple Developer Program, add Developer ID signing + `notarytool` notarization + stapling to the macOS release jobs. |
| macOS in-app auto-update deferred (UI gated) | `latest.json` only carries Windows platform entries and the macOS jobs upload DMGs without `.app.tar.gz` updater artifacts. The UI now gates on `get_update_delivery`: macOS skips the silent check and shows a "前往下载页" action instead of falsely reporting "up to date". Real in-app auto-update is still not wired. | `app/src-tauri/src/updates.rs` (`get_update_delivery`), `app/src/features/updates/useAppUpdateController.ts`, `.github/workflows/desktop-release.yml` | Publish signed `.app.tar.gz` + `.sig` from the macOS jobs and merge `darwin-x86_64` / `darwin-aarch64` entries into `latest.json`, then flip `in_app_updates` on for macOS. Works even ad-hoc-signed because updater downloads bypass Gatekeeper quarantine. |
| Web 宣传站 release metadata 手动同步 | 下载页版本号、平台下载链接、release notes 摘要硬编码在 `site/src/consts.ts` 与 `site/src/content/release-notes/`，新版本发布需手动更新并重新构建。宣传站为人工部署流程，不引入自动化。 | `site/src/consts.ts`; `site/src/content/release-notes/`; `docs/exec-plans/completed/2026-08-05-web-marketing-site-plan.md` | 维护人工更新流程：发布新版本时同步更新 `consts.ts` 版本号与下载链接，从 `docs/releases/` 复制 release notes 摘要到 content collection，重新构建并人工部署 `site/dist/`。 |
| Web 宣传站多语言缺失 | 首版仅中文。多语言切换需先建立翻译审阅流程（对齐 `docs/DESIGN.md` 简繁中文审阅规则）。 | `site/src/pages/*.astro`; `docs/exec-plans/completed/2026-08-05-web-marketing-site-plan.md` | 建立翻译审阅流程后，在 Astro 中引入 i18n routing（`src/pages/[lang]/`）与语言切换组件。 |
| Web 宣传站暗色模式缺失 | 首版仅亮色。暗色模式需 token 系统扩展 `[data-theme="dark"]` 与 `prefers-color-scheme` 媒体查询。 | `site/src/styles/tokens.css`; `site/src/styles/global.css` | 扩展 token 三层系统的 dark 变体，在 BaseLayout 添加主题切换脚本（首版不设 cookie，需评估是否破例）。 |
| Web 宣传站博客/changelog 自动同步缺失 | release notes 通过 content collections 手动同步，无自动拉取。博客功能未实现。宣传站为人工部署流程。 | `site/src/content.config.ts`; `site/src/content/release-notes/` | 维护人工同步流程：发布新版本时从 `docs/releases/` 复制 release notes 摘要到 content collection；如需博客功能，按需引入博客 content collection 与 RSS。 |
| Web 宣传站真实浏览器视觉验证未跑 | 自动化测试断言 HTML 结构与 token 使用，移动端用 browser subagent（Chromium 内核）验证。Firefox/Safari 跨内核视觉一致性、Lighthouse CLI 性能/SEO 审计未跑。V2 动效（视差/3D 倾斜/涟漪/鼠标跟随）在 Firefox/Safari 下的表现同样未实测。 | `docs/exec-plans/completed/2026-08-05-web-marketing-site-plan.md` Task 6; `docs/exec-plans/completed/2026-08-06-web-site-dynamic-enhancement-plan.md` Task 7 | 在发布前手动跑一次跨浏览器视觉回归（Firefox/Safari）与 Lighthouse CLI 审计，覆盖 V1 静态布局与 V2 动效两层；或在本地开发环境跑 Lighthouse。 |
| Short numeric one-time codes are stored as a bare single-round digest | `otpCode()` produces a six-digit numeric code and the store persists only `sha256(code)`, so the entire space is one million hashes and anyone who can read the database can recover a live login code in well under a second. Database read access is already a severe breach; the store keeps verification constant-time, attempt-bounded (`attempts < 5`), and scoped by purpose and state, and the same bare-digest pattern is harmless for activation codes with their eighty-bit space. | `server/src/security.ts`; `server/src/auth.ts`; `server/src/userAuth.ts`; `server/src/adminAuth.ts`; `server/src/prismaStore/auth.ts` | Revisit when a compliance obligation, a multi-tenant deployment, or a threat model that distinguishes database-only access from application-secret access appears. Until then keep the six-digit code, ten-minute validity, five-attempt bound, and constant-time verification unchanged. |

2026-07-03 note: ad-hoc signing avoids the non-recoverable damaged-app path only when the signed `.app` is not modified after signing. The release workflow now runs packaged-runtime smoke tests with `PYTHONDONTWRITEBYTECODE=1`, rejects `__pycache__` / `.pyc` files inside packaged resources, and verifies `codesign --deep --strict` before creating the DMG.

## Recently Closed

| Topic | Evidence | Closed |
|------|----------|--------|
| Web 宣传站部署 CI 未定 | 用户确认宣传站为人工部署流程，不引入 CI 自动化。`site/dist/` 产物由人工托管到任意静态站点服务；`astro.config.mjs` 的 `site` 字段在确认真实域名后人工更新。相关技术债（release metadata 手动同步、博客/changelog 自动同步、真实浏览器视觉验证）的 Removal Condition 已同步调整为人工流程。 | 2026-08-06 |
| GitHub Actions Node.js 20 action runtime warning | Checkout v5, setup-node v5, immutable setup-uv v8.3.2, and upload-artifact v6 use Node.js 24. Contract tests passed 6/6; final hosted ProcessSupervisor run `29199050303` and Intel acceptance run `29199051507` passed at `04b2a92` with no Node.js 20 annotations. No Desktop Release was triggered. | 2026-07-12 |
| Automated React/UI smoke coverage missing | `app/tests/app-input.browser.test.ts` now drives the real React tree through isolated CDP pages and a deterministic test-only Tauri bridge. It covers settings loading/failure/cache clearing; history selection during processing, retry, and cancelling; stable restore and stale transcript-save isolation; and separate summary/insights confirmation targets. Focused browser 16/16 and full app 211/211 passed. | 2026-07-11 |
| macOS process-group cancellation native-host verification | Read-only run `29108659472`, job `86415372457`, at `b3cc6b3e2fc0ed31b98deeecb5ae7f6917de6d58` passed the complete 90-test Cargo suite on `macos-latest`; the log explicitly records `unix_termination_stops_a_parent_and_child_in_the_managed_process_group ... ok`. Linux is not a supported release target. | 2026-07-11 |
| Raw source URL in worker command line | Production process-video, source-identity preflight, and retry requests now use fixed argv mode flags plus a capped one-shot stdin payload. Rust command-spec and real-child probes verify the sensitive fixture reaches stdin but not argv/environment/log output; worker CLI tests cover bounded safe parsing and non-echoing failures. | 2026-07-10 |
| Historical InsightFlow LLM live smoke | Closed by the 2026-06-17 smoke, but the project-root `.env` path is now retired. Current live LLM validation must use Locus server Admin Web config plus server-managed checkout; desktop `.env` is limited to non-LLM local settings. | 2026-06-17 |

## Debt Handling Rules

- Add debt here when it spans more than one file or more than one task.
- Remove or downgrade debt when a change clearly addresses it.
- Link back to the plan, design doc, or code path that best explains the issue.
