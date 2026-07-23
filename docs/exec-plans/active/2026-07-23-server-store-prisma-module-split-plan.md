# Server Store / PrismaStore Module Split Implementation Plan

Status: Approved by the user on 2026-07-23; implementation in progress. The user approved the
Task 1 Prisma/SQLite concurrency-gate amendment on 2026-07-23.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Use superpowers:test-driven-development for characterization and the
> ownership RED/GREEN gate, systematic-debugging for any unexpected failure, and
> verification-before-completion before claiming completion. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** Split the 1,054-line `store.ts` and 1,117-line `prismaStore.ts` into stable adapter roots,
private transaction-responsibility owners, and consumer-owned narrow Store capabilities without
changing persistence behavior, HTTP behavior, schema, migrations, concurrency guarantees, or
existing construction and test seams.

**Architecture:** `store.ts` remains the direct-export compatibility root for all existing Store
contracts and the actual `MemoryStore` class. `prismaStore.ts` remains the sole exported
`PrismaStore` adapter. Backend-specific private modules own authentication, billing,
entitlement/accounting, LLM configuration, and atomic/conflict coordination. One complete Store
instance is still composed in `server.ts`; individual services and route helpers receive
consumer-owned `Pick<Store, ...>` capabilities that exist only at the type level.

**Tech Stack:** TypeScript 5.9 in strict NodeNext mode, Node.js 22, Vitest 4, Prisma 6, SQLite,
Fastify 5, TypeScript compiler API source gates, existing FrameQ migration/preflight/restore
scripts, GitHub Actions Server CI, and repository governance validators.

---

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds. Do not implement
> production changes, create implementation commits, merge, push, archive this plan, or clean up
> the worktree without the corresponding user authorization.

## Purpose / Big Picture

FrameQ users and operators should observe no product change. Email login, administrator login,
desktop ticket exchange, payment settlement, activation redemption, entitlement adjustment,
AI Credit checkout, LLM configuration, health checks, database startup, and every HTTP response
remain unchanged. The SQLite schema, reviewed migrations, query predicates, conditional writes,
transaction membership, retry bounds, fixed public errors, and secret-handling rules also remain
unchanged.

The internal result is a persistence facade that is easier to review safely. The full Store remains
the single consistency boundary, while each private backend owner contains one coherent class of
transactions and each consumer declares only the persistence authority it uses. This is not a
repository rewrite, a new Unit of Work, a database migration, or production-readiness evidence.

## Progress

- [x] 2026-07-23: Audited the current Store/PrismaStore implementation, callers, transaction and
  concurrency tests, architecture/security constraints, and module-split alternatives. The user
  approved 方案 2R and then approved the detailed design. Validation: design commit `248e2b8`;
  design-only governance reported 0 errors / 0 warnings and the worktree was clean.
- [x] 2026-07-23: Drafted and registered this active ExecPlan with exact owner paths, TDD
  checkpoints, capability sets, protected scope, migration/restore gates, and commit boundaries.
  Corrected the design's Prisma import gate to retain `database.ts` as the existing infrastructure
  composition exception. Validation: governance, required-section/fence checks, `git diff --check`, and
  clean-status evidence are recorded in the planning commit handoff.
- [x] 2026-07-23: The user reviewed and approved this ExecPlan and explicitly authorized P1-3
  implementation. Validation: approval is recorded in the Codex thread; production edits had not
  started before this authorization.
- [x] 2026-07-23: Verified the isolated worktree and established the fresh Server baseline. The
  worktree initially lacked `server/node_modules`; lockfile-pinned `npm ci` plus
  `npm --prefix server run prisma:generate` restored the local generated client/engines without
  changing dependency files. Validation: `.worktrees/` is ignored; Server 23/23 files, 142 passed,
  one skipped; TypeScript build passed; worktree branch was clean at `dd7ce7d`.
- [x] 2026-07-23: Task 1 locked the Store/class/Memory fixture compatibility surface and proved
  that the old subclass barrier intercepts zero semantic OTP reads. Validation:
  `storeCompatibility` passed 3/3; the existing Memory/Prisma concurrency and transaction-safety
  filters passed; the deliberate old-barrier RED failed both OTP cases with expected `0` versus
  `2` arrivals.
- [x] 2026-07-23: The approved replacement that blocks both transactions after
  `tx.emailOtp.findFirst` exposed a test-design incompatibility with Prisma/SQLite serialization:
  only one transaction can reach that in-transaction point, so both OTP cases timed out with one
  arrival. Implementation stopped before production movement as required. A test-only
  transaction-start gate plus real-read observer passed the complete Prisma concurrency file
  13/13, proving the approved amendment while retaining two independent clients and the real
  transaction read. Validation: literal read barrier 1/2 arrivals and timeout; approved gate
  2/2 start arrivals, 2/2 observed reads, 13/13 tests passed.
- [x] 2026-07-23: The user approved the evidence-backed Task 1 amendment: synchronize both
  independent clients immediately before `$transaction`, separately observe the real
  `tx.emailOtp.findFirst` inside each transaction, and retain the one-artifact/one-attempt
  assertions without adding production hooks, delays, Store methods, or transaction changes.
- [x] 2026-07-23: Task 1 completed after approval. The compatibility surface, Memory/Prisma
  failure-injection matrices, repaired independent-client OTP concurrency proof, TypeScript build,
  governance, and whitespace checks all passed. Validation: `storeCompatibility` 3/3;
  `authQuotaConcurrency` 23/23; `transactionSafety` 20/20; `prismaTransactionSafety` 9/9;
  `prismaAuthQuotaConcurrency` 13/13; `tsc --noEmit`; governance 0 errors / 0 warnings; and
  `git diff --check`.
- [x] 2026-07-23: Task 2 added the complete future-GREEN Store ownership gate and recorded the
  required first RED before creating any private production file. Validation: the focused test
  compiled and failed only at its first assertion because the approved `store/` tree was `[]`
  instead of the seven exact paths; excluding only that gate passed 24 Server files, 145 tests,
  with one Windows POSIX-signal skip; TypeScript build passed.
- [x] 2026-07-23: Task 3 established the two-line stable contract root, moved all 24 contract
  aliases and the actual Memory class to their defining modules, and extracted the single
  full-state atomic coordinator. A full-suite RED exposed a new enumerable circular reference
  (`MemoryStore.atomic -> coordinator.state -> MemoryStore`); using an ECMAScript private
  `#state` reference restored existing JSON serialization without changing locking or rollback.
  Validation: compatibility 3/3; auth concurrency 23/23; transaction safety 20/20; routes 11/11;
  LLM quota/config 10/10; complete non-boundary suite 145 passed / one Windows skip; TypeScript
  build passed. The ownership RED now reports only the four intentionally absent Memory operation
  owners.
- [x] 2026-07-23: Task 4 extracted all Memory authentication, billing, entitlement/accounting,
  and LLM-configuration operations behind bound, override-aware contexts while retaining one
  actual class, all 13 fixture fields, all 38 callable methods, and the single full-state atomic
  coordinator. Final sizes: `memory.ts` 346, `atomic.ts` 84, `auth.ts` 400, `billing.ts` 176,
  `entitlements.ts` 246, and `llmConfig.ts` 30 physical lines. Validation: auth concurrency 23/23;
  auth filters 27/27; admin 5/5; billing 2/2; activation 4/4; LLM quota/config 10/10; transaction
  safety 20/20; routes 11/11; compatibility 3/3; complete non-boundary suite 145 passed / one
  Windows skip; TypeScript build and `git diff --check` passed. The ownership RED moved exactly to
  the absent Prisma tree.
