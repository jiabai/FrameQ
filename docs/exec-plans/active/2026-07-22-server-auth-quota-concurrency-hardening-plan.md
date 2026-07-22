# Server Authentication and Quota Concurrency Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while
> implementing each behavior slice, then use superpowers:verification-before-completion before
> claiming the plan complete.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Make OTP verification, desktop ticket exchange, OTP dispatch limiting, and per-call AI
Credit checkout atomic and retry-safe on the supported Prisma/SQLite server boundary.

**Architecture:** Authentication services generate raw secrets and invoke purpose-specific semantic
Store operations. MemoryStore provides the same closed outcomes under a process-local atomic queue;
PrismaStore uses parameterized conditional writes, transactions, unique constraints, and bounded
retry for recognized SQLite conflicts. Routes retain HTTP adaptation and never coordinate database
transactions.

**Tech Stack:** TypeScript 5.9, Fastify 5, Prisma 6.19, SQLite WAL, Vitest 4, Node.js 22,
Markdown governance documents.

---

## Purpose / Big Picture

A user must never receive two valid login artifacts from one OTP, lose a still-valid desktop ticket
because session creation failed, or spend more AI Credits than the entitlement permits because two
requests arrived together. This plan changes no desktop media/privacy behavior and makes no LLM
supplier call. It replaces server check-then-write sequences with database-enforced semantic
operations and keeps every public failure non-echoing.

This plan is the data-correctness half of the broad-release server blocker. Production SMTP,
logging, trusted-proxy configuration, health, graceful shutdown, backup/restore, and CI are completed
by the separate server production-operations ExecPlan before publication.

## Progress

- [x] 2026-07-22: Inspected the current authentication services, Store/PrismaStore, SQLite schema,
  quota checkout, tests, and deployment assumptions; confirmed the OTP/ticket/quota read-check-write
  windows and approved the durable design. Validation: source inspection recorded in
  `docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md`.
- [x] 2026-07-22: Registered the product/design/security/architecture boundary and this independent
  implementation plan without modifying server code or data. Validation: governance validation
  reported 0 errors and 0 warnings, and tracked plus new-document whitespace checks passed.
- [ ] Add characterization and deterministic RED concurrency/failure-injection tests. Validation:
  focused Vitest commands and exact failing assertions must be recorded before production edits.
- [ ] Introduce purpose-scoped semantic Store contracts and MemoryStore parity. Validation: focused
  Store/auth tests pass without Prisma.
- [ ] Baseline the current database and add the reviewed forward hardening migration. Validation:
  fresh/existing/invalid-data/restore migration fixtures pass.
- [ ] Implement Prisma OTP, ticket, dispatch-limit, and quota transactions. Validation: independent-
  client real-SQLite concurrency and rollback tests pass.
- [ ] Migrate services/routes away from low-level critical Store composition. Validation: auth,
  admin, LLM checkout, route-contract, and boundary tests pass.
- [ ] Run full server/governance gates and hand off for review without broad-publication claims.
  Validation: commands and exact totals are recorded in this plan.

## Surprises & Discoveries

- Evidence: `server/src/auth.ts` and `server/src/adminAuth.ts` independently call
  `findLatestUsableOtp`, `incrementOtpAttempts`, `consumeOtp`, then create a ticket/session. A
  transaction cannot cover that sequence because the current Store port exposes only the pieces.
- Evidence: `server/src/auth.ts` consumes a desktop ticket before `createSession`; a later session
  failure leaves the one-time ticket spent.
- Evidence: `server/src/prismaStore.ts::consumeLlmQuota` opens a transaction but still reads
  `llmQuotaUsed < llmQuotaLimit` before an unconditional increment. Transaction presence alone does
  not express the cross-row concurrency invariant.
- Evidence: `LlmUsageEvent` already has unique `(userId, requestId)`, which is the correct
  idempotency anchor and should be retained.
- Evidence: `AuthService` and `AdminAuthService` keep separate in-memory resend maps and update them
  only after awaited SMTP delivery. Overlapping requests can pass together, and restart/process
  boundaries discard the limit.
