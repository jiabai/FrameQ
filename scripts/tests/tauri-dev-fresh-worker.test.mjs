import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    await mkdir(staleMirror, { recursive: true });
    await writeFile(join(sourceWorker, "__init__.py"), "# fresh worker\n");
    await writeFile(join(sourceWorker, "__pycache__", "stale.pyc"), "cache");
    await writeFile(join(staleMirror, "old.py"), "# stale mirror\n");

    await prepareFreshWorkerResource(root);

    const refreshed = join(staleMirror, "__init__.py");
    assert.equal(await readFile(refreshed, "utf8"), "# fresh worker\n");
    assert.equal(existsSync(join(staleMirror, "old.py")), false);
    assert.equal(existsSync(join(staleMirror, "__pycache__")), false);
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
