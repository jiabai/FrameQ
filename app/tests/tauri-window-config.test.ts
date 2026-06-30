import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type TauriWindowConfig = {
  title: string;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  decorations?: boolean;
  shadow?: boolean;
  center?: boolean;
};

type TauriConfig = {
  app: {
    windows: TauriWindowConfig[];
  };
  bundle: {
    targets: string[];
    resources: string[];
    createUpdaterArtifacts?: boolean;
  };
  plugins?: {
    updater?: {
      pubkey?: string;
      endpoints?: string[];
      windows?: {
        installMode?: string;
      };
    };
  };
};

const configPath = resolve(import.meta.dirname, "../src-tauri/tauri.conf.json");
const capabilityPath = resolve(import.meta.dirname, "../src-tauri/capabilities/default.json");
const cargoManifestPath = resolve(import.meta.dirname, "../src-tauri/Cargo.toml");
const installerScriptPath = resolve(import.meta.dirname, "../../scripts/build-installer.mjs");
const rootEnvExamplePath = resolve(import.meta.dirname, "../../.env.example");
const desktopReleaseWorkflowPath = resolve(
  import.meta.dirname,
  "../../.github/workflows/desktop-release.yml",
);
const workerManifestPath = resolve(import.meta.dirname, "../../pyproject.toml");
const bundledWorkerCliPath = resolve(
  import.meta.dirname,
  "../src-tauri/resources/worker/frameq_worker/cli.py",
);
const bundledWorkerHistoryPath = resolve(
  import.meta.dirname,
  "../src-tauri/resources/worker/frameq_worker/history.py",
);
const bundledWorkerModelDownloadPath = resolve(
  import.meta.dirname,
  "../src-tauri/resources/worker/frameq_worker/model_download.py",
);

