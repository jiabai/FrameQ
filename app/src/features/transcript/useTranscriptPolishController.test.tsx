// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { createGuestAccountStatus } from "../../accountState";
import { initializeI18n } from "../../i18n/i18n";
import {
  renderUiMessage,
  uiMessage,
  type UiMessage,
} from "../../i18n/uiMessage";
import { createInitialWorkflow, type WorkflowState } from "../../workflow";
import type { WorkerErrorResult, WorkerResult } from "../../workflowState";
import { useTranscriptPolishController } from "./useTranscriptPolishController";

afterEach(cleanup);

function workerResult(error: WorkerErrorResult): WorkerResult {
  return {
    status: "partial_completed",
    task_id: "saved-note",
    task_dir: null,
    artifacts: {},
    text: "",
    summary: "",
    insights: [],
    transcript: null,
    dissection: null,
    dissection_source_status: null,
    draft: "",
    error,
  };
}

async function runPolish(error: WorkerErrorResult) {
  const workflow: WorkflowState = {
    ...createInitialWorkflow(),
    taskId: "saved-note",
    artifacts: { transcript_txt: "transcript/transcript.txt" },
  };
  const notices: unknown[] = [];
  const actions: unknown[] = [];
  const { result } = renderHook(() =>
    useTranscriptPolishController({
      workflow,
      outputLanguage: "zh-CN",
      account: {
        ...createGuestAccountStatus(),
        authenticated: true,
        entitlementStatus: "active",
        canGenerateAi: true,
      },
      openAccountPanel: (notice) => {
        actions.push(notice);
      },
      aiBlockerMessage: () => uiMessage("account.notice.signInRequired"),
      setActionNotice: (notice) => {
        notices.push(notice);
      },
      refreshPolishedTranscript: async () => {
        actions.push("refresh");
      },
      polishRunner: async () => workerResult(error),
    }),
  );
  await act(async () => {
    await result.current.polishTranscript();
  });
  return { notices, actions };
}

test("超长文字稿显示长度限制提示，且不继续刷新整理稿", async () => {
  await initializeI18n("zh-CN");
  const { notices, actions } = await runPolish({
    code: "POLISH_TRANSCRIPT_TOO_LONG",
    message: "Transcript needs more than 24 polish chunks.",
    stage: "insights_generating",
  });

  expect(notices).toEqual([
    null,
    { messageCode: "errors.transcript.polishTooLong" },
  ]);
  expect(actions).toEqual([]);
  const notice = notices[notices.length - 1] as UiMessage;
  expect(renderUiMessage("zh-CN", notice)).toBe(
    "文字稿过长，暂时无法整理。目前最多支持约 4.8 万字符（24 段，每段约 2,000 字符）。",
  );
  expect(renderUiMessage("zh-TW", notice)).toBe(
    "逐字稿過長，暫時無法整理。目前最多支援約 4.8 萬字元（24 段，每段約 2,000 字元）。",
  );
  expect(renderUiMessage("en-US", notice)).toBe(
    "The transcript is too long to polish. The current limit is about 48,000 characters (24 segments of about 2,000 characters each).",
  );
});

test("其它整理失败保留带错误码的通用提示", async () => {
  await initializeI18n("zh-CN");
  const { notices } = await runPolish({
    code: "POLISH_FAILED",
    message: "boom",
    stage: "insights_generating",
  });

  expect(notices).toEqual([
    null,
    {
      messageCode: "transcript.notice.polishFailed",
      args: { code: "POLISH_FAILED" },
    },
  ]);
});
