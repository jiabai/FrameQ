# Server Update Manifest Removal Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

桌面更新使用 GitHub Releases。账号服务只维护当前支持的账号、激活、额度和 checkout 接口。

## Progress

- [x] 2026-10-28: 用户确认没有仓库外程序使用更新接口，并授权处理 S2。Validation: 当前对话确认；仓库调用检索。
- [x] 2026-10-28: 完成服务端基线检查。Validation: server 324 passed、1 skipped；TypeScript build 通过。
- [x] 2026-10-28: 删除更新路由、清单解析、运行时配置与专属测试，调整接口清单。Validation: HTTP 404 回归通过；server 源码及配置检索无清单处理残留。
- [x] 2026-10-28: 完成本地服务端与数据库门禁。Validation: server 321 passed、1 skipped；build 通过；独立 SQLite 的 7 条迁移、migration status、preflight 与隔离副本 restore smoke 通过。
- [x] 2026-10-28: 同步规格、架构、模块地图与 S2 审计记录。Validation: 文档治理与 diff 格式检查通过。
- [ ] 发布前取得托管 Server CI 结果。

## Surprises & Discoveries

Evidence: `app/src-tauri/tauri.conf.json` 指定 GitHub Releases 更新源；仓库内只有更新路由自身及测试消费服务端清单。

Evidence: `deploy/nginx/frameq-server.conf` 为全部 `/api/desktop/` 接口提供通用代理，需要继续服务账号和 checkout。

## Decision Log

Decision: 撤销服务端更新接口及清单配置。Rationale: 用户已确认外部使用情况，当前桌面更新由 GitHub Releases 提供。Date/Author: 2026-10-28, User + Codex。

Decision: 数据库门禁使用 `build/` 下独立文件。Rationale: 本次修改 HTTP 装配与配置，验证需要隔离现有本地数据库。Date/Author: 2026-10-28, Codex。

## Outcomes & Retrospective

本地代码处理完成，服务端更新路径返回标准 404；当前账号路由和 GitHub updater 配置通过相关检查。
完整 server 测试 321 项通过，Windows 上既有的子进程 SIGTERM 用例跳过 1 项；TypeScript build 通过。
隔离数据库位于 `build/side-server-update-2a5ec98401ab435e929b7f5dada50bee/`，使用空文件执行全部
Prisma migrations 后完成 schema status、preflight 与独立副本 restore smoke。
Residual risk: 生产部署与托管 CI 尚未执行，计划保持 active 等待发布证据；本次没有数据库结构改动。

## Context and Orientation

- Spec: `docs/product-specs/2026-06-23-desktop-one-click-updates.md`。
- Server: `server/src/server.ts`、`index.ts`、`runtimeConfig.ts`、`server/.env.example`。
- Tests: `server/tests/routes.test.ts`、`serverModuleBoundaries.test.ts`。
- Operations: `server/scripts/database-preflight.mjs`、`restore-smoke.mjs`。

## Plan of Work

1. 更新规格并增加真实 HTTP 404 断言，确认现有实现未满足该行为。
2. 删除清单解析模块、更新路由、配置与专属测试，调整其他测试的路由清单。
3. 同步架构、模块地图与审计状态，执行本地门禁并记录验证范围。

## Validation and Acceptance

- `npm --prefix server test`、`npm --prefix server run build`。
- 使用独立 SQLite 文件运行 `db:migrate:deploy`、`db:migrate:status`、`db:preflight` 与隔离副本 `db:restore-smoke`。
- `python scripts/validate_agents_docs.py --level ERROR`、`git diff --check`。
- 人工发布验收：生产服务部署后，检查账号接口可用、更新接口返回 404，并确认桌面仍指向 GitHub Releases。