- [x] 2026-07-23: Task 5 centralized Prisma rate-limit reservation SQL, known conflict/error
  classification, fixed three-attempt retry, and `attempt * 5` backoff in the 175-line
  `prismaStore/concurrency.ts`, then moved all authentication/session operations into the 391-line
  `prismaStore/auth.ts`. Validation: repaired independent-client Prisma concurrency 13/13; Prisma
  transaction safety 9/9; cross-backend auth concurrency 23/23; auth 27/27; admin 5/5; routes
  11/11; complete non-boundary suite 145 passed / one Windows skip; TypeScript build passed; and
  source search found every protected concurrency definition only in `concurrency.ts`. The
  ownership RED now reports only the three intentionally absent Prisma capability owners.
- [x] 2026-07-23: Task 6 completed the Prisma adapter behind its stable class. Final sizes:
  `prismaStore.ts` 269, `auth.ts` 391, `billing.ts` 256, `concurrency.ts` 175,
  `entitlements.ts` 309, and `llmConfig.ts` 22 physical lines. Validation: billing 2/2; activation
  4/4; LLM quota/config 10/10; Prisma concurrency 13/13; Prisma transaction safety 9/9; admin 5/5;
  routes 11/11; compatibility 3/3; complete non-boundary suite 145 passed / one Windows skip;
  TypeScript build and `git diff --check` passed. The full ownership gate passed exact trees, line
  limits, stable exports, private dependencies, concurrency ownership, all eight semantic owners,
  and transaction-client placement before reaching the expected first consumer-capability RED in
  `activation.ts`.
- [x] 2026-07-23: Task 7 replaced each of the 12 full Store consumer declarations with the exact
  approved local `Pick<Store, ...>` capability while retaining the complete runtime Store instance
  and all executable statements. Validation: Store ownership 1/1; existing Server module boundaries
  7/7; auth 27/27; admin 5/5; activation 4/4; billing 2/2; LLM quota/config 10/10; routes 11/11;
  TypeScript build and `git diff --check` passed.

## Surprises & Discoveries

- The large roots are not interchangeable CRUD collections. The full 32-method Store is already a
  consistency facade for eight multi-record semantic operations, so splitting it into public
  repositories would allow callers to reconstruct unsafe partial transactions.
  Evidence: `server/src/store.ts`, `server/src/prismaStore.ts`, and
  `docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md`.
- Both classes expose six legacy compatibility methods outside the official Store type:
  `createEmailOtp`, `findLatestUsableOtp`, `incrementOtpAttempts`, `consumeOtp`,
  `createDesktopLoginTicket`, and `consumeDesktopLoginTicket`. They are still exercised by tests or
  remain part of the current class surface and cannot disappear during a structural refactor.
  Evidence: the two adapter classes and `server/tests/serverModuleBoundaries.test.ts`.
- `OtpReadBarrierPrismaStore` is not an effective concurrency barrier. It overrides
  `findLatestUsableOtp`, while both semantic verification methods read through
  `tx.emailOtp.findFirst` inside an interactive Prisma transaction. The race tests currently pass
  through ordinary scheduling rather than a proven synchronized read.
  Evidence: `server/tests/prismaAuthQuotaConcurrency.test.ts` and the two verification bodies in
  `server/src/prismaStore.ts`.
- Existing Memory transaction-failure tests depend on virtual dispatch through public methods.
  The explicitly tested seams are `createSession`, `createDesktopLoginTicket`, `markOrderPaid`,
  `upsertEntitlement`, and `createAdminEntitlementAdjustment`; current production code also calls
  other public methods through `this`, including `createAdminSession`. All existing internal
  public-method dispatch must remain bound to the actual instance.
  Evidence: `server/tests/authQuotaConcurrency.test.ts`,
  `server/tests/transactionSafety.test.ts`, and `server/src/store.ts`.
- `server/src/database.ts` already imports `PrismaClient` to construct, configure, probe, and close
  the process-owned database client. It is a legitimate infrastructure boundary and must remain an
  explicit exception to the private adapter-tree import rule.
  Evidence: `server/src/database.ts` and `server/src/index.ts`.
- The approved code baseline is Windows-local: 23 Server test files reported 142 passed and one
  POSIX signal test skipped; the TypeScript build passed. Hosted Linux CI, production SMTP,
  production-shaped Nginx/systemd, and restore evidence remain governed by the separate active
  operations/release plans.
  Evidence: the design-review validation recorded against code baseline `86d3e0a`.
- The isolated worktree does not inherit ignored `server/node_modules`. Running tests before local
  setup first failed at missing TypeScript and then at missing `.prisma/client`/Prisma engines
  because the dependency install deliberately skipped package scripts. A lockfile-pinned install
  followed by the repository's existing Prisma generation command restored the exact baseline.
  Evidence: the first build error resolved to the global missing `typescript/bin/tsc`; the first
  test run reported missing `.prisma/client/default`; the unchanged rerun passed 142/142 with one
  skip after Prisma 6.19.3 generation.
- Prisma/SQLite does not admit both independent interactive transactions into the current
  transaction callback/read point simultaneously. Blocking the first after its successful
  `emailOtp.findFirst` leaves the second outside that point; both literal barrier cases reported
  exactly one arrival and timed out. Synchronizing the independent requests immediately before
  calling `$transaction`, then separately observing each transaction's real
  `tx.emailOtp.findFirst`, passes without weakening the one-artifact/one-attempt assertions.
  Evidence: Task 1 RED/diagnostic/GREEN command outputs on 2026-07-23.
- Moving the atomic state reference into a separate class created a circular object graph when the
  reference was an ordinary TypeScript parameter property. `JSON.stringify(store)` is an existing
  secret-safety assertion and failed before inspecting the encrypted configuration. An ECMAScript
  `#state` field is non-enumerable, so it preserves the existing serializability while keeping one
  coordinator and the same complete snapshot/rollback behavior.
  Evidence: full non-boundary Server RED in `llmQuota.test.ts`, focused GREEN 10/10, then full
  GREEN 145 passed / one skip.

## Decision Log

- Decision: Preserve `store.ts` and `prismaStore.ts` as the only stable adapter roots.
  Rationale: current services, routes, tests, and composition already depend on those paths; direct
  re-export/delegation gives physical separation without a caller migration or duplicate facade.
  Date/Author: 2026-07-23, User + Codex.
- Decision: Use stable roots plus private transaction slices and consumer-owned type-only
  capabilities (方案 2R). Rationale: transaction ownership remains centralized while TypeScript
  makes each consumer's actual persistence authority reviewable.
  Date/Author: 2026-07-23, User + Codex.
- Decision: Share contracts and black-box behavior tests between Memory and Prisma, not a generic
  repository implementation. Rationale: the backends have materially different atomicity,
  conditional-write, retry, and rollback mechanisms.
  Date/Author: 2026-07-23, User + Codex.
- Decision: Repair the OTP race barrier before moving production code and do not add a production
  test hook. Rationale: extraction cannot rely on a test seam that no longer intercepts the
  transaction read it claims to synchronize.
  Date/Author: 2026-07-23, User + Codex.
- Decision: Replace the infeasible in-transaction read barrier with a test-only outer transaction
  start gate plus a non-blocking real-read observer. Rationale: SQLite serializes admission to the
  interactive transaction callback, so blocking the first transaction at its read prevents the
  second from reaching that same point; the approved amendment still proves two independent
  requests and two real reads while preserving all outcome assertions.
  Date/Author: 2026-07-23, User + Codex.
