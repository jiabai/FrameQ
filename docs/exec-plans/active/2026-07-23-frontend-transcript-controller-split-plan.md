# Frontend Transcript Controller Split Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task-by-task. Use `superpowers:test-driven-development` for characterization and boundary
> tests, and `superpowers:verification-before-completion` before any completion claim. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 509-line frontend transcript-detail hook into a stable facade plus focused
artifact-detail, transcript-document, and audio-review owners without changing its public controller
shape, IPC, user-visible behavior, or task-identity protections.

**Architecture:** `useTranscriptDetailController.ts` remains the only production controller import
used by `App.tsx` and presentation components. It composes three private hooks and flattens their
existing fields/actions into the current return surface; `useTaskProcessingController` remains the
sole workflow/task-identity owner.

**Tech Stack:** React 19 hooks, TypeScript 5.8, Vitest 4, Vite 7, Tauri v2 frontend APIs,
Chromium/CDP browser smoke, FrameQ i18n message codes, Markdown governance documentation.

---

## Purpose / Big Picture

FrameQ users should observe no intentional change. The local transcript still loads from the same
validated Tauri command, supports the same audio review and editing interactions, copies the current
draft, locates only the saved official transcript, rejects stale task callbacks, and merges a
successful save through the existing workflow controller. Summary and inspiration detail sheets
continue using the same open/close/copy/export controller fields.

The improvement is internal: task-scoped document persistence, browser audio/edit-session effects,
and generic artifact-detail actions gain focused owners and independent tests. `App.tsx` stays a
composition root and does not absorb transcript business state.

This plan does not change a product spec, add local-media runtime support, alter the Rust
transcript-detail module, introduce a nested public controller API, or add a new state library.

## Progress

- [x] 2026-07-23: Re-inspected the current controller, its callers, focused unit coverage, real
  browser transcript coverage, task-identity architecture/security rules, active plans, audit
  hotspots, and existing module-split conventions. Validation: source/caller/test scans and measured
  509 physical lines with 12 state cells, 5 refs, 3 effects, and 20 callback definitions.
- [x] 2026-07-23: Created isolated worktree
  `.worktrees/transcript-controller-split` on branch
  `codex/transcript-controller-split` from clean `main` commit `2dc663b`; installed App dependencies
  inside the ignored worktree. Validation: `git check-ignore -v .worktrees`, `git worktree list`,
  `git status --short --branch`, and `npm.cmd --prefix app ci --ignore-scripts`.
- [x] 2026-07-23: Recorded and obtained user approval for the written design in
  `docs/design-docs/2026-07-23-frontend-transcript-controller-split.md`. Validation: design commit
  `8499bac`, governance 0 errors/0 warnings, cached diff check, and clean worktree.
- [x] 2026-07-23: Established the pre-implementation focused baseline. Validation:
  `npm.cmd --prefix app test -- src/features/transcript/useTranscriptDetailController.test.ts`
  passed 1 file / 4 tests.
- [x] 2026-07-23: Registered this active ExecPlan, its task, and navigation entries without
  changing production code. Validation: governance, placeholder scan, staged diff check, and clean
  post-commit status recorded in the planning handoff.
- [x] 2026-07-23: Locked the facade's exact 41-key public surface and cross-owner load, stale
  completion, edit/save, artifact-action, audio-review, and safe-notice behavior before moving
  production code. Validation:
  `npm.cmd --prefix app test -- src/features/transcript/useTranscriptDetailController.test.ts`
  passed 1 file / 18 tests.
- [x] 2026-07-23: Established the planned source-ownership RED. Validation:
  `npm.cmd --prefix app test -- src/features/transcript/transcriptControllerBoundary.test.ts`
  failed for the intended reason: the first approved private owner,
  `../results/useArtifactDetailController.ts`, does not yet exist.
- [x] 2026-07-23: Extracted result-detail tab, clipboard, and saved-artifact location behavior into
  `useArtifactDetailController` while preserving the facade projection. Validation: focused facade
  1 file / 18 tests and App lint passed; the intentional ownership RED advanced to the next missing
  owner, `useTranscriptDocumentController.ts`.
- [x] 2026-07-23: Extracted task-scoped transcript loading, draft/segment state, save IPC, stale
  completion guard, and workflow merge into `useTranscriptDocumentController`; kept the temporary
  review reset and save continuation in the facade. Validation: focused facade 1 file / 18 tests
  and App lint passed; the intentional ownership RED advanced to the final missing owner,
  `useTranscriptReviewSession.ts`.
- [x] 2026-07-23: Proved the cross-task pending-resume defect with a focused RED, then extracted
  task-scoped audio/edit state into `useTranscriptReviewSession` and reset ephemeral resume intent
  on review identity changes. Validation: regression 1/1, facade 1 file / 19 tests, ownership 1
  file / 1 test, and App lint passed. Boundary-test physical sizes are facade 126, artifact owner
  139, document owner 199, and review owner 250 lines. The protected App, presentation, client,
  Tauri, worker, server, and contract diff is empty.
- [x] 2026-07-23: Completed real-browser, full App, build, repository-script, governance, and scope
  regression. Validation: selected Chromium 4 passed / 24 skipped; complete App 65 files / 583
  tests; App lint; production build; Node repository scripts 25/25; governance 0 errors / 0
  warnings; and `git diff --check` all passed. Vite retained its existing non-blocking 665.20 kB
  chunk-size warning.

## Surprises & Discoveries

- The hook name understates its scope: it also owns the summary/inspiration detail tab, clipboard,
  and artifact-location actions used by `AiResultDetailSheet`. Evidence:
  `app/src/features/results/AiResultDetailSheet.tsx` imports the facade type and consumes
  `detailTab`, `closeDetail`, `copyDetail`, `exportDetail`, and `exportPath`.
