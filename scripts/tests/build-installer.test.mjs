import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  copyDenoFromArchive,
  defaultDenoArchiveUrl,
  parseArgs,
  requireBundledDeno,
  requiredDenoBinary,
} from "../build-installer.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const buildInstallerPath = join(testDir, "..", "build-installer.mjs");
const projectManifestPath = join(testDir, "..", "..", "pyproject.toml");
const repoRoot = join(testDir, "..", "..");

async function tempRoot(name) {
  return mkdtemp(join(tmpdir(), `frameq-${name}-`));
}

async function createFakeDenoArchive(binaryName) {
  const root = await tempRoot("deno-archive");
  const source = join(root, "source");
  const archive = join(root, "deno.tar");
  await mkdir(source, { recursive: true });
  const binary = join(source, binaryName);
  await writeFile(binary, "#!/usr/bin/env sh\nprintf 'deno fake\\n'\n");
  await chmod(binary, 0o755);

  const result = spawnSync("tar", ["-cf", archive, "-C", source, binaryName], {
    stdio: "pipe",
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `create fake deno archive: ${result.stderr.toString()}`,
  );
  return { root, archive };
}

test("maps supported targets to bundled Deno binary names", () => {
  assert.equal(requiredDenoBinary("windows-x64"), "deno.exe");
  assert.equal(requiredDenoBinary("macos-arm64"), "deno");
  assert.equal(requiredDenoBinary("macos-x64"), "deno");
});

test("builds official Deno release archive URLs per target", () => {
  assert.equal(
    defaultDenoArchiveUrl("windows-x64", "v2.9.1"),
    "https://github.com/denoland/deno/releases/download/v2.9.1/deno-x86_64-pc-windows-msvc.zip",
  );
  assert.equal(
    defaultDenoArchiveUrl("macos-arm64", "v2.9.1"),
    "https://github.com/denoland/deno/releases/download/v2.9.1/deno-aarch64-apple-darwin.zip",
  );
  assert.equal(
    defaultDenoArchiveUrl("macos-x64", "v2.9.1"),
    "https://github.com/denoland/deno/releases/download/v2.9.1/deno-x86_64-apple-darwin.zip",
  );
});

test("parseArgs accepts Deno archive and version overrides", () => {
  const options = parseArgs([
    "--target",
    "macos-arm64",
    "--deno-archive-url",
    "file:///tmp/deno.zip",
    "--deno-version",
    "v2.9.1",
  ]);

  assert.equal(options.target, "macos-arm64");
  assert.equal(options.denoArchiveUrl, "file:///tmp/deno.zip");
  assert.equal(options.denoVersion, "v2.9.1");
});

test("installer build installs and imports the bundled ONNX runtime before Tauri packaging", () => {
  const buildScript = readFileSync(buildInstallerPath, "utf8");
  const manifest = readFileSync(projectManifestPath, "utf8");

  assert.match(manifest, /"funasr-onnx==0\.4\.2"/);
  assert.match(manifest, /"onnxruntime>=1\.17\.0"/);
  assert.match(
    buildScript,
    /\["export", "--no-dev", "--format", "requirements-txt", "--output-file", requirementsPath\]/,
  );
  assert.match(
    buildScript,
    /\["-m", "pip", "install", "--only-binary=llvmlite,cryptography", "-r", requirementsPath\]/,
  );
  assert.match(
    buildScript,
    /import funasr, funasr_onnx, modelscope, onnxruntime, yt_dlp; import frameq_worker/,
  );
  assert.ok(
    buildScript.indexOf("Python runtime smoke test") < buildScript.indexOf("Build Tauri installer"),
  );
});

test("installer bundles the version-6 dissection worker modules without private artifacts", () => {
  const buildScript = readFileSync(buildInstallerPath, "utf8");
  const contract = JSON.parse(
    readFileSync(join(repoRoot, "contracts", "desktop-worker-contract.json"), "utf8"),
  );

  assert.equal(contract.contractVersion, 6);
  assert.match(
    buildScript,
    /copyDirectoryContents\(join\(repoRoot, "worker", "frameq_worker"\), join\(destination, "frameq_worker"\)\)/,
  );
  assert.equal(
    existsSync(join(repoRoot, "worker", "frameq_worker", "insightflow", "dissection.py")),
    true,
  );
  assert.equal(
    existsSync(join(repoRoot, "worker", "frameq_worker", "pipeline_runtime", "dissection.py")),
    true,
  );
  assert.doesNotMatch(buildScript, /FRAMEQ_LLM_API_KEY\s*=|dissection\.json["']\s*,\s*["']/);
});

test("requireBundledDeno fails clearly when skip-download resources lack Deno", async () => {
  const root = await tempRoot("deno-required");
  try {
    await mkdir(root, { recursive: true });

    assert.throws(
      () => requireBundledDeno(root, "macos-arm64"),
      /Could not find bundled Deno runtime/,
    );

    await writeFile(join(root, "deno"), "");
    assert.doesNotThrow(() => requireBundledDeno(root, "macos-arm64"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("copyDenoFromArchive extracts Deno into resources bin", async () => {
  const { root, archive } = await createFakeDenoArchive("deno");
  const destination = join(root, "resources-bin");

  try {
    await copyDenoFromArchive(archive, destination, "macos-arm64");

    const copied = join(destination, "deno");
    assert.equal(existsSync(copied), true);
    if (process.platform !== "win32") {
      const mode = (await stat(copied)).mode;
      assert.notEqual(mode & 0o111, 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
