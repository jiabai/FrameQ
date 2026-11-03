import { safeArticleUrl } from "./articleExtraction/safeUrl";
import { readIpcDataObject } from "./tauriIpcProtocol";
import { normalizeSubmitUrl } from "./urlSupport";

export type WebPageSource = { kind: "web_page"; url: string; title: string; extractedAt: string };
const WEB_OPERATION_ERRORS = new Set([
  "WEB_REQUEST_INVALID", "WEB_PRIVATE_ADDRESS", "WEB_PLATFORM_UNSUPPORTED",
  "WEB_PROTOCOL_INVALID", "WEB_HOST_FAILED", "WEB_RUNTIME_MISSING", "WEB_RUNTIME_UNSUPPORTED", "WEB_RUNTIME_UNSAFE_CONFIGURATION",
  "WEB_PREPARE_TIMEOUT", "WEB_NETWORK_POLICY_TIMEOUT", "WEB_URL_BLOCKED", "WEB_NAVIGATION_FAILED", "WEB_NAVIGATION_TIMEOUT",
  "WEB_EXTRACTION_FAILED", "WEB_EXTRACTION_TIMEOUT", "WEB_PROCESS_FAILED", "WEB_CLEANUP_FAILED",
  "WEB_LOAD_FAILED", "WEB_BROWSER_FAILED", "WEB_TIMEOUT", "WEB_RESOURCE_LIMIT", "WEB_CANCELLED", "WEB_STORAGE_FAILED", "WEB_ALREADY_RUNNING",
  "WEB_PAGE_NETWORK_BLOCKED", "WEB_PAGE_RESOURCE_LIMIT", "WEB_PAGE_ACCESS_RESTRICTED", "WEB_PAGE_HTTP_FAILED", "WEB_PAGE_CONTENT_TYPE_INVALID", "WEB_PAGE_DOM_LIMIT",
  "WEB_PAGE_SOURCE_CHANGED", "WEB_PAGE_CONTENT_UNSTABLE", "WEB_PAGE_COMPONENT_INVALID", "WEB_PAGE_STORAGE_INVALID", "WEB_PAGE_TIMEOUT", "WEB_PAGE_REQUEST_OR_STORAGE_INVALID", "WEB_PAGE_LOAD_FAILED",
]);

export function closedWebOperationError(value: unknown): string | null {
  return typeof value === "string" && WEB_OPERATION_ERRORS.has(value) ? value : null;
}

export function normalizeWebPageInput(value: string): string | null {
  const input = value.trim();
  try { safeArticleUrl(input); return input; } catch { return null; }
}

export function classifyTaskUrl(value: string): { kind: "media" | "web_page"; url: string } | null {
  const media = normalizeSubmitUrl(value);
  if (media) return { kind: "media", url: media };
  const web = normalizeWebPageInput(value);
  return web ? { kind: "web_page", url: web } : null;
}

export function isArticleTaskSource(source: { kind: string; url?: string } | null): boolean {
  return source?.kind === "web_page" || Boolean(source?.kind === "url" && source.url && classifyTaskUrl(source.url)?.kind === "web_page");
}

export function parseWebPageSource(value: unknown): WebPageSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  let source: Record<string, unknown>;
  try { source = readIpcDataObject(value, ["kind", "url", "title", "extractedAt"], [], "WEB_PAGE_PROTOCOL_INVALID"); }
  catch { return null; }
  if (Object.keys(source).length !== 4 || source.kind !== "web_page" ||
    typeof source.url !== "string" || typeof source.title !== "string" ||
    !source.title.trim() || Array.from(source.title).length > 512 ||
    /[\p{Cc}\p{Cs}]/u.test(source.title) ||
    typeof source.extractedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(source.extractedAt) ||
    !Number.isFinite(Date.parse(source.extractedAt))) return null;
  try { if (safeArticleUrl(source.url) !== source.url) return null; } catch { return null; }
  return source as WebPageSource;
}

export function hasSourceText(value: { taskId: string | null; text: string; artifacts: { transcript_txt?: string; article_txt?: string } }): boolean {
  return Boolean(value.taskId && value.text.trim() && (value.artifacts.article_txt || value.artifacts.transcript_txt));
}
