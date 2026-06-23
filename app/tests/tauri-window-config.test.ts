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
const installerScriptPath = resolve(import.meta.dirname, "../../scripts/build-installer.ps1");
const workerManifestPath = resolve(import.meta.dirname, "../../pyproject.toml");
const bundledWorkerCliPath = resolve(
  import.meta.dirname,
  "../src-tauri/resources/worker/frameq_worker/cli.py",
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
      "https://frameq.8xf.pro/api/desktop/updates/{{target}}/{{arch}}/{{current_version}}?channel=stable",
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
  });

  test("installer script maps macOS targets to explicit Tauri triples", () => {
    const script = readFileSync(installerScriptPath, "utf8");

    expect(script).toContain("Resolve-TauriTargetTriple");
    expect(script).toContain('"macos-arm64" { "aarch64-apple-darwin" }');
    expect(script).toContain('"macos-x64" { "x86_64-apple-darwin" }');
    expect(script).toContain("npm --prefix $appRoot run tauri -- build --target $tauriTarget");
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
    expect(projectDependencies).toContain("torch>=2.10.0");
    expect(manifest).toContain("[project.optional-dependencies]");
    expect(manifest).toContain('qwen = ["qwen-asr>=0.0.6"]');
  });

  test("local bundled worker syncs history after insight retry when present", () => {
    if (!existsSync(bundledWorkerCliPath)) {
      return;
    }

    const workerCli = readFileSync(bundledWorkerCliPath, "utf8");
    const updateHistoryReferences =
      workerCli.match(/update_history_item_after_insight_retry\(/g)?.length ?? 0;

    expect(workerCli).toContain("def update_history_item_after_insight_retry");
    expect(updateHistoryReferences).toBeGreaterThan(1);
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

    expect(script).toContain("Prune-BundledPythonRuntime $pythonRoot");
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

    expect(script).toContain("Assert-LastCommandSucceeded");
    expect(script).toContain('Assert-LastCommandSucceeded "Python runtime smoke test"');
  });
});