- Decision: Preserve every current `this.<publicMethod>` call through bound callbacks when a
  Memory semantic operation moves to a child module. Rationale: virtual dispatch is observable to
  subclasses even when only a subset of seams has explicit failure-injection coverage today.
  Date/Author: 2026-07-23, Codex.
- Decision: Allow `database.ts`, `prismaStore.ts`, and the private `prismaStore/` tree to import
  `@prisma/client`; forbid it everywhere else in Server production code.
  Rationale: `database.ts` is the existing process-level Prisma lifecycle/readiness owner, whereas
  services and routes must remain persistence-implementation independent.
  Date/Author: 2026-07-23, Codex.
- Decision: Do not update a product specification. Rationale: this refactor changes no
  user-visible behavior, HTTP/wire contract, persistence schema, data retention rule, or supported
  operation.
  Date/Author: 2026-07-23, User + Codex.

## Outcomes & Retrospective

Implementation is in progress. Task 1 compatibility and concurrency characterization is complete;
production extraction has not yet started. On completion this section must record final owner
sizes, exact test counts, TypeScript/Prisma/migration/restore results, protected-scope proof,
documentation updates, and the implementation commit range.

Task 1 closed the prior risk that the independent-client OTP tests did not intercept their claimed
semantic read: both requests now synchronize before transaction admission and both real transaction
reads are observed. Residual risk after local completion will still include any hosted Linux Server
CI, production SMTP/staging, and off-host restore evidence not actually run for the resulting
commits.

## Context and Orientation

- Approved design:
  `docs/design-docs/2026-07-23-server-store-prisma-module-split.md`.
- Full Store contract and Memory adapter:
  `server/src/store.ts`.
- Production Prisma adapter:
  `server/src/prismaStore.ts`.
- Process-level Prisma lifecycle/readiness owner:
  `server/src/database.ts`.
- Application composition:
  `server/src/index.ts` and `server/src/server.ts`.
- Service consumers:
  `server/src/auth.ts`, `server/src/adminAuth.ts`, `server/src/billing.ts`,
  `server/src/activation.ts`, `server/src/llmConfig.ts`, and
  `server/src/entitlementAdjustment.ts`.
- Route consumers:
  `server/src/routes/shared.ts`, `desktopAuth.ts`, `desktopAccount.ts`, `desktopLlm.ts`,
  `billing.ts`, and `admin.ts`.
- Memory concurrency/rollback tests:
  `server/tests/authQuotaConcurrency.test.ts` and
  `server/tests/transactionSafety.test.ts`.
- Prisma concurrency/rollback tests:
  `server/tests/prismaAuthQuotaConcurrency.test.ts` and
  `server/tests/prismaTransactionSafety.test.ts`.
- Existing route/module source gate:
  `server/tests/serverModuleBoundaries.test.ts`.
- Schema and reviewed migrations:
  `server/prisma/schema.prisma` and `server/prisma/migrations/`.
- Server CI and durable operations plan:
  `.github/workflows/server-ci.yml` and
  `docs/exec-plans/active/2026-07-22-server-production-operations-hardening-plan.md`.
- Durable architecture/security:
  `docs/ARCHITECTURE.md` and `docs/SECURITY.md`.
- Current structural audit:
  `docs/design-docs/frameq-code-audit-uml.md`.

## Approved Target Tree

```text
server/src/
  store.ts
  store/
    contracts.ts
    memory.ts
    memory/
      atomic.ts
      auth.ts
      billing.ts
      entitlements.ts
      llmConfig.ts
  prismaStore.ts
  prismaStore/
    concurrency.ts
    auth.ts
    billing.ts
    entitlements.ts
    llmConfig.ts
```

No `index.ts` is added inside either private tree. Private modules may export functions and types
for their stable root, but they are not application import surfaces.

## Stable Surface Ledger

### Official Store methods

The exact `keyof Store` set remains:

```ts
const storeMethods = [
  "upsertUserByEmail",
  "getUserById",
  "issueEmailOtp",
  "invalidateIssuedOtpAfterDeliveryFailure",
  "verifyDesktopOtpAndCreateTicket",
  "verifyAdminOtpAndCreateSession",
  "exchangeDesktopTicketAndCreateSession",
  "createSession",
  "findSessionByTokenHash",
  "revokeSession",
  "createOrder",
  "findOrderByOutTradeNo",
  "markOrderPaid",
  "settlePaidOrder",
  "getEntitlement",
  "upsertEntitlement",
  "consumeLlmQuota",
  "getLlmConfig",
  "upsertLlmConfig",
  "createActivationCode",
  "findActivationCodeByHash",
  "markActivationCodeRedeemed",
  "redeemActivationCodeAndGrantEntitlement",
  "listActivationCodes",
  "listUsers",
  "createAdminSession",
  "findAdminSessionByTokenHash",
  "revokeAdminSession",
  "createAdminEntitlementAdjustment",
  "applyEntitlementAdjustmentWithAudit",
  "listAdminEntitlementAdjustments",
  "createWebhookEvent",
] as const satisfies readonly (keyof Store)[];
```

The compatibility-only class methods remain:

```ts
const compatibilityMethods = [
  "createEmailOtp",
  "findLatestUsableOtp",
  "incrementOtpAttempts",
  "consumeOtp",
  "createDesktopLoginTicket",
  "consumeDesktopLoginTicket",
] as const;
```

### Memory fixture state

The following public mutable fixture fields remain on the actual `MemoryStore` instance with their
current record types and reference behavior:

```ts
const memoryFixtureFields = [
  "users",
  "emailOtps",
  "desktopLoginTickets",
  "sessions",
  "orders",
  "entitlements",
  "llmConfig",
  "llmUsageEvents",
  "activationCodes",
  "adminSessions",
  "adminEntitlementAdjustments",
  "webhookEvents",
  "authRateLimits",
] as const;
```

### Semantic transaction ownership

| Operation | Memory owner | Prisma owner |
|---|---|---|
| `issueEmailOtp` | `store/memory/auth.ts` | `prismaStore/auth.ts` |
| `verifyDesktopOtpAndCreateTicket` | `store/memory/auth.ts` | `prismaStore/auth.ts` |
| `verifyAdminOtpAndCreateSession` | `store/memory/auth.ts` | `prismaStore/auth.ts` |
| `exchangeDesktopTicketAndCreateSession` | `store/memory/auth.ts` | `prismaStore/auth.ts` |
| `settlePaidOrder` | `store/memory/billing.ts` | `prismaStore/billing.ts` |
| `consumeLlmQuota` | `store/memory/entitlements.ts` | `prismaStore/entitlements.ts` |
| `redeemActivationCodeAndGrantEntitlement` | `store/memory/entitlements.ts` | `prismaStore/entitlements.ts` |
| `applyEntitlementAdjustmentWithAudit` | `store/memory/entitlements.ts` | `prismaStore/entitlements.ts` |

## Protected Scope

The implementation must leave these paths byte-for-byte unchanged:

- `server/prisma/schema.prisma`;
- every existing file under `server/prisma/migrations/`;
- `server/package.json` and `server/package-lock.json`;
- `server/src/database.ts`, `server/src/index.ts`, and `server/src/server.ts`;
- `deploy/` and `.github/workflows/server-ci.yml`;
- desktop App, Rust/Tauri, Python Worker, desktop-worker contracts, and product specifications.

Service and route files change only in erased TypeScript type imports, type aliases, property types,
and the `ReturnType` owner in `desktopLlm.ts`. Their executable statements, routes, validation,
status codes, messages, supplier calls, cookies, and response bodies remain unchanged.

