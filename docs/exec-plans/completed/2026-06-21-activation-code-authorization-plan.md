# Activation Code Authorization Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ's first paid release no longer needs to expose a WeChat scan payment flow. The desktop account sheet should let a signed-in user paste an administrator-issued activation code, redeem it once, and immediately gain 31 days of processing entitlement plus a fresh batch of insight-generation quota. The sole administrator, `lantianye@163.com`, manages these codes through the existing server-hosted Admin Web page; WeChat Native order creation, the QR checkout, and the merchant webhook stay in the codebase but are disabled by default and only re-enable when `WECHAT_PAY_ENABLED=1` is set. After this change, no new user-visible surface depends on WeChat, and the only processing gate is the existing `Entitlement` record extended either by activation code or, for emergency rollouts, by re-enabling WeChat behind the same gate. Video, audio, transcripts, history, local model cache, LLM keys, and local configuration stay on the user's machine.

## Progress

- [x] 2026-06-21: Spec and active plan written before implementation (`docs/product-specs/2026-06-21-activation-code-authorization.md`).
- [x] 2026-06-21: Product, architecture, design, security, and TASKS.md updated for the activation-code flow while keeping the WeChat code behind `WECHAT_PAY_ENABLED`.
- [x] 2026-06-21: Added Prisma `ActivationCode` and `AdminSession` models, store helpers, and `db:push` migrations. Validation: `npm --prefix server run db:push`, `npm --prefix server run build`.
- [x] 2026-06-21: Added `server/src/activation.ts` for hash-only generation and `markActivationCodeRedeemed`-based single-use redemption that extends `Entitlement` from `max(now, currentExpiry)` and tops up the LLM quota. Validation: `npm --prefix server test`.
- [x] 2026-06-21: Added `server/src/adminAuth.ts` with `FRAMEQ_ADMIN_EMAIL` allowlist, rate-limited OTP start, hash-stored `AdminSession`, HttpOnly cookie helpers, and constant-time CSRF validation.
- [x] 2026-06-21: Added Admin Web login page and dashboard with structured HTML for OTP login, activation code list/create, and existing LLM config and per-user quota views. Validation: `npm --prefix server test`.
- [x] 2026-06-21: Added `POST /api/desktop/activation-codes/redeem` and a guarded `POST /admin/api/activation-codes` route; disabled WeChat Native order, checkout status, and webhook routes unless `WECHAT_PAY_ENABLED=1`. Validation: `npm --prefix server test`.
- [x] 2026-06-21: Added Tauri `redeem_activation_code` command, mapped it to `app/src/accountClient.ts#redeemActivationCode`, and replaced the WeChat checkout button in `AccountSheet.tsx` with an activation code input plus redemption states. Validation: `cargo test --manifest-path app/src-tauri/Cargo.toml`, `npm --prefix app test`, `npm --prefix app run build`.
- [x] 2026-06-21: Ran full validation gates and recorded outcomes. Validation: `python scripts/validate_agents_docs.py --level WARN`.

## Surprises & Discoveries

