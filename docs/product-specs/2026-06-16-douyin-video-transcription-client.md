# Douyin Video Transcription Desktop Client

## 2026-07-05 Task-Owned Artifact Layout

- Each new processing run should create one task-owned output directory under `<FRAMEQ_OUTPUT_DIR>/tasks/<task_id>/`.
- FrameQ no longer treats flat `outputs/*.mp4`, `outputs/*_transcript.txt`, or legacy app-local history records as the product contract for new tasks.
- The task directory should be the user-visible folder for final artifacts: media, transcript, transcript timing, AI summary, mindmap, insights, and `frameq-task.json`.
- `frameq-task.json` is the task source of truth. It should record task identity, source URL, platform, status, model, version metadata, relative artifact paths, error, preview, and insight count.
- App-local `cache/tasks/<task_id>/` is reserved for temporary downloads, partial files, merge scratch space, and diagnostics. These files should not be mixed into the user-visible task output folder.
- The desktop history panel becomes a task library built from task manifests. Old flat-output tasks and old `history.json` records are intentionally ignored by this redesign.
- Transcript review, save, retry AI整理, copy, export, and locate actions should operate by `task_id` and manifest artifacts, not by arbitrary local transcript or audio paths.

## 2026-07-05 YouTube/Bilibili Subtitle-First Transcript Source

- For public YouTube and Bilibili links that complete through `yt-dlp`, FrameQ should request platform subtitle files before local ASR and reuse a valid `.vtt` or `.srt` subtitle as the official transcript when available.
- Subtitle reuse is an optimization inside the existing single-link workflow. It does not add a subtitle picker, raw subtitle viewer, download center, platform login, cookie import, or private-content bypass.
- When a usable subtitle is found, FrameQ should still keep the normal video artifact, audio artifact, audio review behavior, transcript result card, history row, and optional AI整理 flow. Only local ASR model loading and inference are skipped.
- When subtitles are missing, malformed, too short, unsupported, or the Bilibili public fallback path is used, the worker should silently continue through the existing local ASR path and preserve existing recoverable error behavior.
- `frameq-task.json` should use `schema_version: 2`, keep top-level `model` as the configured ASR fallback model, and add `transcript: { source, language, engine }` for the actual transcript source. Old schema v1 manifests without `transcript` should be interpreted as ASR-sourced.
- `transcript.md` metadata should distinguish `Platform subtitle` from `Local ASR`. The UI may show the source and language in the transcript detail view, but it should not claim whether a subtitle was manual, automatic, or translated.

## 2026-07-03 Transcript Audio Review Editor

- The `完整文字稿` detail view should become an audio review and correction surface instead of a read-only searchable text preview.
- The detail toolbar search box should be removed for this view. The user should review by listening, selecting transcript blocks, and editing text directly.
- When the processed task has a local audio file, the transcript detail view should render a native audio player above the transcript content.
- When the worker has produced valid transcript time segments, clicking a transcript block should highlight that block, seek the audio player to the block's `start_ms`, and start playback. For SenseVoice, these segments may come from sentence timing when available or from directly transcribed FSMN-VAD speech blocks when sentence timing is absent.
- During playback, the current block highlight should follow the audio time and move to the next block when playback reaches the next segment. Speaker metadata must not affect seek or highlight behavior, including the single-speaker case.
- Starting an edit should pause audio playback and lock focus to the edited block. Saving should write the official transcript and, if audio was playing before edit, resume playback from the paused position.
- Editing is block-level for v1. FrameQ should not infer word-level timestamps or character-level timing. SenseVoice may use real FSMN-VAD speech block boundaries, but must not invent timing by distributing text over the audio duration.
- Saving confirms the edited transcript as the official transcript used by later AI整理 and exported transcript files. Unsaved drafts should be copied by the copy action, but export/location actions should continue to target the official saved file and ask the user to save first when needed.
- Tasks without a segment sidecar should still open: the audio player and full-text editor remain available when audio/text files exist, but click-to-seek and playback-following block highlight are disabled.
- Audio-missing tasks should remain editable as text. The UI should show a recoverable local-audio-unavailable state rather than blocking transcript correction.

<!-- 由 vibe-coding-launcher 根据根目录历史方案迁移生成；当前以本文件为 source of truth。 -->

## 2026-07-07 External Output Audio Playback Cache

