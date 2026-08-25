# Self-Service Email Activation Code Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. FrameQ works directly on `main` per `AGENTS.md`; do not create a feature branch or worktree unless the user changes that rule.

**Goal:** Let an inactive or expired signed-in desktop user request an account-bound activation code by email, manually redeem it for a fresh 31-day entitlement and 20 AI Credits, and repeat that cycle after every expiry without administrator participation.

**Architecture:** Extend the existing `ActivationCode` record with issuance source, bound user, delivery state, and audit metadata. A dedicated `SelfServiceActivationService` coordinates a fail-closed `pending_delivery → SMTP accepted → active` flow around semantic Memory/Prisma Store transactions; the existing redemption transaction branches by issuance source so administrator universal codes retain their current renewal behavior while self-service codes cannot stack active entitlement. Server capability negotiation is additive and optional, then Rust/Tauri and React expose the request action only when the Server reports the account eligible.

**Tech Stack:** Fastify 5, TypeScript 5.9, Prisma 6 + SQLite, Nodemailer, Vitest, Tauri 2 + Rust/reqwest/serde, React 19, i18next, Vitest, existing FrameQ Store transaction and operation-ownership patterns.

**Approval status:** Approved and implemented. This archived ExecPlan records the completed rollout evidence.

---

## Purpose / Big Picture

Today every visible desktop activation depends on an administrator creating a universal code and handing it to the user. After this plan, an authenticated user with no current entitlement or an expired entitlement sees a “send activation code to email” button in the existing Account & Authorization sheet. The Server sends a code to the account email; the user copies it into the existing field and redeems it manually. A successful redemption starts a new 31-day window with 20 AI Credits. When that window expires, the same user can request and redeem another code with no lifetime cap.

The button is absent for logged-out users, active entitlements, older Servers that do not advertise the capability, and deployments where the kill switch is off. Direct API calls enforce the same eligibility on the Server, so stale UI or a modified client cannot request or stack free entitlement. Administrator universal codes remain available and retain their current “extend from the later of now/current expiry” behavior.

Only account, activation-code, entitlement, quota, rate-limit, locale, and email-delivery metadata cross the Server boundary. Video, audio, transcripts, insights, task history, local model cache, local paths, and user content remain on the device. Activation-code plaintext exists only in one Server request's memory and the outgoing email; it is not returned by the request API, persisted in SQLite, emitted to logs, or stored by the desktop app.

## Progress

- [x] 2026-08-24: Product behavior, account binding, unlimited post-expiry renewal, no-stacking rule, and the “extend existing ActivationCode” approach were approved. Validation: `0b0b5fd4` and `15fa80a2` contain the design/spec baseline.
- [x] 2026-08-24: Mapped the current Store, Prisma migration, SMTP, Fastify route, Rust account IPC, React account controller, AccountSheet, and i18n seams. Validation: read-only inspection of the exact files listed under Context and Orientation.
- [x] 2026-08-24: Created this active ExecPlan, registered it in the active index, and completed its spec/type/sequence self-review. Validation: 13 ordered tasks, 9 required living-document sections, and 21 product/design coverage checks passed; `python scripts/validate_agents_docs.py --level ERROR` and `--level WARN` both reported 0 errors and 0 warnings.
- [x] 2026-08-25: Synchronized rollout documentation for README, deployment runbook, architecture, security, design/spec status, and task ledger to match the implemented self-service activation behavior. Validation: `python scripts/validate_agents_docs.py --level ERROR`, `python scripts/validate_agents_docs.py --level WARN`, and `git diff --check`.
- [x] 2026-08-25: Archived this ExecPlan to `completed/` and removed it from the active index after implementation landed on `main`. Validation: plan file move plus `docs/exec-plans/active/index.md`, `docs/exec-plans/completed/index.md`, and `docs/exec-plans/index.md` updated together.

## Surprises & Discoveries

- The desktop locale contract is `"zh-CN" | "zh-TW" | "en-US"`, not the Server-page locale contract's shorter `en` form. Evidence: `app/src/i18n/locale.ts` exports `SUPPORTED_LOCALES = ["zh-CN", "zh-TW", "en-US"]`. The approved design document was corrected to `en-US` while writing this plan.
- `AccountSheet` already renders the activation input for every authenticated account that cannot process, while the footer has one primary redemption action. Evidence: `app/src/features/account/AccountSheet.tsx` conditions the panel on `account.authenticated && !canProcessWithAccount(account)`. The new request button can be added inside that panel without removing the administrator-code-compatible input.
- Email/IP dispatch limits already have the exact desired policy, but the reservation builder is private and typed only to `OtpPurpose` in both Memory and Prisma paths. Evidence: `server/src/store/memory/auth.ts` and `server/src/prismaStore/concurrency.ts` each build the 60-second, five-per-hour, and twenty-per-IP-hour reservations. A focused shared policy extraction is required before self-service issuance can reuse the same semantics without broadening `EmailOtp.purpose`.
- The React account client rejects unknown IPC keys by default. Evidence: `app/src/tauriIpcProtocol.ts` allows only named required/optional keys. `can_request_activation_code` must be registered as optional and default false to preserve new-client/old-runtime compatibility.
- The Server's development console path intentionally prints login OTPs. Authorization codes have a larger blast radius and must never use that console fallback. Evidence: `server/src/email.ts` implements the explicit non-production OTP output. The activation sender will require SMTP or an injected test sender.
- The repository workflow requires direct commits on `main` and has another unrelated active diagnostic plan. Evidence: `AGENTS.md` and `docs/exec-plans/active/index.md`. This plan updates only the shared active index entry and does not modify the diagnostic plan.

## Decision Log

- Decision: Extend `ActivationCode` with `issuanceSource`, `issuedToUserId`, `sentAt`, `disabledReason`, and `pending_delivery` rather than create a second grant table. Rationale: reuse one hash-only code format, one admin listing, and one atomic entitlement write boundary. Date/Author: 2026-08-24, User + Codex.
- Decision: A self-service code is redeemable only by the requesting user and only while that user has no active entitlement. Rationale: prevent email forwarding theft, early renewal, stacked time, and stacked Credits. Date/Author: 2026-08-24, User + Codex.
- Decision: Permit a new self-service cycle after every expiry with no lifetime count limit. Rationale: this is the explicitly approved free-renewal product model. Date/Author: 2026-08-24, User.
- Decision: Keep administrator universal-code semantics unchanged. Rationale: support/operations still need the existing universal one-time code and active-entitlement extension behavior. Date/Author: 2026-08-24, User + Codex.
- Decision: Prepare a non-redeemable code, send it, then atomically activate it and supersede the previous active self-service code. Rationale: an SMTP or process failure must not leave an unconfirmed redeemable code; a failed replacement should not invalidate the user's previous usable email. Date/Author: 2026-08-24, User + Codex.
- Decision: Reuse the persistent email/IP rate-limit table via a shared `EmailDispatchPurpose` policy, while `EmailOtp.purpose` remains limited to desktop/admin login. Rationale: preserve proven abuse and concurrency controls without pretending an activation code is an OTP challenge. Date/Author: 2026-08-24, Codex.
- Decision: Advertise `can_request_activation_code` as an additive optional capability and ship Server before desktop. Rationale: old clients ignore the new Server field and new clients default false when paired with an old runtime/Server. Date/Author: 2026-08-24, Codex.
- Decision: Add `FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED` as an explicit production flag and never print activation codes through development console delivery. Rationale: enable staged rollout/emergency shutoff and keep authorization plaintext out of logs. Date/Author: 2026-08-24, User + Codex.
- Decision: Execute on `main` with small conventional commits. Rationale: repository-specific `AGENTS.md` overrides the generic worktree recommendation. Date/Author: 2026-08-24, Codex.

