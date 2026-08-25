# 小红书平台字幕直接提取方案

**日期：** 2026-08-23
**状态：** 已完成真实页面验证，并已按确认后的 ExecPlan 实现
**范围：** 小红书公开视频笔记的已有平台字幕；不包含 ASR 生成字幕

## 1. 决策摘要

小红书公开视频的字幕资源位于页面 `window.__INITIAL_STATE__` 中的：

```text
note.video.mediaV2                 # JSON 字符串，不是对象
  -> json.loads(mediaV2).video.subtitles
  -> source / zh-CN / en-US ...
  -> track.url                       # 签名 SRT URL
```

FrameQ 当前小红书 fallback 只读取 `note.video.media.stream` 下载 MP4，尚未主动读取
`mediaV2.video.subtitles`。直接提取的正确方法是复用现有小红书页面解析和 HTTP transport，
解码 `mediaV2` 后下载平台返回的 SRT，再交给现有 `find_subtitle_transcript` 解析。

## 2. 已验证事实

以下四条真实公开笔记均通过 FrameQ 生产 worker 的页面解析入口验证：页面 HTTP 200、note 类型为
`video`、字幕组包含 `en-US`、`source`、`zh-CN`，且三组 SRT URL 均实际返回 HTTP 200。

| 笔记 ID | `source / zh-CN` 解析结果 | 现场记录 |
| --- | --- | --- |
| `6a81333b000000003300b98f` | 335 段，8427 字符 | [`2026-08-21` 实测](../references/2026-08-21-xiaohongshu-platform-subtitle-probe.md) |
| `6a82e94900000000260360d5` | 276 段，6917 字符 | [`6a82e949` 实测](../references/2026-08-22-xiaohongshu-platform-subtitle-probe-6a82e949.md) |
| `6a84fc60000000002c0077e4` | 243 段，5984 字符 | [`6a84fc60` 实测](../references/2026-08-22-xiaohongshu-platform-subtitle-probe-6a84fc60000000002c0077e4.md) |
| `6a872cd0000000002702f748` | 224 段，5378 字符 | [`6a872cd0` 实测](../references/2026-08-22-xiaohongshu-platform-subtitle-probe-6a872cd0000000002702f748.md) |

这些结果证明字幕是平台返回的 SRT 资源，不是从视频画面 OCR，也不是 ASR 推理结果。

## 3. 复用的 FrameQ 边界

页面获取必须沿用现有生产入口，不新增第二套小红书请求协议：

1. `xiaohongshu_fallback.parse_xiaohongshu_input`：解析 note ID 和临时 `xsec_token`。
2. `xiaohongshu.source.build_explore_url`：构造 `/explore/{note_id}` 页面地址。
3. `xiaohongshu.transport.UrllibXiaohongshuHttpClient`：使用当前进程内匿名 CookieJar 和 urllib。
4. `xiaohongshu.transport.page_headers`：获取页面时使用现有固定兼容请求头。
5. `xiaohongshu.page.decode_response_body`：解码 gzip/Brotli/deflate 并执行页面大小限制。
6. `xiaohongshu.page.extract_initial_state`、`lookup_note`：提取并定位 note 对象。
7. `xiaohongshu.transport.media_headers`：请求签名字幕 URL。
8. `frameq_worker.subtitles.find_subtitle_transcript`：解析落地后的 `.srt` / `.vtt`。

## 4. 核心提取流程

```python
parsed = parse_xiaohongshu_input(raw_url, http_client=client)
page = client.get(
    build_explore_url(parsed.note_id, parsed.xsec_token),
    headers=page_headers(),
    timeout_seconds=20.0,
)
state = extract_initial_state(decode_response_body(page))
note = lookup_note(state, parsed.note_id)

raw_media_v2 = note["video"].get("mediaV2")
media_v2 = json.loads(raw_media_v2)
subtitle_groups = media_v2["video"]["subtitles"]
track = select_subtitle_track(subtitle_groups, requested_language=None)

subtitle = client.get(
    track.url,
    headers=media_headers(),
    timeout_seconds=20.0,
)
write_subtitle_atomically(subtitle.body, output_path)
```

生产代码不得直接使用 `Path.write_bytes` 写最终权威产物；应沿用仓库已有的原子文件提交边界，
先写同目录临时文件，确认响应非空且大小在限制内后再提交为 `<note_id>.<language>.srt`。

## 5. 字幕选择策略

`select_subtitle_track` 必须返回确定性的单条轨道，避免同语言的 `source` 和 `zh-CN` 同时落地后
由文件名排序产生隐式选择：

1. 用户明确指定语言时，只接受对应语言轨道；`source` 轨道按其 `track.language` 判断，不把
   `source` 当作语言值。
2. 默认优先级为：`source` 中的首选中文 → `zh-Hans` → `zh-CN` → `zh-Hant` → `zh` →
   `en-US` / `en` → `ja` → `ko`。
3. 同一语言同时存在 `source` 和语言组时，优先 `source`，因为实测它是中文原始平台轨；
   默认只落地选中的一条，避免下游重复候选。
4. 输出语言使用平台 track 的 `language` 字段，并经过固定字符集校验后才能进入文件名。
5. 独立调试/导出命令如果需要全部轨道，可以显式启用 `--all`；产品单次转写路径仍只选择一条。

## 6. 与现有转写流水线的接入

### 6.1 小红书下载阶段

在小红书 fallback 已经完成页面解析、拿到 `note_obj` 后，按以下顺序执行：

```text
解析 note
  -> 解析并排序视频流
  -> 下载 MP4
  -> 尝试下载一条首选平台 SRT 到 download_dir
  -> 返回现有 MP4 下载结果
```

