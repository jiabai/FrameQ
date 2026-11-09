// @vitest-environment jsdom

import { useState, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createInstance, type Resource } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

import type { HistoryListItem } from "../../historyClient";
import type { SupportedLocale } from "../../i18n/locale";
import { shellResources } from "../../i18n/shellResources";
import { getSidebarNoteMenuPosition, SidebarNoteMenu, type NoteAction } from "./SidebarNoteMenu";

function note(overrides: Partial<HistoryListItem> = {}): HistoryListItem {
  return {
    taskId: "saved-note", id: "saved-note", createdAt: "2026-10-31T00:00:00Z",
    source: { kind: "url", url: "https://www.youtube.com/watch?v=abcDEF_123-" },
    status: "completed", taskDir: "D:/Locus/outputs/saved-note", outputDir: "D:/Locus/outputs/saved-note",
    artifacts: { transcript_txt: "transcript/transcript.txt" }, error: null,
    textPreview: "Saved note", insightsCount: 0, ...overrides,
  };
}

async function localized(ui: ReactElement, locale: SupportedLocale = "en-US") {
  const i18n = createInstance();
  await i18n.init({
    lng: locale, fallbackLng: false,
    resources: { [locale]: { shell: shellResources[locale] } } as Resource,
    interpolation: { escapeValue: false },
  });
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

function origin() {
  const scroll = document.createElement("div");
  scroll.style.overflowY = "auto";
  const anchor = document.createElement("button");
  anchor.id = "origin-note-menu";
  anchor.textContent = "Note actions";
  scroll.append(anchor);
  document.body.append(scroll);
  return { anchor, scroll };
}

afterEach(() => {
  cleanup();
  document.getElementById("note-menu-style-test")?.remove();
  document.body.replaceChildren();
});

describe("SidebarNoteMenu", () => {
  test.each<SupportedLocale>(["zh-CN", "zh-TW", "en-US"])("renders exactly the seven actions in the confirmed order in %s", async (locale) => {
    const { anchor, scroll } = origin();
    const actions: NoteAction[] = [];
    const closed: boolean[] = [];
    await localized(<SidebarNoteMenu item={note()} anchor={anchor} mutationDisabled={false} disabledReason="" onAction={(action) => actions.push(action)} onClose={(restore) => closed.push(restore)} />, locale);
    const menu = screen.getByRole("menu");
    const resource = shellResources[locale].noteMenu;
    const buttons = within(menu).getAllByRole("menuitem");
    expect(buttons.map((button) => button.textContent)).toEqual([
      resource.pin, resource.rename, resource.collection, resource.copy_source,
      resource.open_source, resource.info, resource.delete,
    ]);
    expect(within(menu).getAllByRole("separator")).toHaveLength(4);
    expect(Array.from(menu.children).map((element) => element.getAttribute("role")).filter(Boolean)).toEqual([
      "menuitem", "separator", "menuitem", "menuitem", "separator", "menuitem", "menuitem", "separator", "menuitem", "separator", "menuitem",
    ]);
    expect(menu.id).toBe(`${anchor.id}-menu`);
    expect(scroll.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.click(buttons[5]);
    expect(actions).toEqual(["info"]);
    expect(closed).toEqual([true]);
  });

  test("uses desktop text and row density while retaining left alignment and plain icons", async () => {
    const stylesheet = document.createElement("style");
    stylesheet.id = "note-menu-style-test";
    stylesheet.textContent = readFileSync("src/App.css", "utf-8") + readFileSync("src/features/shell/sidebar.css", "utf-8");
    document.head.append(stylesheet);
    const { anchor } = origin();
    const nav = document.createElement("button");
    nav.className = "shell-nav-item";
    const account = document.createElement("div");
    account.className = "shell-account-menu";
    const accountAction = document.createElement("button");
    account.append(accountAction);
    document.body.append(nav, account);
    await localized(<SidebarNoteMenu item={note()} anchor={anchor} mutationDisabled={false} disabledReason="" onAction={() => {}} onClose={() => {}} />);
    const menu = screen.getByRole("menu");
    expect(getComputedStyle(menu).textAlign).toBe("left");
    expect(getComputedStyle(menu).paddingTop).toBe("4px");
    expect(getComputedStyle(menu).paddingBottom).toBe("4px");
    expect(parseFloat(getComputedStyle(menu).width)).toBeLessThanOrEqual(240);
    const navFontSize = parseFloat(getComputedStyle(nav).fontSize);
    const accountRowHeight = parseFloat(getComputedStyle(accountAction).minHeight);
    for (const button of within(menu).getAllByRole("menuitem")) {
      expect(getComputedStyle(button).justifyContent).toBe("flex-start");
      expect(getComputedStyle(button).textAlign).toBe("left");
      const style = getComputedStyle(button);
      expect(parseFloat(style.fontSize)).toBe(navFontSize);
      expect(parseFloat(style.minHeight)).toBeGreaterThanOrEqual(30);
      expect(parseFloat(style.minHeight)).toBeLessThanOrEqual(accountRowHeight);
      expect(parseFloat(style.paddingLeft)).toBeLessThanOrEqual(14);
      expect(style.paddingLeft).toBe(style.paddingRight);
      const label = button.querySelector("span")!;
      expect(getComputedStyle(label).textAlign).toBe("left");
      const icon = button.querySelector("svg")!;
      expect(parseFloat(getComputedStyle(icon).width)).toBeLessThanOrEqual(navFontSize + 2);
      expect(getComputedStyle(icon).width).toBe(getComputedStyle(icon).height);
      expect(getComputedStyle(icon).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    }
    for (const divider of within(menu).getAllByRole("separator")) {
      expect(parseFloat(getComputedStyle(divider).marginTop)).toBeLessThanOrEqual(4);
      expect(getComputedStyle(divider).marginTop).toBe(getComputedStyle(divider).marginBottom);
    }
  });

  test("dispatches each enabled action once and switches pin to unpin from committed metadata", async () => {
    const order: NoteAction[] = ["pin", "rename", "collection", "copy_source", "open_source", "info", "delete"];
    const actions: NoteAction[] = [];
    for (let index = 0; index < order.length; index += 1) {
      const { anchor } = origin();
      const view = await localized(<SidebarNoteMenu item={note({ noteMetadata: { pinned: true, displayTitle: null } })} anchor={anchor} mutationDisabled={false} disabledReason="" onAction={(action) => actions.push(action)} onClose={() => {}} />);
      const buttons = screen.getAllByRole("menuitem");
      expect(buttons[0].textContent).toBe("Unpin");
      fireEvent.click(buttons[index]);
      view.unmount();
      anchor.parentElement?.remove();
    }
    expect(actions).toEqual(order);
  });

  test("skips disabled mutations and local source actions while retaining information", async () => {
    const { anchor } = origin();
    const actions: NoteAction[] = [];
    const closed: boolean[] = [];
    await localized(<SidebarNoteMenu item={note({ source: { kind: "local_file", displayName: "Interview.mp3", mediaKind: "audio" } })} anchor={anchor} mutationDisabled disabledReason="Save your edits first." onAction={(action) => actions.push(action)} onClose={(restore) => closed.push(restore)} />);
    const buttons = screen.getAllByRole("menuitem") as HTMLButtonElement[];
    expect(buttons.map((button) => button.disabled)).toEqual([true, true, true, true, true, false, true]);
    expect(buttons[0].title).toBe("Save your edits first.");
    expect(buttons[3].title).toBe(shellResources["en-US"].noteMenu.sourceUnavailable);
    expect(document.getElementById(buttons[3].getAttribute("aria-describedby")!)?.textContent).toBe(shellResources["en-US"].noteMenu.sourceUnavailable);
    expect(document.activeElement).toBe(buttons[5]);
    fireEvent.keyDown(buttons[5], { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[5]);
    fireEvent.click(buttons[0]);
    expect(actions).toEqual([]);
    expect(closed).toEqual([]);
  });

  test("keeps malformed note settings readable and deletable while disabling pin and rename", async () => {
    const { anchor } = origin();
    await localized(<SidebarNoteMenu item={note({ noteMetadataError: "NOTE_METADATA_INVALID" })} anchor={anchor} mutationDisabled={false} disabledReason="" onAction={() => {}} onClose={() => {}} />);
    const buttons = screen.getAllByRole("menuitem") as HTMLButtonElement[];
    expect(buttons.map((button) => button.disabled)).toEqual([true, true, false, false, false, false, false]);
    expect(buttons[0].title).toBe(shellResources["en-US"].noteMenu.metadataUnavailable);
    expect(document.activeElement).toBe(buttons[2]);
  });

  test.each(["javascript:alert(1)", "https://user:private@example.com/video", "not a URL"])("disables source actions for an unsafe saved source: %s", async (url) => {
    const { anchor } = origin();
    await localized(<SidebarNoteMenu item={note({ source: { kind: "url", url } })} anchor={anchor} mutationDisabled={false} disabledReason="" onAction={() => {}} onClose={() => {}} />);
    for (const name of ["Copy source link", "Open source"]) {
      expect((screen.getByRole("menuitem", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  test("wraps enabled keyboard items, supports Home and End, and consumes Escape", async () => {
    const { anchor } = origin();
    const closed: boolean[] = [];
    let escapedOutside = 0;
    const onWindowKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") escapedOutside += 1; };
    window.addEventListener("keydown", onWindowKey);
    await localized(<SidebarNoteMenu item={note()} anchor={anchor} mutationDisabled={false} disabledReason="" onAction={() => {}} onClose={(restore) => { closed.push(restore); if (restore) anchor.focus(); }} />);
    const buttons = screen.getAllByRole("menuitem");
    fireEvent.keyDown(buttons[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[6]);
    fireEvent.keyDown(buttons[6], { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: "End" });
    expect(document.activeElement).toBe(buttons[6]);
    fireEvent.keyDown(buttons[6], { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: "Escape" });
    expect(closed).toEqual([true]);
    expect(document.activeElement).toBe(anchor);
    expect(escapedOutside).toBe(0);
    window.removeEventListener("keydown", onWindowKey);
  });

  test("closes for Tab without trapping keyboard navigation", async () => {
    const { anchor } = origin();
    const closed: boolean[] = [];
    await localized(<SidebarNoteMenu item={note()} anchor={anchor} mutationDisabled={false} disabledReason="" onAction={() => {}} onClose={(restore) => closed.push(restore)} />);
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    screen.getAllByRole("menuitem")[0].dispatchEvent(event);
    expect(closed).toEqual([false]);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  test("does not steal focus when outside pointer input closes the menu", async () => {
    const { anchor } = origin();
    const outside = document.createElement("button");
    document.body.append(outside);
    const closed: boolean[] = [];
    await localized(<SidebarNoteMenu item={note()} anchor={anchor} mutationDisabled={false} disabledReason="" onAction={() => {}} onClose={(restore) => closed.push(restore)} />);
    fireEvent.pointerDown(outside);
    outside.focus();
    expect(closed).toEqual([false]);
    expect(document.activeElement).toBe(outside);
  });

  test("allows internal menu scrolling and closes on anchor-container scrolling", async () => {
    const { anchor, scroll } = origin();
    const closed: boolean[] = [];
    await localized(<SidebarNoteMenu item={note()} anchor={anchor} mutationDisabled={false} disabledReason="" onAction={() => {}} onClose={(restore) => closed.push(restore)} />);
    fireEvent.scroll(screen.getByRole("menu"));
    expect(closed).toEqual([]);
    fireEvent.scroll(scroll);
    expect(closed).toEqual([false]);
  });

  test.each(["resize", "removal", "collapse"])("closes when its anchor becomes invalid through %s", async (change) => {
    const { anchor, scroll } = origin();
    const closed: boolean[] = [];
    await localized(<SidebarNoteMenu item={note()} anchor={anchor} mutationDisabled={false} disabledReason="" onAction={() => {}} onClose={(restore) => closed.push(restore)} />);
    if (change === "resize") fireEvent(window, new Event("resize"));
    if (change === "removal") anchor.remove();
    if (change === "collapse") scroll.hidden = true;
    await waitFor(() => expect(closed).toEqual([false]));
  });

  test("does not keep document listeners after unmount", async () => {
    const { anchor, scroll } = origin();
    const closed: boolean[] = [];
    const view = await localized(<SidebarNoteMenu item={note()} anchor={anchor} mutationDisabled={false} disabledReason="" onAction={() => {}} onClose={(restore) => closed.push(restore)} />);
    view.unmount();
    fireEvent.scroll(scroll);
    fireEvent(window, new Event("resize"));
    fireEvent.pointerDown(document.body);
    expect(closed).toEqual([]);
  });

  test("lets the parent remove the menu before opening another action surface", async () => {
    const { anchor } = origin();
    function Flow() {
      const [open, setOpen] = useState(true);
      const [action, setAction] = useState<NoteAction | null>(null);
      return <>{open ? <SidebarNoteMenu item={note()} anchor={anchor} mutationDisabled={false} disabledReason="" onClose={() => setOpen(false)} onAction={setAction} /> : null}{action ? <p role="status">{action}</p> : null}</>;
    }
    await localized(<Flow />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("rename");
  });

  test("accepts a new anchor and task without reusing the previous close state", async () => {
    const first = origin();
    const second = origin();
    second.anchor.id = "second-note-menu";
    const actions: NoteAction[] = [];
    function Retarget() {
      const [target, setTarget] = useState(first.anchor);
      return <><button onClick={() => setTarget(second.anchor)}>Another note</button><SidebarNoteMenu item={note({ taskId: target.id })} anchor={target} mutationDisabled={false} disabledReason="" onClose={() => {}} onAction={(action) => actions.push(action)} /></>;
    }
    await localized(<Retarget />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Another note" }));
    fireEvent.click(screen.getByRole("button", { name: "Another note" }));
    expect(screen.getByRole("menu").id).toBe(`${second.anchor.id}-menu`);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Pin to sidebar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Note information" }));
    expect(actions).toEqual(["info"]);
  });
});

describe("getSidebarNoteMenuPosition", () => {
  test("places a measured menu next to its anchor", () => {
    expect(getSidebarNoteMenuPosition({ left: 230, right: 258, top: 210 }, { width: 240, height: 330 }, { width: 1734, height: 907 })).toEqual({ left: 264, top: 210, maxWidth: 1718, maxHeight: 891 });
  });

  test("keeps the menu inside a 720x640 viewport near the bottom-right corner", () => {
    const result = getSidebarNoteMenuPosition({ left: 680, right: 708, top: 620 }, { width: 240, height: 330 }, { width: 720, height: 640 });
    expect(result.left).toBe(434);
    expect(result.top).toBe(302);
    expect(result.left + 240).toBeLessThanOrEqual(712);
    expect(result.top + 330).toBeLessThanOrEqual(632);
  });

  test("bounds oversized menus so their CSS-constrained content can scroll", () => {
    expect(getSidebarNoteMenuPosition({ left: 0, right: 28, top: 0 }, { width: 900, height: 900 }, { width: 720, height: 640 })).toEqual({ left: 8, top: 8, maxWidth: 704, maxHeight: 624 });
  });
});
