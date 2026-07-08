# Security and Compliance

## 2026-07-06 Insight Preference Privacy Boundary

- `我的灵感档案` and per-run generation preferences are local desktop data by default and must not be uploaded to FrameQ server.
- The inspiration profile should be stored under app-local data as a constrained JSON file, not in app-local `.env`, because it is product data rather than runtime configuration.
- A skipped inspiration profile may be represented locally by a marker such as `profileSkipped: true`, but skipped means `no profile / unspecified`; the app must not synthesize, log, upload, or send a default persona in its place.
- AI整理 confirmation must state that transcript snippets will be sent to the administrator-configured cloud LLM supplier for AI整理 outputs, while the selected preference snapshot is sent only with the `启发灵感` generation request and must not be sent with `要点总结` or Mermaid mindmap requests.
- Logs, diagnostics, UI errors, server requests, and quota checkout metadata must not include full inspiration profiles, full generation preferences, complete prompts, transcripts, or generated insight content.
- The account service must not add API fields for storing profiles, generation preferences, transcripts, insight topics, or local task manifest contents.
- Users must be able to clear the local inspiration profile. Clearing it affects future generation only and must not delete existing local task artifacts.

## 2026-07-05 Desktop Diagnostics Log Boundary

- Desktop diagnostics are written only to app-local data `logs/frameq-desktop.log`.
- Logs may include command kind, process exit status, resource/app-local paths, task id, structured error code, and sanitized short error text.
- Logs must not include LLM API keys, desktop session tokens, cookies, sensitive request headers, complete volatile YouTube media/CDN URLs, or Google/YouTube login material.
- YouTube JavaScript runtime support must not introduce browser cookie import, account login automation, CAPTCHA solving, proxy bypass, remote component fetching, or private-content scraping.
- Diagnostic logs are not uploaded to FrameQ server and are not exposed through normal result artifact actions.
- Deno is bundled only as a local `yt-dlp` JavaScript runtime. It must not be used for browser cookie import, account login automation, CAPTCHA solving, proxy bypass, remote app-code loading, or private-content scraping.

## 2026-07-05 Task Artifact Path Boundary

- Task manifests may contain local artifact paths only as relative paths under the owning task directory. Absolute paths, `..`, path traversal, remote URLs, cookies, headers, or credentials must be rejected.
- Tauri task commands must resolve `task_id` to a manifest under the configured output root and must verify every resolved artifact path remains inside that task directory.
- Repeated URL task reuse may read only local manifests and manifest-relative artifacts under the configured output root. It must not trust failed tasks, missing artifacts, traversal paths, remote URLs, cookies, headers, or credentials.
- Transcript review and save commands should receive `task_id`, not arbitrary transcript/audio paths. The audio player and text editor may access only manifest-declared artifacts for that task.
- App-local `cache/tasks/<task_id>/` may store temporary or diagnostic files, but the UI should not expose it as a browseable artifact folder.
- Legacy flat output files and legacy app-local history records are not trusted task authorities after this redesign.

## 2026-07-05 Platform Subtitle Safety Boundary

- Subtitle-first reuse may request only public subtitle files exposed through the same no-login `yt-dlp` flow used for public YouTube and Bilibili video downloads.
- Subtitle support must not add `--cookies`, `--cookies-from-browser`, browser cookie stores, account login automation, QR login, CAPTCHA solving, proxies for access-control bypass, private-content scraping, or member/age/private bypass.
- Raw `.vtt` and `.srt` files belong to `cache/tasks/<task_id>/download/` and must not be exposed as normal result artifacts or written into manifest artifact paths.
- `frameq-task.json` may record transcript source metadata and text preview, but must not store complete raw subtitle files, cookies, credential-bearing headers, or volatile media CDN URLs.
- Subtitle parse failures, missing files, unsupported formats, and unusable text must degrade to local ASR rather than surfacing platform bypass instructions or asking users for cookies/login material.

## 2026-07-03 Transcript Audio Review Local File Boundary