- Evidence: `EmailOtp` has no purpose field, so the same configured administrator address shares one
  challenge table for desktop and administrator login.
- Evidence: the existing temporary Prisma harness creates one real SQLite file but returns only one
  client. The new database tests must extend it to create independent clients against that file.
- Evidence: production currently uses `prisma db push` and has no `prisma/migrations` history, so a
  reviewed baseline plus forward migration is required before adding constraints safely.

## Decision Log

- Decision: Put critical authentication and quota use cases behind semantic Store methods rather
  than expose a generic transaction callback to routes/services. Rationale: Store owns persistence
  consistency and callers should receive closed business outcomes, not database primitives.
  Date/Author: 2026-07-22, User + Codex.
- Decision: Add OTP purpose values `desktop_login` and `admin_login` and invalidate outstanding
  legacy OTPs during migration. Rationale: guessing purpose could let an old challenge cross
  security domains; OTPs are short-lived and safely re-requested. Date/Author: 2026-07-22, Codex.
- Decision: Invalidate an older unconsumed challenge only in the exact
  `{purpose,email,state}` scope when issuing a replacement. Rationale: the latest code must not make
  an older code usable again, while independent device states remain isolated. Date/Author:
  2026-07-22, Codex.
- Decision: Enforce OTP dispatch limits in the database and count a committed SMTP attempt even when
  delivery later fails. Rationale: compensating counter decrements create a second race; a bounded
  cooldown is safer and truthful. Date/Author: 2026-07-22, Codex.
- Decision: Use a parameterized `UPDATE ... WHERE used < limit RETURNING` plus the existing unique
  usage event for quota checkout. Rationale: it makes the capacity decision and increment one
  database mutation and keeps retries idempotent. Date/Author: 2026-07-22, Codex.
- Decision: Retry only recognized SQLite busy/locked or Prisma transaction conflicts with fixed
  bounded policy. Rationale: idempotency guards make these local retries safe, while retrying unknown
  errors could hide defects or repeat unsafe work. Date/Author: 2026-07-22, Codex.
- Decision: Retain one production server instance per local SQLite file even though tests use
  independent clients. Rationale: correctness must not depend on a JavaScript lock, but this work
  does not establish multi-host SQLite availability or throughput. Date/Author: 2026-07-22, Codex.
- Decision: Establish a current-schema baseline migration and a separate hardening migration, then
  retire production `db push`. Rationale: existing databases need an auditable forward path and
  rollback by full restore. Date/Author: 2026-07-22, Codex.

## Outcomes & Retrospective

Planning outcome: the concurrency risks have an approved database-owned design, schema/migration
path, deterministic test matrix, and two-plan release boundary. No server implementation or
database was changed by this planning step.

Residual risk: until this ExecPlan is implemented and accepted, overlapping OTP verification,
ticket exchange, and distinct quota checkout requests may still violate single-use/capacity intent.
Even after implementation, SQLite remains a single-instance deployment choice and does not provide
multi-host failover or high-write scalability.

## Context and Orientation

- Product/release: `docs/product-specs/2026-07-22-release-reliability-hardening.md` and
  `docs/product-specs/2026-07-17-v0.2.17-desktop-i18n-release.md`.
- Durable design:
  `docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md`.
- Authentication: `server/src/auth.ts`, `server/src/adminAuth.ts`,
  `server/src/routes/desktopAuth.ts`, and `server/src/routes/admin.ts`.
- Quota: `server/src/routes/desktopLlm.ts`, `server/src/store.ts`, and
  `server/src/prismaStore.ts`.
- Schema/runtime: `server/prisma/schema.prisma`, `server/src/database.ts`, and
  `server/package.json`.
- Tests: `server/tests/auth.test.ts`, `server/tests/admin.test.ts`,
  `server/tests/llmQuota.test.ts`, `server/tests/transactionSafety.test.ts`,
  `server/tests/prismaTransactionSafety.test.ts`, and `server/tests/prismaTestHarness.ts`.
- Follow-up operations plan:
  `docs/exec-plans/active/2026-07-22-server-production-operations-hardening-plan.md`.

