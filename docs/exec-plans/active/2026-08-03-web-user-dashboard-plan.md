# FrameQ Web User Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user Web dashboard (`GET /dashboard`) and a browser-side email-OTP login path that lands on it, without changing the desktop deep-link login flow. The dashboard ships with account-and-quota content only; other modules are placeholders. Version number is intentionally not assigned by this plan (see Decision Log).

**Architecture:** A new `UserAuthService` + `routes/userAuth.ts` + `routes/dashboard.ts` + `dashboardPage.ts` mirror the existing Admin Web cookie-session pattern (`AdminAuthService` + `routes/admin.ts` + `adminPage.ts`). The desktop `AuthService` and `/auth/email/*` routes are untouched. OTP issuance stays on the `desktop_login` purpose and is shared between the desktop ticket path and the new web-session path; the OTP row is consumed exactly once across both. Store additions are append-only (memory + Prisma + migration); no existing store signature changes.

**Tech Stack:** TypeScript, Fastify, Zod, Vitest, Prisma, Node.js, server-rendered HTML (no React on the server). No app/worker/Rust changes.

---

## Progress

- [x]  2026-08-03: Spec drafted at `docs/product-specs/2026-08-03-web-user-dashboard.md`; this ExecPlan drafted; awaiting user approval before implementation.
- [x]  2026-08-03: All Tasks 1–9 complete. Implementation ships store contracts (memory + Prisma + migration `202608030001_user_session`), `UserAuthService`, `routes/userAuth.ts`, `routes/dashboard.ts`, `dashboardPage.ts`, login-page branching, server wiring, and full integration/regression tests in `server/tests/webDashboard.test.ts`. Governance validated and all regression gates green. See Outcomes & Retrospective for evidence.

## Decision Log

- Decision: Reuse the `desktop_login` OTP purpose for web login instead of adding `user_web_login`. Rationale: a single issued OTP can satisfy either the desktop ticket path or the web-session path, and the OTP row is consumed once; this avoids a user receiving two codes for the same email and avoids a new store branch for issuance. Date/Author: 2026-08-03, User + Codex.
- Decision: Mirror the Admin Web session model (httpOnly session cookie + non-httpOnly CSRF cookie + `x-frameq-csrf` header) rather than extending the desktop bearer-token model to the browser. Rationale: cookies give the browser a natural session, CSRF double-token defends the logout (and future write) endpoints, and the pattern is already proven by Admin Web. Date/Author: 2026-08-03, Codex.
- Decision: Do NOT assign a version number in this plan. Rationale: v0.3.0 is already tagged and pushed; this work is the next iteration. The version bump (e.g. v0.3.1 patch or v0.4.0 minor) is decided in a separate release-prep plan once implementation is complete. Date/Author: 2026-08-03, Codex.
- Decision: Web mode ignores any caller-supplied `redirect_uri` and only lands on `/dashboard` or `/login`; `redirect_uri` is honored exclusively in desktop mode and exclusively when it equals `frameq://auth/callback`. Rationale: prevents open-redirect abuse while preserving the desktop contract. Date/Author: 2026-08-03, Codex.
- Decision: Dashboard ships with account-and-quota content only; task history, settings, and insight-preferences modules are placeholder sections. Rationale: the user explicitly scoped the first cut to "打通登录跳转骨架 + 账号信息与额度". Date/Author: 2026-08-03, User + Codex.

## Outcomes & Retrospective

### What was delivered

- New per-user Web dashboard at `GET /dashboard` with email-OTP cookie-session login that lands on the dashboard, while the desktop deep-link login flow stays byte-for-byte unchanged.
- Browser-side login page (`/login`) now branches between desktop mode (`desktop=1` + `redirect_uri=frameq://auth/callback`) and web mode (everything else, including a plain browser visit). Web mode ignores any caller-supplied `redirect_uri` and only lands on `/dashboard` or `/login` — verified by an explicit open-redirect regression test.
- Dashboard ships account-and-quota content only (email, entitlement status/expiry, AI Credit limit/used/remaining/reset-time, `can_process`, `can_generate_ai`, bound activation-code prefix with masked suffix). Task history, settings, and insight-preferences modules are placeholder sections.

### Key implementation decisions (recorded during work)

