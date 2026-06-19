import { describe, expect, test } from "vitest";
import { shouldApplyModelDownloadUpdate } from "./modelDownloadState";

describe("model download operation state", () => {
  test("applies updates only for the active non-cancelled operation", () => {
    expect(
      shouldApplyModelDownloadUpdate({
        operationId: 2,
        activeOperationId: 2,
        cancelledOperationId: null,
      }),
    ).toBe(true);
  });

  test("ignores stale operation updates", () => {
    expect(
      shouldApplyModelDownloadUpdate({
        operationId: 1,
        activeOperationId: 2,
        cancelledOperationId: null,
      }),
    ).toBe(false);
  });

  test("ignores cancelled operation settlement so cancelled UI is preserved", () => {
    expect(
      shouldApplyModelDownloadUpdate({
        operationId: 2,
        activeOperationId: 2,
        cancelledOperationId: 2,
      }),
    ).toBe(false);
  });
});
