# Product Specs Index

产品规格描述用户可见意图与边界，先于或伴随实现落盘。实施进度不进入 spec，而进入 `docs/exec-plans/`。

## Account, Billing & Server

- `2026-08-24-self-service-email-activation-code.md` — Current default unlock intent: inactive or expired desktop users request an account-bound activation code by email, then manually redeem it for a new 31-day window; repeat after every expiry without an administrator.
- `2026-06-21-account-billing.md` — Retired self-serve WeChat purchase draft; its administrator-issued visible-path statement is superseded by the 2026-08-24 self-service email activation spec.
- `2026-06-21-activation-code-authorization.md` — Historical administrator-issued activation-code baseline; administrator universal codes remain supported, while the default user distribution path is superseded by the 2026-08-24 self-service email activation spec.
- `2026-06-22-server-managed-llm-quota.md` — Server-managed dedicated client LLM config and 20 AI Credits per activation window.
- `2026-06-27-admin-entitlement-adjustments.md` — Admin Web manual compensation for entitlement expiry and LLM API-call quota after support incidents.
- `2026-07-10-server-entitlement-transaction-safety.md` — Atomic, retry-safe payment settlement, activation-code redemption, and administrator entitlement compensation.
- `2026-08-03-web-user-dashboard.md` — Browser-side per-user Web dashboard at `/dashboard` with email-OTP cookie-session login that lands on the dashboard, reusing the `desktop_login` OTP purpose and the Admin Web session model.
- `2026-08-04-server-page-i18n.md` — Per-page language switcher on `/login`, `/dashboard`, `/admin/login`, and `/admin` supporting `zh-CN` (default), `en`, and `zh-TW` via the `server/src/i18n.ts` module.

## Desktop Runtime, Packaging & Distribution

- `2026-09-05-v0.3.6-desktop-release.md` — v0.3.6 desktop release scope and acceptance.

- `2026-06-18-installer-distribution.md` — Historical lightweight-installer distribution baseline; model-acquisition behavior superseded by `2026-07-27-selectable-asr-model-on-demand-download.md`.
- `2026-06-23-desktop-one-click-updates.md` — Low-noise desktop update reminders and one-click upgrades via GitHub Releases static `latest.json`.
- `2026-07-05-app-local-cache-dir-rename.md` — Use `cache/` for the app-local temporary task area and retire the legacy worker env contract.
- `2026-07-05-desktop-diagnostics-logs.md` — Local desktop diagnostics log for installer/runtime debugging, including YouTube JavaScript runtime failures.
- `2026-07-05-youtube-js-runtime-packaging.md` — Bundle Deno as the packaged JavaScript runtime needed by `yt-dlp` for clean-machine YouTube extraction.
- `2026-07-12-v0.2.16-open-source-release.md` — Stable v0.2.16 GitHub Release policy for personal-development, small-user, and open-source distribution.
- `2026-07-15-desktop-i18n-ai-output-language.md` — Offline bundled Simplified Chinese, Traditional Chinese, and US English UI; app-local language preference; strict confirmation-time AI output language.
- `2026-07-17-v0.2.17-desktop-i18n-release.md` — Stable v0.2.17 three-platform release policy for the completed desktop localization and confirmation-time AI output-language work.
- `2026-07-22-release-reliability-hardening.md` — Broad-release requirements for crash-consistent desktop persistence, bounded supervised-worker execution, atomic server authentication/AI Credit accounting, and production operations.
- `2026-08-03-v0.3.0-desktop-feature-release.md` — Stable v0.3.0 minor three-platform release policy; inherits v0.2.17 reliability acceptance.
- `2026-08-05-v0.3.1-desktop-feature-release.md` — Stable v0.3.1 minor three-platform release policy; includes mandatory server gates; excludes the standalone Web marketing site.
- `2026-08-09-desktop-diagnostic-export.md` — User-initiated, local-only export of the most recent seven days of privacy-bounded desktop and ASR model-download diagnostics.
- `2026-08-15-vc-runtime-selfcheck-and-import-diagnostics.md` — Windows app-local VC++ 2015-2022 runtime DLL bundling, pre-flight self-check with closed `ASR_MODEL_RUNTIME_MISSING`, and import-stage diagnostic fallback.
- `2026-08-16-asr-model-download-startup-recovery.md` — Windows ASR model-download startup failure fix: app-local VC++ preflight and explicit 0% startup-failure semantics.

