// @vitest-environment jsdom

import { useState, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { afterEach, describe, expect, test } from "vitest";

import type { HistoryListItem } from "../../historyClient";
import { noteActionsResources } from "../../i18n/noteActionsResources";
import { shellResources } from "../../i18n/shellResources";
import { renderUiMessage } from "../../i18n/uiMessage";
import { appI18n, initializeI18n } from "../../i18n/i18n";
import { useCollectionsController } from "../collections/useCollectionsController";
import type { NoteAction } from "../shell/SidebarNoteMenu";
import { NoteCollectionsSheet } from "./NoteCollectionsSheet";
import { NoteRenameSheet } from "./NoteRenameSheet";
import { useNoteActionsController } from "./useNoteActionsController";

const item: HistoryListItem = {
  taskId: "saved-note", id: "saved-note", createdAt: "2026-10-31T00:00:00Z",
  source: { kind: "local_file", displayName: "Interview.mp3", mediaKind: "audio" },
  status: "completed", taskDir: "D:/Locus/outputs/saved-note", outputDir: "D:/Locus/outputs/saved-note",
  artifacts: { transcript_txt: "transcript/transcript.txt" }, error: null, textPreview: "Original title", insightsCount: 0,
  noteMetadata: { pinned: false, displayTitle: "Saved name" }, noteMetadataError: null,
};

function unexpectedAction(): never { throw new Error("Unexpected committed or destructive action"); }

function ControllerSheets({ allowed = true, items = [item] }: { allowed?: boolean; items?: readonly HistoryListItem[] }) {
  const { t } = useTranslation("shell");
  const collections = useCollectionsController();
  const [reads, setReads] = useState(0);
  const actions = useNoteActionsController({
    items,
    canMutate: () => allowed && !collections.mutating,
    onCommitted: unexpectedAction,
    onDelete: unexpectedAction,
    loadCollections: async () => { setReads((previous) => previous + 1); return collections.load(); },
  });
  const collectionNotice = collections.errorCode ? t(`collections.errors.${collections.errorCode}`) : renderUiMessage("en-US", actions.notice);
  return <>
    <div>
      {(["pin", "rename", "collection", "delete"] as NoteAction[]).map((action) => <button key={action} type="button" onClick={() => { void actions.perform(item, action); }}>{action}</button>)}
      <button type="button" disabled={!allowed || Boolean(actions.sheet) || actions.dirty || actions.busy}>Open another note</button>
      <output aria-label="Dirty name">{String(actions.dirty)}</output>
      <output aria-label="Collection read attempts">{reads}</output>
    </div>
    {!actions.sheet && actions.notice ? <p role="status" aria-label="Action notice">{actions.notice.messageCode}</p> : null}
    <NoteRenameSheet item={actions.sheet?.kind === "rename" ? actions.sheet.item : null} busy={actions.busy} notice={renderUiMessage("en-US", actions.notice)} disabled={!allowed || collections.mutating} disabledReason="Wait for the current operation." onSave={actions.saveName} onClose={actions.close} onDirtyChange={actions.setDirty} />
    <NoteCollectionsSheet item={actions.sheet?.kind === "collection" ? actions.sheet.item : null} collections={collections.collections} loading={actions.loading || collections.loading} mutating={collections.mutating} notice={collectionNotice} disabled={!allowed || actions.busy || Boolean(collections.errorCode) || Boolean(actions.notice)} disabledReason="Wait for the current operation." onSetMembership={collections.setMembership} onRefresh={() => { void actions.refreshCollections(); }} onClose={actions.close} />
  </>;
}

async function localized(ui: ReactElement) {
  await initializeI18n("en-US");
  const wrap = (element: ReactElement) => <I18nextProvider i18n={appI18n}>{element}</I18nextProvider>;
  return { ...render(wrap(ui)), wrap };
}

afterEach(cleanup);

describe("Note action controller with actual sheets", () => {
  test.each(["pin", "rename", "collection", "delete"])("rejects guarded %s before a native or destructive action", async (action) => {
    await localized(<ControllerSheets allowed={false} />);
    fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Action notice" }).textContent).toBe("noteActions.notice.blocked"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Collection read attempts").textContent).toBe("0");
  });

  test("keeps a dirty rename's own Save and Cancel usable while guarding unrelated navigation", async () => {
    const view = await localized(<ControllerSheets />);
    const origin = screen.getByRole("button", { name: "rename" });
    origin.focus();
    fireEvent.click(origin);
    const input = screen.getByRole("textbox", { name: "Note name" });
    fireEvent.change(input, { target: { value: "Unsaved title" } });
    expect(screen.getByLabelText("Dirty name").textContent).toBe("true");
    expect((screen.getByRole("button", { name: "Open another note" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    view.rerender(view.wrap(<ControllerSheets allowed={false} />));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Dirty name").textContent).toBe("false");
    expect(document.activeElement).toBe(origin);
  });

  test("retains the rename draft after the actual unavailable native command fails", async () => {
    expect("__TAURI_INTERNALS__" in window).toBe(false);
    await localized(<ControllerSheets />);
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    const input = screen.getByRole("textbox", { name: "Note name" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Retained name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(noteActionsResources["en-US"].notice.operationFailed));
    expect(input.value).toBe("Retained name");
    expect(screen.getByLabelText("Dirty name").textContent).toBe("true");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("keeps actual Collection load failures unavailable, retries the real read, and permits closing", async () => {
    expect("__TAURI_INTERNALS__" in window).toBe(false);
    await localized(<ControllerSheets />);
    fireEvent.click(screen.getByRole("button", { name: "collection" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(shellResources["en-US"].collections.errors.COLLECTIONS_OPERATION_FAILED));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(noteActionsResources["en-US"].collections.empty)).toBeNull();
    expect(screen.getByLabelText("Collection read attempts").textContent).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByLabelText("Collection read attempts").textContent).toBe("2"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("closes a dirty form when its task disappears and rejects its stale action identity", async () => {
    const view = await localized(<ControllerSheets />);
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note name" }), { target: { value: "Unsaved title" } });
    view.rerender(view.wrap(<ControllerSheets items={[]} />));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByLabelText("Dirty name").textContent).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Action notice" }).textContent).toBe("noteActions.notice.unavailable"));
  });
});
