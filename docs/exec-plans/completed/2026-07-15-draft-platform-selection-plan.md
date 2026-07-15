# Draft Platform Selection Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Let the user see and change the target platform on the `生成文字稿` confirmation page (9-option single select), default it from the inspiration profile, and rewire the worker so the draft's "目标平台" comes from the user-selected platform id instead of `Insight.suitable_use` — with a new platform→form mapping (公众号/小红书 kept; 视频号/抖音/Tiktok/X→抖音; others passthrough).

**Architecture:** A request-only `platform` field flows UI → Tauri → worker alongside the existing `insight_id`; the worker validates it against a 9-id vocabulary before checkout (invalid ⇒ no quota), maps it to a prompt form-label via a new `_platform_label_for_draft_platform`, and stops deriving the platform from `suitable_use`. No persistence, no manifest change, no server change, no profile write-back. Delta on top of the `2026-07-12-generate-draft-from-inspiration` feature.

**Tech Stack:** Python worker (`insightflow/prompt.py`, `draft_agent.py`, `models.py`, `requests.py`, `worker_service.py`), Rust/Tauri (`video_processing.rs`, `worker_command.rs`), TypeScript/React (`workerClient.ts`, `DraftConfirmationSheet.tsx`, controller wiring, a new draft-platform config), pytest + Vitest + cargo test.

---

## Purpose / Big Picture

`生成文字稿` today decides the draft's target platform silently from `Insight.suitable_use` (an LLM-emitted Chinese string), which the user cannot see or change on the confirmation page, and whose vocabulary does not align with the inspiration profile's `platforms`. This change makes the platform a visible, editable single-select on the confirmation page, defaulted from the profile (preselect only when the profile has exactly one mappable platform, else `其他`), and rewrites the platform→form mapping to a new 9-id vocabulary aligned with that selector. The platform is purely request-scoped: it is not persisted, not written to any manifest, not sent to the FrameQ server, and never written back to the inspiration profile.

## Decisions (from the 2026-07-15 grilling session)

- **G1 — User-selected platform replaces `suitable_use` in the draft stage.** The mapping function's input is the user-selected platform id, not `Insight.suitable_use`. `suitable_use` is retired from the draft platform path (kept on `Insight` for display/other uses). *User chose A over "coexist".*
- **G2 — Single-select; 1 seed → 1 platform → 1 draft → 1 quota.** No multi-platform batch generation; quota model and `DraftConfirmationSheet` "1 次" notice unchanged.
- **G3 — Default = preselect only when profile has exactly one mappable platform.** Profile platforms length == 1 and that id is in the 9-id draft vocabulary ⇒ preselect it (identity mapping); 0 / ≥2 / single-unmappable (`podcast`/`course_community`/`internal_sharing`) ⇒ default `other`. ≥2 does not guess priority.
- **G4 — Platform→form mapping: 公众号→微信公众号, 小红书→小红书, 视频号/抖音/Tiktok/X(Twitter)→抖音, B站/Youtube/其他→passthrough display name.** `twitter`(X) stays in the 抖音 group because this scenario is video-script-first (user-confirmed). `wechat_channels` changes from its own form to 抖音.
- **G5 — Fallback is passthrough (current behavior kept).** `other` renders as "目标平台：其他。请按该平台文体…". User accepted the slight semantic rough edge (chose c over neutral-wording/omit).
- **G6 — Wire-contract change is in scope.** `RetryInsightsRequest` gains `platform` across frontend TS / Rust / worker Python; only `target="draft"` carries it. Tauri + worker both edited.
- **G7 — Not persisted.** No draft manifest / task manifest / profile write-back; reopen or retry re-derives the default. No backward-compat migration needed (nothing stored).
- **G8 — Separate vocabulary config; stable English ids.** Draft platform config is a new `DRAFT_PLATFORMS` (id + display label), distinct from `INSIGHT_PREFERENCE_FIELDS.platforms`; ids reuse 5 profile ids (`douyin/xiaohongshu/wechat_channels/bilibili/wechat_official_account`) for identity-mapped defaults, plus `youtube/tiktok/twitter/other`.

## Implementation Tasks

