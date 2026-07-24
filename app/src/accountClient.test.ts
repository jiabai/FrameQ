import { describe, expect, test } from "vitest";
import {
  beginAuthFlow,
  completeAuthFlow,
  createWechatCheckout,
  getAccountStatus,
  getCheckoutStatus,
  logoutAccount,
  redeemActivationCode,
  type AccountCommandRunner,
} from "./accountClient";
import { IpcProtocolError } from "./tauriIpcProtocol";

describe("account client", () => {
  test("maps account status from Tauri", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: AccountCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        authenticated: true,
        email: "user@example.com",
        entitlement_status: "active",
        entitlement_expires_at: "2026-07-22T08:00:00.000Z",
        llm_quota_limit: 20,
        llm_quota_used: 3,
        llm_quota_remaining: 17,
        llm_quota_resets_at: "2026-07-22T08:00:00.000Z",
        llm_configured: true,
        last_verified_at: "2026-06-21T08:00:00.000Z",
        can_process: true,
        can_generate_ai: true,
        server_error: null,
      };
    };

    const status = await getAccountStatus(runner);

    expect(calls).toEqual([{ command: "get_account_status", args: {} }]);
    expect(status).toEqual({
      authenticated: true,
      email: "user@example.com",
      entitlementStatus: "active",
      entitlementExpiresAt: "2026-07-22T08:00:00.000Z",
      llmQuotaLimit: 20,
      llmQuotaUsed: 3,
      llmQuotaRemaining: 17,
      llmQuotaResetsAt: "2026-07-22T08:00:00.000Z",
      llmConfigured: true,
      lastVerifiedAt: "2026-06-21T08:00:00.000Z",
      canProcess: true,
      canGenerateAi: true,
      serverError: null,
    });
  });

  test("invokes login, callback completion, logout, checkout, and order status commands", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: AccountCommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === "begin_auth_flow") {
        return { auth_url: "https://frameq.example/login?state=state-1", state: "state-1" };
      }
      if (command === "complete_auth_flow") {
        return {
          authenticated: true,
          email: "user@example.com",
          can_process: false,
          can_generate_ai: false,
        };
      }
      if (command === "create_wechat_checkout") {
        return {
          order_id: "fq_order",
          amount_fen: 990,
          currency: "CNY",
          code_url: "weixin://wxpay/bizpayurl?pr=fq_order",
          expires_at: "2026-06-21T08:30:00.000Z",
          status: "pending",
        };
      }
      if (command === "get_checkout_status") {
        return {
          order_id: "fq_order",
          status: "paid",
          entitlement_expires_at: "2026-07-22T08:00:00.000Z",
        };
      }
      if (command === "logout_account") {
        return null;
      }
      return {};
    };

    await expect(beginAuthFlow(runner)).resolves.toEqual({
      authUrl: "https://frameq.example/login?state=state-1",
      state: "state-1",
    });
    await expect(
      completeAuthFlow("frameq://auth/callback?ticket=flt_abc&state=state-1", runner),
    ).resolves.toEqual({
      authenticated: true,
      email: "user@example.com",
      canProcess: false,
      canGenerateAi: false,
    });
    await expect(createWechatCheckout(runner)).resolves.toEqual({
      orderId: "fq_order",
      amountFen: 990,
      currency: "CNY",
      codeUrl: "weixin://wxpay/bizpayurl?pr=fq_order",
      expiresAt: "2026-06-21T08:30:00.000Z",
      status: "pending",
    });
    await expect(getCheckoutStatus("fq_order", runner)).resolves.toEqual({
      orderId: "fq_order",
      status: "paid",
      entitlementExpiresAt: "2026-07-22T08:00:00.000Z",
    });
    await expect(logoutAccount(runner)).resolves.toBeUndefined();

    expect(calls).toEqual([
      { command: "begin_auth_flow", args: {} },
      {
        command: "complete_auth_flow",
        args: { callbackUrl: "frameq://auth/callback?ticket=flt_abc&state=state-1" },
      },
      { command: "create_wechat_checkout", args: {} },
      { command: "get_checkout_status", args: { orderId: "fq_order" } },
      { command: "logout_account", args: {} },
    ]);
  });

  test("redeems an activation code and maps refreshed account status", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: AccountCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return {
        authenticated: true,
        email: "user@example.com",
        entitlement_status: "active",
        entitlement_expires_at: "2026-07-22T08:00:00.000Z",
        llm_quota_limit: 20,
        llm_quota_used: 0,
        llm_quota_remaining: 20,
        llm_quota_resets_at: "2026-07-22T08:00:00.000Z",
        llm_configured: true,
        last_verified_at: "2026-06-21T08:00:00.000Z",
        can_process: true,
        can_generate_ai: true,
        server_error: null,
      };
    };

    await expect(redeemActivationCode("fq-abcd-efgh-jklm-npqr", runner)).resolves.toEqual({
      authenticated: true,
      email: "user@example.com",
      entitlementStatus: "active",
      entitlementExpiresAt: "2026-07-22T08:00:00.000Z",
      llmQuotaLimit: 20,
      llmQuotaUsed: 0,
      llmQuotaRemaining: 20,
      llmQuotaResetsAt: "2026-07-22T08:00:00.000Z",
      llmConfigured: true,
      lastVerifiedAt: "2026-06-21T08:00:00.000Z",
      canProcess: true,
      canGenerateAi: true,
      serverError: null,
    });
    expect(calls).toEqual([
      {
        command: "redeem_activation_code",
        args: { code: "fq-abcd-efgh-jklm-npqr" },
      },
    ]);
  });

  test("rejects malformed account status before mapping defaults", async () => {
    const secret = "user@example.com";
    const runner: AccountCommandRunner = async () => ({
      authenticated: true,
      email: secret,
      entitlement_status: "active",
      entitlement_expires_at: null,
      llm_quota_limit: -1,
      llm_quota_used: 0,
      llm_quota_remaining: 0,
      llm_quota_resets_at: null,
      llm_configured: true,
      last_verified_at: null,
      can_process: true,
      can_generate_ai: true,
      server_error: null,
    });

    await expect(getAccountStatus(runner)).rejects.toEqual(
      new IpcProtocolError("ACCOUNT_IPC_RESPONSE_INVALID"),
    );
    await expect(getAccountStatus(runner)).rejects.not.toThrow(secret);
  });

  test("rejects malformed auth-flow responses with one stable account code", async () => {
    await expect(
      beginAuthFlow(async () => ({
        auth_url: "https://frameq.example/login",
        state: "state-1",
        unexpected: true,
      })),
    ).rejects.toEqual(new IpcProtocolError("ACCOUNT_IPC_RESPONSE_INVALID"));

    await expect(
      completeAuthFlow("frameq://auth/callback", async () => ({
        authenticated: true,
        email: "user@example.com",
        can_process: true,
      })),
    ).rejects.toEqual(new IpcProtocolError("ACCOUNT_IPC_RESPONSE_INVALID"));
  });

  test("rejects malformed checkout and checkout-status responses", async () => {
    await expect(
      createWechatCheckout(async () => ({
        order_id: "fq_order",
        amount_fen: Number.NaN,
        currency: "CNY",
        code_url: "weixin://wxpay/bizpayurl?pr=private",
        expires_at: "2026-06-21T08:30:00.000Z",
        status: "pending",
      })),
    ).rejects.toEqual(new IpcProtocolError("ACCOUNT_IPC_RESPONSE_INVALID"));

    await expect(
      getCheckoutStatus("expected-order", async () => ({
        order_id: "different-order",
        status: "paid",
        entitlement_expires_at: null,
      })),
    ).rejects.toEqual(new IpcProtocolError("ACCOUNT_IPC_RESPONSE_INVALID"));
  });

  test("requires the serialized unit result for logout", async () => {
    await expect(
      logoutAccount(async () => ({ arbitrary: "value" })),
    ).rejects.toEqual(new IpcProtocolError("ACCOUNT_IPC_RESPONSE_INVALID"));
  });
});
