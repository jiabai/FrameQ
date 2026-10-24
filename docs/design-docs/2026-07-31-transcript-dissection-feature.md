# 文字稿解剖（Transcript Dissection）功能设计

**Date:** 2026-07-31
**Updated:** 2026-10-25
**Status:** Implemented
**Owner modules:** `dissection_agent.py`、`dissection_report.py`、`pipeline_runtime/dissection.py`

## 输入与命令边界

`智能提炼` 工作区通过 `retry_insights(target="dissection")` 生成文字稿解剖。用户在确认页
最终确认后，worker 从受验证任务中读取固定正式文件 `transcript/transcript.txt`，冻结原始
UTF-8 字节和输出语言。请求只传任务标识，不接收文字稿正文或本地文件路径。

- 任务必须受当前 manifest schema 支持，正式文字稿必须路径合法、已保存且非空。
- 路径校验拒绝符号链接、junction、其他任务的文件和同名替代文件；缺失、空稿或非法输入
  在任何 LLM checkout 前失败。
- `completed` 和 `partial_completed` 的受支持任务均可使用。legacy、quarantined 和不完整
  任务保持现有读取边界。
- 解剖只依赖正式文字稿。该请求拒绝偏好快照，不读取视频、音频、source URL、summary、
  insights 或 draft。
- 主流程继续独立完成下载、ASR 和文字稿保存。解剖独立确认、独立归属错误，同一时刻只有
  一个 AI target；生成期间文字稿可读、可回听，编辑和保存禁用。

## agent_runtime 执行

`transcript_chunks.MarkdownSplitter` 按最多 2,000 个字符生成确定性输入片段。每个片段保留
原文字节范围和 SHA-256，拼接后完整重建正式文字稿。最多接受 16 个片段；超限输入在建立
provider 和 checkout 前返回 `DISSECTION_TRANSCRIPT_TOO_LARGE`。

`dissection_agent.generate_dissection_via_agent_runtime` 使用 `ToolLoopAgentRunner` 运行一个
解剖 agent。`ai_prompts.build_dissection_agent_prompt` 提供全部受支持文字稿片段、合法片段
ID、完整语义 schema、输出语言和分析要求。agent 只获得 `submit_dissection` 交付工具，
没有文件、网络、检索、skills 或自由执行工具。

`submit_dissection(report)` 调用 `dissection_report.parse_dissection_report`：

1. 验证完整闭合结构、字段类型、枚举和集合上限。
2. 验证每个主题段引用的片段 ID 非空、升序、去重且属于本次输入。
3. 验证每条亮点为正式文字稿的逐字子串。
4. 由 worker 补入全文和片段溯源字段。

无效交付返回固定验证类别（结构、片段引用、原文引用、集合上限或枚举），agent 可结合原文
继续修改并提交。普通文本回复不能完成生成。有效交付返回直接结束信号，避免额外的收尾
LLM 调用。整个运行最多六次调用；用尽次数仍无有效报告时返回 `DISSECTION_INVALID_RESULT`。

## 调用预算与计费

- 共享契约使用 agent 调用计划：支持的非空输入统一展示预计 `1–6` 次、硬上限六次。
- 前端确认前预检 16 个片段上限和六次额度；剩余额度不足六次时不启动 worker。
- worker 重算输入边界并限制最多六轮，`max_turns` 只能为 1 到 6 的整数。
- `ai_runtime.ServerManagedInsightProvider` 在每次实际 `text_chat` 前独立 checkout，使用
  派生的 `-call-NNNN` 请求标识保持幂等计费，每次实际调用消费一个 AI Credit。
- checkout 未成功不扣额度；checkout 成功后供应商失败、超时、无效交付或取消，对应扣减
  不返还。尚未开始的调用不扣费。
- 每次 agent LLM 调用前发出 `ai.generation.running`，只有 `attempt`、`total` 和受限
  阶段进度。供应商阻塞时不发送定时心跳；进度可刷新 30 分钟 idle deadline，固定
  90 分钟 absolute deadline 继续生效。

## 权威报告 schema

`TranscriptDissection` 为唯一报告模型，`schemaVersion` 固定为 1。所有嵌套对象保持闭合，
字符串非空且最多 4,000 个字符，拒绝脚本或 `javascript:` 内容。

| 字段 | 结构与约束 |
| --- | --- |
| `sourceTranscriptSha256` | 正式文字稿原始 UTF-8 字节的 SHA-256，由 worker 计算 |
| `sourceLanguage` | 可信 transcript metadata 中的语言，未知时为 `null` |
| `sourceChunks` | `id`、`startByte`、`endByte`、`sha256`；完整覆盖正式文字稿，不存正文 |
| `overallNarrative` | `openingHook`、`structureType`、`turningPoint`、`closingType`；只有 `structureType` 必填非空，其余允许 `null` |
| `segments` | 非空数组；每项 `id` 从 1 连续递增，包含 `title`、`sourceChunkIds`、`coreClaim`、`supportingPoints`、`rhetoricalDevices`、`rhythmNote`、`reusablePattern`、`riskFlags` |
| `highlights` | 最多八条逐字原文摘录，保留原文语言与标点 |
| `reusableTemplate` | `name` 和包含三至七个步骤的 `skeleton` |
| `audienceFit` | 每项包含 `audience`、`fit`、`note`；`fit` 为 `high`、`medium`、`low` |
| `strengths`、`weaknesses` | 各最多六条，基于正式文字稿 |