- [x] **Task 1 — Worker: platform→form mapping + prompt rewire.** In `insightflow/prompt.py` add `_DRAFT_PLATFORM_LABELS` + `_platform_label_for_draft_platform(platform_id)`; change `build_draft_from_inspiration_prompt` to accept `platform: str` and use the new mapping for the "目标平台" line (stop reading `seed.suitable_use`); remove `_platform_label_for_suitable_use` if nothing else references it. In `draft_agent.py` change `_build_system_prompt` to accept `platform` and use the new mapping; thread `platform` through `run_draft` / `run_draft_generation_step`. Unit-test the mapping across all 9 ids and the prompt builder. Validation: `uv run pytest worker/tests`.
- [x] **Task 2 — Worker: `RetryInsightsRequest.platform` + parsing + validation.** Add `platform: str | None = None` to `RetryInsightsRequest` (`models.py:134`); in `parse_retry_insights_request` (`requests.py:181`) require `platform` for `target="draft"` and validate it ∈ the 9-id set (else `ValueError` ⇒ `INVALID_RETRY_PAYLOAD`, before checkout ⇒ no quota); reject `platform` on `summary`/`insights` targets. Thread `request.platform` into the draft branch in `worker_service.retry_insights_once` (`:210`). Validation: `uv run pytest worker/tests/test_requests.py test_draft_branch.py`.
- [x] **Task 3 — Rust / Tauri boundary.** Add `#[serde(skip_serializing_if = "Option::is_none")] platform: Option<String>` to `RetryInsightsRequest` (`video_processing.rs:41`); thread serialization + the `retry_insights_blocking` fallback object (`worker_command.rs`); keep log field-allowlisting (no full prompt). Add tests: `platform` present on the wire for `target="draft"`, absent for non-draft. Validation: `cargo test --manifest-path app/src-tauri/Cargo.toml`.
- [x] **Task 4 — Frontend: types + client + draft-platform config.** Add a `DRAFT_PLATFORMS` config (id + label) and the profile→default derivation helper; extend `RetryInsightsRequest` in `workerClient.ts` with `platform?: string`; pass `platform` in `retryInsightGeneration` for `target="draft"` (still no `preferenceSnapshot`). Validation: `npm --prefix app test`.
- [x] **Task 5 — Frontend: confirmation-sheet UI + controller wiring.** In `DraftConfirmationSheet.tsx` add the 9-option single-select (chip style reusing `InspirationProfileForm` selected-state), derive the default via `getInsightPreferences()` on open (G3), and return the selected platform on `onConfirm`; wire the controller (`App.tsx` draft-confirm path → `retryInsightGeneration`) to forward `platform`. Validation: `npm --prefix app test && npm --prefix app run lint && npm --prefix app run build`.
- [x] **Task 6 — Documentation + final validation.** Cross-link this plan with the product spec / design doc; run all gates and the manual walk-through (profile 0/1-mappable/≥2 → default; change platform → generates with new mapping, no profile write-back; invalid platform rejected pre-quota). Validation: full gate set below.

## Validation and Acceptance

- `uv run pytest worker/tests` — mapping, request parsing, draft branch.
- `uv run ruff check worker`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `npm --prefix app test` — worker client, confirmation sheet, default derivation.
- `npm --prefix app run lint && npm --prefix app run build` — note: this repo's `app/package.json` has **no `lint` script** (only dev/build/test/preview/tauri); static type-checking is covered by `tsc --noEmit` inside `npm --prefix app run build`.
- `python scripts/validate_agents_docs.py --level WARN`
- Manual: profile empty → default `其他`; profile exactly-1 mappable (e.g. `xiaohongshu`) → preselect 小红书; profile ≥2 or unmappable (`podcast`) → default `其他`; change platform → confirm → draft generated with the mapped "目标平台"; reopen/retry → default re-derived, profile unchanged; invalid/missing platform on `target="draft"` → clear error, no quota consumed; `summary`/`insights` request carrying `platform` → rejected.

Acceptance requires: 9-option single-select on the confirmation page with correct default derivation; user changes do not write back to the profile or any storage; platform→form mapping matches G4; `target="draft"` carries a valid `platform` (missing/invalid/non-draft ⇒ explicit error, no quota); platform not persisted / not in manifest / not sent to server; all parent-spec acceptance criteria still hold (`activeAiTarget="draft"`, single seed, 1-quota-per-attempt, privacy boundary, `JobStage.DRAFT_GENERATING` attribution).

## Context and Orientation

