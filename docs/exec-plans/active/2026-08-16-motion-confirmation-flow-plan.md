# Motion Confirmation Flow Implementation Plan

> **For agentic workers:** This plan is executed inline in the current workspace because Motion and the prior Sheet lifecycle work are existing uncommitted changes that must remain available.

**Goal:** Extend `AnimatedSheet` to the three nullable-state confirmation flows without releasing focus or unmounting content before exit animation completion.

**Architecture:** Parent render ownership becomes unconditional for the three confirmation surfaces. `AnimatedSheet` owns presence and focus lifecycle; nullable feature components retain their last renderable snapshot only for the closing phase. Controllers and domain state remain authoritative.

**Tech Stack:** React 19, TypeScript, Motion 13.1.0, Vitest, existing modal CSS and `useModalFocus`.

---

### Task 1: Record scope and write failing coverage

**Files:**
- Create: `docs/product-specs/2026-08-16-motion-confirmation-flow.md`
- Create: `docs/exec-plans/active/2026-08-16-motion-confirmation-flow-plan.md`
- Modify: `docs/product-specs/index.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: affected Sheet tests and `useModalFocus.coverage.test.ts`

- [x] Record the nullable-flow lifecycle boundary in the product spec and this plan.
- [x] Add failing assertions that summary, preference, and dissection confirmation surfaces route through `AnimatedSheet`.
- [x] Verify the focused tests fail before migration.

### Task 2: Migrate summary confirmation

**Files:**
- Modify: `app/src/App.tsx`
- Modify: relevant modal focus coverage

- [x] Remove App-owned focus ref for the summary confirmation.
- [x] Render the summary confirmation shell unconditionally with `open={summaryConfirmOpen}`.
- [x] Preserve existing callbacks, disabled states, labels, and content.

### Task 3: Migrate nullable feature confirmation flows

**Files:**
- Modify: `app/src/features/insightPreferences/InsightPreferenceFlow.tsx`
- Modify: `app/src/features/dissection/TranscriptDissectionConfirmationSheet.tsx`
- Modify: corresponding tests

- [x] Keep each component mounted when its parent nullable value is absent.
- [x] Retain the last renderable flow/preview snapshot during close.
- [x] Replace local focus refs and modal shells with `AnimatedSheet`.
- [x] Preserve localized copy, confirmation semantics, and nested child behavior.

### Task 4: Verification and documentation evidence

**Files:**
- Modify: this plan

- [x] Run focused confirmation/modal tests.
- [x] Run full app tests, lint, build, docs ERROR validation, and `git diff --check`.
- [x] Confirm this task touched no worker, Rust, Tauri IPC, workflow-state, or persistence files.
- [x] Record results and residual risks.

## Progress

- 2026-08-16: Approved scope is the summary confirmation, Inspiration Profile / generation preferences flow, and transcript dissection confirmation.
- 2026-08-16: Added this spec and implementation plan; TDD coverage is next.
- 2026-08-16: Observed the expected RED state for the new Motion shell assertions.
- 2026-08-16: Migrated all three confirmation surfaces; focused confirmation/modal tests and app lint pass.

## Decision Log

- Keep the parent render path unconditional for nullable flows; conditional parent mounting would prevent `AnimatedSheet` from observing the exit lifecycle.
- Retain only the last renderable feature snapshot and use it during close; the current non-null value always wins during open/reopen.
- Keep History's nested permanent-delete confirmation on its existing local focus owner.

## Verification Record

- Focused confirmation/modal tests: pass (8 files, 70 tests).
- Full app tests: pass (76 files, 748 tests).
- App lint: pass; TypeScript and i18n literal checks passed.
- App build: pass; Vite reports the existing single-chunk size warning (844.51 kB minified).
- Docs ERROR validation: pass with 0 errors and 1 existing warning.
- `git diff --check`: pass; only existing line-ending and local Git ignore permission warnings were emitted.

## Residual Risk

- Native packaged Tauri visual smoke and reduced-motion behavior remain unverified on this host, consistent with the previous Motion phases.