- When `FRAMEQ_OUTPUT_DIR` points outside app-local data, transcript review may use a Tauri-controlled playback copy under `$APPLOCALDATA/outputs/.frameq-audio-review/<task_id>/audio.<ext>`.
- `audio_path` remains the original manifest-declared task audio under `<FRAMEQ_OUTPUT_DIR>/tasks/<task_id>/`; `audio_asset_path` is the player-safe path used by the frontend audio element.
- The playback cache is rebuildable. Clearing it must not delete original task artifacts, and the next transcript detail load should recreate the playback copy from the original source audio if that source still exists.
- Settings should add manual cache management only: show `Audio playback cache: <size>` and provide a `Clear audio playback cache` action. Automatic age-based or LRU cleanup is deferred for the first management UI.
- If the original source audio is missing after cache cleanup, transcript review should degrade to text editing with the existing local-audio-unavailable state.

## 2026-06-29 YouTube Public Video Support

- FrameQ should accept ordinary public YouTube single-video links in the existing single input: `youtube.com/watch?v=...`, `youtu.be/...`, and `youtube.com/shorts/...`.
- `watch?v=...&list=...` is treated as one video only; the worker must keep `--no-playlist` and ignore playlist context.
- Playlist pages, channel pages, handle pages, `music.youtube.com`, live-only content, private videos, member-only videos, age/login-restricted videos, and empty short links remain unsupported.
- YouTube v1 uses the existing `yt-dlp` extractor and existing video -> audio -> transcript -> optional AI整理 pipeline. When a usable platform subtitle is available it may become the transcript source before local ASR; otherwise the task falls back to ASR. It does not add a YouTube crawler, YouTube API integration, login flow, cookie import, proxy setup, download center, stream picker, or batch workflow.
- The worker should use a transcription-first format policy for YouTube: prefer MP4/M4A video+audio up to 720p, with fallback to available 720p-or-below formats.
- YouTube failures should remain top-level `VIDEO_DOWNLOAD_FAILED` while surfacing sanitized `YOUTUBE_*` cause prefixes for UI copy: login/verification required, age restricted, private/unavailable, no playable stream, or generic download failure.
- UI recovery copy should ask the user to retry with a public accessible video and must not instruct users to provide cookies or login.
- Full volatile YouTube/Google media CDN URLs, signed query parameters, cookies, Authorization material, login state, and bypass instructions must not be stored in history, logs, UI errors, or server requests.

## 2026-06-23 Server-Managed LLM Dotenv Boundary

- Insight topic generation LLM configuration is now managed by the FrameQ server Admin Web.
- The desktop worker must not load `D:/Github/FrameQ/.env` or any repository-root `.env` as a runtime configuration source.
- App-local data `.env` remains available for local output directory, ASR model selection, and model download overrides, but legacy local `FRAMEQ_LLM_*` dotenv keys must be ignored.
- The settings panel should surface the app-local data `.env` path and allow the user to locate that file in the system file manager.
- Opening or saving settings should create a commented app-local data `.env` template when the file does not exist, so advanced users can inspect supported local keys without relying on the repository-root `.env`.
- Insight generation may only receive LLM runtime material through the server-managed checkout environment (`FRAMEQ_LLM_SOURCE=server`, checkout URL, session token, and request ID).
- The desktop settings UI must not ask users to enter an LLM API key, base URL, model, or timeout.

## 2026-06-23 ASR Model Cache Layout Boundary

- `FRAMEQ_MODEL_DIR` points to the app-local ModelScope cache root; the canonical SenseVoice and VAD files live under `<FRAMEQ_MODEL_DIR>/models/iic/...`.
- ModelScope downloads and FunASR runtime loading must use the same canonical cache layout to avoid duplicate `iic/...` and `models/iic/...` model copies.
- Existing legacy top-level `iic/SenseVoiceSmall` and `iic/speech_fsmn_vad_zh-cn-16k-common-pytorch` caches should be migrated or cleaned automatically only when the canonical cache is complete.
- Unknown user or future model directories under top-level `iic/` must be preserved.

## 2026-06-25 Douyin Share Page Fallback and Highest Quality Video Preservation

