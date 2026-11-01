// @vitest-environment jsdom

import { useState, type ComponentProps, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createInstance, type Resource } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, test } from "vitest";

import type { Collection } from "../../collectionsClient";
import type { HistoryListItem } from "../../historyClient";
import type { NoteInfo } from "../../noteActionsClient";
import type { SupportedLocale } from "../../i18n/locale";
import { noteActionsResources } from "../../i18n/noteActionsResources";
import { shellResources } from "../../i18n/shellResources";
import { NoteRenameSheet } from "./NoteRenameSheet";
import { NoteCollectionsSheet } from "./NoteCollectionsSheet";
import { NoteInfoSheet } from "./NoteInfoSheet";

const item: HistoryListItem = {
  taskId: "saved-note", id: "saved-note", createdAt: "2026-10-31T00:00:00Z",
  source: { kind: "local_file", displayName: "Interview.mp3", mediaKind: "audio" },
  status: "completed", taskDir: "D:/private/outputs/saved-note", outputDir: "D:/private/outputs/saved-note",
  artifacts: { transcript_txt: "transcript/transcript.txt" }, error: null, textPreview: "Original title", insightsCount: 0,
  noteMetadata: { pinned: false, displayTitle: "Saved name" }, noteMetadataError: null,
};
const collections: Collection[] = [
  { id: "research", name: "Research", taskIds: [item.taskId] },
  { id: "interviews", name: "Interviews", taskIds: [] },
];

function unexpectedAction(): never { throw new Error("Unexpected user action"); }
function renameProps(overrides: Partial<ComponentProps<typeof NoteRenameSheet>> = {}): ComponentProps<typeof NoteRenameSheet> {
  return { item, busy: false, notice: null, disabled: false, disabledReason: "Wait for the current operation.", onSave: unexpectedAction, onClose: unexpectedAction, ...overrides };
}
function membershipProps(overrides: Partial<ComponentProps<typeof NoteCollectionsSheet>> = {}): ComponentProps<typeof NoteCollectionsSheet> {
  return { item, collections, loading: false, mutating: false, notice: null, disabled: false, disabledReason: "Save your edits first.", onSetMembership: unexpectedAction, onRefresh: unexpectedAction, onClose: unexpectedAction, ...overrides };
}
function info(overrides: Partial<NoteInfo> = {}): NoteInfo {
  return {
    taskId: item.taskId, source: item.source, createdAt: item.createdAt, status: item.status,
    noteTitle: { text: "Generated name", status: "completed", output_language: "en-US", error_code: null },
    noteMetadata: item.noteMetadata!, noteMetadataError: null, transcript: { source: "asr", language: "en", engine: "SenseVoice" },
    artifactTypes: ["audio", "transcript_txt"], textPreview: item.textPreview, ...overrides,
  };
}
async function localized(ui: ReactElement, locale: SupportedLocale = "en-US") {
  const i18n = createInstance();
  await i18n.init({ lng: locale, fallbackLng: false, resources: { [locale]: { noteActions: noteActionsResources[locale], shell: shellResources[locale] } } as Resource, interpolation: { escapeValue: false } });
  const wrap = (element: ReactElement) => <I18nextProvider i18n={i18n}>{element}</I18nextProvider>;
  return { ...render(wrap(ui)), wrap };
}
afterEach(cleanup);

