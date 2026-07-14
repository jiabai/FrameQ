# ExecPlan — Server-Managed Anysearch Config (2026-07-15)

> **Architecture:** The desktop→worker delivery of anysearch config is already built (`draft_agent.resolve_draft_credentials` → `checkout_anysearch_config_once` → `POST /api/desktop/anysearch/checkout`). Only the server-side **source** changes: from boot-time env vars (`FRAMEQ_ANYSEARCH_MCP_URL` / `FRAMEQ_ANYSEARCH_API_KEY`) to a store-backed, admin-editable, encrypted singleton record — a parallel `AnysearchConfigService` + `AnysearchConfigRecord` mirroring `LlmConfigService`. Env acquisition is removed entirely (hard cut). Anonymous (no key) stays a first-class state via a three-state admin form. The checkout contract `{ mcp_url, api_key | null }` and `ANYSEARCH_CONFIG_MISSING` are unchanged → worker zero-change.

## Purpose / Big Picture

`生成文字稿` grounds drafts via the anysearch streamable-http MCP server. Today its URL + optional key live in `server/.env` and are captured at boot (`server.ts:136-137`), so changing them requires editing a file and restarting. This change moves them onto the Admin Web config page (alongside the LLM config) as an encrypted singleton in SQLite, read live per checkout request. See `docs/product-specs/2026-07-15-server-managed-anysearch-config.md`.

## Decisions

- **D1 — Parallel service, no LLM generalization.** Add `AnysearchConfigService` + `AnysearchConfigRecord` (singleton `id:"default"`), mirroring `LlmConfigService` / `LlmConfigRecord`. Do **not** refactor the LLM path into a shared `kind`-keyed record. Rationale: the LLM path has no covering tests (codegraph ⚠️); anysearch has only 2 fields (`mcpUrl`, optional `apiKey`), so the duplicated code is small and the risk of touching LLM is not worth it.
- **D2 — Hard cut, no env fallback, no seeding.** Remove `FRAMEQ_ANYSEARCH_MCP_URL` / `FRAMEQ_ANYSEARCH_API_KEY` from `ServerDependencies` and from the env resolution at boot. No fallback, no first-run seed from env. Rationale: user decision; the local `server/.env` has neither var set, so no live deployment breaks.
- **D3 — Reuse `FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY`.** Encrypt the anysearch key with the same AES-256-GCM key as the LLM key (`encryptSecret` / `decryptSecret` in `llmConfig.ts`). No separate `FRAMEQ_ANYSEARCH_CONFIG_ENCRYPTION_KEY`. Rationale: one key to rotate; anysearch key is low-sensitivity. Moving the encryption key out of `.env` is a shared LLM+anysearch hardening item, out of scope.
- **D4 — Anonymous is first-class; three-state form (option α).** The admin form distinguishes **set** (non-blank → overwrite), **keep** (blank, clear off → preserve), **clear** (clear on → remove key → anonymous). Affordance: a checkbox "匿名访问（无 key）" that submits `clear_api_key: true`. Rationale: the env model and the existing checkout contract (`api_key: null`) both support anonymous; the LLM form's two-state "blank = keep" cannot express clear, so copying it verbatim would regress anonymous. *Confirmed: α (user, 2026-07-15) — checkbox "匿名访问（无 key）" submits `clear_api_key: true`; β (clear-button + `api_key: null` sentinel) rejected.*
- **D5 — Admin-level shared credential.** Configured on `/admin` (login + CSRF), delivered via the existing desktop-authenticated checkout. Not per-user. Rationale: mirrors LLM config and the current global env model.
- **D6 — Live reconfiguration.** The checkout handler reads the store record per request, not a boot-time closure. Rationale: admin save takes effect immediately, consistent with LLM config; a singleton SQLite read per checkout is acceptable.
- **D7 — Checkout contract unchanged.** `{ mcp_url, api_key | null }` and `400 ANYSEARCH_CONFIG_MISSING` (no record / empty URL) are preserved → worker unchanged.

## Implementation Tasks

