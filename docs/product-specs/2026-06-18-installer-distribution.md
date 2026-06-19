# FrameQ Installer Distribution Spec

## Background

FrameQ 的 MVP 已能在开发环境中运行，但普通用户安装后不能依赖 Python、uv、ffmpeg、yt-dlp、仓库目录或手动环境变量。对外分发版本必须把这些开发态前提转为安装包内置能力。

## Goals

- Windows 和 macOS 用户安装后即可启动 FrameQ，并通过首启引导下载 SenseVoice Small 后完成公开视频处理。
- 安装包内置 Python runtime、worker、媒体工具和 Python 运行依赖；不内置 SenseVoice Small 模型权重。
- 默认 ASR 在模型下载完成后可离线工作，用户无需设置 `FRAMEQ_ALLOW_REAL_ASR`。
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
- 默认 ASR 模型固定为 SenseVoice Small；首版 release UI 不展示未验证的 Qwen 选项。
- 首版普通用户 release 的默认 Python runtime 只安装 SenseVoice 路径所需依赖；`qwen-asr` 作为开发可选 extra 保留，不随默认安装包打入。
- 构建脚本必须裁剪 Python debug/cache/test/header 等非运行期文件，Windows NSIS 包体积必须保持在 NSIS 可打包边界内。
- 构建安装包时不要求 SenseVoice Small 模型目录；`resources/models` 不进入普通用户安装包。
- 首启检测 app-local data 模型缓存；缺少模型时展示下载引导，默认使用 ModelScope，发布方可通过 `FRAMEQ_ASR_MODEL_DOWNLOAD_URL` 配置自定义归档源。
- 模型下载完成后必须在 app-local data `models/` 中保留 ModelScope 缓存布局，并写入包含 SenseVoice 和 VAD 的 `MODEL_VERSION.txt`。
- 缺少模型时，视频下载和音频提取仍可进行；转写阶段返回可行动的 `ASR_MODEL_NOT_DOWNLOADED` 错误。
- 设置面板保存 LLM base URL、API key、model、timeout、输出目录和 ASR 模型配置到 app-local data `.env`。
- 历史记录、输出文件、中间文件和模型可写缓存均保留在用户本地 app-local data 中。
- 首次启动向导优先引导下载 ASR 模型；设置面板必须说明：启用云端 LLM 后，文字稿片段会发送到用户配置的服务。

## Acceptance Criteria

- 干净 Windows VM 未安装 Python、uv、ffmpeg 时，安装 FrameQ 后可启动首启模型下载引导，并在下载完成后完成 URL -> 下载 -> ASR 文字稿。
- Windows x64 构建机可使用真实 Python standalone 和 ffmpeg/ffprobe 产出不含模型权重的轻量 NSIS 安装包。
- macOS arm64/x64 对应干净机器可安装并完成同样链路。
- macOS arm64/x64 构建分别使用明确 target triple，不依赖构建宿主默认架构。
- 首启断网时应用可打开并提示稍后下载；模型已下载后断网仍可用于 ASR。
- 未配置 LLM 时，文字稿成功后进入部分完成状态并保留重试入口。
- 卸载后安装目录清理干净，app-local data 默认保留用户产物和历史。