- Transcript review may read only the transcript path and audio path associated with the current task or a local history record. It must not become an arbitrary file browser, text editor, or media player.
- Tauri transcript commands must validate path shape, file extension, existence, and relationship to known transcript/audio artifacts before returning a playable path or writing edits.
- `load_transcript_detail` may return transcript text, optional segment metadata, backup status, and a validated local audio path. It must not return cookies, request headers, remote media CDN URLs, LLM keys, or private signing material.
- `save_transcript_edit` may write the official transcript `.txt`, matching `.md`, optional segment sidecar, and local history preview. The first save should create an original backup once and must not overwrite that backup later.
- Empty transcript saves, path traversal, non-transcript files, and unrelated local paths must fail recoverably.
- Segment metadata is local-only review data. It must not be sent to FrameQ server unless a future product spec explicitly adds a server workflow.
- The audio player should use Tauri-validated local paths only. Missing audio must degrade to text editing without attempting remote downloads or network lookups.
- For custom output roots, Tauri may create a playback copy under app-local `cache/.frameq-audio-review/<task_id>/` only after validating the original manifest-declared audio artifact. This cache is not an authority and must be rebuildable from the original task artifact.
- Manual playback-cache cleanup must not accept arbitrary paths. It must canonicalize the target, delete only app-local `cache/.frameq-audio-review`, and never delete `<FRAMEQ_OUTPUT_DIR>/tasks/<task_id>/` artifacts, app-local `cache/tasks/`, `models/`, `auth/`, `.env`, logs, or update preferences.
- Playback-cache size reporting is local UI state only. It must not upload audio paths, source paths, transcripts, or cache metadata to FrameQ server.
- The Tauri asset protocol may be enabled only for reviewed audio artifacts under app-local `outputs/tasks/<task_id>/` or Tauri-controlled playback copies under app-local `cache/.frameq-audio-review/<task_id>/`; it must not expose `auth/`, `models/`, `.env`, update preferences, task scratch files under `cache/tasks/`, or arbitrary user directories.

## 2026-06-29 YouTube Public Video Safety Boundary

- YouTube v1 may request only user-submitted public ordinary video or Shorts links through `yt-dlp`, and only to create one local media file for transcription.
- FrameQ must not read browser cookies, persist cookies, request cookie files, use `--cookies`, use `--cookies-from-browser`, store Google/YouTube login material, automate login, solve CAPTCHA, bypass age/member/private restrictions, use proxies for access control bypass, or process playlists as a batch.
- `watch?v=...&list=...` may be accepted only as a single-video request with `--no-playlist`; playlist/channel/handle/music/live/login-gated inputs must fail recoverably.
- YouTube/Google volatile media CDN URLs, signed query strings, cookies, Authorization headers, and login or bypass instructions must not be stored in app-local history, UI errors, logs, settings, or FrameQ server requests.
- Worker error sanitization should remove `googlevideo.com`/`videoplayback` signed URLs and cookie guidance before messages reach the UI.
- Existing completed local media files must be preserved if a new YouTube download attempt fails.

## 2026-06-27 Bilibili Public Video Fallback Safety Boundary

- Bilibili fallback may request only user-submitted public or user-authorized ordinary video links, safe `b23.tv` redirects, public video metadata APIs, public playurl APIs, and public DASH media URLs needed to create one local MP4 for transcription.
- The fallback must not read browser cookies, persist cookies, collect or store `SESSDATA`, automate login, show QR login, solve CAPTCHA, scrape private videos, bypass member-only access, decrypt DRM, rotate user agents, use proxy pools, or spoof browser fingerprints.
- PGC/bangumi/movie links, VIP/member-only streams, login-required streams, private/unavailable videos, CAPTCHA/risk-control pages, malformed API responses, DRM-protected streams, and no-playable-stream cases must return structured recoverable errors rather than attempting to bypass platform controls.
- Fixed compatibility headers such as `User-Agent`, `Referer`, `Origin`, and `Accept-Language` are allowed for public Bilibili API/media requests. Credential-bearing headers and cookies are not allowed.
- Streaming/resumable video and audio download helpers must enforce max-size and no-progress limits, keep partial files scoped to destination `.part`/temporary `.m4s` files, and preserve any existing completed media file if the new download or FFmpeg merge fails.
- Full volatile Bilibili CDN URLs, cookies, `SESSDATA`, sensitive request headers, authorization material, and DRM key material must not be stored in local history, UI errors, logs, app-local settings, or FrameQ server requests. Logs may keep short causes, hostnames, Bilibili IDs, part index, quality labels, byte sizes, and local output paths.

## 2026-06-27 Xiaohongshu Public Video Fallback Safety Boundary

