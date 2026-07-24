import { describe, expect, test, vi } from "vitest";
import {
  checkForAppUpdate,
  DEFAULT_RELEASES_URL,
  getUpdateDelivery,
  getUpdatePreferences,
  installAppUpdate,
  openReleasesPage,
  relaunchApp,
  saveUpdatePreferences,
  type AppUpdateHandle,
  type UpdatePreferencesCommandRunner,
} from "./updateClient";
import { IpcProtocolError } from "./tauriIpcProtocol";

describe("update client", () => {
  test("maps an available Tauri update into app update info", async () => {
    const handle: AppUpdateHandle = {
      version: "0.2.0",
      date: "2026-06-23T10:00:00.000Z",
      body: "修复 worker 转写稳定性。",
      downloadAndInstall: async () => {},
    };

    const update = await checkForAppUpdate(async () => handle);

    expect(update).toEqual({
      version: "0.2.0",
      date: "2026-06-23T10:00:00.000Z",
      notes: "修复 worker 转写稳定性。",
      handle,
    });
  });

  test("returns null when Tauri reports no update", async () => {
    await expect(checkForAppUpdate(async () => null)).resolves.toBeNull();
  });

  test("forwards download progress events to the caller", async () => {
    const events: unknown[] = [];
    const handle: AppUpdateHandle = {
      version: "0.2.0",
      downloadAndInstall: async (onEvent) => {
        onEvent?.({ event: "Started", data: { contentLength: 100 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
        onEvent?.({ event: "Finished" });
      },
    };

    await installAppUpdate({ version: "0.2.0", notes: "", handle }, (event) => {
      events.push(event);
    });

    expect(events).toEqual([
      { event: "Started", data: { contentLength: 100 } },
      { event: "Progress", data: { chunkLength: 40 } },
      { event: "Finished" },
    ]);
  });

  test("delegates relaunch to the process plugin runner", async () => {
    const runner = vi.fn(async () => {});

    await relaunchApp(runner);

    expect(runner).toHaveBeenCalledTimes(1);
  });

  test("reports the exact FrameQ-owned update delivery response", async () => {
    await expect(
      getUpdateDelivery(async () => ({
        inAppUpdates: false,
        releasesUrl: "https://example.com/releases/latest",
      })),
    ).resolves.toEqual({
      inAppUpdates: false,
      releasesUrl: "https://example.com/releases/latest",
    });

    await expect(getUpdateDelivery(async () => ({}))).rejects.toEqual(
      new IpcProtocolError("UPDATE_IPC_RESPONSE_INVALID"),
    );
  });

  test("opens the releases page through the opener runner, falling back to the default url", async () => {
    const opened: string[] = [];
    const runner = async (url: string) => {
      opened.push(url);
    };

    await openReleasesPage("https://example.com/releases/latest", runner);
    await openReleasesPage("", runner);

    expect(opened).toEqual([
      "https://example.com/releases/latest",
      DEFAULT_RELEASES_URL,
    ]);
  });

  test("loads and saves update preferences through Tauri commands", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: UpdatePreferencesCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        lastCheckedAt: "2026-06-23T10:00:00.000Z",
        postponedUntil: 1_800_000,
        skippedVersion: null,
      };
    };

    await expect(getUpdatePreferences(runner)).resolves.toEqual({
      lastCheckedAt: "2026-06-23T10:00:00.000Z",
      postponedUntil: 1_800_000,
      skippedVersion: null,
    });
    await expect(
      saveUpdatePreferences(
        {
          lastCheckedAt: "2026-06-23T10:00:00.000Z",
          postponedUntil: 1_800_000,
          skippedVersion: null,
        },
        runner,
      ),
    ).resolves.toEqual({
      lastCheckedAt: "2026-06-23T10:00:00.000Z",
      postponedUntil: 1_800_000,
      skippedVersion: null,
    });

    expect(calls).toEqual([
      { command: "get_update_preferences", args: {} },
      {
        command: "save_update_preferences",
        args: {
          preferences: {
            lastCheckedAt: "2026-06-23T10:00:00.000Z",
            postponedUntil: 1_800_000,
            skippedVersion: null,
          },
        },
      },
    ]);
  });

  test("rejects malformed update delivery and preference responses", async () => {
    await expect(
      getUpdateDelivery(async () => ({
        inAppUpdates: "false",
        releasesUrl: "https://example.com/releases/latest",
      })),
    ).rejects.toEqual(
      new IpcProtocolError("UPDATE_IPC_RESPONSE_INVALID"),
    );
    await expect(
      getUpdatePreferences(async () => ({
        lastCheckedAt: "2026-06-23T10:00:00.000Z",
        postponedUntil: Number.NaN,
        skippedVersion: null,
      })),
    ).rejects.toEqual(
      new IpcProtocolError("UPDATE_IPC_RESPONSE_INVALID"),
    );
    await expect(
      saveUpdatePreferences(
        {
          lastCheckedAt: null,
          postponedUntil: null,
          skippedVersion: null,
        },
        async () => ({
          lastCheckedAt: null,
          postponedUntil: null,
          skippedVersion: null,
          unexpected: true,
        }),
      ),
    ).rejects.toEqual(
      new IpcProtocolError("UPDATE_IPC_RESPONSE_INVALID"),
    );
  });

  test("does not evaluate accessor-backed update preferences", async () => {
    let getterCalls = 0;
    const response = Object.defineProperty(
      {
        lastCheckedAt: null,
        skippedVersion: null,
      },
      "postponedUntil",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 1_800_000;
        },
      },
    );

    await expect(getUpdatePreferences(async () => response)).rejects.toEqual(
      new IpcProtocolError("UPDATE_IPC_RESPONSE_INVALID"),
    );
    expect(getterCalls).toBe(0);
  });
});
