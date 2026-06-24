#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const [, , manifestPath] = process.argv;

if (!manifestPath) {
  console.error("Usage: node scripts/normalize-updater-manifest.mjs <latest.json>");
  process.exit(1);
}

try {
  const raw = await readFile(manifestPath);
  const hasUtf8Bom =
    raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  const normalized = hasUtf8Bom ? raw.subarray(3) : raw;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(normalized);

  JSON.parse(text);
  await writeFile(manifestPath, normalized);

  console.log(
    hasUtf8Bom
      ? "Removed UTF-8 BOM from updater manifest."
      : "Updater manifest already uses UTF-8 without BOM.",
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Invalid updater manifest: ${message}`);
  process.exit(1);
}
