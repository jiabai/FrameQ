import { beforeEach, describe, expect, test, vi } from "vitest";

import type { AccountStatus } from "../../accountState";
import type { SupportedLocale } from "../../i18n/locale";
import type { UiMessage } from "../../i18n/uiMessage";

type StateUpdater<T> = T | ((current: T) => T);

type HookHarness = {
  resetRender: () => void;
  runEffects: () => void;
  unmount: () => void;
  useCallback: <T extends (...args: never[]) => unknown>(callback: T, deps?: unknown[]) => T;
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void;
  useMemo: <T>(factory: () => T, deps?: unknown[]) => T;
  useRef: <T>(initialValue: T) => { current: T };
  useState: <T>(initialValue: T | (() => T)) => [T, (next: StateUpdater<T>) => void];
};

const {
  beginAuthFlowMock,
  completeAuthFlowMock,
  getAccountStatusMock,
  logoutAccountMock,
  redeemActivationCodeMock,
  requestActivationCodeMock,
  openUrlMock,
} = vi.hoisted(() => ({
  beginAuthFlowMock: vi.fn<() => Promise<{ authUrl: string }>>(),
  completeAuthFlowMock: vi.fn<(callbackUrl: string) => Promise<void>>(),
  getAccountStatusMock: vi.fn<() => Promise<AccountStatus>>(),
  logoutAccountMock: vi.fn<() => Promise<void>>(),
  redeemActivationCodeMock: vi.fn<(code: string) => Promise<AccountStatus>>(),
  requestActivationCodeMock: vi.fn<
    (locale: SupportedLocale) => Promise<{ status: "sent"; retryAt: string; redeemBy: string }>
  >(),
  openUrlMock: vi.fn<(url: string) => Promise<void>>(),
}));
let currentLocale: SupportedLocale = "en-US";

