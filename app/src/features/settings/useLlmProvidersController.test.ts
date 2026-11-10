import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  LlmProbeResult,
  LlmProviderDraft,
  LlmProviderView,
  LlmProvidersState,
  LlmSource,
} from "../../settingsClient";
import type { LlmProvidersController } from "./useLlmProvidersController";
import { uiMessage } from "../../i18n/uiMessage";

type StateUpdater<T> = T | ((current: T) => T);

type HookHarness = {
  resetRender: () => void;
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => T;
  useState: <T>(initialValue: T | (() => T)) => [T, (next: StateUpdater<T>) => void];
};

const mocks = vi.hoisted(() => ({
  getLlmProviders: vi.fn<() => Promise<LlmProvidersState>>(),
  saveLlmProvider: vi.fn<(draft: LlmProviderDraft) => Promise<LlmProvidersState>>(),
  deleteLlmProvider: vi.fn<(id: string) => Promise<LlmProvidersState>>(),
  setActiveLlmProvider: vi.fn<(id: string) => Promise<LlmProvidersState>>(),
  setLlmSource: vi.fn<(source: LlmSource) => Promise<LlmProvidersState>>(),
  testLlmConnection: vi.fn<(draft: LlmProviderDraft) => Promise<LlmProbeResult>>(),
}));

vi.mock("../../settingsClient", () => ({
  getLlmProviders: mocks.getLlmProviders,
  saveLlmProvider: mocks.saveLlmProvider,
  deleteLlmProvider: mocks.deleteLlmProvider,
  setActiveLlmProvider: mocks.setActiveLlmProvider,
  setLlmSource: mocks.setLlmSource,
  testLlmConnection: mocks.testLlmConnection,
}));

function createHookHarness(): HookHarness {
  const states: unknown[] = [];
  let cursor = 0;

  return {
    resetRender: () => {
      cursor = 0;
    },
    useCallback: (callback) => callback,
    useState: <T,>(initialValue: T | (() => T)) => {
      const stateIndex = cursor;
      cursor += 1;
      if (states.length <= stateIndex) {
        states[stateIndex] =
          typeof initialValue === "function"
            ? (initialValue as () => T)()
            : initialValue;
      }
      const setState = (next: StateUpdater<T>) => {
        states[stateIndex] =
          typeof next === "function"
            ? (next as (current: T) => T)(states[stateIndex] as T)
            : next;
      };
      return [states[stateIndex] as T, setState];
    },
  };
}

function createProvider(
  overrides: Partial<LlmProviderView> = {},
): LlmProviderView {
  return {
    id: "provider-1",
    label: "DeepSeek",
    provider: "openai_compatible",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    timeoutSeconds: 30,
    hasKey: true,
    ...overrides,
  };
}

function createState(
  overrides: Partial<LlmProvidersState> = {},
): LlmProvidersState {
  return { source: "managed", activeId: null, providers: [], ...overrides };
}

async function createController(): Promise<{
  render: () => LlmProvidersController;
}> {
  const harness = createHookHarness();
  vi.doMock("react", () => ({
    useCallback: harness.useCallback,
    useState: harness.useState,
  }));
  const { useLlmProvidersController } = await import(
    "./useLlmProvidersController"
  );

  return {
    render: () => {
      harness.resetRender();
      return useLlmProvidersController();
    },
  };
}

