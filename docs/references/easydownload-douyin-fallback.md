# EasyDownload Douyin Fallback Reference

## Purpose

This note records the EasyDownload Douyin approach evaluated for FrameQ's `yt-dlp` fallback. It is a reference for implementation only; FrameQ should port the minimal Python equivalent into `worker/` rather than depending on the external Go/Wails app at runtime.

## Source

- Local reference project: `lib-external/EasyDownload`
- License: MIT, see `lib-external/EasyDownload/LICENSE`
- Primary Douyin files:
  - `lib-external/EasyDownload/internal/download/douyin/parser.go`
  - `lib-external/EasyDownload/internal/download/douyin/client.go`
  - `lib-external/EasyDownload/internal/download/douyin/downloader.go`
  - `lib-external/EasyDownload/docs/douyin-link-download-principle.md`

## Useful Algorithm

1. Parse the submitted share text or URL and extract `aweme_id`.
2. For `v.douyin.com` short links, resolve the redirect first and then extract the final `aweme_id`.
3. Prefer the public share SSR page:
   `https://www.iesdouyin.com/share/video/{aweme_id}/?app=aweme`
4. Parse the embedded `window._ROUTER_DATA` JSON.
5. Find `loaderData.*.videoInfoRes.item_list[0]`.
6. Build stream candidates from `video.bit_rate` when present.
7. If `bit_rate` is empty, use `video.play_addr.uri` and probe:
   `https://aweme.snssdk.com/aweme/v1/play/?video_id={uri}&ratio={ratio}&line=0`
8. Probe ratios in this order: `1080p`, `720p`, `540p`, `480p`, `360p`.
9. Accept only candidates with `206 Partial Content`, positive `Content-Range` total size, and video-like `Content-Type`.
10. FrameQ's product policy differs from a downloader utility: select the largest valid candidate by size, then tie-break by quality or resolution, because users may keep the saved video.

## Request Compatibility Strategy

FrameQ may use a fixed mobile Safari user agent for public share-page compatibility:

```text
Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1
```

Use this as a stable compatibility header for the public share page, not as an anti-bot evasion system. The minimal header set should be:

- Share page and metadata probes: `User-Agent`, `Accept`, `Accept-Language`, `Origin: https://www.douyin.com`, and `Referer: https://www.douyin.com/`.
- Media probes/downloads: the same `User-Agent`, `Origin`, and `Referer`, plus `Range: bytes=0-1` only for small validation probes.
- A process-local cookie jar may accept anonymous cookies naturally set by the public share page, such as `ttwid`, but FrameQ must not read browser cookie stores or persist these cookies.

Explicitly out of scope: user-agent rotation, proxy pools, browser fingerprint spoofing, CAPTCHA solving, login automation, or account-authenticated scraping.

## Fallback and Error Taxonomy

Recommended strategy chain:

| Step | Source | v1 policy |
|------|--------|-----------|
| 1 | `yt-dlp` | First attempt for supported public links |
| 2 | `iesdouyin.com/share/video/{aweme_id}/?app=aweme` | v1 fallback path when `yt-dlp` fails with empty web detail JSON, `Fresh cookies`, or equivalent public-link parse failures |
| 3 | `aweme/detail` / `slidesinfo` | Future extension only, useful for album or mixed-media compatibility if share SSR changes |

Suggested structured causes:

| Cause | Meaning |
|-------|---------|
| `DOUYIN_ID_PARSE_FAILED` | No valid `aweme_id` could be extracted from the submitted URL or resolved short link |
| `DOUYIN_SHARE_PAGE_UNAVAILABLE` | The public share page was unavailable, empty, blocked, login-gated, CAPTCHA-gated, or rate limited |
| `DOUYIN_ROUTER_DATA_MISSING` | The share page did not contain parseable `window._ROUTER_DATA` |
| `DOUYIN_NO_PLAYABLE_STREAM` | Metadata was available but no ranged media probe produced a valid stream |
| `DOUYIN_STREAM_DOWNLOAD_FAILED` | All candidate streams failed download |
| `MEDIA_VALIDATION_FAILED` | A downloaded file failed the existing `ffprobe` media validation |

Logs and history should keep only the submitted URL, hostnames, quality labels, byte sizes, short error summaries, and local output paths. Do not store full volatile media CDN URLs, cookies, sensitive headers, or query tokens.

## Verified Link

Test URL:

```text
https://www.douyin.com/video/7653372612151692594
```

Observed locally on 2026-06-25:

- `yt-dlp 2026.06.09` failed with empty web detail JSON and `Fresh cookies` guidance, even with exported Douyin cookies and `curl_cffi` impersonation.
- `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7653372612151692594` returned `200 application/json` with an empty body.
- `https://www.iesdouyin.com/share/video/7653372612151692594/?app=aweme` returned HTML containing `window._ROUTER_DATA`, `videoInfoRes`, `play_addr`, and the target `aweme_id`.
- The SSR item had no `video.bit_rate`, but did provide `video.play_addr.uri`.
- Ratio probing with ranged GET returned valid MP4 candidates:
  - `1080p`: `206 Partial Content`, `video/mp4`, total size about `211666203` bytes.
  - `720p`: `206 Partial Content`, `video/mp4`, total size about `158560856` bytes.
  - `540p`: `206 Partial Content`, `video/mp4`, total size about `170101623` bytes.
  - `480p` and `360p`: valid but same total size as the `1080p` CDN response in this run.

For FrameQ's highest-quality policy, this sample should choose the largest valid stream and tie-break toward `1080p`.

## Product and Security Boundaries

- Do not persist cookies or require users to export browser cookies for this fallback.
- Do not solve CAPTCHA, bypass login gates, scrape private content, or automate account-authenticated access.
- Do not implement user-agent rotation, proxy pools, browser fingerprint spoofing, or other anti-bot evasion mechanics.
- Do not store full media CDN URLs in local history when they contain volatile tokens.
- Keep downloaded media, extracted audio, transcript, summary, mindmap, and insights local unless the user separately confirms server-managed LLM insight generation.
