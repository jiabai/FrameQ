# FrameQ Architecture

## 2026-06-26 Worker-Owned Download Strategy Boundary

- The Python worker owns all platform-specific public-link fallback strategy, safe media download helpers, candidate probing, media validation, and structured error mapping.
- UI and Tauri continue to pass a source URL into the existing command flow and receive the same worker JSON shape; they must not parse platform HTML, choose media candidates, manage cookies, or become a download queue.
- `yt-dlp` remains the first attempt for supported public links. Worker fallback code may run only after matching failures and only for public or user-authorized links that can expose a playable media URL.
- EasyDownload is an MIT-licensed design and algorithm reference. FrameQ should port the minimal needed behavior into `worker/` and must not import, shell out to, or bundle the Go/Wails application as a runtime dependency.
- Shared download reliability helpers may support `.part` files, resume-safe range checks, no-progress timeouts, maximum-size guardrails, and candidate retries, but they must preserve the current output/history/result contract.
- Xiaohongshu fallback is scoped to video suitable for transcription. Image albums, platform archiving, login-gated content, and broad multi-platform downloader behavior are outside the desktop worker boundary.

## 2026-06-25 Douyin Share Page Fallback Boundary

- The Python worker owns Douyin fallback extraction. UI and Tauri commands continue to submit a source URL and receive the same structured worker result; they do not parse Douyin HTML, choose streams, or download media directly.
- The download path becomes a small strategy chain: attempt `yt-dlp` first, then, only for Douyin download failures that match empty web detail JSON or cookie/challenge-like extractor failures, attempt a local Douyin share page fallback.
- The fallback is derived from EasyDownload's MIT-licensed approach, but FrameQ should port the minimal algorithm into `worker/` rather than importing or bundling the Go/Wails EasyDownload application.
- The fallback extracts an `aweme_id`, requests `https://www.iesdouyin.com/share/video/{aweme_id}/?app=aweme`, parses `window._ROUTER_DATA`, builds stream candidates from `bit_rate` or `play_addr.uri`, and probes candidate streams with ranged GET requests.
- The fallback may use a fixed mobile Safari `User-Agent` (`iPhone OS 16_5`, Safari `604.1`) plus minimal public-page headers. It must not implement UA rotation, proxy pools, browser fingerprint spoofing, CAPTCHA solving, or account automation.
- A process-local cookie jar may keep anonymous cookies naturally issued by the public share page for the current worker invocation only; browser cookies are not read, persisted, or uploaded.
- Candidate selection is automatic. FrameQ chooses the largest valid stream by byte size to preserve the highest-quality local video for users who keep the downloaded file, with resolution or quality rank as a tie-breaker.
- Duplicate candidate streams should be collapsed by verified `Content-Range` total size. If the selected stream fails download or media validation, the worker tries the next candidate before surfacing failure.
- The selected media is written to the configured output directory as a normal MP4 and then flows through the existing `ffprobe`, `ffmpeg`, ASR, history, and result workspace pipeline.
- If all fallback candidates fail download or media validation, the worker returns a structured `VIDEO_DOWNLOAD_FAILED` with a short cause and recovery guidance; it must not hide the failed stage behind a generic worker error.

## 2026-06-23 Desktop Update Boundary

- Desktop app updates use Tauri updater signed artifacts and GitHub Releases as the static updater metadata/artifact host.
- The desktop updater endpoint is `https://github.com/jiabai/FrameQ/releases/latest/download/latest.json?frameq-updater=1`; release automation uploads `latest.json`, the NSIS installer, and signed updater bundles to the published GitHub Release.
- Python worker code upgrades together with the desktop application bundle; v1 does not support independent worker hot updates from app-local data.
- App-local data `updates.json` stores only update preferences such as `lastCheckedAt`, `postponedUntil`, and `skippedVersion`.
- App-local `models/`, `outputs/`, `work/history.json`, `auth/session.json`, and `.env` are preserved across app updates.
- Live old-version-to-new-version testing through GitHub Releases is waived for v1 because mainland China access to GitHub is too slow to test reliably. The updater architecture remains in place, but direct fresh-installer distribution is the accepted fallback for users whose network cannot reach GitHub Releases.

## 2026-06-23 Runtime Configuration Boundary

- Desktop worker runtime configuration no longer reads repository-root `.env` files such as `D:/Github/FrameQ/.env`.
- App-local data `.env` remains the local desktop settings file for output directory, ASR model selection, and model download overrides.
- The desktop settings panel returns and displays the app-local data `.env` path, can locate it in the file manager, and creates a commented template if the file is missing.
- Legacy local `FRAMEQ_LLM_PROVIDER`, `FRAMEQ_LLM_BASE_URL`, `FRAMEQ_LLM_API_KEY`, `FRAMEQ_LLM_MODEL`, and `FRAMEQ_LLM_TIMEOUT_SECONDS` dotenv values are ignored.
- Insight topic generation receives LLM runtime material only through server-managed checkout environment variables injected by Tauri for the insight-generation worker invocation.

