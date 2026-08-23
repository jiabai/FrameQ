# 抖音平台字幕直接下载验证与方案

**日期：** 2026-08-23  
**状态：** 已完成真实页面验证；目标链接当前未暴露可下载的平台字幕  
**范围：** 抖音公开视频已有平台字幕；不包含 ASR、OCR、画面硬字幕识别

## 1. 决策摘要

目标链接中的 `modal_id` 可直接解析为作品 ID：

```text
7674488832540069154
```

本次对该作品做了三层验证：FrameQ 现有抖音 fallback、公开 HTTP 页面/API、抖音动态网页播放器。结论是：

- 公开分享页没有返回 `videoInfoRes`，因此没有可供现有 Router Data 解析器继续提取的媒体/字幕对象；
- 公开详情接口和旧版 iteminfo 接口均返回空响应；
- 动态网页虽然加载出视频，但播放器没有 `<track>`、`textTracks` 或可选字幕轨；“字幕”控件只有“不开启”；
- 页面初始化数据中的 `subtitles.enable`、语言列表和 `subtitleDefaultOpen` 只是功能配置，不是该作品的字幕文件地址。

因此，针对这个链接，目前无法在“不登录、不导入浏览器 Cookie、不解验证码、不绕过签名、且不使用 ASR”的边界内下载出平台字幕文件。这里的正确结果是“未发现平台字幕资源”，不能把 ASR 结果伪装成平台字幕。

## 2. 与小红书方案的关键差异

小红书的已验证路径是页面状态中存在明确的字幕资源描述：

```text
note.video.mediaV2
  -> JSON.parse(...).video.subtitles
  -> track.url
  -> SRT
```

抖音本次页面中没有对应的作品级字幕描述。页面出现的 `subtitles` 仅位于全局播放器配置，实际字幕控件内容是：

```text
字幕
  不开启
```

所以不能照搬小红书的“解析初始状态 → 取字幕 URL”逻辑；抖音必须先确认作品响应确实包含字幕轨，再下载。

## 3. 已验证事实

### 3.1 FrameQ 生产 fallback

现有生产路径为：

```text
输入 URL
  -> 解析 modal_id / aweme_id
  -> https://www.iesdouyin.com/share/video/{aweme_id}/?app=aweme
  -> 解析 window._ROUTER_DATA
  -> videoInfoRes.item_list[0]
  -> 视频流候选
```

本次实测结果：

| 检查项 | 结果 |
| --- | --- |
| `resolve_aweme_id_from_input` | 成功，得到 `7674488832540069154` |
| 分享页 HTTP | 200；约 32 KB；最终主机为 `www.iesdouyin.com` |
| `window._ROUTER_DATA` | 存在 |
| `videoInfoRes` / `item_list` / `play_addr` | 均不存在 |
| 现有页面解析器 | 按设计抛出“分享页没有 videoInfoRes” |

对应代码入口见 [`source.py`](../../worker/frameq_worker/douyin/source.py)、[`page.py`](../../worker/frameq_worker/douyin/page.py) 和 [`douyin_fallback.py`](../../worker/frameq_worker/douyin_fallback.py)。

### 3.2 公开 HTTP 入口

使用 FrameQ 现有公开请求头和 transport 实测：

| 入口 | 结果 | 字幕结论 |
| --- | --- | --- |
| `www.douyin.com/aweme/v1/web/aweme/detail/` | HTTP 200，空响应 | 没有作品 JSON 或字幕字段 |
| `www.iesdouyin.com/web/api/v2/aweme/iteminfo/` | HTTP 200，空 JSON 响应 | 没有作品 JSON 或字幕字段 |
| `www.douyin.com/video/7674488832540069154` | HTTP 200，JS shell | 没有 `play_addr`、`videoInfoRes` 或字幕资源 |
| `www.douyin.com/note/7674488832540069154` | 验证码中间页 | 不作为字幕来源 |

### 3.3 动态播放器

在用户提供的 `user/self?...modal_id=...` 页面中，匿名动态页实际加载出视频播放器。只做页面可见 DOM 和播放器状态检查，不读取浏览器 Cookie、Local Storage 或其他凭据：

- 页面存在两个已加载视频元素；
- 两个视频的 `textTracks.length` 均为 `0`；
- 两个视频的 `<track>` 子元素数量均为 `0`；
- `.xgplayer-texttrack` 控件为隐藏状态；
- 控件下唯一选项为“不开启”；
- 页面初始化数据没有 `subtitleInfos`、`subtitle_info` 等作品字幕资源字段；
- 页面只出现全局配置 `subtitles.enable`、语言列表和 `subtitleDefaultOpen`。

