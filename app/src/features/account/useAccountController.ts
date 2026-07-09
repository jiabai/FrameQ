import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  beginAuthFlow,
  completeAuthFlow,
  getAccountStatus,
  logoutAccount,
  redeemActivationCode,
} from "../../accountClient";
import {
  canProcessWithAccount,
  createAccountStatusFailure,
  createBrowserPreviewAccountStatus,
  createGuestAccountStatus,
  isBrowserPreviewRuntime,
  type AccountStatus,
} from "../../accountState";

type UseAccountControllerOptions = {
  formatHistoryDate: (value: string) => string;
  onSignedOut: () => void;
};

export function useAccountController({
  formatHistoryDate,
  onSignedOut,
}: UseAccountControllerOptions) {
  const [account, setAccount] = useState<AccountStatus>(createGuestAccountStatus);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountNotice, setAccountNotice] = useState("");
  const [accountLoading, setAccountLoading] = useState(false);
  const [activationCodeDraft, setActivationCodeDraft] = useState("");
  const [activationRedeeming, setActivationRedeeming] = useState(false);

  const refreshAccountStatus = useCallback(async () => {
    setAccountLoading(true);
    try {
      const status = await getAccountStatus();
      setAccount(status);
      setAccountNotice(status.serverError ? `账号状态刷新失败：${status.serverError}` : "");
    } catch (error) {
      if (isBrowserPreviewRuntime()) {
        setAccount(createBrowserPreviewAccountStatus());
        setAccountNotice("浏览器预览模式：使用本地模拟账号。");
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      const serverError = message || "账号状态刷新失败";
      setAccount(createAccountStatusFailure(serverError));
      setAccountNotice(`账号状态刷新失败：${serverError}`);
    } finally {
      setAccountLoading(false);
    }
  }, []);

  const handleAuthCallback = useCallback(
    async (callbackUrl: string) => {
      if (!callbackUrl.startsWith("frameq://auth/callback")) {
        return;
      }
      setAccountOpen(true);
      setAccountLoading(true);
      setAccountNotice("正在完成登录...");
      try {
        await completeAuthFlow(callbackUrl);
        await refreshAccountStatus();
        setAccountNotice("登录已完成。");
      } catch (error) {
        setAccountNotice(`登录失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setAccountLoading(false);
      }
    },
    [refreshAccountStatus],
  );

  const openAccountPanel = useCallback(
    (notice?: string) => {
      setAccountOpen(true);
      setAccountNotice(notice ?? "");
      void refreshAccountStatus();
    },
    [refreshAccountStatus],
  );

  const closeAccountPanel = useCallback(() => {
    setAccountOpen(false);
  }, []);

  const startLoginFlow = useCallback(async () => {
    setAccountLoading(true);
    setAccountNotice("正在打开登录页面...");
    try {
      const auth = await beginAuthFlow();
      await openUrl(auth.authUrl);
      setAccountNotice("登录页面已打开。请在浏览器中输入邮箱验证码，完成后会自动回到 FrameQ。");
    } catch (error) {
      setAccountNotice(`无法开始登录：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAccountLoading(false);
    }
  }, []);

  const redeemActivationCodeFromInput = useCallback(async () => {
    const code = activationCodeDraft.trim();
    if (!code) {
      setAccountNotice("请输入激活码。");
      return;
    }
    setActivationRedeeming(true);
    setAccountNotice("");
    try {
      const status = await redeemActivationCode(code);
      setAccount(status);
      setActivationCodeDraft("");
      setAccountNotice("激活成功，授权已生效。");
    } catch (error) {
      setAccountNotice(`激活失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActivationRedeeming(false);
    }
  }, [activationCodeDraft]);

  const signOutAccount = useCallback(async () => {
    setAccountLoading(true);
    try {
      await logoutAccount();
      onSignedOut();
      setAccount(createGuestAccountStatus());
      setActivationCodeDraft("");
      setAccountNotice("");
      setAccountOpen(false);
    } catch (error) {
      setAccountNotice(`退出登录失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAccountLoading(false);
    }
  }, [onSignedOut]);

  useEffect(() => {
    void refreshAccountStatus();
  }, [refreshAccountStatus]);

  const { accountChipLabel, accountStatusText } = useMemo(() => {
    const accountHasActiveEntitlement =
      account.authenticated && account.entitlementStatus === "active";
    const chipLabel = canProcessWithAccount(account)
      ? "授权有效"
      : account.authenticated
        ? accountHasActiveEntitlement
          ? account.llmConfigured
            ? "LLM 额度不足"
            : "待配置"
          : "激活"
        : "登录";
    const statusText = canProcessWithAccount(account)
      ? `授权有效${account.entitlementExpiresAt ? `至 ${formatHistoryDate(account.entitlementExpiresAt)}` : ""}`
      : account.authenticated
        ? accountHasActiveEntitlement
          ? account.llmConfigured
            ? "LLM API 调用额度不足"
            : "等待管理员配置 LLM"
          : "未激活"
        : "未登录";

    return { accountChipLabel: chipLabel, accountStatusText: statusText };
  }, [account, formatHistoryDate]);

  return {
    account,
    accountOpen,
    accountNotice,
    accountLoading,
    activationCodeDraft,
    activationRedeeming,
    accountChipLabel,
    accountStatusText,
    closeAccountPanel,
    handleAuthCallback,
    openAccountPanel,
    redeemActivationCodeFromInput,
    refreshAccountStatus,
    setActivationCodeDraft,
    signOutAccount,
    startLoginFlow,
  };
}
