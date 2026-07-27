# ASR Model Display Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop model status report the selected ASR runtime's concrete local directory without weakening full-cache readiness validation.

**Architecture:** Split the current overloaded path helper into a descriptor-owned cache validation root and a concrete ASR display directory. Availability continues to use the cache root; the Tauri status projection alone returns the display leaf consumed by the existing frontend.

**Tech Stack:** Rust, Tauri, Cargo unit tests, repository governance validation.

**Durable design:** `docs/design-docs/2026-07-27-selectable-asr-model-on-demand-download.md`

---

## Progress

- [x] 2026-07-27: Product specification and durable design updated and approved.
- [x] Added a failing Rust regression test for exact PyTorch and ONNX display directories, then
  observed the expected unresolved-helper failure.
- [x] Separated cache-root and display-directory helpers, kept readiness on the cache root, and
  passed the focused and ASR module tests.
- [x] Ran focused and repository validation, recorded evidence, and archived this plan.

## Surprises & Discoveries

- The frontend already renders `asr_model_dir` directly, so no TypeScript path construction or UI
  change is required.
- The working tree contains a partial Rust attempt that moves the PyTorch path one level deeper and
  broadens marker lookup. It does not reach the concrete model leaf and couples display concerns
  into readiness validation; implementation will retain its intent while restoring a single,
  explicit validation root.

## Decision Log

- Decision: keep the serialized field name `asr_model_dir` for frontend compatibility, but populate
  it from a dedicated display-directory projection. Rationale: the wire shape is already correct;
  only the path semantics are wrong. Date/Author: 2026-07-27, User + Codex.
- Decision: do not display the VAD directory. Rationale: the field describes the selected ASR
  model, while VAD remains a separately validated sibling dependency. Date/Author: 2026-07-27,
  User + Codex.

## Task 1: Lock the Path Contract with Failing Tests

**Files:**

- Modify and test: `app/src-tauri/src/asr_model.rs`

- [x] **Step 1: Import the wished-for display helper into the test module.**

```rust
use super::{
    asr_model_available, asr_model_display_dir, cancelled_model_download_event,
    map_model_download_run_result, ModelDownloadRunResult, DEFAULT_ASR_MODEL,
    SENSEVOICE_SMALL_ONNX_MODEL,
};
```

- [x] **Step 2: Add exact path tests for both closed descriptors.**

```rust
#[test]
fn asr_model_display_directory_points_to_selected_runtime_leaf() {
    let paths = RuntimePaths {
        resource_dir: PathBuf::from("resources"),
        user_data_dir: PathBuf::from("app-data"),
    };

    assert_eq!(
        asr_model_display_dir(&paths, DEFAULT_ASR_MODEL),
        paths
            .user_data_dir
            .join("models")
            .join("models")
            .join("iic")
            .join("SenseVoiceSmall")
    );
    assert_eq!(
        asr_model_display_dir(&paths, SENSEVOICE_SMALL_ONNX_MODEL),
        paths
            .user_data_dir
            .join("models")
            .join("onnx")
            .join("models")
            .join("iic")
            .join("SenseVoiceSmall-onnx")
    );
}
```

- [x] **Step 3: Run the test and verify RED.**

Run:

```powershell
$env:TAURI_CONFIG = '{"bundle":{"resources":[]}}'
cargo test --manifest-path app/src-tauri/Cargo.toml asr_model_display_directory_points_to_selected_runtime_leaf --quiet
```

Expected: compilation fails because `asr_model_display_dir` does not exist.

## Task 2: Separate Display and Validation Paths

**Files:**

- Modify: `app/src-tauri/src/asr_model.rs`
- Test: `app/src-tauri/src/asr_model.rs`

- [x] **Step 1: Define the two path projections.**

```rust
fn asr_model_cache_dir(paths: &RuntimePaths, asr_model: &str) -> PathBuf {
    let root = paths.user_data_dir.join("models");
    if asr_model == SENSEVOICE_SMALL_ONNX_MODEL {
        root.join(ONNX_CACHE_DIR_NAME)
    } else {
        root
    }
}

fn asr_model_display_dir(paths: &RuntimePaths, asr_model: &str) -> PathBuf {
    let model_name = if asr_model == SENSEVOICE_SMALL_ONNX_MODEL {
        "SenseVoiceSmall-onnx"
    } else {
        "SenseVoiceSmall"
    };
    asr_model_cache_dir(paths, asr_model)
        .join("models")
        .join("iic")
        .join(model_name)
}
```

