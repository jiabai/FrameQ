# Server-Managed LLM Config and Monthly Quota

FrameQ should let paid users generate insight topics without configuring an LLM locally. The administrator manages a dedicated FrameQ-client LLM key on the server, and the desktop client retrieves it only when a signed-in user with active entitlement starts insight generation.

## Requirements

- Desktop settings no longer expose insight LLM base URL, API key, model, or timeout.
- Admin Web can configure provider, base URL, model, timeout, and the dedicated FrameQ client API key.
- The LLM API key is encrypted before being stored in SQLite and is never fully displayed in Admin responses.
- Each 31-day activation grants 20 AI Credits.
- Administrators may add quota only through the audited entitlement-adjustment operation. FrameQ has no supported administrator flow to silently set, reduce, or reset a user's remaining quota.
- One AI Credit is consumed per cloud LLM chat-completion/API call attempt, not per AI整理 generation attempt. A single confirmed AI整理 run may therefore consume multiple Credits when the worker generates Mermaid mindmap, summary, topic planning, and insight-topic details through separate LLM calls.
- The desktop/worker/server accounting boundary must authorize or record one AI Credit for each supplier LLM API call attempt. Reusing the same per-call checkout/request ID must not double-charge that same call attempt.
- Distinct concurrent checkout IDs must not overrun the remaining balance. Server checkout uses one
  database conditional entitlement update and the unique per-call usage event in the same
  transaction; an event-write failure rolls back the increment.
- Renewing before expiry extends entitlement and adds 20 more AI Credits; reactivating after expiry starts a fresh 31-day window with 20 Credits and 0 used.
- Account status shows entitlement and remaining AI Credits. User-facing copy must not present this balance as a guaranteed number of AI-generation actions.
- `/api/desktop/account` exposes separate gates: `can_process` means the signed-in user has an active entitlement for local video/audio/ASR processing; `can_generate_ai` means the user can start a confirmed AI output and therefore also requires server LLM config plus remaining quota.
- Users with no entitlement or expired entitlement cannot start local processing or AI generation. Users with no remaining Credits or missing server LLM config can still run local transcription, but cannot start summary or inspiration generation.

## Security Boundary

- The service stores and distributes only a dedicated supplier key for FrameQ clients, never the supplier master key.
- Transport relies on HTTPS; FrameQ does not use custom response-body encryption as a primary security boundary.
- Because the key is delivered to the desktop runtime, a sufficiently advanced user may extract it. The mitigation is a dedicated, revocable, low-blast-radius supplier key.
- The service does not proxy LLM requests and does not receive videos, audio, transcripts, generated insights, local history, cookies, or user local configuration.

## Acceptance Criteria

- Admin can save and replace the LLM config, including a new API key, without the key being exposed back in full.
- A desktop user can redeem an activation code and see 20 available AI Credits.
- Starting AI整理 checks account/config readiness before the first LLM call, then consumes one AI Credit per LLM API call attempt made during that AI整理; one AI整理 may consume multiple Credits.
- Reusing the same per-call checkout/request ID does not double-charge that same LLM API call attempt.
- Independent Prisma clients racing distinct IDs for the final Credit permit exactly one consumed
  result; racing the same ID consumes once and subsequent safe retry returns the existing checkout.
- When Credits reach 0, the desktop client blocks summary/inspiration generation with an account-panel explanation; local video extraction and ASR transcription remain available for signed-in users with active entitlement.
- An administrator quota grant increases `llmQuotaLimit`, preserves `llmQuotaUsed`, and creates an append-only record with administrator, user, reason, before/after values, and timestamp in the same transaction.
