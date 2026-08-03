# Web User Dashboard Spec

## Background

Today the FrameQ server's `/login` page is a desktop-only OAuth-style handshake: a desktop client opens `https://frameq.8xf.pro/login?desktop=1&state=...&redirect_uri=frameq://auth/callback`, the user completes email-OTP verification in the browser, and the server's `AuthService.verifyEmailCode` returns a hard-coded `frameq://auth/callback?ticket=...&state=...` deep link that hands control back to the desktop app. The browser is never given its own session and there is no user-facing web page after login. The `redirect_uri` query parameter is currently not read by the server at all, and the login page front-end actively rejects any `redirect_uri` value other than `frameq://auth/callback`.

Users and support staff occasionally want a browser-side view of their own account state (email, plan expiry, remaining AI Credits, activation-code binding) without having to open the desktop app. The Admin Web already demonstrates a working "email OTP → httpOnly session cookie + CSRF double-token → server-rendered page" pattern; this spec reuses that pattern for a per-user web dashboard and keeps the desktop deep-link flow untouched.

## Goals

- Add a per-user Web dashboard at `GET /dashboard` that any signed-in user can reach in a browser.
- Let a user complete email-OTP login in the browser and land on `/dashboard` instead of being forced into the `frameq://` deep link.
- Reuse the existing `desktop_login` OTP purpose so a single issued OTP can be verified by either the desktop ticket path or the new web-session path; OTP issuance, rate limiting, TTL, and delivery semantics stay unchanged.
- Reuse the Admin Web session model: an httpOnly `frameq_user_session` cookie plus a non-httpOnly `frameq_user_csrf` cookie, with `Secure` driven by the existing `secureCookies` deployment flag.
- Show account information and quota on the dashboard: email, entitlement expiry, AI Credit limit / used / remaining, reset time, `can_process`, `can_generate_ai`, and bound activation-code identity when available. This mirrors the desktop `/api/desktop/account` contract.
- Keep the desktop client login flow behaviorally identical: `/login?desktop=1&...&redirect_uri=frameq://auth/callback` continues to return the deep-link `redirect_url` and never sets a browser session.
- Make the dashboard the landing target for plain web logins: a user who reaches `/login` without `desktop=1` (or with an absent/non-deep-link `redirect_uri`) is routed to the web-session path and ends up at `/dashboard`.

## Non-goals

- No self-service purchase, refund, invoice, or WeChat Pay re-enablement in this version. The retired self-serve purchase flow stays retired.
- No activation-code redemption UI on the dashboard in this version; the page only displays the currently bound activation identity if one exists.
- No task-history list, no AI insight preferences editing, no LLM config editing, and no transcript review on the dashboard in this version. Only the account-and-quota block is in scope; everything else is a placeholder.
- No change to the desktop client binary, the Tauri deep-link handler, `/api/desktop/*` contracts, the worker, or the bundled ASR model path.
- No multi-device session list, no "revoke other sessions" UI, no SSO, no password login, no social login. Email OTP remains the only login factor.
- No public marketing site changes; the dashboard is an authenticated user page, not part of the public web marketing site.
- No version-number assignment in this spec. The work is out of scope for the already-tagged v0.3.0 and will land in a later iteration; the version bump is decided in the ExecPlan.

## Login Branching Requirements

- The single `/login` HTML page continues to be served by `GET /login`.
- The page's front-end script inspects the URL query:
  - If `desktop=1` is present AND `redirect_uri` equals `frameq://auth/callback`, the page operates in **desktop mode**: it posts to `/auth/email/start` and `/auth/email/verify` and on success follows the returned `redirect_url` (the deep link), exactly as today. The `assertDesktopLoginRequest()` guard stays enforced for this branch.
  - Otherwise the page operates in **web mode**: it posts to `/user/auth/email/start` and `/user/auth/email/verify` and on success sets the returned cookies via the browser's normal cookie handling, then performs `window.location.href = "/dashboard"`. No deep link is invoked.
- The desktop client continues to launch the browser with `desktop=1` and `redirect_uri=frameq://auth/callback`, so desktop logins keep using desktop mode.
- A user typing `https://frameq.8xf.pro/login` directly in a browser (no query) lands in web mode.
- Open-redirect hardening: in web mode the page MUST NOT accept an arbitrary `redirect_uri` query value and MUST NOT redirect to it. The only post-login destination in web mode is the fixed path `/dashboard`. The `redirect_uri` parameter is honored exclusively in desktop mode and exclusively when it equals `frameq://auth/callback`.

