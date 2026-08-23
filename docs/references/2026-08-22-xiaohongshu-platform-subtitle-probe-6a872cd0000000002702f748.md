# 小红书平台字幕实测：`6a872cd0000000002702f748`

使用 FrameQ 生产 worker 读取公开页面：页面 HTTP 200，note 类型为 `video`。`note.video.mediaV2` 是 JSON 字符串，平台字幕位于 `json.loads(mediaV2)["video"]["subtitles"]`。

| 轨道 | HTTP | 字节数 | 本地文件 |
| --- | ---: | ---: | --- |
| `source / zh-CN` | 200 | 20747 | `outputs/6a872cd0000000002702f748_source_zh-CN_0.srt` |
| `zh-CN / zh-CN` | 200 | 20747 | `outputs/6a872cd0000000002702f748_zh-CN_zh-CN_0.srt` |
| `en-US / en-US` | 200 | 25741 | `outputs/6a872cd0000000002702f748_en-US_en-US_0.srt` |

FrameQ `find_subtitle_transcript` 解析验证：

- `source / zh-CN`：224 段，5378 字符。
- `zh-CN / zh-CN`：224 段，5370 字符。
- `en-US / en-US`：297 段，15453 字符。

未使用 ASR。访问令牌和带签名字幕 URL 未写入本文档。
