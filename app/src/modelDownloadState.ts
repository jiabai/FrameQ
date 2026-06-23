export type ModelDownloadOperationSnapshot = {
  operationId: number;
  activeOperationId: number;
  cancelledOperationId: number | null;
};

export const MODEL_DOWNLOAD_STALLED_MS = 45_000;

export function shouldApplyModelDownloadUpdate({
  operationId,
  activeOperationId,
  cancelledOperationId,
}: ModelDownloadOperationSnapshot): boolean {
  return operationId === activeOperationId && operationId !== cancelledOperationId;
}

export function isModelDownloadStalled({
  active,
  lastProgressAtMs,
  nowMs,
  thresholdMs = MODEL_DOWNLOAD_STALLED_MS,
}: {
  active: boolean;
  lastProgressAtMs: number;
  nowMs: number;
  thresholdMs?: number;
}): boolean {
  return active && nowMs - lastProgressAtMs >= thresholdMs;
}
