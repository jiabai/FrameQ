# Server Route Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task by task. Use `superpowers:test-driven-development` for behavior and ownership gates,
> and use `superpowers:verification-before-completion` before claiming completion.

**Goal:** Split the Fastify HTTP adapters in `server/src/server.ts` into private capability route
modules while keeping `buildServer()` as the stable composition root and preserving every current
server behavior, transaction boundary, and security property.

**Architecture:** `server.ts` continues to create Fastify, construct services, resolve runtime
configuration, install the global exact-raw-body JSON parser, and call synchronous route
registrars. Private `routes/` modules own administrator, desktop authentication, desktop account,
desktop LLM, update, and billing/webhook HTTP mapping. Shared OTP schemas and a deliberately small
route-support module prevent feature-to-feature imports. No Fastify plugin or new facade is added.

**Tech Stack:** TypeScript 5.9, Node.js 24 types, Fastify 5, Zod 4, Vitest 4, Prisma Store port,
Markdown governance documents.

---

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Users and desktop clients must observe no change. The account service keeps the same login,
entitlement, activation, LLM checkout, update, and disabled WeChat behavior. Internally, future
changes become safer because each HTTP capability has one owner and `server.ts` becomes a clear
composition root rather than the owner of every schema and handler. The move preserves the
existing Store/Prisma transaction boundary, server-managed LLM secret boundary, administrator
cookie/CSRF policy, and exact webhook-signature bytes.

## Progress

- [x] 2026-07-21: Re-inspected `server.ts`, production startup, Store/service boundaries, all 12
  server test files, architecture, security, workflow, execution gates, current audit evidence,
  and active work. Validation: source inventory records a 710-line root with 20 method/route pairs
  and only `ServerDependencies` plus `buildServer` exported.
- [x] 2026-07-21: Created isolated worktree
  `.worktrees/codex-server-module-split-plan` on branch `codex/server-module-split-plan` from clean,
  synchronized `main`; linked the ignored server dependency directory without touching tracked
  files in the main worktree. Validation: `git status --short --branch` reported only the worktree
  branch before documentation edits.
- [x] 2026-07-21: Established the pre-change baseline. Validation:
  `npm.cmd --prefix server test` passed 12 files / 57 tests with only Node's existing SQLite
  experimental warning; `npm.cmd --prefix server run build` passed; and
  `python scripts\validate_agents_docs.py --level ERROR` reported 0 errors / 0 warnings.
- [x] 2026-07-21: Recorded the draft capability-registrar design and this active implementation
  plan for user review. Validation: implementation has not started, no production source is
  modified, `python scripts\validate_agents_docs.py --level WARN` reports 0 errors / 0 warnings,
  and `git diff --check` passes with only Git's existing LF-to-CRLF working-copy notices.
- [x] 2026-07-21: User reviewed and approved the design and ExecPlan; implementation may begin in
  the existing isolated worktree. Validation: user replied `文档已确认，请进入实现` before any
  production source edit.
- [x] 2026-07-21: Task 1 locked the complete 20-route table, exact webhook JSON bytes, and current
  administrator cookie attributes/header sequence. Behavior characterization passed 14/14. The
  architecture suite then produced the intended RED: 4 failed / 2 passed because `routes/` is
  absent, `server.ts` is 711 physical lines, capability owners are absent, and security constants
  remain in the root. Validation: `npm.cmd --prefix server test -- routes.test.ts admin.test.ts` and
  `npm.cmd --prefix server test -- serverModuleBoundaries.test.ts`.
- [x] 2026-07-21: Task 2 extracted shared OTP schemas/route support and the desktop auth/account
  registrars. The root fell from 711 to 535 physical lines; four of eight planned route files now
  exist. Focused auth/account/activation tests passed 17/17 and TypeScript compilation passed. The
  ownership suite remains intentionally RED on the four not-yet-created owners, remaining root
  handlers/size, and unmoved security constants. Validation:
  `npm.cmd --prefix server test -- routes.test.ts auth.test.ts activation.test.ts`,
  `npm.cmd --prefix server run build`, and the expected-RED boundary run.
