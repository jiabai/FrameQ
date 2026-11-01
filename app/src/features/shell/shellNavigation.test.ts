import { describe, expect, test } from "vitest";

import type { HistoryListItem } from "../../historyClient";
import {
  canNavigateShell,
  createShellNavigation,
  getHistoryTitle,
  getShellPage,
  getShellTaskId,
  getShellCollectionId,
  getVisibleArtifactKeys,
  removeShellTask,
  removeShellCollection,
  pruneUnavailableShellTasks,
  shellNavigationReducer,
} from "./shellNavigation";

describe("shell navigation", () => {
  test("returns to visited pages and replaces forward history after a new destination", () => {
    let state = createShellNavigation();
    expect(getShellPage(state)).toBe("home");
    state = shellNavigationReducer(state, { type: "navigate", page: "notes", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "task", canNavigate: true });
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    expect(getShellPage(state)).toBe("notes");
    state = shellNavigationReducer(state, { type: "forward", canNavigate: true });
    expect(getShellPage(state)).toBe("task");
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "artifacts", canNavigate: true });
    expect(state.entries).toEqual([
      { page: "home", taskId: null },
      { page: "notes", taskId: null },
      { page: "artifacts", taskId: null },
    ]);
    expect(shellNavigationReducer(state, { type: "forward", canNavigate: true })).toBe(state);
  });

  test("keeps the current page and history unchanged when navigation is blocked", () => {
    const state = shellNavigationReducer(createShellNavigation(), {
      type: "navigate", page: "task", canNavigate: true,
    });
    expect(shellNavigationReducer(state, { type: "back", canNavigate: false })).toBe(state);
    expect(shellNavigationReducer(state, {
      type: "navigate", page: "notes", canNavigate: false,
    })).toBe(state);
    expect(shellNavigationReducer(state, { type: "forward", canNavigate: false })).toBe(state);
  });

  test("does not add repeated destinations or move before the first entry", () => {
    const initial = createShellNavigation("notes");
    expect(shellNavigationReducer(initial, {
      type: "navigate", page: "notes", canNavigate: true,
    })).toBe(initial);
    expect(shellNavigationReducer(initial, { type: "back", canNavigate: true })).toBe(initial);
  });

  test("preserves each visited task identity across backward and forward navigation", () => {
    let state = createShellNavigation("task", "task-a");
    state = shellNavigationReducer(state, { type: "navigate", page: "notes", canNavigate: true });
    state = shellNavigationReducer(state, {
      type: "navigate", page: "task", taskId: "task-b", canNavigate: true,
    });
    expect(getShellTaskId(state)).toBe("task-b");
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    expect(getShellPage(state)).toBe("notes");
    expect(getShellTaskId(state)).toBeNull();
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    expect(getShellPage(state)).toBe("task");
    expect(getShellTaskId(state)).toBe("task-a");
    state = shellNavigationReducer(state, { type: "forward", canNavigate: true });
    state = shellNavigationReducer(state, { type: "forward", canNavigate: true });
    expect(getShellTaskId(state)).toBe("task-b");
  });

  test("treats another task as a new destination and deduplicates the same task", () => {
    const initial = createShellNavigation("task", "task-a");
    expect(shellNavigationReducer(initial, {
      type: "navigate", page: "task", taskId: "task-a", canNavigate: true,
    })).toBe(initial);
    const next = shellNavigationReducer(initial, {
      type: "navigate", page: "task", taskId: "task-b", canNavigate: true,
    });
    expect(next.entries).toEqual([
      { page: "task", taskId: "task-a" },
      { page: "task", taskId: "task-b" },
    ]);
    expect(shellNavigationReducer(next, {
      type: "navigate", page: "task", taskId: "task-c", canNavigate: false,
    })).toBe(next);
  });

  test("stores an unidentified task explicitly and omits task identity from other pages", () => {
    const pending = createShellNavigation("task");
    expect(getShellTaskId(pending)).toBeNull();
    const home = createShellNavigation("home", "task-a");
    expect(getShellTaskId(home)).toBeNull();
    const notes = shellNavigationReducer(pending, {
      type: "navigate", page: "notes", taskId: "task-a", canNavigate: true,
    });
    expect(getShellTaskId(notes)).toBeNull();
  });

  test("replaces a processing task with its saved identity without adding an empty task visit", () => {
    let state = createShellNavigation();
    state = shellNavigationReducer(state, { type: "navigate", page: "task", canNavigate: true });
    const saved = shellNavigationReducer(state, {
      type: "replace", page: "task", taskId: "saved-task", canNavigate: true,
    });
    expect(saved.entries).toEqual([
      { page: "home", taskId: null },
      { page: "task", taskId: "saved-task" },
    ]);
    expect(saved.index).toBe(1);
    expect(getShellPage(shellNavigationReducer(saved, { type: "back", canNavigate: true })))
      .toBe("home");
    expect(shellNavigationReducer(saved, {
      type: "replace", page: "task", taskId: "saved-task", canNavigate: true,
    })).toBe(saved);
  });

  test("replaces only the current entry while respecting navigation guards and forward visits", () => {
    let state = createShellNavigation("task");
    state = shellNavigationReducer(state, { type: "navigate", page: "notes", canNavigate: true });
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    expect(shellNavigationReducer(state, {
      type: "replace", page: "task", taskId: "saved-task", canNavigate: false,
    })).toBe(state);
    const saved = shellNavigationReducer(state, {
      type: "replace", page: "task", taskId: "saved-task", canNavigate: true,
    });
    expect(saved.entries).toEqual([
      { page: "task", taskId: "saved-task" },
      { page: "notes", taskId: null },
    ]);
    expect(getShellPage(shellNavigationReducer(saved, { type: "forward", canNavigate: true })))
      .toBe("notes");
  });

  test("removes every deleted task visit and keeps another current task selected", () => {
    let state = createShellNavigation("task", "deleted-task");
    state = shellNavigationReducer(state, { type: "navigate", page: "notes", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "task", taskId: "deleted-task", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "artifacts", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "task", taskId: "retained-task", canNavigate: true });
    const retained = removeShellTask(state, "deleted-task");
    expect(retained.entries).toEqual([
      { page: "notes", taskId: null },
      { page: "artifacts", taskId: null },
      { page: "task", taskId: "retained-task" },
    ]);
    expect(retained.index).toBe(2);
    expect(getShellPage(shellNavigationReducer(retained, { type: "back", canNavigate: true })))
      .toBe("artifacts");
    expect(removeShellTask(retained, "missing-task")).toBe(retained);
  });

  test("selects Home after deleting the current task and skips removed forward visits", () => {
    let state = createShellNavigation();
    state = shellNavigationReducer(state, { type: "navigate", page: "task", taskId: "deleted-task", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "notes", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "task", taskId: "deleted-task", canNavigate: true });
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    const retained = removeShellTask(state, "deleted-task");
    expect(retained.entries).toEqual([
      { page: "home", taskId: null },
      { page: "notes", taskId: null },
    ]);
    expect(retained.index).toBe(0);
    expect(getShellPage(shellNavigationReducer(retained, { type: "forward", canNavigate: true })))
      .toBe("notes");
    expect(getShellPage(removeShellTask(createShellNavigation("task", "deleted-task"), "deleted-task")))
      .toBe("home");
  });

  test("blocks each active operation and each unsaved editor independently", () => {
    const idle = {
      processing: false,
      submissionPending: false,
      modelDownloadActive: false,
      transcriptSaving: false,
      transcriptDirty: false,
      draftSaving: false,
      draftDirty: false,
    };
    expect(canNavigateShell(idle)).toBe(true);
    for (const blocker of Object.keys(idle)) {
      expect(canNavigateShell({ ...idle, [blocker]: true })).toBe(false);
    }
  });

  test("blocks view changes while an accepted submission is preparing its model", () => {
    const state = createShellNavigation("task", "retained-task");
    const canNavigate = canNavigateShell({
      processing: false, modelDownloadActive: false,
      transcriptSaving: false, transcriptDirty: false,
      submissionPending: true,
    });
    expect(canNavigate).toBe(false);
    expect(shellNavigationReducer(state, { type: "navigate", page: "notes", canNavigate })).toBe(state);
  });

  test("preserves each collection destination across task visits and browser navigation", () => {
    let state = createShellNavigation("collections");
    state = shellNavigationReducer(state, {
      type: "navigate", page: "collections", collectionId: "collection-a", canNavigate: true,
    });
    state = shellNavigationReducer(state, {
      type: "navigate", page: "collections", collectionId: "collection-b", canNavigate: true,
    });
    expect(state.entries).toEqual([
      { page: "collections", taskId: null, collectionId: null },
      { page: "collections", taskId: null, collectionId: "collection-a" },
      { page: "collections", taskId: null, collectionId: "collection-b" },
    ]);
    expect(shellNavigationReducer(state, {
      type: "navigate", page: "collections", collectionId: "collection-b", canNavigate: true,
    })).toBe(state);
    state = shellNavigationReducer(state, { type: "navigate", page: "task", taskId: "task-a", canNavigate: true });
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    expect(state.entries[state.index].collectionId).toBe("collection-b");
    expect(getShellCollectionId(state)).toBe("collection-b");
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    expect(state.entries[state.index].collectionId).toBe("collection-a");
    state = shellNavigationReducer(state, { type: "forward", canNavigate: true });
    expect(state.entries[state.index].collectionId).toBe("collection-b");
    state = shellNavigationReducer(state, { type: "forward", canNavigate: true });
    expect(getShellTaskId(state)).toBe("task-a");
    expect(getShellCollectionId(state)).toBeNull();
  });

  test("keeps adjacent distinct collections after a task visit is deleted", () => {
    let state = createShellNavigation();
    state = shellNavigationReducer(state, { type: "navigate", page: "collections", collectionId: "collection-a", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "task", taskId: "task-a", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "collections", collectionId: "collection-b", canNavigate: true });
    const retained = removeShellTask(state, "task-a");
    expect(retained.entries).toEqual([
      { page: "home", taskId: null },
      { page: "collections", taskId: null, collectionId: "collection-a" },
      { page: "collections", taskId: null, collectionId: "collection-b" },
    ]);
    expect(retained.index).toBe(2);
  });

  test("returns a deleted current collection to its manager while preserving other task and collection visits", () => {
    let state = createShellNavigation("collections", null, "collection-a");
    state = shellNavigationReducer(state, { type: "navigate", page: "task", taskId: "task-a", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "collections", collectionId: "collection-b", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "collections", collectionId: "collection-a", canNavigate: true });
    const retained = removeShellCollection(state, "collection-a");
    expect(retained.entries).toEqual([
      { page: "task", taskId: "task-a" },
      { page: "collections", taskId: null, collectionId: "collection-b" },
      { page: "collections", taskId: null, collectionId: null },
    ]);
    expect(getShellCollectionId(retained)).toBeNull();
    expect(retained.index).toBe(2);
    expect(getShellCollectionId(shellNavigationReducer(retained, { type: "back", canNavigate: true }))).toBe("collection-b");
    expect(removeShellCollection(retained, "missing-collection")).toBe(retained);
  });

  test("prunes deleted forward collection visits and deduplicates a replacement beside the manager", () => {
    let state = createShellNavigation("collections");
    state = shellNavigationReducer(state, { type: "navigate", page: "collections", collectionId: "collection-a", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "notes", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "collections", collectionId: "collection-a", canNavigate: true });
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    const retained = removeShellCollection(state, "collection-a");
    expect(retained.entries).toEqual([
      { page: "collections", taskId: null, collectionId: null },
      { page: "notes", taskId: null },
    ]);
    expect(retained.index).toBe(0);
    expect(getShellPage(shellNavigationReducer(retained, { type: "forward", canNavigate: true }))).toBe("notes");
  });

  test("prunes unavailable task visits while retaining collection identity and current workflow history", () => {
    let state = createShellNavigation();
    for (const entry of [
      { page: "task", taskId: "old-output-task" },
      { page: "notes" },
      { page: "task", taskId: "retained-workflow-task" },
      { page: "collections", collectionId: "collection-a" },
      { page: "task", taskId: "another-old-task" },
      { page: "artifacts" },
      { page: "task", taskId: "available-task" },
    ] as const) {
      state = shellNavigationReducer(state, { type: "navigate", ...entry, canNavigate: true });
    }
    const available = new Set(["retained-workflow-task", "available-task"]);
    const pruned = pruneUnavailableShellTasks(state, available);
    expect(pruned.entries).toEqual([
      { page: "home", taskId: null },
      { page: "notes", taskId: null },
      { page: "task", taskId: "retained-workflow-task" },
      { page: "collections", taskId: null, collectionId: "collection-a" },
      { page: "artifacts", taskId: null },
      { page: "task", taskId: "available-task" },
    ]);
    expect(pruned.index).toBe(5);
    const back = shellNavigationReducer(pruned, { type: "back", canNavigate: true });
    expect(getShellPage(back)).toBe("artifacts");
    expect(getShellCollectionId(shellNavigationReducer(back, { type: "back", canNavigate: true }))).toBe("collection-a");
    expect(getShellTaskId(shellNavigationReducer(back, { type: "forward", canNavigate: true }))).toBe("available-task");
    expect(pruneUnavailableShellTasks(pruned, available)).toBe(pruned);
  });

  test("replaces an unavailable selected task with Home and skips unavailable forward tasks", () => {
    let state = createShellNavigation();
    state = shellNavigationReducer(state, { type: "navigate", page: "task", taskId: "missing-a", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "notes", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "task", taskId: "missing-b", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "task", taskId: "missing-c", canNavigate: true });
    state = shellNavigationReducer(state, { type: "navigate", page: "task", taskId: "available-task", canNavigate: true });
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    state = shellNavigationReducer(state, { type: "back", canNavigate: true });
    const pruned = pruneUnavailableShellTasks(state, new Set(["available-task"]));
    expect(pruned.entries).toEqual([
      { page: "home", taskId: null },
      { page: "notes", taskId: null },
      { page: "home", taskId: null },
      { page: "task", taskId: "available-task" },
    ]);
    expect(pruned.index).toBe(2);
    expect(getShellTaskId(shellNavigationReducer(pruned, { type: "forward", canNavigate: true }))).toBe("available-task");
    expect(getShellPage(shellNavigationReducer(pruned, { type: "back", canNavigate: true }))).toBe("notes");
    expect(pruneUnavailableShellTasks(createShellNavigation("task", "missing"), new Set())).toEqual(createShellNavigation());
  });

  test("preserves an unidentified current task and removes unidentified task visits from history", () => {
    const current = createShellNavigation("task");
    expect(pruneUnavailableShellTasks(current, new Set())).toBe(current);
    let history = shellNavigationReducer(current, { type: "navigate", page: "notes", canNavigate: true });
    history = shellNavigationReducer(history, { type: "navigate", page: "task", taskId: "available-task", canNavigate: true });
    history = shellNavigationReducer(history, { type: "back", canNavigate: true });
    const pruned = pruneUnavailableShellTasks(history, new Set(["available-task"]));
    expect(pruned.entries).toEqual([
      { page: "notes", taskId: null },
      { page: "task", taskId: "available-task" },
    ]);
    expect(pruned.index).toBe(0);
  });
});

