import { ArrowUpRight, FileText, Layers3, RefreshCw } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { HistoryListItem } from "../../historyClient";
import { formatDateTime } from "../../i18n/formatters";
import { useUiLocale } from "../../i18n/LocaleProvider";
import type { SupportedLocale } from "../../i18n/locale";
import { getHistoryTitle, getVisibleArtifactKeys } from "./shellNavigation";

type ShellLibraryProps = {
  view: "notes" | "artifacts";
  items: readonly HistoryListItem[];
  loading: boolean;
  notice: string | null;
  selectionDisabled: boolean;
  disabledReason: string;
  onOpenTask: (item: HistoryListItem) => void;
  onRefresh: () => void;
  onManageHistory: () => void;
};

function formatHistoryTimestamp(value: string, locale: SupportedLocale): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDateTime(date, locale);
}

export function ShellLibrary({
  view,
  items,
  loading,
  notice,
  selectionDisabled,
  disabledReason,
  onOpenTask,
  onRefresh,
  onManageHistory,
}: ShellLibraryProps) {
  const { t } = useTranslation("shell");
  const { t: historyT } = useTranslation("history");
  const locale = useUiLocale();
  const id = useId();
  const guardReasonId = `${id}-guard-reason`;
  const title = t(`nav.${view}`);
  const visibleItems = view === "artifacts"
    ? items.filter((item) => getVisibleArtifactKeys(item.artifacts).length > 0)
    : items;

  return (
    <section className="shell-library" aria-labelledby={`${id}-title`}>
      <header className="shell-library-header">
        <div>
          <h1 id={`${id}-title`}>{title}</h1>
          <p>{t(view === "notes" ? "library.notesDescription" : "library.artifactsDescription")}</p>
        </div>
        <div className="shell-library-actions">
          <button className="shell-library-action" type="button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" className={loading ? "spin" : undefined} />{t("library.refresh")}
          </button>
          <button className="shell-library-action" type="button" onClick={onManageHistory}>{t("library.manageHistory")}</button>
        </div>
      </header>

      {selectionDisabled ? <p className="shell-library-notice" id={guardReasonId}>{disabledReason}</p> : null}
      {loading && !notice ? <p className="shell-library-notice" role="status">{t("library.loading")}</p> : null}
      {notice ? <p className="shell-library-notice" role="status">{notice}</p> : null}
      {!loading && !notice && visibleItems.length === 0 ? (
        <div className="shell-library-empty">
          {view === "notes" ? <FileText size={28} aria-hidden="true" strokeWidth={1.3} /> : <Layers3 size={28} aria-hidden="true" strokeWidth={1.3} />}
          <p>{t(view === "notes" ? "library.emptyNotes" : "library.emptyArtifacts")}</p>
        </div>
      ) : null}

      {view === "notes" && visibleItems.length > 0 ? (
        <ul className="shell-library-notes" aria-label={title}>
          {visibleItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="shell-library-note"
                onClick={() => onOpenTask(item)}
                disabled={selectionDisabled}
                aria-label={t("library.openTask", { title: getHistoryTitle(item) })}
                aria-describedby={selectionDisabled ? guardReasonId : undefined}
                title={selectionDisabled ? disabledReason : undefined}
              >
                <FileText size={21} strokeWidth={1.4} aria-hidden="true" />
                <span className="shell-library-note-main">
                  <strong>{getHistoryTitle(item)}</strong>
                  <span className="shell-library-note-meta">
                    <time dateTime={item.createdAt}>{formatHistoryTimestamp(item.createdAt, locale)}</time>
                    <span>{historyT(`status.${item.status}`)}</span>
                  </span>
                </span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {view === "artifacts" ? (
        <div className="shell-artifact-groups">
          {visibleItems.map((item) => (
            <section className="shell-artifact-group" key={item.id} aria-labelledby={`${id}-${item.id}`}>
              <div className="shell-artifact-heading">
                <h2 id={`${id}-${item.id}`}>{getHistoryTitle(item)}</h2>
                <time dateTime={item.createdAt}>{formatHistoryTimestamp(item.createdAt, locale)}</time>
              </div>
              <ul className="shell-artifact-list">
                {getVisibleArtifactKeys(item.artifacts).map((key) => (
                  <li key={key}>
                    <button
                      type="button"
                      className="shell-artifact"
                      onClick={() => onOpenTask(item)}
                      disabled={selectionDisabled}
                      aria-label={t("library.openArtifact", { artifact: t(`artifacts.${key}`), title: getHistoryTitle(item) })}
                      aria-describedby={selectionDisabled ? guardReasonId : undefined}
                      title={selectionDisabled ? disabledReason : undefined}
                    >
                      <FileText size={22} aria-hidden="true" strokeWidth={1.4} />
                      <span>{t(`artifacts.${key}`)}</span>
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
