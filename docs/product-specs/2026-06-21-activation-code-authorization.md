# FrameQ Activation Code Authorization Spec

## Background

FrameQ's first small-user release should keep the email account login flow and use administrator-issued activation codes as the visible monthly pass unlock path.

The monthly pass is the user-facing entitlement name: one successful activation grants 31 days of processing access plus the configured LLM API-call quota. The activation code is the current distribution and redemption method for that monthly pass. WeChat purchase remains a future purchase channel, but it is paused for the first release because of WeChat approval requirements; any WeChat payment code may remain in the repository but must stay disabled and hidden from ordinary users by default.

## Goals

- Let signed-in desktop users redeem a one-time activation code to open a 31-day monthly pass for processing.
- Let the sole administrator, `lantianye@163.com`, generate and inspect activation codes through a server-hosted Admin Web page.
- Reuse the existing `Entitlement` record as the only processing gate.
- Keep videos, audio, transcripts, history, and local model cache on the user's machine. LLM key/config is managed by FrameQ server, not desktop `.env`.

## User-visible Requirements

- The account sheet shows an activation code input after email login when the user has no active monthly pass entitlement.
- A signed-in user can paste an activation code and redeem it.
- Successful redemption opens or extends the user's monthly pass entitlement by 31 days from the later of now or the current entitlement expiry.
- Invalid, expired, or already redeemed codes show a generic actionable error.
- Users without an active entitlement remain blocked from new processing and insight retry.

## Admin Requirements

- Admin login uses email OTP and only allows `FRAMEQ_ADMIN_EMAIL`, defaulting to `lantianye@163.com`.
- Admin sessions are stored in HttpOnly cookies and expire after 12 hours.
- The Admin page can generate one-time activation codes for 31-day monthly passes with a default 30-day redemption deadline.
- The Admin page lists users, current entitlement status, and activation code status.
- Full activation codes are shown only immediately after generation; the database stores hashes and a short prefix only.

## Non-goals

- No public self-serve checkout, WeChat purchase entry, invoice, refund, coupon marketplace, or multi-admin role system in this version.
- No automatic renewal and no paid-plan tiering beyond the fixed 31-day activation code.
- WeChat purchase is paused because of WeChat approval requirements. It may be kept as disabled code for later use, but it must not be exposed unless the product explicitly re-enables that channel.

## Acceptance Criteria

- Admin can log in with `lantianye@163.com`, generate a code, and see it listed without full plaintext storage.
- A desktop user can redeem a valid code once and immediately receives an active monthly pass with `can_process=true`.
- Reusing the same code, redeeming an expired code, or using a wrong code does not extend the monthly pass entitlement.

