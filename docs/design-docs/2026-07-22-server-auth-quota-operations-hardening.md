# Server Authentication, Quota, and Production Operations Hardening

- Date: 2026-07-22
- Status: Approved design; implementation pending
- Product spec: `docs/product-specs/2026-07-22-release-reliability-hardening.md`
- ExecPlans:
  - `docs/exec-plans/active/2026-07-22-server-auth-quota-concurrency-hardening-plan.md`
  - `docs/exec-plans/active/2026-07-22-server-production-operations-hardening-plan.md`

## Context

FrameQ server currently has good transaction boundaries for payment settlement, activation-code
redemption, and administrator entitlement adjustment. The login and per-call AI Credits paths do
not yet have the same guarantee:

- desktop and administrator OTP verification read a usable challenge, increment attempts, compare
  the code, consume the challenge, and create the resulting ticket/session through separate Store
  calls;
- desktop ticket exchange consumes the ticket before creating the durable desktop session; and
- LLM checkout reads the entitlement and then increments `llmQuotaUsed`, so two distinct concurrent
  request IDs can both observe one remaining Credit before either update commits.

The current in-memory OTP resend map is also neither atomic across overlapping async requests nor
shared across restarts/processes. Behind the documented Nginx deployment, Fastify does not yet trust
the loopback proxy, so `request.ip` may be the proxy address rather than the client address.

Production startup currently permits missing SMTP configuration by printing the email address and
OTP to stdout, disables Fastify logging completely, exposes no liveness/readiness contract, and does
not close Fastify and Prisma explicitly on `SIGINT`/`SIGTERM`. The deployment runbook describes a
backup but does not provide a complete restore drill, migration baseline, or server CI gate.

These are broad-release blockers. They do not imply that the present small, single-instance service
is already compromised, but they can produce duplicate login artifacts, a consumed ticket without
a session, quota overspend, secret-bearing logs, or operationally ambiguous restarts under ordinary
concurrency and failure.

## Decision Summary

1. Move login and quota invariants into semantic Store operations. Routes and services must not
   assemble critical read/check/write sequences from low-level persistence calls.
2. Use database conditional writes, transactions, and unique constraints as the correctness
   boundary. Do not rely on JavaScript locks, SQLite's usual single-writer behavior, or Redis-style
   distributed locks.
3. Add an explicit OTP purpose and database-backed dispatch limits. Desktop and administrator
   challenges are never interchangeable.
4. Consume a desktop ticket and create its session in one transaction. A session-write failure
   leaves the ticket usable for a safe retry.
5. Check out one AI Credit through one conditional entitlement update plus one idempotency event in
   the same transaction.
6. Keep the supported SQLite production topology at one server instance per local database file.
   Correctness tests use independent Prisma clients so invariants do not depend on one process-local
   lock; this is not approval for shared-network-filesystem or multi-host SQLite deployment.
7. Make production configuration fail closed, enable privacy-safe structured request lifecycle
   logs, expose dependency-aware health endpoints, and implement bounded graceful shutdown.
8. Replace production `prisma db push` with reviewed migrations, backup/preflight/restore evidence,
   and a path-filtered server CI workflow.

## Security and Consistency Invariants

- One OTP challenge can produce at most one ticket or administrator session.
- A wrong OTP attempt increments the challenge attempt count at most once. No challenge accepts
  more than five attempts, and a successful attempt also counts as one attempt.
- A challenge is valid only for its exact `{purpose, normalizedEmail, state}` scope. Issuing a new
  challenge invalidates older unconsumed challenges in that same scope.
- A desktop login ticket can produce at most one desktop session. Ticket consumption and session
  creation either both commit or both roll back.
- For each `{userId, requestId}`, LLM checkout consumes at most one Credit and returns the existing
  checkout as `reused` on a safe retry.
- With `N` remaining Credits, at most `N` distinct request IDs can succeed, including under
  concurrent independent database clients.
- A database conflict retry never invokes SMTP or an LLM supplier. It retries only the local
  transaction, with the same idempotency inputs.
