import {
  buildClientStrings,
  dateLocale,
  langSwitcherStyles,
  renderLangSwitcher,
  type Locale,
  t,
} from "./i18n.js";
import { basePageCss, designTokenCss } from "./designTokens.js";
import { brandChromeCss, faviconLink, renderFrameHeader } from "./pageChrome.js";
import type {
  ActivationCodeRecord,
  AdminEntitlementAdjustmentRecord,
  EntitlementRecord,
  UserRecord,
} from "./store.js";
import type { PublicLlmConfig } from "./llmConfig.js";

export function renderAdminLoginPage(locale: Locale = "zh-CN"): string {
  const i18n = buildClientStrings(locale);
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${t(locale, "admin_login.title")}</title>
    ${faviconLink()}
    <style>${adminStyles(locale)}</style>
  </head>
  <body class="login-page">
    <main class="login-shell">
      <section class="login-card" aria-labelledby="login-title">
        ${renderFrameHeader({
          wrapperClass: "login-card-header",
          eyebrow: "FrameQ Admin",
          title: t(locale, "admin_login.heading"),
          titleId: "login-title",
          rightHtml: renderLangSwitcher(locale),
        })}
        <p class="muted">${t(locale, "admin_login.intro")}</p>
        <form id="admin-login" class="admin-form">
          <label class="field">
            <span>${t(locale, "admin_login.email")}</span>
            <div class="inline-action-field">
              <input id="email" name="email" type="email" autocomplete="email" required />
              <button id="send-code" class="secondary-button" type="button">${t(locale, "admin_login.send_code")}</button>
            </div>
          </label>
          <label class="field">
            <span>${t(locale, "admin_login.code")}</span>
            <input id="code" name="code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="${t(locale, "admin_login.code_placeholder")}" required />
          </label>
          <button id="signin" class="primary-button" type="submit">${t(locale, "admin_login.signin")}</button>
        </form>
        <p id="status" class="status-message" role="status"></p>
      </section>
    </main>
    <script>
      const i18n = ${JSON.stringify(i18n)};
      const state = "admin-" + crypto.randomUUID();
      const email = document.getElementById("email");
      const code = document.getElementById("code");
      const status = document.getElementById("status");
      const sendCode = document.getElementById("send-code");
      const signin = document.getElementById("signin");

      function setStatus(message, tone = "neutral") {
        status.textContent = message;
        status.dataset.tone = tone;
      }

      sendCode.addEventListener("click", async () => {
        if (!email.reportValidity()) return;
        sendCode.disabled = true;
        setStatus(i18n["admin_login.status_sending"]);
        try {
          const response = await fetch("/admin/auth/email/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.value, state }),
          });
          setStatus(response.ok ? i18n["admin_login.status_sent"] : i18n["admin_login.status_send_failed"], response.ok ? "success" : "error");
        } catch {
          setStatus(i18n["admin_login.network_error"], "error");
        } finally {
          sendCode.disabled = false;
        }
      });

      document.getElementById("admin-login").addEventListener("submit", async (event) => {
        event.preventDefault();
        signin.disabled = true;
        setStatus(i18n["admin_login.status_verifying"]);
        try {
          const response = await fetch("/admin/auth/email/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.value, code: code.value, state }),
          });
          if (response.ok) {
            setStatus(i18n["admin_login.status_success"], "success");
            window.location.href = "/admin";
          } else {
            setStatus(i18n["admin_login.status_code_error"], "error");
          }
        } catch {
          setStatus(i18n["admin_login.network_error"], "error");
        } finally {
          signin.disabled = false;
        }
      });
    </script>
  </body>