## Plan of Work

### Task 1: Lock the Current Behavior and Reproduce Races

**Files:**

- Modify: `server/tests/auth.test.ts`
- Modify: `server/tests/admin.test.ts`
- Modify: `server/tests/llmQuota.test.ts`
- Create: `server/tests/authQuotaConcurrency.test.ts`
- Create: `server/tests/prismaAuthQuotaConcurrency.test.ts`
- Modify: `server/tests/prismaTestHarness.ts`

- [ ] Characterize successful desktop/admin login, five-attempt lockout, resend failure, ticket
  exchange, quota-unavailable, and same-request reuse before changing contracts.
- [ ] Extend the fixture to open two or more independent `PrismaClient` instances against one
  temporary database and apply the same WAL/busy-timeout policy to each.
- [ ] Add RED tests showing that two correct OTP submissions can currently create multiple artifacts,
  ticket consumption survives an injected session-write failure, and distinct checkout IDs can race
  for one Credit.
- [ ] Add failure-injection seams for artifact/event writes and record the exact RED failures in
  `Progress`. A test that passes only because SQLite returned `database is locked` is not sufficient;
  it must retry/settle and assert final rows.

### Task 2: Introduce Closed Semantic Store Contracts

**Files:**

- Modify: `server/src/store.ts`
- Modify: `server/tests/transactionSafety.test.ts`
- Modify: `server/tests/authQuotaConcurrency.test.ts`

- [ ] Add `OtpPurpose` and closed issue/verify/exchange/quota result unions.
- [ ] Add purpose-specific issue/verify/exchange semantic methods and remove production-service
  dependence on low-level OTP/ticket calls.
- [ ] Implement MemoryStore operations behind its existing `runAtomically` queue, including exact
  scope replacement, attempt accounting, dispatch limits, artifact rollback, ticket/session
  rollback, and quota idempotency.
- [ ] Keep raw OTP/ticket/session/CSRF values outside Store; pass only hashes and return only records.
- [ ] Run the focused MemoryStore suite to GREEN before editing PrismaStore.

