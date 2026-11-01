import type { Collection } from "../../collectionsClient";
import type { HistoryListItem } from "../../historyClient";

export type CollectionNameValidation =
  | { valid: true; name: string }
  | { valid: false; errorCode: "COLLECTION_NAME_INVALID" | "COLLECTION_NAME_EXISTS" };

const INVALID_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u;

export function validateCollectionName(
  value: unknown,
  collections: readonly Collection[] = [],
  excludeId?: string,
): CollectionNameValidation {
  if (typeof value !== "string" || INVALID_NAME_CHARACTERS.test(value)) {
    return { valid: false, errorCode: "COLLECTION_NAME_INVALID" };
  }
  const name = value.trim();
  if (name.length === 0 || Array.from(name).length > 80) {
    return { valid: false, errorCode: "COLLECTION_NAME_INVALID" };
  }
  if (collections.some((collection) =>
    collection.id !== excludeId && collection.name.toLowerCase() === name.toLowerCase(),
  )) {
    return { valid: false, errorCode: "COLLECTION_NAME_EXISTS" };
  }
  return { valid: true, name };
}

export function getCollectionTasks(
  collection: Collection,
  history: readonly HistoryListItem[],
): HistoryListItem[] {
  const membership = new Set(collection.taskIds);
  return history.filter((task) => membership.has(task.taskId));
}

export function getCollectionTaskCount(
  collection: Collection,
  history: readonly HistoryListItem[],
): number {
  return getCollectionTasks(collection, history).length;
}
