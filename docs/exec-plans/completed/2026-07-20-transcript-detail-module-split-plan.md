# Transcript Detail Application Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Use test-driven-development for the source-boundary test and preserve green
> characterization coverage during each structural move.

**Goal:** Split audio playback preparation, segment codec behavior, and official transcript edit
storage out of `transcript_detail.rs` without changing commands, DTOs, task trust, paths, backups,
cache behavior, manifest behavior, or user-visible transcript review.

**Architecture:** The existing Rust file remains the only crate-visible Tauri command and
composition root. Three private children own audio playback/cache effects, segment decoding/encoding,
and transcript edit persistence; command-level characterization moves to a private test module. All
task access continues through `SupportedTask` and `TaskEditSession`, with no new facade.

**Tech Stack:** Rust 2021, Tauri v2, Serde/serde_json, Cargo tests, rustfmt, existing FrameQ task
access capabilities, Node governance tests, Markdown architecture/security documentation.

---

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ users should observe no change. Opening transcript detail still returns the official local
text, optional segment metadata, validated audio paths, and original-backup status. Saving still
updates the official `.txt`, matching `.md`, optional segment sidecar, history preview, and first
original backup through the same commands. The improvement is internal: future audio-cache, segment,
or edit-storage maintenance has one focused owner and a smaller review surface while the existing
local-first and non-bypassable task trust boundaries remain intact.

This plan does not implement local-media import, alter the active local-media contract v4, change a
product spec, or add a new transcript/storage facade.

## Progress

- [x] 2026-07-20: Re-inspected `transcript_detail.rs`, its 10 tests, `lib.rs` registration,
  frontend client calls, task-access design, architecture/security rules, active local-media plan,
  code-audit pressure points, and the prior Rust module-split pattern. Validation: source symbol and
  caller scans plus measured 1,133 physical lines, with production code through line 552 and the
  580-line test module beginning at line 554.
- [x] 2026-07-20: Created isolated worktree
  `.worktrees/codex-transcript-detail-module-split-plan` on branch
  `codex/transcript-detail-module-split-plan` from clean commit `6d07eb6`; `main` remained untouched.
  Validation: `git status --short --branch`, `git worktree list --porcelain`, and
  `git check-ignore -v .worktrees`.
- [x] 2026-07-20: Established the pre-change baseline. Validation:
  `cargo test --manifest-path app/src-tauri/Cargo.toml transcript_detail` passed 10/10 with 159
  filtered tests; `python scripts/validate_agents_docs.py --level WARN` reported 0 errors and 0
  warnings.
- [x] 2026-07-20: Recorded the proposed failure-boundary design and registered this active
  ExecPlan without modifying product behavior or implementation code. Validation:
  `python scripts/validate_agents_docs.py --level WARN` reported 0 errors and 0 warnings; the
  placeholder/trailing-whitespace scan, no-production-code-diff scope check, and
  `git diff --check` passed.
- [x] 2026-07-20: Obtained user approval of the written design and ExecPlan before implementation.
  Validation: explicit “文档已确认，请进入实现” response in this thread.
- [x] 2026-07-20: Locked three implicit behavior matrices before moving production code and
  established the final module-ownership RED. Validation: each new segment/audio/Markdown test
  passed individually against the old implementation; `cargo test --manifest-path
  app/src-tauri/Cargo.toml transcript_detail_module_boundary` failed 1/1 only because
  `transcript_detail/audio_playback.rs` did not yet exist.
- [x] 2026-07-20: Extracted validated direct/cache audio playback preparation into
  `transcript_detail/audio_playback.rs`, reused the identical task-storage link/reparse predicate,
  and kept root result assembly unchanged. Validation: load-focused 6/6, all non-boundary
  transcript-detail tests 13/13, and rustfmt passed.
- [x] 2026-07-20: Extracted the tolerant-read/strict-write segment codec into
  `transcript_detail/segments.rs` without moving manifest mutation into the codec. Validation: all
  13 non-boundary transcript-detail behavior tests and rustfmt passed.
