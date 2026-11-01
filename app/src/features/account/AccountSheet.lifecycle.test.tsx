// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { createGuestAccountStatus } from "../../accountState";
import { initializeI18n } from "../../i18n/i18n";
import { AccountSheet } from "./AccountSheet";

afterEach(cleanup);

test("Escape closes the active account sheet once and is contained during exit", async () => {
  await initializeI18n("en-US");
  let closed = 0;
  let businessActions = 0;
  let outsideEscapes = 0;
  const account = createGuestAccountStatus();
  const business = () => { businessActions += 1; };
  const sheet = (open: boolean) => <AccountSheet
    open={open} account={account} accountStatusText="Account"
    accountNotice={null} accountLoading={false} activationCodeDraft=""
    activationRedeeming={false} activationCodeRequest={{ status: "idle", retryAt: null, error: null }}
    onClose={() => { closed += 1; }} onActivationCodeChange={business}
    onRequestActivationCode={business} onRedeemActivationCode={business}
    onSignOut={business} onStartLogin={business}
  />;
  const view = render(sheet(true));
  const outside = () => { outsideEscapes += 1; };
  window.addEventListener("keydown", outside);
  try {
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("dialog"), escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(closed).toBe(1);
    expect(outsideEscapes).toBe(0);
    view.rerender(sheet(false));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(closed).toBe(1);
    expect(businessActions).toBe(0);
    expect(outsideEscapes).toBe(0);
  } finally {
    window.removeEventListener("keydown", outside);
  }
});