- The current focused hook suite has only four tests; high-risk task-switch and real React/DOM
  behavior is covered separately in the Chromium suite. Evidence:
  `useTranscriptDetailController.test.ts` passes 4/4, while
  `app-input.browser.test.ts` covers delayed save, segment Escape, audio workspace, and
  transcript-during-AI behavior.
- The controller's flat inferred return type is a compatibility surface even though it is not an
  IPC contract. Evidence: `App.tsx`, `TranscriptReviewPanel`, `LocalTranscriptWorkspace`, and
  `AiResultDetailSheet` all import the same `TranscriptDetailController` alias.
- The active local-media plan names `App.tsx` and workflow state as future consumers but does not
  currently reference `useTranscriptDetailController`. Evidence: the active plan's frontend
  orientation lists App/workflow/worker client only, and a repository search finds no transcript
  controller path in that plan.
- Pending audio-resume intent is currently cleared by explicit end-edit but not directly assigned
  during the task-change load reset. The approved task-scoped review design requires the intent to
  reset with review identity so it can never leak into a later task. Evidence:
  `resumeTranscriptAfterSaveRef` is set in `beginTranscriptSegmentEdit`, cleared in
  `endTranscriptSegmentEdit`, successful resume, and deletion preparation, while the load effect
  resets active/editing IDs only.
- The full App suite contained a source-coupled style assertion that read
  `useTranscriptDetailController.ts` directly to locate `--audio-progress`. After ownership moved,
  the first full run passed 582/583 and failed only this stale fixture path. Updating the fixture to
  read `useTranscriptReviewSession.ts` preserved the assertion and produced 21/21 focused CSS tests
  followed by 583/583 complete App tests.

## Decision Log

- Decision: Keep `useTranscriptDetailController.ts` as the stable public facade with the exact
  current flat return projection. Rationale: this isolates implementation responsibilities without
  forcing simultaneous changes across App and three presentation consumers. Date/Author:
  2026-07-23, User + Codex.
- Decision: Extract `useArtifactDetailController`,
  `useTranscriptDocumentController`, and `useTranscriptReviewSession` by failure/state ownership.
  Rationale: clipboard/location, task persistence, and browser media/edit effects have different
  dependencies and recovery behavior. Date/Author: 2026-07-23, User + Codex.
- Decision: Keep child-to-child imports forbidden and perform successful-save handoff in the
  facade. Rationale: explicit composition prevents a second task owner or circular hook dependency.
  Date/Author: 2026-07-23, User + Codex.
- Decision: Keep focused behavior tests at the stable facade where sequencing crosses owners, and
  add one source-boundary test for physical ownership. Rationale: duplicating the custom hook
  harness in every child test would add test infrastructure without improving behavioral evidence.
  Date/Author: 2026-07-23, Codex.
- Decision: Reset pending playback-resume intent when review task identity changes. Rationale: the
  intent is task-local ephemeral state; retaining it across tasks conflicts with the existing
  desktop task-identity isolation boundary. This is a correctness hardening of intended behavior,
  not a new product feature. Date/Author: 2026-07-23, User + Codex.
- Decision: Do not update a product spec or add dependencies. Rationale: the refactor changes
  internal ownership only and uses existing React/Vitest/Tauri capabilities. Date/Author:
  2026-07-23, Codex.
- Decision: Retarget the existing audio style source assertion to the new review-session owner
  rather than weakening or deleting it. Rationale: `--audio-progress` remains required behavior;
  only its approved implementation owner changed. Date/Author: 2026-07-23, Codex.

## Outcomes & Retrospective

Planning is complete; production implementation has not started. The approved target is one stable
facade below 200 physical lines, three focused private hooks below 250 production lines each unless
measured evidence justifies otherwise, and preserved App/presentation call sites.

Residual risk before implementation: the lightweight hook harness does not reproduce every React
scheduling detail, so the full App suite and focused real-browser cases remain mandatory. Native
Tauri filesystem/path behavior is unchanged and is not scheduled for a new native smoke unless the
implementation unexpectedly touches IPC, asset scope, permissions, or packaged runtime code.

## Context and Orientation

- Approved design:
  `docs/design-docs/2026-07-23-frontend-transcript-controller-split.md`.
- Stable public facade and current mixed implementation:
  `app/src/features/transcript/useTranscriptDetailController.ts`.
- Focused hook harness and current behavior tests:
  `app/src/features/transcript/useTranscriptDetailController.test.ts`.
- Planned ownership test:
  `app/src/features/transcript/transcriptControllerBoundary.test.ts`.
- Presentation consumers:
  `app/src/features/transcript/TranscriptReviewPanel.tsx`,
  `app/src/features/transcript/LocalTranscriptWorkspace.tsx`, and
  `app/src/features/results/AiResultDetailSheet.tsx`.
- App composition and workflow merge:
  `app/src/App.tsx` and
  `app/src/features/workflow/useTaskProcessingController.ts`.
- Existing Tauri client:
  `app/src/transcriptDetailClient.ts`.
- Existing pure policies:
  `app/src/transcriptReviewState.ts`,
  `app/src/audioReviewBarState.ts`, and
  `app/src/taskArtifacts.ts`.
- Real React/browser integration:
  `app/tests/app-input.browser.test.ts` and
  `app/tests/support/mockTauriBridge.ts`.
- Tauri trust boundary, unchanged:
  `app/src-tauri/src/transcript_detail.rs` and its private children.
- Durable boundaries:
  `docs/ARCHITECTURE.md`,
  `docs/DESIGN.md`,
  `docs/SECURITY.md`, and
  `docs/design-docs/frameq-code-audit-uml.md`.

## File Responsibility Map

