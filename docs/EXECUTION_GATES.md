# Execution Gates

<!-- 由 vibe-coding-launcher 生成。 -->

## Purpose

本文件定义 FrameQ 任务完成前必须满足的检查。验证应与风险成比例，并在最终交付中可见。

## Hard Gates

- 受影响代码路径、文档事实来源或方案来源已 inspect。
- 文档结构验证通过：`python scripts/validate_agents_docs.py --level ERROR`。
- touched active ExecPlan 的 Progress、Decision Log 和验证记录已更新。
- 架构、安全、流程、运行时 contract 或导出行为变化已同步到 durable docs。
- 涉及 worker 的改动必须至少运行 focused Python 测试或等价命令。
- 涉及 app/UI 的改动必须至少运行 lint、typecheck 或 build 中的一项。
- 涉及 `server/**` 或生产部署资产的改动必须通过完整 server 测试、TypeScript build、迁移/
  preflight/restore smoke，并以 `.github/workflows/server-ci.yml` 的托管结果作为广泛发布证据；
  本地通过不能替代尚未运行的 hosted CI。
- 涉及下载、ASR、LLM 或文件导出的改动必须记录失败路径和可恢复行为。

### 面向大量普通用户发布的额外硬门禁

- 权威文字稿、AI 产物、偏好和 task manifest 不得直接截断写入最终路径；单文件原子替换、
  现有任务多文件 transaction recovery、故障注入矩阵和跨语言 journal 契约必须通过。
- 所有受监督 worker 操作必须有 Rust 运行时拥有的固定绝对 deadline；具有闭集进度协议的
  操作还必须有 validated-progress idle deadline。超时必须终止并 reap 匹配的完整进程树。
- watchdog 必须覆盖正常完成、静默、进度后停滞、持续进度仍触发绝对超时、阻塞 stdin、
  structured-result/cancel/timeout race、stale instance 和第二任务启动。
- 超时不得自动重试 LLM 或增加 AI Credits 调用；持久化恢复不得暴露内部 staging/journal/
  rollback 文件或触碰 task root 外路径。
- 可用的 Windows/macOS 环境必须分别记录原子替换/恢复和 watchdog parent-child 清理证据；
  缺失平台记录为未验证残余风险，不得默认通过。
- 发布前必须完成并接受 server 认证/额度并发计划：OTP purpose、attempt、artifact 和 ticket/
  session 必须由语义 Store 事务原子提交；额度必须使用数据库条件更新和唯一 request event，
  并由至少两个独立 Prisma client 连接同一真实临时 SQLite 文件证明不重复、不超额和故障回滚。
- OTP dispatch 必须由数据库原子执行 email + trusted-client-IP 限流；`trustProxy` 只允许文档化
  的 loopback Nginx peer。进程内 Map、单 client `Promise.all` 或 SQLite “通常单 writer”不能
  作为并发通过证据。
- 发布前必须完成并接受 server 生产运维计划：production SMTP/必需 secrets fail closed，结构化
  日志通过 secret-seeded 脱敏测试，live/ready 状态真实，SIGTERM 实际 drain Fastify 并断开
  Prisma，server 专用 CI 通过。
- SQLite 生产变更必须使用已审查 baseline + forward migration，且有 preflight、停机备份、
  checksum/权限/异地留存、隔离 restore、`PRAGMA integrity_check` 和匹配 code/database/config
  回滚证据；`prisma db push` 和只有备份没有恢复演练都不能关闭发布门禁。

## Soft Gates

- 更广范围回归测试。
- 桌面端手动运行检查。
- 依赖或安全扫描。
- 打包验证。
- 模型下载和低资源降级路径验证。

跳过相关软门禁时，在最终说明或 active ExecPlan 中记录原因和残余风险。

## Definition Of Done

1. 请求行为已实现、修复，或明确记录为 out of scope。
2. 所有受影响区域的硬门禁通过。
3. 相关 spec、design doc、security doc、architecture doc、AGENTS map 或 ExecPlan 已同步。
4. 新技术债已记录到 active plan 或 `docs/exec-plans/tech-debt-tracker.md`。
5. 最终交付列出 Passed、Not run 和 Residual risk。
