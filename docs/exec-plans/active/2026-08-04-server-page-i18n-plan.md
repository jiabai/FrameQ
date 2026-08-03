# Server Page i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-page language switcher to `/login`, `/dashboard`, `/admin/login`, and `/admin` that toggles between Simplified Chinese (default) and English via a non-sensitive `lang` cookie. No desktop client, worker, ASR, store, or Prisma changes.

**Architecture:** A new `server/src/i18n.ts` module owns the `Locale` type, the flat-keyed string dictionary for both locales, the `t()` lookup, the `detectLocale()` cookie-based resolver, the `renderLangSwitcher()` button HTML/inline-script, and the shared `langSwitcherStyles()` CSS. The four page-render functions (`renderLoginPage`, `renderDashboardPage`, `renderAdminLoginPage`, `renderAdminPage`) gain a `locale` parameter, replace hard-coded literals with `t(locale, key)`, emit `<html lang="...">`, render the switcher button, and inject a `buildClientStrings(locale)` JSON blob for client-side script use. The four page routes (`GET /login`, `GET /dashboard`, `GET /admin/login`, `GET /admin`) read `detectLocale(request.headers.cookie)` and forward the locale to the render function. No new routes, no new store methods, no new Prisma models, no new env vars, no new design doc.

**Tech Stack:** TypeScript, Fastify, Vitest, server-rendered HTML (no React on the server). No app/worker/Rust changes.

---

## Context and Orientation

- Spec: `docs/product-specs/2026-08-04-server-page-i18n.md`.
- Pages touched: `server/src/loginPage.ts`, `server/src/dashboardPage.ts`, `server/src/adminPage.ts`.
- Routes touched (read cookie + pass `locale`): `server/src/routes/desktopAuth.ts` (`GET /login`), `server/src/routes/dashboard.ts` (`GET /dashboard`), `server/src/routes/admin.ts` (`GET /admin/login`, `GET /admin`).
- New module: `server/src/i18n.ts`.
- Governance: `AGENTS.md`, `WORKFLOW.md`, `docs/EXECUTION_GATES.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/design-docs/core-beliefs.md`.
- Out of scope: desktop binary; worker; ASR model path; OTP/auth/store/Prisma behavior; `zh-TW` server locale; `Accept-Language` fallback; new design doc; version number.

---

## Progress

- [x] 2026-08-04: Implementation landed before plan was drafted. `server/src/i18n.ts` created with `Locale`/`SUPPORTED_LOCALES`/`DEFAULT_LOCALE`/`STRINGS`/`t()`/`buildClientStrings`/`detectLocale`/`renderLangSwitcher`/`langSwitcherStyles`/`dateLocale`. Pages (`loginPage.ts`, `dashboardPage.ts`, `adminPage.ts`) updated to accept `locale` and replace hard-coded strings. Routes (`desktopAuth.ts`, `dashboard.ts`, `admin.ts`) updated to read `detectLocale(request.headers.cookie)` and forward `locale`. Regression `npx vitest run` → 26 files / 160 passed / 1 skipped (existing suite, no i18n-specific tests yet). `tsc --noEmit` → no new errors in i18n-touched files (pre-existing `storeCompatibility.test.ts` errors remain unrelated). `python scripts/validate_agents_docs.py --level ERROR` and `--level WARN` → 0 errors / 0 warnings.
- [x] 2026-08-04: Task 1 complete. Created `server/tests/i18n.test.ts` with 29 focused unit tests covering `detectLocale` (missing/empty/malformed/unknown/encoded/mixed-cookie cases), `t()` (existing keys, fallback to default, raw-key fallback), `buildClientStrings` (fresh-object-per-call, locale-specific strings, cross-locale independence), `renderLangSwitcher` (target-locale correctness in both directions, inline script presence, `encodeURIComponent`, cookie attributes `path=/`/`max-age=31536000`/`samesite=lax`), and `langSwitcherStyles` (`.lang-switch` class + hover state). All 29 tests pass.
- [x] 2026-08-04: Task 2 complete. Created `server/tests/pageI18n.test.ts` with 12 integration tests covering all four pages (`/login`, `/dashboard`, `/admin/login`, `/admin`) in both `zh-CN` (default) and `en` (via `Cookie: lang=en`), plus malformed/unknown cookie fallback, and secret-leak regression (malicious `lang` cookie value not reflected; httpOnly session token not leaked). Discovered and documented that the CSRF token is intentionally rendered into the page's inline script for the logout button — this is by design (CSRF cookie is non-httpOnly) and not a secret leak. All 12 tests pass.
- [x] 2026-08-04: Task 3 complete. Full server suite `npx vitest run` → 28 files / 201 passed / 1 skipped (was 160 passed before Tasks 1–2; +41 new i18n tests). `tsc --noEmit` → only pre-existing `storeCompatibility.test.ts` errors remain (unrelated). `python scripts/validate_agents_docs.py --level WARN` → 0 errors / 0 warnings. Governance sync verified.

