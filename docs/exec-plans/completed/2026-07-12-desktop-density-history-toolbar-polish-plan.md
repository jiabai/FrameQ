# Desktop Density, History, and Toolbar Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. This side-conversation session executes inline without subagents; do not commit or push without a separate user request.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Make History intrinsically sized, strengthen secondary typography, normalize the active-task 12/16/24 rhythm, and group desktop toolbar utilities without changing behavior or data boundaries.

**Architecture:** Keep all existing controllers and button handlers. Limit production changes to `App.tsx` structure and scoped `App.css` rules: one utility-group wrapper, compact account styling, explicit spacing tokens, normalized shared heading weights, and non-growing History list behavior. Use existing component/CSS contracts and serial CDP browser tests for TDD and geometry evidence.

**Tech Stack:** React 19, TypeScript, CSS, Vitest source/CSS-contract tests, and the existing deterministic Chromium CDP smoke harness.

---

## Purpose / Big Picture

History should wrap a short task list instead of presenting a large empty sheet, while a long list
must still scroll within the existing sheet maximum. Toolbar controls should read as one compact
account status and one utility cluster. Shared small labels and headings should become clearer and
less heavy, and the active task page should follow a consistent 24/16/12 rhythm.

## Progress

- [x] 2026-07-12: Reviewed current History, toolbar, typography, spacing, screenshots, and browser fixtures while preserving existing uncommitted work. Validation: read-only code and diff inspection.
- [x] 2026-07-12: User approved targeted option A and its written product specification. Validation: visual comparison plus written confirmation.
- [x] 2026-07-12: Added intrinsic-height contracts, verified RED on `flex: 1 1 auto`, changed History to non-growing flex ownership, removed the artificial 720px browser mutation, and added short/long-list geometry. Validation: CSS failed 1/17 then passed 17/17; History browser subset passed 5/5 with 16 skipped.
- [x] 2026-07-12: Added exact typography/rhythm contracts, verified RED on the old text-soft value, then implemented `#747982`, 700/700/650 headings, 700 labels, spacing tokens, and scoped active-task/History usage while preserving local transcript height. Validation: focused CSS failed 1/18, then passed 18/18.
- [x] 2026-07-12: Added toolbar source/style contracts, verified RED on the missing group, wrapped only History/Settings/New Task, and implemented a compact labelled account chip plus one quiet 32px utility group. Validation: focused CSS/source test failed 1/19, then passed 19/19.
- [x] 2026-07-12: Added 1366/720 toolbar geometry and refreshed intrinsic History/task-workspace screenshots. The first full browser run exposed one missing empty scenario and the old 7-11px History gap assertion; measured geometry proved the new gap is exactly 12px, then the corrected suite passed 22/22. Validation: account height 32px, three equal tools, center delta <=1px, toolbar contained; History wide sheet 504.52px with 18px bottom padding and no scrolling, long list scrolls within the sheet maximum.
- [x] 2026-07-12: Synchronized durable design rules and finished scoped gates while preserving unrelated worker changes. Validation: app 35 files / 244 tests, browser 22/22, production build, docs 0 errors/0 warnings, and `git diff --check` passed.

## Surprises & Discoveries

- Evidence: The product sheet has only a shared `max-height`; the saved large-empty-space History screenshot is manufactured by `app-input.browser.test.ts` assigning `style.height = '720px'` before capture.
- Evidence: `.history-list` still declares `flex: 1 1 auto`, which communicates unwanted growth even though the auto-height production sheet usually prevents it from growing.
- Evidence: `--text-soft` is `#8b8f98` at 0.72-0.78rem, while headings and labels use 720/760 weights.
- Evidence: `.workspace` uses an 18px gap; task-workspace siblings already use 16px and domain interiors already use 12px.
- Evidence: History, Settings, and New Task are equal 34px buttons but remain three independent elevated controls; `.account-chip` has a fixed 92px minimum width.
- Evidence: Concurrent workspace modifications exist in worker media code/tests and the main product spec. They are unrelated and must remain untouched.

