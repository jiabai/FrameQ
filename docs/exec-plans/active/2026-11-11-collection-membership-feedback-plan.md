# 合集成员状态反馈 Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

合集只保存笔记的分组引用。加入合集、从合集中移除、删除合集之后，笔记总列表保持完整可见。用户在添加笔记的选择清单里能看到全部笔记与已加入状态，每次成员变更提交成功后看到一条说明「笔记仍在笔记列表」的反馈，并可直接撤销该次变更。全部行为在本机完成，不产生账号请求或 AI 请求，合集名称与成员关系不离开本机。

## Progress

- [x] 2026-11-11: 核查 `App.tsx`、`DesktopSidebar.tsx`、`ShellLibrary.tsx`、`collectionModel.ts`、`useCollectionsController.ts`，确认笔记总列表使用完整 `historyItems`，合集详情按 `taskIds` 过滤，成员变更只写 `collections.json`，代码中没有把已加入笔记从总列表移除的路径。Validation: 源码阅读，`app/src/App.tsx:854`、`app/src/features/shell/DesktopSidebar.tsx:337`、`app/src/features/collections/collectionModel.ts:30`。
- [x] 2026-11-11: 用户确认采纳设计建议，更新产品规格与设计文档中的合集边界。Validation: `docs/product-specs/2026-10-30-desktop-sidebar-home.md` Local Collection 段、`docs/DESIGN.md` Local Collection and Notes 段。
- [x] 2026-11-11: 起草本计划并在 `active/index.md` 注册。Validation: `docs/exec-plans/active/index.md` 首条。
- [x] 2026-11-11: 实现选择清单的已加入状态标注、成员变更说明与撤销，补齐三种语言文案与样式。Validation: `npm --prefix app test -- src/features/collections/CollectionsWorkspace.test.tsx src/i18n/shellResources.test.ts` 输出 2 文件 / 44 项通过。
- [x] 2026-11-11: 补齐组件测试与三语文案测试，覆盖加入、移除、撤销、切换合集清除状态与状态标注。Validation: 同上 44 项，其中 `CollectionsWorkspace.test.tsx` 32 项、`shellResources.test.ts` 12 项。
- [x] 2026-11-11: 运行前端全量门禁与生产构建。Validation: `npm --prefix app test` 输出 137 文件 / 1591 通过 / 1 跳过；`npm --prefix app run lint` 通过；`npm --prefix app run build` 通过；`validate_agents_docs.py` ERROR 与 WARN 均为 0 错误 0 警告；`git diff --check` 通过。

## Surprises & Discoveries

Evidence: `app/src/i18n/shellResources.test.ts:40` 检查 `collections` 下全部文案值，禁止出现小写 `task`、`tasks`、`collections` 与「任务」。新增英文文案使用 `note`、`notes`、`Collection`、`Notes`。

Evidence: `app/src/features/collections/CollectionsWorkspace.test.tsx:232` 以 `getByRole("checkbox", { name: "Interview" })` 定位选择框。状态标注须通过 `aria-describedby` 关联，选择框保留笔记标题作为可访问名称。

Evidence: `app/src/App.tsx:599` 把 `collectionsController.errorCode` 转成 `collectionNotice` 传给合集视图，父级错误提示已有通道；成功反馈在组件局部维护即可，失败时清除局部反馈由父级错误提示接管。

Evidence: 本机会话注入的 `NODE_OPTIONS=--require="D:/Program Files/Tencent/WorkBuddy/resources/app.asar.unpacked/cli/vendor/shim/node-language-shim.cjs"` 会让 Vitest 4.1.9 的全部 137 个测试文件在 `describe` 阶段报 `Cannot read properties of undefined (reading 'config')`，表现为 0 test；在 Git Bash 里 `NODE_OPTIONS= npm ...` 未清除该变量，在 PowerShell 里先执行 `$env:NODE_OPTIONS=$null` 后前端门禁全部正常。这是宿主环境问题，与本次代码改动无关。

## Decision Log

