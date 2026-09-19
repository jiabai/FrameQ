# Self-Service Activation Server Rollout Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision
> Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** FrameQ works directly on `main` per `AGENTS.md`; do not create a feature
> branch or worktree. This plan changes no application code - it is an operations rollout. Follow
> `deploy/server-deployment.md` Sections 5-7 literally; this plan only adds ordering, judgement
> criteria, and the feature-specific smoke.

**Goal:** Take the already-implemented and already-released self-service email activation code
feature from `main` to the production FrameQ server, staged behind its existing kill switch so that
rollback is a configuration change, and produce the authenticated SMTP smoke evidence that
`docs/exec-plans/completed/2026-08-24-self-service-email-activation-code-plan.md` never recorded.

**Architecture:** No source changes. The rollout replays the production runbook against the live
install: stop the service, back up the SQLite database and `.env` as a matched set, rehearse the
restore in isolation, check out a reviewed commit, rebuild, apply the three reviewed migrations,
preflight the schema, start the service with `FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED=false`, prove no
regression, then flip the flag to `true`. `scripts/check-self-service-rollout.mjs` distinguishes
whether the route is deployed using unauthenticated probes only.

**Deployed layout differs from the reference topology.** The host named in
`deploy/server-deployment.md` Sections 2-3 (`/opt/frameq/FrameQ`, unprivileged `frameq` user) is the
*reference* topology, not what production runs. The live install is:

| Item | Reference runbook | Actual production |
| --- | --- | --- |
| Install root | `/opt/frameq/FrameQ` | `/home/ubuntu/FrameQ` |
| Service user | `frameq` | `ubuntu` |
| Server root | `/opt/frameq/FrameQ/server` | `/home/ubuntu/FrameQ/server` |
| Database | `/opt/frameq/FrameQ/server/data/frameq.sqlite` | `/home/ubuntu/FrameQ/server/data/frameq.sqlite` |

Every command in the runbook therefore needs the paths and the `sudo -u frameq` prefix adjusted; the
ordering and the success criteria are unchanged.

**Tech Stack:** Ubuntu host, Node.js 22, Nginx reverse proxy, systemd, Prisma 6 + SQLite, SMTP,
the repository's `server` npm `db:*` scripts, Node's built-in test runner.

**Approval status:** Executed. Production now runs `5c9e974` with all six migrations applied and
`FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED=true`. One acceptance item is still open: the authenticated
request/email/redeem smoke against production needs a test mailbox and has not been run.

> **Reading note:** the `Progress` and `Outcomes & Retrospective` sections are the authoritative, dated
> record of what was actually executed, each entry carrying its own evidence. The `Plan of Work` steps
> below are the pre-execution blueprint and were deliberately left as written - do not read an
> unchecked box there as unverified work, and do not read a checked-box expectation there as the
> verdict that was actually observed (two Phase verdicts were corrected during execution; see
> Surprises & Discoveries). Cross-check `Progress` instead.

---

## Purpose / Big Picture

The desktop client has shipped self-service activation since v0.3.6, but the server side never
reached production. A signed-in user whose entitlement is absent or expired therefore still sees no
"send activation code to my email" button, and the only activation path remains an administrator
handing out a universal code.

After this plan, an inactive signed-in user can request an account-bound code by email, receive it,
and redeem it for 31 days of entitlement plus 20 AI Credits - with no administrator participation -
while the feature stays behind a kill switch that operators can turn off in seconds without touching
code or the database.

The rollout is deliberately two-phase. Phase A deploys the code with the flag off, which proves the
new build, the three migrations, and the existing login/billing paths coexist. Phase B flips one
environment variable and re-verifies. If Phase B misbehaves, `FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED=false`
plus a restart removes the user-visible feature immediately, and the deployed build remains in place
for diagnosis.

## Progress

- [x] 2026-09-19: Confirmed production still runs a pre-feature build and localized the build window.
  Validation: `POST /api/desktop/activation-codes/redeem` answers `401 {"error":"AUTH_REQUIRED"}`
  while `POST /api/desktop/activation-codes/request` answers Fastify's built-in 404; git blame puts
  `redeem` at 2026-06-22/2026-07-21 and `request` at 2026-08-25, so production is between those.
- [x] 2026-09-19: Built and tested the rollout probe. Validation:
  `node --test scripts/tests/self-service-rollout.test.mjs` -> 12 passed; live run against
  `https://frameq.8xf.pro` reports `ROLLOUT_STATE=not_deployed` with the classifier sanity check and
  both auth-first checks behaving as designed.
- [x] 2026-09-19: Re-audited the archived implementation plan and recorded which of its Task 1-13
  artifacts actually exist on `main`. Validation: `Completion Audit (2026-09-19)` section added to
  that plan; `python scripts/validate_agents_docs.py --level ERROR` and `--level WARN` both report
  0 errors and 0 warnings.
