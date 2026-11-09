import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  closePages, evaluate, openPage, press, startProductionBrowser, stopProductionBrowser, waitFor,
} from "./support/productionBrowser";

beforeAll(startProductionBrowser, 60_000);
afterEach(async () => {
  const events = await closePages();
  expect(events.filter(event => event.method === "Runtime.exceptionThrown")).toEqual([]);
});
afterAll(stopProductionBrowser, 15_000);

describe("Production desktop frontend without the native data bridge", { timeout: 15_000 }, () => {
  test("reports actual storage unavailability before mounting any data-dependent views", async () => {
    const page = await openPage();
    const state = await evaluate<{
      name: string; status: string; navigation: number; libraries: number; inputs: number;
      hiddenBridge: boolean; nativeRuntime: boolean; removedActions: string[];
    }>(page, `(() => ({
      name: document.querySelector('.data-storage-recovery h1')?.textContent,
      status: document.querySelector('.data-storage-recovery [role="status"]')?.textContent,
      navigation: document.querySelectorAll('nav[aria-label="Main navigation"] button').length,
      libraries: document.querySelectorAll('.shell-library,.collections-workspace,.task-workspace-layout').length,
      inputs: document.querySelectorAll('#video-url').length,
      hiddenBridge: '__APP_UI_SMOKE__' in window,
      nativeRuntime: '__TAURI_INTERNALS__' in window,
      removedActions: [...document.querySelectorAll('button')].map(button => button.getAttribute('aria-label') || button.textContent.trim()).filter(name => name === 'Search')
    }))()`);
    expect(state.name).toBe("Locus");
    expect(state.status).toBe("Local data storage is unavailable. Open your data in the Locus desktop app.");
    expect(state.navigation).toBe(0);
    expect(state.libraries).toBe(0);
    expect(state.inputs).toBe(0);
    expect(state.hiddenBridge).toBe(false);
    expect(state.nativeRuntime).toBe(false);
    expect(state.removedActions).toEqual([]);
    expect(await evaluate(page, `Boolean(document.querySelector('.shell-toolbar button[aria-label="Settings"]'))`)).toBe(false);
  });

  test("keeps the unavailable boundary after reload and keyboard input", async () => {
    const page = await openPage();
    await press(page, "Escape");
    await press(page, "Tab");
    await press(page, "Enter");
    await page.send("Page.reload");
    await waitFor(page, `document.querySelector('.data-storage-recovery [role="status"]')?.textContent.includes('desktop app')`);
    expect(await evaluate(page, `Boolean(document.querySelector('.desktop-window,.account-sheet,.settings-sheet,.shell-library-empty,.collections-list'))`)).toBe(false);
    expect(await evaluate(page, `Object.keys(localStorage).filter(key => /storage|collection|history|task/i.test(key))`)).toEqual([]);
  });

  test.each([[1734, 907], [1180, 760], [720, 640]])("keeps the recovery message readable at %ix%i", async (width, height) => {
    const page = await openPage(width, height);
    const metrics = await evaluate<{
      overflow: boolean; messageWidth: number; fontSize: string; visible: boolean; label: string;
    }>(page, `(() => {
      const main = document.querySelector('.data-storage-recovery');
      const status = main.querySelector('[role="status"]');
      const rect = status.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth,
        messageWidth: rect.width,
        fontSize: getComputedStyle(status).fontSize,
        visible: rect.top >= 0 && rect.bottom <= window.innerHeight,
        label: main.getAttribute('aria-label')
      };
    })()`);
    expect(metrics.overflow).toBe(false);
    expect(metrics.messageWidth).toBeGreaterThan(0);
    expect(metrics.fontSize).toBe("14px");
    expect(metrics.visible).toBe(true);
    expect(metrics.label).toBe("Recover data location");
  });
});
