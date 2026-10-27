import { describe, expect, test } from "vitest";

import { asrModelLabel } from "./asrModelLabels";

describe("asrModelLabel", () => {
  test("uses the curated label for a known model", () => {
    expect(asrModelLabel("iic/SenseVoiceSmall")).toBe("SenseVoice Small");
    expect(asrModelLabel("iic/SenseVoiceSmall-onnx")).toContain("ONNX");
  });

  test("drops the namespace instead of showing a raw id for a new model", () => {
    expect(asrModelLabel("funasr/Fun-ASR-Nano")).toBe("Fun-ASR-Nano");
  });

  test("leaves an unnamespaced id untouched", () => {
    expect(asrModelLabel("SenseVoiceSmall")).toBe("SenseVoiceSmall");
  });
});