- Xiaohongshu fallback may request only user-submitted public or user-authorized share links, short links, full note URLs, and their public media URLs.
- The fallback must not read browser cookies, persist cookies, upload cookies, automate login, solve CAPTCHA, scrape private notes, rotate user agents, use proxy pools, or spoof browser fingerprints.
- Process-local anonymous cookies naturally issued by a public Xiaohongshu page may exist for one worker invocation only and must not be written to app-local settings, history, logs, UI errors, or FrameQ server requests.
- Brotli/gzip/deflate decoding must keep a post-decompression size cap so malformed or hostile pages cannot exhaust memory.
- Streaming/resumable video download helpers must enforce max-size and no-progress limits, keep partial files scoped to the destination `.part`, and preserve any existing completed media file if the new download fails.
- Full volatile media CDN URLs, cookies, sensitive request headers, `xsec_token`, and authorization material must not be stored in local history or UI error text. Logs may keep short causes, hostnames, quality labels, byte sizes, and local output paths.
- Image-only notes, unavailable notes, login-gated notes, CAPTCHA-gated notes, private notes, rate-limited pages, malformed page state, oversized videos, stalled downloads, and no-playable-stream cases must return structured recoverable errors rather than attempting to bypass platform controls.

## 2026-06-27 Admin Entitlement Adjustment Boundary

- Manual entitlement and quota adjustments are restricted to the configured Admin Web account and must reuse HttpOnly admin session cookies plus `x-frameq-csrf` validation.
- Every successful adjustment must be auditable with administrator email, target user, reason, before/after values, and timestamp. Corrections should create another audit record instead of rewriting the original event.
- Adjustment notes are operational metadata only. They must not include LLM API keys, cookies, transcripts, private video URLs, local file paths, activation-code plaintext beyond the creation response, or sensitive support chat contents.
- Server logs should identify adjustment IDs and target users, but should avoid logging free-form notes in full.
- Manual compensation must never require users to upload videos, audio, transcripts, histories, local model caches, cookies, or desktop configuration files.

## 2026-06-26 Public Link Fallback Safety Boundary

- EasyDownload-derived work may improve FrameQ's handling of public or user-authorized share links, but it must not introduce browser cookie import, persistent cookie storage, account login automation, QR login, CAPTCHA solving, private-content scraping, proxy pools, user-agent rotation, or browser fingerprint spoofing.
- FrameQ must not migrate EasyDownload's WeChat MITM, certificate authority installation, system proxy changes, or administrator-elevation behavior.
- Worker fallbacks may use fixed compatibility headers and process-local anonymous cookies naturally issued by a public share page for one invocation only. Those cookies must not be read from browser stores, written to disk, sent to FrameQ server, or stored in history/logs.
- Bilibili ordinary public-video DASH assembly is allowed only when it can run without login or cookies and produces one local MP4 for transcription. Bilibili login, QR login, SESSDATA handling, PGC/bangumi, member-only behavior, DRM, and downloader-oriented workflows remain out of scope.
- Safe download helpers must avoid logging cookies, sensitive headers, authorization material, or full volatile media CDN URLs. Logs and history may keep the original submitted URL, hostnames, short error causes, quality labels, byte sizes, and local output paths.
- When a link is unavailable, login-gated, CAPTCHA-gated, private, image-only, or has no playable video stream, the worker must return structured recoverable errors rather than attempting to bypass access controls.

## 2026-06-25 Douyin Share Page Fallback Boundary

- The Douyin fallback may request public `iesdouyin.com` share pages and public media CDN URLs for user-submitted public or user-authorized links.
- The fallback must not require, collect, persist, or upload browser cookies. Exported cookie files are not part of the supported product path for this fallback.
- The fallback may use a fixed mobile Safari user agent and minimal public-page headers for compatibility with public share pages. It must not use user-agent rotation, proxy pools, browser fingerprint spoofing, CAPTCHA solving, login automation, or account-authenticated scraping.
- A process-local cookie jar may accept anonymous cookies naturally set by the public share page, such as `ttwid`, but those cookies must be discarded after the worker invocation and must not be written to history, logs, app-local settings, or server requests.
- The fallback must not attempt to solve CAPTCHA, defeat login gates, bypass private content restrictions, or automate account-authenticated scraping.
- Worker logs, history records, and UI errors must not store cookies, sensitive request headers, or full media CDN URLs when those URLs contain volatile request tokens. Logs may keep the original submitted URL, short error summaries, hostnames, stream quality labels, byte sizes, and local output paths.
- Downloaded video, extracted audio, transcripts, summaries, mindmaps, and topic outputs remain local artifacts under the configured output/cache directories; no fallback media data is sent to the FrameQ server.

