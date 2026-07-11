# Local Transcript and AI Workspaces Implementation Plan

> This living ExecPlan follows `WORKFLOW.md`. Keep Progress, Decision Log, and validation
> evidence current. Do not commit or push until the user reviews the finished workspace.

## Goal

Replace the flattened result-card experience with two domain workspaces for one task:
inline local transcript review and independent AI summary/inspiration controls. Finalize the
same boundary by intentionally removing the obsolete process-video AI field and branch while
preserving server, quota, privacy, stdin transport, and process-supervision semantics.

## Architecture

`useTaskProcessingController` remains the workflow/task-identity owner and adds explicit AI
target state. Pure view-model functions project the workflow into local and AI domain
states. `LocalTranscriptWorkspace` embeds a reusable `TranscriptReviewPanel` backed by the
existing transcript controller; `AiGenerationWorkspace` renders two typed target cards and
opens target-specific confirmation/results. App remains the composition root.

## Progress

- [x] 2026-07-11: Inspected current ResultWorkspace, ResultDetailSheet, workflow/controller,
  account/AI confirmation, History vNext changes, CSS tokens, and current tests.
- [x] 2026-07-11: User approved the domain-workspace component tree, typed target state,
  62/38 desktop layout, narrow stacking, and restrained visual direction.
- [x] 2026-07-11: Added product/architecture/design/security boundaries and this ExecPlan.
- [x] Added workflow/view-model RED tests. Evidence: the first focused run failed because
  `taskWorkspaceViewModel` did not exist; controller retry then failed because the partial
  error target was `null`; independent target history failed because `finishInsightRetry`
  did not exist.
- [x] Added component/browser RED tests. Evidence: component imports initially failed, the
  first CDP run could not find `.task-workspace-layout`, and the migrated stale-save smoke
  exposed an old task response overwriting the controller draft.
- [x] Implemented typed active target plus independent target errors, pure local/AI view
  models, task banner, local transcript workspace, AI workspace, and target-specific detail.
- [x] Extracted one `TranscriptReviewPanel`, retained existing Tauri/path/save guards, and
  added a current-task check before any async save response can mutate controller state.
- [x] Verified desktop/narrow screenshots and complete project gates. Desktop geometry at
  1366 px: local 805.05 px, AI 496.95 px, local ratio 61.83%, top delta 0, AI >= 360 px;
  900 px layout stacked and remained contained. Screenshots are under ignored
  `.tmp/task-workspaces/`.
- [x] Completed cross-change native Tauri/WebView2 acceptance with a real safe completed task:
  48:25 WAV playback, 193-segment seeking, 16,214-character transcript edit/save/revert, video
  and audio reveal, same-task history restore, 1180px dual columns, 887px stacking, pending AI
  confirmations, quota/privacy disclosure, and a real failed history task. No AI confirmation,
  checkout, quota consumption, payment, or external network generation was triggered.
- [x] Adversarial integration review removed dead generic-result CSS, restored 13 SourceIdentity
  regression cases, added summary-only/insights-only projections, and forced production
  process-video serialization to `generate_insights=false`. The latter failed its new Rust test
  before the boundary fix and passed afterward.
- [x] 2026-07-11: Replaced the temporary process-video boolean normalization with an intentionally
  incompatible command contract. Remove `generate_insights` from frontend, Rust stdin DTO, Python
  model/parser, worker service, and local pipeline; reject the retired field and leave
  `retry_insights` as the only AI-client/checkout/artifact path. RED evidence: frontend request
  and shared contract tests both exposed the retained field; Python produced five failures across
  the model, parser, sanitized error and service/pipeline signatures; Rust strict deserialization
  initially accepted the unknown field. GREEN evidence: focused frontend 12, focused Rust 2,
  complete worker 230, complete Rust 92, and all final gates passed.

## Decision Log

- Decision: Use domain-specific workspaces rather than splitting the existing generic card
  grid. Rationale: local correction and optional cloud AI have different data, controls,
  progress, errors, and privacy meaning. Date/Author: 2026-07-11 / User + Codex.
- Decision: Keep the existing worker-compatible stage and add typed AI target state plus
  pure projections. Rationale: ProcessSupervisor and IPC semantics remain stable while the
  UI stops treating AI as local progress. Date/Author: 2026-07-11 / User + Codex.
- Decision: Render transcript review inline and keep AI results target-specific. Rationale:
  transcript correction is primary local work, while summary/inspiration are optional
  outputs and must not share a transcript tab container. Date/Author: 2026-07-11 / User + Codex.
