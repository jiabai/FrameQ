# Task Manifest Trust Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Use superpowers:test-driven-development for characterization and ownership
> gates, and use superpowers:verification-before-completion before claiming completion. Steps use
> checkbox (`- [x]`) syntax for tracking.

**Goal:** Split the Rust task-manifest trust hotspot into private source-identity, schema, storage,
and access owners behind the unchanged `task_manifest::*` surface without changing task support,
manifest bytes, paths, errors, I/O order, or product behavior.

**Architecture:** `task_manifest.rs` remains the only crate-visible surface and directly re-exports
the existing constants, contracts, helpers, and validated capabilities. Four private children own
canonical source policy, pure schema/projection policy, filesystem/path effects, and
`SupportedTask`/`TaskEditSession` orchestration; characterization moves to a private test file. Raw
manifest/storage primitives remain inaccessible to application callers, and no new facade or
local-media source variant is introduced.

**Tech Stack:** Rust 2021, Tauri v2, Serde/serde_json, `url`, Cargo tests, rustfmt, existing FrameQ
task-access capabilities, Vitest/TypeScript regression, Node governance tests, Markdown durable
architecture/security documentation.

---

> This ExecPlan is a living document. Progress, Surprises & Discoveries, Decision Log, and Outcomes
> & Retrospective must be updated as implementation proceeds. Do not create commits, merge, push,
> or clean up the worktree without separate user authorization.

## Purpose / Big Picture

FrameQ users should observe no difference. Existing URL tasks remain supported only when schema
version, privacy marker, canonical `SourceIdentity`, exact source URL, ordinary task storage, and
safe declared artifacts pass the same checks. History, cache reuse, transcript review/edit,
deletion, and worker result parsing keep calling the same `task_manifest::*` items.

The improvement is internal: future source-policy, schema, filesystem, and task-capability changes
have one focused owner and a smaller review surface. The refactor must preserve the accepted single
non-bypassable trust boundary rather than replace it with several public services.

This plan does not implement local-media import, change manifest schema v3, add a source union,
alter the active local-media task status, or update a product specification.

## Progress

- [x] 2026-07-21: Confirmed `main` is clean and synchronized at `7521038`, the prior server-route
  worktree residue is gone, and no concurrent local changes require preservation.
- [x] 2026-07-21: Re-inspected all 1,326 lines of `task_manifest.rs`, all crate callers, the Task
  Access Facade ADR, architecture/security/design rules, the active local-media/release ExecPlans,
  current code-audit pressure points, and the transcript-detail Rust split precedent.
- [x] 2026-07-21: Created isolated worktree
  `.worktrees/codex-task-manifest-module-split-plan` on branch
  `codex/task-manifest-module-split-plan` from clean `main`. Validation: `.worktrees` is ignored and
  the main worktree remained untouched.
- [x] 2026-07-21: Established the pre-change baseline. Validation: `cargo test --manifest-path
  app/src-tauri/Cargo.toml task_manifest` passed 13/13 with 160 filtered tests, and
  `python scripts/validate_agents_docs.py --level ERROR` reported 0 errors / 0 warnings.
- [x] 2026-07-21: User accepted the high-level recommendation to retain one stable root and split
  private `source_identity/schema/storage/access/tests` owners, authorizing detailed design and
  ExecPlan documentation but not production implementation.
- [x] 2026-07-21: Recorded the detailed proposed design and this active ExecPlan without modifying
  production code.
- [x] 2026-07-21: Self-reviewed the written design/plan for placeholders, surface completeness,
  dependency cycles, scope ambiguity, and local-media conflicts. Validation: WARN governance
  reported 0 errors / 0 warnings; placeholder, code-fence, trailing-whitespace, production-scope,
  dependency-manifest, and `git diff --check` inspections passed.
- [x] 2026-07-21: User reviewed and explicitly approved the written design and ExecPlan, authorizing
  production and test implementation in the isolated worktree.
- [x] 2026-07-21: Task 1 added the edit-session characterization and final ownership gate.
  Validation: the new behavior test passed 1/1; the focused filter passed 14/14; the ownership
  test then failed for the intended reason only—`task_manifest/source_identity.rs` was absent.
