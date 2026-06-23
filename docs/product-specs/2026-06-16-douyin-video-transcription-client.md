# Douyin Video Transcription Desktop Client

<!-- 由 vibe-coding-launcher 生成。来源：douyin_video_download_solution.md。 -->

## 2026-06-23 Server-Managed LLM Dotenv Boundary

- Insight topic generation LLM configuration is now managed by the FrameQ server Admin Web.
- The desktop worker must not load `D:/Github/FrameQ/.env` or any repository-root `.env` as a runtime configuration source.
- App-local data `.env` remains available for local output directory, ASR model selection, and model download overrides, but legacy local `FRAMEQ_LLM_*` dotenv keys must be ignored.
- The settings panel should surface the app-local data `.env` path and allow the user to locate that file in the system file manager.
- Opening or saving settings should create a commented app-local data `.env` template when the file does not exist, so advanced users can inspect supported local keys without relying on the repository-root `.env`.
- Insight generation may only receive LLM runtime material through the server-managed checkout environment (`FRAMEQ_LLM_SOURCE=server`, checkout URL, session token, and request ID).
- The desktop settings UI must not ask users to enter an LLM API key, base URL, model, or timeout.

## 背景

用户希望在桌面客户端中输入抖音视频 URL，先确认启动本地公开视频下载、音频提取和中文 ASR 转写，再在文字稿完成后单独确认生成可继续思考的启发话题点。

已有方案验证了基础下载链路：示例视频可保存为 `outputs/7524373044106677544.mp4`，并通过 `ffprobe` 校验为有效媒体文件。

## 目标

- 支持粘贴单个抖音视频 URL 并触发处理。
- 下载并校验公开视频，输出标准 MP4 文件。
- 提取 16 kHz 单声道 WAV 音频并调用本地 ASR 模型转写中文语音；默认模型为 `iic/SenseVoiceSmall`，并支持选择 Qwen3-ASR。
- 在文字稿完成后，由用户单独确认调用本项目内置的 InsightFlow 话题点生成模块，输出启发话题点。
- 在桌面 UI 中展示进度、结果总览、详情浮窗、复制和导出入口。
- 在结果总览中提供视频、音频、完整文字稿和启发话题点 4 个产物入口；视频和音频入口定位本地文件。
- 支持导出文字稿 `txt` / `md`，以及话题点 `json` / `md`。
- 记录已操作任务历史，允许用户从历史中查看任务状态、打开结果详情并定位已生成文件。
- 允许用户在桌面设置中配置后续任务的结果输出目录。

## 非目标

- 不做未授权批量抓取。
- 不绕过平台访问限制或风控。
- MVP 不要求字幕 `srt`、批量 URL、OCR 或完整模型管理中心。
- MVP 不把大模型权重打包进安装包。
- MVP 不依赖 `D:\Github\InsightFlow\src\server` 作为运行期 import 路径。

## 使用场景

- 用户粘贴一个自己有权处理的公开视频 URL，获得视频文件和文字稿。
- 用户阅读完整文字稿，并复制到笔记或文档中继续编辑。
- 用户打开启发话题点，获得可用于讨论、选题或复盘的开放式问题。
- InsightFlow 配置缺失时，用户仍能得到文字稿，并稍后重试话题点生成。
- 启发话题点使用由管理员在 FrameQ server 端统一配置的 OpenAI-compatible LLM；桌面 UI 不再提供 LLM API Key、base URL、model 或 timeout 输入。
- 用户完成主流程后，可以先查看或定位视频、音频和文字稿，再通过单独的确认面板启动启发话题点生成。
- 用户可以打开历史任务列表，查看过去处理过的 URL、完成状态、时间和结果路径，并重新打开文字稿或话题点详情。
- 用户可以在设置中修改结果输出目录；修改后只影响新任务，旧历史仍指向旧文件路径。
- 用户可以在设置中选择后续任务使用的 ASR 模型：`Qwen/Qwen3-ASR-0.6B` 或 `iic/SenseVoiceSmall`。

## 约束