## Outcomes & Retrospective

The completed rollout adds a desktop-visible self-service activation-email path for inactive or
expired signed-in accounts while preserving the administrator-issued universal-code path. The Server
now advertises `can_request_activation_code`, accepts auth-first locale-only activation-email
requests, activates self-service codes only after SMTP acceptance, and redeems them only for the
bound account when entitlement is inactive. Each successful self-service redemption starts a fresh
31-day window with `llmQuotaLimit=20` and `llmQuotaUsed=0`, and the same account can repeat after
expiry without a lifetime cap.

This documentation-closeout task intentionally ran only documentation gates, not full code/test
gates, because implementation and broader verification were already completed before Task 13.
Results recorded here: `python scripts/validate_agents_docs.py --level ERROR` passed, `python
scripts/validate_agents_docs.py --level WARN` passed, and `git diff --check` passed. Residual risk:
SMTP acceptance still does not prove inbox delivery, and the fail-closed two-transaction model can
leave a delivered-but-unusable email if a crash happens after SMTP acceptance but before activation;
the supported recovery remains requesting a new code after the persisted cooldown.

## Context and Orientation

### Product and design

- `docs/product-specs/2026-08-24-self-service-email-activation-code.md` — user-visible source of truth.
- `docs/design-docs/2026-08-24-self-service-email-activation-code.md` — approved architecture, state machine, security, failure, and rollout decisions.
- `docs/product-specs/2026-06-21-activation-code-authorization.md` — administrator universal-code baseline that must remain compatible.
- `docs/product-specs/2026-06-22-server-managed-llm-quota.md` — 31-day / 20-Credit entitlement semantics.
- `docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md` — persistent rate-limit and transaction invariants.

### Server contracts and persistence

- `server/prisma/schema.prisma` — User, ActivationCode, Entitlement, AuthRateLimit relations.
- `server/prisma/migrations/202608240001_self_service_email_activation/migration.sql` — new additive-compatible migration.
- `server/src/store/contracts.ts` — record types, dispatch purpose, closed Store outcomes.
- `server/src/store/rateLimitPolicy.ts` — new backend-neutral email dispatch reservation policy.
- `server/src/store/memory/rateLimits.ts` — new MemoryState reservation application.
- `server/src/prismaStore/rateLimits.ts` — new Prisma transaction reservation application.
- `server/src/store/memory/selfServiceActivation.ts` — new Memory prepare/disable/activate operations.
- `server/src/prismaStore/selfServiceActivation.ts` — new Prisma prepare/disable/activate operations.
- `server/src/store/memory/entitlements.ts` and `server/src/prismaStore/entitlements.ts` — source-aware redemption transaction.
- `server/src/store/memory.ts` and `server/src/prismaStore.ts` — Store façade delegation.

### Server services, email, routes, operations

- `server/src/activationPolicy.ts` — new shared code format, days, quota, and redeem-window policy.
- `server/src/activation.ts` — administrator code generation and unified redemption mapping.
- `server/src/selfServiceActivation.ts` — new SMTP orchestration service.
- `server/src/email.ts` — login OTP sender plus three-locale activation email sender/template.
- `server/src/routes/desktopAccount.ts` — capability field, request route, redemption status mapping.
- `server/src/server.ts` and `server/src/index.ts` — dependency wiring.
- `server/src/runtimeConfig.ts` and `server/.env.example` — kill-switch configuration.
- `server/src/adminPage.ts`, `server/src/i18n.ts`, and `server/src/routes/admin.ts` — operational display of source/bound account/status without plaintext.

### Desktop Rust and React

- `app/src-tauri/src/account.rs` — account status decoding, request command, structured expected errors.
- `app/src-tauri/src/lib.rs` — command registration and URL helper tests.
- `app/src/accountState.ts` — capability in safe account state.
- `app/src/accountClient.ts` — strict optional capability parsing and request-command contract.
- `app/src/features/account/useAccountController.ts` — request ownership, cooldown, notices.
- `app/src/features/account/AccountSheet.tsx` — button visibility and accessible states.
- `app/src/App.tsx` and `app/src/App.css` — prop wiring and activation-panel layout.
- `app/src/i18n/accountResources.ts` — Simplified Chinese, Traditional Chinese, and US English copy.

### Focused tests

- Server: `server/tests/activation.test.ts`, `selfServiceActivation.test.ts`, `rateLimitPolicy.test.ts`, `routes.test.ts`, `email.test.ts`, `runtimeConfig.test.ts`, `admin.test.ts`, `prismaSelfServiceActivation.test.ts`, `prismaMigration.test.ts`, `storeCompatibility.test.ts`, `storeModuleBoundaries.test.ts`.
- Rust: unit tests inside `app/src-tauri/src/account.rs` and `app/src-tauri/src/lib.rs`.
- React: `app/src/accountClient.test.ts`, `accountState.test.ts`, `features/account/useAccountController.test.ts`, `features/account/AccountSheet.test.tsx`, `accountCopy.test.ts`.

## File Structure

| Unit | Responsibility | Dependencies |
| --- | --- | --- |
| `activationPolicy.ts` | One source for secure code generation, 31-day entitlement, 30-day redemption, 20 Credits | node:crypto only |
| `store/rateLimitPolicy.ts` | Pure reservation descriptions for email + IP scopes | security key hashing, Store types |
| Memory/Prisma `rateLimits.ts` | Apply one reservation set atomically in each backend | backend state/transaction |
| Memory/Prisma `selfServiceActivation.ts` | Prepare, disable, and activate self-service code records | Store contract, rate-limit adapter |
| `selfServiceActivation.ts` | Hold plaintext in memory, send email, map closed Store results | Store port, activation policy, sender |
| `email.ts` activation sender | Build localized safe email and call SMTP; no console fallback | Nodemailer, runtime SMTP config |
| `routes/desktopAccount.ts` | Authenticate, validate locale, map service outcomes/headers | Fastify, Zod, services |
| Rust `account.rs` | Session-authenticated HTTP call and structured IPC boundary | reqwest, serde |
| TS `accountClient.ts` | Strict IPC decoding and typed expected failures | Tauri invoke, IPC protocol |
| React account feature | Button/cooldown/notices without stale-operation overwrite | account client/state/i18n |

## Plan of Work

### Task 1: Add activation-code schema and Store contracts

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/202608240001_self_service_email_activation/migration.sql`
- Modify: `server/src/store/contracts.ts`
- Modify: `server/tests/prismaMigration.test.ts`
- Modify: `server/tests/storeCompatibility.test.ts`

- [ ] **Step 1: Write failing contract and migration tests**

Add assertions that an existing administrator row survives migration with `issuanceSource="admin"`, nullable delivery fields, and unchanged redeemability. Add compile/runtime fixtures with these exact shapes:

```ts
const adminCode: ActivationCodeRecord = {
  id: "admin-code",
  codeHash: "hash",
  codePrefix: "FQ-ABCD",
  issuanceSource: "admin",
  issuedToUserId: null,
  status: "active",
  entitlementDays: 31,
  redeemBy: new Date("2026-09-23T00:00:00.000Z"),
  sentAt: null,
  disabledReason: null,
  createdAt: new Date("2026-08-24T00:00:00.000Z"),
  redeemedAt: null,
  redeemedByUserId: null,
};
expect(adminCode.issuanceSource).toBe("admin");
```

- [ ] **Step 2: Run the focused tests and record RED**

Run: `npm --prefix server test -- prismaMigration.test.ts storeCompatibility.test.ts`

Expected: FAIL because the new fields, migration, and source/status unions do not exist.

- [ ] **Step 3: Add exact contract types and closed outcomes**

Implement the following public types in `store/contracts.ts`:

```ts
export type EmailDispatchPurpose =
  | "desktop_login"
  | "admin_login"
  | "self_service_activation";
