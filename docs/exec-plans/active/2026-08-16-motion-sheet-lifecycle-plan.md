# Motion Sheet Lifecycle Implementation Plan

> **For agentic workers:** This plan is executed inline in the current workspace because the user's Motion dependency and first-phase UI changes are existing uncommitted work that must remain available.

**Goal:** Add accessible enter/exit Motion transitions to the five primary boolean/tab-controlled FrameQ Sheets without breaking modal focus ownership.

**Architecture:** `AnimatedSheet` owns presence, animation state, and the existing `useModalFocus` lifecycle. Feature Sheets continue to own their copy, controller actions, and content; they pass only shell props to the shared component. Nullable-object confirmation flows remain out of scope.

**Tech Stack:** React 19, TypeScript, Motion 13.1.0, Vitest, existing Tauri desktop modal CSS.

---

### Task 1: Shared AnimatedSheet lifecycle

**Files:**
- Create: `app/src/features/modal/AnimatedSheet.tsx`
- Create: `app/src/features/modal/AnimatedSheet.test.tsx`
- Modify: `app/src/uiMotion.ts`

- [x] Write a failing lifecycle-phase test for open, delayed close, and reopen-before-exit behavior before adding `AnimatedSheet`.
- [x] Verify the lifecycle test fails before `AnimatedSheet` exists.
- [x] Implement `AnimatedSheet` with presence state, Motion variants, stale-exit protection, and `useModalFocus(present)`.
- [x] Verify the focused shared-shell test passes.

### Task 2: Migrate Account, Settings, History, ASR Model, and AI Detail

**Files:**
- Modify: `app/src/features/account/AccountSheet.tsx`
- Modify: `app/src/features/settings/SettingsSheet.tsx`
- Modify: `app/src/features/history/HistorySheet.tsx`
- Modify: `app/src/features/asrModel/ModelGuideSheet.tsx`
- Modify: `app/src/features/results/AiResultDetailSheet.tsx`
- Modify: corresponding existing `*.test.tsx` files
- Modify: `app/src/features/modal/useModalFocus.coverage.test.ts`

- [x] Add regression assertions for `data-motion="sheet"` on all five migrated surfaces while preserving `aria-modal` and localized dialog content.
- [x] Replace each local backdrop/panel shell and local focus hook with `AnimatedSheet`, preserving feature-specific backdrop handlers and keyboard handlers.
- [x] Update the focus integration test to assert that the shared shell is the focus-manager owner and all five surfaces use it.
- [x] Verify all affected Sheet tests pass.

### Task 3: Styles and reduced-motion evidence

**Files:**
- Modify: `app/src/App.css`
- Modify: `app/src/App.css.test.ts`

- [x] Review the existing backdrop/panel geometry and reduced-motion rules for compatibility with Motion wrappers.
- [x] Keep the Phase 2 shell CSS-free: Motion owns only opacity/transform, while existing `sheet-backdrop` and `sheet-panel` styles remain authoritative.
- [x] Confirm the existing CSS regression suite remains green during focused and full verification.

### Task 4: Verification and plan evidence

**Files:**
- Modify: `docs/exec-plans/active/2026-08-16-motion-sheet-lifecycle-plan.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/product-specs/index.md`

- [x] Run focused modal/Sheet tests, full app tests, app lint, app build, and docs ERROR validation.
- [x] Confirm this task touched no worker, Rust, Tauri IPC, workflow state, persistence, or nullable confirmation-flow files.
- [x] Record results and residual risks in this plan.

## Progress

- 2026-08-16: Added the lifecycle spec and this implementation plan.
- 2026-08-16: Completed TDD red/green for the shared lifecycle phase resolver.
- 2026-08-16: Migrated Account, Settings, History, ASR model preparation, and AI result detail to `AnimatedSheet`.
- 2026-08-16: Added shared-shell and five-surface regression assertions; focused tests and lint pass.

## Decision Log

- Keep confirmation flows mounted by nullable-object ownership out of this increment; they need a separate lifecycle seam because their open state is not a simple boolean/tab contract.
- Use controlled Motion presence instead of `AnimatePresence` at the shell boundary. This lets `useModalFocus` stay active during the closing phase and restores focus only after the exit animation finishes.
- Preserve the last AI detail tab while closing so the exit animation never renders an empty or mismatched panel.
- Keep the existing modal CSS as the geometry source of truth; the shared shell adds only Motion opacity and transform values.

## Verification Record

- Focused modal/Sheet tests: pass (7 files, 61 tests).
- Full app tests: pass (76 files, 747 tests).
- App lint: pass.
- App build: pass; Vite reports the existing single-chunk size warning (844.91 kB minified).
- Docs ERROR validation: pass with 0 errors and 1 warning; the warning is the existing AGENTS.md line-count warning.
- `git diff --check`: pass; only existing line-ending and local Git ignore permission warnings were emitted.
- Residual risk: no packaged Tauri visual smoke test has been run on this host; browser/native animation timing remains covered by the lifecycle contract and static component tests.
