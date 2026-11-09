import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { compareWorkerTrees } from "../verify-packaged-worker.mjs";

async function tempRoot(name) {
  return mkdtemp(join(tmpdir(), `frameq-${name}-`));
}

async function writeTree(root, files) {
  for (const [relativePath, bytes] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytes);
  }
}

test("byte comparison passes for identical trees and ignores pycache", async () => {
  const root = await tempRoot("worker-sync-ok");
  try {
    const canonical = join(root, "canonical");
    const packaged = join(root, "packaged");
    const files = {
      "worker_core/cli.py": "cli-source",
      "worker_core/import_stage_diagnostics.py": "guard-source",
      "worker_core/__pycache__/cli.cpython-312.pyc": "stale-cache",
    };
    await writeTree(canonical, files);
    await writeTree(packaged, {
      "worker_core/cli.py": "cli-source",
      "worker_core/import_stage_diagnostics.py": "guard-source",
    });

    assert.deepEqual(compareWorkerTrees(canonical, packaged), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("byte comparison reports missing, mismatched, and extra files", async () => {
  const root = await tempRoot("worker-sync-diff");
  try {
    const canonical = join(root, "canonical");
    const packaged = join(root, "packaged");
    await writeTree(canonical, {
      "worker_core/cli.py": "cli-source",
      "worker_core/only-canonical.py": "extra",
    });
    await writeTree(packaged, {
      "worker_core/cli.py": "cli-DRIFTED",
      "worker_core/only-packaged.py": "extra",
    });

    const errors = compareWorkerTrees(canonical, packaged);
    assert.ok(errors.some((error) => error.includes("byte mismatch: worker_core/cli.py")));
    assert.ok(
      errors.some((error) => error.includes("missing in packaged resources: worker_core/only-canonical.py")),
    );
    assert.ok(
      errors.some((error) => error.includes("extra in packaged resources: worker_core/only-packaged.py")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
