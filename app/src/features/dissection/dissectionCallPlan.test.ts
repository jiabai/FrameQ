import { describe, expect, test } from "vitest";

import { buildDissectionCallPlan } from "./dissectionCallPlan";

describe("dissection call plan", () => {
  test.each([
    [1, 1, 6],
    [4, 1, 6],
    [5, 1, 6],
    [16, 1, 6],
  ])("matches the worker bounds for %i chunks", (chunks, minimum, maximum) => {
    const plan = buildDissectionCallPlan("x".repeat(chunks * 2000));

    expect(plan).toEqual({
      version: 2,
      chunkCount: chunks,
      minimumCalls: minimum,
      maximumCalls: maximum,
      eligible: true,
    });
  });

  test("rejects empty and 17-chunk transcripts before generation", () => {
    expect(buildDissectionCallPlan(" \n").eligible).toBe(false);
    expect(buildDissectionCallPlan("x".repeat(32001))).toEqual({
      version: 2,
      chunkCount: 17,
      minimumCalls: 1,
      maximumCalls: 6,
      eligible: false,
    });
  });

  test("counts Unicode code points exactly like the Python worker", () => {
    expect(buildDissectionCallPlan("🙂".repeat(2000)).chunkCount).toBe(1);
    expect(buildDissectionCallPlan("🙂".repeat(2001)).chunkCount).toBe(2);
  });
});
