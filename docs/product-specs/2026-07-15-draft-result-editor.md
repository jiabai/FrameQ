# 文字稿结果：可编辑 + 落盘 + 重新生成

## Background

父规格 [`2026-07-12-generate-draft-from-inspiration`](./2026-07-12-generate-draft-from-inspiration.md) 落地后，`生成文字稿` 的结果由 `DraftResultSheet` 以**只读预览**呈现：`workflow.draft` 经 `MarkdownContent`（remark-gfm + rehype-sanitize + skipHtml）渲染，工具区仅「复制（markdown）」+「导出（定位 `ai/draft.md` 文件）」。`ai/draft.md` 由 worker 在生成时一次性写入，前端只读，无写回通道；卡片 ready 后只有「查看结果」，没有「已生成状态下重新生成」的路径。

本规格是父规格的增量，把结果视图升级为**可编辑 + 可落盘 + 可重新生成**：

- 左右分栏：左侧 `textarea` 编辑 markdown 原文，右侧 `MarkdownContent` 实时预览。
- 编辑落盘覆盖本地 `ai/draft.md`（走受约束的本地 tauri 命令，**不上 server**）。
- 「复制」「下载」基于编辑器当前文本（markdown 原文）；「导出（定位文件）」降级保留。
- 「重新生成」：重走首次生成的确认页流程（重选 / 确认种子 + 偏好 + 平台），与第一次逻辑完全一致；编辑过则二次确认。

本能力仍服从桌面端本地优先工作流与父规格的全部边界。与 [`2026-07-15-draft-platform-selection`](./2026-07-15-draft-platform-selection.md) 正交：本规格不改平台链路，平台仍按那份规格的「请求态」处理。

## Goals

- 让用户在查看草稿时就能**就地修改**，而不是只能复制到别处编辑。
- 手改结果**落盘到本地 `ai/draft.md`**，与生成产物同源，后续查看 / 导出 / 复用一致。
- 「复制」「下载」都拿到**编辑后的 markdown 原文**，下载产出独立 `.md` 文件。
- 提供「重新生成」入口，复用首次生成的确认 / 额度 / 隐私纪律，避免用户退回卡片重走全套选择。
- 顺带修复「历史任务看不到草稿」的旧缺口（结果视图按需从盘读）。

## Non-goals

- 不做代码编辑器级体验（不上 CodeMirror / Monaco，无语法高亮 / 行号 / 软换行优化）。
- 不改右侧渲染保真度（复用 `MarkdownContent`：原始 HTML 仍剥离、Mermaid 仍显示为代码块）。
- 不持久化平台、不改平台→文体映射（platform-selection 的请求态不变）。
- 不新增 server 接口或字段（父规格红线：FrameQ server 不存草稿 / 灵感 / 偏好）。
- 不做多版本 / 编辑历史快照（仅 `ai/original/draft.md` 一次性备份，对齐 transcript 编辑器）。
- 不改 draft 生成链路、prompt、agent、额度模型、隐私边界。
- 不把草稿写回 `transcript.txt` 或与官方 transcript 共用容器（父规格 Non-goal 不变）。

## Result Experience（修订父规格同名章节）

`生成文字稿` 结果视图（`DraftResultSheet`）从只读预览升级为**左右分栏编辑器**：

- **左侧**：受控 `textarea`，编辑 markdown 原文。打开时经 `load_draft_detail` 从盘读 `ai/draft.md` 作为初始内容（不再依赖 `workflow.draft` 是否被填充，因而历史任务也能查看 / 编辑）。
- **右侧**：`MarkdownContent` 实时渲染左侧缓冲（与摘要 / 灵感详情渲染一致：GFM、剥离原始 HTML、Mermaid 为代码块）。
- **工具区**：
  - `复制`：编辑器当前文本 → 剪贴板。
  - `下载`：基于编辑器当前文本生成 `.md`（Blob 下载）；文件名取首行 `# 标题`，无标题则 `{taskId}.md`。
  - `导出（定位文件）`：本地有 `taskDir` 时作为次要入口保留，定位 `ai/draft.md`。
  - `重新生成`：见下节。
- **保存语义**：编辑落盘覆盖 `ai/draft.md`，首次编辑前把 AI 原产出一次性备份到 `ai/original/draft.md`（基线 + 恢复点）；后续编辑不再覆盖 original。
- **dirty 一致性**：复制可用编辑器当前文本；`下载` / `导出` 在未保存时提示先保存，避免下载 / 定位到与盘上不一致的内容（对齐 transcript 编辑器决策）。
- **窄屏**：左右分栏退化为上下堆叠。
- 失败态：`ai/draft.md` 缺失 / 读取失败 / 保存失败给出可恢复提示，不崩视图。

## Regeneration

在结果视图新增「重新生成」入口（`workflow.draft` 非空或 `has_draft` 时可用），**逻辑与第一次生成完全一致**——重走确认页，不做静默一键复用：

1. **dirty 拦截**：若 `workflow.draftEdited === true`（用户已手改），弹二次确认「将丢弃当前编辑（含已落盘的 `ai/draft.md`），是否继续？」；取消则不发起调用、不扣额度。
2. **打开 `DraftConfirmationSheet`**（与首次生成同一个确认页）：
   - 种子：预选当前 `draftSeedInsightId`（当次会话）或 `load_draft_detail` 回传的 `draft_seed_insight_id`（历史）。
   - 偏好快照：前端**不携带**（父规格 Architecture Boundary），worker 从 `ai/preference-snapshot.json` 读，与首次一致。
   - 平台：确认页按 platform-selection 规则从档案推导默认，用户可改选。