## Service Requirements

- Add `server/src/userAuth.ts` exporting a `UserAuthService` with:
  - `startEmailLogin({ email, ip, state })` that issues an OTP with the existing `desktop_login` purpose (no new purpose), reusing the store's `issueEmailOtp` and the same rate-limit / TTL / delivery-failure invalidation behavior as `AuthService`.
  - `verifyEmailCode({ email, code, state })` that validates the OTP and creates a user web session, returning `{ sessionToken, csrfToken, session: UserSessionRecord }`. It does NOT issue a desktop ticket and does NOT return a `frameq://` redirect URL.
  - `authenticate(sessionToken)` that looks up a session by token hash and returns the session record or `null`.
  - `validateCsrf(session, csrfToken)` using the same constant-time comparison as `AdminAuthService`.
- Add `server/src/routes/userAuth.ts` registering:
  - `POST /user/auth/email/start` — same request schema as `/auth/email/start`, calls `UserAuthService.startEmailLogin`.
  - `POST /user/auth/email/verify` — same request schema as `/auth/email/verify`, calls `UserAuthService.verifyEmailCode`, sets the `frameq_user_session` (httpOnly) and `frameq_user_csrf` (non-httpOnly) cookies with `SameSite=Lax`, `Secure` per the `secureCookies` flag, and `Max-Age` equal to the user session TTL. Returns `{ ok: true, redirect_url: "/dashboard" }` and does NOT return a `ticket`.
  - `POST /user/auth/logout` — validates the session cookie and CSRF, revokes the session, clears both cookies, returns `{ ok: true, redirect_url: "/login" }`.
- Add `server/src/dashboardPage.ts` exporting `renderDashboardPage({ email, account, csrfToken })` that returns the HTML string for `/dashboard`. The page must:
  - Render the user's email, entitlement expiry, AI Credit limit / used / remaining / reset time, `can_process`, and `can_generate_ai`.
  - Render the bound activation-code identity (code prefix + redeemed-at) when one exists; otherwise show "未绑定激活码".
  - Include a logout form that posts to `/user/auth/logout` with the `x-frameq-csrf` header populated from the cookie.
  - Contain clearly marked placeholder sections for task history, settings, and other future modules, with no fake data.
- Add a dashboard route module (e.g. `server/src/routes/dashboard.ts`) registering:
  - `GET /dashboard` — validates the `frameq_user_session` cookie; on failure redirects to `/login`. On success renders `renderDashboardPage` with the user's account snapshot.
  - `GET /api/dashboard/account` — validates the cookie and returns the same account-and-quota JSON shape as the desktop `/api/desktop/account` contract (email, entitlement expiry, quota limit/used/remaining, reset time, `can_process`, `can_generate_ai`, bound activation identity). This is the data source the server-rendered page uses; exposing it as JSON is for future client-side refresh, not for third parties.
- The user session TTL is `90` days, matching the existing desktop `SESSION_TTL_MS`, so web and desktop sessions have comparable lifetime.
- `server/src/server.ts` wires `UserAuthService` and the new route modules into `buildServer`, reusing the existing `secureCookies` dependency. No new environmental configuration is required.

## Store Requirements

- Add to `server/src/store/contracts.ts` and implement in both the memory store and PrismaStore:
  - `verifyUserOtpAndCreateWebSession(input: { email; state; codeHash; sessionTokenHash; csrfTokenHash; now; sessionExpiresAt })` — atomically consumes a `desktop_login` OTP (same table, same state/email/code matching, same attempt/failure accounting as `verifyDesktopOtpAndCreateTicket`) and creates a `UserSessionRecord`. Returns `{ status: "created"; user; session } | { status: "invalid" } | { status: "temporarily_unavailable" }`.
  - `findUserSessionByTokenHash(tokenHash, now)` — returns the live `UserSessionRecord` (not revoked, not expired) or `null`.
  - `revokeUserSession(tokenHash, now)` — marks the session revoked.
  - `createUserSession(input)` — used internally by the verify path.
