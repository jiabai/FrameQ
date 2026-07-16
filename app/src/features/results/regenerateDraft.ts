/**
 * Handles the "regenerate draft" action.
 *
 * When the draft has been user-edited (`draftEdited`), a browser confirm
 * dialog warns that edits will be discarded. On cancel the function is a
 * no-op (no quota consumed, sheets unchanged). On confirm (or when the
 * draft is not dirty), it closes the result sheet, writes the seed insight
 * id into the workflow, and opens the first-generation confirmation sheet
 * so the user can pick a platform and start retry.
 */
export function handleRegenerateDraft(
  draftEdited: boolean,
  seedInsightId: number | null,
  setDraftResultOpen: (open: boolean) => void,
  setDraftConfirmOpen: (open: boolean) => void,
  setDraftSeedInsightId: (id: number | null) => void,
): void {
  if (draftEdited) {
    // Deliberate short-term tradeoff: this is the only native browser dialog in the
    // app. Accepted as-is for now; replace with a shared ConfirmDialog (extracted
    // from HistorySheet AlertDialog) when UX consistency is addressed.
    const ok = window.confirm(
      "重新生成将丢弃当前编辑内容（包括已保存的草稿文件），是否继续？",
    );
    if (!ok) return;
  }

  setDraftResultOpen(false);
  setDraftSeedInsightId(seedInsightId);
  setDraftConfirmOpen(true);
}
