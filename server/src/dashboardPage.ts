import {
  buildClientStrings,
  dateLocale,
  langSwitcherStyles,
  renderLangSwitcher,
  type Locale,
  t,
} from "./i18n.js";
import { basePageCss, designTokenCss } from "./designTokens.js";
import { brandChromeCss, renderFrameHeader } from "./pageChrome.js";

export type DashboardAccountView = {
  email: string;
  entitlement_status: "active" | "inactive";
  entitlement_expires_at: string | null;
  llm_quota_limit: number;
  llm_quota_used: number;
  llm_quota_remaining: number;
  llm_quota_resets_at: string | null;
  llm_configured: boolean;
  can_process: boolean;
  can_generate_ai: boolean;
  activation_code_prefix: string | null;
  activation_code_redeemed_at: string | null;
};

export type DashboardPageInput = {
  account: DashboardAccountView;
  csrfToken: string;
  locale?: Locale;
};

export function renderDashboardPage(input: DashboardPageInput): string {
  const locale = input.locale ?? "zh-CN";
  const a = input.account;
  const entitlementLabel =
    a.entitlement_status === "active"
      ? t(locale, "dashboard.active")
      : t(locale, "dashboard.inactive");
  const entitlementClass = a.entitlement_status === "active" ? "tag active" : "tag inactive";
  const expiryText = a.entitlement_expires_at
    ? formatDate(a.entitlement_expires_at, locale)
    : "—";
  const resetText = a.llm_quota_resets_at ? formatDate(a.llm_quota_resets_at, locale) : "—";
  const activationText =
    a.activation_code_prefix !== null
      ? `${escapeHtml(a.activation_code_prefix)}****（${t(locale, "dashboard.bound_at")} ${a.activation_code_redeemed_at ? formatDate(a.activation_code_redeemed_at, locale) : "—"}）`
      : t(locale, "dashboard.no_activation_code");
  const llmConfiguredText = a.llm_configured
    ? t(locale, "dashboard.configured")
    : t(locale, "dashboard.not_configured");
  const canProcessText = a.can_process ? t(locale, "dashboard.yes") : t(locale, "dashboard.no");
  const canGenerateText = a.can_generate_ai
    ? t(locale, "dashboard.yes")
    : t(locale, "dashboard.no");

  const i18n = buildClientStrings(locale);

  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${t(locale, "dashboard.title")}</title>
    <style>
      ${langSwitcherStyles()}
      ${designTokenCss()}
      ${basePageCss()}
      ${brandChromeCss()}
      body { padding: 24px; }
      .wrap { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
      header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
      header h1 { font-size: 22px; font-weight: 700; }
      header .email { color: var(--fq-text-soft); font-size: 14px; }
      .header-right { display: flex; align-items: center; gap: 8px; }
      button.logout { border-radius: var(--fq-radius); background: var(--fq-surface-soft); color: var(--fq-text); font-weight: 600; padding: 8px 16px; min-height: 34px; }
      button.logout:hover { background: var(--fq-surface); }
      button.logout:disabled { cursor: wait; opacity: 0.6; }
      .card { background: var(--fq-surface); border: 1px solid var(--fq-border); border-radius: var(--fq-radius); padding: 20px; box-shadow: var(--fq-shadow-card); }
      .card h2 { margin: 0 0 12px; font-size: 16px; font-weight: 700; color: var(--fq-text); }
      .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--fq-divider); font-size: 14px; }
      .row:last-child { border-bottom: 0; }
      .row .k { color: var(--fq-text-soft); }
      .row .v { color: var(--fq-text); font-weight: 600; text-align: right; word-break: break-all; }
      .tag { display: inline-block; padding: 2px 8px; border-radius: var(--fq-radius-pill); font-size: 12px; font-weight: 700; }
      .tag.active { background: var(--fq-success-soft); color: var(--fq-success); }
      .tag.inactive { background: var(--fq-danger-soft); color: var(--fq-danger); }
      .placeholder { color: var(--fq-text-soft); font-size: 14px; }
      #status { min-height: 20px; color: var(--fq-text-soft); font-size: 13px; }
      #status.error { color: var(--fq-danger); }
    </style>
  </head>
  <body>
    <div class="wrap">
      ${renderFrameHeader({
        title: t(locale, "dashboard.title"),
        subtitleHtml: `<div class="email">${escapeHtml(a.email)}</div>`,
        rightHtml: `<div class="header-right">
          ${renderLangSwitcher(locale)}
          <button id="logout" class="logout" type="button">${t(locale, "dashboard.logout")}</button>
        </div>`,
      })}

      <section class="card">
        <h2>${t(locale, "dashboard.account_quota")}</h2>
        <div class="row"><span class="k">${t(locale, "dashboard.plan_status")}</span><span class="v"><span class="${entitlementClass}">${entitlementLabel}</span></span></div>
        <div class="row"><span class="k">${t(locale, "dashboard.expiry")}</span><span class="v">${expiryText}</span></div>
        <div class="row"><span class="k">${t(locale, "dashboard.credits_limit")}</span><span class="v">${a.llm_quota_limit}</span></div>
        <div class="row"><span class="k">${t(locale, "dashboard.credits_used")}</span><span class="v">${a.llm_quota_used}</span></div>
        <div class="row"><span class="k">${t(locale, "dashboard.credits_remaining")}</span><span class="v">${a.llm_quota_remaining}</span></div>
        <div class="row"><span class="k">${t(locale, "dashboard.reset_time")}</span><span class="v">${resetText}</span></div>
        <div class="row"><span class="k">${t(locale, "dashboard.llm_config")}</span><span class="v">${llmConfiguredText}</span></div>
        <div class="row"><span class="k">${t(locale, "dashboard.can_process")}</span><span class="v">${canProcessText}</span></div>
        <div class="row"><span class="k">${t(locale, "dashboard.can_generate")}</span><span class="v">${canGenerateText}</span></div>
      </section>

      <section class="card">
        <h2>${t(locale, "dashboard.activation_code")}</h2>
        <div class="row"><span class="k">${t(locale, "dashboard.current_binding")}</span><span class="v">${activationText}</span></div>
      </section>

      <section class="card">
        <h2>${t(locale, "dashboard.task_history")}</h2>
        <p class="placeholder">${t(locale, "dashboard.task_history_placeholder")}</p>
      </section>

      <section class="card">
        <h2>${t(locale, "dashboard.preferences")}</h2>
        <p class="placeholder">${t(locale, "dashboard.preferences_placeholder")}</p>
      </section>

      <div id="status" role="status" aria-live="polite"></div>
    </div>
    <script>
      const i18n = ${JSON.stringify(i18n)};
      const csrfToken = ${JSON.stringify(input.csrfToken)};
      const logoutBtn = document.getElementById("logout");
      const status = document.getElementById("status");
      logoutBtn.addEventListener("click", async () => {
        logoutBtn.disabled = true;
        status.textContent = i18n["dashboard.logging_out"];
        try {
          const response = await fetch("/user/auth/logout", {
            method: "POST",
            headers: { "x-frameq-csrf": csrfToken },
          });
          if (response.ok) {
            window.location.href = "/login";
            return;
          }
          status.textContent = i18n["dashboard.logout_failed"];
          status.className = "error";
        } catch (e) {
          status.textContent = i18n["dashboard.network_error"];
          status.className = "error";
        } finally {
          logoutBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(dateLocale(locale), { timeZone: "UTC" }) + " (UTC)";
}
