# Email Rate Limit Retry Time Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

邮件发送被限流拒绝时，服务端检查邮箱每分钟、邮箱每小时与可信 IP 每小时的全部限制，
返回当前所有阻塞窗口的最晚解除时间。请求期间保留数据库原子计数与整笔事务失败撤销。

## Progress

- [x] 2026-10-29: 用户确认执行已说明的修复方案。Validation: 当前对话授权；核对两个 Store 的实现与调用事务。
- [x] 2026-10-29: 更新相关产品规格并登记执行计划。Validation: 限流策略、HTTP 重试字段与测试入口已检查。
- [x] 2026-10-29: 增加真实 SQLite 与 Memory 的 28 项回归；RED 验证覆盖过早重试时间。Validation: 三种用途、全部窗口组合、解除边界、失败计数恢复与独立连接竞争。
- [x] 2026-10-29: 汇总全部阻塞结果，使用最晚时间统一拒绝。Validation: 新回归与既有并发检查共 56 项通过；TypeScript build 通过。
- [x] 2026-10-29: 完成本地 server 全量测试与数据库门禁。Validation: 349 passed、1 skipped；七条迁移、migration status、preflight、隔离 restore 通过。
- [x] 2026-10-29: 同步规格、安全边界、模块职责及审计记录。Validation: 文档治理与 diff 检查通过。
- [ ] 发布前取得托管 Server CI 结果，并完成生产行为验收。

## Surprises & Discoveries

Evidence: `prismaStore/rateLimits.ts` 每次条件写入直接返回该窗口是否拒绝，汇总阶段仅比较拒绝窗口；Memory 在同一请求时间核对已有窗口。
Evidence: 登录验证码与自助激活邮件都在 Store 事务中调用同一个限流预约函数；SQLite 条件写入已承担并发保护。
Evidence: 一分钟窗口可能在固定小时窗口结束后才解除；回归同时覆盖小时限制更晚及分钟限制更晚两种情况。

## Decision Log

Decision: 保留条件 SQL 写入，每个窗口分别返回本次预约是否被阻塞，在事务内收集全部结果后抛出一次限流错误。
Rationale: 保留并发保护；失败导致所有临时预约撤销，成功预约也不会被误认为请求前已有的阻塞。Date/Author: 2026-10-29, Codex。

Decision: 复用现有 `retryAt`、`retry_at` 与 `Retry-After`，限流阈值、数据库结构及 HTTP 形状保持现有契约。
Rationale: 用户授权修复重试时间与验证计数一致性。Date/Author: 2026-10-29, User + Codex。

## Outcomes & Retrospective

本地代码修复完成。三种邮件用途在所有窗口组合和解除边界上与 Memory 返回相同结果；
两个独立 Prisma client 竞争最后发送位置时只创建一条验证码，受限请求返回最晚解除时间。
完整 server 测试 349 项通过，Windows 子进程 SIGTERM 用例按现有规则跳过 1 项；TypeScript build 通过。
隔离数据库位于 `build/side-email-rate-limit-dfc47ab833224b0c9fc36e4850cf6423/`，七条现有迁移、
migration status、preflight 与独立副本 restore smoke 通过。本次没有数据库结构修改。
### Production deployment — 2026-11-08

生产从 `30934a4`（2026-10-20）部署到 `bf92310`（用户授权）。完整部署证据见
`2026-10-28-server-update-manifest-removal-plan.md` 的同名小节：停服备份
`20261108T103403Z` + 异地副本 + 隔离恢复演练，fetch/checkout、`npm ci`、
`prisma generate`、39 文件 400 项测试、`tsc --noEmit`、第 8 条迁移、
`migrate status`、新代码 preflight、启动与 restart 健康检查全部通过；
`POST /api/desktop/activation-codes/request` 与 `/api/desktop/anysearch/checkout`
线上均返回 401 `AUTH_REQUIRED`，确认修复后的 auth-first 路由已生效。
部署的 `rateLimits.ts` sha256（LF 归一化）与本地 main 一致。

Residual risk: 生产已部署；受限响应中「最晚解除时间 / retry_at」由完整 server 测试与线上
auth-first 探针覆盖，**未发起真实邮件 OTP 请求**验证实际 429 响应体（会触发真实邮件投递）。

## Context and Orientation

- Specs: `docs/product-specs/2026-08-24-self-service-email-activation-code.md`、`2026-07-22-release-reliability-hardening.md`。
- Implementation: `server/src/prismaStore/rateLimits.ts`、`server/src/store/memory/rateLimits.ts`、`server/src/store/rateLimitPolicy.ts`。
- Callers: `server/src/prismaStore/auth.ts`、`selfServiceActivation.ts`。
- HTTP: `server/src/routes/desktopAccount.ts` 按相同解除时间返回 JSON 与向上取整的等待秒数。

## Plan of Work

1. 用真实数据库和内存实现比较全部窗口组合、解除边界和失败前后计数；覆盖三个邮件用途。
2. 修改共用数据库预约函数，保留原子条件写入并在检查结束后统一抛出错误。
3. 验证两个独立 Prisma client 的竞争只允许一次发送，且失败响应带最晚解除时间。
4. 运行本地门禁，同步安全边界、审计状态与验证范围。

## Validation and Acceptance

- `npm --prefix server test`、`npm --prefix server run build`。
- 用 `build/` 下独立 SQLite 文件执行全部迁移、migration status、preflight 与隔离副本 restore smoke。
- `python scripts/validate_agents_docs.py --level ERROR`、`git diff --check`。
- 发布前使用托管 CI，并在已部署服务验证受限响应中的重试时间；本任务不触发生产部署。
