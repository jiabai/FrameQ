import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("app lint runs TypeScript and production i18n literal checks", async () => {
  const appPackage = JSON.parse(
    await readFile(resolve(repositoryRoot, "app/package.json"), "utf8"),
  );

  assert.equal(
    appPackage.scripts?.lint,
    "tsc --noEmit && node ../scripts/check-i18n-literals.mjs",
  );
});
