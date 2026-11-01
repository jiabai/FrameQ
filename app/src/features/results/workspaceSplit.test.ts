import { expect, test } from "vitest";
import { workspaceSplit } from "./workspaceSplit";

test("keeps the default layout and bounds either side of a preferred split", () => {
  expect(workspaceSplit(1000, null)).toEqual({ ai: 380, local: 620, minimum: 280, maximum: 720, resizable: true });
  expect(workspaceSplit(2000, null).ai).toBe(620);
  expect(workspaceSplit(1000, 0.99).local).toBe(280);
  expect(workspaceSplit(1000, 0.01).ai).toBe(280);
});

test("retains a proportion through narrow constraints and later available space", () => {
  const preferred = 0.6;
  expect(workspaceSplit(1600, preferred).ai).toBe(960);
  expect(workspaceSplit(500, preferred)).toEqual({ ai: 250, local: 250, minimum: 250, maximum: 250, resizable: false });
  expect(workspaceSplit(1600, preferred).ai).toBe(960);
  expect(workspaceSplit(560, preferred).resizable).toBe(false);
  expect(workspaceSplit(561, preferred).resizable).toBe(true);
  expect(workspaceSplit(0, preferred).local).toBe(0);
});

test("rejects invalid geometry and proportions", () => {
  for (const width of [-1, NaN, Infinity]) expect(() => workspaceSplit(width, null)).toThrow(RangeError);
  for (const ratio of [-0.1, 1.1, NaN, Infinity]) expect(() => workspaceSplit(1000, ratio)).toThrow(RangeError);
});
