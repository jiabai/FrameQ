import type { EntitlementAdjustmentApplication, Store } from "./store.js";

type EntitlementAdjustmentStore = Pick<Store, "applyEntitlementAdjustmentWithAudit">;

export type EntitlementAdjustmentServiceOptions = {
  store: EntitlementAdjustmentStore;
  now?: () => Date;
};

export class EntitlementAdjustmentService {
  private readonly store: EntitlementAdjustmentStore;
  private readonly now: () => Date;

  constructor(options: EntitlementAdjustmentServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  async apply(input: {
    adminEmail: string;
    userId: string;
    reason: string;
    note?: string;
    extendDays?: number;
    expiresAt?: Date;
    quotaAdd?: number;
  }): Promise<EntitlementAdjustmentApplication> {
    const note = input.note?.trim() || null;
    return this.store.applyEntitlementAdjustmentWithAudit({
      adminEmail: input.adminEmail,
      userId: input.userId,
      reason: input.reason,
      note,
      extendDays: input.extendDays,
      expiresAt: input.expiresAt,
      quotaAdd: input.quotaAdd,
      now: this.now(),
    });
  }
}
