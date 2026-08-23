# Motion UI Enhancement Implementation Plan

> **For agentic workers:** This plan is executed inline in the current workspace because the user-installed Motion dependency is an existing uncommitted change that must remain available. Steps are tracked here and validated before delivery.

**Goal:** Add restrained, accessible Motion transitions to FrameQ's local processing, ASR download, AI target, and history interfaces.

**Architecture:** Motion stays in React presentation components. The existing workflow/view-model/controller contracts remain authoritative; animation props map already-derived state to opacity, layout, and progress transitions. No worker, Tauri IPC, persistence, or domain state changes are included.

**Tech Stack:** React 19, TypeScript, Motion 13.1.0, Vitest, existing CSS reduced-motion rules.

---

### Task 1: Motion root configuration

**Files:**
- Modify: `app/src/main.tsx`
- Test: `app/src/App.css.test.ts` or a focused root-render test if needed

- [x] Record the approved scope in the product spec and this plan.
- [x] Add `MotionConfig reducedMotion="user"` around the mounted `App` without changing the locale startup boundary.
- [x] Run the existing app test suite to confirm the root wrapper does not alter startup behavior.

### Task 2: Local processing stage and task banner motion

**Files:**
- Modify: `app/src/features/transcript/LocalTranscriptWorkspace.tsx`
- Modify: `app/src/features/results/TaskStatusBanner.tsx`
- Test: `app/src/features/results/TaskWorkspaces.test.tsx`

- [x] Add assertions that the semantic stage markup, active loader, and live status region remain present after the Motion wrapper is rendered.
- [x] Verify the new assertions fail before adding Motion.
- [x] Add short `AnimatePresence`/`layout` transitions around stage status content without changing stage derivation.
- [x] Verify focused workspace tests pass.

### Task 3: ASR real progress animation

**Files:**
- Modify: `app/src/features/asrModel/ModelGuideSheet.tsx`
- Test: `app/src/features/asrModel/ModelGuideSheet.test.tsx`

- [x] Add a focused assertion for the accessible progressbar and the real percentage value.
- [x] Verify it fails if the progress element is not Motion-backed.
- [x] Animate only the progress fill width from the existing clamped value and preserve current copy, aria attributes, and stalled/cancel behavior.
- [x] Verify focused model-guide tests pass.

### Task 4: AI target layout/state motion

**Files:**
- Modify: `app/src/features/results/AiGenerationWorkspace.tsx`
- Test: `app/src/features/results/TaskWorkspaces.test.tsx`

- [x] Add assertions for target identity and generating/failed/ready status content.
- [x] Verify they fail before the Motion layout wrapper exists.
- [x] Add `layout` to target rows and use `AnimatePresence` only around optional error/progress/action content; keep all existing buttons and labels.
- [x] Verify focused workspace tests pass.

### Task 5: History list layout motion

**Files:**
- Modify: `app/src/features/history/HistorySheet.tsx`
- Test: `app/src/features/history/HistorySheet.test.tsx`

- [x] Add an assertion that rendered history items retain their stable task IDs and are not keyed by array index.
- [x] Verify it fails if the list is changed to an unstable key.
- [x] Add `layout` and `AnimatePresence mode="popLayout"` around confirmed list-item removal while preserving the current modal/focus behavior.
- [x] Verify focused history tests pass.

### Task 6: Verification and documentation evidence

**Files:**
- Modify: `docs/exec-plans/active/2026-08-16-motion-ui-enhancement-plan.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/product-specs/index.md`

- [x] Run focused tests, full app tests, app lint, and app build.
- [x] Run `python scripts/validate_agents_docs.py --level ERROR`.
- [x] Update this plan with completed tasks, commands, and residual risks.
- [x] Confirm the final diff contains no worker, Rust, Tauri IPC, workflow-state, or persistence changes.

### Task 7: New-task input workspace entry