export type OtpPurpose = Exclude<EmailDispatchPurpose, "self_service_activation">;
export type ActivationCodeIssuanceSource = "admin" | "self_service_email";
export type ActivationCodeStatus =
  | "pending_delivery"
  | "active"
  | "redeemed"
  | "expired"
  | "disabled";
export type ActivationCodeDisabledReason =
  | "delivery_failed"
  | "superseded"
  | "activation_became_active";

export type ActivationCodeRecord = {
  id: string;
  codeHash: string;
  codePrefix: string;
  issuanceSource: ActivationCodeIssuanceSource;
  issuedToUserId: string | null;
  status: ActivationCodeStatus;
  entitlementDays: number;
  redeemBy: Date;
  sentAt: Date | null;
  disabledReason: ActivationCodeDisabledReason | null;
  createdAt: Date;
  redeemedAt: Date | null;
  redeemedByUserId: string | null;
};

export type PrepareSelfServiceActivationResult =
  | { status: "prepared"; code: ActivationCodeRecord; email: string; retryAt: Date }
  | { status: "session_invalid" }
  | { status: "entitlement_active" }
  | { status: "rate_limited"; retryAt: Date }
  | { status: "temporarily_unavailable" };

export type ActivatePreparedSelfServiceActivationResult =
  | { status: "activated"; code: ActivationCodeRecord }
  | { status: "entitlement_active" }
  | { status: "invalid" }
  | { status: "temporarily_unavailable" };
```

Extend `ActivationRedemption` with `{ status: "entitlement_active" }` and add these Store methods:

```ts
prepareSelfServiceActivationCode(input: {
  sessionTokenHash: string;
  codeHash: string;
  codePrefix: string;
  ip: string;
  now: Date;
  redeemBy: Date;
  entitlementDays: number;
}): Promise<PrepareSelfServiceActivationResult>;
disablePreparedSelfServiceActivationCode(input: {
  activationCodeId: string;
  now: Date;
  reason: "delivery_failed";
}): Promise<void>;
activatePreparedSelfServiceActivationCode(input: {
  activationCodeId: string;
  now: Date;
}): Promise<ActivatePreparedSelfServiceActivationResult>;
```

- [ ] **Step 4: Update Prisma schema and migration**

Use named relations because `User` now has both issued and redeemed code relations:

```prisma
model User {
  id                              String                       @id
  email                           String                       @unique
  createdAt                       DateTime
  updatedAt                       DateTime
  sessions                        Session[]
  orders                          Order[]
  entitlements                    Entitlement[]
  issuedActivationCodes           ActivationCode[]             @relation("ActivationCodeIssuedToUser")
  redeemedCodes                   ActivationCode[]             @relation("ActivationCodeRedeemedByUser")
  adminEntitlementAdjustments     AdminEntitlementAdjustment[]
  userSessions                    UserSession[]
}

model ActivationCode {
  id               String    @id
  codeHash         String    @unique
  codePrefix       String
  issuanceSource   String    @default("admin")
  issuedToUserId   String?
  status           String
  entitlementDays  Int
  redeemBy         DateTime
  sentAt           DateTime?
  disabledReason   String?
  createdAt        DateTime
  redeemedAt       DateTime?
  redeemedByUserId String?
  issuedToUser     User?     @relation("ActivationCodeIssuedToUser", fields: [issuedToUserId], references: [id])
  redeemedByUser   User?     @relation("ActivationCodeRedeemedByUser", fields: [redeemedByUserId], references: [id])

  @@index([status])
  @@index([redeemedByUserId])
  @@index([issuedToUserId, issuanceSource, status])
}
```

The migration must preserve every existing row and backfill `issuanceSource` to `admin`. Generate and inspect the SQL; it must not drop `codeHash` uniqueness or either existing index.

- [ ] **Step 5: Generate the Prisma client and verify GREEN**

Run:

```powershell
npm --prefix server run prisma:generate
npm --prefix server test -- prismaMigration.test.ts storeCompatibility.test.ts
npm --prefix server run build
```

Expected: Prisma generation succeeds; focused tests and TypeScript build pass.

- [ ] **Step 6: Commit the schema contract**

```powershell
git add server/prisma server/src/store/contracts.ts server/tests/prismaMigration.test.ts server/tests/storeCompatibility.test.ts
git commit -m "feat(server): add self-service activation schema"
```

### Task 2: Extract one shared email-dispatch rate-limit policy

**Files:**
- Create: `server/src/store/rateLimitPolicy.ts`
- Create: `server/src/store/memory/rateLimits.ts`
- Create: `server/src/prismaStore/rateLimits.ts`
- Modify: `server/src/security.ts`
- Modify: `server/src/store/memory/auth.ts`
- Modify: `server/src/prismaStore/auth.ts`
- Modify: `server/src/prismaStore/concurrency.ts`
- Create: `server/tests/rateLimitPolicy.test.ts`
- Modify: `server/tests/authQuotaConcurrency.test.ts`
- Modify: `server/tests/prismaAuthQuotaConcurrency.test.ts`
- Modify: `server/tests/storeModuleBoundaries.test.ts`

- [ ] **Step 1: Write failing policy-parity tests**

Test the closed purpose and exact reservations:

```ts
expect(emailDispatchRateLimitReservations({
  purpose: "self_service_activation",
  email: "user@example.com",
  ip: "203.0.113.10",
  now,
})).toMatchObject([
  { scope: "email_minute", maxCount: 1 },
  { scope: "email_hour", maxCount: 5 },
  { scope: "ip_hour", maxCount: 20 },
]);
```

Keep the existing OTP concurrency assertions unchanged so extraction cannot weaken login.

- [ ] **Step 2: Run RED**

Run: `npm --prefix server test -- rateLimitPolicy.test.ts authQuotaConcurrency.test.ts prismaAuthQuotaConcurrency.test.ts`

Expected: FAIL because the shared policy and activation purpose do not exist.

- [ ] **Step 3: Implement the backend-neutral policy**

Create `store/rateLimitPolicy.ts` with the only reservation builder:

```ts
export type EmailDispatchRateLimitInput = {
  purpose: EmailDispatchPurpose;
  email: string;
  ip: string;
  now: Date;
};

export type EmailDispatchRateLimitReservation = {
  keyHash: string;
  purpose: EmailDispatchPurpose;
  scope: AuthRateLimitScope;
  windowStartedAt: Date;
  nextAllowedAt: Date;
  maxCount: number;
};