## Plan of Work

### Task 1: Lock Compatibility and Repair the Actual OTP Read Barrier

**Files:**

- Create: `server/tests/storeCompatibility.test.ts`
- Modify: `server/tests/prismaAuthQuotaConcurrency.test.ts`

- [x] Re-run the approved code baseline before editing:

  ```powershell
  npm --prefix server test
  npm --prefix server run build
  ```

  Expected: 23 files, 142 passed, one POSIX signal test skipped on Windows, and a successful
  TypeScript build. If the branch has moved and counts differ, record and explain the new baseline
  in Progress before continuing.

- [x] Add compile-time and runtime compatibility characterization. The new test defines:

  ```ts
  type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
      ? true
      : false;
  type Assert<Value extends true> = Value;
  type StoreMethodSetIsExact = Assert<
    Equal<keyof Store, (typeof storeMethods)[number]>
  >;
  ```

  It also asserts that `MemoryStore.prototype` and `PrismaStore.prototype` contain all 32 official
  methods plus the six compatibility methods, that `new MemoryStore()` exposes all 13 fixture
  fields, and that current read methods return the same mutable record objects where they do today.
  Assign `true` to a value typed as `StoreMethodSetIsExact` so TypeScript checks the alias.

- [x] Re-run the compatibility and existing failure-injection matrices:

  ```powershell
  npm --prefix server test -- --run storeCompatibility
  npm --prefix server test -- --run authQuotaConcurrency
  npm --prefix server test -- --run transactionSafety
  npm --prefix server test -- --run prismaTransactionSafety
  ```

  Expected GREEN: all four filters pass before any production body moves.

- [x] Prove the current subclass barrier is ineffective before replacing it. Give the existing
  test-only barrier an `arrivals()` observation, retain the current subclass, and assert
  `arrivals() === 2` after each independent-client race.

  ```powershell
  npm --prefix server test -- --run prismaAuthQuotaConcurrency
  ```

  Expected RED: the two OTP race cases report zero intercepted reads. No production failure or
  changed outcome is an acceptable substitute for this exact evidence.

- [x] Delete `OtpReadBarrierPrismaStore` and replace it with the user-approved test-only outer
  transaction-start gate plus a transaction proxy that observes the `findFirst` actually called
  on `tx.emailOtp`:

  ```ts
  function transactionWithOtpReadObserver(
    tx: Prisma.TransactionClient,
    observeRead: () => void,
  ): Prisma.TransactionClient {
    const emailOtp = new Proxy(tx.emailOtp, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property !== "findFirst" || typeof value !== "function") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (...args: unknown[]) => {
          const otp = await Reflect.apply(value, target, args);
          observeRead();
          return otp;
        };
      },
    });
    return new Proxy(tx, {
      get(target, property, receiver) {
        if (property === "emailOtp") {
          return emailOtp;
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Prisma.TransactionClient;
  }

  function prismaWithOtpConcurrencyGate(
    prisma: PrismaClient,
    waitAtTransactionStart: () => Promise<void>,
    observeRead: () => void,
  ): PrismaClient {
    return new Proxy(prisma, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property !== "$transaction" || typeof value !== "function") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (...args: unknown[]) => {
          await waitAtTransactionStart();
          const [operation, ...rest] = args;
          if (typeof operation !== "function") {
            return Reflect.apply(value, target, args);
          }
          return Reflect.apply(value, target, [
            async (tx: Prisma.TransactionClient) =>
              Reflect.apply(operation, undefined, [
                transactionWithOtpReadObserver(tx, observeRead),
              ]),
            ...rest,
          ]);
        };
      },
    }) as PrismaClient;
  }
  ```

  The outer gate exposes `allArrived`, `arrivals()`, and `release()`. Each race starts both
  operations, awaits `allArrived`, asserts two transaction-start arrivals, releases them, and only
  then awaits the results. A separate observer asserts two completed real
  `tx.emailOtp.findFirst` calls. Keep two independently created Prisma clients on one temporary
  SQLite file. Add no production hook, environment flag, scheduling delay, or Store method.

- [x] Re-run the repaired Prisma concurrency file and complete Server build:

  ```powershell
  npm --prefix server test -- --run prismaAuthQuotaConcurrency
  npm --prefix server run build
  git diff --check
  ```

  Expected GREEN: both OTP cases prove two gate arrivals and two real reads while still producing
  one artifact plus one recorded attempt; all other conflict/retry/quota tests in the file pass.

- [x] Update this plan's Progress and Surprises with the exact RED/GREEN evidence, then create the
  first authorized implementation checkpoint:

  ```powershell
  git add server/tests/storeCompatibility.test.ts server/tests/prismaAuthQuotaConcurrency.test.ts docs/exec-plans/active/2026-07-23-server-store-prisma-module-split-plan.md
  git commit -m "test(server): lock store adapter compatibility"
  ```

### Task 2: Add the Exact Ownership Gate and Record RED

**Files:**

- Create: `server/tests/storeModuleBoundaries.test.ts`

- [x] Add one source-level test whose first assertion is the exact approved private tree:

  ```ts
  const expectedStoreOwners = [
    "contracts.ts",
    "memory.ts",
    "memory/atomic.ts",
    "memory/auth.ts",
    "memory/billing.ts",
    "memory/entitlements.ts",
    "memory/llmConfig.ts",
  ];
  const expectedPrismaOwners = [
    "auth.ts",
    "billing.ts",
    "concurrency.ts",
    "entitlements.ts",
    "llmConfig.ts",
  ];

  expect(collectRelativeTypeScriptFiles(sourcePath("store"))).toEqual(
    expectedStoreOwners,
  );
  expect(collectRelativeTypeScriptFiles(sourcePath("prismaStore"))).toEqual(
    expectedPrismaOwners,
  );
  ```

  The helper returns an empty array for an absent directory and otherwise recursively returns
  sorted forward-slash-relative `.ts` paths. Do not create empty production files merely to change
  the RED reason.

- [x] After the tree assertion, implement the complete future GREEN gate with the TypeScript
  compiler API. It must enforce all of these facts:

  - `store.ts` has only the direct contract wildcard re-export and actual `MemoryStore` re-export;
  - `store.ts` is at most 60 physical lines;
  - `store/contracts.ts`, `store/memory.ts`, and `prismaStore.ts` are each at most 350 lines;
  - every other private production child is at most 400 lines;
  - contracts export exactly the current 24 type aliases, including `Store`;
  - `store/memory.ts` is the defining class and its public-root/private-path constructors are
    identical;
  - `prismaStore.ts` is the only production module exporting `PrismaStore`;
  - no production consumer imports `store/` or `prismaStore/` private paths;
  - only `database.ts`, `prismaStore.ts`, and `prismaStore/*.ts` import `@prisma/client`;
  - only `prismaStore/concurrency.ts` defines conflict retry, Prisma error classification,
    authentication rate-limit reservation SQL, and the fixed retry-bound/backoff;
  - each of the eight semantic operations has exactly one Memory implementation owner and one
    Prisma implementation owner from the ownership table;
  - `Prisma.TransactionClient` appears only inside the private Prisma tree in production source;
  - private children do not import a stable root, routes, services, runtime config, email,
    WeChat, observability, or the opposite backend;
  - no private child exposes a Store class, repository, Unit of Work, Prisma client, or generic
    transaction callback to application consumers; only the approved Memory atomic coordinator is
    callable inside the private Memory tree; and
  - the exact consumer capability aliases listed in Task 7 replace full Store properties outside
    `server.ts`.

