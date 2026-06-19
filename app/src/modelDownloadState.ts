export type ModelDownloadOperationSnapshot = {
  operationId: number;
  activeOperationId: number;
  cancelledOperationId: number | null;
};

export function shouldApplyModelDownloadUpdate({
  operationId,
  activeOperationId,
  cancelledOperationId,
}: ModelDownloadOperationSnapshot): boolean {
  return operationId === activeOperationId && operationId !== cancelledOperationId;
}
