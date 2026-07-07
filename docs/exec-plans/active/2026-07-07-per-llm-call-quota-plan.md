# Per-LLM-Call Quota Accounting Plan

> This ExecPlan is a living document. Keep Progress, Discoveries, Decision Log, and Validation current as implementation proceeds.

## Purpose / Big Picture

FrameQ quota now means `1 use = 1 cloud LLM API/chat-completion call attempt`. The prior implementation gave the worker one server-managed checkout per AI整理 run and then reused the returned supplier config for multiple `generate()` calls. This plan aligns code with the new product wording while preserving the local-first boundary: FrameQ server still does not receive transcripts, prompts, preference snapshots, summaries, mindmaps, or insights.

## Progress

- [x] 2026-07-07: Existing uncommitted profile-cancel fix and quota-copy documentation changes were committed separately before starting this implementation.
- [x] 2026-07-07: Server, Tauri, worker, product spec, architecture, design, and security boundaries were inspected. Discovery: server-side `consumeLlmQuota(userId, requestId)` already supports per-request-id idempotency, so the main missing behavior is worker per-call checkout id generation.
- [x] 2026-07-07: Wrote failing worker and frontend copy tests. Red evidence: `uv run pytest worker\tests\test_llm.py` failed because only `run-12345678` was checked out once; `npm --prefix app test -- insightPreferenceFlow.test.ts` failed because `getQuotaDisclosureCopy` did not exist.
- [x] 2026-07-07: Implemented per-call checkout id derivation in the server-managed worker LLM client. Each `generate()` now checks out `<seed>-call-0001`, `<seed>-call-0002`, etc. Server tests now cover distinct request ids charging separately and replayed request ids staying idempotent.
- [x] 2026-07-07: Updated confirmation, account, Admin Web, progress, architecture, design, and product-spec copy from fixed insight-generation/topic-count language to LLM API-call quota language.
- [x] 2026-07-07: Focused gates passed: `uv run pytest worker\tests\test_llm.py`, `uv run pytest worker\tests\test_pipeline.py worker\tests\test_llm.py`, `npm --prefix app test -- insightPreferenceFlow.test.ts workflow.test.ts accountCopy.test.ts`, `npm --prefix server test -- llmQuota.test.ts admin.test.ts`, and `python scripts\validate_agents_docs.py --level WARN`.
- [x] 2026-07-07: Full gates passed before final diff cleanup where applicable: `npm --prefix server test` (35 tests), `uv run pytest worker\tests` (141 tests), `npm --prefix app test` (141 tests), `npm --prefix app run build`, `cargo test --manifest-path app\src-tauri\Cargo.toml` (50 tests), and `npm --prefix server run build`. `uv run ruff check worker` initially found one long progress-message line; it was fixed by extracting shared constants and then passed.

## Discoveries

- `server/src/server.ts` already calls `store.consumeLlmQuota(session.userId, request_id, now())` for `/api/desktop/llm/checkouts`.
- `server/src/store.ts` and `server/src/prismaStore.ts` already make `requestId` idempotent per user.
- `worker/frameq_worker/llm.py` currently caches a checked-out `OpenAICompatibleInsightClient`, so two `generate()` calls consume only one quota use.
- `app/src-tauri/src/lib.rs` passes one `FRAMEQ_LLM_CHECKOUT_REQUEST_ID` to the worker. This can remain a run-level seed if the worker derives stable per-call ids from it.
- `app/src-tauri/resources/worker/frameq_worker` is absent in this worktree; installer build scripts copy from `worker/frameq_worker`.
- Current product/UI copy no longer uses `话题点次数` as the quota label; visible quota language is now LLM API-call based.

## Decision Log

- Decision: Keep the existing `/api/desktop/llm/checkouts` endpoint and request body shape. Rationale: it already authorizes and charges by `request_id`; changing the API would add churn without changing the security boundary. Date/Author: 2026-07-07 / Codex.
- Decision: Treat `FRAMEQ_LLM_CHECKOUT_REQUEST_ID` as a run-level id seed and derive per-call ids as `<seed>-call-0001`, `<seed>-call-0002`, etc. Rationale: this preserves Tauri/Rust wiring while making each supplier call independently billable and idempotent. Date/Author: 2026-07-07 / Codex.

## Validation Plan

- Worker: `uv run pytest worker\tests\test_llm.py`
- Worker full: `uv run pytest worker\tests`
- Worker lint: `uv run ruff check worker`
- Frontend focused: `npm --prefix app test -- insightPreferenceFlow.test.ts`
- Frontend full/build: `npm --prefix app test`, `npm --prefix app run build`
- Server focused/full: `npm --prefix server test -- llmQuota.test.ts`, `npm --prefix server test`
- Rust: `cargo test --manifest-path app\src-tauri\Cargo.toml`
- Docs: `python scripts\validate_agents_docs.py --level WARN`
- Diff hygiene: `git diff --check`

## Acceptance

- One worker `generate()` call performs one managed checkout before the supplier call.
- Multiple `generate()` calls in one AI整理 run use distinct per-call request ids and therefore consume multiple quota uses.
- Reusing the same per-call request id remains idempotent on the server.
- Failed or partially failed AI整理 attempts still consume quota for any supplier calls whose managed checkout was attempted.
- Confirmation copy no longer says a confirmed AI整理 fixedly consumes one use.

## Outcomes & Retrospective

Implemented per-LLM-call quota accounting without changing the server endpoint shape or sending user content to FrameQ server. The worker now derives one managed checkout request id per supplier call, the server test suite documents per-request-id charging and replay idempotency, and desktop/Admin/docs copy now describes quota as LLM API-call uses rather than topic-generation uses.

Residual risk: a real authenticated desktop smoke with a completed transcript was not run in this session, so supplier-side quota movement was verified by automated server/worker tests rather than a live end-to-end account.
