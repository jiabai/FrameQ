import { useTranslation } from "react-i18next";

import { AnimatedSheet } from "../modal/AnimatedSheet";
import { StatusLine } from "../common/StatusLine";
import { renderUiMessage, llmProbeMessage } from "../../i18n/uiMessage";
import type { SupportedLocale } from "../../i18n/locale";
import type { LlmProviderDraft } from "../../settingsClient";
import type { LlmProvidersController } from "./useLlmProvidersController";
import {
  CUSTOM_LLM_PROVIDER_PRESET_ID,
  LLM_PROVIDER_PRESETS,
  findLlmProviderPreset,
  presetIdForBaseUrl,
} from "./llmProviderPresets";

type LlmProviderSheetProps = {
  controller: LlmProvidersController;
  locale: SupportedLocale;
};

const EMPTY_DRAFT: LlmProviderDraft = {
  label: "",
  provider: "openai_compatible",
  baseUrl: "",
  model: "",
  timeoutSeconds: 60,
  apiKey: null,
};

export function LlmProviderSheet({
  controller,
  locale,
}: LlmProviderSheetProps) {
  const { t } = useTranslation("settings");
  const draft = controller.draft ?? EMPTY_DRAFT;
  const isEditing = draft.id !== undefined;
  const titleKey = isEditing
    ? "models.dialog.titleEdit"
    : "models.dialog.titleAdd";
  const hasStoredKey = isEditing
    ? controller.providers.some(
        (provider) => provider.id === draft.id && provider.hasKey,
      )
    : false;
  const presetId = presetIdForBaseUrl(draft.baseUrl);
  const preset = findLlmProviderPreset(presetId);
  const candidateModels = preset ? [...preset.models] : [];
  if (draft.model && !candidateModels.includes(draft.model)) {
    candidateModels.unshift(draft.model);
  }

  const applyPreset = (id: string) => {
    const selected = findLlmProviderPreset(id);
    if (!selected || selected.id === CUSTOM_LLM_PROVIDER_PRESET_ID) return;
    controller.updateDraft("provider", selected.provider);
    controller.updateDraft("baseUrl", selected.baseUrl);
    controller.updateDraft("model", selected.models[0] ?? "");
  };

  return (
    <AnimatedSheet
      open={controller.dialogOpen}
      ariaLabel={t(titleKey)}
      className="settings-modal settings-sheet"
      onBackdropClick={() => controller.closeDialog()}
    >
      <header className="modal-header sheet-header">
        <h2>{t(titleKey)}</h2>
      </header>
      <div className="modal-content sheet-body">
        <section className="sheet-form-section">
          <label className="field-row">
            <span>{t("models.dialog.provider")}</span>
            <select
              value={presetId}
              onChange={(event) => applyPreset(event.currentTarget.value)}
            >
              {LLM_PROVIDER_PRESETS.map((option) => (
                <option value={option.id} key={option.id}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-row">
            <span>{t("models.dialog.label")}</span>
            <input
              type="text"
              value={draft.label}
              onChange={(event) =>
                controller.updateDraft("label", event.currentTarget.value)
              }
            />
          </label>
          <label className="field-row">
            <span>{t("models.dialog.baseUrl")}</span>
            <input
              type="text"
              value={draft.baseUrl}
              onChange={(event) =>
                controller.updateDraft("baseUrl", event.currentTarget.value)
              }
            />
          </label>
          <label className="field-row">
            <span>{t("models.dialog.apiKey")}</span>
            <input
              type="password"
              autoComplete="off"
              value={draft.apiKey ?? ""}
              placeholder={
                hasStoredKey
                  ? t("models.dialog.apiKeyPlaceholderEdit")
                  : t("models.dialog.apiKeyPlaceholderNew")
              }
              onChange={(event) =>
                controller.updateDraft(
                  "apiKey",
                  event.currentTarget.value || null,
                )
              }
            />
          </label>
          <label className="field-row">
            <span>{t("models.dialog.model")}</span>
            <input
              type="text"
              list="llm-provider-model-candidates"
              value={draft.model}
              onChange={(event) =>
                controller.updateDraft("model", event.currentTarget.value)
              }
            />
            <datalist id="llm-provider-model-candidates">
              {candidateModels.map((model) => (
                <option value={model} key={model} />
              ))}
            </datalist>
          </label>
          <label className="field-row">
            <span>{t("models.dialog.timeout")}</span>
            <input
              type="number"
              min={1}
              value={draft.timeoutSeconds}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                controller.updateDraft(
                  "timeoutSeconds",
                  Number.isFinite(next) && next > 0 ? next : 60,
                );
              }}
            />
          </label>
        </section>
        <div className="settings-status-card">
          <button
            type="button"
            className="secondary-button"
            data-llm-test
            disabled={controller.probing || controller.busy}
            onClick={() => void controller.probeConnection()}
          >
            {controller.probing
              ? t("models.dialog.testing")
              : t("models.dialog.test")}
          </button>
          <small>{t("models.dialog.probeNotice")}</small>
          {controller.probe ? (
            controller.probe.ok ? (
              <StatusLine className="action-notice inline-notice">
                {t("models.dialog.probeSuccess", {
                  latency: controller.probe.latencyMs,
                })}
              </StatusLine>
            ) : (
              <StatusLine className="action-notice inline-notice">
                {t("models.dialog.probeFailure", {
                  reason: renderUiMessage(
                    locale,
                    llmProbeMessage(controller.probe.errorCode),
                  ),
                })}
              </StatusLine>
            )
          ) : null}
        </div>
      </div>
      <footer className="settings-actions sheet-footer">
        <button
          type="button"
          className="secondary-button"
          data-llm-cancel
          onClick={() => controller.closeDialog()}
        >
          {t("models.dialog.cancel")}
        </button>
        <button
          type="button"
          className="primary-button"
          data-llm-save
          disabled={controller.busy}
          onClick={() => void controller.saveDraft()}
        >
          {t("models.dialog.save")}
        </button>
      </footer>
    </AnimatedSheet>
  );
}
