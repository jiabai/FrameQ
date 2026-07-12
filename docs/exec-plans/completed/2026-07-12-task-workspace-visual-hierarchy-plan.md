# Task Workspace Visual Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. This repository session will execute inline; do not dispatch subagents and do not commit or push without a separate user request.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Make the local transcript and optional AI workspaces visually quieter and more hierarchical without changing any workflow, data, privacy, or accessibility contract.

**Architecture:** Keep the two existing domain components and their current props. Change only their rendered presentation classes and relevant CSS: one grouped transcript list, one grouped AI-target list, conditionally rendered workspace statuses, Chinese-only headings, a dedicated quiet AI action class, and distinct playback/edit/focus states. Controller, view-model, Tauri, worker, server, persistence, and IPC remain untouched.

**Tech Stack:** React 19, TypeScript, CSS, Vitest static-render/CSS-contract tests, and the existing serial Chromium CDP smoke harness.

---

## Purpose / Big Picture

The saved local transcript must read as the primary work surface and cloud AI as an optional
secondary workspace. The UI must stop presenting each nested object as an equal card, stop
repeating task status in workspace headers, and stop giving a pending AI choice the same visual
weight as final cloud confirmation. Playback, editing, and keyboard focus remain distinct.

## Progress

- [x] 2026-07-12: Reviewed current components, CSS, screenshots, and tests; confirmed all five hierarchy problems. Validation: read-only inspection of the relevant TSX, CSS, Vitest, CDP smoke, and wide/narrow/native screenshots.
- [x] 2026-07-12: Presented three visual directions and received approval for restrained option A. Validation: visual comparison and written design approval.
- [x] 2026-07-12: Wrote and self-reviewed the focused product spec. Validation: `git diff --check`.
- [x] 2026-07-12: Added grouped-inner-surface tests and verified RED. Validation: focused Vitest failed 1/20 because `.transcript-segments` still had `gap: 10px` and no shared border.
- [x] 2026-07-12: Implemented one bounded transcript list and one bounded AI-target list with borderless rows and adjacent dividers. Validation: focused Vitest passed 20/20.
- [x] 2026-07-12: Added status/heading ownership tests, verified ready-state RED, removed English eyebrows and redundant ready/optional badges, and preserved processing/failure/waiting/generating plus target states. Validation: focused component test failed 1/6 on `Local transcript`, then passed 6/6.
- [x] 2026-07-12: Added quiet AI action component/CSS tests, verified RED in both files, and changed only pre-confirmation/retry target actions to the scoped secondary-blue class. Validation: focused Vitest failed 2/22, then passed 22/22; confirmation-sheet primary actions were untouched.
- [x] 2026-07-12: Added playback/edit/focus style tests, verified the old three-pixel halo RED, and implemented pale playback background plus two-pixel inset accent while editing clears the playback accent and textarea/global focus rules remain. Validation: focused CSS test failed 1/17, then passed 17/17.
- [x] 2026-07-12: Extended the serial Chromium smoke with grouped-surface, heading, status, and action-style probes; replaced two obsolete probes that inferred state from the removed badge/global-button classes. Validation: first run passed 18/20 and exposed only those stale probes; corrected run passed 20/20. Focused capture passed 1/1 with 19 skipped and refreshed both screenshots.
- [x] 2026-07-12: Synchronized the durable design rules and finished scoped gates. Validation: app 35 files / 240 tests, focused Chromium 20/20, production build, docs validator 0 errors/0 warnings, and `git diff --check` all passed.

## Surprises & Discoveries

