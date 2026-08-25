# 小红书平台字幕优先转写

**状态：** Proposed

**日期：** 2026-08-25

**所属流程：** 单链接视频转写

**产品范围：** 小红书公开视频笔记；平台已有字幕优先，缺失时本地 ASR 兜底

## 1. 一句话定义

用户提交一个可公开访问的小红书视频链接后，FrameQ 在现有视频转写流程中优先复用平台已经提供的字幕；字幕可用时跳过本地 ASR，字幕不可用时无感回退到现有 ASR 流程。

这不是字幕下载中心，也不是新的字幕导出产品。用户仍然提交一个链接并得到一个正常的 FrameQ 文字稿、历史任务和可选 AI 整理结果。

## 2. 用户问题与目标

### 用户问题

- 小红书部分公开视频已经带有平台生成的时间轴字幕，重复运行本地 ASR 会增加模型准备和推理时间。
- 用户需要知道最终文字稿来自平台字幕还是本地 ASR，避免把平台内容误认为模型转写结果。
- 平台字幕可能缺失、失效或格式异常，不能因此让原本可转写的视频任务失败。

### 产品目标

1. 对公开小红书视频自动探测平台字幕，不增加用户操作步骤。
2. 下载到可用的 `.srt`/`.vtt` 并解析成功后，将其作为正式 transcript source。
3. 命中平台字幕时跳过 ASR 模型加载和推理，但保留正常的视频、音频、文字稿、历史和 AI 整理能力。
4. 字幕缺失或不可用时自动进入现有 ASR，不改变用户完成任务的主路径。
5. 在文字稿详情中显示来源和语言，保证来源语义可追溯。

## 3. 非目标与明确边界

首版不包含：

- 独立的“只下载字幕”入口、字幕下载中心或批量字幕任务；
- 字幕轨道选择器、“全部语言”下载或原始 SRT 浏览器；
- OCR、ASR 生成字幕、画面硬字幕识别或字幕与 ASR 合并校对；
- 小红书登录、浏览器 Cookie 导入、验证码处理、私有内容或权限绕过；
- 新增顶层处理阶段、改变现有视频质量选择、改变 AI 整理确认流程；
- 把标题、话题标签或视频画面文字当成平台字幕。

原始平台字幕文件只作为任务临时区的中间输入，不作为首版用户可见最终产物。用户可见的正式文字稿仍是现有 `transcript/` 产物。

## 4. 现有流程中的用户体验

用户操作保持不变：

```text
粘贴小红书视频链接
  -> 视频提取
  -> 媒体校验 / 音频准备
  -> 检测平台字幕
  -> 平台字幕命中：直接生成文字稿
  -> 未命中：本地 ASR
  -> 可选 AI 整理
```

字幕探测属于现有视频转译阶段内的子步骤，不新增顶层 JobStage。阶段状态应使用现有字幕事件和安全参数：

| 场景 | 用户可见语义 |
| --- | --- |
| 探测中 | `正在检测平台字幕` |
| 命中 | `已找到平台字幕，跳过语音识别` |
| 未命中 | `未找到可用平台字幕，使用本地语音识别` |
| 字幕异常 | 不阻断视频任务；进入上面的“未命中”路径 |

除来源提示外，命中字幕与 ASR 的任务都保留现有结果卡片、文字稿编辑/音频回听、历史记录和 AI 整理入口。

## 5. 平台字幕来源与选择规则

### 5.1 来源

小红书公开视频笔记的已验证字幕路径为页面初始状态中的：

```text
note.video.mediaV2
  -> JSON 字符串解码
  -> video.subtitles
  -> 具体字幕轨道 URL
  -> SRT/VTT
```

FrameQ 应复用现有小红书页面解析和 HTTP transport，在同一次 note 页面读取中获取字幕描述，不新增第二套页面请求协议。详细字段验证见 [`2026-08-23-xiaohongshu-platform-subtitle-direct-extraction.md`](../design-docs/2026-08-23-xiaohongshu-platform-subtitle-direct-extraction.md)。

### 5.2 单轨选择

首版每个任务只选择一条轨道，不提供用户选择器。选择规则沿用现有字幕优先策略，并针对已验证的小红书轨道做稳定排序：

1. 用户未来明确指定语言时，只接受该语言轨道；首版 UI 不暴露该设置。
2. 默认优先原始中文轨道 `source`，然后是 `zh-Hans`、`zh-CN`、`zh-Hant`、`zh`。
3. 没有中文轨道时，按现有通用策略考虑 `en-US`/`en` 等可用语言；不因语言不理想而阻断视频任务。
4. 同一语言同时存在多个轨道时，只落地排序最高的一条，避免下游重复候选。
5. 输出语言写入 transcript metadata；语言值必须经过固定字符集校验，不直接作为任意路径片段。

## 6. 转写结果与产物

### 平台字幕命中

- 使用解析后的平台字幕生成正式 `transcript/transcript.txt`、`transcript/transcript.md` 和 `transcript/segments.json`。
- `transcript.source` 为 `subtitle`，`transcript.language` 为实际轨道语言，`transcript.engine` 为 `null`。
- `transcript.md` 显示 `Transcript Source: Platform subtitle` 和字幕语言，不显示 ASR engine 或模型名称。
- 保留正常视频、音频和任务目录结构；AI 整理继续读取正式 `transcript.txt`。
- 跳过 ASR 模型下载、加载和推理，但不跳过视频下载、媒体校验或音频准备等既有任务步骤。

