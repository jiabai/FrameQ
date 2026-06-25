# Active Exec Plans

| File | Focus |
|------|-------|
| `2026-06-25-douyin-share-page-fallback-plan.md` | Add a Douyin share page fallback that selects the largest validated video stream when `yt-dlp` fails on empty web detail or cookie-like extractor errors. |
| `2026-06-25-transcript-summary-mindmap-plan.md` | Generate transcript summaries and local Mermaid mindmaps in the existing confirmed AI整理 flow. |
| `2026-06-23-desktop-worker-structure-refactor-plan.md` | Split desktop client, Tauri bridge, and Python worker orchestration into focused modules without changing behavior. |
| `2026-06-23-desktop-one-click-updates-plan.md` | Tauri updater plus FrameQ server dynamic manifest for low-noise one-click desktop updates. |
| `2026-06-23-asr-model-cache-layout-plan.md` | Unify SenseVoice ASR cache layout under `<FRAMEQ_MODEL_DIR>/models/iic/...` and clean duplicate legacy caches. |
| `2026-06-23-disable-root-dotenv-llm-plan.md` | Stop applying repository-root `.env` to desktop worker runtime after LLM moved to server-managed checkout. |
| `2026-06-22-four-artifact-split-flow-plan.md` | Four artifact result workspace and split transcript/insight generation flow. |
| `2026-06-22-server-managed-llm-quota-plan.md` | Server-managed dedicated client LLM config, desktop checkout, and monthly insight quota. |
| `2026-06-18-installer-distribution-runtime-plan.md` | 普通用户安装即用：内置 runtime，首启下载 SenseVoice Small，用户数据目录和首启配置 |