</html>`;
}

export function renderAdminPage(input: {
  adminEmail: string;
  csrfToken: string;
  users: UserRecord[];
  entitlements: Map<string, EntitlementRecord | null>;
  llmConfig: PublicLlmConfig;
  activationCodes: ActivationCodeRecord[];
  entitlementAdjustments: AdminEntitlementAdjustmentRecord[];
  locale?: Locale;
}): string {
  const locale = input.locale ?? "zh-CN";
  const userRows = input.users.length
    ? input.users
        .map((user) => {
          const entitlement = input.entitlements.get(user.id);
          const active = Boolean(entitlement && entitlement.expiresAt > new Date());
          return `<tr><td>${escapeHtml(user.email)}</td><td>${statusBadge(active ? "active" : "inactive", active ? t(locale, "admin.user_active") : t(locale, "admin.user_inactive"))}</td><td>${formatDate(entitlement?.expiresAt, locale)}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="3" class="empty-cell">${t(locale, "admin.no_users")}</td></tr>`;
  const quotaRows = input.users.length
    ? input.users
        .map((user) => {
          const entitlement = input.entitlements.get(user.id);
          const remaining = entitlement
            ? Math.max(0, entitlement.llmQuotaLimit - entitlement.llmQuotaUsed)
            : 0;
          return `<tr data-user-id="${escapeHtml(user.id)}"><td>${escapeHtml(user.email)}</td><td>${entitlement?.llmQuotaLimit ?? 0}</td><td>${entitlement?.llmQuotaUsed ?? 0}</td><td>${remaining}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="empty-cell">${t(locale, "admin.no_users")}</td></tr>`;
  const userEmailsById = new Map(input.users.map((user) => [user.id, user.email]));
  const adjustmentRows = input.users.length
    ? input.users
        .map((user) => {
          const entitlement = input.entitlements.get(user.id);
          const remaining = entitlement
            ? Math.max(0, entitlement.llmQuotaLimit - entitlement.llmQuotaUsed)
            : 0;
          return `<tr data-user-id="${escapeHtml(user.id)}"><td>${escapeHtml(user.email)}</td><td><span class="adjustment-expiry">${formatDate(entitlement?.expiresAt, locale)}</span></td><td><span class="adjustment-remaining">${remaining}</span></td><td><input class="adjustment-extend-days" type="number" min="0" max="365" value="0" aria-label="${t(locale, "admin.col_extend_days")}" /></td><td><input class="adjustment-quota-add" type="number" min="0" max="100000" value="0" aria-label="${t(locale, "admin.col_add_quota")}" /></td><td><select class="adjustment-reason" aria-label="${t(locale, "admin.col_reason")}"><option value="bug_compensation">${t(locale, "admin.reason_bug")}</option><option value="support_goodwill">${t(locale, "admin.reason_goodwill")}</option><option value="manual_repair">${t(locale, "admin.reason_repair")}</option><option value="other">${t(locale, "admin.reason_other")}</option></select></td><td><input class="adjustment-note" type="text" maxlength="1024" placeholder="${t(locale, "admin.note_placeholder")}" /></td><td><button class="secondary-button adjustment-save" type="button" data-user-id="${escapeHtml(user.id)}">${t(locale, "admin.save")}</button><span class="adjustment-status"></span></td></tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="empty-cell">${t(locale, "admin.no_users")}</td></tr>`;
  const recentAdjustmentRows = input.entitlementAdjustments.length
    ? input.entitlementAdjustments
        .map((adjustment) => {
          const email = userEmailsById.get(adjustment.userId) ?? adjustment.userId;
          const beforeExpiry = adjustment.beforeExpiresAt ? formatDate(adjustment.beforeExpiresAt, locale) : t(locale, "admin.none");
          const afterExpiry = formatDate(adjustment.afterExpiresAt, locale);
          const quotaDelta = adjustment.afterLlmQuotaLimit - adjustment.beforeLlmQuotaLimit;
          return `<tr><td>${formatDate(adjustment.createdAt, locale)}</td><td>${escapeHtml(email)}</td><td>${escapeHtml(adjustmentReasonText(adjustment.reason, locale))}</td><td>${escapeHtml(beforeExpiry)} → ${escapeHtml(afterExpiry)}</td><td>${quotaDelta >= 0 ? "+" : ""}${quotaDelta}</td><td>${escapeHtml(adjustment.note ?? "")}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="empty-cell">${t(locale, "admin.no_adjustments")}</td></tr>`;
  const codeRows = input.activationCodes.length
    ? input.activationCodes
        .map((code) => {
          const source = activationCodeSourceText(code.issuanceSource, locale);
          const boundEmail = resolveUserEmail(code.issuedToUserId, userEmailsById, locale);
          const redeemedBy = resolveUserEmail(code.redeemedByUserId, userEmailsById, locale);
          const status = code.status ?? "active";
          return `<tr><td><code>${escapeHtml(code.codePrefix)}</code></td><td>${escapeHtml(source)}</td><td>${escapeHtml(boundEmail)}</td><td>${statusBadge(status, activationCodeStatusText(status, locale))}</td><td>${escapeHtml(activationCodeDisabledReasonText(code.disabledReason, locale))}</td><td>${formatDateCell(code.createdAt, locale)}</td><td>${formatDateCell(code.sentAt, locale)}</td><td>${formatDateCell(code.redeemedAt, locale)}</td><td>${formatDateCell(code.redeemBy, locale)}</td><td>${code.entitlementDays}${t(locale, "admin.entitlement_days_suffix")}</td><td>${escapeHtml(redeemedBy)}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="11" class="empty-cell">${t(locale, "admin.no_codes")}</td></tr>`;
  const activeUsers = input.users.filter((user) => {
    const entitlement = input.entitlements.get(user.id);
    return Boolean(entitlement && entitlement.expiresAt > new Date());
  }).length;
  const availableCodes = input.activationCodes.filter((code) => code.status === "active" && code.redeemedAt === null).length;

  const i18n = buildClientStrings(locale);

  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${t(locale, "admin.title")}</title>
    ${faviconLink()}
    <style>${adminStyles(locale)}</style>
  </head>
  <body>
    <main class="admin-shell">
      ${renderFrameHeader({
        wrapperClass: "admin-header",
        eyebrow: "FrameQ Admin",
        title: t(locale, "admin.heading"),
        rightHtml: `<div class="admin-session">
          <span class="session-chip">${t(locale, "admin.logged_in_as")}${escapeHtml(input.adminEmail)}</span>
          ${renderLangSwitcher(locale)}
          <button id="logout-admin" class="secondary-button" type="button">${t(locale, "admin.logout")}</button>
        </div>`,
      })}

      <section class="metrics-grid" aria-label="FrameQ Admin summary">
        <div class="metric"><span>${t(locale, "admin.users_count")}</span><strong>${input.users.length}</strong></div>
        <div class="metric"><span>${t(locale, "admin.active_users")}</span><strong>${activeUsers}</strong></div>
        <div class="metric"><span>${t(locale, "admin.available_codes")}</span><strong>${availableCodes}</strong></div>
      </section>

      <section class="admin-panel create-panel">
        <div>
          <p class="eyebrow">LLM config</p>
          <h2>Dedicated FrameQ client LLM</h2>
          <p class="muted">This key is sent to entitled desktop clients at runtime. Use a dedicated revocable supplier key, not a master key.</p>
        </div>
        <form id="llm-config-form" class="llm-config-grid">
          <label class="field compact"><span>Provider</span><input id="llm-provider" value="${escapeHtml(input.llmConfig.provider)}" /></label>
          <label class="field compact"><span>Base URL</span><input id="llm-base-url" value="${escapeHtml(input.llmConfig.baseUrl)}" /></label>
          <label class="field compact"><span>Model</span><input id="llm-model" value="${escapeHtml(input.llmConfig.model)}" /></label>
          <label class="field compact"><span>Timeout seconds</span><input id="llm-timeout" type="number" min="1" max="600" value="${input.llmConfig.timeoutSeconds}" /></label>
          <label class="field compact"><span>Client API key</span><input id="llm-api-key" type="password" placeholder="${input.llmConfig.hasApiKey ? `Saved key ending ${escapeHtml(input.llmConfig.apiKeyLast4)}` : "Enter dedicated client key"}" /></label>
          <button id="save-llm-config" class="primary-button" type="submit">Save LLM config</button>
        </form>
        <p id="llm-config-status" class="status-message" role="status"></p>
      </section>

      <section class="admin-panel create-panel">
        <div>
          <p class="eyebrow">${t(locale, "admin.activation_eyebrow")}</p>
          <h2>${t(locale, "admin.activation_heading")}</h2>
          <p class="muted">${t(locale, "admin.activation_desc")}</p>
        </div>
        <div class="create-controls">
          <label class="field compact">
            <span>${t(locale, "admin.code_validity")}</span>
            <div class="unit-input">
              <input id="redeem-window-days" type="number" min="1" max="365" value="30" />
              <span>${t(locale, "admin.days")}</span>
            </div>
          </label>
          <button id="create-code" class="primary-button" type="button">${t(locale, "admin.generate_code")}</button>
        </div>
        <div id="created-code-card" class="created-code-card" hidden>
          <span>${t(locale, "admin.new_code")}</span>
          <code id="created-code"></code>
          <button id="copy-code" class="secondary-button" type="button">${t(locale, "admin.copy")}</button>
        </div>
        <p id="create-status" class="status-message" role="status"></p>
      </section>

      <section class="admin-panel">
        <div class="table-heading">
          <div>
            <p class="eyebrow">${t(locale, "admin.users_eyebrow")}</p>
            <h2>${t(locale, "admin.users_heading")}</h2>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>${t(locale, "admin.col_email")}</th><th>${t(locale, "admin.col_entitlement")}</th><th>${t(locale, "admin.col_expiry")}</th></tr></thead>
            <tbody>${userRows}</tbody>
          </table>
        </div>
      </section>

      <section class="admin-panel">
        <div class="table-heading">
          <div>
            <p class="eyebrow">${t(locale, "admin.quota_eyebrow")}</p>
            <h2>${t(locale, "admin.quota_heading")}</h2>
          </div>
        </div>
        <div class="table-wrap">
          <table id="llm-quota-table">
            <thead><tr><th>${t(locale, "admin.col_email")}</th><th>${t(locale, "admin.col_total")}</th><th>${t(locale, "admin.col_used")}</th><th>${t(locale, "admin.col_remaining")}</th></tr></thead>
            <tbody>${quotaRows}</tbody>
          </table>
        </div>
      </section>

      <section class="admin-panel">
        <div class="table-heading">
          <div>
            <p class="eyebrow">${t(locale, "admin.compensation_eyebrow")}</p>
            <h2>${t(locale, "admin.compensation_heading")}</h2>
          </div>
        </div>
        <div class="table-wrap table-wrap--scroll">
          <table id="entitlement-adjustment-table">
            <thead><tr><th>${t(locale, "admin.col_email")}</th><th>${t(locale, "admin.col_current_expiry")}</th><th>${t(locale, "admin.col_remaining")}</th><th>${t(locale, "admin.col_extend_days")}</th><th>${t(locale, "admin.col_add_quota")}</th><th>${t(locale, "admin.col_reason")}</th><th>${t(locale, "admin.col_note")}</th><th>${t(locale, "admin.col_action")}</th></tr></thead>
            <tbody>${adjustmentRows}</tbody>
          </table>
        </div>
      </section>

      <section class="admin-panel">
        <div class="table-heading">
          <div>
            <p class="eyebrow">${t(locale, "admin.audit_eyebrow")}</p>
            <h2>${t(locale, "admin.audit_heading")}</h2>
          </div>
        </div>
        <div class="table-wrap table-wrap--scroll">
          <table id="entitlement-adjustment-history-table">
            <thead><tr><th>${t(locale, "admin.col_time")}</th><th>${t(locale, "admin.col_email")}</th><th>${t(locale, "admin.col_reason")}</th><th>${t(locale, "admin.col_expiry_change")}</th><th>${t(locale, "admin.col_quota_change")}</th><th>${t(locale, "admin.col_note")}</th></tr></thead>
            <tbody>${recentAdjustmentRows}</tbody>
          </table>
        </div>
      </section>

      <section class="admin-panel">
        <div class="table-heading">
          <div>
            <p class="eyebrow">${t(locale, "admin.codes_eyebrow")}</p>
            <h2>${t(locale, "admin.codes_heading")}</h2>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>${t(locale, "admin.col_prefix")}</th><th>${t(locale, "admin.col_source")}</th><th>${t(locale, "admin.col_bound_email")}</th><th>${t(locale, "admin.col_delivery_status")}</th><th>${t(locale, "admin.col_disabled_reason")}</th><th>${t(locale, "admin.col_created_at")}</th><th>${t(locale, "admin.col_sent_at")}</th><th>${t(locale, "admin.col_redeemed_at")}</th><th>${t(locale, "admin.col_redeem_by")}</th><th>${t(locale, "admin.col_entitlement_days")}</th><th>${t(locale, "admin.col_redeemed_by")}</th></tr></thead>
            <tbody>${codeRows}</tbody>
          </table>
        </div>
      </section>
    </main>
    <script>
      const i18n = ${JSON.stringify(i18n)};
      const csrfToken = ${JSON.stringify(input.csrfToken)};
      const createButton = document.getElementById("create-code");
      const createStatus = document.getElementById("create-status");
      const createdCodeCard = document.getElementById("created-code-card");
      const createdCode = document.getElementById("created-code");
      const copyCode = document.getElementById("copy-code");
      const logoutAdmin = document.getElementById("logout-admin");
      const llmConfigForm = document.getElementById("llm-config-form");
      const llmConfigStatus = document.getElementById("llm-config-status");

      function setCreateStatus(message, tone = "neutral") {
        createStatus.textContent = message;
        createStatus.dataset.tone = tone;
      }

      function setLlmConfigStatus(message, tone = "neutral") {
        llmConfigStatus.textContent = message;
        llmConfigStatus.dataset.tone = tone;
      }

      llmConfigForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        setLlmConfigStatus("Saving LLM config...");
        const response = await fetch("/admin/api/llm-config", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-frameq-csrf": csrfToken },
          body: JSON.stringify({
            provider: document.getElementById("llm-provider").value,
            base_url: document.getElementById("llm-base-url").value,
            model: document.getElementById("llm-model").value,
            api_key: document.getElementById("llm-api-key").value,
            timeout_seconds: Number(document.getElementById("llm-timeout").value || 60),
          }),
        });
        setLlmConfigStatus(response.ok ? "LLM config saved." : "Could not save LLM config.", response.ok ? "success" : "error");
      });

      document.querySelectorAll(".adjustment-save").forEach((button) => {
        button.addEventListener("click", async () => {
          const userId = button.dataset.userId;
          const row = button.closest("tr");
          const extendInput = row?.querySelector(".adjustment-extend-days");
          const quotaInput = row?.querySelector(".adjustment-quota-add");
          const reasonInput = row?.querySelector(".adjustment-reason");
          const noteInput = row?.querySelector(".adjustment-note");
          const status = row?.querySelector(".adjustment-status");
          const expiry = row?.querySelector(".adjustment-expiry");
          const remaining = row?.querySelector(".adjustment-remaining");
          if (!userId || !extendInput || !quotaInput || !reasonInput || !noteInput || !status) return;
          button.disabled = true;
          status.textContent = i18n["admin.saving"];
          const payload = {
            reason: reasonInput.value,
            note: noteInput.value,
          };
          const extendDays = Number(extendInput.value || 0);
          const quotaAdd = Number(quotaInput.value || 0);
          if (extendDays > 0) payload.extend_days = extendDays;
          if (quotaAdd > 0) payload.quota_add = quotaAdd;
          try {
            const response = await fetch("/admin/api/users/" + encodeURIComponent(userId) + "/entitlement-adjustments", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-frameq-csrf": csrfToken },
              body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data) {
              status.textContent = i18n["admin.save_failed"];
              return;
            }
            if (expiry && data.entitlement_expires_at) {
              expiry.textContent = new Date(data.entitlement_expires_at).toLocaleString();
            }
            if (remaining && typeof data.llm_quota_remaining === "number") {
              remaining.textContent = String(data.llm_quota_remaining);
            }
            extendInput.value = "0";
            quotaInput.value = "0";
            noteInput.value = "";
            status.textContent = i18n["admin.saved"];
          } catch {
            status.textContent = i18n["admin.cannot_connect"];
          } finally {
            button.disabled = false;
          }
        });
      });

      createButton.addEventListener("click", async () => {
        const redeemWindowDays = Number(document.getElementById("redeem-window-days").value || 30);
        createButton.disabled = true;
        createdCodeCard.hidden = true;
        setCreateStatus(i18n["admin.generating"]);
        try {
          const response = await fetch("/admin/api/activation-codes", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-frameq-csrf": csrfToken },
            body: JSON.stringify({ redeem_window_days: redeemWindowDays }),
          });
          const data = await response.json();
          if (!response.ok) {
            setCreateStatus(i18n["admin.generate_failed"], "error");
            return;
          }
          createdCode.textContent = data.code;
          createdCodeCard.hidden = false;
          setCreateStatus(i18n["admin.generated"], "success");
        } catch {
          setCreateStatus(i18n["admin_login.network_error"], "error");
        } finally {
          createButton.disabled = false;
        }
      });

      copyCode.addEventListener("click", async () => {
        await navigator.clipboard.writeText(createdCode.textContent || "");
        setCreateStatus(i18n["admin.code_copied"], "success");
      });

      logoutAdmin.addEventListener("click", async () => {
        logoutAdmin.disabled = true;
        try {
          const response = await fetch("/admin/auth/logout", {
            method: "POST",
            headers: { "x-frameq-csrf": csrfToken },
          });
          if (response.ok) {
            const data = await response.json();
            window.location.href = data.redirect_url || "/admin/login";
            return;
          }
          logoutAdmin.disabled = false;
          setCreateStatus(i18n["admin.logout_failed"], "error");
        } catch {
          logoutAdmin.disabled = false;
          setCreateStatus(i18n["admin_login.network_error"], "error");
        }
      });
    </script>
  </body>
</html>`;
}

