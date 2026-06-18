# FrameQ Installer Distribution Spec

## Background

FrameQ 的 MVP 已能在开发环境中运行，但普通用户安装后不能依赖 Python、uv、ffmpeg、yt-dlp、仓库目录或手动环境变量。对外分发版本必须把这些开发态前提转为安装包内置能力。

## Goals

- Windows 和 macOS 用户安装后即可启动 FrameQ 并完成公开视频处理。
- 安装包内置 Python runtime、worker、媒体工具、Python 运行依赖和 SenseVoice Small 模型。
- 默认 ASR 可离线工作，用户无需设置 `FRAMEQ_ALLOW_REAL_ASR`。
- 用户数据写入 app-local data 目录，而不是安装目录或仓库目录。
- 首次启动允许用户配置 OpenAI-compatible LLM，也允许稍后配置。
- 未配置 LLM 时，视频下载、音频提取和 ASR 文字稿仍可用；话题点生成以可恢复的部分完成状态降级。

## Non-goals

- 首版不提供自动更新。
- 首版不内置 LLM key、云端 LLM 模型或用户私有配置。
- 首版不做 Universal macOS 单包；macOS 分别构建 arm64 与 x64。
- 首版允许无签名内测包；公开面向普通用户发布前仍必须完成 Windows 签名、macOS Developer ID 签名和 notarization。

## User-visible Requirements

- 用户不需要安装 Python、uv、ffmpeg、yt-dlp 或手动配置 PATH。
- 默认 ASR 模型固定为 SenseVoice Small；首版 release UI 不展示未内置的 Qwen 选项。
- 设置面板保存 LLM base URL、API key、model、timeout、输出目录和 ASR 模型配置到 app-local data `.env`。
- 历史记录、输出文件、中间文件和模型可写缓存均保留在用户本地 app-local data 中。
- 首次启动向导必须说明：启用云端 LLM 后，文字稿片段会发送到用户配置的服务。

## Acceptance Criteria

- 干净 Windows VM 未安装 Python、uv、ffmpeg 时，安装 FrameQ 后能完成 URL -> 下载 -> ASR 文字稿。
- macOS arm64/x64 对应干净机器可安装并完成同样链路。
- 断网后启动已安装应用，内置 SenseVoice Small 仍可用于 ASR。
- 未配置 LLM 时，文字稿成功后进入部分完成状态并保留重试入口。
- 卸载后安装目录清理干净，app-local data 默认保留用户产物和历史。
