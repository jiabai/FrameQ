// @vitest-environment jsdom

import type { ComponentProps, ReactElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createInstance, type Resource } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, test } from "vitest";

import type { HistoryListItem } from "../../historyClient";
import { historyResources } from "../../i18n/historyResources";
import { shellResources } from "../../i18n/shellResources";
import { ShellLibrary } from "./ShellLibrary";

function unexpectedAction(): never {
  throw new Error("Unexpected user action");
}

const task: HistoryListItem = {
  taskId: "local-task",
  id: "history-local-task",
  createdAt: "2026-10-30T10:00:00Z",
  source: { kind: "local_file", displayName: "interview.mp4", mediaKind: "video" },
  status: "completed",
  taskDir: "D:/FrameQ/private/local-task",
  outputDir: "D:/FrameQ/private/local-task",
  artifacts: {
    transcript_txt: "transcript/transcript.txt",
    summary: "ai/summary.md",
    mindmap: "ai/mindmap.md",
    preference_snapshot: "internal/preferences.json",
    segments: "internal/segments.json",
  },
  error: null,
  textPreview: "Interview about local processing",
  insightsCount: 0,
};

function libraryProps(overrides: Partial<ComponentProps<typeof ShellLibrary>> = {}): ComponentProps<typeof ShellLibrary> {
  return {
    view: "notes",
    items: [task],
    loading: false,
    notice: null,
    selectionDisabled: false,
    disabledReason: "Finish the current task before opening another task.",
    onOpenTask: unexpectedAction,
    onRefresh: unexpectedAction,
    onManageHistory: unexpectedAction,
    ...overrides,
  };
}

async function renderLocalized(ui: ReactElement) {
  const i18n = createInstance();
  await i18n.init({
    lng: "en-US",
    fallbackLng: false,
    resources: { "en-US": { shell: shellResources["en-US"], history: historyResources["en-US"] } } as Resource,
    interpolation: { escapeValue: false },
  });
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

afterEach(cleanup);

describe("ShellLibrary", () => {
  test.each(["notes", "artifacts"] as const)("prefers persisted titles in %s while retaining transcript preview metadata", async (view) => {
    const item: HistoryListItem = { ...task, noteTitle: {
      text: "Saved interview title", status: "completed", output_language: "en-US", error_code: null,
    } };
    await renderLocalized(<ShellLibrary {...libraryProps({ view, items: [item] })} />);
    expect(screen.getByText("Saved interview title")).toBeTruthy();
    expect(item.textPreview).toBe(task.textPreview);
    expect(screen.queryByText(task.textPreview)).toBeNull();
  });
  test("opens actual Notes history and keeps private paths out of the library", async () => {
    let selected: HistoryListItem | null = null;
    const view = await renderLocalized(<ShellLibrary {...libraryProps({ onOpenTask: (item) => { selected = item; } })} />);

    expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();
    const list = screen.getByRole("list", { name: "Notes" });
    fireEvent.click(within(list).getByRole("button"));
    expect(selected).toBe(task);
    expect(view.container.textContent).not.toContain(task.taskDir);
  });

  test.each(["notes", "artifacts"] as const)("keeps %s available for older history with an invalid timestamp", async (view) => {
    await renderLocalized(<ShellLibrary {...libraryProps({ view, items: [{ ...task, createdAt: "legacy-date" }] })} />);
    expect(screen.getByText("legacy-date")).toBeTruthy();
  });

  test("groups only genuine user artifacts and restores their parent task", async () => {
    let selected: HistoryListItem | null = null;
    const view = await renderLocalized(<ShellLibrary {...libraryProps({ view: "artifacts", onOpenTask: (item) => { selected = item; } })} />);

    expect(screen.getByRole("heading", { name: task.textPreview })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Open note for/ })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: /Open note for/ })[0]);
    expect(selected).toBe(task);
    for (const path of Object.values(task.artifacts)) {
      expect(view.container.textContent).not.toContain(path);
    }
    expect(view.container.textContent).not.toContain(task.taskDir);
    expect(view.container.textContent).not.toContain("preferences");
    expect(view.container.textContent).not.toContain("segments");
  });

  test("omits tasks whose artifacts contain only internal data", async () => {
    await renderLocalized(<ShellLibrary {...libraryProps({ view: "artifacts", items: [{ ...task, artifacts: { segments: "segments.json" } }] })} />);
    expect(screen.getByText(shellResources["en-US"].library.emptyArtifacts)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: task.textPreview })).toBeNull();
  });

  test("shows unavailable history without reporting it as empty", async () => {
    await renderLocalized(<ShellLibrary {...libraryProps({ items: [], notice: "Local history cannot be read." })} />);
    expect(screen.getByRole("status").textContent).toBe("Local history cannot be read.");
    expect(screen.queryByText(shellResources["en-US"].library.emptyNotes)).toBeNull();
  });

  test("announces one loading status when the controller supplies progress copy", async () => {
    await renderLocalized(<ShellLibrary {...libraryProps({ items: [], loading: true, notice: "Reading saved tasks…" })} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("Reading saved tasks…");
  });

  test("disables artifact task switching with the real guard reason", async () => {
    await renderLocalized(<ShellLibrary {...libraryProps({ view: "artifacts", selectionDisabled: true })} />);
    for (const button of screen.getAllByRole("button", { name: /Open note for/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.title).toBe(libraryProps().disabledReason);
    }
    expect(screen.getByText(libraryProps().disabledReason)).toBeTruthy();
  });

  test("passes refresh and history management to their existing controllers", async () => {
    const actions: string[] = [];
    await renderLocalized(<ShellLibrary {...libraryProps({
      onRefresh: () => { actions.push("refresh"); },
      onManageHistory: () => { actions.push("manage"); },
    })} />);
    fireEvent.click(screen.getByRole("button", { name: shellResources["en-US"].library.refresh }));
    fireEvent.click(screen.getByRole("button", { name: shellResources["en-US"].library.manageHistory }));
    expect(actions).toEqual(["refresh", "manage"]);
  });
});
