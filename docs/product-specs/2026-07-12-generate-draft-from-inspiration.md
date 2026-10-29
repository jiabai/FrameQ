# 基于所选灵感的文字稿生成

## Background

`智能提炼` 工作区当前有两张独立 target 卡片：`要点总结（同时生成思维导图文件）` 与 `启发灵感`。`启发灵感` 会从一个已完成任务的文字稿中生成一组结构化 `Insight`（灵感），每条包含议题问句 `topic`、匹配理由 `matchReason`、启发问题 `followUpQuestions`、适合用途 `suitableUse` 和来源片段 `sourceChunkId`。

用户希望把其中**某一条灵感**继续延展成一篇完整、可直接使用的新文字稿（成稿/草稿），并且稿子要能通过联网检索补足事实材料，而不是仅凭灵感问句空写。为此，在 `智能提炼` 工作区新增第三张独立 target 卡片 `生成文字稿`，其 AI 种子来自用户在 `启发灵感` 中选中的**单条** `Insight`。

这项能力仍服务于桌面端本地优先工作流：视频、音频、文字稿、用户偏好与生成结果默认留在本机。用户在 `生成文字稿` 确认页点击 `确认` 后，worker 以所选灵感字段 + 任务局部偏好快照为种子构造草稿 prompt，交由 agent（anysearch 联网检索 + skills + planning + submit_draft 交付契约）生成成稿；agent 生成中可经 anysearch 联网检索补足事实材料并回灌 LLM 上下文，但**不会**上传视频、音频、原文 transcript 片段或 source URL。任务局部偏好快照与可选的要点总结均由 worker 从任务目录读取，前端不在 draft 请求中重发。

## Goals

- 让用户把一条有启发的问题，延展成一篇可直接使用的新文字稿，而不是止步于灵感列表。
- 稿子要能"找到合适信息"再写：经 anysearch 联网检索补足事实材料，而非仅凭灵感问句空写。
- 把 `生成文字稿` 做成与 `要点总结`、`启发灵感` 平级的第三张独立 target 卡片，共享 AI整理 的卡片模板、类型化状态、额度与隐私纪律。
- 以 `启发灵感` 中选中的单条 `Insight` 作为唯一 AI 种子，沿用已有的结构化灵感数据，不要求用户重新填写偏好。
- 严格保持项目的本地优先与隐私边界：不发送原文 transcript 片段、视频、音频或 source URL；草稿的事实 grounding 来自 anysearch 联网检索（可回灌 LLM 上下文）与可选的要点总结（整篇 summary），而非原文片段。
- 复用既有的确认 / 额度 / 错误归属机制，不引入新的隐私或额度漏洞。

## Non-goals

- 本规格仍是未来独立功能；2026-07-15 桌面多语言实施不新增 `draft` target、命令或 artifact，
  只为未来草稿请求规定与其他 AI target 相同的必填 `output_language`。
- 不做"多选灵感合并成一篇文字稿"；种子严格为单条 `Insight`。
- 不做自由文本 prompt 编辑器或"复制灵感 → 粘贴进某页面"的桥接；种子选取是结构化的应用内动作。
- 不把 AI 生成的草稿写回 `transcript.txt` 或复用 transcript artifact，避免污染本地优先的"正式文字稿"概念。
- 不重新收集 6 步生成偏好；草稿复用当初生成该灵感时使用的任务局部偏好快照（由 worker 从盘读，前端不重发）。
- 不改变主流程：视频提取与文字稿生成仍可在不使用 LLM 的情况下完成。
- 不个性化 `要点总结` 或 Mermaid mindmap。
- 不送原文 transcript 片段、视频、音频或 source URL 作为 LLM 输入；`sourceChunkId` 仅作溯源标注。事实 grounding 来自 anysearch 联网检索；要点总结（整篇 summary）作为可选的原视频内容 grounding，缺失则降级为纯联网检索。
- v1 不在确认页新增 anysearch 检索的数据披露行；用户可见数据文案保持现状。

## Product Model

`生成文字稿` 是 `智能提炼` 工作区的第三张独立 target 卡片，遵循与 `要点总结`、`启发灵感` 相同的卡片模板：各自拥有状态、额度/隐私说明、确认/重试/查看动作、进度与错误。

