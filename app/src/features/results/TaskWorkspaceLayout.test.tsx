// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { initializeI18n } from "../../i18n/i18n";
import { TaskWorkspaceLayout } from "./TaskWorkspaceLayout";

afterEach(cleanup);

function workspace(title = "A saved note") {
  return <TaskWorkspaceLayout
    title={title}
    local={<textarea aria-label="Transcript draft" defaultValue="Saved transcript" />}
    ai={<><input aria-label="AI draft" defaultValue="Saved AI draft" /><button type="button">AI action</button></>}
  />;
}

test.each([
  ["zh-CN", "智能提炼", "隐藏智能提炼", "显示智能提炼"],
  ["zh-TW", "AI 提煉", "隱藏 AI 提煉", "顯示 AI 提煉"],
  ["en-US", "AI Synthesis", "Hide AI Synthesis", "Show AI Synthesis"],
] as const)("localizes the pane control and preserves the note title in %s", async (locale, heading, hide, show) => {
  await initializeI18n(locale);
  const { container } = render(workspace("User's saved note"));
  const title = screen.getByRole("heading", { level: 1, name: "User's saved note" });
  expect(title.title).toBe("User's saved note");
  expect(screen.getByRole("heading", { level: 2, name: heading })).toBeTruthy();
  const toggle = screen.getByRole("button", { name: hide });
  const pane = document.getElementById(toggle.getAttribute("aria-controls")!);
  const separator = screen.getByRole("separator");
  expect(separator.getAttribute("aria-orientation")).toBe("vertical");
  expect(document.getElementById(separator.getAttribute("aria-controls")!)).toBe(container.querySelector(".task-workspace-local-pane"));
  expect(pane).toBe(container.querySelector(".task-workspace-ai-pane"));
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(pane?.hasAttribute("inert")).toBe(false);

  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: show })).toBe(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(pane?.getAttribute("aria-hidden")).toBe("true");
  expect(pane?.hasAttribute("inert")).toBe(true);
  expect(pane?.hasAttribute("hidden")).toBe(false);
  expect(screen.queryByRole("heading", { level: 2, name: heading })).toBeNull();
  expect(screen.queryByRole("button", { name: "AI action" })).toBeNull();
  expect(screen.queryByRole("separator")).toBeNull();
  expect(container.querySelector(".task-workspace-ai-heading")?.hasAttribute("inert")).toBe(true);
});

test("keeps both panes mounted and preserves drafts across hiding, showing, and title changes", async () => {
  await initializeI18n("en-US");
  const view = render(workspace());
  const transcript = screen.getByLabelText<HTMLTextAreaElement>("Transcript draft");
  const aiDraft = screen.getByLabelText<HTMLInputElement>("AI draft");
  fireEvent.change(transcript, { target: { value: "Unsaved transcript edit" } });
  fireEvent.change(aiDraft, { target: { value: "Unsaved AI edit" } });
  const toggle = screen.getByRole("button", { name: "Hide AI Synthesis" });
  fireEvent.click(toggle);
  view.rerender(workspace("Renamed note"));
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByRole("heading", { level: 1, name: "Renamed note" })).toBeTruthy();
  expect(view.container.querySelector('input[aria-label="AI draft"]')).toBe(aiDraft);

  fireEvent.click(toggle);
  expect(screen.getByLabelText("Transcript draft")).toBe(transcript);
  expect(screen.getByLabelText("AI draft")).toBe(aiDraft);
  expect(transcript.value).toBe("Unsaved transcript edit");
  expect(aiDraft.value).toBe("Unsaved AI edit");
});

test("returns focus from the AI pane before hiding and preserves focus in the local pane", async () => {
  await initializeI18n("en-US");
  const { container } = render(workspace());
  const toggle = screen.getByRole("button", { name: "Hide AI Synthesis" });
  screen.getByRole("button", { name: "AI action" }).focus();
  fireEvent.click(toggle);
  expect(document.activeElement).toBe(toggle);
  expect(container.querySelector(".task-workspace-ai-pane")?.hasAttribute("inert")).toBe(true);

  fireEvent.click(toggle);
  const local = screen.getByLabelText("Transcript draft");
  local.focus();
  fireEvent.click(toggle);
  expect(document.activeElement).toBe(local);

  fireEvent.click(toggle);
  screen.getByRole("separator").focus();
  fireEvent.click(toggle);
  expect(document.activeElement).toBe(toggle);
});

test("handles rapid batched reversals without a delayed transition state", async () => {
  await initializeI18n("en-US");
  const { container } = render(workspace());
  const toggle = screen.getByRole<HTMLButtonElement>("button", { name: "Hide AI Synthesis" });
  act(() => { toggle.click(); toggle.click(); toggle.click(); });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector(".task-workspace-surface")?.classList.contains("is-ai-collapsed")).toBe(true);
  act(() => { toggle.click(); toggle.click(); toggle.click(); });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector(".task-workspace-ai-pane")?.hasAttribute("inert")).toBe(false);
});

test("owns a unique controlled pane for each rendered workspace", async () => {
  await initializeI18n("en-US");
  render(<>{workspace("First note")}{workspace("Second note")}</>);
  const controls = screen.getAllByRole("button", { name: "Hide AI Synthesis" });
  expect(controls[0].getAttribute("aria-controls")).not.toBe(controls[1].getAttribute("aria-controls"));
  fireEvent.click(controls[0]);
  expect(controls[0].getAttribute("aria-expanded")).toBe("false");
  expect(controls[1].getAttribute("aria-expanded")).toBe("true");
});
