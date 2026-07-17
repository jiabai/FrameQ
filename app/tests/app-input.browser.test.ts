import react from "@vitejs/plugin-react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createNetServer, type AddressInfo } from "node:net";

import {
  createUiSmokeBridgeScript,
  type UiSmokeScenario,
} from "./support/mockTauriBridge";

type CdpEvent = {
  method: string;
  params: unknown;
};

type CdpTarget = {
  webSocketDebuggerUrl: string;
};

const pastedUrl = "https://www.douyin.com/video/7646789377271647540";
const smokeVideoUrl = "https://www.douyin.com/video/7000000000000000003";
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

  await startChromeProcess();
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
      `/json/new?${encodeURIComponent("about:blank")}`,
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
      await page.send("Page.navigate", { url: appUrl });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.app-shell')) && getComputedStyle(document.querySelector('.app-shell')).display === 'grid'",
        15_000,
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
              '.toolbar-title > div',
              '.toolbar-title h1'
            ].every((selector) => document.querySelector(selector)?.hasAttribute('data-tauri-drag-region')),
            toolbarStageBadges: document.querySelectorAll('.app-toolbar .stage-badge').length,
            localBadges: document.querySelectorAll('.command-panel .local-badge').length,
            showsLocalFirstCopy: document.querySelector('.command-panel')?.textContent.includes('本地优先') ?? false,
            visibleUrlLabels: document.querySelectorAll('.command-panel .field-label').length,
            videoUrlAriaLabel: document.querySelector('#video-url')?.getAttribute('aria-label') ?? '',
            videoUrlPlaceholder: document.querySelector('#video-url')?.getAttribute('placeholder') ?? '',
            hasCommandPanel: Boolean(document.querySelector('.command-panel')),
            hasTaskWorkspaces: Boolean(document.querySelector('.task-workspace-layout')),
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
        trafficLightButtons: ["Close window", "Minimize window", "Maximize or restore window"],
        hasToolbar: true,
        toolbarDragRegion: true,
        innerDragRegions: true,
        toolbarStageBadges: 0,
        localBadges: 0,
        showsLocalFirstCopy: false,
        visibleUrlLabels: 0,
        videoUrlAriaLabel: "Video URL",
        videoUrlPlaceholder: "Paste a supported public video link",
        hasCommandPanel: true,
        hasTaskWorkspaces: false,
        primaryButtonText: "Confirm",
      });
      expect(structure.result.value.commandPanelWidth).toBeGreaterThanOrEqual(720);
      expect(structure.result.value.commandPanelWidth).toBeLessThanOrEqual(820);
      expect(structure.result.value.desktopWindowWidth).toBe(1180);
    } finally {
      await page.close();
    }
  }, 20_000);

  test("shows the processing workspace only after the URL is submitted", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent("about:blank")}`,
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
      await page.send("Page.navigate", { url: appUrl });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.command-panel')) && !document.querySelector('.task-workspace-layout')",
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
        "Boolean(document.querySelector('.local-transcript-workspace')) && Boolean(document.querySelector('.ai-generation-workspace'))",
      );

      const afterSubmit = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `({
            hasCommandPanel: Boolean(document.querySelector('.command-panel')),
            hasLocalWorkspace: Boolean(document.querySelector('.local-transcript-workspace')),
            hasAiWorkspace: Boolean(document.querySelector('.ai-generation-workspace')),
            localTitle: document.querySelector('.local-transcript-workspace h2')?.textContent ?? '',
            toolbarStageBadges: document.querySelectorAll('.app-toolbar .stage-badge').length,
            localProgressSteps: document.querySelectorAll('.local-progress > span').length,
            activeLayoutDisplay: getComputedStyle(document.querySelector('.workspace')).display,
            localTop: Math.round(document.querySelector('.local-transcript-workspace').getBoundingClientRect().top),
            aiTop: Math.round(document.querySelector('.ai-generation-workspace').getBoundingClientRect().top)
          })`,
          returnByValue: true,
        },
      );

      expect(afterSubmit.result.value).toMatchObject({
        hasCommandPanel: false,
        hasLocalWorkspace: true,
        hasAiWorkspace: true,
        localTitle: "Local Transcription",
        toolbarStageBadges: 0,
        localProgressSteps: 2,
        activeLayoutDisplay: "flex",
      });
      expect(afterSubmit.result.value.localTop).toBe(afterSubmit.result.value.aiTop);

      await page.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await waitForRuntimeCondition(
        page,
        "Array.from(document.querySelectorAll('.spin')).every((element) => getComputedStyle(element).animationName === 'processing-pulse')",
      );
      const reducedMotion = await evaluateValue<Array<{ name: string; duration: string }>>(
        page,
        `Array.from(document.querySelectorAll('.spin')).map((element) => ({
          name: getComputedStyle(element).animationName,
          duration: getComputedStyle(element).animationDuration
        }))`,
      );
      expect(reducedMotion.length).toBeGreaterThanOrEqual(2);
      expect(reducedMotion).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "processing-pulse", duration: "1.8s" }),
        ]),
      );

      await page.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
      });
      await waitForRuntimeCondition(
        page,
        "Array.from(document.querySelectorAll('.spin')).every((element) => getComputedStyle(element).animationName === 'spin')",
      );
      const standardMotion = await evaluateValue<Array<{ name: string; duration: string }>>(
        page,
        `Array.from(document.querySelectorAll('.spin')).map((element) => ({
          name: getComputedStyle(element).animationName,
          duration: getComputedStyle(element).animationDuration
        }))`,
      );
      expect(standardMotion).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "spin", duration: "1s" }),
        ]),
      );
    } finally {
      await page.close();
    }
  }, 10_000);

  test("keeps the app mounted after a valid Douyin URL is pasted", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent("about:blank")}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Log.enable");
      await page.send("Page.navigate", { url: appUrl });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.app-shell')) && getComputedStyle(document.querySelector('.app-shell')).display === 'grid'",
      );

      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('#video-url').focus()",
      });
      await page.send("Input.insertText", { text: pastedUrl });
      await waitForRuntimeCondition(
        page,
        `document.querySelector('#video-url')?.value === ${JSON.stringify(pastedUrl)} && !document.querySelector('.primary-button')?.disabled`,
      );

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
      expect(afterState.bodyText).toContain("FrameQ");
      expect(afterState.primaryDisabled).toBe(false);
    } finally {
      await page.close();
    }
  });

  test("submits the normalized supported URL extracted from share text", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent("about:blank")}`,
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
                if (command === "get_ui_preferences") {
                  return { schemaVersion: 1, language: "system", recovered: false };
                }
                if (command === "save_ui_preferences") {
                  return {
                    schemaVersion: 1,
                    language: args?.preferences?.language,
                    recovered: false
                  };
                }
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
      await page.send("Page.navigate", { url: appUrl });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.command-panel')) && !document.querySelector('.task-workspace-layout')",
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
      await page.close();
    }
  }, 10_000);

  test("returns to the paste-link screen after signing out from a completed task", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent("about:blank")}`,
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
                if (command === "get_ui_preferences") {
                  return { schemaVersion: 1, language: "system", recovered: false };
                }
                if (command === "save_ui_preferences") {
                  return {
                    schemaVersion: 1,
                    language: args?.preferences?.language,
                    recovered: false
                  };
                }
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
      await page.send("Page.navigate", { url: appUrl });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.command-panel')) && !document.querySelector('.task-workspace-layout')",
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
        "Boolean(document.querySelector('.task-workspace-layout')) && !document.querySelector('.command-panel')",
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
        "Boolean(document.querySelector('.command-panel')) && !document.querySelector('.task-workspace-layout') && !document.querySelector('.account-sheet')",
      );

      const afterSignOut = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `({
            hasCommandPanel: Boolean(document.querySelector('.command-panel')),
            hasTaskWorkspaces: Boolean(document.querySelector('.task-workspace-layout')),
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
        hasTaskWorkspaces: false,
        hasAccountSheet: false,
        accountChipActive: false,
        videoUrlValue: "",
      });
      expect(afterSignOut.result.value.commands).toContain("logout_account");
    } finally {
      await page.close();
    }
  }, 10_000);
});

