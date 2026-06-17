# Douyin Video Transcription Desktop Client

<!-- 由 vibe-coding-launcher 生成。来源：douyin_video_download_solution.md。 -->

## 背景

用户希望在桌面客户端中输入抖音视频 URL，一键完成公开视频下载、音频提取、中文 ASR 转写，并从文字稿中生成可继续思考的启发话题点。

已有方案验证了基础下载链路：示例视频可保存为 `outputs/7524373044106677544.mp4`，并通过 `ffprobe` 校验为有效媒体文件。

## 目标

- 支持粘贴单个抖音视频 URL 并触发处理。
- 下载并校验公开视频，输出标准 MP4 文件。
- 提取 16 kHz 单声道 WAV 音频并调用 `Qwen/Qwen3-ASR-0.6B` 转写中文语音。
- 调用本项目内置的 InsightFlow 话题点生成模块，输出启发话题点。
- 在桌面 UI 中展示进度、结果总览、详情浮窗、复制和导出入口。
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
- 用户可以在桌面 UI 中配置 OpenAI-compatible LLM 服务，用于生成启发话题点，而不需要手工编辑 `.env`。
- 用户可以打开历史任务列表，查看过去处理过的 URL、完成状态、时间和结果路径，并重新打开文字稿或话题点详情。
- 用户可以在设置中修改结果输出目录；修改后只影响新任务，旧历史仍指向旧文件路径。

## 约束

- 技术栈固定为 Tauri + React + TypeScript + Python ASR Worker。
- 默认 ASR 模型为 `Qwen/Qwen3-ASR-0.6B`，后续可提供低资源降级模型。
- 下载、转码和 ASR 默认本地处理。
- 云端 LLM 使用前必须明确提示文字稿会发送到对应服务。
- InsightFlow LLM 配置可由桌面 UI 写入项目根 `.env`，键名为：`FRAMEQ_LLM_PROVIDER=openai_compatible`、`FRAMEQ_LLM_BASE_URL`、`FRAMEQ_LLM_API_KEY`、`FRAMEQ_LLM_MODEL`、`FRAMEQ_LLM_TIMEOUT_SECONDS`。
- 结果输出目录配置可由桌面 UI 写入项目根 `.env`，键名为 `FRAMEQ_OUTPUT_DIR`；为空时默认使用项目根 `outputs/`。
- UI 读取配置时不得回显完整 API Key；只能展示是否已保存密钥，用户可输入新密钥覆盖旧值。
- worker 必须返回结构化状态和错误码，UI 不解析命令行散文本作为业务结果。
- 当前开发态不静默下载大模型权重；真实 ASR 推理需要显式设置 `FRAMEQ_ALLOW_REAL_ASR=1`。
- 模型权重默认缓存到项目 `models/`，可通过 `FRAMEQ_MODEL_DIR` 覆盖；下载/加载进度 UX 完成前，UI 必须给出可行动错误提示。
- 历史记录存放在本地 `work/history.json`，不提交仓库；历史记录不得包含 LLM API key、cookies 或完整敏感请求头。
- 历史记录中的结果路径必须保留任务完成时的实际路径，不因后续输出目录配置变化而重写。

## 验收标准

- 输入合法抖音 URL 后，UI 从输入态切换到处理态，并展示阶段进度。
- 下载成功后，`outputs/` 中存在 MP4 文件，`ffprobe` 可识别视频流和音频流。
- 音频提取后，`work/` 中存在 16 kHz 单声道 WAV。
- ASR 成功后，`outputs/` 中存在 transcript `.txt` 和 `.md`。
- 话题点成功后，`outputs/` 中存在 insights `.json` 和 `.md`。
- InsightFlow 失败时，UI 展示 `部分完成`，保留文字稿并提供重试入口。
- 在 `部分完成` 状态点击话题点重试时，仅重新生成话题点，不重新下载视频或重新执行 ASR。
- `.env` 配置 LLM key 和 model 后，话题点生成调用 OpenAI-compatible Chat Completions 接口；未配置时仍进入 `部分完成` 并保留文字稿。
- 用户在 UI 设置中保存 base URL、API key、model 和 timeout 后，后续完整处理或话题点重试应使用保存后的 LLM 配置。
- 用户在 UI 设置中保存输出目录后，后续完整处理生成的视频、文字稿和话题点文件应写入该目录；中间 WAV 仍写入 `work/`。
- 设置 UI 必须提示：启用云端 LLM 后，文字稿片段会发送到配置的服务。
- 历史入口应展示最近任务列表；每条历史至少包含 URL、状态、时间、输出目录、文字稿路径、话题点路径和错误码或摘要。
- 点击历史中的可用结果应打开与当前结果一致的详情浮窗；导出按钮应定位历史项记录的实际文件路径。
- 处理中点击取消时，桌面端终止当前 worker 进程树，UI 返回输入态并保留已提交 URL；取消后的晚到结果不会覆盖界面。
- 结果详情浮窗可在 `启发话题点` 和 `完整文字稿` 间切换，并支持复制和导出。