- [x] 2026-07-21: Task 3 extracted the administrator and desktop LLM registrars, including the
  unchanged three-header cookie helper and the original checkout order. Admin/quota/MemoryStore/
  Prisma transaction suites passed 33/33 and TypeScript compilation passed with only the existing
  Node SQLite experimental warning. The root is now 204 physical lines. The boundary run remains
  intentionally RED only while billing/update owners are absent and their handlers/raw-body
  consumer remain in the root. Validation: the Task 3 focused command, build, and expected-RED
  boundary run.
- [x] 2026-07-21: Task 4 extracted update and billing/webhook registrars, retained the global raw
  JSON parser in the root, and reduced `server.ts` to 112 physical lines. The architecture RED
  turned fully GREEN at 6/6. Focused update/billing/route/transaction coverage passed 40/40 and the
  TypeScript build passed with only the existing SQLite warning. Validation: Task 4 focused
  command, `npm.cmd --prefix server test -- serverModuleBoundaries.test.ts`, and build.
- [x] Tasks 2-4 extracted route owners incrementally while focused behavior remained green.
- [x] 2026-07-21: Task 5 completed full regression, measured scope/file evidence, durable
  architecture/security/audit updates, and plan archival. Validation: server 65/65 and build, app
  549/549 and lint, native Windows Rust 173/173, worker 515/515, scripts 23/23, protected-path
  no-diff proof, WARN governance validation, and `git diff --check` passed.

## Surprises & Discoveries

- Evidence: `server.ts` contains 20 concrete method/path registrations, not the earlier informal
  count of 17. The design's explicit ownership table is now the authoritative count.
- Evidence: the root's custom `application/json` parser stores the exact incoming string on every
  request before parsing; only `/api/wechat/notify` consumes it. Moving the parser into a feature
  module would change a signature-critical root boundary.
- Evidence: `quotaResponse()` is private and unreferenced; `rg -n "quotaResponse" server/src
  server/tests` finds only its definition. Its removal is allowed but no other unrelated cleanup is
  in scope.
- Evidence: all route-level tests and production startup import only `buildServer` from
  `server.ts`; no current caller assembles individual routes.
- Evidence: existing tests cover the major admin, account, LLM quota, update, billing-disabled, and
  transaction behaviors, but do not directly assert exact webhook raw-body forwarding or the full
  cookie attribute matrix. Those gaps must be characterized before moving their owners.
- Evidence: the first cookie characterization disproved the plan's two-header assumption. Fastify
  currently observes `frameq_admin_session`, the same session header again, then
  `frameq_admin_csrf` because the helper combines prior values before Fastify appends them. This
  refactor preserves the three-header sequence; deduplication remains a separate behavior change.

## Decision Log

- Decision: Propose synchronous capability registration functions rather than Fastify plugins.
  Rationale: direct registrars preserve the current root Fastify instance and registration model;
  plugin encapsulation, hook inheritance, and async lifecycle add proof burden without a current
  requirement. Date/Author: 2026-07-21, User + Codex.
- Decision: Keep `buildServer()` as the sole stable facade/composition entry and add no facade
  class. Rationale: callers already have a simple unified interface; the problem is internal route
  ownership, not external complexity. Date/Author: 2026-07-21, User + Codex.
- Decision: Keep Fastify construction, service construction, configuration resolution, release
  manifest loading, and the exact-raw-body parser in `server.ts`. Rationale: these are process/root
  lifecycle concerns and moving them would change initialization or parser scope. Date/Author:
  2026-07-21, User + Codex.
- Decision: Keep Store semantic transaction methods unchanged and allow route modules to depend
  only on the `Store` port. Rationale: `PrismaStore` already owns atomic settlement, redemption, and
  adjustment; structural route extraction must not redistribute those writes. Date/Author:
  2026-07-21, User + Codex.
- Decision: Do not update a product specification. Rationale: the plan explicitly preserves every
  external route and user-visible behavior; design, architecture, security, audit, and execution
  governance are the appropriate documentation surfaces. Date/Author: 2026-07-21, User + Codex.
