# Server Production Operations Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while
> implementing each behavior slice, then use superpowers:verification-before-completion before
> claiming the plan complete.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Make FrameQ server fail closed on unsafe production configuration and provide privacy-safe
logging, trusted client-IP handling, health probes, bounded graceful shutdown, migration/restore
runbooks, and mandatory server CI evidence.

**Architecture:** A typed runtime configuration is validated before listener startup. The stable
Fastify composition root receives explicit logger/readiness/proxy policy, while a bootstrap owner
coordinates Prisma, app listen/close, signal handling, and cleanup. Operational endpoints and logs
use closed non-secret shapes. Production deploys one instance per local SQLite file through reviewed
migrations and a rehearsed full-restore rollback.

**Tech Stack:** Node.js 22, TypeScript 5.9, Fastify 5 structured logging, Prisma 6.19/SQLite WAL,
Vitest 4, Nginx, systemd, GitHub Actions, Markdown deployment/runbook documentation.

---

## Purpose / Big Picture

An operator should be able to tell whether FrameQ server is alive, ready, shutting down, or failing
without printing authentication secrets or raw database errors. A production configuration mistake
must stop startup rather than silently route OTPs to stdout. Deploy, backup, restore, and rollback
must be repeatable and checked before a broad release.

This plan is the operational half of the broad-release server blocker. It depends on the reviewed
migration and semantic transaction boundary from the authentication/quota concurrency plan, but it
does not change desktop media processing, upload user content, proxy LLM prompts, or enable WeChat
Pay.

## Progress

- [x] 2026-07-22: Inspected current startup, SMTP fallback, Fastify logger setting, database setup,
  proxy headers, systemd/Nginx assets, deployment/backup instructions, and GitHub workflows.
  Validation: findings and decisions are recorded in
  `docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md`.
- [x] 2026-07-22: Registered the product/design/security/architecture boundary and this independent
  implementation plan without changing runtime/deployment files or external systems. Validation:
  governance validation reported 0 errors and 0 warnings, and tracked plus new-document whitespace
  checks passed.
- [x] 2026-07-23: Added RED tests for production config, redaction, trusted proxy, health/lifecycle,
  and deployment contracts before each implementation slice. Validation: focused tests failed on
  the unsafe fallback/raw-error/proxy/missing-route/missing-script behavior, then passed after the
  corresponding change.
- [x] 2026-07-23: Implemented typed fail-closed startup and explicit development-only console OTP.
  Validation: the production configuration/SMTP/optional-integration matrix and email tests pass.
- [x] 2026-07-23: Enabled safe structured logging and loopback-only trusted proxy behavior.
  Validation: seeded OTP/email/IP/state/bearer/cookie/CSRF/API-key/body/database markers are absent
  from captured logs/responses, and trusted/spoofed IPv4/IPv6 cases pass.
- [x] 2026-07-23: Added liveness/readiness and bounded idempotent shutdown. Validation: local tests
  prove fixed health states, schema/database probes, startup cleanup, repeated-signal idempotency,
  timeout code, real listener closure, and SQLite release. The real POSIX child `SIGTERM` fixture is
  registered but skipped on this Windows host pending Linux CI evidence.
- [x] 2026-07-23: Replaced production schema push with reviewed migration/preflight/backup/restore/
  rollback operations. Validation: disposable fresh/baseline/invalid-quota/current-schema/restore
  cases and static deployment contracts pass without row/path/secret output.
- [x] 2026-07-23: Re-ran the complete local operations gate from the final worktree state.
  Validation: Prisma generation and TypeScript build passed; Vitest passed 23 files with 142 tests
  passed and the one POSIX child-signal fixture skipped on Windows; fresh migration deploy/status,
  current preflight, and isolated restore smoke passed; repository scripts passed 25/25;
  governance reported 0 errors/0 warnings; and `git diff --check` passed.
- [ ] 2026-07-23: Added the path-filtered Node 22 server CI workflow and passed its static/local
  contract, but hosted workflow and production-shaped SMTP/Nginx/systemd/restore smoke evidence are
  not available in this local session. The plan remains active and the broad-release gate remains
  blocked.

## Surprises & Discoveries

- Initial evidence, now closed locally: `server/src/email.ts` printed the complete email address and six-digit OTP whenever no
  SMTP variables are present; it does not distinguish development from production.
- Initial evidence, now closed locally: `server/src/server.ts` constructed Fastify with `logger: false`, so there was no structured
  request/error lifecycle owned by the application.
- Initial evidence, now closed locally: `server/src/index.ts` listened and printed the URL but registered no `SIGINT`/`SIGTERM`
  handler and never explicitly calls `app.close()` or `prisma.$disconnect()`.