- [x] 2026-07-20: Extracted required transcript load and official edit persistence into
  `transcript_detail/edit_storage.rs`; the root now opens one supported task and delegates through
  validated capabilities. Validation: save-focused 6/6, quarantine 1/1, all 13 non-boundary
  transcript-detail behavior tests, and rustfmt passed.
- [x] 2026-07-20: Moved command-level tests and fixtures to private `tests.rs`, completed the
  ownership gate, and reduced the root to 134 physical lines. Validation: the prior boundary RED
  became GREEN 1/1; focused transcript-detail passed 14/14; final sizes are root 134,
  `audio_playback.rs` 160, `segments.rs` 99, `edit_storage.rs` 191, and `tests.rs` 791.
- [x] 2026-07-20: Completed pre-close cross-layer regression. Validation: Rust 173/173 with native
  Windows process-termination permission, app 549/549, scripts 23/23, TypeScript/i18n lint,
  production app build, rustfmt, and Tauri no-bundle build passed. Final governance, scope, and diff
  checks remain the archival gate.
- [x] 2026-07-20: Synchronized architecture, security, audit evidence, task/index navigation, and
  the implemented design; archived this completed plan. Validation: governance reported 0 errors
  and 0 warnings, rustfmt and `git diff --check` passed, no protected frontend/worker/contract/
  packaged-resource/task-manifest/command-registry/local-media production path changed, and no
  checklist item remains open.

## Surprises & Discoveries

- The apparent 1,133-line hotspot is almost evenly divided between 552 lines of production and 580
  lines of tests. Moving tests is necessary for navigation but insufficient because production
  still mixes three independent filesystem/fallback boundaries. Evidence:
  `app/src-tauri/src/transcript_detail.rs:1-1133` and the `mod tests` declaration at line 554.
- The existing external-audio cache test uses a hard link intentionally. Removing the cache
  directory entry before atomic replacement preserves the outside inode content; treating every
  hard link as a symlink would change current behavior. Evidence:
  `load_detail_replaces_existing_cache_link_without_overwriting_link_target`.
- Segment reads and writes are intentionally asymmetric: unreadable/malformed content degrades to
  an empty list, while edited segment IDs/timing are rejected before serialization. Evidence:
  `read_segments_sidecar`, `segment_from_value`, and `write_segments_sidecar`.
- The accepted Task Access Facade design explicitly makes physical `task_manifest.rs` splitting
  optional. Reusing `SupportedTask` / `TaskEditSession` is safer than moving transcript application
  responsibilities into that critical trust owner. Evidence:
  `docs/design-docs/2026-07-18-task-access-facade.md` under “Consequences”.
- The active local-media plan has locked pure contract-v4 types but has not implemented its picker,
  worker command, manifest union, or UI. This refactor must remain source-agnostic and avoid claiming
  local-media runtime support. Evidence:
  `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md` tasks 2-5.
- The final source-ownership test necessarily stays RED while Tasks 2-4 create its required module
  tree. Running every focused test after each intermediate extraction would therefore contradict
  the approved RED/GREEN sequence. Evidence: the first RED fails on the missing
  `audio_playback.rs`, while all 13 behavioral tests pass after the audio move.
- Moving the inline tests left one leading blank line in `tests.rs`; rustfmt reported only that
  exact diff. Removing the migration residue made `cargo fmt -- --check` pass without any behavior
  change.
- The Windows blocked-stdin cancellation fixture cannot terminate its child inside the restricted
  sandbox: it waits 30 seconds and reports `RequestDeliveryFailed`. The isolated test passes 1/1
  and the complete suite passes 173/173 with native process-termination permission, confirming an
  environment restriction rather than a transcript-detail regression.

## Decision Log

- Decision: Split the module by failure boundary into `audio_playback.rs`, `segments.rs`, and
  `edit_storage.rs`, with command-level tests in `tests.rs`. Rationale: these responsibilities have
  distinct dependencies and recovery behavior; helper/service buckets do not. Date/Author:
  2026-07-20, User + Codex.
- Decision: Keep `transcript_detail.rs` as the crate-visible Tauri command and composition root.
  Rationale: this preserves command registration, request/result types, and frontend IPC paths while
  making child ownership private. Date/Author: 2026-07-20, User + Codex.
