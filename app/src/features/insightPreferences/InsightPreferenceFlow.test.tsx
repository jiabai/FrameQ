import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { InsightPreferenceFlowState } from "../../insightPreferenceFlow";
import { InsightPreferenceFlow } from "./InsightPreferenceFlow";

const FLOW: InsightPreferenceFlowState = {
  screen: "confirmation",
  profile: {
    role: "marketing_sales",
    domain: "marketing_sales",
    stage: "manager",
    cityContext: "new_tier1_city",
    genderPerspective: "unspecified",
    platforms: ["douyin"],
    defaultStyles: ["direct_sharp"],
    defaultAvoid: [],
  },
  profileSkipped: false,
  profileResetRequired: false,
  defaultGenerationPreferences: null,
  generationPreferences: {
    goal: "content_creation",
    scenario: "short_video",
    angles: ["topic_angle"],
    audience: "beginners",
    styles: ["direct_sharp"],
    avoid: [],
  },
  currentStep: "avoid",
  currentStepIndex: 5,
  canAdvance: true,
};

function renderFlow(
  locale: "zh-TW" | "en-US",
  options: {
    outputLanguage?: "zh-CN" | "zh-TW" | "en-US";
    busy?: boolean;
    transcriptText?: string;
  } = {},
) {
  return renderToStaticMarkup(
    <InsightPreferenceFlow
      flow={FLOW}
      busy={options.busy ?? false}
      accountQuotaRemaining={19}
      transcriptText={
        options.transcriptText ?? (locale === "en-US" ? "hello world" : "測試逐字稿")
      }
      transcriptPath={null}
      locale={locale}
      outputLanguage={options.outputLanguage ?? locale}
      onFlowChange={vi.fn()}
      onSkipProfile={vi.fn()}
      onSaveProfile={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe("InsightPreferenceFlow localization", () => {
  test("renders independently localized confirmation copy and actual output language", () => {
    const traditional = renderFlow("zh-TW");
    expect(traditional).toContain('aria-label="確認靈感啟發"');
    expect(traditional).toContain('data-output-language="zh-TW"');
    expect(traditional).toContain("本次輸出語言");
    expect(traditional).toContain("市場／銷售");
    expect(traditional).toContain("5 字");

    const english = renderFlow("en-US");
    expect(english).toContain('aria-label="Confirm Inspiration"');
    expect(english).toContain('data-output-language="en-US"');
    expect(english).toContain("Output language for this run");
    expect(english).toContain("Marketing / sales");
    expect(english).toContain("2 words");
    expect(english).not.toContain("11 words");
    expect(english).not.toContain("确认启发灵感");
  });

  test("keeps the frozen request language visible while a confirmation is busy", () => {
    const markup = renderFlow("en-US", {
      outputLanguage: "zh-TW",
      busy: true,
    });

    expect(markup).toContain('data-output-language="zh-TW"');
    expect(markup).toContain("Output language for this run");
    expect(markup).toContain("Traditional Chinese (Taiwan)");
    expect(markup).not.toContain('data-output-language="en-US"');
  });
});
