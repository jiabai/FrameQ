// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { createGuestAccountStatus } from "../../accountState";
import { uiMessage } from "../../i18n/uiMessage";
import { createInitialWorkflow, type WorkflowState } from "../../workflow";
import { useTranscriptPolishController } from "./useTranscriptPolishController";

afterEach(cleanup);

test.each(["title_generating", "cancelling"] as const)("polishing starts no work during %s", async (stage) => {
  const workflow: WorkflowState = {
    ...createInitialWorkflow(), stage, taskId: "saved-note", taskDir: "D:/Locus/outputs/tasks/saved-note",
    text: "Saved transcript", artifacts: { transcript_txt: "transcript/transcript.txt" },
    cancellingFromStage: stage === "cancelling" ? "title_generating" : null,
  };
  const actions: unknown[] = [];
  const { result } = renderHook(() => useTranscriptPolishController({
    workflow, outputLanguage: "en-US",
    account: { ...createGuestAccountStatus(), authenticated: true, entitlementStatus: "active", canGenerateAi: true },
    openAccountPanel: (notice) => { actions.push(notice); },
    aiBlockerMessage: () => uiMessage("account.notice.signInRequired"),
    setActionNotice: (notice) => { actions.push(notice); },
    refreshPolishedTranscript: async () => { actions.push("refresh"); },
  }));
  await act(async () => { await result.current.polishTranscript(); });
  expect(actions).toEqual([]);
  expect(result.current.polishingTranscript).toBe(false);
});
