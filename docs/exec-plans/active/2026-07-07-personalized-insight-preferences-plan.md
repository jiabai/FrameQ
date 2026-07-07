# Personalized Insight Preferences Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ will collect option-based local preferences before AI整理 so `启发话题点` can match the user's purpose, audience, style, and long-term inspiration profile. The change keeps the desktop local-first boundary: profile data and per-run preferences stay in app-local data or task-local artifacts, FrameQ server remains account/quota/LLM-checkout only, and summary plus Mermaid mindmap generation stay generic.

The user-visible result is a desktop utility flow, not a marketing-style onboarding page: first-use profile setup or skip, a six-step per-run preference wizard, a confirmation sheet with quota and cloud LLM disclosure, structured insight details with match reasons, and a `换个方向` path that reruns only the per-run preference flow.

## Progress

- [x] 2026-07-07: Product spec, current active/completed ExecPlan state, frontend workflow, Tauri commands, worker contracts, and insight generation code were reviewed before implementation planning. Validation: `python scripts\validate_agents_docs.py --level WARN` passed with 0 errors and 0 warnings; `git diff --check` reported CRLF normalization warnings only and no whitespace errors.
- [x] 2026-07-07: Task 1 created the frontend insight preference registry, TypeScript models, validation helpers, summaries, and preference snapshot builder with TDD coverage. Validation: `npm --prefix app test -- insightPreferences.test.ts` passed with 6 tests; `npm --prefix app test` passed with 127 tests across 21 files; `npm --prefix app run build` passed.
- [x] 2026-07-07: Task 2 added Tauri app-local `insight-preferences.json` storage, profile save/skip/clear commands, default generation preference save command, Rust-side option-id validation, invalid-profile reset state, and invalid-default clearing. Validation: `cargo test --manifest-path app\src-tauri\Cargo.toml insight_preferences` passed with 6 focused tests; `cargo test --manifest-path app\src-tauri\Cargo.toml` passed with 49 tests.
- [x] 2026-07-07: Task 3 added the frontend preference client, flow state model, first-use profile setup/skip, default summary, six-step per-run preference wizard, confirmation sheet, settings edit/clear entry points, compact desktop styling, and browser structure test updates for the new settings section. Validation: `npm --prefix app test -- insightPreferences.test.ts insightPreferencesClient.test.ts insightPreferenceFlow.test.ts` passed with 15 tests; `npm --prefix app test` passed with 136 tests across 23 files; `npm --prefix app run build` passed.
- [x] 2026-07-07: Task 4 passed optional preference snapshots through the `retry_insights` command boundary only, kept `process_video` transcript-only payloads unchanged, added Rust JSON round-trip support, and added Python retry parser dataclasses plus option-id validation. Validation: `npm --prefix app test -- workerClient.test.ts` passed with 8 tests; `cargo test --manifest-path app\src-tauri\Cargo.toml retry_insights_request_round_trips_preference_snapshot_payload` passed; `uv run pytest worker\tests\test_requests.py` passed with 3 tests.
- [x] 2026-07-07: Task 5 replaced the insight result schema end to end with structured `Insight` objects across Python worker models, generated JSON/Markdown, task manifests, Rust cache/history parsing, TypeScript workflow/history state, detail rendering, and copy text. Validation: `uv run pytest worker\tests` passed with 141 tests; `cargo test --manifest-path app\src-tauri\Cargo.toml` passed with 50 tests; `npm --prefix app test` passed with 138 tests across 23 files.
- [x] 2026-07-07: Task 6 scoped personalization to insight question generation only by passing the optional preference snapshot into `generate_insights_from_markdown` / `build_question_prompt`, while summary and Mermaid prompt builders remain generic. Validation: worker prompt and pipeline assertions passed inside `uv run pytest worker\tests`.
- [x] 2026-07-07: Task 7 added task-local `ai/preference-snapshot.json` support, manifest artifact mapping, exact snapshot serialization, and retry-time snapshot writing without restoring historical snapshots into global preferences. Validation: `uv run pytest worker\tests` passed with 141 tests.
- [x] 2026-07-07: Task 8 updated the structured insight UX with grouped detail rows, readable copy text, preserved `ai/insights.md` export behavior, and a `换个方向` action that reopens only the six-step per-run preference flow before confirmation. Validation: `npm --prefix app test` passed with 138 tests; `npm --prefix app run build` passed.
- [x] 2026-07-07: Task 9 updated the desktop-worker contract and tests for structured insights plus optional preference snapshots. Packaged worker sync was inspected and skipped because `app/src-tauri/resources/worker/frameq_worker` does not exist in this worktree. Validation: `uv run pytest worker\tests`, `cargo test --manifest-path app\src-tauri\Cargo.toml`, and `npm --prefix app test` passed.

