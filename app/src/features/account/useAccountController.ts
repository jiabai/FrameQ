import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  ActivationCodeRequestError,
  beginAuthFlow,
  completeAuthFlow,
  getAccountStatus,
  logoutAccount,
  redeemActivationCode,
  requestActivationCode,
} from "../../accountClient";
import {
  canProcessWithAccount,
  canRequestActivationCodeWithAccount,
  createAccountStatusFailure,
  createBrowserPreviewAccountStatus,
  createGuestAccountStatus,
  isBrowserPreviewRuntime,
  type AccountStatus,
} from "../../accountState";
import { formatDateTime } from "../../i18n/formatters";
import { useLocale } from "../../i18n/LocaleProvider";
import type { SupportedLocale } from "../../i18n/locale";
import { renderUiMessage, uiMessage, type UiMessage } from "../../i18n/uiMessage";

type UseAccountControllerOptions = {
  onSignedOut: () => void;
};

export const ACCOUNT_STATUS_UNAVAILABLE_CODE = "ACCOUNT_STATUS_UNAVAILABLE";

export type AccountNotice = UiMessage | null;
export type ActivationCodeRequestStatus = "idle" | "pending" | "success" | "error";
export type ActivationCodeRequestState = Readonly<{
  status: ActivationCodeRequestStatus;
  retryAt: string | null;
  error: ActivationCodeRequestError | null;
}>;

const IDLE_ACTIVATION_CODE_REQUEST_STATE: ActivationCodeRequestState = {
  status: "idle",
  retryAt: null,
  error: null,
};

function sanitizeAccountStatus(status: AccountStatus): AccountStatus {
  return status.serverError
    ? { ...status, serverError: ACCOUNT_STATUS_UNAVAILABLE_CODE }
    : status;
}

function formatAccountDate(
  value: string | null,
  locale: SupportedLocale,
): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : formatDateTime(date, locale);
}

function getAccountChipMessage(account: AccountStatus): UiMessage {
  const hasActiveEntitlement =
    account.authenticated && account.entitlementStatus === "active";
  if (canProcessWithAccount(account)) {
    return uiMessage("account.chip.authorized");
  }
  if (!account.authenticated) {
    return uiMessage("account.chip.signIn");
  }
  if (!hasActiveEntitlement) {
    return uiMessage("account.chip.activationRequired");
  }
  return uiMessage(
    account.llmConfigured
      ? "account.chip.quotaInsufficient"
      : "account.chip.configurationPending",
  );
}

function getAccountStatusMessage(
  account: AccountStatus,
  locale: SupportedLocale,
): UiMessage {
  const hasActiveEntitlement =
    account.authenticated && account.entitlementStatus === "active";
  if (canProcessWithAccount(account)) {
    const expiresAt = formatAccountDate(account.entitlementExpiresAt, locale);
    return expiresAt
      ? uiMessage("account.status.authorizationActiveUntil", { date: expiresAt })
      : uiMessage("account.status.authorizationActive");
  }
  if (!account.authenticated) {
    return uiMessage("account.status.signedOut");
  }
  if (!hasActiveEntitlement) {
    return uiMessage("account.status.notActivated");
  }
  return uiMessage(
    account.llmConfigured
      ? "account.status.quotaInsufficient"
      : "account.status.configurationPending",
  );
}

function mapActivationCodeRequestErrorToNotice(
  error: ActivationCodeRequestError,
): UiMessage {
  switch (error.errorCode) {
    case "AUTH_REQUIRED":
      return uiMessage("account.notice.activationCodeAuthRequired");
    case "FEATURE_NOT_AVAILABLE":
      return uiMessage("account.notice.activationCodeFeatureUnavailable");
    case "ENTITLEMENT_ACTIVE":
      return uiMessage("account.notice.activationCodeAlreadyActive");
    case "ACTIVATION_REQUEST_RATE_LIMITED":
      return uiMessage("account.notice.activationCodeRateLimited");
    case "ACTIVATION_EMAIL_UNAVAILABLE":
      return uiMessage("account.notice.activationCodeEmailUnavailable");
    default:
      return uiMessage("account.notice.activationCodeServerUnavailable");
  }
}

