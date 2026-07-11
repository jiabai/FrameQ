import { type Dispatch, type SetStateAction, useCallback, useState } from "react";

import {
  canGenerateAiWithAccount,
  type AccountStatus,
} from "../../accountState";
import {
  buildPreferenceSnapshot,
  type GenerationPreferences,
  type InspirationProfile,
  type PreferenceSnapshot,
} from "../../insightPreferences";
import {
  createInsightPreferenceFlow,
  skipProfileSetupInFlow,
  startGenerationPreferenceEditing,
  startProfileSetupInFlow,
  type InsightPreferenceFlowState,
} from "../../insightPreferenceFlow";
import {
  getInsightPreferences,
  saveDefaultGenerationPreferences,
  saveInspirationProfile,
  skipInspirationProfile,
} from "../../insightPreferencesClient";
import type { InsightRetryTarget, WorkflowState } from "../../workflow";

type OpenAccountPanel = (notice?: string) => void;
type RetryInsightGeneration = (
  target: InsightRetryTarget,
  preferenceSnapshot: PreferenceSnapshot | null,
  account: AccountStatus,
  openAccountPanel: OpenAccountPanel,
  onRetryCompleted?: () => void,
) => Promise<void>;

type UseInsightGenerationControllerOptions = {
  workflow: WorkflowState;
  account: AccountStatus;
  setActionNotice: Dispatch<SetStateAction<string>>;
  closeSettings: () => void;
  closeDetail: () => void;
  openAccountPanel: OpenAccountPanel;
  refreshAccountStatus: () => Promise<void>;
  retryInsightGeneration: RetryInsightGeneration;
  aiBlockerMessage: (account: AccountStatus, actionLabel: string) => string;
};

