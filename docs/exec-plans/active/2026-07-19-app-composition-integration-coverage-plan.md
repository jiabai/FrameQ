# App Composition Integration Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining App composition-root coverage gaps for startup authentication deep
links and task artifact location using the existing real-browser smoke harness.

**Architecture:** Keep production `App.tsx` unchanged. Load the production `main.tsx` entrypoint in
the existing Vite + Chromium/CDP test, configure behavior only at the mock Tauri process boundary,
and assert both the command ledger and localized rendered state.

**Tech Stack:** React 19, TypeScript 5, Vitest 4, Vite 7, Chromium CDP, mocked Tauri IPC.

---

## Purpose / Big Picture

FrameQ already has real `<App />` browser coverage for task, History, transcript, AI, settings, and
account sign-out flows. This plan adds the two missing composition connections identified after
reviewing the audit finding: startup deep-link delivery and local artifact location. It deliberately
does not add jsdom, Testing Library, production dependency injection, or a second App test owner.

## Progress

- [x] 2026-07-19: Verified the audit against current code and found the existing browser suite
  mounts the production App and passes 25/25 at baseline.
- [x] 2026-07-19: Recorded the approved minimal design and alternatives in
  `docs/design-docs/2026-07-19-app-composition-integration-coverage.md`.
- [ ] 2026-07-19: Demonstrate deep-link RED, implement the bridge seam, add artifact-location
  characterization, run full gates, and archive this plan.

## Surprises & Discoveries

- The audit wording is stale: `app/tests/app-input.browser.test.ts` already loads `main.tsx` and
  renders `<App />` in real Chromium rather than testing only controllers.
- The existing scenario response map can model both missing paths without a new dependency. Only
  `plugin:deep-link|get_current` currently bypasses that map by returning an unconditional `[]`.

## Decision Log

- Decision: Extend the real-browser suite rather than add a mocked `App.test.tsx`. Rationale: it
  exercises the production entrypoint and all real controllers while preserving one App integration
  test owner. Date/Author: 2026-07-19, User + Codex.
- Decision: Keep production code unchanged. Rationale: both behaviors already exist; the missing
  asset is regression evidence at the composition boundary. Date/Author: 2026-07-19, Codex.

## Outcomes & Retrospective

Implementation results, exact test counts, warnings, and residual risks will be recorded before the
plan moves to `completed/`.

## File Structure

- `app/tests/app-input.browser.test.ts`: real-browser App lifecycle tests and command-ledger
  assertions.
- `app/tests/support/mockTauriBridge.ts`: deterministic Tauri IPC/event boundary used only by the
  browser smoke suite.
- `docs/design-docs/2026-07-19-app-composition-integration-coverage.md`: durable test-boundary
  decision.
- `docs/design-docs/frameq-code-audit-uml.md`: audit status and test ownership evidence.
- `TASKS.md`, `AGENTS.md`, ExecPlan indexes: living governance status.

## Task 1: Register the plan

**Files:**
- Create: `docs/exec-plans/active/2026-07-19-app-composition-integration-coverage-plan.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`

- [x] **Step 1: Register the active plan and task**

Add one active-index row, one unchecked technical-debt task linking the design and plan, and one
AGENTS quick-entry link. Do not mark the audit resolved yet.

- [ ] **Step 2: Validate and commit planning**

Run:

```powershell
python scripts\validate_agents_docs.py --level WARN
git diff --check
```

Expected: zero documentation errors/warnings and no whitespace errors.

Commit:

```powershell
git add AGENTS.md TASKS.md docs\exec-plans
git commit -m "docs(app): plan composition integration coverage"
```

## Task 2: Add real-browser App wiring coverage

**Files:**
- Modify: `app/tests/app-input.browser.test.ts`
- Modify: `app/tests/support/mockTauriBridge.ts`

- [ ] **Step 1: Write the startup deep-link test**

Add a test that opens the production App with this scenario response:

