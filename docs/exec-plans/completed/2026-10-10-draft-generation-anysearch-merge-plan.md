# Draft Generation + Anysearch Config Merge Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Merge PR #5 (17 commits, merge base `da04d01`) into `main` in full so users get the complete draft-generation pipeline on top of the post-v0.3.8 refactor: a fourth AI target card ("生成文字稿"), seed selection from insights, a 9-platform confirmation sheet, a split-pane draft editor with save/copy/download/export, retry semantics with a dedicated `draft_generating` error stage, and the server-managed Anysearch MCP config (admin panel + desktop checkout). The merge is adapted to main's newer architecture instead of replayed verbatim: i18n literals must go through the synthesis resources, the worker-result registry gains `draft`, and the desktop retry API keeps main's single-object `RetryInsightsInput` shape.

## Progress

- [x] 2026-10-10: Started `git merge --no-ff --no-commit da04d01` and triaged conflicts across docs, contracts, server, worker, Rust, and app. Validation: `git status` conflict list reviewed before staging.
- [x] 2026-10-10: Resolved docs/contracts conflicts (draft product spec sections, exec-plan index entries, `contracts/desktop-worker-contract.json` task/artifacts/error-stage shapes). Validation: `python scripts/validate_agents_docs.py --level ERROR` (0 errors).
- [x] 2026-10-10: Resolved worker conflicts (draft pipeline stage, platform prompt labels) and server conflicts (Anysearch admin routes, desktop checkout, Prisma store split). Validation: `uv run ruff check worker` clean; `uv run pytest worker/tests -q` → 995 passed, 2 skipped.
- [x] 2026-10-10: Resolved Rust conflicts by porting `load_draft_detail` / `save_draft_edit` into the new worker-runtime module layout and registering `draft` in `result_protocol.rs`. Validation: covered indirectly by TS contract tests (cargo unavailable locally).
- [x] 2026-10-10: Resolved app conflicts: worker-result protocol registry (`TASK_RESULT_FIELDS`/`TASK_ARTIFACT_KEYS` + draft normalization), retry wiring to main's object-signature `retryInsights`, i18n adaptation of `DraftConfirmationSheet`/`DraftResultSheet`/`regenerateDraft`, ids-only `DRAFT_PLATFORMS`, and fixture/registry updates across 15+ test files. Validation: `npx tsc --noEmit` clean; app vitest 842/842.
- [x] 2026-10-10: Server re-adaptation: restored the missing Anysearch public-error allowlist entries in `routes/shared.ts`, added the `AnysearchConfig` migration (`202610100001_anysearch_config`), narrowed `AnysearchConfigService`'s store capability to a `Pick<Store, ...>`, and updated closed-set boundary tests. Validation: server vitest 324 passed / 1 skipped; `npm run build` exit 0.
- [x] 2026-10-10: Browser smoke suite green after feeding `draft: null` on every wire-result fixture and scoping confirmation-sheet clicks by aria-label. Validation: `tests/app-input.browser.test.ts` 34/34, twice.
- [x] 2026-10-12: Ran the Rust gate on stable-x86_64-pc-windows-msvc (cargo 1.99.0) after installing rustup; the first run exposed 3 failures in `draft_detail` tests plus one functional gap. Fixed `draft_detail.rs` to tolerate a manifest-declared draft whose file has not landed (empty view on load; backup path canonicalized only when it already exists, matching `transcript_detail`'s save pattern), and restored the PR branch's server-managed anysearch checkout env injection (`FRAMEQ_ANYSEARCH_SOURCE` / `FRAMEQ_ANYSEARCH_CHECKOUT_URL` / `FRAMEQ_ANYSEARCH_SESSION_TOKEN`) in `worker_runtime/command.rs`, which the runtime-layout port had dropped. Validation: `cargo test --manifest-path app/src-tauri/Cargo.toml` 330 passed / 0 failed.

## Surprises & Discoveries

- Evidence: the TS-side `workerResultProtocol.ts` registry initially lacked `draft` while the Rust side already had it — `parseWorkerResult` rejected every completed result and 7 `workerClient` tests flipped to `failed`/protocol-violation. The TS registry is the single source of truth for frontend parse acceptance.
- Evidence: `readObjectWithOptional` requires the `draft` key to exist on the wire (null allowed), so every mock-Tauri bridge fixture that returns a task result must carry `draft: null` — the browser smoke suite silently degraded to `WORKER_PROTOCOL_VIOLATION` banners until fixtures were updated (`tests/support/mockTauriBridge.ts`, inline scenarios in `app-input.browser.test.ts`).
- Evidence: the merge dropped two Anysearch entries from the `publicOperationErrors` allowlist in `server/src/routes/shared.ts`, turning the admin validation 400 into a 500 — the allowlist is an explicit, closed safety surface that conflict resolution must re-check.
- Evidence: PR #5 added `schema.prisma` models without a migration directory; the test harness deploys migrations via `prisma/migrations/*/migration.sql`, so a hand-written `202610100001_anysearch_config` migration was required.
- Evidence: `AnimatedSheet` unmounts on `onAnimationComplete`; under load a still-closing summary confirmation sheet (same `.preference-flow-sheet` class, earlier DOM order) can capture a class-scoped `.sheet-footer .primary-button` query and misroute the click. Aria-label scoping (`[aria-label="確認靈感啟發"] ...`) removes the ambiguity.
- Evidence (2026-10-12, Rust gate): main's post-v0.3.8 artifact validation canonicalizes every path, so merged write paths that target not-yet-existing files (the draft `ai/original/draft.md` backup on first save) must use `ensure_artifact_parent` + link rejection instead of `validate_existing_path`, exactly as `transcript_detail/edit_storage.rs` already does. Also, porting command construction into `worker_runtime/command.rs` silently dropped the PR branch's anysearch checkout env block even though the constants survived in `settings.rs` (dead-code warnings were the signal); the worker `draft_agent.py` server-managed flow depends on those three `FRAMEQ_ANYSEARCH_*` variables.
- Evidence: `npm --prefix app install` misresolves on this machine (ENOENT at repo root) and PowerShell 5 lacks `&&`; both commands must run with cwd set and `;` separators.

## Decision Log

- Decision: adapt PR #5 to main's i18n architecture (all draft copy moved into `synthesis` resources under `draftPlatform.*` / `draftConfirmation.*` / `draftResult.*`; `DRAFT_PLATFORMS` became a readonly id list) instead of importing PR's hard-coded Chinese labels. Rationale: `check-i18n-literals` and `preferencePresentation` tests enforce that business modules carry no Han literals; labels must live in resources. Date/Author: 2026-10-10, Codex.
- Decision: keep main's single-object `RetryInsightsInput` (`{ taskId, target, outputLanguage, insightId, platform }`) and make draft require both `insightId` and `platform` (guard returns before any UI state change). Rationale: main's closed wire contract validates exact variants; the PR's positional signature and optional-platform draft path are incompatible. Date/Author: 2026-10-10, Codex.
- Decision: forward `resolvedLocale` as the draft retry's `outputLanguage` in `App.tsx`. Rationale: draft copy follows the UI language like summary/insights retries; the PR's null placeholder does not satisfy the locale type. Date/Author: 2026-10-10, Codex.
- Decision: scope the browser-smoke confirmation clicks by aria-label rather than changing AnimatedSheet's unmount timing. Rationale: the flake is a test-selector ambiguity, not a product defect; changing motion lifecycle would touch the motion-confirmation contract. Date/Author: 2026-10-10, Codex.
- Decision: hand-write migration `202610100001_anysearch_config` matching the reviewed migration style instead of generating via prisma CLI. Rationale: keeps the migration chain deterministic and reviewable; the schema model is a plain 6-column singleton table. Date/Author: 2026-10-10, Codex.
- Decision: restore `app/package-lock.json` from main and reinstall. Rationale: PR #5 adds no new app dependencies and main's lockfile already carries i18next/motion; regenerating it produced npm-arborist failures. Date/Author: 2026-10-10, Codex.

## Outcomes & Retrospective

The merge lands draft generation end-to-end on the refactored main: the fourth AI card drives seed selection → platform confirmation (fixed 1-credit disclosure, privacy notice) → `retry_insights` draft call carrying `insight_id`/`platform` → the worker's `draft_generating` stage → a split-pane draft editor with save/copy/download/export/regenerate, all localized in zh-CN/zh-TW/en-US. The server gains the Anysearch MCP admin panel, desktop checkout endpoint, encrypted key storage (singleton table + migration), and desktop-config distribution. Contract v-shapes (`task.draft`, artifacts key, error stage) are consistent across Rust, TypeScript, and `contracts/desktop-worker-contract.json`.

Validation executed: `uv run ruff check worker` clean; `uv run pytest worker/tests -q` 995 passed / 2 skipped; app `npx tsc --noEmit` clean, `npm run lint` passed, app vitest 842/842 (82 files), `npm run build` OK; server vitest 324 passed / 1 skipped (37 files), `npm run build` exit 0; `python scripts/validate_agents_docs.py --level ERROR` 0 errors; `git diff --check` clean.

Residual risk: none from the Rust gate — `cargo test --manifest-path app/src-tauri/Cargo.toml` ran green on 2026-10-12 (330 passed / 0 failed) and the two merge-remnant defects it found are fixed in follow-up commits. The browser smoke "freezes confirmed output language" test had one observed flake root-caused to a not-yet-unmounted sibling sheet; aria-label scoping fixed it, but `AnimatedSheet`'s animation-callback-dependent unmount remains sensitive to heavy load. One skipped server test is pre-existing. Pre-existing (non-merge) `cargo fmt` drift remains in `insight_preferences.rs` and `retry_insights.rs` test sections under rustfmt 1.99; formatting is not a documented gate and the files were left untouched.

## Context and Orientation

- Spec/docs: `docs/product-specs/draft-generation.md` (merged sections), `docs/exec-plans/completed/2026-07-13-generate-draft-from-inspiration-plan.md`, `2026-07-15-draft-result-editor-plan.md`, `2026-07-15-draft-platform-selection-plan.md`, `2026-07-15-server-managed-anysearch-config-plan.md`
- Contracts: `contracts/desktop-worker-contract.json`, `app/src/workerResultProtocol.ts`, `app/src/desktopWorkerProtocol.ts`, `app/src-tauri/src/worker_runtime/result_protocol.rs`
- App: `app/src/features/results/DraftConfirmationSheet.tsx`, `DraftResultSheet.tsx`, `regenerateDraft.ts`, `app/src/insightPreferences.ts`, `app/src/i18n/synthesisResources.ts`, `app/src/App.tsx`, `app/src/features/workflow/useTaskProcessingController.ts`
- Worker: `worker/frameq_worker/` draft pipeline stage + platform prompt labels
- Server: `server/src/routes/admin.ts`, `routes/desktopLlm.ts`, `routes/shared.ts`, `src/anysearchConfig.ts`, `src/store/memory/anysearchConfig.ts`, `src/prismaStore/anysearchConfig.ts`, `prisma/migrations/202610100001_anysearch_config/`, `prisma/schema.prisma`
- Tests: `app/tests/app-input.browser.test.ts`, `app/tests/support/mockTauriBridge.ts`, `server/tests/anysearchAdmin.test.ts`, `server/tests/anysearchConfigStore.test.ts`, `server/tests/serverModuleBoundaries.test.ts`, `server/tests/storeModuleBoundaries.test.ts`, `server/tests/prismaMigration.test.ts`, `server/tests/storeCompatibility.test.ts`

## Plan of Work

1. [x] Triage merge conflicts per module (docs → contracts → server → worker → Rust → app).
2. [x] Restore the registry/contract alignment for `draft` (TS + Rust + contract JSON).
3. [x] Re-wire draft retry to main's API shape and gate on insightId + platform.
4. [x] i18n-adapt all draft UI and remove Han literals from business modules.
5. [x] Restore server Anysearch error allowlist, add migration, narrow store capability, update boundary tests.
6. [x] Update wire-result fixtures and smoke-test selectors; run all gates; archive plan.

## Validation and Acceptance

- `uv run ruff check worker` — clean
- `uv run pytest worker\tests -q` — 995 passed, 2 skipped
- `npx vitest run --no-file-parallelism` (app) — 842/842
- `npm run lint` (app) — tsc + i18n literal checks passed
- `npm run build` (app, server) — both OK
- `npx vitest run --no-file-parallelism` (server) — 324 passed, 1 skipped
- `python scripts/validate_agents_docs.py --level ERROR` — 0 errors
- `git diff --check` — clean
- Manual regression: process a task → generate insights → pick a seed on an insight card ("选为文字稿种子") → draft card opens the 9-platform confirmation → confirm generates the draft → open the draft viewer, edit, save, copy, download, export; regenerate asks for confirmation once dirty.
