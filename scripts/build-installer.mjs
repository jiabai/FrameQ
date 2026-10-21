#!/usr/bin/env node

import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const validTargets = new Set(["windows-x64", "macos-arm64", "macos-x64"]);
const defaultDenoVersion = "v2.9.1";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const appRoot = join(repoRoot, "app");
const tauriRoot = join(appRoot, "src-tauri");
const resourcesRoot = join(tauriRoot, "resources");

// 归档一律用 Windows 自带的 bsdtar（System32）：本地 Git Bash 的 GNU tar 会把
// `D:/...` 当成远程主机（"Cannot connect to D: resolve failed"），也不支持
// `-a` 按扩展名打包 zip。CI 与本机都直接给绝对路径，绕开 PATH 差异。
const tarCommand =
  process.platform === "win32"
    ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";

export function parseArgs(argv) {
  const options = {
    target: "windows-x64",
    pythonStandaloneUrl: process.env.FRAMEQ_PYTHON_STANDALONE_URL ?? "",
    ffmpegArchiveUrl: process.env.FRAMEQ_FFMPEG_ARCHIVE_URL ?? "",
    ffprobeArchiveUrl: process.env.FRAMEQ_FFPROBE_ARCHIVE_URL ?? "",
    denoArchiveUrl: process.env.FRAMEQ_DENO_ARCHIVE_URL ?? "",
    denoVersion: process.env.FRAMEQ_DENO_VERSION ?? defaultDenoVersion,
    skipDownloads: false,
    skipTauriBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    const [flag, inlineValue] = rawArg.includes("=") ? rawArg.split(/=(.*)/s, 2) : [rawArg, undefined];
    const normalized = flag.toLowerCase();
    const readValue = () => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${flag}`);
      }
      return argv[index];
    };

    switch (normalized) {
      case "--target":
      case "-target":
        options.target = readValue();
        break;
      case "--python-standalone-url":
      case "-pythonstandaloneurl":
        options.pythonStandaloneUrl = readValue();
        break;
      case "--ffmpeg-archive-url":
      case "-ffmpegarchiveurl":
        options.ffmpegArchiveUrl = readValue();
        break;
      case "--ffprobe-archive-url":
      case "-ffprobearchiveurl":
        options.ffprobeArchiveUrl = readValue();
        break;
      case "--deno-archive-url":
      case "-denoarchiveurl":
        options.denoArchiveUrl = readValue();
        break;
      case "--deno-version":
      case "-denoversion":
        options.denoVersion = normalizeDenoVersion(readValue());
        break;
      case "--skip-downloads":
      case "-skipdownloads":
        options.skipDownloads = true;
        break;
      case "--skip-tauri-build":
      case "-skiptauribuild":
        options.skipTauriBuild = true;
        break;
      default:
        throw new Error(`Unknown argument: ${rawArg}`);
    }
  }

  if (!validTargets.has(options.target)) {
    throw new Error(`Unsupported target: ${options.target}`);
  }
  options.denoVersion = normalizeDenoVersion(options.denoVersion);

  return options;
}

const pythonRoot = join(resourcesRoot, "python");
const workerRoot = join(resourcesRoot, "worker");
const binRoot = join(resourcesRoot, "bin");

async function resetDirectory(path) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

function requireFileOrUrl(value, name) {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required. Pass the parameter or set the matching FRAMEQ_* environment variable.`);
  }
}