- Evidence: `.transcript-segment.active` uses `box-shadow: 0 0 0 3px var(--focus)`, visually conflating playback with strong focus.
- Evidence: `LocalTranscriptWorkspace` always renders `本地完成` while `TaskStatusBanner` already renders `本地处理完成` for a ready task.
- Evidence: `AiGenerationWorkspace` renders `可选` whenever no target is active, while each target separately renders its lifecycle state.
- Evidence: Pending AI actions and the final confirmation-sheet action both use the elevated `.primary-button`.
- Evidence: `getRuleBody` matches the complete selector text, so separate transcript and AI CSS rules are more reliable than a combined selector for this repository's existing CSS-contract tests.
- Evidence: Removing per-target borders made the old generating/cancelling/failed `border-color` declarations ineffective. A follow-up RED test exposed the dead state rules; grouped rows now use low-saturation state backgrounds while their text badges remain.
- Evidence: 1366 px Chromium geometry remains two columns with local ratio 0.6183, AI width 496.95 px, zero top delta, zero audio-center spread, and zero audio-padding delta. All seven new hierarchy probes are true; 900 px remains contained and local-first stacked.
- Evidence: One final full-suite run timed out in the unrelated existing history-layout smoke at its 15-second limit (239/240). The exact test then passed in 1.60 seconds, the complete browser file passed 20/20 in 7.80 seconds, and a fresh complete app run passed 240/240 in 15.36 seconds. No timeout or assertion was relaxed.

## Decision Log

- Decision: Use one bounded list for transcript rows and one bounded list for AI targets rather than independent nested cards. Rationale: preserve grouping and target independence while reducing repeated borders and radii. Date/Author: 2026-07-12 / User + Codex.
- Decision: Remove only redundant ready/optional workspace badges; retain processing, failure, waiting, generating, and all target-level states. Rationale: status ownership follows task, workspace constraint, and target lifecycle scope. Date/Author: 2026-07-12 / User + Codex.
- Decision: Remove English eyebrow labels without replacement icons. Rationale: Chinese headings and content already communicate domain meaning. Date/Author: 2026-07-12 / User + Codex.
- Decision: Use a dedicated quiet secondary-blue class for pre-confirmation and retry actions while keeping confirmation-sheet submit primary. Rationale: visual hierarchy should peak at the explicit cloud decision. Date/Author: 2026-07-12 / User + Codex.
- Decision: Represent playback with a pale row background and two-pixel inset left accent; reserve the external halo for focus-visible. Rationale: playback, edit, and keyboard states need distinct semantics. Date/Author: 2026-07-12 / User + Codex.

## Outcomes & Retrospective

The approved restrained hierarchy is implemented without changing component props or production
state logic. Transcript segments and AI targets now use one grouped boundary each; ready/optional
workspace statuses and English eyebrows are gone; active states remain scoped; pending/retry AI
actions are quieter than final confirmation; and playback no longer borrows the focus halo.

TDD evidence: grouped surfaces failed 1/20 then passed 20/20; heading/status ownership failed 1/6
then passed 6/6; AI actions failed 2/22 then passed 22/22; transcript state styling failed 1/17
then passed 17/17; the obsolete AI state-border follow-up failed 1/17 then passed 17/17. Final
validation passed app 35 files / 240 tests, Chromium 20/20, production build, docs 0/0, and diff
check. Wide and narrow screenshots are under ignored `.tmp/task-workspaces/`.

Residual risk: Chromium proves DOM/CSS geometry and visual evidence, not native WebView2 font and
control rasterization. No native Tauri run was required because this change does not alter native
controls, IPC, filesystem, worker, or OS behavior.

## Context and Orientation

- Spec: `docs/product-specs/2026-07-12-task-workspace-visual-hierarchy.md`.
- Components: `app/src/features/transcript/LocalTranscriptWorkspace.tsx`, `app/src/features/transcript/TranscriptReviewPanel.tsx`, and `app/src/features/results/AiGenerationWorkspace.tsx`.
- Styles: `app/src/App.css`. Do not modify global `.compact-button` or `.primary-button` semantics.
- Unit/contracts: `app/src/features/results/TaskWorkspaces.test.tsx` and `app/src/App.css.test.ts`.
- Browser: `app/tests/app-input.browser.test.ts` uses deterministic local fixtures without worker, network, LLM, or payment.
- Docs: `docs/DESIGN.md`, `docs/product-specs/index.md`, plan indexes, and `TASKS.md`.