- [x] Run only the new gate:

  ```powershell
  npm --prefix server test -- --run storeModuleBoundaries
  ```

  Expected RED: the first assertion reports the absent approved `store/` tree. The test must
  compile, and no earlier assertion or unrelated exception may fail.

- [x] Keep the gate enabled but exclude only this file while production extraction is incomplete:

  ```powershell
  npm --prefix server test -- --exclude tests/storeModuleBoundaries.test.ts
  npm --prefix server run build
  git diff --check
  ```

  Expected: the complete non-boundary Server suite and build pass.

- [x] Record the exact RED evidence in Progress, then create the authorized test checkpoint:

  ```powershell
  git add server/tests/storeModuleBoundaries.test.ts docs/exec-plans/active/2026-07-23-server-store-prisma-module-split-plan.md
  git commit -m "test(server): define store module ownership"
  ```

### Task 3: Establish the Contract Root and Full-State Memory Atomic Owner

**Files:**

- Create: `server/src/store/contracts.ts`
- Create: `server/src/store/memory.ts`
- Create: `server/src/store/memory/atomic.ts`
- Modify: `server/src/store.ts`
- Modify: `server/tests/storeCompatibility.test.ts`

- [x] Move all current record, closed-outcome, and Store type declarations without renaming or
  reshaping them into `store/contracts.ts`. The stable root becomes exactly:

  ```ts
  export * from "./store/contracts.js";
  export { MemoryStore } from "./store/memory.js";
  ```

  Do not leave a duplicate type, wrapper class, subclass, default export, namespace export, or
  executable initialization in `store.ts`.

- [x] Move the actual `MemoryStore` class to `store/memory.ts` and update its security import to
  `../security.js`. The public-root identity test must be:

  ```ts
  import { MemoryStore as PublicMemoryStore } from "../src/store.js";
  import { MemoryStore as DefiningMemoryStore } from "../src/store/memory.js";

  expect(PublicMemoryStore).toBe(DefiningMemoryStore);
  ```

  This private import is allowed only in the ownership/compatibility tests.

- [x] Extract the existing serialized snapshot/rollback mechanism into one private coordinator:

  ```ts
  export type MemoryState = {
    users: UserRecord[];
    emailOtps: EmailOtpRecord[];
    desktopLoginTickets: DesktopLoginTicketRecord[];
    sessions: SessionRecord[];
    orders: OrderRecord[];
    entitlements: EntitlementRecord[];
    llmConfig: LlmConfigRecord | null;
    llmUsageEvents: LlmUsageEventRecord[];
    activationCodes: ActivationCodeRecord[];
    adminSessions: AdminSessionRecord[];
    adminEntitlementAdjustments: AdminEntitlementAdjustmentRecord[];
    webhookEvents: WebhookEventRecord[];
    authRateLimits: AuthRateLimitRecord[];
  };

  export class MemoryAtomicCoordinator {
    private tail: Promise<void> = Promise.resolve();
    readonly #state: MemoryState;

    constructor(state: MemoryState) {
      this.#state = state;
    }

    async run<T>(operation: () => Promise<T>): Promise<T> {
      const previous = this.tail;
      let release = () => {};
      this.tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshot = structuredClone({
        users: this.#state.users,
        emailOtps: this.#state.emailOtps,
        desktopLoginTickets: this.#state.desktopLoginTickets,
        sessions: this.#state.sessions,
        orders: this.#state.orders,
        entitlements: this.#state.entitlements,
        llmConfig: this.#state.llmConfig,
        llmUsageEvents: this.#state.llmUsageEvents,
        activationCodes: this.#state.activationCodes,
        adminSessions: this.#state.adminSessions,
        adminEntitlementAdjustments:
          this.#state.adminEntitlementAdjustments,
        webhookEvents: this.#state.webhookEvents,
        authRateLimits: this.#state.authRateLimits,
      });
      try {
        return await operation();
      } catch (error) {
        this.#state.users = snapshot.users;
        this.#state.emailOtps = snapshot.emailOtps;
        this.#state.desktopLoginTickets = snapshot.desktopLoginTickets;
        this.#state.sessions = snapshot.sessions;
        this.#state.orders = snapshot.orders;
        this.#state.entitlements = snapshot.entitlements;
        this.#state.llmConfig = snapshot.llmConfig;
        this.#state.llmUsageEvents = snapshot.llmUsageEvents;
        this.#state.activationCodes = snapshot.activationCodes;
        this.#state.adminSessions = snapshot.adminSessions;
        this.#state.adminEntitlementAdjustments =
          snapshot.adminEntitlementAdjustments;
        this.#state.webhookEvents = snapshot.webhookEvents;
        this.#state.authRateLimits = snapshot.authRateLimits;
        throw error;
      } finally {
        release();
      }
    }
  }
  ```

  The state reference uses an ECMAScript private field rather than an enumerable parameter
  property because existing secret-safety tests serialize `MemoryStore`; this avoids a circular
  JSON graph while preserving the coordinator boundary.

  `MemoryStore` constructs exactly one coordinator after its public fields initialize and keeps a
  private `runAtomically` forwarding method until the capability extractions in Task 4 are complete.
  Do not create one lock per capability or snapshot only the fields a capability usually touches.

- [x] Run the stable-surface, Memory concurrency, rollback, route, and build gates:

  ```powershell
  npm --prefix server test -- --run storeCompatibility
  npm --prefix server test -- --run authQuotaConcurrency
  npm --prefix server test -- --run transactionSafety
  npm --prefix server test -- --run routes
  npm --prefix server run build
  ```

  Expected GREEN: direct constructor identity, all existing fields/methods, FIFO serialization,
  complete rollback, virtual failure injection, and HTTP adapter tests pass. The ownership gate
  remains intentionally RED because four approved Memory child files and the Prisma tree are still
  absent.

- [x] Record evidence and create the authorized stable-root checkpoint:

  ```powershell
  git add server/src/store.ts server/src/store server/tests/storeCompatibility.test.ts docs/exec-plans/active/2026-07-23-server-store-prisma-module-split-plan.md
  git commit -m "refactor(server): stabilize memory store root"
  ```

### Task 4: Extract All Memory Capability Owners

**Files:**

- Create: `server/src/store/memory/auth.ts`
- Create: `server/src/store/memory/billing.ts`
- Create: `server/src/store/memory/entitlements.ts`
- Create: `server/src/store/memory/llmConfig.ts`
- Modify: `server/src/store/memory.ts`

- [x] Move the exact existing Memory bodies by this closed ownership map:

  | Owner | Methods and helpers |
  |---|---|
  | `auth.ts` | user read/upsert; OTP issue/invalidate/verify and six compatibility helpers; desktop ticket/session exchange; desktop/admin session CRUD; user listing; rate-limit planning/application |
  | `billing.ts` | order CRUD; webhook creation/matching; paid-order settlement; monthly-pass recovery/extension |
  | `entitlements.ts` | entitlement read/upsert; quota checkout/event; activation CRUD/redemption/listing; administrator adjustment CRUD/application/listing |
  | `llmConfig.ts` | singleton LLM configuration read/upsert |

  Random-ID creation, comparison, date arithmetic, sort order, fixed thrown strings, mutation
  order, and returned object identity move with their current bodies.