## Surprises & Discoveries

- Evidence: `docs/exec-plans/active/index.md` currently lists only `2026-06-18-installer-distribution-runtime-plan.md`; the previously noisy completed plans are already registered in `docs/exec-plans/completed/index.md`. This plan should only add the personalized insight plan to active work.
- Evidence: `app/src/workflow.ts`, `app/src/historyClient.ts`, `app/src-tauri/src/lib.rs`, `app/src-tauri/src/history.rs`, and `worker/frameq_worker/models.py` currently model `insights` as `string[]` / `Vec<String>` / `list[str]`. The implementation must change that contract end to end rather than only changing the worker writer.
- Evidence: `worker/frameq_worker/insightflow/generator.py` writes `{"file_id": ..., "insights": [{"id","text","label","chunk_id"}]}` and Markdown as a simple numbered list. This conflicts with the new required `schemaVersion: 1` and structured `topic`, `matchReason`, `followUpQuestions`, `suitableUse`, `sourceChunkId` schema.
- Evidence: `app/src/App.tsx` currently opens a single AI整理 confirmation sheet and `app/src/workerClient.ts` sends only `{ task_id }` to `retry_insights`. There is no preference snapshot payload or local profile lifecycle yet.
- Evidence: `worker/frameq_worker/pipeline.py` calls `generate_summary_from_markdown` and `generate_insights_from_markdown` separately. This gives a clean seam for passing preferences only into insight generation while keeping summary and mindmap prompts unchanged.
- Evidence: `app/src-tauri/resources/worker` has no `frameq_worker` mirror in this worktree, so changed worker source files did not need a packaged-resource copy for this task.
- Evidence: `git diff --name-only -- server` returned no files, confirming this implementation did not add server-side preference, transcript, or insight persistence changes.

## Decision Log

- Decision: Use an app-local JSON preference file, not `.env`, task history, or FrameQ server, for `profile`, `profileSkipped`, and `defaultGenerationPreferences`. Rationale: the spec makes Tauri responsible for app-local preference storage and explicitly forbids server persistence or history-derived defaults. Date/Author: 2026-07-07 / Codex.
- Decision: Add a canonical option registry artifact for stable field/id definitions, then consume it from frontend and Tauri validation rather than deriving values from Chinese labels. Rationale: the spec defines option identity as `(field, id)` and warns against label-based contracts. Date/Author: 2026-07-07 / Codex.
- Decision: Replace the insight result contract with structured Insight objects across worker JSON, Rust, TypeScript, history restore, detail preview, copy text, and Markdown export. Rationale: the product is not publicly released, so no old-task migration or dual-format compatibility is required for real users. Date/Author: 2026-07-07 / Codex.
- Decision: Send the validated preference snapshot only through `retry_insights` / AI整理, and only pass it into the insight-topic generation function. Rationale: video extraction, ASR, summary, and Mermaid mindmap must remain unaffected by personalization. Date/Author: 2026-07-07 / Codex.
- Decision: Store any task-local preference snapshot as a local task artifact, not as global state and not as server metadata. Rationale: history should explain why old insights were generated that way, but must not restore or mutate the current global profile/default preferences. Date/Author: 2026-07-07 / Codex.

## Outcomes & Retrospective

The source implementation now provides an end-to-end personalized insight flow with local profile storage, six-step per-run preferences, explicit AI整理 confirmation, structured insight results, task-local preference snapshots, and no server-side preference storage.

Automated validation passed on 2026-07-07: `npm --prefix app test` (138 tests), `npm --prefix app run build`, `uv run pytest worker\tests` (141 tests), `uv run ruff check worker`, and `cargo test --manifest-path app\src-tauri\Cargo.toml` (50 tests).

Residual risk: the manual quota-consuming desktop regression was not run in this session because it requires a real completed transcript task plus authenticated per-LLM-call quota accounting. Packaged worker mirroring was inspected and skipped because the mirror directory is absent.

## Context and Orientation

