import type {
  ActivationCodeRecord,
  AdminEntitlementAdjustmentRecord,
  AdminSessionRecord,
  AuthRateLimitRecord,
  DesktopLoginTicketRecord,
  EmailOtpRecord,
  EntitlementRecord,
  LlmConfigRecord,
  LlmUsageEventRecord,
  OrderRecord,
  SessionRecord,
  UserRecord,
  WebhookEventRecord,
} from "../contracts.js";

export type MemoryState = {
  users: UserRecord[];
  emailOtps: EmailOtpRecord[];
  desktopLoginTickets: DesktopLoginTicketRecord[];
  sessions: SessionRecord[];
  orders: OrderRecord[];
  entitlements: EntitlementRecord[];
  llmConfig: LlmConfigRecord | null;
  llmUsageEvents: LlmUsageEventRecord[];
  activationCodes: ActivationCodeRecord[];
  adminSessions: AdminSessionRecord[];
  adminEntitlementAdjustments: AdminEntitlementAdjustmentRecord[];
  webhookEvents: WebhookEventRecord[];
  authRateLimits: AuthRateLimitRecord[];
};

export class MemoryAtomicCoordinator {
  private tail: Promise<void> = Promise.resolve();
  readonly #state: MemoryState;

  constructor(state: MemoryState) {
    this.#state = state;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = structuredClone({
      users: this.#state.users,
      emailOtps: this.#state.emailOtps,
      desktopLoginTickets: this.#state.desktopLoginTickets,
      sessions: this.#state.sessions,
      orders: this.#state.orders,
      entitlements: this.#state.entitlements,
      llmConfig: this.#state.llmConfig,
      llmUsageEvents: this.#state.llmUsageEvents,
      activationCodes: this.#state.activationCodes,
      adminSessions: this.#state.adminSessions,
      adminEntitlementAdjustments: this.#state.adminEntitlementAdjustments,
      webhookEvents: this.#state.webhookEvents,
      authRateLimits: this.#state.authRateLimits,
    });
    try {
      return await operation();
    } catch (error) {
      this.#state.users = snapshot.users;
      this.#state.emailOtps = snapshot.emailOtps;
      this.#state.desktopLoginTickets = snapshot.desktopLoginTickets;
      this.#state.sessions = snapshot.sessions;
      this.#state.orders = snapshot.orders;
      this.#state.entitlements = snapshot.entitlements;
      this.#state.llmConfig = snapshot.llmConfig;
      this.#state.llmUsageEvents = snapshot.llmUsageEvents;
      this.#state.activationCodes = snapshot.activationCodes;
      this.#state.adminSessions = snapshot.adminSessions;
      this.#state.adminEntitlementAdjustments = snapshot.adminEntitlementAdjustments;
      this.#state.webhookEvents = snapshot.webhookEvents;
      this.#state.authRateLimits = snapshot.authRateLimits;
      throw error;
    } finally {
      release();
    }
  }
}
