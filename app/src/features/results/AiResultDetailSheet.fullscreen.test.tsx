// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { initializeI18n } from "../../i18n/i18n";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { summarizeWorkerResult } from "../../workflow";
import type { TranscriptDetailController } from "../transcript/useTranscriptDetailController";
import { AiResultDetailSheet } from "./AiResultDetailSheet";

type DetailTab = "summary" | "insights" | "dissection";

function detailWorkflow() {
  return summarizeWorkerResult({
    status: "completed",
    task_id: "task-1",
    task_dir: "D:/FrameQ/tasks/task-1",
    artifacts: { insights: "ai/insights.json" },
    text: "Transcript",
    summary: "# 总结\n\n内容",
    insights: [
      {
        id: 1,
        topic: "话题",
        matchReason: "理由",
        followUpQuestions: ["问题"],
        suitableUse: "用途",
        sourceChunkId: 1,
      },
    ],
    transcript: null,
    dissection: null,
    dissection_source_status: null,
    draft: "",
    error: null,
  });
}

function detailController(tab: DetailTab | null): TranscriptDetailController {
  return {
    detailTab: tab,
    closeDetail: vi.fn(),
    copyDetail: vi.fn(),
    exportDetail: vi.fn(),
    exportPath: "D:/FrameQ/tasks/task-1/ai/insights.md",
    detailText: "text",
    transcriptDirty: false,
  } as unknown as TranscriptDetailController;
}

function renderSheet(tab: DetailTab | null) {
  return render(
    <LocaleProvider
      initialOutcome={{
        preference: "zh-CN",
        resolvedLocale: "zh-CN",
        persistedAnchor: "zh-CN",
        notice: null,
      }}
    >
      <AiResultDetailSheet
        actionNotice={null}
        controller={detailController(tab)}
        workflow={detailWorkflow()}
        onOpenDirectionEditor={vi.fn()}
      />
    </LocaleProvider>,
  );
}

function sheetElement(): HTMLElement {
  const sheet = document.querySelector(".ai-result-detail-sheet");
  expect(sheet).not.toBeNull();
  return sheet as HTMLElement;
}

describe("AiResultDetailSheet full screen", () => {
  beforeEach(async () => {
    await initializeI18n("zh-CN");
  });

  afterEach(() => {
    cleanup();
  });

  test.each<DetailTab>(["summary", "insights", "dissection"])(
    "exposes the full-screen toggle on the %s tab",
    (tab) => {
      renderSheet(tab);

      const sheet = sheetElement();
      expect(sheet.classList.contains("is-expanded")).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "全屏" }));
      expect(sheet.classList.contains("is-expanded")).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
      expect(sheet.classList.contains("is-expanded")).toBe(false);
    },
  );

  test("closing the sheet clears the expanded state for the next open", () => {
    const { rerender } = renderSheet("summary");

    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    expect(sheetElement().classList.contains("is-expanded")).toBe(true);

    rerender(
      <LocaleProvider
        initialOutcome={{
          preference: "zh-CN",
          resolvedLocale: "zh-CN",
          persistedAnchor: "zh-CN",
          notice: null,
        }}
      >
        <AiResultDetailSheet
          actionNotice={null}
          controller={detailController(null)}
          workflow={detailWorkflow()}
          onOpenDirectionEditor={vi.fn()}
        />
      </LocaleProvider>,
    );

    expect(sheetElement().classList.contains("is-expanded")).toBe(false);
  });
});