### 平台字幕未命中

- 字幕缺失、请求失败、签名过期、内容为空、格式不支持、时间轴非法或清洗后没有有效 cue，均视为未命中。
- 保留现有视频和音频产物，继续本地 ASR。
- `transcript.source` 为 `asr`，沿用当前 ASR engine 和模型 metadata。
- 不把字幕探测失败升级为小红书视频下载失败。

### 临时字幕文件

- 原始 `.srt`/`.vtt` 只写入 `cache/tasks/<task_id>/download/` 临时目录。
- 不把原始字幕文件注册为最终用户产物，不写入 `frameq-task.json` 的 artifact 路径。
- 字幕解析失败时保留现有临时文件清理策略，不影响已提交的 MP4 或音频。

## 7. 错误与恢复

| 情况 | 行为 |
| --- | --- |
| `mediaV2` 缺失或不是字符串 | 记录安全的未命中状态，继续 ASR |
| `mediaV2` JSON 畸形或缺少 `video.subtitles` | 继续 ASR |
| 轨道缺少 URL、URL 非允许 HTTPS 字幕资源 | 继续 ASR |
| 字幕响应非 2xx、空响应或超过大小上限 | 继续 ASR |
| SRT/VTT 无法解析或有效 cue 为 0 | 继续 ASR |
| 视频流不存在或视频下载失败 | 保持现有 `XHS_*` 视频错误，不把字幕探测当作视频能力 |
| 字幕命中但 ASR 配置缺失 | 仍可完成平台字幕转写，不加载 ASR 模型 |

字幕探测是 best-effort 优化；任何字幕侧异常都不能覆盖更主要的视频下载、媒体校验和 ASR 错误语义。

## 8. 隐私与安全

- 只处理用户提交的公开或已授权小红书链接。
- `xsec_token` 只在本次 worker 请求内存中转发到公开页面请求，不进入 manifest、History、日志、诊断、UI 文案、AI prompt 或 server 请求。
- 字幕 URL 的签名 query 只用于当前下载请求，不落盘、不写日志、不写入任务 manifest。
- 继续使用当前进程内匿名 CookieJar；不读取浏览器 Cookie，不持久化 Cookie，不自动登录，不绕过 CAPTCHA 或权限限制。
- 页面、字幕响应和临时文件均受大小限制；字幕下载使用原子临时文件提交，避免半截文件被下游读取。
- 平台字幕正文属于用户本地任务内容，默认只在本机生成 transcript 和 AI 整理输入，不上传到 FrameQ server。

## 9. 功能验收标准

### 必须通过

- 四个已验证的公开小红书视频样本均能从 `mediaV2.video.subtitles` 找到至少一条可用平台 SRT，并在命中时跳过 ASR。
- `source`、`zh-CN`、`en-US` 轨道的解析、选择和语言 metadata 正确。
- 字幕缺失、畸形 JSON、失效签名、非 2xx、空响应、超限、非法时间戳和空 cue 都能继续 ASR。
- 平台字幕命中时 transcript metadata 不包含 ASR engine；ASR 兜底时保持现有 metadata。
- 视频下载成功但字幕下载失败时，MP4、音频和任务历史仍按现有流程完成。
- UI 不新增字幕下载中心、轨道选择器、登录或 Cookie 操作；只显示字幕检测与来源状态。
- 不记录 `xsec_token`、签名 URL、Cookie、完整请求头或响应正文。

### 回归要求

- 现有 YouTube/Bilibili 字幕优先行为不改变。
- 现有小红书无字幕视频仍能走 ASR 并产出与当前一致的任务结果。
- 现有小红书图片笔记、私有/风控/CAPTCHA 页面和无视频流错误语义不改变。
- AI 整理仍只读取正式 `transcript.txt`，不直接读取小红书原始 SRT。

## 10. 实施前置条件

本 spec 只定义产品意图和边界，不授权立即实现。进入实现前需要创建并确认独立 ExecPlan，至少覆盖：

1. 小红书平台轨道解析、语言排序和安全校验；
2. 小红书 fallback 在一次页面请求中复用 note 状态并 best-effort 下载字幕；
3. 临时字幕原子写入与现有 `find_subtitle_transcript` 接入；
4. transcript source metadata、进度事件和 UI 来源展示；
5. 缺失/异常回退 ASR、真实样本和全量 worker/app 门禁。

## 11. 依据与现状

- 已验证技术方案：[`2026-08-23-xiaohongshu-platform-subtitle-direct-extraction.md`](../design-docs/2026-08-23-xiaohongshu-platform-subtitle-direct-extraction.md)
- 四条公开样本的实际字幕探针记录位于 `docs/references/2026-08-21-*` 和 `docs/references/2026-08-22-*`。
- 现有字幕优先转写边界：[`2026-06-16-douyin-video-transcription-client.md`](2026-06-16-douyin-video-transcription-client.md) 中的 YouTube/Bilibili Subtitle-First Transcript Source 章节。
- 现有小红书视频 fallback：`worker/frameq_worker/xiaohongshu_fallback.py` 及 `worker/frameq_worker/xiaohongshu/` 私有模块。
