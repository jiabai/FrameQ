# Project Workflow

<!-- 由 vibe-coding-launcher 生成。 -->

## Purpose

本文件定义 FrameQ 的默认协作流程。目标是让桌面客户端、Python worker、模型管理和 agent_runtime 智能提炼的改动先有可审查意图，再进入实现。

## Mandatory Rule

除非任务是低风险、小范围、无新边界的轻量改动，否则按以下流程推进：

1. Constitution and context
2. Spec
3. Technical plan
4. Task breakdown
5. Implementation and validation

## Constitution

- `AGENTS.md`
- `docs/product-specs/index.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN.md`
- `docs/SECURITY.md`
- `docs/design-docs/core-beliefs.md`
- 相关模块最近的 `AGENTS.md`（如后续创建）

## Spec

当任务改变用户可见行为、新增处理阶段、影响本地文件、模型、LLM 配置、导出格式或打包行为时，在 `docs/product-specs/` 创建或更新 spec。

## Plan

非平凡任务在 `docs/exec-plans/active/` 创建 ExecPlan。计划确认后再实现，执行中持续更新 Progress、Decision Log 和验证记录。

## Lightweight Path

轻量任务可以直接实现，但仍需 inspect、最小验证、必要文档同步和最终验证说明。轻量任务不得改变下载、ASR 或智能提炼的用户可见流程或安全边界。

## File Placement

- 用户意图：`docs/product-specs/`
- 持久设计决策：`docs/design-docs/`
- 外部或供应商参考：`docs/references/`（按需创建）
- 进行中计划：`docs/exec-plans/active/`
- 完成计划：`docs/exec-plans/completed/`
- 技术债：`docs/exec-plans/tech-debt-tracker.md`