- Evidence: `server/src/activation.ts` only stores `codeHash` (sha-256 of the normalized plaintext) plus a 7-character `codePrefix`; the plaintext is returned exactly once from `ActivationCodeService.generateCode`, so a leaked DB cannot yield usable codes.
- Evidence: The plaintext uses a Crockford-style alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no `I/O/0/1`) joined into `FQ-XXXX-XXXX-XXXX-XXXX`, which keeps codes readable, copy-paste safe, and unambiguous when shown in the Admin Web.
- Evidence: `markActivationCodeRedeemed` updates the row only if `status === "active" && redeemedAt === null`, and the redeem service re-reads the row before extending entitlement, so two concurrent desktop sessions cannot both extend the same code.
- Evidence: `redemption` extends `Entitlement.expiresAt` from the later of now or the current expiry rather than always 31 days from now, so a user who redeems near the end of a current pass keeps the existing window and just adds 31 days.
- Evidence: Each redemption also increments `Entitlement.llmQuotaLimit` by `LLM_QUOTA_PER_ACTIVATION = 20` (or creates a new entitlement with that limit) and preserves `llmQuotaUsed`, so a renewal does not reset the user's existing usage count.
- Evidence: `AdminAuthService.startEmailLogin` enforces `email === adminEmail` and rate-limits to one OTP per `email:ip` per 60 seconds, and `verifyEmailCode` returns a constant-time "Verification code is invalid or expired." message on every failure to avoid leaking whether the email existed.
- Evidence: `AdminSessionRecord` stores only the sha-256 of the opaque session token and CSRF token; the cookies are HttpOnly, scoped to `/admin`, and the session max age is `adminSessionMaxAgeSeconds` (12 hours).
- Evidence: The Admin page renders activation code rows from `codePrefix` only and surfaces status as `active / redeemed / expired / disabled`; the `redeemed` row also resolves the redeeming user's email so the admin can audit which account used the code.
- Evidence: `server/src/server.ts` evaluates `wechatPayEnabled ?? process.env.WECHAT_PAY_ENABLED === "1"` once at startup; WeChat routes, the WeChat checkout, and the webhook handler are conditionally registered, so the default build has no WeChat endpoint and the activation-code flow is the only visible surface.
- Evidence: `app/src-tauri/src/account.rs#redeem_activation_code` posts the user-entered code with the persisted `session_token` as a Bearer token; on success it maps the server response into the shared `AccountStatusView` so the React paywall re-evaluates without a separate refresh call.
- Evidence: `AccountSheet.tsx` only shows the activation code input and the "兑换激活码" button when `account.authenticated && !canProcessWithAccount(account)`, so paid users never see the redeem surface again and the disabled-when-active state matches the "月卡已生效" copy.
- Evidence: `npm --prefix server run db:push` synced the local SQLite schema and `npm --prefix server test` reports 7 files / 22 tests; the activation-code and admin routes are covered by `activation.test.ts`, `admin.test.ts`, and the new "redeems an activation code through an authenticated desktop session" / "keeps WeChat routes disabled unless explicitly enabled" cases in `routes.test.ts`.

## Decision Log