## Decision Log

- Decision: Limit server-side locales to `zh-CN` (default) and `en` for v1. Rationale: `docs/DESIGN.md` mandates reviewed Traditional Chinese copy and forbids runtime conversion; producing `zh-TW` server-side without reviewed copy would violate the rule. Date/Author: 2026-08-04, Codex.
- Decision: Locale is detected only from the `lang` cookie, not from `Accept-Language`. Rationale: an explicit user choice is more reliable than a browser preference and avoids surprising the user by switching locales on a different device. Date/Author: 2026-08-04, Codex.
- Decision: The `lang` cookie is intentionally **not** `Secure`-only. Rationale: it carries no sensitive data, must work on the local dev server (HTTP), and is validated against a closed set server-side. A future hardening pass may gate it behind `secureCookies`. Date/Author: 2026-08-04, Codex.
- Decision: No new design doc. Rationale: the change touches no architecture or security boundary; the route module ownership (`docs/design-docs/2026-07-21-server-route-module-split.md`) is preserved (each route keeps its capabilities; only `detectLocale` is imported from `../i18n.js`), and the store/Prisma boundary is untouched. Date/Author: 2026-08-04, Codex.
- Decision: Defer i18n tests to Tasks 1–2 of this plan. Rationale: the initial implementation merged before tests were written; the regression suite (160 passing) confirms no behavior regressed, but the i18n surface itself is not yet asserted. Closing this gap is the explicit goal of Tasks 1–2. Date/Author: 2026-08-04, Codex.
- Decision: No version number assigned by this plan. Rationale: the change is a contained rendering refactor; the version bump (if any) is decided by a separate release-prep plan once tests land. Date/Author: 2026-08-04, Codex.

## Outcomes & Retrospective

### What was delivered (so far)

