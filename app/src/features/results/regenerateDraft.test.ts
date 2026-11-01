// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { useDraftRegeneration } from "./regenerateDraft";

type Options = Parameters<typeof useDraftRegeneration>[0];

function regeneration(overrides: Partial<Options> = {}) {
  const routes: Array<[string, boolean | number | null]> = [];
  const options: Options = {
    taskId: "draft-1", resultOpen: true, saving: false, draftEdited: false,
    setDraftResultOpen: (open) => routes.push(["result", open]),
    setDraftConfirmOpen: (open) => routes.push(["confirmation", open]),
    setDraftSeedInsightId: (seed) => routes.push(["seed", seed]),
    ...overrides,
  };
  return { ...renderHook(useDraftRegeneration, { initialProps: options }), options, routes };
}

afterEach(cleanup);

describe("draft regeneration confirmation", () => {
  test.each([42, null])("a clean draft only routes seed %s to the final generation confirmation", (seed) => {
    const { result, routes } = regeneration();
    act(() => result.current.request(seed));
    expect(result.current.candidate).toBeNull();
    expect(routes).toEqual([["result", false], ["seed", seed], ["confirmation", true]]);
  });

  test.each([
    [true, false], [false, true], [true, true],
  ])("persisted edits %s and unsaved edits %s require a single confirmation", (draftEdited, dirty) => {
    const { result, routes } = regeneration({ draftEdited });
    act(() => {
      result.current.request(42, dirty);
      result.current.request(99, dirty);
    });
    expect(result.current.candidate).toEqual({ taskId: "draft-1", seedInsightId: 42 });
    expect(routes).toEqual([]);
    act(() => result.current.cancel());
    expect(result.current.candidate).toBeNull();
    expect(routes).toEqual([]);
  });

  test("acceptance consumes the candidate once and only opens the final confirmation", () => {
    const { result, routes } = regeneration({ draftEdited: true });
    act(() => result.current.request(42));
    const accept = result.current.confirm;
    act(() => { accept(); accept(); result.current.request(99); });
    expect(routes).toEqual([["result", false], ["seed", 42], ["confirmation", true]]);
    expect(result.current.candidate).toBeNull();
  });

  test.each([
    { taskId: "draft-2" }, { resultOpen: false }, { saving: true },
  ])("invalidates the candidate and retained callbacks when context changes to %j", (change) => {
    const { result, options, rerender, routes } = regeneration({ draftEdited: true });
    act(() => result.current.request(42));
    const accept = result.current.confirm;
    rerender({ ...options, ...change });
    expect(result.current.candidate).toBeNull();
    act(() => accept());
    rerender(options);
    act(() => accept());
    expect(result.current.candidate).toBeNull();
    expect(routes).toEqual([]);
  });

  test("a cancelled callback cannot accept a later candidate", () => {
    const { result, routes } = regeneration({ draftEdited: true });
    act(() => result.current.request(42));
    const firstAccept = result.current.confirm;
    act(() => result.current.cancel());
    act(() => result.current.request(99));
    act(() => firstAccept());
    expect(routes).toEqual([]);
    expect(result.current.candidate?.seedInsightId).toBe(99);
    act(() => result.current.confirm());
    expect(routes).toEqual([["result", false], ["seed", 99], ["confirmation", true]]);
  });

  test.each([
    { saving: true }, { resultOpen: false }, { taskId: null },
  ])("blocks requests for %j", (change) => {
    const { result, routes } = regeneration(change);
    act(() => result.current.request(42));
    expect(result.current.candidate).toBeNull();
    expect(routes).toEqual([]);
  });

  test("a retained request cannot route the next task", () => {
    const { result, options, rerender, routes } = regeneration();
    const request = result.current.request;
    rerender({ ...options, taskId: "draft-2" });
    act(() => request(42));
    expect(routes).toEqual([]);
    expect(result.current.candidate).toBeNull();
  });
});
