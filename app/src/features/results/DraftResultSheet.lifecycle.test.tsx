// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, test } from "vitest";

import { appI18n, initializeI18n } from "../../i18n/i18n";
import { studioResources } from "../../i18n/studioResources";
import { createInitialWorkflow } from "../../workflowState";
import { canCloseDraftResult, DraftResultSheet } from "./DraftResultSheet";

function unexpectedAction(): never {
  throw new Error("Unexpected user action");
}

function workflow(taskId = "task-draft-1") {
  return {
    ...createInitialWorkflow(),
    stage: "completed" as const,
    taskId,
    taskDir: `D:/Locus/outputs/tasks/${taskId}`,
    draft: "# Original draft",
    artifacts: { draft: "ai/draft.md" },
  };
}

async function localization() {
  await initializeI18n("zh-CN");
  return appI18n;
}

afterEach(cleanup);

describe("DraftResultSheet native boundary lifecycle", () => {
  test.each(["button", "Escape", "backdrop"])("cancelling dirty close through %s preserves the editor and full-screen state", async (action) => {
    let closeCount = 0;
    const i18n = await localization();
    render(
      <I18nextProvider i18n={i18n}>
        <DraftResultSheet open workflow={workflow()} onSaved={unexpectedAction}
          onRegenerate={unexpectedAction} onClose={() => { closeCount += 1; }} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("无法读取草稿"));
    fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unsaved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭文字稿详情" }));
    const dialog = screen.getByRole("alertdialog", { name: "放弃未保存的修改" });
    expect(dialog.textContent).toContain("当前草稿有未保存的修改");
    expect(closeCount).toBe(0);
    if (action === "button") fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    if (action === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
    if (action === "backdrop") fireEvent.click(dialog.parentElement!);
    expect(closeCount).toBe(0);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Unsaved draft");
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector(".draft-result-sheet")?.classList.contains("is-expanded")).toBe(true);
    expect(screen.getByRole("button", { name: "渲染模式" })).not.toBeNull();
  });

  test("explicit discard consumes the close candidate once", async () => {
    let closeCount = 0;
    const i18n = await localization();
    render(
      <I18nextProvider i18n={i18n}>
        <DraftResultSheet open workflow={workflow()} onSaved={unexpectedAction}
          onRegenerate={unexpectedAction} onClose={() => { closeCount += 1; }} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("无法读取草稿"));
    fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unsaved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭文字稿详情" }));
    const accept = screen.getByRole("button", { name: "放弃修改并关闭" });
    fireEvent.click(accept);
    fireEvent.click(accept);
    expect(closeCount).toBe(1);
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test.each(["task", "close"])("invalidates a dirty close candidate after %s changes", async (change) => {
    let closeCount = 0;
    const i18n = await localization();
    const sheet = (taskId: string, open: boolean) => (
      <I18nextProvider i18n={i18n}>
        <DraftResultSheet open={open} workflow={workflow(taskId)} onSaved={unexpectedAction}
          onRegenerate={unexpectedAction} onClose={() => { closeCount += 1; }} />
      </I18nextProvider>
    );
    const view = render(sheet("draft-1", true));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("无法读取草稿"));
    fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unsaved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭文字稿详情" }));
    const accept = screen.getByRole("button", { name: "放弃修改并关闭" });
    view.rerender(sheet(change === "task" ? "draft-2" : "draft-1", change !== "close"));
    fireEvent.click(accept);
    expect(closeCount).toBe(0);
    expect((accept as HTMLButtonElement).disabled).toBe(true);
  });

  test("regeneration reports local unsaved edits with the current seed without saving or closing", async () => {
    const requests: Array<[number | null, boolean]> = [];
    const i18n = await localization();
    render(
      <I18nextProvider i18n={i18n}>
        <DraftResultSheet open workflow={{ ...workflow(), draftSeedInsightId: 99 }}
          onSaved={unexpectedAction} onClose={unexpectedAction}
          onRegenerate={(seed, dirty) => { requests.push([seed, dirty]); }} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("无法读取草稿"));
    fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unsaved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    expect(requests).toEqual([[99, true]]);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Unsaved draft");
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test.each([
    ["a clean draft", { saving: false, dirty: false, discardAccepted: false }, true],
    ["cancelled discard", { saving: false, dirty: true, discardAccepted: false }, false],
    ["accepted discard", { saving: false, dirty: true, discardAccepted: true }, true],
    ["an active save", { saving: true, dirty: true, discardAccepted: true }, false],
  ] as const)("resolves closing for %s", (_label, state, allowed) => {
    expect(canCloseDraftResult(state)).toBe(allowed);
  });

  test("reports the real save lifecycle and blocks closing until the native failure settles", async () => {
    const busyStates: boolean[] = [];
    let closeCount = 0;
    const i18n = await localization();
    render(
      <I18nextProvider i18n={i18n}>
        <DraftResultSheet
          open
          workflow={workflow()}
          onBusyChange={(busy) => busyStates.push(busy)}
          onSaved={unexpectedAction}
          onRegenerate={unexpectedAction}
          onClose={() => { closeCount += 1; }}
        />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("无法读取草稿"));
    fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Edited draft" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(busyStates).toEqual([false, true]);
    const close = screen.getByRole("button", { name: "关闭文字稿详情" }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "重新生成" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(close);
    fireEvent.click(document.querySelector(".sheet-backdrop")!);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("dialog"), escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(closeCount).toBe(0);

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("保存草稿失败"));
    await waitFor(() => expect(busyStates).toEqual([false, true, false]));
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Edited draft");
    expect(close.disabled).toBe(false);
  });

  test("keeps reporting saving when the parent closes the sheet during the operation", async () => {
    const busyStates: boolean[] = [];
    const i18n = await localization();
    const onBusyChange = (busy: boolean) => { busyStates.push(busy); };
    const sheet = (open: boolean) => (
      <I18nextProvider i18n={i18n}>
        <DraftResultSheet
          open={open}
          workflow={workflow()}
          onBusyChange={onBusyChange}
          onSaved={unexpectedAction}
          onRegenerate={unexpectedAction}
          onClose={unexpectedAction}
        />
      </I18nextProvider>
    );
    const view = render(sheet(true));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("无法读取草稿"));
    fireEvent.click(screen.getByRole("button", { name: "编辑模式" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Edited draft" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(busyStates[busyStates.length - 1]).toBe(true);
    view.rerender(sheet(false));
    expect(busyStates[busyStates.length - 1]).toBe(true);
    await waitFor(() => expect(busyStates[busyStates.length - 1]).toBe(false));
  });

  test("handles Escape inside the sheet before application navigation handlers", async () => {
    let closeCount = 0;
    let globalEscapeCount = 0;
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") globalEscapeCount += 1;
    };
    const i18n = await localization();
    render(
      <I18nextProvider i18n={i18n}>
        <DraftResultSheet
          open
          workflow={workflow()}
          onSaved={unexpectedAction}
          onRegenerate={unexpectedAction}
          onClose={() => { closeCount += 1; }}
        />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("无法读取草稿"));
    window.addEventListener("keydown", onGlobalKeyDown);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("dialog"), escape);
    window.removeEventListener("keydown", onGlobalKeyDown);
    expect(escape.defaultPrevented).toBe(true);
    expect(globalEscapeCount).toBe(0);
    expect(closeCount).toBe(1);
  });

  test.each([
    ["zh-CN", "当前草稿有未保存的修改。关闭并放弃这些修改？"],
    ["zh-TW", "目前草稿有未儲存的修改。關閉並捨棄這些修改？"],
    ["en-US", "This draft has unsaved changes. Close and discard them?"],
  ] as const)("provides the localized discard question in %s", (locale, question) => {
    expect(studioResources[locale].draftResult).toHaveProperty("discardChangesConfirm", question);
  });
});