| File | Responsibility after implementation |
|---|---|
| `app/src/features/transcript/useTranscriptDetailController.ts` | stable options/type export, child composition, successful-save continuation wiring, exact flat public projection |
| `app/src/features/results/useArtifactDetailController.ts` | result-detail tab state, locale-aware copy text, current saved paths, clipboard, and `revealItemInDir` actions |
| `app/src/features/transcript/useTranscriptDocumentController.ts` | task-scoped detail load/fallback, draft/segments/dirty/loading/saving, semantic edits, save IPC, stale-result guard, workflow merge |
| `app/src/features/transcript/useTranscriptReviewSession.ts` | audio/segment refs, asset URL, timeline/playback, active/editing segment, scrub/follow/scroll, edit pause/resume, deletion release |
| `app/src/features/transcript/useTranscriptDetailController.test.ts` | facade behavior and cross-owner load/edit/save/task-switch characterization |
| `app/src/features/transcript/transcriptControllerBoundary.test.ts` | physical owners, forbidden dependencies, stable consumer import surface, final size constraints |

The following production files should have no intentional diff:
`app/src/App.tsx`,
`TranscriptReviewPanel.tsx`,
`LocalTranscriptWorkspace.tsx`,
`AiResultDetailSheet.tsx`,
`transcriptDetailClient.ts`,
all `app/src-tauri/`,
`worker/`,
`server/`, and
`contracts/`.

## Plan of Work

### Task 1: Register the Approved Plan

**Files:**

- Create: `docs/exec-plans/active/2026-07-23-frontend-transcript-controller-split-plan.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/design-docs/2026-07-23-frontend-transcript-controller-split.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`

- [x] **Step 1: Mark the design approved for planning**

Change the design status to:

```markdown
**Status:** Approved for implementation planning on 2026-07-23
```

- [x] **Step 2: Register one active plan and task**

Add the active-index focus:

```markdown
| `2026-07-23-frontend-transcript-controller-split-plan.md` | Split the stable frontend transcript-detail facade into focused artifact-detail, task-document, and audio-review owners without behavior or IPC changes. |
```

Add one unchecked `TASKS.md` entry linking the design and this plan. Register the plan in the
`AGENTS.md` quick-entry map.

- [x] **Step 3: Validate and commit planning**

Run:

```powershell
python scripts\validate_agents_docs.py --level WARN
rg -n "T[B]D|T[O]DO|implement[ ]later|fill[ ]in[ ]details|待[定]|稍后[实]现" docs\exec-plans\active\2026-07-23-frontend-transcript-controller-split-plan.md
git diff --check
```

Expected: governance reports 0 errors and 0 warnings; the placeholder scan returns no matches; the
diff check reports no whitespace errors.

Commit:

```powershell
git add AGENTS.md TASKS.md docs\design-docs\2026-07-23-frontend-transcript-controller-split.md docs\exec-plans\active
git commit -m "docs(app): plan transcript controller split"
```

### Task 2: Lock the Public Surface and Cross-Owner Behavior

**Files:**

- Modify: `app/src/features/transcript/useTranscriptDetailController.test.ts`

- [x] **Step 1: Make the existing hook harness task-mutable**

Keep the current local React hook harness and extend `createController` with a mutable workflow and
optional initial-load wait:

```ts
type ControllerHarness = {
  render: () => TranscriptDetailController;
  setWorkflow: (next: WorkflowState) => TranscriptDetailController;
  applyTranscriptSave: ReturnType<typeof vi.fn>;
  setActionNotice: ReturnType<typeof vi.fn>;
};

async function createController({
  initialWorkflow = readyWorkflow(),
  waitForInitialLoad = true,
}: {
  initialWorkflow?: WorkflowState;
  waitForInitialLoad?: boolean;
} = {}): Promise<ControllerHarness> {
  const harness = createHookHarness();
  vi.doMock("react", () => ({
    useCallback: harness.useCallback,
    useEffect: harness.useEffect,
    useRef: harness.useRef,
    useState: harness.useState,
  }));
  const { useTranscriptDetailController } = await import(
    "./useTranscriptDetailController"
  );
  const applyTranscriptSave = vi.fn();
  const setActionNotice = vi.fn<
    (value: SetStateAction<UiMessage | null>) => void
  >();
  let workflow = initialWorkflow;
  const render = () => {
    harness.resetRender();
    return useTranscriptDetailController({
      workflow,
      locale: "zh-CN",
      applyTranscriptSave,
      setActionNotice,
    });
  };
  const setWorkflow = (next: WorkflowState) => {
    workflow = next;
    return render();
  };

  render();
  if (waitForInitialLoad) {
    await vi.waitFor(() => expect(mocks.loadTranscriptDetail).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(render().transcriptSegments).toHaveLength(1));
  }
  return { render, setWorkflow, applyTranscriptSave, setActionNotice };
}
```

- [x] **Step 2: Add exact public-key characterization**

Render the ready controller and assert the sorted keys equal the current 41-key projection:

```ts
expect(Object.keys(render()).sort()).toEqual([
  "activeTranscriptSegmentId",
  "beginTranscriptSegmentEdit",
  "closeDetail",
  "copyDetail",
  "copyTranscript",
  "currentTranscriptPath",
  "detailTab",
  "detailText",
  "editingTranscriptSegmentId",
  "endTranscriptSegmentEdit",
  "exportDetail",
  "exportPath",
  "exportTranscript",
  "handleTranscriptAudioMetadata",
  "handleTranscriptAudioPause",
  "handleTranscriptAudioPlay",
  "handleTranscriptTimeUpdate",
  "hasTranscriptSegments",
  "openDetailTab",
  "playTranscriptSegment",
  "prepareTranscriptForTaskDeletion",
  "saveTranscriptDraft",
  "scrubTranscriptAudio",
  "toggleTranscriptAudio",
  "transcriptAudioCurrentTime",
  "transcriptAudioDuration",
  "transcriptAudioPlaying",
  "transcriptAudioProgress",
  "transcriptAudioRef",
  "transcriptAudioScrubberMax",
  "transcriptAudioScrubberStyle",
  "transcriptAudioSrc",
  "transcriptDetail",
  "transcriptDirty",
  "transcriptDraft",
  "transcriptLoading",
  "transcriptSaving",
  "transcriptSegmentRefs",
  "transcriptSegments",
  "updateFullTranscriptDraft",
  "updateTranscriptSegmentDraft",
].sort());
```

