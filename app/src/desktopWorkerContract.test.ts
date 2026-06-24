import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { ASR_MODEL_DOWNLOAD_PROGRESS_EVENT } from "./settingsClient";
import { processVideo, WORKER_PROGRESS_EVENT } from "./workerClient";

type DesktopWorkerContract = {
  events: {
    workerProgress: string;
    asrModelDownloadProgress: string;
  };
  asr: {
    defaultModel: string;
  };
};

function loadContract(): DesktopWorkerContract {
  return JSON.parse(
    readFileSync(new URL("../../contracts/desktop-worker-contract.json", import.meta.url), "utf-8"),
  ) as DesktopWorkerContract;
}

describe("desktop/worker contract", () => {
  test("matches shared event names", () => {
    const contract = loadContract();

    expect(WORKER_PROGRESS_EVENT).toBe(contract.events.workerProgress);
    expect(ASR_MODEL_DOWNLOAD_PROGRESS_EVENT).toBe(contract.events.asrModelDownloadProgress);
  });

  test("uses the contract default ASR model in worker requests", async () => {
    const contract = loadContract();
    const calls: Array<{ command: string; args: unknown }> = [];

    await processVideo("https://www.douyin.com/video/7524373044106677544", async (command, args) => {
      calls.push({ command, args });
      return {
        status: "completed",
        video_path: null,
        audio_path: null,
        text: "",
        insights: [],
        transcript_path: null,
        insights_path: null,
        error: null,
      };
    });

    expect(calls[0]?.args).toMatchObject({
      request: {
        model: contract.asr.defaultModel,
      },
    });
  });
});