## 2026-06-23 ASR Model Cache Layout Boundary

- `FRAMEQ_MODEL_DIR` is the app-local ModelScope cache root, not the directory that directly contains `iic/SenseVoiceSmall`.
- The canonical release ASR layout is `<FRAMEQ_MODEL_DIR>/models/iic/SenseVoiceSmall` plus `<FRAMEQ_MODEL_DIR>/models/iic/speech_fsmn_vad_zh-cn-16k-common-pytorch`.
- Worker startup keeps legacy top-level `iic/...` readable for upgrade compatibility, but normalizes it to the canonical layout before real ASR loading.
- Automatic cleanup is limited to FrameQ's known SenseVoice/VAD legacy directories and stale `._____temp` folders without `model.pt`.

## 2026-06-21 Account and Billing Boundary

- `server/` is a small TypeScript Fastify service for email OTP login, desktop session exchange, WeChat Native orders, payment webhooks, and entitlement status.
- The service stores account and billing state in a private SQLite database at `server/data/frameq.sqlite` with WAL mode enabled. It is designed for a single writer service instance.
- The service stores encrypted administrator-managed LLM config for a dedicated FrameQ client supplier key and tracks per-user insight-generation quota.
- Desktop authentication uses `frameq://auth/callback` deep links. The browser receives a short-lived ticket, and the desktop client exchanges that ticket for an opaque session token.
- Activation codes are an administrator-issued entitlement source. Codes are redeemed through a signed-in desktop session and extend the same `Entitlement` record used by the processing gate.
- Each activation grants 20 insight-generation uses. The desktop worker checks out one use before generating insights, then calls the LLM supplier directly with the returned config.
- Admin Web access is limited to the configured administrator email and uses short-lived HttpOnly cookie sessions.
- The account service never receives video files, audio files, transcripts, generated insights, cookies, model caches, or local history contents. It may store and return the dedicated FrameQ client LLM key.
- The existing local worker pipeline remains the only place where video extraction, ASR, and InsightFlow execution happen.

<!-- 由 vibe-coding-launcher 生成。当前描述的是 MVP 目标架构；代码落地后必须同步更新。 -->

## 概述

FrameQ 是一个桌面客户端：用户输入抖音视频 URL 后，本地 worker 下载视频、校验媒体、提取音频、调用 ASR 转文字，并使用内置 InsightFlow 能力生成启发话题点。

## 代码地图

计划中的主要模块如下：

| 模块 | 责任 | 状态 |
|------|------|------|
| `app/` | Tauri + React + TypeScript 桌面 UI、状态展示、历史面板、设置面板、导出入口 | 已初始化；web build、Tauri release build 和安装器打包已验证 |
| `worker/` | Python 下载、ffprobe 校验、ffmpeg 音频提取、ASR、结果写盘；开发态由 `uv` 管理 `.venv`，分发态由安装包内置 Python runtime 执行 | 已初始化 schema、CLI facade、下载/媒体校验/音频提取、ASR adapter、transcript writers；分发态默认启用 SenseVoice Small，但模型缓存由首启下载 |
| `worker/insightflow/` | 从参考实现复制并裁剪后的话题点生成模块 | 已初始化 splitter、prompt、JSON parser、generator；先用 LLM 做话题分段规划，再逐话题生成问题；planner 失败时 fallback 到直接生成 |
| `app/src-tauri/resources/` | 分发态内置 Python runtime、worker、ffmpeg/ffprobe 和配置模板 | 构建脚本生成；仓库只保留 placeholder，避免提交大体积 runtime |
| app-local data `models/` | 用户本机可写模型缓存；由 `FRAMEQ_MODEL_DIR` 指向 | ModelScope cache root；canonical ASR files live under `models/iic/...`; legacy top-level `iic/...` is migrated/cleaned best-effort |
| app-local data `outputs/` 或 `FRAMEQ_OUTPUT_DIR` | 用户可直接使用的最终视频、文字稿和话题点文件 | 运行时生成；输出目录可由设置面板保存到 app-local data `.env` |
| app-local data `work/` | 音频、中间文件、调试日志、`history.json` 历史任务索引和临时产物 | 运行时生成；由 `FRAMEQ_WORK_DIR` 指向 |
| app-local data `updates.json` | 桌面更新偏好，不含用户内容或签名私钥 | 记录检查时间、稍后提醒时间和跳过版本 |
| app-local data `.env` | 本机非 LLM 运行配置，不提交仓库；设置页可定位该文件，缺失时自动创建注释模板 | 支持输出目录、ASR 模型选择和模型下载覆盖；InsightFlow LLM 配置由 server 管理，不从 dotenv 读取 |

