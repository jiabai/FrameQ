# Draft Result Editor ExecPlan

## Purpose

把 `生成文字稿` 的结果视图从**只读预览**改造为**左右分栏可编辑器**：左侧 `textarea` 编辑 markdown 原文、右侧 `MarkdownContent` 实时预览；编辑落盘覆盖本地 `ai/draft.md`（不走 server）；「复制 / 下载」基于编辑器当前文本，「导出（定位文件）」降级保留；新增「重新生成」入口（重走首次确认页流程，与第一次逻辑完全一致；编辑过则二次确认）。

本地优先特性：不新增 server 接口、不上传草稿、不暴露任意文件读写，落盘走与 transcript 详情同源的受约束 tauri 命令。

设计依据：[`design-docs/2026-07-15-draft-result-editor.md`](../../design-docs/2026-07-15-draft-result-editor.md)。产品规格：[`product-specs/2026-07-15-draft-result-editor.md`](../../product-specs/2026-07-15-draft-result-editor.md)。父规格：[`product-specs/2026-07-12-generate-draft-from-inspiration.md`](../../product-specs/2026-07-12-generate-draft-from-inspiration.md)。

## Progress

- [x] 2026-07-15：完成五问盘问 + Path A 代码验证，锁定决策；design / spec / plan 三份文档落地。
- [ ] tauri：`load_draft_detail` / `save_draft_edit` 命令（照搬 `transcript_detail.rs` 安全模式）。
- [ ] 前端：`DraftResultSheet` 改造为左右分栏编辑器 + 工具区。
- [ ] 前端：`workflowState` 加 `draftEdited` + 重生 dirty 重置。
- [ ] 前端：重新生成接线（编辑过二次确认 → 重走首次确认页）。
- [ ] 各层验证命令通过或残留风险记录。

## Surprises

- 2026-07-15：`HistoryDetailView`（`app/src-tauri/src/history.rs:44`）既不带 `draft` 也不带 `draft_seed_insight_id`——从历史重开任务时 `workflow.draft` 为空，**当前历史里根本看不到草稿**。解法：编辑器打开时按需 `load_draft_detail` 从盘读，顺带修此旧缺口（不在父规格验收里，但本方案一并解决）。
- 2026-07-15：平台是请求态、不持久化（platform-selection 锁定）；重生重走首次确认页，平台在确认页重新选定（与首次一致），不做「复用上次平台」，故无存储来源问题（R1）。

## Decision Log

- 2026-07-15：编辑归属 = 写回 `workflow.draft` **并落盘覆盖 `ai/draft.md`**（盘问 Q1）。
- 2026-07-15：重生与手改冲突 = 编辑过则二次确认，确认后覆盖（盘问 Q2）；dirty 判定用 `draftEdited` 标志（编辑置 true、重生成功置 false），辅以 `ai/original/draft.md` 一次性备份作基线 / 恢复点。
- 2026-07-15：重生输入 = 重走首次确认页（`DraftConfirmationSheet`：种子预选 + 偏好从盘读 + 平台确认页选定），与第一次逻辑完全一致；不做静默一键复用（盘问 Q3 初选一键复用，用户后改为重走确认页）。
- 2026-07-15：下载 / 导出 = 复制 + 下载（Blob，源=编辑器当前文本）为主，「导出（定位文件）」降级保留（盘问 Q4）；dirty 时下载 / 导出提示先保存（对齐 transcript 决策）。
- 2026-07-15：左侧裸 `textarea`、右侧复用 `MarkdownContent`，零新依赖（盘问 Q5）。
- 2026-07-15：落盘走本地 tauri 命令，**不上 server**（父规格红线）；安全模式照搬 `transcript_detail.rs`。

## Plan of Work

1. tauri 本地 IO 边界（`app/src-tauri/src/draft_detail.rs` 新增）
   - `load_draft_detail({ task_id })`：解析路径 → `ensure_task_source_privacy_ready` → `required_artifact_path("draft")` → 路径 / 软链校验 → 读 `ai/draft.md` → 返回 `{ task_id, markdown, has_original_backup, draft_seed_insight_id }`（seed id 从 manifest 读）。
   - `save_draft_edit({ task_id, markdown })`：同校验 → 非空校验 → 首次编辑前一次性备份到 `ai/original/draft.md` → `fs::write(ai/draft.md)` → 更新 manifest（`draft_path` / `has_draft` / `draft_preview`）→ 返回 `{ task_id, markdown, artifacts, has_original_backup }`。
   - 安全校验全复用 `task_manifest`（`required_artifact_path` / `validate_task_artifact_path` / `ensure_artifact_parent`）+ `ensure_task_source_privacy_ready` / `reject_linked_artifact_target`（与 `transcript_detail.rs` 抽公共或复制）。
   - `lib.rs` 注册两个命令到 `invoke_handler`。
   - 单测覆盖：load 读内容 + backup 状态 + seed id；save 一次性备份 + 写盘 + manifest 更新；路径穿越 / 软链 / 隔离任务 / 空文本均 recoverable 拒绝。

