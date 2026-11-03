import { IpcProtocolError, readIpcDataArray, readIpcDataObject } from "./tauriIpcProtocol";

export const DATA_STORAGE_EVENT = "data-storage-progress";
export const DATA_STORAGE_PREFLIGHT_EVENT = "data-storage-preflight-progress";
export const STORAGE_PREFLIGHT_STAGES = ["waiting", "inventory_scanning", "source_validation", "integrity_check", "target_check", "cleanup_checking"] as const;
export type StoragePreflightKind = "migration" | "cleanup";
export type StoragePreflightProgress = {
  requestId: string; generation: number; sequence: number; kind: StoragePreflightKind;
  stage: typeof STORAGE_PREFLIGHT_STAGES[number]; completedFiles: number; totalFiles: number | null;
  completedBytes: number; totalBytes: number | null; currentFileBytes: number; currentFileTotalBytes: number;
};
export const STORAGE_ERROR_CODES = ["DataUnavailable", "ControlInvalid", "Busy", "UnsafePath", "TargetConflict", "LegacySourceAmbiguous", "InsufficientSpace", "PermissionDenied", "SourceChanged", "VerificationFailed", "CommitFailed", "StorageIoFailed", "InvalidToken", "StaleOperation", "ControlLimit", "TaskRecoveryFailed", "Cancelled", "RestartRequired", "StorageValidationFailed", "OperationFailed", "DATA_STORAGE_IPC_RESPONSE_INVALID"] as const;
export type StorageErrorCode = typeof STORAGE_ERROR_CODES[number];
export const STORAGE_PHASES = ["waiting", "prepared", "copying", "verifying", "merging", "publishing", "restart_required", "validating", "cleaning", "failed", "cancelled"] as const;
export type StoragePhase = typeof STORAGE_PHASES[number];
export type DataAccess = "ready" | "quiescing" | "recovery_required" | "restart_required" | "unavailable";
export type DirectoryPurpose = "target" | "legacy_source" | "relink";
export type StorageOperation = {
  operationId: string; phase: StoragePhase; sourcePaths: string[]; targetPath: string;
  completedBytes: number; totalBytes: number; completedFiles: number; totalFiles: number;
  lastError: StorageErrorCode | null; canCancel: boolean; canResume: boolean; merge: boolean;
};
export type StorageReceipt = { receiptId: string; sourcePaths: string[]; totalBytes: number; totalFiles: number };
export type StorageState = {
  schemaVersion: 1; dataAccess: DataAccess; generation: number; currentPath: string; mode: "legacy" | "managed";
  legacyOutputPath: string | null; lastError: StorageErrorCode | null;
  operation: StorageOperation | null; cleanupReceipts: StorageReceipt[];
  recoveryCandidates: StorageOperation[];
};
export type DirectorySelection = { selectionToken: string; path: string };
export type MigrationPreview = {
  planToken: string; operationId: string; generation: number; sourcePaths: string[]; targetPath: string;
  totalBytes: number; totalFiles: number; requiredBytes: number; availableBytes: number; merge: boolean;
};
export type CleanupPreview = { planToken: string; receiptId: string; generation: number; totalBytes: number; totalFiles: number; retainedFiles: number; sourcePaths: string[] };
const invalid = "DATA_STORAGE_IPC_RESPONSE_INVALID";
function fail(): never { throw new IpcProtocolError(invalid); }
function object(value: unknown, keys: string[]) { return readIpcDataObject(value, keys, [], invalid); }
function text(value: unknown, empty = false): string {
  if (typeof value !== "string" || value.length > 32768 || (!empty && !value.length) || /[\u0000-\u001f\u007f]/u.test(value)) fail();
  return value;
}
function count(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(); return value; }
function flag(value: unknown): boolean { if (typeof value !== "boolean") fail(); return value; }
function strings(value: unknown): string[] {
  const items = readIpcDataArray(value, invalid); if (items.length > 1024) fail(); return items.map(item => text(item));
}
function member<T extends string>(value: unknown, choices: readonly T[]): T { if (!choices.includes(value as T)) fail(); return value as T; }
export function parseStoragePreflightAcknowledgement(value: unknown): void { if (value !== null) fail(); }
export function parseStoragePreflightProgress(value: unknown): StoragePreflightProgress {
  const x = object(value, ["requestId", "generation", "sequence", "kind", "stage", "completedFiles", "totalFiles", "completedBytes", "totalBytes", "currentFileBytes", "currentFileTotalBytes"]);
  const requestId = text(x.requestId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(requestId)) fail();
  const progress: StoragePreflightProgress = { requestId, generation: count(x.generation), sequence: count(x.sequence), kind: member(x.kind, ["migration", "cleanup"]), stage: member(x.stage, STORAGE_PREFLIGHT_STAGES), completedFiles: count(x.completedFiles), totalFiles: x.totalFiles === null ? null : count(x.totalFiles), completedBytes: count(x.completedBytes), totalBytes: x.totalBytes === null ? null : count(x.totalBytes), currentFileBytes: count(x.currentFileBytes), currentFileTotalBytes: count(x.currentFileTotalBytes) };
  if (progress.sequence === 0 || progress.totalFiles !== null && progress.completedFiles > progress.totalFiles || progress.totalBytes !== null && progress.completedBytes > progress.totalBytes || progress.currentFileBytes > progress.currentFileTotalBytes) fail();
  return progress;
}
export function parseStorageOperation(value: unknown): StorageOperation {
  const x = object(value, ["operationId", "phase", "sourcePaths", "targetPath", "completedBytes", "totalBytes", "completedFiles", "totalFiles", "lastError", "canCancel", "canResume", "merge"]);
  const result: StorageOperation = { operationId: text(x.operationId), phase: member(x.phase, STORAGE_PHASES), sourcePaths: strings(x.sourcePaths), targetPath: text(x.targetPath), completedBytes: count(x.completedBytes), totalBytes: count(x.totalBytes), completedFiles: count(x.completedFiles), totalFiles: count(x.totalFiles), lastError: x.lastError === null ? null : member(x.lastError, STORAGE_ERROR_CODES), canCancel: flag(x.canCancel), canResume: flag(x.canResume), merge: flag(x.merge) };
  if (result.completedBytes > result.totalBytes || result.completedFiles > result.totalFiles || (result.canCancel && ["merging", "publishing", "restart_required", "validating"].includes(result.phase)) || result.phase === "cleaning" && result.canCancel && !result.canResume || result.phase === "merging" && !result.merge) fail();
  return result;
}
export function parseStorageState(value: unknown): StorageState {
  const x = object(value, ["schemaVersion", "dataAccess", "generation", "currentPath", "mode", "operation", "cleanupReceipts", "legacyOutputPath", "lastError", "recoveryCandidates"]);
  if (x.schemaVersion !== 1) fail();
  const receipts = readIpcDataArray(x.cleanupReceipts, invalid); if (receipts.length > 1024) fail();
  const seen = new Set<string>();
  const cleanupReceipts = receipts.map(value => {
    const r = object(value, ["receiptId", "sourcePaths", "totalBytes", "totalFiles"]);
    const receiptId = text(r.receiptId); if (seen.has(receiptId)) fail(); seen.add(receiptId);
    return { receiptId, sourcePaths: strings(r.sourcePaths), totalBytes: count(r.totalBytes), totalFiles: count(r.totalFiles) };
  });
  const candidates = readIpcDataArray(x.recoveryCandidates, invalid); if (candidates.length > 1024) fail();
  const candidateIds = new Set<string>();
  const recoveryCandidates = candidates.map(value => { const operation = parseStorageOperation(value); if (operation.phase !== "cancelled" || candidateIds.has(operation.operationId)) fail(); candidateIds.add(operation.operationId); return operation; });
  return { schemaVersion: 1, dataAccess: member(x.dataAccess, ["ready", "quiescing", "recovery_required", "restart_required", "unavailable"]), generation: count(x.generation), currentPath: text(x.currentPath, true), legacyOutputPath: x.legacyOutputPath === null ? null : text(x.legacyOutputPath), lastError: x.lastError === null ? null : member(x.lastError, STORAGE_ERROR_CODES), mode: member(x.mode, ["legacy", "managed"]), operation: x.operation === null ? null : parseStorageOperation(x.operation), cleanupReceipts, recoveryCandidates };
}
export function parseDirectorySelection(value: unknown): DirectorySelection | null {
  if (value === null) return null; const x = object(value, ["selectionToken", "path"]);
  return { selectionToken: text(x.selectionToken), path: text(x.path) };
}
export function parseMigrationPreview(value: unknown): MigrationPreview {
  const x = object(value, ["planToken", "operationId", "generation", "sourcePaths", "targetPath", "totalBytes", "totalFiles", "requiredBytes", "availableBytes", "merge"]);
  return { planToken: text(x.planToken), operationId: text(x.operationId), generation: count(x.generation), sourcePaths: strings(x.sourcePaths), targetPath: text(x.targetPath), totalBytes: count(x.totalBytes), totalFiles: count(x.totalFiles), requiredBytes: count(x.requiredBytes), availableBytes: count(x.availableBytes), merge: flag(x.merge) };
}
export function parseCleanupPreview(value: unknown): CleanupPreview {
  const x = object(value, ["planToken", "receiptId", "generation", "totalBytes", "totalFiles", "retainedFiles", "sourcePaths"]);
  return { planToken: text(x.planToken), receiptId: text(x.receiptId), generation: count(x.generation), totalBytes: count(x.totalBytes), totalFiles: count(x.totalFiles), retainedFiles: count(x.retainedFiles), sourcePaths: strings(x.sourcePaths) };
}
export function storageErrorCode(error: unknown): StorageErrorCode {
  if (typeof error === "string" && STORAGE_ERROR_CODES.includes(error as StorageErrorCode)) return error as StorageErrorCode;
  if (error instanceof IpcProtocolError && error.code === invalid) return invalid;
  if (error && typeof error === "object") {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    if (descriptor && "value" in descriptor && STORAGE_ERROR_CODES.includes(descriptor.value)) return descriptor.value as StorageErrorCode;
  }
  return "OperationFailed";
}
export function storageErrorTranslation(code: StorageErrorCode, merge = false) {
  if (code === "StaleOperation") return "errors.InvalidToken";
  if (code === "ControlLimit") return "errors.ControlInvalid";
  if (code === "TaskRecoveryFailed" || code === "StorageValidationFailed" || code === "VerificationFailed") return merge ? "mergeVerificationFailed" : "errors.VerificationFailed";
  if (code === "RestartRequired") return "restartBody";
  if (code === "Cancelled") return "phases.cancelled";
  return `errors.${code}` as const;
}
