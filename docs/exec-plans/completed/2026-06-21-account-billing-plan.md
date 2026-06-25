# Account Login and WeChat Billing Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ's first paid release needs a small cloud account service and a desktop paywall so the app can require a valid 9.9 yuan monthly pass before starting new local processing jobs. After this change, a user starts login from the desktop client, completes email verification in a server-hosted browser page, returns to the desktop through a `frameq://auth/callback` deep link that brings the existing window forward, and can buy a 31-day monthly pass via WeChat Native scan payment. New video processing and insight retry are gated by the entitlement; history, settings, login, and local output viewing remain available. Video, audio, transcript, LLM key, cookies, and local configuration data stay on the user's machine and are not sent to the account service.

## Progress

- [x] 2026-06-21: Spec and active plan written before implementation (`docs/product-specs/2026-06-21-account-billing.md`).
- [x] 2026-06-21: Governance docs and ignore rules updated for the new account/payment boundary (`.gitignore` excludes `server/data/`, `server/logs/`, `server/backups/`, `*.sqlite*`).
- [x] 2026-06-21: Added `server/` Fastify + Prisma + SQLite package with WAL, schema, migrations, and database helpers. Validation: `npm --prefix server run build`.
- [x] 2026-06-21: Implemented email OTP, opaque desktop session tokens, deep-link ticket exchange, entitlement model, WeChat Native order creation (`990` fen), and idempotent webhook decryption + signature verification. Validation: `npm --prefix server test`.
- [x] 2026-06-21: Added Tauri account/session storage, auth URL + state generation, `frameq://auth/callback` validation, server API client, and account/billing commands in `app/src-tauri/src/account.rs`. Validation: `cargo test --manifest-path app/src-tauri/Cargo.toml`.
- [x] 2026-06-21: Added frontend account client (`app/src/accountClient.ts`), account state model (`app/src/accountState.ts`), paywall checks, account sheet UI with QR rendering (`app/src/features/account/AccountSheet.tsx`), and unit tests. Validation: `npm --prefix app test`, `npm --prefix app run build`.
- [x] 2026-06-21: Ran full validation gates and recorded outcomes. Validation: `python scripts/validate_agents_docs.py --level WARN`.
- [x] 2026-06-25: Fixed existing desktop window restore, show, and focus when the browser login returns through `frameq://auth/callback`. Validation: `cargo test --manifest-path app\src-tauri\Cargo.toml deep_link_activation_brings_existing_main_window_forward`.

## Surprises & Discoveries

- Evidence: `server/data/`, `server/logs/`, `server/backups/`, and `*.sqlite*` are gitignored, so the Prisma database, WAL/SHM files, and any local backup stay on disk without polluting the repo.
- Evidence: `server/package.json` ships `db:push` and `prisma:generate` scripts, and `build` is a typecheck-only `tsc --noEmit`, so CI does not need to run Prisma migrations to validate the type surface.
- Evidence: `app/src-tauri/src/account.rs` keeps `AccountSessionFile` and `pending_auth_state.txt` in the runtime data directory resolved by `resolve_runtime_paths`, so login state survives restarts without leaking into the install dir.
- Evidence: `AccountSheet` reuses the existing modal/header chrome and pulls `canProcessWithAccount` from the shared `accountState` model, so the paywall is enforced both in UI gating and in worker submission paths.
- Evidence: `tauri.conf.json` declares the `frameq` deep-link scheme under `plugins.deep-link.desktop`, and the Tauri `account` commands reject any callback whose `state` does not match the locally persisted `pending_auth_state`, preventing CSRF across browser tabs.
- Evidence: The server stores only session token hashes; the opaque token itself lives only in `account.rs` and the browser redirect, so a server DB leak does not yield usable desktop sessions.
- Evidence: Webhook handler in `server/src/wechat.ts` is idempotent on `WebhookEvent.id`, so replayed WeChat notifications cannot extend the same 31-day entitlement twice.

## Decision Log

