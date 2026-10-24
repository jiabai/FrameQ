# 要点总结 agent_runtime 生成规格

## 用户可见行为

- 「智能提炼」的「要点总结」仍在用户确认后独立生成 `ai/summary.md` 与 `ai/mindmap.mmd`，前端命令、产物路径、输出语言、结果合并和失败重试方式不变。
- 生成引擎改为 `agent_runtime` 的 `ToolLoopAgentRunner`。agent 先提交 Mermaid 脑图，再基于原文字稿和已提交脑图提交 Markdown 总结；普通文本回复不能代替交付工具。
- 每次实际云端 LLM 调用仍执行一次服务端 checkout 并扣除一个 AI Credit。agent 为修正无效交付而增加的调用按相同规则计费；打开确认页和取消不扣费。
- 启发灵感与文字稿解剖的 agent 生成契约见 `2026-10-25-intelligent-extraction-agent-runtime.md`；成稿生成和文字稿整理使用各自入口。

## 生成契约

- 正式文字稿路径校验、空稿检查和输出语言校验先于任何 checkout。
- 初始请求使用 `ai_prompts.py` 的 `build_mindmap_prompt`，只提供 `submit_mindmap` 工具。工具拒收空白内容或缺少 `mindmap` 根节点的内容，并允许 agent 在预算内修正后重新提交。
- 脑图通过校验后，运行器追加 `build_summary_prompt`，移除脑图工具并只提供 `submit_summary` 工具。总结沿用既有 Markdown 规范化规则。
- 两个交付物都有效时才算成功。总结有效交付直接结束 agent，避免额外的收尾 LLM 调用；模型提前给出普通回复时，hook 拒绝完成并提示当前必须交付的产物。
- agent 达到步数上限、LLM 调用失败或任一交付物缺失时返回 `partial_completed`，不写入不完整的新产物。
- 产物继续使用 `write_summary_files` 与原子提交，错误码沿用 `INSIGHTFLOW_*`，其中配置缺失、登录失效、额度不足继续映射到既有专用错误码。

## 隐私与边界

- 只向管理员配置的 LLM 服务商发送正式 `transcript/transcript.txt`、生成提示词和本轮生成的脑图；不接入 anysearch、skills、文件读写或网络检索工具。
- 视频、音频、来源 URL、任务清单、用户偏好和其他本地文件不进入提示词。
- 服务端只收到既有 checkout 请求，不接收文字稿、脑图、总结或 agent 运行记录。

## 验收

- 直接执行真实工具与 hook 验证交付顺序、产物与语言规范化；真实 LLM 冒烟验证完整 agent 循环和逐调用计费。
- 覆盖无效脑图重试、提前普通回复、agent 错误、缺失交付物、服务端逐调用 checkout 及失败错误码。
- 既有 summary 重试、产物合并、原子写入、输出语言和其他 AI target 测试保持通过；worker 全量 pytest 与 ruff 通过。
