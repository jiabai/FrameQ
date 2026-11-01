# LLM Note Titles Implementation Plan

> For implementation, use the executing-plans workflow in the existing workspace. Keep this change limited to automatic note titles and preserve concurrent UI work.

## Goal

Generate and persist a concise LLM title for each newly transcribed note, with visible submission disclosure, one additional managed AI Credit per attempt, and consistent local title presentation.

## Architecture

Keep transcription and title generation as sequential supervised operations. First persist the transcript through the current URL/local-media pipeline, then invoke the existing `retry_insights` route with a new closed `title` target for the verified task. A dedicated worker title generator makes one call through the configured provider, validates one structured title, and atomically updates optional manifest metadata. Rust retains task admission, mutation ownership, cancellation, and worker supervision. React owns the authorized submission snapshot and task-bound sequencing. The account service remains unchanged.

## Scope and approval

- Product specification: `docs/product-specs/2026-10-31-llm-note-titles.md`.
- The user confirmed automatic post-transcription generation, submission-time cloud disclosure, and one additional AI Credit.
- On 2026-10-31, the user approved this written plan and requested implementation in the main thread: “确认按此计划实现，发送给主线程实现”. The plan confirmation requirement under `WORKFLOW.md` is satisfied.
- Existing notes receive no automatic bulk calls. Existing URL-task reuse does not become a paid rename operation.

## Progress

- [x] Inspect the current title projection, local task persistence, transcription completion, managed provider, cancellation/controller, and closed worker contracts.
- [x] Confirm generation timing and extra charge with the user.
- [x] Record the product requirements and implementation plan.
- [x] 2026-10-31: The user confirmed the written implementation plan and requested implementation in the main thread.
- [x] Extend title metadata and cross-language request/result/history validation with contract v10 and legacy manifest compatibility.
- [x] Implement one-call title generation, bounded sampling, strict output validation, and atomic metadata persistence.
- [x] Implement disclosure, sequential submission, captured language, failure/retry, and durable pre-admission cancellation in the desktop controller.
- [x] Apply the saved title consistently to sidebar, Notes, Collection, Artifacts, history management, toolbar, and dissection confirmation.
- [x] Run automated gates, two real managed-provider attempts with isolated official audio samples, fresh-process persistence reads, and a Windows build/startup check. Record the remaining native acceptance below.
- [ ] Exercise a fresh URL note through the complete native UI, title cancellation during real processing, and every native title surface.

## Task 1: Contract and task metadata

Files:

- `contracts/desktop-worker-contract.json` and its Python/Rust/TypeScript consumers.
- `worker/frameq_worker/models.py`, `requests.py`, `desktop_contract.py`, `task_store.py`.
- `app/src-tauri/src/task_manifest/schema.rs`, `access.rs`, task result and history projections.
- `app/src/historyClient.ts`, `workerClient.ts`, worker/workflow result decoders and state definitions.

Steps:

1. Add optional `note_title` task metadata with consistent Unicode-count, trim, single-line, and 60-character validation. Missing metadata means no generated title; present invalid metadata is an error.
2. Add the `title` retry target, captured output language, and title result/state fields to the closed protocol. Increment the worker contract version and update every existing version/enum consumer together.
3. Project one validated title through worker results and history list/detail. Preserve existing source identity, artifact keys, task IDs, paths, and Collection IDs.
4. Use actual manifest fixtures and storage operations to verify legacy acceptance and preservation through finalization, transcript edits, and existing AI target saves.

## Task 2: One-call worker title generation

Files:

- New `worker/frameq_worker/note_title.py`.
- `worker/frameq_worker/worker_application/insight_retry.py`, `ai_runtime.py`, `ai_prompts.py`, task persistence helpers.
- Relevant `worker/tests/` contract, metadata, and persistence checks.

Steps:

1. Read a verified saved transcript through `TaskStoreFacade`, with mutation ownership and the existing recovery boundary.
2. Build a deterministic sample covering the beginning, middle, and end, capped at 12,000 Unicode characters. Include only transcript-derived content, the captured output language, and title instructions.
3. Use the current provider's one-call path with supplier automatic retries disabled. Do not run a multi-turn agent for this target. Parse structured output with the existing JSON facilities and validate the title before publication.
4. Commit title metadata atomically while preserving every existing artifact and manifest field. Return stable title-specific errors for invalid generation and failed persistence, without echoing content or raw exceptions.
5. Retain prior title/transcript bytes after validation failure or failed publication. Verify these invariants against actual filesystem operations, including linked paths and recovery state.

## Task 3: Native admission and supervision

Files:

- `app/src-tauri/src/video_processing/retry_insights.rs`, `task_result.rs`.
- Existing worker request/result parsing, operation policy, and task mutation coordination modules.
- Relevant Rust runtime, history, task-manifest, and contract tests.

Steps:

1. Admit `title` only for a verified task with a saved authoritative transcript. Reject invalid task/request/locale before checkout.
2. Reuse the `RetryInsights` supervisor and its fixed deadline/cancellation behavior. Confirm it admits a one-call title response and retains the original task identity.
3. Preserve the transcript when cancellation occurs during title generation. Do not route that cancellation through the pre-transcript workflow reset.
4. Verify malformed output and stale task responses fail closed, and that title publication never changes task/source identity or unrelated task files.

## Task 4: Submission, progress, and retry

Files:

- `app/src/features/workflow/TaskComposer.tsx`, `useTaskProcessingController.ts`, workflow transition/state modules.
- `app/src/App.tsx`, relevant progress/result components.
- `app/src/i18n/workflowResources.ts`, `shellResources.ts`, error/progress resources.

Steps:

