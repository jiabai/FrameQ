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
  serverError: string | null;
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
    serverError: null,
  };
}

export function canProcessWithAccount(account: AccountStatus): boolean {
  return account.authenticated && account.entitlementStatus === "active" && account.canProcess;
}
