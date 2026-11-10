# 自定义 LLM 配置（BYOK）架构设计

| 字段 | 值 |
| --- | --- |
| 状态 | Confirmed，2026-11-10 用户确认五项产品决策 |
| 创建日期 | 2026-11-10 |
| 作者 | WorkBuddy |
| 关联文档 | `docs/product-specs/2026-11-10-llm-byok-custom-providers.md`、`docs/exec-plans/active/2026-11-10-v0.6.1-llm-byok-plan.md` |
| 决策性质 | 新增第二条 LLM 配置来源；改持久化、worker 环境变量注入与冻结契约 |

## 问题

现状有三条彼此矛盾的事实：

1. **worker 已经支持本地静态 LLM**。`worker/worker_core/ai_runtime.py:156-175` 的 `build_insight_provider()` 在 `APP_LLM_SOURCE != "server"` 时走 `_build_single_call_provider()`，读 `APP_LLM_PROVIDER / BASE_URL / API_KEY / MODEL / TIMEOUT_SECONDS`，调用是 OpenAI 兼容协议；`llm.py:55` 的 provider 白名单为 `openai | openai_compatible`，无硬编码供应商或模型。
2. **桌面端与 worker 又主动堵死这条路**。`app/src-tauri/src/worker_runtime/command.rs:153,270,372` 对每条 worker 命令设置 `env_remove: legacy_local_llm_env_removals()`（5 个 `APP_LLM_*`），`command.rs:457-475` 有断言锁死；`settings.rs:45-64` 的 .env 模板写「Do not put APP_LLM_* keys here」，保存配置时还会删掉这些键；`worker/worker_core/config.py:9-15` 再从用户 .env 剥离一次。
3. **契约与配额把 AI 生成绑在 server**。`contracts/desktop-worker-contract.json:1461` 写死 `aiGeneration.serverManagedLlmCheckout: true`；`server/src/routes/desktopLlm.ts:29-71` 每次 checkout 校验 entitlement、扣一次 AI Credit，并把管理员 AES 加密的长期供应商 key 解密后明文下发（`server/src/llmConfig.ts:19-25`）。

所以 BYOK 不需要新写一条 LLM 调用链，真正的工作是：**安全地存配置 → 按来源决定注入什么 → 放行/移除对应环境变量 → 同步冻结契约 → 加 UI 与探针**。

## 方案对比

| 方案 | 做法 | 取舍 | 结论 |
| --- | --- | --- | --- |
| A. server 代管 BYOK | 用户 key 上传 server，由 server 代调供应商 | 密钥离开本机、仍需登录与配额语义，违背本地优先；server 与生产配置都要改 | 否决 |
| B. WebView 前端直连 | React 里直接 fetch 用户 API | CORS、key 暴露在 JS 层与 DevTools、AI 生成实际在 worker 里无法复用 | 否决 |
| C. 放开明文 `.env` | 直接允许填写 `APP_LLM_*` | 与现行三层删除策略冲突，诊断包 / 备份 / 其他进程都有泄漏面 | 否决 |
| D. **本机钥匙串 + Rust 注入 + worker 复用**（选定） | key 存系统钥匙串，元数据存 app-local JSON；Rust 按来源注入；worker 复用现成 provider 分支 | 改动集中在桌面端，密钥不出机，几乎不动 worker 调用逻辑 | **采用** |

## 数据流

### 配置存储

- `llm_providers.json`（app-local，Rust owner，新文件，**不进任务产物白名单**）：
  `{ schemaVersion, source: "managed" | "byok", activeId, providers: [{ id, label, provider, baseUrl, model, timeoutSeconds, createdAt }] }`
  —— **不含 key**。
- API Key 存系统钥匙串：service `pro.8xf.app.llm`，account 为 provider id。
- 抽象 `SecretStore` trait + `KeyringSecretStore` 实现；`#[cfg(test)]` 用内存 mock，CI / Linux 不依赖真实钥匙串。前端拿到的配置对象里 key 字段恒为 `null`，另有 `hasKey: boolean`；编辑已有配置时不回传明文。
- `settings.rs` 的 `APP_SETTINGS_SCHEMA_VERSION` **保持 2 不变**：`migrate_settings_schema()` 在版本不匹配时会把 `APP_ASR_MODEL` 一并重置为默认值（见 `settings.rs:376-399`），bump 会让所有现有安装触发一次意外的 ASR 模型回退。BYOK 配置在独立文件里，与 .env 的 schema 版本没有任何耦合。三份 .env 模板保留「不要在 .env 里写 LLM 密钥」，补一句「自定义模型请在设置里管理」。

### 测试连接

Rust command → 启动 worker CLI 新参数 `--probe-llm-stdin` → stdin 传封闭四字段 `{ base_url, api_key, model, provider }`（契约 v12 的 `llmProbe.request` 设了 `additionalProperties: false`，且契约遍历测试禁止出现含 `timeout` / `deadline` / `watchdog` 的键名）→ worker 复用 `_build_single_call_provider()` 发一条 `max_tokens=1` 的极短 chat → 输出结构化结果 `{ ok, error_code, latency_ms }`。探针超时由 worker 模块常量 `PROBE_TIMEOUT_SECONDS = 15` 控制，不进入跨语言契约。

