import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { UpdateDownloadEvent } from "./updateState";

export type AppUpdateHandle = {
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall: (onEvent?: (event: UpdateDownloadEvent) => void) => Promise<void>;
};

export type AppUpdateInfo = {
  version: string;
  date?: string;
  notes: string;
  handle: AppUpdateHandle;
};

export type UpdateCheckRunner = () => Promise<AppUpdateHandle | null>;
export type RelaunchRunner = () => Promise<void>;
export type UpdatePreferences = {
  lastCheckedAt: string | null;
  postponedUntil: number | null;
  skippedVersion: string | null;
};
export type UpdatePreferencesCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<unknown>;

const defaultUpdateCheckRunner: UpdateCheckRunner = async () =>
  (await check()) as AppUpdateHandle | null;
const defaultPreferencesRunner: UpdatePreferencesCommandRunner = (command, args) =>
  invoke(command, args);

export async function checkForAppUpdate(
  runner: UpdateCheckRunner = defaultUpdateCheckRunner,
): Promise<AppUpdateInfo | null> {
  const update = await runner();
  if (!update) {
    return null;
  }

  return {
    version: update.version,
    date: update.date,
    notes: update.body ?? "",
    handle: update,
  };
}

export async function installAppUpdate(
  update: AppUpdateInfo,
  onEvent?: (event: UpdateDownloadEvent) => void,
): Promise<void> {
  await update.handle.downloadAndInstall((event) => {
    const normalized = normalizeDownloadEvent(event);
    if (normalized) {
      onEvent?.(normalized);
    }
  });
}

export async function relaunchApp(runner: RelaunchRunner = relaunch): Promise<void> {
  await runner();
}

export async function getUpdatePreferences(
  runner: UpdatePreferencesCommandRunner = defaultPreferencesRunner,
): Promise<UpdatePreferences> {
  return mapUpdatePreferences((await runner("get_update_preferences", {})) as Partial<UpdatePreferences>);
}

export async function saveUpdatePreferences(
  preferences: UpdatePreferences,
  runner: UpdatePreferencesCommandRunner = defaultPreferencesRunner,
): Promise<UpdatePreferences> {
  return mapUpdatePreferences(
    (await runner("save_update_preferences", { preferences })) as Partial<UpdatePreferences>,
  );
}

export function createDefaultUpdatePreferences(): UpdatePreferences {
  return {
    lastCheckedAt: null,
    postponedUntil: null,
    skippedVersion: null,
  };
}

function normalizeDownloadEvent(event: unknown): UpdateDownloadEvent | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  const value = event as {
    event?: unknown;
    data?: {
      contentLength?: unknown;
      chunkLength?: unknown;
    };
  };

  if (value.event === "Started") {
    return {
      event: "Started",
      data: {
        contentLength:
          typeof value.data?.contentLength === "number" ? value.data.contentLength : undefined,
      },
    };
  }

  if (value.event === "Progress") {
    return {
      event: "Progress",
      data: {
        chunkLength:
          typeof value.data?.chunkLength === "number" ? value.data.chunkLength : undefined,
      },
    };
  }

  if (value.event === "Finished") {
    return { event: "Finished" };
  }

  return null;
}

function mapUpdatePreferences(response: Partial<UpdatePreferences>): UpdatePreferences {
  return {
    lastCheckedAt: typeof response.lastCheckedAt === "string" ? response.lastCheckedAt : null,
    postponedUntil:
      typeof response.postponedUntil === "number" ? response.postponedUntil : null,
    skippedVersion: typeof response.skippedVersion === "string" ? response.skippedVersion : null,
  };
}