- [x] Tasks 2-5 perform move-first extraction while behavior remains green.
  - [x] 2026-07-21: Task 2 moved canonical source-identity policy verbatim into the private
    `source_identity.rs` owner. Both source-policy tests and the 14-test non-boundary filter passed;
    rustfmt and diff checks passed.
  - [x] 2026-07-21: Task 3 moved raw manifest/error DTOs, safe projections, Insight parsing, and
    pure relative artifact policy into private `schema.rs`. All five requested focused commands
    passed, the 14-test non-boundary filter stayed green without compiler warnings, and rustfmt plus
    diff checks passed.
  - [x] 2026-07-21: Task 4 moved configured roots, manifest I/O, storage enumeration, artifact
    path effects, task-ID validation, and link/reparse handling into private `storage.rs`. All four
    requested storage/access characterizations and the 14-test non-boundary filter passed without
    warnings; rustfmt and diff checks passed.
  - [x] 2026-07-21: Task 5 moved `SupportedTask`/`TaskScan`/`TaskEditSession` into private
    `access.rs`, moved all tests into `tests.rs`, and added the recursive caller-bypass scan. The
    previously RED ownership test passed 1/1 and the focused filter passed 15/15 without warnings;
    rustfmt and diff checks passed. Final physical lines: root 26, source identity 174, schema 298,
    storage 205, access 298, tests 520.
- [x] 2026-07-21: Task 6 completed full regression, protected-scope proof, durable architecture /
  security / ADR / audit / future-local-media updates, task/index updates, and plan archival.
  Evidence: focused Rust 15/15; complete Rust 175/175 under normal Windows process permissions;
  App 549/549; scripts 23/23; TypeScript/i18n lint, frontend build, rustfmt, Tauri no-bundle release,
  governance, scope, and diff gates passed.

## Surprises & Discoveries

- The hotspot contains 380 lines of inline tests and 946 production lines. Moving tests is useful
  for navigation but leaves four distinct production trust responsibilities together.
- The accepted Task Access Facade ADR explicitly says physical splitting is optional and that a
  non-bypassable boundary is more important than line count. Therefore private child paths and
  selective root re-exports are acceptance requirements, not cosmetic preferences.
- Production callers use a broader stable surface than only `SupportedTask`: History, deletion,
  transcript-detail, URL cache, command construction, and terminal parsing also use root constants,
  projections, source identity, path projection, output-root resolution, and link detection.
- The active local-media plan has locked contract-v4 request types but has not implemented its
  picker, worker command, pipeline, manifest union, History, or UI. This split must leave those
  tasks open and cannot manufacture their source variant.
- Rust `TaskEditSession::save` currently writes pretty JSON plus a final newline directly with
  `fs::write`. Python task persistence has a separate atomic artifact boundary; this structural
  Rust refactor must not silently claim or introduce atomic replacement.
- The focused filter currently runs 12 task-manifest unit tests plus one History test whose name
  includes `task_manifests`, for a 13-test baseline.
- Direct crate-visible re-exports that currently have no in-crate consumer (`parse_insight_view`,
  `configured_output_root_from_project`, and `TaskScan`) trigger `unused_imports` after physical
  extraction. Narrow `#[allow(unused_imports)]` annotations on the stable root re-export groups keep
  the accepted surface and zero-warning builds without wrappers or dummy calls.
- The restricted sandbox complete Rust run passed 174/175 and failed only
  `blocked_stdin_delivery_remains_cancellable` with request-delivery failure instead of cancellation.
  The unchanged complete command passed 175/175 with normal Windows process permissions, matching
  the plan's known native termination caveat; no worker-runtime source was changed.
- The isolated worktree intentionally had no `node_modules`. `PATH`/`NODE_PATH` and an external
  config loader could start Vitest but could not resolve ESM packages for worktree sources. A
  validated temporary junction to the main installed dependencies enabled the exact npm/Tauri
  commands and was removed non-recursively after verification; both worktrees retained clean
  dependency state and main tracked files stayed untouched.

## Decision Log

- Decision: Use private source-identity, schema, storage, access, and test files behind the stable
  root. Rationale: these have distinct dependencies and failure modes, while a public child-module
  API would weaken the task capability boundary. Date/Author: 2026-07-21, User + Codex.
- Decision: Keep `task_manifest.rs` as the only crate-visible path and use direct re-exports rather
  than wrapper types/functions. Rationale: every caller remains source-compatible and shared type
  identities do not fork. Date/Author: 2026-07-21, User + Codex.
- Decision: Keep raw `TaskManifest`, raw error DTO, low-level load/read/write/path helpers, and
  support predicates private to the module tree. Rationale: application callers must continue
  receiving validated capabilities rather than assembling trust policy. Date/Author: 2026-07-21,
  User + Codex.
- Decision: Put pure relative artifact-string validation with schema policy and canonical/path I/O
  with storage. Rationale: this prevents a schema/storage import cycle and separates untrusted JSON
  shape from filesystem effects. Date/Author: 2026-07-21, Codex.
