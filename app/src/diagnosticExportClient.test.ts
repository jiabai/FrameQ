import { describe, expect, test, vi } from "vitest";

import { exportDiagnostics, type DiagnosticExportCommandRunner } from "./diagnosticExportClient";

describe("exportDiagnostics", () => {
  test.each([
    [{ status: "exported" }, { status: "exported" }],
    [{ status: "cancelled" }, { status: "cancelled" }],
    [
      { status: "failed", code: "DIAGNOSTIC_EXPORT_FAILED" },
      { status: "failed", code: "DIAGNOSTIC_EXPORT_FAILED" },
    ],
  ] as const)("accepts the exact closed response %#", async (wire, expected) => {
    const runner = vi.fn<DiagnosticExportCommandRunner>().mockResolvedValue(wire);

    await expect(exportDiagnostics(runner)).resolves.toEqual(expected);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith("export_diagnostics", {});
    expect(Object.keys(runner.mock.calls[0][1])).toEqual([]);
  });

  test.each([
    null,
    undefined,
    "exported",
    1,
    [],
    {},
    { status: null },
    { status: "unknown" },
    { status: "exported", code: "DIAGNOSTIC_EXPORT_FAILED" },
    { status: "exported", path: "C:/Users/private/diagnostics.zip" },
    { status: "cancelled", content: "private-log" },
    { status: "failed" },
    { status: "failed", code: null },
    { status: "failed", code: "OTHER" },
    { status: "failed", code: "DIAGNOSTIC_EXPORT_FAILED", url: "https://private" },
  ])("maps malformed response %# to the fixed failed result", async (wire) => {
    const runner = vi.fn<DiagnosticExportCommandRunner>().mockResolvedValue(wire);

    await expect(exportDiagnostics(runner)).resolves.toEqual({
      status: "failed",
      code: "DIAGNOSTIC_EXPORT_FAILED",
    });
  });

  test("rejects symbols and accessor properties without reading or exposing them", async () => {
    const secret = "C:/Users/private/diagnostics.zip";
    const getter = vi.fn(() => {
      throw new Error(secret);
    });
    const accessor = Object.defineProperty({}, "status", { enumerable: true, get: getter });
    const symbol = { status: "exported", [Symbol("private")]: secret };

    for (const wire of [accessor, symbol]) {
      const runner = vi.fn<DiagnosticExportCommandRunner>().mockResolvedValue(wire);
      const result = await exportDiagnostics(runner);
      expect(result).toEqual({
        status: "failed",
        code: "DIAGNOSTIC_EXPORT_FAILED",
      });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  test("maps invoke rejection to the same fixed failed result", async () => {
    const secret = "Authorization: Bearer private-token";
    const runner = vi
      .fn<DiagnosticExportCommandRunner>()
      .mockRejectedValue(new Error(secret));

    const result = await exportDiagnostics(runner);

    expect(result).toEqual({
      status: "failed",
      code: "DIAGNOSTIC_EXPORT_FAILED",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