describe("App desktop sheet structure", () => {
  test("uses a deterministic mock bridge for UI lifecycle smoke", () => {
    expect(createUiSmokeBridgeScript({})).toContain("__FRAMEQ_UI_SMOKE__");
  });

  test("opens settings as a grouped macOS-style sheet", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent("about:blank")}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: createUiSmokeBridgeScript({}),
      });
      await page.send("Page.navigate", { url: appUrl });
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
            activeCategory: document.querySelector('.settings-layout')?.getAttribute('data-active-settings-category'),
            hasBasicSection: Boolean(document.querySelector('#settings-basic')),
            hasConfigFileSection: Boolean(document.querySelector('.settings-config-file-section')),
            hasUpdateSection: Boolean(document.querySelector('.update-settings-section')),
            hasInspirationSection: Boolean(document.querySelector('.inspiration-settings-section')),
            hasSettingsLayout: Boolean(document.querySelector('.settings-layout')),
            hasSettingsNav: Boolean(document.querySelector('.settings-nav')),
            selectedNavCount: document.querySelectorAll('.settings-nav-item.selected').length,
            hasLocateConfigButton: Boolean(document.querySelector('.config-file-row button')),
            hasBasicNotice: Boolean(document.querySelector('.settings-basic-note')),
            hasLanguageSelector: Boolean(document.querySelector('#ui-language-preference')),
            languageSectionIsFirst: document.querySelector('.settings-sections')?.firstElementChild?.classList.contains('language-settings-section') ?? false,
            hasStickyFooter: Boolean(document.querySelector('.sheet-footer')),
            hasScrollableBody: getComputedStyle(document.querySelector('.settings-sections')).overflowY === 'auto'
          })`,
          returnByValue: true,
        },
      );

      expect(sheet.result.value).toEqual({
        hasSheetPanel: true,
        groupedSections: 2,
        activeCategory: "basic",
        hasBasicSection: true,
        hasConfigFileSection: false,
        hasUpdateSection: false,
        hasInspirationSection: false,
        hasSettingsLayout: true,
        hasSettingsNav: true,
        selectedNavCount: 1,
        hasLocateConfigButton: false,
        hasBasicNotice: true,
        hasLanguageSelector: true,
        languageSectionIsFirst: true,
        hasStickyFooter: true,
        hasScrollableBody: true,
      });

      const languageSwitch = await page.send<{
        result: { value: { asrModel: string; outputDir: string } };
      }>("Runtime.evaluate", {
        expression: `(() => {
          const asrModel = document.querySelector('#settings-basic select')?.value ?? '';
          const outputDir = document.querySelector('#settings-basic input')?.value ?? '';
          const selector = document.querySelector('#ui-language-preference');
          selector.value = 'zh-TW';
          selector.dispatchEvent(new Event('change', { bubbles: true }));
          return { asrModel, outputDir };
        })()`,
        returnByValue: true,
      });
      await waitForRuntimeCondition(
        page,
        "document.documentElement.lang === 'zh-TW' && document.querySelector('.language-settings-section h3')?.textContent.includes('介面')",
      );
      const afterLanguageSwitch = await page.send<{
        result: { value: Record<string, unknown> };
      }>("Runtime.evaluate", {
        expression: `({
          preference: document.querySelector('#ui-language-preference')?.value,
          lang: document.documentElement.lang,
          dir: document.documentElement.dir,
          asrModel: document.querySelector('#settings-basic select')?.value ?? '',
          outputDir: document.querySelector('#settings-basic input')?.value ?? '',
          saveCall: window.__FRAMEQ_UI_SMOKE__.commands.find((entry) => entry.command === 'save_ui_preferences')
        })`,
        returnByValue: true,
      });
      expect(afterLanguageSwitch.result.value).toMatchObject({
        preference: "zh-TW",
        lang: "zh-TW",
        dir: "ltr",
        asrModel: languageSwitch.result.value.asrModel,
        outputDir: languageSwitch.result.value.outputDir,
        saveCall: {
          command: "save_ui_preferences",
          args: { preferences: { language: "zh-TW" } },
        },
      });

      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('[data-settings-category=\"inspiration\"]').click()",
      });
      await waitForRuntimeCondition(page, "Boolean(document.querySelector('#settings-inspiration'))");

      const switchedSheet = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `({
            activeCategory: document.querySelector('.settings-layout')?.getAttribute('data-active-settings-category'),
            groupedSections: document.querySelectorAll('.sheet-form-section').length,
            hasBasicSection: Boolean(document.querySelector('#settings-basic')),
            hasInspirationSection: Boolean(document.querySelector('#settings-inspiration')),
            hasBasicNotice: Boolean(document.querySelector('.settings-basic-note')),
            selectedNavText: document.querySelector('.settings-nav-item.selected')?.textContent ?? '',
            inspirationHeading: document.querySelector('#settings-inspiration .form-section-heading h3')?.textContent ?? '',
            profileTitle: document.querySelector('.inspiration-profile-card strong')?.textContent ?? '',
            editProfileText: document.querySelector('.profile-edit-button')?.textContent ?? '',
            actionDisplay: getComputedStyle(document.querySelector('.inspiration-settings-actions')).display,
            actionWrap: getComputedStyle(document.querySelector('.inspiration-settings-actions')).flexWrap,
            clearButtonColor: getComputedStyle(document.querySelector('.profile-clear-button')).color,
            actionsSameRow: Math.abs(
              document.querySelector('.profile-edit-button').getBoundingClientRect().top -
              document.querySelector('.profile-clear-button').getBoundingClientRect().top
            ) < 2
          })`,
          returnByValue: true,
        },
      );

      expect(switchedSheet.result.value).toMatchObject({
        activeCategory: "inspiration",
        groupedSections: 1,
        hasBasicSection: false,
        hasInspirationSection: true,
        hasBasicNotice: false,
        selectedNavText: expect.stringContaining("靈感"),
        inspirationHeading: "靈感檔案",
        profileTitle: "我的靈感檔案",
        editProfileText: expect.stringContaining("編輯靈感檔案"),
        actionDisplay: "flex",
        actionWrap: "nowrap",
        clearButtonColor: "rgb(52, 54, 59)",
        actionsSameRow: true,
      });
    } finally {
      await page.close();
    }
  }, 10_000);

  test("shows and clears audio playback cache from settings", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent("about:blank")}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `
          (() => {
            window.__FRAMEQ_TEST_COMMANDS__ = [];
            window.__TAURI_INTERNALS__ = {
              invoke: async (command, args) => {
                window.__FRAMEQ_TEST_COMMANDS__.push({ command, args });
                if (command === "get_ui_preferences") {
                  return { schemaVersion: 1, language: "system", recovered: false };
                }
                if (command === "save_ui_preferences") {
                  return {
                    schemaVersion: 1,
                    language: args?.preferences?.language,
                    recovered: false
                  };
                }
                if (command === "get_llm_config") {
                  return {
                    output_dir: "D:/FrameQ/outputs",
                    asr_model: "iic/SenseVoiceSmall",
                    supported_asr_models: ["iic/SenseVoiceSmall"],
                    config_path: "C:/Users/demo/AppData/Local/FrameQ/.env"
                  };
                }
                if (command === "get_audio_review_cache_usage") {
                  return {
                    size_bytes: 1572864,
                    cache_path: "C:/Users/demo/AppData/Local/FrameQ/cache/.frameq-audio-review"
                  };
                }
                if (command === "clear_audio_review_cache") {
                  return {
                    size_bytes: 0,
                    cache_path: "C:/Users/demo/AppData/Local/FrameQ/cache/.frameq-audio-review"
                  };
                }
                if (command === "check_first_run") {
                  return {
                    user_data_dir: "C:/Users/demo/AppData/Local/FrameQ",
                    default_output_dir: "C:/Users/demo/AppData/Local/FrameQ/outputs",
                    asr_model: "iic/SenseVoiceSmall",
                    asr_model_dir: "C:/Users/demo/AppData/Local/FrameQ/models",
                    asr_model_available: true,
                    asr_model_source: "modelscope"
                  };
                }
                if (command === "get_account_status") {
                  return {
                    authenticated: false,
                    email: null,
                    entitlement_status: "none",
                    entitlement_expires_at: null,
                    llm_quota_limit: 0,
                    llm_quota_used: 0,
                    llm_quota_remaining: 0,
                    llm_quota_resets_at: null,
                    llm_configured: false,
                    last_verified_at: null,
                    can_process: false,
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
                throw new Error("Unexpected command: " + command);
              },
              convertFileSrc: (filePath) => filePath
            };
          })();
        `,
      });
      await page.send("Page.navigate", { url: appUrl });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.app-shell')) && getComputedStyle(document.querySelector('.app-shell')).display === 'grid'",
      );

      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('button[aria-label=\"应用设置\"]').click()",
      });
      await waitForRuntimeCondition(page, "Boolean(document.querySelector('[data-settings-category=\"storage\"]'))");
      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('[data-settings-category=\"storage\"]').click()",
      });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.audio-cache-settings-section')) && document.querySelector('.audio-cache-settings-section')?.textContent.includes('1.5 MB')",
      );

      await page.send("Runtime.evaluate", {
        expression: "document.querySelector('.audio-cache-settings-section button').click()",
      });
      await waitForRuntimeCondition(
        page,
        "document.querySelector('.audio-cache-settings-section')?.textContent.includes('0 B')",
      );

      const commands = await page.send<{ result: { value: Record<string, unknown> } }>(
        "Runtime.evaluate",
        {
          expression: `({
            commands: window.__FRAMEQ_TEST_COMMANDS__.map((entry) => entry.command),
            hasAudioCacheSection: Boolean(document.querySelector('.audio-cache-settings-section')),
            hasBasicNotice: Boolean(document.querySelector('.settings-basic-note')),
            text: document.querySelector('.audio-cache-settings-section')?.textContent ?? ''
          })`,
          returnByValue: true,
        },
      );

      expect(commands.result.value.commands).toContain("get_audio_review_cache_usage");
      expect(commands.result.value.commands).toContain("clear_audio_review_cache");
      expect(commands.result.value.hasAudioCacheSection).toBe(true);
      expect(commands.result.value.hasBasicNotice).toBe(false);
      expect(commands.result.value.text).toContain("0 B");
    } finally {
      await page.close();
    }
  }, 10_000);
});

describe.sequential("App controller-owned lifecycle UI smoke", () => {
  test("renders settings loading and failure states and clears only the audio review cache", async () => {
    const page = await openUiSmokePage({ deferredCommands: ["get_llm_config"] });

    try {
      await clickSelector(page, 'button[aria-label="应用设置"]');
      await waitForRuntimeCondition(
        page,
        "document.querySelector('.settings-sheet .inline-notice')?.textContent.includes('正在读取配置')",
      );

      await resolveUiSmokeCommand(page, "get_llm_config");
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('[data-settings-category=\"storage\"]')) && !document.querySelector('.settings-sheet .inline-notice')?.textContent.includes('正在读取配置')",
      );
      await clickSelector(page, '[data-settings-category="storage"]');
      await waitForRuntimeCondition(
        page,
        "document.querySelector('.audio-cache-settings-section')?.textContent.includes('1.5 MB')",
      );
      await clickSelector(page, ".audio-cache-settings-section button");
      await waitForRuntimeCondition(
        page,
        "document.querySelector('.audio-cache-settings-section')?.textContent.includes('0 B')",
      );

      const commands = await readUiSmokeCommands(page);
      expect(commands.map((entry) => entry.command)).toContain("clear_audio_review_cache");
      expect(
        commands
          .map((entry) => entry.command)
          .filter((command) => command.startsWith("clear_")),
      ).toEqual(["clear_audio_review_cache"]);
      expectForbiddenProductCommandsAbsent(commands);
    } finally {
      await page.close();
    }

    const failedPage = await openUiSmokePage({
      rejectedCommands: { get_llm_config: "settings unavailable" },
    });
    try {
      await clickSelector(failedPage, 'button[aria-label="应用设置"]');
      await waitForRuntimeCondition(
        failedPage,
        "document.querySelector('.settings-sheet .inline-notice')?.textContent.includes('读取配置失败，请稍后重试。')",
      );
      const failureState = await evaluateValue<Record<string, unknown>>(
        failedPage,
        `({
          notice: document.querySelector('.settings-sheet .inline-notice')?.textContent ?? '',
          saveDisabled: document.querySelector('.settings-sheet .sheet-footer .primary-button')?.disabled ?? null
        })`,
      );
      expect(failureState.notice).toContain("读取配置失败，请稍后重试。");
      expect(failureState.notice).not.toContain("settings unavailable");
      expect(failureState.saveDisabled).toBe(false);
      expectForbiddenProductCommandsAbsent(await readUiSmokeCommands(failedPage));
    } finally {
      await failedPage.close();
    }
  }, 30_000);

  test("keeps the English settings UI usable at the 720 by 640 minimum window", async () => {
    const page = await openUiSmokePage({});

    try {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 720,
        height: 640,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await waitForRuntimeCondition(
        page,
        "window.innerWidth === 720 && window.innerHeight === 640",
      );
      await clickSelector(page, 'button[aria-label="应用设置"]');
      await waitForRuntimeCondition(page, "Boolean(document.querySelector('#ui-language-preference'))");
      await page.send("Runtime.evaluate", {
        expression: `(() => {
          const selector = document.querySelector('#ui-language-preference');
          selector.value = 'en-US';
          selector.dispatchEvent(new Event('change', { bubbles: true }));
        })()`,
      });
      await waitForRuntimeCondition(
        page,
        "document.documentElement.lang === 'en-US' && document.body.innerText.includes('Interface & AI result language')",
      );

      const layout = await evaluateValue<Record<string, unknown>>(
        page,
        `(() => {
          const sheet = document.querySelector('.settings-sheet');
          const sections = document.querySelector('.settings-sections');
          const saveButton = document.querySelector('.settings-sheet .sheet-footer .primary-button');
          const sheetRect = sheet.getBoundingClientRect();
          const saveRect = saveButton.getBoundingClientRect();
          const offscreenControls = Array.from(
            sheet.querySelectorAll('button, input, select, a[href]')
          ).filter((element) => {
            const rect = element.getBoundingClientRect();
            const visible = rect.width > 0 && rect.height > 0;
            return visible && (rect.left < -1 || rect.right > window.innerWidth + 1);
          }).length;
          return {
            documentLanguage: document.documentElement.lang,
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            viewportWidth: window.innerWidth,
            sheetLeft: sheetRect.left,
            sheetRight: sheetRect.right,
            saveTop: saveRect.top,
            saveBottom: saveRect.bottom,
            viewportHeight: window.innerHeight,
            offscreenControls,
            sectionsOverflowY: getComputedStyle(sections).overflowY,
            saveText: saveButton.textContent ?? ''
          };
        })()`,
      );

      expect(layout).toMatchObject({
        documentLanguage: "en-US",
        viewportWidth: 720,
        viewportHeight: 640,
        offscreenControls: 0,
        sectionsOverflowY: "auto",
        saveText: "Save settings",
      });
      expect(Number(layout.documentWidth)).toBeLessThanOrEqual(720);
      expect(Number(layout.bodyWidth)).toBeLessThanOrEqual(720);
      expect(Number(layout.sheetLeft)).toBeGreaterThanOrEqual(0);
      expect(Number(layout.sheetRight)).toBeLessThanOrEqual(720);
      expect(Number(layout.saveTop)).toBeGreaterThanOrEqual(0);
      expect(Number(layout.saveBottom)).toBeLessThanOrEqual(640);
      expectForbiddenProductCommandsAbsent(await readUiSmokeCommands(page));
    } finally {
      await page.close();
    }
  }, 15_000);

  test("traps modal keyboard focus and restores the settings trigger on close", async () => {
    const page = await openUiSmokePage({});

    try {
      await page.send("Runtime.evaluate", {
        expression: `(() => {
          const trigger = document.querySelector('button[aria-label="应用设置"]');
          trigger.focus();
          trigger.click();
        })()`,
      });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.settings-sheet'))",
      );

      expect(
        await evaluateValue<Record<string, boolean>>(
          page,
          `(() => {
            const dialog = document.querySelector('.settings-sheet');
            const background = document.querySelector('.desktop-window');
            return {
              focusInside: dialog.contains(document.activeElement),
              backgroundInert: background.inert === true,
            };
          })()`,
        ),
      ).toEqual({ focusInside: true, backgroundInert: true });

      await page.send("Runtime.evaluate", {
        expression: `(() => {
          const dialog = document.querySelector('.settings-sheet');
          const focusable = [...dialog.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
          )].filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
          focusable.at(-1)?.focus();
        })()`,
      });
      await page.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
      });
      await page.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
      });
      expect(
        await evaluateValue<boolean>(
          page,
          `(() => {
            const dialog = document.querySelector('.settings-sheet');
            const focusable = [...dialog.querySelectorAll(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            )].filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
            return document.activeElement === focusable[0];
          })()`,
        ),
      ).toBe(true);

      await page.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
        modifiers: 8,
      });
      await page.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
        modifiers: 8,
      });
      expect(
        await evaluateValue<boolean>(
          page,
          `(() => {
            const dialog = document.querySelector('.settings-sheet');
            const focusable = [...dialog.querySelectorAll(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            )].filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
            return document.activeElement === focusable.at(-1);
          })()`,
        ),
      ).toBe(true);

      await page.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await page.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await waitForRuntimeCondition(
        page,
        "!document.querySelector('.settings-sheet')",
      );
      expect(
        await evaluateValue<Record<string, boolean | string>>(
          page,
          `(() => ({
            restoredLabel: document.activeElement?.getAttribute('aria-label') ?? '',
            backgroundInert: document.querySelector('.desktop-window').inert === true,
          }))()`,
        ),
      ).toEqual({ restoredLabel: "应用设置", backgroundInert: false });
    } finally {
      await page.close();
    }
  }, 15_000);

  test("renders one task as aligned local transcript and AI workspaces and stacks them below 1100px", async () => {
    const page = await openUiSmokePage({
      responses: {
        load_transcript_detail: {
          text: "本地文字稿第一段。本地文字稿第二段。",
          segments: [
            { id: "segment-1", start_ms: 0, end_ms: 5000, text: "本地文字稿第一段。" },
            { id: "segment-2", start_ms: 5000, end_ms: 9000, text: "本地文字稿第二段。" },
          ],
          audio_path: "C:/FrameQ/outputs/tasks/history-task-a/media/audio.wav",
          audio_asset_path: "C:/FrameQ/cache/audio-review/history-task-a.wav",
          has_original_backup: false,
        },
      },
    });

    try {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 1366,
        height: 960,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await waitForRuntimeCondition(page, "window.innerWidth === 1366");
      await openSmokeHistory(page);
      await clickSelector(page, ".history-item-select");
      await waitForRuntimeCondition(page, "!document.querySelector('.history-sheet')");
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.task-workspace-layout')) && document.querySelectorAll('.task-domain-workspace').length === 2 && Boolean(document.querySelector('.audio-review-bar')) && document.querySelectorAll('.transcript-segment').length === 2",
      );

      const wide = await evaluateValue<{
        columns: number;
        topDelta: number;
        localRatio: number;
        aiWidth: number;
        localWidth: number;
        layoutWidth: number;
        viewportWidth: number;
        sameTask: boolean;
        completionBanner: boolean;
        localScrollable: boolean;
        audioDirectChildren: number;
        audioCenterSpread: number;
        audioPaddingDelta: number;
        segmentListBordered: boolean;
        segmentRowsBorderless: boolean;
        targetListBordered: boolean;
        targetRowsBorderless: boolean;
        noEnglishEyebrows: boolean;
        noRedundantWorkspaceStatus: boolean;
        quietTargetActions: boolean;
      }>(
        page,
        `(() => {
          const layout = document.querySelector('.task-workspace-layout');
          const local = document.querySelector('.local-transcript-workspace');
          const ai = document.querySelector('.ai-generation-workspace');
          const review = document.querySelector('.transcript-review-scroll');
          const audioBar = document.querySelector('.audio-review-bar');
          const playButton = audioBar.querySelector('.audio-play-button');
          const scrubber = audioBar.querySelector('.audio-review-scrubber');
          const clock = audioBar.querySelector('.audio-review-clock');
          const segmentList = document.querySelector('.transcript-segments');
          const segments = [...document.querySelectorAll('.transcript-segment')];
          const targetList = document.querySelector('.ai-target-list');
          const targetRows = [...document.querySelectorAll('.ai-target-card')];
          const localRect = local.getBoundingClientRect();
          const aiRect = ai.getBoundingClientRect();
          const audioBarRect = audioBar.getBoundingClientRect();
          const playRect = playButton.getBoundingClientRect();
          const scrubberRect = scrubber.getBoundingClientRect();
          const clockRect = clock.getBoundingClientRect();
          const audioCenters = [playRect, scrubberRect, clockRect].map((rect) => rect.top + rect.height / 2);
          return {
            columns: getComputedStyle(layout).gridTemplateColumns.split(' ').length,
            topDelta: Math.abs(localRect.top - aiRect.top),
            localRatio: localRect.width / (localRect.width + aiRect.width),
            aiWidth: aiRect.width,
            localWidth: localRect.width,
            layoutWidth: layout.getBoundingClientRect().width,
            viewportWidth: window.innerWidth,
            sameTask: local.dataset.taskId === ai.dataset.taskId && local.dataset.taskId === 'history-task-a',
            completionBanner: document.querySelector('.task-status-banner')?.textContent.includes('视频、音频和文字稿已保存在本机') ?? false,
            localScrollable: review ? ['auto', 'scroll'].includes(getComputedStyle(review).overflowY) : false,
            audioDirectChildren: audioBar.children.length,
            audioCenterSpread: Math.max(...audioCenters) - Math.min(...audioCenters),
            audioPaddingDelta: Math.abs(
              (playRect.left - audioBarRect.left) - (audioBarRect.right - clockRect.right)
            ),
            segmentListBordered: parseFloat(getComputedStyle(segmentList).borderTopWidth) === 1,
            segmentRowsBorderless: segments.every((item) => parseFloat(getComputedStyle(item).borderLeftWidth) === 0),
            targetListBordered: parseFloat(getComputedStyle(targetList).borderTopWidth) === 1,
            targetRowsBorderless: targetRows.every((item) => parseFloat(getComputedStyle(item).borderLeftWidth) === 0),
            noEnglishEyebrows: !document.body.innerText.includes('LOCAL TRANSCRIPT') && !document.body.innerText.includes('CLOUD AI'),
            noRedundantWorkspaceStatus: !document.querySelector('.local-transcript-workspace .workspace-status-badge') && !document.querySelector('.ai-generation-workspace .workspace-status-badge'),
            quietTargetActions: document.querySelectorAll('.ai-target-action').length === 2
          };
        })()`,
      );
      await captureTaskWorkspaceScreenshot(page, "wide");
      if (process.env.FRAMEQ_REPORT_TASK_WORKSPACES === "1") {
        console.info(`task-workspace-wide: ${JSON.stringify(wide)}`);
      }

      expect(wide.columns).toBe(2);
      expect(wide.topDelta).toBeLessThanOrEqual(1);
      expect(wide.localRatio).toBeGreaterThanOrEqual(0.58);
      expect(wide.localRatio).toBeLessThanOrEqual(0.66);
      expect(wide.aiWidth).toBeGreaterThanOrEqual(360);
      expect(wide.sameTask).toBe(true);
      expect(wide.completionBanner).toBe(true);
      expect(wide.localScrollable).toBe(true);
      expect(wide.audioDirectChildren).toBe(3);
      expect(wide.audioCenterSpread).toBeLessThanOrEqual(1);
      expect(wide.audioPaddingDelta).toBeLessThanOrEqual(1);
      expect(wide.segmentListBordered).toBe(true);
      expect(wide.segmentRowsBorderless).toBe(true);
      expect(wide.targetListBordered).toBe(true);
      expect(wide.targetRowsBorderless).toBe(true);
      expect(wide.noEnglishEyebrows).toBe(true);
      expect(wide.noRedundantWorkspaceStatus).toBe(true);
      expect(wide.quietTargetActions).toBe(true);

      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 900,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await waitForRuntimeCondition(
        page,
        "window.innerWidth === 900 && getComputedStyle(document.querySelector('.task-workspace-layout')).gridTemplateColumns.split(' ').length === 1",
      );
      const narrow = await evaluateValue<{
        stacked: boolean;
        contained: boolean;
      }>(
        page,
        `(() => {
          const layout = document.querySelector('.task-workspace-layout');
          const local = document.querySelector('.local-transcript-workspace').getBoundingClientRect();
          const ai = document.querySelector('.ai-generation-workspace').getBoundingClientRect();
          return {
            stacked: ai.top > local.bottom,
            contained: layout.scrollWidth <= layout.clientWidth + 1
          };
        })()`,
      );
      await captureTaskWorkspaceScreenshot(page, "narrow");
      writeTaskWorkspaceGeometry({ wide, narrow });
      expect(narrow).toEqual({ stacked: true, contained: true });
    } finally {
      await page.close();
    }
  }, 30_000);

  test("keeps the labelled account chip and grouped toolbar utilities aligned", async () => {
    const page = await openUiSmokePage({});

    try {
      for (const width of [1366, 720]) {
        await page.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await waitForRuntimeCondition(page, `window.innerWidth === ${width}`);
        const geometry = await evaluateValue<{
          accountHeight: number;
          centerDelta: number;
          toolCount: number;
          toolSizeSpread: number;
          toolbarContained: boolean;
        }>(
          page,
          `(() => {
            const toolbar = document.querySelector('.app-toolbar');
            const account = document.querySelector('.account-chip').getBoundingClientRect();
            const group = document.querySelector('.toolbar-tool-group').getBoundingClientRect();
            const tools = [...document.querySelectorAll('.toolbar-tool-group .icon-button')]
              .map((item) => item.getBoundingClientRect());
            return {
              accountHeight: account.height,
              centerDelta: Math.abs(
                (account.top + account.height / 2) - (group.top + group.height / 2)
              ),
              toolCount: tools.length,
              toolSizeSpread: Math.max(...tools.map((rect) => rect.width)) - Math.min(...tools.map((rect) => rect.width)),
              toolbarContained: toolbar.scrollWidth <= toolbar.clientWidth + 1
            };
          })()`,
        );

        expect(geometry.accountHeight).toBe(32);
        expect(geometry.centerDelta).toBeLessThanOrEqual(1);
        expect(geometry.toolCount).toBe(3);
        expect(geometry.toolSizeSpread).toBeLessThanOrEqual(1);
        expect(geometry.toolbarContained).toBe(true);
      }
    } finally {
      await page.close();
    }
  }, 15_000);

  test("keeps long history card titles clamped and metadata aligned responsively", async () => {
    const baseHistoryItem = {
      task_id: "history-layout-base",
      id: "history-layout-base",
      created_at: "2026-07-11T08:00:00.000Z",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      status: "completed",
      task_dir: "C:/FrameQ/outputs/tasks/history-layout-base",
      output_dir: "C:/FrameQ/outputs",
      artifacts: { transcript_txt: "transcript/transcript.txt" },
      error: null,
      text_preview: "History layout fixture",
      insights_count: 3,
    };
    const historyItems = [
      {
        ...baseHistoryItem,
        task_id: "history-layout-zh",
        id: "history-layout-zh",
        text_preview:
          "这是一段用于验证历史卡片两行截断和高度一致性的超长中文文字稿预览内容，需要足够长以稳定超出两行显示区域".repeat(4),
      },
      {
        ...baseHistoryItem,
        task_id: "history-layout-en",
        id: "history-layout-en",
        text_preview:
          "AnEnglishTranscriptPreviewWithOneVeryLongUnbrokenWordThatMustClampWithoutExpandingTheHistoryCardHeightBeyondTwoLines".repeat(4),
      },
      {
        ...baseHistoryItem,
        task_id: "history-layout-url",
        id: "history-layout-url",
        text_preview: "",
        url: "https://youtu.be/abcdefghijk",
        output_dir:
          "C:/FrameQ/outputs/a-very-long-safe-history-directory/with/many/nested/segments/for/ellipsis",
      },
    ];
    const page = await openUiSmokePage({ responses: { get_history: historyItems } });

    try {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 1366,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await waitForRuntimeCondition(page, "window.innerWidth === 1366");
      await openSmokeHistory(page, historyItems.length);
      await waitForRuntimeCondition(
        page,
        "document.querySelectorAll('.history-title').length === 3 && getComputedStyle(document.querySelector('.history-meta')).gridTemplateColumns.split(' ').length === 3",
      );

      const wide = await evaluateValue<{
        titlesClamped: boolean;
        outputEllipsized: boolean;
        metaAligned: boolean;
        sheetHeight: number;
        listBottomPadding: number;
        listScrollable: boolean;
        cards: Array<{
          height: number;
          metadataBottomInset: number;
          statusTitleGap: number;
          titleMetadataGap: number;
        }>;
      }>(
        page,
        `(() => {
          const cards = Array.from(document.querySelectorAll('.history-item'));
          const titles = Array.from(document.querySelectorAll('.history-title'));
          const output = document.querySelector('.history-meta-output[title*="a-very-long-safe"] .history-meta-value');
          const metaRows = Array.from(document.querySelectorAll('.history-meta'));
          const sheetRect = document.querySelector('.history-sheet').getBoundingClientRect();
          const list = document.querySelector('.history-list');
          const listRect = list.getBoundingClientRect();
          const lastCardRect = cards[cards.length - 1].getBoundingClientRect();
          return {
            titlesClamped: titles.slice(0, 2).every((title) => {
              const style = getComputedStyle(title);
              return style.webkitLineClamp === '2' && title.scrollHeight > title.clientHeight;
            }),
            outputEllipsized: output.scrollWidth > output.clientWidth && getComputedStyle(output).textOverflow === 'ellipsis',
            metaAligned: metaRows.every((meta) => {
              const time = meta.querySelector('.history-meta-time').getBoundingClientRect();
              const result = meta.querySelector('.history-meta-result').getBoundingClientRect();
              return Math.abs(time.top - result.top) <= 1 && result.right <= meta.getBoundingClientRect().right + 1;
            }),
            sheetHeight: sheetRect.height,
            listBottomPadding: listRect.bottom - lastCardRect.bottom,
            listScrollable: list.scrollHeight > list.clientHeight,
            cards: cards.map((card) => {
              const cardRect = card.getBoundingClientRect();
              const statusRect = card.querySelector('.history-status').getBoundingClientRect();
              const titleRect = card.querySelector('.history-title').getBoundingClientRect();
              const metadataRect = card.querySelector('.history-meta').getBoundingClientRect();
              return {
                height: cardRect.height,
                metadataBottomInset: cardRect.bottom - metadataRect.bottom,
                statusTitleGap: titleRect.top - statusRect.bottom,
                titleMetadataGap: metadataRect.top - titleRect.bottom
              };
            })
          };
        })()`,
      );
      await captureHistoryLayoutScreenshot(page, "wide");
      reportHistoryLayoutGeometry("wide", wide);

      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 640,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await waitForRuntimeCondition(
        page,
        "window.innerWidth === 640 && getComputedStyle(document.querySelector('.history-meta')).gridTemplateColumns.split(' ').length === 2",
      );
      const narrow = await evaluateValue<{
        outputOnSecondRow: boolean;
        contained: boolean;
        statusAligned: boolean;
        cards: Array<{
          height: number;
          metadataBottomInset: number;
          statusTitleGap: number;
          titleMetadataGap: number;
        }>;
      }>(
        page,
        `(() => {
          const cards = Array.from(document.querySelectorAll('.history-item'));
          const metas = Array.from(document.querySelectorAll('.history-meta'));
          const statusLefts = cards.map((card) => card.querySelector('.history-status').getBoundingClientRect().left);
          return {
            outputOnSecondRow: metas.every((meta) => {
              const time = meta.querySelector('.history-meta-time').getBoundingClientRect();
              const output = meta.querySelector('.history-meta-output').getBoundingClientRect();
              return output.top > time.bottom - 1;
            }),
            contained: cards.every((card) => card.scrollWidth <= card.clientWidth + 1),
            statusAligned: Math.max(...statusLefts) - Math.min(...statusLefts) <= 1,
            cards: cards.map((card) => {
              const cardRect = card.getBoundingClientRect();
              const statusRect = card.querySelector('.history-status').getBoundingClientRect();
              const titleRect = card.querySelector('.history-title').getBoundingClientRect();
              const metadataRect = card.querySelector('.history-meta').getBoundingClientRect();
              return {
                height: cardRect.height,
                metadataBottomInset: cardRect.bottom - metadataRect.bottom,
                statusTitleGap: titleRect.top - statusRect.bottom,
                titleMetadataGap: metadataRect.top - titleRect.bottom
              };
            })
          };
        })()`,
      );
      await captureHistoryLayoutScreenshot(page, "narrow");
      reportHistoryLayoutGeometry("narrow", narrow);
      expect(wide.titlesClamped).toBe(true);
      expect(wide.outputEllipsized).toBe(true);
      expect(wide.metaAligned).toBe(true);
      expect(wide.sheetHeight).toBeLessThan(600);
      expect(wide.listBottomPadding).toBeGreaterThanOrEqual(16);
      expect(wide.listBottomPadding).toBeLessThanOrEqual(20);
      expect(wide.listScrollable).toBe(false);
      expect(wide.cards.every((card) => card.height < 150)).toBe(true);
      expect(wide.cards[2].height).toBeLessThan(wide.cards[0].height);
      expect(wide.cards.every((card) => card.metadataBottomInset >= 11 && card.metadataBottomInset <= 15)).toBe(true);
      expect(wide.cards.every((card) => card.statusTitleGap >= 6 && card.statusTitleGap <= 10)).toBe(true);
      expect(wide.cards.every((card) => card.titleMetadataGap >= 11 && card.titleMetadataGap <= 13)).toBe(true);
      expect(narrow.outputOnSecondRow).toBe(true);
      expect(narrow.contained).toBe(true);
      expect(narrow.statusAligned).toBe(true);
      expect(narrow.cards.every((card) => card.height < 180)).toBe(true);
      expect(narrow.cards.every((card) => card.metadataBottomInset >= 11 && card.metadataBottomInset <= 15)).toBe(true);
      expect(narrow.cards.every((card) => card.statusTitleGap >= 6 && card.statusTitleGap <= 10)).toBe(true);
      expect(narrow.cards.every((card) => card.titleMetadataGap >= 11 && card.titleMetadataGap <= 13)).toBe(true);
    } finally {
      await page.close();
    }
  }, 15_000);

  test("keeps a long history list inside the sheet maximum and scrolls only the list", async () => {
    const historyItems = Array.from({ length: 14 }, (_, index) => ({
      task_id: `history-scroll-${index}`,
      id: `history-scroll-${index}`,
      created_at: "2026-07-11T08:00:00.000Z",
      url: `https://www.youtube.com/watch?v=demo${index.toString().padStart(7, "0")}`,
      status: "completed",
      task_dir: `C:/FrameQ/outputs/tasks/history-scroll-${index}`,
      output_dir: "C:/FrameQ/outputs",
      artifacts: { transcript_txt: "transcript/transcript.txt" },
      error: null,
      text_preview: `第 ${index + 1} 条安全历史任务文字稿预览`,
      insights_count: index,
    }));
    const page = await openUiSmokePage({ responses: { get_history: historyItems } });

    try {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 1366,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await waitForRuntimeCondition(page, "window.innerWidth === 1366 && window.innerHeight === 720");
      await openSmokeHistory(page, historyItems.length);
      const geometry = await evaluateValue<{
        sheetHeight: number;
        sheetBottom: number;
        viewportHeight: number;
        listScrollable: boolean;
      }>(
        page,
        `(() => {
          const sheet = document.querySelector('.history-sheet').getBoundingClientRect();
          const list = document.querySelector('.history-list');
          return {
            sheetHeight: sheet.height,
            sheetBottom: sheet.bottom,
            viewportHeight: window.innerHeight,
            listScrollable: list.scrollHeight > list.clientHeight
          };
        })()`,
      );

      expect(geometry.sheetHeight).toBeLessThanOrEqual(635);
      expect(geometry.sheetBottom).toBeLessThanOrEqual(geometry.viewportHeight - 24 + 1);
      expect(geometry.listScrollable).toBe(true);
    } finally {
      await page.close();
    }
  }, 15_000);
});

