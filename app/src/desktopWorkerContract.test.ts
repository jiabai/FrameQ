import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { ASR_MODEL_DOWNLOAD_PROGRESS_EVENT } from "./settingsClient";
import { processVideo, WORKER_PROGRESS_EVENT } from "./workerClient";
import type { WorkerResult } from "./workflow";

type DesktopWorkerContract = {
  events: {
    workerProgress: string;
    asrModelDownloadProgress: string;
  };
  asr: {
    defaultModel: string;
  };
  processVideo: {
    serverManagedLlmCheckout: boolean;
  };
  aiGeneration: {
    command: string;
    serverManagedLlmCheckout: boolean;
  };
  insightResult: {
    schemaVersion: number;
    itemKeys: string[];
    preferenceSnapshotArtifact: string;
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
        task_id: null,
        task_dir: null,
        artifacts: {},
        text: "",
        summary: "",
        insights: [],
        transcript: null,
        error: null,
      };
    });

    expect(calls[0]?.args).toMatchObject({
      request: {
        model: contract.asr.defaultModel,
      },
    });
  });

  test("documents process_video as transcript-only and retry_insights as the AI path", async () => {
    const contract = loadContract();
    const calls: Array<{ command: string; args: unknown }> = [];

    await processVideo("https://www.douyin.com/video/7524373044106677544", async (command, args) => {
      calls.push({ command, args });
      return {
        status: "completed",
        task_id: null,
        task_dir: null,
        artifacts: {},
        text: "",
        summary: "",
        insights: [],
        transcript: null,
        error: null,
      };
    });

    expect(contract.processVideo).not.toHaveProperty("defaultGenerateInsights");
    expect(contract.processVideo.serverManagedLlmCheckout).toBe(false);
    expect(contract.aiGeneration.command).toBe("retry_insights");
    expect(contract.aiGeneration.serverManagedLlmCheckout).toBe(true);
    expect(calls[0]?.args).not.toHaveProperty("request.generate_insights");
  });

  test("matches the structured insight result item contract", () => {
    const contract = loadContract();
    const insight = {
      id: 1,
      topic: "topic",
      matchReason: "matched",
      followUpQuestions: ["next"],
      suitableUse: "content planning",
      sourceChunkId: 1,
    } satisfies WorkerResult["insights"][number];

    expect(contract.insightResult.schemaVersion).toBe(1);
    expect(Object.keys(insight).sort()).toEqual([...contract.insightResult.itemKeys].sort());
    expect(contract.insightResult.preferenceSnapshotArtifact).toBe("preference_snapshot");
  });
});