## Decision Log

- Decision: Fix both the fixture and the CSS ownership rule for History height. Rationale: removing only the artificial test height corrects evidence, while `flex: 0 1 auto` makes intrinsic sizing explicit and protects future parent changes. Date/Author: 2026-07-12 / User + Codex.
- Decision: Add `--space-3`, `--space-4`, and `--space-6` rather than globally replacing all gaps. Rationale: explicit tokens improve the approved surfaces without expanding into unrelated sheets. Date/Author: 2026-07-12 / User + Codex.
- Decision: Keep account icon plus status text and group only persistent utility icons. Rationale: account status remains glanceable; update remains a separate temporary action. Date/Author: 2026-07-12 / User + Codex.
- Decision: Normalize only shared heading/label weights and `--text-soft`. Rationale: a global numeric-weight rewrite would exceed the reviewed scope. Date/Author: 2026-07-12 / User + Codex.

## Outcomes & Retrospective

History now wraps short content and scrolls long content within the shared sheet maximum. Secondary
text and shared heading weights are clearer, active-task layout uses explicit 24/16/12 tokens, and
the toolbar presents one compact labelled account chip plus one three-button utility group. Short
transcript height, controllers, data contracts, and native behavior are unchanged.

TDD evidence: History ownership failed 1/17 then CSS passed 17/17 and History smoke passed 5/5;
typography/rhythm failed 1/18 then passed 18/18; toolbar grouping failed 1/19 then passed 19/19.
The first complete browser run exposed a missing empty scenario object and an obsolete 7-11px gap
assertion. Instrumented geometry measured exactly 12px in both widths; after correcting only the
test contracts, browser passed 22/22. Final app validation passed 35 files / 244 tests and the
production build. Wide/narrow History plus task-workspace screenshots were refreshed under
ignored `.tmp/` paths.

Residual risk: Chromium verifies real React/CSS geometry but not native WebView font rasterization.
No native control, IPC, filesystem, worker, or OS behavior changed. Concurrent modifications in
`worker/frameq_worker/media.py`, `worker/tests/test_media.py`, and their main product-spec line were
preserved and were neither reviewed nor claimed by this plan.

## Context and Orientation

- Product spec: `docs/product-specs/2026-07-12-desktop-density-history-toolbar-polish.md`.
- History component: `app/src/features/history/HistorySheet.tsx`; no data or controller changes are expected.
- Toolbar composition: `app/src/App.tsx` around `.topbar-actions.toolbar-actions`.
- Styles: `app/src/App.css` root tokens, shared typography, toolbar controls, sheet surfaces, History list, and active workspace.
- CSS/source tests: `app/src/App.css.test.ts` already reads both `App.css` and `App.tsx`.
- Browser smoke: `app/tests/app-input.browser.test.ts` owns deterministic History fixtures, screenshots, and toolbar DOM geometry.
- Unrelated dirty scope to preserve: `worker/frameq_worker/media.py`, `worker/tests/test_media.py`, and their product-spec edits.

## Plan of Work

### Task 1: Make History height intrinsic and long lists scrollable

**Files:**
- Modify: `app/src/App.css`
- Test: `app/src/App.css.test.ts`
- Test: `app/tests/app-input.browser.test.ts`

- [x] **Step 1: Write the failing CSS contract**

```ts
const historyListRule = getRuleBody([".history-list"]);
const historySheetRule = getRuleBody([".history-modal", ".history-sheet"]);

expect(historyListRule).toContain("flex: 0 1 auto;");
expect(historyListRule).toContain("min-height: 0;");
expect(historyListRule).toContain("overflow: auto;");
expect(historySheetRule).not.toMatch(/(?:^|\s)(?:height|min-height):/);
```

Also assert the browser source no longer contains:

```ts
expect(browserSmokeSource).not.toContain("style.height = '720px'");
```

