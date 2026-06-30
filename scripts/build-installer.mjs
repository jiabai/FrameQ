#!/usr/bin/env node

import { createWriteStream, existsSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const validTargets = new Set(["windows-x64", "macos-arm64", "macos-x64"]);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const appRoot = join(repoRoot, "app");
const tauriRoot = join(appRoot, "src-tauri");
const resourcesRoot = join(tauriRoot, "resources");

function parseArgs(argv) {
  const options = {
    target: "windows-x64",
    pythonStandaloneUrl: process.env.FRAMEQ_PYTHON_STANDALONE_URL ?? "",
    ffmpegArchiveUrl: process.env.FRAMEQ_FFMPEG_ARCHIVE_URL ?? "",
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

  return options;
}

const options = parseArgs(process.argv.slice(2));
const buildRoot = join(repoRoot, "build", "installer-runtime", options.target);
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

function commandName(name) {
  if (process.platform === "win32" && (name === "npm" || name === "uv")) {
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
  await writeFile(join(path, ".gitkeep"), "\r\n");
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
  const archivePath = join(destinationDirectory, getArchiveLeafName(value, fallbackName));
  if (existsSync(value)) {
    await copyFile(value, archivePath);
  } else {
    await downloadArchive(value, archivePath);
  }
  return archivePath;
}

async function expandArchiveFile(archive, destination) {
  await mkdir(destination, { recursive: true });
  run("tar", ["-xf", archive, "-C", destination], `Extract archive ${archive}`);
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
    } else if (entry.isFile()) {
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

async function copyWorkerRuntime(destination) {
  await resetDirectory(destination);
  await ensureGitKeep(destination);
  await copyDirectoryContents(join(repoRoot, "worker", "frameq_worker"), join(destination, "frameq_worker"));

  const directories = await walkDirectories(destination);
  await Promise.all(
    directories
      .filter((directory) => basename(directory) === "__pycache__")
      .sort((left, right) => right.length - left.length)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

async function findPythonExecutable(root) {
  const windowsPython = join(root, "python.exe");
  const unixPython = join(root, "bin", "python3");
  if (existsSync(windowsPython)) {
    return windowsPython;
  }
  if (existsSync(unixPython)) {
    return unixPython;
  }
  throw new Error(`Could not find bundled Python executable under ${root}`);
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

async function copyStandalonePythonFromArchive(archive, destination) {
  const extractRoot = join(dirname(archive), "python-extract");
  await resetDirectory(extractRoot);
  await expandArchiveFile(archive, extractRoot);

  const pythonExe = await findFirstFile(extractRoot, ["python.exe", "python3"]);
  if (!pythonExe) {
    throw new Error("Python executable was not found in the standalone archive.");
  }

  const executableParent = dirname(pythonExe);
  const runtimeRoot = basename(executableParent) === "bin" ? dirname(executableParent) : executableParent;
  await copyDirectoryContents(runtimeRoot, destination);
}

async function copyFfmpegFromArchive(archive, destination, target) {
  const extractRoot = join(dirname(archive), "ffmpeg");
  await resetDirectory(extractRoot);
  await expandArchiveFile(archive, extractRoot);

  const requiredBinaries = target === "windows-x64" ? ["ffmpeg.exe", "ffprobe.exe"] : ["ffmpeg", "ffprobe"];
  for (const binaryName of requiredBinaries) {
    const binary = await findFirstFile(extractRoot, [binaryName]);
    if (!binary) {
      throw new Error(`${binaryName} was not found in the ffmpeg archive.`);
    }
    const destinationPath = join(destination, binaryName);
    await copyFile(binary, destinationPath);
    if (target !== "windows-x64") {
      await chmod(destinationPath, 0o755);
    }
  }
}

async function pruneBundledPythonRuntime(root) {
  const prunedFilePatterns = ["*.pdb", "*.lib", "*.pyc", "*.pyo", "*.h", "*.hpp"];
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

  const exactRuntimePaths = [
    join("Lib", "site-packages", "torch", "include"),
    join("Lib", "site-packages", "torch", "share"),
  ];

  for (const relativePath of exactRuntimePaths) {
    const fullPath = join(root, relativePath);
    if (existsSync(fullPath) && (await stat(fullPath)).isDirectory()) {
      await rm(fullPath, { recursive: true, force: true });
    }
  }
}

async function main() {
  await resetDirectory(resourcesRoot);
  await resetDirectory(buildRoot);
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
    await copyFfmpegFromArchive(ffmpegArchive, binRoot, options.target);
  }

  await copyWorkerRuntime(workerRoot);
  await copyFile(join(repoRoot, "pyproject.toml"), join(resourcesRoot, "pyproject.toml"));
  await copyFile(join(repoRoot, ".env.example"), join(resourcesRoot, ".env.template"));

  const pythonExe = await findPythonExecutable(pythonRoot);
  const requirementsPath = join(buildRoot, "requirements.txt");
  run(commandName("uv"), ["export", "--no-dev", "--format", "requirements-txt", "--output-file", requirementsPath], "Export Python requirements");
  run(pythonExe, ["-m", "ensurepip", "--upgrade"], "Install bundled Python pip");
  run(pythonExe, ["-m", "pip", "install", "--upgrade", "pip"], "Upgrade bundled Python pip");
  run(pythonExe, ["-m", "pip", "install", "-r", requirementsPath], "Install bundled Python dependencies");
  await pruneBundledPythonRuntime(pythonRoot);
  run(pythonExe, ["-c", "import funasr, modelscope, yt_dlp; import frameq_worker"], "Python runtime smoke test", {
    env: { PYTHONPATH: workerRoot },
  });

  if (!options.skipTauriBuild) {
    const tauriTarget = resolveTauriTargetTriple(options.target);
    run(commandName("npm"), ["--prefix", appRoot, "install"], "Install app dependencies");
    run(commandName("npm"), ["--prefix", appRoot, "run", "tauri", "--", "build", "--target", tauriTarget], "Build Tauri installer");
  }

  console.log(`FrameQ installer resources prepared at ${resourcesRoot}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