2. 前端状态层（`app/src/workflowState.ts` + `app/src/draftDetailClient.ts`）
   - 新增 `draftDetailClient.ts`（类比 `historyClient.ts`）：`loadDraftDetail(taskId)` / `saveDraftEdit(taskId, markdown)` 的 `invoke` 封装 + 返回 normalize。
   - `WorkflowState` 加 `draftEdited: boolean`；`createInitialWorkflow` / `startProcessing` 初始 `false`。
   - 加 `editDraft(state, markdown)`：写 `state.draft` + 置 `draftEdited=true`。
   - `finishInsightRetry` 的 `target==="draft"` 成功分支：`draftEdited=false`。

3. 前端结果视图（`app/src/features/results/DraftResultSheet.tsx`）
   - 打开时 `loadDraftDetail(taskId)` 取内容（替代直接读 `workflow.draft`）；加载 / 失败态可恢复提示。
   - 左右分栏：左受控 `<textarea>`（本地编辑缓冲），右 `<MarkdownContent markdown={buffer} />`。
   - 工具区：复制（`navigator.clipboard`）/ 下载（`Blob` + `<a download>`，文件名 = 首 `# 标题` 或 `{taskId}.md`）/ 导出（`getTaskArtifactPath`，本地有 taskDir 时降级保留）/ 重新生成。
   - 编辑 → 标 dirty；保存 → `saveDraftEdit` + 清 dirty + 更新 `workflow.draft`；下载 / 导出 dirty 时提示先保存。
   - 窄屏（modal）退化为上下堆叠。

4. 重新生成接线（`App.tsx` / `useInsightGenerationController.ts`）
   - `regenerateDraft` 入口：`draftEdited` 时先二次确认，随后打开 `DraftConfirmationSheet`（与首次生成同一个确认页）。
   - 确认页：种子预选当前 `draftSeedInsightId`（当次会话）或 `load_draft_detail` 回传值（历史）；偏好快照前端不传（worker 从盘读）；平台在确认页按 platform-selection 推导默认并可改选。
   - 用户确认 → `retry_insights(target="draft", insight_id, platform)`；过 `canGenerateAiWithAccount` / 配额校验。
   - 种子失效 → 按首次纪律要求先在 `启发灵感` 重选种子。
   - 重生成功：`finishInsightRetry("draft")` 重置 `draftEdited=false`；`ai/original/draft.md` 刷新为新基线。

5. 兼容与恢复
   - 历史任务（无 `draft` payload）经 `load_draft_detail` 也能查看 / 编辑。
   - `ai/draft.md` 缺失 / 读取失败 / 保存失败：可恢复错误提示，不崩视图。
   - 老 manifest 无 `draft_path`：`load_draft_detail` 返回空 + `has_draft=false`，编辑器显示空态。

## Validation

- 文档
  - `python scripts/validate_agents_docs.py --level WARN`（若脚本存在）
  - `git diff --check`
- tauri（`app/src-tauri`）
  - `load_draft_detail` 读出 markdown + backup 状态 + seed id。
  - `save_draft_edit` 首次编辑生成 `ai/original/draft.md`，再次编辑不覆盖；写盘 + 更新 manifest（`draft_path` / `has_draft` / `draft_preview`）。
  - 路径穿越、软链目标、隔离 / quarantined 任务、空文本均 recoverable 失败，不写半文件。
  - `cargo test --manifest-path app/src-tauri/Cargo.toml`
- 前端（`app`）
  - 结果视图左右分栏渲染；编辑实时更新右侧预览。
  - 复制 / 下载基于编辑器当前文本；下载产出 `.md`（文件名正确）；导出降级保留。
  - dirty 时下载 / 导出提示先保存；保存后清 dirty。
  - 重新生成：重走首次确认页（种子预选 + 偏好从盘读 + 平台确认页选定）、编辑过二次确认；重生成功重置 dirty。
  - 历史任务可加载并编辑草稿。
  - `npm --prefix app test`
  - `npm --prefix app run build`
- worker
  - 无改动；既有 draft 生成 + `retry_insights` draft 分支回归不变。
  - `uv run pytest worker/tests`（回归，确保未碰生成链路）
