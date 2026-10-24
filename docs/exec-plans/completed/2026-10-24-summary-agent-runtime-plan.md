# 要点总结 agent_runtime 执行计划

Status: Complete，2026-10-25 完成当前实现验收。

## Scope

`retry_insights(target="summary")` 通过 `summary_agent.py` 的 agent 工具循环顺序交付脑图与总结，保留前端命令、语言、产物和原子提交契约。规格见 `docs/product-specs/2026-10-24-summary-agent-runtime.md`。

## Progress

- [x] `submit_mindmap` 通过校验后，hook 添加基于原文与脑图的总结指令，开放 `submit_summary`。
- [x] 两个有效交付物完成任务；无效参数与提前普通回复通过工具或 hook 反馈处理。
- [x] `write_summary_files` 规范化并提供事务提交所需字节。
- [x] `ai_runtime.py` 提供逐次 checkout、严格调用预算、固定错误映射与凭证关闭。
- [x] 工具、语言、编排、产物测试和真实 LLM 验证通过。

## Decision Log

- 有效总结工具直接完成运行，正常生成需要两次 LLM 调用。
- `StrictInsightRunner` 逐步执行，输入预算必须为 1 至 6 的整数。SDK、provider 和空响应隐式重试均关闭。
- 托管配置在调用前校验，每次供应商请求独立 checkout；请求标识包含目标名称和调用序号。
- 共用模块与其他智能提炼目标的验收见 `2026-10-25-intelligent-extraction-agent-runtime-plan.md`。

## Validation

- ruff 通过；worker 全量 1122 通过、3 跳过；前端 859 通过，lint/build 通过。
- 用户授权的真实任务副本生成成功，summary 扣除 2 个 AI Credits，产出 `ai/summary.md` 和 `ai/mindmap.mmd`。
- 真实 LLM 设置 `max_turns=1` 后返回 `INSIGHTFLOW_EMPTY_SUMMARY`，恰好扣除 1 个 AI Credit；原任务文字稿原字节保持一致。
- 原生安装器构建与 macOS 运行未执行；本次未发布版本。
