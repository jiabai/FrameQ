// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test } from "vitest";

import { getAiCreditsCostHint } from "../../aiCreditsCopy";
import { createInsightPreferenceFlow, GENERATION_STEPS, type InsightPreferenceFlowState } from "../../insightPreferenceFlow";
import { dissectionResources } from "../../i18n/dissectionResources";
import { initializeI18n } from "../../i18n/i18n";
import type { SupportedLocale } from "../../i18n/locale";
import { getPreferenceCopy } from "../../i18n/preferencePresentation";
import { studioResources } from "../../i18n/studioResources";
import { createInitialWorkflow } from "../../workflowState";
import { TranscriptDissectionConfirmationSheet } from "../dissection/TranscriptDissectionConfirmationSheet";
import { createDissectionPreview } from "../dissection/useTranscriptDissectionController";
import { InsightPreferenceFlow } from "../insightPreferences/InsightPreferenceFlow";
import { DraftConfirmationSheet } from "./DraftConfirmationSheet";
import { SummaryConfirmationSheet } from "./SummaryConfirmationSheet";

const TRANSCRIPT_PATH = "D:/Locus/outputs/tasks/long-task-name/transcript/full-transcript.txt";
const FLOW = createInsightPreferenceFlow({
  profile: {
    role: "marketing_sales",
    domain: "marketing_sales",
    stage: "manager",
    cityContext: "new_tier1_city",
    genderPerspective: "unspecified",
    platforms: ["douyin"],
  },
  profileSkipped: false,
  profileStatus: "valid",
  profileError: null,
  defaultGenerationPreferences: {
    goal: "content_creation",
    scenario: "short_video",
    angles: ["topic_angle"],
    audience: "beginners",
    styles: ["direct_sharp"],
    avoid: [],
  },
  preferencesPath: "",
});

function unexpectedAction(): never {
  throw new Error("Unexpected user action");
}

function assertSheetRegions(element: ReactElement) {
  const document = new DOMParser().parseFromString(renderToStaticMarkup(element), "text/html");
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  const body = dialog.querySelector<HTMLElement>(":scope > .sheet-body")!;
  const footer = dialog.querySelector<HTMLElement>(":scope > footer.sheet-footer")!;
  expect(dialog.querySelector(":scope > header.sheet-header")).not.toBeNull();
  expect(body).not.toBeNull();
  expect(footer).not.toBeNull();
  expect(body.querySelector(".sheet-footer")).toBeNull();
  expect(body.nextElementSibling).toBe(footer);
  return { dialog, body, footer };
}

function assertOriginalPath(body: HTMLElement) {
  const paths = body.querySelectorAll<HTMLElement>(".sheet-path");
  expect(paths).toHaveLength(1);
  expect(paths[0].textContent).toBe(TRANSCRIPT_PATH);
  expect(paths[0].title).toBe(TRANSCRIPT_PATH);
  expect(body.querySelector(".privacy-callout .sheet-path")).toBeNull();
}

function flowElement(locale: SupportedLocale, flow: InsightPreferenceFlowState | null = FLOW, path: string | null = TRANSCRIPT_PATH) {
  return (
    <InsightPreferenceFlow
      flow={flow}
      busy={false}
      accountQuotaRemaining={19}
      transcriptText="hello world"
      transcriptPath={path}
      locale={locale}
      outputLanguage="zh-TW"
      onFlowChange={unexpectedAction}
      onSkipProfile={unexpectedAction}
      onSaveProfile={unexpectedAction}
      onConfirm={unexpectedAction}
      onCancel={unexpectedAction}
    />
  );
}

afterEach(cleanup);

