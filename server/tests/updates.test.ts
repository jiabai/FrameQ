import { describe, expect, test } from "vitest";
import { buildServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

function buildUpdateServer(releaseManifest: unknown) {
  return buildServer({
    store: new MemoryStore(),
    sendOtp: async () => {},
    createNativePayment: async () => ({
      codeUrl: "weixin://wxpay/bizpayurl?pr=test",
      providerPayload: {},
    }),
    releaseManifest,
  } as Parameters<typeof buildServer>[0] & { releaseManifest: unknown });
}

describe("desktop update route", () => {
  test("returns a stable update manifest for older desktop clients", async () => {
    const app = buildUpdateServer({
      channels: {
        stable: {
          releases: [
            {
              version: "0.2.0",
              pub_date: "2026-06-23T10:00:00.000Z",
              notes: "修复 worker 转写稳定性并改进升级体验。",
              platforms: {
                "windows-x86_64": {
                  url: "https://frameq.8xf.pro/releases/frameq/0.2.0/windows-x86_64/FrameQ_0.2.0_x64-setup.exe",
                  signature: "trusted-signature",
                },
              },
            },
          ],
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/desktop/updates/windows/x86_64/0.1.0?channel=stable",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      version: "0.2.0",
      pub_date: "2026-06-23T10:00:00.000Z",
      url: "https://frameq.8xf.pro/releases/frameq/0.2.0/windows-x86_64/FrameQ_0.2.0_x64-setup.exe",
      signature: "trusted-signature",
      notes: "修复 worker 转写稳定性并改进升级体验。",
    });
  });

  test("returns no content when the client is already current", async () => {
    const app = buildUpdateServer({
      channels: {
        stable: {
          releases: [
            {
              version: "0.2.0",
              pub_date: "2026-06-23T10:00:00.000Z",
              notes: "Latest stable.",
              platforms: {
                "darwin-aarch64": {
                  url: "https://frameq.8xf.pro/releases/frameq/0.2.0/darwin-aarch64/FrameQ_0.2.0_aarch64.dmg",
                  signature: "trusted-signature",
                },
              },
            },
          ],
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/desktop/updates/darwin/aarch64/0.2.0?channel=stable",
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
  });

  test("does not publish invalid, unsigned, or wrong-platform releases", async () => {
    const app = buildUpdateServer({
      channels: {
        stable: {
          releases: [
            {
              version: "not-a-version",
              pub_date: "2026-06-23T10:00:00.000Z",
              notes: "Invalid version.",
              platforms: {
                "windows-x86_64": {
                  url: "https://frameq.8xf.pro/releases/frameq/invalid/setup.exe",
                  signature: "trusted-signature",
                },
              },
            },
            {
              version: "0.3.0",
              pub_date: "2026-06-23T10:00:00.000Z",
              notes: "Unsigned release.",
              platforms: {
                "windows-x86_64": {
                  url: "https://frameq.8xf.pro/releases/frameq/0.3.0/setup.exe",
                  signature: "",
                },
              },
            },
            {
              version: "0.4.0",
              pub_date: "2026-06-23T10:00:00.000Z",
              notes: "macOS only.",
              platforms: {
                "darwin-aarch64": {
                  url: "https://frameq.8xf.pro/releases/frameq/0.4.0/FrameQ.dmg",
                  signature: "trusted-signature",
                },
              },
            },
          ],
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/desktop/updates/windows/x86_64/0.1.0?channel=stable",
    });

    expect(response.statusCode).toBe(204);
  });
});
