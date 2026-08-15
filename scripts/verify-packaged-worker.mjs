#!/usr/bin/env node
// Verify the packaged worker resource tree is byte-identical to the canonical
// worker source (excluding generated __pycache__), so packaged resources
// cannot drift from the code that was tested. Used by desktop-release.yml
// right after build-installer regenerates the resources.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function compareWorkerTrees(canonicalRoot, packagedRoot) {
  const canonicalFiles = walkFiles(canonicalRoot);
  const packagedFiles = walkFiles(packagedRoot);
  const normalized = (root, path) => relative(root, path).split(sep).join("/");
  const packagedRelative = new Set(packagedFiles.map((path) => normalized(packagedRoot, path)));
  const canonicalRelative = new Set(canonicalFiles.map((path) => normalized(canonicalRoot, path)));

  const errors = [];
  for (const file of canonicalFiles) {
    const rel = relative(canonicalRoot, file).split(sep).join("/");
    if (!packagedRelative.has(rel)) {
      errors.push(`missing in packaged resources: ${rel}`);
      continue;
    }
    const canonicalBytes = readFileSync(file);
    const packagedBytes = readFileSync(join(packagedRoot, rel));
    if (!canonicalBytes.equals(packagedBytes)) {
      errors.push(`byte mismatch: ${rel}`);
    }
  }
  for (const rel of packagedRelative) {
    if (!canonicalRelative.has(rel)) {
      errors.push(`extra in packaged resources: ${rel}`);
    }
  }
  return errors;
}

function walkFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "__pycache__") {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  };
  visit(root);
  return files;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const canonical = join(repoRoot, "worker", "frameq_worker");
  const packaged = join(repoRoot, "app", "src-tauri", "resources", "worker", "frameq_worker");
  const errors = compareWorkerTrees(canonical, packaged);
  if (errors.length > 0) {
    console.error("Packaged worker is out of sync with the canonical source:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
  console.log("Packaged worker is byte-identical to the canonical source.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