- Initial evidence, now closed locally: no server route exposed liveness or dependency-aware readiness.
- Initial evidence, now closed locally: the documented Nginx proxy set forwarding headers, while the deployment runbook noted
  Fastify did not trust the proxy; `request.ip` could be `127.0.0.1` for all production users.
- Initial evidence, now closed locally: the runbook already recommended one instance, WAL-aware backup, and off-host storage, but
  it had no restore procedure/integrity rehearsal and still deployed schema through `db:push`.
- Evidence: systemd already sends `SIGTERM` with `TimeoutStopSec=20`, providing a clear upper bound
  for an application shutdown deadline shorter than twenty seconds.
- Initial evidence, now closed locally: `.github/workflows/` contained desktop/macOS/process-supervisor workflows but no mandatory
  server test/build/migration workflow.
- Discovery: Windows does not deliver a catchable POSIX `SIGTERM` to a Node child through
  `child.kill("SIGTERM")`. The lifecycle contract therefore has deterministic in-process signal
  coverage on Windows plus a real listening child fixture that runs only on non-Windows Server CI.
- Discovery: Prisma resolves relative SQLite URLs from the schema directory. The development
  example now uses `file:../data/frameq.sqlite`, while production documentation uses an absolute
  local `file:` URL so runtime, migration, preflight, backup, and restore target one file.
- Discovery: a stop-the-service copy still needs a WAL checkpoint before copying only the main
  SQLite file. The preflight performs `wal_checkpoint(TRUNCATE)` before requesting exclusive access.

## Decision Log

- Decision: Validate one typed runtime configuration before opening Prisma/listener resources.
  Rationale: production defaults and partial secret sets otherwise fail late or create unsafe
  behavior. Date/Author: 2026-07-22, User + Codex.
- Decision: Require complete SMTP in production and permit console OTP only with explicit
  non-production `FRAMEQ_ALLOW_CONSOLE_OTP=1`. Rationale: absence of SMTP must never disclose live
  authentication material to logs. Date/Author: 2026-07-22, User + Codex.
- Decision: Use Fastify/Pino structured logging with application-owned closed fields and redaction,
  not arbitrary request bodies or exception serialization. Rationale: diagnostics are necessary but
  authentication, payment, and LLM material has high disclosure impact. Date/Author: 2026-07-22,
  Codex.
- Decision: Trust forwarded IP only from loopback Nginx peers and reject `trustProxy: true`.
  Rationale: the production topology is known, and universal trust makes IP limits spoofable.
  Date/Author: 2026-07-22, Codex.
- Decision: Expose separate `/health/live` and `/health/ready` fixed responses. Rationale: process
  liveness and database/readiness are different operational questions; neither response needs
  secret/version/user data. Date/Author: 2026-07-22, Codex.
- Decision: Make shutdown idempotent, mark unready first, drain Fastify, disconnect Prisma, and use
  an internal deadline shorter than systemd's 20-second stop limit. Rationale: this preserves
  in-flight transaction integrity while retaining a bounded operator outcome. Date/Author:
  2026-07-22, Codex.
- Decision: Treat full backup restore as the schema rollback path. Rationale: SQLite table rebuilds
  and accounting constraints are safer to roll back as a matched database/code/config set than an
  improvised reverse migration. Date/Author: 2026-07-22, Codex.
- Decision: Add a dedicated path-filtered server CI workflow. Rationale: desktop release workflows
  do not establish server tests, typechecking, Prisma generation, or migration validity.
  Date/Author: 2026-07-22, Codex.
- Decision: Keep this ExecPlan active after local implementation. Rationale: the plan explicitly
  requires hosted Linux signal/CI evidence and approved staging SMTP/restore evidence; repository
  code and a disposable local rehearsal cannot honestly substitute for either external result.
  Date/Author: 2026-07-23, Codex.

## Outcomes & Retrospective

Local implementation outcome: unsafe production config now fails before listening; console OTP is
explicit development/test behavior; production requests use privacy-safe structured logs and
loopback-only proxy trust; health and lifecycle have closed contracts; reviewed migrations,
preflight, WAL-safe backup instructions, read-only restore smoke, rollback, Nginx/systemd assets,
and a dedicated Server CI workflow are present. The final local gate recorded 142 passing Server
tests with one platform-specific skip, the TypeScript build, fresh migration/status/preflight/
restore checks, 25 repository script tests, governance validation, and the whitespace gate. No
live database, SMTP provider, user account, payment provider, LLM, deployment host, commit, push,
or pull request was touched.

Residual risk: hosted Server CI has not run for this worktree; the POSIX child `SIGTERM` fixture is
skipped locally on Windows; no approved non-user SMTP inbox or production-shaped Nginx/systemd host
was provided; off-host backup/restore and provider uptime remain operator/environment concerns; and
the combined v0.2.17 release gate has not been rerun. These are release blockers, not implicit
passes, so this plan remains active.