主题段表达语义主题，可以引用多个输入片段。输入片段 ID 独立于 ASR segment ID。内容分析
覆盖叙事推进、核心论点、支撑点、表达手法及效果、文字信息节奏、结构复用、受众适配和
克制的风险提示。风险提示只指出需核实或可能争议的内容，不声称完成事实核验。

`reusablePattern` 说明必须保留的结构作用、可替换槽位、可选节点、适用内容类型与不适用
条件。`reusableTemplate.skeleton` 使用冻结输出语言的可替换槽位，并标记必要和可选步骤。
段级迁移限制写入 `riskFlags`，全局适用限制和身份、证据依赖写入 `weaknesses`。不得虚构
产品、受众、效果或案例，不分析画面、运镜、音色、语速、剪辑、音乐、字幕、设备或转化率。

## 产物与原子提交

`dissection_report.build_dissection_artifacts` 构造固定产物 `ai/dissection.json` 和
`ai/dissection.md` 的字节内容，不直接修改 manifest。`worker_application/insight_retry.py`
合并既有结果，统一交给 `TaskStoreFacade.finalize`，由现有任务 transaction journal 一并
提交 JSON、Markdown 与 `frameq-task.json`。任何失败不得暴露半套新版本。

manifest 只登记 `artifacts.dissection` 和 `artifacts.dissection_md`。JSON 为权威报告，
不添加平行的 `has_dissection` 或路径状态。解剖不覆盖正式文字稿或其他 AI 产物；失败、
取消或重试保留既有成功版本。

`format_dissection_markdown` 完整导出所有用户可见字段：叙事结构、每段核心论点、支撑点、
表达手法、节奏、可复用模式、风险、引用 ID，以及骨架、亮点、受众适配、优势和不足。
空数组和缺失可选字段可省略。标签支持 `zh-CN | zh-TW | en-US`，适配度使用对应语言。
Markdown 不包含内部 schema、hash、字节范围、路径、prompt 或额外文字稿副本。

## 查看、过时检测与原文定位

卡片未生成时提供确认或重试，已有报告时提供查看；复制、定位 Markdown 与重新解剖由
详情页提供。UI 按 `要点总结 → 文字稿解剖 → 启发灵感 → 生成文字稿` 排列。

每次查看或历史恢复时重新比较当前正式文字稿 SHA-256。摘要不一致即显示过时提示并禁用
原文定位；旧报告继续可读，重新解剖需要再次确认。定位前还须验证片段 UTF-8 byte range、
片段 SHA-256 和任务一致性。只定位同任务受验证片段，不把 chunk ID 当作 ASR segment ID。

报告通过结构化 UI 或经过净化的 GFM 展示。输出语言冻结为确认时的
`zh-CN | zh-TW | en-US`；生成期间 UI 语言变化不改变该次请求，重试重新冻结语言。

## 隐私、失败与恢复

FrameQ server 只接收账号、额度与 checkout 元数据。用户确认后，管理员配置的 LLM 供应商
收到解剖需要的正式文字稿内容，单次请求可能包含全文；agent 后续轮次包含原文上下文、
本轮交付和验证反馈。确认页必须如实告知该范围。

视频、音频、source URL、偏好、本地路径、其他任务或其他 AI 产物不进入提示词。日志、
错误、进度、诊断和 telemetry 不包含完整文字稿、prompt、报告或密钥。worker 不跨目录
依赖 server 实现。

| 失败条件 | 行为 |
| --- | --- |
| 非法、缺失、空白或超限文字稿 | checkout 前失败，保留旧产物 |
| 登录、配置或额度校验失败 | 映射既有专用错误码，保留旧产物 |
| 供应商失败、超时或阻断 | 本 target 返回部分完成，不自动增加调用 |
| 无效报告或引用 | 工具提供验证反馈；六次内仍未交付则失败，不钳制或静默丢段 |
| 用户取消或 watchdog 超时 | 终止当前 worker 进程树，保留旧完整版本与已发生扣减 |
| 产物提交失败 | 任务 journal 恢复旧完整版本 |
| 应用重启 | 从受验证 manifest 恢复，并重新校验报告与过时状态 |

## 验证

- 真实工具 handler 和 hook 测试覆盖接受、拒绝、反馈后重新提交、提前回复及进度协议。
- 纯函数测试覆盖完整 schema、语言、原文逐字引用、UTF-8 溯源、过时完整性和 Markdown 导出。
- 输入边界和 pipeline 测试证明 checkout 前阻断与失败时旧产物保留。
- 真实供应商验证 agent 工具循环、逐调用 checkout 与完整任务原子提交；任务事务回归覆盖
  新 JSON、Markdown 与 manifest 的完整提交和中断恢复。

## References

- `docs/product-specs/2026-07-31-transcript-dissection.md`
- `docs/product-specs/2026-10-25-intelligent-extraction-agent-runtime.md`
- `docs/product-specs/2026-07-11-local-transcript-ai-workspaces.md`
- `docs/product-specs/2026-07-15-desktop-i18n-ai-output-language.md`
- `docs/product-specs/2026-07-22-release-reliability-hardening.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
