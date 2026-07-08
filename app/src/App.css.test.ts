import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf-8");
const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf-8");

function getRuleBody(selectors: string[]): string {
  const selectorPattern = selectors
    .map((selector) => selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*,\\s*");
  const match = appCss.match(new RegExp(`${selectorPattern}\\s*\\{(?<body>[\\s\\S]*?)\\}`));
  return match?.groups?.body ?? "";
}

describe("App result workspace layout styles", () => {
  test("stacks the header, error message, and result cards in normal vertical flow", () => {
    const baseResultAreaRule = getRuleBody([".result-workspace", ".result-area"]);
    const activeResultAreaRule = getRuleBody([
      ".workspace.active-layout .result-workspace",
      ".workspace.active-layout .result-area",
    ]);

    expect(baseResultAreaRule).toContain("display: flex;");
    expect(baseResultAreaRule).toContain("flex-direction: column;");
    expect(activeResultAreaRule).not.toContain("grid-template-rows");
  });

  test("keeps the desktop surfaces on a macOS-like layered visual system", () => {
    const rootRule = getRuleBody([":root"]);
    const toolbarRule = getRuleBody([".app-toolbar", ".topbar"]);
    const panelRule = getRuleBody([
      ".command-panel",
      ".process-monitor",
      ".result-workspace",
      ".input-pane",
      ".process-pane",
      ".result-area",
    ]);
    const resultCardHoverRule = getRuleBody([".result-card:hover"]);

    expect(rootRule).toContain("--shadow-panel");
    expect(toolbarRule).toContain("saturate");
    expect(panelRule).toContain("var(--shadow-panel)");
    expect(panelRule).toContain("backdrop-filter");
    expect(resultCardHoverRule).toContain("translateY(-1px)");
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
    expect(appTsx).toContain("<span>取消任务</span>");
  });

  test("uses a custom compact audio review bar instead of the browser audio controls", () => {
    expect(appTsx).toContain('className="audio-review-bar"');
    expect(appTsx).toContain('className="transcript-audio-engine"');
    expect(appTsx).not.toContain('className="transcript-audio"');
    expect(appTsx).not.toContain("controls\n");
  });

  test("renders summary markdown through the markdown content component", () => {
    const markdownRule = getRuleBody([".markdown-content"]);
    const headingRule = getRuleBody([".markdown-content :is(h1, h2, h3, h4)"]);
    const tableRule = getRuleBody([".markdown-content table"]);

    expect(appTsx).toContain("MarkdownContent");
    expect(appTsx).toContain('markdown={workflow.summary}');
    expect(markdownRule).toContain("white-space: normal;");
    expect(markdownRule).toContain("overflow-wrap: anywhere;");
    expect(headingRule).toContain("line-height: 1.35;");
    expect(tableRule).toContain("overflow-x: auto;");
  });

  test("keeps the custom audio review bar quiet and compact", () => {
    const barRule = getRuleBody([".audio-review-bar"]);
    const controlRule = getRuleBody([".audio-play-button", ".audio-review-actions button"]);
    const playButtonRule = getRuleBody([".audio-play-button"]);
    const scrubberRule = getRuleBody([".audio-review-scrubber"]);
    const webkitTrackRule = getRuleBody([".audio-review-scrubber::-webkit-slider-runnable-track"]);
    const webkitThumbRule = getRuleBody([".audio-review-scrubber::-webkit-slider-thumb"]);

    expect(barRule).toContain("min-height: 40px;");
    expect(barRule).toContain("padding: 4px 8px;");
    expect(controlRule).toContain("box-shadow: none;");
    expect(controlRule).toContain("height: 28px;");
    expect(playButtonRule).toContain("width: 28px;");
    expect(scrubberRule).toContain("appearance: none;");
    expect(webkitTrackRule).toContain("height: 4px;");
    expect(webkitThumbRule).toContain("height: 10px;");
    expect(webkitThumbRule).toContain("width: 10px;");
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

    expect(appTsx).toContain('className="settings-layout"');
    expect(appTsx).toContain('className="settings-nav"');
    expect(appTsx).toContain('const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("basic")');
    expect(appTsx).toContain('data-settings-category={item.id}');
    expect(appTsx).toContain('id="settings-inspiration"');
    expect(appTsx).toContain('className="settings-summary-list"');
    expect(appTsx).toContain("profile-edit-button");
    expect(appTsx).toContain("profile-clear-button");
    expect(appTsx).toContain('settingsCategory === "inspiration"');
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
