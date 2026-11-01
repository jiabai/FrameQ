import { useTranslation } from "react-i18next";
import { useDataStorage } from "./useDataStorageController";

export function DataStorageSetting() {
  const { t } = useTranslation("dataStorage");
  const storage = useDataStorage();
  const path = storage?.state?.currentPath;
  return <div className="data-storage-setting">
    <div><span>{t("title")}</span><small className="sheet-path" title={path}>{path || t(storage?.loading ? "loading" : "unavailable")}</small>
      {storage?.state?.legacyOutputPath && storage.state.legacyOutputPath !== path && <small className="sheet-path" title={storage.state.legacyOutputPath}>{t("legacy", { path: storage.state.legacyOutputPath })}</small>}
    </div>
    <button type="button" className="secondary-button" disabled={!storage?.native || !storage.closeGuardReady || storage.loading || storage.working || storage.frozen} onClick={() => { void storage?.begin(); }}>{t("change")}</button>
    {storage?.state?.cleanupReceipts.map(receipt => <div className="data-storage-cleanup-row" key={receipt.receiptId}><small>{t("cleanupAvailable")}</small><button type="button" className="secondary-button" disabled={storage.working || storage.frozen} onClick={() => { void storage.prepareCleanup(receipt.receiptId); }}>{t("cleanup")}</button></div>)}
    {storage?.state?.recoveryCandidates.some(candidate => candidate.canResume) && <div className="data-storage-cleanup-row"><small>{t("recoveryAvailable")}</small><button type="button" className="secondary-button" disabled={storage.working} onClick={() => storage.show()}>{t("continue")}</button></div>}
  </div>;
}