- `server/src/i18n.ts` module exposing `Locale`, `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `t()`, `buildClientStrings()`, `detectLocale()`, `renderLangSwitcher()`, `langSwitcherStyles()`, `dateLocale()`. Flat-keyed dictionary covers login, dashboard, admin-login, and admin strings in both `zh-CN` and `en`.
- `renderLoginPage(locale)` emits `<html lang="...">`, resolves all visible copy via `t()`, renders the switcher button at the top of the login card, injects `const i18n = ${JSON.stringify(buildClientStrings(locale))}` for client-side status updates.
- `renderDashboardPage({ account, csrfToken, locale })` resolves title, header, account/quota labels, plan status, activation-code binding copy, and placeholder text via `t()`; renders the switcher next to the logout button in the dashboard header.
- `renderAdminLoginPage(locale)` and `renderAdminPage({ ..., locale })` resolve all admin strings via `t()`; the switcher button is rendered in the admin-login brand row and in the admin session chip row.
- All four routes (`GET /login`, `GET /dashboard`, `GET /admin/login`, `GET /admin`) read `detectLocale(request.headers.cookie)` and forward the locale. Pages keep `cache-control: no-store` and `Content-Type: text/html; charset=utf-8`.
- The switcher button's inline script uses `encodeURIComponent(target)` when writing the cookie and `decodeURIComponent` is wrapped in `try/catch` server-side so a malformed cookie value falls back to `zh-CN` rather than throwing.

### Verification evidence (initial implementation)

- **TypeScript build:** `npx tsc --noEmit` in `server/` → no new errors in i18n-touched files (`i18n.ts`, `loginPage.ts`, `dashboardPage.ts`, `adminPage.ts`, `routes/desktopAuth.ts`, `routes/dashboard.ts`, `routes/admin.ts`). Pre-existing `tests/storeCompatibility.test.ts` errors remain and are unrelated to this change.
- **Server tests (regression):** `npx vitest run` in `server/` → 26 files / 160 passed / 1 skipped. The skipped test is pre-existing and unrelated. No i18n-specific test exists yet — see Tasks 1–2.
- **Governance:** `python scripts/validate_agents_docs.py --level ERROR` → 0 errors. `python scripts/validate_agents_docs.py --level WARN` → 0 errors / 0 warnings.
- **App/worker regression (should be unaffected):** not re-run for this plan; the change is server-only with no app/worker/Rust import surface. Re-confirm in Task 3 if any concern surfaces.

### Verification evidence (Tasks 1–3)

- **Task 1 — focused i18n unit tests:** created `server/tests/i18n.test.ts` with 29 tests. `npx vitest run tests/i18n.test.ts` → 1 file / 29 passed. Covers `detectLocale` for missing/empty/malformed/unknown/encoded/mixed-cookie inputs, `t()` for existing/fallback/raw-key paths, `buildClientStrings` for fresh-object-per-call and locale-specific strings, `renderLangSwitcher` for target-locale correctness in both directions and the inline script + cookie attributes, and `langSwitcherStyles` for the `.lang-switch` class and hover state.
- **Task 2 — page i18n integration tests:** created `server/tests/pageI18n.test.ts` with 12 tests. `npx vitest run tests/pageI18n.test.ts` → 1 file / 12 passed. Covers all four pages (`/login`, `/dashboard`, `/admin/login`, `/admin`) in both `zh-CN` (default) and `en` (via `Cookie: lang=en`), malformed/unknown cookie fallback, and secret-leak regression (malicious `lang` cookie value not reflected into HTML; httpOnly session token not leaked). Documented that the CSRF token is intentionally rendered into the page's inline script for the logout button (CSRF cookie is non-httpOnly by design).
- **Task 3 — final regression + governance:**
  - Full server suite `npx vitest run` in `server/` → **28 files / 201 passed / 1 skipped** (was 26 files / 160 passed before Tasks 1–2; +2 new test files, +41 new tests).
  - `npx tsc --noEmit` in `server/` → only pre-existing `tests/storeCompatibility.test.ts` errors (2 errors, unrelated to i18n).
  - `python scripts/validate_agents_docs.py --level WARN` → 0 errors / 0 warnings.
  - App/worker regression gates (`npm --prefix app run lint`, `npm --prefix app run build`, `npm --prefix app test`, `uv run ruff check worker`, `uv run pytest worker/tests`) not re-run for this plan; the change is server-only with no app/worker/Rust import surface. The full server suite passing is sufficient evidence that no server regression was introduced.

### Residual risks (to revisit before release)

- **No `zh-TW` server-side locale.** See Decision Log. Tracked as a follow-up requiring reviewed Traditional Chinese copy per `docs/DESIGN.md`.
- **No `Accept-Language` fallback.** A first-visit English-first user sees Simplified Chinese until they click the switcher. Acceptable for v1.
- **`lang` cookie not `Secure`.** Acceptable for a non-sensitive preference cookie; revisit if a future hardening pass wants cookie parity with session cookies.
- **`document.currentScript.previousElementSibling` dependency.** Not supported on IE11; FrameQ server pages are not supported on IE11.
- **Version bump is a separate follow-up.** This plan does not tag or publish.
- **Real browser visual verification not performed.** The integration tests assert the rendered HTML contains the expected locale-specific strings and `<html lang="...">` attribute, but a manual click-through of the switcher button in a real browser has not been recorded. The inline script's behavior (set cookie + reload) is verified by code inspection only.

---

## Tasks

### Task 1 — Focused i18n unit tests

- [x] 1.1 Create `server/tests/i18n.test.ts`. Cover `detectLocale` for: missing cookie, `lang=zh-CN`, `lang=en`, `lang=fr` (unknown → fallback), `lang=%ZZ` (malformed URI → fallback, no throw), `lang=zh-CN; other=1` (mixed cookies), `lang=en%2DGB` (encoded unknown → fallback), `lang=zh%2DCN` (encoded `zh-CN` → accepted).
- [x] 1.2 Cover `t(locale, key)`: existing key in both locales, key missing in `en` (falls back to `zh-CN`), key missing in both (returns raw key).
- [x] 1.3 Cover `buildClientStrings`: returns a fresh object per call (mutating the returned object does not affect subsequent calls) and contains the expected keys for the locale.
- [x] 1.4 Cover `renderLangSwitcher("zh-CN")` emits `data-target-locale="en"` and the inline script; `renderLangSwitcher("en")` emits `data-target-locale="zh-CN"`. The button label uses `t(locale, "lang.switch_to")`.
- [x] 1.5 Run `npx vitest run tests/i18n.test.ts` → 1 file / 29 passed.

### Task 2 — Page i18n integration tests

- [x] 2.1 Add a test in `server/tests/pageI18n.test.ts` that requests `GET /login` with `Cookie: lang=en` and asserts: `<html lang="en">` appears, an English heading/copy string appears (e.g. `Enter your email`), the `i18n` script blob contains the English strings, the language switcher button is rendered with `data-target-locale="zh-CN"`.
- [x] 2.2 Repeat for `GET /dashboard` (with a valid session cookie + `Cookie: lang=en`): `<html lang="en">`, English dashboard copy, switcher button present.
- [x] 2.3 Repeat for `GET /admin/login` with `Cookie: lang=en`: `<html lang="en">`, English admin-login copy, switcher button present.
- [x] 2.4 Repeat for `GET /admin` (with a valid admin session + `Cookie: lang=en`): `<html lang="en">`, English admin copy, switcher button present.
- [x] 2.5 Add a regression assertion: with no `lang` cookie, all four pages render `<html lang="zh-CN">` and Chinese copy.
- [x] 2.6 Add a secret-leak regression: the rendered HTML of all four pages contains no API key, no full activation code (only the prefix), and no `lang` cookie value reflected outside the `t()`-driven copy. (The CSRF token is intentionally rendered into the page's inline script for the logout button — CSRF cookie is non-httpOnly by design; only the httpOnly session token is asserted as not leaked.)
- [x] 2.7 Run `npx vitest run` in `server/` → 28 files / 201 passed / 1 skipped (existing 160 + 41 new i18n tests).

### Task 3 — Final regression and governance verification

- [x] 3.1 Run `npx tsc --noEmit` in `server/` → only pre-existing `storeCompatibility.test.ts` errors remain (unrelated).
- [x] 3.2 Run `npx vitest run` in `server/` → 28 files / 201 passed / 1 skipped.
- [x] 3.3 Run `python scripts/validate_agents_docs.py --level ERROR` → 0 errors.
- [x] 3.4 Run `python scripts/validate_agents_docs.py --level WARN` → 0 errors / 0 warnings.
- [x] 3.5 App/worker regression gates not re-run; the change is server-only with no app/worker/Rust import surface. The full server suite passing is sufficient evidence that no server regression was introduced. (Revisit if a future change touches the app/worker boundary.)
- [x] 3.6 Outcomes & Retrospective updated with Task 1–3 evidence; residual risks re-confirmed.

---

## Residual Risk Notes (to revisit before release)

- i18n-specific tests (Tasks 1–2) must land before this plan is marked complete; the initial implementation shipped without them.
- No `zh-TW` server-side locale; tracked as a follow-up that requires reviewed Traditional Chinese copy per `docs/DESIGN.md`.
- The `lang` cookie is not `Secure`; acceptable for a non-sensitive preference cookie but revisitable in a future hardening pass.
- Version bump and release-prep are a separate follow-up plan; this plan does not tag or publish.
