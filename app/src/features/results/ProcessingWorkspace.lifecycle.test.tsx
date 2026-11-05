// @vitest-environment jsdom

import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { initializeI18n } from "../../i18n/i18n";
import { startNoteTitleGeneration, summarizeWorkerResult } from "../../workflow";
import { ProcessingWorkspace } from "./ProcessingWorkspace";

afterEach(cleanup);

test("title completion preserves the mounted reader and its interaction state", async () => {
  await initializeI18n("zh-CN");
  let mounts = 0;
  let unmounts = 0;
  function Reader() {
    const [expanded, setExpanded] = useState(false);
    useEffect(() => { mounts += 1; return () => { unmounts += 1; }; }, []);
    return <button onClick={() => setExpanded(!expanded)}>{expanded ? "Reader expanded" : "Reader collapsed"}</button>;
  }
  const saved = summarizeWorkerResult({ status: "completed", task_id: "saved-note", task_dir: "D:/notes/saved-note", artifacts: { transcript_txt: "transcript/transcript.txt" }, text: "Saved transcript", summary: "", insights: [], transcript: null, dissection: null, dissection_source_status: null, draft: "", error: null });
  const renderState = (workflow: typeof saved) => <ProcessingWorkspace workflow={workflow} onCancel={() => {}} onRetry={() => {}} onEditSource={() => {}} retryDisabled={false}><Reader /></ProcessingWorkspace>;
  const view = render(renderState(startNoteTitleGeneration(saved, "zh-CN")));
  fireEvent.click(screen.getByRole("button", { name: "Reader collapsed" }));
  expect(mounts).toBe(1);
  view.rerender(renderState(saved));
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
  expect(screen.getByRole("button", { name: "Reader expanded" })).toBeTruthy();
});
