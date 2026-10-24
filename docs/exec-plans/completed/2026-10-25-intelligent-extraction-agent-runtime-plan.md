# 智能提炼 agent_runtime 执行计划

Status: Complete，2026-10-25 完成实现与验收。

## Scope

实现 `docs/product-specs/2026-10-25-intelligent-extraction-agent-runtime.md`：三个智能提炼目标统一使用 agent_runtime，产物与隐私契约继续有效。

## Progress

- [x] 公共能力：`ai_prompts.py`、`transcript_chunks.py`、`ai_artifacts.py`、`insight_errors.py` 和 `ai_runtime.py` 分别维护提示词、分段、保存、错误和调用配置。
- [x] 启发灵感：`topic_agent.py` 通过完整列表工具交付，校验非空文本、1 至 12 条灵感、1 至 3 个追问、唯一话题与真实分段来源。
- [x] 文字稿解剖：`dissection_report.py` 维护 closed schema、UTF-8 字节区间、SHA-256 和逐字引用；`dissection_agent.py` 交付完整报告。
- [x] 编排：各目标直接进入对应 agent；历史合并、偏好保存、事务提交和结构化失败继续有效；失败时保留已有灵感对应的成稿种子。
- [x] 前端：文字稿解剖显示 1 至 6 次调用，最多 16 个分段，每段最多 2000 个字符，确认时需要六次调用额度。
- [x] 删除旧生成目录、客户端、文本 JSON 提取器、固定规划与分批汇总调度；有效源码、测试、打包资源和文档使用当前模块。
- [x] 运行静态检查、完整回归、脚本检查与真实 LLM 冒烟；重新生成资源副本并比较文件集合和字节。

## Decision Log

- 每个 agent 仅开放自己的交付工具；无效交付在同一会话内反馈，完整交付通过后直接结束。
- `StrictInsightRunner` 逐步执行，严格限制 1 至 6 次调用；SDK、provider 和空响应隐式重试关闭。
- 每次实际托管供应商请求独立 checkout，目标名称和调用序号共同构成独立请求标识，避免多个目标使用同一计费标识。
- 空稿、无效语言、调用预算和输出 token 配置先于任何 checkout 校验。供应商错误使用固定公开消息。
- 本地测试直接执行工具、hook、schema 与真实文件事务；完整 agent 循环通过已获用户授权的真实服务与文字稿副本验证。

## Validation

- `uv run ruff check worker`：通过。
- `uv run pytest worker/tests --basetemp=outputs/pytest-agent-runtime-final -p no:cacheprovider -q`：1122 通过、3 跳过。Windows 无 symlink 权限的三个测试跳过；依赖有一个 audioop 弃用警告。
- `npm --prefix app run lint`、`npm --prefix app test -- --run`、`npm --prefix app run build`：通过，83 个文件、859 项测试；构建存在既有大体积 chunk 提示。
- 原子持久化边界与 installer 脚本测试：13 通过。
- `node scripts/verify-packaged-worker.mjs`：打包 worker 副本与规范源码文件集合、字节一致，资源目录没有旧生成目录。
- 真实 LLM 使用任务 `20261023-082928-douyin-7699722528842992905` 的独立副本，三个目标依次 completed；要点总结、启发灵感、文字稿解剖分别扣除 2、1、1 个 AI Credits，产生九条灵感以及六份非空产物。原任务文字稿字节保持一致。
- 真实 LLM 的 `max_turns=1` 总结验证返回 `INSIGHTFLOW_EMPTY_SUMMARY`，只扣除 1 个 AI Credit。两轮验证共使用 5 个 AI Credits。
- `uv run python scripts/validate_agents_docs.py --level ERROR` 与 `--level WARN`：均为 0 错误、0 警告；`git diff --check` 通过。

## Residual Risk

- 未构建原生安装器或执行 macOS 原生运行检查；本次未发布版本。
- LLM 输出语义质量仍取决于供应商；严格结构校验、原文溯源与调用上限已验证。
