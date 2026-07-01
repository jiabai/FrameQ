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
    macOS?: {
      signingIdentity?: string | null;
      hardenedRuntime?: boolean;
    };
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

  test("ad-hoc signs the macOS bundle so downloaded DMGs avoid the damaged-app Gatekeeper failure", () => {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as TauriConfig;

    // Free ad-hoc signing (no paid Apple Developer ID): re-seals the injected
    // python/ffmpeg/worker resources so first launch degrades to the bypassable
    // "unidentified developer" prompt instead of the "app is damaged" dead end.
    expect(config.bundle.macOS?.signingIdentity).toBe("-");
    // Hardened runtime enforces library validation, which would block loading the
    // bundled torch/ffmpeg/python dylibs under an ad-hoc (team-less) signature.
    expect(config.bundle.macOS?.hardenedRuntime).toBe(false);
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
    // Archives download into per-role directories so URLs that share a leaf name
    // (e.g. evermeet .../ffmpeg/zip and .../ffprobe/zip) cannot overwrite each other.
    expect(script).toContain('basename(fallbackName, ".archive")');
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

  test("installer script normalizes Python launchers without pinning a CPython minor version", () => {
    const script = readFileSync(installerScriptPath, "utf8");

    // Launcher setup must detect python3.<minor> dynamically so bumping the
    // bundled standalone does not require editing hardcoded 3.12 paths here.
    expect(script).toContain("findVersionedUnixPythonLauncher");
    expect(script).toContain(String.raw`/^python3\.\d+$/`);
    expect(script).not.toContain('symlink("python3.12"');
    expect(script).not.toContain('join(root, "bin", "python3.12")');
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

    expect(workflow).toContain("build_windows_updater:");
    expect(workflow).toContain("if: ${{ github.event_name == 'push' || inputs.build_windows_updater }}");
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
    expect(workflow).toContain("build_macos_x64:");
    expect(workflow).toContain("needs.windows-updater-artifacts.result == 'skipped'");
    expect(workflow).toContain("github.event_name == 'push' || inputs.build_macos_x64");
    expect(workflow).toContain("runs-on: macos-15-intel");
    expect(workflow).toContain("node scripts/build-installer.mjs --target macos-x64 --skip-tauri-build");
    expect(workflow).toContain("npm --prefix app run tauri -- build --bundles dmg --target x86_64-apple-darwin");
    expect(workflow).toContain("target/x86_64-apple-darwin/release/bundle/dmg/*.dmg");
    // The Intel job re-imports the packaged runtime so a dropped .dylibs folder
    // (delocate output) fails the build before the DMG is uploaded.
    expect(workflow).toContain(
      "x86_64-apple-darwin/release/bundle/macos/FrameQ.app/Contents/Resources/resources",
    );

    expect(workflow).toContain("macos-arm64-dmg-artifact");
    expect(workflow).toContain("build_macos_arm64:");
    expect(workflow).toContain("github.event_name == 'push' || inputs.build_macos_arm64");
    expect(workflow).toContain("runs-on: macos-15");
    expect(workflow).toContain("FRAMEQ_PYTHON_STANDALONE_URL_ARM64");
    expect(workflow).toContain("FRAMEQ_FFMPEG_ARCHIVE_URL_ARM64");
    expect(workflow).toContain("FRAMEQ_FFPROBE_ARCHIVE_URL_ARM64");
    expect(workflow).toContain("node scripts/build-installer.mjs --target macos-arm64 --skip-tauri-build");
    expect(workflow).toContain("npm --prefix app run tauri -- build --bundles dmg --target aarch64-apple-darwin");
    expect(workflow).toContain("target/aarch64-apple-darwin/release/bundle/dmg/*.dmg");
    expect(workflow).toContain(
      "aarch64-apple-darwin/release/bundle/macos/FrameQ.app/Contents/Resources/resources",
    );

    // Both macOS jobs import the packaged runtime end to end (exercises the
    // delocated @loader_path links inside the built .app).
    expect(workflow).toContain(
      'import funasr, modelscope, yt_dlp; import frameq_worker; print(\'bundled runtime import OK\')',
    );
  });

  test("installer vendors and verifies self-contained macOS native dylibs", () => {
    const script = readFileSync(installerScriptPath, "utf8");
    const verifyScript = readFileSync(
      resolve(import.meta.dirname, "../../scripts/verify-macos-self-contained.mjs"),
      "utf8",
    );

    // delocate runs only on the Intel target that lacks prebuilt native wheels.
    expect(script).toContain('target === "macos-x64"');
    expect(script).toContain('"--from", "delocate", "delocate-path"');
    // Both macOS arches run the static self-containment guard.
    expect(script).toContain("prepareSelfContainedMacRuntime");
    expect(script).toContain("verify-macos-self-contained.mjs");

    // The guard rejects Homebrew/MacPorts prefixes that break on clean Macs.
    expect(verifyScript).toContain("delocate-listdeps");
    expect(verifyScript).toContain('"/usr/local/"');
    expect(verifyScript).toContain('"/opt/homebrew/"');
    expect(verifyScript).toContain('"/opt/local/"');
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
    // macOS Intel pins numba/llvmlite to the last releases with prebuilt x86_64
    // wheels, so pip never source-builds llvmlite (which needs LLVM).
    expect(projectDependencies).toContain("llvmlite==0.45.1");
    expect(projectDependencies).toContain("numba==0.62.1");
    expect(manifest).toContain("[project.optional-dependencies]");
    expect(manifest).toContain('qwen = ["qwen-asr>=0.0.6"]');
  });

  test("installer forces llvmlite to install from a prebuilt wheel", () => {
    const script = readFileSync(installerScriptPath, "utf8");

    // A source build of llvmlite needs a matching LLVM the runners lack, so the
    // pip install must refuse to fall back to it.
    expect(script).toContain('"--only-binary=llvmlite"');
  });

  test("worker manifest documents the macOS Intel CPython constraint for the torch pin", () => {
    const manifest = readFileSync(workerManifestPath, "utf8");

    // torch==2.2.2 macOS x86_64 wheels stop at cp312, so the bundled standalone
    // must stay on CPython 3.11/3.12. Keep that rationale next to the pin so the
    // secret FRAMEQ_PYTHON_STANDALONE_URL_MACOS_X64 is not bumped blindly.
    expect(manifest).toContain("cp312");
    expect(manifest).toContain("FRAMEQ_PYTHON_STANDALONE_URL_MACOS_X64");
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

  test("installer script prunes torch include/share on both Windows and macOS site-packages layouts", () => {
    const script = readFileSync(installerScriptPath, "utf8");

    expect(script).toContain("findSitePackagesDirectories");
    expect(script).toContain('join("torch", "include")');
    expect(script).toContain('join("torch", "share")');
    // Windows keeps Lib/site-packages; python-build-standalone on macOS/Linux nests
    // it under lib/python3.<minor>/site-packages, so both must be resolved.
    expect(script).toContain('join(root, "Lib", "site-packages")');
    expect(script).toContain('join(unixLib, entry.name, "site-packages")');
  });

  test("installer script fails when external build commands fail", () => {
    const script = readFileSync(installerScriptPath, "utf8");

    expect(script).toContain("function run(command, args, description");
    expect(script).toContain("Python runtime smoke test");
    expect(script).toContain("failed with exit code");
  });
});
