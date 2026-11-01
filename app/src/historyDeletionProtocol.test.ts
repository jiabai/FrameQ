import { describe, expect, test } from "vitest";
import { parseHistoryCleanupResponse, parseHistoryDeleteResponse } from "./historyClient";
import { IpcProtocolError } from "./tauriIpcProtocol";

const invalid = new IpcProtocolError("HISTORY_IPC_RESPONSE_INVALID");
const completed = { task_id: "saved-note", status: "completed", error_code: null };

describe("native permanent deletion response boundary", () => {
  test("distinguishes accepted pending cleanup from physically completed deletion", () => {
    expect(parseHistoryDeleteResponse(completed, "saved-note")).toEqual(completed);
    expect(parseHistoryCleanupResponse({ ...completed, status: "cleanup_pending", error_code: "HISTORY_DELETE_CLEANUP_PENDING" }))
      .toEqual({ taskId: "saved-note", status: "cleanup_pending", errorCode: "HISTORY_DELETE_CLEANUP_PENDING" });
    expect(parseHistoryCleanupResponse({ task_id: null, status: "idle", error_code: null }))
      .toEqual({ taskId: null, status: "idle", errorCode: null });
  });

  test.each([
    { ...completed, task_id: "another-note" },
    { ...completed, deleted: true },
    { ...completed, path: "D:/private" },
    { ...completed, status: "accepted" },
    { ...completed, error_code: "HISTORY_DELETE_FAILED" },
    { ...completed, status: "cleanup_pending" },
    { ...completed, status: "cleanup_pending", error_code: "private exception" },
  ])("rejects stale or incoherent deletion results %#", (value) => {
    expect(() => parseHistoryDeleteResponse(value, "saved-note")).toThrowError(invalid);
  });

  test.each([
    { task_id: null, status: "cleanup_pending", error_code: "HISTORY_DELETE_CLEANUP_PENDING" },
    { task_id: "saved-note", status: "idle", error_code: null },
    { task_id: "../saved-note", status: "completed", error_code: null },
  ])("rejects incomplete cleanup identity %#", (value) => {
    expect(() => parseHistoryCleanupResponse(value)).toThrowError(invalid);
  });
});
