# FrameQ Installer Distribution Spec

## Background

FrameQ 的 MVP 已能在开发环境中运行，但普通用户安装后不能依赖 Python、uv、ffmpeg、yt-dlp、仓库目录或手动环境变量。对外分发版本必须把这些开发态前提转为安装包内置能力。

## Goals

- Windows 和 macOS 用户安装后即可启动 FrameQ，并通过首启引导下载 SenseVoice Small 后完成公开视频处理。
- 安装包内置 Python runtime、worker、媒体工具和 Python 运行依赖；不内置 SenseVoice Small 模型权重。
- 默认 ASR 在模型下载完成后可离线工作，用户无需设置 `FRAMEQ_ALLOW_REAL_ASR`。
- 用户数据写入 app-local data 目录，而不是安装目录或仓库目录。
- 首次启动只引导本机 ASR 模型下载和本机设置确认；LLM 由 FrameQ server 管理员统一托管配置。
- server 端 LLM 未配置或账号不可用时，视频下载、音频提取和 ASR 文字稿仍可用；话题点生成以可恢复的部分完成状态降级。

## Non-goals

- 首版不提供自动更新。
- 首版不内置 LLM key、云端 LLM 模型或用户私有配置。
- 首版不做 Universal macOS 单包；macOS 分别构建 arm64 与 x64。
- 面向普通消费者、要求无 Gatekeeper 手动授权的商业分发必须完成 Windows 平台签名、
  macOS Developer ID 签名和 notarization。个人开发、少量用户或开源工具可在明确批准后
  发布 ad-hoc 签名且未 notarize 的稳定版，但必须在 Release 页面突出披露首次打开步骤，
  且不得宣称已通过 Apple 身份验证；当前批准口径见
  `2026-07-12-v0.2.16-open-source-release.md`。

## User-visible Requirements

- 用户不需要安装 Python、uv、ffmpeg、yt-dlp 或手动配置 PATH。
- 默认 ASR 模型固定为 SenseVoice Small；首版 release UI 不展示未验证的 Qwen 选项。
- 首版普通用户 release 的默认 Python runtime 只安装 SenseVoice 路径所需依赖；`qwen-asr` 作为开发可选 extra 保留，不随默认安装包打入。
- 构建脚本必须裁剪 Python debug/cache/test/header 等非运行期文件，Windows NSIS 包体积必须保持在 NSIS 可打包边界内。
- 构建安装包时不要求 SenseVoice Small 模型目录；`resources/models` 不进入普通用户安装包。
- 首启检测 app-local data 模型缓存；缺少模型时展示下载引导。官方源顺序固定为先尝试 ModelScope（`iic/SenseVoiceSmall`），下载失败或达到有界超时后自动切换到 Hugging Face（`FunAudioLLM/SenseVoiceSmall`）。
- 下载源顺序不得根据 UI 语言、操作系统 locale、账号地区或宣传站语言改变；语言只影响界面文案。
- ModelScope 成功时不得再请求 Hugging Face；ModelScope 失败或超时后的 Hugging Face fallback 不要求用户重新点击、重启应用或重新开始下载流程，进度区应显示当前安全源名称及正在切换备用源的状态。
- `FRAMEQ_ASR_MODEL_DOWNLOAD_URL` 是发布方显式配置的独占自定义源。该配置存在时只使用自定义源，不得静默回退到 ModelScope 或 Hugging Face。
- 两个官方源均失败时，界面必须说明本地 ASR 模型未能下载，并提供检查网络和稍后重试的可行动提示；不得把完整下载器输出直接展示给用户。
- 模型下载完成后必须归一化写入 app-local data `models/` 的同一缓存布局，不因实际下载源改变运行期 ASR 行为，并写入包含 SenseVoice 和 VAD 的 `MODEL_VERSION.txt`。
- 模型下载日志和技术详情只允许记录源名称、主机名、公开模型 ID、尝试次数以及超时/失败分类等脱敏摘要；不得记录带 token 的 URL、凭据、Cookie、请求头或完整原始下载器输出。
- 缺少模型时，视频下载和音频提取仍可进行；转写阶段返回可行动的 `ASR_MODEL_NOT_DOWNLOADED` 错误。
- 设置面板只保存输出目录、ASR 模型和模型下载等本机设置到 app-local data `.env`，并提供该文件路径与定位入口；LLM base URL、API key、model 和 timeout 不在桌面端配置。
- 历史记录、输出文件、中间文件和模型可写缓存均保留在用户本地 app-local data 中。
- 首次启动向导优先引导下载 ASR 模型；设置面板必须说明本机 `.env` 仅用于本机配置。AI 整理确认面板必须说明文字稿片段会发送到管理员配置的云端 LLM。

## Acceptance Criteria

- 干净 Windows VM 未安装 Python、uv、ffmpeg 时，安装 FrameQ 后可启动首启模型下载引导，并在下载完成后完成 URL -> 下载 -> ASR 文字稿。
- Windows x64 构建机可使用真实 Python standalone 和 ffmpeg/ffprobe 产出不含模型权重的轻量 NSIS 安装包。
- macOS arm64/x64 对应干净机器可安装并完成同样链路。
- macOS arm64/x64 构建分别使用明确 target triple，不依赖构建宿主默认架构。
- 首启断网时应用可打开并提示稍后下载；模型已下载后断网仍可用于 ASR。
- ModelScope 下载成功时不会访问 Hugging Face；模拟 ModelScope 下载失败和超时两种情况时，均会在同一次用户操作内自动尝试一次 Hugging Face，并能在备用源成功后完成模型安装。
- 配置 `FRAMEQ_ASR_MODEL_DOWNLOAD_URL` 时只访问该自定义源；自定义源失败时返回可重试错误，不访问两个官方源。
- ModelScope 与 Hugging Face 均失败时，界面显示可行动错误，诊断日志只包含源、公开模型 ID、尝试次数和脱敏失败分类；缓存已完整可用时启动 ASR 不访问任何下载源。
- server 端 LLM 未就绪或账号额度不可用时，文字稿成功后进入部分完成状态并保留可恢复入口。
- 卸载后安装目录清理干净，app-local data 默认保留用户产物和历史。