- Decision: Build the service in TypeScript Fastify with Prisma + private SQLite at `server/data/frameq.sqlite`. Rationale: the first paid version only needs a single instance with a simple schema; Fastify + Prisma keep the surface small and the deployment story is a single Node process behind the existing reverse proxy. Date/Author: 2026-06-21 / Codex.
- Decision: Enable SQLite WAL at service startup and assume a single writer. Rationale: WAL gives concurrent reads with the desktop client polling status, and a single writer keeps backup/restore semantics obvious without a distributed lock. Date/Author: 2026-06-21 / Codex.
- Decision: Use passwordless email OTP and opaque random desktop session tokens (server stores only token hashes). Rationale: removes the password reset/support surface and keeps the desktop install free of any password material; hash storage limits blast radius if the DB leaks. Date/Author: 2026-06-21 / Codex.
- Decision: Use `frameq://auth/callback` deep links for desktop login completion and persist a per-flow `state` to validate the callback. Rationale: native URL handler is the standard Tauri pattern, the `state` round-trip stops cross-tab CSRF, and the scheme is already declared in `tauri.conf.json`. Date/Author: 2026-06-21 / Codex.
- Decision: Use WeChat Native scan payment at CNY 9.90 (`990` fen) with a manual 31-day monthly pass; extend entitlement from the later of now or existing expiry. Rationale: native scan avoids requiring the merchant to issue JSAPI/OpenID integration in v1, the price matches the spec, and stacking prevents active passes from being shortened by a renewal. Date/Author: 2026-06-21 / Codex.
- Decision: Gate only new video processing and insight retry; leave history, settings, login, and local output viewing available. Rationale: aligns with the spec's paid-feature boundary and lets unpaid users still inspect past work, which is the most common support trigger. Date/Author: 2026-06-21 / Codex.
- Decision: Do not send video, audio, transcript, generated insights, LLM key, cookies, or local configuration to the account service. Rationale: FrameQ stays local-first; the account tier only answers authentication and entitlement questions, and the threat model assumes the service DB is compromisable. Date/Author: 2026-06-21 / Codex.
- Decision: On 2026-06-25, focus and bring the existing desktop window forward when `frameq://auth/callback` is invoked instead of letting the OS ignore the second launch. Rationale: macOS and Windows do not reliably raise an existing Tauri window on a second-instance deep link, and users were confused by the apparent no-op; a focused regression test now pins the behavior. Date/Author: 2026-06-25 / Codex.

## Outcomes & Retrospective

End-to-end implementation delivered against the spec. The desktop client can start an email login from the account sheet, complete OTP verification in the server-hosted browser page, return through `frameq://auth/callback`, persist the opaque session token in the runtime data directory, and display the signed-in email plus entitlement state. Unauthenticated users or users without an active monthly pass see the account sheet instead of starting new processing or insight retry; history, settings, login, and local output viewing remain reachable. The WeChat Native flow creates a `990` fen order, renders the QR via the existing modal, and extends entitlement on a verified webhook; replayed webhook events are deduped by `WebhookEvent.id`. The 2026-06-25 fix ensures an already-open FrameQ window restores and comes to the foreground when the browser callback fires, which was the only post-launch regression.

Validation passed: `npm --prefix server test`, `npm --prefix server run build`, `npm --prefix app test`, `npm --prefix app run build`, `cargo test --manifest-path app/src-tauri/Cargo.toml`, `cargo test --manifest-path app\src-tauri\Cargo.toml deep_link_activation_brings_existing_main_window_forward`, and `python scripts/validate_agents_docs.py --level WARN`.

Residual risk: WeChat webhook delivery delay falls back to merchant-order-number polling, but the polling cadence is a constant; if WeChat is down for longer than that window an order will appear unpaid in the UI even after the merchant side succeeded until the next poll. The `frameq-server` package version is `0.1.0` and has not yet been bumped to track the desktop client (`0.2.0` / `0.2.1`) — release tagging is handled separately and is out of scope for this plan.

## Context and Orientation

