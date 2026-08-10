import { beforeEach, describe, expect, test, vi } from "vitest";

import type { DiagnosticExportResult } from "../../diagnosticExportClient";

type StateUpdater<T> = T | ((current: T) => T);

const exportDiagnosticsMock = vi.fn<() => Promise<DiagnosticExportResult>>();

vi.mock("../../diagnosticExportClient", () => ({
  exportDiagnostics: exportDiagnosticsMock,
}));

function createHookHarness() {
  const states: unknown[] = [];
  let cursor = 0;
  return {
    resetRender: () => {
      cursor = 0;
    },
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
    useRef: <T,>(initialValue: T) => {
      const index = cursor++;
      if (states.length <= index) states[index] = { current: initialValue };
      return states[index] as { current: T };
    },
    useState: <T,>(initialValue: T | (() => T)) => {
      const index = cursor++;
      if (states.length <= index) {
        states[index] = typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;
      }
      return [states[index] as T, (next: StateUpdater<T>) => {
        states[index] = typeof next === "function"
          ? (next as (current: T) => T)(states[index] as T)
          : next;
      }] as const;
    },
  };
}

async function createHook() {
  const harness = createHookHarness();
  vi.doMock("react", () => ({
    useCallback: harness.useCallback,
    useRef: harness.useRef,
    useState: harness.useState,
  }));
  const { useDiagnosticExport } = await import("./useDiagnosticExport");
  return () => {
    harness.resetRender();
    return useDiagnosticExport();
  };
}

describe("useDiagnosticExport", () => {
  beforeEach(() => {
    vi.resetModules();
    exportDiagnosticsMock.mockReset();
  });

  test("shares one in-flight export and suppresses duplicate clicks", async () => {
    let resolveExport: ((result: DiagnosticExportResult) => void) | undefined;
    exportDiagnosticsMock.mockImplementation(() => new Promise((resolve) => {
      resolveExport = resolve;
    }));
    const render = await createHook();

    let hook = render();
    const first = hook.exportDiagnostics();
    const duplicate = hook.exportDiagnostics();
    hook = render();

    expect(exportDiagnosticsMock).toHaveBeenCalledTimes(1);
    expect(hook.diagnosticExportBusy).toBe(true);
    expect(hook.diagnosticExportNotice).toBeNull();

    resolveExport?.({ status: "exported" });
    await Promise.all([first, duplicate]);
    hook = render();

    expect(hook.diagnosticExportBusy).toBe(false);
    expect(hook.diagnosticExportNotice).toEqual({
      messageCode: "diagnostics.notice.exported",
    });
  });

  test("keeps cancellation silent", async () => {
    exportDiagnosticsMock.mockResolvedValue({ status: "cancelled" });
    const render = await createHook();

    let hook = render();
    await hook.exportDiagnostics();
    hook = render();

    expect(hook.diagnosticExportBusy).toBe(false);
    expect(hook.diagnosticExportNotice).toBeNull();
  });

  test("uses a fixed safe failure notice without retaining backend details", async () => {
    exportDiagnosticsMock.mockResolvedValue({
      status: "failed",
      code: "DIAGNOSTIC_EXPORT_FAILED",
    });
    const render = await createHook();

    let hook = render();
    await hook.exportDiagnostics();
    hook = render();

    expect(hook.diagnosticExportNotice).toEqual({
      messageCode: "diagnostics.notice.exportFailed",
    });
    const state = JSON.stringify(hook);
    expect(state).not.toMatch(/path|\.zip|log|url|error/i);
  });
});
