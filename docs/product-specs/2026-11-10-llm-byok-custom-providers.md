# 自定义 LLM 配置（BYOK）

状态：2026-11-10 用户确认 v0.6.1 需求，五项决策已定稿；**代码未动**。

参照：用户提供的「添加模型」弹窗截图——供应商（仅支持 OpenAI 兼容协议 API）、API Key、模型名称、测试连接、取消 / 保存。

设计文档：`docs/design-docs/2026-11-10-llm-byok-architecture.md`
实施计划：`docs/exec-plans/completed/2026-11-10-v0.6.1-llm-byok-plan.md`

## 用户目标

1. 高级用户不必依赖 Locus 托管的模型与 AI Credit，可以在**设置界面**里填自己的 OpenAI 兼容 API；不需要懂 `.env`、不需要重启。
2. 默认行为对现有用户零变化，仍是 Locus 托管（登录 + server checkout + 扣配额）。
3. API Key 不落在任何配置文件、日志或诊断包里。

## 已确认的五项决策

| 决策 | 结论 |
| --- | --- |
| 与 Locus 托管的关系 | **并存可切换**：设置里选「Locus 托管」（默认）或「我自己的 API」；切到 BYOK 后 AI 步骤直连用户供应商，不扣 AI Credit、不要求登录 |
| API Key 存储 | **系统钥匙串**（Windows Credential Manager / macOS Keychain），其余配置存 app-local JSON |
| 供应商 / 模型输入 | **预设 + 可自由输入**：内置常用供应商快捷填接口地址与候选模型，另可填任意自定义端点与模型名 |
| 草稿（生成文字稿） | **仍走 server anysearch**：BYOK 只换 LLM；未登录时只让草稿目标给出明确提示，其余 AI 目标不受影响 |
| 测试连接 | **worker 最小 chat 探针**：复用现有 provider 实现发一条极短请求，与实际生成同一条代码路径 |

## 范围内

1. 设置页新增独立「模型」分类：
   - 模型来源切换（Locus 托管 / 我自己的 API），并在 BYOK 下明示「不扣 AI Credit、无需登录」。
   - 自定义配置列表：名称、供应商、模型名、当前启用标记；支持添加 / 编辑 / 删除 / 设为启用。
   - 「添加模型」弹窗（照截图）：供应商下拉、接口地址、API Key（遮罩 + 已有 key 只显示占位）、模型名称（候选 + 手输）、测试连接、取消 / 保存。
2. 预设供应商：DeepSeek、SiliconFlow、智谱、月之暗面、OpenAI、自定义。预设只预填 `base_url` 与候选模型，**不锁定**任何字段，也不随发版才能新增。
3. 测试连接：返回「可用 / 不可用 + 固定错误码 + 耗时」；不回显 key、不回显供应商原始响应体；UI 明示会发送一条极短请求。
4. BYOK 生效范围：所有 `retry_insights` AI 目标（摘要、启发灵感、文字稿解剖、自动标题、草稿的 LLM 部分等）。
5. 草稿检索仍使用 server 托管的 anysearch；未登录 + BYOK + 草稿 → 三语明确提示「草稿需登录」，其余目标正常。
6. 三语文案（zh-CN / zh-TW / en-US）、错误码、`{{product}}` 占位与 i18n 一致性门禁。

## 不在范围

- server 端 Admin 全局 LLM 配置改造、生产部署、域名与仓库迁移。
- anysearch 自定义凭证（第二套密钥管理）。
- 自动拉取供应商模型列表、模型能力探测、价格 / 上下文窗口展示。
- 旧配置迁移（功能首次上线，无存量数据）。
- 从托管模式自动回退到 BYOK、或在额度用尽时自动切换。
- 本次不 bump 版本号、不打 tag、不建 Release、不部署站点（v0.6.1 继续在 `0.6.0` 版本号上开发）。

## 验收条件

- [ ] 全新安装默认仍是 Locus 托管，行为与 v0.6.0 一致；跑一次真实 AI 生成。
- [ ] 添加一条配置 → 测试连接通过 → 切换来源 → 生成摘要成功，server 侧 AI Credit 未变化。
- [ ] 错误 key → 测试连接返回结构化错误码，UI / 日志 / 诊断包 / argv / 进度事件里均无 key 明文。
- [ ] 删除或切换配置后，注入 worker 的 `APP_LLM_*` 与当前启用配置一致；切回托管后 5 个键重新被移除。
- [ ] 未登录 + BYOK + 草稿 → 明确三语提示；其余 AI 目标成功。
- [ ] 三语言文案与错误码齐全，i18n 一致性、字面量扫描、文档治理、`git diff --check` 通过。
- [ ] 全套门禁 + `tauri build --no-bundle` 通过。

## 风险与边界

1. **密钥边界**：key 只在 Rust 内存中存在，注入 worker 后不写入 `llm_providers.json`、`.env`、日志、诊断 ZIP、命令行参数与进度事件；含 key 的结构体 `Debug` 返回 `REDACTED`。
2. **契约是跨语言边界**：`contracts/desktop-worker-contract.json` 的 `aiGeneration` 段、`worker/tests/test_contract.py`、前端契约测试与 Rust 契约断言必须同批修改；单边改会让请求被整份拒绝。
3. **`env_remove` 是隐形开关**：`command.rs` 目前对所有 worker 命令强制移除 5 个 `APP_LLM_*`，BYOK 分支必须放行，否则配置注入了也会被抹掉。
4. **测试连接会真实计费**（极少 token），UI 必须明示，且探针固定 `max_tokens=1`。
5. **草稿是半托管状态**：BYOK 下 LLM 走本地、检索走 server，需在文案里说清，不要让用户以为完全离线。
