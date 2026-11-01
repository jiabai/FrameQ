import { describe, expect, test } from "vitest";
import { parseNoteTitleMetadata } from "./noteTitle";

const completed = {
  text: "Understanding local-first notes",
  status: "completed",
  output_language: "en-US",
  error_code: null,
};

describe("persisted note title metadata", () => {
  test("accepts a completed title and a failed attempt retaining the previous title", () => {
    expect(parseNoteTitleMetadata(completed)).toEqual(completed);
    expect(parseNoteTitleMetadata({ ...completed, status: "failed", error_code: "TITLE_OUTPUT_INVALID" }))
      .toEqual({ ...completed, status: "failed", error_code: "TITLE_OUTPUT_INVALID" });
    expect(parseNoteTitleMetadata(null)).toBeNull();
  });

  test.each(["", " leading", "trailing ", "two\nlines", "a\u200bb", "a\u2028b", "a".repeat(61)])(
    "rejects unsafe or invalid title text %j", (text) => {
      expect(() => parseNoteTitleMetadata({ ...completed, text })).toThrow("HISTORY_IPC_RESPONSE_INVALID");
    },
  );

  test("counts Unicode codepoints and enforces closed coherent metadata", () => {
    expect(parseNoteTitleMetadata({ ...completed, text: "😀".repeat(60) })?.text).toHaveLength(120);
    for (const value of [
      { ...completed, text: null }, { ...completed, error_code: "TITLE_SAVE_FAILED" },
      { ...completed, status: "failed" }, { ...completed, status: "cancelled", error_code: "unsafe code" },
      { ...completed, output_language: "fr-FR" }, { ...completed, extra: true }, undefined,
    ]) expect(() => parseNoteTitleMetadata(value)).toThrow("HISTORY_IPC_RESPONSE_INVALID");
  });

  test("rejects accessors without evaluating them", () => {
    let accessed = false;
    const value = { ...completed, get text() { accessed = true; return "private"; } };
    expect(() => parseNoteTitleMetadata(value)).toThrow("HISTORY_IPC_RESPONSE_INVALID");
    expect(accessed).toBe(false);
  });
});
