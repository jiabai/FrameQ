import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useState,
} from "react";

import { canGenerateAiWithAccount, type AccountStatus } from "../../accountState";
import type { SupportedLocale } from "../../i18n/locale";
import { uiMessage, type UiMessage } from "../../i18n/uiMessage";
import type { WorkflowState } from "../../workflow";
import type { RetryInsightsInput } from "../../workerClient";
import { retryInsights } from "../../workerClient";

type PolishTranscriptRunner = (
  input: RetryInsightsInput,
) => ReturnType<typeof retryInsights>;

type UseTranscriptPolishControllerOptions = {
  workflow: WorkflowState;
  outputLanguage: SupportedLocale;
  account: AccountStatus;
  openAccountPanel: (message: UiMessage) => void;
  aiBlockerMessage: (account: AccountStatus) => UiMessage;
  setActionNotice: Dispatch<SetStateAction<UiMessage | null>>;
  refreshPolishedTranscript: () => Promise<void>;
  onPolishCompleted?: () => void;
  polishRunner?: PolishTranscriptRunner;
};

const defaultPolishRunner: PolishTranscriptRunner = (input) =>
  retryInsights(input);

/**
 * State machine for the "Polish Transcript" toolbar button.
 *
 * Polishing reuses the retry_insights `transcript` target (the only channel
 * allowed to consume cloud LLM quota). The output is a separate artifact; the
 * ASR original is never modified. After success the detail view is refreshed
 * so the button flips to "Copy Transcript".
 */
export function useTranscriptPolishController({
  workflow,
  outputLanguage,
  account,
  openAccountPanel,
  aiBlockerMessage,
  setActionNotice,
  refreshPolishedTranscript,
  onPolishCompleted,
  polishRunner = defaultPolishRunner,
}: UseTranscriptPolishControllerOptions) {
  const [polishingTranscript, setPolishingTranscript] = useState(false);

  const polishTranscript = useCallback(async () => {
    if (
      !workflow.taskId ||
      !workflow.artifacts.transcript_txt ||
      polishingTranscript
    ) {
      return;
    }
    if (!canGenerateAiWithAccount(account)) {
      openAccountPanel(aiBlockerMessage(account));
      return;
    }

    const taskId = workflow.taskId;
    setPolishingTranscript(true);
    setActionNotice(null);
    try {
      const result = await polishRunner({
        taskId,
        target: "transcript",
        outputLanguage,
      });
      if (result.error) {
        setActionNotice(
          result.error.code
            ? uiMessage("transcript.notice.polishFailed", {
                code: result.error.code,
              })
            : uiMessage("transcript.notice.polishFailedNoCode"),
        );
        return;
      }
      await refreshPolishedTranscript();
      setActionNotice(uiMessage("transcript.notice.polishedReady"));
      onPolishCompleted?.();
    } catch {
      setActionNotice(uiMessage("transcript.notice.polishFailedNoCode"));
    } finally {
      setPolishingTranscript(false);
    }
  }, [
    account,
    aiBlockerMessage,
    onPolishCompleted,
    openAccountPanel,
    outputLanguage,
    polishRunner,
    polishingTranscript,
    refreshPolishedTranscript,
    setActionNotice,
    workflow.artifacts.transcript_txt,
    workflow.taskId,
  ]);

  return { polishingTranscript, polishTranscript };
}
