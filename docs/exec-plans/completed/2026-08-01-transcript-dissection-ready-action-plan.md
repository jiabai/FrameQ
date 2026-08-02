# Transcript Dissection Ready-State Action Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a generated transcript-dissection card expose only `查看结果`, while keeping the
explicit `重新解剖` action inside the report detail sheet.

**Architecture:** Preserve workflow state, confirmation, quota, worker, and artifact behavior.
Change only React rendering conditions, localized detail-action copy, focused tests, and durable UI
documentation.

**Tech Stack:** React, TypeScript, react-i18next, Vitest.

---

## Progress

- [x] Root cause confirmed: the generic card forced a dissection action in `ready`, while its label
  fell through to `确认生成`.
- [x] Product and design behavior updated before implementation with user approval.
- [x] Added RED tests for the ready card and detail-sheet redissection label; both failed for the
  expected old behavior.
- [x] Applied the minimal React/i18n fix and updated the browser lifecycle to redissection through
  the detail sheet.
- [x] Ran focused tests, full frontend tests, lint/build, governance, and diff checks; archived.

## Implementation

1. Extended `app/src/features/results/TaskWorkspaces.test.tsx` with a generated dissection fixture.
   Its card must contain `查看结果` but no `确认生成` action, and its detail sheet must contain
   `重新解剖`.
2. Changed `AiGenerationWorkspace.tsx` to render a generation action only while a target is not
   ready.
3. Added three-locale dissection-specific redissection copy and used it in
   `AiResultDetailSheet.tsx` with a stable browser selector.
4. Updated the browser lifecycle so stale redissection opens the report and starts again from the
   detail action. Failed redissection still retains the old view and card-level retry behavior.

## Verification Evidence

- RED: focused `TaskWorkspaces.test.tsx` produced exactly two expected assertion failures: the ready
  card contained `确认生成`, and the detail action contained `重新生成`.
- GREEN: focused workspace tests `20 passed`.
- Browser redissection lifecycle: `1 passed`, `30 skipped` under the focused name filter.
- Full frontend: `73` files, `666 passed`.
- `npm.cmd --prefix app run lint`: TypeScript and i18n literal checks passed.
- `npm.cmd --prefix app run build -- --configLoader runner`: production build passed; the existing
  709.55 kB chunk-size warning remains.
- `python scripts/validate_agents_docs.py --level WARN`: 0 errors, 0 warnings.
- `git diff --check`: exit 0; only line-ending conversion notices were emitted.
- The default Vite config bundler initially hit Windows `EPERM` in `node_modules/.vite-temp`; all
  Vitest/build evidence above used the supported `--configLoader runner` path and completed.

## Outcome

A successfully generated transcript-dissection card now has one action: `查看结果`. The report
detail sheet owns the explicit localized `重新解剖` action and reuses the unchanged confirmation,
quota, worker, cancellation, and atomic replacement flow.
