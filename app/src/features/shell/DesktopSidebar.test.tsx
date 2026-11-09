// @vitest-environment jsdom

import type { ComponentProps, ReactElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createInstance, type Resource } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, test } from "vitest";

import { createGuestAccountStatus } from "../../accountState";
import type { HistoryListItem } from "../../historyClient";
import { historyResources } from "../../i18n/historyResources";
import type { SupportedLocale } from "../../i18n/locale";
import { resources } from "../../i18n/resources";
import { shellResources } from "../../i18n/shellResources";
import { DesktopSidebar } from "./DesktopSidebar";

function unexpectedAction(): never {
  throw new Error("Unexpected user action");
}

function historyItem(taskId: string, createdAt: string): HistoryListItem {
  return {
    taskId,
    id: taskId,
    createdAt,
    source: { kind: "local_file", displayName: `${taskId}.mp4`, mediaKind: "video" },
    status: "completed",
    taskDir: `D:/Locus/outputs/${taskId}`,
    outputDir: `D:/Locus/outputs/${taskId}`,
    artifacts: { transcript_txt: "transcript/transcript.txt" },
    error: null,
    textPreview: taskId,
    insightsCount: 0,
  };
}

function sidebarProps(
  overrides: Partial<ComponentProps<typeof DesktopSidebar>> = {},
): ComponentProps<typeof DesktopSidebar> {
  return {
    page: "home",
    collapsed: false,
    historyItems: [],
    historyLoading: false,
    historyNotice: null,
    collections: [],
    collectionsLoading: false,
    collectionsNotice: null,
    selectedCollectionId: null,
    currentTaskId: null,
    navigationDisabled: false,
    disabledReason: "Finish the current task before opening another task.",
    newTaskDisabled: false,
    account: createGuestAccountStatus(),
    onNavigate: unexpectedAction,
    onOpenTask: unexpectedAction,
    onNewTask: unexpectedAction,
    onOpenSettings: unexpectedAction,
    onOpenAccount: unexpectedAction,
    onRefresh: unexpectedAction,
    onOpenCollection: unexpectedAction,
    onCreateCollection: unexpectedAction,
    onOpenNoteMenu: unexpectedAction,
    ...overrides,
  };
}

async function renderLocalized(ui: ReactElement, locale: SupportedLocale = "en-US") {
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    fallbackLng: false,
    resources: {
      [locale]: { shell: shellResources[locale], history: historyResources[locale], common: resources[locale].common },
    } as Resource,
    interpolation: { escapeValue: false },
  });
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

afterEach(cleanup);

