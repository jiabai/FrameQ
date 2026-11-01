import { describe, expect, test } from "vitest";

import {
  createCollection, deleteCollection, normalizeCollectionsErrorCode, parseCollectionsView,
  renameCollection, setCollectionTaskMembership,
} from "./collectionsClient";
import { IpcProtocolError } from "./tauriIpcProtocol";

const FIRST_ID = "01234567-89ab-4def-8abc-0123456789ab";
const SECOND_ID = "11234567-89ab-4def-8abc-0123456789ab";
const collection = { id: FIRST_ID, name: "Research", taskIds: ["20261030-local-a12b"] };

describe("collections committed view protocol", () => {
  test("parses empty and populated committed views and copies response containers", () => {
    expect(parseCollectionsView({ schemaVersion: 1, collections: [] })).toEqual({ schemaVersion: 1, collections: [] });
    const source = { schemaVersion: 1, collections: [collection] };
    const parsed = parseCollectionsView(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed.collections).not.toBe(source.collections);
    expect(parsed.collections[0]).not.toBe(collection);
    expect(parsed.collections[0].taskIds).not.toBe(collection.taskIds);
  });

  test("accepts Unicode names and membership in multiple collections", () => {
    const unicode = { ...collection, id: SECOND_ID, name: "🎬".repeat(80) };
    expect(parseCollectionsView({ schemaVersion: 1, collections: [collection, unicode] }).collections).toEqual([collection, unicode]);
  });

  test.each([
    null, [], {}, { schemaVersion: 2, collections: [] },
    { schemaVersion: 1, collections: [], filePath: "D:/private/collections.json" },
    { schemaVersion: 1, collections: {} },
    { schemaVersion: 1, collections: [{ ...collection, additional: true }] },
    { schemaVersion: 1, collections: [{ id: FIRST_ID, name: "Research" }] },
    { schemaVersion: 1, collections: [collection, collection] },
    { schemaVersion: 1, collections: [collection, { ...collection, id: SECOND_ID, name: "research" }] },
  ])("rejects malformed view structure without echoing supplied fields: %j", (response) => {
    expect(() => parseCollectionsView(response)).toThrow(new IpcProtocolError("COLLECTIONS_IPC_RESPONSE_INVALID"));
  });

  test.each(["", "00000000-0000-0000-0000-000000000000", FIRST_ID.toUpperCase(), "D:/private/collection", "../collection", "0123456789ab4def8abc0123456789ab"])(
    "rejects unsafe or noncanonical collection identity: %s", (id) => {
      expect(() => parseCollectionsView({ schemaVersion: 1, collections: [{ ...collection, id }] })).toThrow("COLLECTIONS_IPC_RESPONSE_INVALID");
    },
  );

  test.each(["", " ", " Research ", "Research\n", "Research\u0000", "🎬".repeat(81), "\ud800"])(
    "rejects unnormalized or invalid committed names: %j", (name) => {
      expect(() => parseCollectionsView({ schemaVersion: 1, collections: [{ ...collection, name }] })).toThrow("COLLECTIONS_IPC_RESPONSE_INVALID");
    },
  );

  test.each(["", ".", "..", "task/child", "task\\child", "D:private", " task", "task\n", "\ud800"])(
    "rejects unsafe task identities: %j", (taskId) => {
      expect(() => parseCollectionsView({ schemaVersion: 1, collections: [{ ...collection, taskIds: [taskId] }] })).toThrow("COLLECTIONS_IPC_RESPONSE_INVALID");
    },
  );

  test("rejects duplicate task identities within one collection", () => {
    expect(() => parseCollectionsView({ schemaVersion: 1, collections: [{ ...collection, taskIds: ["task", "task"] }] })).toThrow("COLLECTIONS_IPC_RESPONSE_INVALID");
  });

  test("rejects accessor and inherited records without reading their values", () => {
    let accessorReads = 0;
    const accessor = Object.defineProperty({ schemaVersion: 1 }, "collections", {
      enumerable: true,
      get() { accessorReads += 1; return []; },
    });
    expect(() => parseCollectionsView(accessor)).toThrow("COLLECTIONS_IPC_RESPONSE_INVALID");
    expect(accessorReads).toBe(0);
    const inherited = Object.create({ schemaVersion: 1, collections: [] });
    expect(() => parseCollectionsView(inherited)).toThrow("COLLECTIONS_IPC_RESPONSE_INVALID");
  });

  test("rejects sparse, accessor, and extended arrays", () => {
    let accessorReads = 0;
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() { accessorReads += 1; return collection; },
    });
    for (const collections of [new Array(1), accessor, Object.assign([], { extra: true })]) {
      expect(() => parseCollectionsView({ schemaVersion: 1, collections })).toThrow("COLLECTIONS_IPC_RESPONSE_INVALID");
    }
    expect(accessorReads).toBe(0);
  });
});

describe("collection request validation and error normalization", () => {
  test("rejects invalid mutation intent before invoking a native command", async () => {
    await expect(createCollection(" ")).rejects.toThrow("COLLECTION_NAME_INVALID");
    await expect(renameCollection("D:/private/path", "Research")).rejects.toThrow("COLLECTION_NOT_FOUND");
    await expect(renameCollection(FIRST_ID, "Research\n")).rejects.toThrow("COLLECTION_NAME_INVALID");
    await expect(deleteCollection("../collection")).rejects.toThrow("COLLECTION_NOT_FOUND");
    await expect(setCollectionTaskMembership(FIRST_ID, "../task", true)).rejects.toThrow("COLLECTION_TASK_UNAVAILABLE");
    await expect(setCollectionTaskMembership(FIRST_ID, "task", "true" as unknown as boolean)).rejects.toThrow("COLLECTIONS_OPERATION_FAILED");
  });

  test("maps only stable codes and never exposes raw error details", () => {
    expect(normalizeCollectionsErrorCode("COLLECTION_NAME_EXISTS")).toBe("COLLECTION_NAME_EXISTS");
    expect(normalizeCollectionsErrorCode(new Error("COLLECTIONS_WRITE_FAILED"))).toBe("COLLECTIONS_WRITE_FAILED");
    expect(normalizeCollectionsErrorCode(new IpcProtocolError("COLLECTIONS_IPC_RESPONSE_INVALID"))).toBe("COLLECTIONS_IPC_RESPONSE_INVALID");
    expect(normalizeCollectionsErrorCode({ code: "COLLECTION_NOT_FOUND" })).toBe("COLLECTION_NOT_FOUND");
    for (const error of [null, undefined, "D:/private/collections.json", new Error("Read failed at D:/private/data"), { code: "PRIVATE_PATH" }]) {
      expect(normalizeCollectionsErrorCode(error)).toBe("COLLECTIONS_OPERATION_FAILED");
    }
  });
});
