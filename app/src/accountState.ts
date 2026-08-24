export type AccountStatus = {
  authenticated: boolean;
  email: string | null;
  entitlementStatus: string;
  entitlementExpiresAt: string | null;
  llmQuotaLimit: number;
  llmQuotaUsed: number;
  llmQuotaRemaining: number;
  llmQuotaResetsAt: string | null;
  llmConfigured: boolean;
  lastVerifiedAt: string | null;
  canProcess: boolean;
  canGenerateAi: boolean;
  canRequestActivationCode: boolean;
  serverError: string | null;
};

export type ActivationCodeRequestOutcome = "sent";

export type ActivationCodeRequestState = {
  requesting: boolean;
  retryAt: string | null;
  lastOutcome: ActivationCodeRequestOutcome | null;
  lastErrorCode: string | null;
};

export function createGuestAccountStatus(): AccountStatus {
  return {
    authenticated: false,
    email: null,
    entitlementStatus: "inactive",
    entitlementExpiresAt: null,
    llmQuotaLimit: 0,
    llmQuotaUsed: 0,
    llmQuotaRemaining: 0,
    llmQuotaResetsAt: null,
    llmConfigured: false,
    lastVerifiedAt: null,
    canProcess: false,
    canGenerateAi: false,
    canRequestActivationCode: false,
    serverError: null,
  };
}

export function createAccountStatusFailure(serverError: string | null): AccountStatus {
  return {
    ...createGuestAccountStatus(),
    serverError,
  };
}

export function createBrowserPreviewAccountStatus(): AccountStatus {
  return {
    authenticated: true,
    email: "browser-preview@frameq.local",
    entitlementStatus: "active",
    entitlementExpiresAt: null,
    llmQuotaLimit: 20,
    llmQuotaUsed: 0,
    llmQuotaRemaining: 20,
    llmQuotaResetsAt: null,
    llmConfigured: true,
    lastVerifiedAt: null,
    canProcess: true,
    canGenerateAi: true,
    canRequestActivationCode: false,
    serverError: "Browser preview fallback",
  };
}

export function createActivationCodeRequestState(): ActivationCodeRequestState {
  return {
    requesting: false,
    retryAt: null,
    lastOutcome: null,
    lastErrorCode: null,
  };
}

type RuntimeWindow = {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

export function isBrowserPreviewRuntime(
  options: { dev?: boolean; runtimeWindow?: RuntimeWindow | null } = {},
): boolean {
  const dev = options.dev ?? import.meta.env.DEV;
  const runtimeWindow =
    options.runtimeWindow ?? (typeof window === "undefined" ? null : (window as RuntimeWindow));

  return Boolean(dev) && runtimeWindow !== null && !("__TAURI__" in runtimeWindow) && !("__TAURI_INTERNALS__" in runtimeWindow);
}

export function canProcessWithAccount(account: AccountStatus): boolean {
  return account.authenticated && account.entitlementStatus === "active" && account.canProcess;
}

export function canGenerateAiWithAccount(account: AccountStatus): boolean {
  return account.authenticated && account.entitlementStatus === "active" && account.canGenerateAi;
}

export function canRequestActivationCodeWithAccount(account: AccountStatus): boolean {
  return (
    account.authenticated &&
    account.entitlementStatus !== "active" &&
    account.canRequestActivationCode
  );
}