- Public authentication failures do not distinguish missing, expired, consumed, wrong-purpose,
  wrong-code, or attempt-exhausted challenges. Raw Prisma/SQLite errors are never returned.
- Production logs never contain OTPs, email message bodies, Authorization/Cookie headers, session
  or CSRF tokens, activation-code plaintext, LLM API keys, request bodies, prompts, transcripts,
  generated content, payment payloads, or raw database error text.

## Semantic Store Boundary

The public `Store` port will replace login-critical primitive composition with closed operations.
Exact names may change during implementation, but the semantic boundary must remain equivalent:

```ts
type OtpPurpose = "desktop_login" | "admin_login";

type IssueOtpResult =
  | { status: "issued"; otpId: string }
  | { status: "rate_limited"; retryAt: Date };

type VerifyDesktopOtpResult =
  | { status: "verified"; user: UserRecord; ticket: DesktopLoginTicketRecord }
  | { status: "invalid" };

type VerifyAdminOtpResult =
  | { status: "verified"; session: AdminSessionRecord }
  | { status: "invalid" };

type ExchangeDesktopTicketResult =
  | { status: "exchanged"; user: UserRecord; session: SessionRecord }
  | { status: "invalid" };

type LlmQuotaCheckoutResult =
  | { status: "consumed"; entitlement: EntitlementRecord }
  | { status: "reused"; entitlement: EntitlementRecord }
  | { status: "unavailable" };
```

The operations are purpose-specific rather than a generic transaction callback exposed to routes:

- `issueEmailOtp(...)` atomically applies both dispatch limits, invalidates older challenges in the
  exact scope, and inserts the new challenge;
- `invalidateIssuedOtpAfterDeliveryFailure(...)` conditionally consumes only the newly issued
  challenge after SMTP failure without compensating committed dispatch counters;
- `verifyDesktopOtpAndCreateTicket(...)` records one attempt, conditionally consumes a correct
  desktop challenge, upserts the user, and inserts the hashed ticket in one transaction;
- `verifyAdminOtpAndCreateSession(...)` records one attempt, conditionally consumes a correct admin
  challenge, and inserts the hashed admin/CSRF session in one transaction;
- `exchangeDesktopTicketAndCreateSession(...)` conditionally consumes the ticket and inserts the
  hashed desktop session in one transaction; and
- `consumeLlmQuota(...)` keeps its public purpose but returns a closed outcome and implements one
  conditional quota mutation plus one usage event.

Services continue to generate raw OTP/ticket/session/CSRF values and pass only hashes into Store.
Raw values never enter database fields or Store return values. The service keeps the raw value only
long enough to send or return it through the existing authenticated flow.

The old public combination of `findLatestUsableOtp`, `incrementOtpAttempts`, `consumeOtp`,
`consumeDesktopLoginTicket`, and independent session/ticket creation must no longer be usable by
production authentication services. Narrow helpers may remain private to a Store implementation.

## OTP Dispatch and Verification

### Purpose and replacement

`EmailOtp` gains the closed purpose values `desktop_login` and `admin_login`. Deployment invalidates
all outstanding legacy OTP rows instead of guessing their purpose; users may request a new code
after the deploy. Existing desktop sessions and unexpired login tickets are not invalidated.

Creating a challenge first invalidates older unconsumed rows for the same
`{purpose,email,state}`. Challenges for another state or purpose remain isolated. This prevents an
older code from becoming usable again after a newer code is consumed.

### Dispatch limits

A database-backed `AuthRateLimit` record stores a versioned hashed scope key, purpose, window start,
count, next-allowed time, and update time. The initial fixed policy is:

| Scope | Policy |
|---|---|
| normalized email + purpose | at most one dispatch attempt per 60 seconds and five per anchored hour |
| trusted client IP + purpose | at most twenty dispatch attempts per anchored hour |