- Reused the `desktop_login` OTP purpose; the OTP row is consumed exactly once across the desktop ticket path and the new web-session path. Two cross-consumption regression tests prove this in both directions.
- Mirrored the Admin Web session model: `frameq_user_session` (httpOnly) + `frameq_user_csrf` (non-httpOnly) + `x-frameq-csrf` header on logout. Cookies inherit `Secure`/`SameSite=Lax`/`Max-Age` from the existing `secureCookies` flag — no new env vars.
- Split user-session store methods into dedicated `store/memory/userSession.ts` and `prismaStore/userSession.ts` modules to keep `auth.ts` under the 450-line module boundary. Added Prisma `UserSession` model + migration `202608030001_user_session`.
- Extracted shared cookie helpers into `routes/cookies.ts` so admin and user routes share one implementation.
- Dashboard HTML is rendered server-side with `cache-control: no-store` and never echoes the session cookie, the full activation code, or any LLM API key. A dedicated "does not leak secrets" test asserts this.

### Verification evidence (Task 9 gates)

- **Server tests:** `npm --prefix server test -- --run` → 26 files, 158 passed / 1 skipped (was 146 passed before this change; +12 new `webDashboard.test.ts` tests covering the full web login → dashboard → logout cycle, secure cookie attributes with `secureCookies=true`, invalid code/state rejection, logout 401/403, unauthenticated dashboard redirect, secret-leak guard, desktop-mode regression, and OTP cross-consumption in both directions, plus the open-redirect guard).
- **Server boundaries:** `routes.test.ts` route table updated; `serverModuleBoundaries.test.ts`, `storeModuleBoundaries.test.ts`, `storeCompatibility.test.ts`, `prismaMigration.test.ts` all green after adding the new routes, modules, and migration.
- **Governance:** `python scripts/validate_agents_docs.py --level WARN` → 0 errors / 0 warnings (also clean at `--level ERROR`). `docs/product-specs/index.md` and `docs/exec-plans/active/index.md` already list this spec/plan; no new design doc was required by the plan.
- **App regression (should be unaffected, confirmed):** `npm --prefix app run lint` → clean (i18n literal checks pass); `npm --prefix app run build` → built in 7.57s; `npm --prefix app test` → 73 files, 669 passed.
- **Worker regression (should be unaffected, confirmed):** `uv run ruff check worker` → All checks passed; `uv run pytest worker/tests` → 669 passed / 2 skipped / 1 warning (pre-existing `audioop` DeprecationWarning, unrelated).

### Residual risks (to revisit before release)

- **`secureCookies` deployment verification on `frameq.8xf.pro`:** the `Secure` flag is only set when `secureCookies=true` is wired through the production deployment config. If the reverse proxy terminates TLS but the app sees HTTP, session cookies could transit without the `Secure` flag. Verify the deployment config before announcing the dashboard URL.
- **No IP/UA binding on user web sessions:** a stolen cookie is usable for the full 90-day TTL. Acceptable for v1 parity with the desktop session; revisit if abuse appears.
- **No web-login-specific rate limit beyond the shared OTP rate limit:** acceptable since OTP issuance is the gated step and the OTP purpose is shared with the desktop path.
- **Version bump and release-prep are a separate follow-up plan:** this plan does not tag or publish. The next plan decides v0.3.1 (patch) vs v0.4.0 (minor) and writes release notes.
- **Login-page script contains both ternary branches as literals:** tests assert the desktop and web targets are both present in the rendered HTML (they have to be, since one page handles both modes). Mode is selected at runtime from URL params; the actual behavior is verified by end-to-end API tests, not by static text checks.

## Context and Orientation

- Spec: `docs/product-specs/2026-08-03-web-user-dashboard.md`.
- Pattern reference (Admin Web session): `server/src/adminAuth.ts`, `server/src/routes/admin.ts`, `server/src/adminPage.ts`.
- Desktop login (must stay unchanged): `server/src/auth.ts`, `server/src/routes/desktopAuth.ts`, `server/src/loginPage.ts`.
- Store contracts: `server/src/store/contracts.ts`, `server/src/store/memory/`, `server/src/prismaStore/`.
- Prisma schema: `server/prisma/schema.prisma`, migrations under `server/prisma/migrations/`.
- Server wiring: `server/src/server.ts`.
- Desktop account contract (JSON shape to mirror): `server/src/routes/desktopAccount.ts`.
- Security helpers: `server/src/security.ts` (`sha256`, `secureToken`, `otpCode`, `constantTimeEqual`).
- Route shared helpers: `server/src/routes/shared.ts`, `server/src/routes/authSchemas.ts`.
- Governance: `AGENTS.md`, `WORKFLOW.md`, `docs/EXECUTION_GATES.md`, `docs/SECURITY.md`.
- Out of scope: v0.3.0 release (already tagged); desktop binary; worker; ASR model path.

---

## Tasks

### Task 1 — Store contracts and memory store