## Plan of Work

### Task 1: Group inner surfaces instead of stacking peer cards

**Files:**
- Modify: `app/src/App.css`
- Test: `app/src/App.css.test.ts`
- Test: `app/src/features/results/TaskWorkspaces.test.tsx`

- [x] **Step 1: Write the failing CSS and component tests**

```ts
const segmentListRule = getRuleBody([".transcript-segments"]);
const segmentRule = getRuleBody([".transcript-segment"]);
const segmentDividerRule = getRuleBody([".transcript-segment + .transcript-segment"]);
const targetListRule = getRuleBody([".ai-target-list"]);
const targetRule = getRuleBody([".ai-target-card"]);
const targetDividerRule = getRuleBody([".ai-target-card + .ai-target-card"]);

expect(segmentListRule).toContain("border: 1px solid var(--border);");
expect(segmentListRule).toContain("overflow: hidden;");
expect(segmentListRule).toContain("gap: 0;");
expect(segmentRule).toContain("background: transparent;");
expect(segmentRule).toContain("border: 0;");
expect(segmentRule).toContain("border-radius: 0;");
expect(segmentDividerRule).toContain("border-top: 1px solid var(--border);");
expect(targetListRule).toContain("border: 1px solid var(--border);");
expect(targetListRule).toContain("overflow: hidden;");
expect(targetListRule).toContain("gap: 0;");
expect(targetRule).toContain("background: transparent;");
expect(targetRule).toContain("border: 0;");
expect(targetRule).toContain("border-radius: 0;");
expect(targetDividerRule).toContain("border-top: 1px solid var(--border);");
```

Keep assertions that two semantic AI `article` targets and transcript segment rows remain. Do not
add test-only props or wrappers.

- [x] **Step 2: Run tests and verify RED**

Run `npm --prefix app test -- src/App.css.test.ts src/features/results/TaskWorkspaces.test.tsx`.
Expected: FAIL because current items each own background, border, radius, and list gap.

- [x] **Step 3: Implement the minimal grouped-surface CSS**

```css
.transcript-segments,
.ai-target-list {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  display: grid;
  gap: 0;
  overflow: hidden;
}

.transcript-segment,
.ai-target-card {
  background: transparent;
  border: 0;
  border-radius: 0;
}

.transcript-segment + .transcript-segment,
.ai-target-card + .ai-target-card {
  border-top: 1px solid var(--border);
}
```

Retain existing item padding and internal layout. Do not alter outer workspaces or the audio player.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the same focused command. Expected: both files pass.

### Task 2: Make status and heading ownership explicit

**Files:**
- Modify: `app/src/features/transcript/LocalTranscriptWorkspace.tsx`
- Modify: `app/src/features/results/AiGenerationWorkspace.tsx`
- Test: `app/src/features/results/TaskWorkspaces.test.tsx`

- [x] **Step 1: Write failing component assertions**

```ts
expect(localMarkup).not.toContain("Local transcript");
expect(localMarkup).not.toContain(">本地完成</span>");
expect(localMarkup).toContain("文字稿校对");
expect(aiMarkup).not.toContain("Cloud AI");
expect(aiMarkup).not.toContain(">可选</span>");
expect(aiMarkup).toContain("AI 整理");
expect(aiMarkup.match(/class="ai-target-status"/g)).toHaveLength(2);
```

Add processing, failed, waiting, and generating cases proving meaningful workspace badges remain.

- [x] **Step 2: Run the component test and verify RED**

Run `npm --prefix app test -- src/features/results/TaskWorkspaces.test.tsx`.
Expected: FAIL because both eyebrow labels and ready/optional workspace badges render.

- [x] **Step 3: Implement conditional statuses**

Delete the two `.section-label` paragraphs. Render local status only when not ready:

```tsx
{model.phase !== "ready" ? (
  <span className={`workspace-status-badge ${model.phase}`}>
    {localStatusLabel(model.phase)}
  </span>
) : null}
```