describe("NoteRenameSheet", () => {
  test.each<SupportedLocale>(["zh-CN", "zh-TW", "en-US"])("focuses the current name and cancels without saving in %s", async (locale) => {
    let closed = 0;
    const dirty: boolean[] = [];
    await localized(<NoteRenameSheet {...renameProps({ onClose: () => { closed += 1; }, onDirtyChange: (value) => dirty.push(value) })} />, locale);
    const copy = noteActionsResources[locale];
    const input = screen.getByRole("textbox", { name: copy.rename.name }) as HTMLInputElement;
    expect(input.value).toBe("Saved name");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "A different name" } });
    expect(dirty[dirty.length - 1]).toBe(true);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(closed).toBe(1);
  });

  test("validates Unicode length and controls before submitting a trimmed name", async () => {
    const saved: Array<[string, string]> = [];
    await localized(<NoteRenameSheet {...renameProps({ onSave: async (id, title) => { saved.push([id, title]); return false; } })} />);
    const input = screen.getByRole("textbox", { name: "Note name" });
    for (const title of [" ", "🌱".repeat(61), "Bad\u200btitle", "\tTrimmed control\t", "\uFEFFTrimmed format\uFEFF", "\u2028Trimmed separator\u2029"]) {
      fireEvent.change(input, { target: { value: title } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByRole("alert").textContent).toBe(noteActionsResources["en-US"].rename.invalid);
    }
    expect(saved).toEqual([]);
    fireEvent.change(input, { target: { value: `  ${"🌱".repeat(60)}  ` } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toEqual([[item.taskId, "🌱".repeat(60)]]));
  });

  test("serializes saves, protects pending input, and retains the draft and focus after failure", async () => {
    const saved: string[] = [];
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { finish = resolve; });
    await localized(<NoteRenameSheet {...renameProps({ notice: "Could not save the name.", onSave: async (_id, title) => { saved.push(title); return pending; } })} />);
    const input = screen.getByRole("textbox", { name: "Note name" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Retained draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(saved).toEqual(["Retained draft"]);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    finish(false);
    await waitFor(() => expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
    expect(input.value).toBe("Retained draft");
    expect(document.activeElement).toBe(input);
    expect(screen.getByText("Could not save the name.")).toBeTruthy();
  });

  test("blocks external mutations while allowing cancellation and releases dirty state on unmount", async () => {
    let closed = 0;
    const dirty: boolean[] = [];
    const view = await localized(<NoteRenameSheet {...renameProps({ disabled: true, onClose: () => { closed += 1; }, onDirtyChange: (value) => dirty.push(value) })} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Note name" }), { target: { value: "Unsaved name" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(closed).toBe(1);
    view.unmount();
    expect(dirty[dirty.length - 1]).toBe(false);
  });

  test("ignores the completed save of an unmounted task when another note opens", async () => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { finish = resolve; });
    let closed = 0;
    const props = renameProps({ onSave: async () => pending, onClose: () => { closed += 1; } });
    const view = await localized(<NoteRenameSheet {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Note name" }), { target: { value: "First note draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const another = { ...item, taskId: "another-note", id: "another-note", noteMetadata: { pinned: false, displayTitle: "Another name" } };
    view.rerender(view.wrap(<NoteRenameSheet {...props} item={another} />));
    finish(true);
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Note name" }) as HTMLInputElement).value).toBe("Another name"));
    expect(closed).toBe(0);
  });
});

describe("NoteCollectionsSheet", () => {
  test.each<SupportedLocale>(["zh-CN", "zh-TW", "en-US"])("shows committed memberships and preserves names in %s", async (locale) => {
    await localized(<NoteCollectionsSheet {...membershipProps()} />, locale);
    expect((screen.getByRole("checkbox", { name: "Research" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Interviews" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("dialog", { name: noteActionsResources[locale].collections.title })).toBeTruthy();
  });

  test("applies only a committed membership and restores the originating checkbox focus", async () => {
    const changes: Array<[string, string, boolean]> = [];
    function Membership() {
      const [current, setCurrent] = useState(collections);
      return <NoteCollectionsSheet {...membershipProps({ collections: current, onSetMembership: async (id, taskId, included) => {
        changes.push([id, taskId, included]);
        setCurrent((previous) => previous.map((collection) => collection.id === id ? { ...collection, taskIds: included ? [...collection.taskIds, taskId] : collection.taskIds.filter((member) => member !== taskId) } : collection));
        return true;
      } })} />;
    }
    await localized(<Membership />);
    const checkbox = screen.getByRole("checkbox", { name: "Interviews" }) as HTMLInputElement;
    checkbox.focus();
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    expect(changes).toEqual([["interviews", item.taskId, true]]);
    expect(checkbox.checked).toBe(true);
    expect(document.activeElement).toBe(checkbox);
  });

  test("retains failed memberships, prevents parallel writes, and restores focus", async () => {
    const changes: string[] = [];
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { finish = resolve; });
    await localized(<NoteCollectionsSheet {...membershipProps({ notice: "Could not save membership.", onSetMembership: async (id) => { changes.push(id); return pending; } })} />);
    const origin = screen.getByRole("checkbox", { name: "Research" }) as HTMLInputElement;
    origin.focus();
    fireEvent.click(origin);
    fireEvent.click(screen.getByRole("checkbox", { name: "Interviews" }));
    fireEvent.keyDown(origin, { key: "Escape" });
    expect(changes).toEqual(["research"]);
    expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true);
    finish(false);
    await waitFor(() => expect(origin.disabled).toBe(false));
    expect(origin.checked).toBe(true);
    expect(document.activeElement).toBe(origin);
    expect(screen.getByText("Could not save membership.")).toBeTruthy();
  });

  test("distinguishes loading, failed reads, and a verified empty collection list", async () => {
    const props = membershipProps({ collections: [], loading: true });
    const view = await localized(<NoteCollectionsSheet {...props} />);
    expect(screen.getByRole("status").textContent).toBe(noteActionsResources["en-US"].collections.loading);
    expect(screen.queryByText(noteActionsResources["en-US"].collections.empty)).toBeNull();
    view.rerender(view.wrap(<NoteCollectionsSheet {...props} loading={false} notice="Collection could not be read." />));
    expect(screen.getByText("Collection could not be read.")).toBeTruthy();
    expect(screen.queryByText(noteActionsResources["en-US"].collections.empty)).toBeNull();
    view.rerender(view.wrap(<NoteCollectionsSheet {...props} loading={false} />));
    expect(screen.getByText(noteActionsResources["en-US"].collections.empty)).toBeTruthy();
  });

  test("focuses Refresh after a failed write leaves membership editing unavailable", async () => {
    function Failure() {
      const [failed, setFailed] = useState(false);
      return <NoteCollectionsSheet {...membershipProps({ disabled: failed, notice: failed ? "Refresh Collection before trying again." : null, onSetMembership: async () => { setFailed(true); return false; } })} />;
    }
    await localized(<Failure />);
    const checkbox = screen.getByRole("checkbox", { name: "Research" }) as HTMLInputElement;
    checkbox.focus();
    fireEvent.click(checkbox);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Refresh" })));
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.checked).toBe(true);
  });
});

describe("NoteInfoSheet", () => {
  test.each<SupportedLocale>(["zh-CN", "zh-TW", "en-US"])("shows actual information and omits private storage paths in %s", async (locale) => {
    const { container } = await localized(<NoteInfoSheet item={item} info={info()} collections={collections} loading={false} notice={null} onRefresh={unexpectedAction} onClose={unexpectedAction} />, locale);
    const copy = noteActionsResources[locale].info;
    const dialog = screen.getByRole("dialog", { name: copy.title });
    expect(within(dialog).getByText("Saved name")).toBeTruthy();
    expect(within(dialog).getByText(copy.origins.manual)).toBeTruthy();
    expect(within(dialog).getByText("Interview.mp3")).toBeTruthy();
    expect(within(dialog).getByText("SenseVoice")).toBeTruthy();
    expect(within(dialog).getByText("Research")).toBeTruthy();
    expect(within(dialog).queryByText("Interviews")).toBeNull();
    expect(within(dialog).getByText(shellResources[locale].artifacts.transcript_txt)).toBeTruthy();
    expect(container.textContent).not.toContain(item.taskDir);
    expect(container.textContent).not.toContain("transcript/transcript.txt");
    expect(container.textContent).not.toMatch(/Duration|File size|Modified/);
  });

  test("preserves canonical identity parameters and does not turn sources into arbitrary links", async () => {
    const url = "https://www.youtube.com/watch?v=abcDEF_123-";
    await localized(<NoteInfoSheet item={item} info={info({ source: { kind: "url", url } })} collections={[]} loading={false} notice={null} onRefresh={unexpectedAction} onClose={unexpectedAction} />);
    expect(screen.getByText(url)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("omits unknown fields and unsafe URLs without manufacturing values", async () => {
    await localized(<NoteInfoSheet item={item} info={info({ createdAt: "invalid-date", transcript: null, noteTitle: null, noteMetadata: { pinned: false, displayTitle: null }, source: { kind: "url", url: "https://user:secret@example.com/video" }, artifactTypes: [] })} collections={[]} loading={false} notice={null} onRefresh={unexpectedAction} onClose={unexpectedAction} />);
    for (const label of ["Created", "Recognition engine", "Transcript language", "Title status", "Available artifacts", "Source"]) {
      expect(screen.queryByText(label, { selector: "dt" })).toBeNull();
    }
    expect(screen.queryByText("invalid-date")).toBeNull();
    expect(screen.queryByText(/user:secret/)).toBeNull();
  });

  test("keeps stale information out of a different note's panel and permits refresh", async () => {
    let refreshed = 0;
    await localized(<NoteInfoSheet item={item} info={info({ taskId: "another-note", textPreview: "Do not display" })} collections={[]} loading={false} notice={null} onRefresh={() => { refreshed += 1; }} onClose={unexpectedAction} />);
    expect(screen.getByText(noteActionsResources["en-US"].info.unavailable)).toBeTruthy();
    expect(screen.queryByText("Do not display")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refreshed).toBe(1);
  });
});
