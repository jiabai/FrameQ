# FrameQ Account Login and WeChat Monthly Pass Spec

## Background

FrameQ currently works as a local-first desktop utility. The first paid release needs a small account service so users can log in with email, buy a monthly pass through WeChat Native scan payment, and let the desktop client verify whether new processing jobs are allowed.

## Goals

- Let users start login from FrameQ, complete email verification in a server-hosted browser page, and return to the desktop client through `frameq://auth/callback`.
- When the browser opens `frameq://auth/callback`, an already-running FrameQ desktop window must restore, show, and move to the foreground before completing the login callback.
- Use email one-time codes instead of passwords.
- Use WeChat Native payment for a manual monthly pass priced at CNY 9.90.
- Unlock new video processing and insight retry only when the desktop client has a valid paid entitlement.
- Keep video files, audio files, transcripts, history, local model cache, and LLM keys on the user's machine.

## Non-goals

- No automatic renewal, delegated withholding, refunds console, invoice system, admin console, or multi-device limit in the first version.
- No cloud upload of videos, audio, transcripts, generated insights, LLM keys, cookies, or local configuration.
- No bundled WeChat merchant secret, SMTP password, APIv3 key, or certificate private key in the desktop installer.

## User-visible Requirements

- The toolbar exposes an account entry showing login/payment status.
- Clicking login opens the service login page in the user's browser.
- The login page asks for an email address, sends a verification code, and verifies the code.
- After successful verification the page redirects to `frameq://auth/callback?ticket=...&state=...`.
- FrameQ validates the `state`, exchanges the single-use `ticket` for a desktop session, and displays the signed-in email.
- If the user is not signed in or has no active pass, submitting a video URL or retrying insight generation opens the account/payment sheet instead of starting worker processing.
- The payment sheet shows CNY 9.90, a WeChat scan QR code, order expiration, and a refresh status action.
- When payment succeeds, the user's entitlement becomes active for 31 days from the later of now or the existing entitlement expiry.
- Login and payment failures must show actionable messages without exposing internal stack traces or secrets.

## Service Requirements

- Add a TypeScript Fastify service under `server/`.
- Use Prisma with SQLite at `server/data/frameq.sqlite` by default.
- Enable SQLite WAL mode at service startup and assume a single service instance writes to the database.
- Data model includes `User`, `EmailOtp`, `DesktopLoginTicket`, `Session`, `Order`, `Entitlement`, and `WebhookEvent`.
- Email codes expire after 10 minutes, allow at most 5 verification attempts, and are rate-limited per email and IP.
- Desktop sessions use opaque random tokens. The server stores only token hashes.
- WeChat Native payment creates a `990` fen order and returns `code_url` to the desktop client.
- WeChat webhook handling verifies signatures, decrypts APIv3 resources, records webhook IDs idempotently, and extends entitlement on successful payment.
- If webhook delivery is delayed, order-status polling may query WeChat by merchant order number as a reconciliation fallback.

## Acceptance Criteria

- A development user can start the server, request an OTP, verify it, exchange a desktop login ticket, and see an authenticated account status.
- A desktop user without an active entitlement cannot start new processing or insight retry.
- A desktop user with an active entitlement can start the existing local worker flow.
- A WeChat Native order is created for exactly `990` fen and can become `paid` through the webhook or test payment adapter.
- Replayed WeChat notifications do not extend entitlement more than once for the same payment.
- SQLite database, WAL/SHM files, local backups, and secrets are not tracked by git.
