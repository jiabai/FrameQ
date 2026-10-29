# Active Exec Plans

- `2026-10-29-entitlement-expiry-only-plan.md` - 权益持久化状态与相关写入已移除；完整 server 测试、build、八条迁移、数据保留与约束、schema diff、备份校验和恢复验证通过，托管 CI 与生产部署待执行。
- `2026-10-29-email-rate-limit-retry-time-plan.md` - 邮件限流按全部阻塞窗口的最晚解除时间返回；真实 SQLite/Memory 回归、完整 server 测试、build、迁移/preflight/restore 通过，生产部署与托管 CI 待执行。
- `2026-10-28-server-update-manifest-removal-plan.md` - 服务端更新清单与路由已移除，完整 server 测试、build、隔离数据库迁移/preflight/restore 通过；生产部署与托管 CI 待执行。



- `2026-08-09-desktop-diagnostic-export-plan.md` - Implementation and automated gates complete for contract v8 structured ASR model-download diagnostics, Rust-owned bounded persistence, and user-initiated local ZIP export from failure UI and Settings > Advanced; Windows/macOS native release smoke remains pending, with no automatic upload or network probes.
- `2026-10-24-transcript-polish-plan.md` - Implementation and automated gates complete for contract v9 `retry_insights` `transcript` target: chunked LLM polish of the official ASR transcript into a separate `transcript/polished.txt` (+ SHA-256 meta), dual-state toolbar button, untouched original transcript; native release smoke remains pending.

See `../completed/index.md` for completed plans and `docs/exec-plans/index.md`
for the full index.