- [x] 2026-09-19: Read the three migrations and identified the one that constrains rollback.
  Validation: `202608240001_self_service_email_activation/migration.sql` rebuilds `ActivationCode`
  with `issuanceSource TEXT NOT NULL` and no default, so pre-feature code cannot insert a code once
  the migration is applied. Recorded below under Rollback.
- [x] 2026-09-19: Stopped the service and took the matched backup set. Validation: clean shutdown
  checkpointed the WAL (`-wal`/`-shm` removed), `PRAGMA integrity_check` returned `ok`, all ten table
  row counts matched the pre-stop values, and `backups/20260919T045124Z/{frameq.sqlite,server.env,
  SHA256SUMS}` verified with `sha256sum --check`. `.env` was tightened from `664` to `600`. An
  off-host copy was pulled and re-verified.
- [x] 2026-09-19: Discovered the live database predates migration history entirely and re-derived the
  correct migration path. Validation: the database had no `_prisma_migrations` table, but its schema
  was byte-identical to the output of migrations `0001`+`0002`+`0003` (compared `sqlite_master` DDL
  against a scratch database built from the migration files). `db:preflight -- --mode baseline`
  therefore failed with `UNEXPECTED_BASELINE_SCHEMA` and `--mode current` failed with
  `MIGRATION_HISTORY_INCOMPATIBLE`, so the runbook's "resolve the baseline only" path was wrong here.
- [x] 2026-09-19: Rehearsed the whole migration on an isolated copy before touching production.
  Validation: the rehearsal applied the three new migrations, produced `status: ok` from
  `db:preflight --mode current` and `db:restore-smoke`, preserved all ten row counts, backfilled
  `issuanceSource='admin'` on all 11 existing codes, and left the production database hash unchanged.
- [x] 2026-09-19: Deployed `5c9e974` to production. Validation: fast-forward from `1afb925`;
  `npm ci`, `npm run prisma:generate`, `npm test` (292 passed / 33 files) and `npm run build`
  (`tsc --noEmit`) all exited 0.
- [x] 2026-09-19: Applied the migrations to production with zero data loss. Validation:
  `prisma migrate status` reports all six applied and `Database schema is up to date!`;
  `db:preflight --mode current` returns `status: ok`; every one of the ten table row counts is
  unchanged (11 users, 11 activation codes, 128 usage events).
- [x] Phase A: started with the flag off and proved no regression. Validation: `/health/live` and
  `/health/ready` answer 200 on loopback and through Nginx; `/login` 200, `/admin/login` 200,
  `/dashboard` 302, marketing `/` 200 and `/privacy`/`/download` resolve to 200; desktop API shapes
  unchanged (`/api/desktop/account` 401, `sessions/exchange` 400, `llm/checkouts` 401).
- [x] Phase B: enabled the flag and re-verified. Validation: `.env` line set to `true` and mode `600`,
  `systemctl restart` swapped the PID with `Result=success`, health stayed 200/200, and the real
  config parser reported `environment: production` and `selfServiceActivationEnabled: true`.
- [ ] Authenticated request/email/redeem smoke against production (Task 7 Step 3), plus the Admin Web
  metadata check (Task 7 Step 4). Blocked on a test mailbox; see Surprises & Discoveries for what the
  isolated rehearsal already proved. This is the only remaining acceptance item.
- [x] 2026-09-19: Closed out the documentation. Validation: `TASKS.md` carries the deployed commit, the
  applied migrations, the Phase A/B probe verdicts, and the outstanding smoke;
  `docs/product-specs/2026-08-24-self-service-email-activation-code.md`,
  `docs/design-docs/2026-08-24-self-service-email-activation-code.md`, and
  `docs/exec-plans/completed/2026-08-24-self-service-email-activation-code-plan.md` now state the
  deployment instead of an outstanding one, and the archived plan's `feature_disabled`/`live` probe
  description was corrected to the states the probe can actually distinguish; this plan moved to
  `completed/` with all three index files updated. Evidence records no mailbox, code, session token,
  or request body. Gates: `python scripts/validate_agents_docs.py --level ERROR` and `--level WARN`
  both report 0 errors and 0 warnings;
  `node --test scripts/tests/self-service-rollout.test.mjs` -> 12 passed / 0 failed; and a fresh probe
  run against `https://frameq.8xf.pro` -> 9/9 checks pass, `ROLLOUT_STATE=route_registered`, exit 0.

## Surprises & Discoveries