Both reservations and challenge creation occur in one transaction. If either scope is exhausted,
neither counter nor challenge changes. A committed SMTP attempt counts against the bounded dispatch
policy even if delivery later fails; the new challenge is invalidated on send failure, but counters
are not decremented through a race-prone compensation. The user receives the existing generic send
failure and may retry after the bounded cooldown.

Rate-limit keys use SHA-256 over a versioned scope/purpose/value tuple so the limiter table does not
duplicate raw email/IP values. `EmailOtp.ip` remains current schema data in this change; removing or
retaining historical network identifiers requires a separate retention/privacy decision.

### Atomic attempt semantics

Verification selects only the newest usable row in the exact purpose scope inside the Store
transaction and retains the existing constant-time comparison of fixed-length code hashes. A
conditional mutation then requires the same row/hash to remain unconsumed, unexpired, below five
attempts, and scope-matching. It increments `attempts` once and sets `consumedAt` only for the
constant-time verified candidate. The artifact insert is part of the same transaction.

Two correct concurrent submissions therefore cannot both consume the same row. A correct and wrong
fifth attempt race follows database commit order: whichever conditional attempt commits first owns
the final attempt. No application code promises a more favorable ordering.

## Desktop Ticket Exchange

The service generates the raw desktop session token before entering Store and passes its hash and
expiry into `exchangeDesktopTicketAndCreateSession`. Store reads the candidate ticket, conditionally
marks it consumed, reads the bound user, and creates the session in one transaction. If the user is
missing or session insertion fails, the transaction rolls back the ticket update.

Concurrent exchanges of one ticket yield exactly one `exchanged` result. All other callers receive
the same public invalid/expired response. The transaction does not extend ticket expiry and does not
create an automatic retry loop at the HTTP layer.

## Atomic AI Credit Checkout

The existing unique `(userId, requestId)` constraint on `LlmUsageEvent` remains the idempotency
anchor. In one transaction, PrismaStore must:

1. return `reused` when the same usage event already exists and the entitlement is still eligible;
2. execute a parameterized conditional update equivalent to:

   ```sql
   UPDATE Entitlement
      SET llmQuotaUsed = llmQuotaUsed + 1,
          updatedAt = ?
    WHERE userId = ?
      AND expiresAt > ?
      AND llmQuotaUsed < llmQuotaLimit
   RETURNING ...;
   ```

3. return `unavailable` when no row is updated; and
4. insert `LlmUsageEvent` before committing the consumed result.

If usage-event insertion fails, the entitlement increment rolls back. If two same-request
transactions race, the unique event conflict rolls back any losing increment; a bounded retry then
observes and returns `reused`. If distinct request IDs race for the last Credit, only one conditional
update can succeed.

The SQL must be parameterized through Prisma's safe raw-query API. String-built SQL and
`$queryRawUnsafe` are forbidden for values. Checkout does not call the supplier and a database retry
does not spend or refund an external Credit.

## Conflict Retry Policy

SQLite WAL and `busy_timeout` remain useful availability settings, not correctness guarantees.
Semantic Store transactions use a small bounded retry helper only for explicitly classified
SQLite busy/locked or Prisma transaction-conflict outcomes. The retry count and backoff are fixed
internal policy with deterministic test injection. Unknown, validation, constraint, or programming
errors fail immediately.

Every retried operation is safe because it carries stable hashes/request IDs and database uniqueness
or conditional-write guards. Exhaustion becomes one stable temporary-unavailable server error and a
sanitized log event; it is not mislabeled as an invalid code or exhausted quota.

## Schema and Migration

The hardening migration introduces:

- `EmailOtp.purpose` with a database check for the two closed values;
- an index supporting latest lookup by email/state/purpose/time;
- `AuthRateLimit` with unique hashed key and nonnegative-count/closed-scope checks;
- checks that OTP attempts remain between zero and five; and
- checks that `llmQuotaLimit >= 0`, `llmQuotaUsed >= 0`, and
  `llmQuotaUsed <= llmQuotaLimit`.

Prisma schema cannot express every SQLite check, so the reviewed SQL migration is authoritative for
those constraints. Production must stop using `prisma db push` as its deployment mechanism.