**Files:**
- Modify: `app/src/App.tsx`
- Test: `app/tests/app-input.browser.test.ts`
- Modify: `docs/product-specs/2026-08-16-motion-ui-enhancement.md`
- Modify: `docs/exec-plans/active/2026-08-16-motion-ui-enhancement-plan.md`

- [x] Add a browser regression assertion that the initial waiting page has no reset-specific entry animation, while the toolbar reset mounts the input workspace with the marker.
- [x] Verify the new assertion fails before the Motion entry wrapper exists.
- [x] Add a local `motion.div` around the waiting input workspace with `opacity: 0 → 1`, a small upward offset, `UI_MOTION_TRANSITION`, and `MotionConfig reducedMotion="user"` inheritance; arm the entry only from the toolbar reset so the initial mount stays static.
- [x] Keep the existing workflow reset synchronous and do not animate or delay the task state controller.
- [x] Verify reduced-motion mode leaves the input workspace immediately usable.

## Progress

- 2026-08-16: Added shared Motion timing constants and root `MotionConfig` with user reduced-motion preference.
- 2026-08-16: Added stage/banner, ASR progress, AI target, and History list Motion wrappers. Kept controller/view-model contracts unchanged.
- 2026-08-16: Added regression assertions for Motion mount points and accessibility-preserving markup. RED was observed before implementation; focused tests then passed.
- 2026-08-16: Approved a restrained new-task input entry: one 180–220ms ease-out fade/translate transition on reset only; initial app mount and task state semantics remain unchanged.
- 2026-08-16: Implemented the entry with a local, reset-armed waiting-workspace Motion wrapper. The task workspace branch keeps its existing DOM structure, while the initial mount remains static and the reset stays synchronous.

## Decision Log

- Use Motion only where a semantic lifecycle or layout change is already present. Keep CSS spinner behavior for active worker signals.
- Keep the existing inline progress width so server/worker truth and SSR/static markup remain visible; disable the old CSS width transition only for the Motion-owned ASR fill.
- Defer modal enter/exit animation because `useModalFocus` owns focus trapping, inert background state, and restoration. It needs a separate integration test before animation is added.
- Keep the new-task entry local to the waiting workspace branch; do not animate the whole desktop shell or add a route-like transition to the task controller.

## Verification Record

- `npm.cmd --prefix app test -- src/features/asrModel/ModelGuideSheet.test.tsx src/features/results/TaskWorkspaces.test.tsx src/features/history/HistorySheet.test.tsx` — 3 files, 48 tests passed.
- `npm.cmd --prefix app test -- src/App.css.test.ts` — 22 tests passed.
- `npm.cmd --prefix app test` — 75 files, 743 tests passed.
- `npm.cmd --prefix app test -- tests/app-input.browser.test.ts -t "animates the input workspace when starting a new task"` — 1 test passed, including reduced-motion coverage.
- `npm.cmd --prefix app test -- tests/app-input.browser.test.ts -t "shows the processing workspace only after the URL is submitted"` — 1 test passed; existing task workspace layout remains intact.
- `npm.cmd --prefix app test` — 76 files, 750 tests passed.
- A repeated full-suite run intermittently timed out in the pre-existing controller-owned lifecycle smoke at `save_default_generation_preferences`; the same test passed in isolation and a subsequent complete run passed 76/750.
- `npm.cmd --prefix app run lint` — TypeScript and i18n literal checks passed.
- `npm.cmd --prefix app run build` — Vite production build passed; existing single-chunk size warning remains.
- `python scripts/validate_agents_docs.py --level ERROR` — 0 errors, 1 existing warning.
- `git diff --check` — no whitespace errors.

## Residual Risk

- Native Tauri visual smoke and reduced-motion behavior have not been manually exercised in a packaged desktop build.
- The controller-owned lifecycle browser smoke has an intermittent full-suite timing failure unrelated to the new-task entry; keep that existing test under observation.
- Modal enter/exit motion remains intentionally out of scope until it can be integrated with the existing focus lifecycle.
- The build still reports a non-blocking bundle-size warning after adding Motion; code splitting is deferred.