- [x] **Step 3: Characterize load reset, deduplication, fallback, and stale completion**

Add tests with these exact outcomes:

```ts
test("does not load without a current official transcript and resets review state", async () => {
  const workflow = {
    ...readyWorkflow(),
    taskId: null,
    text: "Workflow fallback",
    artifacts: {},
  };
  const { render } = await createController({
    initialWorkflow: workflow,
    waitForInitialLoad: false,
  });

  expect(mocks.loadTranscriptDetail).not.toHaveBeenCalled();
  expect(render().transcriptDraft).toBe("Workflow fallback");
  expect(render().transcriptSegments).toEqual([]);
  expect(render().transcriptDirty).toBe(false);
});

test("does not reload an already loaded task on an equivalent rerender", async () => {
  const { render } = await createController();
  render();
  render();
  expect(mocks.loadTranscriptDetail).toHaveBeenCalledTimes(1);
});

test("keeps workflow text and a fixed notice when detail loading fails", async () => {
  mocks.loadTranscriptDetail.mockRejectedValueOnce(
    new Error("C:/private/transcript.txt Authorization: secret"),
  );
  const { render, setActionNotice } = await createController({
    waitForInitialLoad: false,
  });
  await vi.waitFor(() =>
    expect(setActionNotice).toHaveBeenCalledWith({
      messageCode: "transcript.notice.detailLoadFallback",
    }),
  );
  expect(render().transcriptDraft).toBe("第一段原稿。");
  expect(JSON.stringify(setActionNotice.mock.calls)).not.toContain("C:/private");
  expect(JSON.stringify(setActionNotice.mock.calls)).not.toContain("secret");
});

test("keeps editing available with the fixed no-audio notice", async () => {
  mocks.loadTranscriptDetail.mockResolvedValueOnce({
    task_id: "task-escape",
    text: "第一段原稿。",
    segments: [],
    audio_path: null,
    audio_asset_path: null,
    has_original_backup: false,
  });
  const { render, setActionNotice } = await createController({
    waitForInitialLoad: false,
  });
  await vi.waitFor(() =>
    expect(setActionNotice).toHaveBeenCalledWith({
      messageCode: "transcript.notice.audioUnavailableEdit",
    }),
  );
  expect(render().transcriptDraft).toBe("第一段原稿。");
  expect(render().transcriptAudioSrc).toBe("");
});
```

For the stale-load case, use a deferred first promise, switch to a second ready workflow with
`taskId: "task-b"` and `text: "任务 B 文字稿"`, resolve task B first, then resolve task A. Assert
the final draft and detail task ID remain task B and task A's late result produces no notice.

- [x] **Step 4: Characterize save identity and positive resume**

Add one stale-save test that starts a deferred save for task A, changes the workflow to task B,
resolves task A, and asserts:

```ts
expect(render().transcriptDraft).toBe("任务 B 文字稿");
expect(applyTranscriptSave).not.toHaveBeenCalled();
expect(setActionNotice).not.toHaveBeenCalledWith({
  messageCode: "transcript.notice.saved",
});
expect(audio.play).not.toHaveBeenCalled();
```

Add one positive resume test: attach a playing audio double, begin segment edit, change the draft,
save successfully, and require one `pause`, one `play`, cleared edit state, cleared dirty state,
and one `applyTranscriptSave("task-escape", saved)` call.

- [x] **Step 5: Characterize artifact actions and audio review**

Expose `mocks.revealItemInDir` from the opener mock and stub
`navigator.clipboard.writeText`. Add assertions that:

- transcript copy writes the current unsaved draft;
- dirty transcript export does not call `revealItemInDir` and emits
  `transcript.notice.unsavedLocate`;
- a clean transcript export reveals the existing `currentTranscriptPath`;
- rejected clipboard/opener promises emit fixed message codes without rejection text;
- clicking a segment sets `audio.currentTime` to `start_ms / 1000` and calls `play`;
- clicking the active playing segment pauses instead of replaying;
- scrubbing clamps time and updates the active segment; and
- autoplay/playback rejection emits only the existing fixed message code.

- [x] **Step 6: Run the expanded facade suite**

Run:

```powershell
npm.cmd --prefix app test -- src/features/transcript/useTranscriptDetailController.test.ts
```

Expected: the original 4 tests and all new characterization tests pass before production movement.
Record the exact total in Progress.

- [x] **Step 7: Commit characterization**

```powershell
git add app\src\features\transcript\useTranscriptDetailController.test.ts
git commit -m "test(app): characterize transcript controller boundaries"
```

### Task 3: Establish the Module-Ownership RED

**Files:**

- Create: `app/src/features/transcript/transcriptControllerBoundary.test.ts`

- [x] **Step 1: Add the source-boundary test**

Create this test with real source paths and fixed owner assertions:

```ts
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const sourcePath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));
const readSource = (relativePath: string) =>
  readFileSync(sourcePath(relativePath), "utf8");

describe("frontend transcript controller ownership", () => {
  test("matches the approved private owners and stable consumer surface", () => {
    const expectedOwners = [
      "../results/useArtifactDetailController.ts",
      "./useTranscriptDocumentController.ts",
      "./useTranscriptReviewSession.ts",
    ];
    for (const owner of expectedOwners) {
      expect(existsSync(sourcePath(owner)), owner).toBe(true);
    }

    const root = readSource("./useTranscriptDetailController.ts");
    const artifact = readSource("../results/useArtifactDetailController.ts");
    const document = readSource("./useTranscriptDocumentController.ts");
    const review = readSource("./useTranscriptReviewSession.ts");

    expect(root).toContain("useArtifactDetailController");
    expect(root).toContain("useTranscriptDocumentController");
    expect(root).toContain("useTranscriptReviewSession");
    expect(root).not.toContain("loadTranscriptDetail");
    expect(root).not.toContain("saveTranscriptEdit");
    expect(root).not.toContain("convertFileSrc");
    expect(root).not.toContain("revealItemInDir");

    expect(artifact).toContain("revealItemInDir");
    expect(artifact).toContain("navigator.clipboard.writeText");
    expect(artifact).not.toContain("loadTranscriptDetail");
    expect(artifact).not.toContain("convertFileSrc");

    expect(document).toContain("loadTranscriptDetail");
    expect(document).toContain("saveTranscriptEdit");
    expect(document).not.toContain("convertFileSrc");
    expect(document).not.toContain("revealItemInDir");

    expect(review).toContain("convertFileSrc");
    expect(review).not.toContain("loadTranscriptDetail");
    expect(review).not.toContain("saveTranscriptEdit");
    expect(review).not.toContain("revealItemInDir");

    const consumers = [
      "../../App.tsx",
      "./LocalTranscriptWorkspace.tsx",
      "./TranscriptReviewPanel.tsx",
      "../results/AiResultDetailSheet.tsx",
    ];
    for (const consumer of consumers) {
      const source = readSource(consumer);
      expect(source).not.toContain("useTranscriptDocumentController");
      expect(source).not.toContain("useTranscriptReviewSession");
      expect(source).not.toContain("useArtifactDetailController");
    }
  });
});
```

- [x] **Step 2: Run the ownership test and verify RED**

```powershell
npm.cmd --prefix app test -- src/features/transcript/transcriptControllerBoundary.test.ts
```

Expected: FAIL because the three approved owner files do not exist. The failure must identify the
first missing owner path; a TypeScript/compiler/configuration failure is not valid RED evidence.

- [x] **Step 3: Commit the RED boundary**

```powershell
git add app\src\features\transcript\transcriptControllerBoundary.test.ts
git commit -m "test(app): lock transcript controller ownership"
```

The branch intentionally has one focused boundary RED until Tasks 4-6 create all owners. During
that interval, run the behavior file separately after every extraction; do not skip or weaken the
boundary test.

### Task 4: Extract Artifact Detail Actions

**Files:**

- Create: `app/src/features/results/useArtifactDetailController.ts`
- Modify: `app/src/features/transcript/useTranscriptDetailController.ts`
- Test: `app/src/features/transcript/useTranscriptDetailController.test.ts`

- [x] **Step 1: Create the artifact-detail owner**

Implement this private hook signature:

```ts
type UseArtifactDetailControllerOptions = {
  workflow: WorkflowState;
  locale: SupportedLocale;
  transcriptDraft: string;
  transcriptDirty: boolean;
  setActionNotice: Dispatch<SetStateAction<UiMessage | null>>;
};

export function useArtifactDetailController({
  workflow,
  locale,
  transcriptDraft,
  transcriptDirty,
  setActionNotice,
}: UseArtifactDetailControllerOptions) {
  const [detailTab, setDetailTab] = useState<DetailTab | null>(null);
  const openDetailTab = useCallback((tab: DetailTab | null) => {
    setDetailTab(tab);
  }, []);
  const closeDetail = useCallback(() => {
    setDetailTab(null);
  }, []);

  const detailText =
    detailTab === "transcript"
      ? transcriptDraft
      : detailTab
        ? getDetailText(detailTab, workflow, locale)
        : "";
  const exportPath = detailTab ? getExportPath(detailTab, workflow) : null;
  const currentTranscriptPath = getExportPath("transcript", workflow);

  return {
    detailTab,
    openDetailTab,
    closeDetail,
    detailText,
    exportPath,
    currentTranscriptPath,
    copyDetail,
    copyTranscript,
    exportDetail,
    exportTranscript,
  };
}
```

Define `copyDetail`, `copyTranscript`, `exportDetail`, and `exportTranscript` inside this hook with
the exact current guards, selectors, `navigator.clipboard.writeText` /
`revealItemInDir` calls, and message codes. Keep the current callback dependency values. Do not
accept a path or command runner through options.

- [x] **Step 2: Compose the new owner from the stable facade**

Remove `detailTab` state, derived detail/export values, and the four clipboard/location callbacks
from the root. Call:

```ts
const artifactDetail = useArtifactDetailController({
  workflow,
  locale,
  transcriptDraft,
  transcriptDirty,
  setActionNotice,
});
```

Return the same artifact-detail fields explicitly. Do not modify consumer imports or props.

- [x] **Step 3: Run behavior and type gates**

```powershell
npm.cmd --prefix app test -- src/features/transcript/useTranscriptDetailController.test.ts
npm.cmd --prefix app run lint
```

Expected: all facade behavior tests pass and TypeScript/i18n lint reports zero failures. The
ownership test remains RED only because the document/review owners are still absent.

- [x] **Step 4: Commit the artifact owner**

```powershell
git add app\src\features\results\useArtifactDetailController.ts app\src\features\transcript\useTranscriptDetailController.ts
git commit -m "refactor(app): extract artifact detail actions"
```