错误分类为固定码（网络失败、鉴权失败、模型不存在、超时、限流、响应非法），**不回显供应商原始响应体、不回显 key**。任何进入日志的文本先过 `diagnostics.rs:93-186` 的 `sanitize_diagnostic_text`。

### 实际生成

`build_worker_command_spec(paths, invocation, server_managed_llm, byok_llm)` 按来源分支：

| 来源 | LLM 环境变量 | `env_remove` | anysearch |
| --- | --- | --- | --- |
| Locus 托管（默认） | `APP_LLM_SOURCE=server` + checkout URL / session token / request id | 保持移除 5 个 `APP_LLM_*` | 已登录时注入 server checkout |
| BYOK | 注入 5 个 `APP_LLM_*`（provider 固定 `openai_compatible`），**不注入** `APP_LLM_SOURCE=server` | 不再移除这 5 键，改为只清理 server checkout 键 | 已登录时仍注入 server checkout；未登录 + `draft` → 前置拒绝并返回 `AI_DRAFT_REQUIRES_LOGIN` |

配额：BYOK 不调 `/api/desktop/llm/checkouts` → 天然不扣 AI Credit、不校验 entitlement。UI 必须明示这一点，避免用户以为额度仍被消耗。

### 命中的 target 与白名单

所有 `retry_insights` target 均按新来源走；`worker/worker_core/requests.py:299` 的 target 白名单、`contracts` 的 `forbiddenContent` 与 `command.rs` 防 key 进 argv / 进度事件 / stdout 的边界一律保留。

## 契约改动

- `contracts/desktop-worker-contract.json` 的 `aiGeneration`：`serverManagedLlmCheckout: true` 改为双模式描述（新增 `llmSources: ["managed", "byok"]` 与 `byokProviderEnv` 键名列表，`serverManagedLlmCheckout` 保留为托管模式下的事实）。该段 `additionalProperties: false`，**新增键必须写进 schema**，否则校验失败。
- 同步四处断言：`worker/tests/test_contract.py`、`app/src/desktopWorkerContract.test.ts`、`app/src/desktopWorkerProtocol.test.ts`、`app/src-tauri/src/lib.rs` / `result_protocol.rs` 的契约断言。
- **不改** `contracts/task-artifact-transaction-v1.json` 的落盘白名单：本次不新增任务产物，`llm_providers.json` 属于 app-local 设置，不进任务目录。
- 探针请求是新 CLI 参数，不是新的 `retry_insights` 字段，因此不扩 `aiGeneration.request`；但要在契约里声明该 CLI 参数的存在与 stdin 结构，避免三端各自猜测。

### IPC 参数命名边界（真实端到端才暴露的坑）

Tauri 会把**顶层命令参数**重命名为 camelCase：Rust 的 `api_key: Option<String>` 必须由前端传 `apiKey`；传 `api_key` 不会报错，而是静默变成 `None`，命令照常进入业务分支再返回 `LLM_PROVIDER_API_KEY_REQUIRED` / `LLM_PROBE_API_KEY_REQUIRED`。而 `provider` / `config` 嵌套对象由 serde 直接反序列化，保持 snake_case（`base_url`、`timeout_seconds`）。所以一次调用里会同时出现两种命名风格，这是 Tauri 的边界行为，不是笔误。改这些参数名必须跑 `app/src/settingsClient.test.ts` 的形状断言，并对真实 app 调一次命令——mock runner 永远发现不了这类错误。

## 安全边界（不可让步）

1. key 不进 `llm_providers.json`、`.env`、日志、诊断 ZIP、argv、进度事件、错误详情与前端状态；含 key 的 Rust 结构体 `Debug` 返回 `REDACTED`（照 `app/src-tauri/src/local_media.rs:32` 先例）。
2. 注入 worker 优先用 stdin（探针）；实际生成用 env，但 `env_remove` 必须按来源分支，且 Rust 单测逐键断言。
3. `diagnostics.rs` 的 `sanitize_diagnostic_text` 已含 `APP_LLM_API_KEY=` marker，补一条回归测试证明导出内容无 key。
4. 错误信息只回固定错误码；供应商返回的原始 body 不进 UI、不进日志。
5. 测试连接真实计费（极少 token），UI 明示；探针超时设短上限（建议 15 秒）并可取消。

## 依赖与平台前提

- `keyring` 4.2.0：本机 `rustc 1.96.0` 满足其 MSRV 1.88；默认 feature `v1` 已含 Windows Credential Manager 与 macOS Keychain 后端。Linux 默认后端依赖 D-Bus Secret Service，CI 上不保证存在 → 用 target-specific dependency + `SecretStore` trait 隔离，测试全程用 mock。
- **实施第 0 步必须先验证**该依赖能在项目里编译通过并确认 API 形态；若失败，回退到 `keyring` 3.6.3（MSRV 1.75，显式 `windows-native` / `apple-native` feature），再不行则按平台直调 DPAPI / Keychain。
- 不新增前端依赖、不新增 Python 依赖、不改 server 依赖。

## 不做

server 端 Admin 改造与生产部署、anysearch 自定义凭证、模型列表自动发现、旧配置迁移、自动回退策略、v0.6.1 发版动作。
