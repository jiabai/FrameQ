import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildTauriDevSpawnSpec,
  prepareFreshWorkerResource,
} from "../tauri-dev-fresh-worker.mjs";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "frameq-tauri-dev-"));
}

async function relativeWorkerFiles(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name.endsWith(".pyc") || entry.name.endsWith(".pyo")) {
      continue;
    }
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await relativeWorkerFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(path.slice(root.length + 1).replaceAll("\\", "/"));
    }
  }
  return files.sort();
}

test("refreshes the Tauri worker resource mirror from source worker", async () => {
  const root = await tempRoot();
  const sourceWorker = join(root, "worker", "frameq_worker");
  const staleMirror = join(
    root,
    "app",
    "src-tauri",
    "resources",
    "worker",
    "frameq_worker",
  );

  try {
    await mkdir(join(sourceWorker, "__pycache__"), { recursive: true });
    await mkdir(join(sourceWorker, "nested"), { recursive: true });
    await mkdir(staleMirror, { recursive: true });
    await writeFile(join(sourceWorker, "__init__.py"), "# fresh worker\n");
    await writeFile(join(sourceWorker, "nested", "requests.py"), "# contract v4\n");
    await writeFile(join(sourceWorker, "__pycache__", "stale.pyc"), "cache");
    await writeFile(join(staleMirror, "old.py"), "# stale mirror\n");

    await prepareFreshWorkerResource(root);

    const refreshed = join(staleMirror, "__init__.py");
    assert.equal(await readFile(refreshed, "utf8"), "# fresh worker\n");
    assert.equal(existsSync(join(staleMirror, "old.py")), false);
    assert.equal(existsSync(join(staleMirror, "__pycache__")), false);
    const canonicalFiles = await relativeWorkerFiles(sourceWorker);
    const mirrorFiles = await relativeWorkerFiles(staleMirror);
    assert.deepEqual(mirrorFiles, canonicalFiles);
    for (const relativePath of canonicalFiles) {
      assert.deepEqual(
        await readFile(join(staleMirror, relativePath)),
        await readFile(join(sourceWorker, relativePath)),
      );
    }
    assert.equal(
      existsSync(join(root, "app", "src-tauri", "resources", "worker", ".gitkeep")),
      true,
    );
    assert.equal(
      await readFile(join(root, "app", "src-tauri", "resources", "worker", ".gitkeep"), "utf8"),
      "\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("launches npm through cmd.exe on Windows to avoid npm.cmd spawn failures", () => {
  const spec = buildTauriDevSpawnSpec("D:\\Github\\FrameQ", "win32", {
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
  });

  assert.equal(spec.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(spec.args, [
    "/d",
    "/s",
    "/c",
    "npm --prefix app run tauri dev",
  ]);
});
