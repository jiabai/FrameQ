# Account Entitlement Foundation Plan

This completed plan is retained only as a historical marker for the account and entitlement foundation. It is not the current product source of truth.

## Current Meaning

FrameQ's desktop-visible unlock path is email login plus administrator-issued activation codes. New product, design, deployment, and support documentation should describe that flow directly.

The durable current requirements live in:

- `docs/product-specs/2026-06-21-activation-code-authorization.md`
- `docs/product-specs/2026-06-22-server-managed-llm-quota.md`
- `docs/product-specs/2026-06-27-admin-entitlement-adjustments.md`

## Historical Scope

This work established the server-side account foundation:

- Email OTP login.
- Desktop session exchange through `frameq://auth/callback`.
- SQLite-backed account and entitlement state.
- Client-side gating before new processing and insight retry.
- Local-first boundary: videos, audio, transcripts, generated files, local model cache, cookies, and local configuration stay on the user's machine.

## Current Verification References

Use the latest account, activation-code, quota, and Admin Web test suites for verification instead of this retired plan.
