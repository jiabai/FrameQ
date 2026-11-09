# Active Exec Plans

- `2026-11-09-project-rename-locus-plan.md` — 改名为 Locus 并彻底去品牌化：先把包名、环境变量、应用标识符、磁盘契约与日志改成中性名（`worker_core` / `APP_*` / `pro.8xf.app` / `task.json`），再把品牌收敛到三处常量并用 `{{product}}` 渲染文案；不写迁移代码，最后跑三端门禁与本机重装验证。规格、命名规范与计划已定稿，等待确认后执行。




- `2026-11-07-web-login-response-classification-plan.md` — Windows 与 macOS 原生宿主把「HTTP 200 且重定向到登录页」在提取前判为 `WEB_PAGE_ACCESS_RESTRICTED`；Windows crate 20 项单测、前端 1507 项、脚本 57 项、生产构建与文档治理通过。macOS Swift 编译与协议测试已由 v0.5.0 重发的托管 CI 覆盖；2026-11-08 完成真实 WebView2 Runtime 157.0.4341.42 + 公网端到端验收：登录跳转 12.5 秒即时报受限码、正常文章不误报、直达 `/login` 的边界行为符合设计。剩余：真实 WKWebView 验收需 macOS 机器。
- `2026-10-31-llm-note-titles-plan.md` — 自动标题已实现；前端 1102、worker 1198、Rust 381 项通过，真实供应商两次共使用 2 个 AI Credit；完整原生 URL 流程验收待完成。
- `2026-10-30-desktop-sidebar-home-plan.md` - 侧栏、Home、本地合集与笔记流程已实现；1039 项前端测试与 Windows 构建通过。2026-11-08 三项残余原生验收闭环：详情动作激活 13 项、原生合集删除与任务文件保留 14 项（脚本化原生输入 + 字节级比对），以及用户手动跑通的「新建笔记 → 真实网页处理 → 自动入集」（微信文章，新任务 `20261108-145629-web-602ecab8a8b14291`，合集 0→1，无 AI 调用）。membership-retry 失败路径未触发，仍只有组件测试覆盖；本机 11-05 构建产物混版本曾导致 web 会话 `WEB_STORAGE_FAILED`，重建 `tauri build --no-bundle` 后恢复。详见计划与 `design-qa.md`。




- `2026-08-09-desktop-diagnostic-export-plan.md` - Implementation and automated gates complete for contract v8 structured ASR model-download diagnostics, Rust-owned bounded persistence, and user-initiated local ZIP export from failure UI and Settings > Advanced. 2026-11-08: focused Rust 50+8, worker 73, scripts 57, frontend 23 and packaged-worker equality all green; new permanent test writes a real ZIP to disk and scans every entry for seeded forbidden data. Same day the **real Windows Save As dialog** was driven through WebView2 CDP (`--remote-debugging-port=9222`) plus Win32 messages / `SendInput` (no mouse, .NET UIA blocked here): success / cancel / replace-existing / destination-failure all passed, zero forbidden-data hits. Remaining: strict packaged (NSIS) evidence, Rust write-stage `failed` code (unit-test only), and macOS native dialog/replacement. No automatic upload, mail or network probes.

See `../completed/index.md` for completed plans and `docs/exec-plans/index.md`
for the full index.