- Decision: Add no `TranscriptDetailFacade`. Rationale: `SupportedTask` and `TaskEditSession` already
  hide the complex trust subsystem; the remaining single-caller application code needs cohesion,
  not another object layer. Date/Author: 2026-07-20, User + Codex.
- Decision: Pass validated task capabilities into children and keep raw manifest/path policy private
  to `task_manifest.rs`. Rationale: child modules must not become alternative task support or path
  validation owners. Date/Author: 2026-07-20, User + Codex.
- Decision: Preserve current multi-file save ordering and partial-failure semantics. Rationale:
  atomic transcript/Markdown/segments/manifest transactions are a separate behavior and security
  design, not a safe pure move. Date/Author: 2026-07-20, Codex.
- Decision: Do not update a product spec or the local-media plan as a prerequisite. Rationale: no
  user-visible behavior or local-media runtime boundary changes, and this cleanup must not block the
  independent feature plan. Date/Author: 2026-07-20, Codex.
- Decision: During Tasks 2-4, run the complete transcript-detail behavior suite with only
  `transcript_detail_module_boundary` skipped; never mark or compile-ignore that test. Rationale:
  the boundary test is intentionally RED until the final module tree and separate test file exist,
  while behavioral regressions must still block every intermediate move. Date/Author: 2026-07-20,
  Codex.

## Outcomes & Retrospective

The hotspot is now a 134-line stable Tauri command/DTO/composition root plus three private
failure-boundary owners: 160-line audio playback/cache preparation, 99-line segment codec, and
191-line official edit storage. The 791-line command-level test suite is separate, making
production responsibilities visible without hiding coverage. Three behavior matrices and the
source-ownership test preceded production movement; the boundary test moved from its expected
missing-child RED to GREEN, and focused coverage increased from 10 to 14 tests.

No command, DTO, error string, fixed path, backup, Markdown, segment, cache, manifest, frontend,
worker, contract, packaged-resource, or local-media runtime behavior changed. Task trust and
mutation still enter only through `SupportedTask` / `TaskEditSession`, so no additional facade was
needed. Automated acceptance passed Rust 173/173, app 549/549, scripts 23/23, rustfmt,
TypeScript/i18n lint, production app build, Tauri no-bundle build, governance, scope, and diff
checks. A real Tauri load/play/save smoke was not rerun; native WebView integration remains the
only residual validation risk for this structural refactor.

## Context and Orientation

- Approved-after-review design target:
  `docs/design-docs/2026-07-20-transcript-detail-module-split.md`.
- Current command/DTO/composition root: `app/src-tauri/src/transcript_detail.rs`; private owners and
  command-level tests live under `app/src-tauri/src/transcript_detail/`.
- Tauri command registration: `app/src-tauri/src/lib.rs`.
- Frontend IPC adapter: `app/src/transcriptDetailClient.ts`.
- Validated task capabilities and private manifest trust owner:
  `app/src-tauri/src/task_manifest.rs`.
- Audio playback cache usage/cleanup commands: `app/src-tauri/src/settings.rs`; permanent task
  deletion cleanup: `app/src-tauri/src/history_deletion.rs`. These are not part of the split.
- Existing durable behavior: `docs/ARCHITECTURE.md` sections “Task access facade boundary” and
  “Transcript Detail and Audio Review Boundary”.
- Existing security rules: `docs/SECURITY.md` sections “Task Access Facade Enforcement” and
  “Transcript Audio Review Local File Boundary”.