vi.mock("../../accountClient", async () => {
  const actual = await vi.importActual<typeof import("../../accountClient")>(
    "../../accountClient",
  );

  return {
  ...actual,
  beginAuthFlow: beginAuthFlowMock,
  completeAuthFlow: completeAuthFlowMock,
  getAccountStatus: getAccountStatusMock,
  logoutAccount: logoutAccountMock,
  redeemActivationCode: redeemActivationCodeMock,
  requestActivationCode: requestActivationCodeMock,
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

vi.mock("../../i18n/LocaleProvider", () => ({
  useLocale: () => ({
    preference: currentLocale,
    resolvedLocale: currentLocale,
    setLanguagePreference: vi.fn(),
  }),
}));

function createHookHarness(): HookHarness {
  const states: unknown[] = [];
  const effects = new Map<number, { effect: () => void | (() => void); deps?: unknown[]; cleanup?: () => void }>();
  const pendingEffects = new Set<number>();
  let cursor = 0;
  let mounted = true;

  return {
    resetRender: () => {
      cursor = 0;
    },
    runEffects: () => {
      for (const effectIndex of pendingEffects) {
        const record = effects.get(effectIndex);
        if (!record) {
          continue;
        }
        if (String(record.effect).includes("refreshAccountStatus")) {
          continue;
        }
        record.cleanup?.();
        const cleanup = record.effect();
        record.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      }
      pendingEffects.clear();
    },
    unmount: () => {
      mounted = false;
      for (const record of effects.values()) {
        record.cleanup?.();
      }
      effects.clear();
      pendingEffects.clear();
    },
    useCallback: (callback, deps) => {
      const stateIndex = cursor;
      cursor += 1;
      const previous = states[stateIndex] as { callback: typeof callback; deps?: unknown[] } | undefined;
      const depsChanged =
        !previous ||
        !deps ||
        !previous.deps ||
        deps.length !== previous.deps.length ||
        deps.some((dependency, index) => !Object.is(dependency, previous.deps?.[index]));
      if (depsChanged) {
        states[stateIndex] = { callback, deps };
      }
      return (states[stateIndex] as { callback: typeof callback }).callback;
    },
    useEffect: (effect, deps) => {
      const effectIndex = cursor;
      cursor += 1;
      const previous = effects.get(effectIndex);
      const depsChanged =
        !previous ||
        !deps ||
        !previous.deps ||
        deps.length !== previous.deps.length ||
        deps.some((dependency, index) => !Object.is(dependency, previous.deps?.[index]));

      effects.set(effectIndex, {
        effect,
        deps,
        cleanup: previous?.cleanup,
      });

      if (depsChanged) {
        pendingEffects.add(effectIndex);
      }
    },
    useMemo: <T,>(factory: () => T, deps?: unknown[]) => {
      const stateIndex = cursor;
      cursor += 1;
      const previous = states[stateIndex] as { deps?: unknown[]; value: T } | undefined;
      const depsChanged =
        !previous ||
        !deps ||
        !previous.deps ||
        deps.length !== previous.deps.length ||
        deps.some((dependency, index) => !Object.is(dependency, previous.deps?.[index]));
      if (depsChanged) {
        states[stateIndex] = { deps, value: factory() };
      }
      return (states[stateIndex] as { value: T }).value;
    },
    useRef: <T,>(initialValue: T) => {
      const stateIndex = cursor;
      cursor += 1;
      if (states.length <= stateIndex) {
        states[stateIndex] = { current: initialValue };
      }
      return states[stateIndex] as { current: T };
    },
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
        if (!mounted) {
          return;
        }
        states[stateIndex] =
          typeof next === "function"
            ? (next as (current: T) => T)(states[stateIndex] as T)
            : next;
      };
      return [states[stateIndex] as T, setState];
    },
  };
}

async function createController() {
  const harness = createHookHarness();
  vi.doMock("react", () => ({
    useCallback: harness.useCallback,
    useEffect: harness.useEffect,
    useMemo: harness.useMemo,
    useRef: harness.useRef,
    useState: harness.useState,
  }));
  const { initializeI18n } = await import("../../i18n/i18n");
  await initializeI18n(currentLocale);
  const { useAccountController } = await import("./useAccountController");
  const onSignedOut = vi.fn();

  return {
    render: () => {
      harness.resetRender();
      const controller = useAccountController({ onSignedOut });
      harness.runEffects();
      return controller;
    },
    unmount: harness.unmount,
    onSignedOut,
  };
}

function expectSafeMessage(
  notice: UiMessage | null,
  messageCode: string,
  secret: string,
): void {
  expect(notice).toEqual({ messageCode });
  expect(JSON.stringify(notice)).not.toContain(secret);
}

function createAccountStatus(
  email: string,
  overrides: Partial<AccountStatus> = {},
): AccountStatus {
  return {
    authenticated: true,
    email,
    entitlementStatus: "active",
    entitlementExpiresAt: null,
    llmQuotaLimit: 10,
    llmQuotaUsed: 1,
    llmQuotaRemaining: 9,
    llmQuotaResetsAt: null,
    llmConfigured: true,
    lastVerifiedAt: null,
    canProcess: true,
    canGenerateAi: true,
    canRequestActivationCode: false,
    serverError: null,
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useAccountController semantic notices", () => {
  beforeEach(() => {
    vi.resetModules();
    currentLocale = "en-US";
    beginAuthFlowMock.mockReset();
    completeAuthFlowMock.mockReset();
    getAccountStatusMock.mockReset();
    logoutAccountMock.mockReset();
    redeemActivationCodeMock.mockReset();
    requestActivationCodeMock.mockReset();
    openUrlMock.mockReset();
    vi.useRealTimers();
  });

  test("does not retain raw account refresh failures", async () => {
    const secret = "D:/private/account-refresh-secret.txt";
    getAccountStatusMock.mockRejectedValueOnce(new Error(secret));
    const { render } = await createController();

    let controller = render();
    await controller.refreshAccountStatus();
    controller = render();

    expectSafeMessage(controller.accountNotice, "account.notice.statusRefreshFailed", secret);
    expect(controller.account.serverError).toBe("ACCOUNT_STATUS_UNAVAILABLE");
  });

  test("replaces server-provided error prose with a stable status code", async () => {
    const secret = "D:/private/backend-account-secret.txt";
    getAccountStatusMock.mockResolvedValueOnce(
      createAccountStatus("member@example.test", { serverError: secret }),
    );
    const { render } = await createController();

    let controller = render();
    await controller.refreshAccountStatus();
    controller = render();

    expect(controller.account.serverError).toBe("ACCOUNT_STATUS_UNAVAILABLE");
    expect(JSON.stringify(controller.account)).not.toContain(secret);
    expectSafeMessage(
      controller.accountNotice,
      "account.notice.statusRefreshFailed",
      secret,
    );
  });

  test("keeps the newest account refresh when an older request resolves last", async () => {
    const first = deferred<AccountStatus>();
    const second = deferred<AccountStatus>();
    getAccountStatusMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { render } = await createController();

    let controller = render();
    const firstRefresh = controller.refreshAccountStatus();
    controller = render();
    const secondRefresh = controller.refreshAccountStatus();

    second.resolve(createAccountStatus("newest@example.test"));
    await secondRefresh;
    controller = render();
    expect(controller.account.email).toBe("newest@example.test");
    expect(controller.accountLoading).toBe(false);

    first.resolve(createAccountStatus("stale@example.test"));
    await firstRefresh;
    controller = render();
    expect(controller.account.email).toBe("newest@example.test");
    expect(controller.accountLoading).toBe(false);
  });

  test("does not let a passive refresh overwrite a later activation", async () => {
    const passiveRefresh = deferred<AccountStatus>();
    getAccountStatusMock.mockImplementationOnce(() => passiveRefresh.promise);
    redeemActivationCodeMock.mockResolvedValueOnce(
      createAccountStatus("activated@example.test"),
    );
    const { render } = await createController();

    let controller = render();
    const refresh = controller.refreshAccountStatus();
    controller.setActivationCodeDraft("FQ-TEST");
    controller = render();
    await controller.redeemActivationCodeFromInput();
    controller = render();
    expect(controller.account.email).toBe("activated@example.test");
    expect(controller.accountLoading).toBe(false);

    passiveRefresh.resolve(createAccountStatus("stale@example.test"));
    await refresh;
    controller = render();
    expect(controller.account.email).toBe("activated@example.test");
    expect(controller.accountNotice).toEqual({
      messageCode: "account.notice.activationSuccess",
    });
  });

  test("uses fixed semantic failures for login, activation, and sign-out", async () => {
    const secret = "private-auth-token";
    beginAuthFlowMock.mockRejectedValueOnce(new Error(secret));
    const { render } = await createController();

    let controller = render();
    await controller.startLoginFlow();
    controller = render();
    expectSafeMessage(controller.accountNotice, "account.notice.loginStartFailed", secret);

    controller.setActivationCodeDraft("FQ-TEST");
    controller = render();
    redeemActivationCodeMock.mockRejectedValueOnce(new Error(secret));
    await controller.redeemActivationCodeFromInput();
    controller = render();
    expectSafeMessage(controller.accountNotice, "account.notice.activationFailed", secret);

    logoutAccountMock.mockRejectedValueOnce(new Error(secret));
    await controller.signOutAccount();
    controller = render();
    expectSafeMessage(controller.accountNotice, "account.notice.signOutFailed", secret);
  });

  test("derives account chip and status copy from the current locale", async () => {
    const activeAccount = createAccountStatus("member@example.test");
    getAccountStatusMock.mockResolvedValueOnce(activeAccount);
    const { render } = await createController();

    let controller = render();
    await controller.refreshAccountStatus();
    controller = render();
    expect(controller.accountChipLabel).toBe("Authorized");
    expect(controller.accountStatusText).toBe("Authorization active");

    currentLocale = "zh-TW";
    controller = render();
    expect(controller.accountChipLabel).toBe("授權有效");
    expect(controller.accountStatusText).toBe("授權有效");
  });

  test("requests an activation code with the current locale, refreshes status, and clears cooldown after retryAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T04:00:00.000Z"));
    const retryAt = "2026-08-25T04:05:00.000Z";
    requestActivationCodeMock.mockResolvedValueOnce({
      status: "sent",
      retryAt,
      redeemBy: "2026-09-24T00:00:00.000Z",
    });
    getAccountStatusMock.mockResolvedValueOnce(
      createAccountStatus("member@example.test", {
        entitlementStatus: "inactive",
        canProcess: false,
        canRequestActivationCode: true,
      }),
    );
    const { render } = await createController();

    let controller = render();
    await controller.refreshAccountStatus();
    controller = render();
    const pendingRequest = controller.requestActivationCodeByEmail();
    controller = render();

    expect(requestActivationCodeMock).toHaveBeenCalledWith("en-US");
    expect(controller.activationCodeRequest.status).toBe("pending");

    await pendingRequest;
    controller = render();
    expect(controller.activationCodeRequest.status).toBe("success");
    expect(controller.activationCodeRequest.retryAt).toBe(retryAt);
    expect(controller.accountNotice).toEqual({
      messageCode: "account.notice.activationCodeSent",
    });
    expect(getAccountStatusMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    controller = render();
    expect(controller.activationCodeRequest.status).toBe("idle");
    expect(controller.activationCodeRequest.retryAt).toBeNull();
  });

  test("maps activation code request failures to semantic notices without leaking raw details", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T04:30:00.000Z"));
    requestActivationCodeMock.mockRejectedValueOnce(
      new (await import("../../accountClient")).ActivationCodeRequestError("ACTIVATION_REQUEST_RATE_LIMITED", {
        retryAt: "2026-08-25T05:00:00.000Z",
        httpStatus: 429,
      }),
    );
    getAccountStatusMock.mockResolvedValueOnce(
      createAccountStatus("member@example.test", {
        entitlementStatus: "inactive",
        canProcess: false,
        canRequestActivationCode: true,
      }),
    );
    const { render } = await createController();

    let controller = render();
    await controller.refreshAccountStatus();
    controller = render();
    await controller.requestActivationCodeByEmail();
    controller = render();

    expect(controller.activationCodeRequest.status).toBe("error");
    expect(controller.activationCodeRequest.retryAt).toBe("2026-08-25T05:00:00.000Z");
    expectSafeMessage(
      controller.accountNotice,
      "account.notice.activationCodeRateLimited",
      "token-SECRET",
    );
    expect(JSON.stringify(controller.activationCodeRequest)).not.toContain("token-SECRET");
  });

  test("cleans activation code cooldown timers on unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T05:30:00.000Z"));
    requestActivationCodeMock.mockResolvedValueOnce({
      status: "sent",
      retryAt: "2026-08-25T06:00:00.000Z",
      redeemBy: "2026-09-24T00:00:00.000Z",
    });
    getAccountStatusMock.mockResolvedValueOnce(
      createAccountStatus("member@example.test", {
        entitlementStatus: "inactive",
        canProcess: false,
        canRequestActivationCode: true,
      }),
    );
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { render, unmount } = await createController();

    let controller = render();
    await controller.refreshAccountStatus();
    controller = render();
    await controller.requestActivationCodeByEmail();
    controller = render();
    expect(controller.activationCodeRequest.status).toBe("success");

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
