// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import structured from "./articleExtraction/fixtures/structured.html?raw";
import { extractArticle } from "./articleExtraction/extractArticle";
import { normalizeWebPageInput, classifyTaskUrl, parseWebPageSource, hasSourceText, closedWebOperationError } from "./webPageProtocol";
import { parseWorkerResult } from "./workerResultProtocol";
import { createInitialWorkflow, summarizeWorkerResult, startInsightRetry, finishInsightRetry } from "./workflowState";
import { createTaskWorkspaceViewModel } from "./taskWorkspaceViewModel";
import { createGuestAccountStatus } from "./accountState";
import { MarkdownContent } from "./features/results/MarkdownContent";
import { articleSourceRanges } from "./features/articles/articleSourceRanges";
import { collectionNoteCreationReducer, createCollectionNoteCreation } from "./features/collections/collectionNoteCreation";
import { getHistoryTitle } from "./features/shell/shellNavigation";
import { safeNoteSource } from "./noteActionsClient";
import { shouldGenerateNoteTitle } from "./features/workflow/noteTitleSubmission";
import { parseHistoryDetailResponse } from "./historyClient";
import { readFileSync } from "node:fs";

function extractedResult() {
  const document = new DOMParser().parseFromString(structured, "text/html");
  const article = extractArticle(document, "https://example.com/articles/current?id=5&token=secret#fragment");
  const source = { kind: "web_page" as const, url: article.sourceUrl, title: article.title, extractedAt: new Date().toISOString() };
  return {
    status: "completed" as const, task_id: "article-source-contract", task_dir: "outputs/tasks/article-source-contract",
    artifacts: { article_txt: "article/article.txt", article_md: "article/article.md" },
    source, markdown: article.markdown, text: article.text, summary: "", insights: [], transcript: null,
    dissection: null, dissection_source_status: null, draft: "", error: null, note_title: null, task_created: true,
  };
}

