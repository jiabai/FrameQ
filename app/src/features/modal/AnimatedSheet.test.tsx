import { describe, expect, test } from "vitest";

import { resolveAnimatedSheetPhase } from "./AnimatedSheet";

describe("AnimatedSheet lifecycle", () => {
  test("keeps an open sheet in the closing phase until its exit animation completes", () => {
    expect(
      resolveAnimatedSheetPhase({ open: true, present: true, exitComplete: false }),
    ).toBe("open");
    expect(
      resolveAnimatedSheetPhase({ open: false, present: true, exitComplete: false }),
    ).toBe("closing");
    expect(
      resolveAnimatedSheetPhase({ open: false, present: true, exitComplete: true }),
    ).toBe("hidden");
  });

  test("reopening during exit returns to the open phase", () => {
    expect(
      resolveAnimatedSheetPhase({ open: true, present: true, exitComplete: false }),
    ).toBe("open");
  });
});
