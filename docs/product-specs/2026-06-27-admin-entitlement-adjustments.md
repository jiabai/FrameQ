# Admin Entitlement Adjustment and Compensation Spec

## Background

FrameQ is still stabilizing. When a user loses time or LLM API-call quota because of a product bug, platform download instability, release regression, or support incident, the administrator needs a controlled way to compensate that user without issuing a new activation code. The compensation path should extend the user's entitlement expiry and add LLM API-call uses while preserving the existing account, activation, and quota model.

## Goals

- Let the configured administrator manually extend a user's entitlement expiry from Admin Web.
- Let the configured administrator manually add LLM API-call quota to a user after a support incident.
- Keep the desktop client account contract unchanged: `/api/desktop/account` continues to return entitlement status, expiry, quota limit, quota used, quota remaining, reset time, and `can_process`.
- Record every manual adjustment with administrator identity, reason, optional support note, before/after entitlement values, and timestamp.
- Make compensation visible in Admin Web so future support work can understand why a user's expiry or quota changed.

## Non-goals

- No public self-service compensation request flow.
- No multi-admin role system or delegated support-agent permissions in this version.
- No automatic bug detection, SLA engine, coupon marketplace, refund console, invoice integration, or negative punitive adjustment workflow.
- No desktop UI for asking users to edit their own expiry or quota.

## Admin Requirements

- Admin Web should add a "用户补偿" or "权益调整" control near the user/entitlement table.
- The administrator can search or select a signed-in user by email.
- The administrator can extend entitlement by a number of days using `base = max(now, current expiresAt)` and can optionally set an absolute `expiresAt` for repair cases.
- The administrator can add a positive number of LLM API-call uses. The default operation should increase `llmQuotaLimit` by the added amount and preserve `llmQuotaUsed`, so already consumed uses remain auditable.
- If the user has no entitlement record, the compensation flow may create one with `expiresAt = now + extendDays` and `llmQuotaLimit = addedUses`, `llmQuotaUsed = 0`.
- Every adjustment must require a structured reason such as `bug_compensation`, `support_goodwill`, `manual_repair`, or `other`, plus an optional note for bug ID, chat record, or release version.
- The response should show the updated expiry and quota remaining immediately, and the Admin page should refresh or update the row without requiring a server restart.

## Service Requirements

- Add an admin-only API such as `POST /admin/api/users/:userId/entitlement-adjustments`.
- The route must use the existing Admin session cookie and `x-frameq-csrf` validation.
- Request payload should accept:
  - `extend_days?: number`
  - `expires_at?: ISO-8601 string`
  - `quota_add?: number`
  - `reason: string`
  - `note?: string`
- At least one of `extend_days`, `expires_at`, or `quota_add` must be present.
- `quota_add` must be non-negative in v1 and should have a practical upper bound to prevent accidental large grants.
- `extend_days` should have a practical upper bound, for example 365 days per operation.
- Store an audit record, for example `AdminEntitlementAdjustment`, containing `id`, `adminEmail`, `userId`, `reason`, `note`, before/after expiry, before/after quota limit, before/after quota used, and `createdAt`.
- The existing direct remaining-quota edit route may remain for repair, but compensation should prefer the new additive adjustment path because it better matches "奖励用户" and preserves usage history.

## User-visible Behavior

- A compensated user sees the updated expiry and remaining LLM API-call uses the next time the desktop client refreshes account status.
- If the compensation makes the user active and leaves quota remaining, `can_process` becomes true once server-managed LLM config is also available.
- No video, audio, transcript, history, model cache, cookie, or local configuration data is sent to the server as part of compensation.

## Security and Compliance

- Only the configured Admin Web account may perform manual adjustments.
- Admin write routes must keep HttpOnly session cookie validation and CSRF validation.
- Adjustment notes must not contain API keys, cookies, transcripts, private video URLs, or user-local file paths.
- Audit records must be append-only from the application perspective; later correction should create a new adjustment rather than rewriting history.
- Logs should record adjustment IDs and user IDs or emails, but not sensitive notes if those notes might contain support details.

## Acceptance Criteria

- Admin can extend an active user's expiry by N days from the later of now or current expiry.
- Admin can reactivate an expired or missing-entitlement user by adding days.
- Admin can add positive LLM API-call uses without changing `llmQuotaUsed`.
- Desktop account status reflects the updated expiry and `llm_quota_remaining`.
- Missing admin session returns `401`, missing/invalid CSRF returns `403`, invalid payload returns `400`, and unknown user returns `404`.
- Each successful adjustment creates an audit record with before/after values and reason.
- Server tests cover expiry extension, quota addition, missing entitlement creation, CSRF/auth failures, payload validation, and desktop account status refresh.
