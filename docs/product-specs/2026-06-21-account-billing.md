# FrameQ Account Entitlement Draft

This draft is retired as a product source of truth for self-serve WeChat purchase.

The current desktop-visible unlock path is email login plus administrator-issued activation codes. The user-facing entitlement is still a monthly pass: redeeming a code opens a 31-day monthly pass and grants the configured LLM API-call quota.

WeChat purchase is paused because of WeChat approval requirements. Payment routes and code may remain for later use, but the ordinary desktop client and support documentation must not present WeChat purchase as an available channel unless the product explicitly re-enables it.

Keep new product, UI, deployment, and support documentation aligned to the activation-code monthly pass flow:

- A user signs in with email OTP.
- An administrator creates one-time activation codes in Admin Web.
- A signed-in desktop user redeems a code in the account sheet.
- Redemption grants a 31-day monthly pass entitlement and the configured LLM API-call quota.
- History, settings, local output viewing, and generated files remain available according to the normal local-first rules.

Use `docs/product-specs/2026-06-21-activation-code-authorization.md` and later account/entitlement specs for current requirements.