export function emailDispatchRateLimitReservations(
  input: EmailDispatchRateLimitInput,
): EmailDispatchRateLimitReservation[] {
  const hourStart = new Date(
    Math.floor(input.now.getTime() / 3_600_000) * 3_600_000,
  );
  const hourEnd = new Date(hourStart.getTime() + 3_600_000);
  const make = (
    scope: AuthRateLimitScope,
    value: string,
    windowStartedAt: Date,
    nextAllowedAt: Date,
    maxCount: number,
  ) => ({
    keyHash: authRateLimitKey(scope, input.purpose, value),
    purpose: input.purpose,
    scope,
    windowStartedAt,
    nextAllowedAt,
    maxCount,
  });
  return [
    make("email_minute", input.email, input.now, new Date(input.now.getTime() + 60_000), 1),
    make("email_hour", input.email, hourStart, hourEnd, 5),
    make("ip_hour", input.ip, hourStart, hourEnd, 20),
  ];
}
```

Update `authRateLimitKey` and `AuthRateLimitRecord.purpose` to accept `EmailDispatchPurpose`, while `EmailOtpRecord.purpose` remains `OtpPurpose`.

- [ ] **Step 4: Move backend application code without changing behavior**

`memory/rateLimits.ts` exports `reserveMemoryEmailDispatchRateLimits(state, input)` and returns:

```ts
type ReserveEmailDispatchRateLimitsResult =
  | { status: "reserved"; retryAt: Date }
  | { status: "rate_limited"; retryAt: Date };
```

`prismaStore/rateLimits.ts` exports `reservePrismaEmailDispatchRateLimits(tx, input)`, using the existing conditional upsert and `RateLimitExceededError`. Modify both OTP issuance paths to call these helpers from inside their existing atomic transaction. Do not invoke SMTP inside either helper or a conflict retry.

- [ ] **Step 5: Run GREEN and module-boundary coverage**

Run:

```powershell
npm --prefix server test -- rateLimitPolicy.test.ts authQuotaConcurrency.test.ts prismaAuthQuotaConcurrency.test.ts storeModuleBoundaries.test.ts
npm --prefix server run build
```

Expected: focused tests pass; existing OTP policies/concurrency remain unchanged.

- [ ] **Step 6: Commit the refactor**

```powershell
git add server/src/security.ts server/src/store server/src/prismaStore server/tests
git commit -m "refactor(server): share email dispatch rate limits"
```

### Task 3: Implement MemoryStore self-service issuance and source-aware redemption

**Files:**
- Create: `server/src/store/memory/selfServiceActivation.ts`
- Modify: `server/src/store/memory/entitlements.ts`
- Modify: `server/src/store/memory.ts`
- Create: `server/tests/selfServiceActivationStore.test.ts`
- Modify: `server/tests/activation.test.ts`
- Modify: `server/tests/transactionSafety.test.ts`

- [ ] **Step 1: Write failing MemoryStore state-machine tests**

Cover prepare, SMTP-failure disable, enable, supersede, active-entitlement rejection, account binding, quota reset, and repeat after expiry. The binding assertion must look like:

```ts
const prepared = await store.prepareSelfServiceActivationCode({
  sessionTokenHash: requesterSession.tokenHash,
  codeHash: sha256("FQ-SELF-AAAA-BBBB-CCCC"),
  codePrefix: "FQ-SELF",
  ip: "203.0.113.71",
  now,
  redeemBy,
  entitlementDays: 31,
});
expect(prepared).toMatchObject({
  status: "prepared",
  code: {
    issuanceSource: "self_service_email",
    issuedToUserId: requester.id,
    status: "pending_delivery",
  },
});
```

Assert a different user's session returns `code_invalid` and leaves the code unchanged.

- [ ] **Step 2: Run RED**

Run: `npm --prefix server test -- selfServiceActivationStore.test.ts activation.test.ts transactionSafety.test.ts`

Expected: FAIL because MemoryStore lacks the semantic operations and redemption source branch.

- [ ] **Step 3: Implement prepare/disable/activate under MemoryAtomicCoordinator**

The new module must:

```ts
export async function prepareSelfServiceActivationCode(
  context: MemorySelfServiceActivationContext,
  input: Parameters<Store["prepareSelfServiceActivationCode"]>[0],
): ReturnType<Store["prepareSelfServiceActivationCode"]> {
  return context.atomic.run(async () => {
    const session = await context.findSessionByTokenHash(
      input.sessionTokenHash,
      input.now,
    );
    if (!session) return { status: "session_invalid" };
    const entitlement = await context.getEntitlement(session.userId);
    if (entitlement && entitlement.expiresAt > input.now) {
      return { status: "entitlement_active" };
    }
    const user = await context.getUserById(session.userId);
    if (!user) return { status: "session_invalid" };
    const reserved = reserveMemoryEmailDispatchRateLimits(context.state, {
      purpose: "self_service_activation",
      email: user.email,
      ip: input.ip,
      now: input.now,
    });
    if (reserved.status === "rate_limited") return reserved;
    for (const existingCode of context.state.activationCodes) {
      if (
        existingCode.issuanceSource === "self_service_email" &&
        existingCode.issuedToUserId === session.userId &&
        existingCode.status === "pending_delivery"
      ) {
        existingCode.status = "disabled";
        existingCode.disabledReason = "superseded";
      }
    }
    const code: ActivationCodeRecord = {
      id: randomUUID(),
      codeHash: input.codeHash,
      codePrefix: input.codePrefix,
      issuanceSource: "self_service_email",
      issuedToUserId: session.userId,
      status: "pending_delivery",
      entitlementDays: input.entitlementDays,
      redeemBy: input.redeemBy,
      sentAt: null,
      disabledReason: null,
      createdAt: input.now,
      redeemedAt: null,
      redeemedByUserId: null,
    };
    context.state.activationCodes.push(code);
    return { status: "prepared", code, email: user.email, retryAt: reserved.retryAt };
  });
}
```

`disablePrepared...` conditionally changes only the matching pending row. `activatePrepared...` rechecks entitlement, disables other active self-service codes for that user, and activates only the matching pending row.

- [ ] **Step 4: Branch redemption by issuance source in one atomic block**

For `self_service_email` require:

```ts
if (
  code.issuanceSource === "self_service_email" &&
  code.issuedToUserId !== session.userId
) {
  return { status: "code_invalid" };
}
const existing = await context.getEntitlement(session.userId);
if (
  code.issuanceSource === "self_service_email" &&
  existing &&
  existing.expiresAt > input.now
) {
  return { status: "entitlement_active" };
}
const redeemed = await context.markActivationCodeRedeemed(
  input.codeHash,
  session.userId,
  input.now,
);
if (!redeemed) return { status: "code_invalid" };
if (redeemed.issuanceSource === "self_service_email") {
  const entitlement = await context.upsertEntitlement(
    session.userId,
    new Date(input.now.getTime() + redeemed.entitlementDays * 86_400_000),
    input.now,
    { llmQuotaLimit: input.llmQuotaPerActivation, llmQuotaUsed: 0 },
  );
  return { status: "redeemed", entitlement };
}
const active = Boolean(existing && existing.expiresAt > input.now);
const base = active && existing ? existing.expiresAt : input.now;
const quota = active && existing
  ? {
      llmQuotaLimit: existing.llmQuotaLimit + input.llmQuotaPerActivation,
      llmQuotaUsed: existing.llmQuotaUsed,
    }
  : { llmQuotaLimit: input.llmQuotaPerActivation, llmQuotaUsed: 0 };
