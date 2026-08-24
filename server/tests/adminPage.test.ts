import { describe, expect, test } from "vitest";
import { renderAdminPage } from "../src/adminPage.js";
import type {
  ActivationCodeRecord,
  AdminEntitlementAdjustmentRecord,
  EntitlementRecord,
  UserRecord,
} from "../src/store.js";

const now = new Date("2026-08-03T08:00:00.000Z");

function buildPage(input: {
  activationCodes?: ActivationCodeRecord[];
  users?: UserRecord[];
  locale?: "zh-CN" | "zh-TW" | "en";
}) {
  const users =
    input.users ??
    ([
      {
        id: "user-1",
        email: "bound@example.com",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "user-2",
        email: "redeemed@example.com",
        createdAt: now,
        updatedAt: now,
      },
    ] satisfies UserRecord[]);
  const entitlements = new Map<string, EntitlementRecord | null>(
    users.map((user) => [
      user.id,
      {
        id: `ent-${user.id}`,
        userId: user.id,
        status: "active",
        expiresAt: new Date("2026-09-01T08:00:00.000Z"),
        llmQuotaLimit: 100,
        llmQuotaUsed: 20,
        updatedAt: now,
      },
    ]),
  );

  return renderAdminPage({
    adminEmail: "admin@example.com",
    csrfToken: "csrf-token",
    users,
    entitlements,
    llmConfig: {
      provider: "openai",
      baseUrl: "https://api.example.com",
      model: "gpt-5-mini",
      timeoutSeconds: 60,
      hasApiKey: true,
      apiKeyLast4: "4321",
      updatedAt: now,
    },
    activationCodes:
      input.activationCodes ??
      ([
        {
          id: "code-pending",
          codeHash: "hash-pending",
          codePrefix: "FQ-PEND",
          status: "pending_delivery",
          issuanceSource: "self_service_email",
          entitlementDays: 31,
          issuedToUserId: "user-1",
          redeemBy: new Date("2026-09-02T08:00:00.000Z"),
          createdAt: now,
          sentAt: null,
          redeemedAt: null,
          redeemedByUserId: null,
          disabledReason: null,
        },
        {
          id: "code-disabled",
          codeHash: "hash-disabled",
          codePrefix: "FQ-DISB",
          status: "disabled",
          issuanceSource: "admin",
          entitlementDays: 31,
          issuedToUserId: null,
          redeemBy: new Date("2026-09-03T08:00:00.000Z"),
          createdAt: now,
          sentAt: now,
          redeemedAt: null,
          redeemedByUserId: null,
          disabledReason: "delivery_failed",
        },
        {
          id: "code-redeemed",
          codeHash: "hash-redeemed",
          codePrefix: "FQ-REDM",
          status: "redeemed",
          issuanceSource: "self_service_email",
          entitlementDays: 31,
          issuedToUserId: "user-1",
          redeemBy: new Date("2026-09-04T08:00:00.000Z"),
          createdAt: now,
          sentAt: now,
          redeemedAt: new Date("2026-08-05T08:00:00.000Z"),
          redeemedByUserId: "user-2",
          disabledReason: "activation_became_active",
        },
      ] satisfies ActivationCodeRecord[]),
    entitlementAdjustments: [] satisfies AdminEntitlementAdjustmentRecord[],
    locale: input.locale ?? "zh-CN",
  });
}

describe("renderAdminPage activation code audit table", () => {
  test("renders audit columns and localized source, status, reason, and bound email values", () => {
    const body = buildPage({});

    expect(body).toContain("来源");
    expect(body).toContain("绑定邮箱");
    expect(body).toContain("投递/状态");
    expect(body).toContain("停用原因");
    expect(body).toContain("创建时间");
    expect(body).toContain("发送时间");
    expect(body).toContain("兑换时间");
    expect(body).toContain("兑换截止");
    expect(body).toContain("前缀");
    expect(body).toContain("管理员发放");
    expect(body).toContain("自助邮件");
    expect(body).toContain("待发送");
    expect(body).toContain("可兑换");
    expect(body).toContain("已兑换");
    expect(body).toContain("投递失败");
    expect(body).toContain("激活后停发");
    expect(body).toContain("bound@example.com");
    expect(body).toContain("redeemed@example.com");
    expect(body).toContain(">—<");
    expect(body).toContain("llm-config-form");
    expect(body).toContain("entitlement-adjustment-table");
  });

  test("handles legacy rows, escapes unknown values, and does not leak hashes or tokens", () => {
    const body = buildPage({
      activationCodes: [
        {
          id: "legacy-code",
          codeHash: "hash-secret-123",
          codePrefix: "FQ-&<OLD>",
          status: "legacy<script>alert(1)</script>" as ActivationCodeRecord["status"],
          entitlementDays: 31,
          redeemBy: new Date("2026-09-02T08:00:00.000Z"),
          createdAt: now,
          redeemedAt: null,
          redeemedByUserId: null,
        } as unknown as ActivationCodeRecord,
        {
          id: "unknown-code",
          codeHash: "hash-secret-456",
          codePrefix: "FQ-NEW",
          status: "disabled",
          issuanceSource: "self_service_email<script>" as ActivationCodeRecord["issuanceSource"],
          entitlementDays: 31,
          issuedToUserId: "missing-user",
          redeemBy: new Date("2026-09-03T08:00:00.000Z"),
          createdAt: now,
          sentAt: null,
          redeemedAt: null,
          redeemedByUserId: null,
          disabledReason:
            "delivery_failed<script>" as ActivationCodeRecord["disabledReason"],
        },
      ],
    });

    expect(body).toContain("管理员发放");
    expect(body).toContain(">—<");
    expect(body).toContain("legacy&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).toContain("self_service_email&lt;script&gt;");
    expect(body).toContain("delivery_failed&lt;script&gt;");
    expect(body).toContain("FQ-&amp;&lt;OLD&gt;");
    expect(body).not.toContain("hash-secret-123");
    expect(body).not.toContain("hash-secret-456");
    expect(body).not.toContain("<script>alert(1)</script>");
  });

  test("renders English labels for the activation audit table", () => {
    const body = buildPage({ locale: "en" });

    expect(body).toContain("Source");
    expect(body).toContain("Bound email");
    expect(body).toContain("Delivery / status");
    expect(body).toContain("Disabled reason");
    expect(body).toContain("Created at");
    expect(body).toContain("Sent at");
    expect(body).toContain("Admin issued");
    expect(body).toContain("Self-service email");
    expect(body).toContain("Pending delivery");
  });
});