- Decision: Replace the first visible WeChat payment unlock with administrator-issued activation codes and keep the WeChat code in the repo behind `WECHAT_PAY_ENABLED=1`. Rationale: WeChat merchant onboarding adds review and certification cost that is too high for the first small-user release, while activation codes need only the existing email-OTP login and a single admin allowlist. Date/Author: 2026-06-21 / Codex.
- Decision: Store activation codes as sha-256 hashes plus a 7-character prefix and show the plaintext only when generated. Rationale: matches the existing email-OTP posture (server only sees hashes), keeps an auditable prefix for the Admin page, and limits blast radius if the SQLite DB leaks. Date/Author: 2026-06-21 / Codex.
- Decision: Use 31-day single-use codes with a default 30-day redemption deadline and a 1-365 day configurable window from the Admin page. Rationale: aligns with the original 9.9 yuan monthly pass duration and lets the administrator pre-issue codes for offline distribution; the deadline stops abandoned codes from sitting as a permanent attack surface. Date/Author: 2026-06-21 / Codex.
- Decision: Extend `Entitlement` from `max(now, currentExpiry)` on each redemption and stack `LLM_QUOTA_PER_ACTIVATION = 20` quota uses on top of any existing quota. Rationale: users who redeem near the end of a current pass keep their remaining window, and the insight quota model from the LLM-quota plan continues to work without changes. Date/Author: 2026-06-21 / Codex.
- Decision: Restrict Admin Web access to `FRAMEQ_ADMIN_EMAIL` (default `lantianye@163.com`) using email OTP and 12-hour HttpOnly cookie sessions with CSRF tokens. Rationale: a single admin does not justify a full role system, while hash-only token storage and CSRF checks keep the admin surface from becoming a parallel account takeover vector. Date/Author: 2026-06-21 / Codex.
- Decision: Use a Crockford-style alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` formatted as `FQ-XXXX-XXXX-XXXX-XXXX`. Rationale: avoids visually ambiguous `I/O/0/1`, keeps a stable prefix so the Admin table can be sorted and searched, and matches the share-page look-and-feel of the existing account copy. Date/Author: 2026-06-21 / Codex.
- Decision: Disable WeChat Native order, checkout status, and webhook routes by default and only register them when `WECHAT_PAY_ENABLED=1`. Rationale: keeps the code for future use and emergency rollback without exposing WeChat endpoints on the default deployment, which would otherwise leak merchant configuration. Date/Author: 2026-06-21 / Codex.
- Decision: Replace the WeChat checkout button in `AccountSheet.tsx` with an activation code input and a "兑换激活码" primary action that calls the existing Tauri `redeem_activation_code` command. Rationale: the React paywall and the shared `canProcessWithAccount` model already gate processing, so the only user-visible change is the unlock surface. Date/Author: 2026-06-21 / Codex.

## Outcomes & Retrospective

Implemented end to end against the spec. The desktop account sheet now shows an activation code input and a "兑换激活码" button instead of the WeChat QR code for signed-in users without an active entitlement; on success the shared `AccountStatus` flips to `can_process = true` and the rest of the UI gating follows the existing `canProcessWithAccount` model. The Admin Web page (`/admin`) supports email-OTP login restricted to `FRAMEQ_ADMIN_EMAIL`, lists users and activation codes, and creates new 31-day codes with a configurable 1-365 day redemption window. Server endpoints `/api/desktop/activation-codes/redeem` and `POST /admin/api/activation-codes` cover the user and admin paths respectively, and WeChat routes are conditionally registered only when `WECHAT_PAY_ENABLED=1`.

Validation passed: `npm --prefix server test` (7 files, 22 tests), `npm --prefix server run build`, `npm --prefix app test` (10 files, 55 tests), `npm --prefix app run build`, `cargo test --manifest-path app/src-tauri/Cargo.toml` (23 tests), `npm --prefix server run db:push` (synced the local SQLite schema), and `python scripts/validate_agents_docs.py --level WARN` (0 errors, 0 warnings).

Residual risk: a single administrator email means the Admin surface is a single point of failure; the temporary mitigation is keeping the WeChat code behind `WECHAT_PAY_ENABLED=1` for emergency rollback, and a future plan can introduce a small admin role table if more operators are needed.

## Context and Orientation

- `docs/product-specs/2026-06-21-activation-code-authorization.md` is the durable product spec this plan implements.
- `server/src/activation.ts` owns `ActivationCodeService.generateCode` and `redeemCode`, normalization, hash computation, and the `LLM_QUOTA_PER_ACTIVATION` constant.
- `server/src/adminAuth.ts` owns `AdminAuthService.startEmailLogin`, `verifyEmailCode`, `authenticate`, `validateCsrf`, the `FRAMEQ_ADMIN_EMAIL` allowlist, and the 12-hour `adminSessionMaxAgeSeconds`.
- `server/src/adminPage.ts` renders `/admin/login` and `/admin`, including the activation code table, the "创建激活码" form, and the existing LLM config and per-user quota views.
- `server/src/server.ts` wires `/admin/login`, `/admin/auth/email/start`, `/admin/auth/email/verify`, `/admin/auth/logout`, `/admin`, `/admin/api/activation-codes`, `/api/desktop/activation-codes/redeem`, and the conditionally-registered WeChat routes.
- `server/src/store.ts` and `server/src/prismaStore.ts` own the `ActivationCode` and `AdminSession` records and their CRUD helpers.
- `server/prisma/schema.prisma` defines the `ActivationCode` and `AdminSession` models and the `User.redeemedCodes` relation.
- `server/tests/activation.test.ts`, `server/tests/admin.test.ts`, and the activation-code / WeChat-disabled cases in `server/tests/routes.test.ts` cover generation, redemption, admin OTP, admin cookies, and route gating.
- `app/src-tauri/src/account.rs` owns the `redeem_activation_code` Tauri command, the `build_activation_redeem_url` helper, and the bearer-authenticated `POST /api/desktop/activation-codes/redeem` call.
- `app/src/accountClient.ts` adds `redeemActivationCode` and maps the server `AccountStatus` response into the shared `AccountStatus` model used by the paywall.
- `app/src/accountState.ts` keeps `canProcessWithAccount` as the single processing gate; the AccountSheet input and button are gated on `account.authenticated && !canProcessWithAccount(account)`.
- `app/src/features/account/AccountSheet.tsx` renders the activation code input, the "兑换激活码" button, the "月卡已生效" / "兑换中" copy states, and the "兑换成功后将为当前邮箱增加 31 天权益" hint.
- `docs/ARCHITECTURE.md` and `docs/SECURITY.md` document the activation-code source, the admin allowlist, and the hash-only storage rule.

## Plan of Work

1. Spec and governance
   - Write `docs/product-specs/2026-06-21-activation-code-authorization.md` and the active plan before any code change.
   - Update product, architecture, design, security, and TASKS.md to describe the activation-code authorization and the disabled-by-default WeChat fallback.
2. Service (`server/`)
   - Add Prisma `ActivationCode` and `AdminSession` models, store helpers, and `db:push` migrations.
   - Implement `ActivationCodeService.generateCode` (hash + prefix + 31-day default) and `redeemCode` (single-use, max(now, currentExpiry) extension, 20-quota stack).
   - Implement `AdminAuthService` with the `FRAMEQ_ADMIN_EMAIL` allowlist, rate-limited OTP, hash-stored session/CSRF, and constant-time failure messages.
   - Render the Admin login and dashboard pages with structured HTML for OTP login, activation code list, and the "创建激活码" form (default 30-day redeem window, 1-365 day range).
   - Wire `/admin/login`, `/admin/auth/email/{start,verify,logout}`, `/admin`, `/admin/api/activation-codes`, and `/api/desktop/activation-codes/redeem`; gate the WeChat routes on `WECHAT_PAY_ENABLED=1`.
   - Cover generation, redemption, admin OTP, admin session cookies, CSRF, and the WeChat-disabled route behavior with focused Vitest suites.
3. Desktop Tauri bridge
   - Add `redeem_activation_code` to `app/src-tauri/src/account.rs` with the bearer-authenticated `POST /api/desktop/activation-codes/redeem` call and shared `AccountStatusView` mapping.
   - Register the new command in `app/src-tauri/src/lib.rs` and add a focused Rust test pinning the request shape.
4. Frontend
   - Add `redeemActivationCode` to `app/src/accountClient.ts` and the matching Vitest case.
   - Replace the WeChat checkout button in `AccountSheet.tsx` with the activation code input, the "兑换激活码" primary action, the loading / "月卡已生效" copy states, and the redemption hint.
   - Keep `canProcessWithAccount` as the single processing gate; cover the input and redeem flow with frontend tests.
5. Validation
   - Run `npm --prefix server test`, `npm --prefix server run build`, `npm --prefix server run db:push`, `npm --prefix app test`, `npm --prefix app run build`, `cargo test --manifest-path app/src-tauri/Cargo.toml`, and `python scripts/validate_agents_docs.py --level WARN`.

## Validation and Acceptance

- `npm --prefix server test` passes, including `activation`, `admin`, and the activation-code / WeChat-disabled cases in `routes.test.ts`.
- `npm --prefix server run build` passes (TypeScript typecheck via `tsc --noEmit`).
- `npm --prefix server run db:push` syncs the local SQLite schema, including the new `ActivationCode` and `AdminSession` tables.
- `npm --prefix app test` passes, covering `accountClient` (`redeemActivationCode`) and the `canProcessWithAccount` paywall model.
- `npm --prefix app run build` passes.
- `cargo test --manifest-path app/src-tauri/Cargo.toml` passes, including the new `redeem_activation_code` test.
- `python scripts/validate_agents_docs.py --level WARN` passes.
- Manual follow-up: as administrator, log in to `/admin`, generate a 31-day code, paste it into the desktop account sheet as a signed-in user, confirm `can_process = true`, and confirm a second redemption attempt returns the generic "Activation code is invalid or expired." error.
