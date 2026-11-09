import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeSystemWebViewTarget, validateSystemWebViewTarget, verifySystemWebViewResources } from "../build-system-webview-host.mjs";

const resources = resolve(dirname(fileURLToPath(import.meta.url)), "../../app/src-tauri/resources/webview-host");

test("native host compilation requires the matching platform and architecture", () => {
  assert.equal(validateSystemWebViewTarget("windows-x64", "win32-x64").binary, "app-webview-host.exe");
  assert.equal(validateSystemWebViewTarget("macos-arm64", "darwin-arm64").arch, "arm64");
  assert.equal(validateSystemWebViewTarget("macos-x64", "darwin-x64").arch, "x86_64");
  assert.throws(() => validateSystemWebViewTarget("macos-arm64", "win32-x64"));
  assert.throws(() => validateSystemWebViewTarget("macos-x64", "darwin-arm64"));
  assert.throws(() => validateSystemWebViewTarget("linux-x64", "linux-x64"));
});

test("generated native host bytes match the real resource manifest", { skip: !existsSync(join(resources, "manifest.json")) }, () => {
  const manifest = verifySystemWebViewResources(resources, nativeSystemWebViewTarget());
  assert.ok(manifest.bytes > 0);
  assert.equal(manifest.sha256.length, 64);
});
