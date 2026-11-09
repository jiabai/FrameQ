import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf-8");
const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf-8");
const shellCss = readFileSync(
  new URL("./features/shell/shell.css", import.meta.url),
  "utf-8",
);
const sidebarCss = readFileSync(
  new URL("./features/shell/sidebar.css", import.meta.url),
  "utf-8",
);
const composerCss = readFileSync(
  new URL("./features/workflow/composer.css", import.meta.url),
  "utf-8",
);
const shellToolbarTsx = readFileSync(
  new URL("./features/shell/ShellToolbar.tsx", import.meta.url),
  "utf-8",
);
const desktopSidebarTsx = readFileSync(
  new URL("./features/shell/DesktopSidebar.tsx", import.meta.url),
  "utf-8",
);
const taskComposerTsx = readFileSync(
  new URL("./features/workflow/TaskComposer.tsx", import.meta.url),
  "utf-8",
);
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
const transcriptReviewSessionTs = readFileSync(
  new URL("./features/transcript/useTranscriptReviewSession.ts", import.meta.url),
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
const browserSmokeSource = readFileSync(
  new URL("../tests/app-input.browser.test.ts", import.meta.url),
  "utf-8",
);

function getRuleBody(selectors: string[], stylesheet = appCss): string {
  const selectorPattern = selectors
    .map((selector) => selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*,\\s*");
  const match = stylesheet.match(new RegExp(`${selectorPattern}\\s*\\{(?<body>[\\s\\S]*?)\\}`));
  return match?.groups?.body ?? "";
}

describe("App result workspace layout styles", () => {
  test("keeps processing loaders visibly active while respecting reduced motion", () => {
    const spinRule = getRuleBody([".spin"]);

    expect(spinRule).toContain("animation: spin 1s linear infinite;");
    expect(spinRule).toContain("transform-origin: center;");
    expect(appCss).toContain("@keyframes processing-pulse");
    expect(appCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.spin\s*\{[\s\S]*?animation: processing-pulse 1.8s ease-in-out infinite !important;/,
    );
  });

  test("lets Motion own the ASR progress interpolation", () => {
    expect(appCss).toMatch(
      /\.progress-fill\[data-motion="asr-progress"\]\s*\{[\s\S]*?transition:\s*none;/,
    );
  });

  test("stacks the task banner above a domain-specific workspace grid", () => {
    const activeWorkspaceRule = getRuleBody([".workspace.active-layout"]);
    const taskLayoutRule = getRuleBody([".task-workspace-layout"]);

    expect(activeWorkspaceRule).toContain("display: flex;");
    expect(activeWorkspaceRule).toContain("flex-direction: column;");
    expect(activeWorkspaceRule).toContain("align-items: stretch;");
    expect(taskLayoutRule).toContain("display: grid;");
    expect(taskLayoutRule).toContain("grid-template-columns: var(--workspace-columns);");
    expect(getRuleBody([".task-workspace-surface"])).toContain("minmax(0, 1fr) minmax(0, var(--workspace-ai-size))");
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
    expect(panelRule).toContain("background: transparent;");
    expect(panelRule).toContain("border: 0;");
    expect(panelRule).toContain("border-radius: 0;");
    expect(panelRule).toContain("box-shadow: none;");
    expect(panelRule).not.toContain("gradient");
    expect(panelRule).not.toContain("backdrop-filter");
  });

  test("uses scoped workspace typography and the selected spacing", () => {
    const rootRule = getRuleBody([":root"]);
    const h1Rule = getRuleBody(["h1"]);
    const h2Rule = getRuleBody(["h2"]);
    const h3Rule = getRuleBody(["h3"]);
    const labelRule = getRuleBody([".eyebrow", ".section-label"]);
    const activeWorkspaceRule = getRuleBody([".workspace.active-layout"]);
    const taskLayoutRule = getRuleBody([".task-workspace-layout"]);
    const domainRule = getRuleBody([".task-domain-workspace"]);
    const transcriptPanelRule = getRuleBody([".transcript-review-panel"]);
    const historyListRule = getRuleBody([".history-list"]);
    const historyItemSelectRule = getRuleBody([".history-item-select"]);
    const historyMainRule = getRuleBody([".history-item-main"]);
    const localWorkspaceRule = getRuleBody([".local-transcript-workspace"]);

    expect(rootRule).toContain("--text-soft: #747982;");
    expect(rootRule).toContain("--space-3: 12px;");
    expect(rootRule).toContain("--space-4: 16px;");
    expect(rootRule).toContain("--space-6: 24px;");
    expect(h1Rule).toContain("font-weight: 700;");
    expect(h2Rule).toContain("font-weight: 700;");
    expect(h3Rule).toContain("font-weight: 650;");
    expect(labelRule).toContain("font-weight: 700;");
    expect(getRuleBody([".sidebar-layout .workspace.shell-content.active-layout"], shellCss)).toContain("gap: 0;");
    expect(activeWorkspaceRule).toContain("display: flex;");
    expect(taskLayoutRule).toContain("gap: 0;");
    expect(domainRule).toContain("gap: 0;");
    expect(domainRule).toContain("padding: 0;");
    expect(transcriptPanelRule).toContain("gap: 0;");
    expect(historyListRule).toContain("gap: 0;");
    expect(historyItemSelectRule).toContain("gap: 8px;");
    expect(historyMainRule).toContain("gap: 8px;");
    expect(localWorkspaceRule).toContain("height: auto;");
    expect(localWorkspaceRule).toContain("min-height: 0;");
    expect(localWorkspaceRule).toContain("padding: 16px 24px 0;");
  });

  test("separates flat transcript segments and AI targets with horizontal rules", () => {
    const segmentListRule = getRuleBody([".transcript-segments"]);
    const segmentRule = getRuleBody([".transcript-segment"]);
    const segmentDividerRule = getRuleBody([".transcript-segment + .transcript-segment"]);
    const targetListRule = getRuleBody([".ai-target-list"]);
    const targetRule = getRuleBody([".ai-target-card"]);
    const targetDividerRule = getRuleBody([".ai-target-card + .ai-target-card"]);
    const activeTargetRule = getRuleBody([
      ".ai-target-card.generating",
      ".ai-target-card.cancelling",
    ]);
    const failedTargetRule = getRuleBody([".ai-target-card.failed"]);

    expect(segmentListRule).toContain("border: 0;");
    expect(segmentListRule).toContain("overflow: visible;");
    expect(segmentListRule).toContain("gap: 0;");
    expect(segmentRule).toContain("background: transparent;");
    expect(segmentRule).toContain("border: 0;");
    expect(segmentRule).toContain("border-radius: 0;");
    expect(segmentDividerRule).toContain("border-top: 1px solid #eceeeb;");

    expect(targetListRule).toContain("border: 0;");
    expect(targetListRule).toContain("overflow: visible;");
    expect(targetListRule).toContain("gap: 0;");
    expect(targetRule).toContain("background: transparent;");
    expect(targetRule).toContain("border: 0;");
    expect(targetRule).toContain("border-radius: 0;");
    expect(targetDividerRule).toContain("border-top: 1px solid #eceeeb;");
    expect(activeTargetRule).toContain("background: #f7fbff;");
    expect(activeTargetRule).not.toContain("border-color");
    expect(failedTargetRule).toContain("background: #fff8f7;");
    expect(failedTargetRule).not.toContain("border-color");
  });

  test("uses a quiet scoped action before final AI confirmation", () => {
    const actionRule = getRuleBody([".ai-target-action"]);
    const actionFeedbackRule = getRuleBody([
      ".ai-target-action:not(:disabled):hover",
      ".ai-target-action:focus-visible",
      ".ai-target-actions .secondary-button:not(:disabled):hover",
      ".ai-cancel-button:not(:disabled):hover",
    ]);

    expect(actionRule).toContain("background: transparent;");
    expect(actionRule).toContain("box-shadow: none;");
    expect(actionRule).toContain("color: #2570b3;");
    expect(actionFeedbackRule).toContain("background: #f1f7fe;");
  });

  test("anchors account details beneath the independently scrolling sidebar history", () => {
    const sidebarRule = getRuleBody([".desktop-sidebar"], sidebarCss);
    const historyRule = getRuleBody([".shell-sidebar-history"], sidebarCss);
    const accountRule = getRuleBody([".shell-sidebar-account"], sidebarCss);
    const detailsRule = getRuleBody([".shell-account-details"], sidebarCss);

    expect(appTsx).toContain("<DesktopSidebar");
    expect(appTsx).toContain("account={account}");
    expect(sidebarRule).toContain("display: flex;");
    expect(sidebarRule).toContain("flex-direction: column;");
    expect(sidebarRule).toContain("height: 100%;");
    expect(historyRule).toContain("flex: 1;");
    expect(historyRule).toContain("min-height: 0;");
    expect(historyRule).toContain("overflow-y: auto;");
    expect(accountRule).toContain("margin-top: auto;");
    expect(accountRule).toContain("flex: 0 0 auto;");
    expect(detailsRule).toContain("min-width: 0;");
    expect(detailsRule).toContain("flex-direction: column;");
    expect(desktopSidebarTsx).toContain("<strong>{displayName}</strong>");
    expect(desktopSidebarTsx).toContain('email ?? t("account.guestDescription")');
  });

  test("keeps task cancellation actions visually distinct", () => {
    const dangerButtonRule = getRuleBody([".danger-soft"]);
    const dangerHoverRule = getRuleBody([".danger-soft:hover"]);

    expect(dangerButtonRule).toContain(
      "background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(239, 241, 245, 0.9));",
    );
    expect(dangerButtonRule).toContain("border-color: var(--border);");
    expect(dangerButtonRule).toContain("color: #b42318;");
    expect(dangerHoverRule).toContain("background: #fff7f5;");
  });

  test("keeps navigation and utilities reachable in a quiet compact toolbar", () => {
    const toolbarRule = getRuleBody([".app-toolbar.shell-toolbar"], shellCss);
    const buttonRule = getRuleBody([".shell-toolbar-button"], shellCss);
    const utilitiesRule = getRuleBody([".shell-toolbar-utilities"], shellCss);
    const titleRule = getRuleBody([".shell-toolbar-title"], shellCss);

    expect(appTsx).toContain("<ShellToolbar");
    expect(shellToolbarTsx).toContain("onClick={onToggleSidebar}");
    expect(shellToolbarTsx).toContain("aria-expanded={!collapsed}");
    expect(shellToolbarTsx).toContain('aria-controls="app-sidebar"');
    expect(shellToolbarTsx).toContain("onClick={onBack} disabled={!canBack}");
    expect(shellToolbarTsx).toContain("onClick={onForward} disabled={!canForward}");
    expect(shellToolbarTsx).toContain("onClick={onInstallUpdate}");
    expect(toolbarRule).toContain("grid-column: 2;");
    expect(toolbarRule).toContain("display: flex;");
    expect(toolbarRule).toContain("background: transparent;");
    expect(toolbarRule).toContain("box-shadow: none;");
    expect(buttonRule).toContain("width: 32px;");
    expect(buttonRule).toContain("min-height: 32px;");
    expect(utilitiesRule).toContain("margin-left: auto;");
    expect(titleRule).toContain("min-width: 0;");
    expect(titleRule).toContain("text-overflow: ellipsis;");
  });

  test("preserves the Home proportions, borderless artwork, and reversible sidebar", () => {
    const windowRule = getRuleBody([".desktop-window.sidebar-layout"], shellCss);
    const collapsedRule = getRuleBody([".desktop-window.sidebar-layout.is-sidebar-collapsed"], shellCss);
    const contentRule = getRuleBody([".sidebar-layout .workspace.shell-content"], shellCss);
    const columnRule = getRuleBody([".sidebar-layout .workspace.waiting-layout .workflow-column"], shellCss);
    const greetingRule = getRuleBody([".shell-home-greeting"], shellCss);

    expect(windowRule).toContain("grid-template-columns: var(--sidebar-width) minmax(0, 1fr);");
    expect(collapsedRule).toContain("--sidebar-width: 66px;");
    expect(contentRule).toContain("min-height: 0;");
    expect(contentRule).toContain("min-width: 0;");
    expect(contentRule).toContain("overflow: auto;");
    expect(contentRule).toContain("border-radius: 27px;");
    expect(columnRule).toContain("max-width: 972px;");
    expect(columnRule).toContain("width: 100%;");
    expect(greetingRule).toContain("font-family: Georgia,");
    for (const selector of [".shell-sidebar-region .shell-sidebar-mark", ".shell-greeting-mark"]) {
      const markRule = getRuleBody([selector], shellCss);
      expect(markRule).toContain("border: 0;");
      expect(markRule).toContain("border-radius: 0;");
      expect(markRule).toContain("background: transparent;");
      expect(markRule).toContain("box-shadow: none;");
    }
    expect(shellCss).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.desktop-window.sidebar-layout.is-sidebar-collapsed\s*\{[\s\S]*?--sidebar-width: 66px;/);
  });

  test("owns the compact composer surface and selection styles in its feature stylesheet", () => {
    const surfaceRule = getRuleBody([".media-composer-surface"], composerCss);
    const expandedRule = getRuleBody([".media-composer.is-expanded .media-composer-surface"], composerCss);
    const toolbarRule = getRuleBody([".media-composer-toolbar"], composerCss);
    const selectionRule = getRuleBody([".media-composer .local-media-chip"], composerCss);
    const removeRule = getRuleBody([".media-composer .local-media-remove"], composerCss);

    expect(taskComposerTsx).toContain('import "./composer.css";');
    expect(surfaceRule).toContain("height: 156px;");
    expect(surfaceRule).toContain("border-radius: 16px;");
    expect(surfaceRule).toContain("flex-direction: column;");
    expect(surfaceRule).not.toContain("gradient");
    expect(expandedRule).toContain("height: min(400px, 60vh);");
    expect(toolbarRule).toContain("display: flex;");
    expect(selectionRule).toContain("grid-template-columns: auto minmax(0, 1fr) 32px;");
    expect(selectionRule).toContain("min-width: 0;");
    expect(removeRule).toContain("width: 32px;");
    for (const selector of [".command-panel", ".input-pane", ".task-composer-row", ".attachment-control", ".attachment-trigger", ".attachment-menu", ".local-media-chip", ".local-media-remove", ".status-line"]) {
      expect(appCss).not.toContain(selector);
    }
    expect(getRuleBody([".settings-form input", ".settings-form select", ".search-box input"])).toContain("border: 1px solid var(--border-strong);");
    expect(getRuleBody([".settings-form input:focus", ".settings-form select:focus", ".search-box:focus-within"])).toContain("box-shadow: 0 0 0 3px var(--focus);");
  });

  test("uses facade cancellation state for the processing cancel action", () => {
    expect(localTranscriptWorkspaceTsx).toContain('t("workspace.cancelling")');
    expect(localTranscriptWorkspaceTsx).toContain('t("workspace.cancel")');
    expect(localTranscriptWorkspaceTsx).toContain("model.cancellation.visible");
    expect(localTranscriptWorkspaceTsx).toContain("disabled={!model.cancellation.enabled}");
    expect(localTranscriptWorkspaceTsx).toContain("model.cancellation.inProgress");
    expect(localTranscriptWorkspaceTsx).not.toContain("workflow.stage");
  });

  test("routes sign-out cancellation through the workflow controller", () => {
    expect(appTsx).not.toContain("void cancelProcess();");
    expect(appTsx).toContain("void cancelCurrentProcessing();");
  });

  test("keeps history task replacement inside the workflow controller", () => {
    expect(appTsx).toMatch(/!shellCanNavigateRef\.current\s*\|\|\s*!restoreHistoryItem\(item\)/);
    expect(appTsx).toContain("selectionDisabled={!canNavigate}");
    expect(appTsx).not.toContain("setWorkflow({");
  });

  test("clamps history titles and keeps metadata aligned across wide and narrow layouts", () => {
    const listRule = getRuleBody([".history-list"]);
    const sheetRule = getRuleBody([".history-modal", ".history-sheet"]);
    const itemRule = getRuleBody([".history-item"]);
    const selectRule = getRuleBody([".history-item-select"]);
    const deleteRule = getRuleBody([".history-item-delete"]);
    const deleteFeedbackRule = getRuleBody([
      ".history-item-delete:not(:disabled):hover",
      ".history-item-delete:focus-visible",
    ]);
    const mainRule = getRuleBody([".history-item-main"]);
    const titleRule = getRuleBody([".history-title"]);
    const metaRule = getRuleBody([".history-meta"]);
    const outputRule = getRuleBody([".history-meta-output"]);
    const outputValueRule = getRuleBody([".history-meta-output .history-meta-value"]);
    const resultRule = getRuleBody([".history-meta-result"]);
    const confirmRule = getRuleBody([".history-delete-confirm"]);
    const dangerRule = getRuleBody([".history-delete-confirm .danger-button"]);

    expect(listRule).toContain("display: flex;");
    expect(listRule).toContain("flex-direction: column;");
    expect(listRule).toContain("flex: 0 1 auto;");
    expect(listRule).toContain("min-height: 0;");
    expect(listRule).toContain("overflow: auto;");
    expect(sheetRule).not.toMatch(/(?:^|\s)(?:height|min-height):/);
    expect(sheetRule).toContain("position: relative;");
    expect(browserSmokeSource).not.toContain("style.height = '720px'");
    expect(listRule).toContain("align-items: stretch;");
    expect(itemRule).toContain("display: grid;");
    expect(itemRule).toContain("flex: 0 0 auto;");
    expect(itemRule).toContain("grid-template-columns: minmax(0, 1fr) 32px;");
    expect(itemRule).toContain("padding: 0;");
    expect(selectRule).toContain("display: flex;");
    expect(selectRule).toContain("flex-direction: column;");
    expect(selectRule).toContain("min-width: 0;");
    expect(deleteRule).toContain("height: 32px;");
    expect(deleteRule).toContain("width: 32px;");
    expect(deleteRule).toContain("padding: 0;");
    expect(deleteFeedbackRule).toContain("background: #fff3f1;");
    expect(confirmRule).toContain("max-width: 440px;");
    expect(dangerRule).toContain("min-height: 32px;");
    expect(dangerRule).toContain("padding: 5px 11px;");
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
    const clockRule = getRuleBody([".audio-review-clock"]);
    const scrubberRule = getRuleBody([".audio-review-scrubber"]);
    const webkitTrackRule = getRuleBody([".audio-review-scrubber::-webkit-slider-runnable-track"]);
    const webkitThumbRule = getRuleBody([".audio-review-scrubber::-webkit-slider-thumb"]);

    expect(transcriptReviewPanelTsx).not.toContain('className="audio-review-actions"');
    expect(transcriptReviewPanelTsx).not.toContain('className="audio-review-timeline"');
    expect(transcriptReviewPanelTsx).toMatch(
      /className="audio-review-bar"[\s\S]*?<button[\s\S]*?<\/button>\s*<input[\s\S]*?className="audio-review-scrubber"[\s\S]*?\/>\s*<div className="audio-review-clock">/,
    );
    expect(transcriptReviewPanelTsx).toContain("transcriptAudioScrubberStyle");
    expect(transcriptReviewSessionTs).toContain("--audio-progress");
    expect(barRule).toContain("grid-template-columns: 32px minmax(0, 1fr) max-content;");
    expect(barRule).toContain("align-items: center;");
    expect(barRule).toContain("column-gap: 14px;");
    expect(barRule).toContain("min-height: 72px;");
    expect(barRule).toContain("padding: 22px 0 18px;");
    expect(barRule).toContain("border: 0;");
    expect(barRule).toContain("box-shadow: none;");
    expect(playButtonRule).toContain("height: 32px;");
    expect(playButtonRule).toContain("width: 32px;");
    expect(playButtonRule).not.toContain("transform");
    expect(scrubberRule).toContain("display: block;");
    expect(scrubberRule).toContain("min-width: 0;");
    expect(scrubberRule).toContain("align-self: center;");
    expect(clockRule).toContain("justify-self: end;");
    expect(clockRule).toContain("min-width: 0;");
    expect(clockRule).toContain("font-variant-numeric: tabular-nums;");
    expect(clockRule).toContain("line-height: 1;");
    expect(clockRule).not.toContain("min-width: 126px;");
    expect(clockRule).toContain("font-size: 12px;");
    expect(clockRule).toContain("font-weight: 500;");
    expect(scrubberRule).toContain("appearance: none;");
    expect(webkitTrackRule).toContain("#3785ca");
    expect(webkitTrackRule).toContain("height: 4px;");
    expect(webkitThumbRule).toContain("background: #3785ca;");
    expect(webkitThumbRule).toContain("height: 12px;");
    expect(webkitThumbRule).toContain("width: 12px;");
    expect(webkitThumbRule).toContain("margin-top: -4px;");
  });

  test("keeps the compact transcript edit control available on hover and keyboard focus", () => {
    const editRule = getRuleBody([".transcript-segment-edit"]);
    const editFeedbackRule = getRuleBody([
      ".transcript-segment-edit:not(:disabled):hover",
      ".transcript-segment-edit:focus-visible",
    ]);

    expect(transcriptReviewPanelTsx).toContain(
      'className="secondary-button compact-button transcript-segment-edit"',
    );
    expect(transcriptReviewPanelTsx).toContain('aria-label={t("review.editSegment")}');
    expect(transcriptReviewPanelTsx).toContain('title={t("review.edit")}');
    expect(editRule).toContain("height: 24px;");
    expect(editRule).toContain("min-height: 24px;");
    expect(editRule).toContain("width: 24px;");
    expect(editRule).toContain("min-width: 24px;");
    expect(editRule).toContain("opacity: 0;");
    expect(editRule).toContain("padding: 0;");
    expect(editRule).toContain("align-items: center;");
    expect(editRule).toContain("justify-content: center;");
    expect(editFeedbackRule).toContain("background: #e7eddf;");
    expect(getRuleBody([
      ".transcript-segment:hover .transcript-segment-edit",
      ".transcript-segment:focus-within .transcript-segment-edit",
      ".transcript-segment.editing .transcript-segment-edit",
    ])).toContain("opacity: 1;");
  });

  test("keeps playback, editing, and keyboard focus visually distinct", () => {
    const activeRule = getRuleBody([".transcript-segment.active"]);
    const editingRule = getRuleBody([".transcript-segment.editing"]);

    expect(activeRule).toContain("background: #f1f7fd;");
    expect(activeRule).toContain("box-shadow: inset 2px 0 0 #83b4e6;");
    expect(activeRule).not.toContain("0 0 0 3px");
    expect(editingRule).toContain("background: #fff;");
    expect(editingRule).toContain("box-shadow: none;");
    expect(appCss).toContain(":focus-visible");
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
    expect(layoutRule).toContain("grid-template-columns: 160px minmax(0, 1fr);");
    expect(navRule).toContain("border-right: 1px solid var(--border);");
    expect(navItemRule).toContain("box-shadow: none;");
    expect(navItemRule).toContain("display: flex;");
    expect(navItemRule).toContain("flex-direction: column;");
    expect(navItemRule).toContain("min-height: 44px;");
    expect(navItemRule).toContain("justify-content: center;");
    expect(navItemRule).toContain("padding: 8px 10px;");
    expect(navItemRule).toContain("align-items: flex-start;");
    expect(selectedNavItemRule).toContain("background: #fff;");
    expect(sectionsRule).toContain("overflow: auto;");
    expect(privacyCalloutRule).not.toContain("background:");
    expect(privacyCalloutRule).toContain("color: var(--text-muted);");
    expect(statusCardRule).toContain("border-bottom: 1px solid var(--border);");
    expect(summaryListRule).toContain("display: grid;");
    expect(inspirationActionsRule).toContain("align-items: center;");
    expect(inspirationActionsRule).toContain("justify-content: flex-start;");
    expect(profileEditButtonRule).toContain("width: auto;");
    expect(profileEditButtonRule).toContain("min-height: 32px;");
    expect(inspirationActionsRule).toContain("display: flex;");
    expect(inspirationActionsRule).toContain("flex-wrap: wrap;");
    expect(profileClearButtonRule).toContain(
      "background: transparent;",
    );
    expect(profileClearButtonRule).toContain("border-color: var(--border);");
    expect(profileClearButtonRule).toContain("color: #34363b;");
    expect(profileClearButtonRule).toContain("min-height: 32px;");
  });

  test("scopes the compact local settings notice to the basic category", () => {
    const basicNoticeRule = getRuleBody([".settings-basic-note"]);

    expect(settingsSheetTsx.match(/className="settings-basic-note"/g)).toHaveLength(1);
    // The notice lives inside the basic render helper, and that helper is the
    // only thing the basic branch calls, so it cannot leak into other tabs.
    expect(settingsSheetTsx).toMatch(/settingsCategory === "basic" \? renderBasicSection\(\)/);
    expect(settingsSheetTsx).toMatch(
      /function renderBasicSection\(\)[\s\S]*?className="settings-basic-note"[\s\S]*?id="settings-basic"/,
    );
    expect(settingsSheetTsx).toContain('tSettings("basic.privacy")');
    expect(settingsSheetTsx).not.toContain(
      "AI 结果 LLM 由管理员在服务端统一配置，客户端无需手动填写 API Key。",
    );
    expect(basicNoticeRule).toContain("display: flex;");
    expect(basicNoticeRule).toContain("color: var(--text-muted);");
    expect(basicNoticeRule).not.toContain("background");
    expect(basicNoticeRule).not.toContain("border:");
  });
});
