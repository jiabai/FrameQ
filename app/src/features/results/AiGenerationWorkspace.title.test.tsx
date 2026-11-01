// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { createGuestAccountStatus } from "../../accountState";
import { initializeI18n } from "../../i18n/i18n";
import { createTaskWorkspaceViewModel } from "../../taskWorkspaceViewModel";
import { createInitialWorkflow, startNoteTitleGeneration } from "../../workflow";
import { AiGenerationWorkspace } from "./AiGenerationWorkspace";

afterEach(cleanup);

test("title generation blocks competing paid actions while saved results stay viewable", async () => {
  await initializeI18n("en-US");
  const saved = {
    ...createInitialWorkflow(), stage: "completed" as const, taskId: "saved-note", taskDir: "D:/FrameQ/outputs/tasks/saved-note", text: "A saved transcript",
    artifacts: { transcript_txt: "transcript/transcript.txt", summary: "ai/summary.md" }, summary: "A saved summary",
  };
  const workflow = startNoteTitleGeneration(saved, "en-US");
  const model = createTaskWorkspaceViewModel(workflow, {
    ...createGuestAccountStatus(), authenticated: true, entitlementStatus: "active",
    llmConfigured: true, canGenerateAi: true, llmQuotaRemaining: 5,
  });
  const actions: string[] = [];
  const { container } = render(<AiGenerationWorkspace
    model={model.ai} quotaRemaining={5}
    onSummaryAction={() => actions.push("summary")}
    onInsightsAction={() => actions.push("insights")}
    onDissectionAction={() => actions.push("dissection")}
    onDraftAction={() => actions.push("draft")}
    onViewTarget={(target) => actions.push(`view-${target}`)}
    onCancel={() => actions.push("cancel")}
  />);
  const generationButtons = [...container.querySelectorAll<HTMLButtonElement>(".ai-target-action")];
  expect(generationButtons.length).toBeGreaterThanOrEqual(2);
  for (const button of generationButtons) {
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(actions).toEqual([]);
  const view = container.querySelector<HTMLButtonElement>('[data-ai-target="summary"] button');
  expect(view?.disabled).toBe(false);
  fireEvent.click(view!);
  expect(actions).toEqual(["view-summary"]);
});