describe("useLlmProvidersController", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
  });

  test("starts with a managed empty state and no key in React state", async () => {
    const { render } = await createController();
    const controller = render();

    expect(controller.source).toBe("managed");
    expect(controller.activeId).toBeNull();
    expect(controller.providers).toEqual([]);
    expect(controller.busy).toBe(false);
    expect(controller.probing).toBe(false);
    expect(controller.dialogOpen).toBe(false);
    expect(controller.draft).toBeNull();
    expect(controller.probe).toBeNull();
    expect(controller.error).toBeNull();
    expect(JSON.stringify(controller)).not.toContain("apiKey");
  });

  test("loads providers and resets busy state", async () => {
    const loaded = createState({
      source: "byok",
      activeId: "provider-1",
      providers: [createProvider()],
    });
    mocks.getLlmProviders.mockResolvedValueOnce(loaded);
    const { render } = await createController();

    let controller = render();
    const pending = controller.loadLlmProviders();
    controller = render();
    expect(controller.busy).toBe(true);

    await pending;
    controller = render();
    expect(mocks.getLlmProviders).toHaveBeenCalledTimes(1);
    expect(controller.busy).toBe(false);
    expect(controller.source).toBe("byok");
    expect(controller.activeId).toBe("provider-1");
    expect(controller.providers).toEqual([createProvider()]);
    expect(controller.error).toBeNull();
  });

  test("surfaces load failures and resets busy state", async () => {
    mocks.getLlmProviders.mockRejectedValueOnce(new Error("keyring unavailable"));
    const { render } = await createController();

    let controller = render();
    await controller.loadLlmProviders();
    controller = render();

    expect(controller.busy).toBe(false);
    expect(controller.error).toEqual(
      uiMessage("settings.models.notice.loadFailed"),
    );
    expect(JSON.stringify(controller.error)).not.toContain("keyring unavailable");
  });

  test("opens an add dialog with an empty draft and no retained probe", async () => {
    const { render } = await createController();
    let controller = render();
    controller.startAdd();
    controller = render();

    expect(controller.dialogOpen).toBe(true);
    expect(controller.draft).toEqual({
      label: "",
      provider: "openai_compatible",
      baseUrl: "",
      model: "",
      timeoutSeconds: 60,
      apiKey: null,
    });
    expect(controller.probe).toBeNull();
    expect(controller.error).toBeNull();
  });

  test("opens an edit dialog without ever carrying a plaintext key", async () => {
    const { render } = await createController();
    let controller = render();
    controller.startEdit(createProvider());
    controller = render();

    expect(controller.dialogOpen).toBe(true);
    expect(controller.draft).toEqual({
      id: "provider-1",
      label: "DeepSeek",
      provider: "openai_compatible",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      timeoutSeconds: 30,
      apiKey: null,
    });
    expect(JSON.stringify(controller.draft)).not.toContain("sk-");
  });

  test("updates draft fields and clears the previous probe result", async () => {
    const { render } = await createController();
    let controller = render();
    controller.startAdd();
    controller = render();
    controller.updateDraft("label", "My DeepSeek");
    controller.updateDraft("baseUrl", "https://api.deepseek.com/v1");
    controller.updateDraft("model", "deepseek-reasoner");
    controller.updateDraft("timeoutSeconds", 45);
    controller.updateDraft("apiKey", "sk-secret-value");
    controller = render();

    expect(controller.draft).toEqual({
      label: "My DeepSeek",
      provider: "openai_compatible",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-reasoner",
      timeoutSeconds: 45,
      apiKey: "sk-secret-value",
    });
  });

  test("saves a draft, refreshes state, and never retains the plaintext key", async () => {
    const saved = createState({
      source: "byok",
      activeId: "provider-1",
      providers: [createProvider()],
    });
    mocks.saveLlmProvider.mockResolvedValueOnce(saved);
    const { render } = await createController();

    let controller = render();
    controller.startAdd();
    controller = render();
    controller.updateDraft("label", "DeepSeek");
    controller.updateDraft("baseUrl", "https://api.deepseek.com/v1");
    controller.updateDraft("model", "deepseek-chat");
    controller.updateDraft("timeoutSeconds", 30);
    controller.updateDraft("apiKey", "sk-secret-value");
    controller = render();

    const pending = controller.saveDraft();
    controller = render();
    expect(controller.busy).toBe(true);
    await pending;
    controller = render();

    expect(mocks.saveLlmProvider).toHaveBeenCalledWith({
      label: "DeepSeek",
      provider: "openai_compatible",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      timeoutSeconds: 30,
      apiKey: "sk-secret-value",
    });
    expect(controller.busy).toBe(false);
    expect(controller.providers).toEqual([createProvider()]);
    expect(controller.source).toBe("byok");
    expect(controller.dialogOpen).toBe(false);
    expect(controller.draft).toBeNull();
    expect(controller.probe).toBeNull();
    expect(controller.error).toBeNull();
    expect(controller.notice).toEqual(
      uiMessage("settings.models.notice.saved"),
    );
    expect(controller.providers[0]).not.toHaveProperty("apiKey");
    expect(JSON.stringify(controller)).not.toContain("sk-secret-value");
  });

  test("keeps the draft and surfaces a safe error when saving fails", async () => {
    mocks.saveLlmProvider.mockRejectedValueOnce(new Error("disk full"));
    const { render } = await createController();

    let controller = render();
    controller.startAdd();
    controller = render();
    controller.updateDraft("apiKey", "sk-secret-value");
    controller = render();
    await controller.saveDraft();
    controller = render();

    expect(controller.busy).toBe(false);
    expect(controller.dialogOpen).toBe(true);
    expect(controller.draft?.apiKey).toBe("sk-secret-value");
    expect(controller.error).toEqual(
      uiMessage("settings.models.notice.saveFailed"),
    );
    expect(JSON.stringify(controller.error)).not.toContain("disk full");
  });

  test("deletes a provider by id and refreshes state", async () => {
    mocks.deleteLlmProvider.mockResolvedValueOnce(createState());
    const { render } = await createController();

    let controller = render();
    await controller.removeProvider("provider-1");
    controller = render();

    expect(mocks.deleteLlmProvider).toHaveBeenCalledWith("provider-1");
    expect(controller.providers).toEqual([]);
    expect(controller.error).toBeNull();
  });

  test("surfaces a safe error when deletion fails", async () => {
    mocks.deleteLlmProvider.mockRejectedValueOnce(new Error("locked"));
    const { render } = await createController();

    let controller = render();
    await controller.removeProvider("provider-1");
    controller = render();

    expect(controller.error).toEqual(
      uiMessage("settings.models.notice.deleteFailed"),
    );
  });

  test("sets the active provider by id and refreshes state", async () => {
    mocks.setActiveLlmProvider.mockResolvedValueOnce(
      createState({ source: "byok", activeId: "provider-2" }),
    );
    const { render } = await createController();

    let controller = render();
    await controller.activateProvider("provider-2");
    controller = render();

    expect(mocks.setActiveLlmProvider).toHaveBeenCalledWith("provider-2");
    expect(controller.activeId).toBe("provider-2");
    expect(controller.error).toBeNull();
  });

  test("surfaces a safe error when activation fails", async () => {
    mocks.setActiveLlmProvider.mockRejectedValueOnce(new Error("missing"));
    const { render } = await createController();

    let controller = render();
    await controller.activateProvider("provider-2");
    controller = render();

    expect(controller.error).toEqual(
      uiMessage("settings.models.notice.activateFailed"),
    );
  });

  test.each(["managed", "byok"] as const)(
    "switches the LLM source to %s",
    async (source) => {
      mocks.setLlmSource.mockResolvedValueOnce(createState({ source }));
      const { render } = await createController();

      let controller = render();
      await controller.changeSource(source);
      controller = render();

      expect(mocks.setLlmSource).toHaveBeenCalledWith(source);
      expect(controller.source).toBe(source);
      expect(controller.error).toBeNull();
    },
  );

  test("surfaces a safe error when source switching fails", async () => {
    mocks.setLlmSource.mockRejectedValueOnce(new Error("store unavailable"));
    const { render } = await createController();

    let controller = render();
    await controller.changeSource("byok");
    controller = render();

    expect(controller.error).toEqual(
      uiMessage("settings.models.notice.sourceFailed"),
    );
  });

  test("stores a successful probe result without a key", async () => {
    mocks.testLlmConnection.mockResolvedValueOnce({
      ok: true,
      errorCode: null,
      latencyMs: 180,
    });
    const { render } = await createController();

    let controller = render();
    controller.startAdd();
    controller = render();
    controller.updateDraft("apiKey", "sk-secret-value");
    controller = render();
    const pending = controller.probeConnection();
    controller = render();
    expect(controller.probing).toBe(true);
    await pending;
    controller = render();

    expect(mocks.testLlmConnection).toHaveBeenCalledTimes(1);
    expect(controller.probing).toBe(false);
    expect(controller.probe).toEqual({
      ok: true,
      errorCode: null,
      latencyMs: 180,
    });
    expect(controller.error).toBeNull();
    expect(JSON.stringify(controller.probe)).not.toContain("sk-");
  });

  test.each([
    ["LLM_PROBE_AUTH_FAILED", "errors.llmProbe.authFailed"],
    ["LLM_PROBE_NETWORK_ERROR", "errors.llmProbe.networkError"],
    ["LLM_PROBE_TIMEOUT", "errors.llmProbe.timeout"],
    ["LLM_PROBE_UNEXPECTED_ERROR", "errors.llmProbe.unexpectedError"],
  ] as const)(
    "maps probe error %s to a localized message code",
    async (errorCode, messageCode) => {
      mocks.testLlmConnection.mockResolvedValueOnce({
        ok: false,
        errorCode,
        latencyMs: 90,
      });
      const { render } = await createController();

      let controller = render();
      controller.startAdd();
      controller = render();
      await controller.probeConnection();
      controller = render();

      expect(controller.probe).toEqual({ ok: false, errorCode, latencyMs: 90 });
      expect(controller.error).toEqual({ messageCode });
    },
  );

  test("surfaces a safe error when the probe command itself fails", async () => {
    mocks.testLlmConnection.mockRejectedValueOnce(new Error("worker crashed"));
    const { render } = await createController();

    let controller = render();
    controller.startAdd();
    controller = render();
    await controller.probeConnection();
    controller = render();

    expect(controller.probing).toBe(false);
    expect(controller.error).toEqual(
      uiMessage("settings.models.notice.probeFailed"),
    );
    expect(JSON.stringify(controller.error)).not.toContain("worker crashed");
  });

  test("resets errors explicitly and at the start of a new operation", async () => {
    mocks.getLlmProviders.mockRejectedValueOnce(new Error("offline"));
    mocks.deleteLlmProvider.mockResolvedValueOnce(createState());
    const { render } = await createController();

    let controller = render();
    await controller.loadLlmProviders();
    controller = render();
    expect(controller.error).not.toBeNull();

    controller.resetError();
    controller = render();
    expect(controller.error).toBeNull();

    mocks.getLlmProviders.mockRejectedValueOnce(new Error("offline"));
    controller = render();
    await controller.loadLlmProviders();
    controller = render();
    expect(controller.error).not.toBeNull();

    const pending = controller.removeProvider("provider-1");
    controller = render();
    expect(controller.error).toBeNull();
    await pending;
  });

  test("closing the dialog discards the draft, probe result, and error", async () => {
    const { render } = await createController();
    let controller = render();
    controller.startAdd();
    controller = render();
    controller.updateDraft("apiKey", "sk-secret-value");
    controller = render();
    controller.closeDialog();
    controller = render();

    expect(controller.dialogOpen).toBe(false);
    expect(controller.draft).toBeNull();
    expect(controller.probe).toBeNull();
    expect(controller.error).toBeNull();
    expect(JSON.stringify(controller)).not.toContain("sk-secret-value");
  });

  test("clears the success notice", async () => {
    mocks.saveLlmProvider.mockResolvedValueOnce(createState());
    const { render } = await createController();

    let controller = render();
    controller.startAdd();
    controller = render();
    await controller.saveDraft();
    controller = render();
    expect(controller.notice).not.toBeNull();

    controller.clearNotice();
    controller = render();
    expect(controller.notice).toBeNull();
  });
});
