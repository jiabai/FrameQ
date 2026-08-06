# Server Page i18n Spec

## Background

The FrameQ server renders three user-facing HTML pages — `/login` (desktop + web mode), `/dashboard` (per-user web session), and `/admin` + `/admin/login` (administrator web session). Before this spec, every page hard-coded Simplified Chinese copy in both the server-rendered HTML and the inline client-side script strings (status messages, error copy, button labels, and success-panel text). There was no way for an English-speaking user or administrator to switch the page language, and the desktop client already shipped a fully localized UI (Simplified/Traditional Chinese + English) per `docs/product-specs/2026-07-15-desktop-i18n-ai-output-language.md`, so the web surface was inconsistent with the desktop surface.

This spec introduces a server-side i18n module that supports three locales (`zh-CN` default, `en`, `zh-TW`) and a per-page language switcher dropdown. The locale is stored in a non-sensitive `lang` cookie and applied to every server-rendered page. Detected via `lang` cookie → `?lang=` deep-link query → `Accept-Language` header → default.

## Goals

- Add a single i18n module at `server/src/i18n.ts` that owns the locale type, the string dictionary, the `t()` lookup, the `detectLocale()` locale resolution (cookie → `?lang=` deep link → `Accept-Language` → default), the `renderLangSwitcher()` dropdown HTML/inline-script, and the shared `langSwitcherStyles()` CSS.
- Cover all user-visible strings on `/login`, `/dashboard`, `/admin/login`, and `/admin` with flat-keyed strings resolved via `t(locale, key)` in both `zh-CN` and `en`.
- Pass a `locale: Locale` parameter through every page-render function (`renderLoginPage`, `renderDashboardPage`, `renderAdminLoginPage`, `renderAdminPage`) and emit `<html lang="...">` plus a per-page language switcher button.
- Have every page route (`GET /login`, `GET /dashboard`, `GET /admin/login`, `GET /admin`) read the `lang` cookie via `detectLocale(request.headers.cookie)` and forward the resolved locale to the render function.
- Render a per-page language switcher button that sets the `lang` cookie (`path=/`, `max-age=1y`, `samesite=lax`) and reloads the page. No server round-trip to a settings endpoint is required to switch language.
- Mirror client-side script strings (status, error, success-panel, button copy) through a `buildClientStrings(locale)` JSON blob injected into each page's inline `<script>` so client-side DOM updates use the same locale as the server-rendered HTML.

## Non-goals

- No change to the desktop client binary, the Tauri IPC contract, the worker, the ASR path, AI Credit accounting, OTP semantics, store transactions, or Prisma schema. The change is server-side rendering only.
- Traditional Chinese (`zh-TW`) is supported as a third locale, added after v1. It uses reviewed Traditional Chinese copy per `docs/DESIGN.md` (no runtime conversion). The server renders `zh-TW` for `lang=zh-TW`, `?lang=zh-TW` desktop deep links, and `Accept-Language: zh-TW` / `zh-Hant`.
- No `Follow System` mode toggle on the server pages. The browser `Accept-Language` is consulted only as a first-visit fallback (after the `lang` cookie and `?lang=` deep link); an explicit `lang` cookie always wins, so a user's choice is honored across `/login`, `/dashboard`, and `/admin`.
- No change to OTP issuance, rate limiting, dispatch, or auth flow. The `lang` cookie is a non-sensitive preference cookie and is not read by any auth, store, or Prisma code.
- No new design doc is produced by this spec; the change is a contained rendering refactor that touches no architecture or security boundary.
- No version-number assignment in this spec. Version bump is decided in the ExecPlan.

## Locale Model

- Supported locales: `zh-CN` (default), `en`, and `zh-TW`. The type is `Locale = "zh-CN" | "en" | "zh-TW"` exported from `server/src/i18n.ts`. The `zh-TW` strings are reviewed Traditional Chinese copy per `docs/DESIGN.md` (no runtime conversion).
- The locale is detected via `detectLocale({ cookie, queryLang, acceptLanguage }): Locale`. Resolution order: `lang` cookie → `?lang=` query param (desktop deep link, e.g. `/login?lang=zh-TW`) → `Accept-Language` header → `DEFAULT_LOCALE` (`zh-CN`). The cookie/query value is URL-decoded and validated against the closed set `{"zh-CN", "en", "zh-TW"}`; `Accept-Language` maps `zh-TW`/`zh-Hant*` → `zh-TW`, generic `zh`/`zh-CN`/`zh-Hans` → `zh-CN`, `en` → `en`. Any malformed or unrecognized value falls back to `DEFAULT_LOCALE`.
- The cookie is set by the per-page language switcher button with `path=/`, `max-age=31536000` (1 year), and `samesite=lax`. The cookie is intentionally **not** `Secure`-only so language switching also works on the local development server (HTTP) and on `frameq.8xf.pro` (HTTPS). The cookie carries no sensitive data and is read only by `detectLocale`.
- The cookie is **not** `HttpOnly` because it is read by client-side code is unnecessary — the locale is applied server-side on the next request and the client only needs to set the cookie and reload.