## 2026-06-23 Desktop Update Boundary

- Desktop updates must use Tauri updater signature verification before installation.
- The updater public key may be bundled in `tauri.conf.json`; the private signing key and signing password must never be committed, bundled, or stored on FrameQ server runtime hosts unless that host is the intended signing environment.
- The public update endpoint returns only release metadata and artifact URLs; it must not require desktop authentication and must not return user data, account data, LLM keys, or ASR model credentials.
- `updates.json` may store `lastCheckedAt`, `postponedUntil`, and `skippedVersion` only. It must not store downloaded installers, signatures, private keys, session tokens, video URLs, transcripts, or model cache paths beyond generic update preferences.
- Updating the app must preserve app-local `models/`, `outputs/`, `cache/`, `auth/`, `.env`, and `updates.json`.
- Waiving mainland China live updater testing does not relax the signature-verification requirement. It only means the GitHub Releases network path is not a v1 release blocker; unsigned or malformed updater artifacts must still be rejected by configuration and release checks.

## 2026-06-23 LLM Secret Boundary

- Desktop clients must not read repository-root `.env` files for LLM configuration.
- Local dotenv files must not be treated as a supported place for `FRAMEQ_LLM_PROVIDER`, `FRAMEQ_LLM_BASE_URL`, `FRAMEQ_LLM_API_KEY`, `FRAMEQ_LLM_MODEL`, or `FRAMEQ_LLM_TIMEOUT_SECONDS`.
- Tauri worker subprocesses remove legacy local LLM environment variables before launch.
- Server-managed checkout environment variables remain allowed only for the insight-generation invocation.
- App-local data `.env` remains limited to non-LLM local settings such as output directory, ASR model, and model download overrides.

## 2026-06-23 ASR Model Cache Cleanup Boundary

- Automatic ASR cache cleanup may only touch FrameQ's known SenseVoice Small and VAD model cache directories plus stale `._____temp` directories without `model.pt`.
- Unknown model directories or user-created files under app-local `models/` must be preserved.
- Cleanup failures must not delete broader app-local data, block transcription, or hide the original ASR model availability state.

## Account and Billing Service

- The account service stores only email accounts, OTP metadata, session token hashes, activation-code hashes/prefixes, entitlements, admin sessions, LLM config metadata, and quota events.
- Desktop session tokens are opaque random values. The server stores SHA-256 hashes only; the desktop client stores the raw token in app-local data under `auth/session.json`.
- Email OTP codes expire after 10 minutes, allow at most 5 attempts, and must be rate-limited by email and IP.
- Login deep-link tickets expire after 5 minutes, are single-use, and must be bound to a desktop-generated `state` value.
- SMTP credentials and server encryption keys must only be configured through the server environment. They must not be bundled into the desktop installer.
- Activation codes must be high-entropy, single-use, and stored as hashes only. The full code is displayed once when an administrator creates it.
- Admin Web access is restricted to `FRAMEQ_ADMIN_EMAIL`, defaults to `lantianye@163.com`, and uses HttpOnly 12-hour sessions. Admin write routes must validate CSRF tokens.
- The service must not accept uploads or API fields containing video, audio, transcript, insight, cookie, or user-local configuration data.
- The service may store a dedicated FrameQ client LLM API key. It must be encrypted at rest with `FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY`, never displayed in full, and treated as revocable client runtime material rather than a supplier master key.
- The dedicated client LLM key is delivered to authenticated entitled desktop clients during checkout. This improves out-of-box setup but does not prevent extraction from a compromised client; supplier-side key rotation and quota controls remain required.

<!-- 由 vibe-coding-launcher 生成。 -->

## Scope

FrameQ 涉及公开视频 URL、下载文件、本地音频、ASR 文字稿、可选 LLM API 和导出文件。本文件定义默认安全边界。

## Content Boundary

