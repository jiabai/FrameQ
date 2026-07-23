import { describe, expect, test } from "vitest";
import type { WechatConfig } from "../src/runtimeConfig.js";
import { createWechatNotificationParser } from "../src/wechat.js";

describe("typed WeChat configuration", () => {
  test("development notification parsing uses only the injected normalized config", async () => {
    const config: WechatConfig = Object.freeze({
      appId: "wx-app-id",
      mchId: "merchant-id",
      serialNo: "serial-no",
      privateKey: "unused-in-test",
      notifyUrl: "https://frameq.example/api/wechat/notify",
      apiV3Key: "",
      platformCertPem: "",
      allowInsecureNotify: true,
    });
    const parser = createWechatNotificationParser(config);

    const parsed = await parser({
      headers: {},
      rawBody: "{}",
      body: {
        id: "development-notification",
        out_trade_no: "frameq-order",
        transaction_id: "provider-transaction",
        success_time: "2026-07-23T00:00:00.000Z",
      },
    });

    expect(parsed).toMatchObject({
      webhookId: "development-notification",
      outTradeNo: "frameq-order",
      transactionId: "provider-transaction",
    });
  });
});