describe("DesktopSidebar", () => {
  test("duplicates verified pinned notes in their own independently collapsible group", async () => {
    const pinned = { ...historyItem("pinned-note", "2026-10-31T00:00:00Z"), noteMetadata: { pinned: true, displayTitle: null }, noteMetadataError: null };
    const invalid = { ...historyItem("invalid-settings", "2026-10-30T00:00:00Z"), noteMetadata: { pinned: true, displayTitle: null }, noteMetadataError: "NOTE_METADATA_INVALID" };
    const ordinary = historyItem("ordinary-note", "2026-10-29T00:00:00Z");
    const actions: Array<{ item: HistoryListItem; anchor: HTMLButtonElement; section: string }> = [];
    const props = sidebarProps({
      page: "task", currentTaskId: pinned.taskId, historyItems: [ordinary, pinned, invalid],
      onOpenNoteMenu: (item, anchor, section) => { actions.push({ item, anchor, section }); },
    });
    await renderLocalized(<DesktopSidebar {...props} />);

    const pinnedList = screen.getByRole("list", { name: "Pinned" });
    const notesList = screen.getByRole("list", { name: "Notes" });
    expect(within(pinnedList).getAllByRole("listitem")).toHaveLength(1);
    expect(within(notesList).getAllByRole("listitem")).toHaveLength(3);
    const pinnedOpen = within(pinnedList).getByRole("button", { name: "pinned-note" });
    const notesOpen = within(notesList).getByRole("button", { name: "pinned-note" });
    expect(pinnedOpen.getAttribute("aria-current")).toBe("page");
    expect(notesOpen.getAttribute("aria-current")).toBe("page");
    const pinnedTrigger = within(pinnedList).getByRole("button", { name: "Open note menu: pinned-note" });
    const notesTrigger = within(notesList).getByRole("button", { name: "Open note menu: pinned-note" });
    expect(pinnedTrigger.id).not.toBe(notesTrigger.id);
    expect(pinnedTrigger.parentElement).toBe(pinnedOpen.parentElement);
    expect(pinnedTrigger.closest("button")).toBe(pinnedTrigger);
    fireEvent.click(pinnedTrigger);
    fireEvent.click(notesTrigger);
    expect(actions).toEqual([
      { item: pinned, anchor: pinnedTrigger, section: "pinned" },
      { item: pinned, anchor: notesTrigger, section: "notes" },
    ]);
    expect(notesTrigger.dataset.noteMenuTask).toBe(pinned.taskId);
    expect(notesTrigger.dataset.noteMenuSection).toBe("notes");
    fireEvent.click(screen.getByRole("button", { name: "Collapse Pinned" }));
    expect(screen.queryByRole("list", { name: "Pinned" })).toBeNull();
    expect(screen.getByRole("list", { name: "Notes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand Pinned" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse Notes" }));
    expect(screen.getByRole("list", { name: "Pinned" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Notes" })).toBeNull();
  });

  test("keeps note menus reachable while switching is guarded and marks only the exact open instance", async () => {
    const item = { ...historyItem("busy-note", "2026-10-31T00:00:00Z"), noteMetadata: { pinned: true, displayTitle: null }, noteMetadataError: null };
    const actions: string[] = [];
    await renderLocalized(<DesktopSidebar {...sidebarProps({
      historyItems: [item], navigationDisabled: true,
      activeNoteMenu: { taskId: item.taskId, section: "pinned" },
      onOpenNoteMenu: (_item, _anchor, section) => { actions.push(section); },
    })} />);
    const pinned = within(screen.getByRole("list", { name: "Pinned" }));
    const notes = within(screen.getByRole("list", { name: "Notes" }));
    expect((pinned.getByRole("button", { name: "busy-note" }) as HTMLButtonElement).disabled).toBe(true);
    const pinnedTrigger = pinned.getByRole("button", { name: "Open note menu: busy-note" }) as HTMLButtonElement;
    const notesTrigger = notes.getByRole("button", { name: "Open note menu: busy-note" }) as HTMLButtonElement;
    expect(pinnedTrigger.disabled).toBe(false);
    expect(pinnedTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(pinnedTrigger.getAttribute("aria-controls")).toBe(`${pinnedTrigger.id}-menu`);
    expect(notesTrigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(notesTrigger);
    expect(actions).toEqual(["notes"]);
  });

  test("uses task identity to order equal timestamps and hides the empty pinned group", async () => {
    const entries = [historyItem("b-note", "2026-10-31T00:00:00Z"), historyItem("a-note", "2026-10-31T00:00:00Z")];
    await renderLocalized(<DesktopSidebar {...sidebarProps({ historyItems: entries })} />);
    const notes = screen.getByRole("list", { name: "Notes" });
    expect(within(notes).getAllByRole("listitem").map((row) => within(row).getAllByRole("button")[0].textContent)).toEqual(["a-note", "b-note"]);
    expect(screen.queryByRole("list", { name: "Pinned" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: shellResources["en-US"].sidebar.sortOldest }));
    expect(within(notes).getAllByRole("listitem").map((row) => within(row).getAllByRole("button")[0].textContent)).toEqual(["a-note", "b-note"]);
  });

  test.each<SupportedLocale>(["zh-CN", "zh-TW", "en-US"])("shows a saved title verbatim in %s", async (locale) => {
    const item = historyItem("saved-note", "2026-10-31T00:00:00Z");
    item.noteTitle = { text: "Persisted title", status: "completed", output_language: "en-US", error_code: null };
    await renderLocalized(<DesktopSidebar {...sidebarProps({ historyItems: [item] })} />, locale);
    expect(screen.getByRole("button", { name: "Persisted title" })).toBeTruthy();
    expect(item.textPreview).toBe("saved-note");
  });
  test.each<SupportedLocale>(["zh-CN", "zh-TW", "en-US"])(
    "keeps navigation names and exposes real collection navigation in %s",
    async (locale) => {
      await renderLocalized(<DesktopSidebar {...sidebarProps()} />, locale);

      const navigation = screen.getByRole("navigation");
      expect(within(navigation).getAllByRole("button").map((button) => button.dataset.shellDestination)).toEqual(["home", "notes", "collections", "artifacts"]);
      const labels = {
        "zh-CN": ["主页", "笔记", "合集", "作品"],
        "zh-TW": ["主頁", "筆記", "合集", "作品"],
        "en-US": ["Home", "Notes", "Collection", "Artifacts"],
      };
      for (const name of labels[locale]) {
        expect(within(navigation).getByRole("button", { name })).toBeTruthy();
      }
      const collections = within(navigation).getByRole("button", { name: labels[locale][2] });
      expect((collections as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByText(shellResources[locale].sidebar.emptyCollections)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    },
  );

  test("opens real collections, projects current task counts, sorts by name, and starts creation", async () => {
    const actions: string[] = [];
    await renderLocalized(<DesktopSidebar {...sidebarProps({
      page: "collections",
      selectedCollectionId: "research",
      collections: [
        { id: "research", name: "Research", taskIds: ["task", "unavailable"] },
        { id: "articles", name: "Articles", taskIds: [] },
      ],
      historyItems: [historyItem("task", "2026-10-30T10:00:00Z")],
      onOpenCollection: (id) => { actions.push(id); },
      onCreateCollection: () => { actions.push("create"); },
    })} />);
    const list = screen.getByRole("list", { name: "Collection" });
    expect(within(list).getAllByRole("button").map((button) => button.textContent)).toEqual(["Research1", "Articles0"]);
    expect(within(list).getByRole("button", { name: "Research, 1 note" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: shellResources["en-US"].sidebar.sortCollectionsAscending }));
    expect(within(list).getAllByRole("button").map((button) => button.textContent)).toEqual(["Articles0", "Research1"]);
    fireEvent.click(within(list).getByRole("button", { name: "Articles, 0 notes" }));
    fireEvent.click(screen.getByRole("button", { name: shellResources["en-US"].sidebar.addCollection }));
    expect(actions).toEqual(["articles", "create"]);
  });

  test("guards collection selection and creation while task navigation is disabled", async () => {
    await renderLocalized(<DesktopSidebar {...sidebarProps({
      navigationDisabled: true,
      collections: [{ id: "research", name: "Research", taskIds: [] }],
    })} />);
    expect((within(screen.getByRole("navigation")).getByRole("button", { name: "Collection" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Research, 0 notes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: shellResources["en-US"].sidebar.addCollection }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("opens real history entries, toggles their date order, and indicates the current task", async () => {
    const entries = [historyItem("earlier", "2026-10-28T10:00:00Z"), historyItem("recent", "2026-10-30T10:00:00Z")];
    let openedTask: HistoryListItem | null = null;
    await renderLocalized(
      <DesktopSidebar {...sidebarProps({
        page: "task",
        currentTaskId: "recent",
        historyItems: entries,
        onOpenTask: (item) => { openedTask = item; },
      })} />,
    );

    const notes = screen.getByRole("list", { name: "Notes" });
    expect(within(notes).getAllByRole("listitem").map((row) => within(row).getAllByRole("button")[0].textContent)).toEqual(["recent", "earlier"]);
    expect(within(notes).getByRole("button", { name: "recent" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: shellResources["en-US"].sidebar.sortOldest }));
    expect(within(notes).getAllByRole("listitem").map((row) => within(row).getAllByRole("button")[0].textContent)).toEqual(["earlier", "recent"]);
    fireEvent.click(within(notes).getByRole("button", { name: "earlier" }));
    expect(openedTask).toBe(entries[0]);
  });

  test("keeps task switching and new task controls disabled while busy", async () => {
    await renderLocalized(<DesktopSidebar {...sidebarProps({
      historyItems: [historyItem("task", "2026-10-30T10:00:00Z")],
      navigationDisabled: true,
      newTaskDisabled: true,
    })} />);

    const home = within(screen.getByRole("navigation")).getByRole("button", { name: "Home" });
    expect((home as HTMLButtonElement).disabled).toBe(true);
    expect(home.title).toBe(sidebarProps().disabledReason);
    expect((screen.getByRole("button", { name: "task" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: shellResources["en-US"].sidebar.newTask }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("distinguishes loading, unavailable, and empty history", async () => {
    await renderLocalized(<DesktopSidebar {...sidebarProps({ historyLoading: true })} />);
    expect(screen.getByText(shellResources["en-US"].sidebar.loading)).toBeTruthy();
    expect(screen.queryByText(shellResources["en-US"].sidebar.empty)).toBeNull();

    cleanup();
    await renderLocalized(<DesktopSidebar {...sidebarProps({ historyNotice: "History is unavailable." })} />);
    expect(screen.getByText("History is unavailable.")).toBeTruthy();
    expect(screen.queryByText(shellResources["en-US"].sidebar.empty)).toBeNull();
  });

  test("uses the real account and supports keyboard menu navigation, Escape, and callbacks", async () => {
    let settingsOpened = 0;
    let accountOpened = 0;
    await renderLocalized(<DesktopSidebar {...sidebarProps({
      account: { ...createGuestAccountStatus(), authenticated: true, email: "alex.chen@example.test" },
      onOpenSettings: () => { settingsOpened += 1; },
      onOpenAccount: () => { accountOpened += 1; },
    })} />);

    expect(screen.getByText("alex.chen")).toBeTruthy();
    expect(screen.getByText("alex.chen@example.test")).toBeTruthy();
    const trigger = screen.getByRole("button", { name: shellResources["en-US"].account.menu });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const account = screen.getByRole("menuitem", { name: shellResources["en-US"].account.openAccount });
    expect(document.activeElement).toBe(account);
    fireEvent.keyDown(account, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: shellResources["en-US"].account.openSettings }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: shellResources["en-US"].account.openSettings }));
    expect(settingsOpened).toBe(1);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: shellResources["en-US"].account.openAccount }));
    expect(accountOpened).toBe(1);
  });

  test("routes the existing navigation, refresh, and new task actions through their callbacks", async () => {
    const actions: string[] = [];
    await renderLocalized(<DesktopSidebar {...sidebarProps({
      onNavigate: (page) => { actions.push(page); },
      onRefresh: () => { actions.push("refresh"); },
      onNewTask: () => { actions.push("new-task"); },
    })} />);
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Notes" }));
    fireEvent.click(screen.getByRole("button", { name: shellResources["en-US"].sidebar.refresh }));
    fireEvent.click(screen.getByRole("button", { name: shellResources["en-US"].sidebar.newTask }));
    expect(actions).toEqual(["notes", "refresh", "new-task"]);
  });
});
