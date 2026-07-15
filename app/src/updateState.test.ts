import { describe, expect, test } from "vitest";
import {
  applyUpdateDownloadEvent,
  createInitialUpdateState,
  failUpdate,
  isUpdateInstallBlocked,
  markUpdateAvailable,
  markUpdateReadyToRestart,
  postponeUpdate,
  startUpdateDownload,
} from "./updateState";

describe("desktop update state", () => {
  test("starts idle and records an available update", () => {
    const state = markUpdateAvailable(createInitialUpdateState(), {
      version: "0.2.0",
      notes: "修复 worker 转写稳定性并改进升级体验。",
    });

    expect(state).toMatchObject({
      status: "available",
      progress: 0,
      availableVersion: "0.2.0",
      notes: "修复 worker 转写稳定性并改进升级体验。",
      message: {
        messageCode: "updates.state.available",
        args: { version: "0.2.0" },
      },
    });
  });

  test("stores semantic failure copy and only allowlisted technical details", () => {
    const state = failUpdate(
      createInitialUpdateState(),
      new Error("Authorization: Bearer secret at C:/private/file; HTTP 503 ETIMEDOUT"),
    );

    expect(state.message).toEqual({ messageCode: "updates.state.failed" });
    expect(state.error).toEqual({ httpStatus: 503, errno: "ETIMEDOUT" });
    expect(JSON.stringify(state)).not.toContain("secret");
    expect(JSON.stringify(state)).not.toContain("C:/private");
  });

  test("tracks download byte progress from Tauri updater events", () => {
    let state = startUpdateDownload(
      markUpdateAvailable(createInitialUpdateState(), { version: "0.2.0" }),
    );

    state = applyUpdateDownloadEvent(state, {
      event: "Started",
      data: { contentLength: 100 },
    });
    state = applyUpdateDownloadEvent(state, {
      event: "Progress",
      data: { chunkLength: 35 },
    });

    expect(state).toMatchObject({
      status: "downloading",
      downloadedBytes: 35,
      totalBytes: 100,
      progress: 35,
    });
  });

  test("marks installed updates as ready to restart", () => {
    const state = markUpdateReadyToRestart(
      markUpdateAvailable(createInitialUpdateState(), { version: "0.2.0" }),
    );

    expect(state).toMatchObject({
      status: "ready_to_restart",
      availableVersion: "0.2.0",
      progress: 100,
    });
  });

  test("blocks install while processing or model download is active", () => {
    expect(isUpdateInstallBlocked({ processingActive: true, modelDownloadActive: false })).toBe(
      true,
    );
    expect(isUpdateInstallBlocked({ processingActive: false, modelDownloadActive: true })).toBe(
      true,
    );
    expect(isUpdateInstallBlocked({ processingActive: false, modelDownloadActive: false })).toBe(
      false,
    );
  });

  test("can postpone update reminders without losing the available version", () => {
    const state = postponeUpdate(
      markUpdateAvailable(createInitialUpdateState(), { version: "0.2.0" }),
      1_800_000,
      10_000,
    );

    expect(state).toMatchObject({
      status: "postponed",
      availableVersion: "0.2.0",
      postponedUntil: 1_810_000,
    });
  });
});
