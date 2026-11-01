// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { afterEach, describe, expect, test } from "vitest";

import { frameqI18n, initializeI18n } from "../../i18n/i18n";
import { createInitialWorkflow } from "../../workflowState";
import { ConfirmDialog } from "../modal/ConfirmDialog";
import { DraftConfirmationSheet } from "./DraftConfirmationSheet";
import { DraftResultSheet } from "./DraftResultSheet";
import { useDraftRegeneration } from "./regenerateDraft";

function unexpectedAction(): never {
  throw new Error("Unexpected saving or generation");
}

function DraftSheets({ persistedEdits }: { persistedEdits: boolean }) {
  const { t } = useTranslation("synthesis");
  const [resultOpen, setDraftResultOpen] = useState(true);
  const [confirmOpen, setDraftConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftSeedInsightId, setDraftSeedInsightId] = useState<number | null>(99);
  const workflow = {
    ...createInitialWorkflow(), stage: "completed" as const,
    taskId: "draft-1", taskDir: "D:/FrameQ/outputs/tasks/draft-1",
    draft: "# Original draft", draftEdited: persistedEdits, draftSeedInsightId,
    artifacts: { draft: "ai/draft.md" },
  };
  const regeneration = useDraftRegeneration({
    taskId: workflow.taskId, draftEdited: workflow.draftEdited, resultOpen, saving,
    setDraftResultOpen, setDraftConfirmOpen, setDraftSeedInsightId,
  });
  return <>
    <DraftConfirmationSheet open={confirmOpen} workflow={workflow} busy={false}
      quotaRemaining={10} transcriptPath={null} onConfirm={unexpectedAction}
      onCancel={() => setDraftConfirmOpen(false)} />
    <DraftResultSheet open={resultOpen} workflow={workflow} onSaved={unexpectedAction}
      onBusyChange={setSaving} onRegenerate={regeneration.request}
      onClose={() => setDraftResultOpen(false)} />
    <ConfirmDialog open={regeneration.candidate !== null}
      title={t("draftResult.regenerateTitle")} message={t("draftResult.regenerateConfirm")}
      cancelLabel={t("draftResult.keepDraft")} confirmLabel={t("draftResult.continueRegeneration")}
      onCancel={regeneration.cancel} onConfirm={regeneration.confirm} />
  </>;
}

async function editableSheets(persistedEdits: boolean) {
  await initializeI18n("zh-CN");
  render(<I18nextProvider i18n={frameqI18n}><DraftSheets persistedEdits={persistedEdits} /></I18nextProvider>);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("无法读取草稿"));
  fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unsaved draft" } });
  fireEvent.click(screen.getByRole("button", { name: "全屏" }));
  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
}

afterEach(cleanup);

describe("draft result and regeneration confirmation integration", () => {
  test.each(["button", "Escape", "backdrop"])("cancelling regeneration through %s keeps unsaved edits visible", async (action) => {
    await editableSheets(false);
    const dialog = screen.getByRole("alertdialog", { name: "重新生成草稿" });
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    if (action === "button") fireEvent.click(screen.getByRole("button", { name: "保留当前草稿" }));
    if (action === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
    if (action === "backdrop") fireEvent.click(dialog.parentElement!);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Unsaved draft");
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector(".draft-result-sheet")?.classList.contains("is-expanded")).toBe(true);
    expect(document.querySelector(".preference-flow-sheet")).toBeNull();
    expect(document.querySelector(".draft-result-sheet")?.parentElement?.getAttribute("data-motion-state")).toBe("open");
  });

  test.each([false, true])("local dirty and persisted edits %s use one acceptance before the final generation confirmation", async (persistedEdits) => {
    await editableSheets(persistedEdits);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "继续重新生成" }));
    expect(screen.getByRole("dialog", { name: "确认生成文字稿" })).not.toBeNull();
    expect(document.querySelector(".draft-result-sheet")?.parentElement?.getAttribute("data-motion-state")).toBe("closing");
  });
});