function normalizeDenoVersion(version) {
  const trimmed = version.trim();
  if (!trimmed) {
    throw new Error("DenoVersion is required.");
  }
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function commandName(name) {
  if (process.platform === "win32" && name === "npm") {
    return `${name}.cmd`;
  }
  return name;
}

function run(command, args, description, extraOptions = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...(extraOptions.env ?? {}) },
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${description} failed with exit code ${result.status}.`);
  }
}

async function ensureGitKeep(path) {
  await writeFile(join(path, ".gitkeep"), "\n");
}

async function downloadArchive(url, destination) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function getArchiveLeafName(value, fallbackName) {
  if (existsSync(value)) {
    return basename(value);
  }

  try {
    const leaf = basename(new URL(value).pathname);
    return leaf || fallbackName;
  } catch {
    return fallbackName;
  }
}

async function prepareArchiveInput(value, destinationDirectory, fallbackName) {
  // Isolate each archive in its own directory keyed by the (unique) fallback
  // name. URLs can share a leaf name — for example evermeet's .../ffmpeg/zip and
  // .../ffprobe/zip both end in "zip" — and without isolation the second
  // download would overwrite the first, silently swapping ffmpeg for ffprobe.
  const isolatedDirectory = join(destinationDirectory, basename(fallbackName, ".archive"));
  await mkdir(isolatedDirectory, { recursive: true });
  const archivePath = join(isolatedDirectory, getArchiveLeafName(value, fallbackName));
  if (existsSync(value)) {
    await copyFile(value, archivePath);
  } else {
    await downloadArchive(value, archivePath);
  }
  return archivePath;
}

async function expandArchiveFile(archive, destination) {
  await mkdir(destination, { recursive: true });
  run(tarCommand, ["-xf", archive, "-C", destination], `Extract archive ${archive}`);
}

async function copyDirectoryContents(source, destination) {
  if (!existsSync(source)) {
    throw new Error(`Source directory not found: ${source}`);
  }

  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) => cp(join(source, entry.name), join(destination, entry.name), { recursive: true, force: true })),
  );
}

async function walkFiles(root) {
  const files = [];
  if (!existsSync(root)) {
    return files;
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath)));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function walkDirectories(root) {
  const directories = [];
  if (!existsSync(root)) {
    return directories;
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      directories.push(entryPath, ...(await walkDirectories(entryPath)));
    }
  }
  return directories;
}

async function findFirstFile(root, names) {
  const wanted = new Set(names);
  for (const file of await walkFiles(root)) {
    if (wanted.has(basename(file))) {
      return file;
    }
  }
  return undefined;
}

async function removePythonCaches(root) {
  for (const file of await walkFiles(root)) {
    if (file.endsWith(".pyc") || file.endsWith(".pyo")) {
      await rm(file, { force: true });
    }
  }

  const directories = await walkDirectories(root);
  await Promise.all(
    directories
      .filter((directory) => basename(directory) === "__pycache__")
      .sort((left, right) => right.length - left.length)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

async function copyWorkerRuntime(destination) {
  await resetDirectory(destination);
  await ensureGitKeep(destination);
  await copyDirectoryContents(join(repoRoot, "worker", "frameq_worker"), join(destination, "frameq_worker"));
  await removePythonCaches(destination);
}

async function findVersionedUnixPythonLauncher(binDirectory) {
  if (!existsSync(binDirectory)) {
    return undefined;
  }

  // python-build-standalone ships the real interpreter as python3.<minor>
  // (for example python3.12) with python/python3 as symlinks to it. Match the
  // minor-version launcher without pinning a specific CPython minor, so bumping
  // the bundled standalone does not silently break launcher normalization here.
  const entries = await readdir(binDirectory);
  return entries
    .filter((name) => /^python3\.\d+$/.test(name))
    .sort()
    .at(-1);
}

async function findPythonExecutable(root) {
  const windowsPython = join(root, "python.exe");
  if (existsSync(windowsPython)) {
    return windowsPython;
  }

  const binDirectory = join(root, "bin");
  const unixPython = join(binDirectory, "python3");
  if (existsSync(unixPython)) {
    return unixPython;
  }

  const versionedLauncher = await findVersionedUnixPythonLauncher(binDirectory);
  if (versionedLauncher) {
    return join(binDirectory, versionedLauncher);
  }

  throw new Error(`Could not find bundled Python executable under ${root}`);
}

async function normalizeUnixPythonLaunchers(root) {
  const binDirectory = join(root, "bin");
  const versionedLauncher = await findVersionedUnixPythonLauncher(binDirectory);
  if (!versionedLauncher) {
    return;
  }

  for (const launcherName of ["python", "python3"]) {
    const launcherPath = join(binDirectory, launcherName);
    await rm(launcherPath, { force: true });
    await symlink(versionedLauncher, launcherPath);
  }
}

function requiredFfmpegBinaries(target) {
  return target === "windows-x64" ? ["ffmpeg.exe", "ffprobe.exe"] : ["ffmpeg", "ffprobe"];
}

function requireBundledFfmpeg(root, target) {
  const missingBinaries = requiredFfmpegBinaries(target).filter((binaryName) => !existsSync(join(root, binaryName)));
  if (missingBinaries.length > 0) {
    throw new Error(`Could not find bundled media binaries under ${root}: ${missingBinaries.join(", ")}`);
  }
}

export function requiredDenoBinary(target) {
  return target === "windows-x64" ? "deno.exe" : "deno";
}

// python-build-standalone ships vcruntime140.dll so python.exe itself can
// start on a clean machine, but third-party C extensions (numpy, onnxruntime,
// pycryptodome, ...) link against the system-level msvcp140.dll and
// vcruntime140_1.dll from the Microsoft Visual C++ 2015-2022 Redistributable.
// Bundling them app-local (Microsoft allows app-local deployment) removes the
// clean-Windows dependency without UAC or a redist install.
export const WINDOWS_VC_RUNTIME_DLLS = ["msvcp140.dll", "vcruntime140_1.dll", "vcruntime140.dll"];

function defaultWindowsSystemRoot() {
  return process.env.SystemRoot ?? "C:\\Windows";
}

export async function bundleWindowsVcRuntimeDlls(pythonRoot, systemRoot = defaultWindowsSystemRoot()) {
  const system32 = join(systemRoot, "System32");
  const copied = [];
  for (const dllName of WINDOWS_VC_RUNTIME_DLLS) {
    const destinationPath = join(pythonRoot, dllName);
    if (dllName === "vcruntime140.dll" && existsSync(destinationPath)) {
      continue;
    }
    const sourcePath = join(system32, dllName);
    if (!existsSync(sourcePath)) {
      throw new Error(
        `Could not find VC++ runtime DLL under ${system32}: ${dllName}. ` +
          "Install the Microsoft Visual C++ 2015-2022 Redistributable (x64) on the build machine.",
      );
    }
    await copyFile(sourcePath, destinationPath);
    copied.push(dllName);
  }
  assertBundledWindowsVcRuntimeDlls(pythonRoot);
  return copied;
}

export function assertBundledWindowsVcRuntimeDlls(pythonRoot) {
  const missing = WINDOWS_VC_RUNTIME_DLLS.filter((dllName) => !existsSync(join(pythonRoot, dllName)));
  if (missing.length > 0) {
    throw new Error(`Could not find bundled VC++ runtime DLLs under ${pythonRoot}: ${missing.join(", ")}`);
  }
}

function denoArchiveAssetName(target) {
  switch (target) {
    case "windows-x64":
      return "deno-x86_64-pc-windows-msvc.zip";
    case "macos-arm64":
      return "deno-aarch64-apple-darwin.zip";
    case "macos-x64":
      return "deno-x86_64-apple-darwin.zip";
    default:
      throw new Error(`Unsupported target: ${target}`);
  }
}

export function defaultDenoArchiveUrl(target, version = defaultDenoVersion) {
  const normalizedVersion = normalizeDenoVersion(version);
  return `https://github.com/denoland/deno/releases/download/${normalizedVersion}/${denoArchiveAssetName(target)}`;
}

