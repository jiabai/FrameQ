// @vitest-environment jsdom

import { useState, type ComponentProps, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createInstance, type Resource } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, test } from "vitest";

import type { Collection } from "../../collectionsClient";
import type { HistoryListItem } from "../../historyClient";
import type { SupportedLocale } from "../../i18n/locale";
import { shellResources } from "../../i18n/shellResources";
import { CollectionsWorkspace } from "./CollectionsWorkspace";

const tasks: HistoryListItem[] = ["Interview", "Lecture"].map((name) => ({
  taskId: name,
  id: name,
  createdAt: "2026-10-30T10:00:00Z",
  source: { kind: "local_file", displayName: `${name}.mp4`, mediaKind: "video" },
  status: "completed",
  taskDir: `D:/FrameQ/outputs/${name}`,
  outputDir: `D:/FrameQ/outputs/${name}`,
  artifacts: { transcript_txt: "transcript/transcript.txt" },
  error: null,
  textPreview: name,
  insightsCount: 0,
}));

const research: Collection = { id: "research", name: "Research", taskIds: ["Interview", "unavailable"] };

function unexpectedAction(): never { throw new Error("Unexpected user action"); }

function props(overrides: Partial<ComponentProps<typeof CollectionsWorkspace>> = {}): ComponentProps<typeof CollectionsWorkspace> {
  return {
    collections: [research],
    selectedCollectionId: null,
    items: tasks,
    loading: false,
    mutating: false,
    notice: null,
    disabled: false,
    disabledReason: "Save the current task before switching.",
    onSelectCollection: unexpectedAction,
    onCreate: unexpectedAction,
    onRename: unexpectedAction,
    onDelete: unexpectedAction,
    onSetMembership: unexpectedAction,
    onOpenTask: unexpectedAction,
    onNewNote: unexpectedAction,
    onRefresh: unexpectedAction,
    ...overrides,
  };
}

async function renderLocalized(ui: ReactElement, locale: SupportedLocale = "en-US") {
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    fallbackLng: false,
    resources: { [locale]: { shell: shellResources[locale] } } as Resource,
    interpolation: { escapeValue: false },
  });
  const view = render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
  return { ...view, wrap: (element: ReactElement) => <I18nextProvider i18n={i18n}>{element}</I18nextProvider> };
}

afterEach(cleanup);