- [x] **Task 1 — Prisma schema + migration.** Add `model AnysearchConfig { id String @id, mcpUrl String, encryptedApiKey String, apiKeyLast4 String, createdAt DateTime, updatedAt DateTime }` to `server/prisma/schema.prisma` (sibling of `model LlmConfig` at :90). Generate and apply the migration. Singleton row uses `id = "default"`.
- [x] **Task 2 — Store layer.** Add `AnysearchConfigRecord` type and `getAnysearchConfig(): Promise<AnysearchConfigRecord | null>` / `upsertAnysearchConfig(input, now)` to the `Store` interface (`store.ts:148`, sibling `getLlmConfig` :180 / `upsertLlmConfig` :181); implement in `PrismaStore` (`prismaStore.ts`, mirror :299-319) and `MemoryStore` (`store.ts:213`, mirror :496-515).
- [x] **Task 3 — `AnysearchConfigService`.** New `server/src/anysearchConfig.ts`, mirroring `llmConfig.ts`. `getPublicConfig()` → `PublicAnysearchConfig` (`mcpUrl`, `hasApiKey`, `apiKeyLast4`, `updatedAt`); `saveConfig({ mcpUrl, apiKey?, clearApiKey })` with three-state key logic (D4) and AES via imported `encryptSecret`/`decryptSecret` from `./llmConfig.js` (no duplication); `getDesktopConfig()` → `{ mcpUrl, apiKey: string | null }` for checkout (decrypt, or `null` when anonymous/unset); `isConfigured()` (URL present). Validation: `mcpUrl` required and `http(s)://` (mirror `normalizeBaseUrl`).
- [x] **Task 4 — Server wiring + hard cut.** In `server.ts`: construct `anysearchConfig = new AnysearchConfigService({ store, now, encryptionKey: dependencies.llmConfigEncryptionKey ?? process.env.FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY })` (mirror :114-118); remove `anysearchMcpUrl` / `anysearchApiKey` from `ServerDependencies` (:34-35) and the boot-time resolution (:136-137).
- [x] **Task 5 — Admin GET.** `server.ts:219-242`: add `const publicAnysearchConfig = await anysearchConfig.getPublicConfig()` (mirror :226) and pass `anysearchConfig: publicAnysearchConfig` into `renderAdminPage({...})` (:237-242).
- [x] **Task 6 — Admin POST route.** `server.ts`, mirror :274-300: `app.post("/admin/api/anysearch-config", ...)` — admin session cookie + CSRF (`x-frameq-csrf`) + `adminAnysearchConfigSchema` (zod, mirror `adminLlmConfigSchema` :63: `mcp_url`, `api_key?`, `clear_api_key?`) → `anysearchConfig.saveConfig(...)` → `publicAnysearchConfigResponse` (mirror :634); errors via `publicError` (:726).
- [x] **Task 7 — Checkout handler.** `server.ts:467-479`: replace the boot-time closure read with per-request `const cfg = await anysearchConfig.getDesktopConfig(); if (!cfg) return reply.code(400).send({ error: "ANYSEARCH_CONFIG_MISSING" }); return { mcp_url: cfg.mcpUrl, api_key: cfg.apiKey };`. Desktop auth (`authenticateDesktop`) unchanged.
- [x] **Task 8 — Admin page UI.** `adminPage.ts`: add `anysearchConfig: PublicAnysearchConfig` to `renderAdminPage` input (:104-109); add an `#anysearch-config-form` section (mirror :202-216) with MCP URL field, API key password field (placeholder shows `Saved key ending xxxx` or `Enter anysearch key`), and a "匿名访问（无 key）" checkbox that sets `clear_api_key`; wire the submit JS to `POST /admin/api/anysearch-config` (mirror :326-356). Admin-only; no end-user anysearch disclosure.
- [x] **Task 9 — Hard-cut cleanup.** Grep-verify zero references to `FRAMEQ_ANYSEARCH_MCP_URL` / `FRAMEQ_ANYSEARCH_API_KEY` in `server/src`; remove them from `server/.env.example` if present (currently absent — document the code-side removal). Remove the now-dead `dependencies.anysearchMcpUrl` / `anysearchApiKey` plumbing in test helpers.
- [x] **Task 10 — Tests.** Migrate `server/tests/anysearchCheckout.test.ts` from `buildTestServer(store, { anysearchMcpUrl, anysearchApiKey })` injection (:29, :37-38) to store seeding (`store.upsertAnysearchConfig(...)`); add `AnysearchConfigService` tests (set / keep / clear → anonymous / missing-URL rejected / last-4 masking), mirroring LLM config coverage; assert checkout returns live post-save values with no restart; assert env vars are ignored.
- [x] **Task 11 — Docs.** Update `docs/ARCHITECTURE.md` if it references anysearch env config; refresh `server/.env.example` comments; add product-specs and exec-plans index entries (this plan + the spec).

