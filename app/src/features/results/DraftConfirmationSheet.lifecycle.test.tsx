// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";

import type { DraftPlatformId } from "../../insightPreferences";
import { initializeI18n } from "../../i18n/i18n";
import { createInitialWorkflow } from "../../workflowState";
import { DraftConfirmationSheet } from "./DraftConfirmationSheet";

function unexpectedAction(): never {
  throw new Error("Unexpected user action");
}

afterEach(cleanup);

describe("DraftConfirmationSheet shared lifecycle", () => {
  test("owns focus, background inert, Escape and restoration through the shared shell", async () => {
    await initializeI18n("en-US");
    let cancelled = 0;
    let escapedOutside = 0;
    function Confirmation() {
      const [mounted, setMounted] = useState(false);
      return (
        <>
          <main><button type="button" onClick={() => setMounted(true)}>Open draft confirmation</button></main>
          {mounted ? (
            <DraftConfirmationSheet
              open
              workflow={createInitialWorkflow()}
              busy={false}
              quotaRemaining={5}
              transcriptPath={null}
              onConfirm={unexpectedAction}
              onCancel={() => { cancelled += 1; setMounted(false); }}
            />
          ) : null}
        </>
      );
    }
    render(<Confirmation />);
    const origin = screen.getByRole("button", { name: "Open draft confirmation" });
    origin.focus();
    fireEvent.click(origin);
    const dialog = screen.getByRole("dialog");
    const background = document.querySelector("main")!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(background.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".sheet-backdrop")!.getAttribute("data-motion-state")).toBe("open");

    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    fireEvent(dialog, tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);

    const outside = () => { escapedOutside += 1; };
    window.addEventListener("keydown", outside);
    try {
      const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      fireEvent(dialog, escape);
      expect(escape.defaultPrevented).toBe(true);
      expect(escapedOutside).toBe(0);
    } finally {
      window.removeEventListener("keydown", outside);
    }
    expect(cancelled).toBe(1);
    expect(background.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(origin);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("blocks actions during closing and restores platform selection and confirmation after reopening", async () => {
    await initializeI18n("en-US");
    const submitted: DraftPlatformId[] = [];
    let cancelled = 0;
    const sheet = (open: boolean) => (
      <>
        <main><button type="button">Background</button></main>
        <DraftConfirmationSheet
          open={open}
          workflow={createInitialWorkflow()}
          busy={false}
          quotaRemaining={5}
          transcriptPath={null}
          onConfirm={(platform) => { submitted.push(platform); }}
          onCancel={() => { cancelled += 1; }}
        />
      </>
    );
    const view = render(sheet(true));
    const panel = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("radio", { name: "Douyin" }));
    expect(screen.getByRole("radio", { name: "Douyin" }).getAttribute("aria-checked")).toBe("true");
    view.rerender(sheet(false));
    expect(screen.getByRole("dialog")).toBe(panel);
    expect(document.querySelector(".sheet-backdrop")!.getAttribute("data-motion-state")).toBe("closing");
    expect(document.querySelector("main")!.hasAttribute("inert")).toBe(true);
    for (const button of panel.querySelectorAll("button")) {
      expect(button.disabled).toBe(true);
    }
    fireEvent.click(screen.getByRole("radio", { name: "TikTok" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close the full transcript confirmation" }));
    fireEvent.click(document.querySelector(".sheet-backdrop")!);
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(submitted).toEqual([]);
    expect(cancelled).toBe(0);
    expect(screen.getByRole("radio", { name: "Douyin" }).getAttribute("aria-checked")).toBe("true");
    view.rerender(sheet(true));
    expect(screen.getByRole("dialog")).toBe(panel);
    expect(document.querySelector(".sheet-backdrop")!.getAttribute("data-motion-state")).toBe("open");
    for (const button of panel.querySelectorAll("button")) {
      expect(button.disabled).toBe(false);
    }
    fireEvent.click(screen.getByRole("radio", { name: "TikTok" }));
    expect(screen.getByRole("radio", { name: "TikTok" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(submitted).toEqual(["tiktok"]);
    expect(cancelled).toBe(0);
  });

  test("retains the existing busy close behavior while blocking footer actions", async () => {
    await initializeI18n("en-US");
    let cancelled = 0;
    render(
      <DraftConfirmationSheet
        open
        workflow={createInitialWorkflow()}
        busy
        quotaRemaining={5}
        transcriptPath={null}
        onConfirm={unexpectedAction}
        onCancel={() => { cancelled += 1; }}
      />,
    );
    for (const button of screen.getAllByRole("radio")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByRole("button", { name: "Starting" }) as HTMLButtonElement).disabled).toBe(true);
    const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.click(cancel);
    expect(cancelled).toBe(0);
    const close = screen.getByRole("button", { name: "Close the full transcript confirmation" }) as HTMLButtonElement;
    expect(close.disabled).toBe(false);
    fireEvent.click(close);
    fireEvent.click(document.querySelector(".sheet-backdrop")!);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(cancelled).toBe(3);
  });
});