describe("Tauri desktop window configuration", () => {
  test("uses the custom macOS-style app chrome instead of the native titlebar", () => {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as TauriConfig;
    const [mainWindow] = config.app.windows;

    expect(mainWindow).toMatchObject({
      title: "FrameQ",
      width: 1180,
      height: 760,
      minWidth: 720,
      minHeight: 640,
      decorations: false,
      shadow: true,
      center: true,
    });
  });

  test("allows the custom chrome to control the Tauri window", () => {
    const capability = JSON.parse(readFileSync(capabilityPath, "utf8")) as {
      permissions: string[];
    };

    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-start-dragging",
        "core:window:allow-close",
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
      ]),
    );
  });

  test("bundles the local runtime resources required for ordinary users", () => {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as TauriConfig;

    expect(config.bundle.targets).toEqual(expect.arrayContaining(["nsis", "dmg"]));
    expect(config.bundle.resources).toEqual(
      expect.arrayContaining([
        "resources/python/**/*",
        "resources/worker/**/*",
        "resources/bin/**/*",
        "resources/pyproject.toml",
        "resources/.env.template",
      ]),
    );
    expect(config.bundle.resources).not.toContain("resources/models/**/*");
  });

  test("enables signed updater artifacts without bundling model resources", () => {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as TauriConfig;

    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(config.plugins?.updater?.pubkey).toEqual(expect.any(String));
    expect(config.plugins?.updater?.pubkey?.length).toBeGreaterThan(80);
    expect(config.plugins?.updater?.endpoints).toEqual([
      "https://github.com/jiabai/FrameQ/releases/latest/download/latest.json?frameq-updater=1",
    ]);
    expect(config.plugins?.updater?.windows?.installMode).toBe("passive");
    expect(config.bundle.resources).not.toContain("resources/models/**/*");
  });

  test("allows updater and process plugin commands from the main window", () => {
    const capability = JSON.parse(readFileSync(capabilityPath, "utf8")) as {
      permissions: string[];
    };

    expect(capability.permissions).toEqual(
      expect.arrayContaining(["updater:default", "process:default"]),
    );
  });

  test("uses release-grade application metadata", () => {
    const manifest = readFileSync(cargoManifestPath, "utf8");

    expect(manifest).toContain('description = "FrameQ desktop video transcription client"');
    expect(manifest).toContain('authors = ["FrameQ"]');
    expect(manifest).toContain('tauri-plugin-updater = "2"');
    expect(manifest).toContain('tauri-plugin-process = "2"');
    expect(manifest).not.toContain('description = "A Tauri App"');
    expect(manifest).not.toContain('authors = ["you"]');
  });

  test("installer script builds a lightweight runtime without bundled model resources", () => {
    const script = readFileSync(installerScriptPath, "utf8");

    expect(script).not.toContain("SenseVoiceModelDir");
    expect(script).not.toContain("FRAMEQ_SENSEVOICE_MODEL_DIR");
    expect(script).not.toContain("resources\\models");
    expect(script).not.toContain("Copy-SenseVoiceModelCache");
    expect(script).not.toContain("Require-DirectoryWithFiles");
    expect(script).toContain("copyWorkerRuntime(workerRoot)");
    expect(script).toContain('join(repoRoot, "worker", "frameq_worker")');
    expect(script).toContain("normalizeUnixPythonLaunchers");
    expect(script).toContain("PYTHONDONTWRITEBYTECODE");
    expect(script).not.toContain("powershell");
    expect(script).not.toContain("pwsh");
  });

  test("installer script can use a separate ffprobe archive when ffmpeg is split", () => {
    const script = readFileSync(installerScriptPath, "utf8");

    expect(script).toContain("ffprobeArchiveUrl");
    expect(script).toContain("FRAMEQ_FFPROBE_ARCHIVE_URL");
    expect(script).toContain("--ffprobe-archive-url");
    expect(script).toContain("const ffprobeArchive = options.ffprobeArchiveUrl");
    expect(script).toContain("await copyFfmpegFromArchive(ffmpegArchive, ffprobeArchive, binRoot, options.target)");
  });

  test("installer script normalizes macOS Python launchers when reusing runtime resources", () => {
    const script = readFileSync(installerScriptPath, "utf8");
    const mainScript = script.slice(script.indexOf("async function main()"));
    const skipDownloadsBranch =
      mainScript.match(/} else \{([\s\S]*?)\n  \}\n\n  await resetDirectory\(buildRoot\);/)?.[1] ?? "";

    expect(skipDownloadsBranch).toContain("await findPythonExecutable(pythonRoot)");
    expect(skipDownloadsBranch).toContain("requireBundledFfmpeg(binRoot, options.target)");
    expect(skipDownloadsBranch).toContain("await normalizeUnixPythonLaunchers(pythonRoot)");
  });

  test("installer script has a tracked local settings template to bundle", () => {
    expect(existsSync(rootEnvExamplePath)).toBe(true);
    const script = readFileSync(installerScriptPath, "utf8");
    const envExample = readFileSync(rootEnvExamplePath, "utf8");

    expect(script).toContain('join(repoRoot, ".env.example")');
    expect(envExample).toContain("FRAMEQ_OUTPUT_DIR=");
    expect(envExample).toContain("FRAMEQ_ASR_MODEL=iic/SenseVoiceSmall");
    expect(envExample).not.toContain("FRAMEQ_LLM_API_KEY");
    expect(envExample).not.toContain("FRAMEQ_LLM_BASE_URL");
    expect(envExample).not.toContain("FRAMEQ_LLM_MODEL=");
  });

  test("installer script maps macOS targets to explicit Tauri triples", () => {
    const script = readFileSync(installerScriptPath, "utf8");

    expect(script).toContain("resolveTauriTargetTriple");
    expect(script).toContain('case "macos-arm64":');
    expect(script).toContain('return "aarch64-apple-darwin"');
    expect(script).toContain('case "macos-x64":');
    expect(script).toContain('return "x86_64-apple-darwin"');
    expect(script).toContain('"tauri", "--", "build", "--target", tauriTarget');
  });

  test("desktop release workflow publishes GitHub-hosted updater metadata", () => {
    expect(existsSync(desktopReleaseWorkflowPath)).toBe(true);
    const workflow = readFileSync(desktopReleaseWorkflowPath, "utf8");

    expect(workflow).toContain("tauri-apps/tauri-action@v0");
    expect(workflow).toContain("includeUpdaterJson: true");
    expect(workflow).toContain("updaterJsonPreferNsis: true");
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(workflow).toContain("FRAMEQ_PYTHON_STANDALONE_URL");
    expect(workflow).toContain("FRAMEQ_FFMPEG_ARCHIVE_URL");
    expect(workflow).toContain("node scripts\\build-installer.mjs --target windows-x64 --skip-tauri-build");
    expect(workflow).not.toContain("shell: pwsh");
    expect(workflow).not.toContain("build-installer.ps1");
  });

  test("desktop release workflow builds separate macOS Intel and Apple Silicon DMGs", () => {
    const workflow = readFileSync(desktopReleaseWorkflowPath, "utf8");

    expect(workflow).toContain("macos-x64-dmg-artifact");
    expect(workflow).toContain("runs-on: macos-15-intel");
    expect(workflow).toContain("node scripts/build-installer.mjs --target macos-x64 --skip-tauri-build");
    expect(workflow).toContain("npm --prefix app run tauri -- build --bundles dmg --target x86_64-apple-darwin");
    expect(workflow).toContain("target/x86_64-apple-darwin/release/bundle/dmg/*.dmg");

    expect(workflow).toContain("macos-arm64-dmg-artifact");
    expect(workflow).toContain("runs-on: macos-15");
    expect(workflow).toContain("FRAMEQ_PYTHON_STANDALONE_URL_ARM64");
    expect(workflow).toContain("FRAMEQ_FFMPEG_ARCHIVE_URL_ARM64");
    expect(workflow).toContain("FRAMEQ_FFPROBE_ARCHIVE_URL_ARM64");
    expect(workflow).toContain("node scripts/build-installer.mjs --target macos-arm64 --skip-tauri-build");
    expect(workflow).toContain("npm --prefix app run tauri -- build --bundles dmg --target aarch64-apple-darwin");
    expect(workflow).toContain("target/aarch64-apple-darwin/release/bundle/dmg/*.dmg");
  });

  test("installer runtime still includes ModelScope for first-run model download", () => {
    const script = readFileSync(installerScriptPath, "utf8");

    expect(script).toContain("import funasr, modelscope, yt_dlp; import frameq_worker");
    expect(script).not.toContain("MODEL_VERSION.txt");
  });

  test("installer release runtime does not install Qwen ASR by default", () => {
    const manifest = readFileSync(workerManifestPath, "utf8");
    const projectDependencies = manifest.match(/dependencies = \[([\s\S]*?)\]\s*\n/)?.[1] ?? "";

    expect(projectDependencies).not.toContain("qwen-asr");
    expect(projectDependencies).toContain("numpy<2");
    expect(projectDependencies).toContain("torch==2.2.2");
    expect(projectDependencies).toContain("torch>=2.10.0");
    expect(projectDependencies).toContain("torchaudio==2.2.2");
    expect(projectDependencies).toContain("torchaudio>=2.10.0");
    expect(projectDependencies).toContain("platform_machine == 'x86_64'");
    expect(manifest).toContain("[project.optional-dependencies]");
    expect(manifest).toContain('qwen = ["qwen-asr>=0.0.6"]');
  });

  test("local bundled worker syncs history after insight retry when present", () => {
    if (!existsSync(bundledWorkerCliPath) || !existsSync(bundledWorkerHistoryPath)) {
      return;
    }

    const workerCli = readFileSync(bundledWorkerCliPath, "utf8");
    const workerHistory = readFileSync(bundledWorkerHistoryPath, "utf8");

    expect(workerHistory).toContain("def update_history_item_after_insight_retry");
    expect(workerCli).toContain("update_history_item_after_insight_retry");
  });

  test("local bundled worker uses canonical ASR model cache layout when present", () => {
    if (!existsSync(bundledWorkerModelDownloadPath)) {
      return;
    }

    const modelDownload = readFileSync(bundledWorkerModelDownloadPath, "utf8");

    expect(modelDownload).toContain("def normalize_asr_model_cache_layout");
    expect(modelDownload).toContain("modelscope_cache_dir = _canonical_model_root(cache_dir)");
    expect(modelDownload).toContain("cache_dir=modelscope_cache_dir");
  });

  test("installer script prunes non-runtime Python artifacts before bundling", () => {
    const script = readFileSync(installerScriptPath, "utf8");

    expect(script).toContain("pruneBundledPythonRuntime(pythonRoot)");
    expect(script).toContain('"*.pdb"');
    expect(script).toContain('"*.lib"');
    expect(script).toContain('"__pycache__"');
    expect(script).toContain('"tests"');
    expect(script).toContain('"include"');
    expect(script).not.toContain('@("Lib", "site-packages", "torch", "testing")');
    expect(script).not.toContain('"*.pyi"');
  });

  test("installer script fails when external build commands fail", () => {
    const script = readFileSync(installerScriptPath, "utf8");

    expect(script).toContain("function run(command, args, description");
    expect(script).toContain("Python runtime smoke test");
    expect(script).toContain("failed with exit code");
  });
});
