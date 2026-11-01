import { describe, expect, test } from "vitest";

import type { Collection } from "../../collectionsClient";
import type { HistoryListItem } from "../../historyClient";
import { getCollectionTaskCount, getCollectionTasks, validateCollectionName } from "./collectionModel";

const collection: Collection = { id: "01234567-89ab-4def-8abc-0123456789ab", name: "Research", taskIds: ["first-task", "missing-task"] };

function historyItem(taskId: string): HistoryListItem {
  return {
    taskId, id: taskId, createdAt: "2026-10-30T10:00:00Z",
    source: { kind: "local_file", displayName: "Interview.mp3", mediaKind: "audio" },
    status: "completed", taskDir: `D:/FrameQ/outputs/tasks/${taskId}`,
    outputDir: `D:/FrameQ/outputs/tasks/${taskId}`, artifacts: {},
    error: null, textPreview: taskId, insightsCount: 0,
  };
}

describe("collection names", () => {
  test("trims names and counts Unicode characters without splitting supplementary characters", () => {
    expect(validateCollectionName("  阅读资料  ")).toEqual({ valid: true, name: "阅读资料" });
    expect(validateCollectionName("🎬".repeat(80))).toEqual({ valid: true, name: "🎬".repeat(80) });
    expect(validateCollectionName("🎬".repeat(81))).toEqual({ valid: false, errorCode: "COLLECTION_NAME_INVALID" });
  });

  test.each(["", "   ", "\tResearch", "Research\n", "Private\u0000name", "Invalid\u0085name", "\ud800", null, {}])(
    "rejects empty, control, or malformed names: %j", (name) => {
      expect(validateCollectionName(name)).toEqual({ valid: false, errorCode: "COLLECTION_NAME_INVALID" });
    },
  );

  test("rejects case-insensitive duplicates while allowing a collection to retain its name", () => {
    expect(validateCollectionName(" research ", [collection])).toEqual({ valid: false, errorCode: "COLLECTION_NAME_EXISTS" });
    expect(validateCollectionName("Research", [collection], collection.id)).toEqual({ valid: true, name: "Research" });
  });
});

describe("verified collection task projection", () => {
  test("shows actual history in history order and excludes stale memberships", () => {
    const first = historyItem("first-task");
    const second = historyItem("second-task");
    expect(getCollectionTasks(collection, [second, first])).toEqual([first]);
    expect(getCollectionTaskCount(collection, [second, first])).toBe(1);
    expect(getCollectionTasks(collection, [])).toEqual([]);
    expect(getCollectionTaskCount(collection, [])).toBe(0);
  });

  test("supports the same task in multiple collections without mutating history or membership", () => {
    const task = historyItem("first-task");
    const another = { ...collection, id: "11234567-89ab-4def-8abc-0123456789ab", name: "Archive" };
    expect(getCollectionTasks(collection, [task])[0]).toBe(task);
    expect(getCollectionTasks(another, [task])[0]).toBe(task);
    expect(collection.taskIds).toEqual(["first-task", "missing-task"]);
  });
});