export function requireBundledDeno(root, target) {
  const binaryName = requiredDenoBinary(target);
  if (!existsSync(join(root, binaryName))) {
    throw new Error(`Could not find bundled Deno runtime under ${root}: ${binaryName}`);
  }
}

export async function copyDenoFromArchive(archive, destination, target) {
  const binaryName = requiredDenoBinary(target);
  const extractRoot = join(dirname(archive), "deno");
  await resetDirectory(extractRoot);
  await expandArchiveFile(archive, extractRoot);

  const binary = await findFirstFile(extractRoot, [binaryName]);
  if (!binary) {
    const extractedNames = (await walkFiles(extractRoot)).map((file) => basename(file));
    const preview =
      extractedNames.length > 0 ? [...new Set(extractedNames)].slice(0, 40).join(", ") : "(archive extracted no files)";
    throw new Error(`${binaryName} was not found in the Deno archive (${basename(archive)}). Extracted files: ${preview}`);
  }

  await mkdir(destination, { recursive: true });
  const destinationPath = join(destination, binaryName);
  await copyFile(binary, destinationPath);
  if (target !== "windows-x64") {
    await chmod(destinationPath, 0o755);
  }
}

function smokeTestDenoRuntime(root, target, cacheRoot) {
  const deno = join(root, requiredDenoBinary(target));
  run(deno, ["eval", "console.log('deno runtime OK')"], "Deno runtime smoke test", {
    env: {
      DENO_DIR: join(cacheRoot, "deno-cache"),
      DENO_NO_UPDATE_CHECK: "1",
    },
  });
}

