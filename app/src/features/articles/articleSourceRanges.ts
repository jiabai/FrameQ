import type { TranscriptDissection } from "../../workflowState";

export async function articleSourceRanges(text: string, report: TranscriptDissection, ids: readonly number[]) {
  if (report.schemaVersion !== 2 || report.sourceKind !== "article") throw new Error("ARTICLE_SOURCE_INVALID");
  const bytes = new TextEncoder().encode(text);
  const digest = async (value: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (await digest(bytes) !== report.sourceTextSha256) throw new Error("ARTICLE_SOURCE_STALE");
  const selected = report.sourceChunks.filter((chunk) => ids.includes(chunk.id));
  if (!selected.length || ids.some((id) => !selected.some((chunk) => chunk.id === id))) throw new Error("ARTICLE_SOURCE_INVALID");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const ranges: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;
  for (const chunk of selected) {
    if (chunk.startByte < cursor || chunk.endByte > bytes.length) throw new Error("ARTICLE_SOURCE_INVALID");
    const excerpt = bytes.slice(chunk.startByte, chunk.endByte);
    if (await digest(excerpt) !== chunk.sha256) throw new Error("ARTICLE_SOURCE_STALE");
    ranges.push({ text: decoder.decode(bytes.slice(cursor, chunk.startByte)), highlighted: false });
    ranges.push({ text: decoder.decode(excerpt), highlighted: true });
    cursor = chunk.endByte;
  }
  ranges.push({ text: decoder.decode(bytes.slice(cursor)), highlighted: false });
  return ranges;
}