- [x] Define narrow child contexts from `MemoryState`, `MemoryAtomicCoordinator`, contract method
  signatures, and explicit compatibility callback signatures. Children must not import
  `../memory.js`. The stable class binds every current internal public call to the actual instance:

  ```ts
  private authContext() {
    return {
      state: this,
      atomic: this.atomic,
      upsertUserByEmail: this.upsertUserByEmail.bind(this),
      getUserById: this.getUserById.bind(this),
      createEmailOtp: this.createEmailOtp.bind(this),
      createDesktopLoginTicket:
        this.createDesktopLoginTicket.bind(this),
      createSession: this.createSession.bind(this),
      createAdminSession: this.createAdminSession.bind(this),
    };
  }

  private billingContext() {
    return {
      state: this,
      atomic: this.atomic,
      findOrderByOutTradeNo: this.findOrderByOutTradeNo.bind(this),
      markOrderPaid: this.markOrderPaid.bind(this),
      getEntitlement: this.getEntitlement.bind(this),
      upsertEntitlement: this.upsertEntitlement.bind(this),
      createWebhookEvent: this.createWebhookEvent.bind(this),
    };
  }
  ```

  The entitlement context likewise binds `findSessionByTokenHash`, `getUserById`,
  `findActivationCodeByHash`, `markActivationCodeRedeemed`, `getEntitlement`,
  `upsertEntitlement`, and `createAdminEntitlementAdjustment`. This preserves current virtual
  dispatch; a child must not directly mutate an array in place of one of those existing calls.

- [x] Keep `MemoryStore` as the actual class with all 13 fixture fields and all 38 callable
  methods. Each method delegates directly to one named child operation:

  ```ts
  async settlePaidOrder(
    input: Parameters<Store["settlePaidOrder"]>[0],
  ): ReturnType<Store["settlePaidOrder"]> {
    return settlePaidOrder(this.billingContext(), input);
  }

  async consumeLlmQuota(
    userId: string,
    requestId: string,
    now: Date,
  ): ReturnType<Store["consumeLlmQuota"]> {
    return consumeLlmQuota(this.entitlementContext(), userId, requestId, now);
  }
  ```

  Use explicit record types for the six compatibility method signatures because they are not part
  of `Store`. Do not use `any`, an index-signature state bag, runtime repositories, or a generic
  public dispatcher.

- [x] Run focused tests after each child moves instead of batching all four:

  ```powershell
  npm --prefix server test -- --run authQuotaConcurrency
  npm --prefix server test -- --run auth
  npm --prefix server test -- --run admin

  npm --prefix server test -- --run billing
  npm --prefix server test -- --run transactionSafety

  npm --prefix server test -- --run activation
  npm --prefix server test -- --run llmQuota
  npm --prefix server test -- --run transactionSafety

  npm --prefix server test -- --run routes
  npm --prefix server test -- --run storeCompatibility
  npm --prefix server run build
  ```

  Expected GREEN: no Memory behavior, order, object identity, rollback, or subclass-injection seam
  changes. `store/memory.ts` is at most 350 lines and every child is at most 400. The ownership gate
  remains RED at the absent Prisma tree.

- [x] Record each owner size and focused count, then create the authorized Memory checkpoint:

  ```powershell
  git add server/src/store/memory.ts server/src/store/memory docs/exec-plans/active/2026-07-23-server-store-prisma-module-split-plan.md
  git commit -m "refactor(server): split memory store operations"
  ```

### Task 5: Extract Prisma Concurrency and Authentication Owners

**Files:**

- Create: `server/src/prismaStore/concurrency.ts`
- Create: `server/src/prismaStore/auth.ts`
- Modify: `server/src/prismaStore.ts`

- [x] Move these backend-policy definitions unchanged into `concurrency.ts`:

  - `PrismaRateLimitReservation`;
  - `RateLimitExceededError`;
  - `StoreTemporarilyUnavailableError`;
  - rate-limit reservation planning and `Prisma.sql` conditional reservation;
  - `ConflictRetryResult` and the three-attempt `withConflictRetry`;
  - Prisma/SQLite busy-conflict classification;
  - LLM usage-event uniqueness classification; and
  - exact known-error code classification.

  Preserve the maximum of three attempts and the `attempt * 5` millisecond backoff. Export only
  the private functions/types required by sibling operation modules.

- [x] Move all Prisma user/OTP/ticket/desktop-session/admin-session operations, `listUsers`, and
  complete authentication transactions into `auth.ts`. The semantic functions accept a
  `PrismaClient`; transaction-local helpers accept `Prisma.TransactionClient` only inside the
  private Prisma tree. Preserve every query predicate, attempt increment, constant-time comparison,
  conditional consume, created ID, transaction member, and terminal outcome mapping.

- [x] Replace the corresponding root bodies with direct private-operation delegation while keeping
  the constructor and public methods:

  ```ts
  export class PrismaStore implements Store {
    constructor(private readonly prisma: PrismaClient) {}

    async issueEmailOtp(
      input: Parameters<Store["issueEmailOtp"]>[0],
    ): ReturnType<Store["issueEmailOtp"]> {
      return authOperations.issueEmailOtp(this.prisma, input);
    }
  }
  ```

  Keep all six compatibility methods and every official auth method on the class. Do not expose the
  Prisma client, a transaction callback, or a child module to callers.

- [x] Run the repaired independent-client races and all auth/route/build gates:

  ```powershell
  npm --prefix server test -- --run prismaAuthQuotaConcurrency
  npm --prefix server test -- --run prismaTransactionSafety
  npm --prefix server test -- --run authQuotaConcurrency
  npm --prefix server test -- --run auth
  npm --prefix server test -- --run admin
  npm --prefix server test -- --run routes
  npm --prefix server run build
  ```

  Expected GREEN: the proxy barrier still intercepts the transaction read after extraction; all
  atomicity, retry, purpose, limit, ticket/session, and fixed error outcomes remain unchanged.
  The ownership gate remains RED because three Prisma capability files are absent.

- [x] Record exact evidence and create the authorized Prisma-auth checkpoint:

  ```powershell
  git add server/src/prismaStore.ts server/src/prismaStore/concurrency.ts server/src/prismaStore/auth.ts docs/exec-plans/active/2026-07-23-server-store-prisma-module-split-plan.md
  git commit -m "refactor(server): split prisma auth operations"
  ```

### Task 6: Complete the Prisma Adapter Behind Its Stable Class

**Files:**

- Create: `server/src/prismaStore/billing.ts`
- Create: `server/src/prismaStore/entitlements.ts`
- Create: `server/src/prismaStore/llmConfig.ts`
- Modify: `server/src/prismaStore.ts`

- [x] Move the exact current Prisma bodies by this closed map:

  | Owner | Methods and transaction-local helpers |
  |---|---|
  | `billing.ts` | order CRUD, webhook create/ensure/match, paid-order settlement, existing-paid recovery, monthly-pass extension |
  | `entitlements.ts` | entitlement read/upsert, conditional quota/event checkout, activation CRUD/redemption/listing, administrator adjustment CRUD/application/listing |
  | `llmConfig.ts` | singleton LLM configuration read/upsert |

  Keep each complete semantic transaction in one file. Billing may write entitlement rows inside
  its own transaction; it must not call an independently committed public entitlement operation.

- [x] Keep `PrismaStore` below 350 lines as the only exported class and delegate every remaining
  method directly:

  ```ts
  async settlePaidOrder(
    input: Parameters<Store["settlePaidOrder"]>[0],
  ): ReturnType<Store["settlePaidOrder"]> {
    return billingOperations.settlePaidOrder(this.prisma, input);
  }

  async applyEntitlementAdjustmentWithAudit(
    input: Parameters<Store["applyEntitlementAdjustmentWithAudit"]>[0],
  ): ReturnType<Store["applyEntitlementAdjustmentWithAudit"]> {
    return entitlementOperations.applyEntitlementAdjustmentWithAudit(
      this.prisma,
      input,
    );
  }
  ```

  The root contains no SQL, conflict classification, transaction body, payment matching, quota
  arithmetic, or configuration mutation.