- **种子（seed）**：`启发灵感` 结果中由用户选中的单条 `Insight`。未选种子时，本卡片不可用。
- **生成路线**：经 agent（anysearch 联网检索 + skills + planning + submit_draft）成稿，而非单次 LLM 调用；联网检索是 agent 路线的差异化价值，去掉后 agent 退化为无意义的多轮循环。
- **依赖关系**：`生成文字稿` 依赖 `启发灵感` 已成功生成且存在至少一条 `Insight`，并已选中其中一条。这是两张 target 之间的数据依赖，不改变"每张 target 各自独立确认"的原则。
- **产物命名**：卡片 UI 文案为 `生成文字稿`（用户术语）；底层 AI 产物称为 `草稿 / draft`，以区别于 ASR `transcript.txt`。UI 可在卡片副标题注明"（AI 草稿）"以避免语义混淆。

## Seed Selection

种子选择在 `启发灵感` 卡片内完成，而不是在 `生成文字稿` 卡片内：

1. `启发灵感` 列表的每条灵感提供一个 `选为文字稿种子` 的单选交互（radio 或单按钮）。
2. 选中后，该灵感在 `启发灵感` 列表内高亮为"已选种子"，并同步地、只读地在 `生成文字稿` 卡片显示"种子：灵感 #N — <topic 截断>"。
3. 仅允许选 1 条（单种子）。切换选择即更新种子；提供清除选择的交互。
4. 选择是任务级状态，持久化为任务 manifest 的 `draft_seed_insight_id`，便于结果展示与防止 stale 选择。
5. 当 `启发灵感` 被重新生成（如 `换个方向` 后再次确认）时，旧 `insight_id` 可能失效，必须清空 `draft_seed_insight_id`，并使 `生成文字稿` 回到安静禁用态，要求用户重新选择。

## Generation Flow (生成文字稿 Card)

- **未生成启发灵感 / 启发灵感失败 / 未选种子**：卡片安静禁用，提示"请先在启发灵感中选择一条灵感作为种子"。不消耗额度，不暴露 LLM 入口。
- **已选种子**：主按钮 `确认` 可点。
- 点击 `确认` 打开确认页（**不消耗额度**）。
- 确认页点击最终 `确认` 后，经 `retry_insights` 扩展 `target="draft"` 触发 worker 草稿生成（见 Architecture Boundary）。
- 生成期间：复用 `insights_generating` 阶段，`activeAiTarget` 为 `"draft"`；本地工作区保持可读/可回听，文字稿编辑/保存禁用，提示"AI 正在使用已保存版本"。
- 失败：该卡片显示失败态 + 重试入口；错误 `WorkerError.stage` 为 `JobStage.DRAFT_GENERATING`，仅归因到 `生成文字稿`；若其他 target 成功，整体为 `partial_completed`。

## Confirmation Panel

`生成文字稿` 确认页展示：

- **本次输出语言**：展示确认时解析后的实际 UI locale（简体中文、繁體中文或 English），
  不显示 `system` 字样；点击最终确认时冻结该值。
- **种子摘要**：灵感 #N + `topic` 全文。
- **额度说明**：`1 次额度 = 1 次草稿生成尝试`，不论成败、不返还，重试另计；确认页固定显示 `1 次`（根因见 Quota Consumption）。
- **数据提示**：将把所选灵感的字段（`topic` / `followUpQuestions` / `suitableUse` / `matchReason`）与本次任务局部偏好快照发送给管理员配置的云端 LLM 服务；**不会**上传视频、音频或原文全量；任务局部偏好快照只在草稿生成时参与（由 worker 从任务目录读取，复用当初生成该灵感时的快照），不参与 `要点总结` 或 Mermaid mindmap 生成。
- **操作按钮**：`确认`、`取消`。

用户点击 `确认` 后才触发 worker 的草稿生成流程。v1 不在确认页新增 anysearch 检索披露行（用户明确决定）。

## Quota Consumption

