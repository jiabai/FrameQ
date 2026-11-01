import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DataStorageProvider, type DataStorageController } from "./useDataStorageController";
import { DataStorageMigrationSheet } from "./DataStorageMigrationSheet";
import "./dataStorage.css";
import "../modal/sheets.css";

function StorageGate({ controller, children }: { controller: DataStorageController; children: ReactNode }) {
  const { t } = useTranslation("dataStorage");
  const { t: common } = useTranslation("common");
  const mountedApp = useRef(false);
  const ready = controller.native && controller.state?.dataAccess === "ready";
  useEffect(() => { if (ready) mountedApp.current = true; }, [ready]);
  const showApp = ready || mountedApp.current;
  return <>
    {showApp ? children : <main className="data-storage-recovery" aria-label={t("recoveryTitle")}><h1>{common("appName")}</h1><p role="status">{!controller.native ? t("nativeRequired") : controller.loading ? t("loading") : t("recoveryBody")}</p></main>}
    {controller.native && <DataStorageMigrationSheet controller={controller} persistent={!showApp} />}
  </>;
}
export function StorageBootstrap({ children }: { children: ReactNode }) {
  return <DataStorageProvider>{controller => <StorageGate controller={controller}>{children}</StorageGate>}</DataStorageProvider>;
}
