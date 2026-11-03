import { useTranslation } from "react-i18next";
import type { StoragePreflightProgress } from "../../dataStorageProtocol";
import { formatBytes, formatNumber } from "../../i18n/formatters";
import { useUiLocale } from "../../i18n/LocaleProvider";

export function StoragePreflightProgressView({ progress }: { progress: StoragePreflightProgress | null }) {
  const { t } = useTranslation("dataStorage");
  const locale = useUiLocale();
  const stage = progress?.stage ?? "waiting";
  const label = t(`preflight.stages.${stage}`);
  const total = progress?.totalBytes ?? progress?.totalFiles ?? null;
  const completed = progress?.totalBytes !== null ? progress?.completedBytes : progress.completedFiles;
  return <section className="data-storage-progress" role="status" aria-live="polite">
    <strong>{label}</strong>
    {progress && stage !== "waiting" && <>
      {total === null ? <progress aria-label={label} /> : <progress max={Math.max(1, total)} value={completed} aria-label={label} />}
      {progress.totalFiles === null
        ? <span>{t(stage === "inventory_scanning" ? "preflight.discoveredFiles" : "preflight.processedFiles", { files: formatNumber(progress.completedFiles, locale) })}</span>
        : <span>{t("progress", { completed: formatNumber(progress.completedFiles, locale), total: formatNumber(progress.totalFiles, locale) })} {t("files")}</span>}
      {progress.totalBytes !== null && <small>{t("progress", { completed: formatBytes(progress.completedBytes, locale), total: formatBytes(progress.totalBytes, locale) })}</small>}
      {progress.currentFileTotalBytes > 0 && <div className="data-storage-progress">
        <small>{t("preflight.currentFile")}</small>
        <progress max={progress.currentFileTotalBytes} value={progress.currentFileBytes} aria-label={t("preflight.currentFile")} />
        <small>{t("progress", { completed: formatBytes(progress.currentFileBytes, locale), total: formatBytes(progress.currentFileTotalBytes, locale) })}</small>
      </div>}
    </>}
  </section>;
}