Add `browserSmokeSource` to `App.css.test.ts` by reading
`../tests/app-input.browser.test.ts` with `readFileSync`.

- [x] **Step 2: Run focused test and verify RED**

Run `npm --prefix app test -- src/App.css.test.ts`.
Expected: FAIL because `.history-list` currently declares `flex: 1 1 auto` and the browser fixture
still assigns 720px.

- [x] **Step 3: Implement intrinsic list ownership**

Change only the flex declaration:

```css
.history-list {
  flex: 0 1 auto;
}
```

Keep `min-height: 0`, `overflow: auto`, and the shared sheet `max-height` unchanged.

- [x] **Step 4: Replace artificial browser geometry with real intrinsic assertions**

Remove the `Runtime.evaluate` block that writes `style.height`. For the existing three-item wide
fixture collect:

```ts
const sheetRect = document.querySelector('.history-sheet').getBoundingClientRect();
const listRect = document.querySelector('.history-list').getBoundingClientRect();
const cards = [...document.querySelectorAll('.history-item')];
const lastCardRect = cards[cards.length - 1].getBoundingClientRect();
return {
  sheetHeight: sheetRect.height,
  listBottomPadding: listRect.bottom - lastCardRect.bottom,
  listScrollable: document.querySelector('.history-list').scrollHeight > document.querySelector('.history-list').clientHeight,
};
```

Assert `sheetHeight < 600`, `listBottomPadding` is between 16 and 20 CSS px, and the short list is
not scrollable. Preserve title-clamp, metadata, compact-card, and narrow-layout assertions.

- [x] **Step 5: Add a long-list scroll fixture**

Create 14 safe manifest-derived list DTO fixtures by repeating the existing sanitized base item
with unique task IDs and previews. Open History at 1366x720 and assert:

```ts
expect(longList.sheetHeight).toBeLessThanOrEqual(720);
expect(longList.sheetBottom).toBeLessThanOrEqual(longList.viewportHeight - 24 + 1);
expect(longList.listScrollable).toBe(true);
```

Do not invoke worker, network, LLM, payment, or external files.

- [x] **Step 6: Run focused CSS and browser tests**

Run:

```powershell
npm --prefix app test -- src/App.css.test.ts
npm --prefix app test -- tests/app-input.browser.test.ts -t "history"
```

Expected: CSS and all History-matching browser tests pass.

### Task 2: Normalize secondary typography and active-task rhythm

**Files:**
- Modify: `app/src/App.css`
- Test: `app/src/App.css.test.ts`

- [x] **Step 1: Write failing token, weight, and rhythm assertions**

```ts
const rootRule = getRuleBody([":root"]);
const h1Rule = getRuleBody(["h1"]);
const h2Rule = getRuleBody(["h2"]);
const h3Rule = getRuleBody(["h3"]);
const labelRule = getRuleBody([".eyebrow", ".section-label"]);
const activeWorkspaceRule = getRuleBody([".workspace.active-layout"]);
const taskLayoutRule = getRuleBody([".task-workspace-layout"]);
const domainRule = getRuleBody([".task-domain-workspace"]);
const historyListRule = getRuleBody([".history-list"]);
const historyItemRule = getRuleBody([".history-item"]);

expect(rootRule).toContain("--text-soft: #747982;");
expect(rootRule).toContain("--space-3: 12px;");
expect(rootRule).toContain("--space-4: 16px;");
expect(rootRule).toContain("--space-6: 24px;");
expect(h1Rule).toContain("font-weight: 700;");
expect(h2Rule).toContain("font-weight: 700;");
expect(h3Rule).toContain("font-weight: 650;");
expect(labelRule).toContain("font-weight: 700;");
expect(activeWorkspaceRule).toContain("gap: var(--space-6);");
expect(taskLayoutRule).toContain("gap: var(--space-4);");
expect(domainRule).toContain("gap: var(--space-3);");
expect(historyListRule).toContain("gap: var(--space-3);");
expect(historyItemRule).toContain("gap: var(--space-3);");
```

