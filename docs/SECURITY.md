# Security and Compliance

## 2026-06-25 Douyin Share Page Fallback Boundary

- The Douyin fallback may request public `iesdouyin.com` share pages and public media CDN URLs for user-submitted public or user-authorized links.
- The fallback must not require, collect, persist, or upload browser cookies. Exported cookie files are not part of the supported product path for this fallback.
- The fallback may use a fixed mobile Safari user agent and minimal public-page headers for compatibility with public share pages. It must not use user-agent rotation, proxy pools, browser fingerprint spoofing, CAPTCHA solving, login automation, or account-authenticated scraping.
- A process-local cookie jar may accept anonymous cookies naturally set by the public share page, such as `ttwid`, but those cookies must be discarded after the worker invocation and must not be written to history, logs, app-local settings, or server requests.
- The fallback must not attempt to solve CAPTCHA, defeat login gates, bypass private content restrictions, or automate account-authenticated scraping.
- Worker logs, history records, and UI errors must not store cookies, sensitive request headers, or full media CDN URLs when those URLs contain volatile request tokens. Logs may keep the original submitted URL, short error summaries, hostnames, stream quality labels, byte sizes, and local output paths.
- Downloaded video, extracted audio, transcripts, summaries, mindmaps, and topic outputs remain local artifacts under the configured output/work directories; no fallback media data is sent to the FrameQ server.

## 2026-06-23 Desktop Update Boundary

- Desktop updates must use Tauri updater signature verification before installation.
- The updater public key may be bundled in `tauri.conf.json`; the private signing key and signing password must never be committed, bundled, or stored on FrameQ server runtime hosts unless that host is the intended signing environment.
- The public update endpoint returns only release metadata and artifact URLs; it must not require desktop authentication and must not return user data, account data, LLM keys, or ASR model credentials.
- `updates.json` may store `lastCheckedAt`, `postponedUntil`, and `skippedVersion` only. It must not store downloaded installers, signatures, private keys, session tokens, video URLs, transcripts, or model cache paths beyond generic update preferences.
- Updating the app must preserve app-local `models/`, `outputs/`, `work/`, `auth/`, `.env`, and `updates.json`.

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

- The account service stores only email accounts, OTP metadata, session token hashes, orders, entitlements, and webhook audit records.
- Desktop session tokens are opaque random values. The server stores SHA-256 hashes only; the desktop client stores the raw token in app-local data under `auth/session.json`.
- Email OTP codes expire after 10 minutes, allow at most 5 attempts, and must be rate-limited by email and IP.
- Login deep-link tickets expire after 5 minutes, are single-use, and must be bound to a desktop-generated `state` value.
- WeChat merchant credentials, APIv3 key, certificate private key, and SMTP credentials must only be configured through the server environment. They must not be bundled into the desktop installer.
- WeChat payment callbacks must verify signatures, decrypt encrypted resources, and apply entitlement updates idempotently.
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
- 如果使用浏览器 cookies，只能用于用户有权访问的内容，并且不得默认上传或持久化 cookies。

## Local Data

- `outputs/` 存放用户最终产物，默认不提交仓库。
- 用户可通过 `FRAMEQ_OUTPUT_DIR` 将最终产物写入自定义本地目录；该目录内容不由仓库管理，用户需要自行保护其中的公开视频、文字稿和话题点文件。
- `work/` 存放中间文件和调试产物，默认不提交仓库。
- `work/history.json` 存放本地历史任务索引，默认不提交仓库；它可以包含 URL、本地结果路径、错误码和摘要，但不得包含 API key、cookies 或敏感请求头。
- `models/` 存放模型权重缓存，默认不提交仓库。
- `updates.json` 只存放更新检查偏好，默认不提交仓库；不得包含用户内容、账号 session、release signing private key 或下载包二进制。
- 对外分发安装包不内置 ASR 模型权重；首启下载的核心本地 ASR 模型（首版 SenseVoice Small）和运行期可写缓存、输出、历史、`.env` 必须写入 app-local data，不得写入安装目录。
- 取消任务会终止当前 worker 进程树；已写入的 `outputs/`、`work/` 和 `models/` 文件默认保留，不做自动清理。

## Secrets

- LLM API Key、代理地址和云端配置不得硬编码到桌面端或 worker；管理员在 server Admin Web 中配置，server 负责加密保存。
- LLM 配置不得从 app-local data `.env` 或项目根 `.env` 读取；真实 `.env` 被 `.gitignore` 忽略，仓库只保留不含 LLM key 的 `.env.example` 和安装包 `.env.template` 占位模板。
- 旧本地 InsightFlow LLM 键名 `FRAMEQ_LLM_PROVIDER`、`FRAMEQ_LLM_BASE_URL`、`FRAMEQ_LLM_API_KEY`、`FRAMEQ_LLM_MODEL` 和 `FRAMEQ_LLM_TIMEOUT_SECONDS` 必须被 dotenv 加载链路忽略。
- 输出目录键名为 `FRAMEQ_OUTPUT_DIR`，不得用于写入网络路径凭据或敏感 token。
- 日志不得输出完整密钥、cookies 或敏感请求头。

## External Services

- 下载、转码和 ASR 默认本地处理。
- 首启 ASR 模型下载会访问 ModelScope，或访问发布方通过 `FRAMEQ_ASR_MODEL_DOWNLOAD_URL` 配置的自定义归档 URL；该配置不得包含凭据、URL 查询 token 或敏感请求头。
- ASR 模型选择通过 `FRAMEQ_ASR_MODEL` 保存到本地 `.env`；该键只允许选择受支持的本地 ASR 模型标识，不得携带凭据、URL 查询 token 或敏感请求头。
- AI整理会通过 server-managed checkout 使用管理员配置的云端 LLM；worker 会把文字稿片段发送到 checkout 返回的服务地址，用于生成要点总结、Mermaid mindmap 和启发话题点，确认面板必须明确提示这一点。
- 桌面更新检查会访问 GitHub Releases 上的公开 `latest.json` updater manifest；该请求不上传本地文件、历史、模型缓存或账号 session。
- UI 设置面板只管理本机 ASR 和输出目录；云端 LLM 是否就绪由账号状态展示，文字稿主流程不依赖 LLM。
- worker 对外部服务错误必须返回结构化错误码，不得吞掉失败。

## Validation

涉及安全边界的改动至少需要：

- 检查 `.gitignore` 是否覆盖模型、输出、中间文件和密钥。
- 检查日志中不包含密钥、cookies 或完整敏感头。
- 在 spec 或 ExecPlan 中说明云端 LLM 数据流和用户提示。