- [x] Run each capability's behavior and rollback tests immediately after moving it:

  ```powershell
  npm --prefix server test -- --run billing
  npm --prefix server test -- --run prismaTransactionSafety

  npm --prefix server test -- --run activation
  npm --prefix server test -- --run llmQuota
  npm --prefix server test -- --run prismaAuthQuotaConcurrency
  npm --prefix server test -- --run prismaTransactionSafety

  npm --prefix server test -- --run admin
  npm --prefix server test -- --run routes
  npm --prefix server test -- --run storeCompatibility
  npm --prefix server run build
  ```

  Expected GREEN: webhook idempotency, order/entitlement atomicity, activation single use,
  adjustment audit atomicity, quota/event conditional writes, configuration behavior, and all
  adapter surfaces are unchanged.

- [x] Run the ownership test after the full private tree exists:

  ```powershell
  npm --prefix server test -- --run storeModuleBoundaries
  ```

  Expected RED now moves to the exact consumer-capability assertion because services and route
  helpers still declare the full Store. Any line-limit, export, import, ownership, cycle, or
  transaction-client failure must be fixed before Task 7.

- [x] Record sizes and evidence, then create the authorized complete-adapter checkpoint:

  ```powershell
  git add server/src/prismaStore.ts server/src/prismaStore docs/exec-plans/active/2026-07-23-server-store-prisma-module-split-plan.md
  git commit -m "refactor(server): split prisma persistence operations"
  ```

### Task 7: Narrow Every Service and Route Capability and Turn Ownership GREEN

**Files:**

- Modify: `server/src/auth.ts`
- Modify: `server/src/adminAuth.ts`
- Modify: `server/src/billing.ts`
- Modify: `server/src/activation.ts`
- Modify: `server/src/llmConfig.ts`
- Modify: `server/src/entitlementAdjustment.ts`
- Modify: `server/src/routes/shared.ts`
- Modify: `server/src/routes/desktopAuth.ts`
- Modify: `server/src/routes/desktopAccount.ts`
- Modify: `server/src/routes/desktopLlm.ts`
- Modify: `server/src/routes/billing.ts`
- Modify: `server/src/routes/admin.ts`
- Modify: `server/tests/storeModuleBoundaries.test.ts` only if an AST implementation correction is
  required; do not weaken an accepted capability set

- [x] Add exactly these local or adjacent type aliases:

  | Consumer | Capability alias | Exact Store keys |
  |---|---|---|
  | `auth.ts` | `AuthStore` | `issueEmailOtp`, `invalidateIssuedOtpAfterDeliveryFailure`, `verifyDesktopOtpAndCreateTicket`, `exchangeDesktopTicketAndCreateSession` |
  | `adminAuth.ts` | `AdminAuthStore` | `issueEmailOtp`, `invalidateIssuedOtpAfterDeliveryFailure`, `verifyAdminOtpAndCreateSession`, `findAdminSessionByTokenHash` |
  | `billing.ts` | `BillingStore` | `findSessionByTokenHash`, `createOrder`, `settlePaidOrder`, `findOrderByOutTradeNo` |
  | `activation.ts` | `ActivationStore` | `createActivationCode`, `redeemActivationCodeAndGrantEntitlement` |
  | `llmConfig.ts` | `LlmConfigStore` | `getLlmConfig`, `upsertLlmConfig` |
  | `entitlementAdjustment.ts` | `EntitlementAdjustmentStore` | `applyEntitlementAdjustmentWithAudit` |
  | `routes/shared.ts` | `DesktopSessionStore` | `findSessionByTokenHash` |
  | `routes/desktopAuth.ts` | `DesktopAuthRouteStore` | `revokeSession` |
  | `routes/desktopAccount.ts` | `DesktopAccountStore` | `findSessionByTokenHash`, `getUserById`, `getEntitlement` |
  | `routes/desktopLlm.ts` | `DesktopLlmStore` | `findSessionByTokenHash`, `consumeLlmQuota` |
  | `routes/billing.ts` | `BillingRouteStore` | `findSessionByTokenHash`, `getEntitlement` |
  | `routes/admin.ts` | `AdminRouteStore` | `revokeAdminSession`, `listUsers`, `getEntitlement`, `listActivationCodes`, `listAdminEntitlementAdjustments` |

  Each definition follows this form and is erased at runtime:

  ```ts
  type AuthStore = Pick<
    Store,
    | "issueEmailOtp"
    | "invalidateIssuedOtpAfterDeliveryFailure"
    | "verifyDesktopOtpAndCreateTicket"
    | "exchangeDesktopTicketAndCreateSession"
  >;
  ```

- [x] Change only the consumer's `store` property/constructor type. Keep the full instance passed
  from `server.ts`; create no runtime adapter:

  ```ts
  export type AuthServiceOptions = {
    store: AuthStore;
    now?: () => Date;
    sendOtp: (email: string, code: string) => Promise<void>;
  };

  export class AuthService {
    private readonly store: AuthStore;
  }
  ```

  In `desktopLlm.ts`, change the checkout result annotation to:

  ```ts
  let consumed: Awaited<
    ReturnType<DesktopLlmStore["consumeLlmQuota"]>
  >;
  ```

  Do not change executable statements, dependency objects, route registration, or Store
  construction.

- [x] Run the ownership gate and require full GREEN:

  ```powershell
  npm --prefix server test -- --run storeModuleBoundaries
  npm --prefix server test -- --run serverModuleBoundaries
  ```

  Expected GREEN: exact files, line limits, direct roots, private dependencies, semantic owners,
  Prisma import exceptions, and all 12 capability aliases match the approved map.

- [x] Run all service and route behavior plus TypeScript compilation:

  ```powershell
  npm --prefix server test -- --run auth
  npm --prefix server test -- --run admin
  npm --prefix server test -- --run activation
  npm --prefix server test -- --run billing
  npm --prefix server test -- --run llmQuota
  npm --prefix server test -- --run routes
  npm --prefix server run build
  git diff --check
  ```

  Expected GREEN: runtime behavior is unchanged and every full MemoryStore/PrismaStore instance is
  structurally assignable to the narrower consumer type.

- [x] Record GREEN evidence and create the authorized capability checkpoint:

  ```powershell
  git add server/src/auth.ts server/src/adminAuth.ts server/src/billing.ts server/src/activation.ts server/src/llmConfig.ts server/src/entitlementAdjustment.ts server/src/routes/shared.ts server/src/routes/desktopAuth.ts server/src/routes/desktopAccount.ts server/src/routes/desktopLlm.ts server/src/routes/billing.ts server/src/routes/admin.ts server/tests/storeModuleBoundaries.test.ts docs/exec-plans/active/2026-07-23-server-store-prisma-module-split-plan.md
  git commit -m "refactor(server): narrow store consumer capabilities"
  ```

### Task 8: Complete Regression, Operations Gates, Durable Docs, and Archival

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/2026-07-23-server-store-prisma-module-split.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Move:
  `docs/exec-plans/active/2026-07-23-server-store-prisma-module-split-plan.md` to
  `docs/exec-plans/completed/2026-07-23-server-store-prisma-module-split-plan.md`

