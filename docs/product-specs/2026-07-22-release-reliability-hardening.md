# Release Reliability Hardening

- Date: 2026-07-22
- Status: Local implementation complete; hosted server/staging and combined release evidence pending
- Scope: authoritative task persistence, supervised worker execution, and server authorization/accounting/operations

## Summary

Before FrameQ is distributed to a broad non-technical audience, three reliability areas must be
closed:

1. an interrupted write must not leave a transcript, AI artifact, or task manifest truncated or in
   a product-visible mixed revision; and
2. a worker process that hangs or stops making observable progress must not keep the desktop task in
   a processing state forever; and
3. concurrent server requests and ordinary production failures must not duplicate authentication
   artifacts, overspend AI Credits, expose OTPs/secrets, or leave operators unable to distinguish a
   ready process from a failed or draining one.

These are release-reliability requirements, not optional refactors. Desktop persistence, worker
watchdog, server authentication/quota concurrency, and the local production-operations code/runbook
are implemented. The remaining active production-operations work is evidence: hosted Linux Server
CI, an approved non-user SMTP/staging smoke, off-host restore practice, and the combined release
gate. Those external results remain separate from the locally verified database boundary.

## User Problem

Ordinary users cannot be expected to diagnose a half-written JSON file, manually kill an orphaned
Python process, or decide whether a task that has shown the same progress for hours is still safe.
Power loss, forced shutdown, full disks, antivirus/file locks, native-library hangs, broken network
calls, and child-process bugs are normal operating conditions at consumer scale.

Without hardening, those conditions can produce one of two bad experiences:

- a previously usable task becomes unreadable, or different files describe different revisions;
- the UI remains busy indefinitely and blocks retry, cancellation, or the next task.

The same standard applies to the small account service. Users cannot diagnose why one OTP produced
multiple artifacts, why a ticket was consumed without a session, or why concurrent checkout spent
more Credits than the balance allowed. Operators also cannot safely run a production service whose
missing SMTP path prints OTPs, whose logs/health state are undefined, or whose database has no
rehearsed forward/restore path.

## Product Requirements

### Authoritative persistence

- Every authoritative text/JSON artifact is installed through a same-directory staging file,
  flush/sync, validation where applicable, and atomic replacement. Production code must not write
  directly to its final authoritative path.
- The protected set includes worker transcript TXT/Markdown/segments, summary/mermaid, insight
  JSON/Markdown, preference snapshot, `frameq-task.json`, and Rust transcript-edit outputs.
- A failed replacement keeps the previous valid file. A failed first write leaves no authoritative
  final file.
- A new task remains product-invisible until its atomically written manifest records only completed
  artifacts.
- A multi-file update to an existing task uses one task-local transaction journal and recovery
  protocol. Product readers must see either the previous committed revision or the new committed
  revision after recovery, never trust an unfinished revision, and never expose staging/journal
  files as artifacts.
- The transaction protocol keeps the current official artifact paths and task manifest schema. It
  does not silently migrate or reinterpret unsupported legacy tasks.
- One-time user transcript backups remain independent recovery artifacts and must not be confused
  with internal transaction rollback files.
- Recovery is automatic on the next supported task open/edit/scan or worker task access. If safe
  recovery cannot be completed, the task fails closed with a stable non-echoing code and leaves
  source media and previous recovery material untouched.

### Worker watchdog

- The Rust `worker_runtime` owns all worker deadlines because it already owns spawn, registration,
  cancellation, process-tree termination, wait/reap, and terminal classification.
- Every semantic `WorkerJob` and ASR model-download operation receives a closed internal timeout
  policy. React, Tauri command callers, request JSON, and Python must not supply arbitrary timeout
  values.
- The watchdog uses a monotonic clock and distinguishes:
  - an idle deadline for operations with validated progress, based only on validated progress
    activity; and
  - an absolute hard deadline that cannot be extended by output or progress.
- The source-identity preflight has no progress protocol and therefore uses only a short absolute
  deadline.
- When a deadline expires, FrameQ terminates and reaps the complete supervised process tree using
  the existing Windows/macOS cancellation primitives, clears only the matching supervisor
  instance, and returns a distinct timeout result.
