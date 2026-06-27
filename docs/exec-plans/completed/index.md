# Completed Exec Plans

| File | Focus |
|------|-------|
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
| `2026-06-21-activation-code-authorization-plan.md` | Account login with Admin Web-issued activation codes replacing the visible WeChat payment flow. |
| `2026-06-21-account-billing-plan.md` | Account login, desktop deep-link callback, SQLite-backed service, and WeChat Native monthly pass. |
| `2026-06-17-sensevoice-modelscope-cache-plan.md` | Routed SenseVoice ModelScope cache into FrameQ's configured model directory |
| `2026-06-17-sensevoice-long-audio-vad-plan.md` | Improved SenseVoice long-audio VAD parameters and transcript tag cleanup |
| `2026-06-17-local-media-reuse-plan.md` | Reused existing local audio and selected downloaded media by Douyin video ID |
| `2026-06-17-sensevoice-asr-models-plan.md` | Added ASR model selection with SenseVoice Small and Qwen3-ASR |
| `2026-06-17-history-and-output-config-plan.md` | Added task history viewing and configurable output directory |
| `2026-06-17-ui-llm-configuration-plan.md` | Added desktop UI controls for InsightFlow LLM configuration |
| `2026-06-16-mvp-desktop-client-plan.md` | Built and validated the MVP desktop client workflow from URL input to transcript and insight output |
| `2026-06-16-mvp-desktop-client-tasks.md` | Completed task checklist for the MVP desktop client ExecPlan |