function historySource(
  source: HistoryListItem["source"],
  textPreview = "",
): Pick<HistoryListItem, "taskId" | "source" | "textPreview"> {
  return { taskId: "history-task", source, textPreview };
}

describe("history presentation", () => {
  test("uses the transcript preview or safe local filename without output paths", () => {
    const source = { kind: "local_file", displayName: "Interview.m4a", mediaKind: "audio" } as const;
    expect(getHistoryTitle(historySource(source, "  Interview  notes\nfrom today  ")))
      .toBe("Interview notes from today");
    expect(getHistoryTitle(historySource(source))).toBe("Interview.m4a");
  });

  test("uses a source URL title without credentials, query parameters, or fragments", () => {
    expect(getHistoryTitle(historySource({
      kind: "url",
      url: "https://user:private@example.com/video/123?token=private#private",
    }))).toBe("example.com/video/123");
  });

  test.each([
    "not a URL",
    "https://[invalid",
    "file:///Users/private/audio.wav",
    "D:/private/audio.wav",
    "javascript:alert('private')",
  ])("uses task identity when a source is invalid or unsuitable for display: %s", (url) => {
    expect(getHistoryTitle(historySource({ kind: "url", url }))).toBe("history-task");
  });

  test("projects available user artifacts while excluding internal task metadata", () => {
    expect(getVisibleArtifactKeys({
      video: "media/video.mp4",
      audio: "media/audio.wav",
      transcript_txt: "transcript/transcript.txt",
      summary: "ai/summary.md",
      mindmap: "ai/mindmap.mmd",
      insights: "ai/insights.json",
      dissection: "ai/dissection.json",
      draft: "ai/draft.md",
      segments: "transcript/segments.json",
      preference_snapshot: "ai/preference-snapshot.json",
      transcript_md: "",
    })).toEqual([
      "video", "audio", "transcript_txt", "summary", "mindmap", "insights", "dissection", "draft",
    ]);
    expect(getVisibleArtifactKeys({})).toEqual([]);
  });
});