function normalizeRetryAt(retryAt: string | null): string | null {
  if (!retryAt) {
    return null;
  }
  const timestamp = new Date(retryAt).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now() ? retryAt : null;
}

export function useAccountController({
  onSignedOut,
}: UseAccountControllerOptions) {
  const { resolvedLocale } = useLocale();
  const [account, setAccount] = useState<AccountStatus>(createGuestAccountStatus);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountNotice, setAccountNotice] = useState<AccountNotice>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [activationCodeDraft, setActivationCodeDraft] = useState("");
  const [activationRedeeming, setActivationRedeeming] = useState(false);
  const [activationCodeRequest, setActivationCodeRequest] = useState<ActivationCodeRequestState>(
    IDLE_ACTIVATION_CODE_REQUEST_STATE,
  );
  const refreshRequestIdRef = useRef(0);
  const activeOperationIdRef = useRef(0);
  const activeOperationPendingRef = useRef<number | null>(null);
  const activationCodeRequestVersionRef = useRef(0);
  const activationCodeRequestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearActivationCodeRequestTimeout = useCallback(() => {
    if (activationCodeRequestTimeoutRef.current !== null) {
      clearTimeout(activationCodeRequestTimeoutRef.current);
      activationCodeRequestTimeoutRef.current = null;
    }
  }, []);

  const commitActivationCodeRequestState = useCallback(
    (nextState: ActivationCodeRequestState) => {
      const normalizedRetryAt = normalizeRetryAt(nextState.retryAt);
      const committedState =
        nextState.status === "idle"
          ? IDLE_ACTIVATION_CODE_REQUEST_STATE
          : {
              ...nextState,
              retryAt: normalizedRetryAt,
            };
      activationCodeRequestVersionRef.current += 1;
      const version = activationCodeRequestVersionRef.current;
      clearActivationCodeRequestTimeout();
      setActivationCodeRequest(committedState);

      if (!normalizedRetryAt) {
        return;
      }

      const delay = new Date(normalizedRetryAt).getTime() - Date.now();
      if (delay <= 0) {
        activationCodeRequestVersionRef.current += 1;
        setActivationCodeRequest(IDLE_ACTIVATION_CODE_REQUEST_STATE);
        return;
      }

      activationCodeRequestTimeoutRef.current = setTimeout(() => {
        if (activationCodeRequestVersionRef.current !== version) {
          return;
        }
        activationCodeRequestTimeoutRef.current = null;
        activationCodeRequestVersionRef.current += 1;
        setActivationCodeRequest(IDLE_ACTIVATION_CODE_REQUEST_STATE);
      }, delay);
    },
    [clearActivationCodeRequestTimeout],
  );

  const beginActiveOperation = useCallback(() => {
    const operationId = activeOperationIdRef.current + 1;
    activeOperationIdRef.current = operationId;
    activeOperationPendingRef.current = operationId;
    refreshRequestIdRef.current += 1;
    return operationId;
  }, []);

  const finishActiveOperation = useCallback((operationId: number) => {
    if (activeOperationPendingRef.current !== operationId) {
      return false;
    }
    activeOperationPendingRef.current = null;
    return true;
  }, []);

  useEffect(
    () => () => {
      clearActivationCodeRequestTimeout();
    },
    [clearActivationCodeRequestTimeout],
  );

  const runAccountStatusRefresh = useCallback(async (
    activeOperationId: number | null,
  ) => {
    if (
      activeOperationId === null
        ? activeOperationPendingRef.current !== null
        : activeOperationPendingRef.current !== activeOperationId
    ) {
      return;
    }

    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    const canCommit = () =>
      refreshRequestIdRef.current === requestId &&
      (activeOperationId === null
        ? activeOperationPendingRef.current === null
        : activeOperationPendingRef.current === activeOperationId);

    setAccountLoading(true);
    try {
      const status = await getAccountStatus();
      if (!canCommit()) {
        return;
      }
      setAccount(sanitizeAccountStatus(status));
      setAccountNotice(
        status.serverError
          ? uiMessage("account.notice.statusRefreshFailed")
          : null,
      );
    } catch {
      if (!canCommit()) {
        return;
      }
      if (isBrowserPreviewRuntime()) {
        setAccount({
          ...createBrowserPreviewAccountStatus(),
          serverError: null,
        });
        setAccountNotice(uiMessage("account.notice.browserPreview"));
        return;
      }

      setAccount(
        createAccountStatusFailure(ACCOUNT_STATUS_UNAVAILABLE_CODE),
      );
      setAccountNotice(uiMessage("account.notice.statusRefreshFailed"));
    } finally {
      if (canCommit()) {
        setAccountLoading(false);
      }
    }
  }, []);

  const refreshAccountStatus = useCallback(
    () => runAccountStatusRefresh(null),
    [runAccountStatusRefresh],
  );

  const handleAuthCallback = useCallback(
    async (callbackUrl: string) => {
      if (!callbackUrl.startsWith("frameq://auth/callback")) {
        return;
      }
      const operationId = beginActiveOperation();
      setActivationRedeeming(false);
      setAccountOpen(true);
      setAccountLoading(true);
      setAccountNotice(uiMessage("account.notice.loginCompleting"));
      try {
        await completeAuthFlow(callbackUrl);
        if (activeOperationPendingRef.current === operationId) {
          await runAccountStatusRefresh(operationId);
        }
        if (activeOperationPendingRef.current === operationId) {
          setAccountNotice(uiMessage("account.notice.loginComplete"));
        }
      } catch {
        if (activeOperationPendingRef.current === operationId) {
          setAccountNotice(uiMessage("account.notice.loginFailed"));
        }
      } finally {
        if (finishActiveOperation(operationId)) {
          setAccountLoading(false);
        }
      }
    },
    [beginActiveOperation, finishActiveOperation, runAccountStatusRefresh],
  );

  const openAccountPanel = useCallback(
    (notice?: UiMessage) => {
      setAccountOpen(true);
      setAccountNotice(notice ?? null);
      void refreshAccountStatus();
    },
    [refreshAccountStatus],
  );

  const closeAccountPanel = useCallback(() => {
    setAccountOpen(false);
  }, []);

  const startLoginFlow = useCallback(async () => {
    const operationId = beginActiveOperation();
    setActivationRedeeming(false);
    setAccountLoading(true);
    setAccountNotice(uiMessage("account.notice.loginOpening"));
    try {
      const auth = await beginAuthFlow();
      await openUrl(auth.authUrl);
      if (activeOperationPendingRef.current === operationId) {
        setAccountNotice(uiMessage("account.notice.loginOpened"));
      }
    } catch {
      if (activeOperationPendingRef.current === operationId) {
        setAccountNotice(uiMessage("account.notice.loginStartFailed"));
      }
    } finally {
      if (finishActiveOperation(operationId)) {
        setAccountLoading(false);
      }
    }
  }, [beginActiveOperation, finishActiveOperation]);

  const redeemActivationCodeFromInput = useCallback(async () => {
    const code = activationCodeDraft.trim();
    if (!code) {
      setAccountNotice(uiMessage("account.notice.activationRequired"));
      return;
    }
    const operationId = beginActiveOperation();
    setAccountLoading(false);
    setActivationRedeeming(true);
    setAccountNotice(null);
    try {
      const status = await redeemActivationCode(code);
      if (activeOperationPendingRef.current === operationId) {
        setAccount(sanitizeAccountStatus(status));
        setActivationCodeDraft("");
        setAccountNotice(uiMessage("account.notice.activationSuccess"));
      }
    } catch {
      if (activeOperationPendingRef.current === operationId) {
        setAccountNotice(uiMessage("account.notice.activationFailed"));
      }
    } finally {
      if (finishActiveOperation(operationId)) {
        setActivationRedeeming(false);
      }
    }
  }, [activationCodeDraft, beginActiveOperation, finishActiveOperation]);

  const requestActivationCodeByEmail = useCallback(async () => {
    if (
      activationCodeRequest.status === "pending" ||
      !canRequestActivationCodeWithAccount(account)
    ) {
      return;
    }
    const operationId = beginActiveOperation();
    setActivationRedeeming(false);
    commitActivationCodeRequestState({
      status: "pending",
      retryAt: activationCodeRequest.retryAt,
      error: null,
    });
    setAccountNotice(null);
    try {
      const result = await requestActivationCode(resolvedLocale);
      if (activeOperationPendingRef.current !== operationId) {
        return;
      }
      commitActivationCodeRequestState({
        status: "success",
        retryAt: result.retryAt,
        error: null,
      });
      await runAccountStatusRefresh(operationId);
      if (activeOperationPendingRef.current === operationId) {
        setAccountNotice(uiMessage("account.notice.activationCodeSent"));
      }
    } catch (error) {
      if (activeOperationPendingRef.current !== operationId) {
        return;
      }
      const activationRequestError =
        error instanceof ActivationCodeRequestError
          ? error
          : new ActivationCodeRequestError("INTERNAL_SERVER_ERROR");
      commitActivationCodeRequestState({
        status: "error",
        retryAt: activationRequestError.retryAt,
        error: activationRequestError,
      });
      setAccountNotice(mapActivationCodeRequestErrorToNotice(activationRequestError));
    } finally {
      finishActiveOperation(operationId);
    }
  }, [
    account,
    activationCodeRequest.retryAt,
    activationCodeRequest.status,
    beginActiveOperation,
    commitActivationCodeRequestState,
    finishActiveOperation,
    resolvedLocale,
    runAccountStatusRefresh,
  ]);

  const signOutAccount = useCallback(async () => {
    const operationId = beginActiveOperation();
    setActivationRedeeming(false);
    setAccountLoading(true);
    try {
      await logoutAccount();
      if (activeOperationPendingRef.current === operationId) {
        onSignedOut();
        setAccount(createGuestAccountStatus());
        setActivationCodeDraft("");
        setAccountNotice(null);
        setAccountOpen(false);
      }
    } catch {
      if (activeOperationPendingRef.current === operationId) {
        setAccountNotice(uiMessage("account.notice.signOutFailed"));
      }
    } finally {
      if (finishActiveOperation(operationId)) {
        setAccountLoading(false);
      }
    }
  }, [beginActiveOperation, finishActiveOperation, onSignedOut]);

  useEffect(() => {
    void refreshAccountStatus();
  }, [refreshAccountStatus]);

  const { accountChipLabel, accountStatusText } = useMemo(
    () => ({
      accountChipLabel: renderUiMessage(
        resolvedLocale,
        getAccountChipMessage(account),
      ),
      accountStatusText: renderUiMessage(
        resolvedLocale,
        getAccountStatusMessage(account, resolvedLocale),
      ),
    }),
    [account, resolvedLocale],
  );

  return {
    account,
    accountOpen,
    accountNotice,
    accountLoading,
    activationCodeRequest,
    activationCodeDraft,
    activationRedeeming,
    accountChipLabel,
    accountStatusText,
    closeAccountPanel,
    handleAuthCallback,
    openAccountPanel,
    requestActivationCodeByEmail,
    redeemActivationCodeFromInput,
    refreshAccountStatus,
    setActivationCodeDraft,
    signOutAccount,
    startLoginFlow,
  };
}
