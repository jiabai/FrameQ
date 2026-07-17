# Product Specs Index

## Account and Billing Spec

- `2026-07-10-server-entitlement-transaction-safety.md` - Atomic, retry-safe payment settlement, activation-code redemption, and administrator entitlement compensation.
- `2026-06-27-admin-entitlement-adjustments.md` - Admin Web manual compensation for entitlement expiry and LLM API-call quota after support incidents.
- `2026-06-22-server-managed-llm-quota.md` - Server-managed dedicated client LLM config and 20 AI Credits per activation window.
- `2026-06-21-activation-code-authorization.md` - Account login with administrator-issued activation codes for 31-day monthly pass access.
- `2026-06-21-account-billing.md` - Retired self-serve WeChat purchase draft; current visible unlock path is administrator-issued activation-code monthly passes while WeChat purchase is paused.

## Desktop Runtime Spec

- `2026-07-16-local-media-file-import.md` - Single-file local video/audio import with opaque Rust-owned selection tokens, normalized local WAV transcription, source-aware artifacts/History, and strict path secrecy.
- `2026-07-15-desktop-i18n-ai-output-language.md` - Offline bundled Simplified Chinese, Traditional Chinese, and US English UI; app-local language preference; structured progress codes; and strict confirmation-time AI output language.
- `2026-07-12-history-task-permanent-deletion.md` - Explicit irreversible deletion of one supported History vNext task and its playback cache, with strict task-ID/path validation and truthful partial-failure semantics.
- `2026-07-12-desktop-density-history-toolbar-polish.md` - Intrinsic History height, clearer secondary typography, consistent active-workspace rhythm, and a quieter grouped desktop toolbar without lifecycle or data changes.
- `2026-07-12-task-workspace-visual-hierarchy.md` - Restrained hierarchy cleanup for local transcript and AI workspaces without changing their product, privacy, or workflow boundaries.
- `2026-07-11-local-transcript-ai-workspaces.md` - One task with separate inline local transcript review and independently confirmed AI summary/inspiration workspaces.
- `2026-07-11-history-vnext-strict-boundary.md` - Strict manifest-only history listing plus on-demand detail for current safe v3 tasks; unsupported legacy data remains physically untouched and product-isolated.
- `2026-07-10-history-task-restore-ownership.md` - Controller-owned history restoration that rejects active workflow switches and prevents stale operation overwrite.
- `2026-07-10-desktop-process-supervision-cancellation.md` - Truthful cancellable worker/model-download lifecycle with platform process-tree termination and preservation of partial local artifacts.

## AI Insight Spec

- `2026-07-12-generate-draft-from-inspiration.md` - Third AI整理 target card `生成文字稿`: turn a single user-selected `Insight` from `启发灵感` into a new draft, with strict single-seed, quota, and local-first privacy boundaries.
- `2026-07-06-personalized-insight-preferences.md` - Option-based inspiration profile and per-run six-step generation preferences for more personalized insight topics.

## Distribution Spec

- `2026-07-17-v0.2.17-desktop-i18n-release.md` - Stable v0.2.17 three-platform release policy for the completed desktop localization and confirmation-time AI output-language work, with draft-first artifact validation and unchanged macOS Gatekeeper disclosure.
- `2026-07-12-v0.2.16-open-source-release.md` - Stable v0.2.16 GitHub Release policy for personal-development, small-user, and open-source distribution with explicit ad-hoc macOS Gatekeeper disclosure and draft-first artifact validation.
- `2026-07-10-source-url-privacy-boundary.md` - Separate process-local download URLs from safe canonical source identities and keep raw/sensitive URL metadata out of persistence, history, diagnostics, and cloud AI prompts.
- `2026-07-05-processing-toolbar-new-task-guard.md` - Disable the toolbar new-task/reset action while a video task is actively processing.
- `2026-07-05-app-local-cache-dir-rename.md` - Use `cache/` for the app-local temporary task area and retire the legacy worker env contract.
- `2026-07-05-repeat-url-task-reuse.md` - Reuse an existing completed local task when the same public video URL is submitted again.
- `2026-07-05-youtube-js-runtime-packaging.md` - Bundle Deno as the packaged JavaScript runtime needed by `yt-dlp` for clean-machine YouTube extraction.
- `2026-07-05-desktop-diagnostics-logs.md` - Local desktop diagnostics log for installer/runtime debugging, including YouTube JavaScript runtime failures.
- `2026-06-23-desktop-one-click-updates.md` - Low-noise desktop update reminders and one-click upgrades via GitHub Releases static `latest.json`.
- `2026-06-18-installer-distribution.md` — 普通用户安装即用分发：内置 runtime，首启下载 SenseVoice Small，用户数据目录和首启配置体验。

<!-- 由 vibe-coding-launcher 生成。 -->

## Purpose

Product specs describe user-visible intent and boundaries before implementation work.

## Current Specs

| File | Scope |
|------|-------|
| `2026-06-16-douyin-video-transcription-client.md` | MVP 桌面客户端：输入抖音 URL，输出最高质量公开视频和文字稿；文字稿完成后可单独确认生成要点总结/Mermaid mindmap 或启发灵感；包含 Douyin share page fallback 行为 |