- Decision: Preserve direct Rust manifest-write and partial-failure behavior. Rationale: atomic
  Rust edit persistence is a separate reliability/security design, not a pure module move.
  Date/Author: 2026-07-21, Codex.
- Decision: Do not update a product spec and do not implement local-media manifest task 6 here.
  Rationale: this work preserves every external behavior and must keep the independent feature's
  RED/GREEN evidence attributable. Date/Author: 2026-07-21, User + Codex.
- Decision: During Tasks 2-4, run all behavior tests with only the final ownership test skipped;
  never ignore or compile-disable that test. Rationale: the ownership test is intentionally RED
  until the complete private tree exists, while behavior regressions must stop every move.
  Date/Author: 2026-07-21, Codex.
- Decision: Allow unused imports only on intentional stable root re-export groups. Rationale: direct
  re-exports preserve shared type/function identity and the approved surface; wrappers or dummy
  production uses would add behavior solely to silence a lint. Date/Author: 2026-07-21, Codex.

## Outcomes & Retrospective

Implemented the approved private owner tree. The former 1,326-line root is 26 physical lines;
`source_identity.rs` is 174, `schema.rs` 298, `storage.rs` 205, `access.rs` 298, and `tests.rs` 520.
The stable root constants, types, functions, methods, and type identities remain available through
the same `task_manifest::*` paths. Existing application callers were not edited, and raw
manifest/error/path/write primitives were not re-exported.

The edit-session characterization passed before production movement. The ownership gate then
recorded the intended missing-owner RED and complete-tree GREEN, including owner/dependency rules
and a recursive ban on private child imports from production callers. Focused evidence increased
from 13 baseline matches to 15/15; the complete Rust suite increased from 173 to 175 and passed under
normal Windows permissions. App 549/549, scripts 23/23, lint/build/rustfmt/Tauri/governance/diff
gates passed. Protected-scope inspection found production changes only in
`app/src-tauri/src/task_manifest.rs` and `app/src-tauri/src/task_manifest/`; no caller, frontend,
worker, server, contract, dependency manifest, command registry, product spec, or packaged worker
resource changed.

No real Tauri History/transcript UI smoke was run because commands and callers are unchanged; native
WebView integration therefore remains explicitly unverified. Source ownership tests cannot prevent
every future semantic bypass, so behavioral characterization and security review remain necessary
when the local-media source union is implemented. The existing direct Rust manifest write still has
no new rollback/atomicity guarantee; that was deliberately outside this move-only refactor.

## Context and Orientation

- Proposed detailed design:
  `docs/design-docs/2026-07-21-task-manifest-module-split.md`.
- Current hotspot and stable import root: `app/src-tauri/src/task_manifest.rs`.
- Tauri module registry: `app/src-tauri/src/lib.rs`.
- Main callers: `app/src-tauri/src/history.rs`, `history_deletion.rs`, `transcript_detail.rs`,
  `transcript_detail/`, `video_processing/`, and `worker_runtime/`.
- Existing trust decision: `docs/design-docs/2026-07-18-task-access-facade.md`.
- Related split precedent: `docs/design-docs/2026-07-20-transcript-detail-module-split.md` and its
  completed ExecPlan.
- Active future feature:
  `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`, especially tasks 6-7.
- Durable architecture/security: `docs/ARCHITECTURE.md` section
  `2026-07-18 Task access facade boundary` and `docs/SECURITY.md` sections covering task access,
  unsupported legacy isolation, local media paths, transcript editing, and deletion.
- Current structural audit: `docs/design-docs/frameq-code-audit-uml.md`.

## Target File Responsibility Map

| File | Responsibility after implementation |
|---|---|
| `app/src-tauri/src/task_manifest.rs` | private module/test declarations, four current invariant constants, direct re-exports of every existing crate-visible item |
| `app/src-tauri/src/task_manifest/source_identity.rs` | canonical `SourceIdentity`, platform/stable-ID rules, URL/query privacy checks, equality key |
| `app/src-tauri/src/task_manifest/schema.rs` | closed artifact enum/policy, raw private manifest/error DTOs, safe source/error/artifact/transcript projections, Insight parsing, relative artifact-string validation |
| `app/src-tauri/src/task_manifest/storage.rs` | configured output root, frontend path projection, task/manifest enumeration/read/write, task-ID/path/link/reparse/canonical-containment effects |
| `app/src-tauri/src/task_manifest/access.rs` | `SupportedTask`, `TaskScan`, `TaskEditSession`, support gating, artifact/content reads, restricted mutation/save composition |
| `app/src-tauri/src/task_manifest/tests.rs` | all existing characterization, new edit-session matrix, final source/dependency boundary gate, fixtures |