- `1 次额度` 表示 1 次 draft 生成**尝试**，不是 1 次 LLM API 调用。draft 采用 one-checkout 结构：一次确认生成只向 server 发起 1 次 LLM checkout，server 在 checkout 当场 `consumeLlmQuota`（`llmQuotaUsed += 1`，`prismaStore.ts:260` / checkout 端点 `server.ts:439`），**不论该次生成最终成功或失败**。
- 失败、超时、空结果或 seed 失效**不返还**额度：server 无 refund / success-gating 路径，`consumeLlmQuota` 当场扣、无回滚。
- 每次确认生成（含重试）各计 1 次：tauri 每次 `retry_insights` 生成新 `request_id`（`account.rs:376` `format!("llm-{}", Uuid::new_v4().simple())`），不命中 server 的 `(userId, requestId)` 幂等，故重试另计。
- 仅进入确认页或点击 `取消` 不消耗额度（不发起 checkout）；账户或额度预检未通过时草稿生成不开始，也不消耗额度。
- anysearch 联网检索调用**不计入**用户额度（`anysearch/checkout` 不调 `consumeLlmQuota`）；server/LLM 供应商侧成本随 agent 轮数增长（`max_turns` 默认 40），由 FrameQ 承担，靠 `FRAMEQ_DRAFT_MAX_TURNS` env 收紧。
- 草稿生成不隐式扣除 `要点总结` / `启发灵感` / Mermaid mindmap 的额度。

> 撤回早前"1 额度 = 1 LLM 调用 / 按实际调用次数 / 失败不返还 / 不得固定显示 1 次"的额度单位表述：核实 server（`consumeLlmQuota` 当场扣、无 refund）+ tauri（每次新 `request_id`）后，draft 额度模型定为"1 次尝试 = 1 额度，不论成败"，确认页固定显示 1 次。若未来要"失败不计 / 免费重试"，需 server 侧加 success-gating 或 refund 端点（跨 server+worker 改动），记为未来项。

## Result Experience

- 成功：写入底层 artifact `{task_dir}/ai/draft.md`（UI 称"草稿/成文"），与 transcript/summary/insights/mindmap 并列、互不覆盖。
- `生成文字稿` 卡片提供 `查看`、`复制`、`导出（定位文件）` 动作；查看使用经净化的 Markdown 渲染（GitHub Flavored Markdown），不渲染原始 HTML 或 Mermaid 源码。
- 草稿是独立 artifact，不与官方 transcript 共用容器，也不可作为官方 transcript 编辑/导出。
- 失败：卡片展示结构化错误原因、重试入口与可修改入口；重试走同一确认 / 额度流程。

## Draft Artifact Schema

- 文件：`{task_dir}/ai/draft.md`（`TaskPaths.draft_path`）。
- `ProcessResult` 增加 `draft: str` 字段（类比 `summary` / `insights`）；Rust `ProcessVideoResult` 同步增 `draft: String`。
- 任务 manifest 增加 `draft_path` / `has_draft` / `draft_seed_insight_id`，用于历史展示与定位；不复制草稿全文进 manifest。
- UI 详情、复制文本、导出定位均以该 artifact 为准。

## Prompt Strategy

worker 的 `build_draft_from_inspiration_prompt(seed: Insight, preference_snapshot: PreferenceSnapshot | None, output_language, summary: str | None = None) -> str`（位于 `worker/frameq_worker/ai_prompts.py`），构造草稿**种子 prompt** 供 agent 消费（agent 叠加 anysearch 联网检索 + skills + planning + submit_draft 交付契约成稿），并遵守以下规则：

- **输出语言**：`output_language` 必须复用共享的 `zh-CN | zh-TW | en-US` 闭集，使用固定
  enum 派生的语言指令覆盖标题、正文和所有用户可见生成内容；不得把任意 UI 字符串直接拼为指令。
