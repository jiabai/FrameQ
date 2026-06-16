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

## 约束

- 技术栈固定为 Tauri + React + TypeScript + Python ASR Worker。
- 默认 ASR 模型为 `Qwen/Qwen3-ASR-0.6B`，后续可提供低资源降级模型。
- 下载、转码和 ASR 默认本地处理。
- 云端 LLM 使用前必须明确提示文字稿会发送到对应服务。
- worker 必须返回结构化状态和错误码，UI 不解析命令行散文本作为业务结果。
- 当前开发态不静默下载大模型权重；真实 ASR 推理需要显式设置 `FRAMEQ_ALLOW_REAL_ASR=1`。
- 模型权重默认缓存到项目 `models/`，可通过 `FRAMEQ_MODEL_DIR` 覆盖；下载/加载进度 UX 完成前，UI 必须给出可行动错误提示。

## 验收标准

- 输入合法抖音 URL 后，UI 从输入态切换到处理态，并展示阶段进度。
- 下载成功后，`outputs/` 中存在 MP4 文件，`ffprobe` 可识别视频流和音频流。
- 音频提取后，`work/` 中存在 16 kHz 单声道 WAV。
- ASR 成功后，`outputs/` 中存在 transcript `.txt` 和 `.md`。
- 话题点成功后，`outputs/` 中存在 insights `.json` 和 `.md`。
- InsightFlow 失败时，UI 展示 `部分完成`，保留文字稿并提供重试入口。
- 结果详情浮窗可在 `启发话题点` 和 `完整文字稿` 间切换，并支持复制和导出。