- Product and governance: `docs/product-specs/2026-07-06-personalized-insight-preferences.md`, `TASKS.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/SECURITY.md`.
- ExecPlan indexes: `docs/exec-plans/active/index.md`, `docs/exec-plans/completed/index.md`, `docs/exec-plans/index.md`.
- Shared contracts: `contracts/desktop-worker-contract.json`; add `contracts/insight-preference-options.json` if a shared JSON registry is used.
- Frontend state and clients: `app/src/workflow.ts`, `app/src/workerClient.ts`, `app/src/historyClient.ts`, `app/src/App.tsx`, `app/src/features/results/ResultWorkspace.tsx`.
- Frontend new modules: `app/src/insightPreferences.ts`, `app/src/insightPreferencesClient.ts`, `app/src/features/insightPreferences/InsightPreferenceFlow.tsx`, `app/src/features/insightPreferences/InspirationProfileForm.tsx`.
- Tauri/Rust boundary: `app/src-tauri/src/lib.rs`, `app/src-tauri/src/settings.rs`, `app/src-tauri/src/task_manifest.rs`, `app/src-tauri/src/history.rs`; add `app/src-tauri/src/insight_preferences.rs`.
- Worker contract and orchestration: `worker/frameq_worker/models.py`, `worker/frameq_worker/requests.py`, `worker/frameq_worker/worker_service.py`, `worker/frameq_worker/pipeline.py`, `worker/frameq_worker/task_store.py`, `worker/frameq_worker/desktop_contract.py`.
- Worker insight generation: `worker/frameq_worker/insightflow/generator.py`, `worker/frameq_worker/insightflow/prompt.py`, `worker/frameq_worker/insightflow/utils.py`, `worker/tests/test_insights.py`, `worker/tests/test_pipeline.py`.
- Packaged worker mirror: `app/src-tauri/resources/worker/frameq_worker/...` must be synchronized for every changed worker source file that exists there.
- Server boundary: `server/` should not gain preference/profile/transcript/insight persistence fields or endpoints for this feature.

## Plan of Work

1. Establish the option registry and TypeScript preference state model.
   - Add the v1 option ids from the product spec with field-scoped lookup keys for `我的灵感档案` and `本次生成偏好`.
   - Define `InspirationProfile`, `GenerationPreferences`, `PreferenceSnapshot`, structured `Insight`, and validation helpers in TypeScript.
   - Cover required single-select fields, optional multi-select fields, max counts, invalid unknown ids, label rendering, profile summary, generation preference summary, and default preference invalidation in `app/src/insightPreferences.test.ts`.

2. Add Tauri app-local preference storage.
   - Create `app/src-tauri/src/insight_preferences.rs` to read and write an app-local `insight-preferences.json`.
   - Expose commands for reading preference state, saving profile, skipping profile, clearing profile, and saving default generation preferences after confirmation.
   - Validate all incoming option ids and counts inside Rust before writing the file; invalid profile reads must report a reset-required state instead of silently treating the profile as skipped.
   - Register commands in `app/src-tauri/src/lib.rs` and add Rust tests for file location, skip/save/clear semantics, invalid profile behavior, default preference clearing, and no traversal/history mutation.

3. Build the frontend preference flow.
   - Add a small client wrapper in `app/src/insightPreferencesClient.ts`.
   - Add desktop-style option controls for first-use profile setup/skip, returning-user default summary, six-step per-run generation preferences, and final confirmation.
   - Integrate from `App.tsx` so clicking pending or failed `要点总结` / `启发话题点` starts the preference flow before `retryInsights`.
   - Keep `直接生成` as a shortcut to the confirmation sheet only; it must not call the worker until the user clicks `确认`.
   - Add settings entry points for `编辑灵感档案` and `清空灵感档案`; clearing sets `profileSkipped: false` and leaves default generation preferences and historical task artifacts untouched.
   - Update `App.css` with compact desktop utility styling that fits current FrameQ sheets and avoids landing-page treatment.

4. Pass preference snapshots through the AI整理 command boundary.
   - Extend `app/src/workerClient.ts` `RetryInsightsRequest` to include an optional validated `preference_snapshot`.
   - Extend `app/src-tauri/src/lib.rs` `RetryInsightsRequest` to carry the snapshot while preserving current LLM checkout behavior and sanitized command logging.
   - Extend `worker/frameq_worker/models.py` and `worker/frameq_worker/requests.py` with structured preference snapshot dataclasses and parser validation.
   - Add tests proving transcript-only `process_video` does not carry preferences and `retry_insights` does.

