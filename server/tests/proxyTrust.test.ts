import { describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

function buildIpTestServer(store: MemoryStore) {
  return buildServer({
    store,
    sendOtp: async () => {},
    createNativePayment: async () => ({
      codeUrl: "weixin://wxpay/bizpayurl?pr=test",
      providerPayload: {},
    }),
    trustLoopbackProxy: true,
  });
}

async function dispatchLogin(input: {
  remoteAddress: string;
  forwardedFor: string;
}): Promise<string | undefined> {
  const store = new MemoryStore();
  const app = buildIpTestServer(store);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/auth/email/start",
      remoteAddress: input.remoteAddress,
      headers: { "x-forwarded-for": input.forwardedFor },
      payload: { email: "user@example.com", state: "state-proxy-test" },
    });
    expect(response.statusCode).toBe(200);
    return store.emailOtps[0]?.ip;
  } finally {
    await app.close();
  }
}

describe("trusted proxy boundary", () => {
  test.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "accepts the forwarded client address from loopback proxy %s",
    async (remoteAddress) => {
      await expect(
        dispatchLogin({ remoteAddress, forwardedFor: "203.0.113.42" }),
      ).resolves.toBe("203.0.113.42");
    },
  );

  test("ignores a spoofed forwarded address from an untrusted direct peer", async () => {
    await expect(
      dispatchLogin({
        remoteAddress: "198.51.100.19",
        forwardedFor: "203.0.113.99",
      }),
    ).resolves.toBe("198.51.100.19");
  });

  test("preserves an IPv6 client address supplied by the trusted loopback proxy", async () => {
    await expect(
      dispatchLogin({ remoteAddress: "::1", forwardedFor: "2001:db8::42" }),
    ).resolves.toBe("2001:db8::42");
  });

  test("selects the nearest untrusted hop from a canonical forwarded chain", async () => {
    await expect(
      dispatchLogin({
        remoteAddress: "127.0.0.1",
        forwardedFor: "192.0.2.250, 203.0.113.77",
      }),
    ).resolves.toBe("203.0.113.77");
  });
});