Because this repository has no migration history, implementation creates:

1. a baseline migration representing the current pre-hardening schema; and
2. a separate forward hardening migration.

Fresh databases apply both through `prisma migrate deploy`. An existing production database first
passes documented schema/data preflight, is backed up, marks only the verified baseline as applied,
then applies the hardening migration. Preflight rejects negative/overused quota data rather than
clamping or silently rewriting billing state. Outstanding OTPs are deliberately invalidated during
the migration. Rollback restores the complete pre-deploy database and matching code; it does not
attempt an ad-hoc reverse migration.

## Trusted Client IP Boundary

The supported production topology remains Nginx on the same host proxying to a server bound to
`127.0.0.1`. Fastify trusts forwarded client addresses only from loopback proxy peers. An untrusted
direct client cannot choose its effective IP by sending `X-Forwarded-For`.

Nginx keeps the canonical `X-Forwarded-For` chain. Tests cover trusted loopback forwarding,
untrusted spoofed headers, IPv4/IPv6 normalization, and the address passed to the database limiter.
Changing to another proxy/load balancer requires an explicit trusted-proxy configuration and test;
`trustProxy: true` is not acceptable.

## Production Configuration and SMTP

Server startup resolves and validates one closed runtime configuration before opening the listener.
In `NODE_ENV=production` it requires, at minimum, an explicit administrator email, LLM encryption
key, database URL, and complete SMTP configuration. Enabled optional integrations must validate all
of their own required credentials.

Missing or incomplete SMTP in production is a startup error. Console OTP delivery is available only
outside production and only with explicit `FRAMEQ_ALLOW_CONSOLE_OTP=1`; it emits a prominent
development warning and must never be enabled by default. A production value of `1` is rejected.
Tests inject a sender and never print real-looking secrets.

Startup validation reports only missing/invalid variable names, never variable values. Secrets
remain environment-owned and are not persisted to logs, health responses, or diagnostics.

## Structured Logging and Redaction

Fastify's structured logger is enabled in production with a generated server request ID. Logs cover
startup/shutdown, request route/method/status/duration bucket, readiness transitions, semantic
operation outcome, and stable internal error code. They do not log request or response bodies.

Authorization, Cookie, Set-Cookie, API-key, SMTP, and payment headers/fields are redacted at the
logger boundary. Authentication logs use purpose plus coarse outcome and may use a short process-
local correlation hash when necessary; they do not emit OTP, ticket/session hashes, raw email, raw
IP, state, or database exception text. LLM checkout logs only `consumed/reused/unavailable`, never
the request ID, supplier config, or returned API key.

Unknown exceptions are mapped to a fixed internal code before logging and to a fixed public
response. Development stack traces remain local opt-in behavior and are not a production response
or structured field.

## Liveness, Readiness, and Shutdown

Two fixed, unauthenticated, non-secret endpoints are registered:

- `GET /health/live` returns 200 while the process/event loop is serving;
- `GET /health/ready` returns 200 only after startup validation, Prisma connection/migration
  compatibility, and a bounded `SELECT 1` succeed and shutdown has not begun; otherwise it returns
  503 with a fixed body.

Readiness does not require the optional LLM provider to be configured or call SMTP/LLM over the
network. Those capabilities retain their existing account/config status. Nginx exposes the two
exact paths and no health response includes versions, paths, configuration, exception text, or
user counts.

The process installs one idempotent `SIGINT`/`SIGTERM` coordinator:

1. mark readiness false;
2. stop accepting new work and drain in-flight requests through `app.close()`;
3. disconnect Prisma; and
4. complete before a fixed deadline shorter than systemd `TimeoutStopSec`.

A second signal does not start another close sequence. On deadline, the process records one safe
shutdown-timeout code and exits nonzero; systemd remains the final process supervisor. Startup
failure closes any resource already opened before exit.

## Backup, Restore, and Deployment

The production runbook must define and test:

