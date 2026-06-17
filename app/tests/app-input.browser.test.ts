import react from "@vitejs/plugin-react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createNetServer, type AddressInfo } from "node:net";

type CdpEvent = {
  method: string;
  params: unknown;
};

type CdpTarget = {
  webSocketDebuggerUrl: string;
};

const pastedUrl = "https://www.douyin.com/video/7646789377271647540";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let viteServer: ViteDevServer | null = null;
let appUrl = "";
let chromeProcess: ChildProcess | null = null;
let chromeProfileDir = "";
let cdpPort = 0;

beforeAll(async () => {
  viteServer = await createServer({
    root: appRoot,
    configFile: false,
    plugins: [react()],
    clearScreen: false,
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  await viteServer.listen();

  const address = viteServer.httpServer?.address() as AddressInfo;
  appUrl = `http://127.0.0.1:${address.port}/`;

  cdpPort = await findFreePort();
  chromeProfileDir = mkdtempSync(join(tmpdir(), "frameq-cdp-"));
  chromeProcess = spawn(findChromeExecutable(), [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${chromeProfileDir}`,
    "--disable-gpu",
    "--no-first-run",
    "about:blank",
  ]);
  await waitForChrome(cdpPort);
});

afterAll(async () => {
  chromeProcess?.kill();
  if (viteServer) {
    await viteServer.close();
  }
  if (chromeProfileDir) {
    rmSync(chromeProfileDir, { recursive: true, force: true });
  }
});

describe("App browser input interactions", () => {
  test("keeps the app mounted after a valid Douyin URL is pasted", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent(appUrl)}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Log.enable");
      const loaded = page.waitForEvent("Page.loadEventFired");
      await page.send("Page.navigate", { url: appUrl });
      await loaded;
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.app-shell')) && getComputedStyle(document.querySelector('.app-shell')).display === 'grid'",
      );

      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('#video-url').focus()",
      });
      await page.send("Input.insertText", { text: pastedUrl });
      await delay(300);

      const after = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `({
            rootChildren: document.getElementById('root')?.childElementCount ?? -1,
            inputValue: document.querySelector('#video-url')?.value ?? null,
            bodyText: document.body.innerText,
            primaryDisabled: document.querySelector('.primary-button')?.disabled ?? null
          })`,
          returnByValue: true,
        },
      );
      const afterState = after.result.value;
      const exception = page.events.find((event) => event.method === "Runtime.exceptionThrown");

      expect(exception).toBeUndefined();
      expect(afterState.rootChildren).toBe(1);
      expect(afterState.inputValue).toBe(pastedUrl);
      expect(afterState.bodyText).toContain("视频转文字");
      expect(afterState.primaryDisabled).toBe(false);
    } finally {
      page.close();
    }
  });
});

describe("App result detail modal layout", () => {
  test("keeps long detail text scrollable inside the modal content area", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent(appUrl)}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      const loaded = page.waitForEvent("Page.loadEventFired");
      await page.send("Page.navigate", { url: appUrl });
      await loaded;
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.app-shell')) && getComputedStyle(document.querySelector('.app-shell')).display === 'grid'",
      );
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 900,
        height: 520,
        deviceScaleFactor: 1,
        mobile: false,
      });

      const metrics = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const longText = Array.from({ length: 80 }, (_, index) =>
              '<p>第 ' + (index + 1) + ' 行文字稿内容，用于验证详情弹窗内部滚动。</p>'
            ).join('');
            document.body.innerHTML =
              '<div class="modal-backdrop">' +
                '<section class="detail-modal" role="dialog">' +
                  '<header class="modal-header"><h2>完整文字稿</h2><button class="icon-button">x</button></header>' +
                  '<div class="tabs"><button class="selected">完整文字稿</button></div>' +
                  '<div class="modal-tools"><label class="search-box"><input /></label></div>' +
                  '<div class="modal-content">' + longText + '</div>' +
                '</section>' +
              '</div>';
            const modal = document.querySelector('.detail-modal');
            const content = document.querySelector('.modal-content');
            content.scrollTop = 240;
            return {
              modalClientHeight: modal.clientHeight,
              viewportHeight: window.innerHeight,
              contentClientHeight: content.clientHeight,
              contentScrollHeight: content.scrollHeight,
              contentScrollTop: content.scrollTop,
              contentOverflowY: getComputedStyle(content).overflowY,
            };
          })()`,
          returnByValue: true,
        },
      );
      const value = metrics.result.value;

      expect(value.modalClientHeight).toBeLessThanOrEqual(458);
      expect(value.contentScrollHeight).toBeGreaterThan(value.contentClientHeight);
      expect(value.contentScrollTop).toBeGreaterThan(0);
      expect(value.contentOverflowY).toBe("auto");
    } finally {
      page.close();
    }
  });

  test("keeps long settings forms scrollable inside the settings modal", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent(appUrl)}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      const loaded = page.waitForEvent("Page.loadEventFired");
      await page.send("Page.navigate", { url: appUrl });
      await loaded;
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.app-shell')) && getComputedStyle(document.querySelector('.app-shell')).display === 'grid'",
      );
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 720,
        height: 420,
        deviceScaleFactor: 1,
        mobile: false,
      });

      const metrics = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const fields = Array.from({ length: 24 }, (_, index) =>
              '<label><span>配置项 ' + (index + 1) + '</span><input value="demo" /></label>'
            ).join('');
            document.body.innerHTML =
              '<div class="modal-backdrop">' +
                '<section class="detail-modal settings-modal" role="dialog">' +
                  '<header class="modal-header"><h2>LLM 配置</h2><button class="icon-button">x</button></header>' +
                  '<form class="settings-form">' +
                    '<p class="settings-warning">启用云端 LLM 后，文字稿片段会发送到你配置的服务。</p>' +
                    fields +
                    '<div class="settings-actions"><button>保存配置</button></div>' +
                  '</form>' +
                '</section>' +
              '</div>';
            const form = document.querySelector('.settings-form');
            form.scrollTop = 240;
            return {
              formClientHeight: form.clientHeight,
              formScrollHeight: form.scrollHeight,
              formScrollTop: form.scrollTop,
              formOverflowY: getComputedStyle(form).overflowY,
            };
          })()`,
          returnByValue: true,
        },
      );
      const value = metrics.result.value;

      expect(value.formScrollHeight).toBeGreaterThan(value.formClientHeight);
      expect(value.formScrollTop).toBeGreaterThan(0);
      expect(value.formOverflowY).toBe("auto");
    } finally {
      page.close();
    }
  });
});

async function connectToCdp(webSocketDebuggerUrl: string) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const events: CdpEvent[] = [];
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  let nextId = 0;

  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data));
    if (data.id && pending.has(data.id)) {
      const callbacks = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) {
        callbacks?.reject(new Error(JSON.stringify(data.error)));
      } else {
        callbacks?.resolve(data.result);
      }
      return;
    }

    if (data.method) {
      events.push({ method: data.method, params: data.params });
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    events,
    close: () => socket.close(),
    send: <T>(method: string, params: Record<string, unknown> = {}) => {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise<T>((resolve, reject) => {
        pending.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
        });
      });
    },
    waitForEvent: (method: string) =>
      new Promise<CdpEvent>((resolve) => {
        const initial = events.find((event) => event.method === method);
        if (initial) {
          resolve(initial);
          return;
        }

        const handler = (message: MessageEvent) => {
          const data = JSON.parse(String(message.data));
          if (data.method === method) {
            socket.removeEventListener("message", handler);
            resolve({ method: data.method, params: data.params });
          }
        };
        socket.addEventListener("message", handler);
      }),
  };
}

function findChromeExecutable(): string {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];

  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error("Chrome or Edge executable was not found for browser regression tests.");
  }
  return executable;
}

function requestJson<T>(port: number, path: string, method = "GET"): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", method, path, port }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          reject(new Error(`Chrome returned non-JSON response: ${body}`));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForChrome(port: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await requestJson(port, "/json/version");
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Chrome DevTools endpoint did not become ready.");
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function waitForRuntimeCondition(
  page: Awaited<ReturnType<typeof connectToCdp>>,
  expression: string,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.send<{ result: { value: boolean } }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.result.value) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Runtime condition did not become true: ${expression}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