describe.each<SupportedLocale>(["zh-CN", "zh-TW", "en-US"])("confirmation regions in %s", (locale) => {
  test("keeps summary disclosure, facts, full path and frozen language above an independent footer", async () => {
    await initializeI18n(locale);
    const { body } = assertSheetRegions(
      <SummaryConfirmationSheet
        open
        locale={locale}
        transcriptText="hello world"
        transcriptPath={TRANSCRIPT_PATH}
        quotaRemaining={19}
        busy={false}
        onConfirm={unexpectedAction}
        onCancel={unexpectedAction}
      />,
    );
    expect(body.querySelector(".privacy-callout")!.textContent).toBe(studioResources[locale].confirmation.privacy);
    expect(body.querySelectorAll(".sheet-facts > div > dt")).toHaveLength(3);
    expect(body.querySelector("[data-output-language]")!.getAttribute("data-output-language")).toBe(locale);
    expect(body.textContent).toContain(getAiCreditsCostHint(locale));
    assertOriginalPath(body);
  });

  test("keeps all nine draft platform choices, fixed attempt charge and privacy copy", async () => {
    await initializeI18n(locale);
    const { body } = assertSheetRegions(
      <DraftConfirmationSheet
        open
        workflow={createInitialWorkflow()}
        busy={false}
        quotaRemaining={19}
        transcriptPath={TRANSCRIPT_PATH}
        onConfirm={unexpectedAction}
        onCancel={unexpectedAction}
      />,
    );
    const copy = studioResources[locale].draftConfirmation;
    expect(body.querySelectorAll('[role="radio"]')).toHaveLength(9);
    expect(body.querySelector(".privacy-callout")!.textContent).toBe(copy.privacy);
    expect(body.textContent).toContain(copy.quotaCost);
    expect(body.textContent).toContain(copy.quotaHint);
    expect(body.querySelector("[role=radio][aria-checked=true]")!.getAttribute("aria-label"))
      .toBe(studioResources[locale].draftPlatform.other);
    assertOriginalPath(body);
  });

  test("keeps the six dissection facts and full billing disclosure with the quota blocker", async () => {
    await initializeI18n(locale);
    const preview = createDissectionPreview({
      taskTitle: "Interview with a long title.mov",
      transcript: "A transcript with source content.",
      outputLanguage: "zh-TW",
      quotaRemaining: 0,
    });
    const { body, footer } = assertSheetRegions(
      <TranscriptDissectionConfirmationSheet preview={preview} onCancel={unexpectedAction} onConfirm={unexpectedAction} />,
    );
    const copy = dissectionResources[locale].dissection.confirmation;
    expect(body.querySelectorAll(".sheet-facts > div > dt")).toHaveLength(6);
    expect(body.querySelector(".privacy-callout")!.textContent).toBe(copy.privacy);
    expect(body.querySelector(".dissection-credit-disclosure")!.textContent).toBe(copy.creditDisclosure);
    expect(body.querySelector('[role="status"]')!.textContent).toBe(copy.insufficientQuota);
    expect(footer.querySelector<HTMLButtonElement>(".primary-button")!.disabled).toBe(true);
    expect(body.querySelector(".sheet-path")).toBeNull();
  });

  test("keeps profile, default preferences and confirmation actions outside each scrolling region", () => {
    for (const screen of ["profile_intro", "profile_form", "default_summary", "confirmation"] as const) {
      const { body } = assertSheetRegions(flowElement(locale, { ...FLOW, screen }));
      if (screen === "profile_form") {
        expect(body.querySelectorAll(".preference-field")).toHaveLength(6);
      }
      if (screen === "confirmation") {
        expect(body.querySelector(".privacy-callout")!.textContent).toBe(getPreferenceCopy(locale).flow.privacyInsights);
        expect(body.textContent).toContain(getPreferenceCopy(locale).flow.quotaDisclosure);
        expect(body.querySelector("[data-output-language]")!.getAttribute("data-output-language")).toBe("zh-TW");
        assertOriginalPath(body);
      }
    }
  });

  test("keeps navigation available separately for every generation step", () => {
    for (const [index, step] of GENERATION_STEPS.entries()) {
      const { body, footer } = assertSheetRegions(flowElement(locale, {
        ...FLOW,
        screen: "generation_step",
        currentStep: step,
        currentStepIndex: index,
      }));
      expect(body.querySelectorAll(".preference-options button").length).toBeGreaterThan(0);
      expect(footer.querySelectorAll("button")).toHaveLength(2);
      expect(footer.querySelector<HTMLButtonElement>(".secondary-button")!.disabled).toBe(index === 0);
    }
  });
});

test("keeps the missing-transcript explanation as complete wrapping text", () => {
  const { body } = assertSheetRegions(flowElement("en-US", { ...FLOW, screen: "confirmation" }, null));
  expect(body.querySelector(".sheet-path")).toBeNull();
  expect(body.textContent).toContain(getPreferenceCopy("en-US").flow.transcriptUnavailable);
});

test("closes dissection with Escape without propagating to application navigation and retains its closing snapshot", async () => {
  await initializeI18n("en-US");
  let cancelled = 0;
  let escapedOutside = 0;
  const preview = createDissectionPreview({
    taskTitle: "Retained interview title.mov",
    transcript: "Transcript content.",
    outputLanguage: "zh-TW",
    quotaRemaining: 0,
  });
  const onCancel = () => { cancelled += 1; };
  const view = render(
    <TranscriptDissectionConfirmationSheet preview={preview} onCancel={onCancel} onConfirm={unexpectedAction} />,
  );
  const dialog = screen.getByRole("dialog");
  const outside = () => { escapedOutside += 1; };
  window.addEventListener("keydown", outside);
  try {
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    fireEvent(dialog, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(cancelled).toBe(1);
    expect(escapedOutside).toBe(0);
  } finally {
    window.removeEventListener("keydown", outside);
  }
  view.rerender(<TranscriptDissectionConfirmationSheet preview={null} onCancel={onCancel} onConfirm={unexpectedAction} />);
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(screen.getByText(preview.taskTitle)).toBeTruthy();
  expect(document.querySelector(".sheet-backdrop")!.getAttribute("data-motion-state")).toBe("closing");
});

test("retains the preference confirmation and frozen language during its closing lifecycle", () => {
  const view = render(flowElement("en-US", { ...FLOW, screen: "confirmation" }));
  const dialog = screen.getByRole("dialog");
  view.rerender(flowElement("en-US", null));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(dialog.querySelector("[data-output-language]")!.getAttribute("data-output-language")).toBe("zh-TW");
  expect(dialog.querySelector(".sheet-path")!.textContent).toBe(TRANSCRIPT_PATH);
  expect(document.querySelector(".sheet-backdrop")!.getAttribute("data-motion-state")).toBe("closing");
});