## Context and Orientation

- Product/release: `docs/product-specs/2026-07-22-release-reliability-hardening.md` and
  `docs/product-specs/2026-07-17-v0.2.17-desktop-i18n-release.md`.
- Durable design:
  `docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md`.
- Startup/composition: `server/src/index.ts`, `server/src/server.ts`, `server/src/database.ts`, and
  `server/src/env.ts`.
- Email/security: `server/src/email.ts`, `server/src/security.ts`, and `server/.env.example`.
- HTTP/proxy: `server/src/routes/`, `deploy/nginx/frameq-server.conf`, and
  `deploy/nginx/frameq-proxy-headers.conf`.
- Service lifecycle: `deploy/systemd/frameq-server.service`.
- Deployment: `deploy/server-deployment.md` and the `README.md` Server Deployment section.
- CI: `.github/workflows/` and `server/package.json`.
- Required data-correctness predecessor:
  `docs/exec-plans/completed/2026-07-22-server-auth-quota-concurrency-hardening-plan.md`.

## Plan of Work

### Task 1: Characterize Unsafe Startup and Operational Gaps

**Files:**

- Modify: `server/tests/email.test.ts`
- Modify: `server/tests/database.test.ts`
- Create: `server/tests/runtimeConfig.test.ts`
- Create: `server/tests/observability.test.ts`
- Create: `server/tests/health.test.ts`
- Create: `server/tests/lifecycle.test.ts`
- Create: `server/tests/proxyTrust.test.ts`

- [x] Add RED production tests for absent/partial SMTP, implicit admin email, missing encryption key,
  and forbidden console OTP.
- [x] Capture logs containing seeded OTP, bearer/cookie/CSRF/API-key/body/database-error markers and
  assert the current implementation fails the no-secret contract.
- [x] Add health/readiness characterization plus a real POSIX child-process `SIGTERM` fixture; the
  child fixture is skipped on Windows and remains required in hosted Linux CI.
- [x] Add trusted-loopback and untrusted-forwarded-header cases for `request.ip`.

### Task 2: Add Typed Fail-Closed Runtime Configuration

**Files:**

- Create: `server/src/runtimeConfig.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/email.ts`
- Modify: `server/src/env.ts`
- Modify: `server/.env.example`
- Modify: `server/tests/runtimeConfig.test.ts`
- Modify: `server/tests/email.test.ts`

- [x] Parse host/port/database/admin email/encryption key/SMTP/proxy/development flags into a closed
  immutable runtime config before opening the listener.
- [x] Require explicit production administrator email, encryption key, database URL, and complete
  SMTP; validate enabled optional integrations without logging values.
- [x] Require `FRAMEQ_ALLOW_CONSOLE_OTP=1` outside production for console delivery and reject it in
  production. Make test SMTP dependency injection remain silent.
- [x] Preserve current development convenience through explicit documented configuration, not an
  implicit missing-secret fallback.

### Task 3: Add Structured Logging and Trusted Proxy Policy

**Files:**

- Create: `server/src/observability.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/routes/shared.ts`
- Modify: `server/tests/observability.test.ts`
- Modify: `server/tests/proxyTrust.test.ts`
- Modify: `deploy/nginx/frameq-proxy-headers.conf`

- [x] Generate application-owned request IDs and log only method, matched route, status, duration
  bucket, stable operation outcome/error code, and lifecycle transitions.
- [x] Redact Authorization, Cookie, Set-Cookie, SMTP/payment/API-key fields and disable request/
  response body logging.
- [x] Map unknown errors to fixed internal/public codes without serializing raw Prisma/SQLite
  exceptions in production.
- [x] Configure forwarded-address trust only for loopback peers and prove spoofed direct headers are
  ignored. Pass the normalized effective address to authentication dispatch limits.

### Task 4: Implement Health and Graceful Lifecycle Ownership

**Files:**

- Create: `server/src/readiness.ts`
- Create: `server/src/bootstrap.ts`
- Create: `server/src/routes/health.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/routes/`
- Modify: `server/tests/health.test.ts`
- Modify: `server/tests/lifecycle.test.ts`

- [x] Add fixed `GET /health/live` and `GET /health/ready` responses; readiness requires startup
  completion, schema compatibility, and a bounded database probe but no SMTP/LLM network call.
- [x] Register health through the existing route-capability boundary and update the route ownership
  contract test deliberately.
- [x] Move listen/signal/close/disconnect orchestration into one bootstrap owner with an idempotent
  shutdown promise and test-injected deadline.
- [x] On first signal mark unready, drain `app.close()`, disconnect Prisma, and exit successfully;
  on timeout log one safe code and exit nonzero before systemd's deadline.