describe("App controller-owned lifecycle UI smoke", () => {
  beforeAll(async () => {
    await restartChromeProcess();
  }, 30_000);

  test("owns permanent deletion confirmation, failure, and current-task reset in one history lifecycle", async () => {
    const page = await openUiSmokePage({ deferredCommands: ["delete_history_task"] });

    try {
      await restoreSmokeHistoryItem(page, "历史任务甲文字稿");
      await openSmokeHistory(page);
      await openHistoryDeleteConfirmation(page, "历史任务乙文字稿");
      expect(
        await evaluateValue<string>(
          page,
          "document.activeElement?.textContent?.trim() ?? ''",
        ),
      ).toBe("取消");
      await clickButtonContaining(page, ".history-delete-confirm button", "取消");
      await waitForRuntimeCondition(page, "!document.querySelector('.history-delete-confirm')");
      expect((await readUiSmokeCommands(page)).some((entry) => entry.command === "delete_history_task"))
        .toBe(false);

      await page.send("Runtime.evaluate", {
        expression: `(() => {
          const card = [...document.querySelectorAll('.history-item')]
            .find((item) => item.textContent?.includes('历史任务乙文字稿'));
          card?.querySelector('.history-item-select')?.focus();
        })()`,
      });
      await page.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
      });
      await page.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
      });
      expect(
        await evaluateValue<string>(
          page,
          "document.activeElement?.getAttribute('aria-label') ?? ''",
        ),
      ).toBe("永久删除历史任务：历史任务乙文字稿");
      await clickSelector(page, ".history-item-delete:focus");
      await waitForRuntimeCondition(page, "Boolean(document.querySelector('.history-delete-confirm'))");
      await page.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await page.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await waitForRuntimeCondition(page, "!document.querySelector('.history-delete-confirm')");

      await openHistoryDeleteConfirmation(page, "历史任务乙文字稿");
      await clickButtonContaining(page, ".history-delete-confirm button", "永久删除");
      await waitForRuntimeCondition(
        page,
        "Boolean(window.__FRAMEQ_UI_SMOKE__.pending.delete_history_task?.length) && document.body.innerText.includes('正在永久删除')",
      );
      expect(
        await evaluateValue<string>(
          page,
          "document.querySelector('.local-transcript-workspace')?.dataset.taskId ?? ''",
        ),
      ).toBe("history-task-a");
      await resolveUiSmokeCommand(page, "delete_history_task", {
        task_id: "history-task-b",
        deleted: true,
      });
      await waitForRuntimeCondition(
        page,
        "document.querySelectorAll('.history-item').length === 1 && !document.body.innerText.includes('历史任务乙文字稿')",
      );
      expect(
        await evaluateValue<string>(
          page,
          "document.querySelector('.local-transcript-workspace')?.dataset.taskId ?? ''",
        ),
      ).toBe("history-task-a");

      await openHistoryDeleteConfirmation(page, "历史任务甲文字稿");
      await clickButtonContaining(page, ".history-delete-confirm button", "永久删除");
      await waitForRuntimeCondition(
        page,
        "Boolean(window.__FRAMEQ_UI_SMOKE__.pending.delete_history_task?.length)",
      );
      await rejectUiSmokeCommand(page, "delete_history_task", "C:/private/review-secret");
      await waitForRuntimeCondition(
        page,
        "document.body.innerText.includes('部分文件可能') && document.querySelectorAll('.history-item').length === 2",
      );
      const state = await evaluateValue<Record<string, unknown>>(
        page,
        `({
          currentTask: document.querySelector('.local-transcript-workspace')?.dataset.taskId ?? '',
          body: document.body.innerText,
          confirmStillOpen: Boolean(document.querySelector('.history-delete-confirm'))
        })`,
      );
      expect(state.currentTask).toBe("history-task-a");
      expect(state.confirmStillOpen).toBe(true);
      expect(String(state.body)).not.toContain("review-secret");
      expect(String(state.body)).not.toContain("C:/private");

      await clickButtonContaining(page, ".history-delete-confirm button", "永久删除");
      await waitForRuntimeCondition(
        page,
        "Boolean(window.__FRAMEQ_UI_SMOKE__.pending.delete_history_task?.length) && document.body.innerText.includes('正在永久删除')",
      );
      expect(
        await evaluateValue<string>(
          page,
          "document.querySelector('.local-transcript-workspace')?.dataset.taskId ?? ''",
        ),
      ).toBe("history-task-a");
      await resolveUiSmokeCommand(page, "delete_history_task", {
        task_id: "history-task-a",
        deleted: true,
      });
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.command-panel')) && document.querySelectorAll('.history-item').length === 1",
      );

      const deletionCommands = (await readUiSmokeCommands(page)).filter(
        (entry) => entry.command === "delete_history_task",
      );
      expect(deletionCommands).toHaveLength(3);
      expect(deletionCommands[0].args).toEqual({ request: { task_id: "history-task-b" } });
      expect(deletionCommands[1].args).toEqual({ request: { task_id: "history-task-a" } });
      expect(deletionCommands[2].args).toEqual({ request: { task_id: "history-task-a" } });
    } finally {
      await page.close();
    }
  }, 15_000);

  test("keeps history read-only during processing and restores one stable completed task", async () => {
    const page = await openUiSmokePage({ deferredCommands: ["process_video"] });

    try {
      await submitSmokeVideo(page);
      await openSmokeHistory(page);
      await waitForRuntimeCondition(
        page,
        "document.querySelectorAll('.history-item-select:disabled').length === 2 && document.querySelectorAll('.history-item-delete:disabled').length === 2 && document.body.innerText.includes('当前任务仍在处理中')",
      );

      await resolveUiSmokeCommand(page, "process_video");
      await waitForRuntimeCondition(
        page,
        "document.querySelectorAll('.history-item-select:not(:disabled)').length === 2 && document.querySelectorAll('.history-item-delete:not(:disabled)').length === 2 && document.body.innerText.includes('视频、音频和文字稿已保存在本机')",
      );
      await clickButtonContaining(page, ".history-item-select", "历史任务甲文字稿");
      await waitForRuntimeCondition(page, "!document.querySelector('.history-sheet')");
      await waitForRuntimeCondition(
        page,
        "document.querySelector('.transcript-full-editor')?.value === '历史任务甲完整文字稿'",
      );

      const load = (await readUiSmokeCommands(page))
        .filter((entry) => entry.command === "load_transcript_detail")
        .at(-1);
      expect(load?.args).toMatchObject({ request: { task_id: "history-task-a" } });
    } finally {
      await page.close();
    }
  }, 15_000);

  test("keeps local transcript usable when AI is unavailable or quota is exhausted", async () => {
    for (const account of [
      {
        authenticated: true,
        email: "ui-smoke@frameq.local",
        entitlement_status: "active",
        entitlement_expires_at: null,
        llm_quota_limit: 20,
        llm_quota_used: 20,
        llm_quota_remaining: 0,
        llm_quota_resets_at: null,
        llm_configured: true,
        last_verified_at: null,
        can_process: true,
        can_generate_ai: false,
        server_error: null,
      },
      {
        authenticated: true,
        email: "ui-smoke@frameq.local",
        entitlement_status: "active",
        entitlement_expires_at: null,
        llm_quota_limit: 20,
        llm_quota_used: 0,
        llm_quota_remaining: 20,
        llm_quota_resets_at: null,
        llm_configured: false,
        last_verified_at: null,
        can_process: true,
        can_generate_ai: false,
        server_error: null,
      },
    ]) {
      const page = await openUiSmokePage({ responses: { get_account_status: account } });
      try {
        await restoreSmokeHistoryItem(page, "历史任务甲文字稿");
        await waitForRuntimeCondition(
          page,
          "Boolean(document.querySelector('.ai-availability-blocker')) && Boolean(document.querySelector('.transcript-full-editor'))",
        );
        const state = await evaluateValue<Record<string, unknown>>(
          page,
          `({
            blocker: document.querySelector('.ai-availability-blocker')?.textContent ?? '',
            disabledTargets: document.querySelectorAll('.ai-target-card .ai-target-action:disabled').length,
            localTask: document.querySelector('.local-transcript-workspace')?.dataset.taskId ?? '',
            localEditorDisabled: document.querySelector('.transcript-full-editor')?.disabled ?? null
          })`,
        );
        expect(state.disabledTargets).toBe(2);
        expect(state.localTask).toBe("history-task-a");
        expect(state.localEditorDisabled).toBe(false);
        expect(String(state.blocker)).toMatch(/AI Credits 已用完|暂不可用/);
      } finally {
        await page.close();
      }
    }
  }, 20_000);

  test("keeps an AI target failure in the right workspace while the local transcript remains ready", async () => {
    const page = await openUiSmokePage({ deferredCommands: ["retry_insights"] });
    try {
      await restoreSmokeHistoryItem(page, "历史任务甲文字稿");
      await clickButtonContaining(page, '[data-ai-target="summary"] button', "确认生成");
      await clickButtonContaining(page, '[aria-label="确认要点总结"] .primary-button', "确认");
      await waitForRuntimeCondition(
        page,
        "document.querySelector('[data-ai-target=\"summary\"]')?.classList.contains('generating')",
      );
      await resolveUiSmokeCommand(page, "retry_insights", {
        status: "partial_completed",
        task_id: "history-task-a",
        task_dir: "C:/FrameQ/outputs/tasks/history-task-a",
        artifacts: {},
        text: "",
        summary: "",
        insights: [],
        transcript: null,
        error: {
          code: "INSIGHTFLOW_EMPTY_SUMMARY",
          message: "No summary returned.",
          stage: "insights_generating",
        },
      });
      await waitForRuntimeCondition(
        page,
        "document.querySelector('[data-ai-target=\"summary\"]')?.classList.contains('failed')",
      );
      const state = await evaluateValue<Record<string, unknown>>(
        page,
        `({
          localReady: Boolean(document.querySelector('.local-transcript-workspace .transcript-review-panel')),
          localError: Boolean(document.querySelector('.local-workspace-error')),
          aiError: document.querySelector('[data-ai-target="summary"] .ai-target-error')?.textContent ?? '',
          insightsFailed: document.querySelector('[data-ai-target="insights"]')?.classList.contains('failed') ?? false
        })`,
      );
      expect(state).toMatchObject({
        localReady: true,
        localError: false,
        aiError: "生成失败。错误码：INSIGHTFLOW_EMPTY_SUMMARY",
        insightsFailed: false,
      });
    } finally {
      await page.close();
    }
  }, 15_000);

  test("keeps history read-only while cancelling and waits for the confirmed worker terminal result", async () => {
    const page = await openUiSmokePage({ deferredCommands: ["process_video"] });

    try {
      await submitSmokeVideo(page);
      await clickButtonContaining(page, ".local-progress button", "取消本地处理");
      await waitForRuntimeCondition(page, "document.body.innerText.includes('正在取消')");
      await openSmokeHistory(page);
      await waitForRuntimeCondition(
        page,
        "document.querySelectorAll('.history-item-select:disabled').length === 2 && document.querySelectorAll('.history-item-delete:disabled').length === 2 && document.body.innerText.includes('当前任务仍在处理中')",
      );

      await resolveUiSmokeCommand(page, "process_video", cancelledWorkerResult());
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.command-panel')) && document.querySelectorAll('.history-item-select:not(:disabled)').length === 2 && document.querySelectorAll('.history-item-delete:not(:disabled)').length === 2",
      );
      await clickSelector(page, ".history-sheet .sheet-header .icon-button");
      await waitForRuntimeCondition(page, "!document.querySelector('.history-sheet')");
      const state = await evaluateValue<Record<string, unknown>>(
        page,
        `({
          hasInput: Boolean(document.querySelector('.command-panel')),
          hasResults: Boolean(document.querySelector('.task-workspace-layout')),
          draft: document.querySelector('#video-url')?.value ?? ''
        })`,
      );
      expect(state).toMatchObject({ hasInput: true, hasResults: false });
      expect(state.draft).toBe(smokeVideoUrl);
    } finally {
      await page.close();
    }
  }, 15_000);

  test("ignores a late transcript save after restoring a different history task", async () => {
    const page = await openUiSmokePage({ deferredCommands: ["save_transcript_edit"] });

    try {
      await restoreSmokeHistoryItem(page, "历史任务甲文字稿");
      await waitForRuntimeCondition(
        page,
        "document.querySelector('.transcript-full-editor')?.value === '历史任务甲完整文字稿'",
      );
      await replaceTextAreaValue(page, ".transcript-full-editor", "甲任务延迟保存后的长文字稿内容");
      await clickButtonContaining(page, ".transcript-action-bar button", "保存");
      await waitForRuntimeCondition(
        page,
        "Boolean(window.__FRAMEQ_UI_SMOKE__.pending.save_transcript_edit?.length)",
      );

      await openSmokeHistory(page);
      await waitForRuntimeCondition(
        page,
        "document.querySelectorAll('.history-item-delete:disabled').length === 2 && document.body.innerText.includes('文字稿正在保存')",
      );
      await clickSelector(page, ".history-sheet .sheet-header .icon-button");
      await waitForRuntimeCondition(page, "!document.querySelector('.history-sheet')");

      await restoreSmokeHistoryItem(page, "历史任务乙文字稿");
      await resolveUiSmokeCommand(page, "save_transcript_edit", {
        task_id: "history-task-a",
        text: "甲任务延迟保存后的长文字稿内容",
        artifacts: { transcript_txt: "transcript/late-a.txt" },
        has_original_backup: true,
      });
      await waitForRuntimeCondition(
        page,
        "document.querySelector('.local-transcript-workspace')?.dataset.taskId === 'history-task-b' && document.querySelector('.transcript-full-editor')?.value === '历史任务乙完整文字稿'",
      );

      const transcriptLoads = (await readUiSmokeCommands(page)).filter(
        (entry) => entry.command === "load_transcript_detail",
      );
      expect(transcriptLoads.at(-1)?.args).toMatchObject({
        request: { task_id: "history-task-b" },
      });
    } finally {
      await page.close();
    }
  }, 15_000);

  test("Escape exits segment editing without saving while composing Escape stays local", async () => {
    const page = await openUiSmokePage({
      responses: {
        load_transcript_detail: {
          text: "第一段原稿。",
          segments: [{ id: "segment-1", start_ms: 0, end_ms: 3000, text: "第一段原稿。" }],
          audio_path: "C:/FrameQ/outputs/tasks/history-task-a/media/audio.wav",
          audio_asset_path: "C:/FrameQ/cache/audio-review/history-task-a.wav",
          has_original_backup: false,
        },
      },
    });

    try {
      await restoreSmokeHistoryItem(page, "历史任务甲文字稿");
      await waitForRuntimeCondition(page, "document.querySelectorAll('.transcript-segment-edit').length === 1");
      await clickSelector(page, ".transcript-segment-edit");
      await waitForRuntimeCondition(page, "Boolean(document.querySelector('.transcript-segment textarea'))");
      await replaceTextAreaValue(page, ".transcript-segment textarea", "第一段保留草稿。");

      const composingState = await evaluateValue<Record<string, unknown>>(
        page,
        `(() => {
          const textarea = document.querySelector('.transcript-segment textarea');
          window.__frameqEscapeBubbled = 0;
          document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') window.__frameqEscapeBubbled += 1;
          });
          const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
          Object.defineProperty(event, 'isComposing', { value: true });
          textarea.dispatchEvent(event);
          return {
            editing: Boolean(document.querySelector('.transcript-segment textarea')),
            value: document.querySelector('.transcript-segment textarea')?.value,
            bubbled: window.__frameqEscapeBubbled
          };
        })()`,
      );
      expect(composingState).toMatchObject({
        editing: true,
        value: "第一段保留草稿。",
        bubbled: 1,
      });

      await page.send("Runtime.evaluate", {
        expression: `(() => {
          window.__frameqEscapeBubbled = 0;
          document.querySelector('.transcript-segment textarea')
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        })()`,
      });
      await waitForRuntimeCondition(page, "!document.querySelector('.transcript-segment textarea')");
      await waitForRuntimeCondition(
        page,
        "document.activeElement?.matches('.transcript-segment-edit')",
      );

      const finalState = await evaluateValue<Record<string, unknown>>(
        page,
        `({
          text: document.querySelector('.transcript-segment-text')?.textContent,
          saveEnabled: !document.querySelector('.transcript-action-bar .primary-button')?.disabled,
          bubbled: window.__frameqEscapeBubbled
        })`,
      );
      expect(finalState).toMatchObject({
        text: "第一段保留草稿。",
        saveEnabled: true,
        bubbled: 0,
      });
      const commands = await readUiSmokeCommands(page);
      expect(commands.some((entry) => entry.command === "save_transcript_edit")).toBe(false);
      expect(commands.some((entry) => entry.command === "retry_insights")).toBe(false);
    } finally {
      await page.close();
    }
  }, 15_000);

  test("freezes confirmed output language across locale changes and uses the new locale next time", async () => {
    const page = await openUiSmokePage({
      deferredCommands: ["retry_insights", "save_default_generation_preferences"],
      responses: { retry_insights: completedSummaryResult() },
    });

    try {
      await clickSelector(page, ".toolbar-tool-group > button:nth-of-type(2)");
      await waitForRuntimeCondition(page, "Boolean(document.querySelector('#ui-language-preference'))");
      await page.send("Runtime.evaluate", {
        expression: `(() => {
          const selector = document.querySelector('#ui-language-preference');
          selector.value = 'zh-TW';
          selector.dispatchEvent(new Event('change', { bubbles: true }));
        })()`,
      });
      await waitForRuntimeCondition(page, "document.documentElement.lang === 'zh-TW'");
      await clickSelector(page, ".settings-sheet .sheet-header .icon-button");

      await restoreSmokeHistoryItem(page, "历史任务甲文字稿");
      await clickSelector(page, '[data-ai-target="summary"] .ai-target-action');
      await waitForRuntimeCondition(
        page,
        "Boolean(document.querySelector('.preference-flow-sheet [data-output-language]'))",
      );
      const summaryLanguage = await evaluateValue<Record<string, unknown>>(
        page,
        `({
          documentLanguage: document.documentElement.lang,
          outputLanguage: document.querySelector('.preference-flow-sheet [data-output-language]')?.dataset.outputLanguage ?? '',
          label: document.querySelector('.preference-flow-sheet [data-output-language]')?.textContent ?? ''
        })`,
      );
      expect(summaryLanguage).toMatchObject({
        documentLanguage: "zh-TW",
        outputLanguage: "zh-TW",
      });
      expect(String(summaryLanguage.label)).toContain("繁體中文");
      await clickSelector(page, ".preference-flow-sheet .sheet-footer .primary-button");
      await waitForRuntimeCondition(
        page,
        "window.__FRAMEQ_UI_SMOKE__.commands.some((entry) => entry.command === 'retry_insights' && entry.args?.request?.target === 'summary')",
      );
      await waitForRuntimeCondition(
        page,
        "document.querySelector('[data-ai-target=\"summary\"]')?.classList.contains('generating')",
      );
      const generatingState = await evaluateValue<Record<string, unknown>>(
        page,
        `({
          transcriptVisible: Boolean(document.querySelector('.transcript-full-editor')),
          transcriptReadOnly: document.querySelector('.transcript-full-editor')?.disabled ?? false,
          saveDisabled: document.querySelector('.transcript-action-bar .primary-button')?.disabled ?? false,
          aiCancelVisible: Boolean(document.querySelector('.ai-generation-workspace .ai-cancel-button')),
          localCancelVisible: Boolean(document.querySelector('.local-transcript-workspace .danger-soft'))
        })`,
      );
      expect(generatingState).toMatchObject({
        transcriptVisible: true,
        transcriptReadOnly: true,
        saveDisabled: true,
        aiCancelVisible: true,
        localCancelVisible: false,
      });
      await openSmokeHistory(page);
      await waitForRuntimeCondition(
        page,
        "document.querySelectorAll('.history-item-select:disabled').length === 2 && document.querySelectorAll('.history-item-delete:disabled').length === 2",
      );
      await resolveUiSmokeCommand(page, "retry_insights");
      await waitForRuntimeCondition(
        page,
        "document.querySelectorAll('.history-item-select:not(:disabled)').length === 2 && document.querySelectorAll('.history-item-delete:not(:disabled)').length === 2",
      );
      await clickSelector(page, ".history-sheet .sheet-header .icon-button");

      await clickSelector(page, '[data-ai-target="insights"] .ai-target-action');
      await waitForRuntimeCondition(page, "document.body.innerText.includes('直接產生')");
      await clickButtonContaining(page, ".preference-flow-sheet .primary-button", "直接產生");
      await waitForRuntimeCondition(
        page,
        "document.querySelector('.preference-flow-sheet [data-output-language=\"zh-TW\"]')?.textContent.includes('繁體中文')",
      );
      await clickSelector(page, ".preference-flow-sheet .sheet-footer .primary-button");
      await waitForRuntimeCondition(
        page,
        "window.__FRAMEQ_UI_SMOKE__.pending.save_default_generation_preferences?.length === 1",
      );

      await clickSelector(page, ".toolbar-tool-group > button:nth-of-type(2)");
      await waitForRuntimeCondition(page, "Boolean(document.querySelector('#ui-language-preference'))");
      await page.send("Runtime.evaluate", {
        expression: `(() => {
          const selector = document.querySelector('#ui-language-preference');
          selector.value = 'en-US';
          selector.dispatchEvent(new Event('change', { bubbles: true }));
        })()`,
      });
      await waitForRuntimeCondition(
        page,
        "document.documentElement.lang === 'en-US' && document.querySelector('.preference-flow-sheet [data-output-language=\"zh-TW\"]')?.textContent.includes('Traditional Chinese (Taiwan)')",
      );
      await clickSelector(page, ".settings-sheet .sheet-header .icon-button");

      await resolveUiSmokeCommand(page, "save_default_generation_preferences");
      await waitForRuntimeCondition(
        page,
        "window.__FRAMEQ_UI_SMOKE__.commands.filter((entry) => entry.command === 'retry_insights').length === 2",
      );
      await resolveUiSmokeCommand(page, "retry_insights");

      await clickSelector(page, '[data-ai-target="insights"] .ai-target-action');
      await waitForRuntimeCondition(page, "document.body.innerText.includes('Generate now')");
      await clickButtonContaining(page, ".preference-flow-sheet .primary-button", "Generate now");
      await waitForRuntimeCondition(
        page,
        "document.querySelector('.preference-flow-sheet [data-output-language=\"en-US\"]')?.textContent.includes('English (US)')",
      );
      await clickButtonContaining(page, ".preference-flow-sheet .primary-button", "Confirm");
      await waitForRuntimeCondition(
        page,
        "window.__FRAMEQ_UI_SMOKE__.pending.save_default_generation_preferences?.length === 1",
      );
      await resolveUiSmokeCommand(page, "save_default_generation_preferences");
      await waitForRuntimeCondition(
        page,
        "window.__FRAMEQ_UI_SMOKE__.commands.filter((entry) => entry.command === 'retry_insights').length === 3",
      );

      const commands = await readUiSmokeCommands(page);
      const retries = commands.filter((entry) => entry.command === "retry_insights");
      expect(retries).toHaveLength(3);
      expect(retries[0].args).toMatchObject({
        request: {
          task_id: "history-task-a",
          target: "summary",
          output_language: "zh-TW",
        },
      });
      expect((retries[0].args.request as Record<string, unknown>).preference_snapshot).toBeUndefined();
      expect(retries[1].args).toMatchObject({
        request: {
          task_id: "history-task-a",
          target: "insights",
          output_language: "zh-TW",
          preference_snapshot: {
            generationPreferences: expect.any(Object),
          },
        },
      });
      expect(retries[2].args).toMatchObject({
        request: {
          task_id: "history-task-a",
          target: "insights",
          output_language: "en-US",
          preference_snapshot: {
            generationPreferences: expect.any(Object),
          },
        },
      });
      await resolveUiSmokeCommand(page, "retry_insights");
      expectForbiddenProductCommandsAbsent(commands);
    } finally {
      await page.close();
    }
  }, 20_000);
});