1. Show the cloud transcript-sample disclosure and one-Credit cost before explicit URL/local-file submission in all three locales. File selection alone performs no title call.
2. Snapshot output language and authorization on submission. After a newly created task successfully persists its transcript, start one title attempt before releasing the operation guard. Preserve a pending originating Collection destination throughout both operations.
3. Distinguish real new-task completion from existing URL-task reuse; neither history restoration nor UI remount can start title generation.
4. Show title generation progress and cancellation. Keep transcript/artifacts accessible after title failure or insufficient quota and provide an explicit title retry with the same charge disclosure.
5. Keep operation/task identity checks across both awaited operations. Prevent duplicate submissions and retries. An old completion cannot overwrite a newer task or add it to the wrong Collection.

## Task 5: Consistent title presentation

Files:

- `app/src/features/shell/shellNavigation.ts`, `DesktopSidebar.tsx`, `ShellLibrary.tsx`.
- `app/src/features/collections/` note lists, `app/src/features/history/HistorySheet.tsx`, and task toolbar title selection.

Steps:

1. Prefer validated saved title metadata at every note-title surface. Keep transcript previews as separate text and preserve user content verbatim.
2. Ensure titleless legacy tasks continue to use their existing display behavior without triggering a cloud request.
3. Verify actual locale changes, history refresh, restart, and Collection membership do not modify or regenerate saved titles.

## Validation

- Run focused Python checks for actual title validation, prompt sampling, manifest compatibility, preservation, and atomic storage. Run `uv run ruff check worker` and `uv run pytest worker/tests` after focused checks pass.
- Run focused Rust title/manifest/history/protocol checks, then `cargo test --manifest-path app/src-tauri/Cargo.toml -- --test-threads=1` with the process permissions required by the existing watchdog tests.
- Run focused frontend decoding/state/component checks, then `npm --prefix app test`, `npm --prefix app run lint`, and `npm --prefix app run build`.
- Since contracts and script-read sources change, run `node --test scripts/tests/*.test.mjs` and Python script tests with temporary/cache output under the ignored workspace `build/` directory.
- Run `python scripts/validate_agents_docs.py --level ERROR` and `git diff --check`.
- Rebuild using `npm --prefix app run tauri -- build --no-bundle` and verify real URL/local-media processing, one-call title output, restart persistence, cancellation after transcript completion, and all title surfaces. Use the configured real provider for cloud behavior; record actual account Credits before/after. Never replace unavailable external verification with a fake provider result.
- Update `docs/ARCHITECTURE.md` and `docs/SECURITY.md` to state the approved title call, direct-supplier transcript sample, and unchanged account-server privacy boundary. Record verification results in this plan before completion.

## Decisions

- 2026-10-31: The user approved this plan and explicitly requested that implementation be handed to the main thread.
- 2026-10-31: Automatic title generation is authorized for newly transcribed notes, with visible pre-submission disclosure and one additional managed AI Credit per attempt.
- 2026-10-31: Title generation uses one bounded call through the existing provider and `retry_insights` supervision boundary; it does not require a new account endpoint or a multi-turn generation loop.
- 2026-10-31: Existing task identity, local artifact layout, Collection membership, and authoritative transcripts survive title failure and cancellation. Existing notes are not bulk-renamed.
- 2026-10-31: A closed `record_note_title_cancellation` Tauri command commits cancellation before title-worker admission without checkout. Expected-metadata comparison preserves a newer committed result. Competing AI actions remain disabled throughout title generation.

## Verification record

- `npm --prefix app test`: 106 files / 1102 tests passed, including 14 real production-browser cases and the retained bottom-left Settings entry after the separate toolbar change.
- `npm --prefix app run lint` and the production frontend build passed. `npm --prefix app run tauri -- build --no-bundle` passed; the running release executable contains the current `index-B_KO0GUp.js` asset. Both staged and release worker trees match the tested canonical source byte-for-byte.
- `uv run pytest worker/tests`: 1198 passed / 4 skipped. `uv run ruff check worker` passed. The skipped platform/external cases do not count as live-provider evidence; Rust includes actual Windows file-lock, directory-junction, and cancellation/publication preservation checks.
- `cargo test --manifest-path app/src-tauri/Cargo.toml -- --test-threads=1`: 381 passed with the process permissions required by the real watchdog parent/descendant tests.
- Node script checks: 51 passed. Python script checks: 1 passed. Document governance: 0 errors / 0 warnings. `git diff --check` passed.
- Real verification used official SenseVoice Chinese and English audio samples, actual local ONNX transcription, the configured managed supplier, and isolated files under `build/llm-note-titles/`. Each title attempt used exactly one additional AI Credit: account used count 27 → 28 → 29. Both titles passed output validation and persisted; transcript SHA-256 values remained unchanged. A fresh Python process restored the metadata and performed no checkout (Credit delta 0).
- Sanitized evidence: `build/llm-note-titles/live-report.json`. No existing user note or Collection was renamed by verification. These two live checks prove the actual Python worker/provider path and are not presented as native IPC or complete URL-UI evidence.
- Native accessibility confirms the submission disclosure in the rebuilt Windows Home and the absence of the top-right Settings button. The user-menu Settings flow, keyboard focus, and narrow-window behavior passed actual production-browser checks.

## Risks and limits

- Complete native URL submission, in-flight title cancellation, and all native title surfaces remain unverified. Actual worker/provider calls and filesystem tests establish the recorded behavior only within their stated scope.
- Long transcripts use a bounded sample; the title prompt must explicitly stay within the supplied evidence.
- Title generation uses the saved transcript's content; bounded sampling and transcription accuracy constrain the resulting title. No release, installer publication, or Git commit was performed.
