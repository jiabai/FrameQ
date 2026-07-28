# Bundled ONNX Runtime Dependency Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent FrameQ release builds from producing a desktop package whose bundled Python runtime lacks the ONNX ASR dependencies required by SenseVoiceSmall-ONNX.

**Architecture:** The existing installer builder remains the only dependency-installation owner. A Node regression test locks down its locked-requirements export, bundled-runtime pip install, ONNX import smoke test, and ordering before Tauri packaging. A local installer-resource preparation run validates the same contract against the exact Windows runtime that Tauri will bundle.

**Tech Stack:** Node.js test runner, installer build script, uv lock export, bundled CPython, pip, Tauri resources.

**Durable design:** `docs/design-docs/2026-07-28-bundled-onnx-runtime-integrity.md`

---

## Progress

- [x] 2026-07-28: Investigated the production failure. The downloaded ONNX model cache is complete;
  the local debug Python runtime lacks both `funasr_onnx` and `onnxruntime`.
- [x] 2026-07-28: Added the release-build regression test; all six focused installer
  tests pass.
- [x] 2026-07-28: Refreshed the local bundled runtime through the installer preparation
  path and verified real imports (`funasr-onnx 0.4.2`, `onnxruntime 1.28.0`).
- [ ] Run focused validation, archive this plan, commit, and push.

## Surprises & Discoveries

- `scripts/build-installer.mjs` already exports locked production requirements, installs them into
  `resources/python`, and runs the complete ONNX import smoke test. The missing safeguard is a
  dedicated automated regression that locks that release contract in place.
- `tauri:dev:fresh-worker` only mirrors Python source files; it deliberately does not install
  Python packages and is outside this release-boundary fix.
- The local `--skip-downloads` preparation path cannot run yet: its required existing Deno
  binary (`resources/bin/deno.exe`) is absent. This stops before requirements export or any
  Python package installation. The local environment also has no configured Windows Python or
  ffmpeg archive inputs for a full resource refresh.
- The resource binaries were subsequently restored. `--skip-downloads --skip-tauri-build` then
  completed its locked-runtime installation and smoke test. A Tauri debug resource directory
  can retain files removed from the source runtime; after a NumPy downgrade, its stale NumPy 2
  extension files conflicted with the copied NumPy 1.26.4 package. Removing only the ignored,
  generated `target/debug/resources/python` directory and rebuilding regenerated a clean copy.

## Decision Log

- Decision: retain dependency installation exclusively in the installer build. Rationale: runtime
  installation would violate the local-first installer and user-network boundary. Date/Author:
  2026-07-28, User + Codex.
- Decision: use the supported `--skip-downloads --skip-tauri-build` installer path for local
  runtime preparation. Rationale: it reuses already provisioned Python/media resources while still
  exporting, installing, and smoke-testing locked dependencies. Date/Author: 2026-07-28, User + Codex.

## Task 1: Lock the Release Dependency Contract

**Files:**

- Modify and test: `scripts/tests/build-installer.test.mjs`
- Inspect: `scripts/build-installer.mjs:594-628`
- Inspect: `pyproject.toml:6-12`

- [ ] **Step 1: Add a regression test for the bundled ONNX runtime contract.**

```javascript
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const buildInstallerPath = join(testDir, "..", "build-installer.mjs");
const projectManifestPath = join(testDir, "..", "..", "pyproject.toml");

test("installer build installs and imports the bundled ONNX runtime before Tauri packaging", () => {
  const buildScript = readFileSync(buildInstallerPath, "utf8");
  const manifest = readFileSync(projectManifestPath, "utf8");

  assert.match(manifest, /"funasr-onnx==0\\.4\\.2"/);
  assert.match(manifest, /"onnxruntime>=1\\.17\\.0"/);
  assert.match(buildScript, /\["export", "--no-dev", "--format", "requirements-txt", "--output-file", requirementsPath\]/);
  assert.match(buildScript, /\["-m", "pip", "install", "--only-binary=llvmlite,cryptography", "-r", requirementsPath\]/);
  assert.match(buildScript, /import funasr, funasr_onnx, modelscope, onnxruntime, yt_dlp; import frameq_worker/);
  assert.ok(
    buildScript.indexOf("Python runtime smoke test") < buildScript.indexOf("Build Tauri installer"),
  );
});
```

