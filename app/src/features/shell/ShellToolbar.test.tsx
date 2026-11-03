// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createInstance, type Resource } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, test } from "vitest";

import type { SupportedLocale } from "../../i18n/locale";
import { resources } from "../../i18n/resources";
import { shellResources } from "../../i18n/shellResources";
import { ShellToolbar } from "./ShellToolbar";

function unexpectedAction(): never {
  throw new Error("Unexpected user action");
}

function toolbarProps(overrides: Partial<ComponentProps<typeof ShellToolbar>> = {}): ComponentProps<typeof ShellToolbar> {
  return {
    collapsed: false,
    title: "Home",
    canBack: true,
    canForward: true,
    disabledReason: "Finish the current task before switching views.",
    update: { visible: false, status: "idle", text: "", busy: false, spinnerVisible: false },
    onToggleSidebar: unexpectedAction,
    onBack: unexpectedAction,
    onForward: unexpectedAction,
    onInstallUpdate: unexpectedAction,
    ...overrides,
  };
}

async function renderToolbar(props = toolbarProps(), locale: SupportedLocale = "en-US") {
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    fallbackLng: false,
    resources: { [locale]: { shell: shellResources[locale], common: resources[locale].common } } as Resource,
    interpolation: { escapeValue: false },
  });
  return render(<I18nextProvider i18n={i18n}><ShellToolbar {...props} /></I18nextProvider>);
}

afterEach(cleanup);

describe("ShellToolbar", () => {
  test("omits the navigation title when opening a note", async () => {
    const { container } = await renderToolbar(toolbarProps({ title: "" }));
    expect(container.querySelector(".shell-toolbar-title")).toBeNull();
  });
  test.each<SupportedLocale>(["zh-CN", "zh-TW", "en-US"])("keeps navigation and window controls without a settings action in %s", async (locale) => {
    await renderToolbar(toolbarProps(), locale);
    const toolbar = screen.getByRole("banner");
    const shell = shellResources[locale];
    const common = resources[locale].common;

    expect(within(toolbar).queryByRole("button", { name: shell.toolbar.settings })).toBeNull();
    expect(within(toolbar).getByRole("button", { name: shell.toolbar.collapseSidebar }).getAttribute("aria-expanded")).toBe("true");
    expect(within(toolbar).getByRole("button", { name: shell.toolbar.back })).toBeTruthy();
    expect(within(toolbar).getByRole("button", { name: shell.toolbar.forward })).toBeTruthy();
    const windowControls = within(toolbar).getByRole("group", { name: common.window.controls });
    for (const name of [common.window.minimize, common.window.maximize, common.window.close]) {
      expect(within(windowControls).getByRole("button", { name })).toBeTruthy();
    }
    expect(within(toolbar).getByText("Home")).toBeTruthy();
  });

  test("routes sidebar, history navigation, and available updates through their actions", async () => {
    const actions: string[] = [];
    await renderToolbar(toolbarProps({
      collapsed: true,
      update: { visible: true, status: "available", text: "Install update", busy: false, spinnerVisible: false },
      onToggleSidebar: () => { actions.push("sidebar"); },
      onBack: () => { actions.push("back"); },
      onForward: () => { actions.push("forward"); },
      onInstallUpdate: () => { actions.push("update"); },
    }));

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    fireEvent.click(screen.getByRole("button", { name: "Go forward" }));
    fireEvent.click(screen.getByRole("button", { name: resources["en-US"].common.toolbar.update }));
    expect(actions).toEqual(["sidebar", "back", "forward", "update"]);
  });

  test("retains disabled navigation and in-progress update guards", async () => {
    await renderToolbar(toolbarProps({
      canBack: false,
      canForward: false,
      update: { visible: true, status: "downloading", text: "Downloading update", busy: true, spinnerVisible: true },
    }));

    for (const name of ["Go back", "Go forward"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(toolbarProps().disabledReason);
      fireEvent.click(button);
    }
    const update = screen.getByRole("button", { name: resources["en-US"].common.toolbar.update }) as HTMLButtonElement;
    expect(update.disabled).toBe(true);
    fireEvent.click(update);
  });
});