const entitlement = await context.upsertEntitlement(
  session.userId,
  new Date(base.getTime() + redeemed.entitlementDays * 86_400_000),
  input.now,
  quota,
);
return { status: "redeemed", entitlement };
```

The `admin` tail above keeps the existing `max(now, existing.expiresAt)` and quota stacking/reset behavior byte-for-byte. The rollback test must prove code consumption and entitlement mutation restore together.

- [ ] **Step 5: Run GREEN**

Run:

```powershell
npm --prefix server test -- selfServiceActivationStore.test.ts activation.test.ts transactionSafety.test.ts authQuotaConcurrency.test.ts
npm --prefix server run build
```

Expected: Memory state machine and all existing administrator activation tests pass.

- [ ] **Step 6: Commit MemoryStore behavior**

```powershell
git add server/src/store server/tests/selfServiceActivationStore.test.ts server/tests/activation.test.ts server/tests/transactionSafety.test.ts
git commit -m "feat(server): add memory self-service activation"
```

### Task 4: Implement PrismaStore self-service transactions and concurrency

**Files:**
- Create: `server/src/prismaStore/selfServiceActivation.ts`
- Modify: `server/src/prismaStore/entitlements.ts`
- Modify: `server/src/prismaStore.ts`
- Create: `server/tests/prismaSelfServiceActivation.test.ts`
- Modify: `server/tests/prismaTransactionSafety.test.ts`
- Modify: `server/tests/prismaAuthQuotaConcurrency.test.ts`

- [ ] **Step 1: Write failing independent-client tests**

Using `createTemporaryPrismaClient()`, assert two stores on independent clients produce:

```ts
const results = await Promise.all([
  firstStore.prepareSelfServiceActivationCode(input),
  secondStore.prepareSelfServiceActivationCode({
    ...input,
    codeHash: "second-code-hash",
  }),
]);
expect(results.filter((result) => result.status === "prepared")).toHaveLength(1);
expect(results.filter((result) => result.status === "rate_limited")).toHaveLength(1);
expect(await fixture.prisma.activationCode.count({
  where: { issuanceSource: "self_service_email" },
})).toBe(1);
```

Add a concurrent same-code redemption test that produces one `redeemed` result and one `code_invalid` result with one entitlement window.

- [ ] **Step 2: Run RED**

Run: `npm --prefix server test -- prismaSelfServiceActivation.test.ts prismaTransactionSafety.test.ts prismaAuthQuotaConcurrency.test.ts`

Expected: FAIL because PrismaStore lacks the operations and source-aware transaction.

- [ ] **Step 3: Implement prepare with bounded conflict retry**

`prepareSelfServiceActivationCode` must call `withConflictRetry` around one Prisma transaction. Inside that transaction: validate session/user/entitlement; reserve all three limits with `reservePrismaEmailDispatchRateLimits`; disable stale pending rows; create one pending code. Return `temporarily_unavailable` only when recognized conflicts exhaust three attempts. SMTP is outside this function and therefore outside retry.

- [ ] **Step 4: Implement conditional disable/activate**

`activatePreparedSelfServiceActivationCode` performs one transaction:

```ts
const pending = await tx.activationCode.findFirst({
  where: {
    id: input.activationCodeId,
    issuanceSource: "self_service_email",
    status: "pending_delivery",
  },
});
if (!pending || !pending.issuedToUserId) return { status: "invalid" };
const entitlement = await tx.entitlement.findUnique({
  where: { userId: pending.issuedToUserId },
});
if (entitlement && entitlement.expiresAt > input.now) {
  await tx.activationCode.update({
    where: { id: pending.id },
    data: { status: "disabled", disabledReason: "activation_became_active" },
  });
  return { status: "entitlement_active" };
}
```

Then disable other active self-service rows for that user and conditionally change this row to `active` with `sentAt=input.now`. A zero-row conditional update returns `invalid`.

- [ ] **Step 5: Implement source-aware Prisma redemption**

Keep session lookup, code validity, conditional code consumption, and entitlement upsert inside the existing transaction. Add `issuedToUserId` to the self-service conditional update and require the existing entitlement to be expired. Preserve the administrator branch exactly. Wrap recognized transaction conflicts consistently with other entitlement operations.

- [ ] **Step 6: Run GREEN and migration-backed tests**

Run:

```powershell
npm --prefix server test -- prismaSelfServiceActivation.test.ts prismaTransactionSafety.test.ts prismaAuthQuotaConcurrency.test.ts prismaMigration.test.ts
npm --prefix server run build
```

Expected: independent-client issuance/redemption, rollback, migration, and build pass.

- [ ] **Step 7: Commit Prisma behavior**

```powershell
git add server/src/prismaStore.ts server/src/prismaStore server/tests/prismaSelfServiceActivation.test.ts server/tests/prismaTransactionSafety.test.ts server/tests/prismaAuthQuotaConcurrency.test.ts
git commit -m "feat(server): add prisma self-service activation"
```

### Task 5: Extract activation policy and add SelfServiceActivationService

**Files:**
- Create: `server/src/activationPolicy.ts`
- Create: `server/src/selfServiceActivation.ts`
- Modify: `server/src/activation.ts`
- Create: `server/tests/selfServiceActivation.test.ts`
- Modify: `server/tests/activation.test.ts`

- [ ] **Step 1: Write failing service orchestration tests**

Inject a fake Store and sender to assert call order:

```ts
expect(events).toEqual([
  "prepare:pending_delivery",
  "send:user@example.com",
  "activate",
]);
expect(result).toEqual({
  status: "sent",
  retryAt: new Date("2026-08-24T00:01:00.000Z"),
  redeemBy: new Date("2026-09-23T00:00:00.000Z"),
});
expect(JSON.stringify(result)).not.toContain("FQ-");
```

Add sender-failure, activation-after-send failure, entitlement-active, rate-limit, and session-invalid cases.

- [ ] **Step 2: Run RED**

Run: `npm --prefix server test -- selfServiceActivation.test.ts activation.test.ts`

Expected: FAIL because the policy and service do not exist.

- [ ] **Step 3: Create one activation policy**

`activationPolicy.ts` exports:

```ts
export const activationCodeDays = 31;
export const activationCodeRedeemWindowDays = 30;
export const llmQuotaPerActivation = 20;
export function generateActivationCode(): string;
export function normalizeActivationCode(code: string): string;
```

Move the existing cryptographically secure alphabet/format implementation without changing output format. Update `ActivationCodeService.generateCode` to persist `issuanceSource:"admin"` and null delivery/binding fields.

- [ ] **Step 4: Implement the service with typed domain errors**

```ts
export type ActivationEmailLocale = "zh-CN" | "zh-TW" | "en-US";
export type SendActivationCode = (input: {
  email: string;
  code: string;
  locale: ActivationEmailLocale;
  redeemBy: Date;
  entitlementDays: number;
  llmCredits: number;
}) => Promise<void>;

