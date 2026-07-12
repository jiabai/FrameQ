import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`Invalid release version source: ${label}`);
  }
}

function requireVersion(value, label) {
  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) {
    throw new Error(`Invalid release version source: ${label}`);
  }
  return value;
}

function cargoPackageVersion(text, label, packageName = null) {
  const header = packageName === null ? "\\[package\\]" : "\\[\\[package\\]\\]";
  const blocks = text.match(new RegExp(`${header}([\\s\\S]*?)(?=\\n\\[|$)`, "g")) ?? [];

  for (const block of blocks) {
    if (packageName !== null) {
      const name = block.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
      if (name !== packageName) {
        continue;
      }
    }

    return requireVersion(block.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1], label);
  }

  throw new Error(`Invalid release version source: ${label}`);
}

export async function readReleaseVersions(repositoryRoot) {
  const appRoot = resolve(repositoryRoot, "app");
  const tauriRoot = resolve(appRoot, "src-tauri");
  const [appPackage, appPackageLock, tauriConfig, cargoManifest, cargoLock] =
    await Promise.all([
      readJson(resolve(appRoot, "package.json"), "appPackage"),
      readJson(resolve(appRoot, "package-lock.json"), "appPackageLock"),
      readJson(resolve(tauriRoot, "tauri.conf.json"), "tauriConfig"),
      readFile(resolve(tauriRoot, "Cargo.toml"), "utf8"),
      readFile(resolve(tauriRoot, "Cargo.lock"), "utf8"),
    ]);

  const lockVersion = requireVersion(appPackageLock.version, "appPackageLock");
  if (appPackageLock.packages?.[""]?.version !== lockVersion) {
    throw new Error("Invalid release version source: appPackageLock");
  }

  return {
    appPackage: requireVersion(appPackage.version, "appPackage"),
    appPackageLock: lockVersion,
    tauriConfig: requireVersion(tauriConfig.version, "tauriConfig"),
    cargoManifest: cargoPackageVersion(cargoManifest, "cargoManifest"),
    cargoLock: cargoPackageVersion(cargoLock, "cargoLock", "app"),
  };
}

export function assertReleaseVersion(versions, expectedVersion) {
  requireVersion(expectedVersion, "expectedVersion");
  const mismatches = Object.entries(versions)
    .filter(([, version]) => version !== expectedVersion)
    .map(([label]) => label);

  if (mismatches.length > 0) {
    throw new Error(`Release version mismatch: ${mismatches.join(", ")}`);
  }
}

async function main() {
  const expectedVersion = process.argv[2];
  const versions = await readReleaseVersions(resolve(import.meta.dirname, ".."));
  assertReleaseVersion(versions, expectedVersion);
  process.stdout.write(`Release version ${expectedVersion} is consistent.\n`);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
