# Exec Plans

<!-- 由 vibe-coding-launcher 生成。 -->

## Purpose

Exec plans capture task-specific implementation intent, progress, and recovery context.

## Entry Points

- Active plans: `active/index.md`
- Completed plans: `completed/index.md`
- Shared debt list: `tech-debt-tracker.md`

## Rules

- Keep active work in `active/`.
- Move completed work to `completed/`.
- Capture cross-cutting debt in `tech-debt-tracker.md`.

## Required Sections

每个 ExecPlan 在 `active/` 创建时必须包含以下章节。完成后归档到 `completed/` 时同样保留全部章节并补齐验证结果；`WORKFLOW.md` 与 `docs/EXECUTION_GATES.md` 把 `Progress`、`Decision Log`、验证记录列为硬门禁，缺一不可。完整参考范例见 `completed/2026-06-21-account-billing-plan.md` 与 `completed/2026-06-16-mvp-desktop-client-plan.md`。

1. **Title + Living-document notice**

   文件以 `# <计划名> Plan` 开头，紧跟一段固定提示：

   > This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

2. **Purpose / Big Picture**

   用户视角的一段话，说明这次改动让用户看到什么、不看到什么，以及对本地优先、安全边界的影响。

3. **Progress**

   一组按日期排序的 `[x] YYYY-MM-DD: ...` 条目，每条在句末以 `Validation: <命令或证据>` 收尾。条目粒度足以让审阅者按行追溯「什么时候、改了什么、怎么验证的」。

4. **Surprises & Discoveries**

   多个 `Evidence: ...` 段落，记录实现期间发现的事实、边界、依赖或环境约束。每条都要可回溯到代码路径、日志、配置或外部链接。

5. **Decision Log**

   多条 `Decision: ... Rationale: ... Date/Author: ...`。Decision 描述做了什么、Rationale 解释为什么这么做、Date/Author 给出日期和负责方（常用 `Codex` 或 `User + Codex`）。

6. **Outcomes & Retrospective**

   一段总结，说明端到端交付了哪些用户可见行为、跑了哪些验证命令、并显式记录残余风险（`Residual risk: ...`）。已完成命令的具体输出回填到该段或单独 `Results` 小节。

7. **Context and Orientation**

   用 bullet 列出关键文件路径（按模块分组：spec / server / app / worker / Rust / docs），帮助恢复上下文时直接定位到代码。

8. **Plan of Work**

   编号步骤，每步可包含子项。完成归档时按已实现情况打勾或保留为执行时的施工蓝图。

9. **Validation and Acceptance**

   列出可重复运行的命令（如 `npm --prefix server test`、`cargo test --manifest-path app/src-tauri/Cargo.toml`、`uv run pytest worker\tests`、`python scripts/validate_agents_docs.py --level WARN`）以及一条人工回归步骤。

## Lifecycle

1. 在 `active/` 起草，命名 `YYYY-MM-DD-<kebab-case-scope>-plan.md`，并在 `active/index.md` 注册。
2. 实现期间持续更新 `Progress`（每完成一项加一行带日期和验证）与 `Decision Log`（每次重要取舍加一条）。
3. 全部硬门禁通过后，把文件移到 `completed/`、`active/index.md` 移除条目、`completed/index.md` 追加条目，并补齐 `Outcomes & Retrospective` 的验证结果与残余风险。
4. 跨模块的债务同步到 `tech-debt-tracker.md`，不要只藏在单个计划里。

## Common Pitfalls

- 把 `Progress` 写成无日期的简单 checkbox 列表——失去时序与证据可追溯性。
- `Surprises & Discoveries` 用「我觉得」「似乎」开头——每条都必须有可验证的 `Evidence:`。
- `Decision Log` 漏掉 `Rationale` 或 `Date/Author`——后续接手者无法判断取舍来源。
- 完成后不补 `Outcomes & Retrospective` 的验证输出与残余风险——归档模板硬性要求。
- 跨多模块的债务只写在单个计划里——必须同步进 `tech-debt-tracker.md`。