- 技术栈固定为 Tauri + React + TypeScript + Python ASR Worker。
- 默认 ASR 模型为 `iic/SenseVoiceSmall`；可选 ASR 模型包括 `Qwen/Qwen3-ASR-0.6B`。
- 下载、转码和 ASR 默认本地处理。
- 云端 LLM 使用前必须明确提示文字稿会发送到对应服务。
- InsightFlow LLM 配置由 FrameQ server 托管；worker 不得读取项目根 `.env` 或 app-local `.env` 中的旧 `FRAMEQ_LLM_*` 字段作为 LLM 配置。
- 启发话题点生成应优先让 LLM 对完整 ASR 文字稿做“话题分段规划”，输出话题标题、摘要、原文片段和 `question_count`；随后按每个话题段生成问题。planner 最多保留 8 个话题段、每段 1-3 个问题、最终话题点总数最多 12 个；planner 失败或返回空结果时，fallback 到直接按文本片段生成问题，fallback 默认按约 1000 字生成 1 个问题。OpenAI-compatible LLM 默认 `temperature` 为 `0.7`。
- 结果输出目录配置可由桌面 UI 写入 app-local data `.env`，键名为 `FRAMEQ_OUTPUT_DIR`；为空时默认使用 app-local data `outputs/`。
- ASR 模型配置可由桌面 UI 写入 app-local data `.env`，键名为 `FRAMEQ_ASR_MODEL`；为空时默认使用 `iic/SenseVoiceSmall`。
- UI 读取配置时不得展示或要求输入 LLM API Key；只能展示服务端 LLM 是否已由管理员配置就绪。
- worker 必须返回结构化状态和错误码，UI 不解析命令行散文本作为业务结果。
- 当前开发态不静默下载大模型权重；真实 ASR 推理需要显式设置 `FRAMEQ_ALLOW_REAL_ASR=1`。
- 模型权重默认缓存到项目 `models/`，可通过 `FRAMEQ_MODEL_DIR` 覆盖；SenseVoice/FunASR 必须把该目录同步到 `MODELSCOPE_CACHE`，避免落入 ModelScope 用户级默认缓存。下载/加载进度 UX 完成前，UI 必须给出可行动错误提示。
- SenseVoice 真实推理依赖 `funasr`；当依赖缺失、模型不可下载或模型 ID 不受支持时，worker 必须返回结构化 ASR 错误，不得让 UI 白屏或卡死。
- SenseVoice 处理长音频时必须启用 `fsmn-vad` 切分和长音频合并参数，并在写入文字稿前移除 `<|...|>` 控制标签。
- 历史记录存放在本地 `work/history.json`，不提交仓库；历史记录不得包含 LLM API key、cookies 或完整敏感请求头。
- 历史记录中的结果路径必须保留任务完成时的实际路径，不因后续输出目录配置变化而重写。

## 验收标准

- 输入合法抖音 URL 后，UI 从输入态切换到处理态，并展示阶段进度。
- 首页 `确认` 只启动下载视频、提取音频和 ASR 文字稿流程，请求 worker 时 `generate_insights=false`。
- 下载成功后，`outputs/` 中存在 MP4 文件，`ffprobe` 可识别视频流和音频流。
- 音频提取后，`work/` 中存在 16 kHz 单声道 WAV。
- ASR 成功后，`outputs/` 中存在 transcript `.txt` 和 `.md`。
- 主流程完成后，结果区显示视频、音频、完整文字稿和启发话题点 4 个入口；视频和音频入口在文件管理器中定位对应本地文件。
- 主流程完成后，启发话题点入口显示待生成状态；点击后打开确认面板，用户再次点击 `确认` 才启动生成。
- 话题点生成开始时才使用 server-managed LLM checkout 和消耗 1 次话题点额度；主流程不得携带 checkout env 或消耗额度。
- 用户在 UI 设置中保存 ASR 模型后，后续完整处理请求应使用保存后的 ASR 模型；历史记录和 transcript markdown 中应保留任务实际使用的模型名。
- 话题点成功后，`outputs/` 中存在 insights `.json` 和 `.md`。
- 话题点生成应先请求 LLM 规划话题段，并在逐话题生成问题时包含“读完就知道可以从哪个角度思考”“问题长度尽量控制在一行可读范围内”等表达优化约束。
- planner JSON 无法解析或没有有效话题段时，worker 应自动回退到直接问题生成策略，不因 planner 失败丢失可用文字稿结果。
- InsightFlow 失败时，UI 展示 `部分完成`，保留文字稿并提供重试入口。
- 在 `部分完成` 状态点击话题点重试时，仅重新生成话题点，不重新下载视频或重新执行 ASR。
- 话题点待生成或失败时，点击话题点入口都应进入确认面板；确认后仅运行话题点生成，不重新下载视频、提取音频或重新转写。
- app-local data `.env` 只承载本机 ASR、输出目录和模型下载覆盖；话题点生成不得从 dotenv 读取 LLM key 或 model。
- 管理员在 server 端保存 LLM base URL、API key、model 和 timeout 后，后续话题点生成应通过 server-managed checkout 使用该配置；主流程不携带 LLM checkout env。
- 用户在 UI 设置中保存输出目录后，后续完整处理生成的视频、文字稿和话题点文件应写入该目录；中间 WAV 仍写入 `work/`。
- 设置 UI 必须提示：这里只管理本机 ASR 和输出目录；话题点确认面板必须提示文字稿片段会发送到管理员配置的云端 LLM 服务。
- 历史入口应展示最近任务列表；每条历史至少包含 URL、状态、时间、输出目录、文字稿路径、话题点路径和错误码或摘要。
- 点击历史中的可用结果应打开与当前结果一致的详情浮窗；导出按钮应定位历史项记录的实际文件路径。
- 处理中点击取消时，桌面端终止当前 worker 进程树，UI 返回输入态并保留已提交 URL；取消后的晚到结果不会覆盖界面。
- 结果详情浮窗可在 `启发话题点` 和 `完整文字稿` 间切换，并支持复制和导出；视频和音频不进入详情浮窗，只定位本地文件。

