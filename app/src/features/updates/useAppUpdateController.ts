import { useCallback, useEffect, useRef, useState } from "react";

import {
  checkForAppUpdate,
  createDefaultUpdatePreferences,
  getUpdatePreferences,
  installAppUpdate,
  relaunchApp,
  saveUpdatePreferences,
  type AppUpdateInfo,
  type UpdatePreferences,
} from "../../updateClient";
import {
  applyUpdateDownloadEvent,
  createInitialUpdateState,
  failUpdate,
  isUpdateInstallBlocked,
  markUpdateAvailable,
  markUpdateReadyToRestart,
  markUpdateUpToDate,
  postponeUpdate,
  startUpdateCheck,
  startUpdateDownload,
} from "../../updateState";

type UseAppUpdateControllerOptions = {
  processingActive: boolean;
  modelDownloadActive: boolean;
};

export function useAppUpdateController({
  processingActive,
  modelDownloadActive,
}: UseAppUpdateControllerOptions) {
  const [updateState, setUpdateState] = useState(createInitialUpdateState);
  const updateInfoRef = useRef<AppUpdateInfo | null>(null);
  const updatePreferencesRef = useRef<UpdatePreferences>(createDefaultUpdatePreferences());
  const updateBusy = isUpdateBusy(updateState.status);
  const updateInstallBlocked = isUpdateInstallBlocked({
    processingActive,
    modelDownloadActive,
  });
  const updateToolbarVisible = isUpdateActionVisible(updateState.status);
  const updateSpinnerVisible = updateState.status === "downloading" || updateState.status === "installing";

  const persistUpdatePreferences = useCallback((patch: Partial<UpdatePreferences>) => {
    const next = {
      ...updatePreferencesRef.current,
      ...patch,
    };
    updatePreferencesRef.current = next;
    void saveUpdatePreferences(next).catch((error) => {
      console.warn("Failed to save update preferences", error);
    });
  }, []);

  const checkForUpdates = useCallback(
    async (options: { silent?: boolean; isCancelled?: () => boolean } = {}) => {
      if (!options.silent) {
        persistUpdatePreferences({ postponedUntil: null });
      }
      setUpdateState((current) => startUpdateCheck(current));
      try {
        const update = await checkForAppUpdate();
        if (options.isCancelled?.()) {
          return;
        }

        if (!update) {
          updateInfoRef.current = null;
          persistUpdatePreferences({
            lastCheckedAt: new Date().toISOString(),
            skippedVersion: null,
          });
          setUpdateState((current) =>
            options.silent ? createInitialUpdateState() : markUpdateUpToDate(current),
          );
          return;
        }

        updateInfoRef.current = update;
        persistUpdatePreferences({
          lastCheckedAt: new Date().toISOString(),
          skippedVersion: null,
        });
        setUpdateState((current) =>
          markUpdateAvailable(current, {
            version: update.version,
            notes: update.notes,
          }),
        );
      } catch (error) {
        if (options.isCancelled?.()) {
          return;
        }

        if (options.silent) {
          setUpdateState(createInitialUpdateState());
          return;
        }

        setUpdateState((current) => failUpdate(current, error));
      }
    },
    [persistUpdatePreferences],
  );

  const loadPreferencesAndCheckForUpdates = useCallback(
    async (isCancelled: () => boolean) => {
      try {
        const preferences = await getUpdatePreferences();
        if (isCancelled()) {
          return;
        }
        updatePreferencesRef.current = preferences;
        if (preferences.postponedUntil && preferences.postponedUntil > Date.now()) {
          return;
        }
      } catch (error) {
        console.warn("Failed to load update preferences", error);
      }

      if (!isCancelled()) {
        await checkForUpdates({ silent: true, isCancelled });
      }
    },
    [checkForUpdates],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadPreferencesAndCheckForUpdates(() => cancelled);
    }, 2_500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadPreferencesAndCheckForUpdates]);

  const restartForUpdate = useCallback(async () => {
    try {
      await relaunchApp();
    } catch (error) {
      setUpdateState((current) => failUpdate(current, error));
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (updateState.status === "ready_to_restart") {
      await restartForUpdate();
      return;
    }

    if (updateInstallBlocked) {
      setUpdateState((current) => ({
        ...current,
        message: "当前任务或模型下载完成后再安装更新。",
      }));
      return;
    }

    let update = updateInfoRef.current;
    if (!update) {
      await checkForUpdates({ silent: false });
      update = updateInfoRef.current;
    }

    if (!update) {
      return;
    }

    setUpdateState((current) => startUpdateDownload(current));
    try {
      await installAppUpdate(update, (event) => {
        setUpdateState((current) => applyUpdateDownloadEvent(current, event));
      });
      setUpdateState((current) => markUpdateReadyToRestart(current));
    } catch (error) {
      setUpdateState((current) => failUpdate(current, error));
    }
  }, [checkForUpdates, restartForUpdate, updateInstallBlocked, updateState.status]);

  const postponeUpdateReminder = useCallback(() => {
    const next = postponeUpdate(updateState, 24 * 60 * 60 * 1000);
    setUpdateState(next);
    persistUpdatePreferences({
      postponedUntil: next.postponedUntil,
      skippedVersion: null,
    });
  }, [persistUpdatePreferences, updateState]);

  return {
    updateState,
    updateBusy,
    updateInstallBlocked,
    updateToolbarVisible,
    updateSpinnerVisible,
    checkForUpdates,
    installUpdate,
    postponeUpdateReminder,
    restartForUpdate,
  };
}

function isUpdateBusy(status: string): boolean {
  return status === "checking" || status === "downloading" || status === "installing";
}

function isUpdateActionVisible(status: string): boolean {
  return status === "available" || status === "downloading" || status === "installing" || status === "ready_to_restart";
}