export class SelfServiceActivationError extends Error {
  constructor(
    readonly code:
      | "AUTH_REQUIRED"
      | "ENTITLEMENT_ACTIVE"
      | "ACTIVATION_REQUEST_RATE_LIMITED"
      | "ACTIVATION_EMAIL_UNAVAILABLE"
      | "SERVER_TEMPORARILY_UNAVAILABLE",
    readonly retryAt: Date | null = null,
  ) {
    super(code);
  }
}
```

`requestCode` generates plaintext once, passes only hash/prefix to prepare, calls sender, disables pending on explicit send failure, activates after SMTP acceptance, and returns only `status/retryAt/redeemBy`. Map every Store outcome exhaustively.

- [ ] **Step 5: Map self-service active-entitlement redemption**

Update `ActivationCodeService.redeemCode` so `entitlement_active` throws a stable `ENTITLEMENT_ACTIVE` domain error while `code_invalid` remains the generic existing activation error.

- [ ] **Step 6: Run GREEN and commit**

Run:

```powershell
npm --prefix server test -- selfServiceActivation.test.ts activation.test.ts
npm --prefix server run build
```

Commit:

```powershell
git add server/src/activation.ts server/src/activationPolicy.ts server/src/selfServiceActivation.ts server/tests/activation.test.ts server/tests/selfServiceActivation.test.ts
git commit -m "feat(server): orchestrate self-service activation"
```

### Task 6: Add localized activation email delivery without console fallback

**Files:**
- Modify: `server/src/email.ts`
- Modify: `server/tests/email.test.ts`

- [ ] **Step 1: Write failing three-locale and secrecy tests**

For each locale, assert the SMTP message contains the code, 31 days, 20 Credits, redeem deadline, bound-account warning, and the matching language. Assert SMTP `to` equals the session-derived email. Assert creating the activation sender with `smtp:null` throws and never calls `DevelopmentOtpOutput.write`.

- [ ] **Step 2: Run RED**

Run: `npm --prefix server test -- email.test.ts`

Expected: FAIL because the activation sender/template does not exist.

- [ ] **Step 3: Implement the exact sender API**

```ts
export function createActivationCodeSender(
  config: Pick<OtpSenderConfig, "smtp">,
  createTransport: MailTransportFactory = defaultTransportFactory,
): SendActivationCode {
  if (!config.smtp) {
    throw new Error("SMTP configuration is required for activation-code email.");
  }
  const transporter = createConfiguredTransport(config.smtp, createTransport);
  return async (input) => {
    await transporter.sendMail(buildActivationCodeMessage({
      from: config.smtp!.from,
      ...input,
    }));
  };
}
```

Use fixed template maps keyed by `ActivationEmailLocale`. Escape all HTML interpolations even though the code and locale are closed; format the deadline with a fixed locale mapping and UTC/time-zone label so Server host locale cannot change email meaning.

- [ ] **Step 4: Verify GREEN and no OTP regression**

Run:

```powershell
npm --prefix server test -- email.test.ts auth.test.ts
npm --prefix server run build
```

Expected: activation template tests and existing OTP console/SMTP tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/src/email.ts server/tests/email.test.ts
git commit -m "feat(server): send localized activation emails"
```

### Task 7: Wire runtime configuration, account capability, and request route

**Files:**
- Modify: `server/src/runtimeConfig.ts`
- Modify: `server/.env.example`
- Modify: `server/src/index.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/routes/desktopAccount.ts`
- Modify: `server/tests/runtimeConfig.test.ts`
- Modify: `server/tests/routes.test.ts`
- Modify: `server/tests/deploymentContracts.test.ts`

- [ ] **Step 1: Write failing config and HTTP contract tests**

Add production config cases requiring an explicit `FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED=0|1`. Add route cases for 401, 404, 400 locale, 409 active entitlement, 429 with `Retry-After` + `retry_at`, 503 SMTP, and 200:

```ts
expect(response.json()).toEqual({
  status: "sent",
  retry_at: "2026-08-24T00:01:00.000Z",
  redeem_by: "2026-09-23T00:00:00.000Z",
});
expect(response.body).not.toContain("FQ-");
```

Assert `GET /api/desktop/account` returns `can_request_activation_code=true` only for enabled inactive/expired users.

- [ ] **Step 2: Run RED**

Run: `npm --prefix server test -- runtimeConfig.test.ts routes.test.ts deploymentContracts.test.ts`

Expected: FAIL because the flag, dependency, capability, and route are absent.

- [ ] **Step 3: Add fail-closed runtime configuration**

Extend `RuntimeConfig` with `selfServiceActivationEnabled:boolean`. Production treats a missing or malformed flag as `RuntimeConfigurationError`; development/test defaults false when absent. Add this documented line:

```dotenv
# Explicit production kill switch for account-bound activation-code email requests.
FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED=0
```

- [ ] **Step 4: Wire service dependencies**

Extend `ServerDependencies`:

```ts
sendActivationCode?: SendActivationCode;
selfServiceActivationEnabled?: boolean;
```

`index.ts` creates `createActivationCodeSender(runtimeConfig)` only when enabled and passes the flag. Tests with the feature disabled need no sender. `buildServer` constructs `SelfServiceActivationService` with an injected sender that throws `ACTIVATION_EMAIL_UNAVAILABLE` only if a test incorrectly enables without supplying a sender.

- [ ] **Step 5: Implement capability and route**

Add `locale: z.enum(["zh-CN", "zh-TW", "en-US"]).default("zh-CN")`. Authenticate first, then check feature availability. Pass only `session.tokenHash`, `request.ip`, and locale to the service. Map domain errors exactly:

```ts
case "AUTH_REQUIRED":
  return reply.code(401).send({ error: error.code });
case "ENTITLEMENT_ACTIVE":
  return reply.code(409).send({ error: error.code });
case "ACTIVATION_REQUEST_RATE_LIMITED":
  reply.header("Retry-After", retryAfterSeconds(error.retryAt, now));
  return reply.code(429).send({
    error: error.code,
    retry_at: error.retryAt?.toISOString(),
  });
case "ACTIVATION_EMAIL_UNAVAILABLE":
case "SERVER_TEMPORARILY_UNAVAILABLE":
  return reply.code(503).send({ error: error.code });
```

Do not accept email, user ID, days, quota, or code in this request body.

- [ ] **Step 6: Run GREEN and commit**

Run:

```powershell
npm --prefix server test -- runtimeConfig.test.ts routes.test.ts deploymentContracts.test.ts selfServiceActivation.test.ts
npm --prefix server run build
```

Commit:

```powershell
git add server/.env.example server/src server/tests/runtimeConfig.test.ts server/tests/routes.test.ts server/tests/deploymentContracts.test.ts
git commit -m "feat(server): expose activation email requests"
```

### Task 8: Add Admin Web audit visibility without plaintext

**Files:**
- Modify: `server/src/adminPage.ts`
- Modify: `server/src/i18n.ts`
- Modify: `server/tests/admin.test.ts`
- Modify: `server/tests/pageI18n.test.ts`

- [ ] **Step 1: Write failing Admin Web assertions**

Seed one administrator code and one self-service code. Assert the page shows localized source, bound email, `pending/active/disabled reason`, sent/redeem timestamps, and prefix. Assert it does not contain either full code/hash, SMTP content, bearer token, or an unrelated user email.

- [ ] **Step 2: Run RED**

Run: `npm --prefix server test -- admin.test.ts pageI18n.test.ts`

Expected: FAIL because the new metadata/strings are not rendered.

- [ ] **Step 3: Render source and bound account safely**

Build `userEmailsById` once and add columns for source, bound account, sent time, and disabled reason. Use `escapeHtml` for every dynamic string and existing `formatDate`. Add all page strings to `zh-CN`, `zh-TW`, and `en` Server-page locales; this `en` is intentionally distinct from the desktop request locale `en-US`.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm --prefix server test -- admin.test.ts pageI18n.test.ts
npm --prefix server run build
```

Commit:

```powershell
git add server/src/adminPage.ts server/src/i18n.ts server/tests/admin.test.ts server/tests/pageI18n.test.ts
git commit -m "feat(server): show activation delivery metadata"
```

### Task 9: Add the Rust/Tauri capability and request IPC

**Files:**
- Modify: `app/src-tauri/src/account.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust contract tests**

Add tests for:

- missing `can_request_activation_code` deserializes false;
- true survives Server → `AccountStatusView` mapping;
- guest and status-failure views return false;
- request URL is exactly `/api/desktop/activation-codes/request`;
- `zh-CN`, `zh-TW`, `en-US` are accepted and other locale strings rejected;
- structured 429 error preserves code and `retry_at`;
- success response contains no activation code.

- [ ] **Step 2: Run RED**

Run: `cargo test --manifest-path app/src-tauri/Cargo.toml account`

Expected: FAIL because fields, URL helper, response/error structs, and command are absent.

- [ ] **Step 3: Extend account status compatibly**

