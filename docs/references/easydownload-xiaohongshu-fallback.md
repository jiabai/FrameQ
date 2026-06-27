# EasyDownload Xiaohongshu Fallback Reference

## Purpose

This note records the EasyDownload Xiaohongshu implementation details that are relevant to FrameQ's transcription workflow. FrameQ should use these details to improve public Xiaohongshu video note handling, not to become a general Xiaohongshu downloader or image-album archiver.

## Source

- Local reference project: `lib-external/EasyDownload`
- License: MIT, see `lib-external/EasyDownload/LICENSE`
- Primary Xiaohongshu files:
  - `lib-external/EasyDownload/internal/download/xiaohongshu/parser.go`
  - `lib-external/EasyDownload/internal/download/xiaohongshu/client.go`
  - `lib-external/EasyDownload/internal/download/xiaohongshu/model.go`
  - `lib-external/EasyDownload/internal/download/xiaohongshu/downloader.go`
  - `lib-external/EasyDownload/docs/xiaohongshu-link-download-principle.md`

## Useful Algorithm

1. Accept Xiaohongshu share text, `xhslink.com` short links, full note URLs, and direct 24-character hexadecimal `note_id` values.
2. Extract the first acceptable Xiaohongshu URL from copied share text.
3. Resolve `xhslink.com` links by first reading standard `3xx` `Location`; if that fails, parse the returned HTML for an embedded Xiaohongshu URL.
4. Preserve `xsec_token` from the resolved URL and include it when fetching `/explore/{note_id}`.
5. Request the public note page with browser-like navigation headers, including `Accept-Encoding: gzip, deflate, br`.
6. Decode `gzip`, Brotli `br`, and both zlib-wrapped and raw `deflate` responses with a post-decompression size cap.
7. Extract `window.__INITIAL_STATE__`, convert common JavaScript values such as `undefined`, `void 0`, and trailing commas to JSON-compatible forms, then parse the note object.
8. Parse video streams from both supported schemas:
   - Old shape: `video.media.stream` is a list.
   - New shape: `video.media.stream` is an object keyed by codec such as `h264`, `h265`, `av1`, `h266`, `hevc`, or `avc`.
9. Deduplicate stream candidates by quality key and select the better candidate with this priority: URL exists, codec rank, weight, stream type, default stream marker, resolution, video bitrate, declared size, then backup URL count.
10. Download the chosen video stream with fallback to backup URLs, max-size guardrails, no-progress timeout, and resumable `.part` behavior.

## FrameQ Scope

Migrate now:

- Frontend acceptance for Xiaohongshu complete note URLs and share text in addition to `xhslink.com/o/<code>`.
- Worker parser parity for short-link resolution, embedded URL fallback, redirect-depth limit, direct `note_id`, and `xsec_token`.
- Public page compatibility for Brotli decoding and browser-like navigation headers.
- Video stream parsing and ranking parity for the EasyDownload stream model.
- Streaming/resumable video download reliability for large public video notes.
- User-facing `XHS_*` error copy that distinguishes image-only notes, login-gated/private notes, no playable stream, rate limiting, page structure changes, and stalled/oversized downloads.

Keep out of scope:

- Xiaohongshu image album ZIP downloads.
- Live Photo sidecar download and packaging.
- Login automation, browser cookie import, persistent cookies, CAPTCHA solving, private-note scraping, proxy pools, or browser fingerprint spoofing.
- A stream picker, batch queue, download manager, or Xiaohongshu archive product surface.

## Security Notes

- Fallback requests are limited to user-submitted public or user-authorized share links.
- Process-local anonymous cookies naturally issued by a public page may exist for one invocation only, but must not be read from browser stores, persisted, uploaded, or written to logs/history.
- Full volatile media CDN URLs should not be stored in local history or UI error text. Use short causes, hostnames, quality labels, byte sizes, and local paths instead.
- When a note is image-only, unavailable, login-gated, CAPTCHA-gated, private, rate-limited, or lacks playable video, the worker should return structured recoverable errors and stop.