- Decision: Preserve the observed three-header administrator-login sequence, including the
  duplicate session `Set-Cookie`, and record deduplication as a separate behavior/security change.
  Rationale: characterization showed this is current wire behavior; silently correcting it during
  a structural refactor would violate the approved compatibility boundary. Date/Author:
  2026-07-21, User + Codex.

## Outcomes & Retrospective

Implemented behind the unchanged `ServerDependencies`/`buildServer()` surface. The 710-line root is
now 112 lines and owns only Fastify/service/runtime/parser composition. The private route tree is
`admin.ts` 330 lines, `authSchemas.ts` 12, `billing.ts` 95, `desktopAccount.ts` 115,
`desktopAuth.ts` 88, `desktopLlm.ts` 60, `desktopUpdates.ts` 34, and `shared.ts` 30. It contains six
capability registrars plus shared private support, with no Fastify plugin or second facade.

TDD locked all 20 method/path pairs, exact webhook JSON bytes, and administrator cookie behavior.
The architecture test first failed 4/6 against the old root, then passed 6/6 after extraction.
Final regression passed server 65/65 and TypeScript build, app 549/549 and lint, native Windows Rust
173/173, worker 515/515, and scripts 23/23. Existing Node SQLite experimental and Python `audioop`
deprecation warnings remain the only runtime notices.

Scope proof found no tracked diff in Prisma/schema, Store/service implementations, app production,
Rust production, worker production, contracts, or package manifests. Production edits are limited
to `server/src/server.ts` and `server/src/routes/`; remaining edits are tests and governance docs.

No credentialed SMTP, LLM supplier, updater, WeChat, reverse-proxy, or TLS smoke was run. WeChat
remains disabled/unintegrated, source gates cannot prevent every future semantic coupling, and line
count is only a maintenance alarm. The existing duplicate administrator-session `Set-Cookie`
header is preserved and explicitly deferred to a separate behavior/security change.

## Context and Orientation

- Draft design:
  `docs/design-docs/2026-07-21-server-route-module-split.md`.
- Current composition/routes hotspot: `server/src/server.ts`.
- Production startup: `server/src/index.ts`.
- Store port and in-memory test implementation: `server/src/store.ts`.
- Concrete transaction owner: `server/src/prismaStore.ts`.
- Application services: `server/src/auth.ts`, `server/src/adminAuth.ts`,
  `server/src/activation.ts`, `server/src/llmConfig.ts`, `server/src/billing.ts`, and
  `server/src/entitlementAdjustment.ts`.
- Update policy/manifest loading: `server/src/updates.ts`.
- WeChat signature/parser implementation: `server/src/wechat.ts`.
- Route behavior suites: `server/tests/routes.test.ts`, `server/tests/admin.test.ts`,
  `server/tests/llmQuota.test.ts`, and `server/tests/updates.test.ts`.
- Transaction regression suites: `server/tests/transactionSafety.test.ts` and
  `server/tests/prismaTransactionSafety.test.ts`.
- Durable transaction decision: `docs/ARCHITECTURE.md`, section
  `2026-07-10 Server Entitlement Transaction Boundary`.
- Security constraints: `docs/SECURITY.md`.
- Current structural audit: `docs/design-docs/frameq-code-audit-uml.md`, sections
  `Server Service 与 Store` and `结构压力点与审计问题`.

## Target File Responsibility Map

| File | Responsibility after implementation |
|---|---|
| `server/src/server.ts` | stable public type/function, Fastify and service construction, runtime defaults, root JSON parser, registrar composition |
| `server/src/routes/authSchemas.ts` | shared OTP start/verify Zod schemas only |
| `server/src/routes/shared.ts` | bearer/session authentication, quota remaining, and current public error mapping only |
| `server/src/routes/admin.ts` | all administrator pages/routes, cookies/CSRF, schemas, response mapping |
| `server/src/routes/desktopAuth.ts` | login page, desktop OTP/ticket/session/logout HTTP mapping |
| `server/src/routes/desktopAccount.ts` | account projection and activation redemption HTTP mapping |
| `server/src/routes/desktopLlm.ts` | LLM checkout validation/auth/quota/config HTTP mapping |
| `server/src/routes/desktopUpdates.ts` | public update route and 204 mapping |
| `server/src/routes/billing.ts` | WeChat disabled gate, order routes, raw webhook/signature input, settlement mapping |
| `server/tests/serverModuleBoundaries.test.ts` | exact route ownership and dependency/source boundary gates |

