import { describe, expect, test } from "vitest";
import { parseCleanupPreview, parseDirectorySelection, parseMigrationPreview, parseStorageState, storageErrorCode, storageErrorTranslation } from "./dataStorageProtocol";
import { acceptStorageEvent } from "./features/dataStorage/useDataStorageController";

function ready() {
  return { schemaVersion: 1, generation: 3, dataAccess: "ready", mode: "managed", currentPath: "D:/FrameQData", legacyOutputPath: null, lastError: null, operation: null, cleanupReceipts: [], recoveryCandidates: [] };
}
function operation() {
  return { operationId: "migration-1", phase: "copying", sourcePaths: ["C:/Data/outputs"], targetPath: "D:/FrameQData", totalFiles: 4, completedFiles: 1, totalBytes: 1024, completedBytes: 256, canCancel: true, canResume: false, lastError: null };
}
describe("data-storage response boundary", () => {
  test("ready remains usable with durable cleanup and cancelled recovery candidates", () => {
    const state = parseStorageState({ ...ready(), cleanupReceipts: [{ receiptId: "receipt-1", sourcePaths: ["C:/Data/outputs"], totalFiles: 4, totalBytes: 1024 }], recoveryCandidates: [{ ...operation(), phase: "cancelled", canResume: true }] });
    expect(state.dataAccess).toBe("ready");
    expect(state.cleanupReceipts[0].totalFiles).toBe(4);
    expect(state.recoveryCandidates[0].canResume).toBe(true);
  });
  test("accepts a committed restart without an active copying operation", () => {
    expect(parseStorageState({ ...ready(), dataAccess: "restart_required", lastError: "RestartRequired" }).operation).toBeNull();
  });
  test("preserves cancelled copies that the current storage generation cannot resume", () => {
    const state = parseStorageState({ ...ready(), recoveryCandidates: [{ ...operation(), phase: "cancelled", canResume: false }] });
    expect(state.recoveryCandidates[0].canResume).toBe(false);
  });
  test("allows stopping an interrupted cleanup while active cleanup remains protected", () => {
    const state = parseStorageState({ ...ready(), dataAccess: "recovery_required", operation: { ...operation(), phase: "cleaning", canResume: true, lastError: "PermissionDenied" } });
    expect(state.operation?.canCancel).toBe(true);
    expect(state.operation?.canResume).toBe(true);
  });
  test.each([
    { ...ready(), generation: -1 }, { ...ready(), generation: Number.MAX_SAFE_INTEGER + 1 },
    { ...ready(), dataAccess: "empty_library" }, { ...ready(), schemaVersion: 2 },
    { ...ready(), currentPath: "D:/Data\u0000" }, { ...ready(), ignoredField: true },
    { ...ready(), operation: { ...operation(), completedBytes: 2048 } },
    { ...ready(), operation: { ...operation(), phase: "publishing" } },
    { ...ready(), operation: { ...operation(), phase: "cleaning" } },
    { ...ready(), operation: { ...operation(), lastError: "raw private path" } },
    { ...ready(), recoveryCandidates: [{ ...operation(), canResume: true }] },
  ])("rejects malformed storage authority or progress %#", value => {
    expect(() => parseStorageState(value)).toThrow("DATA_STORAGE_IPC_RESPONSE_INVALID");
  });
  test("never executes response getters", () => {
    const value = ready();
    Object.defineProperty(value, "currentPath", { get() { throw new Error("Getter executed"); }, enumerable: true });
    expect(() => parseStorageState(value)).toThrow("DATA_STORAGE_IPC_RESPONSE_INVALID");
  });
  test("rejects duplicate cleanup identities and unsafe candidate progress", () => {
    const receipt = { receiptId: "same", sourcePaths: ["C:/Data"], totalFiles: 1, totalBytes: 1 };
    expect(() => parseStorageState({ ...ready(), cleanupReceipts: [receipt, receipt] })).toThrow();
    expect(() => parseStorageState({ ...ready(), operation: { ...operation(), completedFiles: 5 } })).toThrow();
  });
  test("parses selection cancellation and only declared preview fields", () => {
    expect(parseDirectorySelection(null)).toBeNull();
    expect(parseDirectorySelection({ selectionToken: "selection-1", path: "D:/FrameQData" })?.selectionToken).toBe("selection-1");
    const preview = { planToken: "plan", operationId: "operation", generation: 3, sourcePaths: ["C:/Data"], targetPath: "D:/FrameQData", totalFiles: 1, totalBytes: 10, requiredBytes: 1024, availableBytes: 2048 };
    expect(parseMigrationPreview(preview).requiredBytes).toBe(1024);
    expect(() => parseMigrationPreview({ ...preview, availableBytes: Infinity })).toThrow();
    expect(parseCleanupPreview({ planToken: "cleanup", receiptId: "receipt", generation: 3, totalFiles: 1, totalBytes: 10, retainedFiles: 2, sourcePaths: ["C:/Data"] }).retainedFiles).toBe(2);
  });
  test("maps only closed local errors and their localized keys", () => {
    expect(storageErrorCode({ code: "StorageValidationFailed" })).toBe("StorageValidationFailed");
    expect(storageErrorCode("a raw path or filesystem diagnostic")).toBe("OperationFailed");
    expect(storageErrorTranslation("RestartRequired")).toBe("restartBody");
    expect(storageErrorTranslation("StorageValidationFailed")).toBe("errors.VerificationFailed");
  });
  test("old generations, closed operations and other concurrent operation events cannot replace current UI", () => {
    const current = parseStorageState({ ...ready(), operation: operation() });
    expect(acceptStorageEvent(current, parseStorageState({ ...ready(), generation: 2 }), new Set())).toBe(false);
    expect(acceptStorageEvent(null, current, new Set(["migration-1"]))).toBe(false);
    expect(acceptStorageEvent(current, parseStorageState({ ...ready(), operation: { ...operation(), operationId: "other" } }), new Set())).toBe(false);
    expect(acceptStorageEvent(current, parseStorageState({ ...ready(), generation: 4 }), new Set())).toBe(true);
  });
});