- [ ] Run Prisma generation and the complete Server regression:

  ```powershell
  npm --prefix server run prisma:generate
  npm --prefix server test
  npm --prefix server run build
  ```

  Record exact file/pass/skip counts. The new compatibility and ownership tests increase the
  baseline; no existing test may disappear or be weakened.

- [ ] Rehearse the local migration, current-schema preflight, and isolated restore gates against
  disposable absolute SQLite paths:

  ```powershell
  $databasePath = Join-Path ([System.IO.Path]::GetTempPath()) "frameq-store-split-$PID.sqlite"
  $restorePath = Join-Path ([System.IO.Path]::GetTempPath()) "frameq-store-split-restore-$PID.sqlite"
  New-Item -ItemType File -Force -Path $databasePath | Out-Null
  $env:DATABASE_URL = "file:$($databasePath.Replace('\', '/'))"
  npm --prefix server run db:migrate:deploy
  npm --prefix server run db:migrate:status
  npm --prefix server run db:preflight -- --mode current
  Copy-Item -LiteralPath $databasePath -Destination $restorePath -Force
  npm --prefix server run db:restore-smoke -- --database $restorePath
  Remove-Item -LiteralPath $databasePath, $restorePath -Force
  Remove-Item Env:DATABASE_URL
  ```

  Expected: both reviewed migrations deploy, status is current, preflight passes, and the copied
  database passes isolated restore smoke. Cleanup targets only the two explicit temp files.

- [ ] Prove protected code/schema/dependency/operations scope is byte-for-byte unchanged from the
  approved code baseline:

  ```powershell
  git diff --exit-code 86d3e0a -- server/prisma server/package.json server/package-lock.json server/src/database.ts server/src/index.ts server/src/server.ts deploy .github/workflows/server-ci.yml app worker contracts
  ```

  Expected: empty diff. Then inspect the service/route diff and confirm every change is TypeScript
  type-only:

  ```powershell
  git diff --word-diff=porcelain 86d3e0a -- server/src/auth.ts server/src/adminAuth.ts server/src/billing.ts server/src/activation.ts server/src/llmConfig.ts server/src/entitlementAdjustment.ts server/src/routes/shared.ts server/src/routes/desktopAuth.ts server/src/routes/desktopAccount.ts server/src/routes/desktopLlm.ts server/src/routes/billing.ts server/src/routes/admin.ts
  ```

- [ ] Run repository script and governance gates:

  ```powershell
  node --test scripts/tests/*.test.mjs
  python scripts/validate_agents_docs.py --level WARN
  git diff --check
  git status --short --branch
  ```

  Record exact Node test and governance counts.

- [ ] Update durable documents with measured facts:

  - add the stable Store roots, private semantic owners, one-instance composition, and consumer
    capability boundary to `docs/ARCHITECTURE.md`;
  - add the transaction-client confinement, complete semantic transaction, conflict retry, and
    secret/error invariants to `docs/SECURITY.md`;
  - mark the design implemented and record final owner sizes;
  - update the audit hotspot table and implementation status;
  - mark P1-3 complete in `TASKS.md` with exact validation evidence;
  - replace the active plan entry with the completed plan entry in `AGENTS.md`;
  - remove/add the plan from the active/completed indexes; and
  - fill this plan's Progress, Surprises, Decision Log, and Outcomes with actual evidence and
    explicit unrun hosted/staging/provider residual risks.

- [ ] Run governance, diff, protected-scope proof, and clean-status checks again after archival:

  ```powershell
  python scripts/validate_agents_docs.py --level WARN
  git diff --check
  git diff --exit-code 86d3e0a -- server/prisma server/package.json server/package-lock.json server/src/database.ts server/src/index.ts server/src/server.ts deploy .github/workflows/server-ci.yml app worker contracts
  git status --short --branch
  ```

- [ ] Create the final authorized documentation/archive checkpoint:

  ```powershell
  git add AGENTS.md TASKS.md docs/ARCHITECTURE.md docs/SECURITY.md docs/design-docs/2026-07-23-server-store-prisma-module-split.md docs/design-docs/frameq-code-audit-uml.md docs/exec-plans/active/index.md docs/exec-plans/active/2026-07-23-server-store-prisma-module-split-plan.md docs/exec-plans/completed/index.md docs/exec-plans/completed/2026-07-23-server-store-prisma-module-split-plan.md
  git commit -m "docs(server): complete store adapter module split"
  ```

  Do not push, merge, delete the branch, or remove the worktree without separate authorization.

## Concrete Execution Sequence

Run commands from the isolated worktree root:

```text
D:\Github\FrameQ\.worktrees\p1-server-store-module-split-design
```

The canonical final sequence is:

```powershell
npm --prefix server run prisma:generate
npm --prefix server test
npm --prefix server run build
node --test scripts/tests/*.test.mjs
python scripts/validate_agents_docs.py --level WARN
git diff --check
git status --short --branch
```

The focused commands in Tasks 1-7 run after every owner move. Until Task 7, the only intentionally
failing test is `server/tests/storeModuleBoundaries.test.ts`; all other tests must remain green.
No test may be disabled, deleted, converted to a weaker assertion, or changed to accept different
business behavior.

## Validation and Acceptance

Completion requires all of the following:

- the exact approved private tree exists and contains no extra private production owner;
- `store.ts` directly re-exports all existing contracts and the actual `MemoryStore`;
- `prismaStore.ts` remains the only exported `PrismaStore` class;
- all 32 Store methods, six compatibility methods, 13 Memory fixture fields, constructor shapes,
  object-reference behavior, sort order, and fixed errors remain compatible;
- all current Memory internal public-method calls preserve virtual dispatch;
- all eight semantic operations remain complete and atomic in exactly one owner per backend;
- one Memory atomic coordinator snapshots and restores all mutable state;
- Prisma transaction clients never escape their private semantic owner in production source;
- conflict classification, three-attempt bound, backoff, rate-limit SQL, quota conditional update,
  unique usage event, and webhook matching are unchanged;
- repaired OTP tests prove two independent clients reached the real transaction read barrier before
  release and still create at most one artifact;
- every service and route helper declares exactly its approved consumer-owned capability;
- one full Store object is still composed and passed at runtime;
- schema, migrations, dependency manifests, database lifecycle, composition, CI workflow, desktop,
  worker, contracts, and product specs are unchanged;
- complete Server tests, TypeScript build, Prisma generation, migration/status/preflight,
  restore smoke, script tests, governance, and diff gates pass with exact evidence;
- architecture, security, audit, task tracking, design status, and plan indexes match final code;
  and
- unrun hosted Linux, SMTP/staging, off-host restore, or provider evidence remains explicitly
  unverified rather than inferred.

## Rollback and Recovery

Each implementation checkpoint is move-first and independently reviewable. If a focused test fails:

1. stop before the next owner;
2. inspect the smallest moved method/transaction and compare it with baseline `86d3e0a`;
3. restore the last green implementation commit only with explicit user authorization;
4. do not change a query, outcome, retry, schema, route, or test expectation to make the refactor
   pass; and
5. return any required semantic change to design review.

No database migration or user-data rollback is expected because schema and runtime data formats are
protected. If the effective OTP barrier exposes a real concurrency defect, stop after Task 1 and
return to the authentication/quota design; do not weaken or remove the barrier.

## Final Acceptance

The task is complete only after the user-approved implementation has passed every gate above, this
living plan contains actual results rather than forecasts, the plan is archived under `completed/`,
and the branch/worktree remain available for user-directed integration. Local completion does not
authorize a push, merge, PR, tag, deployment, or production database operation.
