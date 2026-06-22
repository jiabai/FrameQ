import type { ActivationCodeRecord, EntitlementRecord, UserRecord } from "./store.js";
import type { PublicLlmConfig } from "./llmConfig.js";

export function renderAdminLoginPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FrameQ Admin Login</title>
    <style>${adminStyles()}</style>
  </head>
  <body class="login-page">
    <main class="login-shell">
      <section class="login-card" aria-labelledby="login-title">
        <div class="brand-row">
          <span class="brand-mark">FQ</span>
          <div>
            <p class="eyebrow">FrameQ Admin</p>
            <h1 id="login-title">管理员登录</h1>
          </div>
        </div>
        <p class="muted">使用管理员邮箱获取验证码，登录后可生成和查看激活码。</p>
        <form id="admin-login" class="admin-form">
          <label class="field">
            <span>管理员邮箱</span>
            <div class="inline-action-field">
              <input id="email" name="email" type="email" autocomplete="email" placeholder="lantianye@163.com" required />
              <button id="send-code" class="secondary-button" type="button">获取验证码</button>
            </div>
          </label>
          <label class="field">
            <span>邮箱验证码</span>
            <input id="code" name="code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位数字" required />
          </label>
          <button id="signin" class="primary-button" type="submit">登录 FrameQ Admin</button>
        </form>
        <p id="status" class="status-message" role="status"></p>
      </section>
    </main>
    <script>
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
        setStatus("正在发送验证码...");
        try {
          const response = await fetch("/admin/auth/email/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.value, state }),
          });
          setStatus(response.ok ? "验证码已发送，请查看邮箱。" : "验证码发送失败，请确认邮箱权限。", response.ok ? "success" : "error");
        } catch {
          setStatus("无法连接 FrameQ 服务端。", "error");
        } finally {
          sendCode.disabled = false;
        }
      });

      document.getElementById("admin-login").addEventListener("submit", async (event) => {
        event.preventDefault();
        signin.disabled = true;
        setStatus("正在验证...");
        try {
          const response = await fetch("/admin/auth/email/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.value, code: code.value, state }),
          });
          if (response.ok) {
            setStatus("登录成功，正在进入后台...", "success");
            window.location.href = "/admin";
          } else {
            setStatus("验证码错误或已过期。", "error");
          }
        } catch {
          setStatus("无法连接 FrameQ 服务端。", "error");
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
}): string {
  const userRows = input.users.length
    ? input.users
        .map((user) => {
          const entitlement = input.entitlements.get(user.id);
          const active = Boolean(entitlement && entitlement.expiresAt > new Date());
          return `<tr><td>${escapeHtml(user.email)}</td><td>${statusBadge(active ? "active" : "inactive", active ? "已激活" : "未激活")}</td><td>${formatDate(entitlement?.expiresAt)}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="3" class="empty-cell">暂无用户</td></tr>`;
  const quotaRows = input.users.length
    ? input.users
        .map((user) => {
          const entitlement = input.entitlements.get(user.id);
          const remaining = entitlement
            ? Math.max(0, entitlement.llmQuotaLimit - entitlement.llmQuotaUsed)
            : 0;
          const disabled = entitlement ? "" : " disabled";
          return `<tr data-user-id="${escapeHtml(user.id)}"><td>${escapeHtml(user.email)}</td><td>${entitlement?.llmQuotaLimit ?? 0}</td><td>${entitlement?.llmQuotaUsed ?? 0}</td><td><div class="quota-edit-control"><input class="quota-remaining-input" type="number" min="0" value="${remaining}"${disabled} /><button class="secondary-button quota-save" type="button" data-user-id="${escapeHtml(user.id)}"${disabled}>保存</button><span class="quota-status"></span></div></td></tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="empty-cell">暂无用户</td></tr>`;
  const userEmailsById = new Map(input.users.map((user) => [user.id, user.email]));
  const codeRows = input.activationCodes.length
    ? input.activationCodes
        .map((code) => {
          const redeemedBy = code.redeemedByUserId
            ? userEmailsById.get(code.redeemedByUserId) ?? code.redeemedByUserId
            : "";
          return `<tr><td><code>${escapeHtml(code.codePrefix)}</code></td><td>${statusBadge(code.status, activationCodeStatusText(code.status))}</td><td>${code.entitlementDays} 天</td><td>${formatDate(code.redeemBy)}</td><td>${formatDate(code.redeemedAt)}</td><td>${escapeHtml(redeemedBy)}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="empty-cell">暂无激活码</td></tr>`;
  const activeUsers = input.users.filter((user) => {
    const entitlement = input.entitlements.get(user.id);
    return Boolean(entitlement && entitlement.expiresAt > new Date());
  }).length;
  const availableCodes = input.activationCodes.filter((code) => code.status === "active" && code.redeemedAt === null).length;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FrameQ Admin</title>
    <style>${adminStyles()}</style>
  </head>
  <body>
    <main class="admin-shell">
      <header class="admin-header">
        <div class="brand-row">
          <span class="brand-mark">FQ</span>
          <div>
            <p class="eyebrow">FrameQ Admin</p>
            <h1>激活码管理</h1>
          </div>
        </div>
        <div class="admin-session">
          <span class="session-chip">已登录：${escapeHtml(input.adminEmail)}</span>
          <button id="logout-admin" class="secondary-button" type="button">退出登录</button>
        </div>
      </header>

      <section class="metrics-grid" aria-label="FrameQ Admin summary">
        <div class="metric"><span>用户数</span><strong>${input.users.length}</strong></div>
        <div class="metric"><span>已激活用户</span><strong>${activeUsers}</strong></div>
        <div class="metric"><span>可兑换激活码</span><strong>${availableCodes}</strong></div>
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
          <p class="eyebrow">Activation code</p>
          <h2>生成 31 天月卡码</h2>
          <p class="muted">完整激活码只在这里显示一次。复制后发给用户，数据库只保存哈希和短前缀。</p>
        </div>
        <div class="create-controls">
          <label class="field compact">
            <span>兑换有效期</span>
            <div class="unit-input">
              <input id="redeem-window-days" type="number" min="1" max="365" value="30" />
              <span>天</span>
            </div>
          </label>
          <button id="create-code" class="primary-button" type="button">生成激活码</button>
        </div>
        <div id="created-code-card" class="created-code-card" hidden>
          <span>新激活码</span>
          <code id="created-code"></code>
          <button id="copy-code" class="secondary-button" type="button">复制</button>
        </div>
        <p id="create-status" class="status-message" role="status"></p>
      </section>

      <section class="admin-panel">
        <div class="table-heading">
          <div>
            <p class="eyebrow">Users</p>
            <h2>用户状态</h2>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>邮箱</th><th>权益</th><th>到期时间</th></tr></thead>
            <tbody>${userRows}</tbody>
          </table>
        </div>
      </section>

      <section class="admin-panel">
        <div class="table-heading">
          <div>
            <p class="eyebrow">LLM quota</p>
            <h2>话题点次数</h2>
          </div>
        </div>
        <div class="table-wrap">
          <table id="llm-quota-table">
            <thead><tr><th>邮箱</th><th>总次数</th><th>已用</th><th>剩余次数</th></tr></thead>
            <tbody>${quotaRows}</tbody>
          </table>
        </div>
      </section>

      <section class="admin-panel">
        <div class="table-heading">
          <div>
            <p class="eyebrow">Codes</p>
            <h2>激活码状态</h2>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>前缀</th><th>状态</th><th>权益</th><th>兑换截止</th><th>兑换时间</th><th>兑换邮箱</th></tr></thead>
            <tbody>${codeRows}</tbody>
          </table>
        </div>
      </section>
    </main>
    <script>
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

      document.querySelectorAll(".quota-save").forEach((button) => {
        button.addEventListener("click", async () => {
          const userId = button.dataset.userId;
          const row = button.closest("tr");
          const input = row?.querySelector(".quota-remaining-input");
          const status = row?.querySelector(".quota-status");
          if (!userId || !input || !status) return;
          button.disabled = true;
          status.textContent = "保存中...";
          const remaining = Number(input.value || 0);
          try {
            const response = await fetch("/admin/api/users/" + encodeURIComponent(userId) + "/llm-quota", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-frameq-csrf": csrfToken },
              body: JSON.stringify({ remaining }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
              status.textContent = "保存失败";
              return;
            }
            if (data && typeof data.llm_quota_remaining === "number") {
              input.value = String(data.llm_quota_remaining);
            }
            status.textContent = "已保存";
          } catch {
            status.textContent = "无法连接";
          } finally {
            button.disabled = false;
          }
        });
      });

      createButton.addEventListener("click", async () => {
        const redeemWindowDays = Number(document.getElementById("redeem-window-days").value || 30);
        createButton.disabled = true;
        createdCodeCard.hidden = true;
        setCreateStatus("正在生成激活码...");
        try {
          const response = await fetch("/admin/api/activation-codes", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-frameq-csrf": csrfToken },
            body: JSON.stringify({ redeem_window_days: redeemWindowDays }),
          });
          const data = await response.json();
          if (!response.ok) {
            setCreateStatus("生成失败，请检查有效期设置。", "error");
            return;
          }
          createdCode.textContent = data.code;
          createdCodeCard.hidden = false;
          setCreateStatus("已生成。请立即复制并妥善发送给用户。", "success");
        } catch {
          setCreateStatus("无法连接 FrameQ 服务端。", "error");
        } finally {
          createButton.disabled = false;
        }
      });

      copyCode.addEventListener("click", async () => {
        await navigator.clipboard.writeText(createdCode.textContent || "");
        setCreateStatus("激活码已复制。", "success");
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
          setCreateStatus("退出登录失败，请刷新后重试。", "error");
        } catch {
          logoutAdmin.disabled = false;
          setCreateStatus("无法连接 FrameQ 服务端。", "error");
        }
      });
    </script>
  </body>
</html>`;
}

function adminStyles(): string {
  return `
    :root {
      color: #1f2328;
      background: #f2f4f7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      font-size: 16px;
      line-height: 1.5;
      --surface: #ffffff;
      --surface-soft: #f7f8fa;
      --text: #1f2328;
      --muted: #667085;
      --border: #d7dce3;
      --border-strong: #c2c9d3;
      --primary: #1668dc;
      --primary-pressed: #0f55b8;
      --success: #1f7a4d;
      --warning: #9a5b05;
      --danger: #b42318;
      --shadow: 0 18px 54px rgba(20, 26, 35, 0.12);
      --radius: 8px;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; }
    button, input { font: inherit; }
    button { border: 0; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: 0.58; }
    h1, h2, p { margin: 0; }
    h1 { color: var(--text); font-size: clamp(1.7rem, 4vw, 2.3rem); line-height: 1.08; }
    h2 { color: var(--text); font-size: 1.08rem; line-height: 1.2; }
    .login-page {
      align-items: center;
      background:
        linear-gradient(135deg, rgba(22, 104, 220, 0.08), transparent 34%),
        #f2f4f7;
      display: flex;
      justify-content: center;
      padding: 32px 18px;
    }
    .login-shell { width: min(100%, 480px); }
    .login-card,
    .admin-panel,
    .metric {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }
    .login-card { display: grid; gap: 18px; padding: 28px; }
    .brand-row { align-items: center; display: flex; gap: 12px; min-width: 0; }
    .brand-mark {
      align-items: center;
      background: #111827;
      border-radius: 7px;
      color: #ffffff;
      display: inline-flex;
      flex: 0 0 auto;
      font-size: 0.78rem;
      font-weight: 800;
      height: 38px;
      justify-content: center;
      letter-spacing: 0;
      width: 38px;
    }
    .eyebrow {
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 760;
      letter-spacing: 0;
      margin-bottom: 3px;
      text-transform: uppercase;
    }
    .muted { color: var(--muted); font-size: 0.92rem; }
    .admin-form { display: grid; gap: 14px; }
    .field { color: #333946; display: grid; font-size: 0.88rem; font-weight: 680; gap: 7px; }
    .field.compact { min-width: 180px; }
    input {
      background: #ffffff;
      border: 1px solid var(--border-strong);
      border-radius: 7px;
      color: var(--text);
      min-height: 42px;
      outline: none;
      padding: 0 12px;
      width: 100%;
    }
    input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(22, 104, 220, 0.16);
    }
    .inline-action-field { display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr) auto; }
    .primary-button,
    .secondary-button {
      align-items: center;
      border-radius: 7px;
      display: inline-flex;
      font-weight: 720;
      justify-content: center;
      min-height: 42px;
      padding: 0 14px;
      white-space: nowrap;
    }
    .primary-button { background: var(--primary); color: #ffffff; }
    .primary-button:hover { background: var(--primary-pressed); }
    .secondary-button {
      background: var(--surface-soft);
      border: 1px solid var(--border);
      color: #303743;
    }
    .secondary-button:hover { background: #ffffff; border-color: var(--border-strong); }
    .status-message { color: var(--muted); font-size: 0.88rem; min-height: 22px; }
    .status-message[data-tone="success"] { color: var(--success); }
    .status-message[data-tone="error"] { color: var(--danger); }
    .admin-shell { display: grid; gap: 18px; margin: 0 auto; max-width: 1180px; padding: 28px; }
    .admin-header { align-items: end; display: flex; gap: 16px; justify-content: space-between; }
    .admin-session { align-items: center; display: flex; gap: 10px; }
    .session-chip {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: #303743;
      font-size: 0.84rem;
      font-weight: 700;
      min-height: 34px;
      padding: 6px 12px;
      white-space: nowrap;
    }
    .metrics-grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .metric { box-shadow: none; display: grid; gap: 4px; padding: 16px; }
    .metric span { color: var(--muted); font-size: 0.82rem; font-weight: 680; }
    .metric strong { color: var(--text); font-size: 1.8rem; line-height: 1; }
    .admin-panel { box-shadow: none; display: grid; gap: 14px; padding: 18px; }
    .create-panel { grid-template-columns: minmax(0, 1fr) auto; }
    .llm-config-grid { display: grid; gap: 10px; grid-column: 1 / -1; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .create-controls { align-items: end; display: flex; gap: 10px; }
    .unit-input { align-items: center; display: grid; grid-template-columns: minmax(84px, 1fr) auto; }
    .unit-input input { border-bottom-right-radius: 0; border-top-right-radius: 0; }
    .unit-input span {
      align-items: center;
      background: var(--surface-soft);
      border: 1px solid var(--border-strong);
      border-left: 0;
      border-radius: 0 7px 7px 0;
      color: var(--muted);
      display: flex;
      min-height: 42px;
      padding: 0 10px;
    }
    .created-code-card {
      align-items: center;
      background: #f6fbf8;
      border: 1px solid rgba(31, 122, 77, 0.24);
      border-radius: var(--radius);
      display: grid;
      gap: 10px;
      grid-column: 1 / -1;
      grid-template-columns: auto minmax(0, 1fr) auto;
      padding: 12px;
    }
    .created-code-card span { color: var(--success); font-size: 0.82rem; font-weight: 760; }
    .quota-edit-control {
      align-items: center;
      display: grid;
      gap: 8px;
      grid-template-columns: 100px auto minmax(70px, 1fr);
    }
    .quota-edit-control input { min-height: 36px; }
    .quota-status { color: var(--muted); font-size: 0.78rem; }
    code {
      background: var(--surface-soft);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: #111827;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      overflow-wrap: anywhere;
      padding: 3px 7px;
    }
    .table-heading { align-items: center; display: flex; justify-content: space-between; }
    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; min-width: 720px; width: 100%; }
    th, td {
      border-bottom: 1px solid var(--border);
      color: #303743;
      font-size: 0.9rem;
      padding: 10px 8px;
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }
    th { color: var(--muted); font-size: 0.76rem; font-weight: 760; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    .badge {
      border: 1px solid var(--border);
      border-radius: 999px;
      display: inline-flex;
      font-size: 0.78rem;
      font-weight: 760;
      min-height: 24px;
      padding: 2px 9px;
    }
    .badge.active { background: #edf8f2; border-color: rgba(31, 122, 77, 0.2); color: var(--success); }
    .badge.redeemed { background: #eef4ff; border-color: rgba(22, 104, 220, 0.2); color: var(--primary); }
    .badge.inactive,
    .badge.expired,
    .badge.disabled { background: #fff4f3; border-color: rgba(180, 35, 24, 0.2); color: var(--danger); }
    .empty-cell { color: var(--muted); text-align: center; }
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
      .quota-edit-control { grid-template-columns: 1fr; }
      .primary-button,
      .secondary-button { width: 100%; }
      .created-code-card { grid-template-columns: 1fr; }
    }
  `;
}

function statusBadge(status: string, label: string): string {
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function activationCodeStatusText(status: string): string {
  const labels: Record<string, string> = {
    active: "可兑换",
    redeemed: "已兑换",
    expired: "已过期",
    disabled: "已停用",
  };
  return labels[status] ?? status;
}

function formatDate(value: Date | null | undefined): string {
  if (!value) {
    return "";
  }
  return escapeHtml(
    value.toLocaleString("zh-CN", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