- `yt-dlp` remains the first download attempt for supported public video links, but Douyin failures caused by empty web detail JSON, `Fresh cookies` guidance, or web detail parse failure should trigger a Douyin-specific fallback before returning `VIDEO_DOWNLOAD_FAILED`.
- The fallback derives the `aweme_id` from canonical Douyin URLs or resolved short links, then requests the public share SSR page `https://www.iesdouyin.com/share/video/{aweme_id}/?app=aweme`.
- The worker should parse `window._ROUTER_DATA` and `videoInfoRes.item_list[0]` from the share page. When `video.bit_rate` is empty, it should use `video.play_addr.uri` to probe `https://aweme.snssdk.com/aweme/v1/play/?video_id={uri}&ratio={ratio}&line=0`.
- Stream probing must use small ranged GET requests and only accept candidates that return a valid partial media response, a positive content size, and a video-like content type.
- If multiple playable streams are available, FrameQ should select the largest candidate by `size_bytes` so the saved local video favors highest quality. If sizes tie, choose the higher resolution or quality rank. If the selected candidate later fails download or `ffprobe` validation, the worker should retry the next candidate.
- The downloaded fallback video should be written as a normal local MP4 under the configured output directory, preferably with the Douyin video ID as the stem, so the existing media selection, history, audio extraction, ASR, and result-location behavior continue unchanged.
- MVP should not expose a stream picker in the main flow. A future settings option may allow `最高质量` and `转写优先` policies, but the current default is highest-quality preservation.
- The fallback may use a fixed mobile Safari `User-Agent` and minimal public-page headers to access public share pages. It must not rotate user agents, use proxy pools, spoof browser fingerprints, solve CAPTCHA, automate login, or scrape account-authenticated content.
- The worker may keep anonymous share-page cookies in memory for one invocation, but must not read browser cookie stores, persist cookies, or include cookies/sensitive headers/full media CDN URLs in history or logs.
- Fallback failures should be classified into user-readable causes such as ID parse failure, public share page unavailable, router data missing, no playable stream, stream download failure, and media validation failure.
- The fallback must not collect, persist, or require user browser cookies, and must not attempt to bypass login gates, CAPTCHA, private content restrictions, or platform access controls. It is only for public or user-authorized links that expose a share page and playable media URL.

## 2026-06-26 EasyDownload Transcription-Oriented Migration Scope

- FrameQ should use EasyDownload only as an MIT-licensed algorithm reference for improving public-link acquisition before local transcription; it must not become a general downloader or expose a download center.
- Douyin compatibility work should prioritize share text parsing, short-link resolution, `/note/{id}` and `/share/slides/{id}` handling, and `modal_id` or `aweme_id` extraction when those inputs resolve to a public playable video.
- Worker download reliability should improve through streaming `.part` writes, safe resume/range validation, candidate retry, no-progress timeout handling, maximum-size guardrails, and `ffprobe` validation before the media enters ASR.
- Xiaohongshu fallback should be video-only: resolve supported share text or `xhslink.com` links, parse public page state such as `__INITIAL_STATE__`, and extract a playable video stream only when the note is public or user-authorized.
- Bilibili fallback should support ordinary public BV/av videos and safe `b23.tv` short links by fetching public Web API metadata, selecting one no-cookie DASH video/audio stream pair, downloading `.m4s` files safely, and merging them into one MP4 for the existing transcription pipeline.
- The user-visible workflow remains the existing transcription flow: submit one link, process local video/audio/ASR, then optionally confirm AI整理. No stream picker, batch queue, account login, cookie import, or proxy setup should be added for this migration.
- Do not migrate EasyDownload's WeChat MITM/CA/system proxy behavior, Bilibili login/SESSDATA/bangumi/member-only/DRM workflows, Wails/Vue UI, tray behavior, image proxy, or download-manager product model.
- The product copy should describe this work as improved public-link compatibility and safer download reliability for transcription, not as platform scraping or archive downloading.

## 2026-06-27 Xiaohongshu Video Fallback Completion