## Validation and Acceptance

- `npm --prefix server test` — `anysearchCheckout` (migrated), new `AnysearchConfigService` tests, existing admin/llm-config regression.
- `rg -n "FRAMEQ_ANYSEARCH_MCP_URL|FRAMEQ_ANYSEARCH_API_KEY" server/src` → zero hits.
- `npm --prefix server run build` (tsc) clean.
- Manual: admin save URL+key → checkout returns new values + last-4 shown; save anonymous (clear) → checkout `api_key: null`; leave key blank without clear → key preserved; no record → `400 ANYSEARCH_CONFIG_MISSING`; restart not required after save; `生成文字稿` still produces a web-grounded draft end-to-end with no worker change.

Acceptance requires: anysearch URL + optional key admin-editable and encrypted at rest (reusing the LLM encryption key); anonymous reachable via explicit clear; env acquisition fully removed; checkout contract and `ANYSEARCH_CONFIG_MISSING` unchanged; worker zero-change; admin save live without restart.

## Context and Orientation

- **Product spec:** `docs/product-specs/2026-07-15-server-managed-anysearch-config.md`.
- **Sibling pattern (LLM):** `server/src/llmConfig.ts` — `LlmConfigService` :25, `PublicLlmConfig` :7, `DesktopLlmConfig` :17, `getPublicConfig` :34, `saveConfig` :44, `getDesktopConfig` :75, `isConfigured` :39, `normalizeBaseUrl` :110, `requireEncryptionKey` :133, `encryptSecret` :141 (exported), `decryptSecret` :149 (exported).
- **Store:** `server/src/store.ts` — `Store` interface :148, `getLlmConfig` :180, `upsertLlmConfig` :181, `LlmConfigRecord` :65; `MemoryStore` :213 (`getLlmConfig` :496, `upsertLlmConfig` :500).
- **Prisma:** `server/src/prismaStore.ts` — `getLlmConfig` :299, `upsertLlmConfig` :304 (singleton `id:"default"`). Schema: `server/prisma/schema.prisma` — `model LlmConfig` :90.
- **Server wiring:** `server/src/server.ts` — `ServerDependencies` :20 (`anysearchMcpUrl`/`anysearchApiKey` :34-35), `buildServer` :96, LLM service construction :114-118, env resolution :136-137, admin GET `/admin` :219 (`getPublicConfig` :226, `renderAdminPage` :237), admin POST `/admin/api/llm-config` :274-300, `adminLlmConfigSchema` :63, `publicLlmConfigResponse` :634, `publicError` :726, anysearch checkout :467-479.
- **Admin page:** `server/src/adminPage.ts` — `renderAdminPage` :104, `llmConfig: PublicLlmConfig` :109, LLM form section :202-216, form submit JS :326-356.
- **Worker (unchanged, reference only):** `worker/frameq_worker/draft_agent.py` — `resolve_draft_credentials` :328, `build_anysearch_mcp_config` :73; `worker/frameq_worker/llm.py` — `checkout_anysearch_config_once`.
- **Tests:** `server/tests/anysearchCheckout.test.ts` — `buildTestServer` options :29, deps injection :37-38.
- **ExecPlan indexes:** update `docs/exec-plans/active/index.md` now; on completion move this file to `docs/exec-plans/completed/` and update both indexes.

## Progress

- [x] 2026-07-15: ExecPlan authored from the `grill-me` design session — D1–D7 locked (D2 + D4(α) user-confirmed; D1/D3/D5/D6/D7 defaulted, no objection). Load-bearing symbols and file paths verified via codegraph. Validation: read-only verification.
- [x] 2026-07-15: 实现完成（feature branch `feat/server-managed-anysearch-config`，TDD 四层）。store / service / checkout / admin 全部 RED→GREEN；全量 89 测试通过；`tsc --noEmit` 干净；`server/src` 中 `FRAMEQ_ANYSEARCH_*` 零引用。待用户手动桌面端 E2E 验收。