- Current audit entry: `docs/design-docs/frameq-code-audit-uml.md`.
- Independent future feature: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`.

## File Responsibility Map

| File | Responsibility after implementation |
|---|---|
| `app/src-tauri/src/transcript_detail.rs` | child declarations, current request/view DTOs, Tauri commands, runtime-root composition, one `SupportedTask::open` per operation, result assembly |
| `app/src-tauri/src/transcript_detail/audio_playback.rs` | optional validated audio lookup, extension policy, direct/cache routing, safe temporary copy/install, frontend path projection |
| `app/src-tauri/src/transcript_detail/segments.rs` | fixed segment path, tolerant JSON decode/filtering, strict edited-segment validation and encoding |
| `app/src-tauri/src/transcript_detail/edit_storage.rs` | required transcript load, official path/link validation, one-time backups, Markdown formatting, ordered save, segment delegation, `TaskEditSession` artifact/preview/save |
| `app/src-tauri/src/transcript_detail/tests.rs` | existing 10 command-level characterization tests, new behavior matrix, source ownership/dependency test, fixtures |

The following production files remain unchanged: `app/src-tauri/src/lib.rs`,
`app/src-tauri/src/task_manifest.rs`, all `app/src/` frontend sources, `contracts/`, `worker/`, and
packaged worker resources.

## Plan of Work

### Task 1: Lock Implicit Behavior and the Target Ownership Boundary

**Files:**

- Modify: `app/src-tauri/src/transcript_detail.rs` test module

- [x] Add `load_detail_degrades_missing_malformed_and_mixed_segments_without_hiding_valid_items`.
  Construct missing, malformed top-level, and mixed valid/invalid sidecars; assert missing/malformed
  returns `[]` and mixed input retains only valid items in source order with `speaker` unchanged.
- [x] Add `load_detail_routes_direct_audio_without_cache_and_allows_missing_audio`. Assert a
  validated audio artifact under the direct app-local output root returns identical canonical
  `audio_path` / `audio_asset_path` without creating `.frameq-audio-review`; remove the manifest
  audio declaration and assert both fields become `None` while transcript text still loads.
- [x] Add `save_detail_preserves_markdown_prefix_and_existing_empty_segments_declaration`. Seed
  metadata before `## Transcript` plus a declared segment sidecar, save empty segments, and assert
  the prefix is byte-preserved, only transcript content changes, `segments.json` contains an empty
  array, and the manifest retains the segment artifact.
- [x] Run:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml transcript_detail
  ```

  Require all existing and new characterization tests to pass before moving production code.
- [x] Add `transcript_detail_module_boundary_matches_approved_owners`. Read the root and target
  child source paths from `env!("CARGO_MANIFEST_DIR")`; require the three child files and separate
  test file, require their owner symbols, reject owner symbols from the root, and reject Tauri,
  runtime-path, raw `TaskManifest`, and `frameq-task.json` dependencies from private children.
- [x] Re-run only the boundary test and require RED because the approved child files do not yet
  exist:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml transcript_detail_module_boundary
  ```

  Record the missing child path as the expected RED evidence, not a compiler or dependency failure.

### Task 2: Extract Audio Playback Preparation

**Files:**

- Create: `app/src-tauri/src/transcript_detail/audio_playback.rs`
- Modify: `app/src-tauri/src/transcript_detail.rs`
- Test: `app/src-tauri/src/transcript_detail.rs` until Task 5 moves the tests

- [x] Declare private `mod audio_playback;` and move `AudioPlaybackPaths`, `load_audio_paths`,
  direct/cache routing, copy/install, canonical cache containment, extension policy, and associated
  helpers without changing error strings or operation order.
- [x] Narrow the entry to:

  ```rust
  pub(super) fn load_audio_paths(
      task: &task_manifest::SupportedTask,
      direct_audio_root: &Path,
      playback_cache_root: &Path,
  ) -> Result<Option<AudioPlaybackPaths>, String>
  ```

  Read `task.task_id()` internally instead of accepting a second identity value.
- [x] Reuse `task_manifest::is_link_or_reparse_point` for the identical OS link/reparse predicate;
  keep cache-target inspection, hard-link unlink/install, temporary cleanup, and canonical
  containment inside the audio owner.
- [x] Make the root call `audio_playback::load_audio_paths` only after one successful
  `SupportedTask::open`; do not pass arbitrary frontend paths into the child.