Decision: 合集保持引用语义，笔记总列表始终显示完整本地历史。 Rationale: 一条笔记可属于多个合集，成员关系变化不改变笔记本体与历史投影。 Date/Author: 2026-11-11 / User + Codex

Decision: 反馈状态由 `CollectionsWorkspace` 局部维护，成员变更与撤销复用现有 `onSetMembership` 与 `commit` 提交路径。 Rationale: 无需改动 App 层合集控制器、Rust 命令与 `collections.json` 结构。 Date/Author: 2026-11-11 / Codex

Decision: 撤销成功后显示「已撤销」说明，不再提供第二次撤销。 Rationale: 撤销链无限延伸会让用户难以判断当前成员状态。 Date/Author: 2026-11-11 / Codex

Decision: 本次不 bump 版本、不打 tag、不建 Release、不部署站点。 Rationale: v0.6.0 发版决策尚未执行，站点 dist 已指向尚不存在的 `Locus_0.6.0_*` 资产。 Date/Author: 2026-11-11 / Codex

Decision: 前端门禁统一在 PowerShell 里先清除 `NODE_OPTIONS` 再执行。 Rationale: 宿主注入的 shim 让 Vitest 4 的测试收集上下文失效，清除后 137 个文件全部正常运行。 Date/Author: 2026-11-11 / Codex

## Outcomes & Retrospective

合集详情中的添加清单现在列出全部本地笔记，已加入项带「已在此合集」标注并通过 `aria-describedby` 关联到选择框；加入、移除与撤销提交成功后显示一条说明「笔记仍保留在笔记列表中」的反馈，撤销复用同一成员提交命令，切换合集或刷新后反馈清除。笔记总列表使用完整本地历史的行为没有改动。验证输出：`npm --prefix app test` 137 文件 / 1591 通过 / 1 跳过；`npm --prefix app run lint` 通过（含 `tsc --noEmit` 与 i18n 字面量检查）；`npm --prefix app run build` 通过（2621 模块，产物 `index-WmMP-ug0.js`）；文档治理 ERROR 与 WARN 均 0 错误 0 警告；`git diff --check` 通过。Residual risk: 原生 Tauri 窗口中的真实指针与键盘操作尚未在本轮脚本化验证，撤销按钮在 WebView2 宿主中的焦点转移只由组件测试覆盖；改动尚未提交，未发版，未部署站点。

## Context and Orientation

- Spec: `docs/product-specs/2026-10-30-desktop-sidebar-home.md`
- Design: `docs/DESIGN.md`、`docs/SECURITY.md`
- App 组件: `app/src/features/collections/CollectionsWorkspace.tsx`、`collections.css`、`CollectionsWorkspace.test.tsx`
- App 文案: `app/src/i18n/shellResources.ts`、`shellResources.test.ts`
- App 状态: `app/src/features/collections/useCollectionsController.ts`、`app/src/App.tsx`
- 本地存储: Rust 侧 `collections.json`，本次不改
- Docs: `docs/exec-plans/index.md`、`docs/EXECUTION_GATES.md`

## Plan of Work

1. 在成员选择清单中为已加入项显示状态标注，选择框保留笔记标题作为可访问名称。
2. 成员变更提交成功后显示状态说明，明确笔记仍保留在笔记列表，并提供撤销按钮；撤销走同一提交路径，成功后改为「已撤销」说明。
3. 切换所选合集时清除状态，失败时清除局部反馈。
4. 三种语言补齐文案，样式沿用现有浅色面版与绿色强调。
5. 补齐组件测试与三语文案测试，运行验证。

## Validation and Acceptance

- `npm --prefix app test`
- `npm --prefix app run lint`
- `npm --prefix app run build`
- `uv run python scripts/validate_agents_docs.py --level ERROR`
- `uv run python scripts/validate_agents_docs.py --level WARN`
- 人工回归：在真实桌面窗口打开一个合集，添加一篇已有笔记，确认该笔记仍出现在侧栏「笔记」与 Notes 页；点击撤销，确认合集计数回到原值且笔记仍在笔记列表。
