import { describe, expect, test } from "vitest";
import {
  createInitialWorkflow,
  editDraft,
  finishInsightRetry,
  type WorkflowState,
  type WorkerResult,
} from "./workflowState";

const makeMinimalCompletedResult = (): WorkerResult => ({
  status: "completed",
  task_id: "task-1",
  task_dir: "/tmp/task-1",
  artifacts: { draft: "draft.md" },
  text: "transcript text",
  summary: "summary text",
  insights: [],
  transcript: null,
  dissection: null,
  dissection_source_status: null,
  draft: "new draft",
  error: null,
});

describe("workflowState", () => {
  test("createInitialWorkflow has draftEdited: false", () => {
    const state = createInitialWorkflow();
    expect(state.draftEdited).toBe(false);
  });

  test("editDraft sets draft and draftEdited to true, does not mutate original", () => {
    const state = createInitialWorkflow();
    const next = editDraft(state, "# new");

    expect(next.draft).toBe("# new");
    expect(next.draftEdited).toBe(true);
    // original state must not be mutated
    expect(state.draft).toBe("");
    expect(state.draftEdited).toBe(false);
  });

  test("finishInsightRetry resets draftEdited to false when target is draft", () => {
    const state: WorkflowState = {
      ...createInitialWorkflow(),
      taskId: "task-1",
      draft: "old draft",
      draftEdited: true,
    };
    const result = makeMinimalCompletedResult();

    const next = finishInsightRetry(state, result, "draft");

    expect(next.draftEdited).toBe(false);
  });

  test("finishInsightRetry preserves draftEdited when target is not draft", () => {
    const state: WorkflowState = {
      ...createInitialWorkflow(),
      taskId: "task-1",
      draft: "old draft",
      draftEdited: true,
    };
    const result = makeMinimalCompletedResult();

    const next = finishInsightRetry(state, result, "summary");

    expect(next.draftEdited).toBe(true);
  });

  test("finishInsightRetry preserves draftEdited when draft regeneration fails", () => {
    const state: WorkflowState = {
      ...createInitialWorkflow(),
      taskId: "task-1",
      draft: "old draft",
      draftEdited: true,
    };
    const failedResult: WorkerResult = {
      status: "failed",
      task_id: "task-1",
      task_dir: "/tmp/task-1",
      artifacts: {},
      text: "",
      summary: "",
      insights: [],
      transcript: null,
      dissection: null,
      dissection_source_status: null,
      draft: "old draft",
      error: {
        code: "draft_generation_failed",
        message: "LLM returned empty content",
        stage: "draft_generating",
      },
    };

    const next = finishInsightRetry(state, failedResult, "draft");

    expect(next.draftEdited).toBe(true);
  });
});