Retain the existing assertion that `.local-transcript-workspace` keeps its height and min-height.

- [x] **Step 2: Run focused test and verify RED**

Run `npm --prefix app test -- src/App.css.test.ts`.
Expected: FAIL on old text-soft, missing spacing tokens, 720/760 weights, and literal gaps.

- [x] **Step 3: Implement exact tokens and scoped usage**

At `:root` add/change:

```css
--text-soft: #747982;
--space-3: 12px;
--space-4: 16px;
--space-6: 24px;
```

Set `h1/h2` to 700, `h3` to 650, and label weight to 700. Set:

```css
.workspace.active-layout { gap: var(--space-6); }
.task-workspace-layout { gap: var(--space-4); }
.task-domain-workspace,
.transcript-review-panel { gap: var(--space-3); }
.history-list,
.history-item { gap: var(--space-3); }
```

Do not alter `.history-item-main { gap: 8px; }` or local transcript height.

- [x] **Step 4: Run focused test and verify GREEN**

Run `npm --prefix app test -- src/App.css.test.ts`.
Expected: PASS.

### Task 3: Group toolbar utilities and quiet the account chip

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/App.css`
- Test: `app/src/App.css.test.ts`
- Test: `app/tests/app-input.browser.test.ts`

- [x] **Step 1: Write failing source and CSS contracts**

```ts
expect(appTsx).toMatch(
  /className="toolbar-tool-group"[\s\S]*?aria-label="查看历史"[\s\S]*?aria-label="应用设置"[\s\S]*?aria-label=\{toolbarNewTaskButtonState\.ariaLabel\}/,
);

const accountRule = getRuleBody([".account-chip"]);
const toolGroupRule = getRuleBody([".toolbar-tool-group"]);
const groupedIconRule = getRuleBody([".toolbar-tool-group .icon-button"]);
expect(accountRule).toContain("min-width: 0;");
expect(accountRule).toContain("min-height: 32px;");
expect(accountRule).toContain("padding: 0 9px;");
expect(accountRule).toContain("box-shadow: none;");
expect(toolGroupRule).toContain("gap: 2px;");
expect(toolGroupRule).toContain("padding: 2px;");
expect(groupedIconRule).toContain("height: 32px;");
expect(groupedIconRule).toContain("width: 32px;");
expect(groupedIconRule).toContain("box-shadow: none;");
expect(groupedIconRule).toContain("border-color: transparent;");
```

- [x] **Step 2: Run focused test and verify RED**

Run `npm --prefix app test -- src/App.css.test.ts`.
Expected: FAIL because no group wrapper/rules exist and the account chip is fixed at 92px.

- [x] **Step 3: Implement the semantic utility wrapper**

In `App.tsx`, leave the account and optional update button as siblings, then wrap only History,
Settings, and New Task:

```tsx
<div className="toolbar-tool-group" aria-label="任务工具">
  {/* existing History button unchanged */}
  {/* existing Settings button unchanged */}
  {/* existing New Task button unchanged */}
</div>
```

- [x] **Step 4: Implement compact scoped toolbar styles**

```css
.account-chip {
  background: rgba(255, 255, 255, 0.62);
  box-shadow: none;
  min-height: 32px;
  min-width: 0;
  padding: 0 9px;
}

.toolbar-tool-group {
  align-items: center;
  background: rgba(238, 241, 246, 0.72);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  display: flex;
  gap: 2px;
  padding: 2px;
}

