import { describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

const databaseErrorMarker = "SQLITE_BUSY raw-database-detail-marker";

class FailingLogoutStore extends MemoryStore {
  override async revokeSession(): Promise<void> {
    throw new Error(databaseErrorMarker);
  }
}

describe("production observability", () => {
  test("emits allowlisted structured request fields without secrets, bodies, or raw errors", async () => {
    const chunks: string[] = [];
    let otpSecretMarker = "";
    const adminEmailMarker = "admin-private-email-marker@example.com";
    const app = buildServer({
      store: new FailingLogoutStore(),
      sendOtp: async (_email, code) => {
        otpSecretMarker = code;
      },
      createNativePayment: async () => ({
        codeUrl: "weixin://wxpay/bizpayurl?pr=test",
        providerPayload: {},
      }),
      observability: {
        enabled: true,
        requestIdFactory: () => "srv-test-request-id",
        stream: {
          write: (chunk: string | Uint8Array) => {
            chunks.push(String(chunk));
          },
        },
      },
      adminEmail: adminEmailMarker,
      secureCookies: true,
    });

    const adminStart = await app.inject({
      method: "POST",
      url: "/admin/auth/email/start",
      remoteAddress: "198.51.100.44",
      payload: { email: adminEmailMarker, state: "admin-private-state-marker" },
    });
    expect(adminStart.statusCode).toBe(200);
    expect(otpSecretMarker).toMatch(/^\d{6}$/);
    const adminVerify = await app.inject({
      method: "POST",
      url: "/admin/auth/email/verify",
      payload: {
        email: adminEmailMarker,
        state: "admin-private-state-marker",
        code: otpSecretMarker,
      },
    });
    expect(adminVerify.statusCode).toBe(200);
    const cookieSecretMarkers = (Array.isArray(adminVerify.headers["set-cookie"])
      ? adminVerify.headers["set-cookie"]
      : [adminVerify.headers["set-cookie"]]
    )
      .filter((value): value is string => Boolean(value))
      .map((value) => value.split(";", 1)[0]?.split("=", 2)[1] ?? "")
      .filter(Boolean);

    const response = await app.inject({
      method: "POST",
      url: "/api/desktop/logout",
      headers: {
        authorization: "Bearer bearer-secret-marker",
        cookie: "session=cookie-secret-marker",
        "x-request-id": "attacker-chosen-request-id",
        "x-api-key": "api-key-secret-marker",
        "x-smtp-pass": "smtp-secret-marker",
        "x-wechat-api-v3-key": "payment-secret-marker",
      },
      payload: {
        otp: "otp-body-secret-marker",
        transcript: "request-body-secret-marker",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });

    const output = `${response.body}\n${chunks.join("")}`;
    for (const marker of [
      databaseErrorMarker,
      "bearer-secret-marker",
      "cookie-secret-marker",
      "attacker-chosen-request-id",
      "api-key-secret-marker",
      "smtp-secret-marker",
      "payment-secret-marker",
      "otp-body-secret-marker",
      "request-body-secret-marker",
      adminEmailMarker,
      "admin-private-state-marker",
      "198.51.100.44",
      otpSecretMarker,
      ...cookieSecretMarkers,
    ]) {
      expect(output).not.toContain(marker);
    }

    const records = chunks
      .flatMap((chunk) => chunk.split("\n"))
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "http.request.failed",
          request_id: "srv-test-request-id",
          error_code: "INTERNAL_SERVER_ERROR",
          method: "POST",
          route: "/api/desktop/logout",
        }),
        expect.objectContaining({
          event: "http.request.completed",
          request_id: "srv-test-request-id",
          method: "POST",
          route: "/api/desktop/logout",
          status: 500,
          outcome_code: "INTERNAL_SERVER_ERROR",
          duration_bucket: expect.any(String),
        }),
      ]),
    );
  });
});