- 仅用于公开视频、用户自己发布的视频、已授权视频、内部研究或内容归档。
- 不实现绕过平台访问限制、批量抓取未授权内容、规避版权或隐私规则的能力。
- 当前产品路径不支持浏览器 cookie 导入、浏览器 cookie 文件、平台账号登录或 Cookie 辅助下载。worker fallback 只能使用公开视频页面自然下发的进程内匿名 cookie，且必须在本次 worker 调用结束后丢弃，不得上传、持久化、写入历史、日志或 app-local settings。

## Local Data

- `outputs/tasks/<task_id>/` 存放用户最终产物和 `frameq-task.json`，默认不提交仓库。
- 用户可通过 `FRAMEQ_OUTPUT_DIR` 将最终任务目录写入自定义本地目录；该目录内容不由仓库管理，用户需要自行保护其中的公开视频、音频、文字稿和灵感文件。
- `cache/tasks/<task_id>/` 存放下载缓存、中间文件和调试产物，默认不提交仓库；它不得作为历史或正式产物真相源。
- `frameq-task.json` 是任务库索引和 artifact 真相源；旧版 app-local history 记录不再被新版本读取或信任。
- `models/` 存放模型权重缓存，默认不提交仓库。
- `updates.json` 只存放更新检查偏好，默认不提交仓库；不得包含用户内容、账号 session、release signing private key 或下载包二进制。
- 对外分发安装包不内置 ASR 模型权重；首启下载的核心本地 ASR 模型（首版 SenseVoice Small）和运行期可写缓存、输出、历史、`.env` 必须写入 app-local data，不得写入安装目录。
- 取消任务会终止当前 worker 进程树；已写入的 `outputs/`、`cache/` 和 `models/` 文件默认保留，不做自动清理。

## Secrets

- LLM API Key、代理地址和云端配置不得硬编码到桌面端或 worker；管理员在 server Admin Web 中配置，server 负责加密保存。
- LLM 配置不得从 app-local data `.env` 或项目根 `.env` 读取；真实 `.env` 被 `.gitignore` 忽略，仓库只保留不含 LLM key 的 `.env.example` 和安装包 `.env.template` 占位模板。
- 旧本地 InsightFlow LLM 键名 `FRAMEQ_LLM_PROVIDER`、`FRAMEQ_LLM_BASE_URL`、`FRAMEQ_LLM_API_KEY`、`FRAMEQ_LLM_MODEL` 和 `FRAMEQ_LLM_TIMEOUT_SECONDS` 必须被 dotenv 加载链路忽略。
- 输出目录键名为 `FRAMEQ_OUTPUT_DIR`，不得用于写入网络路径凭据或敏感 token。
- 日志不得输出完整密钥、cookies 或敏感请求头。

## External Services

- LLM-generated Markdown rendered in the desktop UI must go through the sanitized Markdown renderer. Raw HTML from `summary.md` must be skipped or sanitized and must not be rendered with `dangerouslySetInnerHTML`.
- 下载、转码和 ASR 默认本地处理。
- 首启 ASR 模型下载会访问 ModelScope，或访问发布方通过 `FRAMEQ_ASR_MODEL_DOWNLOAD_URL` 配置的自定义归档 URL；该配置不得包含凭据、URL 查询 token 或敏感请求头。
- ASR 模型选择通过 `FRAMEQ_ASR_MODEL` 保存到本地 `.env`；该键只允许选择受支持的本地 ASR 模型标识，不得携带凭据、URL 查询 token 或敏感请求头。
- AI整理会通过 server-managed checkout 使用管理员配置的云端 LLM；worker 会把文字稿片段发送到 checkout 返回的服务地址，用于生成要点总结、Mermaid mindmap 和启发灵感，确认面板必须明确提示这一点。
- 桌面更新检查会访问 GitHub Releases 上的公开 `latest.json` updater manifest；该请求不上传本地文件、历史、模型缓存或账号 session。
- UI 设置面板只管理本机 ASR 和输出目录；云端 LLM 是否就绪由账号状态展示，文字稿主流程不依赖 LLM。
- worker 对外部服务错误必须返回结构化错误码，不得吞掉失败。

## Validation

涉及安全边界的改动至少需要：

- 检查 `.gitignore` 是否覆盖模型、输出、中间文件和密钥。
- 检查日志中不包含密钥、cookies 或完整敏感头。
- 在 spec 或 ExecPlan 中说明云端 LLM 数据流和用户提示。