Render AI workspace status only for active generation or transcript waiting:

```tsx
{model.activeTarget ? (
  <span className="workspace-status-badge active">生成中</span>
) : model.phase === "waiting_transcript" ? (
  <span className="workspace-status-badge">等待文字稿</span>
) : null}
```

Do not change semantic region labels, target statuses, or view-model state.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the same component test. Expected: PASS.

### Task 3: Lower pre-confirmation AI action weight

**Files:**
- Modify: `app/src/features/results/AiGenerationWorkspace.tsx`
- Modify: `app/src/App.css`
- Test: `app/src/features/results/TaskWorkspaces.test.tsx`
- Test: `app/src/App.css.test.ts`

- [x] **Step 1: Write failing action-contract tests**

```ts
expect(aiMarkup.match(/class="secondary-button ai-target-action"/g)).toHaveLength(2);
expect(aiMarkup).not.toContain('class="primary-button"');

const actionRule = getRuleBody([".ai-target-action"]);
const actionFeedbackRule = getRuleBody([
  ".ai-target-action:not(:disabled):hover",
  ".ai-target-action:focus-visible",
]);
expect(actionRule).toContain("background: #eef6ff;");
expect(actionRule).toContain("box-shadow: none;");
expect(actionRule).toContain("color: #075c9f;");
expect(actionFeedbackRule).toContain("border-color: #8cc8ff;");
```

- [x] **Step 2: Run tests and verify RED**

Run `npm --prefix app test -- src/App.css.test.ts src/features/results/TaskWorkspaces.test.tsx`.
Expected: FAIL because pending actions use `.primary-button` and no scoped rule exists.

- [x] **Step 3: Implement the quiet action class**

```tsx
<button
  type="button"
  className="secondary-button ai-target-action"
  onClick={onAction}
  disabled={disabled}
>
  {actionLabel}
</button>
```

```css
.ai-target-action {
  background: #eef6ff;
  border-color: rgba(10, 132, 255, 0.24);
  box-shadow: none;
  color: #075c9f;
}

.ai-target-action:not(:disabled):hover,
.ai-target-action:focus-visible {
  background: #e2f1ff;
  border-color: #8cc8ff;
}
```

- [x] **Step 4: Run focused tests and verify GREEN**

Run the same focused command. Expected: PASS. Final confirmation flow buttons remain primary.

### Task 4: Separate playback, editing, and keyboard focus states

**Files:**
- Modify: `app/src/App.css`
- Test: `app/src/App.css.test.ts`

- [x] **Step 1: Write the failing state-style test**

```ts
const activeRule = getRuleBody([".transcript-segment.active"]);
const editingRule = getRuleBody([".transcript-segment.editing"]);
expect(activeRule).toContain("background: #eef6ff;");
expect(activeRule).toContain("box-shadow: inset 2px 0 0 var(--primary);");
expect(activeRule).not.toContain("0 0 0 3px");
expect(editingRule).toContain("background: #fff;");
expect(editingRule).toContain("box-shadow: none;");
expect(appCss).toContain(":focus-visible");
```

- [x] **Step 2: Run the CSS test and verify RED**

Run `npm --prefix app test -- src/App.css.test.ts`.
Expected: FAIL because active playback still uses the external focus halo.

- [x] **Step 3: Implement distinct state styles**

```css
.transcript-segment.active {
  background: #eef6ff;
  box-shadow: inset 2px 0 0 var(--primary);
}

.transcript-segment.editing {
  background: #fff;
  box-shadow: none;
}
```

Keep textarea focus border/halo and global focus-visible rules. Add no motion or offsets.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the same CSS test. Expected: PASS.

### Task 5: Verify complete hierarchy with existing Chromium smoke

**Files:**
- Modify: `app/tests/app-input.browser.test.ts`
- Evidence only: `.tmp/task-workspaces/task-workspaces-wide.png`
- Evidence only: `.tmp/task-workspaces/task-workspaces-narrow.png`
- Evidence only: `.tmp/task-workspaces/task-workspaces-geometry.json`

