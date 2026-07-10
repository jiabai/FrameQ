# Completed Exec Plans

| File | Focus |
|------|-------|
| `2026-07-10-source-url-privacy-boundary-plan.md` | Added transient download URL separation, canonical persisted source identity, pure-text AI input, safe cache/history matching, and bounded legacy artifact cleanup/quarantine. |
| `2026-07-07-tauri-lib-module-split-plan.md` | Split the oversized Tauri `lib.rs` into focused runtime, diagnostics, worker command, ASR model, video processing, and deep-link modules without behavior changes. |
| `2026-07-07-personalized-insight-preferences-plan.md` | Add local inspiration profile, six-step per-run generation preferences, confirmation snapshot, and structured personalized insight-topic results without server-side preference storage. |
| `2026-07-07-per-llm-call-quota-plan.md` | Aligned server-managed LLM quota accounting with the per-cloud-LLM-API-call quota definition. |
| `2026-07-05-subtitle-first-asr-fallback-plan.md` | Reused public YouTube/Bilibili `yt-dlp` subtitle files as transcript source before local ASR, with ASR fallback and source metadata. |
| `2026-07-05-task-owned-artifact-layout-plan.md` | Replaced flat output/history paths with task-owned artifact directories and manifest-driven desktop history. |
| `2026-07-03-transcript-audio-review-editor-plan.md` | Added transcript audio review/editing with optional ASR time segments, safe local Tauri IO, audio playback, block highlight, and save semantics. |
| `2026-07-05-macos-youtube-runtime-diagnostics-plan.md` | Added explicit YouTube JavaScript runtime selection and sanitized app-local desktop diagnostics for macOS runtime debugging. |
| `2026-06-29-youtube-public-video-support-plan.md` | Added public YouTube watch/short/Shorts support through existing yt-dlp pipeline with 720p transcription-first policy, sanitized `YOUTUBE_*` failures, and no login/cookie/playlist behavior. |
| `2026-06-27-bilibili-public-video-fallback-plan.md` | Completed Bilibili ordinary public-video fallback with BV/av/b23.tv input acceptance, public API metadata/playurl parsing, DASH video/audio safe download, FFmpeg merge, backup URL retry, and `BILIBILI_*` UI guidance. |
| `2026-06-27-admin-entitlement-adjustments-plan.md` | Added Admin Web manual entitlement and quota compensation with append-only audit records and completed browser smoke acceptance. |
| `2026-06-27-xiaohongshu-video-fallback-completion-plan.md` | Completed Xiaohongshu public video-note fallback with share/full/direct/short-link input acceptance, Brotli page compatibility, safe resumable video download, and `XHS_*` UI guidance. |
| `2026-06-23-desktop-one-click-updates-plan.md` | Implemented low-noise Tauri updater with GitHub Releases metadata/artifacts; live GitHub updater smoke is waived for v1 because mainland China GitHub access is too slow to test reliably. |
| `2026-06-26-easydownload-transcription-download-reliability-plan.md` | Added shared safe media download helpers, Douyin share-text parsing, and video-only Xiaohongshu public-link fallback for transcription-first media acquisition. |
| `2026-06-25-douyin-share-page-fallback-plan.md` | Added a bounded Douyin share-page fallback that selects the largest validated public stream after matching `yt-dlp` failures. |
| `2026-06-25-transcript-summary-mindmap-plan.md` | Added confirmed AI整理 outputs for transcript summaries and local Mermaid mindmap artifacts. |
| `2026-06-23-desktop-worker-structure-refactor-plan.md` | Split the desktop React shell, Tauri bridge, and Python worker orchestration into focused modules without behavior changes. |
| `2026-06-23-asr-model-cache-layout-plan.md` | Unified SenseVoice ASR cache layout under `<FRAMEQ_MODEL_DIR>/models/iic/...` and preserved legacy compatibility. |
| `2026-06-23-disable-root-dotenv-llm-plan.md` | Stopped applying repository-root `.env` to desktop worker runtime after LLM config moved to server-managed checkout. |
| `2026-06-22-four-artifact-split-flow-plan.md` | Split local transcript generation from confirmed insight generation and surfaced video/audio/transcript/insight artifacts. |
| `2026-06-22-server-managed-llm-quota-plan.md` | Added server-managed dedicated client LLM config, desktop checkout, and monthly insight quota. |
| `2026-06-18-macos-desktop-ui-upgrade-plan.md` | Upgraded the React desktop UI to a macOS-style utility shell |
| `2026-06-18-topic-planner-insights-plan.md` | Added LLM topic planning before insight question generation |
| `2026-06-18-insight-prompt-tuning-plan.md` | Aligned FrameQ insight prompts and generation parameters with the reference service |
| `2026-06-21-activation-code-authorization-plan.md` | Account login with Admin Web-issued activation codes as the visible unlock flow. |
| `2026-06-21-account-billing-plan.md` | Retired account entitlement foundation plan; current visible unlock flow is activation-code based. |
| `2026-06-17-sensevoice-modelscope-cache-plan.md` | Routed SenseVoice ModelScope cache into FrameQ's configured model directory |
| `2026-06-17-sensevoice-long-audio-vad-plan.md` | Improved SenseVoice long-audio VAD parameters and transcript tag cleanup |
| `2026-06-17-local-media-reuse-plan.md` | Reused existing local audio and selected downloaded media by Douyin video ID |
| `2026-06-17-sensevoice-asr-models-plan.md` | Added ASR model selection with SenseVoice Small and Qwen3-ASR |
| `2026-06-17-history-and-output-config-plan.md` | Added task history viewing and configurable output directory |
| `2026-06-17-ui-llm-configuration-plan.md` | Retired local desktop LLM configuration UI; current LLM config is managed by FrameQ server |
| `2026-06-16-mvp-desktop-client-plan.md` | Built and validated the MVP desktop client workflow from URL input to transcript and insight output |
| `2026-06-16-mvp-desktop-client-tasks.md` | Completed task checklist for the MVP desktop client ExecPlan |