describe("App result detail modal layout", () => {
  beforeAll(async () => {
    await restartChromeProcess();
  }, 30_000);

  test("keeps long detail text scrollable inside the modal content area", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent("about:blank")}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Page.navigate", { url: appUrl });
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
      await page.close();
    }
  }, 10_000);

  test("keeps long settings forms scrollable inside the settings modal", async () => {
    const target = await requestJson<CdpTarget>(
      cdpPort,
      `/json/new?${encodeURIComponent("about:blank")}`,
      "PUT",
    );
    const page = await connectToCdp(target.webSocketDebuggerUrl);

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Page.navigate", { url: appUrl });
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
                    '<div class="settings-layout">' +
                      '<nav class="settings-nav"><a href="#settings-basic"><span>基础</span><small>模型与输出</small></a></nav>' +
                      '<div class="settings-sections">' +
                    '<p class="settings-warning">这里管理本机 ASR、输出目录和配置文件位置。</p>' +
                    fields +
                      '</div>' +
                    '</div>' +
                    '<div class="settings-actions"><button>保存配置</button></div>' +
                  '</form>' +
                '</section>' +
              '</div>';
            const form = document.querySelector('.settings-sections');
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
      await page.close();
    }
  }, 10_000);
});

async function connectToCdp(webSocketDebuggerUrl: string) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const targetId = new URL(webSocketDebuggerUrl).pathname.split("/").at(-1);
  let closePromise: Promise<void> | null = null;
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
    close: () => {
      closePromise ??= (async () => {
        try {
          if (targetId) {
            const response = await fetch(`http://127.0.0.1:${cdpPort}/json/close/${targetId}`);
            if (!response.ok) {
              throw new Error(`Could not close CDP target: ${response.status}`);
            }
            await waitForCdpTargetClosed(targetId);
          }
        } finally {
          socket.close();
        }
      })();
      return closePromise;
    },
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