- **输入**：单条 `Insight` 的结构化字段 + 任务局部 `PreferenceSnapshot`（缺失则无个性化降级）+ 可选要点总结 `summary`（整篇，作为原视频内容 grounding；缺失则略过）。不拼接 transcript 片段、视频、音频或 URL。
- **角色**：把一条可迁移的议题问句延展为一篇完整、可直接使用的成稿/文字稿。
- **骨架**：`topic` 作为中央议题 / 标题方向；`followUpQuestions` 作为章节结构 / 子论点展开角度。
- **约束**：`suitableUse` 决定体裁与形态并写入 prompt 作为平台方向；`skills/` 下的平台文体 skill（v1 由 `viral-writer` 覆盖 抖音/小红书/公众号，注意 `公众号` ↔ skill 内 `微信公众号` 名称映射）由 agent 自取加载，后端不做 suitableUse→skill 硬匹配；其余取值（视频号/b站/播客/课程·社群/内部分享）走 LLM 通用兜底。加新平台 = 在 `skills/` 丢 `SKILL.md`，零代码改动。`matchReason` 作为目标感锚点，防止跑题；`PreferenceSnapshot`（goal / scenario / angles / audience / styles / avoid）决定语气、受众、角度与避雷方向。
- **溯源而非输入**：`sourceChunkId` 仅用于向 LLM 说明该灵感的来源片段编号，或用于结果中标注溯源；其对应片段文本**不进入 prompt**。v1 不送原文 transcript 片段；整篇要点总结 summary 是允许的可选 grounding。
- **原创性**：产出应为原创成稿；若草稿引用原文字稿中的具体观点或案例，须显式标注来源，不得伪装为凭空原创。
- **外部引用标注**：草稿引用 anysearch 检索来的事实/案例时，须显式标注来源（v1 依赖 prompt 指令；web 引用结构化模型留待后续）。
- **个性化降级**：当任务局部偏好快照缺失时，按"无档案 / 不指定"处理，不得补任何默认画像、角色、领域或风格。
- 生成内容应主动避开 `avoid` 中声明的方向；`styles` 调整措辞而不改变事实判断。

## Data and Storage

- 草稿 artifact 写入任务目录，与 `transcript`、`summary`、`insights`、`mindmap` 并列，互不覆盖。
- **任务局部偏好快照必须持久化**：草稿复用当初生成该灵感时使用的快照（worker 从 `ai/preference-snapshot.json` 读）。若快照缺失，草稿以无个性化方式生成（不阻断、不伪造画像）。
- **要点总结作为可选 grounding**：worker 从 `ai/summary.md` 读取（前端不发）；缺失则降级为纯联网检索，不阻断。
- 日志、错误文案和诊断信息不得输出完整个人档案、完整生成偏好、完整 prompt、完整 transcript 或草稿全文。
- 草稿与偏好快照均属于本地任务产物，不上传 FrameQ server。

## Architecture Boundary

- 这是 `AI整理` 的信息架构扩展，不是 worker 流水线重写。它不得改变 `process_video`、stdin 传输、server 权益/额度职责、`SourceIdentity`、任务存储或 `ProcessSupervisor` 内部。
- **触发方式**：经 `retry_insights` 扩展 `target="draft"` 触发（`RetryInsightsRequest{ task_id, target="draft", insight_id, preference_snapshot? }`），复用既有确认、额度预检、监督、取消与 `partial_completed` 降级；不新增独立 Tauri 命令。退役独立 CLI `--generate-draft-json` / `generate_draft_once` / `GenerateDraftRequest`（落盘逻辑吸收进 `retry_insights_once` 的 draft 分支）。`retry_insights` 仍是唯一可构造 AI client、接收 server-managed checkout、消耗额度的本地 worker 调用。
- target=draft 的 stdin request 同样必须包含确认时冻结的
  `output_language: "zh-CN" | "zh-TW" | "en-US"`；TypeScript、Rust、Python 拒绝缺失或非法值，
  不允许旧调用默认语言。
- worker 仅接收选中 `insight_id`；由 worker 自行从 `ai/insights.json` 取该 Insight 结构化字段、从 `ai/preference-snapshot.json` 读偏好快照、从 `ai/summary.md` 读可选 summary grounding。前端在 target=draft 请求中**不携带** `preference_snapshot`（避免覆盖当初生成灵感时的快照）。worker 不读取、传递或拼接 transcript 片段、视频、音频或 URL。
- **类型化状态**：前端 `activeAiTarget` 扩展为 `"summary" | "insights" | "draft" | null`；UI 行为不得从状态文案推断 target。底层仍复用 `insights_generating` 阶段，target 归属为 `draft`，错误 target 经 `aiErrorTarget="draft"` 投影。
- 本地进度与 AI target 状态为分离的视图模型投影；AI 生成期间本地投影保持 ready（transcript 可用）。
- `FrameQ server` 仍只负责账号、权益、配额和 LLM+anysearch checkout；server 不接收、不存储灵感、偏好或草稿，不为草稿新增接口或字段。
- LLM supplier 在用户确认后收到灵感字段 + 偏好快照 + agent 生成中经 anysearch 检索回灌的事实材料 + 可选 summary grounding；**不收到** transcript 片段、视频、音频或 URL。确认页用户可见数据文案保持"把所选灵感字段 + 偏好快照发送给云端 LLM；不上传视频/音频/原文全量"，v1 不新增 anysearch 检索披露行（内部边界放宽、确认页文案不变）。
- 两张 target 之间存在数据依赖（草稿依赖启发灵感结果 + 选中），但各自保持独立的状态、确认、额度与错误归属；历史恢复时两工作区共享同一 taskId。

