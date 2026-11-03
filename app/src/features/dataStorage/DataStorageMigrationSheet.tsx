import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { AnimatedSheet } from "../modal/AnimatedSheet";
import { ConfirmDialog } from "../modal/ConfirmDialog";
import { formatBytes, formatNumber } from "../../i18n/formatters";
import { useUiLocale } from "../../i18n/LocaleProvider";
import type { DataStorageController, StorageEditorId } from "./useDataStorageController";
import { storageErrorTranslation } from "../../dataStorageProtocol";
import { StoragePreflightProgressView } from "./StoragePreflightProgress";

export function DataStorageMigrationSheet({ controller: c, persistent = false }: { controller: DataStorageController; persistent?: boolean }) {
  const { t } = useTranslation("dataStorage");
  const locale = useUiLocale();
  const [discard, setDiscard] = useState<StorageEditorId | null>(null);
  const operation = c.state?.operation;
  const error = c.error ?? operation?.lastError ?? c.state?.lastError;
  const visible = persistent || c.open || c.state !== null && c.state.dataAccess !== "ready";
  const cleanupMode = Boolean(c.cleanup) || c.preflightKind === "cleanup" || operation?.phase === "cleaning";
  const label = cleanupMode ? t("cleanup") : persistent && !operation ? t("recoveryTitle") : t("migrationTitle");
  const showPreflight = c.preparing;
  const closeAllowed = !persistent && error !== "DATA_STORAGE_IPC_RESPONSE_INVALID" && (c.preparing || c.state?.dataAccess === "ready" || operation?.canCancel);
  const paths = c.preview?.sourcePaths ?? c.cleanup?.sourcePaths ?? operation?.sourcePaths;
  const target = c.preview?.targetPath ?? operation?.targetPath;
  const merge = c.preview?.merge ?? operation?.merge ?? false;
  return <>
    <AnimatedSheet open={visible} ariaLabel={label} className="data-storage-sheet" onBackdropClick={() => { if (closeAllowed) c.close(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (closeAllowed) c.close(); } }}>
      <header className="sheet-header"><h2>{label}</h2>{closeAllowed && <button className="icon-button" type="button" disabled={c.cancelling} onClick={c.close} aria-label={t("close")}><X size={18} /></button>}</header>
      <div className="sheet-body">
        <p className="data-storage-description">{showPreflight ? t(`preflight.bodies.${c.preflightProgress?.stage ?? "waiting"}`) : c.preview ? t(merge ? "mergeConfirmBody" : "confirmBody") : c.cleanup || cleanupMode ? t("cleanupBody") : c.state?.dataAccess === "restart_required" ? t(operation ? "restartBody" : "restartValidationBody") : operation?.phase === "merging" ? t("mergingBody") : persistent && !operation ? t("recoveryBody") : t("scope")}</p>
        {c.loading && <p role="status">{t("loading")}</p>}
        {showPreflight && <StoragePreflightProgressView progress={c.preflightProgress} />}
        {c.preparing && c.cancelling && <p role="status">{t("preflight.cancelling")}</p>}
        {c.preparing && c.preparation.updateRestartRequired && <p role="status">{t("updateFirst")}</p>}
        {c.preparing && c.editors.some(editor => editor.dirty) && <section className="data-storage-editors">
          <p>{t("preflight.dirtyBody")}</p>
          {c.editors.filter(editor => editor.dirty).map(editor => <div key={editor.id}><span>{t(`editors.${editor.id}`)}</span><div className="tool-actions">
            {editor.save && <button className="secondary-button" type="button" disabled={editor.saving || c.working || c.preparation.busy} onClick={() => { void c.resolveEditor(editor.id, false); }}>{t("save")}</button>}
            <button className="secondary-button" type="button" disabled={editor.saving || c.working || c.preparation.busy} onClick={() => setDiscard(editor.id)}>{t("discard")}</button>
          </div></div>)}
        </section>}
        {(paths || target) && <dl className="sheet-facts">
          {paths?.length ? <div><dt>{t("source")}</dt><dd>{paths.map(path => <span className="sheet-path" title={path} key={path}>{path}</span>)}</dd></div> : null}
          {target && <div><dt>{t("target")}</dt><dd><span className="sheet-path" title={target}>{target}</span></dd></div>}
          {(c.preview || c.cleanup) && <>
            <div><dt>{t(c.cleanup ? "preflight.deletableFiles" : "files")}</dt><dd>{formatNumber((c.preview ?? c.cleanup)!.totalFiles, locale)}</dd></div>
            <div><dt>{t(c.cleanup ? "preflight.deletableBytes" : "bytes")}</dt><dd>{formatBytes((c.preview ?? c.cleanup)!.totalBytes, locale)}</dd></div>
          </>}
          {c.preview && <><div><dt>{t("required")}</dt><dd>{formatBytes(c.preview.requiredBytes, locale)}</dd></div><div><dt>{t("available")}</dt><dd>{formatBytes(c.preview.availableBytes, locale)}</dd></div></>}
          {c.cleanup && <div><dt>{t("preflight.retainedFiles")}</dt><dd>{formatNumber(c.cleanup.retainedFiles, locale)}</dd></div>}
        </dl>}
        {operation && !c.preview && !c.cleanup && !showPreflight && <section className="data-storage-progress" role="status" aria-live="polite">
          <strong>{t(`phases.${operation.phase}`)}</strong>
          <progress max={Math.max(1, operation.totalBytes)} value={operation.completedBytes} aria-label={t(`phases.${operation.phase}`)} />
          <span>{t("progress", { completed: formatBytes(operation.completedBytes, locale), total: formatBytes(operation.totalBytes, locale) })}</span>
          <small>{t("progress", { completed: formatNumber(operation.completedFiles, locale), total: formatNumber(operation.totalFiles, locale) })} {t("files")}</small>
        </section>}
        {error && error !== "RestartRequired" && <p className="data-storage-error" role="alert">{t(storageErrorTranslation(error, merge))}</p>}
        {!operation && !c.preview && !c.cleanup && !c.preparing && c.state?.cleanupReceipts.map(receipt => <div className="data-storage-cleanup-row" key={receipt.receiptId}>
          <span>{t("cleanupAvailable")}</span><button className="secondary-button" type="button" disabled={c.working} onClick={() => { void c.prepareCleanup(receipt.receiptId); }}>{t("cleanup")}</button>
        </div>)}
        {!operation && !c.preview && !c.cleanup && !c.preparing && c.state?.recoveryCandidates.filter(candidate => candidate.canResume).map(candidate => <section className="data-storage-progress" key={candidate.operationId}>
          <strong>{t("recoveryAvailable")}</strong><span className="sheet-path" title={candidate.targetPath}>{candidate.targetPath}</span>
          <button className="secondary-button" type="button" disabled={c.working} onClick={() => { void c.resume(candidate.operationId); }}>{t("continue")}</button>
        </section>)}
      </div>
      <footer className="sheet-footer">
        {closeAllowed && <button className="secondary-button" type="button" disabled={c.cancelling} onClick={c.close}>{c.preview || c.preparing || operation?.canCancel ? t("cancel") : t("close")}</button>}
        {operation?.canCancel && !c.preparing && !closeAllowed && <button className="secondary-button" type="button" disabled={c.cancelling} onClick={c.cancel}>{t("cancel")}</button>}
        {c.preparing && c.preparation.updateRestartRequired && <button className="primary-button" type="button" disabled={c.working || c.preparation.busy || c.editors.length > 0} onClick={() => { void c.restartUpdate(); }}>{t("restart")}</button>}
        {(c.preview || c.cleanup) && <button className={c.cleanup ? "danger-button" : "primary-button"} type="button" disabled={c.working || c.cancelling} onClick={() => { void c.confirm(); }}>{c.cleanup ? t("cleanup") : t("confirm")}</button>}
        {operation?.canResume && !c.preparing && !c.preview && !["restart_required", "validating"].includes(operation.phase) && <button className="primary-button" type="button" disabled={c.working} onClick={() => { void c.resume(); }}>{t("continue")}</button>}
        {c.state?.dataAccess === "restart_required" && <button className="primary-button" type="button" disabled={c.working} onClick={() => { void c.restart(); }}>{t("restart")}</button>}
        {error === "LegacySourceAmbiguous" && <button className="secondary-button" type="button" disabled={c.working} onClick={() => { void c.locateLegacy(); }}>{t("legacyLocate")}</button>}
        {!c.preparing && !c.preview && !c.cleanup && c.state?.dataAccess !== "restart_required" && (Boolean(error) || c.state?.dataAccess === "unavailable" || !["copying", "verifying", "merging", "publishing", "validating", "cleaning"].includes(operation?.phase ?? "")) && <>
          <button className="secondary-button" type="button" disabled={c.working} onClick={() => { void c.recheck(); }}>{t("retry")}</button>
          {(persistent || c.state?.dataAccess === "unavailable") && <button className="primary-button" type="button" disabled={c.working} onClick={() => { void c.locate(); }}>{t("locate")}</button>}
        </>}
      </footer>
    </AnimatedSheet>
    <ConfirmDialog open={discard !== null && visible} title={t("discardTitle")} message={t("discardBody")} cancelLabel={t("keepEditing")} confirmLabel={t("discard")}
      onCancel={() => setDiscard(null)} onConfirm={() => { const id = discard; setDiscard(null); if (id) void c.resolveEditor(id, true); }} />
  </>;
}
