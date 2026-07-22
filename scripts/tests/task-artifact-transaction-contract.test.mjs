import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function read(relativePath) {
  return readFile(resolve(repositoryRoot, relativePath), "utf8");
}

test("transaction contract is closed and mirrored by Python and Rust", async () => {
  const contract = JSON.parse(
    await read("contracts/task-artifact-transaction-v1.json"),
  );
  const python = await read("worker/frameq_worker/task_transaction.py");
  const rust = await read("app/src-tauri/src/task_manifest/transaction.rs");

  assert.equal(contract.contractVersion, 1);
  assert.equal(contract.journal.additionalProperties, false);
  assert.equal(contract.entry.additionalProperties, false);
  assert.deepEqual(contract.journal.states, ["prepared", "committed"]);
  assert.equal(contract.validFixtures.length, 2);
  assert.ok(contract.invalidFixtures.length >= 5);

  for (const value of [
    contract.journalFileName,
    ...contract.allowedDestinations,
    ...contract.journal.requiredFields,
    ...contract.entry.requiredFields,
  ]) {
    assert.ok(python.includes(value), `Python transaction owner is missing ${value}`);
    assert.ok(rust.includes(value), `Rust transaction owner is missing ${value}`);
  }
});