describe("CollectionsWorkspace", () => {
  test("uses the persisted note title for member and membership-selection actions", async () => {
    const title = "Persisted interview title";
    const item: HistoryListItem = { ...tasks[0], noteTitle: { text: title, status: "completed", output_language: "en-US", error_code: null } };
    await renderLocalized(<CollectionsWorkspace {...props({ selectedCollectionId: research.id, items: [item] })} />);
    expect(screen.getByRole("button", { name: `Open note: ${title}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Remove note from Collection: ${title}` })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add notes to Collection" }));
    expect(screen.getByRole("checkbox", { name: title })).toBeTruthy();
  });
  test.each<SupportedLocale>(["zh-CN", "zh-TW", "en-US"])("supports inline creation and keyboard cancellation in %s", async (locale) => {
    await renderLocalized(<CollectionsWorkspace {...props()} />, locale);
    const copy = shellResources[locale].collections;
    const create = screen.getByRole("button", { name: copy.create });
    fireEvent.click(create);
    const input = screen.getByRole("textbox", { name: copy.name });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: copy.name })).toBeNull();
    expect(document.activeElement).toBe(create);
  });

  test("submits a trimmed name once and waits for the committed result", async () => {
    const submitted: string[] = [];
    let complete!: (success: boolean) => void;
    const result = new Promise<boolean>((resolve) => { complete = resolve; });
    await renderLocalized(<CollectionsWorkspace {...props({ onCreate: async (name) => { submitted.push(name); return result; } })} />);
    fireEvent.click(screen.getByRole("button", { name: "New Collection" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Collection name" }), { target: { value: "  Ideas  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(submitted).toEqual(["Ideas"]);
    expect(screen.getByRole("textbox", { name: "Collection name" })).toBeTruthy();
    complete(true);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Collection name" })).toBeNull());
  });

  test("rejects invalid Unicode length and duplicate names before submitting", async () => {
    await renderLocalized(<CollectionsWorkspace {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "New Collection" }));
    const input = screen.getByRole("textbox", { name: "Collection name" });
    fireEvent.change(input, { target: { value: "🌱".repeat(81) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe(shellResources["en-US"].collections.errors.COLLECTION_NAME_INVALID);
    fireEvent.change(input, { target: { value: "  RESEARCH  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe(shellResources["en-US"].collections.errors.COLLECTION_NAME_EXISTS);
  });

  test("keeps a rejected create form and its parent error visible", async () => {
    await renderLocalized(<CollectionsWorkspace {...props({ notice: "Local collections could not be saved.", onCreate: async () => false })} />);
    fireEvent.click(screen.getByRole("button", { name: "New Collection" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Collection name" }), { target: { value: "Ideas" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole("textbox", { name: "Collection name" }) as HTMLInputElement).value).toBe("Ideas");
    expect(screen.getByText("Local collections could not be saved.")).toBeTruthy();
  });

  test("opens creation from the sidebar request and reports unsaved name edits", async () => {
    const changes: boolean[] = [];
    const options = props({ createRequested: 0, onDirtyChange: (dirty) => { changes.push(dirty); } });
    const view = await renderLocalized(<CollectionsWorkspace {...options} />);
    view.rerender(view.wrap(<CollectionsWorkspace {...options} createRequested={1} />));
    const input = screen.getByRole("textbox", { name: "Collection name" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Ideas" } });
    expect(changes[changes.length - 1]).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(changes[changes.length - 1]).toBe(false);
  });

  test("acknowledges a create request once, retains the form on acknowledgement, and accepts a later request", async () => {
    let acknowledgements = 0;
    const options = props({ onCreateRequestHandled: () => { acknowledgements += 1; } });
    const view = await renderLocalized(<CollectionsWorkspace {...options} createRequested={1} />);
    expect(screen.getByRole("textbox", { name: "Collection name" })).toBeTruthy();
    expect(acknowledgements).toBe(1);
    view.rerender(view.wrap(<CollectionsWorkspace {...options} createRequested={0} />));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Collection name" })).toBeNull();
    view.rerender(view.wrap(<CollectionsWorkspace {...options} createRequested={1} />));
    expect(screen.getByRole("textbox", { name: "Collection name" })).toBeTruthy();
    expect(acknowledgements).toBe(2);
    view.rerender(view.wrap(<CollectionsWorkspace {...options} createRequested={0} />));
    view.rerender(view.wrap(<span />));
    view.rerender(view.wrap(<CollectionsWorkspace {...options} createRequested={0} />));
    expect(screen.queryByRole("textbox", { name: "Collection name" })).toBeNull();
    expect(acknowledgements).toBe(2);
  });

  test("renames a manager row using its identity and returns focus to that row", async () => {
    const renamed: Array<[string, string]> = [];
    await renderLocalized(<CollectionsWorkspace {...props({ onRename: async (id, name) => { renamed.push([id, name]); return true; } })} />);
    const rename = screen.getByRole("button", { name: "Rename Collection: Research" });
    const open = screen.getByRole("button", { name: "Open Collection: Research" });
    expect(rename.parentElement).toBe(open.parentElement);
    fireEvent.click(rename);
    const input = screen.getByRole("textbox", { name: "Collection name" });
    expect((input as HTMLInputElement).value).toBe("Research");
    fireEvent.change(input, { target: { value: "  Writing  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(renamed).toEqual([["research", "Writing"]]));
    await waitFor(() => expect(document.activeElement).toBe(rename));
  });

  test("opens a new note from collection detail and keeps management actions on the outer manager", async () => {
    let newNotes = 0;
    await renderLocalized(<CollectionsWorkspace {...props({ selectedCollectionId: "research", onNewNote: () => { newNotes += 1; } })} />);
    expect(screen.queryByRole("button", { name: /Rename|Delete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "New Collection" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(newNotes).toBe(1);
  });

  test("cancels a manager row rename and restores the exact collection action", async () => {
    await renderLocalized(<CollectionsWorkspace {...props({ collections: [research, { id: "writing", name: "Writing", taskIds: [] }] })} />);
    const rename = screen.getByRole("button", { name: "Rename Collection: Writing" });
    fireEvent.click(rename);
    const input = screen.getByRole("textbox", { name: "Collection name" });
    expect((input as HTMLInputElement).value).toBe("Writing");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).toBe(rename);
  });

  test("shows only real member tasks and opens the original history item", async () => {
    let selected: HistoryListItem | null = null;
    await renderLocalized(<CollectionsWorkspace {...props({ selectedCollectionId: "research", onOpenTask: (item) => { selected = item; } })} />);
    const list = screen.getByRole("list", { name: "Notes in Collection" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(within(list).getByRole("button", { name: "Open note: Interview" }));
    expect(selected).toBe(tasks[0]);
    expect(screen.queryByText("unavailable")).toBeNull();
  });

  test("places one add-notes action below the note list and below the membership editor", async () => {
    await renderLocalized(<CollectionsWorkspace {...props({ selectedCollectionId: "research" })} />);
    const list = screen.getByRole("list", { name: "Notes in Collection" });
    const action = screen.getByRole("button", { name: "Add notes to Collection" });
    expect(list.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(action);
    const editor = screen.getByRole("region", { name: "Add notes to Collection" });
    const done = screen.getByRole("button", { name: "Finish selecting notes" });
    expect(editor.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(done).toBe(action);
  });

  test("updates membership through committed parent state and filters real task titles", async () => {
    const membership: Array<[string, string, boolean]> = [];
    function CollectionState() {
      const [collection, setCollection] = useState<Collection>(research);
      return <CollectionsWorkspace {...props({
        collections: [collection],
        selectedCollectionId: collection.id,
        onSetMembership: async (collectionId, taskId, included) => {
          membership.push([collectionId, taskId, included]);
          setCollection((current) => ({ ...current, taskIds: included ? [...current.taskIds, taskId] : current.taskIds.filter((id) => id !== taskId) }));
          return true;
        },
      })} />;
    }
    await renderLocalized(<CollectionState />);
    fireEvent.click(screen.getByRole("button", { name: "Add notes to Collection" }));
    expect((screen.getByRole("checkbox", { name: "Interview" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Lecture" }));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "Lecture" }) as HTMLInputElement).checked).toBe(true));
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter existing notes" }), { target: { value: "Lecture" } });
    expect(screen.queryByRole("checkbox", { name: "Interview" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Lecture" })).toBeTruthy();
    expect(membership).toEqual([["research", "Lecture", true]]);
  });

  test("focuses the task chooser from an empty collection and restores its action with Escape", async () => {
    await renderLocalized(<CollectionsWorkspace {...props({ collections: [{ ...research, taskIds: [] }], selectedCollectionId: "research" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add notes to Collection" }));
    const filter = screen.getByRole("searchbox", { name: "Filter existing notes" });
    expect(document.activeElement).toBe(filter);
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add notes to Collection" }));
  });

  test.each([true, false])("restores the membership checkbox after an asynchronous commit returns %s", async (success) => {
    let complete!: (value: boolean) => void;
    const commit = new Promise<boolean>((resolve) => { complete = resolve; });
    await renderLocalized(<CollectionsWorkspace {...props({ selectedCollectionId: "research", onSetMembership: () => commit })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add notes to Collection" }));
    const checkbox = screen.getByRole("checkbox", { name: "Lecture" }) as HTMLInputElement;
    checkbox.focus();
    fireEvent.click(checkbox);
    expect(checkbox.disabled).toBe(true);
    const filter = screen.getByRole("searchbox", { name: "Filter existing notes" });
    filter.focus();
    expect(document.activeElement).toBe(filter);
    complete(success);
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    expect(document.activeElement).toBe(checkbox);
  });

  test("does not restore a previous collection's checkbox after the selected collection changes", async () => {
    let complete!: (value: boolean) => void;
    const commit = new Promise<boolean>((resolve) => { complete = resolve; });
    const options = props({ selectedCollectionId: "research", onSetMembership: () => commit });
    const view = await renderLocalized(<CollectionsWorkspace {...options} />);
    fireEvent.click(screen.getByRole("button", { name: "Add notes to Collection" }));
    const checkbox = screen.getByRole("checkbox", { name: "Lecture" }) as HTMLInputElement;
    checkbox.focus();
    fireEvent.click(checkbox);
    view.rerender(view.wrap(<CollectionsWorkspace {...options} selectedCollectionId={null} />));
    complete(true);
    await waitFor(() => expect((screen.getByRole("button", { name: "New Collection" }) as HTMLButtonElement).disabled).toBe(false));
    expect(checkbox.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(checkbox);
  });

  test("keeps focus in the filter when the originating membership checkbox is no longer displayed", async () => {
    let complete!: (value: boolean) => void;
    const commit = new Promise<boolean>((resolve) => { complete = resolve; });
    await renderLocalized(<CollectionsWorkspace {...props({ selectedCollectionId: "research", onSetMembership: () => commit })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add notes to Collection" }));
    const checkbox = screen.getByRole("checkbox", { name: "Lecture" }) as HTMLInputElement;
    checkbox.focus();
    fireEvent.click(checkbox);
    const filter = screen.getByRole("searchbox", { name: "Filter existing notes" });
    filter.focus();
    fireEvent.change(filter, { target: { value: "Interview" } });
    complete(true);
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "Interview" }) as HTMLInputElement).disabled).toBe(false));
    expect(checkbox.isConnected).toBe(false);
    expect(document.activeElement).toBe(filter);
  });

  test("requires explicit deletion from a manager row and restores that row on cancellation", async () => {
    const deleted: string[] = [];
    await renderLocalized(<CollectionsWorkspace {...props({ collections: [research, { id: "writing", name: "Writing", taskIds: [] }], onDelete: async (id) => { deleted.push(id); return true; } })} />);
    const trigger = screen.getByRole("button", { name: "Delete Collection: Writing" });
    expect(trigger.parentElement).toBe(screen.getByRole("button", { name: "Open Collection: Writing" }).parentElement);
    fireEvent.click(trigger);
    let confirmation = screen.getByRole("alertdialog");
    expect(within(confirmation).getByText(shellResources["en-US"].collections.deleteBody)).toBeTruthy();
    expect(document.activeElement).toBe(within(confirmation).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    confirmation = screen.getByRole("alertdialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Confirm Collection deletion" }));
    await waitFor(() => expect(deleted).toEqual(["writing"]));
  });

  test("restores Cancel focus after a collection deletion fails", async () => {
    let complete!: (success: boolean) => void;
    const result = new Promise<boolean>((resolve) => { complete = resolve; });
    await renderLocalized(<CollectionsWorkspace {...props({ onDelete: () => result })} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Collection: Research" }));
    const confirmation = screen.getByRole("alertdialog");
    const cancel = within(confirmation).getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    fireEvent.click(within(confirmation).getByRole("button", { name: "Confirm Collection deletion" }));
    expect(cancel.disabled).toBe(true);
    const heading = screen.getByRole("heading", { name: "Collection" });
    heading.focus();
    complete(false);
    await waitFor(() => expect(cancel.disabled).toBe(false));
    expect(screen.getByRole("alertdialog")).toBe(confirmation);
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });

  test("disables navigation and mutations for the actual task guard", async () => {
    await renderLocalized(<CollectionsWorkspace {...props({ selectedCollectionId: "research", disabled: true })} />);
    for (const name of ["New note", "Add notes to Collection", "Open note: Interview", "Remove note from Collection: Interview"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText(props().disabledReason)).toBeTruthy();
  });

  test("guards manager row actions while an external task operation is active", async () => {
    await renderLocalized(<CollectionsWorkspace {...props({ disabled: true })} />);
    for (const name of ["New Collection", "Rename Collection: Research", "Delete Collection: Research"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  test("keeps the new note action unavailable during an active collection mutation", async () => {
    await renderLocalized(<CollectionsWorkspace {...props({ selectedCollectionId: "research", mutating: true })} />);
    const action = screen.getByRole("button", { name: "New note" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
  });
});
