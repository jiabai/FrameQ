import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resources = join(repository, "app", "src-tauri", "resources", "webview-host");
const sources = join(repository, "app", "native-webview-host");
const targets = new Map([
  ["windows-x64", { host: "win32-x64", triple: "x86_64-pc-windows-msvc", binary: "frameq-webview-host.exe" }],
  ["macos-arm64", { host: "darwin-arm64", triple: "arm64-apple-macos14.0", binary: "FrameQWebViewHost.app/Contents/MacOS/frameq-webview-host", arch: "arm64" }],
  ["macos-x64", { host: "darwin-x64", triple: "x86_64-apple-macos14.0", binary: "FrameQWebViewHost.app/Contents/MacOS/frameq-webview-host", arch: "x86_64" }],
]);
const helperIdentifier = "com.frameq.webview-host";

export function validateSystemWebViewTarget(target, host = `${process.platform}-${process.arch}`) {
  const configuration = targets.get(target);
  if (!configuration || configuration.host !== host) {
    throw new Error(`System WebView host target ${target} requires its matching native runner (${host}).`);
  }
  return configuration;
}

export function nativeSystemWebViewTarget() {
  const target = [...targets].find(([, value]) => value.host === `${process.platform}-${process.arch}`)?.[0];
  if (!target) throw new Error(`System WebView host is unsupported on ${process.platform}-${process.arch}.`);
  return target;
}