function adminStyles(locale: Locale): string {
  void locale; // styles are locale-independent
  return `
    ${langSwitcherStyles()}
    ${designTokenCss()}
    ${basePageCss()}
    h1 { color: var(--fq-text); font-size: clamp(1.7rem, 4vw, 2.3rem); line-height: 1.08; }
    h2 { color: var(--fq-text); font-size: 1.08rem; line-height: 1.2; }
    .login-page {
      align-items: center;
      display: flex;
      justify-content: center;
      padding: 32px 18px;
    }
    .login-shell { width: min(100%, 480px); }
    .login-card,
    .admin-panel,
    .metric {
      background: var(--fq-surface);
      border: 1px solid var(--fq-border);
      border-radius: var(--fq-radius);
      box-shadow: var(--fq-shadow-raised);
    }
    .login-card { display: grid; gap: 18px; padding: 28px; }
    .login-card-header { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; }
    ${brandChromeCss()}
    .muted { color: var(--fq-text-soft); font-size: 0.92rem; }
    .admin-form { display: grid; gap: 14px; }
    .field { color: var(--fq-text); display: grid; font-size: 0.88rem; font-weight: 680; gap: 7px; }
    .field.compact { min-width: 180px; }
    .inline-action-field { display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr) auto; }
    .primary-button,
    .secondary-button {
      align-items: center;
      border-radius: var(--fq-radius);
      display: inline-flex;
      font-weight: 720;
      justify-content: center;
      min-height: 42px;
      padding: 0 14px;
      white-space: nowrap;
    }
    .primary-button { background: var(--fq-primary); color: var(--fq-text-on-primary); }
    .primary-button:hover { background: var(--fq-primary-pressed); }
    .secondary-button {
      background: var(--fq-surface-soft);
      border: 1px solid var(--fq-border);
      color: var(--fq-text);
    }
    .secondary-button:hover { background: var(--fq-surface); border-color: var(--fq-border-strong); }
    .status-message { color: var(--fq-text-soft); font-size: 0.88rem; min-height: 22px; }
    .status-message[data-tone="success"] { color: var(--fq-success); }
    .status-message[data-tone="error"] { color: var(--fq-danger); }
    .admin-shell { display: grid; gap: 18px; margin: 0 auto; max-width: 1180px; padding: 28px; }
    .admin-header { align-items: end; display: flex; gap: 16px; justify-content: space-between; }
    .admin-session { align-items: center; display: flex; gap: 10px; }
    .session-chip {
      background: var(--fq-surface);
      border: 1px solid var(--fq-border);
      border-radius: var(--fq-radius-pill);
      color: var(--fq-text);
      font-size: 0.84rem;
      font-weight: 700;
      min-height: 34px;
      padding: 6px 12px;
      white-space: nowrap;
    }
    .metrics-grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .metric { box-shadow: none; display: grid; gap: 4px; padding: 16px; }
    .metric span { color: var(--fq-text-soft); font-size: 0.82rem; font-weight: 680; }
    .metric strong { color: var(--fq-text); font-size: 1.8rem; line-height: 1; }
    .admin-panel { box-shadow: none; display: grid; gap: 14px; padding: 18px; }
    .create-panel { grid-template-columns: minmax(0, 1fr) auto; }
    .llm-config-grid { display: grid; gap: 10px; grid-column: 1 / -1; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .create-controls { align-items: end; display: flex; gap: 10px; }
    .unit-input { align-items: center; display: grid; grid-template-columns: minmax(84px, 1fr) auto; }
    .unit-input input { border-bottom-right-radius: 0; border-top-right-radius: 0; }
    .unit-input span {
      align-items: center;
      background: var(--fq-surface-soft);
      border: 1px solid var(--fq-border-strong);
      border-left: 0;
      border-radius: 0 var(--fq-radius) var(--fq-radius) 0;
      color: var(--fq-text-soft);
      display: flex;
      min-height: 42px;
      padding: 0 10px;
    }
    .created-code-card {
      align-items: center;
      background: var(--fq-success-soft);
      border: 1px solid rgba(31, 122, 77, 0.24);
      border-radius: var(--fq-radius);
      display: grid;
      gap: 10px;
      grid-column: 1 / -1;
      grid-template-columns: auto minmax(0, 1fr) auto;
      padding: 12px;
    }
    .created-code-card span { color: var(--fq-success); font-size: 0.82rem; font-weight: 760; }
    code {
      background: var(--fq-surface-soft);
      border: 1px solid var(--fq-border);
      border-radius: var(--fq-radius-sm);
      color: var(--fq-text);
      overflow-wrap: anywhere;
      padding: 3px 7px;
    }
    .table-heading { align-items: center; display: flex; justify-content: space-between; }
    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; min-width: 720px; width: 100%; }
    th, td {
      border-bottom: 1px solid var(--fq-border);
      color: var(--fq-text);
      font-size: 0.9rem;
      padding: 10px 8px;
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }
    th { background: var(--fq-surface); color: var(--fq-text-soft); font-size: 0.76rem; font-weight: 760; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    tbody tr:nth-child(even) { background: var(--fq-surface-soft); }
    tbody tr:hover { background: var(--fq-primary-soft); }
    .table-wrap--scroll { max-height: 65vh; overflow: auto; }
    .table-wrap--scroll thead th { position: sticky; top: 0; z-index: 1; }
    .badge {
      border: 1px solid var(--fq-border);
      border-radius: var(--fq-radius-pill);
      display: inline-flex;
      font-size: 0.78rem;
      font-weight: 760;
      min-height: 24px;
      padding: 2px 9px;
    }
    .badge.pending_delivery,
    .badge.active { background: var(--fq-success-soft); border-color: rgba(31, 122, 77, 0.2); color: var(--fq-success); }
    .badge.redeemed { background: var(--fq-primary-soft); border-color: rgba(0, 102, 204, 0.2); color: var(--fq-primary); }
    .badge.inactive,
    .badge.expired,
    .badge.disabled,
    .badge.unknown { background: var(--fq-danger-soft); border-color: rgba(180, 35, 24, 0.2); color: var(--fq-danger); }
    .empty-cell { color: var(--fq-text-soft); text-align: center; }
    @media (max-width: 760px) {
      .login-page { align-items: stretch; padding-top: 18px; }
      .login-card { padding: 22px; }
      .inline-action-field,
      .metrics-grid,
      .create-panel,
      .llm-config-grid { grid-template-columns: 1fr; }
      .admin-shell { padding: 18px; }
      .admin-header { align-items: start; flex-direction: column; }
      .admin-session { align-items: stretch; flex-direction: column; width: 100%; }
      .session-chip { text-align: center; }
      .create-controls { align-items: stretch; flex-direction: column; }
      .primary-button,
      .secondary-button { width: 100%; }
      .created-code-card { grid-template-columns: 1fr; }
    }
  `;
}

