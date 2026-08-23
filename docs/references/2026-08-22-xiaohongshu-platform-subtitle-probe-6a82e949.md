# 小红书平台字幕实测：`6a82e94900000000260360d5`

## 结论

该公开视频提供平台已有字幕，不需要 ASR。使用 FrameQ 生产 worker 的小红书页面解析入口读取页面后，发现：

```text
note.video.mediaV2              # JSON 字符串
  -> JSON.parse(...).video.subtitles
  -> source / zh-CN / en-US
  -> 每组一个签名 SRT URL
```

页面返回 HTTP 200，note 类型为 `video`，三组字幕均存在且每组 1 条。访问令牌和带签名的字幕 URL 不写入本文档。

## 已下载文件

| 轨道 | HTTP | 字节数 | 本地文件 |
| --- | ---: | ---: | --- |
| `source / zh-CN` | 200 | 25676 | `outputs/6a82e94900000000260360d5_source_zh-CN_0.srt` |
| `zh-CN / zh-CN` | 200 | 25672 | `outputs/6a82e94900000000260360d5_zh-CN_zh-CN_0.srt` |
| `en-US / en-US` | 200 | 32108 | `outputs/6a82e94900000000260360d5_en-US_en-US_0.srt` |

## FrameQ 解析验证

将下载的 SRT 按 FrameQ 的字幕文件命名规则放入临时下载目录后，调用 `find_subtitle_transcript` 验证：

- `source / zh-CN`：276 个时间段，6917 个字符；首段“好，大家好”，末段“在这里面是怎么具体跑起来的？”
- `zh-CN / zh-CN`：276 个时间段，6905 个字符。
- `en-US / en-US`：369 个时间段，19298 个字符。

## 可复用实现边界

页面获取和初始状态解析复用：

- `worker/frameq_worker/xiaohongshu_fallback.py`：`parse_xiaohongshu_input`
- `worker/frameq_worker/xiaohongshu/source.py`：`build_explore_url`
- `worker/frameq_worker/xiaohongshu/page.py`：`decode_response_body`、`extract_initial_state`、`lookup_note`
- `worker/frameq_worker/xiaohongshu/transport.py`：`UrllibXiaohongshuHttpClient`、`page_headers`、`media_headers`

字幕提取核心代码：

```python
media_v2 = json.loads(note["video"]["mediaV2"])
tracks = media_v2["video"]["subtitles"]
track = tracks["source"][0]  # 中文原始平台字幕
subtitle_response = client.get(track["url"], headers=media_headers())
Path("note.zh-CN.srt").write_bytes(subtitle_response.body)
```

下载后直接复用 `worker/frameq_worker/subtitles.py` 的 `.srt` / `.vtt` 解析即可。

## 来源

- 目标页面：`https://www.xiaohongshu.com/explore/6a82e94900000000260360d5`（完整查询参数未写入）。
- FrameQ 生产源码：上述 worker 文件及 `worker/frameq_worker/subtitles.py`。
- 现场下载产物：本仓库 `outputs/` 下列出的三个 `.srt` 文件。