这证明网页播放器当前没有为该作品下发可直接保存的 WebVTT/SRT 字幕轨。它不等价于证明抖音任何客户端、任何账号状态都绝对没有字幕，只说明本次目标的公开 Web 响应没有提供该资源。

## 4. 可行的直接下载算法

这是后续可以安全落地的“有字幕才下载”算法，而不是为当前目标凭空猜测接口：

1. 使用现有 `resolve_aweme_id_from_input` 解析 `modal_id`、`aweme_id` 或公开链接中的作品 ID。
2. 复用现有公开分享页请求，不增加登录、浏览器 Cookie、代理池、验证码处理或签名绕过。
3. 在已解析的作品对象中，仅接受平台明确返回的字幕轨描述；字段名、语言、格式和 URL 必须来自实际响应，不根据全局 `subtitles` 配置推断 URL。
4. 对字幕 URL 做安全校验：仅允许 HTTPS、平台允许的资源主机、有限的 `.srt`/`.vtt` 内容类型和大小；不把完整易变 URL 写入日志、manifest 或历史记录。
5. 原子下载到任务临时目录，交给现有 `find_subtitle_transcript` 解析；解析为空、格式不支持或资源失效，均视为未命中。
6. 命中时写入 `TranscriptMetadata(source="subtitle", language=..., engine=None)`；未命中时返回“平台字幕不可用”。如果产品另行允许 ASR，ASR 只能作为独立兜底来源，不能混入本方案的字幕结果。

伪代码边界如下：

```python
aweme_id = resolve_aweme_id_from_input(url)
item = fetch_and_parse_public_douyin_item(aweme_id)
tracks = extract_explicit_subtitle_tracks(item)
if not tracks:
    return PlatformSubtitleUnavailable("Douyin response exposed no subtitle track")

track = select_preferred_track(tracks, requested_language=None)
path = download_verified_subtitle(track.url)
return find_subtitle_transcript(path)
```

当前目标在第 2～3 步没有得到作品字幕轨，因此不能继续到第 4 步下载。

## 5. 不采用的“方案”

- 不把 `subtitles.enable=1` 当成字幕存在标志；它只是站点功能开关。
- 不从视频画面 OCR 或调用 ASR 生成 `.srt`，因为那不是平台已有字幕。
- 不把视频描述中的 `caption`（标题/话题标签）当成时间轴字幕。
- 不把空响应接口包装成“补签名后即可下载”的已验证方案；本次没有验证出可公开、稳定、合规的字幕请求协议。
- 不导入浏览器 Cookie、不自动登录、不解验证码、不抓取私有接口或绕过访问限制。

## 6. 对 FrameQ 的落地建议

当前不应直接修改生产代码来宣称“抖音支持平台字幕”，因为目标链接尚未暴露任何可下载字幕文件。若后续拿到一个公开响应中确实带字幕轨的抖音样本，再按以下边界立项：

- 在 `worker/frameq_worker/douyin/` 增加作品字幕字段解析和确定性语言选择；
- 不修改现有视频流选择和下载成功/失败语义；
- 复用 `worker/frameq_worker/subtitles.py` 的 SRT/VTT 解析；
- 增加 `source=subtitle` 的 transcript metadata，禁止写入 ASR engine；
- 增加“资源缺失/格式异常 → 未命中或既有 ASR 兜底”的单测；
- product spec 和 ExecPlan 明确“抖音公开字幕探测”是否进入产品范围。

## 7. 验收标准

只有同时满足以下条件，才能称为“直接下载平台字幕”：

- 作品响应中存在明确字幕轨，而不是全局功能配置；
- 下载到真实 `.srt` 或 `.vtt` 内容并通过现有解析器；
- 结果 metadata 标记为平台字幕，且不出现 ASR 引擎；
- 目标缺少字幕时明确失败/未命中，不伪造字幕；
- 日志和产物不保存 Cookie、签名参数或完整易变资源 URL。

本次目标已验证前四项中的“缺少字幕时明确未命中”，但未满足“存在字幕轨”和“下载字幕文件”，因此当前不存在可交付的直接字幕文件。

## 8. 依据

- 抖音现有 fallback 参考：[`easydownload-douyin-fallback.md`](../references/easydownload-douyin-fallback.md)
- 抖音 fallback 模块边界：[`2026-07-20-douyin-fallback-module-split.md`](2026-07-20-douyin-fallback-module-split.md)
- 小红书已验证字幕方案：[`2026-08-23-xiaohongshu-platform-subtitle-direct-extraction.md`](2026-08-23-xiaohongshu-platform-subtitle-direct-extraction.md)
- FrameQ 字幕解析器：[`subtitles.py`](../../worker/frameq_worker/subtitles.py)
