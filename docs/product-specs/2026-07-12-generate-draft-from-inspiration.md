# 基于所选灵感的文字稿生成（AI整理 第三 Target）

## Background

`AI整理` 工作区当前有两张独立 target 卡片：`要点总结（同时生成思维导图文件）` 与 `启发灵感`。`启发灵感` 会从一个已完成任务的文字稿中生成一组结构化 `Insight`（灵感），每条包含议题问句 `topic`、匹配理由 `matchReason`、启发问题 `followUpQuestions`、适合用途 `suitableUse` 和来源片段 `sourceChunkId`。

用户希望把其中**某一条灵感**继续延展成一篇完整、可直接使用的新文字稿（成稿/草稿）。为此，在 `AI整理` 工作区新增第三张独立 target 卡片 `生成文字稿`，其 AI 输入提示词来自用户在 `启发灵感` 中选中的**单条** `Insight`。

这项能力仍服务于桌面端本地优先工作流：视频、音频、文字稿、用户偏好与生成结果默认留在本机。只有当用户在 `生成文字稿` 确认页点击 `确认` 时，worker 才会把所选灵感的字段与本次任务局部偏好快照发送给管理员配置的云端 LLM 服务；**不会**上传视频、音频、原文全量或 source URL。

## Goals

- 让用户把一条有启发的问题，延展成一篇可直接使用的新文字稿，而不是止步于灵感列表。
- 把 `生成文字稿` 做成与 `要点总结`、`启发灵感` 平级的第三张独立 target 卡片，共享 AI整理 的卡片模板、类型化状态、额度与隐私纪律。
- 以 `启发灵感` 中选中的单条 `Insight` 作为唯一 AI 种子，沿用已有的结构化灵感数据，不要求用户重新填写偏好。
- 严格保持项目的本地优先与隐私边界：只发送灵感字段 + 任务局部偏好快照，不发送 transcript 片段、视频、音频或 URL。
- 复用既有的确认 / 额度 / 错误归属机制，不引入新的隐私或额度漏洞。

## Non-goals

- 不做"多选灵感合并成一篇文字稿"；种子严格为单条 `Insight`。
- 不做自由文本 prompt 编辑器或"复制灵感 → 粘贴进某页面"的桥接；种子选取是结构化的应用内动作。
- 不把 AI 生成的草稿写回 `transcript.txt` 或复用 transcript artifact，避免污染本地优先的"正式文字稿"概念。
- 不重新收集 6 步生成偏好；草稿复用当初生成该灵感时使用的任务局部偏好快照。
- 不改变主流程：视频提取与文字稿生成仍可在不使用 LLM 的情况下完成。
- 不个性化 `要点总结` 或 Mermaid mindmap。
- 不在 v1 把原文字稿片段作为 LLM 输入（grounding）；`sourceChunkId` 仅作溯源标注。

## Product Model

`生成文字稿` 是 `AI整理` 工作区的第三张独立 target 卡片，遵循与 `要点总结`、`启发灵感` 相同的卡片模板：各自拥有状态、额度/隐私说明、确认/重试/查看动作、进度与错误。

- **种子（seed）**：`启发灵感` 结果中由用户选中的单条 `Insight`。未选种子时，本卡片不可用。
- **依赖关系**：`生成文字稿` 依赖 `启发灵感` 已成功生成且存在至少一条 `Insight`，并已选中其中一条。这是两张 target 之间的数据依赖，不改变"每张 target 各自独立确认"的原则。
- **产物命名**：卡片 UI 文案为 `生成文字稿`（用户术语）；底层 AI 产物称为 `草稿 / draft`，以区别于 ASR `transcript.txt`。UI 可在卡片副标题注明"（AI 草稿）"以避免语义混淆。

## Seed Selection

种子选择在 `启发灵感` 卡片内完成，而不是在 `生成文字稿` 卡片内：

1. `启发灵感` 列表的每条灵感提供一个 `选为文字稿种子` 的单选交互（radio 或单按钮）。
2. 选中后，该灵感在 `启发灵感` 列表内高亮为"已选种子"，并同步地、只读地在 `生成文字稿` 卡片显示"种子：灵感 #N — <topic 截断>"。
3. 仅允许选 1 条（单种子）。切换选择即更新种子；提供清除选择的交互。
4. 选择是任务级状态。建议持久化为任务 manifest 的 `draft_seed_insight_id`，便于结果展示与防止 stale 选择。
5. 当 `启发灵感` 被重新生成（如 `换个方向` 后再次确认）时，旧 `insight_id` 可能失效，必须清空 `draft_seed_insight_id`，并使 `生成文字稿` 回到安静禁用态，要求用户重新选择。

## Generation Flow (生成文字稿 Card)