5. Replace insight result schema end to end.
   - Update Python `Insight` to contain `id`, `topic`, `matchReason`, `followUpQuestions`, `suitableUse`, and `sourceChunkId`.
   - Update `write_insight_files` to write top-level `{"schemaVersion": 1, "insights": [...]}` and Markdown grouped by `话题点`, `匹配理由`, `启发问题`, and `适合用途`.
   - Update `ProcessResult.insights`, `task_store.write_task_manifest`, Rust `WorkerResult`, Rust history/cache readers, TypeScript `WorkerResult`, `HistoryItem`, workflow state, detail preview, copy text, and result counts to use structured Insight objects.
   - Remove old `string[]` assumptions from tests instead of maintaining dual-format UI behavior.

6. Scope personalization to insight generation only.
   - Change `generate_insights_from_markdown` and `build_question_prompt` to accept an optional preference snapshot.
   - Include compact structured JSON preference context in topic-question prompts, including field ids and concise label snapshots for LLM readability.
   - Keep `build_mindmap_prompt`, `build_summary_prompt`, and `generate_summary_from_markdown` unchanged except for any type imports forced by refactoring.
   - Add worker tests asserting preference ids appear in question prompts and do not appear in summary or mindmap prompts.

7. Persist task-local preference snapshot.
   - Add a task artifact path such as `ai/preference-snapshot.json` to `TaskPaths` and the manifest artifact map when AI整理 is confirmed with preferences.
   - Save the exact local snapshot used for that confirmed AI整理 attempt, including `profile`/`profileSkipped` meaning, generation preferences, and optional label snapshot for history display.
   - Ensure global `defaultGenerationPreferences` is updated only after the confirmation click, not when the user merely completes the six-step wizard or cancels the confirmation sheet.
   - Ensure task-local snapshots are never used to reconstruct global profile or defaults.

8. Update the structured insight UX.
   - Render each insight as a compact grouped item with topic, match reason, follow-up questions, suitable use, and source chunk if available.
   - Add `换个方向` in the insight detail surface; it should reopen only the six-step per-run preference flow and then return to confirmation.
   - Update copy behavior to produce readable plain text from structured insights and export behavior to continue locating `ai/insights.md`.
   - Keep result cards unchanged: no new card for preference snapshots, no raw JSON display in the main result workspace.

9. Synchronize bundled worker resources and contracts.
   - Copy changed worker files into `app/src-tauri/resources/worker/frameq_worker/...`.
   - Update `contracts/desktop-worker-contract.json` if result keys or schema notes change.
   - Add or update contract tests so desktop worker JSON, Rust parsing, and TypeScript types agree on structured insights and optional preference snapshots.

10. Documentation and release hygiene.
   - Update this ExecPlan Progress, Surprises, Decision Log, and Outcomes as implementation proceeds.
   - Update `TASKS.md` only when implementation status changes, not during this planning-only step unless the task state needs to move sections.
   - If implementation reveals cross-cutting deferred work, record it in `docs/exec-plans/tech-debt-tracker.md`.
   - Do not add server persistence, Admin Web profile views, broad prompt editors, free-text preference input, or historical task migration.

## Validation and Acceptance

- Documentation:
  - `python scripts\validate_agents_docs.py --level WARN`
  - `git diff --check`
- Frontend:
  - `npm --prefix app test`
  - `npm --prefix app run build`
  - Tests cover option validation, first-use skip, invalid profile reset, six-step button enablement, default preference update only on confirmation, structured insight rendering, copy text, and `换个方向`.
- Tauri/Rust:
  - `cargo test --manifest-path app\src-tauri\Cargo.toml`
  - Tests cover app-local preference file location, command validation, clear profile semantics, sanitized worker command logging, structured insight parsing, cache restore, and history loading.
- Worker:
  - `uv run pytest worker\tests`
  - `uv run ruff check worker`
  - Tests cover retry request parsing, prompt personalization only for insights, structured insight JSON/Markdown writing, task-local snapshot writing, manifest insight counts, and partial failure preservation.
- Server boundary:
  - Inspect `server/` diff and confirm no new user preference, transcript, or insight persistence endpoint/field was added.
- Manual regression:
  - Start from a transcript-only completed task, skip first-use profile, complete six-step preferences, confirm AI整理, verify summary/mindmap are generated generically, insights show match reasons, quota is consumed once per cloud LLM API call attempt, and task-local artifacts remain under the task directory.
  - Reopen the same task, use `换个方向`, confirm again, verify the new AI整理 attempt consumes quota again according to its cloud LLM API call attempts and updates insights without asking for long-term profile again.
  - Clear `我的灵感档案`, start a new task's AI整理, verify first-use setup appears again and old task artifacts are unchanged.