export function useInsightGenerationController({
  workflow,
  account,
  setActionNotice,
  closeSettings,
  closeDetail,
  openAccountPanel,
  refreshAccountStatus,
  retryInsightGeneration,
  aiBlockerMessage,
}: UseInsightGenerationControllerOptions) {
  const [summaryConfirmOpen, setSummaryConfirmOpen] = useState(false);
  const [insightPreferenceFlow, setInsightPreferenceFlow] =
    useState<InsightPreferenceFlowState | null>(null);
  const [insightPreferenceBusy, setInsightPreferenceBusy] = useState(false);
  const [aiActionNotice, setAiActionNotice] = useState("");
  const reportAiNotice = useCallback(
    (notice: string) => {
      setAiActionNotice(notice);
      setActionNotice(notice);
    },
    [setActionNotice],
  );

  const closeSummaryConfirmation = useCallback(() => {
    setSummaryConfirmOpen(false);
  }, []);

  const closeInsightPreferenceFlow = useCallback(() => {
    setInsightPreferenceFlow(null);
  }, []);

  const resetInsightGenerationUi = useCallback(() => {
    setSummaryConfirmOpen(false);
    setInsightPreferenceFlow(null);
    reportAiNotice("");
  }, [reportAiNotice]);

  const openInsightPreferenceFlow = useCallback(async () => {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt) {
      reportAiNotice("文字稿生成后才能继续生成启发灵感。");
      return;
    }

    setInsightPreferenceBusy(true);
    reportAiNotice("");
    try {
      const preferences = await getInsightPreferences();
      setInsightPreferenceFlow(createInsightPreferenceFlow(preferences));
    } catch (error) {
      reportAiNotice(`无法读取本地偏好：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInsightPreferenceBusy(false);
    }
  }, [reportAiNotice, workflow.artifacts.transcript_txt, workflow.taskId]);

  const openSummaryConfirmation = useCallback(() => {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt) {
      reportAiNotice("文字稿生成后才能继续生成要点总结。");
      return;
    }

    reportAiNotice("");
    setSummaryConfirmOpen(true);
  }, [reportAiNotice, workflow.artifacts.transcript_txt, workflow.taskId]);

  const confirmSummaryGeneration = useCallback(async () => {
    if (!canGenerateAiWithAccount(account)) {
      openAccountPanel(aiBlockerMessage(account, "生成要点总结"));
      return;
    }

    setSummaryConfirmOpen(false);
    try {
      await retryInsightGeneration("summary", null, account, openAccountPanel, refreshAccountStatus);
    } catch (error) {
      reportAiNotice(`启动要点总结失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [
    account,
    aiBlockerMessage,
    openAccountPanel,
    refreshAccountStatus,
    retryInsightGeneration,
    reportAiNotice,
  ]);

  const openProfileEditorFromSettings = useCallback(async () => {
    closeSettings();
    setInsightPreferenceBusy(true);
    reportAiNotice("");
    try {
      const preferences = await getInsightPreferences();
      setInsightPreferenceFlow(startProfileSetupInFlow(createInsightPreferenceFlow(preferences)));
    } catch (error) {
      reportAiNotice(`无法读取本地偏好：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInsightPreferenceBusy(false);
    }
  }, [closeSettings, reportAiNotice]);

  const openDirectionEditorFromDetail = useCallback(async () => {
    if (!workflow.taskId || !workflow.artifacts.transcript_txt) {
      reportAiNotice("文字稿生成后才能重新选择方向。");
      return;
    }

    closeDetail();
    setInsightPreferenceBusy(true);
    reportAiNotice("");
    try {
      const preferences = await getInsightPreferences();
      setInsightPreferenceFlow(startGenerationPreferenceEditing(createInsightPreferenceFlow(preferences)));
    } catch (error) {
      reportAiNotice(`无法读取本地偏好：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInsightPreferenceBusy(false);
    }
  }, [closeDetail, reportAiNotice, workflow.artifacts.transcript_txt, workflow.taskId]);

  const skipCurrentProfileSetup = useCallback(async () => {
    if (!insightPreferenceFlow) {
      return;
    }
    setInsightPreferenceBusy(true);
    try {
      await skipInspirationProfile();
      setInsightPreferenceFlow(skipProfileSetupInFlow(insightPreferenceFlow));
    } catch (error) {
      reportAiNotice(`保存跳过状态失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInsightPreferenceBusy(false);
    }
  }, [insightPreferenceFlow, reportAiNotice]);

  const saveCurrentProfile = useCallback(
    async (profile: InspirationProfile) => {
      setInsightPreferenceBusy(true);
      try {
        const preferences = await saveInspirationProfile(profile);
        setInsightPreferenceFlow(startGenerationPreferenceEditing(createInsightPreferenceFlow(preferences)));
      } catch (error) {
        reportAiNotice(`保存灵感档案失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setInsightPreferenceBusy(false);
      }
    },
    [reportAiNotice],
  );

  const confirmInsightPreferences = useCallback(
    async (preferences: GenerationPreferences) => {
      if (!canGenerateAiWithAccount(account)) {
        openAccountPanel(aiBlockerMessage(account, "生成启发灵感"));
        return;
      }

      setInsightPreferenceBusy(true);
      try {
        const preferenceSnapshot = insightPreferenceFlow
          ? buildPreferenceSnapshot({
              profile: insightPreferenceFlow.profile,
              profileSkipped: insightPreferenceFlow.profileSkipped,
              generationPreferences: preferences,
            })
          : null;
        await saveDefaultGenerationPreferences(preferences);
        setInsightPreferenceFlow(null);
        await retryInsightGeneration(
          "insights",
          preferenceSnapshot,
          account,
          openAccountPanel,
          refreshAccountStatus,
        );
      } catch (error) {
        reportAiNotice(`启动启发灵感失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setInsightPreferenceBusy(false);
      }
    },
    [
      account,
      aiBlockerMessage,
      insightPreferenceFlow,
      openAccountPanel,
      refreshAccountStatus,
      retryInsightGeneration,
      reportAiNotice,
    ],
  );

  return {
    aiActionNotice,
    summaryConfirmOpen,
    insightPreferenceFlow,
    insightPreferenceBusy,
    setInsightPreferenceFlow,
    closeSummaryConfirmation,
    closeInsightPreferenceFlow,
    resetInsightGenerationUi,
    openInsightPreferenceFlow,
    openSummaryConfirmation,
    confirmSummaryGeneration,
    openProfileEditorFromSettings,
    openDirectionEditorFromDetail,
    skipCurrentProfileSetup,
    saveCurrentProfile,
    confirmInsightPreferences,
  };
}

export type InsightGenerationController = ReturnType<typeof useInsightGenerationController>;
