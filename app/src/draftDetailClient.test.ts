import { describe, expect, test } from "vitest";
import {
  loadDraftDetail,
  saveDraftEdit,
  type DraftDetailCommandRunner,
  type DraftDetailResponse,
  type SaveDraftEditResponse,
} from "./draftDetailClient";

describe("draft detail client", () => {
  test("loadDraftDetail passes correct command name and request shape", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: DraftDetailCommandRunner<DraftDetailResponse> = async (
      command,
      args,
    ) => {
      calls.push({ command, args });
      return {
        task_id: "t1",
        markdown: "# hello",
        has_original_backup: false,
        draft_seed_insight_id: null,
      };
    };

    const detail = await loadDraftDetail("t1", runner);

    expect(detail.task_id).toBe("t1");
    expect(detail.markdown).toBe("# hello");
    expect(detail.draft_seed_insight_id).toBeNull();
    expect(detail.has_original_backup).toBe(false);
    expect(calls).toEqual([
      {
        command: "load_draft_detail",
        args: {
          request: {
            task_id: "t1",
          },
        },
      },
    ]);
  });

  test("saveDraftEdit passes correct command name and request shape with markdown", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: DraftDetailCommandRunner<SaveDraftEditResponse> = async (
      command,
      args,
    ) => {
      calls.push({ command, args });
      return {
        task_id: "t1",
        markdown: "# hi",
        artifacts: {
          draft: "draft/draft.md",
          summary: "summary/summary.md",
        },
        has_original_backup: true,
      };
    };

    const result = await saveDraftEdit("t1", "# hi", runner);

    expect(result.task_id).toBe("t1");
    expect(result.markdown).toBe("# hi");
    expect(result.has_original_backup).toBe(true);
    expect(result.artifacts).toEqual({
      draft: "draft/draft.md",
      summary: "summary/summary.md",
    });
    expect(calls).toEqual([
      {
        command: "save_draft_edit",
        args: {
          request: {
            task_id: "t1",
            markdown: "# hi",
          },
        },
      },
    ]);
  });
});
