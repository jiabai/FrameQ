import { describe, expect, test } from "vitest";

import {
  collectionNoteCreationReducer,
  createCollectionNoteCreation,
  type CollectionNoteCreationResult,
} from "./collectionNoteCreation";

const completed: CollectionNoteCreationResult = {
  status: "completed",
  task_id: "saved-task",
  artifacts: { transcript_txt: "transcript/transcript.txt" },
  error: null,
};

describe("collection note creation intent", () => {
  test("claims one genuine local completion and consumes the intent after membership commits", () => {
    const composing = collectionNoteCreationReducer(createCollectionNoteCreation(), {
      type: "begin", collectionId: "collection-a",
    });
    const attaching = collectionNoteCreationReducer(composing, {
      type: "local_completed", intentId: composing.intentId, result: completed,
    });
    expect(attaching).toEqual({
      phase: "attaching", intentId: composing.intentId,
      collectionId: "collection-a", taskId: "saved-task", attemptId: 1,
    });
    expect(collectionNoteCreationReducer(attaching, {
      type: "local_completed", intentId: composing.intentId, result: completed,
    })).toBe(attaching);
    const finished = collectionNoteCreationReducer(attaching, {
      type: "attachment_finished", intentId: composing.intentId, attemptId: 1, success: true,
    });
    expect(finished.phase).toBe("idle");
    expect(collectionNoteCreationReducer(finished, {
      type: "local_completed", intentId: composing.intentId, result: completed,
    })).toBe(finished);
  });

  test.each([
    undefined,
    { ...completed, status: "failed" as const },
    { ...completed, task_id: null },
    { ...completed, task_id: "  " },
    { ...completed, artifacts: {} },
    { ...completed, error: { code: "WORKER_CANCELLED", message: "", stage: "video_extracting" as const } },
  ])("preserves the composing destination when no completed transcript is available: %j", (result) => {
    const composing = collectionNoteCreationReducer(createCollectionNoteCreation(), {
      type: "begin", collectionId: "collection-a",
    });
    expect(collectionNoteCreationReducer(composing, {
      type: "local_completed", intentId: composing.intentId, result,
    })).toBe(composing);
  });

  test("accepts a partial completion that contains a saved local transcript", () => {
    const composing = collectionNoteCreationReducer(createCollectionNoteCreation(), {
      type: "begin", collectionId: "collection-a",
    });
    expect(collectionNoteCreationReducer(composing, {
      type: "local_completed", intentId: composing.intentId,
      result: { ...completed, status: "partial_completed" },
    }).phase).toBe("attaching");
  });

  test("adds the saved note when only its subsequent title generation was cancelled", () => {
    const composing = collectionNoteCreationReducer(createCollectionNoteCreation(), {
      type: "begin", collectionId: "collection-a",
    });
    expect(collectionNoteCreationReducer(composing, {
      type: "local_completed", intentId: composing.intentId,
      result: { ...completed, status: "partial_completed", error: { code: "WORKER_CANCELLED", message: "", stage: "title_generating" } },
    }).phase).toBe("attaching");
  });

  test("new intents and explicit clearing invalidate older local completions", () => {
    const first = collectionNoteCreationReducer(createCollectionNoteCreation(), {
      type: "begin", collectionId: "collection-a",
    });
    const next = collectionNoteCreationReducer(first, { type: "begin", collectionId: "collection-b" });
    expect(collectionNoteCreationReducer(next, {
      type: "local_completed", intentId: first.intentId, result: completed,
    })).toBe(next);
    const cleared = collectionNoteCreationReducer(next, { type: "clear" });
    expect(collectionNoteCreationReducer(cleared, {
      type: "local_completed", intentId: next.intentId, result: completed,
    })).toBe(cleared);
    expect(cleared.phase).toBe("idle");
  });

  test("retries exactly the failed task and rejects a previous attachment attempt's response", () => {
    const composing = collectionNoteCreationReducer(createCollectionNoteCreation(), {
      type: "begin", collectionId: "collection-a",
    });
    const attaching = collectionNoteCreationReducer(composing, {
      type: "local_completed", intentId: composing.intentId, result: completed,
    });
    const failed = collectionNoteCreationReducer(attaching, {
      type: "attachment_finished", intentId: composing.intentId, attemptId: 1, success: false,
    });
    const retry = collectionNoteCreationReducer(failed, { type: "retry" });
    expect(retry).toEqual({
      phase: "attaching", intentId: composing.intentId,
      collectionId: "collection-a", taskId: "saved-task", attemptId: 2,
    });
    expect(collectionNoteCreationReducer(retry, {
      type: "attachment_finished", intentId: composing.intentId, attemptId: 1, success: true,
    })).toBe(retry);
    expect(collectionNoteCreationReducer(retry, { type: "retry" })).toBe(retry);
  });

  test("clears only the matching saved task when it is deleted during attachment or after failure", () => {
    const composing = collectionNoteCreationReducer(createCollectionNoteCreation(), {
      type: "begin", collectionId: "collection-a",
    });
    expect(collectionNoteCreationReducer(composing, {
      type: "task_deleted", taskId: "saved-task",
    })).toBe(composing);
    const attaching = collectionNoteCreationReducer(composing, {
      type: "local_completed", intentId: composing.intentId, result: completed,
    });
    const failed = collectionNoteCreationReducer(attaching, {
      type: "attachment_finished", intentId: composing.intentId, attemptId: 1, success: false,
    });
    for (const saved of [attaching, failed]) {
      expect(collectionNoteCreationReducer(saved, {
        type: "task_deleted", taskId: "another-task",
      })).toBe(saved);
      const deleted = collectionNoteCreationReducer(saved, {
        type: "task_deleted", taskId: "saved-task",
      });
      expect(deleted).toEqual({ phase: "idle", intentId: composing.intentId + 1 });
      expect(collectionNoteCreationReducer(deleted, {
        type: "attachment_finished", intentId: composing.intentId, attemptId: 1, success: false,
      })).toBe(deleted);
    }
  });
});