- **未生成启发灵感 / 启发灵感失败 / 未选种子**：卡片安静禁用，提示"请先在启发灵感中选择一条灵感作为种子"。不消耗额度，不暴露 LLM 入口。
- **已选种子**：主按钮 `确认` 可点。
- 点击 `确认` 打开确认页（**不消耗额度**）。
- 确认页点击最终 `确认` 后，触发 worker 的新 AI 命令（见 Architecture Boundary）。
- 生成期间：复用 `insights_generating` 阶段，`activeAiTarget` 为 `"draft"`；本地工作区保持可读/可回听，文字稿编辑/保存禁用，提示"AI 正在使用已保存版本"。
- 失败：该卡片显示失败态 + 重试入口；若其他 target 成功，整体为 `partial_completed`，错误仅归因到 `生成文字稿`。

## Confirmation Panel

`生成文字稿` 确认页展示：

- **种子摘要**：灵感 #N + `topic` 全文。
- **额度说明**：`1 次额度 = 1 次云端 LLM API 调用尝试`；确认页不得固定显示为 `1 次`，应说明本次生成会按实际 LLM 调用次数扣除。
- **数据提示**：将把所选灵感的字段（`topic` / `followUpQuestions` / `suitableUse` / `matchReason`）与本次任务局部偏好快照发送给管理员配置的云端 LLM 服务；**不会**上传视频、音频或原文全量；偏好快照只随 `生成文字稿` 请求发送，不随 `要点总结` 或 Mermaid mindmap 请求发送。
- **操作按钮**：`确认`、`取消`。

用户点击 `确认` 后才触发 worker 的草稿生成流程。

## Quota Consumption

- `1 次额度` 表示 FrameQ 向云端 LLM 发起 1 次 chat-completion/API 调用尝试。
- 用户在确认页点击 `确认` 后，草稿生成按实际 LLM API 调用次数消耗额度；它不隐式生成或扣除 `要点总结` / `启发灵感` / Mermaid mindmap 的调用。
- 每次 LLM API 调用尝试在发起前或发起时扣除 1 次额度；该次调用失败、超时、返回不可解析或最终导致草稿部分失败时，对应额度不自动返还。
- 仅进入确认页或点击 `取消` 不消耗额度。
- 如果账户或额度预检未通过，草稿生成不会开始，也不消耗额度。

## Result Experience

- 成功：写入底层 artifact `{task_dir}/{stem}_draft.md`（UI 称"草稿/成文"）。
- `生成文字稿` 卡片提供 `查看`、`复制`、`导出（定位文件）` 动作；查看使用经净化的 Markdown 渲染（GitHub Flavored Markdown），不渲染原始 HTML 或 Mermaid 源码。
- 草稿是独立 artifact，不与官方 transcript 共用容器，也不可作为官方 transcript 编辑/导出。
- 失败：卡片展示结构化错误原因、重试入口与可修改入口；重试走同一确认 / 额度流程。

## Draft Artifact Schema

- 文件：`{task_dir}/{stem}_draft.md`。
- `ProcessResult` 增加 `draft: str` 字段（类比 `summary` / `insights`）。
- 任务 manifest 增加 `draft_path` 与 `has_draft`，用于历史展示与定位；不复制草稿全文进 manifest。
- UI 详情、复制文本、导出定位均以该 artifact 为准。

## Prompt Strategy

worker 生成草稿时应新增 `build_draft_from_inspiration_prompt(seed: Insight, preference_snapshot)`（位于 `worker/frameq_worker/insightflow/prompt.py`），类比 `build_summary_prompt`，并遵守以下规则：

- **输入**：单条 `Insight` 的结构化字段 + 任务局部 `PreferenceSnapshot`。不拼接 transcript 片段、视频、音频或 URL。
- **角色**：把一条可迁移的议题问句延展为一篇完整、可直接使用的成稿/文字稿。
- **骨架**：`topic` 作为中央议题 / 标题方向；`followUpQuestions` 作为章节结构 / 子论点展开角度。
- **约束**：`suitableUse` 决定体裁与形态（如短视频脚本、图文、团队分享稿）；`matchReason` 作为目标感锚点，防止跑题；`PreferenceSnapshot`（goal / scenario / angles / audience / styles / avoid）决定语气、受众、角度与避雷方向。
- **溯源而非输入**：`sourceChunkId` 仅用于向 LLM 说明该灵感的来源片段编号，或用于结果中标注溯源；**不作为 LLM 内容输入**。v1 不把原文字稿文本送入草稿 prompt。
- **原创性**：产出应为原创成稿；若草稿引用原文字稿中的具体观点或案例，须显式标注来源，不得伪装为凭空原创。
- **个性化降级**：当任务局部偏好快照缺失时，按"无档案 / 不指定"处理，不得补任何默认画像、角色、领域或风格。
- 生成内容应主动避开 `avoid` 中声明的方向；`styles` 调整措辞而不改变事实判断。