- [x] Run:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml transcript_detail::tests::load_detail
  cargo test --manifest-path app/src-tauri/Cargo.toml transcript_detail -- --skip transcript_detail_module_boundary
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  ```

  Require direct audio, external cache copy, hard-link replacement, symlink/reparse rejection,
  missing audio, and full focused coverage to pass.

### Task 3: Extract the Segment Sidecar Codec

**Files:**

- Create: `app/src-tauri/src/transcript_detail/segments.rs`
- Modify: `app/src-tauri/src/transcript_detail.rs`
- Modify: `app/src-tauri/src/transcript_detail/edit_storage.rs` when Task 4 creates it
- Test: `app/src-tauri/src/transcript_detail.rs` until Task 5 moves the tests

- [x] Declare private `mod segments;` and move fixed-path validation, tolerant read/decode/filter,
  strict ID/timing validation, and pretty JSON write without changing the sidecar shape or errors.
- [x] Expose only these parent-visible functions:

  ```rust
  pub(super) fn read_segments_sidecar(
      task: &task_manifest::SupportedTask,
  ) -> Result<Vec<TranscriptSegmentView>, String>;

  pub(super) fn validate_segments_path(task_dir: &Path, path: &Path) -> Result<(), String>;

  pub(super) fn write_segments_sidecar(
      path: &Path,
      segments: &[TranscriptSegmentView],
  ) -> Result<(), String>;
  ```

- [x] Keep optional read behavior exact: absent, unreadable, invalid JSON, wrong top-level shape, or
  wholly invalid items return an empty list; mixed items retain valid entries in order.
- [x] Keep write behavior exact: blank IDs and non-increasing timings fail, output is pretty JSON
  with a final newline, and no manifest mutation occurs in this codec.
- [x] Run:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml transcript_detail -- --skip transcript_detail_module_boundary
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  ```

  Require the segment matrix, save characterization, and all focused tests to pass.

### Task 4: Extract Official Transcript Edit Storage

**Files:**

- Create: `app/src-tauri/src/transcript_detail/edit_storage.rs`
- Modify: `app/src-tauri/src/transcript_detail.rs`
- Modify: `app/src-tauri/src/transcript_detail/segments.rs`
- Test: `app/src-tauri/src/transcript_detail.rs` until Task 5 moves the tests

- [x] Declare private `mod edit_storage;` and implement the approved `LoadedTranscript` and
  `SavedTranscript` projections. Their fields are `pub(super)` and contain only text, safe declared
  artifacts, and backup state needed by the root result DTOs.
- [x] Move required transcript read, official `.txt`/`.md` validation, linked target/parent
  rejection, first-backup creation, backup-path derivation, Markdown replacement, ordered official
  writes, segment delegation, artifact registration, preview truncation, and edit-session save.
- [x] Use the exact capability entries:

  ```rust
  pub(super) fn load_transcript(
      task: &task_manifest::SupportedTask,
  ) -> Result<LoadedTranscript, String>;

  pub(super) fn save_transcript(
      task: task_manifest::SupportedTask,
      text: &str,
      segments: &[TranscriptSegmentView],
  ) -> Result<SavedTranscript, String>;
  ```

  `save_transcript` converts the supplied validated task into one `TaskEditSession`; it must not
  accept an output root/task ID or reopen the manifest.
- [x] Preserve the existing sequence: validate all official paths and parents; ensure parents;
  create first backups; write `.txt`; derive/write `.md`; write/retain optional segments; set closed
  artifacts and preview; save the manifest last. Do not introduce rollback or claim atomicity.
- [x] Reduce root load/save helpers to one task open, child calls, and DTO assembly. Keep Tauri
  commands, request aliases, result fields, and `lib.rs` registration unchanged.
- [x] Run:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml transcript_detail::tests::save_detail
  cargo test --manifest-path app/src-tauri/Cargo.toml transcript_load_and_save_reject_quarantined_tasks
  cargo test --manifest-path app/src-tauri/Cargo.toml transcript_detail -- --skip transcript_detail_module_boundary
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  ```

  Require backup-once, Markdown prefix, empty/non-empty segments, fixed paths, linked targets,
  legacy/quarantined rejection, and full focused coverage to pass.

### Task 5: Move Integration Tests and Enforce the Final Module Shape

**Files:**

- Create: `app/src-tauri/src/transcript_detail/tests.rs`
- Modify: `app/src-tauri/src/transcript_detail.rs`
- Test: `app/src-tauri/src/transcript_detail/tests.rs`

- [x] Replace the inline test module with `#[cfg(test)] mod tests;` and move all existing/new tests
  plus filesystem fixtures without changing assertions.
