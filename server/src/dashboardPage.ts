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
};

export function renderDashboardPage(input: DashboardPageInput): string {
  const a = input.account;
  const entitlementLabel = a.entitlement_status === "active" ? "已激活" : "未激活";
  const entitlementClass = a.entitlement_status === "active" ? "tag active" : "tag inactive";
  const expiryText = a.entitlement_expires_at
    ? formatDate(a.entitlement_expires_at)
    : "—";
  const resetText = a.llm_quota_resets_at ? formatDate(a.llm_quota_resets_at) : "—";
  const activationText =
    a.activation_code_prefix !== null
      ? `${escapeHtml(a.activation_code_prefix)}****（绑定于 ${a.activation_code_redeemed_at ? formatDate(a.activation_code_redeemed_at) : "—"}）`
      : "未绑定激活码";
  const llmConfiguredText = a.llm_configured ? "已配置" : "未配置";
  const canProcessText = a.can_process ? "是" : "否";
  const canGenerateText = a.can_generate_ai ? "是" : "否";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FrameQ 控制台</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f7f8;
        color: #171717;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; padding: 24px; }
      .wrap { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
      header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
      header h1 { margin: 0; font-size: 22px; font-weight: 700; }
      header .email { color: #5f6874; font-size: 14px; }
      button.logout { border: 0; border-radius: 8px; background: #eef2f6; color: #171717; font: inherit; font-weight: 600; padding: 8px 16px; cursor: pointer; }
      button.logout:disabled { opacity: 0.6; cursor: wait; }
      .card { background: #ffffff; border: 1px solid #e2e5e9; border-radius: 8px; padding: 20px; box-shadow: 0 6px 20px rgba(17,24,39,0.04); }
      .card h2 { margin: 0 0 12px; font-size: 16px; font-weight: 700; color: #303845; }
      .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f2f5; font-size: 14px; }
      .row:last-child { border-bottom: 0; }
      .row .k { color: #5f6874; }
      .row .v { color: #171717; font-weight: 600; text-align: right; word-break: break-all; }
      .tag { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; }
      .tag.active { background: #e7f6ec; color: #1f7a3a; }
      .tag.inactive { background: #fdecec; color: #b42318; }
      .placeholder { color: #9aa3af; font-size: 14px; }
      #status { min-height: 20px; color: #5f6874; font-size: 13px; }
      #status.error { color: #b42318; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <div>
          <h1>FrameQ 控制台</h1>
          <div class="email">${escapeHtml(a.email)}</div>
        </div>
        <button id="logout" class="logout" type="button">退出登录</button>
      </header>

      <section class="card">
        <h2>账号与额度</h2>
        <div class="row"><span class="k">套餐状态</span><span class="v"><span class="${entitlementClass}">${entitlementLabel}</span></span></div>
        <div class="row"><span class="k">到期时间</span><span class="v">${expiryText}</span></div>
        <div class="row"><span class="k">AI Credits 上限</span><span class="v">${a.llm_quota_limit}</span></div>
        <div class="row"><span class="k">AI Credits 已用</span><span class="v">${a.llm_quota_used}</span></div>
        <div class="row"><span class="k">AI Credits 剩余</span><span class="v">${a.llm_quota_remaining}</span></div>
        <div class="row"><span class="k">额度重置时间</span><span class="v">${resetText}</span></div>
        <div class="row"><span class="k">云端 LLM 配置</span><span class="v">${llmConfiguredText}</span></div>
        <div class="row"><span class="k">可本地转录</span><span class="v">${canProcessText}</span></div>
        <div class="row"><span class="k">可生成 AI 内容</span><span class="v">${canGenerateText}</span></div>
      </section>

      <section class="card">
        <h2>激活码</h2>
        <div class="row"><span class="k">当前绑定</span><span class="v">${activationText}</span></div>
      </section>

      <section class="card">
        <h2>任务历史</h2>
        <p class="placeholder">即将推出。当前请在 FrameQ 桌面客户端查看任务历史。</p>
      </section>

      <section class="card">
        <h2>偏好设置</h2>
        <p class="placeholder">即将推出。当前请在 FrameQ 桌面客户端管理偏好设置。</p>
      </section>

      <div id="status" role="status" aria-live="polite"></div>
    </div>
    <script>
      const csrfToken = ${JSON.stringify(input.csrfToken)};
      const logoutBtn = document.getElementById("logout");
      const status = document.getElementById("status");
      logoutBtn.addEventListener("click", async () => {
        logoutBtn.disabled = true;
        status.textContent = "正在退出...";
        try {
          const response = await fetch("/user/auth/logout", {
            method: "POST",
            headers: { "x-frameq-csrf": csrfToken },
          });
          if (response.ok) {
            window.location.href = "/login";
            return;
          }
          status.textContent = "退出失败，请重试。";
          status.className = "error";
        } catch (e) {
          status.textContent = "网络错误，请重试。";
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

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("zh-CN", { timeZone: "UTC" }) + " (UTC)";
}