- **The live database predates migration history, and it is already at the `user_session` schema.**
  It had no `_prisma_migrations` table, so `db:preflight -- --mode current` failed with
  `MIGRATION_HISTORY_INCOMPATIBLE` and `--mode baseline` failed with `UNEXPECTED_BASELINE_SCHEMA`
  (because `EmailOtp.purpose` already exists, which baseline mode explicitly rejects). The runbook's
  Section 4 recovery path - run `--mode baseline`, then `migrate resolve --applied
  202607220001_baseline`, then deploy - is written for a database still at the *baseline* schema and
  would have failed here. Building a scratch database from the six migration files and diffing
  `sqlite_master` against the live schema showed the live schema is exactly the output of
  `0001`+`0002`+`0003`, so all three had to be resolved as applied, not just the baseline.
- **The rollout probe's original state model was wrong, and running it against the deployed server is
  what proved it.** `POST /api/desktop/activation-codes/request` authenticates *before* it evaluates
  the feature flag (`server/src/routes/desktopAccount.ts:66-79`), so an unauthenticated caller gets
  `401 AUTH_REQUIRED` whether the flag is on or off. The original script claimed a `live` state
  meaning "route registered and the flag is enabled" and reported exactly that while the production
  flag was still `false`. Measured: the anonymous probe output is byte-identical for flag `false` and
  flag `true`. The script now reports `route_registered` and states that the flag is not observable
  without a session; `404 FEATURE_NOT_AVAILABLE` remains recognised because the flag-off body is real,
  but it is only reachable once a valid session exists.
- **`db:restore-smoke` cannot pass on a pre-migration-history database, by construction.** It runs
  `runDatabasePreflight({mode: "current"})` internally, which calls `verifyMigrationHistory`. On the
  legacy database it therefore failed with `MIGRATION_HISTORY_INCOMPATIBLE` - not because the backup
  was bad, but because the migration history did not exist yet. The rehearsal ordering has to be
  "restore the copy, resolve the legacy migrations, deploy the new ones, *then* run the smoke".
- **The host runs several unrelated services, and one of them owns port 8788.** A first attempt at
  the isolated rehearsal chose 8788 and reported a healthy 200 plus a route-not-found 404 - all of
  which came from a different application on the same box. The port list is: Nginx 80/443/8080/8008,
  StudyMind 8788, a Next.js server on 3000, a uvicorn app on 8001. The lesson is that a rehearsal must
  confirm the listener identity, not just a 200: check `ss -lptn` plus the application's own
  "Server listening" line. The real rehearsal then used 8799.
- **The 429 `Retry-After` header was not observed by the rehearsal probe, and this is unresolved.**
  The isolated copy returned `429` with `{"error":"ACTIVATION_REQUEST_RATE_LIMITED"}` as expected, but
  the probe did not see a `Retry-After` header. The route sets that header only when
  `error.retryAt` is truthy (`server/src/routes/desktopAccount.ts:105-111`), and both the route test
  (with a stubbed service) and the Prisma store test (which asserts a concrete `retryAt` date) pass,
  so the most likely explanation is header-name case sensitivity in the probe rather than a product
  defect. It should be settled on the deployed service with a real session before the smoke is
  considered complete.
- **`.env` sets `NODE_ENV=development` while the systemd unit sets `NODE_ENV=production`, and
  production wins.** `server/src/env.ts` loads `.env` with `override: false`, so the environment
  variable from the unit is authoritative; `/proc/<pid>/environ` confirms the running process sees
  `production`. That is why `FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED` had to be added explicitly -
  `parseExplicitProductionFlag` records a missing value as a startup failure in production, so the
  new code would not have started without it.
- The three migrations are not equally reversible. `202608240001` and `202608240002` rebuild their
  tables; `0001` backfills `issuanceSource='admin'` for existing rows but leaves the column `NOT
  NULL` with no default, so a code-only rollback breaks administrator code issuance
  (`NOT NULL constraint failed: ActivationCode.issuanceSource`). Evidence:
  `server/prisma/migrations/202608240001_self_service_email_activation/migration.sql:9` and the
  `INSERT ... SELECT` at line 48. Rollback must restore the database, not just the commit.
- `202608240002` is safe to apply ahead of the code. Its `purpose` CHECK constraint adds
  `self_service_activation` to a closed set that already contains the only two values older code
  writes. Evidence: migration line 12 versus `createOtpSender`/`AdminAuthService` purposes.
- `202608240003` cannot fail on this rollout. It creates a partial unique index over active
  self-service codes, and production has never issued one, so the fail-closed behavior described in
  its header comment is vacuous here. It becomes meaningful only after Phase B issues real codes.