## Validation Rules (new)

- `insight_id` 必须在当前任务 `insights.json` 中存在；不存在（例如 `启发灵感` 已重新生成且编号变化）时，worker 返回 `DRAFT_SEED_INVALID`（或等价明确错误）并要求用户重新选择种子，不得静默使用错误条目，且不消耗草稿 LLM 调用。
- 种子选择随 `启发灵感` 重生成而失效：重生成成功后清空 `draft_seed_insight_id`，`生成文字稿` 回到安静禁用态。
- `生成文字稿` 不得在 `启发灵感` 未生成、生成失败或 `draft_seed_insight_id` 为空时发起任何 worker 调用。
- target=draft 请求中前端不携带 `preference_snapshot`；worker 从 `ai/preference-snapshot.json` 读取，缺失则按无个性化降级，不伪造画像。
- draft 失败的 `WorkerError.stage` 用 `JobStage.DRAFT_GENERATING`，使错误归因到 draft target 而非 insights。
- 成稿生成默认不打印工具参数、工具返回内容、模型回复片段或完整异常转储；异常返回保留
  `DRAFT_GENERATION_FAILED` 与 `draft_generating`，消息固定为 `Draft generation failed.`。
  工具交付、空结果检查及已有产物的失败保护保持有效；hook 与 MCP 清理警告只包含固定事件信息。

## Acceptance Criteria

- `智能提炼` 工作区显示三张独立 target 卡片：`要点总结（同时生成思维导图文件）`、`启发灵感`、`生成文字稿`；三者共享卡片模板、类型化状态、额度与隐私纪律。
- `生成文字稿` 在未生成启发灵感、启发灵感失败或未选种子时安静禁用，提示先选一条灵感；不消耗额度、不暴露 LLM 入口。
- `启发灵感` 列表中每条灵感提供 `选为文字稿种子` 单选；选中后高亮并同步到 `生成文字稿` 卡片显示种子摘要；仅允许选 1 条，可清除。
- `activeAiTarget` 类型扩展为 `"summary" | "insights" | "draft" | null`；UI 不依赖状态文案推断 target。
- `生成文字稿` 确认页展示种子摘要、额度说明（1 次确认生成尝试 = 扣 1 次额度，不论成败不返还，重试另计；agent 多轮规划/写作与 anysearch 检索不另计）与数据提示（只发灵感字段 + 任务局部偏好快照，不上传视频/音频/原文全量；v1 不披露 anysearch）。
- `生成文字稿` 确认页展示实际输出语言；最终确认冻结并发送共享 enum 的
  `output_language`，生成中切换 UI 不改变该请求，重试使用重试确认时的新语言。
- 确认后才触发 worker 调用；每次确认的 checkout 扣 1 次额度，不论成败不返还，重试另计；仅进入确认页或取消不扣；anysearch 检索不计额度。
- 草稿经 agent（anysearch 联网检索 + skills + planning + submit_draft）生成；worker 仅接收 `insight_id`，自行读取 Insight 字段 + 偏好快照 + 可选 summary，不发送 transcript 片段、视频、音频或 URL；`sourceChunkId` 仅作溯源标注，不作为 LLM 输入。
- 草稿写入 `ai/draft.md`；`ProcessResult` 含 `draft`，manifest 含 `draft_path` / `has_draft` / `draft_seed_insight_id`；UI 提供查看/复制/导出，且不与官方 transcript 共用容器。
- 任务局部偏好快照被持久化以支持草稿复用（worker 从盘读，前端 draft 请求不重发）；缺失时草稿以无个性化方式生成，不伪造画像。
- `insight_id` 校验存在，失效返回 `DRAFT_SEED_INVALID` 且不消耗额度；`启发灵感` 重生成后清空种子选择并使 `生成文字稿` 回到禁用态。
- `生成文字稿` 失败仅归因本 target（`JobStage.DRAFT_GENERATING`）；整体 `partial_completed` 时其他 target 的成功产物不受影响。
- `FrameQ server` 不新增保存灵感、偏好或草稿的接口或字段。