- A valid structured terminal result observed at the timeout boundary wins. Otherwise the first
  terminal claim between explicit user cancellation and timeout determines the result; stale
  watchdogs must never terminate a newer worker instance.
- A timeout never triggers an automatic LLM retry, never spends another AI Credit, and never
  deletes already committed local artifacts.

### Server authentication and AI Credit correctness

- OTP challenges are purpose-bound to desktop or administrator login. Issuing a replacement
  invalidates the older challenge in the same purpose/email/state scope, and legacy challenges are
  invalidated rather than assigned a guessed purpose during migration.
- OTP dispatch limits are database-backed and atomically enforce bounded email and trusted-client-IP
  policies across overlapping requests and process restarts. An in-memory map or reverse-proxy
  header alone is not a correctness boundary.
- One semantic Store transaction records an OTP attempt, consumes a matching challenge, and creates
  the resulting desktop ticket or administrator session. One challenge creates at most one artifact
  and never exceeds five attempts.
- Desktop ticket consumption and desktop session creation commit or roll back together. A failed
  session write does not silently spend the ticket.
- One AI Credit checkout uses a database conditional entitlement update plus the existing unique
  `(userId, requestId)` usage event in the same transaction. Distinct concurrent requests cannot
  exceed remaining quota; a repeated request ID consumes at most once.
- Only recognized SQLite/Prisma transaction conflicts receive a small bounded local retry. Retry
  does not send SMTP, call an LLM supplier, or spend another external Credit; unknown failures fail
  immediately with a fixed non-echoing response.
- The supported production topology remains one FrameQ server instance per local SQLite file.
  Independent-client database tests are required so invariants do not depend on a process-local
  lock, but this does not approve multi-host or network-filesystem SQLite deployment.

### Server production operations

- Production startup validates one closed runtime configuration before listening. It requires
  explicit required secrets and complete SMTP; absent SMTP must never fall back to printing an OTP.
  Console OTP is explicit non-production-only behavior.
- Structured logs retain request/lifecycle/outcome correlation while excluding request/response
  bodies, OTPs, raw email/IP/state, authorization/cookie/session/CSRF material, activation-code
  plaintext, LLM API keys/config, prompts, transcripts, generated content, payment payloads, and raw
  database exceptions.
- Fastify trusts forwarded client IP only from the documented loopback Nginx proxy. An untrusted
  client cannot choose the rate-limit identity with `X-Forwarded-For`.
- `GET /health/live` reports process liveness; `GET /health/ready` reports startup completion,
  compatible/reachable SQLite, and non-draining state. Both return fixed non-secret bodies and make
  no SMTP or LLM network call.
- `SIGINT`/`SIGTERM` first mark readiness false, then drain Fastify and disconnect Prisma through one
  idempotent bounded shutdown sequence shorter than the systemd stop deadline.
- Production schema changes use a reviewed baseline and forward `prisma migrate deploy` path, not
  `db push`. Preflight, stop-the-service backup, checksum/permissions/off-host retention, isolated
  restore, integrity check, rollback, and post-restore readiness are documented and rehearsed.
- A dedicated path-filtered server CI workflow runs Prisma generation/migrations, complete server
  tests, TypeScript build, and disposable migration/restore contracts without real SMTP/payment/LLM
  calls.

## Initial Timeout Policy

The initial release uses conservative fixed limits. They are internal constants with test-only
injection, not user settings or wire fields.

| Operation | Idle deadline | Absolute deadline |
|---|---:|---:|
| URL/local media processing | 45 minutes without validated progress | 8 hours |
| Summary or inspiration generation | 10 minutes without validated progress | 30 minutes |
| Source-identity preflight | Disabled because the route emits no progress | 3 minutes |
| ASR model download | 10 minutes without validated download progress | 4 hours |

The future local-media worker job inherits the media-processing policy when its runtime variant is
implemented. Changing production values requires a documented reliability decision and focused
tests; it must not require a desktop-worker contract change.

## User-Visible Failure Behavior

- Task processing timeout: the task leaves its busy state and shows localized guidance that the
  worker exceeded its safe execution time and may be retried.
