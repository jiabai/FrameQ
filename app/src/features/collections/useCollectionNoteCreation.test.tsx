// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import type { TaskSubmission, WorkerResult } from "../../workflowState";
import { useCollectionNoteCreation } from "./useCollectionNoteCreation";

const submission: TaskSubmission = { kind: "url", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };

function completed(taskId = "saved-task"): WorkerResult {
  return {
    status: "completed", task_id: taskId, task_dir: `D:/FrameQ/outputs/tasks/${taskId}`,
    artifacts: { transcript_txt: "transcript/transcript.txt" },
    text: "Saved transcript", summary: "", insights: [], transcript: null,
    dissection: null, dissection_source_status: null, draft: "", error: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

afterEach(cleanup);

describe("collection note creation callback scheduling", () => {
  test("delegates ordinary submissions without adding collection membership", async () => {
    const submitted: TaskSubmission[] = [];
    const memberships: string[] = [];
    const { result } = renderHook(() => useCollectionNoteCreation({
      submitTask: async (value) => { submitted.push(value); return completed(); },
      setMembership: async (collectionId) => { memberships.push(collectionId); return true; },
    }));
    await act(async () => { await result.current.submit(submission); });
    expect(submitted).toEqual([submission]);
    expect(memberships).toEqual([]);
  });

  test("preserves account/model/cancellation retry context and attaches the completed task once", async () => {
    let output: WorkerResult | undefined;
    const memberships: Array<[string, string, boolean]> = [];
    const { result } = renderHook(() => useCollectionNoteCreation({
      submitTask: async () => output,
      setMembership: async (...value) => { memberships.push(value); return true; },
    }));
    act(() => result.current.begin("collection-a"));
    await act(async () => { await result.current.submit(submission); });
    expect(result.current.destinationCollectionId).toBe("collection-a");
    output = { ...completed(), status: "failed" };
    await act(async () => { await result.current.submit(submission); });
    expect(result.current.destinationCollectionId).toBe("collection-a");
    output = { ...completed(), error: { code: "WORKER_CANCELLED", message: "", stage: "video_extracting" } };
    await act(async () => { await result.current.submit(submission); });
    expect(result.current.destinationCollectionId).toBe("collection-a");
    output = completed();
    await act(async () => { await result.current.submit(submission); });
    expect(memberships).toEqual([["collection-a", "saved-task", true]]);
    expect(result.current.destinationCollectionId).toBeNull();
  });

  test("claims attachment before awaiting so simultaneous completions cannot attach twice", async () => {
    const first = deferred<WorkerResult>();
    const second = deferred<WorkerResult>();
    const attachment = deferred<boolean>();
    const submissions = [first, second];
    const memberships: string[] = [];
    const { result } = renderHook(() => useCollectionNoteCreation({
      submitTask: () => submissions.shift()!.promise,
      setMembership: async (_collectionId, taskId) => { memberships.push(taskId); return attachment.promise; },
    }));
    act(() => result.current.begin("collection-a"));
    let firstSubmission!: Promise<void>;
    let secondSubmission!: Promise<void>;
    act(() => {
      firstSubmission = result.current.submit(submission);
      secondSubmission = result.current.submit(submission);
    });
    await act(async () => { first.resolve(completed("first-task")); });
    expect(result.current.attaching).toBe(true);
    await act(async () => { second.resolve(completed("second-task")); await secondSubmission; });
    expect(memberships).toEqual(["first-task"]);
    await act(async () => { attachment.resolve(true); await firstSubmission; });
    expect(result.current.attaching).toBe(false);
  });

  test("ignores late local completion after another collection or history restore clears its context", async () => {
    const local = deferred<WorkerResult>();
    const memberships: string[] = [];
    const { result } = renderHook(() => useCollectionNoteCreation({
      submitTask: () => local.promise,
      setMembership: async (collectionId) => { memberships.push(collectionId); return true; },
    }));
    act(() => result.current.begin("collection-a"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.submit(submission); });
    act(() => { result.current.clear(); result.current.begin("collection-b"); });
    await act(async () => { local.resolve(completed()); await pending; });
    expect(memberships).toEqual([]);
    expect(result.current.destinationCollectionId).toBe("collection-b");
  });

  test("retains a failed task identity and retries that task without resubmitting media", async () => {
    let submitted = 0;
    let success = false;
    const memberships: string[] = [];
    const { result } = renderHook(() => useCollectionNoteCreation({
      submitTask: async () => { submitted += 1; return completed(); },
      setMembership: async (_collectionId, taskId) => { memberships.push(taskId); return success; },
    }));
    act(() => result.current.begin("collection-a"));
    await act(async () => { await result.current.submit(submission); });
    expect(result.current.failure).toEqual({ collectionId: "collection-a", taskId: "saved-task" });
    success = true;
    await act(async () => { await result.current.retry(); });
    expect(submitted).toBe(1);
    expect(memberships).toEqual(["saved-task", "saved-task"]);
    expect(result.current.failure).toBeNull();
  });

  test("propagates an unexpected membership callback rejection", async () => {
    const { result } = renderHook(() => useCollectionNoteCreation({
      submitTask: async () => completed(),
      setMembership: async () => { throw new Error("Membership operation rejected"); },
    }));
    act(() => result.current.begin("collection-a"));
    await act(async () => {
      await expect(result.current.submit(submission)).rejects.toThrow("Membership operation rejected");
    });
  });

  test("clears a deleted failed note without cancelling another composing destination", async () => {
    const { result } = renderHook(() => useCollectionNoteCreation({
      submitTask: async () => completed(),
      setMembership: async () => false,
    }));
    act(() => result.current.begin("collection-a"));
    await act(async () => { await result.current.submit(submission); });
    act(() => result.current.taskDeleted("another-task"));
    expect(result.current.failure?.taskId).toBe("saved-task");
    act(() => result.current.taskDeleted("saved-task"));
    expect(result.current.failure).toBeNull();
    expect(result.current.destinationCollectionId).toBeNull();
    act(() => { result.current.begin("collection-b"); result.current.taskDeleted("saved-task"); });
    expect(result.current.destinationCollectionId).toBe("collection-b");
  });

  test("ignores an attachment response after its origin collection is deleted", async () => {
    const attachment = deferred<boolean>();
    const { result } = renderHook(() => useCollectionNoteCreation({
      submitTask: async () => completed(),
      setMembership: () => attachment.promise,
    }));
    act(() => result.current.begin("collection-a"));
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.submit(submission); });
    act(() => { result.current.clear(); result.current.begin("collection-b"); });
    await act(async () => { attachment.resolve(false); await pending; });
    expect(result.current.failure).toBeNull();
    expect(result.current.destinationCollectionId).toBe("collection-b");
  });

  test("does not request membership after unmount while local submission is pending", async () => {
    const local = deferred<WorkerResult>();
    let memberships = 0;
    const { result, unmount } = renderHook(() => useCollectionNoteCreation({
      submitTask: () => local.promise,
      setMembership: async () => { memberships += 1; return true; },
    }));
    act(() => result.current.begin("collection-a"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.submit(submission); });
    unmount();
    await act(async () => { local.resolve(completed()); await pending; });
    expect(memberships).toBe(0);
  });
});