- The auth-first ordering is what makes the probe safe. An unauthenticated `POST` to the request
  route returns `401 AUTH_REQUIRED` before the feature flag or the request body is evaluated, so a
  probe can never trigger an email or leak the flag state. Evidence:
  `server/src/routes/desktopAccount.ts:66` authenticates before the availability check at line 74,
  asserted by `server/tests/routes.test.ts` "checks bearer auth before evaluating self-service
  availability".
- The desktop locale set is `zh-CN | zh-TW | en-US`, and the request body is `.strict()`. An extra
  field is a `400`, not a silent ignore, so the smoke must send `locale` alone.
- Production SMTP is already proven for login OTP. Because production refuses to start without a
  complete SMTP configuration and forbids `FRAMEQ_ALLOW_CONSOLE_OTP`, a working OTP login means
  `SMTP_HOST/PORT/USER/PASS/FROM` are already present, and `createActivationCodeSender` requires the
  same fields. No new mail credentials are expected.

## Decision Log

- Decision: Deploy in two phases with the flag off first. Rationale: it separates "the new build and
  migrations are safe" from "the new feature behaves", so a Phase B failure has a one-variable
  cause and a configuration-only remedy. Date/Author: 2026-09-19, User + Codex.
- Decision: Pin the rollout to a recorded commit rather than a moving branch. Rationale: the runbook
  asks for a reviewed commit, and `server/` has been unchanged since `5a3ed84` (2026-08-25), so any
  commit at or after it carries identical server behavior. Date/Author: 2026-09-19, Codex.
- Decision: Do not modify the two live endpoints' contract as part of the rollout. Rationale: the
  frozen route table and the already-published v0.3.6 client depend on the current fields, status
  codes, and error codes; changing them turns a deployment into a breaking client release.
  Date/Author: 2026-09-19, User + Codex.
- Decision: Treat the migration set as forward-only and make the backup the rollback mechanism.
  Rationale: `0001` is not backward compatible with pre-feature inserts, so the matched
  code-plus-database-plus-configuration set is the only safe restore unit. Date/Author: 2026-09-19,
  Codex.
- Decision: Use `scripts/check-self-service-rollout.mjs` as the phase gate rather than ad-hoc curls.
  Rationale: it refuses non-HTTPS non-loopback targets, sends no credentials, and carries a
  control-route sanity check that would catch a changed 404 shape. Date/Author: 2026-09-19, Codex.