async function waitForCdpTargetClosed(targetId: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const targets = await requestJson<Array<{ id: string }>>(cdpPort, "/json/list");
    if (!targets.some((target) => target.id === targetId)) {
      return;
    }
    await delay(25);
  }
  throw new Error(`CDP target did not close: ${targetId}`);
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

async function startChromeProcess() {
  cdpPort = await findFreePort();
  chromeProfileDir = mkdtempSync(join(tmpdir(), "frameq-cdp-"));
  chromeStderr = "";
  chromeExit = null;
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
}

async function restartChromeProcess() {
  await stopChromeProcess();
  if (chromeProfileDir) {
    rmSync(chromeProfileDir, { recursive: true, force: true });
    chromeProfileDir = "";
  }
  await startChromeProcess();
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

type CdpPage = Awaited<ReturnType<typeof connectToCdp>>;
type UiSmokeCommand = {
  command: string;
  args: Record<string, unknown>;
};

async function openUiSmokePage(scenario: UiSmokeScenario): Promise<CdpPage> {
  const target = await requestJson<CdpTarget>(
    cdpPort,
    `/json/new?${encodeURIComponent("about:blank")}`,
    "PUT",
  );
  const page = await connectToCdp(target.webSocketDebuggerUrl);
  try {
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: createUiSmokeBridgeScript(scenario),
    });
    await page.send("Page.navigate", { url: appUrl });
    await waitForRuntimeCondition(
      page,
      "window.__FRAMEQ_UI_SMOKE__?.ready === true && Boolean(document.querySelector('.app-shell'))",
      15_000,
    );
    return page;
  } catch (error) {
    await page.close();
    throw error;
  }
}