function run(command, args, { capture = false, input, env } = {}) {
  const result = spawnSync(command, args, {
    cwd: repository, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    stdio: capture || input !== undefined ? "pipe" : "inherit", input,
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${capture ? result.stderr.trim() : "see command output"}`);
  }
  return capture ? result.stdout : "";
}

function requireRegularFile(path) {
  const information = lstatSync(path);
  if (!information.isFile() || information.isSymbolicLink() || information.size <= 0 || information.size > 64 * 1024 * 1024) {
    throw new Error(`Native WebView host is missing or invalid: ${path}`);
  }
  return information;
}

function plistValue(path, key) {
  return run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", path], { capture: true }).trim();
}

function verifyMacHelper(root, configuration) {
  const bundle = join(root, "FrameQWebViewHost.app");
  const binary = join(root, configuration.binary);
  requireRegularFile(binary);
  if (run("/usr/bin/lipo", ["-archs", binary], { capture: true }).trim() !== configuration.arch) {
    throw new Error("The macOS WebView host architecture does not match its native target.");
  }
  const info = join(bundle, "Contents", "Info.plist");
  if (plistValue(info, "CFBundleIdentifier") !== helperIdentifier ||
      plistValue(info, "CFBundleExecutable") !== "frameq-webview-host" ||
      plistValue(info, "LSMinimumSystemVersion") !== "14.0") {
    throw new Error("The macOS WebView host bundle identity is invalid.");
  }
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R", `=identifier "${helperIdentifier}"`, bundle]);
  const entitlementXML = run("/usr/bin/codesign", ["--display", "--entitlements", "-", "--xml", bundle], { capture: true });
  const entitlements = JSON.parse(run("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], { capture: true, input: entitlementXML }));
  const allowed = new Set(["com.apple.security.app-sandbox", "com.apple.security.network.client",
    "com.apple.application-identifier", "com.apple.developer.team-identifier"]);
  if (entitlements["com.apple.security.app-sandbox"] !== true || entitlements["com.apple.security.network.client"] !== true ||
      Object.keys(entitlements).some((key) => !allowed.has(key))) {
    throw new Error("The macOS WebView host must retain its dedicated Sandbox and network.client entitlements.");
  }
}

export function verifySystemWebViewResources(root, target) {
  const configuration = validateSystemWebViewTarget(target);
  const manifestPath = join(root, "manifest.json");
  if (requireRegularFile(manifestPath).size > 16 * 1024) throw new Error("Native WebView host manifest exceeds its limit.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const fields = ["schema_version", "target", "binary", "bytes", "sha256"];
  if (!manifest || Array.isArray(manifest) || Object.keys(manifest).length !== fields.length ||
      !fields.every((key) => Object.hasOwn(manifest, key)) || manifest.schema_version !== 1 ||
      manifest.target !== target || manifest.binary !== configuration.binary || !Number.isSafeInteger(manifest.bytes) ||
      manifest.bytes <= 0 || typeof manifest.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error("Native WebView host manifest is invalid.");
  }
  const binary = join(root, configuration.binary);
  if (requireRegularFile(binary).size !== manifest.bytes ||
      createHash("sha256").update(readFileSync(binary)).digest("hex") !== manifest.sha256) {
    throw new Error("Native WebView host bytes do not match the packaged manifest.");
  }
  if (target.startsWith("macos-")) verifyMacHelper(root, configuration);
  return manifest;
}

export function verifyPackagedSystemWebViewHost(appBundle, target) {
  validateSystemWebViewTarget(target);
  if (!target.startsWith("macos-")) throw new Error("App bundle verification requires macOS.");
  return verifySystemWebViewResources(join(resolve(appBundle), "Contents", "Resources", "resources", "webview-host"), target);
}

export function verifySystemWebViewDmg(dmg, target) {
  validateSystemWebViewTarget(target);
  if (!target.startsWith("macos-")) throw new Error("DMG verification requires macOS.");
  const mount = join(repository, "build", "system-webview-host", `dmg-verify-${randomUUID()}`);
  mkdirSync(mount, { recursive: true });
  run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, resolve(dmg)]);
  try { return verifyPackagedSystemWebViewHost(join(mount, "FrameQ.app"), target); }
  finally { run("/usr/bin/hdiutil", ["detach", mount]); }
}

export function testMacHostProtocol() {
  const target = nativeSystemWebViewTarget();
  if (!target.startsWith("macos-")) throw new Error("Swift protocol tests require macOS.");
  const output = join(repository, "build", "system-webview-host", target, "protocol-tests");
  mkdirSync(dirname(output), { recursive: true });
  run("/usr/bin/xcrun", ["swiftc", "-swift-version", "5", "-parse-as-library",
    "-module-cache-path", join(dirname(output), "protocol-module-cache"),
    join(sources, "macos", "HostProtocol.swift"), join(sources, "macos", "tests", "ProtocolTests.swift"), "-o", output],
  { env: { TMPDIR: dirname(output) } });
  run(output, []);
}

export function buildSystemWebViewHost({ target = nativeSystemWebViewTarget() } = {}) {
  const configuration = validateSystemWebViewTarget(target);
  const buildRoot = join(repository, "build", "system-webview-host", target);
  mkdirSync(buildRoot, { recursive: true });
  // 只清理构建器专用的固定资源目录；不接受外部传入的删除路径。
  if (resolve(resources) !== join(repository, "app", "src-tauri", "resources", "webview-host")) {
    throw new Error("Native WebView resource directory is outside its build location.");
  }
  rmSync(resources, { recursive: true, force: true });
  mkdirSync(resources, { recursive: true });
  const destination = join(resources, configuration.binary);
  mkdirSync(dirname(destination), { recursive: true });
  if (target === "windows-x64") {
    const cargoTarget = join(buildRoot, "cargo-target");
    run("cargo", ["build", "--locked", "--release", "--target", configuration.triple,
      "--manifest-path", join(sources, "windows", "Cargo.toml")], { env: { CARGO_TARGET_DIR: cargoTarget } });
    const builtBinary = join(cargoTarget, configuration.triple, "release", "frameq-webview-host.exe");
    requireRegularFile(builtBinary);
    copyFileSync(builtBinary, destination);
  } else {
    const mac = join(sources, "macos");
    const moduleCache = join(buildRoot, "module-cache");
    mkdirSync(moduleCache, { recursive: true });
    run("/usr/bin/xcrun", ["swiftc", "-swift-version", "5", "-parse-as-library", "-O", "-target", configuration.triple,
      "-module-cache-path", moduleCache, "-framework", "AppKit", "-framework", "WebKit", "-framework", "Network", "-framework", "Security",
      ...["Main", "HostProtocol", "WebPageHost", "PolicyDelegate", "Extraction"].map((name) => join(mac, `${name}.swift`)), "-o", destination],
    { env: { TMPDIR: buildRoot } });
    chmodSync(destination, 0o755);
    const bundle = join(resources, "FrameQWebViewHost.app");
    copyFileSync(join(mac, "Info.plist"), join(bundle, "Contents", "Info.plist"));
    run("/usr/bin/codesign", ["--force", "--sign", "-", "--identifier", helperIdentifier, "--entitlements", join(mac, "entitlements.plist"), bundle]);
    verifyMacHelper(resources, configuration);
  }
  const information = requireRegularFile(destination);
  const manifest = { schema_version: 1, target, binary: configuration.binary, bytes: information.size,
    sha256: createHash("sha256").update(readFileSync(destination)).digest("hex") };
  writeFileSync(join(resources, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  verifySystemWebViewResources(resources, target);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argumentsList = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const flag = argumentsList[index];
    if (["--target", "--verify-bundle", "--verify-dmg"].includes(flag)) {
      const value = argumentsList[++index];
      if (!value) throw new Error(`Missing value for ${flag}.`);
      options[flag] = value;
    } else if (flag === "--test-protocol") options[flag] = true;
    else throw new Error(`Unknown native WebView host argument: ${flag}`);
  }
  const target = options["--target"] ?? nativeSystemWebViewTarget();
  const actions = ["--verify-bundle", "--verify-dmg", "--test-protocol"].filter((flag) => options[flag]);
  if (actions.length > 1) throw new Error("Select one native WebView host action.");
  if (options["--verify-bundle"]) verifyPackagedSystemWebViewHost(options["--verify-bundle"], target);
  else if (options["--verify-dmg"]) verifySystemWebViewDmg(options["--verify-dmg"], target);
  else if (options["--test-protocol"]) testMacHostProtocol();
  else {
    const manifest = buildSystemWebViewHost({ target });
    process.stdout.write(`System WebView host: ${manifest.target}, ${manifest.bytes} bytes, SHA-256 ${manifest.sha256}\n`);
  }
}
