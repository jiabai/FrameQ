# Activation Code Authorization Plan

This completed plan records the current visible unlock model for FrameQ's first small-user release.

## Purpose / Big Picture

The desktop account sheet lets a signed-in user paste an administrator-issued activation code, redeem it once, and receive processing entitlement plus insight-generation quota. The sole administrator manages these codes through the server-hosted Admin Web page.

Videos, audio, transcripts, history, local model cache, local configuration, and generated files remain on the user's machine.

## Completed Scope

- Added hash-only activation-code generation and single-use redemption.
- Added Admin Web login restricted by `FRAMEQ_ADMIN_EMAIL`.
- Added Admin Web activation-code list/create flow.
- Added desktop activation-code redemption through the existing account sheet.
- Kept `Entitlement` as the single processing gate for new video processing and insight retry.
- Added tests for generation, redemption, admin auth, account state mapping, and desktop redemption.

## Key Decisions

- Store only activation-code hashes plus short prefixes; show plaintext only immediately after generation.
- Extend entitlement from `max(now, currentExpiry)` so renewal does not shorten an active user.
- Stack the configured insight quota on successful redemption.
- Keep Admin Web intentionally small: one administrator email, short-lived HttpOnly cookies, and CSRF validation.

## Validation

The original implementation passed the server, app, Rust, database-sync, build, and governance checks recorded at completion. For current work, run the latest project gates listed in `AGENTS.md` and `README.md`.