## 模块关系

```text
Desktop UI
  -> Tauri process_video command
  -> Python Worker
      -> yt-dlp
      -> ffprobe / ffmpeg
      -> Qwen3-ASR or SenseVoice
      -> Result JSON with video/audio/transcript paths
      -> Desktop UI result workspace
  -> Tauri retry_insights command after user confirmation
  -> Python Worker embedded InsightFlow module
      -> Mermaid mindmap and summary generation
      -> Insight topic generation
  -> Result JSON with summary/mindmap/insights paths
  -> Desktop UI result workspace
```

## 关键文件

- `douyin_video_download_solution.md`：产品与技术方案来源。
- `AGENTS.md`：AI 协作入口地图和最高优先级约束摘要。
- `docs/product-specs/2026-06-16-douyin-video-transcription-client.md`：首个用户可见 MVP 规格。
- `docs/exec-plans/active/2026-06-16-mvp-desktop-client-plan.md`：首个实现计划。
- `ruff.toml`：Python worker 初始 lint 约束。
- `pyproject.toml`：Python worker 项目元数据和 `uv` 依赖入口（初始化后维护）。
- `app/src/workflow.ts`：前端工作流状态模型。
- `app/src/settingsClient.ts`：前端本机设置读写 client（Tauri invoke 包装），包含 ASR、输出目录和 app-local `.env` 路径。
- `app/src/historyClient.ts`：前端历史记录读取 client（Tauri invoke 包装）。
- `worker/frameq_worker/models.py`：worker request/result/error schema。
- `worker/frameq_worker/cli.py`：worker CLI/facade 入口，默认在真实 ASR 未启用时返回结构化 `ASR_MODEL_NOT_READY`。
- `worker/frameq_worker/media.py`：yt-dlp、ffprobe 和 ffmpeg 音频提取服务。
- `worker/frameq_worker/asr.py`：ASR model registry、Qwen / SenseVoice adapter、模型缓存目录解析和 transcript `.txt/.md` 写出。
- `worker/frameq_worker/model_download.py`：SenseVoice Small 与 VAD 模型缓存下载、归档解压、校验和 `MODEL_VERSION.txt` 写入。
- `worker/frameq_worker/config.py`：app-local data `.env` 加载、旧本地 LLM dotenv 字段过滤和环境变量合并；项目根 `.env` 不参与 worker runtime。
- `worker/frameq_worker/llm.py`：OpenAI-compatible InsightFlow LLM client；桌面话题点生成通过 server-managed checkout env 创建 client，默认使用 `temperature=0.7`。
- `worker/frameq_worker/pipeline.py`：worker 分阶段 pipeline 与 `ProcessResult` 映射。
- `worker/frameq_worker/insightflow/`：内置 InsightFlow 话题点与总结生成模块，运行期不依赖外部参考仓库；对完整 ASR 文字稿优先生成 Mermaid mindmap 和要点总结，同时保留 topic planner 生成启发问题，最终去重并限制总数。

## 架构不变量

- UI 只编排任务和展示状态，不直接调用 `yt-dlp`、`ffmpeg`、ASR 或 LLM。
- UI 可以通过 Tauri command 读取/保存 ASR 与输出目录配置；LLM 配置由 server Admin Web 管理，桌面 UI 不回显也不输入 API Key。
- worker 通过结构化 JSON 返回状态、路径、文本、话题点和错误码。
- `process_video` 主流程默认只负责视频下载、音频提取和 ASR 文字稿；`retry_insights`/AI整理流程在用户二次确认后单独运行，生成要点总结、Mermaid mindmap 和启发话题点，并且是唯一需要 server-managed LLM checkout 的本地 worker 调用。
- `D:\Github\InsightFlow\src\server` 只允许作为开发参考，禁止成为运行期依赖。
- 对外分发态的用户可见输出默认写入 app-local data `outputs/`，也可通过 `FRAMEQ_OUTPUT_DIR` 写入自定义目录；中间文件和历史索引写入 app-local data `work/`；模型缓存写入 app-local data `models/`。
- 历史记录只索引本地结果和状态，不参与 worker 核心处理决策；旧历史路径不随输出目录配置变化而迁移。
- 话题点失败不得阻断文字稿结果，客户端进入 `部分完成` 状态。

## 层级边界

依赖方向为 `UI -> Tauri command -> Worker facade -> Services -> Config/Types`。下层不得 import 上层；共享数据结构应收敛到明确的 request/result schema。

## 横切关注点

- 安全与合规：见 `docs/SECURITY.md`。
- UI 和交互状态：见 `docs/DESIGN.md`。
- 完成标准：见 `docs/EXECUTION_GATES.md`。
