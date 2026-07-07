# Product Specs Index

## Account and Billing Spec

- `2026-06-27-admin-entitlement-adjustments.md` - Admin Web manual compensation for entitlement expiry and LLM API-call quota after support incidents.
- `2026-06-22-server-managed-llm-quota.md` - Server-managed dedicated client LLM config and 20-use monthly insight quota.
- `2026-06-21-activation-code-authorization.md` - Account login with administrator-issued activation codes for 31-day monthly pass access.
- `2026-06-21-account-billing.md` - Retired self-serve WeChat purchase draft; current visible unlock path is administrator-issued activation-code monthly passes while WeChat purchase is paused.

## AI Insight Spec

- `2026-07-06-personalized-insight-preferences.md` - Option-based inspiration profile and per-run six-step generation preferences for more personalized insight topics.

## Distribution Spec

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
| `2026-06-16-douyin-video-transcription-client.md` | MVP 桌面客户端：输入抖音 URL，输出最高质量公开视频、文字稿、要点总结、Mermaid mindmap 和启发话题点；包含 Douyin share page fallback 行为 |
