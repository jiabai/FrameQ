import {
  Download,
  FolderOpen,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AsrModelStatus } from "../asrModel/types";
import type { UpdateState } from "../../updateState";
import type { InsightPreferenceState } from "../../insightPreferencesClient";
import type { SupportedLocale } from "../../i18n/locale";
import { clampPercent, formatBytes, formatProgressPercent, selectPluralCategory } from "../../i18n/formatters";
import { renderUiMessage } from "../../i18n/uiMessage";
import {
  getPreferenceCopy,
  interpolatePreferenceCopy,
  summarizeGenerationPreferences,
  summarizeInspirationProfile,
} from "../../i18n/preferencePresentation";
import type { SettingsCategory, SettingsController } from "./useSettingsController";
import { LanguagePreferenceField } from "./LanguagePreferenceField";
import { AnimatedSheet } from "../modal/AnimatedSheet";
import { asrModelLabel } from "../asrModel/asrModelLabels";
import { StatusLine } from "../common/StatusLine";

type SettingsSheetProps = {
  controller: SettingsController;
  asrModelStatus: AsrModelStatus;
  modelDownloadActive: boolean;
  updateState: UpdateState;
  updateBusy: boolean;
  updateInstallBlocked: boolean;
  inAppUpdates: boolean;
  currentVersion: string;
  onAsrModelSelection?: (model: string) => void;
  onOpenProfileEditorFromSettings: () => void | Promise<void>;
  onCheckForUpdates: (options?: { silent?: boolean; isCancelled?: () => boolean }) => void | Promise<void>;
  onInstallUpdate: () => void | Promise<void>;
  onPostponeUpdateReminder: () => void | Promise<void>;
  onRestartForUpdate: () => void | Promise<void>;
  onOpenReleases: () => void | Promise<void>;
  locale: SupportedLocale;
};

type SettingsProfilePresentation = {
  label: string;
  tone: "ready" | "missing";
  lines: string[];
};

const INSTALLABLE_UPDATE_STATUSES = new Set(["available", "postponed"]);

function settingsProfilePresentation(
  state: InsightPreferenceState | null,
  loading: boolean,
  locale: SupportedLocale,
): SettingsProfilePresentation {
  const copy = getPreferenceCopy(locale).settings;

  if (!state) {
    return {
      label: loading ? copy.statusReading : copy.statusUnavailable,
      tone: "missing",
      lines: [loading ? copy.summaryLoading : copy.summaryUnavailable],
    };
  }

  if (state.profileStatus === "invalid") {
    return { label: copy.statusResetRequired, tone: "missing", lines: [copy.profileResetRequired] };
  }

  if (state.profileStatus === "skipped") {
    return { label: copy.statusSkipped, tone: "missing", lines: [copy.profileNotSet] };
  }

  if (state.profileStatus === "valid") {
    const summary = summarizeInspirationProfile(state.profile, locale);
    const remainingCount = summary.length - 3;
    const lines =
      summary.length > 3
        ? [
            ...summary.slice(0, 3),
            interpolatePreferenceCopy(
              selectPluralCategory(remainingCount, locale) === "one"
                ? copy.moreItems_one
                : copy.moreItems_other,
              { count: remainingCount },
            ),
          ]
        : summary;
    return { label: copy.statusReady, tone: "ready", lines };
  }

  return { label: copy.statusNotSet, tone: "missing", lines: [copy.profileNotSet] };
}

function settingsGenerationPreferenceLines(
  state: InsightPreferenceState | null,
  loading: boolean,
  locale: SupportedLocale,
): string[] {
  const copy = getPreferenceCopy(locale).settings;
  if (!state) {
    return [loading ? copy.defaultLoading : copy.defaultUnavailable];
  }

  if (!state.defaultGenerationPreferences) {
    return [copy.defaultNotSaved];
  }

  const summary = summarizeGenerationPreferences(state.defaultGenerationPreferences, locale);
  const savedTemplate =
    selectPluralCategory(summary.length, locale) === "one"
      ? copy.defaultSaved_one
      : copy.defaultSaved_other;
  return [interpolatePreferenceCopy(savedTemplate, { count: summary.length })];
}