- `server/src/index.ts` boots the Fastify app, registers routes, enables SQLite WAL, and starts the listener.
- `server/src/database.ts` and `server/src/prismaStore.ts` own the Prisma client and SQLite connection lifecycle.
- `server/src/auth.ts` issues email OTPs, verifies them with rate limiting, and manages `EmailOtp` / `Session` / `DesktopLoginTicket` rows.
- `server/src/billing.ts` and `server/src/wechat.ts` create WeChat Native orders, verify APIv3 webhook signatures, decrypt resources, and extend `Entitlement`.
- `server/src/email.ts` sends OTP mail through SMTP via nodemailer.
- `server/src/security.ts` centralises session token hashing, signed-state generation, and the deep-link `state` validator.
- `server/src/adminAuth.ts`, `server/src/adminPage.ts`, and `server/src/llmConfig.ts` carry the server-managed LLM quota work that was folded into this server package.
- `server/tests/` covers auth, billing, wechat webhook idempotency, routes, database, email, admin, LLM quota, and updates.
- `app/src-tauri/src/account.rs` owns the desktop `begin_auth_flow`, `complete_auth_flow`, `get_account_status`, and `start_wechat_checkout` commands and persists session + pending state under the runtime data directory.
- `app/src-tauri/src/lib.rs` registers the account commands and wires the deep-link plugin.
- `app/src/accountClient.ts` and `app/src/accountState.ts` are the React-side client and the shared `AccountStatus` state used by the paywall and the account sheet.
- `app/src/features/account/AccountSheet.tsx` renders the QR code, the activation code path, sign-out, and the entitlement status block.
- `app/src-tauri/tauri.conf.json` declares the `frameq` deep-link scheme under `plugins.deep-link.desktop`.
- `docs/product-specs/2026-06-21-account-billing.md` is the durable product spec this plan implements.

## Plan of Work

1. Spec and governance
   - Write `docs/product-specs/2026-06-21-account-billing.md` and the active plan before any code change.
   - Extend `.gitignore` to keep `server/data/`, `server/logs/`, `server/backups/`, and `*.sqlite*` out of the repo.
2. Service (`server/`)
   - Scaffold the Fastify + Prisma + SQLite package with WAL enabled at startup.
   - Add Prisma schema and migrations for `User`, `EmailOtp`, `DesktopLoginTicket`, `Session`, `Order`, `Entitlement`, `WebhookEvent`.
   - Implement email OTP, opaque session tokens (hash on server), and `frameq://auth/callback` ticket exchange.
   - Implement WeChat Native order creation (`990` fen), APIv3 signature verification, resource decryption, idempotent webhook handling, and entitlement extension from `max(now, currentExpiry)`.
   - Cover auth, billing, wechat, routes, database, email, admin, and LLM quota with focused Vitest suites.
3. Desktop Tauri bridge
   - Add `app/src-tauri/src/account.rs` with session/pending-state persistence under the runtime data directory and signed `state` for CSRF protection.
   - Expose `begin_auth_flow`, `complete_auth_flow`, `get_account_status`, and `start_wechat_checkout` commands.
   - Register the `frameq` deep-link scheme and route callbacks into the account commands.
   - Add a Rust test pinning that an existing main window is restored, shown, and focused on `deep_link_activation`.
4. Frontend
   - Add `accountClient.ts`, `accountState.ts`, and the `AccountSheet` modal with QR rendering, activation code redeem, and sign-out.
   - Gate new video submission and insight retry on `canProcessWithAccount`.
   - Cover clients and state transitions with Vitest unit tests.
5. Deep-link foreground fix (2026-06-25)
   - Ensure an already-open FrameQ window restores, shows, and moves to the foreground when the browser invokes `frameq://auth/callback`.
   - Add a focused regression test named `deep_link_activation_brings_existing_main_window_forward`.
6. Validation
   - Run `npm --prefix server test`, `npm --prefix server run build`, `npm --prefix app test`, `npm --prefix app run build`, `cargo test --manifest-path app/src-tauri/Cargo.toml`, and `python scripts/validate_agents_docs.py --level WARN`.

## Validation and Acceptance

- `npm --prefix server test` passes, including `auth`, `billing`, `wechat`/webhook idempotency, `routes`, `database`, `email`, `admin`, and `llmQuota` suites.
- `npm --prefix server run build` passes (TypeScript typecheck via `tsc --noEmit`).
- `npm --prefix app test` passes, covering `accountClient`, `accountState`, and the paywall gating.
- `npm --prefix app run build` passes.
- `cargo test --manifest-path app/src-tauri/Cargo.toml` passes, including `account` and deep-link tests.
- `python scripts/validate_agents_docs.py --level WARN` passes.
- Manual follow-up: start the server, request an OTP, verify it, exchange a desktop login ticket, confirm the desktop client shows the signed-in email, then trigger a WeChat test order and confirm the entitlement flips to active for 31 days.
- Manual follow-up: with FrameQ already open, complete a login in the browser and confirm the existing desktop window comes to the foreground instead of being ignored.
