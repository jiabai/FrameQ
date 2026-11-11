# Active Exec Plans

- `2026-11-11-collection-membership-feedback-plan.md` — 合集成员状态反馈：**代码与门禁完成**。用户确认合集保持引用语义，笔记总列表始终全量；添加清单保留已加入笔记并标注状态，加入/移除后显示「笔记仍在笔记列表」的说明与撤销。规格、`DESIGN.md`、组件、三语文案、样式与测试已更新；前端 137 文件 / 1591 通过 / 1 跳过，lint 与 build 通过，文档 0/0。残余：原生窗口真实指针与键盘验收，以及提交与发版决策。前端门禁需在 PowerShell 里先清 `NODE_OPTIONS`。

- `2026-11-10-data-storage-migration-speedup-plan.md` — 数据存储迁移提速（**第一批代码完成**）：并行复制/验证、砍写入后重哈希、源重验 identity+length 廉价判定、persist 250ms 节流；用户干净环境 data_storage 全模块 **88 passed / 0 failed**（agent 宿主内删除拦截致波动假失败，教训已记）。残余：全量 `cargo test --lib` 复跑与真实迁移计时对比。第二批与第三批单独立项。

- `2026-11-10-v0.6.1-llm-byok-plan.md` — v0.6.1 自定义 LLM 配置（BYOK）**代码与门禁已完成**（2026-11-10）：契约 v12 双模式、Rust `llm_providers.json` + 系统钥匙串、worker 最小 chat 探针、设置页「模型」分类与三语文案；默认仍是 Locus 托管，BYOK 不扣 AI Credit、不需登录。全套门禁全绿（worker 1310/4、前端 1576/1、服务端 375/1、脚本 57+1、Rust 相关 79 项、文档 0/0）。**Step 11 已用真实 SiliconFlow Key 跑通**（探针、钥匙串、真实摘要生成），并修掉两个真实调用才暴露的缺陷：Tauri 顶层参数需为 `apiKey`、HTTP 400 的未知模型需归类 `LLM_PROBE_MODEL_NOT_FOUND`；不 bump 版本、不打 tag、不部署站点。

- `2026-11-10-v0.6.0-local-preparation-plan.md` — v0.6.0 **只在本机准备、未发版**：6 处版本号 bump 到 `0.6.0`，写好 GitHub 发布正文与站点本地发布说明，跑全套门禁与本机构建，形成一个本地 commit；不 push、不打 tag、不建 Release、不部署站点（站点 dist 已指向尚不存在的 `Locus_0.6.0_*` 资产）。用户还有 v0.6.1 功能要做，版本号保持 `0.6.0` 直到下一次发版决策。计划内含完整发版前清单与 v0.6.1 交接步骤。

- `2026-11-09-project-rename-locus-plan.md` — 已完成（提交 `5d312de` / `0a8d377` / `83d50ea`）：改名为 Locus 并彻底去品牌化，包名、环境变量、应用标识符、磁盘契约与日志改成中性名（`worker_core` / `APP_*` / `pro.8xf.app` / `task.json`），品牌收敛到四处常量并用 `{{product}}` 渲染文案；不写迁移代码。残余：旧数据目录不迁移、生产域名与路径仍是旧名、macOS 侧改动等待托管 CI 首次验证。




- `2026-11-07-web-login-response-classification-plan.md` — Windows 与 macOS 原生宿主把「HTTP 200 且重定向到登录页」在提取前判为 `WEB_PAGE_ACCESS_RESTRICTED`；Windows crate 20 项单测、前端 1507 项、脚本 57 项、生产构建与文档治理通过。macOS Swift 编译与协议测试已由 v0.5.0 重发的托管 CI 覆盖；2026-11-08 完成真实 WebView2 Runtime 157.0.4341.42 + 公网端到端验收：登录跳转 12.5 秒即时报受限码、正常文章不误报、直达 `/login` 的边界行为符合设计。剩余：真实 WKWebView 验收需 macOS 机器。
- `2026-10-31-llm-note-titles-plan.md` — 自动标题已实现；前端 1102、worker 1198、Rust 381 项通过，真实供应商两次共使用 2 个 AI Credit；完整原生 URL 流程验收待完成。
- `2026-10-30-desktop-sidebar-home-plan.md` - 侧栏、Home、本地合集与笔记流程已实现；1039 项前端测试与 Windows 构建通过。2026-11-08 三项残余原生验收闭环：详情动作激活 13 项、原生合集删除与任务文件保留 14 项（脚本化原生输入 + 字节级比对），以及用户手动跑通的「新建笔记 → 真实网页处理 → 自动入集」（微信文章，新任务 `20261108-145629-web-602ecab8a8b14291`，合集 0→1，无 AI 调用）。membership-retry 失败路径未触发，仍只有组件测试覆盖；本机 11-05 构建产物混版本曾导致 web 会话 `WEB_STORAGE_FAILED`，重建 `tauri build --no-bundle` 后恢复。详见计划与 `design-qa.md`。




- `2026-08-09-desktop-diagnostic-export-plan.md` - Implementation and automated gates complete for contract v8 structured ASR model-download diagnostics, Rust-owned bounded persistence, and user-initiated local ZIP export from failure UI and Settings > Advanced. 2026-11-08: focused Rust 50+8, worker 73, scripts 57, frontend 23 and packaged-worker equality all green; new permanent test writes a real ZIP to disk and scans every entry for seeded forbidden data. Same day the **real Windows Save As dialog** was driven through WebView2 CDP (`--remote-debugging-port=9222`) plus Win32 messages / `SendInput` (no mouse, .NET UIA blocked here): success / cancel / replace-existing / destination-failure all passed, zero forbidden-data hits. Remaining: strict packaged (NSIS) evidence, Rust write-stage `failed` code (unit-test only), and macOS native dialog/replacement. No automatic upload, mail or network probes.

See `../completed/index.md` for completed plans and `docs/exec-plans/index.md`
for the full index.