function isMacTarget(target) {
  return target === "macos-arm64" || target === "macos-x64";
}

async function verifyMacRuntimeSelfContained(pythonRoot) {
  // The macOS runtime relies on upstream-delocated wheels: Intel pins
  // numba/llvmlite to versions that ship self-contained x86_64 wheels, and torch
  // and friends bundle their own libraries. Fail the build if any bundled
  // library still references a path outside the app bundle. This is static
  // analysis (delocate-listdeps), so it catches leaks even on the Homebrew-rich
  // runner where an import smoke test would pass.
  run(
    "node",
    [join(scriptDir, "verify-macos-self-contained.mjs"), pythonRoot],
    "Verify macOS runtime is self-contained",
  );
}

function resolveTauriTargetTriple(target) {
  switch (target) {
    case "windows-x64":
      return "x86_64-pc-windows-msvc";
    case "macos-arm64":
      return "aarch64-apple-darwin";
    case "macos-x64":
      return "x86_64-apple-darwin";
    default:
      throw new Error(`Unsupported target: ${target}`);
  }
}

function hasStandalonePythonRuntimeLandmark(root) {
  return existsSync(join(root, "Lib")) || existsSync(join(root, "lib")) || existsSync(join(root, "pyvenv.cfg"));
}

export async function findStandalonePythonRuntimeRoot(root) {
  const candidates = [];
  const executableNames = [];

  for (const executable of await walkFiles(root)) {
    const executableName = basename(executable);
    if (executableName !== "python.exe" && executableName !== "python3" && !/^python3\.\d+$/.test(executableName)) {
      continue;
    }

    executableNames.push(executable);
    const executableParent = dirname(executable);
    const runtimeRoot = basename(executableParent) === "bin" ? dirname(executableParent) : executableParent;
    if (hasStandalonePythonRuntimeLandmark(runtimeRoot)) {
      candidates.push({ executable, runtimeRoot });
    }
  }

  if (candidates.length === 0) {
    const preview =
      executableNames.length > 0 ? executableNames.slice(0, 20).join(", ") : "(archive contained no Python executable)";
    throw new Error(`Python standalone runtime root was not found in the archive. Candidate executables: ${preview}`);
  }

  candidates.sort(
    (left, right) => left.runtimeRoot.length - right.runtimeRoot.length || left.executable.localeCompare(right.executable),
  );
  return candidates[0];
}

async function copyStandalonePythonFromArchive(archive, destination) {
  const extractRoot = join(dirname(archive), "python-extract");
  await resetDirectory(extractRoot);
  await expandArchiveFile(archive, extractRoot);

  const { runtimeRoot } = await findStandalonePythonRuntimeRoot(extractRoot);
  await copyDirectoryContents(runtimeRoot, destination);
  await normalizeUnixPythonLaunchers(destination);
}

async function copyMediaBinariesFromArchive(archive, destination, target, binaryNames, extractDirectoryName) {
  const extractRoot = join(dirname(archive), extractDirectoryName);
  await resetDirectory(extractRoot);
  await expandArchiveFile(archive, extractRoot);

  for (const binaryName of binaryNames) {
    const binary = await findFirstFile(extractRoot, [binaryName]);
    if (!binary) {
      const extractedNames = (await walkFiles(extractRoot)).map((file) => basename(file));
      const preview =
        extractedNames.length > 0
          ? [...new Set(extractedNames)].slice(0, 40).join(", ")
          : "(archive extracted no files)";
      throw new Error(
        `${binaryName} was not found in the media archive (${basename(archive)}). Extracted files: ${preview}`,
      );
    }
    const destinationPath = join(destination, binaryName);
    await copyFile(binary, destinationPath);
    if (target !== "windows-x64") {
      await chmod(destinationPath, 0o755);
    }
  }
}

async function copyFfmpegFromArchive(ffmpegArchive, ffprobeArchive, destination, target) {
  const [ffmpegBinary, ffprobeBinary] = requiredFfmpegBinaries(target);
  await copyMediaBinariesFromArchive(ffmpegArchive, destination, target, [ffmpegBinary], "ffmpeg");
  await copyMediaBinariesFromArchive(ffprobeArchive, destination, target, [ffprobeBinary], "ffprobe");
}

