// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { HistoryListItem } from "../../historyClient";
import { useNoteActionsController } from "./useNoteActionsController";

const item: HistoryListItem = {
  taskId: "note-1", id: "note-1", createdAt: "2026-10-31T10:00:00Z",
  source: { kind: "local_file", displayName: "Interview.wav", mediaKind: "audio" },
  status: "completed", taskDir: "saved-task", outputDir: "saved-output", artifacts: {},
  error: null, textPreview: "Saved transcript", insightsCount: 0,
  noteMetadata: { pinned: false, displayTitle: "Saved manual title" }, noteMetadataError: null,
};

function options(items: readonly HistoryListItem[], allowed: boolean) {
  return {
    items,
    canMutate: () => allowed,
    onCommitted: () => { throw new Error("Rejected action committed settings"); },
    onDelete: () => { throw new Error("Rejected action requested deletion"); },
    loadCollections: async () => { throw new Error("Rejected action requested Collections"); },
  };
}

describe("note actions rejected admission with real React state", () => {
  test.each(["pin", "rename", "collection", "delete"] as const)
    ("blocks %s while the current task guard is active", async (action) => {
      const { result } = renderHook(() => useNoteActionsController(options([item], false)));
      await act(async () => { await result.current.perform(item, action); });
      expect(result.current.notice).toEqual({ messageCode: "noteActions.notice.blocked" });
      expect(result.current.sheet).toBeNull();
      expect(result.current.busy).toBe(false);
      expect(result.current.loading).toBe(false);
    });

  test.each(["pin", "rename"] as const)
    ("keeps %s unavailable when native settings cannot be read", async (action) => {
      const unreadable = { ...item, noteMetadata: null, noteMetadataError: "NOTE_METADATA_INVALID" };
      const { result } = renderHook(() => useNoteActionsController(options([unreadable], true)));
      await act(async () => { await result.current.perform(unreadable, action); });
      expect(result.current.notice).toEqual({ messageCode: "noteActions.notice.metadataLoadFailed" });
      expect(result.current.sheet).toBeNull();
      expect(result.current.busy).toBe(false);
    });

  test("rejects saved-name submission when the guard changed after opening", async () => {
    const { result, rerender } = renderHook(
      ({ allowed }) => useNoteActionsController(options([item], allowed)),
      { initialProps: { allowed: true } },
    );
    await act(async () => { await result.current.perform(item, "rename"); });
    expect(result.current.sheet?.kind).toBe("rename");
    rerender({ allowed: false });
    let saved = true;
    await act(async () => { saved = await result.current.saveName(item.taskId, "New title"); });
    expect(saved).toBe(false);
    expect(result.current.notice).toEqual({ messageCode: "noteActions.notice.blocked" });
    expect(result.current.sheet?.kind).toBe("rename");
    expect(result.current.busy).toBe(false);
  });

  test("rejects stale task identity after the source row disappears", async () => {
    const { result, rerender } = renderHook(
      ({ items }) => useNoteActionsController(options(items, true)),
      { initialProps: { items: [item] as readonly HistoryListItem[] } },
    );
    await act(async () => { await result.current.perform(item, "rename"); });
    rerender({ items: [] });
    expect(result.current.sheet).toBeNull();
    await act(async () => { await result.current.perform(item, "delete"); });
    expect(result.current.notice).toEqual({ messageCode: "noteActions.notice.unavailable" });
  });

  test.each(["copy_source", "open_source"] as const)
    ("keeps %s unavailable for local imports", async (action) => {
      const { result } = renderHook(() => useNoteActionsController(options([item], true)));
      await act(async () => { await result.current.perform(item, action); });
      expect(result.current.notice).toEqual({ messageCode: "noteActions.notice.unavailable" });
      expect(result.current.busy).toBe(false);
    });

  test("uses the latest matching row for a deletion confirmation callback", async () => {
    const current = { ...item, noteMetadata: { pinned: true, displayTitle: "Current title" } };
    const selected: HistoryListItem[] = [];
    const { result } = renderHook(() => useNoteActionsController({
      ...options([current], true), onDelete: (note) => selected.push(note),
    }));
    await act(async () => { await result.current.perform(item, "delete"); });
    expect(selected).toEqual([current]);
  });

  test("reports settings failure discovered while a rename form is open", async () => {
    const { result, rerender } = renderHook(
      ({ items }) => useNoteActionsController(options(items, true)),
      { initialProps: { items: [item] as readonly HistoryListItem[] } },
    );
    await act(async () => { await result.current.perform(item, "rename"); });
    rerender({ items: [{ ...item, noteMetadata: null, noteMetadataError: "NOTE_METADATA_INVALID" }] });
    let saved = true;
    await act(async () => { saved = await result.current.saveName(item.taskId, "Unsaved title"); });
    expect(saved).toBe(false);
    expect(result.current.notice).toEqual({ messageCode: "noteActions.notice.metadataLoadFailed" });
    expect(result.current.sheet?.kind).toBe("rename");
  });

  test("cancelling a dirty rename changes only local sheet state", async () => {
    const { result } = renderHook(() => useNoteActionsController(options([item], true)));
    await act(async () => { await result.current.perform(item, "rename"); });
    act(() => result.current.setDirty(true));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.close());
    expect(result.current.sheet).toBeNull();
    expect(result.current.dirty).toBe(false);
    expect(item.noteMetadata?.displayTitle).toBe("Saved manual title");
  });
});
