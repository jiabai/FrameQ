import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  ASR_MODEL_DOWNLOAD_MESSAGE_CODE_RULES,
  ASR_MODEL_DOWNLOAD_WIRE_STATUSES,
  WORKER_PROGRESS_STAGES,
  WORKER_MESSAGE_CODE_RULES,
  WORKFLOW_STAGES,
  parseAsrModelDownloadProgressEvent,
  parseWorkerProgressEvent,
} from "./desktopWorkerProtocol";

type Contract = {
  progressEvents: {
    fieldSchemas: { stage: { enum: string[] } };
    worker: { messageCodes: Record<string, { allowedArgs: string[] }> };
    asrModelDownload: {
      fieldSchemas: { status: { enum: string[] } };
      messageCodes: Record<
        string,
        {
          status: string;
          current_file: "required" | "forbidden";
          allowedArgs: string[];
        }
      >;
    };
  };
};

function loadContract(): Contract {
  return JSON.parse(
    readFileSync(new URL("../../contracts/desktop-worker-contract.json", import.meta.url), "utf8"),
  ) as Contract;
}

describe("desktop worker protocol runtime", () => {
  test("keeps the TypeScript literal registries in parity with the shared contract", () => {
    const progress = loadContract().progressEvents;

    expect(WORKER_PROGRESS_STAGES).toEqual(progress.fieldSchemas.stage.enum);
    expect(WORKER_MESSAGE_CODE_RULES).toEqual(progress.worker.messageCodes);
    expect(ASR_MODEL_DOWNLOAD_MESSAGE_CODE_RULES).toEqual(
      progress.asrModelDownload.messageCodes,
    );
    expect(ASR_MODEL_DOWNLOAD_WIRE_STATUSES).toEqual(
      progress.asrModelDownload.fieldSchemas.status.enum,
    );
  });

  test("keeps desktop-only cancelling out of the worker progress wire", () => {
    expect(WORKFLOW_STAGES).toContain("cancelling");
    expect(WORKER_PROGRESS_STAGES).not.toContain("cancelling");
    expect(
      parseWorkerProgressEvent({
        stage: "cancelling",
        progress: 1,
        message_code: "video.download.preparing",
      }),
    ).toEqual({ kind: "invalid", diagnosticCode: "video.download.preparing" });
  });

  test("accepts every registered worker code as a closed snake_case event", () => {
    for (const message_code of Object.keys(WORKER_MESSAGE_CODE_RULES)) {
      expect(
        parseWorkerProgressEvent({
          stage: "video_extracting",
          progress: 50,
          message_code,
        }),
      ).toEqual({
        kind: "known",
        diagnosticCode: message_code,
        event: {
          stage: "video_extracting",
          progress: 50,
          message: { messageCode: message_code, args: {} },
        },
      });
    }
  });

  test("accepts every registered model code with its exact status and file policy", () => {
    for (const [message_code, rule] of Object.entries(
      ASR_MODEL_DOWNLOAD_MESSAGE_CODE_RULES,
    )) {
      const payload: Record<string, unknown> = {
        status: rule.status,
        progress: 50,
        message_code,
      };
      if (rule.current_file === "required") {
        payload.current_file = "SenseVoice Small (v2)+fp16.bin";
      }

      const parsed = parseAsrModelDownloadProgressEvent(payload);
      expect(parsed.kind).toBe("known");
      if (parsed.kind !== "invalid") {
        expect(parsed.event.message.messageCode).toBe(message_code);
        expect(parsed.event.status).toBe(rule.status);
        expect(parsed.event.currentFile).toBe(
          rule.current_file === "required" ? payload.current_file : undefined,
        );
      }
    }
  });

  test("validates code-specific args and their retry relationship", () => {
    expect(
      parseWorkerProgressEvent({
        stage: "video_extracting",
        progress: 40,
        message_code: "douyin.stream.retrying",
        message_args: { attempt: 2, total: 3 },
      }),
    ).toMatchObject({
      kind: "known",
      event: { message: { args: { attempt: 2, total: 3 } } },
    });
    expect(
      parseWorkerProgressEvent({
        stage: "video_extracting",
        progress: 40,
        message_code: "subtitle.detect.found",
        message_args: { language: "zh-Hant-TW" },
      }),
    ).toMatchObject({ kind: "known" });
    expect(
      parseWorkerProgressEvent({
        stage: "video_transcribing",
        progress: 40,
        message_code: "asr.cache.preparing",
        message_args: { model: "iic/SenseVoiceSmall" },
      }),
    ).toMatchObject({ kind: "known" });

    for (const payload of [
      {
        stage: "video_extracting",
        progress: 40,
        message_code: "douyin.stream.retrying",
        message_args: { attempt: 3, total: 2 },
      },
      {
        stage: "video_extracting",
        progress: 40,
        message_code: "douyin.stream.retrying",
        message_args: { attempt: 1.5, total: 2 },
      },
      {
        stage: "video_extracting",
        progress: 40,
        message_code: "video.download.preparing",
        message_args: { language: "zh-CN" },
      },
      {
        stage: "video_transcribing",
        progress: 40,
        message_code: "asr.cache.preparing",
        message_args: { model: "private/model" },
      },
    ]) {
      expect(parseWorkerProgressEvent(payload)).toEqual({
        kind: "invalid",
        diagnosticCode: payload.message_code,
      });
    }
  });

  test("rejects raw prose, camelCase, extras, invalid stages, and invalid progress", () => {
    for (const payload of [
      {
        stage: "video_extracting",
        progress: 20,
        message_code: "video.download.preparing",
        message: "raw worker prose with https://secret.example",
      },
      {
        stage: "video_extracting",
        progress: 20,
        messageCode: "video.download.preparing",
      },
      {
        stage: "not-a-stage",
        progress: 20,
        message_code: "video.download.preparing",
      },
      {
        stage: "video_extracting",
        progress: 20.5,
        message_code: "video.download.preparing",
      },
      {
        stage: "video_extracting",
        progress: 101,
        message_code: "video.download.preparing",
      },
      {
        status: "downloading",
        progress: 20,
        message_code: "model.file.downloading",
        current_file: "../secret/model.pt",
      },
      {
        status: "started",
        progress: 20,
        message_code: "model.file.downloading",
        current_file: "model.pt",
      },
    ]) {
      const parsed = "stage" in payload
        ? parseWorkerProgressEvent(payload)
        : parseAsrModelDownloadProgressEvent(payload);
      expect(parsed.kind).toBe("invalid");
    }
  });

  test("retains a safe unknown code for generic fallback and masks unsafe codes", () => {
    expect(
      parseWorkerProgressEvent({
        stage: "video_transcribing",
        progress: 61,
        message_code: "future.action.running",
      }),
    ).toEqual({
      kind: "unknown",
      diagnosticCode: "future.action.running",
      event: {
        stage: "video_transcribing",
        progress: 61,
        message: { messageCode: "future.action.running", args: {} },
      },
    });

    expect(
      parseWorkerProgressEvent({
        stage: "video_transcribing",
        progress: 61,
        message_code: "https://secret.example/private",
      }),
    ).toEqual({ kind: "invalid", diagnosticCode: "invalid" });
  });

  test("exports the exact workflow stage and wire-status closed sets", () => {
    expect(WORKFLOW_STAGES).toEqual([
      "waiting_input",
      "cancelling",
      "video_extracting",
      "video_transcribing",
      "insights_generating",
      "completed",
      "partial_completed",
      "failed",
    ]);
    expect(ASR_MODEL_DOWNLOAD_WIRE_STATUSES).toEqual([
      "started",
      "downloading",
      "extracting",
      "completed",
      "cancelled",
    ]);
  });
});
