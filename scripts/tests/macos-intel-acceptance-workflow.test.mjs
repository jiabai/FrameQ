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
  "app/src-tauri/src/history_deletion/tests.rs",
);

test("builds manual internal macOS artifacts for both architectures with read-only permissions", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^name:\s*macOS Acceptance Artifacts/m);
  assert.match(workflow, /^on:\s*\r?\n\s+workflow_dispatch:\s*$/m);
  assert.match(workflow, /permissions:\s*\r?\n\s+contents:\s*read/);
  assert.match(workflow, /runs-on:\s*\$\{\{ matrix\.runner \}\}/);
  assert.match(workflow, /fail-fast:\s*false/);
  assert.match(workflow, /platform:\s*macos-x64\s+runner:\s*macos-15-intel\s+target:\s*x86_64-apple-darwin\s+arch:\s*x86_64/);
  assert.match(workflow, /platform:\s*macos-arm64\s+runner:\s*macos-15\s+target:\s*aarch64-apple-darwin\s+arch:\s*arm64/);
  assert.match(workflow, /timeout-minutes:\s*90/);
  assert.match(workflow, /uses:\s*actions\/checkout@v5/);
  assert.match(workflow, /uses:\s*actions\/setup-node@v5/);
  assert.match(workflow, /uses:\s*dtolnay\/rust-toolchain@stable/);
  assert.match(workflow, /targets:\s*\$\{\{ matrix\.target \}\}/);
  assert.match(
    workflow,
    /uses:\s*astral-sh\/setup-uv@11f9893b081a58869d3b5fccaea48c9e9e46f990/,
  );
  assert.doesNotMatch(
    workflow,
    /actions\/checkout@v4|actions\/setup-node@v4|astral-sh\/setup-uv@(?:v6|v8)|node20/i,
  );
  assert.match(workflow, /run:\s*npm ci --prefix app/);
  assert.match(
    workflow,
    /run:\s*cargo test --manifest-path app\/src-tauri\/Cargo\.toml --target \$\{\{ matrix\.target \}\}/,
  );
  assert.match(
    workflow,
    /run:\s*node scripts\/build-installer\.mjs --target \$\{\{ matrix\.platform \}\} --skip-tauri-build/,
  );
  assert.match(
    workflow,
    /run:\s*>-[\s\S]{0,120}npm --prefix app run tauri -- build --bundles app[\s\S]{0,80}--target \$\{\{ matrix\.target \}\}/,
  );
  assert.match(workflow, /createUpdaterArtifacts\":false/);
  const prepare = workflow.indexOf("name: Prepare bundled runtime resources");
  const build = workflow.indexOf("name: Build internal macOS app bundle");
  const native = workflow.indexOf("name: Extract, save and reopen real static and dynamic pages");
  assert(prepare >= 0 && build > prepare && native > build);
  assert.match(workflow, /real_system_webview_static_and_dynamic_notes_are_saved_and_reopened -- --ignored --nocapture/);
  assert.match(workflow, /run:\s*node scripts\/verify-packaged-worker\.mjs/);
  assert.match(
    workflow,
    /EXECUTABLE="\$\(\/usr\/libexec\/PlistBuddy -c 'Print :CFBundleExecutable' "\$APP\/Contents\/Info\.plist"\)"/,
  );
  assert.match(workflow, /BIN="\$APP\/Contents\/MacOS\/\$EXECUTABLE"/);
  assert.match(workflow, /test -f "\$BIN"/);
  assert.match(workflow, /file "\$BIN"/);
  assert.match(workflow, /lipo -archs "\$BIN"/);
  assert.match(workflow, /test "\$\(lipo -archs "\$BIN"\)" = "\$\{\{ matrix\.arch \}\}"/);
  assert.match(
    workflow,
    /import funasr_onnx, modelscope, onnxruntime, yt_dlp; import worker_core/,
  );
  assert.match(workflow, /bundled deno OK/);
  assert.match(workflow, /codesign --verify --deep --strict --verbose=4 "\$APP"/);
  assert.match(
    workflow,
    /bash scripts\/make-macos-dmg\.sh \$\{\{ matrix\.target \}\} Locus/,
  );
  assert.match(workflow, /--target \$\{\{ matrix\.platform \}\} --verify-bundle "\$APP"/);
  assert.match(workflow, /hdiutil verify "\$DMG"/);
  assert.match(workflow, /hdiutil attach -readonly -nobrowse -mountpoint "\$MOUNT" "\$DMG"/);
  assert.match(workflow, /trap 'hdiutil detach "\$MOUNT"' EXIT/);
  assert.match(workflow, /codesign --verify --deep --strict --verbose=4 "\$MOUNT\/Locus\.app"/);
  assert.match(workflow, /--target \$\{\{ matrix\.platform \}\} --verify-bundle "\$MOUNT\/Locus\.app"/);
  assert.match(workflow, /shasum -a 256 "\$DMG" > "\$DMG\.sha256"/);
  assert.match(workflow, /uses:\s*actions\/upload-artifact@v6/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact@(?:v4|v5)/);
  assert.match(workflow, /retention-days:\s*7/);
  assert.match(workflow, /if-no-files-found:\s*error/);
  assert.match(workflow, /path:\s*\|[\s\S]*\.dmg[\s\S]*\.dmg\.sha256/);

  const referencedSecrets = [...workflow.matchAll(/(?:python|ffmpeg|ffprobe)_archive:\s*([A-Z0-9_]+)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(referencedSecrets, [
    "FRAMEQ_FFMPEG_ARCHIVE_URL_ARM64",
    "FRAMEQ_FFMPEG_ARCHIVE_URL_MACOS_X64",
    "FRAMEQ_FFPROBE_ARCHIVE_URL_ARM64",
    "FRAMEQ_FFPROBE_ARCHIVE_URL_MACOS_X64",
    "FRAMEQ_PYTHON_STANDALONE_URL_ARM64",
    "FRAMEQ_PYTHON_STANDALONE_URL_MACOS_X64",
  ]);
  for (const component of ["python", "ffmpeg", "ffprobe"]) {
    assert.match(workflow, new RegExp(`secrets\\[matrix\\.${component}_archive\\]`));
  }
  assert.equal([...workflow.matchAll(/secrets\[/g)].length, 3);
  assert.doesNotMatch(workflow, /secrets\./);
  // Secret names are repository-level external identities, not code identifiers. The
  // de-branding sweep renamed them to APP_* and every runner received empty values.
  // Keep the neutral APP_* environment variable names that scripts consume while
  // locking the GitHub Secret keys to the names that actually exist in the repo.
  assert.match(
    workflow,
    /APP_PYTHON_STANDALONE_URL:\s*\$\{\{ secrets\[matrix\.python_archive\] \}\}/,
  );
  assert.match(
    workflow,
    /APP_FFMPEG_ARCHIVE_URL:\s*\$\{\{ secrets\[matrix\.ffmpeg_archive\] \}\}/,
  );
  assert.match(
    workflow,
    /APP_FFPROBE_ARCHIVE_URL:\s*\$\{\{ secrets\[matrix\.ffprobe_archive\] \}\}/,
  );
  assert.doesNotMatch(workflow, /(?:python|ffmpeg|ffprobe)_archive:\s*APP_/);

  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule|release):/m);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /gh release|tauri-action|desktop-release/i);
  assert.doesNotMatch(workflow, /TAURI_SIGNING|APPLE_|NOTARY|DEVELOPER_ID/i);
  assert.doesNotMatch(workflow, /WECHAT|LLM|PAYMENT/i);
  assert.doesNotMatch(workflow, /ubuntu|apt-get|libwebkit/i);
});

test("the hosted Cargo suite contains real deletion and macOS link fixtures", async () => {
  const source = await readFile(deletionSourcePath, "utf8");

  assert.match(source, /fn complete_delete_removes_only_selected_note_both_caches_and_exact_memberships\(\)/);
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