async function clickSelector(page: CdpPage, selector: string): Promise<void> {
  await page.send("Runtime.evaluate", {
    expression: `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Missing smoke selector");
      element.click();
    })()`,
  });
}

async function clickButtonContaining(
  page: CdpPage,
  selector: string,
  text: string,
): Promise<void> {
  await page.send("Runtime.evaluate", {
    expression: `(() => {
      const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
        .find((candidate) => candidate.textContent.includes(${JSON.stringify(text)}));
      if (!element) throw new Error("Missing smoke button");
      element.click();
    })()`,
  });
}

async function evaluateValue<T>(page: CdpPage, expression: string): Promise<T> {
  const evaluated = await page.send<{ result: { value: T } }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  return evaluated.result.value;
}

async function captureHistoryLayoutScreenshot(
  page: CdpPage,
  viewport: "wide" | "narrow",
): Promise<void> {
  if (process.env.FRAMEQ_CAPTURE_HISTORY_LAYOUT !== "1") {
    return;
  }
  const screenshot = await page.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const screenshotDir = resolve(appRoot, "..", ".tmp", "history-layout");
  mkdirSync(screenshotDir, { recursive: true });
  writeFileSync(
    join(screenshotDir, `history-layout-${viewport}.png`),
    Buffer.from(screenshot.data, "base64"),
  );
}

