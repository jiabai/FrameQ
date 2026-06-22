# Activation Code Authorization ExecPlan

## Goal

Replace the first visible WeChat payment unlock flow with administrator-issued activation codes while preserving the existing account login and entitlement gate.

## Decisions

- Add activation codes to the SQLite/Prisma service.
- Store activation code hashes only; show plaintext once at generation.
- Use 31-day single-use codes with a default 30-day redemption deadline.
- Use `FRAMEQ_ADMIN_EMAIL`, default `lantianye@163.com`, for Admin OTP login.
- Disable WeChat routes unless `WECHAT_PAY_ENABLED=1`; keep code for future reuse.

## Implementation Tasks

- Update product/security/architecture/design/task docs for activation-code authorization.
- Add service tests for activation code generation, redemption, Admin OTP, Admin session cookies, and WeChat disabled behavior.
- Add Prisma/store support for `ActivationCode` and `AdminSession`.
- Add server activation/admin services and routes.
- Add Tauri `redeem_activation_code` command and API mapping.
- Replace the client payment sheet with activation code input and redemption states.
- Run server, app, Rust, and docs gates.

## Progress

- [x] Documentation updated.
- [x] Server tests added and red.
- [x] Server implementation complete.
- [x] Desktop command and frontend UI complete.
- [x] Verification gates passed.

## Validation

- `npm --prefix server test`
- `npm --prefix server run build`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `python scripts/validate_agents_docs.py --level WARN`

## Results

- `npm --prefix server test` passed: 7 files, 22 tests.
- `npm --prefix server run build` passed.
- `npm --prefix app test` passed: 10 files, 55 tests.
- `npm --prefix app run build` passed.
- `cargo test --manifest-path app/src-tauri/Cargo.toml` passed: 23 tests.
- `npm --prefix server run db:push` synced the local SQLite schema.
- `python scripts/validate_agents_docs.py --level WARN` passed: 0 errors, 0 warnings.