## String Dictionary

- Strings are flat-keyed (e.g. `login.title`, `dashboard.credits_remaining`, `admin.code_active`) and stored in a single `STRINGS: Record<Locale, Record<string, string>>` map.
- The `t(locale, key)` lookup falls back to `STRINGS[DEFAULT_LOCALE][key]` then to the raw key, so a missing English string never crashes rendering.
- The `buildClientStrings(locale)` helper returns a shallow copy of the locale's strings for injection into the page's inline `<script>` as `const i18n = {...}`. Client-side status/error/success-panel updates read from this object instead of hard-coded literals.
- Brand tokens (`FrameQ`, `FrameQ Admin`, `AI Credits`, `LLM`, `Mermaid`, `ASR`) are not translated. User content (emails, activation-code prefixes, dates) is rendered verbatim.

## Page Rendering

- Each page-render function gains a `locale: Locale` parameter (optional with default `zh-CN` for backward compatibility with existing tests). The function:
  - Emits `<html lang="${locale}">`.
  - Includes `${langSwitcherStyles()}` in the `<style>` block.
  - Resolves the page title, headings, button labels, helper copy, status strings, and error copy via `t(locale, key)`.
  - Renders the language switcher button via `${renderLangSwitcher(locale)}` at a consistent location: top-right of the login card, top-right of the dashboard header next to the logout button, top-right of the admin login brand row, and in the admin session chip row next to the admin logout button.
  - Injects `const i18n = ${JSON.stringify(buildClientStrings(locale))};` into the inline `<script>` so client-side DOM updates use the same locale.
- Pages continue to set `cache-control: no-store` and `Content-Type: text/html; charset=utf-8`. The locale change does not weaken the no-store policy.

## Route Wiring

- `GET /login` in `server/src/routes/desktopAuth.ts` calls `detectLocale({ cookie: request.headers.cookie, queryLang: extractQueryLang(request.query), acceptLanguage: firstHeader(request.headers["accept-language"]) })` and passes the locale to `renderLoginPage(locale)`. When a valid `?lang=` deep link is present and no `lang` cookie exists, it persists the deep-link locale as a `lang` cookie so post-login pages remember it.
- `GET /dashboard` in `server/src/routes/dashboard.ts` calls `detectLocale({ cookie, queryLang, acceptLanguage })` and passes `locale` in the `DashboardPageInput` to `renderDashboardPage`.
- `GET /admin/login` in `server/src/routes/admin.ts` calls `detectLocale({ cookie, queryLang, acceptLanguage })` and passes the locale to `renderAdminLoginPage(locale)`.
- `GET /admin` in `server/src/routes/admin.ts` calls `detectLocale({ cookie, queryLang, acceptLanguage })` and passes `locale` in the `renderAdminPage` input.
- No new routes, no new Store methods, no new Prisma models, no new env vars. The route module boundary ownership (`docs/design-docs/2026-07-21-server-route-module-split.md`) is preserved: each route keeps its existing capabilities; the only new import is `detectLocale` from `../i18n.js`.

## User-visible Behavior

- A user opens `/login`, `/dashboard`, `/admin/login`, or `/admin` in a browser. The page renders in Simplified Chinese by default. A language switcher button labeled `English` is visible on every page.
- Clicking the button sets the `lang=en` cookie and reloads the page. The re-rendered page is fully in English: title, headings, helper text, button labels, status strings, error copy, and the success-panel text. The button label changes to `中文`.
- Clicking again switches back to Simplified Chinese. The choice persists across pages and across sessions for 1 year.
- The locale applies uniformly to server-rendered HTML and to client-side script-driven status updates. There is no flash of the wrong locale: the server renders the correct locale on the first response after the cookie is set.
- All existing functionality (desktop deep-link login, web dashboard login, admin login, OTP verify, dashboard rendering, admin user/code/quota/audit rendering, logout) is behaviorally unchanged. Only the visible language changes.

## Security and Compliance

- The `lang` cookie is a non-sensitive preference cookie. It is not used for authentication, authorization, CSRF, or session identity. It carries only one of two closed values (`zh-CN` or `en`) and is validated server-side; an unrecognized value falls back to `zh-CN` rather than being echoed.
- `detectLocale` does not log the cookie value, does not reflect the cookie into HTML without going through `t()` lookup, and does not pass the cookie to any Store, Prisma, auth, or LLM code path. It is read once per request inside the route handler.
- The language switcher button's inline script uses `encodeURIComponent(target)` before writing the cookie value, preventing cookie injection via the button's `data-target-locale` attribute. The attribute is a server-rendered closed value (`en` or `zh-CN`), not user input.
- No new logging, no new diagnostic surface, no new persistence. The change touches only rendering.
- The i18n change does not weaken any existing boundary in `docs/SECURITY.md`: OTP purposes, attempt accounting, ticket/session atomicity, CSRF double-token, `secureCookies` semantics, structured-log redaction, `cache-control: no-store`, secret-leak guards, and Prisma transaction ownership are all unchanged.
- The page continues to render only account/quota/activation-code-prefix fields; no API key, full activation code, raw URL, file path, transcript, prompt, or LLM config secret is rendered regardless of locale.

