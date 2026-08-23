# 小红书平台字幕实测：`6a84fc60000000002c0077e4`

使用 FrameQ 生产 worker 解析页面后，页面 HTTP 200，note 类型为 `video`。`note.video.mediaV2` 是 JSON 字符串，字幕位于 `json.loads(mediaV2)["video"]["subtitles"]`。

## 下载结果

| 轨道 | HTTP | 字节数 | 本地文件 |
| --- | ---: | ---: | --- |
| `source / zh-CN` | 200 | 22234 | `outputs/6a84fc60000000002c0077e4_source_zh-CN_0.srt` |
| `zh-CN / zh-CN` | 200 | 22244 | `outputs/6a84fc60000000002c0077e4_zh-CN_zh-CN_0.srt` |
| `en-US / en-US` | 200 | 27707 | `outputs/6a84fc60000000002c0077e4_en-US_en-US_0.srt` |

## FrameQ 解析验证

- `source / zh-CN`：243 个时间段，5984 个字符。
- `zh-CN / zh-CN`：243 个时间段，5956 个字符。
- `en-US / en-US`：327 个时间段，16365 个字符。

核心路径：

```python
media_v2 = json.loads(note["video"]["mediaV2"])
track = media_v2["video"]["subtitles"]["source"][0]
subtitle_response = client.get(track["url"], headers=media_headers())
```

下载后由 `worker/frameq_worker/subtitles.py` 的 `find_subtitle_transcript` 成功解析；未使用 ASR。完整查询参数和带签名字幕 URL 未写入本文档。

## 来源

- 目标页面：`https://www.xiaohongshu.com/explore/6a84fc60000000002c0077e4`
- FrameQ 生产源码：`worker/frameq_worker/xiaohongshu_fallback.py`、`worker/frameq_worker/xiaohongshu/page.py`、`worker/frameq_worker/xiaohongshu/transport.py`、`worker/frameq_worker/subtitles.py`
- 现场下载产物：本仓库 `outputs/` 下列出的三个 `.srt` 文件。
