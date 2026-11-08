# Active Exec Plans




- `2026-11-07-web-login-response-classification-plan.md` — Windows 与 macOS 原生宿主把「HTTP 200 且重定向到登录页」在提取前判为 `WEB_PAGE_ACCESS_RESTRICTED`；Windows crate 20 项单测、前端 1507 项、脚本 57 项、生产构建与文档治理通过。macOS Swift 编译与协议测试已由 v0.5.0 重发的托管 CI 覆盖；2026-11-08 完成真实 WebView2 Runtime 157.0.4341.42 + 公网端到端验收：登录跳转 12.5 秒即时报受限码、正常文章不误报、直达 `/login` 的边界行为符合设计。剩余：真实 WKWebView 验收需 macOS 机器。
- `2026-10-31-llm-note-titles-plan.md` — 自动标题已实现；前端 1102、worker 1198、Rust 381 项通过，真实供应商两次共使用 2 个 AI Credit；完整原生 URL 流程验收待完成。
- `2026-10-30-desktop-sidebar-home-plan.md` - 侧栏、Home、本地合集与笔记流程已实现；1039 项前端测试与 Windows 构建通过，完整原生交互及视觉验收记录见计划。




- `2026-08-09-desktop-diagnostic-export-plan.md` - Implementation and automated gates complete for contract v8 structured ASR model-download diagnostics, Rust-owned bounded persistence, and user-initiated local ZIP export from failure UI and Settings > Advanced. 2026-11-08 recheck on current main: focused Rust 50+8, worker 73, scripts 57, frontend 23 and packaged-worker equality all green; a new permanent test writes a real ZIP to disk and scans every entry for seeded forbidden data, covering the scriptable part of manual steps 1/4/5/7/8. Windows/macOS **native Save As dialog** release smoke remains unverified (no CDP/UIA tree on this host); the earlier "Windows manual verification complete" claim was wrong and is corrected in the plan and `TASKS.md`. No automatic upload or network probes.

See `../completed/index.md` for completed plans and `docs/exec-plans/index.md`
for the full index.
