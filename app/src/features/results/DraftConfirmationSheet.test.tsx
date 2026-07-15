// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  summarizeWorkerResult,
  type WorkflowState,
} from "../../workflow";
import type { Insight } from "../../insightPreferences";
import type { InsightPreferenceState } from "../../insightPreferencesClient";
import { DraftConfirmationSheet } from "./DraftConfirmationSheet";

// Reused helpers (mirror DraftSheet.test.tsx) — keep this interactive test
// independent of the SSR file so the jsdom environment stays isolated here.
const SEED_INSIGHT: Insight = {
  id: 7,
  topic: "短视频开头三秒决定完播率",
  matchReason: "匹配理由正文",
  followUpQuestions: ["问题一", "问题二"],
  suitableUse: "适合用途正文",
  sourceChunkId: 2,
};

function workflowWithSeed(): WorkflowState {
  const state = summarizeWorkerResult({
    status: "completed",
    task_id: "task-draft",
    task_dir: "/FrameQ/outputs/tasks/task-draft",
    artifacts: {
      transcript_txt: "transcript/transcript.txt",
      insights_md: "ai/insights.md",
    },
    text: "文字稿正文。",
    summary: "",
    insights: [SEED_INSIGHT],
    transcript: { source: "asr", language: "zh", engine: "SenseVoice" },
    draft: "",
    error: null,
  });
  state.draftSeedInsightId = SEED_INSIGHT.id;
  return state;
}

const mocks = vi.hoisted(() => ({
  getInsightPreferences: vi.fn<() => Promise<InsightPreferenceState>>(),
}));

vi.mock("../../insightPreferencesClient", () => ({
  getInsightPreferences: mocks.getInsightPreferences,
}));

function preferenceState(platforms: string[] | null): InsightPreferenceState {
  return {
    profile: platforms
      ? {
          role: "unspecified",
          domain: "unspecified",
          stage: "unspecified",
          cityContext: "unspecified",
          genderPerspective: "unspecified",
          platforms,
          defaultStyles: [],
          defaultAvoid: [],
        }
      : null,
    profileSkipped: false,
    profileStatus: platforms ? "valid" : "missing",
    profileError: null,
    defaultGenerationPreferences: null,
    preferencesPath: "",
  };
}

function expectPlatformChecked(label: string): void {
  const radio = screen.getByRole("radio", { name: label });
  expect(radio.getAttribute("aria-checked")).toBe("true");
}

describe("DraftConfirmationSheet platform selection", () => {
  beforeEach(() => {
    mocks.getInsightPreferences.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  test("renders exactly 9 platform options with the design-§4 display labels", async () => {
    mocks.getInsightPreferences.mockResolvedValue(preferenceState(null));
    render(
      <DraftConfirmationSheet
        open
        workflow={workflowWithSeed()}
        busy={false}
        quotaRemaining={5}
        transcriptPath={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "目标平台" });
    const options = within(group).getAllByRole("radio");
    expect(options).toHaveLength(9);
    // Design §4 order + labels (公众号/小红书/视频号/抖音/Tiktok/X(Twitter)/B站/Youtube/其他).
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "公众号",
      "小红书",
      "视频号",
      "抖音",
      "Tiktok",
      "X(Twitter)",
      "B站",
      "Youtube",
      "其他",
    ]);
    // Let the open-effect settle so the unmocked rejection does not leak.
    await waitFor(() => expect(mocks.getInsightPreferences).toHaveBeenCalledTimes(1));
  });

  test("derives the default from the profile: single mappable platform is preselected", async () => {
    mocks.getInsightPreferences.mockResolvedValue(preferenceState(["xiaohongshu"]));
    render(
      <DraftConfirmationSheet
        open
        workflow={workflowWithSeed()}
        busy={false}
        quotaRemaining={5}
        transcriptPath={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => expectPlatformChecked("小红书"));
  });

  test("derives the default from the profile: empty profile → 其他", async () => {
    mocks.getInsightPreferences.mockResolvedValue(preferenceState([]));
    render(
      <DraftConfirmationSheet
        open
        workflow={workflowWithSeed()}
        busy={false}
        quotaRemaining={5}
        transcriptPath={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => expectPlatformChecked("其他"));
  });

  test("derives the default from the profile: two or more → 其他 (no priority guessing)", async () => {
    mocks.getInsightPreferences.mockResolvedValue(preferenceState(["xiaohongshu", "douyin"]));
    render(
      <DraftConfirmationSheet
        open
        workflow={workflowWithSeed()}
        busy={false}
        quotaRemaining={5}
        transcriptPath={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => expectPlatformChecked("其他"));
  });

  test("onConfirm receives the currently selected platform id when the user changes it", async () => {
    mocks.getInsightPreferences.mockResolvedValue(preferenceState(["xiaohongshu"]));
    const onConfirm = vi.fn();
    render(
      <DraftConfirmationSheet
        open
        workflow={workflowWithSeed()}
        busy={false}
        quotaRemaining={5}
        transcriptPath={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    // Wait for the profile-derived default to land.
    await waitFor(() => expectPlatformChecked("小红书"));

    // User picks 抖音 instead.
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "抖音" }));
    });
    expectPlatformChecked("抖音");

    // Confirm forwards the selected platform id to the controller.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "确认" }));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("douyin");
  });

  test("busy disables both platform selection and confirm", async () => {
    mocks.getInsightPreferences.mockResolvedValue(preferenceState(["xiaohongshu"]));
    render(
      <DraftConfirmationSheet
        open
        workflow={workflowWithSeed()}
        busy
        quotaRemaining={5}
        transcriptPath={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => expect(mocks.getInsightPreferences).toHaveBeenCalledTimes(1));
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      (screen.getByRole("button", { name: "启动中" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
