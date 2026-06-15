# FrameQ Architecture

<!-- 由 vibe-coding-launcher 生成。当前描述的是 MVP 目标架构；代码落地后必须同步更新。 -->

## 概述

FrameQ 是一个桌面客户端：用户输入抖音视频 URL 后，本地 worker 下载视频、校验媒体、提取音频、调用 ASR 转文字，并使用内置 InsightFlow 能力生成启发话题点。

## 代码地图

计划中的主要模块如下：

| 模块 | 责任 | 状态 |
|------|------|------|
| `app/` | Tauri + React + TypeScript 桌面 UI、状态展示、导出入口 | 已初始化；web build 通过，桌面 build 待 Rust/Cargo |
| `worker/` | Python 下载、ffprobe 校验、ffmpeg 音频提取、ASR、结果写盘；由 `uv` 管理本项目 `.venv` | 已初始化 schema、CLI facade、下载/媒体校验/音频提取 |
| `worker/insightflow/` | 从参考实现复制并裁剪后的话题点生成模块 | 待初始化 |
| `models/` | 本地模型权重缓存，不提交仓库 | 待创建 |
| `outputs/` | 用户可直接使用的最终视频、文字稿和话题点文件 | 运行时生成 |
| `work/` | 音频、中间文件、调试日志和临时产物 | 运行时生成 |

## 模块关系

```text
Desktop UI
  -> Tauri Command
  -> Python Worker
      -> yt-dlp
      -> ffprobe / ffmpeg
      -> Qwen3-ASR
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
- `worker/frameq_worker/models.py`：worker request/result/error schema。
- `worker/frameq_worker/cli.py`：worker CLI/facade 入口。
- `worker/frameq_worker/media.py`：yt-dlp、ffprobe 和 ffmpeg 音频提取服务。

## 架构不变量

- UI 只编排任务和展示状态，不直接调用 `yt-dlp`、`ffmpeg`、ASR 或 LLM。
- worker 通过结构化 JSON 返回状态、路径、文本、话题点和错误码。
- `D:\Github\InsightFlow\src\server` 只允许作为开发参考，禁止成为运行期依赖。
- 用户可见输出写入 `outputs/`；中间文件写入 `work/`；模型缓存写入 `models/`。
- 话题点失败不得阻断文字稿结果，客户端进入 `部分完成` 状态。

## 层级边界

依赖方向为 `UI -> Tauri command -> Worker facade -> Services -> Config/Types`。下层不得 import 上层；共享数据结构应收敛到明确的 request/result schema。

## 横切关注点

- 安全与合规：见 `docs/SECURITY.md`。
- UI 和交互状态：见 `docs/DESIGN.md`。
- 完成标准：见 `docs/EXECUTION_GATES.md`。