## Stable Interfaces and Invariants

- `ServerDependencies` fields, optionality, semantics, and defaults do not change.
- `buildServer(dependencies)` remains synchronous and returns the same Fastify instance type.
- `index.ts` remains unchanged and imports only `buildServer` from `./server.js`.
- Fastify is still created with `{ logger: false }`.
- Each service is constructed once per `buildServer()` call with the same dependencies.
- `now` is still one injected function and is invoked at the same request-policy points.
- `parseWechatNotification`, `wechatPayEnabled`, and `releaseManifest` are still resolved once at
  server construction with the same nullish/environment behavior.
- The root removes and replaces the JSON content parser before route registration and retains the
  exact `rawBody` string.
- Every method/path, schema, header, cookie, response, status, error text, and call order remains
  compatible with the approved design matrix.
- Route modules may import `Store` but never `PrismaStore`, Prisma, database startup, or one another.
- Only `server.ts` creates Fastify/services; only `admin.ts` owns administrator cookies/CSRF; only
  `billing.ts` consumes raw body.

## Plan of Work

### Task 1: Lock Behavior Gaps and Establish the Ownership RED

**Files:**

- Modify: `server/tests/routes.test.ts`
- Modify: `server/tests/admin.test.ts`
- Create: `server/tests/serverModuleBoundaries.test.ts`
- Inspect only: `server/src/server.ts`

- [x] Add a table-driven route-presence characterization for all twenty method/path pairs using
  the real `buildServer()` instance. Include parameterized route patterns without making network
  calls.
- [x] Add a WeChat notification test that sends a deliberately formatted JSON string, captures the
  injected parser input, and proves `rawBody` is byte-for-byte identical while `body` remains the
  parsed object. Do not print the body in assertion messages.
- [x] Extend administrator cookie assertions to prove the current session/session/CSRF
  `Set-Cookie` sequence, stable names, `Path=/`, integer `Max-Age`, `SameSite=Lax`, session-only
  `HttpOnly`, and logout clearing. Preserve/restore any temporary `NODE_ENV` change if
  production-only `Secure` is characterized; do not deduplicate headers in this structural task.
- [x] Run the new behavior tests first and require GREEN against the unsplit baseline.
- [x] Add the source/AST ownership test for the target file set, exact route owners, stable root
  export/import surface, root-only constructors/parser, forbidden route imports, sibling-feature
  independence, billing-only `rawBody`, admin-only cookie/CSRF constants, no direct root handlers,
  and root physical size <= 200.
- [x] Run the boundary test and require RED only because the planned modules are absent/current
  ownership is unsplit. Record exact RED evidence in Progress.
- [x] Reconfirm `quotaResponse()` has no caller before allowing its later deletion.

Suggested commands:

```powershell
npm.cmd --prefix server test -- routes.test.ts admin.test.ts
npm.cmd --prefix server test -- serverModuleBoundaries.test.ts
```

### Task 2: Extract Shared Support, Desktop Authentication, and Desktop Account

**Files:**

- Create: `server/src/routes/authSchemas.ts`
- Create: `server/src/routes/shared.ts`
- Create: `server/src/routes/desktopAuth.ts`
- Create: `server/src/routes/desktopAccount.ts`
- Modify: `server/src/server.ts`
- Test: `server/tests/routes.test.ts`
- Test: `server/tests/serverModuleBoundaries.test.ts`

- [x] Move the identical email-start/email-verify schemas once into `authSchemas.ts`; keep all
  field types and validation behavior unchanged.
- [x] Move `authenticateDesktop`, `bearerToken`, `llmQuotaRemaining`, and `publicError` into
  `shared.ts` without semantic edits. Do not move cookie or raw-body helpers there.
- [x] Move `/login`, desktop OTP start/verify, ticket exchange, and logout registration into
  `desktopAuth.ts` with `{ store, auth, now }` only.
- [x] Move account projection/redeem schemas, helpers, and routes into `desktopAccount.ts` with
  `{ store, activationCodes, llmConfig, now }` only.
