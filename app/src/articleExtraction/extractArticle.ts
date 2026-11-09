/*
 * SPDX-License-Identifier: MIT
 * Adapted from InsightFlow readingSession.cjs:57-400 and useMarkdownConverter.ts.
 * Copyright (c) 2025 StandlX. See licenses/InsightFlow-MIT.txt.
 * Locus changes: explicit Document/URL, Readability-only generic extraction,
 * bounded input/output, DOMPurify, safe links, image removal and GFM tables.
 */
import { Readability } from "@mozilla/readability";
import createDOMPurify from "dompurify";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { matchesSiteRule, safeArticleUrl } from "./safeUrl";
import { SITE_RULES, type SiteRule } from "./siteRules";

export interface ExtractedArticle {
  title: string;
  text: string;
  markdown: string;
  sourceUrl: string;
}

export const EXTRACTION_LIMITS = Object.freeze({
  domNodes: 100_000,
  serializedBytes: 8 * 1024 * 1024,
  textBytes: 2 * 1024 * 1024,
  markdownBytes: 4 * 1024 * 1024,
  titleCharacters: 512,
  minimumTextCharacters: 50,
});

const removedTags = "script,style,noscript,iframe,svg,math,form,button,input,textarea,select,option,canvas,object,embed,video,audio,source,track,link,meta,base,template,dialog,nav,footer,aside,[hidden],[aria-hidden=true]";
const allowedTags = ["div", "section", "article", "main", "header", "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "del", "strike", "a", "ul", "ol", "li", "dl", "dt", "dd", "blockquote", "pre", "code", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "figure", "figcaption", "span", "sup", "sub", "kbd", "samp"];
const blockTags = new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "H1", "H2", "H3", "H4", "H5", "H6", "P", "HR", "UL", "OL", "DL", "DT", "DD", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "FIGURE", "FIGCAPTION", "CAPTION"]);

function fail(code: string): never {
  throw new Error(`article_extraction:${code}`);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validateUnicode(value: string): void {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) fail("invalid_unicode");
  }
}

function getPageTitle(doc: Document, rule?: SiteRule, readableTitle?: string | null): string {
  const element = (rule?.titleElem ? doc.querySelector(rule.titleElem) : null) || doc.querySelector("#activity-name") || doc.querySelector("h1");
  const value = (element?.textContent || readableTitle || doc.title || "").replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
  validateUnicode(value);
  const title = Array.from(value).slice(0, EXTRACTION_LIMITS.titleCharacters).join("");
  if (!title) fail("missing_title");
  return title;
}

function sanitizeClone(element: Element, rule?: SiteRule): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  for (const selector of [...(rule?.excludeElems ?? []), ...(rule?.ignoreElements ?? []), removedTags]) {
    clone.querySelectorAll(selector).forEach((node) => node.remove());
  }
  clone.querySelectorAll("img").forEach((image) => image.remove());
  return clone;
}

function pickBestElement(doc: Document, selectors: string, rule: SiteRule): Element | null {
  let best: Element | null = null;
  let bestLength = 0;
  for (const candidate of doc.querySelectorAll(selectors)) {
    const length = (sanitizeClone(candidate, rule).textContent || "").replace(/\s/gu, "").length;
    if (length > bestLength) {
      best = candidate;
      bestLength = length;
    }
  }
  return best;
}

function extractBySiteRule(doc: Document, rule?: SiteRule): HTMLElement | null {
  if (!rule?.contentElem) return null;
  const root = pickBestElement(doc, rule.contentElem, rule);
  if (!root) return null;
  const extracts = (rule.extractElems ?? []).flatMap((selector) => Array.from(root.querySelectorAll(selector)));
  if (!extracts.length) return sanitizeClone(root, rule);
  const wrapper = doc.createElement("div");
  extracts.forEach((element, index) => {
    if (index && rule.extractElemsJoiner) wrapper.append(doc.createElement("hr"));
    wrapper.append(sanitizeClone(element, rule));
  });
  return wrapper;
}

function sanitizeContent(root: HTMLElement, doc: Document, sourceUrl: string): HTMLElement {
  const targetWindow = doc.defaultView ?? globalThis.window;
  if (!targetWindow) fail("missing_window");
  const purifier = createDOMPurify(targetWindow);
  const fragment = purifier.sanitize(root, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ["href", "title", "colspan", "rowspan", "start", "class"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    SANITIZE_NAMED_PROPS: true,
    RETURN_DOM_FRAGMENT: true,
  });
  const clean = doc.createElement("div");
  clean.append(fragment);
  for (const element of clean.querySelectorAll("*")) {
    const language = element.tagName === "CODE" ? element.className.match(/(?:^|\s)language-([a-zA-Z0-9_+-]{1,40})(?:\s|$)/)?.[1] : undefined;
    element.removeAttribute("class");
    if (language) element.setAttribute("class", `language-${language}`);
    if (element.hasAttribute("title")) element.setAttribute("title", element.getAttribute("title")!.replace(/\p{Cc}/gu, " "));
    if (element.hasAttribute("href")) {
      if (element.tagName !== "A") {
        element.removeAttribute("href");
      } else {
        // Reject unsafe destinations locally while retaining readable link text.
        try {
          element.setAttribute("href", safeArticleUrl(element.getAttribute("href")!, sourceUrl));
        } catch {
          element.removeAttribute("href");
        }
      }
    }
  }
  return clean;
}