.toolbar-tool-group .icon-button {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  height: 32px;
  min-height: 32px;
  width: 32px;
}
```

Add a scoped hover rule that uses the existing light-blue/neutral feedback and keeps the global
focus-visible rule. Do not modify handlers, labels, order, or disabled logic.

- [x] **Step 5: Run focused test and verify GREEN**

Run `npm --prefix app test -- src/App.css.test.ts`.
Expected: PASS.

### Task 4: Verify toolbar and History in real React/Chromium

**Files:**
- Modify: `app/tests/app-input.browser.test.ts`
- Evidence only: `.tmp/history-layout/history-layout-wide.png`
- Evidence only: `.tmp/history-layout/history-layout-narrow.png`
- Optional evidence only: `.tmp/task-workspaces/task-workspaces-wide.png`

- [x] **Step 1: Add toolbar geometry to an existing mounted-app smoke**

Collect:

```ts
const account = document.querySelector('.account-chip').getBoundingClientRect();
const group = document.querySelector('.toolbar-tool-group').getBoundingClientRect();
const tools = [...document.querySelectorAll('.toolbar-tool-group .icon-button')]
  .map((item) => item.getBoundingClientRect());
return {
  accountHeight: account.height,
  groupHeight: group.height,
  centerDelta: Math.abs((account.top + account.height / 2) - (group.top + group.height / 2)),
  toolCount: tools.length,
  toolSizeSpread: Math.max(...tools.map((rect) => rect.width)) - Math.min(...tools.map((rect) => rect.width)),
  toolbarContained: document.querySelector('.app-toolbar').scrollWidth <= document.querySelector('.app-toolbar').clientWidth + 1,
};
```

Assert account height 32, tool count 3, size spread at most 1 px, center delta at most 1 px, and
toolbar containment at 1366 and 720 px.

- [x] **Step 2: Capture deterministic screenshots**

Run the History smoke with `FRAMEQ_CAPTURE_HISTORY_LAYOUT=1` after removing the artificial height.
Capture wide and narrow screenshots. If toolbar capture is not included in those screenshots,
reuse the existing full-app task-workspace screenshot path without adding a new framework.

- [x] **Step 3: Run the full serial browser file**

Run `npm --prefix app test -- tests/app-input.browser.test.ts`.
Expected: every browser smoke passes without fixed sleeps, network, worker, LLM, payment, or source
URL secrets.

### Task 5: Documentation and final scoped gates

**Files:**
- Modify: `docs/DESIGN.md`
- Modify: `TASKS.md`
- Modify: this ExecPlan
- Move after all gates: this plan from `active/` to `completed/`
- Modify after all gates: `docs/exec-plans/active/index.md` and `docs/exec-plans/completed/index.md`
- Modify after all gates: product-spec status

- [x] **Step 1: Synchronize durable design rules**

Document intrinsic short-list sheets, long-list internal scrolling, 12/16/24 active-task rhythm,
700/700/650 heading hierarchy, and compact account plus grouped utilities. Keep the existing short
transcript-height rule.

- [x] **Step 2: Run complete scoped validation**

```powershell
npm --prefix app test
npm --prefix app run build
python scripts\validate_agents_docs.py --level WARN
git diff --check
git status --short
```

Expected: all app tests/build pass; docs validator has no blocking error; diff check is clean; git
status preserves all pre-existing unrelated changes and adds only approved app/docs files.

- [x] **Step 3: Close the plan only after evidence exists**

Record RED/GREEN outputs, browser geometry, screenshot paths, final counts, unrelated dirty files,
and residual risks. Mark the TASKS entry complete, update product-spec status, archive the plan,
and update both indexes. Do not commit or push unless separately requested.

## Validation and Acceptance

- `npm --prefix app test -- src/App.css.test.ts`
- `npm --prefix app test -- tests/app-input.browser.test.ts -t "history"`
- `npm --prefix app test -- tests/app-input.browser.test.ts`
- `npm --prefix app test`
- `npm --prefix app run build`
- `python scripts\validate_agents_docs.py --level WARN`
- `git diff --check`
- `git status --short`

Acceptance requires intrinsic short History height, long-list scrolling, exact typography and
spacing tokens, one compact utility group, unchanged accessible controls, no short-transcript
height change, and no modifications to worker/server/Rust/data/privacy behavior.
