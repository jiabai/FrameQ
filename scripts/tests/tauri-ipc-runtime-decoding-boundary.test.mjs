import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const clients = [
  {
    path: "app/src/accountClient.ts",
    runners: ["AccountCommandRunner"],
    errorCode: "ACCOUNT_IPC_RESPONSE_INVALID",
  },
  {
    path: "app/src/historyClient.ts",
    runners: ["HistoryCommandRunner"],
    errorCode: "HISTORY_IPC_RESPONSE_INVALID",
  },
  {
    path: "app/src/settingsClient.ts",
    runners: ["SettingsCommandRunner"],
    errorCode: "SETTINGS_IPC_RESPONSE_INVALID",
  },
  {
    path: "app/src/transcriptDetailClient.ts",
    runners: ["TranscriptDetailCommandRunner"],
    errorCode: "TRANSCRIPT_IPC_RESPONSE_INVALID",
  },
  {
    path: "app/src/updateClient.ts",
    runners: ["UpdateDeliveryRunner", "UpdatePreferencesCommandRunner"],
    errorCode: "UPDATE_IPC_RESPONSE_INVALID",
  },
];

test("reviewed Tauri clients decode unknown command results through domain boundaries", async () => {
  const violations = [];

  for (const client of clients) {
    const source = await readFile(resolve(repositoryRoot, client.path), "utf8");

    if (!source.includes("readIpcDataObject")) {
      violations.push(`${client.path}: missing shared safe data-object reader`);
    }
    if (!source.includes(client.errorCode)) {
      violations.push(`${client.path}: missing stable domain protocol code`);
    }
    if (/\binvoke\s*</u.test(source)) {
      violations.push(`${client.path}: generic invoke<T> bypasses runtime decoding`);
    }
    if (/\bas\s+(?:Partial<)?[A-Za-z0-9_]*(?:Response|View)>?/u.test(source)) {
      violations.push(`${client.path}: direct response assertion bypasses decoding`);
    }

    for (const runner of client.runners) {
      const declaration = new RegExp(
        `export\\s+type\\s+${runner}\\s*=[\\s\\S]*?Promise<unknown>`,
        "u",
      );
      if (!declaration.test(source)) {
        violations.push(`${client.path}: ${runner} must return Promise<unknown>`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Tauri IPC runtime-decoding boundary violations:\n${violations.join("\n")}`,
  );
});

test("the shared IPC primitive remains domain-free", async () => {
  const source = await readFile(
    resolve(repositoryRoot, "app/src/tauriIpcProtocol.ts"),
    "utf8",
  );

  for (const field of [
    "authenticated",
    "task_id",
    "output_dir",
    "segments",
    "postponedUntil",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`["']${field}["']`, "u"),
      `shared IPC primitive must not own domain field ${field}`,
    );
  }
  assert.doesNotMatch(source, /BaseClient|from\s+["']zod["']/u);
});
