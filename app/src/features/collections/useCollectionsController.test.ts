// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { useCollectionsController } from "./useCollectionsController";

afterEach(cleanup);

describe("collection controller native boundary", () => {
  test("keeps an unavailable native read distinct from a committed empty view", async () => {
    const { result } = renderHook(() => useCollectionsController());
    expect(result.current.view).toBeNull();
    expect(result.current.collections).toEqual([]);
    expect(result.current.errorCode).toBeNull();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.load(); });
    expect(result.current.loading).toBe(true);
    await act(async () => { expect(await pending).toBe(false); });
    expect(result.current.view).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.errorCode).toBe("COLLECTIONS_OPERATION_FAILED");
  });

  test("invalidates an older real native read when mutation validation fails", async () => {
    const { result } = renderHook(() => useCollectionsController());
    let read!: Promise<boolean>;
    let mutation!: Promise<boolean>;
    act(() => {
      read = result.current.load();
      mutation = result.current.create("");
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.mutating).toBe(true);
    await act(async () => { expect(await Promise.all([read, mutation])).toEqual([false, false]); });
    expect(result.current.errorCode).toBe("COLLECTION_NAME_INVALID");
    expect(result.current.view).toBeNull();
    expect(result.current.mutating).toBe(false);
  });

  test("blocks another mutation and reads while a native mutation is pending", async () => {
    const { result } = renderHook(() => useCollectionsController());
    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    let read!: Promise<boolean>;
    act(() => {
      first = result.current.create("Research");
      duplicate = result.current.create("");
      read = result.current.load();
    });
    expect(result.current.mutating).toBe(true);
    expect(result.current.loading).toBe(false);
    await act(async () => { expect(await Promise.all([first, duplicate, read])).toEqual([false, false, false]); });
    expect(result.current.errorCode).toBe("COLLECTIONS_OPERATION_FAILED");
    expect(result.current.mutating).toBe(false);
    expect(result.current.view).toBeNull();
  });

  test("does not apply late responses or restart operations after unmount", async () => {
    const { result, unmount } = renderHook(() => useCollectionsController());
    const load = result.current.load;
    let pending!: Promise<boolean>;
    act(() => { pending = load(); });
    unmount();
    expect(await pending).toBe(false);
    expect(await load()).toBe(false);
  });

  test("keeps invalid mutation errors local without creating a committed view", async () => {
    const { result } = renderHook(() => useCollectionsController());
    await act(async () => { expect(await result.current.rename("../private", "Research")).toBe(false); });
    expect(result.current.errorCode).toBe("COLLECTION_NOT_FOUND");
    expect(result.current.view).toBeNull();
    await act(async () => { expect(await result.current.remove("../private")).toBe(false); });
    expect(result.current.errorCode).toBe("COLLECTION_NOT_FOUND");
    await act(async () => { expect(await result.current.setMembership("01234567-89ab-4def-8abc-0123456789ab", "task/child", true)).toBe(false); });
    expect(result.current.errorCode).toBe("COLLECTION_TASK_UNAVAILABLE");
    expect(result.current.view).toBeNull();
  });
});