### Task 3: Establish Reviewed SQLite Migrations

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/202607220001_baseline/migration.sql`
- Create: `server/prisma/migrations/202607220002_auth_quota_hardening/migration.sql`
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Create: `server/tests/prismaMigration.test.ts`

- [ ] Generate/review a baseline that exactly represents the current schema; it must not contain the
  hardening change.
- [ ] Add `EmailOtp.purpose`, latest-scope index, `AuthRateLimit`, and explicit SQLite checks for
  closed purpose/scope, OTP attempts, and quota invariants.
- [ ] Make the forward migration deliberately invalidate outstanding legacy OTP rows and reject
  invalid entitlement data through preflight rather than clamp it.
- [ ] Add `db:migrate:deploy` and `db:migrate:status` scripts. Keep `db:push` development-only and
  remove it from production documentation in the operations plan.
- [ ] Test fresh apply, verified existing-baseline apply, invalid preflight, repeat deploy, integrity
  check, and restoration of a pre-migration copy.

### Task 4: Implement Prisma Authentication Transactions

**Files:**

- Modify: `server/src/prismaStore.ts`
- Modify: `server/src/security.ts` if a versioned limiter-key helper is needed
- Modify: `server/tests/prismaAuthQuotaConcurrency.test.ts`
- Modify: `server/tests/prismaTransactionSafety.test.ts`

- [ ] Implement atomic email/IP dispatch reservations and challenge creation with parameterized
  writes; a failed second scope must roll back the first.
- [ ] Implement desktop OTP attempt/consume + user/ticket creation and administrator OTP
  attempt/consume + admin-session creation as separate semantic transactions while retaining the
  existing constant-time fixed-length hash comparison.
- [ ] Implement ticket conditional consumption + desktop-session insertion in one transaction.
- [ ] Add fixed bounded retry for recognized local transaction conflicts only.
- [ ] Prove purpose isolation, exact replacement scope, correct/wrong fifth-attempt race, one-artifact
  maximum, injected rollback, and safe retry with independent clients.

### Task 5: Implement Atomic AI Credit Checkout

**Files:**

- Modify: `server/src/prismaStore.ts`
- Modify: `server/src/store.ts`
- Modify: `server/src/routes/desktopLlm.ts`
- Modify: `server/tests/llmQuota.test.ts`
- Modify: `server/tests/prismaAuthQuotaConcurrency.test.ts`

- [ ] Replace read-then-unconditional-increment with one parameterized conditional update and one
  same-transaction usage-event insert.
- [ ] Preserve same-request `reused` behavior and existing successful checkout response fields.
- [ ] Map recognized retry exhaustion to a fixed temporary-unavailable outcome; preserve
  `LLM_QUOTA_UNAVAILABLE` for true missing/expired/exhausted entitlement.
- [ ] Prove one remaining Credit permits exactly one distinct request ID, identical IDs consume once,
  event failure rolls back the increment, and no response/log echoes a database error.

### Task 6: Migrate Services and HTTP Adapters

**Files:**

- Modify: `server/src/auth.ts`
- Modify: `server/src/adminAuth.ts`
- Modify: `server/src/routes/desktopAuth.ts`
- Modify: `server/src/routes/admin.ts`
- Modify: `server/src/routes/desktopLlm.ts`
- Modify: `server/tests/routes.test.ts`
- Modify: `server/tests/serverModuleBoundaries.test.ts`

- [ ] Generate raw values in services, pass hashes/expiries into semantic Store operations, and keep
  fixed public invalid-code/ticket responses.
- [ ] Remove the two in-memory resend maps; database issuance becomes the only dispatch-limit owner.
- [ ] Ensure SMTP runs only after committed issuance and delivery failure invalidates the challenge
  without decrementing committed rate-limit counters.
- [ ] Return a stable retryable HTTP failure for database contention exhaustion and never translate
  it to invalid credentials or no quota.
- [ ] Add boundary tests forbidding auth routes/services from importing Prisma or composing retired
  low-level critical methods.

### Task 7: Synchronize Evidence and Hand Off

**Files:**

- Modify: `docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md`
- Modify: `docs/product-specs/2026-07-22-release-reliability-hardening.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `TASKS.md`
- Modify: this ExecPlan throughout implementation

- [ ] Record exact RED/GREEN evidence, migration rehearsal results, test totals, unavailable evidence,
  and residual risks in `Progress` and `Outcomes & Retrospective`.
- [ ] Do not mark the overall broad-release server blocker closed until the production-operations
  ExecPlan is also accepted.
- [ ] Move this plan to `completed/` only after all hard gates pass and update both plan indexes.

## Validation and Acceptance

Run focused tests during each TDD slice, then the complete server/document gates:

```powershell
npm --prefix server run prisma:generate
npm --prefix server test -- --run authQuotaConcurrency
npm --prefix server test -- --run prismaAuthQuotaConcurrency
npm --prefix server test -- --run prismaMigration
npm --prefix server test
npm --prefix server run build
npm --prefix server run db:migrate:status
python scripts\validate_agents_docs.py --level WARN
git diff --check
git status --short
```

Acceptance requires:

- independent-client real-SQLite tests prove at-most-one OTP artifact, at-most-one ticket exchange,
  no fifth-attempt overflow, and no quota overspend;
- failure injection proves session/ticket, OTP/artifact, and quota/event writes roll back together;
- MemoryStore and PrismaStore expose the same closed semantic outcomes;
- migration fixtures pass for fresh and existing databases and reject invalid accounting state;
- raw SQL is parameterized and public responses/logs contain no seeded secret/error fixtures;
- existing successful desktop/admin login and LLM checkout response shapes remain compatible; and
- no LLM supplier, real SMTP service, desktop media, or real AI Credits are used by automation.

Manual acceptance is limited to a local disposable server/database with a fake SMTP transport:
submit overlapping login/checkout requests, inspect final row counts, restart the process, and
confirm persisted limits/idempotency remain effective. Production deployment and real SMTP smoke
belong to the production-operations plan.
