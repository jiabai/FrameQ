import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Collection } from "../../collectionsClient";
import type { HistoryListItem } from "../../historyClient";
import { safeNoteSource, type NoteInfo } from "../../noteActionsClient";
import { formatDateTime } from "../../i18n/formatters";
import { useUiLocale } from "../../i18n/LocaleProvider";
import { getHistoryTitle } from "../shell/shellNavigation";
import { NoteActionSheet } from "./NoteActionSheet";

export type NoteInfoSheetProps = {
  item: HistoryListItem | null;
  info: NoteInfo | null;
  collections: readonly Collection[];
  loading: boolean;
  notice: string | null;
  onRefresh: () => void;
  onClose: () => void;
};

export function NoteInfoSheet({ item, info, collections, loading, notice, onRefresh, onClose }: NoteInfoSheetProps) {
  const { t } = useTranslation("noteActions");
  const { t: shellT } = useTranslation("shell");
  const locale = useUiLocale();
  if (!item) return null;
  const current = info?.taskId === item.taskId ? info : null;
  const created = current ? new Date(current.createdAt) : null;
  const memberships = current ? collections.filter((collection) => collection.taskIds.includes(current.taskId)) : [];
  const source = current ? current.source.kind === "local_file" ? current.source.displayName : safeNoteSource(current.source) : null;
  const titleOrigin = current?.noteMetadata?.displayTitle && !current.noteMetadataError ? "manual" : current?.noteTitle?.text ? "generated" : "fallback";

  return (
    <NoteActionSheet
      open
      title={t("info.title")}
      onClose={onClose}
      className="note-information-sheet"
      footer={<button type="button" className="note-action-button" onClick={onClose}>{t("common.done")}</button>}
    >
      <div className="note-action-tools"><button type="button" className="note-action-button" onClick={onRefresh} disabled={loading}><RefreshCw size={16} aria-hidden="true" />{t("common.refresh")}</button></div>
      {loading ? <p className="note-action-notice" role="status">{t("info.loading")}</p> : null}
      {notice ? <p className="note-action-notice" role="alert">{notice}</p> : null}
      {current?.noteMetadataError ? <p className="note-action-notice" role="status">{t("notice.metadataLoadFailed")}</p> : null}
      {!loading && !notice && !current ? <p className="note-action-notice" role="status">{t("info.unavailable")}</p> : null}
      {current ? (
        <dl className="note-information-fields">
          <div><dt>{t("info.fields.title")}</dt><dd>{getHistoryTitle(current)}</dd></div>
          <div><dt>{t("info.fields.titleOrigin")}</dt><dd>{t(`info.origins.${titleOrigin}`)}</dd></div>
          {created && !Number.isNaN(created.getTime()) ? <div><dt>{t("info.fields.createdAt")}</dt><dd><time dateTime={current.createdAt}>{formatDateTime(created, locale)}</time></dd></div> : null}
          <div><dt>{t("info.fields.sourceType")}</dt><dd>{t(`info.sourceTypes.${current.source.kind === "url" ? "url" : current.source.mediaKind}`)}</dd></div>
          {source ? <div><dt>{t("info.fields.source")}</dt><dd>{source}</dd></div> : null}
          <div><dt>{t("info.fields.status")}</dt><dd>{t(`info.statuses.${current.status}`)}</dd></div>
          {current.noteTitle ? <div><dt>{t("info.fields.titleStatus")}</dt><dd>{t(`info.titleStatuses.${current.noteTitle.status}`)}</dd></div> : null}
          {current.transcript?.language ? <div><dt>{t("info.fields.transcriptLanguage")}</dt><dd>{current.transcript.language}</dd></div> : null}
          {current.transcript?.engine ? <div><dt>{t("info.fields.transcriptEngine")}</dt><dd>{current.transcript.engine}</dd></div> : null}
          {memberships.length > 0 ? <div><dt>{t("info.fields.collections")}</dt><dd><ul>{memberships.map((collection) => <li key={collection.id}>{collection.name}</li>)}</ul></dd></div> : null}
          {current.artifactTypes.length > 0 ? <div><dt>{t("info.fields.artifacts")}</dt><dd><ul>{current.artifactTypes.map((artifact) => <li key={artifact}>{shellT(`artifacts.${artifact}`)}</li>)}</ul></dd></div> : null}
          <div><dt>{t("info.fields.taskId")}</dt><dd>{current.taskId}</dd></div>
        </dl>
      ) : null}
    </NoteActionSheet>
  );
}
