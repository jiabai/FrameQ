#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(scriptDir, "..");

const LOCKFILE_NAME = "uv.lock";
const PYPI_URL = "https://pypi.org/pypi/yt-dlp/json";

export function lockedVersionFromLockfile(text) {
  const match = text.match(/^name = "yt-dlp"\r?\nversion = "([^"]+)"/m);
  return match ? match[1] : null;
}

function numericParts(version) {
  return version.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isNaN(value) ? part : value;
  });
}

export function isNewerVersion(candidate, baseline) {
  const left = numericParts(candidate);
  const right = numericParts(baseline);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a === b) {
      continue;
    }
    if (typeof a === "number" && typeof b === "number") {
      return a > b;
    }
    return String(a) > String(b);
  }
  return false;
}

export async function fetchLatestVersion(fetchImpl = fetch) {
  const response = await fetchImpl(PYPI_URL, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`PyPI responded ${response.status}`);
  }
  const payload = await response.json();
  const version = payload?.info?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("PyPI payload has no info.version");
  }
  return version;
}

export async function checkDrift({ repoRoot = defaultRepoRoot, fetchImpl = fetch } = {}) {
  const lockfilePath = resolve(repoRoot, LOCKFILE_NAME);
  const lockfile = await readFile(lockfilePath, "utf8");
  const locked = lockedVersionFromLockfile(lockfile);
  if (locked === null) {
    throw new Error(`No yt-dlp entry in ${lockfilePath}`);
  }

  const latest = await fetchLatestVersion(fetchImpl);
  return {
    locked,
    latest,
    drifted: isNewerVersion(latest, locked),
  };
}

async function main() {
  try {
    const result = await checkDrift();
    if (result.drifted) {
      console.log(`yt-dlp locked ${result.locked}, upstream ${result.latest} (drift)`);
      console.log("Review the upstream changelog, then run a real download before releasing.");
      process.exitCode = 1;
      return;
    }
    console.log(`yt-dlp locked ${result.locked}, upstream ${result.latest} (current)`);
  } catch (error) {
    console.error(`yt-dlp check skipped: ${error.message}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