- [ ] **Step 2: Run the focused test and record the existing release behavior.**

```powershell
node --test scripts/tests/build-installer.test.mjs
```

Expected: all tests pass. This is a regression characterization of existing installer behavior;
no production build-script change is required unless the contract is absent.

## Task 2: Prepare and Smoke-Test the Actual Bundled Runtime

**Files:**

- Runtime output only (ignored): `app/src-tauri/resources/python/`
- Runtime output only (ignored): `app/src-tauri/resources/worker/`
- Runtime output only (ignored): `build/installer-runtime/windows-x64/`

- [x] **Step 1: Run the supported installer preparation path.**

```powershell
node scripts/build-installer.mjs --target windows-x64 --skip-downloads --skip-tauri-build
```

Expected: export locked requirements, install them into the existing bundled Python runtime, and
complete the script's ONNX import smoke test without producing an installer artifact.

- [x] **Step 2: Independently import the packaged dependency set.**

```powershell
$runtimePython = "app/src-tauri/resources/python/python.exe"
$env:PYTHONPATH = "app/src-tauri/resources/worker"
& $runtimePython -c "import funasr, funasr_onnx, modelscope, onnxruntime, yt_dlp; import frameq_worker; print('bundled ONNX runtime OK')"
```

Expected: prints `bundled ONNX runtime OK` and exits zero.

- [x] **Step 3: Verify the runtime boundary remains offline at application/model-download time.**

Inspect the build script and Rust worker command construction to confirm package installation occurs
only in `scripts/build-installer.mjs`, while the runtime command invokes only bundled Python and
the worker. Do not add `pip`, `uv`, or PyPI endpoints to the application runtime.

## Task 3: Verify, Archive, and Publish

**Files:**

- Modify: `docs/exec-plans/active/2026-07-28-bundled-onnx-runtime-integrity-plan.md`
- Modify: `docs/exec-plans/active/index.md`
- Move after completion:
  `docs/exec-plans/active/2026-07-28-bundled-onnx-runtime-integrity-plan.md` to
  `docs/exec-plans/completed/2026-07-28-bundled-onnx-runtime-integrity-plan.md`

- [x] **Step 1: Run repository checks.**

```powershell
node --test scripts/tests/build-installer.test.mjs
node --test scripts/tests/tauri-dev-fresh-worker.test.mjs
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Expected: every command exits zero.

- [x] **Step 2: Inspect the final tracked diff.**

Confirm only the regression test and this ExecPlan are tracked. The generated Python runtime,
worker mirror, and installer staging directories remain untracked/ignored.

- [ ] **Step 3: Archive the plan and commit the tracked change.**

```powershell
git add scripts/tests/build-installer.test.mjs docs/exec-plans/active/index.md docs/exec-plans/completed/2026-07-28-bundled-onnx-runtime-integrity-plan.md
git commit -m "test(release): guard bundled ONNX runtime dependencies"
git push origin main
```

Expected: the push triggers release-related repository checks without adding model weights or
generated runtime packages to Git.

## Outcomes & Retrospective

The installer preparation path installed the locked packages into the bundled Windows CPython
runtime. Its independent import gate passed with `funasr-onnx 0.4.2` and `onnxruntime 1.28.0`;
the bundled Deno smoke check also passed. The source-bound regression test prevents a future
release-script edit from dropping the requirements export, pip install, ONNX import smoke test,
or its required ordering before Tauri packaging. No application or ASR-model-download path installs
Python packages or contacts PyPI.
