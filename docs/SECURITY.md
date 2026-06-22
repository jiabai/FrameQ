# Security and Compliance

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
- 对外分发安装包不内置 ASR 模型权重；首启下载的核心本地 ASR 模型（首版 SenseVoice Small）和运行期可写缓存、输出、历史、`.env` 必须写入 app-local data，不得写入安装目录。
- 取消任务会终止当前 worker 进程树；已写入的 `outputs/`、`work/` 和 `models/` 文件默认保留，不做自动清理。

## Secrets

- LLM API Key、代理地址和云端配置不得硬编码。
- LLM 配置从 app-local data `.env`、项目根 `.env`（开发态）或进程环境变量读取；真实 `.env` 被 `.gitignore` 忽略，仓库只保留 `.env.example` 和安装包 `.env.template` 占位模板。桌面 UI 可以写入 app-local data `.env`，但读取时不得回显完整 API Key。
- InsightFlow LLM 相关键名为 `FRAMEQ_LLM_PROVIDER`、`FRAMEQ_LLM_BASE_URL`、`FRAMEQ_LLM_API_KEY`、`FRAMEQ_LLM_MODEL` 和 `FRAMEQ_LLM_TIMEOUT_SECONDS`。
- 输出目录键名为 `FRAMEQ_OUTPUT_DIR`，不得用于写入网络路径凭据或敏感 token。
- 日志不得输出完整密钥、cookies 或敏感请求头。

## External Services

- 下载、转码和 ASR 默认本地处理。
- 首启 ASR 模型下载会访问 ModelScope，或访问发布方通过 `FRAMEQ_ASR_MODEL_DOWNLOAD_URL` 配置的自定义归档 URL；该配置不得包含凭据、URL 查询 token 或敏感请求头。
- ASR 模型选择通过 `FRAMEQ_ASR_MODEL` 保存到本地 `.env`；该键只允许选择受支持的本地 ASR 模型标识，不得携带凭据、URL 查询 token 或敏感请求头。
- 如果 InsightFlow 通过 `.env` 配置云端 LLM，worker 会把文字稿片段发送到 `FRAMEQ_LLM_BASE_URL` 指向的服务；运行进度文案和本地配置模板必须明确提示这一点。
- UI 设置面板也必须明确提示云端 LLM 数据流，并允许用户不配置 LLM，此时文字稿功能仍可用。
- worker 对外部服务错误必须返回结构化错误码，不得吞掉失败。

## Validation

涉及安全边界的改动至少需要：

- 检查 `.gitignore` 是否覆盖模型、输出、中间文件和密钥。
- 检查日志中不包含密钥、cookies 或完整敏感头。
- 在 spec 或 ExecPlan 中说明云端 LLM 数据流和用户提示。