export function SettingsSheet({
  controller,
  asrModelStatus,
  modelDownloadActive,
  updateState,
  updateBusy,
  updateInstallBlocked,
  inAppUpdates,
  currentVersion,
  onAsrModelSelection,
  onOpenProfileEditorFromSettings,
  onCheckForUpdates,
  onInstallUpdate,
  onPostponeUpdateReminder,
  onRestartForUpdate,
  onOpenReleases,
  locale,
}: SettingsSheetProps) {
  const { t: tSettings } = useTranslation("settings");
  const { t: tUpdates } = useTranslation("updates");
  const { t: tCommon } = useTranslation("common");
  const preferenceCopy = getPreferenceCopy(locale).settings;
  const localizedSettingsNavItems: Array<{ id: SettingsCategory; label: string; description: string }> = [
    {
      id: "basic",
      label: tSettings("navigation.basic.label"),
      description: tSettings("navigation.basic.description"),
    },
    {
      id: "inspiration",
      label: preferenceCopy.navLabel,
      description: preferenceCopy.navDescription,
    },
    {
      id: "storage",
      label: tSettings("navigation.storage.label"),
      description: tSettings("navigation.storage.description"),
    },
    {
      id: "updates",
      label: tSettings("navigation.updates.label"),
      description: tSettings("navigation.updates.description"),
    },
    {
      id: "advanced",
      label: tSettings("navigation.advanced.label"),
      description: tSettings("navigation.advanced.description"),
    },
  ];
  const {
    settingsOpen,
    settingsCategory,
    settingsDraft,
    settingsSupportedAsrModels,
    settingsConfigPath,
    settingsAsrModelMigrated,
    audioReviewCacheUsage,
    settingsInsightPreferences,
    settingsNotice,
    exportDiagnostics,
    diagnosticExportBusy,
    diagnosticExportNotice,
    settingsLoading,
    settingsSaving,
    closeSettings,
    submitSettings,
    dismissAsrModelMigrationNotice,
    setSettingsCategory,
    updateSettingsDraft,
    clearAudioReviewCacheFromSettings,
    clearProfileFromSettings,
    locateSettingsConfigFile,
  } = controller;
  const renderedSettingsNotice = renderUiMessage(locale, settingsNotice);
  const renderedDiagnosticExportNotice = renderUiMessage(locale, diagnosticExportNotice);
  const renderedUpdateMessage = renderUiMessage(locale, updateState.message);
  const updateProgress = clampPercent(updateState.progress);
  const profilePresentation = settingsProfilePresentation(
    settingsInsightPreferences,
    settingsLoading,
    locale,
  );

  // The five categories share no markup, so they stay as named render helpers
  // in this file rather than becoming five prop-plumbing components.
  function renderBasicSection() {
    return (
      <>
        <LanguagePreferenceField />
        <p className="settings-basic-note">
          <ShieldCheck size={15} />
          <span>{tSettings("basic.privacy")}</span>
        </p>
        <section id="settings-basic" className="sheet-form-section">
          <div className="form-section-heading">
            <h3>{tSettings("basic.heading")}</h3>
            <p>{tSettings("basic.description")}</p>
          </div>
          {settingsAsrModelMigrated ? (
            <div className="model-migration-notice" role="status">
              <div className="model-migration-notice-body">
                <strong>{tSettings("basic.migrationNotice.title")}</strong>
                <p>{tSettings("basic.migrationNotice.body")}</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void dismissAsrModelMigrationNotice()}
              >
                {tSettings("basic.migrationNotice.dismiss")}
              </button>
            </div>
          ) : null}
          <label className="field-row">
            <span>{tSettings("basic.asrModel")}</span>
            <select
              value={settingsDraft.asrModel}
              onChange={(event) => {
                const model = event.currentTarget.value;
                updateSettingsDraft("asrModel", model);
                onAsrModelSelection?.(model);
              }}
              disabled={settingsLoading || settingsSaving || modelDownloadActive}
            >
              {settingsSupportedAsrModels.map((model) => (
                <option value={model} key={model}>
                  {asrModelLabel(model)}
                </option>
              ))}
            </select>
          </label>
          <div className="model-settings-row">
            <div>
              <span className={`model-status-badge ${asrModelStatus.available ? "ready" : "missing"}`}>
                {asrModelStatus.available
                  ? tSettings("basic.modelReady")
                  : tSettings("basic.modelMissing")}
              </span>
              <small>{asrModelStatus.modelDir || tSettings("basic.defaultModelPath")}</small>
            </div>
          </div>
          <label className="field-row">
            <span>{tSettings("basic.outputDirectory")}</span>
            <input
              value={settingsDraft.outputDir}
              onChange={(event) => updateSettingsDraft("outputDir", event.currentTarget.value)}
              placeholder={tSettings("basic.outputPlaceholder")}
              disabled={settingsLoading || settingsSaving}
            />
          </label>
        </section>
      </>
    );
  }

  function renderInspirationSection() {
    return (
      <section id="settings-inspiration" className="sheet-form-section inspiration-settings-section">
        <div className="form-section-heading">
          <h3>{preferenceCopy.heading}</h3>
          <p>{preferenceCopy.description}</p>
        </div>
        <div className="settings-status-card inspiration-profile-card">
          <div>
            <span className={`model-status-badge ${profilePresentation.tone}`}>
              {profilePresentation.label}
            </span>
            <strong>{preferenceCopy.profileCardTitle}</strong>
            <div className="settings-summary-list">
              {profilePresentation.lines.map((line, index) => (
                <span key={`${line}-${index}`}>{line}</span>
              ))}
            </div>
          </div>
          <div className="inspiration-settings-actions">
            <button
              type="button"
              className="secondary-button profile-edit-button"
              onClick={() => void onOpenProfileEditorFromSettings()}
              disabled={settingsLoading || settingsSaving}
            >
              <UserRound size={15} />
              <span>{preferenceCopy.editProfile}</span>
            </button>
            <button
              type="button"
              className="secondary-button profile-clear-button"
              onClick={() => void clearProfileFromSettings()}
              disabled={settingsLoading || settingsSaving}
            >
              <X size={15} />
              <span>{preferenceCopy.clearProfile}</span>
            </button>
          </div>
        </div>
        <div className="settings-status-card quiet">
          <div>
            <strong>{preferenceCopy.defaultGenerationTitle}</strong>
            <div className="settings-summary-list">
              {settingsGenerationPreferenceLines(
                settingsInsightPreferences,
                settingsLoading,
                locale,
              ).map((line, index) => (
                <span key={`${line}-${index}`}>{line}</span>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  function renderStorageSection() {
    return (
      <section id="settings-storage" className="sheet-form-section audio-cache-settings-section">
        <div className="form-section-heading">
          <h3>{tSettings("storage.heading")}</h3>
          <p>{tSettings("storage.description")}</p>
        </div>
        <div className="config-file-row audio-cache-row">
          <code title={audioReviewCacheUsage?.cachePath ?? ""}>
            {tSettings("storage.audioCache", {
              size: formatBytes(audioReviewCacheUsage?.sizeBytes ?? 0, locale),
            })}
          </code>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void clearAudioReviewCacheFromSettings()}
            disabled={settingsLoading || settingsSaving || !audioReviewCacheUsage}
          >
            <Trash2 size={15} />
            <span>{tSettings("storage.clear")}</span>
          </button>
        </div>
      </section>
    );
  }

  function renderUpdatesSection() {
    return (
      <section id="settings-updates" className="sheet-form-section update-settings-section">
        <div className="form-section-heading">
          <h3>{tUpdates("section.heading")}</h3>
          <p>{tUpdates("section.description")}</p>
        </div>
        <div className={`update-status-card ${updateState.status}`}>
          <div>
            <span className={`model-status-badge ${updateState.status === "failed" ? "missing" : "ready"}`}>
              {inAppUpdates
                ? tUpdates(`status.${updateState.status}`)
                : tUpdates("section.manualStatus")}
            </span>
            {currentVersion ? (
              <small data-current-version={currentVersion}>
                {tUpdates("section.currentVersion", { version: currentVersion })}
              </small>
            ) : null}
            <strong>
              {updateState.availableVersion
                ? tUpdates("section.versionLabel", { version: updateState.availableVersion })
                : tUpdates("section.stableVersion")}
            </strong>
            <small>
              {inAppUpdates
                ? renderedUpdateMessage || tUpdates("section.defaultMessage")
                : tUpdates("section.manualMessage")}
            </small>
            {updateState.notes ? <small>{updateState.notes}</small> : null}
            {updateInstallBlocked && updateState.status === "available" ? (
              <small>{tUpdates("section.installBlocked")}</small>
            ) : null}
          </div>
          {updateState.status === "downloading" || updateState.status === "installing" ? (
            <div
              className="update-progress"
              role="progressbar"
              aria-label={tUpdates("section.downloadProgressAria")}
              aria-valuenow={updateProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="progress-track">
                <span
                  className="progress-fill video_transcribing"
                  style={{ width: `${updateProgress}%` }}
                />
              </div>
              <small>{formatProgressPercent(updateState.progress)}</small>
            </div>
          ) : null}
        </div>
        <div className="update-actions">
          {inAppUpdates ? (
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void onCheckForUpdates({ silent: false })}
                disabled={updateBusy}
              >
                <RotateCcw size={15} />
                <span>
                  {updateState.status === "checking"
                    ? tUpdates("action.checking")
                    : tUpdates("action.check")}
                </span>
              </button>
              {updateState.status === "ready_to_restart" ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void onRestartForUpdate()}
                >
                  <RotateCcw size={15} />
                  <span>{tUpdates("action.restart")}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void onInstallUpdate()}
                  disabled={
                    updateBusy ||
                    updateInstallBlocked ||
                    !INSTALLABLE_UPDATE_STATUSES.has(updateState.status)
                  }
                >
                  <Download size={15} />
                  <span>{tUpdates("action.install")}</span>
                </button>
              )}
              {INSTALLABLE_UPDATE_STATUSES.has(updateState.status) ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void onPostponeUpdateReminder()}
                  disabled={updateBusy}
                >
                  <span>{tUpdates("action.postpone")}</span>
                </button>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={() => void onOpenReleases()}
            >
              <Download size={15} />
              <span>{tUpdates("action.releases")}</span>
            </button>
          )}
        </div>
      </section>
    );
  }

  function renderAdvancedSection() {
    return (
      <section id="settings-advanced" className="sheet-form-section settings-config-file-section">
        <div className="form-section-heading">
          <h3>{tSettings("advanced.heading")}</h3>
          <p>{tSettings("advanced.description")}</p>
        </div>
        <div className="config-file-row">
          <code title={settingsConfigPath}>
            {settingsConfigPath || tSettings("advanced.pathPending")}
          </code>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void locateSettingsConfigFile()}
            disabled={settingsLoading || !settingsConfigPath}
          >
            <FolderOpen size={15} />
            <span>{tSettings("advanced.locate")}</span>
          </button>
        </div>
        <div className="settings-status-card diagnostics-export-card">
          <div>
            <span className="section-label">{tSettings("advanced.diagnostics.eyebrow")}</span>
            <strong>{tSettings("advanced.diagnostics.heading")}</strong>
            <p>{tSettings("advanced.diagnostics.description")}</p>
            <small>{tSettings("advanced.diagnostics.privacy")}</small>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void exportDiagnostics()}
            disabled={diagnosticExportBusy}
            aria-busy={diagnosticExportBusy}
          >
            <Download size={15} />
            <span>
              {diagnosticExportBusy
                ? tSettings("advanced.diagnostics.exporting")
                : tSettings("advanced.diagnostics.action")}
            </span>
          </button>
          {renderedDiagnosticExportNotice ? (
            <StatusLine className="action-notice inline-notice">
              {renderedDiagnosticExportNotice}
            </StatusLine>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <AnimatedSheet
      open={settingsOpen}
      ariaLabel={tSettings("sheet.ariaLabel")}
      className="settings-modal settings-sheet"
      onBackdropClick={closeSettings}
    >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">{tCommon("appName")}</p>
            <h2>{tSettings("sheet.title")}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={closeSettings}
            aria-label={tSettings("sheet.closeAria")}
          >
            <X size={18} />
          </button>
        </header>
        <form id="settings-form" className="settings-form" onSubmit={submitSettings}>
          <div className="settings-layout" data-active-settings-category={settingsCategory}>
            <nav className="settings-nav" aria-label={tSettings("navigation.ariaLabel")}>
              {localizedSettingsNavItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`settings-nav-item ${settingsCategory === item.id ? "selected" : ""}`}
                  onClick={() => setSettingsCategory(item.id)}
                  aria-current={settingsCategory === item.id ? "page" : undefined}
                  data-settings-category={item.id}
                >
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </button>
              ))}
            </nav>

            <div className="settings-sections">
              {settingsCategory === "basic" ? renderBasicSection() : null}
              {settingsCategory === "inspiration" ? renderInspirationSection() : null}
              {settingsCategory === "storage" ? renderStorageSection() : null}
              {settingsCategory === "updates" ? renderUpdatesSection() : null}
              {settingsCategory === "advanced" ? renderAdvancedSection() : null}
              {renderedSettingsNotice ? (
                <StatusLine className="action-notice inline-notice">
                  {renderedSettingsNotice}
                </StatusLine>
              ) : null}
            </div>
          </div>
        </form>
        <div className="settings-actions sheet-footer">
          <button type="button" className="secondary-button" onClick={closeSettings}>
            <span>{tSettings("footer.close")}</span>
          </button>
          <button
            className="primary-button"
            type="submit"
            form="settings-form"
            disabled={settingsLoading || settingsSaving}
          >
            <span>
              {settingsSaving ? tSettings("footer.saving") : tSettings("footer.save")}
            </span>
          </button>
        </div>
    </AnimatedSheet>
  );
}
