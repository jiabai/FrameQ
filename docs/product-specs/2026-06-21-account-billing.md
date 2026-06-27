# FrameQ Account Entitlement Draft

This draft is retired as a product source of truth.

The current desktop-visible unlock path is email login plus administrator-issued activation codes. Keep new product, UI, deployment, and support documentation aligned to the activation-code flow:

- A user signs in with email OTP.
- An administrator creates one-time activation codes in Admin Web.
- A signed-in desktop user redeems a code in the account sheet.
- Redemption grants a 31-day processing entitlement and the configured insight-generation quota.
- History, settings, local output viewing, and generated files remain available according to the normal local-first rules.

Use `docs/product-specs/2026-06-21-activation-code-authorization.md` and later account/entitlement specs for current requirements.
