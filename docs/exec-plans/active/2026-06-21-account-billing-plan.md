# Account Login and WeChat Billing ExecPlan

## Goal

Add a small cloud account service and desktop paywall so FrameQ can require a valid 9.9 yuan monthly pass before starting new local processing jobs.

## Decisions

- Use TypeScript Fastify for the service.
- Use Prisma with a private SQLite database at `server/data/frameq.sqlite`.
- Enable SQLite WAL mode and deploy the service as a single writer.
- Use SMTP for email OTP delivery.
- Use passwordless email login and opaque desktop session tokens.
- Use `frameq://auth/callback` deep links for desktop login completion.
- Use WeChat Native scan payment, CNY 9.90 (`990` fen), manual 31-day monthly pass.
- Gate only new video processing and insight retry. History, settings, login, and local output viewing remain available.
- Do not send video/audio/transcript/LLM key data to the account service.

## Implementation Tasks

- Update governance docs and ignore rules for the account/payment boundary.
- Add `server/` package, Prisma schema, migrations, config, database helpers, auth services, payment services, routes, and focused tests.
- Add desktop account/session storage, auth URL generation, deep-link validation, server API client, and Tauri commands.
- Add frontend account client, account state model, paywall checks, login/payment sheet UI, and QR-code rendering.
- Add unit and browser regression tests for the login/paywall/payment states.
- Run server, app, Rust, and governance gates.

## Progress

- [x] Governance docs and ignore rules updated.
- [x] Server package and Prisma SQLite schema added.
- [x] Auth, session, entitlement, order, and webhook logic implemented.
- [x] Tauri account/billing commands implemented.
- [x] React account/paywall UI implemented.
- [x] Verification gates passed.
- [x] Existing desktop window restores and focuses when browser login returns through `frameq://auth/callback`.

## Validation Results

2026-06-21 implementation gates passed:

- `npm --prefix server test`
- `npm --prefix server run build`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `python scripts/validate_agents_docs.py --level WARN`

2026-06-25 deep-link foreground fix:

- `cargo test --manifest-path app\src-tauri\Cargo.toml deep_link_activation_brings_existing_main_window_forward`

## Validation

- `npm --prefix server test`
- `npm --prefix server run build`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `python scripts/validate_agents_docs.py --level WARN`