### Task 5: Extract the Task-Scoped Transcript Document

**Files:**

- Create: `app/src/features/transcript/useTranscriptDocumentController.ts`
- Modify: `app/src/features/transcript/useTranscriptDetailController.ts`
- Test: `app/src/features/transcript/useTranscriptDetailController.test.ts`

- [x] **Step 1: Create the document owner**

Use this option and continuation shape:

```ts
type UseTranscriptDocumentControllerOptions = {
  workflow: WorkflowState;
  applyTranscriptSave: (
    expectedTaskId: string | null,
    saved: SaveTranscriptEditResponse,
  ) => void;
  setActionNotice: Dispatch<SetStateAction<UiMessage | null>>;
};

type CompleteSuccessfulSave = () => Promise<void>;
```

Move these state cells and refs into the document owner:

```ts
const [transcriptDetail, setTranscriptDetail] =
  useState<TranscriptDetailResponse | null>(null);
const [transcriptDraft, setTranscriptDraft] = useState("");
const [transcriptSegments, setTranscriptSegments] =
  useState<TranscriptSegment[]>([]);
const [transcriptDirty, setTranscriptDirty] = useState(false);
const [transcriptLoading, setTranscriptLoading] = useState(false);
const [transcriptSaving, setTranscriptSaving] = useState(false);
const transcriptLoadTaskIdRef = useRef<string | null>(null);
const currentTaskIdRef = useRef(workflow.taskId);
currentTaskIdRef.current = workflow.taskId;
```

Move the complete current load effect, but remove assignments to active/editing audio-review state.
It must still reset document state without a task/artifact, deduplicate the same task, ignore a
cleaned-up request, install text/segments/detail on success, and use the existing fallback/no-audio
message codes.

- [x] **Step 2: Move semantic draft updates**

Implement the exact current draft actions:

```ts
const updateTranscriptSegmentDraft = useCallback(
  (segmentId: string, text: string) => {
    setTranscriptSegments((current) => {
      const next = updateTranscriptSegmentText(current, segmentId, text);
      setTranscriptDraft(transcriptTextFromSegments(next));
      return next;
    });
    setTranscriptDirty(true);
  },
  [],
);

const updateFullTranscriptDraft = useCallback((text: string) => {
  setTranscriptDraft(text);
  setTranscriptDirty(true);
}, []);
```

- [x] **Step 3: Move save IPC and stale-result protection**

Expose a private `saveTranscriptDocument(completeSuccessfulSave)` action. Preserve the exact
guard and sequencing:

```ts
const saveTranscriptDocument = useCallback(
  async (completeSuccessfulSave: CompleteSuccessfulSave) => {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt || transcriptSaving) {
      return;
    }

    const expectedTaskId = workflow.taskId;
    setTranscriptSaving(true);
    try {
      const saved = await saveTranscriptEdit(
        expectedTaskId,
        transcriptDraft,
        transcriptSegments,
      );
      if (
        currentTaskIdRef.current !== expectedTaskId ||
        saved.task_id !== expectedTaskId
      ) {
        return;
      }
      setTranscriptDraft(saved.text);
      setTranscriptDirty(false);
      setTranscriptDetail((current) =>
        current
          ? {
              ...current,
              text: saved.text,
              has_original_backup: saved.has_original_backup,
            }
          : current,
      );
      applyTranscriptSave(expectedTaskId, saved);
      setActionNotice(uiMessage("transcript.notice.saved"));
      await completeSuccessfulSave();
    } catch {
      setActionNotice(uiMessage("transcript.notice.saveFailed"));
    } finally {
      setTranscriptSaving(false);
    }
  },
  [
    applyTranscriptSave,
    setActionNotice,
    transcriptDraft,
    transcriptSaving,
    transcriptSegments,
    workflow.artifacts.transcript_txt,
    workflow.taskId,
  ],
);
```

The continuation must catch its own audio-play failure and must not throw. This keeps a successful
disk save from being relabeled as a save failure.

- [x] **Step 4: Compose document fields in the facade**

Call the new hook first, pass its draft/dirty values into `useArtifactDetailController`, and return
the same document fields/actions explicitly. While review state still lives in the facade, keep its
task-change reset and successful-save continuation there:

```ts
useEffect(() => {
  setActiveTranscriptSegmentId(null);
  setEditingTranscriptSegmentId(null);
}, [workflow.artifacts.transcript_txt, workflow.taskId]);

const completeSuccessfulSave = useCallback(async () => {
  setEditingTranscriptSegmentId(null);
  if (resumeTranscriptAfterSaveRef.current && transcriptAudioRef.current) {
    resumeTranscriptAfterSaveRef.current = false;
    try {
      await transcriptAudioRef.current.play();
    } catch {
      setActionNotice(uiMessage("transcript.notice.savedAutoplayFailed"));
    }
  }
}, [setActionNotice]);

const saveTranscriptDraft = useCallback(
  () =>
    transcriptDocument.saveTranscriptDocument(completeSuccessfulSave),
  [completeSuccessfulSave, transcriptDocument.saveTranscriptDocument],
);
```

Task 6 moves this temporary review effect and continuation into the review owner. Do not move
workflow identity or `applyTranscriptSave` into App or the review owner.

- [x] **Step 5: Run behavior and lint gates**

```powershell
npm.cmd --prefix app test -- src/features/transcript/useTranscriptDetailController.test.ts
npm.cmd --prefix app run lint
```

Expected: all behavior tests pass. The ownership test remains RED only because
`useTranscriptReviewSession.ts` is still absent.

- [x] **Step 6: Commit the document owner**

```powershell
git add app\src\features\transcript\useTranscriptDocumentController.ts app\src\features\transcript\useTranscriptDetailController.ts
git commit -m "refactor(app): extract transcript document state"
```