- [x] Keep `buildServer()` responsible for constructing services and pass only narrow records.
- [x] Run route/account/auth tests and TypeScript build. Review the move diff for route/schema/body
  equivalence before proceeding.
- [x] Run the ownership suite and record which target assertions have turned green while the final
  architecture remains intentionally red.

Suggested commands:

```powershell
npm.cmd --prefix server test -- routes.test.ts auth.test.ts activation.test.ts serverModuleBoundaries.test.ts
npm.cmd --prefix server run build
```

### Task 3: Extract Administrator and Desktop LLM Routes

**Files:**

- Create: `server/src/routes/admin.ts`
- Create: `server/src/routes/desktopLlm.ts`
- Modify: `server/src/server.ts`
- Test: `server/tests/admin.test.ts`
- Test: `server/tests/llmQuota.test.ts`
- Test: `server/tests/transactionSafety.test.ts`
- Test: `server/tests/prismaTransactionSafety.test.ts`
- Test: `server/tests/serverModuleBoundaries.test.ts`

- [x] Move all administrator route schemas/handlers, cookie helpers, `firstHeader`, and public LLM
  configuration response mapping into `admin.ts` without changing authentication-before-CSRF
  order or cookie append behavior.
- [x] Pass only `{ store, adminAuth, activationCodes, llmConfig, entitlementAdjustments, now }`.
  Keep `AdminAuthService` and every other service construction in the root.
- [x] Move checkout schema/handler into `desktopLlm.ts` with `{ store, llmConfig, now }`; preserve
  auth -> validation -> config -> atomic quota consumption -> secret response order.
- [x] Use the one shared quota helper from `shared.ts`; do not create a quota service or move Store
  transactions into handlers.
- [x] Remove the confirmed-unreferenced `quotaResponse()` helper and no other unrelated code.
- [x] Run administrator, LLM, MemoryStore transaction, and Prisma transaction suites. Review the
  diff for cookie/CSRF, secret, status, response, and Store-call equivalence.
- [x] Run the ownership suite and record incremental GREEN evidence.

Suggested commands:

```powershell
npm.cmd --prefix server test -- admin.test.ts llmQuota.test.ts transactionSafety.test.ts prismaTransactionSafety.test.ts serverModuleBoundaries.test.ts
npm.cmd --prefix server run build
```

### Task 4: Extract Update and Billing Routes and Finish the Root

**Files:**

- Create: `server/src/routes/desktopUpdates.ts`
- Create: `server/src/routes/billing.ts`
- Modify: `server/src/server.ts`
- Test: `server/tests/updates.test.ts`
- Test: `server/tests/routes.test.ts`
- Test: `server/tests/billing.test.ts`
- Test: `server/tests/transactionSafety.test.ts`
- Test: `server/tests/prismaTransactionSafety.test.ts`
- Test: `server/tests/serverModuleBoundaries.test.ts`

- [x] Move only update request/response mapping into `desktopUpdates.ts`; keep manifest loading and
  one-time resolution in the root.
- [x] Move billing order/webhook handlers into `billing.ts` with
  `{ store, billing, parseWechatNotification, wechatPayEnabled, now }`.
- [x] Preserve disabled-before-auth behavior, order ownership, exact raw-body forwarding, parsed
  body forwarding, success body, failure body, and settlement call shape exactly.
- [x] Keep the JSON content parser in `server.ts`, installed before all registrar calls.
- [x] Reduce the root to stable dependencies, Fastify/service/config composition, parser, and
  registrar calls. It must contain no Zod schema, response mapper, auth/cookie helper, or direct
  route registration and must remain <= 200 physical lines.
- [x] Run update/billing/route/transaction suites and build, then run the ownership suite and
  require full GREEN.
- [x] Compare the complete route matrix and source diff before starting closeout.

Suggested commands:

```powershell
npm.cmd --prefix server test -- updates.test.ts routes.test.ts billing.test.ts transactionSafety.test.ts prismaTransactionSafety.test.ts serverModuleBoundaries.test.ts
npm.cmd --prefix server run build
```