- Decision: Do not create a mindmap target. Rationale: the Mermaid file remains an attached
  output of confirmed summary generation. Date/Author: 2026-07-11 / User + Codex.
- Superseded decision: preserving the old IPC field and normalizing it to `false` was accepted only
  as an interim safety repair. Final product direction intentionally breaks that compatibility.
  Date/Author: 2026-07-11 / User.
- Decision: Local processing and AI generation are different command schemas, not modes of one
  request. `process_video` rejects the retired AI field; only `retry_insights` constructs AI
  clients and enters checkout/quota behavior. Date/Author: 2026-07-11 / User + Codex.

## Implementation Sequence

### 1. Workflow and view-model RED/GREEN

- Add tests for typed `activeAiTarget`, local-only progress, target-local failure, AI unlock,
  cancellation placement, and summary/insight snapshot contracts.
- Run focused Vitest and confirm failures arise from the missing state/view model.
- Add the smallest state fields and pure selectors required to make those tests pass.

### 2. Domain components RED/GREEN

- Add component tests for semantic region labels, status banner, local file/audio/transcript
  structure, two AI target cards, blockers, read-only explanation, and no generic result grid.
- Implement `TaskStatusBanner`, `LocalTranscriptWorkspace`, `AiGenerationWorkspace`, and
  `AiTargetCard` with existing tokens and controller actions.

### 3. Transcript extraction RED/GREEN

- Add tests proving segment playback/edit/save/copy/export and AI-time edit/save disabling.
- Extract `TranscriptReviewPanel` from `ResultDetailSheet`; keep one
  `useTranscriptDetailController` instance and existing task-id guards.
- Replace mixed transcript/AI tabs with a target-specific AI result sheet.

### 4. Integration and browser smoke RED/GREEN

- Wire App to the two view models and workspaces without exposing a workflow setter.
- Add deterministic CDP scenarios for 1366px columns and sub-1100px stacking, completion
  banner, account/quota blockers, confirmations, preference flow, AI read-only local panel,
  partial target error, cancellation control placement, history restore, and stale callbacks.
- Use observable readiness/geometry conditions; run browser smoke serially and save desktop
  and narrow screenshots under the existing ignored temporary screenshot area.

### 5. Full validation and handoff

- Run `npm --prefix app test` and `npm --prefix app run build`.
- Run `cargo test --manifest-path app\src-tauri\Cargo.toml`.
- Run `uv run pytest worker\tests` and `uv run ruff check worker`.
- Run `npm --prefix server test` and `npm --prefix server run build`.
- Run `node --test scripts\tests\*.test.mjs`.
- Run `python scripts\validate_agents_docs.py --level WARN`, `git diff --check`, and
  `git status --short`.
- Update this plan with RED/GREEN evidence, screenshot paths, counts, and residual risks.

## Constraints and Failure Handling

- Preserve every pre-existing dirty History layout/API change; do not reset, checkout,
  delete, or rewrite unrelated files.
- Server and ProcessSupervisor internals remain unchanged. The process-video request shape is
  intentionally incompatible: there is no AI boolean, no dual parser, and no silent fallback.
- A target error is rendered only in its AI card. A usable transcript never becomes failed
  because optional AI failed.
- A stale task callback is ignored before either workspace view is derived.
- The transcript editor is disabled only while the current task's AI target is running or
  its cancellation is pending; playback and file location remain available.

## Outcome

The task result experience now has two domain workspaces under one completion banner and
one task identity. The generic ResultWorkspace/ResultCard array and mixed transcript/AI
detail sheet were removed. Local progress has only media/transcription stages; AI target
state, errors, confirmation, quota, privacy copy, and cancellation placement are independent.
During AI generation the transcript stays readable/playable but edit/save are disabled.

TDD and final validation: App 33 files / 230 tests, including 19 serial CDP smoke tests;
Rust 92; worker 230 plus Ruff; server 57 plus TypeScript build; scripts 9; app production
build, docs validation, and diff checks passed. The intentional worker contract change deletes
the obsolete process-video AI field and automatic AI branch. SourceIdentity, stdin transport,
ProcessSupervisor, server and quota semantics are otherwise unchanged. Rust now strictly rejects
unknown IPC fields and serializes an explicit local-only worker DTO; Python rejects the retired
field before source resolution with a fixed non-echoing error. `run_worker_once` cannot receive or
construct an AI client, while `retry_insights` retains both target-specific generation paths.

Native Windows/WebView2 acceptance now covers local media decoding, Explorer reveal, long
transcript editing, and responsive layout. Residual risk remains for macOS WebView behavior and
real LLM supplier/checkout execution, which was intentionally not authorized or run.
