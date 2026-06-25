# Server-Managed LLM Config and Monthly Quota Plan

## Goal

Move insight-topic LLM configuration out of the desktop settings UI and into the FrameQ server Admin Web while keeping LLM calls in the desktop worker. Add per-user monthly insight-generation quota tied to activation-code entitlements.

## Progress

- [x] Write failing server tests for encrypted LLM config, checkout idempotency, and entitlement quota.
- [x] Implement server data model, services, routes, and Admin UI.
- [x] Write failing worker/Tauri tests for server-managed checkout and one-charge-per-generation.
- [x] Implement worker checkout client and Tauri env/session propagation.
- [x] Write failing frontend tests for quota status and settings UI removal.
- [x] Implement frontend account quota display and gating.
- [x] Run gates and record results.

## Decisions

- Each activation grants 20 insight-generation uses.
- Checkout charges at generation start.
- One visible insight-generation attempt consumes one use, regardless of internal LLM request count.
- Pre-expiry renewal adds 20 uses; post-expiry reactivation resets used count and grants 20 uses.
- Admin edits remaining uses directly.
- The supplier key is a dedicated FrameQ client key; it can be revoked or rotated outside FrameQ if abused.
- No server-side LLM proxy in this version.

## Verification

- `npm --prefix server test`
- `npm --prefix server run build`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `uv run pytest worker\tests`
- `uv run ruff check worker`
- `python scripts/validate_agents_docs.py --level WARN`

## Validation Results

2026-06-26 final gates passed:

- `npm --prefix server test` — 32 passed.
- `npm --prefix server run build` — passed.
- `npm --prefix app test` — 84 passed.
- `npm --prefix app run build` — passed.
- `cargo test --manifest-path app/src-tauri/Cargo.toml` — 31 passed.
- `uv run pytest worker\tests` — 99 passed.
- `uv run ruff check worker` — passed.
- `python scripts/validate_agents_docs.py --level WARN` — 0 errors, 0 warnings.