async function findSitePackagesDirectories(root) {
  // Standalone Python uses different site-packages layouts per platform: Windows
  // keeps Lib/site-packages, while python-build-standalone on macOS/Linux nests it
  // under lib/python3.<minor>/site-packages. Resolve both so runtime pruning (for
  // example torch include/share) works regardless of the bundled OS and minor.
  const directories = [];

  const windowsSitePackages = join(root, "Lib", "site-packages");
  if (existsSync(windowsSitePackages)) {
    directories.push(windowsSitePackages);
  }

  const unixLib = join(root, "lib");
  if (existsSync(unixLib)) {
    for (const entry of await readdir(unixLib, { withFileTypes: true })) {
      if (entry.isDirectory() && /^python3\.\d+$/.test(entry.name)) {
        const sitePackages = join(unixLib, entry.name, "site-packages");
        if (existsSync(sitePackages)) {
          directories.push(sitePackages);
        }
      }
    }
  }

  return directories;
}

const BUNDLED_MANIFEST_NAME = "runtime-manifest.json";
const COMPONENT_SITE_PACKAGES_NAME = "site-packages";

// uv.lock 的 SHA256 作为运行时指纹：包内与组件各写一份 runtime-manifest.json，
// worker 比对两者，不一致按缺失处理。锁文件里任何影响解析的改动都会换指纹。
function computeLockFingerprint() {
  return createHash("sha256").update(readFileSync(join(repoRoot, "uv.lock"))).digest("hex");
}

export { computeLockFingerprint };

function runtimeManifestPayload(fingerprint, runtimeKind, target) {
  return `${JSON.stringify(
    {
      lock_fingerprint: fingerprint,
      runtime_kind: runtimeKind,
      target,
    },
    null,
    2,
  )}\n`;
}

function distributionNameFromMetadata(distInfoDirectory) {
  const metadataPath = join(distInfoDirectory, "METADATA");
  if (!existsSync(metadataPath)) {
    return null;
  }
  const match = readFileSync(metadataPath, "utf8").match(/^Name:\s*(.+)$/m);
  return match ? match[1].trim().toLowerCase().replace(/_/g, "-") : null;
}

async function collectDistributionNames(sitePackages) {
  const names = new Set();
  for (const entry of await readdir(sitePackages, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.toLowerCase().endsWith(".dist-info")) {
      continue;
    }
    const name = distributionNameFromMetadata(join(sitePackages, entry.name));
    if (name) {
      names.add(name);
    }
  }
  return names;
}

// 组件导出的是「基础依赖 + pytorch extra」全集，其中基础依赖与包内完全同版本
// （同一份 uv.lock）。这里按发行版名把与包内重叠的部分从组件里删掉，只留下
// PyTorch 族的独占闭包。发行版名到顶层目录的映射用 RECORD 文件还原，避免
// 手写 dist name 与 import name 的对照表（Pillow->PIL、funasr-onnx->funasr_onnx）。
async function harvestComponentSitePackages(componentSitePackages, bundledSitePackages) {
  const bundledNames = await collectDistributionNames(bundledSitePackages);
  let removedDistributions = 0;
  for (const entry of await readdir(componentSitePackages, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.toLowerCase().endsWith(".dist-info")) {
      continue;
    }
    const distInfoDirectory = join(componentSitePackages, entry.name);
    const name = distributionNameFromMetadata(distInfoDirectory);
    if (!name || !bundledNames.has(name)) {
      continue;
    }
    const ownedTopLevel = new Set();
    const recordPath = join(distInfoDirectory, "RECORD");
    if (existsSync(recordPath)) {
      for (const line of readFileSync(recordPath, "utf8").split(/\r?\n/)) {
        const rawPath = line.split(",")[0]?.trim() ?? "";
        if (!rawPath) {
          continue;
        }
        const unquoted = rawPath.replace(/^"(.*)"$/, "$1").replace(/""/g, '"');
        const firstSegment = unquoted.split(/[\\/]/)[0];
        if (firstSegment && !firstSegment.toLowerCase().endsWith(".dist-info")) {
          ownedTopLevel.add(firstSegment);
        }
      }
    }
    await rm(distInfoDirectory, { recursive: true, force: true });
    for (const segment of ownedTopLevel) {
      await rm(join(componentSitePackages, segment), { recursive: true, force: true });
    }
    removedDistributions += 1;
  }
  return removedDistributions;
}