- AI timeout: the task remains `partial_completed`; the local transcript and any previously
  committed AI target remain available. The user chooses whether to retry.
- Model-download timeout: the download leaves its busy state, preserves any non-authoritative
  resumable bytes under the existing model-download policy, and offers retry.
- Persistence/recovery failure: FrameQ must not claim that a save succeeded. The previous committed
  task remains preferred; if recovery is not provably safe, task access fails closed and offers
  localized guidance plus sanitized technical details.
- Stable public codes distinguish idle timeout, absolute timeout, atomic write failure, and
  transaction recovery failure. Raw paths, request bodies, URLs, credentials, transcripts,
  prompts, generated text, and operating-system error prose are never primary UI content.

## Acceptance Criteria

- Failure injection before and after every stage/write/replace/commit-marker step proves that a
  supported task recovers to one complete revision.
- Corrupt, linked, escaping, unknown-version, and path-containing transaction journals fail closed
  without touching external paths.
- Existing valid files survive ENOSPC, permission, sharing-violation, serialization, validation,
  replace, and simulated process-crash failures.
- Watchdog tests use injected short durations and deterministic clocks/signals; the production test
  suite never waits for real minute/hour deadlines.
- Tests cover blocked stdin delivery, silent worker, progress-then-stall, endless valid progress,
  normal completion, malformed output, cancellation/timeout races, stale instance IDs, reader
  cleanup, and descendant-process termination.
- Windows and macOS native-host validation confirms that timed-out parent and child processes are
  gone and a second task can start.
- Existing contracts, task manifest schema, artifact names, cancellation behavior, AI Credits,
  cache behavior, History support predicate, local-media v4 planning, and user content remain
  unchanged except for the new fixed failure outcomes.
- Independent Prisma clients against one real temporary SQLite file prove OTP single-use,
  purpose/attempt limits, atomic ticket exchange, quota capacity/idempotency, and rollback after
  injected artifact/event failures.
- Migration tests cover fresh databases, a verified existing baseline, invalid accounting preflight,
  repeat deploy, integrity, and restore without silently clamping quota data.
- Production configuration/log/proxy/health/lifecycle tests seed secret and raw-error markers, prove
  none leave the approved boundary, and exercise `SIGTERM` against a real listening child process.
- A disposable production-shaped environment records SMTP delivery, health, graceful restart,
  migration, backup, restore, and post-restore readiness without placing an OTP, address, token,
  key, path, or database contents in evidence.

## Release Gate

The authoritative-persistence ExecPlan is implemented, reviewed, and merged at `61d489a`. The
worker-watchdog ExecPlan is implemented and passed complete local gates plus the native Windows
parent/descendant timeout fixture. The portable fixture is registered in the hosted macOS full
Cargo workflow, but no macOS host was available in this session; that runtime evidence remains an
unverified residual risk rather than a pass.

The server hardening boundary is specified by
`docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md` and two ExecPlans:

- `docs/exec-plans/completed/2026-07-22-server-auth-quota-concurrency-hardening-plan.md`; and
- `docs/exec-plans/active/2026-07-22-server-production-operations-hardening-plan.md`.

The authentication/quota plan has accepted local database correctness evidence. The operations
implementation and disposable local migration/restore rehearsal also pass locally, and the hosted
workflow is registered. Broad publication remains blocked until that workflow produces Linux
signal/CI evidence, the required production-shaped SMTP/Nginx/systemd/restore smoke is accepted,
and the combined release gate is rerun.

## Non-Goals

- No background task queue, worker restart/resume after app relaunch, distributed transaction,
  database-engine change, Redis/distributed lock, user-configurable timeout, or automatic LLM
  retry. The server hardening does require reviewed SQLite schema migrations and bounded local
  transaction-conflict retry.
- No translation or rewriting of historical user content.
- No change to permanent task deletion's explicitly accepted non-transactional semantics.
- No implementation of the planned local-media runtime in these reliability plans.
- No multi-host SQLite, network-filesystem database, zero-downtime multi-instance deployment,
  supplier-side exactly-once LLM billing, or claim that SMTP/provider uptime is controlled by
  FrameQ.
