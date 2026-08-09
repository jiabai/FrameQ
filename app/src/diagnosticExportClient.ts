import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";

import { readIpcDataObject } from "./tauriIpcProtocol";

export type DiagnosticExportResult =
  | { status: "exported" }
  | { status: "cancelled" }
  | { status: "failed"; code: "DIAGNOSTIC_EXPORT_FAILED" };

export type DiagnosticExportCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<unknown>;

const FAILED_RESULT: DiagnosticExportResult = Object.freeze({
  status: "failed",
  code: "DIAGNOSTIC_EXPORT_FAILED",
});

const defaultRunner: DiagnosticExportCommandRunner = (command, args) =>
  invoke(command, args);

export async function exportDiagnostics(
  runner: DiagnosticExportCommandRunner = defaultRunner,
): Promise<DiagnosticExportResult> {
  try {
    return decodeDiagnosticExportResult(
      await runner("export_diagnostics", {}),
    );
  } catch {
    return FAILED_RESULT;
  }
}

function decodeDiagnosticExportResult(value: unknown): DiagnosticExportResult {
  const statusOnly = tryReadExactObject(value, ["status"]);
  if (statusOnly?.status === "exported") {
    return { status: "exported" };
  }
  if (statusOnly?.status === "cancelled") {
    return { status: "cancelled" };
  }

  const failed = tryReadExactObject(value, ["status", "code"]);
  if (
    failed?.status === "failed" &&
    failed.code === "DIAGNOSTIC_EXPORT_FAILED"
  ) {
    return FAILED_RESULT;
  }

  return FAILED_RESULT;
}

function tryReadExactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  try {
    return readIpcDataObject(
      value,
      keys,
      [],
      "SETTINGS_IPC_RESPONSE_INVALID",
    );
  } catch {
    return null;
  }
}