- [x] 1.1 Add `UserSessionRecord` type and result types (`VerifyUserOtpResult`) to `server/src/store/contracts.ts`, mirroring `AdminSessionRecord` / `VerifyAdminOtpResult`.
- [x] 1.2 Add store methods to the `Store` interface (additions only): `verifyUserOtpAndCreateWebSession`, `findUserSessionByTokenHash`, `revokeUserSession`, `createUserSession`. The verify method consumes the existing `desktop_login` OTP row using the same matching/attempt/failure accounting as `verifyDesktopOtpAndCreateTicket`.
- [x] 1.3 Implement the four methods in `server/src/store/memory/auth.ts` (or a new `userSession.ts`) using in-memory maps; OTP consumption shares the same OTP storage used by desktop/admin.
- [x] 1.4 Confirm `server/src/store/memory.ts` re-exports the new methods; no existing method signature changes.
- [x] 1.5 Add focused memory-store tests: web verify success, OTP consumed-once across web/desktop, session lookup, revocation, expiry.

### Task 2 — Prisma model and migration

- [x] 2.1 Add `UserSession` model to `server/prisma/schema.prisma` mirroring `AdminSession` (id, userId, email, sessionTokenHash unique, csrfTokenHash, expiresAt, createdAt, revokedAt; relation to User).
- [x] 2.2 Generate a new migration under `server/prisma/migrations/202608030001_user_session/` (or the next sequence number). SQL must be idempotent-friendly and follow the baseline style of existing migrations.
- [x] 2.3 Implement the four store methods in `server/src/prismaStore/auth.ts` (or a new `userSession.ts`) using Prisma transactions for the OTP-consume + session-create atomicity, matching the existing `verifyAdminOtpAndCreateSession` transaction style.
- [x] 2.4 Update `server/src/prismaStore.ts` re-exports.
- [x] 2.5 Add Prisma-focused tests: migration applies on fresh DB and on a DB pre-seeded with desktop/admin data; verify + lookup + revoke; cross-path OTP consumption.

### Task 3 — UserAuthService

- [x] 3.1 Create `server/src/userAuth.ts` exporting `UserAuthService` with `startEmailLogin`, `verifyEmailCode`, `authenticate`, `validateCsrf`. Reuse `normalizeEmail`/`validateState` from `auth.ts`. `startEmailLogin` issues with `purpose: "desktop_login"` (no new purpose). Session TTL = 90 days (match `SESSION_TTL_MS`).
- [x] 3.2 `verifyEmailCode` must NOT issue a desktop ticket and must NOT return a `frameq://` URL; it returns `{ sessionToken, csrfToken, session }`.
- [x] 3.3 Export `userSessionMaxAgeSeconds` for the cookie route layer.
- [x] 3.4 Add focused unit tests for `UserAuthService` mirroring `adminAuth.test.ts` coverage.

### Task 4 — Web auth routes

- [x] 4.1 Create `server/src/routes/userAuth.ts` registering `POST /user/auth/email/start`, `POST /user/auth/email/verify`, `POST /user/auth/logout`. Reuse `emailStartSchema` / `emailVerifySchema` from `authSchemas.ts`. Share `setCookie` / `clearCookie` / `parseCookies` helpers — extract them into `server/src/routes/shared.ts` (or a new `cookies.ts`) if not already shared, and have `routes/admin.ts` import the shared versions to avoid duplication.
- [x] 4.2 `verify` sets `frameq_user_session` (httpOnly, `Secure` per `secureCookies`, `SameSite=Lax`, `Max-Age=userSessionMaxAgeSeconds`) and `frameq_user_csrf` (non-httpOnly, same Secure/SameSite/Max-Age). Returns `{ ok: true, redirect_url: "/dashboard" }`. Does NOT return `ticket`.
- [x] 4.3 `logout` validates session cookie + `x-frameq-csrf` header, revokes session, clears both cookies, returns `{ ok: true, redirect_url: "/login" }`. 401 on missing session, 403 on bad CSRF.
- [x] 4.4 Route tests: start success/rate-limit/error, verify success + cookie attributes + no-ticket, verify invalid code/state, logout success/401/403, server-temporarily-unavailable path.

### Task 5 — Dashboard page and route

