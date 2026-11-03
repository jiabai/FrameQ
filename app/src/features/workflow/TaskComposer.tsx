import {
  ArrowUp,
  FileAudio,
  FileVideo,
  LoaderCircle,
  Maximize2,
  Mic,
  Minimize2,
  Upload,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatBytes } from "../../i18n/formatters";
import { useUiLocale } from "../../i18n/LocaleProvider";
import { selectLocalMedia } from "../../localMediaClient";
import type { LocalMediaSelectionView } from "../../localMediaContract";
import type { TaskComposerSource, TaskSubmission } from "../../workflow";
import { normalizeSubmitUrl } from "../../urlSupport";
import { normalizeWebPageInput } from "../../webPageProtocol";
import "./composer.css";

type TaskComposerProps = {
  source: TaskComposerSource;
  canSubmit: boolean;
  statusBody: string;
  onUrlDraftChange: (url: string) => void;
  onLocalMediaSelected: (selection: LocalMediaSelectionView) => void;
  onRemoveLocalMedia: () => Promise<boolean>;
  onSubmit: (submission: TaskSubmission) => void;
};

export function TaskComposer({
  source,
  canSubmit,
  statusBody,
  onUrlDraftChange,
  onLocalMediaSelected,
  onRemoveLocalMedia,
  onSubmit,
}: TaskComposerProps) {
  const { t } = useTranslation("workflow");
  const { t: webT } = useTranslation("webPage");
  const isArticle = source.kind === "url" && !normalizeSubmitUrl(source.urlDraft) && Boolean(normalizeWebPageInput(source.urlDraft));
  const resolvedLocale = useUiLocale();
  const [expanded, setExpanded] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [localFeedbackKey, setLocalFeedbackKey] = useState<
    | "input.attachment.pickerFailed"
    | "input.attachment.removeFailed"
    | null
  >(null);
  const attachmentTriggerRef = useRef<HTMLButtonElement>(null);
  const localMediaRemoveRef = useRef<HTMLButtonElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const expandTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<"attachment" | "remove" | null>(null);
  const composerId = useId();
  const surfaceId = `${composerId}-surface`;
  const helperId = `${composerId}-helper`;
  const recordingDescriptionId = `${composerId}-recording-description`;
  const hasSource =
    source.kind === "local_media" || source.urlDraft.trim().length > 0;

  useEffect(() => {
    if (pickerBusy || removing || !pendingFocusRef.current) {
      return;
    }
    if (pendingFocusRef.current === "attachment") {
      pendingFocusRef.current = null;
      attachmentTriggerRef.current?.focus();
      return;
    }
    if (pendingFocusRef.current === "remove" && source.kind === "local_media") {
      pendingFocusRef.current = null;
      localMediaRemoveRef.current?.focus();
    }
  }, [pickerBusy, removing, source.kind]);

  async function pickLocalMedia() {
    setPickerBusy(true);
    setLocalFeedbackKey(null);
    try {
      const selection = await selectLocalMedia();
      if (!selection) {
        pendingFocusRef.current = "attachment";
        return;
      }
      onLocalMediaSelected(selection);
      pendingFocusRef.current = "remove";
    } catch {
      setLocalFeedbackKey("input.attachment.pickerFailed");
      pendingFocusRef.current = "attachment";
    } finally {
      setPickerBusy(false);
    }
  }

  async function removeLocalMedia() {
    setRemoving(true);
    setLocalFeedbackKey(null);
    const removed = await onRemoveLocalMedia();
    pendingFocusRef.current = removed ? "attachment" : "remove";
    if (!removed) {
      setLocalFeedbackKey("input.attachment.removeFailed");
    }
    setRemoving(false);
  }

  function toggleExpanded() {
    setExpanded(!expanded);
    if (expanded) {
      expandTriggerRef.current?.focus();
    } else if (source.kind === "url") {
      urlInputRef.current?.focus();
    } else {
      localMediaRemoveRef.current?.focus();
    }
  }

  function submitCurrentSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || pickerBusy || removing || !hasSource) {
      return;
    }
    if (source.kind === "url") {
      onSubmit({ kind: "url", url: source.urlDraft });
      return;
    }
    onSubmit({
      kind: "local_media",
      selectionToken: source.selection.selectionToken,
    });
  }

  return (
    <form
      className={`media-composer${expanded ? " is-expanded" : ""}`}
      aria-label={t("input.title")}
      onSubmit={submitCurrentSource}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(false);
          expandTriggerRef.current?.focus();
        }
      }}
    >
      <div className="media-composer-surface" id={surfaceId}>
        <div className="media-composer-content">
          {source.kind === "url" ? (
            <input
              ref={urlInputRef}
              id="video-url"
              aria-label={t("input.urlAria")}
              aria-describedby={isArticle ? `${helperId} ${helperId}-title` : helperId}
              value={source.urlDraft}
              onChange={(event) => onUrlDraftChange(event.currentTarget.value)}
              placeholder={t("input.placeholder")}
              autoComplete="off"
              spellCheck={false}
            />
          ) : (
            <div
              className="local-media-chip"
              data-media-kind={source.selection.mediaKind}
              role="group"
              aria-label={t("input.attachment.selectedAria")}
              aria-describedby={isArticle ? `${helperId}-title` : undefined}
            >
              {source.selection.mediaKind === "video" ? (
                <FileVideo size={20} aria-hidden="true" />
              ) : (
                <FileAudio size={20} aria-hidden="true" />
              )}
              <span className="local-media-chip-copy">
                <strong title={source.selection.displayName}>
                  {source.selection.displayName}
                </strong>
                <small>
                  {t("input.attachment.details", {
                    kind: t(`input.attachment.kind.${source.selection.mediaKind}`),
                    size: formatBytes(source.selection.sizeBytes, resolvedLocale),
                  })}
                </small>
              </span>
              <button
                ref={localMediaRemoveRef}
                className="local-media-remove"
                type="button"
                aria-label={t("input.attachment.removeAria", {
                  name: source.selection.displayName,
                })}
                disabled={removing || pickerBusy}
                onClick={() => void removeLocalMedia()}
              >
                {removing ? (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                ) : (
                  <X size={16} aria-hidden="true" />
                )}
              </button>
            </div>
          )}
        </div>

        <div className="media-composer-toolbar">
          <button
            ref={attachmentTriggerRef}
            className="media-composer-tool media-composer-file"
            type="button"
            aria-label={t("input.attachment.openAria")}
            title={t("input.attachment.selectFile")}
            aria-busy={pickerBusy}
            disabled={pickerBusy || removing}
            onClick={() => void pickLocalMedia()}
          >
            {pickerBusy ? (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            ) : (
              <Upload size={18} aria-hidden="true" />
            )}
            <span>{t("input.chooseFiles")}</span>
          </button>
          <span
            className="media-composer-recording"
            title={t("input.recordingUnavailable")}
          >
            <button
              className="media-composer-tool"
              type="button"
              disabled
              title={t("input.recordingUnavailable")}
              aria-describedby={recordingDescriptionId}
            >
              <Mic size={17} aria-hidden="true" />
              <span>{t("input.recordVoice")}</span>
            </button>
          </span>
          <span className="media-composer-sr-only" id={recordingDescriptionId}>
            {t("input.recordingUnavailable")}
          </span>
          <div className="media-composer-actions">
            {hasSource ? (
              <button
                className="media-composer-submit"
                type="submit"
                aria-label={t("input.confirm")}
                aria-describedby={isArticle ? `${helperId}-title` : undefined}
                title={t("input.confirm")}
                disabled={!canSubmit || pickerBusy || removing}
              >
                <ArrowUp size={18} aria-hidden="true" />
              </button>
            ) : null}
            <button
              ref={expandTriggerRef}
              className="media-composer-tool media-composer-expand"
              type="button"
              aria-label={t(expanded ? "input.collapse" : "input.expand")}
              title={t(expanded ? "input.collapse" : "input.expand")}
              aria-expanded={expanded}
              aria-controls={surfaceId}
              onClick={toggleExpanded}
            >
              {expanded ? (
                <Minimize2 size={17} aria-hidden="true" />
              ) : (
                <Maximize2 size={17} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>
      {localFeedbackKey ? (
        <p className="action-notice composer-notice" role="alert">
          {t(localFeedbackKey)}
        </p>
      ) : null}
      <p className="media-composer-helper" id={helperId}>
        {t("input.supportedSources")}
      </p>
      {isArticle && <p className="media-composer-helper media-composer-title-disclosure" id={`${helperId}-title`}>
        {webT("disclosure")}
      </p>}
      <p className="media-composer-status" aria-live="polite">
        {pickerBusy ? t("input.attachment.pickerBusy") : statusBody}
      </p>
    </form>
  );
}