## Input & Media Processing

- `2026-06-16-douyin-video-transcription-client.md` — MVP desktop client: input a Douyin URL, output highest-quality public video and transcript; includes Douyin share-page fallback.
- `2026-07-05-repeat-url-task-reuse.md` — Reuse an existing completed local task when the same public video URL is submitted again.
- `2026-07-05-processing-toolbar-new-task-guard.md` — Disable the toolbar new-task/reset action while a video task is actively processing.
- `2026-07-10-source-url-privacy-boundary.md` — Separate process-local download URLs from safe canonical source identities; keep raw URL metadata out of persistence, history, diagnostics, and cloud AI prompts.
- `2026-07-10-desktop-process-supervision-cancellation.md` — Truthful cancellable worker/model-download lifecycle with platform process-tree termination and preservation of partial local artifacts.
- `2026-07-16-local-media-file-import.md` — Single-file local video/audio import with opaque Rust-owned selection tokens, normalized local WAV transcription, and strict path secrecy.
- `2026-07-18-process-video-request-contract-v3.md` — Minimal URL-only desktop intent, Rust-owned ASR configuration, and strict v3 worker execution request.
- `2026-07-27-selectable-asr-model-on-demand-download.md` — Two selectable local ASR models, model-snapshot task submission, and selected-model on-demand download with automatic resume.
- `2026-08-25-xiaohongshu-platform-subtitle-first-transcript.md` — Reuse verified Xiaohongshu platform SRT subtitles before local ASR in the existing single-link transcription flow; missing or malformed subtitles fall back to ASR, with no standalone subtitle-download UI.

## History & Workspace

- `2026-07-10-history-task-restore-ownership.md` — Controller-owned history restoration that rejects active workflow switches and prevents stale operation overwrite.
- `2026-07-11-history-vnext-strict-boundary.md` — Strict manifest-only history listing plus on-demand detail for current safe v3 tasks.
- `2026-07-11-local-transcript-ai-workspaces.md` — One task with separate inline local transcript review and independently confirmed AI summary/inspiration workspaces.
- `2026-07-12-history-task-permanent-deletion.md` — Explicit irreversible deletion of one supported History vNext task and its playback cache.
- `2026-07-12-desktop-density-history-toolbar-polish.md` — Intrinsic History height, clearer secondary typography, and a quieter grouped desktop toolbar.
- `2026-07-12-task-workspace-visual-hierarchy.md` — Restrained hierarchy cleanup for local transcript and AI workspaces without changing product, privacy, or workflow boundaries.

## AI Insight

- `2026-07-06-personalized-insight-preferences.md` — Six-field local Inspiration Profile v2 plus per-run six-step generation preferences.
- `2026-07-12-generate-draft-from-inspiration.md` — Turn a single user-selected `Insight` into a new draft, with strict single-seed, quota, and local-first privacy boundaries.
- `2026-07-31-transcript-dissection.md` — Independent `文字稿解剖` AI target for traceable structural review of a saved transcript.

## Motion UI

- `2026-08-16-motion-ui-enhancement.md` — Motion 第一阶段：处理阶段、ASR 真实进度、AI target 与历史列表的克制动效。
- `2026-08-16-motion-sheet-lifecycle.md` — Motion 第二阶段：主要 Sheet 的延迟卸载、焦点保持与进出场动效。
- `2026-08-16-motion-confirmation-flow.md` — Motion 第三阶段：摘要确认、灵感偏好流程、文字稿解剖确认的延迟卸载与焦点生命周期。

## Web Marketing Site

- `2026-08-05-web-marketing-site.md` — Public marketing site at top-level `site/` using Astro SSG; index/download/privacy three pages with Hallmark anti-AI-slop visual system and zero analytics/tracking.
