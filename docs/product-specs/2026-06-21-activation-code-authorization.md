# FrameQ Activation Code Authorization Spec

## Background

WeChat merchant onboarding adds review and certification cost that is too high for the first small-user release. FrameQ should keep the email account login flow and replace the first visible paid unlock path with administrator-issued activation codes.

## Goals

- Let signed-in desktop users redeem a one-time activation code to unlock processing.
- Let the sole administrator, `lantianye@163.com`, generate and inspect activation codes through a server-hosted Admin Web page.
- Reuse the existing `Entitlement` record as the only processing gate.
- Keep videos, audio, transcripts, history, local model cache, and LLM keys on the user's machine.

## User-visible Requirements

- The account sheet shows an activation code input instead of WeChat scan payment.
- A signed-in user can paste an activation code and redeem it.
- Successful redemption extends the user's entitlement by 31 days from the later of now or the current entitlement expiry.
- Invalid, expired, or already redeemed codes show a generic actionable error.
- Users without an active entitlement remain blocked from new processing and insight retry.

## Admin Requirements

- Admin login uses email OTP and only allows `FRAMEQ_ADMIN_EMAIL`, defaulting to `lantianye@163.com`.
- Admin sessions are stored in HttpOnly cookies and expire after 12 hours.
- The Admin page can generate one-time 31-day activation codes with a default 30-day redemption deadline.
- The Admin page lists users, current entitlement status, and activation code status.
- Full activation codes are shown only immediately after generation; the database stores hashes and a short prefix only.

## Non-goals

- No public self-serve payment, invoice, refund, coupon marketplace, or multi-admin role system in this version.
- No automatic renewal and no paid-plan tiering beyond the fixed 31-day activation code.
- WeChat payment code may remain in the repository for later, but the client must not expose it by default.

## Acceptance Criteria

- Admin can log in with `lantianye@163.com`, generate a code, and see it listed without full plaintext storage.
- A desktop user can redeem a valid code once and immediately receives `can_process=true`.
- Reusing the same code, redeeming an expired code, or using a wrong code does not extend entitlement.
- The WeChat checkout path is disabled unless `WECHAT_PAY_ENABLED=1`.