Production files outside this tree remain unchanged except durable documentation during closeout.
In particular, no implementation diff is allowed under `app/src/`, `worker/`, `contracts/`,
`server/`, package manifests, `app/src-tauri/src/lib.rs`, or existing application callers.

## Stable Root Shape

The final root must be equivalent to this surface, with rustfmt-only formatting differences:

```rust
mod access;
mod schema;
mod source_identity;
mod storage;

#[cfg(test)]
mod tests;

pub(crate) const TASK_MANIFEST_FILE_NAME: &str = "frameq-task.json";
pub(crate) const TASKS_DIR_NAME: &str = "tasks";
pub(crate) const TASK_SCHEMA_VERSION: u64 = 3;
pub(crate) const SOURCE_PRIVACY_MIGRATION_VERSION: u64 = 2;

pub(crate) use access::{SupportedTask, TaskEditSession, TaskScan};
pub(crate) use schema::{
    parse_insight_view, parse_insights_payload, InsightView, SafeTaskError, TaskArtifact,
    TranscriptMetadata,
};
pub(crate) use source_identity::SourceIdentity;
pub(crate) use storage::{
    configured_output_root, configured_output_root_from_project, is_link_or_reparse_point,
    path_to_frontend_string,
};
```

Raw `TaskManifest`, `TaskManifestError`, storage helpers, source-policy helpers, and relative-path
validators are intentionally absent from the re-export list.

## Plan of Work

### Task 1: Lock Edit-Session Behavior and the Final Ownership Boundary

**Files:**

- Modify: `app/src-tauri/src/task_manifest.rs` test module only

- [x] Add `edit_session_preserves_unknown_fields_and_rejects_unsafe_paths_without_echo`. Use the
  existing `write_supported_task` fixture, add one unknown manifest field, convert the supported
  task into an edit session, reject one escaping/sensitive path, then save a valid artifact and
  preview:

  ```rust
  #[test]
  fn edit_session_preserves_unknown_fields_and_rejects_unsafe_paths_without_echo() {
      let output_root = temp_dir("task-edit-session-characterization");
      let task_id = "20260721-120000-youtube-dQw4w9WgXcQ";
      let task_dir = write_supported_task(&output_root, task_id, "dQw4w9WgXcQ");
      let manifest_path = task_dir.join(super::TASK_MANIFEST_FILE_NAME);
      let mut payload: serde_json::Value = serde_json::from_str(
          &fs::read_to_string(&manifest_path).expect("read manifest"),
      )
      .expect("parse manifest");
      payload["future_worker_field"] = json!({"enabled": true});
      fs::write(
          &manifest_path,
          serde_json::to_string_pretty(&payload).expect("encode manifest") + "\n",
      )
      .expect("write manifest");

      let task = SupportedTask::open(&output_root, task_id).expect("open supported task");
      let mut edit = task.into_edit_session();
      let error = edit
          .set_artifact(
              TaskArtifact::TranscriptMd,
              "../xsec_token=review-secret.md",
          )
          .expect_err("escaping artifact must fail");
      assert!(!error.contains("review-secret"));
      assert!(!error.contains("xsec_token"));

      edit.set_artifact(
          TaskArtifact::TranscriptMd,
          "transcript/transcript.md",
      )
      .expect("set safe artifact");
      edit.set_text_preview("updated preview".to_string());
      edit.save().expect("save edit session");

      let bytes = fs::read(&manifest_path).expect("read saved manifest");
      assert!(bytes.ends_with(b"\n"));
      let saved: serde_json::Value = serde_json::from_slice(&bytes).expect("parse saved manifest");
      assert_eq!(saved["future_worker_field"]["enabled"], true);
      assert_eq!(
          saved["artifacts"]["transcript_md"],
          "transcript/transcript.md"
      );
      assert_eq!(saved["text_preview"], "updated preview");
  }
  ```