- [x] Keep test-only `load_transcript_detail_from_output_root` reachable through the parent module;
  do not expose a new production entry.
- [x] Complete the source-boundary test with the approved owner and forbidden-dependency assertions.
  Require the root to omit `copy_audio_asset`, `segment_from_value`, and
  `create_original_backups`; require child source to omit Tauri commands, runtime-path resolution,
  raw `TaskManifest`, and `frameq-task.json`.
- [x] Run the prior RED boundary filter and require GREEN, then run all focused tests:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml transcript_detail_module_boundary
  cargo test --manifest-path app/src-tauri/Cargo.toml transcript_detail
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  ```

- [x] Measure every final file. Require the root to be below 200 physical lines excluding the
  separate test file; record production responsibilities rather than treating test lines as
  production complexity.
- [x] Review `git diff -- app/src-tauri/src/transcript_detail.rs app/src-tauri/src/transcript_detail`
  and stop if command paths, DTOs, errors, save ordering, path policy, or cache behavior drifted.

### Task 6: Cross-Layer Regression and Closeout

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/2026-07-20-transcript-detail-module-split.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Move: this plan from `active/` to `completed/`

- [x] Run:

  ```powershell
  cargo test --manifest-path app/src-tauri/Cargo.toml transcript_detail
  cargo test --manifest-path app/src-tauri/Cargo.toml
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  npm --prefix app test
  npm --prefix app run lint
  npm --prefix app run build
  node --test scripts/tests/*.test.mjs
  python scripts/validate_agents_docs.py --level WARN
  npm --prefix app run tauri -- build --no-bundle
  git diff --check
  ```

- [x] Prove no production diff exists under `app/src/`, `worker/`, `contracts/`, packaged worker
  resources, `task_manifest.rs`, `lib.rs`, or the active local-media implementation.
- [x] Optionally load/play/save one disposable supported task in a real Tauri window. If not run,
  record native UI smoke as residual risk rather than claiming it passed.
- [x] Update architecture/security with the final private owners, update the audit with measured
  sizes and resolved hotspot evidence, mark the design implemented, complete Outcomes, mark the
  `TASKS.md` item complete, archive this plan, and update active/completed indexes plus `AGENTS.md`.
- [x] Re-run governance, formatting, diff, and clean-status checks after closeout.

## Validation and Acceptance

### Required automated evidence

- Focused Rust transcript-detail tests pass after every extraction.
- The new characterization matrix and source-boundary RED/GREEN evidence are recorded in Progress.
- Complete Rust tests and rustfmt pass.
- App tests, TypeScript/i18n lint, production build, scripts, and Tauri no-bundle build remain green.
- Governance reports 0 errors and 0 warnings; `git diff --check` is clean.
- Scope scans prove no command registry, frontend production, worker, contract, manifest
  implementation, or packaged-resource changes.

### Behavioral acceptance

- Load behavior is unchanged for supported, missing-segment, malformed-segment, missing-audio,
  direct-audio, external-cache, hard-link, and symlink/reparse cases.
- Save behavior is unchanged for empty text, fixed/alternate/linked paths, first/later backups,
  Markdown prefix preservation, empty/non-empty segments, preview/artifact updates, and
  legacy/quarantined tasks.
- Commands and DTOs are unchanged and local-media v4 remains unimplemented outside its independent
  active plan.

### Manual evidence

- A disposable real-Tauri transcript load/play/save smoke is optional because this is a structural
  refactor with existing frontend IPC unchanged. If it is skipped, state that explicitly in the
  completed plan and retain it as a residual risk.

## Final Acceptance

- Root and private-child responsibilities match the approved design and dependency direction.
- No existing test is removed without equivalent coverage; the focused count increases by the new
  matrix/boundary cases.
- `SupportedTask` / `TaskEditSession` remain the only task trust/mutation capabilities used by the
  module tree.
- All required gates pass with exact totals recorded before archival.
- No product-visible behavior, Facade, contract, schema, cache path, worker path, network path, log,
  or local-media runtime behavior is added.