// PyTorch 族运行时组件：独立 site-packages + runtime-manifest.json，打成 zip
// 供 CI 上传到 GitHub Releases，worker 按需下载后注入 sys.path。
export async function buildPytorchRuntimeComponent({
  pythonExe,
  target,
  buildRoot,
  fingerprint,
  workerRoot,
  bundledSitePackages,
}) {
  const componentStaging = join(buildRoot, "pytorch-component");
  const componentSitePackages = join(componentStaging, COMPONENT_SITE_PACKAGES_NAME);
  run(commandName("uv"), ["export", "--no-dev", "--format", "requirements-txt", "--extra", "pytorch", "--output-file", join(buildRoot, "requirements-pytorch.txt")], "Export PyTorch component requirements");
  run(commandName("uv"), ["pip", "install", "--python", pythonExe, "--target", componentSitePackages, "-r", join(buildRoot, "requirements-pytorch.txt")], "Install PyTorch component dependencies");
  const removedDistributions = await harvestComponentSitePackages(componentSitePackages, bundledSitePackages);
  await writeFile(join(componentStaging, BUNDLED_MANIFEST_NAME), runtimeManifestPayload(fingerprint, "pytorch-component", target));
  const componentZipPath = join(buildRoot, `frameq-pytorch-runtime-${target}.zip`);
  run(tarCommand, ["-a", "-c", "-f", componentZipPath, "-C", componentStaging, COMPONENT_SITE_PACKAGES_NAME, BUNDLED_MANIFEST_NAME], "Package PyTorch runtime component");
  await removePythonCaches(componentStaging);
  run(
    pythonExe,
    ["-c", "import funasr, torch, torchaudio; import frameq_worker"],
    "PyTorch component import smoke test",
    {
      env: {
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONPATH: [componentSitePackages, workerRoot].join(delimiter),
      },
    },
  );
  return { componentZipPath, removedDistributions };
}

