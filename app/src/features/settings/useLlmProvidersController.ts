import { useCallback, useState } from "react";
import {
  llmProbeMessage,
  uiMessage,
  type UiMessage,
} from "../../i18n/uiMessage";
import {
  deleteLlmProvider,
  getLlmProviders,
  saveLlmProvider,
  setActiveLlmProvider,
  setLlmSource,
  testLlmConnection,
  type LlmProbeResult,
  type LlmProviderDraft,
  type LlmProviderView,
  type LlmProvidersState,
  type LlmSource,
} from "../../settingsClient";

const EMPTY_STATE: LlmProvidersState = {
  source: "managed",
  activeId: null,
  providers: [],
};

function emptyDraft(): LlmProviderDraft {
  return {
    label: "",
    provider: "openai_compatible",
    baseUrl: "",
    model: "",
    timeoutSeconds: 60,
    apiKey: null,
  };
}

export function useLlmProvidersController() {
  const [state, setState] = useState<LlmProvidersState>(EMPTY_STATE);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(false);
  const [notice, setNotice] = useState<UiMessage | null>(null);
  const [error, setError] = useState<UiMessage | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<LlmProviderDraft | null>(null);
  const [probe, setProbe] = useState<LlmProbeResult | null>(null);

  const loadLlmProviders = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await getLlmProviders());
    } catch {
      setError(uiMessage("settings.models.notice.loadFailed"));
    } finally {
      setBusy(false);
    }
  }, []);

  const startAdd = useCallback(() => {
    setError(null);
    setProbe(null);
    setDraft(emptyDraft());
    setDialogOpen(true);
  }, []);

  const startEdit = useCallback((view: LlmProviderView) => {
    setError(null);
    setProbe(null);
    setDraft({
      id: view.id,
      label: view.label,
      provider: view.provider,
      baseUrl: view.baseUrl,
      model: view.model,
      timeoutSeconds: view.timeoutSeconds,
      apiKey: null,
    });
    setDialogOpen(true);
  }, []);

  const updateDraft = useCallback(
    (field: keyof LlmProviderDraft, value: string | number | null) => {
      setDraft((current) =>
        current ? { ...current, [field]: value } : current,
      );
    },
    [],
  );

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setDraft(null);
    setProbe(null);
    setError(null);
  }, []);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      setState(await saveLlmProvider(draft));
      setDraft(null);
      setProbe(null);
      setDialogOpen(false);
      setNotice(uiMessage("settings.models.notice.saved"));
    } catch {
      setError(uiMessage("settings.models.notice.saveFailed"));
    } finally {
      setBusy(false);
    }
  }, [draft]);

  const removeProvider = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setState(await deleteLlmProvider(id));
    } catch {
      setError(uiMessage("settings.models.notice.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }, []);

  const activateProvider = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setState(await setActiveLlmProvider(id));
    } catch {
      setError(uiMessage("settings.models.notice.activateFailed"));
    } finally {
      setBusy(false);
    }
  }, []);

  const changeSource = useCallback(async (source: LlmSource) => {
    setBusy(true);
    setError(null);
    try {
      setState(await setLlmSource(source));
    } catch {
      setError(uiMessage("settings.models.notice.sourceFailed"));
    } finally {
      setBusy(false);
    }
  }, []);

  const probeConnection = useCallback(async () => {
    if (!draft) return;
    setProbing(true);
    setError(null);
    try {
      const result = await testLlmConnection(draft);
      setProbe(result);
      setError(result.ok ? null : llmProbeMessage(result.errorCode));
    } catch {
      setError(uiMessage("settings.models.notice.probeFailed"));
    } finally {
      setProbing(false);
    }
  }, [draft]);

  const resetError = useCallback(() => setError(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  return {
    source: state.source,
    activeId: state.activeId,
    providers: state.providers,
    busy,
    probing,
    notice,
    error,
    dialogOpen,
    draft,
    probe,
    loadLlmProviders,
    startAdd,
    startEdit,
    updateDraft,
    closeDialog,
    saveDraft,
    removeProvider,
    activateProvider,
    changeSource,
    probeConnection,
    resetError,
    clearNotice,
  };
}

export type LlmProvidersController = ReturnType<
  typeof useLlmProvidersController
>;