### Task 6: Extract Audio and Edit Review Session, Then Complete the Facade

**Files:**

- Create: `app/src/features/transcript/useTranscriptReviewSession.ts`
- Modify: `app/src/features/transcript/useTranscriptDetailController.ts`
- Modify: `app/src/features/transcript/transcriptControllerBoundary.test.ts`
- Test: `app/src/features/transcript/useTranscriptDetailController.test.ts`

- [x] **Step 1: Write the task-switch resume-intent regression and verify RED**

Add `clears pending audio resume when the review task changes`. Begin editing task A while its audio
double reports `paused: false`, switch the mutable harness to a loaded task B, attach a task-B audio
double, edit/save task B, and assert:

```ts
expect(taskAAudio.pause).toHaveBeenCalledOnce();
expect(taskBAudio.play).not.toHaveBeenCalled();
expect(render().transcriptDirty).toBe(false);
```

Run:

```powershell
npm.cmd --prefix app test -- src/features/transcript/useTranscriptDetailController.test.ts -t "clears pending audio resume when the review task changes"
```

Expected: FAIL because the current root does not reset
`resumeTranscriptAfterSaveRef.current` when task identity changes and therefore attempts to play the
task-B audio double.

- [x] **Step 2: Create the review-session owner and task-scoped reset**

Use this closed input shape:

```ts
type UseTranscriptReviewSessionOptions = {
  reviewTaskId: string | null;
  audioAssetPath: string | null;
  transcriptSegments: TranscriptSegment[];
  setActionNotice: Dispatch<SetStateAction<UiMessage | null>>;
};
```

Move the active/editing/audio state and element refs:

```ts
const [activeTranscriptSegmentId, setActiveTranscriptSegmentId] =
  useState<string | null>(null);
const [editingTranscriptSegmentId, setEditingTranscriptSegmentId] =
  useState<string | null>(null);
const [transcriptAudioCurrentTime, setTranscriptAudioCurrentTime] = useState(0);
const [transcriptAudioDuration, setTranscriptAudioDuration] = useState(0);
const [transcriptAudioPlaying, setTranscriptAudioPlaying] = useState(false);
const transcriptAudioRef = useRef<HTMLAudioElement | null>(null);
const transcriptSegmentRefs =
  useRef<Record<string, HTMLDivElement | null>>({});
const resumeTranscriptAfterSaveRef = useRef(false);
```

Move `convertFileSrc`, progress/scrubber derivation, active-segment scroll, audio-source reset,
segment play/follow, metadata/time/play/pause handlers, toggle, scrub, begin/end edit, and deletion
preparation into this hook. Keep current message codes and pure helper calls.

Add this effect:

```ts
useEffect(() => {
  resumeTranscriptAfterSaveRef.current = false;
  setActiveTranscriptSegmentId(null);
  setEditingTranscriptSegmentId(null);
}, [reviewTaskId]);
```

Keep the separate `transcriptAudioSrc` effect for current-time/duration/playing reset and playback
rate. This closes the stale resume-intent gap recorded in Surprises.

- [x] **Step 3: Implement successful-save completion**

```ts
const completeSuccessfulSave = useCallback(async () => {
  setEditingTranscriptSegmentId(null);
  if (resumeTranscriptAfterSaveRef.current && transcriptAudioRef.current) {
    resumeTranscriptAfterSaveRef.current = false;
    try {
      await transcriptAudioRef.current.play();
    } catch {
      setActionNotice(uiMessage("transcript.notice.savedAutoplayFailed"));
    }
  }
}, [setActionNotice]);
```

`endTranscriptSegmentEdit` and matching-task deletion preparation must continue clearing pending
resume intent before later saves.

- [x] **Step 4: Complete the stable facade composition**

Derive review identity and compose the hooks:

```ts
const reviewTaskId =
  workflow.taskId && workflow.artifacts.transcript_txt
    ? workflow.taskId
    : null;
const transcriptReview = useTranscriptReviewSession({
  reviewTaskId,
  audioAssetPath:
    transcriptDocument.transcriptDetail?.audio_asset_path ?? null,
  transcriptSegments: transcriptDocument.transcriptSegments,
  setActionNotice,
});
const saveTranscriptDraft = useCallback(
  () =>
    transcriptDocument.saveTranscriptDocument(
      transcriptReview.completeSuccessfulSave,
    ),
  [
    transcriptDocument.saveTranscriptDocument,
    transcriptReview.completeSuccessfulSave,
  ],
);
```

Return the exact characterized public keys explicitly. Do not spread the private
`saveTranscriptDocument` or `completeSuccessfulSave` actions into the public controller.

- [x] **Step 5: Complete the source-boundary size assertions**

Extend the boundary test with:

```ts
const physicalLines = (source: string) => source.split(/\r?\n/).length;
expect(physicalLines(root)).toBeLessThanOrEqual(200);
expect(physicalLines(artifact)).toBeLessThanOrEqual(250);
expect(physicalLines(document)).toBeLessThanOrEqual(250);
expect(physicalLines(review)).toBeLessThanOrEqual(250);
```

Also require `TranscriptDetailController` to remain derived from
`ReturnType<typeof useTranscriptDetailController>`.

- [x] **Step 6: Turn the ownership RED GREEN**

```powershell
npm.cmd --prefix app test -- src/features/transcript/transcriptControllerBoundary.test.ts
npm.cmd --prefix app test -- src/features/transcript/useTranscriptDetailController.test.ts
npm.cmd --prefix app run lint
```

Expected: boundary, facade behavior, and TypeScript/i18n lint all pass. Record exact test totals and
measured file sizes in Progress.

- [x] **Step 7: Review protected production scope**

Run:

```powershell
git diff 8499bac -- app\src\App.tsx app\src\features\transcript\LocalTranscriptWorkspace.tsx app\src\features\transcript\TranscriptReviewPanel.tsx app\src\features\results\AiResultDetailSheet.tsx app\src\transcriptDetailClient.ts app\src-tauri worker server contracts
```

Expected: no diff. Stop if any protected consumer, IPC, Rust, worker, server, or contract file
changed.

- [x] **Step 8: Commit the completed module tree**

```powershell
git add app\src\features\transcript\useTranscriptDetailController.ts app\src\features\transcript\useTranscriptReviewSession.ts app\src\features\transcript\transcriptControllerBoundary.test.ts
git commit -m "refactor(app): split transcript review session"
```

### Task 7: Run Real-React and Full App Regression

**Files:**

- Test only; production changes are not expected

- [x] **Step 1: Run focused Chromium integration**

```powershell
npm.cmd --prefix app test -- tests/app-input.browser.test.ts -t "renders one task as aligned local transcript|ignores a late transcript save|Escape exits segment editing|keeps local transcript usable"
```

Expected: the four selected real-browser cases pass with no runtime exception. They prove workspace
audio/segments, stale save, Escape edit semantics, and local transcript availability during AI
gating.

- [x] **Step 2: Run the complete App gates**

```powershell
npm.cmd --prefix app test
npm.cmd --prefix app run lint
npm.cmd --prefix app run build
```

Expected: zero test/lint/build failures. Record exact file/test totals and existing non-blocking
Vite warnings.

- [x] **Step 3: Run repository and governance gates**

```powershell
node --test scripts\tests\*.test.mjs
python scripts\validate_agents_docs.py --level WARN
git diff --check
```

Expected: scripts and governance pass; no whitespace errors.

- [x] **Step 4: Inspect final scope and commits**

```powershell
git status --short
git diff --stat 8499bac
git log --oneline 8499bac..HEAD
```

Expected: only the planned frontend controller/tests and planning documents differ from the
approved design commit.

### Task 8: Synchronize Durable Evidence and Archive

**Files:**

- Modify: `docs/design-docs/2026-07-23-frontend-transcript-controller-split.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Move: this plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/`

- [ ] **Step 1: Record implemented ownership and evidence**

Mark the design Implemented with measured line counts and final test totals. Add an Architecture
entry stating:

- the facade remains the only production controller import;
- artifact actions, task document state, and review session have private owners;
- workflow task identity remains in `useTaskProcessingController`; and
- no IPC, path, network, localization, or Credits behavior changed.

Update the code audit's large-module table and resolved/deferred section with the final sizes and
boundary-test evidence. Mark the old 509-line mixed controller hotspot resolved in the technical
debt tracker.

- [ ] **Step 2: Complete task and plan lifecycle**

Mark the `TASKS.md` item complete, fill every pending Progress/Decision/Outcome fact with exact
evidence, move this plan to `completed/`, remove its active-index row, add its completed-index row,
and change the AGENTS link from active to recently completed.

- [ ] **Step 3: Re-run closeout gates**

```powershell
python scripts\validate_agents_docs.py --level WARN
node --test scripts\tests\*.test.mjs
npm.cmd --prefix app test
npm.cmd --prefix app run lint
npm.cmd --prefix app run build
git diff --check
git status --short
```

Expected: all automated gates pass after documentation movement. Record exact totals and all
not-run manual evidence in Outcomes.

- [ ] **Step 4: Commit closeout**

```powershell
git add AGENTS.md TASKS.md docs
git commit -m "docs(app): close transcript controller split"
```

Do not push, merge, tag, publish, or create a PR without a separate user request.

## Validation and Acceptance

### Required automated evidence

- Pre-change facade baseline is 1 file / 4 tests.
- Characterization tests pass against the pre-extraction implementation.
- The ownership test demonstrates a missing-owner RED, then passes against the final module tree.
- Focused facade, boundary, selected Chromium, complete App, lint, and build gates pass.
- Repository scripts, governance WARN, and `git diff --check` pass.
- Final protected-scope diff proves no consumer, IPC, Rust, worker, server, or contract change.

### Behavioral acceptance

- The public controller has the same characterized keys and `ReturnType` alias.
- Summary/inspiration detail open/close/copy/export behavior remains unchanged.
- Transcript load reset, deduplication, fallback, and no-audio behavior remain unchanged.
- Segment and full-text edits preserve current draft/dirty semantics.
- Audio seek, follow, scrub, pause, resume, and fixed failure notices remain unchanged.
- Successful saves merge only into the expected current task; stale load/save results are ignored.
- End edit, task switch, and matching-task deletion clear task-local resume intent.
- Copy uses the draft; location uses the saved artifact and blocks while dirty.

### Structural acceptance

- `useTranscriptDetailController.ts` is at most 200 physical lines.
- Each child is at most 250 physical production lines unless the completed plan records a reviewed
  reason.
- No private child imports another private child.
- Presentation consumers import only the stable facade type/hook.
- `App.tsx` gains no transcript state or workflow setter exposure.

### Manual evidence

A native Tauri load/play/edit/save smoke is optional because IPC, asset scope, and native code are
unchanged. If not run, record it explicitly as residual risk. If any implementation diff touches
Tauri IPC, asset scope, permissions, or packaged runtime, stop and expand the plan before claiming
completion.

## Final Acceptance

- All Plan of Work checkboxes are complete and backed by recorded command output.
- Durable docs and audit facts match the final code rather than the planned shape.
- The active plan is archived only after full gates pass.
- No product-visible feature, dependency, command, contract, schema, path, network call,
  localization key, log field, or AI Credit behavior is added.
- The branch remains isolated until the user separately authorizes integration.