- Decision: Resolve `0001`, `0002` *and* `0003` as applied on the legacy database, deviating from
  Section 4 of the runbook. Rationale: the live schema is provably identical to the output of those
  three migrations, so resolving only the baseline would make `migrate deploy` re-run `0002` (which
  would drop and recreate `EmailOtp` and then fail on `AuthErrorLimit`'s existing `CREATE TABLE`) and
  `0003` (which would fail because `UserSession` already exists). Evidence: `sqlite_master` DDL diff
  between the live database and a scratch database built from the migration files is empty.
  Date/Author: 2026-09-19, Codex.
- Decision: Rehearse with real authenticated sessions against a throwaway copy, seeded with test
  users, rather than relying on stubbed unit tests. Rationale: it exercises the real Prisma store,
  real route handlers, and the real flag plumbing on the deployed build, and it does so without
  sending any email - the `entitlement_active`, `rate_limited`, and `invalid locale` paths all return
  before the send. Date/Author: 2026-09-19, Codex.
- Decision: Do not run the happy-path request in the rehearsal. Rationale: it would attempt SMTP
  delivery to a test address, and sender reputation is not worth the marginal evidence; the
  authenticated happy path is reserved for the production smoke with a real test mailbox.
  Date/Author: 2026-09-19, Codex.

## Outcomes & Retrospective

**Outcome: deployed and enabled; one acceptance item outstanding.** Production serves
`5c9e974` with all six migrations applied and `FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED=true`, so an
inactive signed-in user now has the self-service entry point. The authenticated end-to-end smoke
against production has not been run because it needs a test mailbox.

Recorded evidence (no mailbox, code, session token, or request body is recorded anywhere):

- Deployed commit `5c9e974` (fast-forward from `1afb925`); `server/` at that commit is byte-identical
  to `5a3ed84`, the last commit that touched `server/`.
- Gates on the host: `npm ci` 0, `npm run prisma:generate` 0, `npm test` 292 passed across 33 files,
  `npm run build` (`tsc --noEmit`) 0.
- `prisma migrate status`: 6 migrations found, `Database schema is up to date!`
- `db:preflight -- --mode current`: `{"status":"ok","mode":"current","checks":["wal_checkpoint",
  "exclusive_access","integrity","foreign_keys","quota_invariants","current_schema",
  "migration_history"]}`
- Data preservation across the migration, all ten tables: `User` 11, `Entitlement` 8,
  `ActivationCode` 11, `Order` 0, `LlmUsageEvent` 128, `EmailOtp` 28, `AuthRateLimit` 34,
  `UserSession` 9, `Session` 32, `AdminSession` 22 - identical before and after.
  All 11 existing activation codes carry `issuanceSource='admin'`.
- Backup `20260919T045124Z` is the pre-migration database; `sha256sum --check` passes on the host and
  on an off-host copy taken to the operator's workstation.
- Phase A probe verdict: `ROLLOUT_STATE=route_registered`, exit 0. The originally planned verdict
  `feature_disabled` is not reachable without a session - see Surprises & Discoveries.
- Phase B verification: `.env` set to `true` at mode `600`, restart produced a new PID with
  `Result=success`, `/health/live` and `/health/ready` 200 on loopback and through Nginx, and
  `parseRuntimeConfig` reported `environment: production` / `selfServiceActivationEnabled: true`.
- Regression sweep after the restart: `/login` 200, `/admin/login` 200, `/dashboard` 302,
  marketing `/` 200, `/privacy` and `/download` resolve to 200; `/api/desktop/account` 401,
  `sessions/exchange` 400, `llm/checkouts` 401, both activation routes 401.
- Isolated rehearsal (throwaway copy, seeded test users, no email sent) reproduced the flag
  semantics end to end: flag off gave `can_request_activation_code=false` and
  `404 FEATURE_NOT_AVAILABLE`; flag on gave `can_request_activation_code=true` for a user without
  entitlement and `false` for a user with an active one, `409 ENTITLEMENT_ACTIVE` for the active
  user, `429 ACTIVATION_REQUEST_RATE_LIMITED` for a saturated mailbox, and `400 INVALID_REQUEST` for
  a bad locale, an extra field, and an empty body. No activation code row was created in any of
  those cases.
- Production database contains zero rehearsal residue: no seeded user, session, entitlement,
  `self_service_activation` rate-limit row, or `self_service_email` activation code. Table counts
  remain 11 users and 11 activation codes. The rehearsal directory was removed from `/var/tmp`.
- Post-close-out probe re-run against `https://frameq.8xf.pro`: 9/9 checks pass with exit 0 and
  `ROLLOUT_STATE=route_registered`. The PASS set covers both health endpoints, the classifier sanity
  control route, `GET /api/desktop/account` auth-first, both activation routes auth-first, and the
  "flag state is not observable without a session" assertion (well-formed, malformed, and extra-field
  requests all answer 401). The probe's own closing hint now tells the operator to confirm the flag
  separately, which is the corrected state model.

Still open:

- The authenticated request/email/redeem smoke (Task 7 Step 3), including the Admin Web metadata
  check (Step 4), needs a test mailbox.
- The `Retry-After` observation noted under Surprises & Discoveries should be settled while doing so.

Residual risk: the full list lives under `Residual Risks` at the end of this document. The dominant
one is that SMTP acceptance does not prove inbox delivery, so a "sent" code can still be lost, and
the supported recovery is requesting a new code after the persisted cooldown.

## Context and Orientation

Deployment targets and the exact command sequence live in `deploy/server-deployment.md`; this plan
does not restate Section 5/6/7 command text, it adds ordering and verdicts on top of it.

- Production topology: Internet -> Nginx :443 -> FrameQ server on `127.0.0.1:8787` -> local SQLite,
  plus an SMTP provider. One process per SQLite file.
- Install root `/opt/frameq/FrameQ`, run as the unprivileged `frameq` user, systemd unit
  `frameq-server`, environment file `/opt/frameq/FrameQ/server/.env` at mode `0600`.
- Database file `/opt/frameq/FrameQ/server/data/frameq.sqlite`.
- Public hostname `https://frameq.8xf.pro`, which also statically serves the marketing site.
- Feature files involved, all already on `main`: `server/src/routes/desktopAccount.ts` (the two
  routes), `server/src/selfServiceActivation.ts`, `server/src/activationPolicy.ts`,
  `server/src/email.ts` (`createActivationCodeSender`), `server/src/store/rateLimitPolicy.ts`,
  `server/src/runtimeConfig.ts` (the flag), and the three migrations under
  `server/prisma/migrations/`.
- Migrations to apply, in order: `202608240001_self_service_email_activation`,
  `202608240002_auth_rate_limit_self_service_purpose`,
  `202608240003_self_service_active_unique`.
- Verification tooling added by this plan: `scripts/check-self-service-rollout.mjs` plus
  `scripts/tests/self-service-rollout.test.mjs`. Run it with
  `node scripts/check-self-service-rollout.mjs` (defaults to `https://frameq.8xf.pro`) or pass
  `--base-url`.

## File Structure

- `scripts/check-self-service-rollout.mjs` - new. Unauthenticated rollout probe; exports
  `classifyRequestProbe`, `isRouteNotFoundBody`, `assertUsableBaseUrl`, and `runRolloutChecks`.
- `scripts/tests/self-service-rollout.test.mjs` - new. 12 cases covering the classifier, the URL
  guard, the credential-free guarantee, and the three real rollout scenarios.
- `docs/exec-plans/completed/2026-09-19-self-service-activation-server-rollout-plan.md` - this plan
  (authored under `active/`, archived to `completed/` at close-out).
- `docs/exec-plans/active/index.md` - registered this plan while active, and dropped the entry at
  close-out.
- `docs/exec-plans/completed/index.md` - received the archived entry at close-out.
- `docs/exec-plans/completed/2026-08-24-self-service-email-activation-code-plan.md` - receives the
  completion audit and the corrected approval status.
- `TASKS.md` - ledger entry when the rollout completes.
- No changes under `app/`, `worker/`, `server/src/`, or `server/prisma/`.

## Plan of Work

### Task 1: Freeze the release candidate

- [ ] **Step 1: Confirm the working tree is clean and record the commit to deploy.**

  ```bash
  cd /opt/frameq/FrameQ
  sudo -u frameq git status --short
  ```

  Success: empty output. Then choose the commit by inspecting
  `git log --oneline -- server/`, not by taking whatever `main` points at. Success: the chosen
  commit is at or after `5a3ed84` (2026-08-25), and its `server/` tree is identical to the tested
  one. Failure: if `server/` moved since `5a3ed84`, stop and re-run the server gates on the new
  commit before deploying.

- [ ] **Step 2: Record the pre-deployment state as evidence.**

  ```bash
  curl --silent https://frameq.8xf.pro/health/live
  curl --silent https://frameq.8xf.pro/health/ready
  node scripts/check-self-service-rollout.mjs; echo "exit=$?"
  ```

  Success: both health endpoints answer, and the probe prints `ROLLOUT_STATE=not_deployed` with
  exit 1. Save the state line only - never the mailbox, code, or session material. Failure: if the
  probe already reports `feature_disabled` or `live`, this plan is stale; re-audit before
  continuing.

### Task 2: Stop the service and take the matched backup set

- [ ] **Step 1: Run `deploy/server-deployment.md` Section 5 in full.**

  Success: the database and `.env` are copied into a timestamped `backups/<STAMP>/` directory, a
  `SHA256SUMS` manifest exists, and the directory is mode-restricted. Verify the manifest with
  `sudo -u frameq sha256sum --check SHA256SUMS` inside that directory. Failure: do not proceed. An
  unverifiable backup means Task 4 onward has no rollback path.

- [ ] **Step 2: Copy the encrypted backup and checksum to protected off-host storage.**

  Success: an off-host copy exists and its access is narrower than source access. Record only the
  UTC timestamp, the backup identifier, and pass/fail.

### Task 3: Rehearse the restore in isolation

- [ ] **Step 1: Run `deploy/server-deployment.md` Section 6.**

  Success: `db:restore-smoke` opens the isolated copy read-only, reports integrity, foreign keys,
  required migrations, and quota invariants as OK, and `db:migrate:status` against the isolated copy
  reports the pre-deployment migration set. Failure: stop; a backup that cannot be opened is not a
  backup.

- [ ] **Step 2: Delete the rehearsal directory securely.**

  Success: the isolated directory is gone, and the live database was never the target.

### Task 4: Deploy the code with the feature still off

- [ ] **Step 1: Run `deploy/server-deployment.md` Section 7 through the build, with the flag left off.**

  That is: `systemctl stop` (already stopped by Task 2), `git fetch --tags --prune`,
  `git checkout <Task 1 commit>`, then `npm ci`, `npm run prisma:generate`, `npm test`,
  `npm run build` in `server/`.

  Success: `npm test` passes (the pre-deploy baseline recorded at v0.3.6 was 291 passed / 1 skipped),
  and `npm run build` exits 0. Also confirm `/opt/frameq/FrameQ/server/.env` still contains an
  explicit `FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED` line, currently `false`, and that its mode is
  still `0600`. Failure: fix forward on the host, or restore the previous commit and restart - the
  service has not yet been started against new data.

### Task 5: Apply the migrations and preflight

- [ ] **Step 1: Apply the three migrations while the service is stopped.**

  ```bash
  cd /opt/frameq/FrameQ/server
  sudo -u frameq npm run db:migrate:deploy
  sudo -u frameq npm run db:migrate:status
  sudo -u frameq npm run db:preflight -- --mode current
  ```

  Success: `migrate deploy` reports no drift, `migrate status` lists all three 20260824 migrations as
  applied, and the preflight returns `status: ok` for `mode: current`. Failure: if `0001` or `0002`
  aborts, the service stays stopped and the backup from Task 2 becomes the recovery path - do not
  hand-edit SQLite. If `0003` aborts because of a pre-existing duplicate active self-service code,
  investigate that row before retrying; this rollout does not expect any such row.

- [ ] **Step 2: Confirm the admin code path still has its data intact.**

  Success: the preflight's activation-code checks pass and the row count is unchanged from the
  pre-deployment backup. Record counts only.

### Task 6: Start with the flag off and prove no regression

- [ ] **Step 1: Start the service and check health.**

  ```bash
  sudo systemctl start frameq-server
  curl --fail --silent https://frameq.8xf.pro/health/live
  curl --fail --silent https://frameq.8xf.pro/health/ready
  ```

  Success: both commands exit 0. Failure: read `journalctl -u frameq-server` for the startup
  rejection code. A missing or invalid `FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED` is a startup failure
  by design in production.

- [ ] **Step 2: Prove the feature is deployed but disabled.**

  ```bash
  node scripts/check-self-service-rollout.mjs; echo "exit=$?"
  ```

  Success: `ROLLOUT_STATE=route_registered`, exit 0 - the route now exists and answers
  `401 AUTH_REQUIRED` instead of Fastify's built-in 404. **Corrected during execution:** the original
  expectation of `ROLLOUT_STATE=feature_disabled` with `404 FEATURE_NOT_AVAILABLE` is not reachable
  from an unauthenticated probe, because the route authenticates before it evaluates the flag, and
  Phase A therefore cannot produce a flag-specific verdict. Failure: `not_deployed` means the checkout
  did not take effect. See Surprises & Discoveries.

- [ ] **Step 3: Re-verify the existing user-visible paths.**

  Success: one non-user test-inbox OTP login, one administrator login, a ticket exchange, one
  idempotent quota checkout on a fake/provider-approved path, and log redaction all behave as before.
  Confirm the marketing site still serves at `https://frameq.8xf.pro/`. Failure: restore per the
  Rollback section.

### Task 7: Phase B - enable the flag and run the authenticated smoke

- [ ] **Step 1: Set the flag and restart.**

  ```bash
  # edit /opt/frameq/FrameQ/server/.env
  #   FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED=true
  sudo systemctl restart frameq-server
  sudo -u frameq stat -c '%a %n' /opt/frameq/FrameQ/server/.env   # expect 600
  ```

  Success: the service returns to `active (running)` and health endpoints answer. Failure: revert the
  line to `false`, restart, and fall back to Phase A behavior - nothing else changes.

- [ ] **Step 2: Confirm the capability is advertised.**

  ```bash
  node scripts/check-self-service-rollout.mjs; echo "exit=$?"
  ```

  Success: `ROLLOUT_STATE=route_registered` with exit 0, unchanged from Phase A - which is the
  expected result, because the probe cannot see the flag. **This step therefore cannot prove the flag
  flipped.** The observable proof is on the host instead: the real config parser reports
  `environment: production` / `selfServiceActivationEnabled: true`, the restart produced a new PID with
  `Result=success`, and health stayed 200/200. The flag is finally observable end to end only by the
  authenticated smoke in Step 3. Failure: `not_deployed` means the build regressed.

- [ ] **Step 3: Run the authenticated request/email/redeem smoke on a dedicated test account.**

  Use an account whose entitlement is absent or expired. With its desktop session token:

  1. `GET /api/desktop/account` - success: `can_request_activation_code=true`, `can_process=false`.
  2. `POST /api/desktop/activation-codes/request` with body `{"locale":"zh-CN"}` only - success:
     `status=sent` plus `retry_at` and `redeem_by`, and no plaintext code in the response.
  3. The email arrives with the three-locale template, the bound mailbox, the redeem-by deadline,
     31-day entitlement, 20 AI Credits, and the do-not-forward notice. Confirm by human reading; the
     code itself must not be copied into any log or ledger.
  4. `GET /api/desktop/account` again - success: `can_request_activation_code=false` while the
     account stays inactive, proving the capability follows eligibility rather than the flag.
  5. `POST /api/desktop/activation-codes/redeem` with the emailed code - success: entitlement
     becomes active, `llm_quota_limit=20`, `llm_quota_used=0`, `can_process=true`.
  6. Repeat the request call while entitlement is active - success: `409 ENTITLEMENT_ACTIVE`.
  7. After entitlement expires or with a second inactive test account, request twice inside one
     minute - success: the second call returns `429 ACTIVATION_REQUEST_RATE_LIMITED` with `retry_at`
     and a `Retry-After` header.

  Failure: capture the HTTP status and error code only, plus the server's `event`-tagged log line;
  never the email address, code, or token. If SMTP is the failing hop, the code is disabled with
  `delivery_failed` and a `503 ACTIVATION_EMAIL_UNAVAILABLE` is returned - that is the designed
  fail-closed behavior, not a defect.

- [ ] **Step 4: Confirm Admin Web shows the new metadata without plaintext.**

  Success: the activation-code list renders source, bound account, and status for the self-service
  row, and no plaintext code appears anywhere in the page or its API response.

- [ ] **Step 5: Leave the entry point documented for support.**

  Success: support knows that a user can self-serve after expiry, that the cooldown is one request
  per minute and five per hour per mailbox with twenty per hour per IP, and that the emergency
  remedy is the kill switch plus a restart.

### Task 8: Close-out

- [ ] **Step 1: Record the rollout in `TASKS.md`** with the deployed commit, the applied migrations,
  the probe verdict for both phases, and the authenticated smoke result - carrying no mailbox, code,
  session token, prompt, or raw database error. Success: ledger entry present with a `✅` validation
  clause.

- [ ] **Step 2: Update the feature's status lines** in
  `docs/product-specs/2026-08-24-self-service-email-activation-code.md` and
  `docs/exec-plans/completed/2026-08-24-self-service-email-activation-code-plan.md` so its "Still
  open" list is resolved. Success: no remaining document claims the feature is un-deployed.

- [ ] **Step 3: Move this plan to `completed/`** and update `docs/exec-plans/active/index.md`,
  `docs/exec-plans/completed/index.md`, and `docs/exec-plans/index.md` together. Success:
  `python scripts/validate_agents_docs.py --level ERROR` and `--level WARN` both report 0 errors and
  0 warnings.

## Validation and Acceptance

Automated acceptance:

- `node --test scripts/tests/self-service-rollout.test.mjs` passes.
- `node scripts/check-self-service-rollout.mjs` reports `ROLLOUT_STATE=not_deployed` before the deploy
  and `ROLLOUT_STATE=route_registered` with exit 0 afterwards. **Corrected during execution:** the
  planned `feature_disabled` / `live` pair is not distinguishable from an unauthenticated probe, so
  the probe is a deploy gate, not a flag gate; the flag gate is the host-side config check plus the
  authenticated smoke. Measured: the anonymous output is byte-identical for flag `false` and `true`.
- On the server, `npm test` passes and `npm run db:preflight -- --mode current` returns `status: ok`.
- `python scripts/validate_agents_docs.py --level ERROR` and `--level WARN` report 0 errors and 0
  warnings.

Manual acceptance:

- The authenticated smoke in Task 7 Step 3 completes end to end with the exact status codes listed.
- OTP login, administrator login, ticket exchange, and quota checkout still work with the flag on.
- The marketing site still serves at the shared hostname.

## Rollback

Choose the narrowest remedy that matches the failure.

1. **Feature misbehaves, build is fine.** Set `FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED=false` in
   `/opt/frameq/FrameQ/server/.env` and `sudo systemctl restart frameq-server`. Success: the probe
   returns to `ROLLOUT_STATE=feature_disabled`. No database or code change is needed, and any code
   already issued stays redeemable only after the flag is turned back on.
2. **Build is bad.** Restore the matched set: previous reviewed code revision, the Task 2 database
   backup, and the matching `.env`, then verify `SHA256SUMS`, re-run the isolated restore smoke
   against the restored file, start the service, and repeat health plus login smoke.
3. **Never roll back code alone after Task 5.** Migration `202608240001` leaves
   `ActivationCode.issuanceSource` `NOT NULL` with no default, so pre-feature code cannot insert an
   activation code and administrator issuance would fail with a constraint error. Code rollback
   without the database is only safe while the database is still at the pre-deployment schema, i.e.
   before Task 5.
4. The migrations are forward-only in this rollout. There is no down migration; the backup is the
   down path.

## Residual Risks

- SMTP acceptance does not prove inbox delivery. A code can be "sent" and still be lost, and the
  fail-closed two-transaction model can leave a delivered-but-unusable email if the process dies
  between SMTP acceptance and activation. The supported recovery is requesting a new code after the
  persisted cooldown.
- The rate limits are per mailbox and per IP only. There is no graphical or device challenge on the
  request route, so a determined actor with many mailboxes and many addresses can still trigger
  outbound mail within the limits. Adding a challenge is a separate, client-contract-affecting
  change and is out of scope here.
- The rollout widens the deployed attack surface by one unauthenticated-reachable route. It is
  auth-first, so payloads and the flag state are not evaluated before authentication, but the route
  is now discoverable by path probing.
- Evidence discipline is a human control. Recording a mailbox, code, or session token during the
  smoke would leak authorization material into the ledger, and no automated check prevents that.
