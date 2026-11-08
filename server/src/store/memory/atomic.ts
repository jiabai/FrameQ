import type {
  ActivationCodeRecord,
  AdminEntitlementAdjustmentRecord,
  AdminSessionRecord,
  AnysearchConfigRecord,
  AuthRateLimitRecord,
  DesktopLoginTicketRecord,
  EmailOtpRecord,
  EntitlementRecord,
  LlmConfigRecord,
  LlmUsageEventRecord,
  SessionRecord,
  UserRecord,
  UserSessionRecord,
} from "../contracts.js";

export type MemoryState = {
  users: UserRecord[];
  emailOtps: EmailOtpRecord[];
  desktopLoginTickets: DesktopLoginTicketRecord[];
  sessions: SessionRecord[];
  entitlements: EntitlementRecord[];
  llmConfig: LlmConfigRecord | null;
  llmUsageEvents: LlmUsageEventRecord[];
  activationCodes: ActivationCodeRecord[];
  adminSessions: AdminSessionRecord[];
  adminEntitlementAdjustments: AdminEntitlementAdjustmentRecord[];
  authRateLimits: AuthRateLimitRecord[];
  userSessions: UserSessionRecord[];
  anysearchConfig: AnysearchConfigRecord | null;
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
      entitlements: this.#state.entitlements,
      llmConfig: this.#state.llmConfig,
      llmUsageEvents: this.#state.llmUsageEvents,
      activationCodes: this.#state.activationCodes,
      adminSessions: this.#state.adminSessions,
      adminEntitlementAdjustments: this.#state.adminEntitlementAdjustments,
      authRateLimits: this.#state.authRateLimits,
      userSessions: this.#state.userSessions,
      anysearchConfig: this.#state.anysearchConfig,
    });
    try {
      return await operation();
    } catch (error) {
      this.#state.users = snapshot.users;
      this.#state.emailOtps = snapshot.emailOtps;
      this.#state.desktopLoginTickets = snapshot.desktopLoginTickets;
      this.#state.sessions = snapshot.sessions;
      this.#state.entitlements = snapshot.entitlements;
      this.#state.llmConfig = snapshot.llmConfig;
      this.#state.llmUsageEvents = snapshot.llmUsageEvents;
      this.#state.activationCodes = snapshot.activationCodes;
      this.#state.adminSessions = snapshot.adminSessions;
      this.#state.adminEntitlementAdjustments = snapshot.adminEntitlementAdjustments;
      this.#state.authRateLimits = snapshot.authRateLimits;
      this.#state.userSessions = snapshot.userSessions;
      this.#state.anysearchConfig = snapshot.anysearchConfig;
      throw error;
    } finally {
      release();
    }
  }
}
