import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertReleaseVersion,
  readReleaseVersions,
} from "../check-release-version.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function createVersionFixture(versions) {
  const root = await mkdtemp(join(tmpdir(), "frameq-release-version-"));
  await mkdir(join(root, "app", "src-tauri"), { recursive: true });

  await writeFile(
    join(root, "app", "package.json"),
    JSON.stringify({ name: "app", version: versions.appPackage }),
  );
  await writeFile(
    join(root, "app", "package-lock.json"),
    JSON.stringify({
      name: "app",
      version: versions.appPackageLock,
      packages: { "": { name: "app", version: versions.appPackageLock } },
    }),
  );
  await writeFile(
    join(root, "app", "src-tauri", "tauri.conf.json"),
    JSON.stringify({ productName: "FrameQ", version: versions.tauriConfig }),
  );
  await writeFile(
    join(root, "app", "src-tauri", "Cargo.toml"),
    `[package]\nname = "app"\nversion = "${versions.cargoManifest}"\n\n[dependencies]\n`,
  );
  await writeFile(
    join(root, "app", "src-tauri", "Cargo.lock"),
    `[[package]]\nname = "app"\nversion = "${versions.cargoLock}"\n\n[[package]]\nname = "other"\nversion = "9.9.9"\n`,
  );

  return root;
}

test("desktop release version sources agree on v0.2.16", async () => {
  const versions = await readReleaseVersions(repositoryRoot);

  assert.doesNotThrow(() => assertReleaseVersion(versions, "0.2.16"));
  assert.deepEqual(new Set(Object.values(versions)), new Set(["0.2.16"]));
});

test("release version mismatch reports only stable source labels", async () => {
  const root = await createVersionFixture({
    appPackage: "0.2.16",
    appPackageLock: "0.2.15",
    tauriConfig: "0.2.16",
    cargoManifest: "0.2.14",
    cargoLock: "0.2.16",
  });

  try {
    const versions = await readReleaseVersions(root);
    assert.throws(
      () => assertReleaseVersion(versions, "0.2.16"),
      (error) => {
        assert.equal(
          error.message,
          "Release version mismatch: appPackageLock, cargoManifest",
        );
        assert.doesNotMatch(error.message, /0\.2\.1[45]/);
        assert.doesNotMatch(error.message, /frameq-release-version/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