- [x] 5.1 Create `server/src/dashboardPage.ts` exporting `renderDashboardPage({ email, account, csrfToken })`. HTML mirrors the login page's styling. Renders email, entitlement expiry, AI Credit limit/used/remaining/reset-time, `can_process`, `can_generate_ai`, and bound activation-code prefix (or "未绑定激活码"). Includes a logout form posting to `/user/auth/logout` with `x-frameq-csrf`. Placeholder sections for task history / settings / preferences with no fake data.
- [x] 5.2 Create `server/src/routes/dashboard.ts` registering `GET /dashboard` and `GET /api/dashboard/account`. `GET /dashboard` validates the `frameq_user_session` cookie; on failure redirect to `/login`; on success load the user's account snapshot (reuse the same data assembly used by `/api/desktop/account` — extract a shared `assembleAccountSnapshot(userId, now)` helper if useful) and render the page with `cache-control: no-store`.
- [x] 5.3 `GET /api/dashboard/account` returns the same JSON shape as `/api/desktop/account` for a valid session, 401 otherwise.
- [x] 5.4 Route tests: dashboard redirect when unauthenticated, dashboard render with/without entitlement, dashboard JSON 200/401, no-store header, no secrets in rendered HTML (assert absence of api key / full activation code / video URLs).

### Task 6 — Login page branching

- [x] 6.1 Update `server/src/loginPage.ts` front-end script: compute `desktopMode = params.get("desktop") === "1" && redirectUri === "frameq://auth/callback"`. In desktop mode keep current behavior (post to `/auth/email/*`, follow `redirect_url` deep link, keep `assertDesktopLoginRequest` guard). In web mode post to `/user/auth/email/*`, on verify success `window.location.href = "/dashboard"`, ignore any `redirect_uri`.
- [x] 6.2 The page copy may adjust the helper text ("验证成功后回到 FrameQ 客户端" vs "验证成功后进入控制台") based on mode.
- [x] 6.3 Update existing `loginPage`-related tests (if any) and add tests covering both modes; ensure desktop-mode contract is unchanged.

### Task 7 — Server wiring

- [x] 7.1 In `server/src/server.ts`, instantiate `UserAuthService` (reusing `dependencies.store`, `now`, `dependencies.sendOtp`) and register `userAuth` and `dashboard` routes, passing `secureCookies: dependencies.secureCookies ?? false`.
- [x] 7.2 Confirm no new environment variables are required; `secureCookies` already exists.
- [x] 7.3 Run server boundary test (`server/tests/serverModuleBoundaries.test.ts`) and store boundary test; update if they enumerate registered routes.

### Task 8 — Integration and regression tests

- [x] 8.1 Add a server integration test: full web-mode flow — `/login` page → `/user/auth/email/start` → `/user/auth/email/verify` (assert cookies set) → `GET /dashboard` (200, renders account) → `GET /api/dashboard/account` (200) → `/user/auth/logout` → `GET /dashboard` (redirect to `/login`).
- [x] 8.2 Add a regression test: desktop-mode `/login?desktop=1&state=...&redirect_uri=frameq://auth/callback` → `/auth/email/verify` returns `ticket` + `frameq://` `redirect_url` and sets no `frameq_user_session` cookie; `/api/desktop/sessions/exchange` still works.
- [x] 8.3 Add an OTP cross-consumption test: an OTP verified via the web path is rejected by the desktop verify path and vice versa.
- [x] 8.4 Add an open-redirect test: web mode with `redirect_uri=https://evil.example/` still lands on `/dashboard`, never on the external URL.
- [x] 8.5 Run the full server suite: `npm --prefix server test` (or the project's server test command); all previously-green tests stay green.

### Task 9 — Governance sync and final verification

- [x] 9.1 Update `docs/product-specs/index.md` with the new spec entry (already done at plan-draft time; verify wording).
- [x] 9.2 Update `docs/exec-plans/active/index.md` with this plan entry (already done at plan-draft time; verify wording).
- [x] 9.3 Update `AGENTS.md` quick-entry map if a new design doc is produced (only if a design doc is added; this plan currently does not require one).
- [x] 9.4 Run `python scripts/validate_agents_docs.py --level WARN` — 0 errors / 0 warnings.
- [x] 9.5 Run regression gates that should be unaffected but must be confirmed: `npm --prefix app run lint`, `npm --prefix app run build`, `npm --prefix app test`, `uv run ruff check worker`, `uv run pytest worker/tests` (server-only change; expect green).
- [x] 9.6 Record final evidence in Outcomes & Retrospective; list residual risks (e.g. real-IP `secureCookies` deployment verification on `frameq.8xf.pro`).

---

## Residual Risk Notes (to revisit before release)

- `secureCookies` must be true in the `frameq.8xf.pro` deployment so the `Secure` flag is set; otherwise session cookies could transit over HTTP. Verify deployment config.
- The user web session has no IP/UA binding in this version; a stolen cookie is usable for the session lifetime. Acceptable for v1 parity with the desktop session; revisit if abuse appears.
- No rate-limit specific to web login beyond the shared OTP rate-limit; acceptable since OTP issuance is the gated step.
- Version bump and release-prep (release notes, version sync, tag) are a separate follow-up plan; this plan does not tag or publish.