- **Specs (this change):** [product-spec](../../product-specs/2026-07-15-draft-platform-selection.md), [design-doc](../../design-docs/2026-07-15-draft-platform-selection.md).
- **Parent spec:** `docs/product-specs/2026-07-12-generate-draft-from-inspiration.md` (seed/quota/privacy boundaries — unchanged).
- **Worker — mapping/prompt:** `worker/frameq_worker/insightflow/prompt.py` (`_SUITABLE_USE_PLATFORM_LABELS` :274, `_platform_label_for_suitable_use` :282, `build_draft_from_inspiration_prompt` :289, "目标平台" line :306/:360).
- **Worker — agent:** `worker/frameq_worker/draft_agent.py` (`_build_system_prompt` :162 uses `insight.suitable_use` :164; import of `_platform_label_for_suitable_use` :23).
- **Worker — models/parse/service:** `worker/frameq_worker/models.py` (`RetryInsightsRequest` :134, `Insight.suitable_use` :149), `worker/frameq_worker/requests.py` (`parse_retry_insights_request` :181, draft `insight_id` parsing :205-214), `worker/frameq_worker/worker_service.py` (`retry_insights_once` :156, draft branch :210-222).
- **Rust:** `app/src-tauri/src/video_processing.rs` (`RetryInsightsRequest` :41 — add `platform`), `app/src-tauri/src/worker_command.rs` (serialization + `retry_insights_blocking` fallback + log sanitization).
- **Frontend:** `app/src/workerClient.ts` (`RetryInsightsRequest`, `retryInsightGeneration`), `app/src/features/results/DraftConfirmationSheet.tsx` (add platform selector + default), `app/src/insightPreferences.ts` (`platforms` options :181, `getInsightPreferences` client) + the draft-confirm controller wiring in `app/src/App.tsx`; new `DRAFT_PLATFORMS` config (location TBD in Task 4, likely alongside `insightPreferences.ts`).
- **ExecPlan indexes:** register in `docs/exec-plans/active/index.md` now; on completion move to `completed/` and update both indexes.

## Progress

- [x] 2026-07-15: ExecPlan authored after a `/grill-me` session that locked G1–G8; load-bearing symbols and file paths verified via CodeGraph (worker `RetryInsightsRequest`/`parse_retry_insights_request`/draft branch, Rust `RetryInsightsRequest`, prompt mapping, `DraftConfirmationSheet`). Validation: read-only verification.
- [x] 2026-07-15: All 6 implementation tasks (Task 1–6) completed via TDD; the full gate set was re-run independently on the merged worktree (per-gate results recorded in Outcomes & Retrospective).

## Surprises & Discoveries

