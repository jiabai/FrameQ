#!/usr/bin/env node

import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(scriptDir, "..");

const DIRECT_FILES = [".env", "ui-preferences.json"];
const RECURSIVE_DIRS = ["auth"];
const FILTERED_DIRS = ["outputs"];
const FILTERED_EXTENSION = ".json";
const DEFAULT_KEEP = 5;

export function resolveSnapshotPaths({ repoRoot = defaultRepoRoot, sourceRoot } = {}) {
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const source = sourceRoot
    ? resolve(sourceRoot)
    : join(localAppData, "com.frameq.desktop");

  return {
    source,
    outputRoot: resolve(repoRoot, "build", "appdata-snapshot"),
  };
}

export function snapshotStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function collectJsonFiles(root) {
  const collected = [];

  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(FILTERED_EXTENSION)) {
        collected.push(entryPath);
      }
    }
  }

  await walk(root);
  return collected;
}

async function copyFileInto(sourcePath, targetPath) {
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath);
  const info = await stat(targetPath);
  return info.size;
}

export async function createAppDataSnapshot({
  repoRoot = defaultRepoRoot,
  sourceRoot,
  keep = DEFAULT_KEEP,
  now = new Date(),
} = {}) {
  const { source, outputRoot } = resolveSnapshotPaths({ repoRoot, sourceRoot });
  if (!existsSync(source)) {
    throw new Error(`App data directory not found: ${source}`);
  }

  const target = join(outputRoot, snapshotStamp(now));
  if (existsSync(target)) {
    await rm(target, { recursive: true, force: true });
  }
  await mkdir(target, { recursive: true });

  let fileCount = 0;
  let totalBytes = 0;
  const skipped = [];

  for (const name of DIRECT_FILES) {
    const sourcePath = join(source, name);
    if (!existsSync(sourcePath)) {
      skipped.push(name);
      continue;
    }
    totalBytes += await copyFileInto(sourcePath, join(target, name));
    fileCount += 1;
  }

  for (const name of RECURSIVE_DIRS) {
    const sourcePath = join(source, name);
    if (!existsSync(sourcePath)) {
      skipped.push(`${name}/`);
      continue;
    }
    await cp(sourcePath, join(target, name), { recursive: true });
    const info = await stat(join(target, name));
    totalBytes += info.size;
    fileCount += 1;
  }

  for (const name of FILTERED_DIRS) {
    const sourcePath = join(source, name);
    if (!existsSync(sourcePath)) {
      skipped.push(`${name}/`);
      continue;
    }
    const files = await collectJsonFiles(sourcePath);
    for (const filePath of files) {
      const relativePath = relative(source, filePath);
      totalBytes += await copyFileInto(filePath, join(target, relativePath));
      fileCount += 1;
    }
    if (files.length === 0) {
      skipped.push(`${name}/ (no json)`);
    }
  }

  return {
    source,
    target,
    fileCount,
    totalBytes,
    skipped,
  };
}

export async function pruneSnapshots(outputRoot, keep = DEFAULT_KEEP) {
  if (!existsSync(outputRoot)) {
    return [];
  }

  const entries = await readdir(outputRoot, { withFileTypes: true });
  const snapshots = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const removable = snapshots.slice(0, Math.max(0, snapshots.length - keep));
  for (const name of removable) {
    await rm(join(outputRoot, name), { recursive: true, force: true });
  }
  return removable;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const args = process.argv.slice(2);
  const options = { repoRoot: defaultRepoRoot, keep: DEFAULT_KEEP };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source") {
      options.sourceRoot = args[index + 1];
      index += 1;
    } else if (arg === "--keep") {
      options.keep = Number.parseInt(args[index + 1], 10);
      index += 1;
    }
  }

  const result = await createAppDataSnapshot(options);
  const removed = await pruneSnapshots(resolveSnapshotPaths(options).outputRoot, options.keep);

  console.log(
    `snapshot ${result.target}: ${result.fileCount} files, ${formatBytes(result.totalBytes)}`,
  );
  if (result.skipped.length > 0) {
    console.log(`skipped: ${[...new Set(result.skipped)].join(", ")}`);
  }
  if (removed.length > 0) {
    console.log(`pruned: ${removed.join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`snapshot failed: ${error.message}`);
    process.exitCode = 1;
  });
}