## Acceptance Criteria

- `GET /login`, `GET /dashboard`, `GET /admin/login`, and `GET /admin` render in `zh-CN` by default when no `lang` cookie is present.
- Setting `Cookie: lang=en` and re-requesting any of the four pages renders the page in English: `<html lang="en">`, English title, English headings, English button labels, and English client-side `i18n` object.
- Every page contains a language switcher button whose `data-target-locale` is the opposite of the current locale.
- Every page contains the shared `langSwitcherStyles()` CSS and the inline switcher script that sets the `lang` cookie and reloads.
- The switcher button's `data-target-locale` is always one of `{"zh-CN", "en"}` (server-rendered, never user-supplied).
- `detectLocale` returns `zh-CN` for: missing cookie, empty cookie, malformed cookie value, and any value not in `{"zh-CN", "en"}`. Malformed URI-encoded values do not throw (the `try/catch` swallows `URIError`).
- All previously-passing server tests remain green. The desktop deep-link login contract, web dashboard login, admin login, OTP verify, dashboard rendering, admin rendering, and logout behaviors are byte-for-byte unchanged except for the added locale parameter and the rendered language.
- No new env var, no new Store method, no new Prisma model, no new migration, no new route, no new design doc.
- `python scripts/validate_agents_docs.py --level WARN` remains green after governance-index sync.

## Test Plan

- Add a focused `server/tests/i18n.test.ts` covering:
  - `detectLocale` for: missing cookie, `lang=zh-CN`, `lang=en`, `lang=fr` (unknown), `lang=%ZZ` (malformed), `lang=zh-CN; other=1` (mixed), URL-encoded values (`lang=en%2DGB` rejected, `lang=zh-CN` accepted).
  - `t(locale, key)` for: existing key in both locales, key missing in `en` (falls back to `zh-CN`), key missing in both (returns raw key).
  - `buildClientStrings` returns a copy (mutating the returned object does not mutate the module's internal map).
  - `renderLangSwitcher("zh-CN")` emits `data-target-locale="en"` and the inline script; `renderLangSwitcher("en")` emits `data-target-locale="zh-CN"`.
- Extend `server/tests/webDashboard.test.ts` (or a new `server/tests/pageI18n.test.ts`) with integration assertions:
  - `GET /login` with `Cookie: lang=en` renders `<html lang="en">` and English copy in both server-rendered HTML and the `i18n` script blob.
  - `GET /dashboard` with `Cookie: lang=en` renders English dashboard copy.
  - `GET /admin/login` with `Cookie: lang=en` renders English admin-login copy.
  - `GET /admin` with `Cookie: lang=en` renders English admin copy.
  - Each page renders the language switcher button and shared styles.
  - The switcher button's `data-target-locale` is the opposite locale.
- Regression: existing `routes.test.ts` route table, `webDashboard.test.ts` flows, `admin.test.ts` flows, `serverModuleBoundaries.test.ts`, `storeModuleBoundaries.test.ts`, and `storeCompatibility.test.ts` remain green.
- Governance: `python scripts/validate_agents_docs.py --level WARN` clean.

## Residual Risks

- **`zh-TW` server-side locale — resolved.** The server now supports `zh-TW` with reviewed Traditional Chinese copy (per `docs/DESIGN.md`, no runtime conversion). A desktop Traditional Chinese user who opens the web dashboard now sees Traditional Chinese.
- **`Accept-Language` fallback — resolved.** `detectLocale` consults `Accept-Language` as a first-visit fallback (after the `lang` cookie and `?lang=` deep link). A browser whose language is `zh-TW`/`zh-Hant` or `en` with no `lang` cookie set now renders the matching locale on first visit; an explicit `lang` cookie still wins.
- **Cookie not `Secure`.** The `lang` cookie is set without the `Secure` flag so it works on the local dev server. Since it carries no sensitive data, this is acceptable, but a future hardening pass could gate it behind `secureCookies` to mirror the session cookies.
- **Inline script uses `document.currentScript.previousElementSibling`.** This is robust in all evergreen browsers but not in IE11; FrameQ server pages are not supported on IE11.
- **Real browser visual verification not performed.** The integration tests assert the rendered HTML contains the expected locale-specific strings and `<html lang="...">` attribute, but a manual click-through of the switcher button in a real browser has not been recorded. The inline script's behavior (set cookie + reload) is verified by code inspection only.