- Evidence: The draft's "目标平台" currently comes from `Insight.suitable_use` in two places — `insightflow/prompt.py:306` (user prompt) and `draft_agent.py:164` (system prompt) — both via `_platform_label_for_suitable_use` (`prompt.py:282`). Both must be rewired to the user-selected platform; the mapping function input changes from `suitable_use` to `platform`.
- Evidence: `RetryInsightsRequest` already carries `insight_id: Option<i64>` (Rust `video_processing.rs:49`) and `insight_id: int | None` (worker `models.py:140`), serialized only for `target="draft"`. The new `platform` field follows the same pattern (`#[serde(skip_serializing_if = "Option::is_none")]` / required-for-draft).
- Evidence: `parse_retry_insights_request` (`requests.py:200-214`) already enforces "no `preference_snapshot` for draft" and "required integer `insight_id` for draft" before checkout, so invalid-seed consumes no quota. The platform validation slots into the same pre-checkout block to preserve the no-quota-on-invalid contract.
- Evidence: The inspiration profile `platforms` vocabulary (`insightPreferences.ts:181`) has 8 ids and does NOT include `youtube`/`tiktok`/`twitter`; those 3 draft platforms are only reachable by manual selection, never auto-preselected (captured as a known vocabulary asymmetry in the spec).
- Evidence: Tauri end-to-end pass-through needed no change to `worker_command.rs`. The `retry_insights` Tauri command deserializes the frontend JSON into `RetryInsightsRequest` (so `platform` is captured), `retry_insights_blocking` re-serializes it with `serde_json::to_string(&request)` for the worker stdin, and `build_worker_command_spec` passes that JSON string verbatim as `stdin_payload` (the existing `stdin_payload == request_json` test corroborates worker_command's payload passthrough). The `platform` field rides through via the struct's serde derive (`skip_serializing_if = "Option::is_none"`), the same pattern as `insight_id`.
- Evidence: UI selector display names ≠ worker form-mapping labels. Design doc §4 specifies **mutually exclusive** display names (公众号/小红书/视频号/抖音/Tiktok/X(Twitter)/B站/Youtube/其他), whereas the worker's `_DRAFT_PLATFORM_LABELS` maps all 4 short-video ids (`wechat_channels`/`douyin`/`tiktok`/`twitter`) to "抖音". A single-select control cannot present 4 options sharing one label, so the frontend `DRAFT_PLATFORMS` takes its labels from design §4's display names; the 9 **ids** are identical on both ends (single-source-of-truth in spirit).
- Evidence: Frontend interaction tests need a DOM environment. The existing convention uses SSR (`renderToStaticMarkup`) / a homegrown `HookHarness`, which cannot drive the `useEffect(open)` default derivation or the "change selection → confirm" interaction. Hence new devDeps `jsdom` + `@testing-library/react`, scoped to a single new test file via a file-level `// @vitest-environment jsdom` pragma.

## Decision Log

- Decision: Replace `suitable_use` with the user-selected platform as the draft platform source (G1). Rationale: two coexisting platform sources conflict and are hard to explain; the user explicitly chose "replace" over "coexist" in the grilling. Date/Author: 2026-07-15 / User.
- Decision: Single-select, no multi-platform batch (G2). Rationale: multi-platform breaks the 1-seed→1-quota contract and touches manifest/retry; user chose single. Date/Author: 2026-07-15 / User.
- Decision: Default preselect only on exactly-one-mappable profile platform; ≥2 ⇒ `other` (G3). Rationale: avoid guessing priority across multiple platforms; user explicitly rejected preselecting the first. Date/Author: 2026-07-15 / User.
- Decision: Keep passthrough fallback incl. `other` (G5). Rationale: user chose to preserve current behavior and accepted the "目标平台：其他" rough edge over neutral-wording or omission. Date/Author: 2026-07-15 / User.
- Decision: `twitter`(X) maps to 抖音, not fallback (G4). Rationale: this scenario is video-script-first; user confirmed after the design flagged X as text-platform-ish. Date/Author: 2026-07-15 / User.
- Decision: Do not persist the platform (G7). Rationale: user chose ephemeral; avoids manifest/server/profile changes and any backward-compat migration. Date/Author: 2026-07-15 / User.
- Decision: UI selector display names come from design doc §4's mutually exclusive labels, not the worker's form-mapping labels. Rationale: the 4 short-video ids all map to "抖音" in the worker, which would produce duplicate labels unusable in a single-select control; keeping the 9 ids identical on both ends is sufficient. Date/Author: 2026-07-15 / Implementation subagent.
- Decision: Do not modify Tauri's `worker_command.rs`. Rationale: the retry request is deserialized into `RetryInsightsRequest` at the Tauri command boundary and re-serialized by `serde_json::to_string` into stdin; `platform` rides through via the serde derive automatically, mirroring `insight_id`, and the existing privacy/passthrough tests stay green. Date/Author: 2026-07-15 / Implementation subagent.
- Decision: DraftConfirmationSheet interaction tests use jsdom + `@testing-library/react` (new devDeps), pragma-scoped to a single file. Rationale: the existing SSR test convention cannot cover `useEffect` default derivation and click interactions. Date/Author: 2026-07-15 / Implementation subagent.

## Outcomes & Retrospective

- Automated gate results (re-run independently on the merged worktree): `uv run pytest worker/tests` → 365 passed (1 unrelated pydub audioop DeprecationWarning); `uv run ruff check worker` → All checks passed; `cargo test --manifest-path app/src-tauri/Cargo.toml` → 111 passed; `npm --prefix app test` → 37 files / 305 passed; `npm --prefix app run build` (tsc && vite build) → 0 errors; `python scripts/validate_agents_docs.py --level WARN` → 0 errors 0 warnings; `npm run lint` N/A (this repo has no such script — `tsc` substitutes).
- Code-level walkthrough (done): `platform` flows end-to-end — UI select → `onConfirm(platform)` → `App.confirmDraftGeneration` → `retryInsightGeneration(..., platform)` → `useTaskProcessingController` → `workerClient.retryInsights(target=draft, platform)` → Tauri deserializes `RetryInsightsRequest.platform` → serde re-serializes into stdin → worker `parse_retry_insights_request` validates ∈ `DRAFT_PLATFORM_IDS` → `run_draft_generation_step` threads `request.platform` through → `run_draft` → `_build_user_prompt`/`_build_system_prompt` → `_platform_label_for_draft_platform` → prompt "目标平台：{label}". A non-draft target carrying `platform` is rejected by the worker; a draft with a missing/illegal `platform` ⇒ `INVALID_RETRY_PAYLOAD`, failing before checkout with no quota consumed.
- Residual risks: R1 (`other` fallback renders "目标平台：其他" with slightly empty semantics — accepted at G5); R2 (vocabulary drift — guarded by `test_requests.py` rejecting any id outside the 9-id set; the 9-id single source of truth lives in `prompt.py`'s `DRAFT_PLATFORM_IDS`, imported and reused by `requests.py`); lint gap (the repo has no lint script at all — not introduced by this feature; static checking relies on `tsc`); new test devDeps (`jsdom`/`@testing-library/react`, pragma-scoped).
- UI runtime walkthrough (open the confirmation page, verify defaults against profiles of length 0/1/≥2, change the selection, confirm) is left for the user to perform at runtime.
