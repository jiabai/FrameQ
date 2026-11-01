// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

function confirmation(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const actions: string[] = [];
  const view = render(
    <ConfirmDialog
      open title="Discard changes" message="Unsaved edits will be discarded."
      cancelLabel="Keep editing" confirmLabel="Discard"
      onCancel={() => actions.push("cancel")} onConfirm={() => actions.push("confirm")}
      {...overrides}
    />,
  );
  return { ...view, actions };
}

describe("ConfirmDialog", () => {
  test("uses an alertdialog, readable description and the shared initial cancel focus marker", () => {
    confirmation();
    const dialog = screen.getByRole("alertdialog", { name: "Discard changes" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent)
      .toBe("Unsaved edits will be discarded.");
    expect(screen.getByRole("heading", { name: "Discard changes" }).tagName).toBe("H2");
    expect(screen.getByRole("button", { name: "Keep editing" }).hasAttribute("data-modal-initial-focus")).toBe(true);
    expect(dialog.classList.contains("confirm-dialog")).toBe(true);
  });

  test.each(["button", "Escape", "backdrop"])("cancels through %s without confirming", (action) => {
    const { actions } = confirmation();
    if (action === "button") fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    if (action === "backdrop") fireEvent.click(document.querySelector(".sheet-backdrop")!);
    if (action === "Escape") fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(actions).toEqual(["cancel"]);
  });

  test("only an explicit acceptance confirms", () => {
    const { actions } = confirmation();
    fireEvent.click(screen.getByRole("alertdialog"));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });
    expect(actions).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(actions).toEqual(["confirm"]);
  });

  test("contains Escape before application navigation receives it", () => {
    const { actions } = confirmation();
    let globalEscapes = 0;
    const listener = () => { globalEscapes += 1; };
    window.addEventListener("keydown", listener);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("alertdialog"), escape);
    window.removeEventListener("keydown", listener);
    expect(escape.defaultPrevented).toBe(true);
    expect(globalEscapes).toBe(0);
    expect(actions).toEqual(["cancel"]);
  });

  test("disabled confirmation blocks acceptance and every cancellation route", () => {
    const { actions } = confirmation({ disabled: true });
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(document.querySelector(".sheet-backdrop")!);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(actions).toEqual([]);
  });

  test("closing retains the shell and blocks late actions during the exit animation", () => {
    const { rerender, actions } = confirmation();
    rerender(
      <ConfirmDialog
        open={false} title="Discard changes" message="Unsaved edits will be discarded."
        cancelLabel="Keep editing" confirmLabel="Discard"
        onCancel={() => actions.push("cancel")} onConfirm={() => actions.push("confirm")}
      />,
    );
    expect(document.querySelector("[data-motion-state='closing']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(document.querySelector(".sheet-backdrop")!);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(actions).toEqual([]);
  });

  test("starts absent when closed", () => {
    const { container } = confirmation({ open: false });
    expect(container.innerHTML).toBe("");
  });
});