- [x] **Step 1: Extend the existing ready-task geometry/style assertion**

Add computed facts while preserving every existing layout/audio assertion:

```ts
const segments = [...document.querySelectorAll('.transcript-segment')];
const targetCards = [...document.querySelectorAll('.ai-target-card')];
const targetList = document.querySelector('.ai-target-list');
const segmentList = document.querySelector('.transcript-segments');
return {
  segmentListBordered: parseFloat(getComputedStyle(segmentList).borderTopWidth) === 1,
  segmentCardsBorderless: segments.every((item) => parseFloat(getComputedStyle(item).borderLeftWidth) === 0),
  targetListBordered: parseFloat(getComputedStyle(targetList).borderTopWidth) === 1,
  targetCardsBorderless: targetCards.every((item) => parseFloat(getComputedStyle(item).borderLeftWidth) === 0),
  noEnglishEyebrows: !document.body.innerText.includes('LOCAL TRANSCRIPT') && !document.body.innerText.includes('CLOUD AI'),
  noRedundantWorkspaceStatus: !document.querySelector('.local-transcript-workspace .workspace-status-badge') && !document.querySelector('.ai-generation-workspace .workspace-status-badge'),
  quietTargetActions: document.querySelectorAll('.ai-target-action').length === 2,
};
```

Assert every new boolean is true at 1366px. Keep the 900px local-first stack assertion.

- [x] **Step 2: Run the serial browser smoke**

```powershell
$env:FRAMEQ_REPORT_TASK_WORKSPACES='1'
npm --prefix app test -- tests/app-input.browser.test.ts
Remove-Item Env:FRAMEQ_REPORT_TASK_WORKSPACES
```

Expected: PASS and geometry-only report; no source URL, token, transcript, credential, worker,
network, LLM, payment, or checkout activity.

- [x] **Step 3: Inspect wide and narrow screenshots**

Verify outer workspaces remain bounded; transcript and AI items read as grouped rows; the banner is
the only ready-task completion status; AI actions are quieter than final confirmation; narrow mode
stays local-first with no horizontal overflow. If evidence contradicts the design, add a failing
style/geometry assertion before the smallest correction.

### Task 6: Documentation and scoped final gates

**Files:**
- Modify: `docs/DESIGN.md`
- Modify: `TASKS.md`
- Modify: this plan
- Move after all gates: this plan from `active/` to `completed/`
- Modify after all gates: `docs/exec-plans/active/index.md` and `docs/exec-plans/completed/index.md`

- [x] **Step 1: Synchronize the durable design rule**

Document that outer workspaces own strong panel surfaces, transcript/AI items use grouped rows,
redundant ready/optional workspace badges are omitted, and playback/focus/edit states stay distinct.

- [x] **Step 2: Run complete scoped validation**

```powershell
npm --prefix app test
npm --prefix app run build
python scripts\validate_agents_docs.py --level WARN
git diff --check
git status --short
```

Expected: all app tests/build pass; docs validator has no blocking error; diff check is clean;
status contains only this approved UI/docs scope plus ignored screenshot evidence.

- [x] **Step 3: Close the living plan only after evidence exists**

Record exact RED failures, GREEN counts, screenshots, final command results, and residual risks.
Mark TASKS complete, archive the plan, and update both indexes. Do not commit or push unless the
user separately requests it.

## Validation and Acceptance

- `npm --prefix app test -- src/App.css.test.ts src/features/results/TaskWorkspaces.test.tsx`
- `npm --prefix app test -- tests/app-input.browser.test.ts`
- `npm --prefix app test`
- `npm --prefix app run build`
- `python scripts\validate_agents_docs.py --level WARN`
- `git diff --check`
- `git status --short`

Acceptance requires all five visible changes, unchanged accessibility and responsive behavior, no
new dependency, no production-logic change, and no modifications to Rust/Tauri, worker, server,
payment, quota, persistence, SourceIdentity, or privacy boundaries.