字幕下载是视频成功后的 best-effort 子步骤。字幕缺失、签名过期、返回空 body、HTTP 失败或
格式异常都不能使公开视频下载失败。

落地文件命名为 `<note_id>.<language>.srt`，放在当前任务的 `download_dir`，使现有
`media_preparation.py` 可以继续调用 `find_subtitle_transcript(download_dir)`，无需让通用
字幕解析器知道小红书页面结构。

### 6.2 转写阶段

- `.srt` 解析成功：使用平台字幕作为 transcript，跳过 ASR，并记录
  `TranscriptMetadata(source="subtitle", language=<language>, engine=None)`。
- 字幕不存在、解析为空、时间戳非法或清洗后无有效文本：继续现有 ASR 兜底，并记录
  `TranscriptMetadata(source="asr", ...)`。
- 小红书公开视频没有可用视频流时：保持现有 `XHS_*` 错误，不把字幕能力当成视频可用性。

### 6.3 独立“直接提取字幕”模式

独立字幕下载中心不属于本次产品范围；当前实现只在既有单链接视频转写流程中自动获取一条
平台字幕 sidecar。需要正式文字稿时继续走现有 transcript 产物路径，不新增独立 job、导出入口
或“全部语言”下载能力。

## 7. 失败、边界与安全

### 7.1 失败闭合

以下情况都按“平台字幕不可用”处理，并按调用模式分别执行：

- `mediaV2` 缺失、不是字符串、JSON 无法解析或缺少 `video.subtitles`；
- 字幕组为空、语言不匹配、track 缺少 URL 或 URL 不是允许的 HTTPS 字幕资源；
- 字幕响应非 2xx、为空、超过固定大小上限或无法写入原子文件；
- SRT/VTT 解析失败、时间戳非法、有效 cue 数为 0 或清洗后正文为空。

视频转写路径降级到 ASR；独立字幕下载路径返回结构化失败。两条路径都不得把原始异常文本、
响应正文或完整 CDN URL 返回给 UI。

### 7.2 安全边界

- 只处理用户提交的公开视频或用户已获授权的公开链接。
- `xsec_token` 只在当前 worker 调用内存中转发到页面请求，不写入 manifest、History、日志、
  诊断、AI prompt、服务器请求或 UI 文案。
- 字幕 URL 的签名 query 只在当前下载请求中使用；不落盘、不进入日志、不写入字幕文件内容。
- 继续使用当前进程内匿名 CookieJar；不导入浏览器 Cookie、不持久化 Cookie、不自动登录、不绕过
  CAPTCHA/权限/私有内容限制。
- 页面响应解码、字幕响应和本地原子写入都必须有大小上限；临时文件只能位于目标目录旁边。
- 平台字幕文本属于用户本地任务内容，默认只写入本地任务产物，不上传到 FrameQ server。

## 8. 已实现的拆分与边界

本方案已由 product spec 和 ExecPlan 立项并完成实现，实际拆分为：

1. **平台轨道解析**：`worker/frameq_worker/xiaohongshu/subtitles.py` 只负责 `mediaV2` 解码、轨道
   标准化、语言排序和 URL 安全校验的私有模块。
2. **根适配器组合**：`xiaohongshu_fallback.py` 在 fallback 路径复用一次页面读取的 note 对象；
   `media.py` 只在成功的 XHS `yt-dlp` 路径触发一次独立 best-effort sidecar 探测。
3. **字幕原子下载**：`xiaohongshu/transport.py` 复用现有原子文件提交能力并增加最终主机、类型、
   2 MiB 大小和空响应校验，不影响已完成 MP4。
4. **流水线接入**：`media_preparation.py` 只消费已落地的 `.srt` / `.vtt`，继续保持字幕优先、
   ASR 兜底的通用策略。
5. **契约边界**：不新增 desktop-worker message code、顶层 JobStage、UI 控件、server 请求或
   manifest artifact；平台字幕沿用现有 source/language metadata 和进度事件。

## 9. 验收清单

实现完成前必须同时满足：

- 真实公开小红书视频页能从 `mediaV2.video.subtitles` 找到并下载平台 SRT；
- `source`、`zh-CN`、`en-US` 轨道选择、语言过滤和同语言优先级有单测；
- `mediaV2` 缺失、畸形 JSON、无字幕、失效签名、非 2xx、空响应、超限和非法 SRT 均能闭合；
- 视频下载成功但字幕失败时，MP4 保留、任务按现有 ASR 路径完成；
- 字幕命中时 transcript metadata 为 `source=subtitle`，不得出现 ASR engine；
- 既有单链接视频转写路径在无字幕时回退 ASR，不新增独立字幕任务；
- 不记录 `xsec_token`、签名 URL、Cookie、完整请求头或响应正文；
- `worker/tests/test_xiaohongshu_fallback.py`、字幕解析测试、模块边界测试和完整 worker 门禁通过；
- `python scripts/validate_agents_docs.py --level WARN` 通过，除仓库已有治理警告外不得新增警告。

## 10. 权威来源

- 小红书页面解析：`worker/frameq_worker/xiaohongshu/page.py`、`source.py`、`transport.py`。
- 小红书视频下载适配：`worker/frameq_worker/xiaohongshu_fallback.py`、`streams.py`。
- 通用字幕解析：`worker/frameq_worker/subtitles.py`。
- 现有小红书安全边界：`docs/design-docs/2026-07-20-xiaohongshu-fallback-module-split.md`、
  `docs/SECURITY.md`。
- 真实验证记录：`docs/references/2026-08-21-xiaohongshu-platform-subtitle-probe.md` 及其后续三条
  `2026-08-22-xiaohongshu-platform-subtitle-probe-*.md` 记录。