async function captureTaskWorkspaceScreenshot(
  page: CdpPage,
  viewport: "wide" | "narrow",
): Promise<void> {
  if (process.env.FRAMEQ_CAPTURE_TASK_WORKSPACES !== "1") {
    return;
  }
  const screenshot = await page.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const screenshotDir = resolve(appRoot, "..", ".tmp", "task-workspaces");
  mkdirSync(screenshotDir, { recursive: true });
  writeFileSync(
    join(screenshotDir, `task-workspaces-${viewport}.png`),
    Buffer.from(screenshot.data, "base64"),
  );
}

function writeTaskWorkspaceGeometry(geometry: unknown): void {
  if (process.env.FRAMEQ_REPORT_TASK_WORKSPACES !== "1") {
    return;
  }
  const outputDir = resolve(appRoot, "..", ".tmp", "task-workspaces");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(outputDir, "task-workspaces-geometry.json"),
    `${JSON.stringify(geometry, null, 2)}\n`,
    "utf-8",
  );
}

function reportHistoryLayoutGeometry(viewport: string, geometry: unknown): void {
  if (process.env.FRAMEQ_REPORT_HISTORY_GEOMETRY === "1") {
    console.info(`history-layout-${viewport}: ${JSON.stringify(geometry)}`);
  }
}

