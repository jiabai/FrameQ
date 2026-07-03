import { describe, expect, test } from "vitest";
import {
  findActiveTranscriptSegmentId,
  isTranscriptSegmentEditDisabled,
  transcriptTextFromSegments,
  updateTranscriptSegmentText,
} from "./transcriptReviewState";
import type { TranscriptSegment } from "./transcriptDetailClient";

const segments: TranscriptSegment[] = [
  { id: "seg-0001", start_ms: 0, end_ms: 1000, text: "first", speaker: "solo" },
  { id: "seg-0002", start_ms: 1000, end_ms: 2500, text: "second" },
];

describe("transcript review state", () => {
  test("finds the active segment by time without using speaker metadata", () => {
    expect(findActiveTranscriptSegmentId(segments, 0.4)).toBe("seg-0001");
    expect(findActiveTranscriptSegmentId(segments, 1.2)).toBe("seg-0002");
    expect(findActiveTranscriptSegmentId(segments, 2.5)).toBe("seg-0002");
    expect(findActiveTranscriptSegmentId(segments, 3)).toBeNull();
  });

  test("updates one segment and flattens edited transcript text", () => {
    const updated = updateTranscriptSegmentText(segments, "seg-0002", "corrected");

    expect(updated[0]).toEqual(segments[0]);
    expect(updated[1].text).toBe("corrected");
    expect(transcriptTextFromSegments(updated)).toBe("first\n\ncorrected");
  });

  test("locks editing to the active segment while another segment is being edited", () => {
    expect(isTranscriptSegmentEditDisabled(null, "seg-0001")).toBe(false);
    expect(isTranscriptSegmentEditDisabled("seg-0001", "seg-0001")).toBe(false);
    expect(isTranscriptSegmentEditDisabled("seg-0001", "seg-0002")).toBe(true);
  });
});