3. 用户在确认页点「确认」→ 经既有 `retry_insights`（`target="draft"`，带 `insight_id` + `platform`）触发 worker。
4. 复用父规格的确认 / 额度 / 监督 / 取消与 `partial_completed` 降级；每次重生 checkout 扣 1 额度，不论成败不返还（父规格 Quota Consumption 不变）。
5. **重生成功**：`finishInsightRetry(target="draft")` 重置 `workflow.draftEdited = false`，并把 `ai/original/draft.md` 刷新为新 AI 产出（下次编辑的新基线）。

种子失效（如 `启发灵感` 已重生成、id 变化）时，按首次生成纪律要求用户先在 `启发灵感` 重选种子，不静默用错误种子（父规格 `DRAFT_SEED_INVALID` 纪律不变）。

## Data and Storage（增补父规格同名章节）

- 编辑落盘覆盖 `{task_dir}/ai/draft.md`，与 transcript / summary / insights / mindmap 并列、互不覆盖。
- 首次编辑前一次性备份 AI 原产出到 `{task_dir}/ai/original/draft.md`（仅一次，对齐 `transcript/original/`）。
- 任务 manifest 维持父规格的 `draft_path` / `has_draft` / `draft_seed_insight_id`。`draft_preview` 已移除（无消费者、worker 重写会丢失；待需要时再加）。
- 草稿、original 备份、偏好快照均属本地任务产物，**不上传 FrameQ server**。

## Architecture Boundary

- 这是 `AI整理` 结果视图的增量，不是 worker 流水线或 server 职责变更。不改变 `process_video`、stdin 传输、server 权益 / 额度职责、`SourceIdentity`、任务存储或 `ProcessSupervisor` 内部。
- **落盘走本地 tauri 命令** `load_draft_detail` / `save_draft_edit`（`app/src-tauri/src/draft_detail.rs`，照搬 `transcript_detail.rs` 的受约束 IO 边界）。**FrameQ server 不新增保存草稿的接口或字段**（父规格红线不变）。
- 安全校验与 transcript 详情同源：路径穿越（`validate_task_artifact_path`）、软链 / reparse point（`reject_linked_artifact_target`）、隔离 / 旧格式任务（`ensure_task_source_privacy_ready`）、空内容（trim 后为空拒绝）；全部 recoverable，不写半文件。
- 重新生成复用既有 `retry_insights` 的 `target="draft"` 分支（父规格触发方式不变），不新增独立 Tauri 命令；偏好快照仍由 worker 从盘读，前端 draft 请求不重发。
- 类型化状态：前端 `activeAiTarget` 仍为 `"summary" | "insights" | "draft" | null`，新增 `workflow.draftEdited` 仅供 dirty 判定，不影响 target 归属或阶段。
- 平台仍是请求态：重生重走确认页，平台在确认页重新选定（与首次一致），不持久化、不回写档案、不上 server（platform-selection 不变）。

## Validation Rules (new)

- `save_draft_edit` 拒绝空内容（trim 后为空）；拒绝 draft 路径不落在 `{task_dir}/ai/draft.md` 的请求（路径穿越）；拒绝目标或父目录为软链 / reparse point；拒绝未完成 source-privacy 迁移 / quarantined 的任务。以上均 recoverable，不写半文件、不创建 original 备份。
- `ai/original/draft.md` 仅在首次编辑时创建一次；后续编辑不覆盖；重新生成成功后刷新为新 AI 产出。
- 「下载」/「导出」在 `draftEdited === true` 时必须先提示保存；保存成功后清 dirty。
- 重新生成在 `draftEdited === true` 时必须二次确认；取消则不发起 worker 调用、不扣额度。
- 重新生成重走首次确认页；种子 `insight_id` 必须在当前任务 `insights.json` 中存在，失效（如灵感已重生成、id 变化）时要求先在 `启发灵感` 重选种子，不得静默用错误种子（父规格 `DRAFT_SEED_INVALID` 纪律不变）。
- 重新生成仍过配额 / 账号预检；预检未通过不开始、不扣额度（父规格不变）。

## Acceptance Criteria

- `生成文字稿` 结果视图为左右分栏：左侧 `textarea` 可编辑 markdown 原文，右侧 `MarkdownContent` 实时预览；窄屏退化为上下堆叠。
- 打开结果视图时经 `load_draft_detail` 从盘读 `ai/draft.md`；历史任务（`HistoryDetailView` 不含 draft）也能加载并编辑草稿（修复旧缺口）。
- 编辑落盘覆盖 `ai/draft.md`；首次编辑前生成 `ai/original/draft.md` 备份，后续编辑不覆盖 original。
- 「复制」「下载」均基于编辑器当前文本（markdown 原文）；下载产出 `.md` 文件，文件名为首行标题或 `{taskId}.md`。
- 「导出（定位文件）」在本地有 `taskDir` 时作为次要入口保留；dirty 时「下载」/「导出」提示先保存。
- 「重新生成」入口在结果视图可用：重走首次确认页 `DraftConfirmationSheet`（种子预选 + 偏好从盘读 + 平台确认页选定）→ `retry_insights(target="draft")`；与第一次生成逻辑完全一致。
- `draftEdited === true` 时重新生成弹二次确认，取消不发起调用、不扣额度。
- 重新生成过配额 / 账号预检；每次重生 checkout 扣 1 额度、不论成败不返还（父规格额度模型不变）。
- 重新生成成功后 `workflow.draftEdited` 重置为 `false`，`ai/original/draft.md` 刷新为新基线。
- `save_draft_edit` 对空内容、路径穿越、软链目标、隔离 / quarantined 任务均 recoverable 拒绝，不写半文件、不创建 original 备份。
- 父规格全部验收项继续通过；平台请求态、`activeAiTarget` 类型、隐私边界、额度模型不变。