async function readUiSmokeCommands(page: CdpPage): Promise<UiSmokeCommand[]> {
  return evaluateValue<UiSmokeCommand[]>(
    page,
    "window.__FRAMEQ_UI_SMOKE__.commands.map((entry) => ({ command: entry.command, args: entry.args }))",
  );
}

async function resolveUiSmokeCommand(
  page: CdpPage,
  command: string,
  value?: unknown,
): Promise<void> {
  await page.send("Runtime.evaluate", {
    expression: `window.__FRAMEQ_UI_SMOKE__.resolve(${JSON.stringify(command)}, ${
      value === undefined ? "undefined" : JSON.stringify(value)
    })`,
  });
}

async function rejectUiSmokeCommand(
  page: CdpPage,
  command: string,
  message: string,
): Promise<void> {
  await page.send("Runtime.evaluate", {
    expression: `window.__FRAMEQ_UI_SMOKE__.reject(${JSON.stringify(command)}, ${JSON.stringify(message)})`,
  });
}

async function submitSmokeVideo(page: CdpPage): Promise<void> {
  await page.send("Runtime.evaluate", {
    expression: "document.querySelector('#video-url').focus()",
  });
  await page.send("Input.insertText", { text: smokeVideoUrl });
  await waitForRuntimeCondition(page, "!document.querySelector('.primary-button').disabled");
  await clickSelector(page, ".primary-button");
  await waitForRuntimeCondition(
    page,
    "Boolean(window.__FRAMEQ_UI_SMOKE__.pending.process_video?.length) && Boolean(document.querySelector('.local-transcript-workspace'))",
  );
}

async function openSmokeHistory(page: CdpPage, expectedItems = 2): Promise<void> {
  await clickSelector(page, ".toolbar-tool-group > button:nth-of-type(1)");
  await waitForRuntimeCondition(
    page,
    `Boolean(document.querySelector('.history-sheet')) && document.querySelectorAll('.history-item').length === ${expectedItems}`,
  );
}

async function restoreSmokeHistoryItem(page: CdpPage, preview: string): Promise<void> {
  await openSmokeHistory(page);
  await clickButtonContaining(page, ".history-item-select", preview);
  await waitForRuntimeCondition(page, "!document.querySelector('.history-sheet')");
}

async function openHistoryDeleteConfirmation(page: CdpPage, preview: string): Promise<void> {
  await page.send("Runtime.evaluate", {
    expression: `(() => {
      const card = [...document.querySelectorAll('.history-item')]
        .find((item) => item.textContent?.includes(${JSON.stringify(preview)}));
      card?.querySelector('.history-item-delete')?.click();
    })()`,
  });
  await waitForRuntimeCondition(
    page,
    "Boolean(document.querySelector('.history-delete-confirm'))",
  );
}

async function replaceTextAreaValue(
  page: CdpPage,
  selector: string,
  value: string,
): Promise<void> {
  await page.send("Runtime.evaluate", {
    expression: `(() => {
      const textarea = document.querySelector(${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, ${JSON.stringify(value)});
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    })()`,
  });
  await waitForRuntimeCondition(
    page,
    `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`,
  );
}

function cancelledWorkerResult() {
  return {
    status: "failed",
    task_id: null,
    task_dir: null,
    artifacts: {},
    text: "",
    summary: "",
    insights: [],
    transcript: null,
    error: {
      code: "WORKER_CANCELLED",
      message: "任务已取消。",
      stage: "video_extracting",
    },
  };
}

function completedSummaryResult() {
  return {
    status: "completed",
    task_id: "history-task-a",
    task_dir: "C:/FrameQ/outputs/tasks/history-task-a",
    artifacts: { summary: "ai/summary.md", mindmap: "ai/mindmap.mmd" },
    text: "历史任务甲完整文字稿",
    summary: "模拟要点总结",
    insights: [],
    transcript: null,
    error: null,
  };
}

function expectForbiddenProductCommandsAbsent(commands: UiSmokeCommand[]): void {
  const commandNames = commands.map((entry) => entry.command);
  expect(commandNames.some((command) => /wechat|checkout|redeem|download_asr|process_video/i.test(command)))
    .toBe(false);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
