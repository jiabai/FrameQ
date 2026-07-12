import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = resolve(
  repositoryRoot,
  ".github/workflows/macos-intel-acceptance.yml",
);
const deletionSourcePath = resolve(
  repositoryRoot,
  "app/src-tauri/src/history_deletion.rs",
);

test("builds one manual internal Intel macOS artifact with native tests and read-only permissions", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^name:\s*macOS Intel Acceptance Artifact/m);
  assert.match(
    workflow,
    /^on:\s*\r?\n\s+push:\s*\r?\n\s+branches:\s*\r?\n\s+- codex\/history-delete-macos-intel-acceptance\s*\r?\n\s+workflow_dispatch:\s*$/m,
  );
  assert.match(workflow, /permissions:\s*\r?\n\s+contents:\s*read/);
  assert.match(workflow, /runs-on:\s*macos-15-intel/);
  assert.match(workflow, /timeout-minutes:\s*90/);
  assert.match(workflow, /uses:\s*actions\/checkout@v4/);
  assert.match(workflow, /uses:\s*actions\/setup-node@v4/);
  assert.match(workflow, /uses:\s*dtolnay\/rust-toolchain@stable/);
  assert.match(workflow, /targets:\s*x86_64-apple-darwin/);
  assert.match(workflow, /uses:\s*astral-sh\/setup-uv@v6/);
  assert.match(workflow, /run:\s*npm ci --prefix app/);
  assert.match(
    workflow,
    /run:\s*cargo test --manifest-path app\/src-tauri\/Cargo\.toml --target x86_64-apple-darwin/,
  );
  assert.match(
    workflow,
    /run:\s*node scripts\/build-installer\.mjs --target macos-x64 --skip-tauri-build/,
  );
  assert.match(
    workflow,
    /run:\s*>-[\s\S]{0,120}npm --prefix app run tauri -- build --bundles app[\s\S]{0,80}--target x86_64-apple-darwin/,
  );
  assert.match(workflow, /createUpdaterArtifacts\":false/);
  assert.match(
    workflow,
    /EXECUTABLE="\$\(\/usr\/libexec\/PlistBuddy -c 'Print :CFBundleExecutable' "\$APP\/Contents\/Info\.plist"\)"/,
  );
  assert.match(workflow, /BIN="\$APP\/Contents\/MacOS\/\$EXECUTABLE"/);
  assert.match(workflow, /test -f "\$BIN"/);
  assert.match(workflow, /file "\$BIN"/);
  assert.match(workflow, /lipo -archs "\$BIN"/);
  assert.match(workflow, /import funasr, modelscope, yt_dlp; import frameq_worker/);
  assert.match(workflow, /bundled deno OK/);
  assert.match(workflow, /codesign --verify --deep --strict --verbose=4 "\$APP"/);
  assert.match(
    workflow,
    /bash scripts\/make-macos-dmg\.sh x86_64-apple-darwin FrameQ/,
  );
  assert.match(workflow, /shasum -a 256 "\$DMG" > "\$DMG\.sha256"/);
  assert.match(workflow, /uses:\s*actions\/upload-artifact@v4/);
  assert.match(workflow, /retention-days:\s*7/);
  assert.match(workflow, /if-no-files-found:\s*error/);
  assert.match(workflow, /path:\s*\|[\s\S]*\.dmg[\s\S]*\.dmg\.sha256/);

  const referencedSecrets = [...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(referencedSecrets, [
    "FRAMEQ_FFMPEG_ARCHIVE_URL_MACOS_X64",
    "FRAMEQ_FFPROBE_ARCHIVE_URL_MACOS_X64",
    "FRAMEQ_PYTHON_STANDALONE_URL_MACOS_X64",
  ]);

  assert.doesNotMatch(workflow, /^\s+(pull_request|schedule|release):/m);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /gh release|tauri-action|desktop-release/i);
  assert.doesNotMatch(workflow, /TAURI_SIGNING|APPLE_|NOTARY|DEVELOPER_ID/i);
  assert.doesNotMatch(workflow, /WECHAT|LLM|PAYMENT/i);
  assert.doesNotMatch(workflow, /ubuntu|apt-get|libwebkit/i);
});

test("the hosted Cargo suite contains real deletion and macOS link fixtures", async () => {
  const source = await readFile(deletionSourcePath, "utf8");

  assert.match(source, /fn deletes_only_the_supported_task_and_its_playback_cache\(\)/);
  assert.match(source, /fn rejects_linked_tasks_root_before_removal\(\)/);
  assert.match(source, /fn rejects_linked_playback_cache_root_before_task_removal\(\)/);
  assert.match(
    source,
    /#\[cfg\(unix\)\][\s\S]{0,100}fn rejects_dangling_playback_cache_symlink_before_task_removal\(\)/,
  );
  assert.match(
    source,
    /#\[cfg\(unix\)\][\s\S]{0,150}fn create_dir_link[\s\S]{0,150}std::os::unix::fs::symlink/,
  );
});