function statusBadge(status: string, label: string): string {
  return `<span class="badge ${escapeHtml(badgeClass(status))}">${escapeHtml(label)}</span>`;
}

function activationCodeStatusText(status: string, locale: Locale): string {
  const labels: Record<string, string> = {
    pending_delivery: t(locale, "admin.code_pending_delivery"),
    active: t(locale, "admin.code_active"),
    redeemed: t(locale, "admin.code_redeemed"),
    expired: t(locale, "admin.code_expired"),
    disabled: t(locale, "admin.code_disabled"),
  };
  return labels[status] ?? status;
}

function activationCodeSourceText(source: string | null | undefined, locale: Locale): string {
  switch (source) {
    case undefined:
    case null:
    case "admin":
      return t(locale, "admin.code_source_admin");
    case "self_service_email":
      return t(locale, "admin.code_source_self_service_email");
    default:
      return source;
  }
}

function activationCodeDisabledReasonText(
  reason: string | null | undefined,
  locale: Locale,
): string {
  switch (reason) {
    case undefined:
    case null:
    case "":
      return emDash();
    case "delivery_failed":
      return t(locale, "admin.code_reason_delivery_failed");
    case "superseded":
      return t(locale, "admin.code_reason_superseded");
    case "activation_became_active":
      return t(locale, "admin.code_reason_activation_became_active");
    default:
      return reason;
  }
}

function adjustmentReasonText(reason: string, locale: Locale): string {
  switch (reason) {
    case "bug_compensation":
      return t(locale, "admin.reason_bug");
    case "support_goodwill":
      return t(locale, "admin.reason_goodwill");
    case "manual_repair":
      return t(locale, "admin.reason_repair");
    default:
      return t(locale, "admin.reason_other");
  }
}

function formatDate(value: Date | null | undefined, locale: Locale): string {
  if (!value) {
    return "";
  }
  return escapeHtml(
    value.toLocaleString(dateLocale(locale), {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
}

function formatDateCell(value: Date | null | undefined, locale: Locale): string {
  return value ? formatDate(value, locale) : escapeHtml(emDash());
}

function resolveUserEmail(
  userId: string | null | undefined,
  userEmailsById: Map<string, string>,
  locale: Locale,
): string {
  return userId ? (userEmailsById.get(userId) ?? emDash()) : emDash();
}

function badgeClass(status: string): string {
  const normalized = status.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return normalized.length > 0 ? normalized : "unknown";
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emDash(): string {
  return "—";
}
