# Server-Managed LLM Config and Monthly Quota

FrameQ should let paid users generate insight topics without configuring an LLM locally. The administrator manages a dedicated FrameQ-client LLM key on the server, and the desktop client retrieves it only when a signed-in user with active entitlement starts insight generation.

## Requirements

- Desktop settings no longer expose insight LLM base URL, API key, model, or timeout.
- Admin Web can configure provider, base URL, model, timeout, and the dedicated FrameQ client API key.
- The LLM API key is encrypted before being stored in SQLite and is never fully displayed in Admin responses.
- Each 31-day activation grants 20 insight-generation uses.
- A generation attempt consumes 1 use when it starts, even if the worker makes multiple underlying chat-completion calls.
- Renewing before expiry extends entitlement and adds 20 more uses; reactivating after expiry starts a fresh 31-day window with 20 uses and 0 used.
- Account status shows entitlement and remaining insight-generation uses.
- Users with no entitlement, expired entitlement, no remaining uses, or missing server LLM config cannot start new processing or retry insight generation.

## Security Boundary

- The service stores and distributes only a dedicated supplier key for FrameQ clients, never the supplier master key.
- Transport relies on HTTPS; FrameQ does not use custom response-body encryption as a primary security boundary.
- Because the key is delivered to the desktop runtime, a sufficiently advanced user may extract it. The mitigation is a dedicated, revocable, low-blast-radius supplier key.
- The service does not proxy LLM requests and does not receive videos, audio, transcripts, generated insights, local history, cookies, or user local configuration.

## Acceptance Criteria

- Admin can save and replace the LLM config, including a new API key, without the key being exposed back in full.
- A desktop user can redeem an activation code and see 20 available insight uses.
- Starting insight generation checks out one use and receives LLM config.
- Reusing the same checkout request ID does not double-charge.
- When uses reach 0, the desktop client blocks new processing and retry with an account-panel explanation.
