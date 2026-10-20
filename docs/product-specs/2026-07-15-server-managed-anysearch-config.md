# Server-Managed Anysearch Config

FrameQ's `生成文字稿` (draft) feature grounds drafts via the anysearch streamable-http MCP server. Today the anysearch MCP URL and optional API key are read from `server/.env` (`FRAMEQ_ANYSEARCH_MCP_URL` / `FRAMEQ_ANYSEARCH_API_KEY`) and captured once at server boot. This spec moves them onto the Admin Web config page as a server-managed, encrypted, singleton record — mirroring the dedicated LLM config — so the operator can change anysearch credentials without editing files or restarting, while the existing desktop checkout continues to deliver them to the worker unchanged.

## Requirements

- Admin Web can configure the anysearch MCP URL and an optional API key on the same admin page as the LLM config.
- The anysearch API key is encrypted before storage in SQLite (AES-256-GCM), reusing the existing `FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY`; it is never returned in full by any admin or checkout response (last-4 only, like the LLM key).
- The anysearch API key is optional (anonymous MCP access is valid). The admin form supports three key states: **set** (non-blank → overwrite), **keep** (blank, clear flag off → preserve existing key), and **clear** (clear flag on → remove the key → anonymous). Anonymous must remain reachable; the LLM config's two-state "blank = keep" form cannot express "clear", so it is not copied verbatim.
- The MCP URL is required; a save with an empty URL is rejected. A record with a URL but no key is the anonymous state.
- The server stops reading `FRAMEQ_ANYSEARCH_MCP_URL` / `FRAMEQ_ANYSEARCH_API_KEY` from the environment entirely (hard cut, no env fallback, no env seeding). Both vars are removed from `ServerDependencies` and from `server/.env.example`.
- The `/api/desktop/anysearch/checkout` contract is unchanged: it returns `{ mcp_url, api_key }` with `api_key: null` for anonymous. When no anysearch record exists (or its URL is empty), checkout still returns `400 ANYSEARCH_CONFIG_MISSING`.
- Checkout reads the live store record per request, so an admin save takes effect immediately without a server restart.
- The worker (`draft_agent.resolve_draft_credentials` + `checkout_anysearch_config_once`) is unchanged; the `FRAMEQ_ANYSEARCH_SOURCE=server` delivery path already consumes this checkout contract.

## Security Boundary

- The anysearch key is a low-sensitivity, revocable Bearer token for an external search service; it is not a supplier master key.
- Encrypting the key at rest reuses the LLM config encryption key. Because that encryption key is itself currently sourced from `server/.env`, encryption-at-rest here is **consistency with the LLM path, not a defense against an attacker who already has `server/.env`**. Moving the encryption key out of `.env` into a secret manager is a shared hardening item for both LLM and anysearch config and is explicitly out of scope for this change.
- Transport relies on HTTPS; FrameQ does not use custom response-body encryption as a primary security boundary.
- The checkout endpoint authenticates the desktop session (`authenticateDesktop`) and returns the key only to a signed-in desktop client, identical to today. Configuration is admin-only (login + CSRF); end users see no anysearch disclosure.

## Acceptance Criteria

- Admin can save an anysearch MCP URL + key; the key is stored encrypted and only its last-4 is shown thereafter.
- Admin can save a URL with no key (anonymous); checkout then returns `api_key: null` and the worker builds the MCP config with no `Authorization` header.
- Admin can clear a previously saved key (switch to anonymous) via the explicit clear affordance; the stored key is removed and checkout returns `api_key: null`.
- Admin can replace the key by entering a new one; the old key is overwritten.
- Leaving the key field blank without the clear flag preserves the existing key.
- After saving, the next `/api/desktop/anysearch/checkout` returns the new values with no server restart.
- With no anysearch record saved, checkout returns `400 ANYSEARCH_CONFIG_MISSING`.
- `FRAMEQ_ANYSEARCH_MCP_URL` / `FRAMEQ_ANYSEARCH_API_KEY` are no longer read anywhere in `server/src`; setting them in the environment has no effect.
- The `生成文字稿` feature still generates a web-grounded draft end-to-end after the migration, with no worker code change.
