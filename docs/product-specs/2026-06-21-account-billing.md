# FrameQ Account Entitlement Draft

This draft is retired as a product source of truth for self-serve WeChat purchase.

The planned desktop-visible unlock path is email login plus an account-bound activation code
self-requested from the account sheet and delivered by email. The user-facing entitlement remains
a monthly pass: redeeming a code opens a 31-day monthly pass and grants the configured LLM API-call
quota. Administrator-issued universal codes remain available, but no longer require per-user
participation in the default flow.

WeChat purchase is paused because of WeChat approval requirements. Payment routes and code may remain for later use, but the ordinary desktop client and support documentation must not present WeChat purchase as an available channel unless the product explicitly re-enables it.

Keep new product, UI, deployment, and support documentation aligned to the activation-code monthly pass flow:

- A user signs in with email OTP.
- An inactive or expired signed-in desktop user requests an account-bound code by email.
- The same desktop user manually redeems that code in the account sheet.
- An administrator may still create universal one-time activation codes in Admin Web.
- Redemption grants a 31-day monthly pass entitlement and the configured LLM API-call quota.
- History, settings, local output viewing, and generated files remain available according to the normal local-first rules.

Use `docs/product-specs/2026-08-24-self-service-email-activation-code.md` and later
account/entitlement specs for current requirements.
