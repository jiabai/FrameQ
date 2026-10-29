# Entitlement Expiry Only Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

权益是否有效统一根据 `expiresAt > now` 判断，恰好到期时视为失效。数据库和 Store 记录保存到期时间
与额度信息，公共接口继续返回现有的派生状态。迁移只删除冗余字段，保留其他权益数据与约束。

## Progress

- [x] 2026-10-29: 用户授权移除冗余字段及相关写入。Validation: 已检查 schema、内部契约、Prisma/Memory 写入与期限判断。
- [x] 2026-10-29: 更新产品规格，确认使用独立数据库进行迁移与恢复验证。Validation: 历史迁移与部署 runbook 已检查。
- [x] 2026-10-29: 增加数据保留、期限边界与 schema 兼容性测试，完成 RED 验证。Validation: 真实 SQLite/Memory 覆盖字段移除和期限边界，旧结构拒绝检查覆盖启动与 preflight。
- [x] 2026-10-29: 增加第八条 forward migration，移除模型、内部记录和十二处写入，生成 Prisma client。Validation: Client 生成与 TypeScript build 通过；历史迁移保持原有内容。
- [x] 2026-10-29: 更新启动检查、preflight、迁移链测试及部署说明。Validation: 新代码拒绝旧结构，迁移后的结构通过；current preflight 要求第八条迁移。
- [x] 2026-10-29: 完成 server 全量测试与隔离数据库门禁。Validation: 401 passed、1 skipped；八条迁移、migration status、schema diff、preflight、checksum 与 restore smoke 通过。
- [x] 2026-10-29: 同步架构、安全边界与审计记录。Validation: 文档治理与 diff 检查通过。
- [ ] 发布前取得托管 Server CI 结果并执行生产备份、配套部署与验收。

## Surprises & Discoveries

Evidence: 公共权益状态、额度结账、激活和补偿已经依赖到期时间。激活码、订单和请求结果各自的 `status` 有独立含义。
Evidence: 历史迁移是部署证据，必须保持原有内容；新版本通过 forward migration 进入当前 schema。
Evidence: 原生 `DROP COLUMN` 经真实 Prisma migrate deploy 验证，保留字段、用户唯一索引、外键及三项额度检查约束保持有效。

## Decision Log

Decision: 新增 `202610290001_remove_entitlement_status`，仅删除 `Entitlement.status`。
Rationale: 期限、额度、用户关系及审计信息继续由现有字段承担；避免同时修改其他状态或数据。Date/Author: 2026-10-29, User + Codex。

Decision: 启动检查与 current preflight 必须拒绝旧权益结构，baseline preflight 继续服务历史升级。
Rationale: 新代码创建权益时不会提供已删除字段，必须在提供服务前确认数据库已迁移。Date/Author: 2026-10-29, Codex。

Decision: 生产恢复使用配套的迁移前数据库、代码和配置备份，不编写逆向数据修补迁移。
Rationale: 保留现有部署 runbook 的一致性要求。Date/Author: 2026-10-29, Codex。

## Outcomes & Retrospective

本地修复完成；生产数据库、生产服务及现有本地业务数据库保持原有内容。
期限边界、迁移与部署相关定向检查 19 项通过，完整 server 测试 401 passed、1 skipped；
TypeScript build 与 Prisma client 生成通过。升级测试从七条历史迁移构建已填充数据库，
由 Prisma 登记真实迁移历史并执行第八条迁移；核对所有保留字段、额度约束、唯一性和外键，
验证旧 schema 的启动与 preflight 拒绝、迁移后隔离恢复及迁移前备份的完整性与可恢复性。

空库门禁位于 `build/side-entitlement-expiry-0cf8a228c9fa46a6bb611db0726b0b76/`，完成八条迁移、
migration status、schema diff（无差异）、preflight 和独立副本 restore smoke。数据库与恢复副本
SHA-256 均为 `C8DFC14F4C9A4837C7698262CC162E1F0A0739FEE82DBC0775DA2344570706C0`。
Residual risk: 托管 CI、生产停服备份、异地留存、配套部署和生产验收尚未执行；计划保持 active 等待发布证据。

## Context and Orientation

- Schema: `server/prisma/schema.prisma` 与 `server/prisma/migrations/`。
- Store: `server/src/store/contracts.ts`、`store/memory/entitlements.ts`、`prismaStore/entitlements.ts`、`prismaStore/billing.ts`。
- Operations: `server/src/database.ts`、`server/scripts/database-preflight.mjs`、`restore-smoke.mjs`、`deploy/server-deployment.md`。
- Spec: `docs/product-specs/2026-07-22-release-reliability-hardening.md`。

## Plan of Work

1. 测试字段移除与 Memory/Prisma 的期限边界；验证从现有七条迁移升级时只移除目标列。
2. 修改 schema 和写入，保留历史 SQL；生成 Prisma client 并更新相关类型化数据。
3. 验证主键、用户唯一性、外键和额度检查约束，核对迁移前后的保留字段和文件备份。
4. 检查新代码拒绝旧结构，完成空库、已填充数据库升级及隔离恢复检查。
5. 同步持久文档与审计，记录本地结果和生产发布证据范围。

## Validation and Acceptance

- `npm --prefix server test`、`npm --prefix server run build`、`npm --prefix server run prisma:generate`。
- 独立 SQLite 的八条迁移、migration status、schema diff、preflight、备份 checksum 与隔离 restore smoke。
- `python scripts/validate_agents_docs.py --level ERROR`、`git diff --check`。
- 生产发布需先停服并验证配套备份，再迁移与启动新代码；本任务只执行本地独立数据库验证。