- Xiaohongshu support should accept public video note share text, `xhslink.com` short links, `www.xhslink.com` short links, full `xiaohongshu.com/explore/{note_id}` URLs, and links that carry `xsec_token`.
- The desktop UI should keep the single input workflow and should not introduce a Xiaohongshu download center, stream picker, image album picker, login flow, cookie import, or proxy setup.
- Worker fallback should preserve `xsec_token`, resolve short links through standard redirects or embedded HTML URLs, and fetch the public note page through browser-like navigation headers.
- Worker page parsing should handle `gzip`, Brotli `br`, and zlib/raw `deflate` responses, then extract `window.__INITIAL_STATE__` with the existing JavaScript-to-JSON tolerance.
- Worker stream selection should align with EasyDownload's video stream model: support list and codec-keyed schemas, deduplicate by quality key, and prefer URL availability, codec rank, official weight, stream type, default stream, resolution, bitrate, size, and backup URL availability.
- Download should be safe for large videos: streaming `.part` writes, resume-safe range validation, no-progress timeout, 2 GiB maximum video size, backup URL retry, and existing-file preservation on failure.
- Image-only Xiaohongshu notes, private/login-gated notes, CAPTCHA-gated notes, rate-limited pages, malformed page state, oversized videos, stalled downloads, or no playable video stream should produce structured recoverable `XHS_*` errors with clear Chinese UI guidance.
- The resulting MP4 should still flow through the existing `ffprobe`, `ffmpeg`, ASR, history, transcript, summary, mindmap, and insight generation pipeline without changing the worker JSON result shape.

## 2026-06-27 Bilibili Public Video Fallback

- Bilibili support should accept ordinary public video URLs in BV and av forms, plus safe `b23.tv` short links that resolve to ordinary `/video/` pages.
- The desktop UI should keep the single input workflow and should not introduce a Bilibili download center, stream picker, quality selector, batch queue, login flow, QR login, cookie import, or proxy setup.
- Worker fallback should parse BV/av IDs, preserve the submitted source for history, resolve safe short links with finite redirect depth, and select one part from `?p=N` or the first part by default.
- Worker metadata lookup should use public Bilibili Web APIs for ordinary videos: `x/web-interface/view` for title/pages/cid and `x/player/playurl` with DASH flags for video/audio stream URLs.
- Worker stream selection should align with EasyDownload's public-video model: parse camelCase and snake_case URL fields, merge backup URLs, prefer AV1 over HEVC over H.264, choose higher bandwidth within the same codec, and choose the highest-bandwidth audio stream.
- Download should be safe for DASH media: video/audio `.m4s` streaming `.part` writes, resume-safe range validation where available, no-progress timeout, maximum-size guardrails, backup URL retry, and existing-file preservation on failure.
- Worker merge should use the existing bundled FFmpeg to combine the selected video and audio streams with stream copy into a normal MP4, then continue through the existing `ffprobe`, audio extraction, ASR, history, transcript, summary, mindmap, and insight pipeline without changing the Bilibili fallback product surface. Subtitle-first reuse applies only to Bilibili `yt-dlp` success paths in v1; public fallback continues through ASR.
- PGC/bangumi links, login-required videos, member-only streams, DRM-protected streams, unavailable videos, malformed API responses, failed DASH downloads, or failed FFmpeg merges should produce structured recoverable `BILIBILI_*` errors with clear Chinese UI guidance.
- The fallback must not collect, store, or request browser cookies or `SESSDATA`, must not automate login or QR login, and must not attempt to bypass CAPTCHA, private content, member-only access, or DRM.

## 背景

用户希望在桌面客户端中输入抖音视频 URL，先确认启动本地公开视频下载、音频提取和中文 ASR 转写，再在文字稿完成后单独确认生成可继续思考的要点总结、Mermaid mindmap 和启发话题点。

已有方案验证了基础下载链路：示例视频可保存为 task 目录中的 `media/video.mp4`，并通过 `ffprobe` 校验为有效媒体文件。

## 目标