```rust
#[derive(Debug, Deserialize)]
struct ServerAccountStatus {
    authenticated: bool,
    email: String,
    entitlement_status: String,
    entitlement_expires_at: Option<String>,
    llm_quota_limit: i32,
    llm_quota_used: i32,
    llm_quota_remaining: i32,
    llm_quota_resets_at: Option<String>,
    llm_configured: bool,
    last_verified_at: String,
    can_process: bool,
    can_generate_ai: bool,
    #[serde(default)]
    can_request_activation_code: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct AccountStatusView {
    authenticated: bool,
    email: Option<String>,
    entitlement_status: String,
    entitlement_expires_at: Option<String>,
    llm_quota_limit: i32,
    llm_quota_used: i32,
    llm_quota_remaining: i32,
    llm_quota_resets_at: Option<String>,
    llm_configured: bool,
    last_verified_at: Option<String>,
    can_process: bool,
    can_generate_ai: bool,
    can_request_activation_code: bool,
    server_error: Option<String>,
}
```

Set false in guest and failure branches.

- [ ] **Step 4: Implement a structured command boundary**

```rust
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ActivationCodeRequestView {
    status: String,
    retry_at: String,
    redeem_by: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ActivationCodeRequestError {
    code: String,
    retry_at: Option<String>,
}

#[tauri::command]
pub(crate) async fn request_activation_code(
    app: AppHandle,
    locale: String,
) -> Result<ActivationCodeRequestView, ActivationCodeRequestError>;
```

Validate locale locally, load the existing session, POST `{locale}` with bearer auth, decode only the closed success fields, and map expected Server error bodies to the structured error. Unknown/malformed responses become `ACCOUNT_IPC_RESPONSE_INVALID` without embedding raw response text.

- [ ] **Step 5: Register, verify, and commit**

Add `account::request_activation_code` to `generate_handler!` and the URL helper test imports.

Run:

```powershell
cargo fmt --manifest-path app/src-tauri/Cargo.toml --check
cargo test --manifest-path app/src-tauri/Cargo.toml account
```

Commit:

```powershell
git add app/src-tauri/src/account.rs app/src-tauri/src/lib.rs
git commit -m "feat(app): add activation request ipc"
```

### Task 10: Extend TypeScript account state and strict IPC client

**Files:**
- Modify: `app/src/accountState.ts`
- Modify: `app/src/accountState.test.ts`
- Modify: `app/src/accountClient.ts`
- Modify: `app/src/accountClient.test.ts`

- [ ] **Step 1: Write failing optional-capability and request tests**

Assert account status maps true, defaults false when the optional key is absent, rejects non-boolean values, and invokes:

```ts
expect(calls).toEqual([{
  command: "request_activation_code",
  args: { locale: "en-US" },
}]);
```

Assert a structured `{code:"ACTIVATION_REQUEST_RATE_LIMITED",retry_at:"..."}` rejection becomes a typed error without retaining extra secret fields.

- [ ] **Step 2: Run RED**

Run: `npm --prefix app test -- accountState.test.ts accountClient.test.ts`

Expected: FAIL because state/client types and request function are absent.

- [ ] **Step 3: Add safe state defaults**

Add `canRequestActivationCode:boolean` to `AccountStatus`. Guest, failure, browser preview, and any absent optional IPC field use false.

- [ ] **Step 4: Add strict request decoding**

```ts
export type ActivationCodeRequest = {
  status: "sent";
  retryAt: string;
  redeemBy: string;
};

export class ActivationCodeRequestError extends Error {
  constructor(
    readonly code:
      | "AUTH_REQUIRED"
      | "FEATURE_NOT_AVAILABLE"
      | "ENTITLEMENT_ACTIVE"
      | "ACTIVATION_REQUEST_RATE_LIMITED"
      | "ACTIVATION_EMAIL_UNAVAILABLE"
      | "SERVER_TEMPORARILY_UNAVAILABLE"
      | "ACCOUNT_IPC_RESPONSE_INVALID",
    readonly retryAt: string | null,
  ) {
    super(code);
  }
}
```

Register `can_request_activation_code` in the optional-key list and require boolean when present. Parse request success with exact keys and ISO date strings. Catch only the structured Rust error shape; map all other values to `ACCOUNT_IPC_RESPONSE_INVALID`.

- [ ] **Step 5: Run GREEN and commit**

Run:

```powershell
npm --prefix app test -- accountState.test.ts accountClient.test.ts
npm --prefix app run lint
```

Commit:

```powershell
git add app/src/accountState.ts app/src/accountState.test.ts app/src/accountClient.ts app/src/accountClient.test.ts
git commit -m "feat(app): map activation request capability"
```

### Task 11: Add React request flow, cooldown, button, and three-language copy

**Files:**
- Modify: `app/src/features/account/useAccountController.ts`
- Modify: `app/src/features/account/useAccountController.test.ts`
- Modify: `app/src/features/account/AccountSheet.tsx`
- Modify: `app/src/features/account/AccountSheet.test.tsx`
- Modify: `app/src/i18n/accountResources.ts`
- Modify: `app/src/accountCopy.test.ts`
- Modify: `app/src/App.tsx`
- Modify: `app/src/App.css`
- Modify: `app/src/App.css.test.ts`

- [ ] **Step 1: Write failing UI/controller tests**

Cover:

- request button hidden for guest, active, capability false/absent;
- visible for inactive and expired capability true;
- input/redeem remains when the request feature is unavailable;
- one click sends current `resolvedLocale` and disables during flight;
- success shows semantic sent notice and disables until `retryAt`;
- 429 uses server retry time;
- 409 refreshes status and hides the button;
- 503 shows safe localized failure without raw Server text;
- stale refresh/request responses cannot overwrite a later redemption or sign-out;
- all three locales render the action and notices.

- [ ] **Step 2: Run RED**

Run:

```powershell
npm --prefix app test -- features/account/useAccountController.test.ts features/account/AccountSheet.test.tsx accountCopy.test.ts App.css.test.ts
```

Expected: FAIL because request state, callbacks, markup, styles, and strings are absent.

- [ ] **Step 3: Implement controller state with operation ownership**

Add:

```ts
const [activationCodeRequestPending, setActivationCodeRequestPending] =
  useState(false);
const [activationCodeRequestRetryAt, setActivationCodeRequestRetryAt] =
  useState<string | null>(null);
```

`requestActivationCodeByEmail` must call `beginActiveOperation()`, pass `resolvedLocale`, commit results only if it still owns the operation, and clear ownership in `finally`. Schedule one bounded timeout to clear an elapsed cooldown and clean it up on unmount/sign-out. Never show `String(error)`; switch only on `ActivationCodeRequestError.code`. For 409, run `runAccountStatusRefresh(operationId)` before setting the localized “already active” notice.

- [ ] **Step 4: Add the button without breaking manual redemption**

Inside the existing activation panel, render a secondary mail action only when `account.canRequestActivationCode`:

```tsx
{account.canRequestActivationCode ? (
  <button
    type="button"
    className="secondary-button activation-email-button"
    onClick={onRequestActivationCode}
    disabled={activationCodeRequestPending || activationCodeRequestCoolingDown}
  >
    <Mail size={16} />
    <span>
      {activationCodeRequestPending
        ? t("actions.activationEmailSending")
        : t("actions.sendActivationEmail")}
    </span>
  </button>
) : null}
```

Keep the activation input and footer redemption action available for inactive accounts even when this button is hidden. Wire the new controller values/callback through `App.tsx`.

- [ ] **Step 5: Add semantic copy and stable layout**

