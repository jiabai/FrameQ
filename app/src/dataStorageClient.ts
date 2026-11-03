import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DATA_STORAGE_EVENT, DATA_STORAGE_PREFLIGHT_EVENT, parseCleanupPreview, parseDirectorySelection, parseMigrationPreview, parseStorageState, parseStoragePreflightAcknowledgement, parseStoragePreflightProgress, type DirectoryPurpose, type StoragePreflightKind, type StoragePreflightProgress, type StorageState } from "./dataStorageProtocol";

export const getDataStorageState = async () => parseStorageState(await invoke("get_data_storage_state"));
export const selectDataStorageDirectory = async (purpose: DirectoryPurpose) => parseDirectorySelection(await invoke("select_data_storage_directory", { purpose }));
export const beginDataStoragePreflight = async (requestId: string, kind: StoragePreflightKind, expectedGeneration: number) => parseStoragePreflightAcknowledgement(await invoke("begin_data_storage_preflight", { requestId, kind, expectedGeneration }));
export const cancelDataStoragePreflight = async (requestId: string) => parseStoragePreflightAcknowledgement(await invoke("cancel_data_storage_preflight", { requestId }));
export const prepareDataStorageMigration = async (targetToken: string, legacySourceTokens: string[], expectedGeneration: number, requestId: string) => parseMigrationPreview(await invoke("prepare_data_storage_migration", { targetToken, legacySourceTokens, expectedGeneration, requestId }));
export const confirmDataStorageMigration = async (planToken: string) => parseStorageState(await invoke("confirm_data_storage_migration", { planToken }));
export const getPendingDataStoragePreview = async () => parseMigrationPreview(await invoke("get_pending_data_storage_preview"));
export const cancelDataStorageMigration = async (operationId: string, expectedGeneration: number) => parseStorageState(await invoke("cancel_data_storage_migration", { operationId, expectedGeneration }));
export const resumeDataStorageMigration = async (operationId: string, expectedGeneration: number, legacySourceTokens: string[], requestId: string) => parseStorageState(await invoke("resume_data_storage_migration", { operationId, expectedGeneration, legacySourceTokens, requestId }));
export const recheckDataStorage = async () => parseStorageState(await invoke("recheck_data_storage"));
export const relinkDataStorage = async (selectionToken: string) => parseStorageState(await invoke("relink_data_storage", { selectionToken }));
export const restartForDataStorage = async (): Promise<void> => { await invoke("restart_for_data_storage"); };
export const prepareOldStorageCleanup = async (receiptId: string, requestId: string) => parseCleanupPreview(await invoke("prepare_old_storage_cleanup", { receiptId, requestId }));
export const confirmOldStorageCleanup = async (planToken: string) => parseStorageState(await invoke("confirm_old_storage_cleanup", { planToken }));
export const listenDataStorage = (receive: (state: StorageState) => void, rejected: (error: unknown) => void) => listen<unknown>(DATA_STORAGE_EVENT, event => {
  try { receive(parseStorageState(event.payload)); } catch (error) { rejected(error); }
});
export const listenDataStoragePreflight = (receive: (progress: StoragePreflightProgress) => void, rejected: (error: unknown) => void) => listen<unknown>(DATA_STORAGE_PREFLIGHT_EVENT, event => {
  try { receive(parseStoragePreflightProgress(event.payload)); } catch (error) { rejected(error); }
});