function textFromDocument(root: HTMLElement): string {
  const chunks: string[] = [];
  const segments: string[] = [];
  const flush = () => {
    segments.push(chunks.join("").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n"));
    chunks.length = 0;
  };
  const stack: { node: Node; exit: boolean }[] = [{ node: root, exit: false }];
  while (stack.length) {
    const { node, exit } = stack.pop()!;
    if (node.nodeType === 3) {
      chunks.push((node.textContent || "").replace(/[\t\n\r\f ]+/g, " "));
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as HTMLElement;
    const tag = element.tagName;
    if (tag === "PRE") {
      chunks.push("\n\n");
      flush();
      segments.push(element.textContent || "");
      chunks.push("\n\n");
      continue;
    }
    if (tag === "BR") {
      chunks.push("\n");
      continue;
    }
    if (blockTags.has(tag)) chunks.push("\n\n");
    if (tag === "LI") chunks.push(exit ? "\n" : "\n• ");
    if ((tag === "TD" || tag === "TH") && exit && element.nextElementSibling) chunks.push("\t");
    if (exit) continue;
    stack.push({ node, exit: true });
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push({ node: node.childNodes[index], exit: false });
  }
  flush();
  return segments.join("").trim();
}

function markdownFromDocument(root: HTMLElement): string {
  const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", preformattedCode: true });
  converter.use(gfm);
  const escape = converter.escape.bind(converter);
  converter.escape = (value) => escape(value).replace(/</g, "\\<").replace(/>/g, "\\>");
  // GFM has no caption element or headerless table syntax. Promote the first
  // row and keep the caption as a paragraph; all cell text remains present.
  for (const table of Array.from(root.querySelectorAll("table"))) {
    const caption = table.querySelector(":scope > caption");
    if (caption) {
      const paragraph = root.ownerDocument.createElement("p");
      paragraph.append(...Array.from(caption.childNodes));
      table.before(paragraph);
      caption.remove();
    }
    if (!table.rows.length) {
      table.remove();
      continue;
    }
    const firstRow = table.rows[0];
    for (const cell of Array.from(firstRow.cells)) {
      if (cell.tagName === "TH") continue;
      const heading = root.ownerDocument.createElement("th");
      heading.append(...Array.from(cell.childNodes));
      cell.replaceWith(heading);
    }
    for (const section of Array.from(table.querySelectorAll("thead,tbody,tfoot,tr"))) {
      for (const child of Array.from(section.childNodes)) if (child.nodeType === 3 && !child.textContent?.trim()) child.remove();
    }
  }
  converter.addRule("safeTableCell", {
    filter: ["td", "th"],
    replacement: (content, node) => `${node.previousElementSibling ? " " : "| "}${content.trim().replace(/\|/g, "\\|").replace(/\n+/g, " ")} |`,
  });
  return converter.turndown(root).trim();
}

export function extractArticle(document: Document, sourceUrl: string): ExtractedArticle {
  const canonicalUrl = safeArticleUrl(sourceUrl);
  if (!document.documentElement || !document.body) fail("no_document");
  const walker = document.createTreeWalker(document, 0xffffffff);
  let nodes = 0;
  while (walker.nextNode()) if (++nodes > EXTRACTION_LIMITS.domNodes) fail("dom_limit");
  if (byteLength(document.documentElement.outerHTML) > EXTRACTION_LIMITS.serializedBytes) fail("input_limit");
  const parsedUrl = new URL(canonicalUrl);
  const rule = Object.entries(SITE_RULES).find(([pattern]) => matchesSiteRule(parsedUrl, pattern))?.[1];
  if (rule?.readable === false) fail("unsupported_page");
  const clone = document.cloneNode(true) as Document;
  let extracted = extractBySiteRule(clone, rule);
  let readableTitle: string | null | undefined;
  if (!extracted) {
    clone.querySelectorAll(removedTags).forEach((node) => node.remove());
    const base = clone.createElement("base");
    base.href = canonicalUrl;
    clone.head.prepend(base);
    const readable = new Readability<HTMLElement>(clone, {
      maxElemsToParse: EXTRACTION_LIMITS.domNodes,
      charThreshold: EXTRACTION_LIMITS.minimumTextCharacters,
      keepClasses: true,
      disableJSONLD: true,
      serializer: (node) => node as HTMLElement,
    }).parse();
    if (!readable?.content) fail("no_article");
    readableTitle = readable.title;
    extracted = sanitizeClone(readable.content, rule);
  }
  const clean = sanitizeContent(extracted, document, canonicalUrl);
  const bodyText = textFromDocument(clean);
  if (Array.from(bodyText.replace(/\s/gu, "")).length < EXTRACTION_LIMITS.minimumTextCharacters) fail("no_article");
  if (byteLength(bodyText) > EXTRACTION_LIMITS.textBytes) fail("text_limit");
  const title = getPageTitle(document, rule, readableTitle);
  if (!(clean.textContent || "").includes(title)) {
    const heading = document.createElement("h1");
    heading.textContent = title;
    clean.prepend(heading);
  }
  const text = textFromDocument(clean);
  const markdown = markdownFromDocument(clean);
  validateUnicode(text);
  validateUnicode(markdown);
  if (byteLength(text) > EXTRACTION_LIMITS.textBytes) fail("text_limit");
  if (!markdown || byteLength(markdown) > EXTRACTION_LIMITS.markdownBytes) fail("markdown_limit");
  return { title, text, markdown, sourceUrl: canonicalUrl };
}
