import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const productionOwners = [
  "worker/frameq_worker/asr_runtime/artifacts.py",
  "worker/frameq_worker/insightflow/summary.py",
  "worker/frameq_worker/insightflow/generator.py",
  "app/src-tauri/src/task_manifest/storage.rs",
  "app/src-tauri/src/transcript_detail/edit_storage.rs",
  "app/src-tauri/src/transcript_detail/segments.rs",
];

const forbiddenWrites = [
  /\.write_text\s*\(/,
  /\.write_bytes\s*\(/,
  /\.unlink\s*\(/,
  /\bfs::write\s*\(/,
  /\bFile::create\s*\(/,
  /\.truncate\s*\(\s*true\s*\)/,
];

test("authoritative task writers delegate final-path mutation to atomic owners", async () => {
  const violations = [];
  for (const relativePath of productionOwners) {
    const source = await readFile(resolve(repositoryRoot, relativePath), "utf8");
    for (const pattern of forbiddenWrites) {
      if (pattern.test(source)) {
        violations.push(`${relativePath}: ${pattern}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `direct authoritative writes bypass the reviewed atomic boundary:\n${violations.join("\n")}`,
  );
});