## Data and Storage

- 草稿 artifact 写入任务目录，与 `transcript`、`summary`、`insights`、`mindmap` 并列，互不覆盖。
- **任务局部偏好快照必须持久化**：草稿复用当初生成该灵感时使用的快照。若快照缺失，草稿以无个性化方式生成（不阻断、不伪造画像）。
- 日志、错误文案和诊断信息不得输出完整个人档案、完整生成偏好、完整 prompt、完整 transcript 或草稿全文。
- 草稿与偏好快照均属于本地任务产物，不上传 FrameQ server。

## Architecture Boundary

- 这是 `AI整理` 的信息架构扩展，不是 worker 流水线重写。它不得改变 `process_video`、stdin 传输、server 权益/额度职责、`SourceIdentity`、任务存储或 `ProcessSupervisor` 内部。
- **唯一新增 AI 命令**：`generate_draft_from_insight(task_id, insight_id)`（或由 `retry_insights` 扩展 `target="draft"`）。只有该命令可接收 server-managed checkout 配置、消耗额度、构造 AI client 并调用 LLM。
- worker 仅接收选中 `Insight` 的结构化字段 + 任务局部偏好快照；不读取、传递或拼接 transcript 片段（除非未来显式开启 grounding 并经用户确认）。
- **类型化状态**：前端 `activeAiTarget` 扩展为 `"summary" | "insights" | "draft" | null`；UI 行为不得从状态文案推断 target。底层仍复用 `insights_generating` 阶段，target 归属为 `draft`。
- 本地进度与 AI target 状态为分离的视图模型投影；AI 生成期间本地投影保持 ready（transcript 可用）。
- `FrameQ server` 仍只负责账号、权益、配额和 LLM checkout；server 不接收、不存储灵感、偏好或草稿。
- LLM supplier 在用户确认后仅收到灵感字段 + 偏好快照；确认页必须明确提示。
- 两张 target 之间存在数据依赖（草稿依赖启发灵感结果 + 选中），但各自保持独立的状态、确认、额度与错误归属；历史恢复时两工作区共享同一 taskId。

## Validation Rules (new)

- `insight_id` 必须在当前任务 `insights.json` 中存在；不存在（例如 `启发灵感` 已重新生成且编号变化）时，返回明确错误并要求用户重新选择种子，不得静默使用错误条目。
- 种子选择随 `启发灵感` 重生成而失效：重生成成功后清空 `draft_seed_insight_id`，`生成文字稿` 回到安静禁用态。
- `生成文字稿` 不得在 `启发灵感` 未生成、生成失败或 `draft_seed_insight_id` 为空时发起任何 worker 调用。

## Acceptance Criteria

- `AI整理` 工作区显示三张独立 target 卡片：`要点总结（同时生成思维导图文件）`、`启发灵感`、`生成文字稿`；三者共享卡片模板、类型化状态、额度与隐私纪律。
- `生成文字稿` 在未生成启发灵感、启发灵感失败或未选种子时安静禁用，提示先选一条灵感；不消耗额度、不暴露 LLM 入口。
- `启发灵感` 列表中每条灵感提供 `选为文字稿种子` 单选；选中后高亮并同步到 `生成文字稿` 卡片显示种子摘要；仅允许选 1 条，可清除。
- `activeAiTarget` 类型扩展为 `"summary" | "insights" | "draft" | null`；UI 不依赖状态文案推断 target。
- `生成文字稿` 确认页展示种子摘要、额度说明（1 次额度 = 1 次 LLM 调用尝试，按实际调用扣除）与数据提示（只发灵感字段 + 任务局部偏好快照，不上传视频/音频/原文全量）。
- 确认后才触发 worker 新命令；草稿生成按实际 LLM 调用次数扣除额度；失败/超时/不可解析不返还；取消不扣。
- worker 仅接收选中 `Insight` 结构化字段 + 任务局部偏好快照；不发送 transcript 片段、视频、音频或 URL；`sourceChunkId` 仅作溯源标注，不作为 LLM 输入。
- 草稿写入 `{stem}_draft.md`；`ProcessResult` 含 `draft`，manifest 含 `draft_path` / `has_draft`；UI 提供查看/复制/导出，且不与官方 transcript 共用容器。
- 任务局部偏好快照被持久化以支持草稿复用；缺失时草稿以无个性化方式生成，不伪造画像。
- `insight_id` 校验存在；`启发灵感` 重生成后清空种子选择并使 `生成文字稿` 回到禁用态。
- `生成文字稿` 失败仅归因本 target；整体 `partial_completed` 时其他 target 的成功产物不受影响。
- `FrameQ server` 不新增保存灵感、偏好或草稿的接口或字段。