async function pruneBundledPythonRuntime(root) {  const prunedFilePatterns = ["*.pdb", "*.lib", "*.pyc", "*.pyo", "*.h", "*.hpp"];
  const prunedExtensions = new Set(prunedFilePatterns.map((pattern) => pattern.slice(1)));
  const prunedDirectoryNames = new Set(["__pycache__", "tests", "test"]);

  for (const file of await walkFiles(root)) {
    if (prunedExtensions.has(file.slice(file.lastIndexOf(".")))) {
      await rm(file, { force: true });
    }
  }

  const directories = await walkDirectories(root);
  await Promise.all(
    directories
      .filter((directory) => prunedDirectoryNames.has(basename(directory)))
      .sort((left, right) => right.length - left.length)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );

  const prunedSitePackageSubdirectories = [join("torch", "include"), join("torch", "share")];
  const sitePackagesDirectories = await findSitePackagesDirectories(root);

  for (const sitePackages of sitePackagesDirectories) {
    for (const relativePath of prunedSitePackageSubdirectories) {
      const fullPath = join(sitePackages, relativePath);
      if (existsSync(fullPath) && (await stat(fullPath)).isDirectory()) {
        await rm(fullPath, { recursive: true, force: true });
      }
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const buildRoot = join(repoRoot, "build", "installer-runtime", options.target);

  if (!options.skipDownloads) {
    requireFileOrUrl(options.pythonStandaloneUrl, "PythonStandaloneUrl");
    requireFileOrUrl(options.ffmpegArchiveUrl, "FfmpegArchiveUrl");
  } else {
    await findPythonExecutable(pythonRoot);
    requireBundledFfmpeg(binRoot, options.target);
    requireBundledDeno(binRoot, options.target);
    await normalizeUnixPythonLaunchers(pythonRoot);
  }

  await resetDirectory(buildRoot);
  if (!options.skipDownloads) {
    await resetDirectory(resourcesRoot);
  }
  await mkdir(pythonRoot, { recursive: true });
  await mkdir(workerRoot, { recursive: true });
  await mkdir(binRoot, { recursive: true });
  await ensureGitKeep(resourcesRoot);
  await ensureGitKeep(pythonRoot);
  await ensureGitKeep(workerRoot);
  await ensureGitKeep(binRoot);

  if (!options.skipDownloads) {
    requireFileOrUrl(options.pythonStandaloneUrl, "PythonStandaloneUrl");
    const pythonArchive = await prepareArchiveInput(options.pythonStandaloneUrl, buildRoot, "python-standalone.archive");
    await copyStandalonePythonFromArchive(pythonArchive, pythonRoot);

    requireFileOrUrl(options.ffmpegArchiveUrl, "FfmpegArchiveUrl");
    const ffmpegArchive = await prepareArchiveInput(options.ffmpegArchiveUrl, buildRoot, "ffmpeg.archive");
    const ffprobeArchive = options.ffprobeArchiveUrl
      ? await prepareArchiveInput(options.ffprobeArchiveUrl, buildRoot, "ffprobe.archive")
      : ffmpegArchive;
    await copyFfmpegFromArchive(ffmpegArchive, ffprobeArchive, binRoot, options.target);

    const denoArchiveUrl = options.denoArchiveUrl || defaultDenoArchiveUrl(options.target, options.denoVersion);
    const denoArchive = await prepareArchiveInput(denoArchiveUrl, buildRoot, "deno.archive");
    await copyDenoFromArchive(denoArchive, binRoot, options.target);
  }

  await copyWorkerRuntime(workerRoot);
  await copyFile(join(repoRoot, "pyproject.toml"), join(resourcesRoot, "pyproject.toml"));
  await copyFile(join(repoRoot, ".env.example"), join(resourcesRoot, ".env.template"));

  const pythonExe = await findPythonExecutable(pythonRoot);
  const requirementsPath = join(buildRoot, "requirements.txt");
  run(commandName("uv"), ["export", "--no-dev", "--format", "requirements-txt", "--output-file", requirementsPath], "Export Python requirements");
  run(pythonExe, ["-m", "ensurepip", "--upgrade"], "Install bundled Python pip");
  run(pythonExe, ["-m", "pip", "install", "--upgrade", "pip"], "Upgrade bundled Python pip");
  // Force wheels for packages that leak Homebrew libraries when source-built on
  // the runner: llvmlite needs a matching LLVM (opaque CMake failure otherwise),
  // and cryptography links Homebrew OpenSSL. Failing loudly here beats shipping a
  // bundle that breaks on clean Macs.
  run(
    pythonExe,
    ["-m", "pip", "install", "--only-binary=llvmlite,cryptography", "-r", requirementsPath],
    "Install bundled Python dependencies",
  );
  await pruneBundledPythonRuntime(pythonRoot);
  if (options.target === "windows-x64") {
    await bundleWindowsVcRuntimeDlls(pythonRoot);
  }
  // PyTorch 族已外置：包内只保 ONNX 路径，funasr 与 torch 由按需组件提供。
  run(pythonExe, ["-c", "import funasr_onnx, modelscope, onnxruntime, yt_dlp; import frameq_worker"], "Python runtime smoke test", {
    env: { PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: workerRoot },
  });
  const lockFingerprint = computeLockFingerprint();
  // 包内 manifest 放进 resources/python（本身是产物目录，已被 tauri 的
  // `resources/python/**/*` 打进去），避免仓库里出现一个每次构建都会变脏的文件。
  await writeFile(
    join(pythonRoot, BUNDLED_MANIFEST_NAME),
    runtimeManifestPayload(lockFingerprint, "bundled", options.target),
  );
  const [bundledSitePackages] = await findSitePackagesDirectories(pythonRoot);
  if (!bundledSitePackages) {
    throw new Error("Could not locate the bundled site-packages directory for the component diff.");
  }
  const { componentZipPath, removedDistributions } = await buildPytorchRuntimeComponent({
    pythonExe,
    target: options.target,
    buildRoot,
    fingerprint: lockFingerprint,
    workerRoot,
    bundledSitePackages,
  });
  console.log(
    `PyTorch runtime component ready at ${componentZipPath} (${removedDistributions} shared distributions removed)`,
  );
  smokeTestDenoRuntime(binRoot, options.target, buildRoot);
  await removePythonCaches(pythonRoot);
  await removePythonCaches(workerRoot);

  if (isMacTarget(options.target)) {
    await verifyMacRuntimeSelfContained(pythonRoot);
  }

  if (!options.skipTauriBuild) {
    const tauriTarget = resolveTauriTargetTriple(options.target);
    run(commandName("npm"), ["--prefix", appRoot, "install"], "Install app dependencies");
    run(commandName("npm"), ["--prefix", appRoot, "run", "tauri", "--", "build", "--target", tauriTarget], "Build Tauri installer");
  }

  console.log(`FrameQ installer resources prepared at ${resourcesRoot}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
