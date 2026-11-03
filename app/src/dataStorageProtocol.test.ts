import { describe, expect, test } from "vitest";
import { parseCleanupPreview, parseDirectorySelection, parseMigrationPreview, parseStorageState, storageErrorCode, storageErrorTranslation } from "./dataStorageProtocol";
import { acceptStorageEvent } from "./features/dataStorage/useDataStorageController";
import * as protocol from "./dataStorageProtocol";
import * as controller from "./features/dataStorage/useDataStorageController";

function preflight() {
  return { requestId: "6ec49382-bd73-47f0-9209-249a2de176c0", generation: 3, sequence: 1, kind: "migration", stage: "inventory_scanning", completedFiles: 12, totalFiles: null, completedBytes: 8192, totalBytes: null, currentFileBytes: 0, currentFileTotalBytes: 0 };
}

describe("storage preflight progress boundary", () => {
  test("preserves discovered counts while totals are unknown", () => {
    const progress = protocol.parseStoragePreflightProgress(preflight());
    expect(progress.totalFiles).toBeNull();
    expect(progress.completedFiles).toBe(12);
    expect(progress.totalBytes).toBeNull();
  });
  test("preserves real large-file reads while checking cleanup candidates", () => {
    const progress = protocol.parseStoragePreflightProgress({ ...preflight(), kind: "cleanup", stage: "cleanup_checking", totalFiles: 100, totalBytes: 20_000_000, currentFileBytes: 4096, currentFileTotalBytes: 10_000_000 });
    expect(progress.currentFileBytes).toBe(4096);
    expect(progress.kind).toBe("cleanup");
  });
  test.each([
    { ...preflight(), requestId: "not-a-uuid" },
    { ...preflight(), requestId: "6EC49382-BD73-47F0-9209-249A2DE176C0" },
    { ...preflight(), sequence: 0 }, { ...preflight(), generation: -1 },
    { ...preflight(), stage: "copying" }, { ...preflight(), totalFiles: 5 },
    { ...preflight(), totalBytes: 5 }, { ...preflight(), currentFileBytes: 1 },
    { ...preflight(), privatePath: "C:/private" },
    { ...preflight(), completedFiles: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid request identity, phase and counts %#", value => {
    expect(() => protocol.parseStoragePreflightProgress(value)).toThrow("DATA_STORAGE_IPC_RESPONSE_INVALID");
  });
  test("does not execute progress getters", () => {
    const value = preflight();
    Object.defineProperty(value, "stage", { get() { throw Error("Getter executed"); }, enumerable: true });
    expect(() => protocol.parseStoragePreflightProgress(value)).toThrow("DATA_STORAGE_IPC_RESPONSE_INVALID");
  });
  test("requires null acknowledgement for registration and cancellation", () => {
    expect(protocol.parseStoragePreflightAcknowledgement(null)).toBeUndefined();
    expect(() => protocol.parseStoragePreflightAcknowledgement({})).toThrow("DATA_STORAGE_IPC_RESPONSE_INVALID");
    expect(() => protocol.parseStoragePreflightAcknowledgement(undefined)).toThrow("DATA_STORAGE_IPC_RESPONSE_INVALID");
  });
  test("cancelled, replaced and out-of-order preflight progress cannot reopen preparation", () => {
    const incoming = protocol.parseStoragePreflightProgress(preflight());
    const active = { requestId: incoming.requestId, generation: incoming.generation, kind: incoming.kind, sequence: 0, cancelled: false };
    expect(controller.acceptStoragePreflightProgress(active, incoming)).toBe(true);
    expect(controller.acceptStoragePreflightProgress({ ...active, cancelled: true }, incoming)).toBe(false);
    expect(controller.acceptStoragePreflightProgress(null, incoming)).toBe(false);
    expect(controller.acceptStoragePreflightProgress({ ...active, requestId: "88eab520-0769-40f2-9cc9-a84e416d20b4" }, incoming)).toBe(false);
    expect(controller.acceptStoragePreflightProgress({ ...active, generation: 4 }, incoming)).toBe(false);
    expect(controller.acceptStoragePreflightProgress({ ...active, kind: "cleanup" }, incoming)).toBe(false);
    expect(controller.acceptStoragePreflightProgress({ ...active, sequence: 1 }, incoming)).toBe(false);
    expect(controller.acceptStoragePreflightProgress({ ...active, sequence: 2 }, incoming)).toBe(false);
    expect(controller.acceptStoragePreflightProgress({ ...active, executionStarted: true }, incoming)).toBe(false);
  });
  test("actual execution replaces waiting while resumed inventory checks retain their own progress", () => {
    const copying = parseStorageState({ ...ready(), operation: operation() }).operation;
    expect(controller.isStoragePreflightActive(true, null, copying)).toBe(false);
    expect(controller.isStoragePreflightActive(true, protocol.parseStoragePreflightProgress({ ...preflight(), stage: "waiting" }), copying)).toBe(false);
    expect(controller.isStoragePreflightActive(true, protocol.parseStoragePreflightProgress(preflight()), copying)).toBe(true);
    expect(controller.isStoragePreflightActive(true, null, copying ? { ...copying, canResume: true } : null)).toBe(true);
    const cleaning = parseStorageState({ ...ready(), operation: { ...operation(), phase: "cleaning", canCancel: false } }).operation;
    expect(controller.isStoragePreflightActive(true, null, cleaning)).toBe(false);
    expect(controller.isStoragePreflightActive(false, protocol.parseStoragePreflightProgress(preflight()), null)).toBe(false);
  });
  test.each(["merging", "publishing", "restart_required", "validating", "cleaning"])("protected %s progress stays visible during resume checks", phase => {
    const progress = protocol.parseStoragePreflightProgress({ ...preflight(), stage: "integrity_check" });
    const protectedOperation = parseStorageState({ ...ready(), operation: { ...operation(), merge: phase === "merging", phase, canCancel: false } }).operation;
    expect(controller.isStoragePreflightActive(true, progress, protectedOperation)).toBe(false);
    expect(controller.isStoragePreflightActive(true, progress, protectedOperation ? { ...protectedOperation, canResume: true } : null)).toBe(false);
  });
  test("only actual native execution events finish transient preflight progress", () => {
    const copying = parseStorageState({ ...ready(), operation: operation() }).operation;
    expect(controller.isStorageExecutionEvent(copying, true)).toBe(true);
    expect(controller.isStorageExecutionEvent(copying, false)).toBe(false);
    expect(controller.isStorageExecutionEvent(copying ? { ...copying, canResume: true } : null, true)).toBe(false);
    expect(controller.isStorageExecutionEvent(copying ? { ...copying, phase: "prepared" } : null, true)).toBe(false);
    expect(controller.isStorageExecutionEvent(null, true)).toBe(false);
  });
});

function ready() {
  return { schemaVersion: 1, generation: 3, dataAccess: "ready", mode: "managed", currentPath: "D:/FrameQData", legacyOutputPath: null, lastError: null, operation: null, cleanupReceipts: [], recoveryCandidates: [] };
}
function operation() {
  return { operationId: "migration-1", merge: false, phase: "copying", sourcePaths: ["C:/Data/outputs"], targetPath: "D:/FrameQData", totalFiles: 4, completedFiles: 1, totalBytes: 1024, completedBytes: 256, canCancel: true, canResume: false, lastError: null };
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
    const preview = { planToken: "plan", operationId: "operation", merge: false, generation: 3, sourcePaths: ["C:/Data"], targetPath: "D:/FrameQData", totalFiles: 1, totalBytes: 10, requiredBytes: 1024, availableBytes: 2048 };
    expect(parseMigrationPreview(preview).requiredBytes).toBe(1024);
    expect(() => parseMigrationPreview({ ...preview, availableBytes: Infinity })).toThrow();
    expect(parseCleanupPreview({ planToken: "cleanup", receiptId: "receipt", generation: 3, totalFiles: 1, totalBytes: 10, retainedFiles: 2, sourcePaths: ["C:/Data"] }).retainedFiles).toBe(2);
  });
  test("retains explicit merge policy and protected resumable progress", () => {
    const preview = { planToken: "plan", operationId: "operation", merge: true, generation: 3, sourcePaths: ["C:/Data"], targetPath: "D:/FrameQData", totalFiles: 1, totalBytes: 10, requiredBytes: 1024, availableBytes: 2048 };
    expect(parseMigrationPreview(preview).merge).toBe(true);
    expect(() => parseMigrationPreview({ ...preview, merge: undefined })).toThrow("DATA_STORAGE_IPC_RESPONSE_INVALID");
    const merging = parseStorageState({ ...ready(), operation: { ...operation(), merge: true, phase: "merging", canCancel: false, canResume: true } }).operation;
    expect(merging?.merge).toBe(true);
    expect(merging?.canResume).toBe(true);
    expect(controller.isStorageExecutionEvent(merging ? { ...merging, canResume: false } : null, true)).toBe(true);
    expect(() => parseStorageState({ ...ready(), operation: { ...merging, canCancel: true } })).toThrow("DATA_STORAGE_IPC_RESPONSE_INVALID");
    expect(() => parseStorageState({ ...ready(), operation: { ...merging, merge: false } })).toThrow("DATA_STORAGE_IPC_RESPONSE_INVALID");
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
