import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = resolve(
  repositoryRoot,
  ".github/workflows/desktop-release.yml",
);

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

test("desktop release uses Node.js 24-capable actions in every platform job", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.equal(countMatches(workflow, /uses:\s*actions\/checkout@v5/g), 3);
  assert.equal(countMatches(workflow, /uses:\s*actions\/setup-node@v5/g), 3);
  assert.equal(
    countMatches(
      workflow,
      /uses:\s*astral-sh\/setup-uv@11f9893b081a58869d3b5fccaea48c9e9e46f990/g,
    ),
    3,
  );
  assert.doesNotMatch(
    workflow,
    /actions\/checkout@v4|actions\/setup-node@v4|astral-sh\/setup-uv@(?:v6|v8)|node20/i,
  );
});

test("both macOS release jobs verify the packaged WebView host in the app and DMG", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const dmgScript = await readFile(
    resolve(repositoryRoot, "scripts/make-macos-dmg.sh"),
    "utf8",
  );

  assert.equal(
    countMatches(workflow, /bash scripts\/make-macos-dmg\.sh x86_64-apple-darwin FrameQ/g),
    1,
  );
  assert.equal(
    countMatches(workflow, /bash scripts\/make-macos-dmg\.sh aarch64-apple-darwin FrameQ/g),
    1,
  );
  assert.match(dmgScript, /x86_64-apple-darwin\) ARCH_SUFFIX="x64"; NATIVE_TARGET="macos-x64"/);
  assert.match(dmgScript, /aarch64-apple-darwin\) ARCH_SUFFIX="aarch64"; NATIVE_TARGET="macos-arm64"/);
  assert.match(dmgScript, /--target "\$\{NATIVE_TARGET\}" --verify-bundle "\$\{APP\}"/);
  assert.match(dmgScript, /--target "\$\{NATIVE_TARGET\}" --verify-dmg "\$\{DMG\}"/);
});

test("desktop release keeps its draft-first three-platform boundary", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /push:\s*\r?\n\s+tags:\s*\r?\n\s+- "v\*"/);
  assert.match(workflow, /permissions:\s*\r?\n\s+contents:\s*write/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /runs-on:\s*macos-15-intel/);
  assert.match(workflow, /runs-on:\s*macos-15/);
  assert.match(
    workflow,
    /RELEASE_DRAFT:\s*\$\{\{ github\.event_name == 'push' \|\| inputs\.release_draft \}\}/,
  );
  assert.match(workflow, /includeUpdaterJson:\s*true/);
  assert.match(workflow, /codesign --verify --deep --strict --verbose=4/);
});