### Task 5: Complete Regression, Scope Proof, and Documentation Closeout

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/2026-07-21-server-route-module-split.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Move: this plan from `active/` to `completed/`

- [x] Run the complete server suite and build and record exact file/test totals.
- [x] Run cross-layer desktop/worker/Rust/script tests that exercise account and LLM checkout
  consumers; no live LLM, email, update, or payment call is permitted.
- [x] Prove production changes are restricted to `server/src/server.ts` and
  `server/src/routes/`; prove no diff under Prisma schema, Store/service implementations, app
  production, Rust production, worker production, contracts, or package dependencies.
- [x] Measure final source files and update architecture, security, and audit evidence without
  claiming WeChat provider readiness or a user-visible change.
- [x] Set the design status to implemented only after all gates pass. Update Progress, Decision Log,
  Outcomes, TASKS, indexes, and AGENTS; then archive this plan.
- [x] Run governance and diff checks again after archival.

Final commands:

```powershell
npm.cmd --prefix server test
npm.cmd --prefix server run build
npm.cmd --prefix app test
npm.cmd --prefix app run lint
cargo test --manifest-path app/src-tauri/Cargo.toml
uv run pytest worker\tests
node --test scripts/tests/*.test.mjs
python scripts\validate_agents_docs.py --level WARN
git diff --check
```

The final implementation session may omit a cross-layer command only for a documented environment
blocker, never because the server suite passed. Any omitted command and residual risk must be
recorded in Outcomes.

## Validation and Acceptance

### Automated acceptance matrix

| Concern | Required evidence |
|---|---|
| Stable public surface | `ServerDependencies`/`buildServer` source gate, unchanged `index.ts`, TypeScript build |
| Route completeness | Twenty method/path characterization rows and all existing inject tests |
| Administrator security | Admin route suite plus cookie/CSRF source ownership gate |
| Desktop authentication/account | Auth, activation, route, and account projection tests |
| LLM secret/quota | LLM quota suite and transaction suites; no secret appears in public admin/account output |
| Transaction ownership | MemoryStore and Prisma transaction-safety suites; forbidden Prisma/database imports in routes |
| Update behavior | Update suite including exact 204 empty-body behavior |
| Billing/webhook | Disabled route tests, order ownership, exact raw-body characterization, settlement tests |
| Module direction | AST/source boundary suite for exact files, imports, constructors, handlers, and private owners |
| Scope | Git diff allowlist and package/contract/schema no-diff checks |
| Governance | WARN-level document validator and `git diff --check` |

### Manual and residual validation

No live provider smoke is required because this is a behavior-preserving server refactor and
WeChat Pay remains disabled. If a local server smoke is run, it may cover only login/admin page
rendering with fake/local dependencies and must not send email, consume real LLM credits, or call a
payment provider. Record it as optional evidence, not a substitute for automated gates.

Residual risks to record even after automation passes:

- source gates protect the planned ownership model but cannot prevent all future semantic coupling;
- injected Fastify tests do not exercise production proxy/TLS configuration;
- no credentialed WeChat, SMTP, LLM supplier, or updater network smoke is part of this task; and
- physical line count is a maintenance indicator, not proof of architectural quality.

## Rollback and Recovery

The work is a sequence of moves behind an unchanged root. After each task, a failing capability can
be restored by moving that registrar's handlers/helpers back into `server.ts` while retaining the
green characterization tests. Do not use `git reset --hard`, discard unrelated user changes, or
revert Store/Prisma transaction code. If raw-body, cookie, route, or transaction behavior differs,
stop at the last green extraction boundary and document the mismatch before continuing.

## Final Acceptance

- User approved this design and plan before production edits.
- All twenty route pairs and all behavior/failure invariants remain unchanged.
- `server.ts` is a <= 200-line stable composition root with no direct handlers or Zod schemas.
- Six feature registrars plus shared schemas/support match the approved responsibility map.
- Fastify/service/parser lifecycle and Store/Prisma transaction ownership remain unchanged.
- No new facade, plugin, dependency, public API, product behavior, logging, or provider scope exists.
- Complete server and required cross-layer gates pass with exact evidence recorded.
- Durable docs, audit, task tracking, indexes, and the archived ExecPlan match implemented reality.