- 支持粘贴单个抖音视频 URL 并触发处理。
- 下载并校验公开视频，输出标准 MP4 文件。
- 提取 16 kHz 单声道 WAV 音频并调用本地 ASR 模型转写中文语音；默认模型为 `iic/SenseVoiceSmall`，并支持选择 Qwen3-ASR。
- 在文字稿完成后，由用户单独确认调用本项目内置的 AI 整理能力，输出要点总结、Mermaid 思维导图本地文件和启发话题点。
- 在桌面 UI 中展示进度、结果总览、详情浮窗、复制和导出入口。
- 在结果总览中提供视频、音频、完整文字稿、要点总结、启发话题点这 5 个入口；Mermaid mindmap 作为本地 `.mmd` 文件保存但不作为单独入口展示；视频和音频入口定位本地文件。
- 支持导出文字稿 `txt` / `md`、要点总结 `md`，以及话题点 `json` / `md`；Mermaid 思维导图仅保存为本地 `.mmd` 文件，不展示或渲染。
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
- 用户打开要点总结，获得基于文字稿原文和 Mermaid 思维导图整理出的层次化 Markdown 摘要。
- 用户打开启发话题点，获得可用于讨论、选题或复盘的开放式问题。
- InsightFlow 配置缺失时，用户仍能得到文字稿，并稍后重试 AI 整理。
- AI 整理使用由管理员在 FrameQ server 端统一配置的 OpenAI-compatible LLM；桌面 UI 不再提供 LLM API Key、base URL、model 或 timeout 输入。
- 用户完成主流程后，可以先查看或定位视频、音频和文字稿，再通过单独的确认面板启动要点总结、Mermaid mindmap 和启发话题点生成。
- 用户可以打开历史任务列表，查看过去处理过的 URL、完成状态、时间和结果路径，并重新打开文字稿、要点总结或话题点详情。
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
- 模型权重默认缓存到 app-local data `models/`，可通过 `FRAMEQ_MODEL_DIR` 覆盖；该目录是 ModelScope cache root，SenseVoice/FunASR 的实际文件位于其 `models/iic/...` 子树。下载/加载进度 UX 完成前，UI 必须给出可行动错误提示。
- SenseVoice 真实推理依赖 `funasr`；当依赖缺失、模型不可下载或模型 ID 不受支持时，worker 必须返回结构化 ASR 错误，不得让 UI 白屏或卡死。
- SenseVoice 处理长音频时必须启用 `fsmn-vad` 切分和长音频合并参数，并在写入文字稿前移除 `<|...|>` 控制标签。
- 历史任务库从 `<FRAMEQ_OUTPUT_DIR>/tasks/<task_id>/frameq-task.json` 读取；新版本不再读取旧版 app-local history。
- `frameq-task.json` 只记录任务元数据、相对 artifact 路径、错误码、预览和计数，不得包含 LLM API key、cookies 或完整敏感请求头。

## 验收标准

- 输入合法抖音 URL 后，UI 从输入态切换到处理态，并展示阶段进度。
- 首页 `确认` 只启动下载视频、提取音频和 ASR 文字稿流程，请求 worker 时 `generate_insights=false`。
- 下载成功后，`<FRAMEQ_OUTPUT_DIR>/tasks/<task_id>/media/video.mp4` 存在，`ffprobe` 可识别视频流和音频流。
- 当 `yt-dlp` 因 Douyin web detail 空响应、`Fresh cookies`、JSON 解析失败或同类公开链接解析问题失败时，worker 应尝试 Douyin share page fallback；fallback 成功时 UI 不进入失败态，后续流程与普通下载一致。
- Douyin share page fallback 解析出多个候选流时，默认下载体积最大的可用 MP4；若该流下载或媒体校验失败，应自动降级尝试下一候选流，并在所有候选失败后返回结构化 `VIDEO_DOWNLOAD_FAILED`。
- 音频提取后，当前 task 目录的 `media/audio.wav` 中存在 16 kHz 单声道 WAV；临时下载和中间文件保留在 app-local `cache/tasks/<task_id>/`。
- ASR 成功后，当前 task 目录的 `transcript/` 中存在 `transcript.txt`、`transcript.md`，有合法时间轴时存在 `segments.json`。
- 主流程完成后，结果区显示视频、音频、完整文字稿、要点总结、启发话题点这 5 个入口；Mermaid mindmap 保存为本地 `.mmd` 文件但不作为单独入口展示；视频和音频入口在文件管理器中定位对应本地文件。
- 主流程完成后，要点总结、启发话题点入口显示待生成状态；点击后打开确认面板，用户再次点击 `确认` 才启动要点总结、Mermaid mindmap 和启发话题点生成。
- AI 整理开始后才使用 server-managed LLM checkout；主流程不得携带 checkout env 或消耗额度。AI 整理额度按云端 LLM API 调用尝试计费，1 次额度对应 1 次 chat-completion/API 调用尝试，而不是 1 次 AI整理任务包。
- 用户在 UI 设置中保存 ASR 模型后，后续完整处理请求应使用保存后的 ASR 模型；历史记录和 transcript markdown 中应保留任务实际使用的模型名。
- AI 整理成功后，当前 task 目录的 `ai/` 中存在 `summary.md`、`mindmap.mmd`、`insights.json` 和 `insights.md`。
- 话题点生成应先请求 LLM 规划话题段，并在逐话题生成问题时包含“读完就知道可以从哪个角度思考”“问题长度尽量控制在一行可读范围内”等表达优化约束。
- planner JSON 无法解析或没有有效话题段时，worker 应自动回退到直接问题生成策略，不因 planner 失败丢失可用文字稿结果。
- InsightFlow 失败时，UI 展示 `部分完成`，保留文字稿和已经成功生成的 AI 产物，并提供重试入口。
- 在 `部分完成` 状态点击要点总结或话题点重试时，仅重新运行 AI 整理，不重新下载视频或重新执行 ASR。
- 要点总结或话题点待生成/失败时，点击对应入口都应进入确认面板；确认后仅运行要点总结、Mermaid mindmap 和话题点生成，不重新下载视频、提取音频或重新转写。
- app-local data `.env` 只承载本机 ASR、输出目录和模型下载覆盖；话题点生成不得从 dotenv 读取 LLM key 或 model。
- 管理员在 server 端保存 LLM base URL、API key、model 和 timeout 后，后续话题点生成应通过 server-managed checkout 使用该配置；主流程不携带 LLM checkout env。
- 用户在 UI 设置中保存输出目录后，后续完整处理生成的视频、音频、文字稿、要点总结、Mermaid mindmap 和话题点文件应写入该目录下的 `tasks/<task_id>/`；临时下载和中间产物仍写入 app-local `cache/tasks/<task_id>/`。
- 设置 UI 必须提示：这里只管理本机 ASR 和输出目录；AI 整理确认面板必须提示文字稿片段会发送到管理员配置的云端 LLM 服务。
- 历史入口应展示最近任务列表；每条历史至少包含 URL、状态、时间、输出目录、文字稿路径、要点总结路径、Mermaid mindmap 路径、话题点路径和错误码或摘要。
- 点击历史中的可用结果应打开与当前结果一致的详情浮窗；导出按钮应定位历史项记录的实际文件路径。
- 处理中点击取消时，桌面端终止当前 worker 进程树，UI 返回输入态并保留已提交 URL；取消后的晚到结果不会覆盖界面。
- 结果详情浮窗可在 `要点总结`、`启发话题点` 和 `完整文字稿` 间切换，并支持复制和导出；视频和音频不进入详情浮窗，只定位本地文件，Mermaid 文本不进入详情浮窗。