describe("web article projection from real Document extraction", () => {
  it.runIf(Boolean(process.env.FRAMEQ_WEB_HISTORY_DETAIL))("reopens a real Python draft failure through the Rust history projection", () => {
    const actual = JSON.parse(readFileSync(process.env.FRAMEQ_WEB_HISTORY_DETAIL!, "utf8"));
    const detail = parseHistoryDetailResponse(actual, actual.task_id);
    expect(detail.error?.stage).toBe("draft_generating");
    expect(detail.error?.code).toBe("DRAFT_SEED_INVALID");
    expect(detail.source.kind).toBe("web_page");
    expect(detail.text.endsWith("\r\n")).toBe(true);
    expect(detail.markdown).toContain("## 正文结构");
    expect(detail.transcript).toBeNull();
  });
  it("validates canonical source metadata and allows query data only in the input", () => {
    const result = extractedResult();
    expect(parseWebPageSource(result.source)).toEqual(result.source);
    expect(safeNoteSource(result.source)).toBe("https://example.com/articles/current?id=5");
    expect(normalizeWebPageInput("https://example.com/articles/current?token=secret")).toContain("token=secret");
    expect(classifyTaskUrl("https://www.youtube.com/watch?v=abcdefghijk")?.kind).toBe("media");
    expect(classifyTaskUrl("https://xhslink.cn/o/5Sr07UUGn54")?.kind).toBe("media");
    expect(classifyTaskUrl("https://example.com/articles/current")?.kind).toBe("web_page");
    expect(classifyTaskUrl("Read https://example.com/articles/current")).toBeNull();
    expect(parseWebPageSource({ ...result.source, url: "https://example.com/articles/current?token=secret" })).toBeNull();
    for (const url of ["http://127.0.0.1/page", "http://[::1]/page", "http://192.168.1.1/", "https://user:password@example.com/", "https://example.com:8080/"]) {
      expect(normalizeWebPageInput(url)).toBeNull();
    }
  });

  it("reopens extracted titles containing Unicode joining characters", () => {
    const document = new DOMParser().parseFromString(structured, "text/html");
    const title = "نوشته\u200cهای فارسی 👩\u200d💻";
    document.querySelector("h1")!.textContent = title;
    const article = extractArticle(document, "https://example.com/articles/current");
    const source = { kind: "web_page", url: article.sourceUrl, title: article.title, extractedAt: new Date().toISOString() };
    expect(article.title).toBe(title);
    expect(parseWebPageSource(source)).toEqual(source);
  });

  it("preserves article ownership across AI retries and admits the saved text to all AI targets", () => {
    const result = parseWorkerResult(extractedResult())!;
    expect(result).not.toBeNull();
    const workflow = summarizeWorkerResult(result);
    expect(hasSourceText(workflow)).toBe(true);
    const model = createTaskWorkspaceViewModel(workflow, createGuestAccountStatus());
    expect(model.local.phase).toBe("ready");
    expect(model.ai.summary.status).toBe("available");
    expect(model.ai.dissection.status).toBe("available");
    expect(model.ai.insights.status).toBe("available");
    expect(shouldGenerateNoteTitle(result)).toBe(false);
    const next = finishInsightRetry(startInsightRetry(workflow, "summary"), { ...result, summary: "# Article summary" }, "summary");
    expect(next.taskSource).toEqual(result.source);
    expect(next.markdown).toBe(result.markdown);
    expect(next.transcript).toBeNull();
    expect(createInitialWorkflow().markdown).toBe("");
    expect(getHistoryTitle({ taskId: "article-source-contract", source: result.source!, textPreview: result.text })).toBe(result.source!.title);
  });

  it("keeps media artifacts outside the article result and requires both formal article paths", () => {
    const result = extractedResult();
    expect(parseWorkerResult({ ...result, artifacts: { ...result.artifacts, transcript_txt: "transcript/transcript.txt" } })).toBeNull();
    expect(parseWorkerResult({ ...result, artifacts: { article_txt: "article/article.txt" } })).toBeNull();
    expect(parseWorkerResult({ ...result, source: null })).toBeNull();
    let state = collectionNoteCreationReducer(createCollectionNoteCreation(), { type: "begin", collectionId: "research" });
    state = collectionNoteCreationReducer(state, { type: "local_completed", intentId: state.intentId, result });
    expect(state.phase).toBe("attaching");
    const detail = { task_id: result.task_id, source: result.source, status: result.status, task_dir: result.task_dir, artifacts: result.artifacts,
      error: null, text: result.text, markdown: result.markdown, summary: "", transcript: null, insights: [], dissection: null, dissection_source_status: null };
    expect(parseHistoryDetailResponse(detail, result.task_id).markdown).toBe(result.markdown);
    expect(() => parseHistoryDetailResponse({ ...detail, artifacts: { ...detail.artifacts, audio: "media/audio.wav" } }, result.task_id)).toThrow();
    expect(() => parseHistoryDetailResponse({ ...detail, markdown: undefined }, result.task_id)).toThrow();
  });

  it("renders safe formatted text without fetching images or executing HTML", () => {
    const result = extractedResult();
    const markup = renderToStaticMarkup(<MarkdownContent markdown={`${result.markdown}\n\n![tracking](https://example.com/pixel.png)\n\n<script>window.secret()</script>`} emptyText="" />);
    expect(markup).toContain("<table>");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<script");
    expect(markup).toContain("tracking");
  });

  it("highlights validated UTF-8 article bytes independently of Markdown offsets", async () => {
    const result = extractedResult();
    const bytes = new TextEncoder().encode(result.text);
    const digest = async (value: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const report = {
      schemaVersion: 2 as const, sourceKind: "article" as const, sourceTextSha256: await digest(bytes),
      sourceLanguage: "en", sourceChunks: [{ id: 1, startByte: 0, endByte: bytes.length, sha256: await digest(bytes) }],
      overallNarrative: { openingHook: null, structureType: "article", turningPoint: null, closingType: null },
      segments: [], highlights: [], reusableTemplate: { name: "article", skeleton: [] }, audienceFit: [], strengths: [], weaknesses: [],
    };
    const ranges = await articleSourceRanges(result.text, report, [1]);
    expect(ranges.filter((range) => range.highlighted).map((range) => range.text).join("")).toBe(result.text);
    await expect(articleSourceRanges(`${result.text}\n`, report, [1])).rejects.toThrow("ARTICLE_SOURCE_STALE");
    await expect(articleSourceRanges(result.text, report, [2])).rejects.toThrow("ARTICLE_SOURCE_INVALID");
    const completeReport = { ...report, reusableTemplate: { name: result.source.title, skeleton: result.text.split("\n\n").slice(0, 3) }, segments: [{ id: 1, title: result.source.title, sourceChunkIds: [1], coreClaim: result.text, supportingPoints: [], rhetoricalDevices: [], rhythmNote: result.source.title, reusablePattern: result.source.title, riskFlags: [] }] };
    expect(parseWorkerResult({ ...result, dissection: completeReport })?.dissection?.schemaVersion).toBe(2);
    expect(parseWorkerResult({ ...result, dissection: { ...completeReport, sourceKind: "transcript" } })).toBeNull();
  });

  it("accepts closed operation errors and rejects private diagnostic text", () => {
    expect(closedWebOperationError("WEB_CANCELLED")).toBe("WEB_CANCELLED");
    expect(closedWebOperationError("WEB_TIMEOUT")).toBe("WEB_TIMEOUT");
    expect(closedWebOperationError("https://example.com/?token=secret")).toBeNull();
    expect(closedWebOperationError("D:\\FrameQ\\private")).toBeNull();
  });
});
