import { invoke } from "@tauri-apps/api/core";

import { validateCollectionName } from "./features/collections/collectionModel";
import { IpcProtocolError, readIpcDataArray, readIpcDataObject } from "./tauriIpcProtocol";

export type Collection = { id: string; name: string; taskIds: string[] };
export type CollectionsView = { schemaVersion: 1; collections: Collection[] };

const PROTOCOL_INVALID = "COLLECTIONS_IPC_RESPONSE_INVALID";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const UNSAFE_TASK_ID = /[/\\:\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u;

const ERROR_CODES = [
  "COLLECTIONS_IPC_RESPONSE_INVALID", "COLLECTIONS_OPERATION_FAILED",
  "COLLECTIONS_READ_FAILED", "COLLECTIONS_WRITE_FAILED", "COLLECTIONS_DATA_INVALID",
  "COLLECTION_NOT_FOUND", "COLLECTION_NAME_INVALID", "COLLECTION_NAME_EXISTS",
  "COLLECTION_TASK_UNAVAILABLE",
] as const;
export type CollectionsErrorCode = (typeof ERROR_CODES)[number];

function isCollectionId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value) && value !== NIL_UUID;
}

function isTaskId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim() &&
    value !== "." && value !== ".." && !UNSAFE_TASK_ID.test(value);
}

export function parseCollectionsView(response: unknown): CollectionsView {
  const view = readIpcDataObject(response, ["schemaVersion", "collections"], [], PROTOCOL_INVALID);
  if (view.schemaVersion !== 1) throw new IpcProtocolError(PROTOCOL_INVALID);
  const ids = new Set<string>();
  const names = new Set<string>();
  const collections = readIpcDataArray(view.collections, PROTOCOL_INVALID).map((value): Collection => {
    const collection = readIpcDataObject(value, ["id", "name", "taskIds"], [], PROTOCOL_INVALID);
    const validatedName = validateCollectionName(collection.name);
    if (!isCollectionId(collection.id) || ids.has(collection.id) || !validatedName.valid ||
      validatedName.name !== collection.name || names.has(validatedName.name.toLowerCase())) {
      throw new IpcProtocolError(PROTOCOL_INVALID);
    }
    ids.add(collection.id);
    names.add(validatedName.name.toLowerCase());
    const membership = new Set<string>();
    const taskIds = readIpcDataArray(collection.taskIds, PROTOCOL_INVALID).map((taskId) => {
      if (!isTaskId(taskId) || membership.has(taskId)) throw new IpcProtocolError(PROTOCOL_INVALID);
      membership.add(taskId);
      return taskId;
    });
    return { id: collection.id, name: validatedName.name, taskIds };
  });
  return { schemaVersion: 1, collections };
}

export function normalizeCollectionsErrorCode(error: unknown): CollectionsErrorCode {
  const candidates: unknown[] = typeof error === "string" ? [error] : [];
  if (error && typeof error === "object") {
    for (const field of ["code", "message"]) {
      const descriptor = Object.getOwnPropertyDescriptor(error, field);
      if (descriptor && "value" in descriptor) candidates.push(descriptor.value);
    }
  }
  for (const value of candidates) {
    if ((ERROR_CODES as readonly unknown[]).includes(value)) return value as CollectionsErrorCode;
  }
  return "COLLECTIONS_OPERATION_FAILED";
}

function requireCollectionId(collectionId: string): void {
  if (!isCollectionId(collectionId)) throw new Error("COLLECTION_NOT_FOUND");
}

function normalizedName(name: string): string {
  const validation = validateCollectionName(name);
  if (!validation.valid) throw new Error(validation.errorCode);
  return validation.name;
}

export async function getCollections(): Promise<CollectionsView> {
  return parseCollectionsView(await invoke("get_collections", {}));
}

export async function createCollection(name: string): Promise<CollectionsView> {
  return parseCollectionsView(await invoke("create_collection", { request: { name: normalizedName(name) } }));
}

export async function renameCollection(collectionId: string, name: string): Promise<CollectionsView> {
  requireCollectionId(collectionId);
  return parseCollectionsView(await invoke("rename_collection", { request: { collectionId, name: normalizedName(name) } }));
}

export async function deleteCollection(collectionId: string): Promise<CollectionsView> {
  requireCollectionId(collectionId);
  return parseCollectionsView(await invoke("delete_collection", { request: { collectionId } }));
}

export async function setCollectionTaskMembership(collectionId: string, taskId: string, included: boolean): Promise<CollectionsView> {
  requireCollectionId(collectionId);
  if (!isTaskId(taskId)) throw new Error("COLLECTION_TASK_UNAVAILABLE");
  if (typeof included !== "boolean") throw new Error("COLLECTIONS_OPERATION_FAILED");
  return parseCollectionsView(await invoke("set_collection_task_membership", { request: { collectionId, taskId, included } }));
}
