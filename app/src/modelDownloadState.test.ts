import { describe, expect, test } from "vitest";
import {
  MODEL_DOWNLOAD_STALLED_MS,
  isModelDownloadStalled,
  shouldApplyModelDownloadUpdate,
} from "./modelDownloadState";

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

  test("detects active downloads with no recent progress updates", () => {
    expect(
      isModelDownloadStalled({
        active: true,
        lastProgressAtMs: 1_000,
        nowMs: 1_000 + MODEL_DOWNLOAD_STALLED_MS,
      }),
    ).toBe(true);

    expect(
      isModelDownloadStalled({
        active: true,
        lastProgressAtMs: 1_000,
        nowMs: 1_000 + MODEL_DOWNLOAD_STALLED_MS - 1,
      }),
    ).toBe(false);
  });

  test("never reports inactive downloads as stalled", () => {
    expect(
      isModelDownloadStalled({
        active: false,
        lastProgressAtMs: 1_000,
        nowMs: 1_000 + MODEL_DOWNLOAD_STALLED_MS * 2,
      }),
    ).toBe(false);
  });
});
