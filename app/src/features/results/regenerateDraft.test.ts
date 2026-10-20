// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { handleRegenerateDraft } from "./regenerateDraft";

// ---------------------------------------------------------------------------
// handleRegenerateDraft — pure function extracted from App.tsx for testability.
// Encapsulates dirty confirmation + sheet routing logic.
// ---------------------------------------------------------------------------

const CONFIRM_MESSAGE = "Discard current edits?";

describe("handleRegenerateDraft", () => {
  let confirmSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    confirmSpy = vi.fn();
    vi.stubGlobal("confirm", confirmSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("when draftEdited is false, closes result sheet, sets seed, opens confirm sheet", () => {
    const setDraftResultOpen = vi.fn();
    const setDraftConfirmOpen = vi.fn();
    const setDraftSeedInsightId = vi.fn();

    handleRegenerateDraft(
      false,
      42,
      setDraftResultOpen,
      setDraftConfirmOpen,
      setDraftSeedInsightId,
      CONFIRM_MESSAGE,
    );

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(setDraftResultOpen).toHaveBeenCalledWith(false);
    expect(setDraftSeedInsightId).toHaveBeenCalledWith(42);
    expect(setDraftConfirmOpen).toHaveBeenCalledWith(true);
  });

  test("when draftEdited is true and user confirms, proceeds with routing", () => {
    confirmSpy.mockReturnValue(true);
    const setDraftResultOpen = vi.fn();
    const setDraftConfirmOpen = vi.fn();
    const setDraftSeedInsightId = vi.fn();

    handleRegenerateDraft(
      true,
      99,
      setDraftResultOpen,
      setDraftConfirmOpen,
      setDraftSeedInsightId,
      CONFIRM_MESSAGE,
    );

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(setDraftResultOpen).toHaveBeenCalledWith(false);
    expect(setDraftSeedInsightId).toHaveBeenCalledWith(99);
    expect(setDraftConfirmOpen).toHaveBeenCalledWith(true);
  });

  test("when draftEdited is true and user cancels, does nothing", () => {
    confirmSpy.mockReturnValue(false);
    const setDraftResultOpen = vi.fn();
    const setDraftConfirmOpen = vi.fn();
    const setDraftSeedInsightId = vi.fn();

    handleRegenerateDraft(
      true,
      1,
      setDraftResultOpen,
      setDraftConfirmOpen,
      setDraftSeedInsightId,
      CONFIRM_MESSAGE,
    );

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(setDraftResultOpen).not.toHaveBeenCalled();
    expect(setDraftSeedInsightId).not.toHaveBeenCalled();
    expect(setDraftConfirmOpen).not.toHaveBeenCalled();
  });

  test("passes null seed when seedInsightId is null", () => {
    const setDraftResultOpen = vi.fn();
    const setDraftConfirmOpen = vi.fn();
    const setDraftSeedInsightId = vi.fn();

    handleRegenerateDraft(
      false,
      null,
      setDraftResultOpen,
      setDraftConfirmOpen,
      setDraftSeedInsightId,
      CONFIRM_MESSAGE,
    );

    expect(setDraftSeedInsightId).toHaveBeenCalledWith(null);
  });
});