## 2026-06-17 Repeat URL Local Media Reuse

- FrameQ still invokes `yt-dlp` for each submitted URL so the downloader owns its native existing-file skip behavior.
- After `yt-dlp` returns, the worker should prefer a video file whose stem matches the Douyin `/video/<id>` value, and use newest-file fallback only when the URL ID cannot be resolved or no matching local file exists.
- When `work/<video_stem>.wav` already exists and `ffprobe` reports a valid audio stream, the worker should reuse it and skip `ffmpeg` extraction.
- If the cached WAV is missing or invalid, the worker should extract audio from the validated video as before.

## 2026-06-18 macOS Desktop UI Upgrade

- FrameQ should present as a focused macOS-style desktop utility rather than a centered web form.
- Tauri dev/build windows should disable the native titlebar/decorations and use the app's custom toolbar as the visible desktop chrome.
- The custom toolbar must be functional chrome: empty toolbar space drags the Tauri window, and the red/yellow/green controls close, minimize, and maximize/restore the window.
- The Tauri capability for the main window must grant the minimum required window commands for the custom chrome actions.
- On Windows/WebView2, toolbar dragging should fall back to manual window position updates when native `start_dragging` is unreliable.
- The first screen still prioritizes a single URL command input and the fixed primary action `确认`; it must not become a marketing or hero page.
- The waiting-input screen should show only the `粘贴视频链接` card in the content area. The result workspace should appear only after the user submits a URL.
- The shell should use a stable desktop app frame with a compact toolbar, app identity, current status, and icon actions for history, settings, and new task.
- Processing states should appear as a task monitor with a clear stage timeline, worker progress message, percent indicator, and cancel action only while processing.
- Completed and partial-completed states should show compact result tiles for `启发话题点` and `完整文字稿`, including status, small metadata, and clear open/retry affordances.
- Failure states should explain the failed stage, cause, recovery action, and preserved artifacts when available.
- Settings should appear as a macOS-style sheet with grouped fields, local privacy callout, scrollable body, and sticky actions.
- History should preserve the existing behavior while using a denser desktop list treatment that remains scrollable inside the panel.
- The visual system should use restrained neutral surfaces, subtle borders, low shadows, system typography, visible focus states, and semantic status colors.

## 2026-06-22 Douyin Short Link Support

- The URL input should accept canonical Douyin video URLs such as `https://www.douyin.com/video/<id>` and share short links such as `https://v.douyin.com/<code>/`.
- The client should reject empty `v.douyin.com/` links, non-Douyin hosts, and lookalike hosts before starting local processing.
- Download failures from `yt-dlp` should be shown as actionable user guidance for expired or invalid links, login/CAPTCHA requirements, network failures, and other public-access failures, while retaining a short original error summary for troubleshooting.
- FrameQ does not bypass platform access controls, login gates, or CAPTCHA challenges; users should retry with a public, authorized video link.

## 2026-06-23 Xiaohongshu Short Link Support

- The URL input should accept Xiaohongshu share short links in the form `http://xhslink.com/o/<code>` or `https://xhslink.com/o/<code>`.
- The client should reject empty `xhslink.com/o/` links, non-Xiaohongshu hosts, and lookalike hosts before starting local processing.
- Worker download should still pass the original URL to `yt-dlp`; after download it should select the media file created or updated by the current run when no platform-specific video ID is available.
- FrameQ does not bypass Xiaohongshu platform access controls, login gates, risk checks, or CAPTCHA challenges; users should retry with a public, authorized video link.

## 2026-06-22 Insight Failure Reason Visibility

- When insight generation fails after transcript completion, the result workspace should keep video, audio, and transcript entries visible while also showing the structured insight failure code, stage, and actionable recovery copy.
- The client should translate common `INSIGHTFLOW_*`, checkout, quota, timeout, empty-result, and worker-process failures into user-facing Chinese guidance, preserving a short original error summary when useful for troubleshooting.
- If an OpenAI-compatible provider rejects the transcript because of content safety or risk-control policy, FrameQ should classify it as `INSIGHTFLOW_LLM_CONTENT_BLOCKED` and explain that the cloud LLM refused the request rather than hiding it behind a generic request failure.

## 2026-06-23 Insight Retry History Sync

- When insight generation fails and a later retry succeeds, the matching local history item should update from the failed or pending insight state to `completed`, clear the previous error, store the generated `insights_path`, and refresh `insights_count`.
- Local bundled worker resources used by Tauri dev/build should keep this retry-history sync behavior in step with the source worker.