## Surprises & Discoveries

- 2026-07-15: The delivery half was already built. `draft_agent.resolve_draft_credentials` (`draft_agent.py:328`) already checks out anysearch config from the server when `FRAMEQ_ANYSEARCH_SOURCE=server`, and `/api/desktop/anysearch/checkout` (`server.ts:467`) already returns `{ mcp_url, api_key }` incl. anonymous (`api_key: null`, tested at `worker/tests/test_draft_checkout.py:125`). So this change is server-source-only; the worker is untouched.
- 2026-07-15: `server/.env` currently sets **neither** `FRAMEQ_ANYSEARCH_*` var, and `FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY` is also empty locally — so the LLM encrypted-store path is not presently exercised in this env. D3 inherits that prerequisite; the encryption key must be set for either LLM or anysearch save to succeed. (Pre-existing condition, not introduced here.)

## Decision Log

- Decision: Parallel `AnysearchConfigService` rather than generalizing LLM into a `kind`-keyed store. Rationale: LLM path is untested; anysearch is 2 fields; risk asymmetry favors duplication. Date/Author: 2026-07-15 / design session (D1).
- Decision: Hard cut, no env fallback. Rationale: user explicitly chose to delete the env path; no live env-based deployment to migrate. Date/Author: 2026-07-15 / User (D2).
- Decision: Reuse the LLM encryption key; treat key-out-of-.env as shared out-of-scope hardening. Rationale: avoids pretending encryption-at-rest is more secure than the LLM path currently is. Date/Author: 2026-07-15 / design session (D3).
- Decision: Three-state key form with explicit "匿名访问" clear checkbox (α). Rationale: anonymous is a supported state today; the LLM two-state form cannot express "clear". Date/Author: 2026-07-15 / User-confirmed α (D4).

## Outcomes & Retrospective

- 新增 `AnysearchConfigService` + `AnysearchConfigRecord`（singleton `id="default"`），镜像 LLM 配置路径，复用 `FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY` 做 AES-256-GCM 加密（D3）。
- 三态表单（设置 / 保留 / 清除→匿名）通过「匿名访问（无 key）」复选框提交 `clear_api_key` 实现（D4-α）；填入新 key 时前端自动取消勾选，避免 clear 覆盖刚输入的 key。
- 硬切：`FRAMEQ_ANYSEARCH_MCP_URL` / `FRAMEQ_ANYSEARCH_API_KEY` 从 `ServerDependencies` 与启动解析中移除，无 env 回退（D2）；checkout 改为每请求读 store（D6），管理员保存即时生效、无需重启。
- checkout 契约 `{ mcp_url, api_key | null }` 与 `400 ANYSEARCH_CONFIG_MISSING` 不变 → worker 零改动（D7）。
- TDD：store / service / checkout / admin 四层全部先写测试再实现。新增 32 个测试（store 4 + service 13 + checkout 6 + admin 9），全量 89 测试通过，`tsc --noEmit` 干净，`server/src` 中 `FRAMEQ_ANYSEARCH_*` 零引用。
- 偏差：仓库使用 `prisma db push`（无 migrations 目录），Task 1 改用 `prisma generate` + `db push` 而非 `migrate dev`。
- 发现：`requireEncryptionKey` 从 `llmConfig.ts` 导出以共享密钥派生（仅新增 `export`，行为不变），避免在 anysearch 侧重复 crypto 代码。

**Retrospective:**

- 镜像而非泛化（D1）再次验证正确：LLM 路径无覆盖测试，anysearch 仅 2 字段，独立 service 风险最低、交付最快。
- 加密密钥本地为空是先决条件（LLM / anysearch 保存都需 `FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY`）——属既有状况，本次未处理；将密钥移出 `.env` 是 LLM+anysearch 共享加固项，out of scope。
- 待办：手动 E2E（管理员在 `/admin` 保存 URL+key → 桌面端「生成文字稿」产出联网草稿，含匿名场景）由用户在真实桌面端验证；自动化层面 checkout→草稿链路已被 `anysearchAdmin.test.ts` 的 admin-save→desktop-checkout 集成测试覆盖。