```ts
const callbackUrl =
  "frameq://auth/callback?code=ui-smoke-code&state=ui-smoke-state";
const page = await openUiSmokePage({
  responses: {
    "plugin:deep-link|get_current": [callbackUrl],
    complete_auth_flow: {
      authenticated: true,
      email: "ui-smoke@frameq.local",
      can_process: true,
      can_generate_ai: true,
    },
  },
});
```

Wait for `complete_auth_flow`, then require exactly one ledger entry with
`args.callbackUrl === callbackUrl`, no `Runtime.exceptionThrown`, a visible `.account-sheet`, and
the localized `登录已完成。` notice.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd test -- tests\app-input.browser.test.ts -t "routes a startup authentication deep link"
```

Expected: FAIL because `createUiSmokeBridgeScript` still returns `[]` for
`plugin:deep-link|get_current`, so `complete_auth_flow` is never invoked.

- [ ] **Step 3: Implement the minimal bridge seam**

Replace the unconditional response with a scenario-backed default:

```ts
if (command === "plugin:deep-link|get_current") {
  return Promise.resolve(
    scenario.responses["plugin:deep-link|get_current"] || [],
  );
}
```

Do not add a production API or change the default empty-list behavior.

- [ ] **Step 4: Run the focused deep-link test and verify GREEN**

Run the command from Step 2. Expected: one passing test and no runtime exception.

- [ ] **Step 5: Add the artifact-location characterization test**

Open the App with a successful `plugin:opener|reveal_item_in_dir: null` response, restore History
task `history-task-a`, click the `定位视频` button in `.local-artifact-toolbar`, and assert:

```ts
expect(openerCommands).toEqual([
  {
    command: "plugin:opener|reveal_item_in_dir",
    args: {
      paths: [
        "C:/FrameQ/outputs/tasks/history-task-a/media/video.mp4",
      ],
    },
  },
]);
```

Also require the localized `已在文件管理器中定位导出文件。` notice and no runtime exception. This
is a characterization test of existing production behavior; no production implementation is
expected.

- [ ] **Step 6: Run and commit focused coverage**

Run:

```powershell
npm.cmd test -- tests\app-input.browser.test.ts
```

Expected: 27/27 browser tests pass.

Commit:

```powershell
git add app\tests\app-input.browser.test.ts app\tests\support\mockTauriBridge.ts
git commit -m "test(app): cover composition root lifecycles"
```

## Task 3: Close the audit item

**Files:**
- Modify: `docs/design-docs/2026-07-19-app-composition-integration-coverage.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `TASKS.md`, `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`, `docs/exec-plans/completed/index.md`
- Move: this plan from `active/` to `completed/`

- [ ] **Step 1: Run complete app and governance gates**

```powershell
npm.cmd --prefix app test
npm.cmd --prefix app run lint
npm.cmd --prefix app run build
node --test scripts\tests\*.test.mjs
python scripts\validate_agents_docs.py --level WARN
git diff --check
```

Expected: zero failures. Record the exact app/browser/script counts and existing build warnings.

- [ ] **Step 2: Update durable evidence**

Mark the design Implemented, add the audit finding to the resolved table with the real-browser
ownership and both new lifecycle assertions, complete the TASKS item, record outcomes here, archive
the plan, and update AGENTS plus both indexes.

- [ ] **Step 3: Re-run governance and commit closeout**

```powershell
python scripts\validate_agents_docs.py --level WARN
git diff --check
git status --short
git diff --stat
```

Commit:

```powershell
git add AGENTS.md TASKS.md docs
git commit -m "docs(app): close composition integration coverage"
```

## Acceptance

- The production entrypoint mounts for both scenarios without runtime exceptions.
- One startup callback produces exactly one `complete_auth_flow` request with the unchanged URL.
- The account sheet reaches the localized completion state.
- Restored task `history-task-a` produces exactly one opener request for its video artifact path.
- Artifact location renders the localized success notice.
- Existing 25 browser cases and the complete app suite remain green.
- No production source, package dependency, Rust, worker, server, or wire contract changes.
