import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf-8");
const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf-8");
const localTranscriptWorkspaceTsx = readFileSync(
  new URL("./features/transcript/LocalTranscriptWorkspace.tsx", import.meta.url),
  "utf-8",
);
const transcriptReviewPanelTsx = readFileSync(
  new URL("./features/transcript/TranscriptReviewPanel.tsx", import.meta.url),
  "utf-8",
);
const aiResultDetailSheetTsx = readFileSync(
  new URL("./features/results/AiResultDetailSheet.tsx", import.meta.url),
  "utf-8",
);
const transcriptDetailControllerTs = readFileSync(
  new URL("./features/transcript/useTranscriptDetailController.ts", import.meta.url),
  "utf-8",
);
const settingsSheetTsx = readFileSync(
  new URL("./features/settings/SettingsSheet.tsx", import.meta.url),
  "utf-8",
);
const settingsControllerTs = readFileSync(
  new URL("./features/settings/useSettingsController.ts", import.meta.url),
  "utf-8",
);

function getRuleBody(selectors: string[]): string {
  const selectorPattern = selectors
    .map((selector) => selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*,\\s*");
  const match = appCss.match(new RegExp(`${selectorPattern}\\s*\\{(?<body>[\\s\\S]*?)\\}`));
  return match?.groups?.body ?? "";
}

describe("App result workspace layout styles", () => {
  test("stacks the task banner above a domain-specific workspace grid", () => {
    const activeWorkspaceRule = getRuleBody([".workspace.active-layout"]);
    const taskLayoutRule = getRuleBody([".task-workspace-layout"]);

    expect(activeWorkspaceRule).toContain("display: flex;");
    expect(activeWorkspaceRule).toContain("flex-direction: column;");
    expect(activeWorkspaceRule).toContain("align-items: stretch;");
    expect(taskLayoutRule).toContain("display: grid;");
    expect(taskLayoutRule).toContain("minmax(0, 1.62fr) minmax(360px, 1fr)");
  });

  test("does not retain selectors from the deleted generic result workspace", () => {
    for (const selector of [
      ".result-workspace",
      ".result-card",
      ".result-grid",
      ".result-tile",
      ".result-placeholder",
    ]) {
      expect(appCss).not.toContain(selector);
    }
  });

  test("lets the active workspace expand across maximized desktop windows", () => {
    const activeWorkspaceRule = getRuleBody([".workspace.active-layout"]);
    const taskLayoutRule = getRuleBody([".task-workspace-layout"]);

    expect(activeWorkspaceRule).toContain("justify-content: flex-start;");
    expect(activeWorkspaceRule).not.toContain("1120px");
    expect(taskLayoutRule).not.toContain("max-width");
    expect(taskLayoutRule).toContain("min-width: 0;");
  });

  test("uses restrained shared panel tokens without decorative effects in the new workspaces", () => {
    const rootRule = getRuleBody([":root"]);
    const panelRule = getRuleBody([".task-domain-workspace"]);

    expect(rootRule).toContain("--shadow-panel");
    expect(panelRule).toContain("background: var(--surface-raised);");
    expect(panelRule).toContain("border: 1px solid var(--border);");
    expect(panelRule).toContain("box-shadow: var(--shadow-panel-quiet);");
    expect(panelRule).not.toContain("gradient");
    expect(panelRule).not.toContain("backdrop-filter");
  });

  test("keeps account status and cancel controls in the desktop toolbar system", () => {
    const activeAccountRule = getRuleBody([".account-chip.active"]);
    const activeAccountIconRule = getRuleBody([".account-chip.active svg"]);
    const dangerButtonRule = getRuleBody([".danger-soft"]);
    const dangerHoverRule = getRuleBody([".danger-soft:hover"]);

    expect(activeAccountRule).toContain(
      "background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(239, 241, 245, 0.9));",
    );
    expect(activeAccountRule).toContain("border-color: var(--border);");
    expect(activeAccountRule).toContain("color: #34363b;");
    expect(activeAccountIconRule).toContain("color: var(--success);");
    expect(dangerButtonRule).toContain(
      "background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(239, 241, 245, 0.9));",
    );
    expect(dangerButtonRule).toContain("border-color: var(--border);");
    expect(dangerButtonRule).toContain("color: #b42318;");
    expect(dangerHoverRule).toContain("background: #fff7f5;");
  });

  test("uses explicit task copy for the processing cancel action", () => {
    expect(localTranscriptWorkspaceTsx).toContain(
      'workflow.stage === "cancelling" ? "正在取消" : "取消本地处理"',
    );
    expect(localTranscriptWorkspaceTsx).toContain('disabled={workflow.stage === "cancelling"}');
  });

  test("routes sign-out cancellation through the workflow controller", () => {
    expect(appTsx).not.toContain("void cancelProcess();");
    expect(appTsx).toContain("void cancelCurrentProcessing();");
  });

  test("keeps history task replacement inside the workflow controller", () => {
    expect(appTsx).toContain("restoreHistoryItem(item);");
    expect(appTsx).toContain("selectionDisabled={!canRestoreHistory}");
    expect(appTsx).not.toContain("setWorkflow({");
  });

  test("clamps history titles and keeps metadata aligned across wide and narrow layouts", () => {
    const listRule = getRuleBody([".history-list"]);
    const itemRule = getRuleBody([".history-item"]);
    const mainRule = getRuleBody([".history-item-main"]);
    const titleRule = getRuleBody([".history-title"]);
    const metaRule = getRuleBody([".history-meta"]);
    const outputRule = getRuleBody([".history-meta-output"]);
    const outputValueRule = getRuleBody([".history-meta-output .history-meta-value"]);
    const resultRule = getRuleBody([".history-meta-result"]);

    expect(listRule).toContain("display: flex;");
    expect(listRule).toContain("flex-direction: column;");
    expect(listRule).toContain("align-items: stretch;");
    expect(itemRule).toContain("display: flex;");
    expect(itemRule).toContain("flex: 0 0 auto;");
    expect(itemRule).toContain("flex-direction: column;");
    expect(mainRule).toContain("display: flex;");
    expect(mainRule).toContain("flex-direction: column;");
    expect(titleRule).toContain("-webkit-line-clamp: 2;");
    expect(titleRule).toContain("overflow: hidden;");
    expect(titleRule).toContain("overflow-wrap: anywhere;");
    expect(titleRule).not.toContain("min-height");
    expect(titleRule).not.toContain("max-height");
    expect(metaRule).toContain("display: grid;");
    expect(metaRule).toContain("grid-template-columns: max-content minmax(0, 1fr) max-content;");
    expect(outputRule).toContain("min-width: 0;");
    expect(outputValueRule).toContain("overflow: hidden;");
    expect(outputValueRule).toContain("text-overflow: ellipsis;");
    expect(outputValueRule).toContain("white-space: nowrap;");
    expect(resultRule).toContain("justify-self: end;");
    expect(metaRule).toContain("flex: 0 0 auto;");
    expect(appCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.history-meta\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) max-content;[\s\S]*?\.history-meta-output\s*\{[\s\S]*?grid-column: 1 \/ -1;/,
    );
  });

  test("uses a custom compact audio review bar instead of the browser audio controls", () => {
    expect(transcriptReviewPanelTsx).toContain('className="audio-review-bar"');
    expect(transcriptReviewPanelTsx).toContain('className="transcript-audio-engine"');
    expect(transcriptReviewPanelTsx).not.toContain('className="transcript-audio"');
    expect(transcriptReviewPanelTsx).not.toContain("controls\n");
  });

  test("renders summary markdown through the markdown content component", () => {
    const markdownRule = getRuleBody([".markdown-content"]);
    const headingRule = getRuleBody([".markdown-content :is(h1, h2, h3, h4)"]);
    const tableRule = getRuleBody([".markdown-content table"]);

    expect(aiResultDetailSheetTsx).toContain("MarkdownContent");
    expect(aiResultDetailSheetTsx).toContain('markdown={workflow.summary}');
    expect(markdownRule).toContain("white-space: normal;");
    expect(markdownRule).toContain("overflow-wrap: anywhere;");
    expect(headingRule).toContain("line-height: 1.35;");
    expect(tableRule).toContain("overflow-x: auto;");
  });

  test("keeps the transcript audio review bar in the requested single-line player style", () => {
    const barRule = getRuleBody([".audio-review-bar"]);
    const playButtonRule = getRuleBody([".audio-play-button"]);
    const timelineRule = getRuleBody([".audio-review-timeline"]);
    const clockRule = getRuleBody([".audio-review-clock"]);
    const scrubberRule = getRuleBody([".audio-review-scrubber"]);
    const webkitTrackRule = getRuleBody([".audio-review-scrubber::-webkit-slider-runnable-track"]);
    const webkitThumbRule = getRuleBody([".audio-review-scrubber::-webkit-slider-thumb"]);

    expect(transcriptReviewPanelTsx).not.toContain('className="audio-review-actions"');
    expect(transcriptReviewPanelTsx).toContain("transcriptAudioScrubberStyle");
    expect(transcriptDetailControllerTs).toContain("--audio-progress");
    expect(barRule).toContain("grid-template-columns: auto minmax(0, 1fr);");
    expect(barRule).toContain("min-height: 64px;");
    expect(barRule).toContain("padding: 12px 16px;");
    expect(playButtonRule).toContain("height: 48px;");
    expect(playButtonRule).toContain("width: 48px;");
    expect(timelineRule).toContain("grid-template-columns: minmax(0, 1fr) max-content;");
    expect(clockRule).toContain("font-variant-numeric: tabular-nums;");
    expect(clockRule).toContain("font-weight: 760;");
    expect(scrubberRule).toContain("appearance: none;");
    expect(webkitTrackRule).toContain("#2388f2");
    expect(webkitTrackRule).toContain("#2fc66d");
    expect(webkitTrackRule).toContain("height: 8px;");
    expect(webkitThumbRule).toContain("background: transparent;");
    expect(webkitThumbRule).toContain("height: 18px;");
    expect(webkitThumbRule).toContain("width: 18px;");
  });

  test("keeps the settings sheet grouped and scannable", () => {
    const settingsModalRule = getRuleBody([".settings-modal", ".settings-sheet"]);
    const layoutRule = getRuleBody([".settings-layout"]);
    const navRule = getRuleBody([".settings-nav"]);
    const navItemRule = getRuleBody([".settings-nav-item"]);
    const selectedNavItemRule = getRuleBody([".settings-nav-item.selected"]);
    const sectionsRule = getRuleBody([".settings-sections"]);
    const privacyCalloutRule = getRuleBody([".settings-warning", ".privacy-callout"]);
    const statusCardRule = getRuleBody([".settings-status-card"]);
    const summaryListRule = getRuleBody([".settings-summary-list"]);
    const inspirationActionsRule = getRuleBody([".inspiration-settings-actions"]);
    const profileEditButtonRule = getRuleBody([".profile-edit-button"]);
    const profileClearButtonRule = getRuleBody([".profile-clear-button"]);

    expect(settingsSheetTsx).toContain('className="settings-layout"');
    expect(settingsSheetTsx).toContain('className="settings-nav"');
    expect(settingsControllerTs).toContain('const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("basic")');
    expect(settingsSheetTsx).toContain('data-settings-category={item.id}');
    expect(settingsSheetTsx).toContain('id="settings-inspiration"');
    expect(settingsSheetTsx).toContain('className="settings-summary-list"');
    expect(settingsSheetTsx).toContain("profile-edit-button");
    expect(settingsSheetTsx).toContain("profile-clear-button");
    expect(settingsSheetTsx).toContain('settingsCategory === "inspiration"');
    expect(settingsModalRule).toContain("max-width: 800px;");
    expect(layoutRule).toContain("grid-template-columns: 176px minmax(0, 1fr);");
    expect(navRule).toContain("border-right: 1px solid var(--border);");
    expect(navItemRule).toContain("box-shadow: none;");
    expect(navItemRule).toContain("display: flex;");
    expect(navItemRule).toContain("flex-direction: column;");
    expect(navItemRule).toContain("height: 64px;");
    expect(navItemRule).toContain("justify-content: center;");
    expect(navItemRule).toContain("padding: 0 14px;");
    expect(navItemRule).toContain("align-items: flex-start;");
    expect(selectedNavItemRule).toContain("background: rgba(255, 255, 255, 0.86);");
    expect(sectionsRule).toContain("overflow: auto;");
    expect(privacyCalloutRule).toContain("background: rgba(248, 249, 252, 0.78);");
    expect(privacyCalloutRule).toContain("color: var(--text-muted);");
    expect(statusCardRule).toContain("box-shadow: none;");
    expect(summaryListRule).toContain("flex-wrap: wrap;");
    expect(inspirationActionsRule).toContain("align-items: center;");
    expect(inspirationActionsRule).toContain("justify-content: flex-start;");
    expect(profileEditButtonRule).toContain("width: auto;");
    expect(profileEditButtonRule).toContain("min-height: 36px;");
    expect(inspirationActionsRule).toContain("display: flex;");
    expect(inspirationActionsRule).toContain("flex-wrap: nowrap;");
    expect(profileClearButtonRule).toContain(
      "background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(239, 241, 245, 0.9));",
    );
    expect(profileClearButtonRule).toContain("border-color: var(--border);");
    expect(profileClearButtonRule).toContain("color: #34363b;");
    expect(profileClearButtonRule).toContain("min-height: 36px;");
  });
});