- [x] Run the new test alone and then the existing focused suite. Require GREEN before moving any
  production code:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml edit_session_preserves_unknown_fields
  cargo test --manifest-path app/src-tauri/Cargo.toml task_manifest
  ```

- [x] Add `task_manifest_module_boundary_matches_approved_private_owners`. Resolve
  `env!("CARGO_MANIFEST_DIR")/src/task_manifest`, require the exact five target files, then inspect
  root/child source. The test must contain these final assertions:

  ```rust
  #[test]
  fn task_manifest_module_boundary_matches_approved_private_owners() {
      use std::path::Path;

      let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
      let module_dir = src.join("task_manifest");
      let root = fs::read_to_string(src.join("task_manifest.rs")).expect("read root");
      let source_identity =
          fs::read_to_string(module_dir.join("source_identity.rs")).expect("read source o…19 tokens truncated…)).expect("read schema owner");
      let storage = fs::read_to_string(module_dir.join("storage.rs")).expect("read storage owner");
      let access = fs::read_to_string(module_dir.join("access.rs")).expect("read access owner");
      let tests = fs::read_to_string(module_dir.join("tests.rs")).expect("read tests owner");

      assert!(root.lines().count() <= 100, "root must remain a narrow surface");
      for declaration in [
          "mod access;",
          "mod schema;",
          "mod source_identity;",
          "mod storage;",
          "mod tests;",
      ] {
          assert!(root.contains(declaration), "missing {declaration}");
      }
      assert!(!root.contains("pub mod "));
      for forbidden in [
          "struct TaskManifest",
          "impl SupportedTask",
          "impl TaskEditSession",
          "Url::parse",
          "fs::read_to_string",
          "fs::write",
      ] {
          assert!(!root.contains(forbidden), "root owns {forbidden}");
      }

      assert!(source_identity.contains("pub(crate) struct SourceIdentity"));
      assert!(source_identity.contains("impl SourceIdentity"));
      assert!(schema.contains("struct TaskManifest"));
      assert!(schema.contains("pub(crate) enum TaskArtifact"));
      assert!(schema.contains("pub(crate) fn parse_insights_payload"));
      assert!(storage.contains("fn load_task_manifest"));
      assert!(storage.contains("pub(crate) fn configured_output_root"));
      assert!(storage.contains("pub(crate) fn is_link_or_reparse_point"));
      assert!(access.contains("pub(crate) struct SupportedTask"));
      assert!(access.contains("pub(crate) struct TaskEditSession"));
      assert!(tests.contains("edit_session_preserves_unknown_fields"));

      for pure_owner in [&source_identity, &schema] {
          assert!(!pure_owner.contains("std::fs"));
          assert!(!pure_owner.contains("RuntimePaths"));
          assert!(!pure_owner.contains("settings::"));
      }
      assert!(!access.contains("RuntimePaths"));
      assert!(!access.contains("settings::"));
      for child in [&source_identity, &schema, &storage, &access] {
          for forbidden in [
              "tauri::",
              "crate::history",
              "crate::history_deletion",
              "crate::transcript_detail",
              "crate::video_processing",
              "crate::worker_runtime",
              "crate::diagnostics",
          ] {
              assert!(!child.contains(forbidden), "child imports {forbidden}");
          }
      }
  }
  ```

  During implementation, extend this test with a recursive production-call-site scan that rejects
  `task_manifest::source_identity`, `task_manifest::schema`, `task_manifest::storage`, and
  `task_manifest::access` outside the private tree.

- [x] Run only the boundary test and require RED because
  `task_manifest/source_identity.rs` does not yet exist. The expected failure is a missing approved
  owner file, not a compilation, behavior, or dependency failure:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml task_manifest_module_boundary
  ```

### Task 2: Extract Canonical Source-Identity Policy

**Files:**

- Create: `app/src-tauri/src/task_manifest/source_identity.rs`
- Modify: `app/src-tauri/src/task_manifest.rs`
- Test: `app/src-tauri/src/task_manifest.rs` until Task 5 moves tests

- [x] Declare private `mod source_identity;`, move `SOURCE_IDENTITY_VERSION`, URL/query/part/ID
  limits, `SourceIdentity`, its implementation, `platform_stable_id_is_valid`,
  `is_sensitive_parameter_name`, and `is_sensitive_parameter_value` verbatim.
- [x] Make the definition directly re-exportable while keeping the child module private:

  ```rust
  // source_identity.rs
  #[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
  pub(crate) struct SourceIdentity {
      pub(crate) version: u64,
      pub(crate) platform: String,
      pub(crate) stable_id: String,
      #[serde(default)]
      pub(crate) effective_part: Option<u64>,
      pub(crate) canonical_url: String,
  }

  // task_manifest.rs
  pub(crate) use source_identity::SourceIdentity;
  ```

  Move method bodies without changing comparisons, parsing order, string bounds, accepted hosts,
  accepted paths/queries, or equality-key semantics.
- [x] Keep schema code in the root temporarily and import the moved type with the re-export. Do not
  add filesystem, settings, task access, local-source, logging, or network behavior to the source
  owner.
- [x] Run source-focused behavior plus every non-boundary task-manifest test and formatting:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml source_identity_accepts_only_canonical_query_contract
  cargo test --manifest-path app/src-tauri/Cargo.toml safe_source_identity_requires_current_schema_marker
  cargo test --manifest-path app/src-tauri/Cargo.toml task_manifest -- --skip task_manifest_module_boundary
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  ```

  Require all behavior GREEN; the ownership test remains RED only because later owners are absent.

### Task 3: Extract Pure Manifest Schema and Projection Policy

**Files:**

- Create: `app/src-tauri/src/task_manifest/schema.rs`
- Modify: `app/src-tauri/src/task_manifest.rs`
- Modify: `app/src-tauri/src/task_manifest/storage.rs` only when Task 4 creates it
- Test: `app/src-tauri/src/task_manifest.rs` until Task 5 moves tests

- [x] Declare private `mod schema;` and move `SAFE_ARTIFACT_KEYS`, `TaskArtifact`, raw
  `TaskManifestError`, `SafeTaskError`, `TranscriptMetadata`, `InsightView`, raw `TaskManifest`,
  Insight parsing, pure safe projections, and relative artifact-string validation.
- [x] Preserve the stable root re-exports exactly:

  ```rust
  pub(crate) use schema::{
      parse_insight_view, parse_insights_payload, InsightView, SafeTaskError, TaskArtifact,
      TranscriptMetadata,
  };
  ```

- [x] Keep `TaskManifest` and `TaskManifestError` unexported from the root. Expose only the minimum
  `pub(super)` schema methods/storage-facing helpers needed by sibling composition. `TaskManifest`
  continues to flatten and preserve unknown fields.
- [x] Keep relative artifact validation pure in `schema.rs`: closed key allowlist, non-empty value,
  relative/no-parent components, and sensitive-material rejection. Move canonicalization,
  filesystem existence, and link/reparse checks only in Task 4.
- [x] Keep `TaskManifest::safe_source_identity`, `safe_source_url`, `source_privacy_ready`, and
  transcript/error projections byte-for-byte equivalent. The URL-only supported-task predicate
  remains unchanged; do not add `source_kind` or local metadata.
- [x] Run schema-focused tests, the edit-session characterization, all non-boundary focused tests,
  and formatting:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml task_error_code_and_message_never_echo
  cargo test --manifest-path app/src-tauri/Cargo.toml manifest_round_trip_preserves_unknown_fields
  cargo test --manifest-path app/src-tauri/Cargo.toml parse_insight_view
  cargo test --manifest-path app/src-tauri/Cargo.toml edit_session_preserves_unknown_fields
  cargo test --manifest-path app/src-tauri/Cargo.toml task_manifest -- --skip task_manifest_module_boundary
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  ```

### Task 4: Extract Configured Storage, Manifest I/O, and Path Effects

**Files:**

- Create: `app/src-tauri/src/task_manifest/storage.rs`
- Modify: `app/src-tauri/src/task_manifest.rs`
- Modify: `app/src-tauri/src/task_manifest/schema.rs`
- Test: `app/src-tauri/src/task_manifest.rs` until Task 5 moves tests

- [x] Declare private `mod storage;` and move these existing responsibilities without changing
  order or error text:

  - configured output-root resolution and frontend path projection;
  - `load_task_manifest`, `task_dir_for`, `list_task_manifest_paths`,
    `read_task_manifest_path`, and direct pretty-JSON `write_task_manifest`;
  - declared/required artifact path derivation;
  - canonical task-artifact containment and artifact-parent preparation;
  - task-ID/forbidden-component/storage-entry validation; and
  - cross-platform symlink/junction/reparse detection.

- [x] Preserve only the existing root-visible storage helpers:

  ```rust
  pub(crate) use storage::{
      configured_output_root, configured_output_root_from_project, is_link_or_reparse_point,
      path_to_frontend_string,
  };
  ```

  Keep all raw manifest/path helpers at sibling-only visibility and do not re-export them.
- [x] Import pure `schema::validate_relative_artifact_path` and private `TaskManifest`; storage must
  not duplicate the artifact allowlist or source support predicate.
- [x] Preserve exact I/O sequencing: storage validation before read, ID match after decode, ordinary
  directory/file filtering during scan, canonicalization before containment, and direct
  `fs::write(pretty_json + "\n")` on save. Add no additional read, canonicalize, write, lock,
  temporary file, rollback, or retry.
- [x] Run storage/access characterization, all non-boundary focused tests, and formatting:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml artifact_resolution_errors_never_echo
  cargo test --manifest-path app/src-tauri/Cargo.toml supported_task_opens_only_current_tasks
  cargo test --manifest-path app/src-tauri/Cargo.toml supported_task_scan_isolates
  cargo test --manifest-path app/src-tauri/Cargo.toml supported_task_artifact_errors_do_not_echo
  cargo test --manifest-path app/src-tauri/Cargo.toml task_manifest -- --skip task_manifest_module_boundary
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  ```

### Task 5: Extract Validated Access, Move Tests, and Turn the Boundary GREEN

**Files:**

- Create: `app/src-tauri/src/task_manifest/access.rs`
- Create: `app/src-tauri/src/task_manifest/tests.rs`
- Modify: `app/src-tauri/src/task_manifest.rs`
- Modify: `app/src-tauri/src/task_manifest/schema.rs`
- Modify: `app/src-tauri/src/task_manifest/storage.rs`

- [x] Declare private `mod access;` and move `SupportedTask`, `TaskScan`, `TaskEditSession`, and their
  implementations. Preserve exact crate-visible structs/methods through:

  ```rust
  pub(crate) use access::{SupportedTask, TaskEditSession, TaskScan};
  ```

- [x] Make access compose only the private schema/storage/source owners. Preserve one manifest read
  in `open`, per-entry isolation in `scan`, exact expected-directory comparison, one support
  predicate, existing artifact/content read behavior, safe error projection, and transfer into one
  edit session. It must not resolve settings/runtime roots or import application callers.
- [x] Keep the edit session as the only raw mutation capability. Preserve artifact/preview mutation
  and make `save()` delegate once to the existing storage write. Do not reopen the task, add locking,
  or expose the raw manifest.
- [x] Replace the inline test module with `#[cfg(test)] mod tests;` and move every existing/new test
  and fixture to `task_manifest/tests.rs` without deleting assertions or changing fixture bytes.
- [x] Update only the moved test module's private imports; production callers must not receive raw
  re-exports:

  ```rust
  use super::{
      parse_insight_view,
      schema::{TaskManifest, TaskManifestError},
      storage::validate_task_artifact_path,
      SourceIdentity, SupportedTask, TaskArtifact,
  };
  ```

- [x] Complete the ownership test's recursive production source scan with this helper. Skip the
  stable root and files under the private `task_manifest/` tree, then reject private child paths
  everywhere else:

  ```rust
  fn collect_rust_sources(dir: &Path, sources: &mut Vec<std::path::PathBuf>) {
      for entry in fs::read_dir(dir).expect("read Rust source directory") {
          let path = entry.expect("read Rust source entry").path();
          if path.is_dir() {
              collect_rust_sources(&path, sources);
          } else if path.extension().and_then(|value| value.to_str()) == Some("rs") {
              sources.push(path);
          }
      }
  }

  let stable_root = src.join("task_manifest.rs");
  let mut rust_sources = Vec::new();
  collect_rust_sources(&src, &mut rust_sources);
  for path in rust_sources {
      if path == stable_root || path.starts_with(&module_dir) {
          continue;
      }
      let production_source = fs::read_to_string(&path).expect("read production Rust source");
      for forbidden in [
          "task_manifest::source_identity",
          "task_manifest::schema",
          "task_manifest::storage",
          "task_manifest::access",
      ] {
          assert!(
              !production_source.contains(forbidden),
              "{} bypasses the stable root through {forbidden}",
              path.display()
          );
      }
  }
  ```

- [x] Run the previously RED boundary and require GREEN, then run all focused tests and formatting:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml task_manifest_module_boundary
  cargo test --manifest-path app/src-tauri/Cargo.toml task_manifest
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  ```

- [x] Measure all final files. Require `task_manifest.rs` to be below 100 physical lines, record
  child/test sizes separately, and treat owner/dependency assertions as stronger evidence than
  total line count.
- [x] Review the production diff under `app/src-tauri/src/task_manifest.rs` and
  `app/src-tauri/src/task_manifest/`. Stop if any stable item disappears, raw primitive becomes a
  root re-export, error/JSON/path policy changes, or any existing caller requires modification.

### Task 6: Complete Regression, Scope Proof, Durable Docs, and Archival

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/2026-07-18-task-access-facade.md`
- Modify: `docs/design-docs/2026-07-21-task-manifest-module-split.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Move: this plan from `active/` to `completed/`

- [x] Run focused and complete Rust gates and record exact counts:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml task_manifest
  cargo test --manifest-path app/src-tauri/Cargo.toml
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  ```

  If the Windows blocked-stdin cancellation fixture fails only because restricted process
  termination reports access denied, rerun the same complete suite with native process permission
  and record both outputs. Do not modify worker-runtime code to mask an environment restriction.
- [x] Run cross-layer and packaging regression:

  ```powershell
  npm --prefix app test
  npm --prefix app run lint
  npm --prefix app run build
  node --test scripts/tests/*.test.mjs
  python scripts/validate_agents_docs.py --level WARN
  npm --prefix app run tauri -- build --no-bundle
  git diff --check
  ```

- [x] Prove production changes are restricted to `app/src-tauri/src/task_manifest.rs` and
  `app/src-tauri/src/task_manifest/`. Prove no diff under `app/src/`, `worker/`, `contracts/`,
  `server/`, package/Cargo dependency manifests, Tauri command registry, existing Rust application
  callers, product specs, or packaged worker resources.
- [x] Update architecture/security and the Task Access Facade ADR to say raw DTO/path policy is
  private to the `task_manifest` module tree and only the stable root is crate-visible. Do not imply
  that the trust boundary or manifest behavior changed.
- [x] Update the active local-media plan's task 6/context paths to the implemented private owners,
  without checking off any local-media runtime task or changing its accepted behavior.
- [x] Update measured audit evidence, mark the design implemented only after all gates pass, complete
  Progress/Outcomes, mark the TASKS item complete, archive this plan, and update AGENTS plus indexes.
- [x] Optionally exercise History load/transcript save for one disposable supported task in a real
  Tauri window. If not run, record native UI integration as an unverified residual rather than
  claiming acceptance.
- [x] Re-run WARN governance, rustfmt, `git diff --check`, scope proof, and clean-status inspection
  after archival.

## Validation and Acceptance

### Required automated evidence

- The new edit-session characterization passes before production movement.
- The final ownership test records missing-owner RED and complete private-tree GREEN.
- All focused task-manifest tests pass after every move; only the ownership test is intentionally
  skipped during Tasks 2-4.
- Complete Rust tests and rustfmt pass.
- App tests, TypeScript/i18n lint, production build, script tests, and Tauri no-bundle build remain
  green.
- Governance reports 0 errors / 0 warnings and `git diff --check` is clean.
- Scope scans prove no caller, command registry, frontend, worker, contract, dependency, product
  spec, or packaged-resource production change.

### Behavioral acceptance

- Source identity accepts and rejects the exact same platform, ID, host, path, query, part, userinfo,
  fragment, port, percent, control, length, and sensitive-material cases.
- Supported-task support, scan isolation/ignored counts, task-ID matching, legacy/quarantine
  isolation, and ordinary-file/link/reparse behavior are unchanged.
- Artifact allowlist, relative path, canonical containment, optional/required reads, safe errors,
  tolerant Insight parsing, edit mutation, JSON shape, unknown fields, final newline, and direct
  write ordering are unchanged.
- Every existing caller continues importing only `task_manifest::*`; no raw DTO/path/write helper
  becomes reachable.
- Contract v4 types remain declaration-only where currently planned, and no local-media manifest or
  UI behavior is implemented.

### Manual and residual validation

No live provider, server, worker, LLM, payment, updater, or native picker smoke is relevant. A real
Tauri History/transcript smoke is optional because command and caller code remain unchanged. If
skipped, record that source-level and Rust integration coverage do not exercise native WebView
interaction. Physical line count remains a maintenance indicator, not proof that the security
boundary is correct.

## Rollback and Recovery

This is a move-first refactor behind an unchanged root. After each task, a failing owner can be
moved back into `task_manifest.rs` while retaining the new characterization. Do not use
`git reset --hard`, discard unrelated user work, modify active local-media behavior, or adapt an
existing contract/error/path rule to make extraction easier.

If type identity, import paths, source privacy, manifest bytes, scan behavior, link/reparse handling,
artifact reads, edit save, or error text differs, stop at the last green step and document the
mismatch before continuing.

## Final Acceptance

- User approved the design and this plan before production edits.
- `task_manifest.rs` is a below-100-line stable root with no raw DTO, filesystem, URL parsing, or
  access implementation.
- Four private production owners plus a separate test module match the approved responsibility map.
- `SupportedTask` / `TaskEditSession` remain the only application trust/mutation capabilities, and
  raw manifest/storage primitives remain non-bypassable.
- All stable root items, behavior/failure invariants, schema-v3 bytes, and current I/O ordering are
  unchanged.
- Complete required gates pass with exact evidence recorded.
- No new facade, dependency, contract/schema behavior, migration, logging/network path, product
  behavior, or local-media runtime implementation exists.
- Durable docs, active local-media references, audit/task tracking, indexes, and archived ExecPlan
  match implemented reality.