## 2026-06-17 Repeat URL Local Media Reuse

- FrameQ still invokes `yt-dlp` for each submitted URL so the downloader owns its native existing-file skip behavior.
- After `yt-dlp` returns, the worker should prefer a video file whose stem matches the Douyin `/video/<id>` value, and use newest-file fallback only when the URL ID cannot be resolved or no matching local file exists.
- When the current task's `media/audio.wav` already exists and `ffprobe` reports a valid audio stream, the worker should reuse it and skip `ffmpeg` extraction.
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

## 2026-06-23 Insight Retry Task Manifest Sync

- When insight generation fails and a later retry succeeds, the same task manifest should update from the failed or pending insight state to `completed`, clear the previous error, store generated `ai/` artifacts, and refresh `insights_count`.
- Local bundled worker resources used by Tauri dev/build should keep this task-manifest retry behavior in step with the source worker.

## 2026-06-25 Transcript Summary and Mermaid Mindmap

- After transcript completion, the existing second confirmation starts one AI整理 run that generates `要点总结`, local Mermaid mindmap, and `启发话题点` using server-managed LLM checkout.
- The AI整理 run consumes quota per underlying cloud LLM API call attempt. A single AI整理 run may make multiple LLM calls, and each attempted call consumes one quota use.
- The worker should first generate a Mermaid `mindmap` text from the transcript, then generate a layered Markdown summary from the original transcript and that Mermaid mindmap.
- The UI shows the summary content as a result card and detail tab, but must not display or render the Mermaid source.
- Summary artifacts are written under the current task's `ai/summary.md`; Mermaid text is written to `ai/mindmap.mmd`.
- Task manifests should preserve `summary`, `mindmap`, and summary text loading so completed tasks can reopen the summary detail.
- If summary generation succeeds but topic generation fails, the summary remains available and the task is `partial_completed`; if topic generation succeeds but summary generation fails, topic output remains available and the task is `partial_completed`.
- Transcript-only completion shows both `要点总结` and `启发话题点` as pending AI整理 outputs until the user confirms generation.
