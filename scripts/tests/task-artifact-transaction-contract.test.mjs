import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function read(relativePath) {
  return readFile(resolve(repositoryRoot, relativePath), "utf8");
}

// The worker (Python) writes the journal and the desktop (Rust) recovers it, so
// the two languages must accept the same closed destination set. Each language
// asserts equality against this contract in its own test suite; this file is the
// only one that sees all three, so it owns the contract's internal consistency.
test("transaction contract destinations are internally consistent", async () => {
  const contract = JSON.parse(
    await read("contracts/task-artifact-transaction-v1.json"),
  );

  const allowed = [...contract.allowedDestinations];
  const artifactKeys = Object.keys(contract.artifactKeysByDestination);
  const nonArtifact = [...contract.nonArtifactDestinations];

  assert.equal(
    new Set(allowed).size,
    allowed.length,
    "allowedDestinations must be unique",
  );

  // Every allowed destination is either an artifact with a manifest key or an
  // explicit non-artifact file; the two partitions must not overlap.
  const partitioned = new Set([...artifactKeys, ...nonArtifact]);
  assert.deepEqual(
    [...partitioned].sort(),
    [...allowed].sort(),
    "artifact keys + non-artifact destinations must reproduce allowedDestinations",
  );
  assert.equal(
    partitioned.size,
    artifactKeys.length + nonArtifact.length,
    "artifact keys and non-artifact destinations must not overlap",
  );

  // internalParents exists so both languages clean leftover staging files in
  // every directory a transaction can stage into.
  const parents = new Set(
    allowed.map((destination) => {
      const separator = destination.lastIndexOf("/");
      return separator === -1 ? "." : destination.slice(0, separator);
    }),
  );
  assert.deepEqual(
    [...contract.internalParents].sort(),
    [...parents].sort(),
    "internalParents must cover the parent of every allowed destination",
  );
});

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
    ...contract.internalParents,
    ...contract.journal.requiredFields,
    ...contract.entry.requiredFields,
  ]) {
    assert.ok(python.includes(value), `Python transaction owner is missing ${value}`);
    assert.ok(rust.includes(value), `Rust transaction owner is missing ${value}`);
  }

  // The destinations must be the same closed set in both languages, not merely
  // present somewhere in the file: a one-sided addition would otherwise slip
  // through as a substring.
  const block = (source, pattern, label) => {
    const match = source.match(pattern);
    assert.ok(match, `${label} literal was not found`);
    return match[1];
  };
  const stringsIn = (text) => [...text.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  const pythonAllowed = [
    ...[
      ...block(
        python,
        /MappingProxyType\(([\s\S]*?)\n\)/,
        "Python artifact mapping",
      ).matchAll(/"([^"]+)":\s*"[^"]+"/g),
    ].map((entry) => entry[1]),
    ...stringsIn(
      block(
        python,
        /_NON_ARTIFACT_DESTINATIONS = \(([\s\S]*?)\n\)/,
        "Python non-artifact",
      ),
    ),
    block(python, /_MANIFEST_DESTINATION = "([^"]+)"/, "Python manifest destination"),
  ];
  const rustAllowed = stringsIn(
    block(
      rust,
      /const ALLOWED_DESTINATIONS: \[&str; \d+\] = \[([\s\S]*?)\];/,
      "Rust destination",
    ),
  );

  assert.deepEqual(
    [...pythonAllowed].sort(),
    [...contract.allowedDestinations].sort(),
    "Python destination set must equal the contract",
  );
  assert.deepEqual(
    [...rustAllowed].sort(),
    [...contract.allowedDestinations].sort(),
    "Rust destination set must equal the contract",
  );
});
