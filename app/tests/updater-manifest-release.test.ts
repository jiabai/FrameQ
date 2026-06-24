import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const normalizerPath = resolve(repoRoot, "scripts/normalize-updater-manifest.mjs");
const releaseWorkflowPath = resolve(repoRoot, ".github/workflows/desktop-release.yml");

describe("desktop updater release manifest", () => {
  test("normalizes latest.json to UTF-8 JSON without a BOM", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "frameq-updater-manifest-"));
    const manifestPath = join(tempDir, "latest.json");
    writeFileSync(
      manifestPath,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('{"version":"0.2.1","platforms":{}}', "utf8"),
      ]),
    );

    execFileSync("node", [normalizerPath, manifestPath], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    const normalized = readFileSync(manifestPath);
    expect([...normalized.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(JSON.parse(normalized.toString("utf8"))).toMatchObject({
      version: "0.2.1",
    });
  });

  test("release workflow normalizes latest.json before final upload", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain("Normalize updater manifest encoding");
    expect(workflow).toContain("scripts/normalize-updater-manifest.mjs");
    expect(workflow).toContain("gh release upload $env:RELEASE_TAG $manifestPath --clobber");
  });
});