- [x] Prove startup failure closes partial resources, a second signal does not double-close, the
  listening port closes, and the SQLite file can be reopened/moved after normal shutdown.

### Task 5: Replace Production Schema Push and Complete Restore Operations

**Files:**

- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Create: `server/scripts/database-preflight.mjs`
- Create: `server/scripts/restore-smoke.mjs`
- Create: `server/tests/deploymentContracts.test.ts`
- Modify: `deploy/server-deployment.md`
- Modify: `deploy/systemd/frameq-server.service`
- Modify: `deploy/nginx/frameq-server.conf`
- Modify: `README.md`

- [x] Require the baseline/forward migrations from the concurrency plan and remove `db:push` from
  production deployment/rollback instructions.
- [x] Add a non-secret database preflight for schema version, invalid quota rows, integrity, and
  single-instance/local-file assumptions.
- [x] Document stop-the-service backup, checksum, permissions, retention/off-host copy, isolated
  restore, `PRAGMA integrity_check`, migration status, readiness, and bounded read-only verification.
- [x] Add rollback as matched code/database/config restoration; never reverse-edit live accounting
  tables or print their rows in evidence.
- [x] Expose only exact health paths in Nginx and align systemd stop timeout/kill signal with the
  application deadline. Keep the server bound to loopback.
- [x] Rehearse backup and restore on disposable data and record only checks/outcomes.

### Task 6: Add Mandatory Server CI

**Files:**

- Create: `.github/workflows/server-ci.yml`
- Create or modify: server workflow contract tests under `server/tests/` or `scripts/tests/`
- Modify: `docs/EXECUTION_GATES.md`

- [x] Trigger on pull requests/pushes that touch `server/**`, server deployment assets, relevant
  docs/scripts, or the workflow itself.
- [x] Use Node.js 22, immutable `npm ci`, Prisma generation, fresh migration deploy/status,
  complete server tests, and TypeScript build.
- [x] Run a disposable migration/restore smoke and static deployment-contract checks without real
  secrets, SMTP, payments, or LLM calls.
- [ ] Make the workflow a required broad-release evidence item; local success alone does not imply
  the hosted gate passed.

### Task 7: Production Smoke, Documentation, and Handoff

**Files:**

- Modify: `docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md`
- Modify: `docs/product-specs/2026-07-22-release-reliability-hardening.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `TASKS.md`
- Modify: this ExecPlan throughout implementation

- [ ] With explicit operator approval and a designated non-user test inbox, use a disposable/staging
  production-shaped host to verify startup refusal, real SMTP delivery, liveness/readiness, log
  redaction, graceful restart, migration, backup, restore, and post-restore readiness. Do not include
  the OTP or address in evidence.
- [x] Record unavailable staging/SMTP/hosted evidence as residual risk, never as a pass.
- [ ] After both server plans pass, rerun the complete v0.2.17 release gate on the combined reviewed
  commit before changing the release blocker status.
- [ ] Move this plan to `completed/` only after local, hosted, and required staging evidence is
  accepted and both plan indexes are updated.

## Validation and Acceptance

Run focused tests during each TDD slice, then the complete server/operations gates:

```powershell
npm --prefix server run prisma:generate
npm --prefix server test -- --run runtimeConfig
npm --prefix server test -- --run observability
npm --prefix server test -- --run health
npm --prefix server test -- --run lifecycle
npm --prefix server test -- --run proxyTrust
npm --prefix server test -- --run deploymentContracts
npm --prefix server test
npm --prefix server run build
npm --prefix server run db:migrate:deploy
npm --prefix server run db:migrate:status
python scripts\validate_agents_docs.py --level WARN
node --test scripts\tests\*.test.mjs
git diff --check
git status --short
```

Acceptance requires:

- production cannot start with missing/partial SMTP, implicit required secrets, or console OTP;
- captured production logs and public responses contain none of the seeded secret/body/raw-error
  fixtures while retaining request/outcome correlation;
- only a loopback proxy can supply the effective forwarded client IP;
- liveness/readiness report fixed truthful states and readiness turns false before shutdown drain;
- real-process `SIGTERM` closes the listener and Prisma within the bounded deadline, with idempotent
  repeated-signal behavior;
- fresh/existing migration, preflight, backup, isolated restore, integrity, and rollback rehearsal
  pass on disposable SQLite data;
- the dedicated hosted server CI workflow passes from the reviewed commit; and
- production-shaped manual smoke records SMTP, Nginx, systemd, health, graceful restart, and restore
  outcomes without exposing an OTP, email address, token, key, database path, or user data.

No broad-release completion claim is permitted until the authentication/quota concurrency plan is
also accepted and the combined release gate is rerun.
