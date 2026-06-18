# FrameQ Architecture

<!-- 由 vibe-coding-launcher 生成。当前描述的是 MVP 目标架构；代码落地后必须同步更新。 -->

## 概述

FrameQ 是一个桌面客户端：用户输入抖音视频 URL 后，本地 worker 下载视频、校验媒体、提取音频、调用 ASR 转文字，并使用内置 InsightFlow 能力生成启发话题点。

## 代码地图

计划中的主要模块如下：

| 模块 | 责任 | 状态 |
|------|------|------|
| `app/` | Tauri + React + TypeScript 桌面 UI、状态展示、历史面板、设置面板、导出入口 | 已初始化；web build、Tauri release build 和安装器打包已验证 |
| `worker/` | Python 下载、ffprobe 校验、ffmpeg 音频提取、ASR、结果写盘；开发态由 `uv` 管理 `.venv`，分发态由安装包内置 Python runtime 执行 | 已初始化 schema、CLI facade、下载/媒体校验/音频提取、ASR adapter、transcript writers；分发态默认内置并启用 SenseVoice Small |
| `worker/insightflow/` | 从参考实现复制并裁剪后的话题点生成模块 | 已初始化 splitter、prompt、JSON parser、generator；先用 LLM 做话题分段规划，再逐话题生成问题；planner 失败时 fallback 到直接生成 |
| `app/src-tauri/resources/` | 分发态内置 Python runtime、worker、ffmpeg/ffprobe、SenseVoice Small 模型和配置模板 | 构建脚本生成；仓库只保留 placeholder，避免提交大体积 runtime |
| app-local data `models/` | 用户本机可写模型缓存；由 `FRAMEQ_MODEL_DIR` 指向 | 分发态从内置模型资源初始化，运行期可写 |
| app-local data `outputs/` 或 `FRAMEQ_OUTPUT_DIR` | 用户可直接使用的最终视频、文字稿和话题点文件 | 运行时生成；输出目录可由设置面板保存到 app-local data `.env` |
| app-local data `work/` | 音频、中间文件、调试日志、`history.json` 历史任务索引和临时产物 | 运行时生成；由 `FRAMEQ_WORK_DIR` 指向 |
| app-local data `.env` | 本机运行配置和密钥，不提交仓库；`.env.example`/resource `.env.template` 提供占位模板 | 已支持 InsightFlow LLM、输出目录和 ASR 模型选择；LLM/输出目录/ASR 模型配置可由桌面 UI 写入 |

## 模块关系

```text
Desktop UI
  -> Tauri Command
  -> Python Worker
      -> yt-dlp
      -> ffprobe / ffmpeg
      -> Qwen3-ASR or SenseVoice
      -> embedded InsightFlow module
  -> Result JSON
  -> Desktop UI
```

## 关键文件

- `douyin_video_download_solution.md`：产品与技术方案来源。
- `AGENTS.md`：AI 协作入口地图和最高优先级约束摘要。
- `docs/product-specs/2026-06-16-douyin-video-transcription-client.md`：首个用户可见 MVP 规格。
- `docs/exec-plans/active/2026-06-16-mvp-desktop-client-plan.md`：首个实现计划。
- `ruff.toml`：Python worker 初始 lint 约束。
- `pyproject.toml`：Python worker 项目元数据和 `uv` 依赖入口（初始化后维护）。
- `app/src/workflow.ts`：前端工作流状态模型。
- `app/src/settingsClient.ts`：前端 LLM 配置读写 client（Tauri invoke 包装）。
- `app/src/historyClient.ts`：前端历史记录读取 client（Tauri invoke 包装）。
- `worker/frameq_worker/models.py`：worker request/result/error schema。
- `worker/frameq_worker/cli.py`：worker CLI/facade 入口，默认在真实 ASR 未启用时返回结构化 `ASR_MODEL_NOT_READY`。
- `worker/frameq_worker/media.py`：yt-dlp、ffprobe 和 ffmpeg 音频提取服务。
- `worker/frameq_worker/asr.py`：ASR model registry、Qwen / SenseVoice adapter、模型缓存目录解析和 transcript `.txt/.md` 写出。
- `worker/frameq_worker/config.py`：项目根 `.env` 加载和环境变量合并。
- `worker/frameq_worker/llm.py`：OpenAI-compatible InsightFlow LLM client，由 `FRAMEQ_LLM_*` 配置创建；话题点生成默认使用 `temperature=0.7`。
- `worker/frameq_worker/pipeline.py`：worker 分阶段 pipeline 与 `ProcessResult` 映射。
- `worker/frameq_worker/insightflow/`：内置 InsightFlow 话题点生成模块，运行期不依赖外部参考仓库；对完整 ASR 文字稿优先执行 topic planner，再按 planner 的标题、摘要、原文片段和 `question_count` 生成启发问题，最终去重并限制总数。

## 架构不变量

- UI 只编排任务和展示状态，不直接调用 `yt-dlp`、`ffmpeg`、ASR 或 LLM。
- UI 可以通过 Tauri command 读取/保存 LLM 配置，但不得回显完整 API Key。
- worker 通过结构化 JSON 返回状态、路径、文本、话题点和错误码。
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