- The OTP consumption MUST be shared with the desktop path: an OTP consumed by the web verify path cannot be reused by the desktop verify path, and vice versa. Both paths read and update the same OTP row.
- Prisma: add a `UserSession` model to `server/prisma/schema.prisma` mirroring `AdminSession` (id, userId, email, sessionTokenHash, csrfTokenHash, expiresAt, createdAt, revokedAt) and a migration under `server/prisma/migrations/`. The memory store gains an equivalent in-memory structure.
- No existing store method signature changes; additions only. Existing desktop and admin store behavior stays byte-for-byte identical.

## User-visible Behavior

- A user opens `https://frameq.8xf.pro/login` in a browser, enters email, receives a 6-digit code, verifies it, and lands on `/dashboard` showing their email, plan expiry, remaining AI Credits, and `can_process` / `can_generate_ai` flags.
- The same user can open the desktop client, click sign-in, complete the browser OTP, and the desktop app signs in exactly as before; the browser in that flow still shows the deep-link redirect and does not land on `/dashboard`.
- A user on `/dashboard` can click logout and is returned to `/login`.
- Refreshing `/dashboard` while the session cookie is valid keeps the user on `/dashboard`; with an expired or absent cookie, the user is redirected to `/login`.
- No video, audio, transcript, history, model cache, cookie, or local configuration data is sent to the server as part of dashboard rendering. Only email, entitlement, quota, and activation-code identity are read.

## Security and Compliance

- Only email-OTP-verified users obtain a `frameq_user_session` cookie. OTP issuance reuses the existing rate-limit, IP capture, TTL, and delivery-failure invalidation.
- The session cookie is `HttpOnly` and `Secure` (when `secureCookies` is true); the CSRF cookie is non-httpOnly so the front-end can read it into the `x-frameq-csrf` header. `SameSite=Lax` is the minimum; dashboard write operations (logout, future mutations) require both the session cookie and a matching CSRF header.
- No open redirect: web mode ignores any caller-supplied `redirect_uri` and only ever lands on `/dashboard` or `/login`.
- Dashboard pages set `cache-control: no-store` and are not cached by intermediaries.
- The dashboard must not render API keys, LLM config secrets, raw video URLs, file paths, transcripts, or notes that may contain support details. It renders only account and quota fields plus the activation-code prefix (not the full code).
- Audit logs for web login reuse the existing OTP issuance/verification logging; no new sensitive log fields are introduced.

## Acceptance Criteria

- `GET /login` with no query renders the login page in web mode; submitting email + code lands the browser on `/dashboard`.
- `GET /login?desktop=1&state=...&redirect_uri=frameq://auth/callback` renders the login page in desktop mode; the verify response returns a `frameq://auth/callback` `redirect_url` and `ticket`, and sets no user session cookie. Desktop deep-link behavior is unchanged.
- A web-mode `redirect_uri` query value other than `frameq://auth/callback` is ignored (web mode still used) rather than throwing, because web mode never trusts `redirect_uri`.
- `GET /dashboard` without a valid session cookie redirects to `/login`.
- `GET /dashboard` with a valid session renders the user's email, expiry, AI Credit limit/used/remaining, `can_process`, `can_generate_ai`, and bound activation-code prefix.
- `GET /api/dashboard/account` returns 200 with the account JSON for a valid session, 401 otherwise.
- `POST /user/auth/logout` with a valid session and CSRF clears cookies and returns `{ ok: true, redirect_url: "/login" }`; missing CSRF returns 403; missing session returns 401.
- An OTP consumed by the web verify path is rejected by the desktop verify path, and vice versa.
- Existing desktop `/auth/email/start`, `/auth/email/verify`, `/api/desktop/sessions/exchange`, `/api/desktop/account`, and admin routes behave identically before and after the change (regression tests pass unchanged).
- Server tests cover: web-mode login success, desktop-mode login unchanged, dashboard rendering with and without entitlement, dashboard JSON, logout, CSRF/auth failures, OTP cross-path consumption rejection, and cookie `Secure`/`HttpOnly`/`SameSite` attributes.
- Prisma migration applies cleanly on a fresh database and on a database pre-seeded with desktop/admin data.
- `uv run ruff check worker`, `npm --prefix app run lint`, `npm --prefix app run build`, and `npm --prefix app test` remain green where the change touches them (server-only change is not expected to affect app/worker gates, but they are run as regression).
- `python scripts/validate_agents_docs.py --level WARN` remains green after governance-index sync.