- one server instance per local SQLite file and no database file on NFS/SMB/shared storage;
- pre-deploy schema/data preflight and `prisma migrate deploy`;
- a stop-the-service SQLite backup (including `.env`/key material through a separately protected
  secret backup), checksum, restrictive permissions, retention, and off-host copy;
- restore into an isolated rehearsal directory, `PRAGMA integrity_check`, migration-status check,
  readiness probe, and bounded read-only account/entitlement verification;
- full rollback by stopping the service and restoring the matching code/database/config set; and
- post-deploy health, login, ticket exchange, quota idempotency, log-redaction, and graceful-stop
  smoke checks.

Backups, restored databases, checksums tied to private locations, and logs remain outside Git.
Restore evidence records timestamps/outcomes only and contains no emails, tokens, API keys, or
database contents.

## Verification Matrix

Automated tests must include:

- MemoryStore and PrismaStore semantic contract parity;
- two correct concurrent OTP verifications produce one artifact;
- wrong/correct fifth-attempt race never exceeds five and produces at most one artifact;
- desktop and administrator OTP purposes cannot cross;
- replacement OTP invalidates only the exact prior scope;
- overlapping dispatches enforce both email and IP limits;
- two ticket exchanges create one session, and injected session failure preserves the ticket;
- distinct quota request IDs cannot overspend the final Credit;
- identical quota request IDs consume once and return `reused` after conflict/retry;
- injected usage-event failure rolls back the quota increment;
- recognized busy conflicts retry within the fixed bound; unknown failures do not retry;
- production missing SMTP/required config refuses startup and console OTP is production-forbidden;
- trusted proxy and spoofed-header address behavior;
- health transitions through startup, database failure, normal serving, and shutdown;
- logs and public errors remain free of seeded OTP/token/cookie/key/body/database-error fixtures;
- `SIGTERM` drains a real listening child process, closes the port, and releases SQLite; and
- migration rehearsal covers fresh database, existing baseline, invalid preflight, forward deploy,
  integrity check, and restore.

Prisma concurrency tests must use at least two independent `PrismaClient` instances connected to
the same real temporary SQLite file. `Promise.all` against one in-memory Store or one client alone is
not sufficient evidence for the database boundary.

## Alternatives Rejected

- **Keep service-level read/check/write calls:** cannot make cross-entity artifacts atomic and leaves
  every caller responsible for the same race rules.
- **Use a process-local mutex:** does not survive restart or protect another client/process and can
  silently become the real correctness boundary.
- **Assume SQLite serializes all writes:** a transaction containing an earlier read can still make a
  stale business decision; conditional writes and constraints must express the invariant.
- **Add Redis/distributed locks now:** unnecessary for the supported one-instance SQLite topology,
  adds an availability dependency, and still would not replace database constraints/idempotency.
- **Consume ticket then compensate on session failure:** a crash between steps cannot be repaired
  safely; rollback in one transaction is simpler.
- **Clamp invalid historical quota during migration:** could hide an accounting incident. Preflight
  and reviewed manual repair are required.
- **Continue `db push` in production:** it does not provide the reviewed, repeatable forward/restore
  evidence needed for a live database.
- **Allow console OTP whenever SMTP is absent:** one configuration mistake would disclose live
  authentication secrets to logs.
- **Use `trustProxy: true`:** it accepts spoofable forwarding headers outside the documented proxy
  boundary.

## Consequences and Residual Risks

The Store interface becomes more semantic and slightly larger, and the repository gains explicit
migration/operations work. That complexity is justified because the operations cross authentication
or paid-accounting boundaries and need one owner.

SQLite remains appropriate only for the documented small single-instance service. Independent-client
tests prove database invariants under concurrency but do not establish high write throughput,
multi-host failover, or network-filesystem safety. Migrating to PostgreSQL, introducing a queue,
supplier-side exactly-once LLM billing, or providing zero-downtime multi-instance deploys remains out
of scope.

SMTP acceptance proves configuration and controlled sending behavior, not third-party delivery
availability. Backup automation is not accepted until a restore rehearsal succeeds. No plan may
claim this broad-release blocker closed from unit tests alone.
