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
let chromeStderr = "";
let chromeExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;

beforeAll(async () => {
  viteServer = await createServer({
    root: appRoot,
    configFile: false,
    plugins: [react()],
    clearScreen: false,
    logLevel: "error",
    optimizeDeps: {
      entries: [resolve(appRoot, "index.html")],
    },
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  });
  await viteServer.listen();

  const address = viteServer.httpServer?.address() as AddressInfo;
  appUrl = `http://127.0.0.1:${address.port}/`;

  cdpPort = await findFreePort();
  chromeProfileDir = mkdtempSync(join(tmpdir(), "frameq-cdp-"));
  chromeProcess = spawn(
    findChromeExecutable(),
    [
      "--headless=new",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${chromeProfileDir}`,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-3d-apis",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  chromeProcess.stderr?.on("data", (chunk) => {
    chromeStderr = `${chromeStderr}${String(chunk)}`.slice(-4_000);
  });
  chromeProcess.on("exit", (code, signal) => {
    chromeExit = { code, signal };
  });
  await waitForChrome(cdpPort, chromeDiagnostics);
}, 30_000);

afterAll(async () => {
  await stopChromeProcess();
  if (viteServer) {
    await viteServer.close();
  }
  if (chromeProfileDir) {
    rmSync(chromeProfileDir, { recursive: true, force: true });
  }
});

describe("App browser input interactions", () => {
  test("renders a macOS-style desktop utility frame around the waiting input state", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent(appUrl)}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 1180,
        height: 760,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const loaded = page.waitForEvent("Page.loadEventFired");
      await page.send("Page.navigate", { url: appUrl });
      await loaded;
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.app-shell')) && getComputedStyle(document.querySelector('.app-shell')).display === 'grid'",
      );

      const structure = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `({
            hasDesktopWindow: Boolean(document.querySelector('.desktop-window')),
            trafficLights: document.querySelectorAll('.traffic-light').length,
            trafficLightButtons: Array.from(document.querySelectorAll('button.traffic-light')).map((button) => button.getAttribute('aria-label')),
            hasToolbar: Boolean(document.querySelector('.app-toolbar')),
            toolbarDragRegion: document.querySelector('.app-toolbar')?.hasAttribute('data-tauri-drag-region') ?? false,
            innerDragRegions: [
              '.toolbar-title',
              '.app-mark',
              '.toolbar-title .eyebrow',
              '.toolbar-title h1'
            ].every((selector) => document.querySelector(selector)?.hasAttribute('data-tauri-drag-region')),
            toolbarStageBadges: document.querySelectorAll('.app-toolbar .stage-badge').length,
            localBadges: document.querySelectorAll('.command-panel .local-badge').length,
            showsLocalFirstCopy: document.querySelector('.command-panel')?.textContent.includes('本地优先') ?? false,
            visibleUrlLabels: document.querySelectorAll('.command-panel .field-label').length,
            videoUrlAriaLabel: document.querySelector('#video-url')?.getAttribute('aria-label') ?? '',
            videoUrlPlaceholder: document.querySelector('#video-url')?.getAttribute('placeholder') ?? '',
            hasCommandPanel: Boolean(document.querySelector('.command-panel')),
            hasResultWorkspace: Boolean(document.querySelector('.result-workspace')),
            hasQuietPlaceholder: Boolean(document.querySelector('.result-placeholder')),
            primaryButtonText: document.querySelector('.primary-button')?.textContent.trim() ?? '',
            commandPanelWidth: Math.round(document.querySelector('.command-panel')?.getBoundingClientRect().width ?? 0),
            desktopWindowWidth: Math.round(document.querySelector('.desktop-window')?.getBoundingClientRect().width ?? 0)
          })`,
          returnByValue: true,
        },
      );

      expect(structure.result.value).toMatchObject({
        hasDesktopWindow: true,
        trafficLights: 3,
        trafficLightButtons: ["关闭窗口", "最小化窗口", "最大化或还原窗口"],
        hasToolbar: true,
        toolbarDragRegion: true,
        innerDragRegions: true,
        toolbarStageBadges: 0,
        localBadges: 0,
        showsLocalFirstCopy: false,
        visibleUrlLabels: 0,
        videoUrlAriaLabel: "视频 URL",
        videoUrlPlaceholder: "粘贴抖音或小红书视频链接",
        hasCommandPanel: true,
        hasResultWorkspace: false,
        hasQuietPlaceholder: false,
        primaryButtonText: "确认",
      });
      expect(structure.result.value.commandPanelWidth).toBeGreaterThanOrEqual(720);
      expect(structure.result.value.commandPanelWidth).toBeLessThanOrEqual(820);
      expect(structure.result.value.desktopWindowWidth).toBe(1180);
    } finally {
      page.close();
    }
  }, 10_000);

  test("shows the processing workspace only after the URL is submitted", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent(appUrl)}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 1180,
        height: 760,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const loaded = page.waitForEvent("Page.loadEventFired");
      await page.send("Page.navigate", { url: appUrl });
      await loaded;
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.command-panel')) && !document.querySelector('.result-workspace')",
      );

      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('#video-url').focus()",
      });
      await page.send("Input.insertText", { text: pastedUrl });
      await waitForRuntimeCondition(page, "!document.querySelector('.primary-button').disabled");
      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('.primary-button').click()",
      });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.process-monitor')) && Boolean(document.querySelector('.result-workspace'))",
      );

      const afterSubmit = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `({
            hasCommandPanel: Boolean(document.querySelector('.command-panel')),
            hasProcessMonitor: Boolean(document.querySelector('.process-monitor')),
            hasResultWorkspace: Boolean(document.querySelector('.result-workspace')),
            monitorTitle: document.querySelector('.process-monitor h2')?.textContent ?? '',
            toolbarStageBadges: document.querySelectorAll('.app-toolbar .stage-badge').length,
            resultHeaderStageBadges: document.querySelectorAll('.result-header .stage-badge').length,
            activeLayoutColumns: getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns.trim().split(/\\s+/).length,
            processBottom: Math.round(document.querySelector('.process-monitor').getBoundingClientRect().bottom),
            resultTop: Math.round(document.querySelector('.result-workspace').getBoundingClientRect().top),
            processWidth: Math.round(document.querySelector('.process-monitor').getBoundingClientRect().width),
            resultWidth: Math.round(document.querySelector('.result-workspace').getBoundingClientRect().width)
          })`,
          returnByValue: true,
        },
      );

      expect(afterSubmit.result.value).toMatchObject({
        hasCommandPanel: false,
        hasProcessMonitor: true,
        hasResultWorkspace: true,
        monitorTitle: "视频提取中",
        toolbarStageBadges: 0,
        resultHeaderStageBadges: 0,
        activeLayoutColumns: 1,
      });
      expect(afterSubmit.result.value.resultTop).toBeGreaterThan(afterSubmit.result.value.processBottom);
      expect(afterSubmit.result.value.resultWidth).toBe(afterSubmit.result.value.processWidth);
    } finally {
      page.close();
    }
  }, 10_000);

  test("stacks the completed task monitor above compact result tiles", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent(appUrl)}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 1180,
        height: 760,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const loaded = page.waitForEvent("Page.loadEventFired");
      await page.send("Page.navigate", { url: appUrl });
      await loaded;
      await waitForRuntimeCondition(page, "Boolean(document.querySelector('.workspace'))");

      const completedLayout = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const workspace = document.querySelector('.workspace');
            workspace.className = 'workspace active-layout';
            workspace.innerHTML =
              '<div class="workflow-column">' +
                '<section class="process-monitor process-pane completed" aria-label="处理进度">' +
                  '<div class="process-heading"><div><p class="section-label">Task monitor</p><h2>文字稿完成</h2></div></div>' +
                  '<div class="progress-summary"><div><span class="progress-value">100%</span><p>结果已可查看和导出</p></div><div class="progress-track"><span class="progress-fill completed"></span></div></div>' +
                  '<div class="steps"><div class="step complete"><span class="step-dot"></span><span>视频提取中</span></div><div class="step complete"><span class="step-dot"></span><span>视频转译中</span></div><div class="step complete"><span class="step-dot"></span><span>话题点生成中</span></div></div>' +
                  '<p class="status-line worker-message">文字稿和启发话题点已准备好。</p>' +
                '</section>' +
              '</div>' +
              '<section class="result-workspace result-area" aria-label="结果总览">' +
                '<div class="result-header"><div><p class="section-label">Results</p><h2>结果工作区</h2></div></div>' +
                '<div class="result-grid">' +
                  '<button class="result-card result-tile ready"><span class="result-icon"></span><span>视频文件</span><small>已下载，可定位文件</small><em>定位文件</em></button>' +
                  '<button class="result-card result-tile ready"><span class="result-icon"></span><span>音频文件</span><small>WAV 音频，可定位文件</small><em>定位文件</em></button>' +
                  '<button class="result-card result-tile ready"><span class="result-icon"></span><span>完整文字稿</span><small>15,297 字</small><em>打开详情</em></button>' +
                  '<button class="result-card result-tile ready"><span class="result-icon"></span><span>要点总结</span><small>1,065 字</small><em>打开详情</em></button>' +
                  '<button class="result-card result-tile ready"><span class="result-icon"></span><span>启发话题点</span><small>12 个话题点</small><em>打开详情</em></button>' +
                '</div>' +
              '</section>';
            const processRect = document.querySelector('.process-monitor').getBoundingClientRect();
            const result = document.querySelector('.result-workspace');
            const resultRect = result.getBoundingClientRect();
            const cardHeights = Array.from(document.querySelectorAll('.result-card')).map((card) =>
              Math.round(card.getBoundingClientRect().height)
            );
            const cardBottoms = Array.from(document.querySelectorAll('.result-card')).map((card) =>
              Math.round(card.getBoundingClientRect().bottom)
            );
            return {
              activeLayoutColumns: getComputedStyle(workspace).gridTemplateColumns.trim().split(/\\s+/).length,
              processBottom: Math.round(processRect.bottom),
              resultTop: Math.round(resultRect.top),
              resultBottom: Math.round(resultRect.bottom),
              lastResultCardBottom: Math.max(...cardBottoms),
              resultVerticalOverflow: result.scrollHeight - result.clientHeight,
              maxResultCardHeight: Math.max(...cardHeights),
            };
          })()`,
          returnByValue: true,
        },
      );

      expect(completedLayout.result.value.activeLayoutColumns).toBe(1);
      expect(completedLayout.result.value.resultTop).toBeGreaterThan(
        completedLayout.result.value.processBottom,
      );
      expect(completedLayout.result.value.resultBottom).toBeGreaterThanOrEqual(
        completedLayout.result.value.lastResultCardBottom,
      );
      expect(completedLayout.result.value.resultVerticalOverflow).toBeLessThanOrEqual(1);
      expect(completedLayout.result.value.maxResultCardHeight).toBeLessThanOrEqual(132);
    } finally {
      page.close();
    }
  }, 10_000);

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

  test("submits the normalized supported URL extracted from share text", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent(appUrl)}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);
    const shareText =
      "copy https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123 more text";

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `
          (() => {
            window.__FRAMEQ_TEST_COMMANDS__ = [];
            window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
              unregisterListener: () => {}
            };
            window.__TAURI_INTERNALS__ = {
              callbacks: {},
              transformCallback: () => 1,
              unregisterCallback: () => {},
              invoke: async (command, args) => {
                window.__FRAMEQ_TEST_COMMANDS__.push({ command, args });
                if (command === "check_first_run") {
                  return {
                    user_data_dir: "C:/FrameQ",
                    default_output_dir: "C:/FrameQ/outputs",
                    asr_model: "iic/SenseVoiceSmall",
                    asr_model_dir: "C:/FrameQ/models/SenseVoiceSmall",
                    asr_model_available: true,
                    asr_model_source: "modelscope"
                  };
                }
                if (command === "get_account_status") {
                  return {
                    authenticated: true,
                    email: "tester@frameq.local",
                    entitlement_status: "active",
                    entitlement_expires_at: null,
                    llm_quota_limit: 20,
                    llm_quota_used: 0,
                    llm_quota_remaining: 20,
                    llm_quota_resets_at: null,
                    llm_configured: true,
                    last_verified_at: null,
                    can_process: true,
                    server_error: null
                  };
                }
                if (command === "plugin:deep-link|get_current") {
                  return [];
                }
                if (command === "plugin:event|listen") {
                  return 1;
                }
                if (command === "plugin:event|unlisten") {
                  return null;
                }
                if (command === "process_video") {
                  return {
                    status: "completed",
                    task_id: "task-1",
                    task_dir: "C:/FrameQ/outputs/tasks/task-1",
                    artifacts: {
                      video: "media/video.mp4",
                      audio: "media/audio.wav",
                      transcript_txt: "transcript/transcript.txt",
                      transcript_md: "transcript/transcript.md"
                    },
                    text: "transcript",
                    summary: "",
                    insights: [],
                    error: null
                  };
                }
                throw new Error("Unexpected command: " + command);
              },
              convertFileSrc: (filePath) => filePath
            };
          })();
        `,
      });
      const loaded = page.waitForEvent("Page.loadEventFired");
      await page.send("Page.navigate", { url: appUrl });
      await loaded;
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.command-panel')) && !document.querySelector('.result-workspace')",
      );

      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('#video-url').focus()",
      });
      await page.send("Input.insertText", { text: shareText });
      await waitForRuntimeCondition(page, "!document.querySelector('.primary-button').disabled");
      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('.primary-button').click()",
      });
      await waitForRuntimeCondition(
        page,
        "window.__FRAMEQ_TEST_COMMANDS__.some((entry) => entry.command === 'process_video')",
      );

      const submitted = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const entry = window.__FRAMEQ_TEST_COMMANDS__.find((item) =>
              item.command === 'process_video'
            );
            return {
              submittedUrl: entry?.args?.request?.url ?? null
            };
          })()`,
          returnByValue: true,
        },
      );

      expect(submitted.result.value).toEqual({
        submittedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
      });
    } finally {
      page.close();
    }
  }, 10_000);

  test("returns to the paste-link screen after signing out from a completed task", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent(appUrl)}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `
          (() => {
            let callbackId = 1;
            const callbacks = {};
            window.__FRAMEQ_TEST_COMMANDS__ = [];
            window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
              unregisterListener: () => {}
            };
            window.__TAURI_INTERNALS__ = {
              callbacks,
              transformCallback: (callback) => {
                const id = callbackId++;
                callbacks[id] = callback;
                return id;
              },
              unregisterCallback: (id) => {
                delete callbacks[id];
              },
              invoke: async (command, args) => {
                window.__FRAMEQ_TEST_COMMANDS__.push({ command, args });
                if (command === "check_first_run") {
                  return {
                    user_data_dir: "C:/FrameQ",
                    default_output_dir: "C:/FrameQ/outputs",
                    asr_model: "iic/SenseVoiceSmall",
                    asr_model_dir: "C:/FrameQ/models/SenseVoiceSmall",
                    asr_model_available: true,
                    asr_model_source: "modelscope"
                  };
                }
                if (command === "get_account_status") {
                  return {
                    authenticated: true,
                    email: "tester@frameq.local",
                    entitlement_status: "active",
                    entitlement_expires_at: null,
                    llm_quota_limit: 20,
                    llm_quota_used: 0,
                    llm_quota_remaining: 20,
                    llm_quota_resets_at: null,
                    llm_configured: true,
                    last_verified_at: null,
                    can_process: true,
                    server_error: null
                  };
                }
                if (command === "plugin:deep-link|get_current") {
                  return [];
                }
                if (command === "plugin:event|listen") {
                  return 1;
                }
                if (command === "plugin:event|unlisten") {
                  return null;
                }
                if (command === "process_video") {
                  return {
                    status: "completed",
                    task_id: "task-1",
                    task_dir: "C:/FrameQ/outputs/tasks/task-1",
                    artifacts: {
                      video: "media/video.mp4",
                      audio: "media/audio.wav",
                      transcript_txt: "transcript/transcript.txt",
                      transcript_md: "transcript/transcript.md"
                    },
                    text: "完成后的文字稿",
                    summary: "",
                    insights: [],
                    error: null
                  };
                }
                if (command === "logout_account") {
                  return null;
                }
                if (command === "cancel_process") {
                  return { cancelled: true, error: null };
                }
                throw new Error("Unexpected command: " + command);
              },
              convertFileSrc: (filePath) => filePath
            };
          })();
        `,
      });
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 1180,
        height: 760,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const loaded = page.waitForEvent("Page.loadEventFired");
      await page.send("Page.navigate", { url: appUrl });
      await loaded;
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.command-panel')) && !document.querySelector('.result-workspace')",
      );

      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('#video-url').focus()",
      });
      await page.send("Input.insertText", { text: pastedUrl });
      await waitForRuntimeCondition(page, "!document.querySelector('.primary-button').disabled");
      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('.primary-button').click()",
      });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.result-workspace')) && !document.querySelector('.command-panel')",
      );

      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('.account-chip').click()",
      });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.account-sheet .sheet-footer .secondary-button')) && !document.querySelector('.account-sheet .sheet-footer .secondary-button').disabled",
      );
      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('.account-sheet .sheet-footer .secondary-button').click()",
      });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.command-panel')) && !document.querySelector('.result-workspace') && !document.querySelector('.account-sheet')",
      );

      const afterSignOut = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `({
            hasCommandPanel: Boolean(document.querySelector('.command-panel')),
            hasResultWorkspace: Boolean(document.querySelector('.result-workspace')),
            hasAccountSheet: Boolean(document.querySelector('.account-sheet')),
            accountChipActive: Boolean(document.querySelector('.account-chip.active')),
            videoUrlValue: document.querySelector('#video-url')?.value ?? null,
            commands: window.__FRAMEQ_TEST_COMMANDS__.map((entry) => entry.command)
          })`,
          returnByValue: true,
        },
      );

      expect(afterSignOut.result.value).toMatchObject({
        hasCommandPanel: true,
        hasResultWorkspace: false,
        hasAccountSheet: false,
        accountChipActive: false,
        videoUrlValue: "",
      });
      expect(afterSignOut.result.value.commands).toContain("logout_account");
    } finally {
      page.close();
    }
  }, 10_000);
});

describe("App desktop sheet structure", () => {
  test("opens settings as a grouped macOS-style sheet", async () => {
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

      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('button[aria-label=\"应用设置\"]').click()",
      });
      await waitForRuntimeCondition(page, "document.body.innerText.includes('应用设置')");

      const sheet = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `({
            hasSheetPanel: Boolean(document.querySelector('.sheet-panel.settings-sheet')),
            groupedSections: document.querySelectorAll('.sheet-form-section').length,
            hasConfigFileSection: Boolean(document.querySelector('.settings-config-file-section')),
            hasUpdateSection: Boolean(document.querySelector('.update-settings-section')),
            hasLocateConfigButton: Boolean(document.querySelector('.config-file-row button')),
            hasPrivacyCallout: Boolean(document.querySelector('.privacy-callout')),
            hasStickyFooter: Boolean(document.querySelector('.sheet-footer')),
            hasScrollableBody: getComputedStyle(document.querySelector('.settings-form')).overflowY === 'auto'
          })`,
          returnByValue: true,
        },
      );

      expect(sheet.result.value).toEqual({
        hasSheetPanel: true,
        groupedSections: 3,
        hasConfigFileSection: true,
        hasUpdateSection: true,
        hasLocateConfigButton: true,
        hasPrivacyCallout: true,
        hasStickyFooter: true,
        hasScrollableBody: true,
      });
    } finally {
      page.close();
    }
  }, 10_000);
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
                  '<header class="modal-header"><h2>应用设置</h2><button class="icon-button">x</button></header>' +
                  '<form class="settings-form">' +
                    '<p class="settings-warning">这里管理本机 ASR、输出目录和配置文件位置。</p>' +
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
  }, 10_000);
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
      const response = new Promise<T>((resolve, reject) => {
        pending.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
        });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return response;
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

function chromeDiagnostics() {
  const parts = [];
  if (chromeExit) {
    parts.push(`exit=${chromeExit.code ?? "null"}/${chromeExit.signal ?? "null"}`);
  }
  if (chromeStderr.trim()) {
    parts.push(`stderr=${chromeStderr.trim()}`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

async function waitForChrome(port: number, diagnostics = () => "") {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await requestJson(port, "/json/version");
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Chrome DevTools endpoint did not become ready.${diagnostics()}`);
}

async function stopChromeProcess() {
  const process = chromeProcess;
  if (!process) {
    return;
  }
  if (process.exitCode !== null || process.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    process.once("exit", () => resolve());
    process.kill();
    setTimeout(resolve, 2_000);
  });
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
