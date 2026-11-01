import { describe, expect, test } from "vitest";
import { getGreetingPeriod } from "./greetingTime";

describe("local-time Home greeting", () => {
  test("uses the correct greeting across morning, afternoon, and evening boundaries", () => {
    expect(getGreetingPeriod(0)).toBe("evening");
    expect(getGreetingPeriod(5)).toBe("evening");
    expect(getGreetingPeriod(6)).toBe("morning");
    expect(getGreetingPeriod(11)).toBe("morning");
    expect(getGreetingPeriod(12)).toBe("afternoon");
    expect(getGreetingPeriod(17)).toBe("afternoon");
    expect(getGreetingPeriod(18)).toBe("evening");
    expect(getGreetingPeriod(23)).toBe("evening");
  });
});
