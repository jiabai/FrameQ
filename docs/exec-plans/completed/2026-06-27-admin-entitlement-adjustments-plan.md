# Admin Entitlement Adjustments Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Give FrameQ support operations a small, auditable Admin Web workflow for compensating users when product bugs or unstable releases waste entitlement time or insight-generation quota. Users should simply see their expiry and remaining topic-generation uses increase in the existing desktop account status; they should not see a new public unlock product, self-service support portal, or any change to local-first media processing.

## Progress

- [x] 2026-06-27: Captured the product scope for manual compensation of entitlement expiry and insight quota. Validation: `docs/product-specs/2026-06-27-admin-entitlement-adjustments.md`.
- [x] 2026-06-27: Inspected existing server Admin Web, entitlement, quota, activation, and CSRF paths before planning implementation. Validation: `server/src/server.ts`, `server/src/adminPage.ts`, `server/src/store.ts`, `server/src/prismaStore.ts`, `server/tests/admin.test.ts`, and `server/tests/llmQuota.test.ts`.
- [x] 2026-06-27: Registered the active plan and synchronized architecture, security, design, and product indexes for the compensation boundary. Validation: `python scripts\validate_agents_docs.py --level WARN` and `git diff --check`.
- [x] 2026-06-27: Added persistent audit model and store methods for admin entitlement adjustments. Validation: `npm --prefix server test -- tests/llmQuota.test.ts`.
- [x] 2026-06-27: Added admin-only adjustment API with CSRF validation and payload limits. Validation: `npm --prefix server test -- tests/llmQuota.test.ts`.
- [x] 2026-06-27: Added Admin Web controls for extending expiry and adding quota with reason/note capture plus recent adjustment history. Validation: `npm --prefix server test -- tests/admin.test.ts`.
- [x] 2026-06-27: Ran full server and Prisma generation gates. Validation: `npm --prefix server test`, `npm --prefix server run build`, and `npm --prefix server run prisma:generate`.
- [x] 2026-06-27: Ran Admin Web manual acceptance and final governance gates before archival. Validation: Admin Web local smoke extended `acceptance-user@example.com` by 7 days and 5 topic uses, refreshed desktop account status to `2026-08-03T08:00:00.000Z` with 21 remaining uses, `python scripts\validate_agents_docs.py --level WARN`, and `git diff --check`.

## Surprises & Discoveries

Evidence: `server/src/server.ts` already has Admin cookie authentication, CSRF validation, activation-code creation, LLM config management, and `POST /admin/api/users/:userId/llm-quota` for editing remaining quota.

Evidence: `server/src/store.ts` and `server/src/prismaStore.ts` currently expose `upsertEntitlement` and `updateEntitlementQuota`, but there is no append-only audit record for why an administrator changed entitlement or quota.

Evidence: `server/prisma/schema.prisma` has `Entitlement`, `LlmUsageEvent`, `ActivationCode`, `AdminSession`, and `WebhookEvent`, but no model dedicated to manual support compensation.

Evidence: `server/tests/llmQuota.test.ts` already proves that admin quota edits affect `/api/desktop/account`, so the compensation flow can reuse the existing desktop account response shape.

Evidence: The first implementation attempt exposed that `MemoryStore.getEntitlement` returns a mutable record reference; audit `before*` values must be copied before calling `upsertEntitlement`, or the in-memory record update mutates the audit snapshot.

## Decision Log

Decision: Add compensation as an Admin Web operation on the existing `Entitlement` record rather than creating a separate product plan or coupon system. Rationale: The user need is support repair for unstable product behavior, and the current processing gate already depends on `Entitlement` and LLM quota fields. Date/Author: 2026-06-27 / User + Codex.

Decision: Prefer additive quota grants over setting remaining quota for the compensation workflow. Rationale: Adding `quota_add` preserves `llmQuotaUsed` and makes "reward user with more topic uses" easier to audit than overwriting remaining uses. Date/Author: 2026-06-27 / Codex.

Decision: Require an append-only audit record for every manual adjustment. Rationale: Manual entitlement edits affect paid access and need traceability by administrator, reason, before/after values, and timestamp. Date/Author: 2026-06-27 / Codex.

Decision: Keep desktop APIs and UI unchanged. Rationale: The account status response already carries expiry and quota fields; users only need to see refreshed entitlement, not a new compensation product surface. Date/Author: 2026-06-27 / Codex.

