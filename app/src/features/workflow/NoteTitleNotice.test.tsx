// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance, type Resource } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test } from "vitest";

import { workflowResources } from "../../i18n/workflowResources";
import type { SupportedLocale } from "../../i18n/locale";
import { cancelNoteTitleGeneration, createInitialWorkflow, startNoteTitleGeneration, type WorkflowState } from "../../workflow";
import { NoteTitleNotice } from "./NoteTitleNotice";

afterEach(cleanup);

function localNote(): WorkflowState {
  return { ...createInitialWorkflow(), taskId: "saved-note", stage: "completed", artifacts: { transcript_txt: "transcript/transcript.txt" }, text: "Saved transcript" };
}

async function showNotice(workflow: WorkflowState, locale: SupportedLocale, retryDisabled = false) {
  const language = createInstance();
  await language.init({ lng: locale, fallbackLng: false, resources: { [locale]: { workflow: workflowResources[locale] } } as Resource });
  const actions: string[] = [];
  render(<I18nextProvider i18n={language}><NoteTitleNotice workflow={workflow} retryDisabled={retryDisabled} onRetry={() => actions.push("retry")} onCancel={() => actions.push("cancel")} /></I18nextProvider>);
  return actions;
}

test("shows title progress and an explicit cancellation action", async () => {
  const actions = await showNotice(startNoteTitleGeneration(localNote(), "en-US"), "en-US");
  expect(screen.getByRole("status").textContent).toContain("Transcript saved");
  fireEvent.click(screen.getByRole("button", { name: "Cancel title generation" }));
  expect(actions).toEqual(["cancel"]);
  expect(screen.queryByRole("button", { name: /Retry title/ })).toBeNull();
});

test.each(["zh-CN", "zh-TW", "en-US"] as const)("discloses the cloud call and charge before retry in %s", async (locale) => {
  const state = cancelNoteTitleGeneration(startNoteTitleGeneration(localNote(), locale));
  const actions = await showNotice(state, locale);
  expect(screen.getByText(workflowResources[locale].noteTitle.disclosure)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: workflowResources[locale].noteTitle.retry }));
  expect(actions).toEqual(["retry"]);
});

test("keeps dirty or busy note retry disabled", async () => {
  const state = cancelNoteTitleGeneration(startNoteTitleGeneration(localNote(), "en-US"));
  const actions = await showNotice(state, "en-US", true);
  const button = screen.getByRole("button", { name: "Retry title · 1 AI Credit" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(actions).toEqual([]);
});