- [x] **Step 2: Keep availability on the cache root and status on the display leaf.**

```rust
fn asr_model_available(paths: &RuntimePaths, asr_model: &str) -> bool {
    SUPPORTED_ASR_MODELS.contains(&asr_model)
        && model_marker_exists(&asr_model_cache_dir(paths, asr_model), asr_model)
}

// In AsrModelStatusView construction:
asr_model_dir: path_to_env_string(asr_model_display_dir(&paths, &asr_model)),
```

- [x] **Step 3: Restore marker/file validation to its cache-root contract.**

Use `model_dir.join(MODEL_VERSION_FILE_NAME)` for the marker. Preserve the existing PyTorch
compatibility search over `[model_dir, model_dir.join("models")]`; do not search parent directories
or treat the displayed leaf as a validation root.

- [x] **Step 4: Run the focused test and verify GREEN.**

Run the command from Task 1. Expected: one test passes.

- [x] **Step 5: Run all ASR model unit tests.**

```powershell
$env:TAURI_CONFIG = '{"bundle":{"resources":[]}}'
cargo test --manifest-path app/src-tauri/Cargo.toml asr_model --quiet
```

Expected: all matching tests pass, including existing availability coverage.

## Task 3: Verify, Record, and Publish

**Files:**

- Modify: `docs/exec-plans/active/2026-07-27-asr-model-display-directory-plan.md`
- Modify: `docs/exec-plans/active/index.md`
- Move after completion:
  `docs/exec-plans/active/2026-07-27-asr-model-display-directory-plan.md` to
  `docs/exec-plans/completed/2026-07-27-asr-model-display-directory-plan.md`

- [x] **Step 1: Run formatting and focused validation.**

```powershell
cargo fmt --manifest-path app/src-tauri/Cargo.toml --check
$env:TAURI_CONFIG = '{"bundle":{"resources":[]}}'
cargo test --manifest-path app/src-tauri/Cargo.toml asr_model --quiet
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Expected: every command exits zero.

- [x] **Step 2: Inspect the final diff and status.**

Confirm the change is limited to the Rust status/path boundary and this ExecPlan, and that no model
weights or unrelated user files are staged.

- [x] **Step 3: Update this living plan.**

Check completed progress, record exact validation evidence in Outcomes & Retrospective, move the
plan to `completed`, and return `docs/exec-plans/active/index.md` to “No active ExecPlans.”

- [x] **Step 4: Prepare the scoped commit and publication.**

```powershell
git add app/src-tauri/src/asr_model.rs docs/exec-plans/active/index.md docs/exec-plans/completed/2026-07-27-asr-model-display-directory-plan.md
git commit -m "fix(asr): show concrete selected model directory"
git push origin main
```

After the verified scope is recorded here, commit and push it to trigger the repository's GitHub
Actions workflows.

## Outcomes & Retrospective

The Tauri status projection now reports the selected ASR runtime leaf while availability continues
to validate the descriptor-owned cache root, marker, ASR files, and VAD files. No frontend protocol
or path concatenation changed.

Fresh validation on 2026-07-27:

- TDD RED: the focused Rust test failed with unresolved import
  `super::asr_model_display_dir`.
- TDD GREEN: the focused Rust path test passed (1 passed), then the ASR module suite passed
  (13 passed).
- `cargo fmt --manifest-path app/src-tauri/Cargo.toml --check` passed.
- `npm.cmd --prefix app test` passed (68 files, 640 tests).
- `python scripts/validate_agents_docs.py --level WARN` passed with 0 errors and 0 warnings.
- `git diff --check` passed.

The first frontend test invocation was blocked by the local PowerShell script policy and the
sandbox prevented Vitest from writing its temporary config. Re-running `npm.cmd` with the required
filesystem permission completed the suite successfully.