## Outcomes & Retrospective

Implemented the server/Admin Web compensation path. Admin Web can now post an entitlement adjustment for a selected user, extending expiry, adding insight-generation quota, requiring a reason, optionally storing a note, and listing recent audit records. The server updates the existing `Entitlement` record, preserves `llmQuotaUsed`, writes an append-only `AdminEntitlementAdjustment` audit record, and keeps desktop account status on the existing response shape.

Validation: `npm --prefix server test -- tests/llmQuota.test.ts` passed with 7 tests, `npm --prefix server test -- tests/admin.test.ts` passed with 5 tests, `npm --prefix server test` passed with 35 tests across 9 files, `npm --prefix server run build` passed, and `npm --prefix server run prisma:generate` passed.

Manual Admin Web acceptance passed on 2026-06-27 using a local seeded Admin Web session. The administrator opened `/admin`, adjusted `acceptance-user@example.com` with `extend_days=7`, `quota_add=5`, reason `bug_compensation`, and note `bug compensation manual smoke`. The page updated the row to expiry `2026/08/03 16:00` and remaining uses `21`, reload showed the append-only audit history row, and `/acceptance/account` reported `entitlement_expires_at=2026-08-03T08:00:00.000Z`, `llm_quota_limit=25`, `llm_quota_used=4`, and `llm_quota_remaining=21`.

Residual risk: This was a local smoke over seeded in-memory data, not a production database operation. The product boundary remains unchanged: no desktop UI change, no new public unlock product, and no local media or transcript data sent to the server.

## Context and Orientation

Product/spec:

- `docs/product-specs/2026-06-27-admin-entitlement-adjustments.md`
- `docs/product-specs/2026-06-21-account-billing.md`
- `docs/product-specs/2026-06-21-activation-code-authorization.md`
- `docs/product-specs/2026-06-22-server-managed-llm-quota.md`

Server:

- `server/src/server.ts`
- `server/src/adminPage.ts`
- `server/src/store.ts`
- `server/src/prismaStore.ts`
- `server/prisma/schema.prisma`
- `server/tests/admin.test.ts`
- `server/tests/llmQuota.test.ts`
- `server/tests/database.test.ts`

Docs:

- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/DESIGN.md`
- `docs/product-specs/index.md`
- `docs/exec-plans/active/index.md`

## Plan of Work

1. Add an audit model and store contract.
   - Add a Prisma model such as `AdminEntitlementAdjustment`.
   - Add MemoryStore and PrismaStore methods to create and list adjustment records.
   - Include admin email, target user, reason, note, before/after expiry, before/after quota limit, before/after quota used, and timestamp.

2. Add an entitlement adjustment service or helper.
   - Calculate expiry extension from `max(now, current expiresAt)`.
   - Support absolute `expires_at` only for repair cases.
   - Add `quota_add` by increasing `llmQuotaLimit` while preserving `llmQuotaUsed`.
   - Create an entitlement if the target user has none and the request grants days or quota.

3. Add the admin API.
   - Implement `POST /admin/api/users/:userId/entitlement-adjustments`.
   - Reuse Admin session cookie auth and `x-frameq-csrf`.
   - Validate ranges for `extend_days`, `expires_at`, `quota_add`, `reason`, and `note`.
   - Return updated expiry, quota limit, quota used, quota remaining, and the audit adjustment ID.

4. Update Admin Web.
   - Add compact controls in the user table or a dedicated compensation panel.
   - Require reason and allow optional support note.
   - Show immediate success/failure feedback and updated expiry/quota values.
   - List recent adjustments with timestamp, email, reason, and before/after summary.

5. Add tests and docs verification.
   - Cover active-user extension, expired-user reactivation, missing-entitlement creation, quota addition, auth/CSRF failures, invalid payloads, and account-status refresh.
   - Update docs if implementation reveals a different route name or data shape.

## Validation and Acceptance

Repeatable commands:

- `npm --prefix server test`
- `npm --prefix server run build`
- `python scripts/validate_agents_docs.py --level WARN`
- `git diff --check`

Manual acceptance:

- Log in to Admin Web, select a known test user, add 7 days and 5 topic uses with reason `bug_compensation`, refresh the desktop account status, and confirm the expiry and remaining uses increased without changing local files or requiring the user to redeem a new code.