Update activation title/description so it no longer claims codes only come from administrators. Add Simplified Chinese, Traditional Chinese, and US English keys for send/sending/sent/cooldown/rate-limit/active/email-unavailable/general-failure. Add focused CSS for a full-width secondary request button; do not change global button hierarchy.

- [ ] **Step 6: Run GREEN and commit**

Run:

```powershell
npm --prefix app test -- features/account/useAccountController.test.ts features/account/AccountSheet.test.tsx accountCopy.test.ts App.css.test.ts
npm --prefix app run lint
npm --prefix app run build
```

Commit:

```powershell
git add app/src/App.tsx app/src/App.css app/src/App.css.test.ts app/src/features/account app/src/i18n/accountResources.ts app/src/accountCopy.test.ts
git commit -m "feat(app): add email activation request ui"
```

### Task 12: Close end-to-end concurrency, privacy, and compatibility coverage

**Files:**
- Modify: `server/tests/routes.test.ts`
- Modify: `server/tests/prismaSelfServiceActivation.test.ts`
- Modify: `server/tests/observability.test.ts`
- Modify: `server/tests/storeCompatibility.test.ts`
- Modify: `server/tests/serverModuleBoundaries.test.ts`
- Modify: `server/tests/storeModuleBoundaries.test.ts`
- Modify: `app/src/accountClient.test.ts`
- Modify: `app/src/features/account/useAccountController.test.ts`

- [ ] **Step 1: Add an end-to-end Server flow test**

Using MemoryStore and injected sender:

1. create user/session with no entitlement;
2. GET account reports capability true;
3. POST request captures the email code but response does not;
4. another account cannot redeem;
5. requesting account redeems and receives 31 days / 20 Credits;
6. GET account reports capability false;
7. direct request returns 409;
8. advance `now` beyond expiry;
9. request and redeem again; quota resets to 20/0.

- [ ] **Step 2: Add concurrency/failure matrix**

Prove:

- overlapping request services call SMTP once;
- SMTP failure leaves no active code and keeps dispatch counters;
- crash-equivalent pending row cannot redeem;
- response-loss-equivalent active row remains redeemable;
- old code vs new activation and admin code vs self-service activation produce at most one new free window;
- same self-service code across independent Prisma clients consumes once;
- a Store write failure rolls back code and entitlement together.

- [ ] **Step 3: Add privacy and boundary assertions**

Assert logs, Admin HTML, request responses, Tauri errors, and React notices contain none of: full activation code, `codeHash`, SMTP password, bearer token, raw email body, database error, video URL, file path, transcript marker. Update module boundary allowlists only for the new focused modules; prevent routes/UI from importing Prisma or Nodemailer directly.

- [ ] **Step 4: Run focused cross-layer gates**

Run:

```powershell
npm --prefix server test -- activation selfServiceActivation routes email observability storeCompatibility serverModuleBoundaries storeModuleBoundaries
cargo test --manifest-path app/src-tauri/Cargo.toml account
npm --prefix app test -- account
```

Expected: all focused suites pass with no skipped self-service acceptance case.

- [ ] **Step 5: Commit hardening coverage**

```powershell
git add server/tests app/src/accountClient.test.ts app/src/features/account/useAccountController.test.ts
git commit -m "test: harden self-service activation flow"
```

### Task 13: Synchronize operations/docs, run full gates, and archive the plan

**Files:**
- Modify: `README.md`
- Modify: `deploy/server-deployment.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/2026-08-24-self-service-email-activation-code.md`
- Modify: `docs/product-specs/2026-08-24-self-service-email-activation-code.md` only if implementation reveals a user-visible correction
- Modify: `TASKS.md`
- Modify: `docs/exec-plans/active/2026-08-24-self-service-email-activation-code-plan.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Move after all gates: active plan → `docs/exec-plans/completed/2026-08-24-self-service-email-activation-code-plan.md`

- [ ] **Step 1: Document configuration and rollout**

Document `FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED`, Server-first order, SMTP requirement, emergency disable, account-bound semantics, 60s/5h/20-IP rate limits, and the fact that SMTP acceptance is not delivery proof. Remove current-architecture language claiming administrator distribution is the only visible path only after implementation is live and verified.

- [ ] **Step 2: Run database migration evidence**

Run against disposable fresh and pre-seeded SQLite databases:

```powershell
npm --prefix server run prisma:generate
npm --prefix server run db:migrate:deploy
npm --prefix server run db:migrate:status
npm --prefix server run db:preflight
npm --prefix server run db:restore-smoke
```

Record exact results and verify the pre-seeded administrator code retains `issuanceSource=admin` and can redeem.

- [ ] **Step 3: Run complete automated gates**

```powershell
npm --prefix server test
npm --prefix server run build
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
cargo test --manifest-path app/src-tauri/Cargo.toml
uv run ruff check worker
uv run pytest worker\tests
python scripts/validate_agents_docs.py --level ERROR
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Expected: every command exits 0. Record test counts and any existing non-failing build warning in Outcomes & Retrospective.

- [ ] **Step 4: Perform staging SMTP and packaged-desktop smoke**

With a test mailbox and feature flag enabled:

- inactive account sees request button;
- email arrives in each selected locale template;
- copied code activates the same account;
- forwarded code fails on another account;
- active account hides button and direct request returns 409;
- simulated expired account can repeat;
- disabling the flag hides the button after refresh while administrator code redemption still works.

Do not use a real user's mailbox, entitlement, or production code for this smoke. If approved SMTP/staging is unavailable, keep the plan active and record that exact residual rather than claiming release completion.

- [ ] **Step 5: Update living sections and archive only after evidence**

Add dated Progress entries with command evidence, append implementation discoveries/decisions, and fill Outcomes & Retrospective with exact results and residual risk. Move the plan to completed, update both indexes, and add the completed `TASKS.md` ledger entry.

- [ ] **Step 6: Commit documentation and archive**

```powershell
git add README.md deploy docs TASKS.md
git commit -m "docs: complete self-service activation rollout"
```

## Validation and Acceptance

### Automated acceptance

- Fresh and pre-seeded Prisma migrations apply; existing administrator codes remain redeemable.
- MemoryStore and PrismaStore implement identical closed outcomes for prepare/disable/activate/redeem.
- Independent-client concurrency permits at most one request dispatch and one code consumption.
- SMTP failure and crash-equivalent pending state leave no redeemable code.
- Self-service codes are bound to the requester and rejected for active entitlement.
- Expired users can repeat the cycle indefinitely; each successful cycle starts at now with quota 20/0.
- Administrator universal codes still extend active entitlement and retain quota behavior.
- Account capability is additive/optional and false for guest, active, disabled feature, old runtime, and unavailable status.
- Rust and TypeScript strictly decode success/error contracts without raw response leakage.
- React shows the button only for eligible accounts and preserves manual universal-code redemption.
- Simplified Chinese, Traditional Chinese, and US English client/email copy pass i18n gates.
- Admin Web/logs/API/IPC/diagnostics do not expose activation plaintext or content data.

### Manual acceptance

Use a non-production mailbox and a disposable test account. Complete request → email → copy → redeem, cross-account rejection, active-state hiding, post-expiry repeat, rate-limit feedback, SMTP failure, and kill-switch behavior. Capture timestamps and non-sensitive screenshots/log event IDs; never capture the full code, session token, SMTP credentials, or email body in repository artifacts.

### Completion rule

This plan is confirmed only when the user approves it. Implementation is complete only after all automated gates pass, staging SMTP/desktop smoke evidence is recorded (or the plan remains active with that explicit external blocker), living sections are current, architecture/security/TASKS are synchronized, and the plan is moved to `completed/`.
