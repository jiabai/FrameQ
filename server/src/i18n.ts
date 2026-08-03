/**
 * Server-side i18n for FrameQ web pages (login, dashboard, admin).
 *
 * Locale is detected from the `lang` cookie (set by the language switcher)
 * with a fallback to zh-CN.  All user-visible strings are keyed flat and
 * resolved via `t(locale, key)`.
 */

export type Locale = "zh-CN" | "en";

export const SUPPORTED_LOCALES: Locale[] = ["zh-CN", "en"];

export const DEFAULT_LOCALE: Locale = "zh-CN";

const STRINGS: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    // ── shared ──────────────────────────────────────────────
    "lang.switch_to": "English",
    "lang.label": "中文",

    // ── login page ──────────────────────────────────────────
    "login.title": "FrameQ Login",
    "login.intro.desktop": "输入邮箱获取验证码，验证成功后会自动回到 FrameQ 客户端。",
    "login.intro.web": "输入邮箱获取验证码，验证成功后会进入 FrameQ 控制台。",
    "login.email": "邮箱",
    "login.send_code": "获取验证码",
    "login.code": "验证码",
    "login.verify_desktop": "登录 FrameQ",
    "login.verify_web": "登录控制台",
    "login.fallback": "打开 FrameQ 客户端",
    "login.success_title": "登录成功",
    "login.success_body": "此窗口可关闭，请返回并继续使用 FrameQ",
    "login.success_dashboard": "去到 Web Dashboard",
    "login.status_sending": "正在发送验证码...",
    "login.status_sent": "验证码已发送，请检查邮箱。开发环境会在服务端终端输出验证码。",
    "login.status_verifying": "正在验证...",
    "login.status_verified_web": "验证成功，正在进入 FrameQ 控制台...",
    "login.error_state_desktop": "登录请求已失效，请回到 FrameQ 重新发起登录。",
    "login.error_callback": "登录回调地址无效，请回到 FrameQ 重新发起登录。",
    "login.error_state_web": "登录请求已失效，请刷新页面重试。",
    "login.error_request": "请求失败，请稍后重试。",
    "login.error_verify": "验证失败，请重试。",
    "login.error_invalid": "登录请求无效。",

    // ── dashboard page ──────────────────────────────────────
    "dashboard.title": "FrameQ 控制台",
    "dashboard.logout": "退出登录",
    "dashboard.account_quota": "账号与额度",
    "dashboard.plan_status": "套餐状态",
    "dashboard.expiry": "到期时间",
    "dashboard.credits_limit": "AI Credits 上限",
    "dashboard.credits_used": "AI Credits 已用",
    "dashboard.credits_remaining": "AI Credits 剩余",
    "dashboard.reset_time": "额度重置时间",
    "dashboard.llm_config": "云端 LLM 配置",
    "dashboard.can_process": "可本地转录",
    "dashboard.can_generate": "可生成 AI 内容",
    "dashboard.active": "已激活",
    "dashboard.inactive": "未激活",
    "dashboard.configured": "已配置",
    "dashboard.not_configured": "未配置",
    "dashboard.yes": "是",
    "dashboard.no": "否",
    "dashboard.activation_code": "激活码",
    "dashboard.current_binding": "当前绑定",
    "dashboard.no_activation_code": "未绑定激活码",
    "dashboard.bound_at": "绑定于",
    "dashboard.task_history": "任务历史",
    "dashboard.task_history_placeholder": "即将推出。当前请在 FrameQ 桌面客户端查看任务历史。",
    "dashboard.preferences": "偏好设置",
    "dashboard.preferences_placeholder": "即将推出。当前请在 FrameQ 桌面客户端管理偏好设置。",
    "dashboard.logging_out": "正在退出...",
    "dashboard.logout_failed": "退出失败，请重试。",
    "dashboard.network_error": "网络错误，请重试。",

    // ── admin login page ────────────────────────────────────
    "admin_login.title": "FrameQ Admin Login",
    "admin_login.heading": "管理员登录",
    "admin_login.intro": "使用管理员邮箱获取验证码，登录后可生成和查看激活码。",
    "admin_login.email": "管理员邮箱",
    "admin_login.send_code": "获取验证码",
    "admin_login.code": "邮箱验证码",
    "admin_login.code_placeholder": "6 位数字",
    "admin_login.signin": "登录 FrameQ Admin",
    "admin_login.status_sending": "正在发送验证码...",
    "admin_login.status_sent": "验证码已发送，请查看邮箱。",
    "admin_login.status_send_failed": "验证码发送失败，请确认邮箱权限。",
    "admin_login.status_verifying": "正在验证...",
    "admin_login.status_success": "登录成功，正在进入后台...",
    "admin_login.status_code_error": "验证码错误或已过期。",
    "admin_login.network_error": "无法连接 FrameQ 服务端。",

    // ── admin page ─────────────────────────────────────────
    "admin.title": "FrameQ Admin",
    "admin.heading": "激活码管理",
    "admin.logged_in_as": "已登录：",
    "admin.logout": "退出登录",
    "admin.user_active": "已激活",
    "admin.user_inactive": "未激活",
    "admin.users_count": "用户数",
    "admin.active_users": "已激活用户",
    "admin.available_codes": "可兑换激活码",
    "admin.activation_eyebrow": "Activation code",
    "admin.activation_heading": "生成月卡激活码",
    "admin.activation_desc": "兑换后获得 31 天月卡权益。完整激活码只在这里显示一次，复制后发给用户，数据库只保存哈希和短前缀。",
    "admin.code_validity": "激活码有效期",
    "admin.days": "天",
    "admin.generate_code": "生成激活码",
    "admin.new_code": "新激活码",
    "admin.copy": "复制",
    "admin.generating": "正在生成激活码...",
    "admin.generated": "已生成。请立即复制并妥善发送给用户。",
    "admin.generate_failed": "生成失败，请检查有效期设置。",
    "admin.code_copied": "激活码已复制。",
    "admin.logout_failed": "退出登录失败，请刷新后重试。",
    "admin.users_eyebrow": "Users",
    "admin.users_heading": "用户状态",
    "admin.col_email": "邮箱",
    "admin.col_entitlement": "权益",
    "admin.col_expiry": "到期时间",
    "admin.no_users": "暂无用户",
    "admin.quota_eyebrow": "LLM quota",
    "admin.quota_heading": "LLM API 调用次数（只读）",
    "admin.col_total": "总次数",
    "admin.col_used": "已用",
    "admin.col_remaining": "剩余次数",
    "admin.compensation_eyebrow": "Compensation",
    "admin.compensation_heading": "权益补偿（增加额度并留痕）",
    "admin.col_current_expiry": "当前到期",
    "admin.col_extend_days": "延长天数",
    "admin.col_add_quota": "增加 LLM API 调用次数",
    "admin.col_reason": "原因",
    "admin.col_note": "备注",
    "admin.col_action": "操作",
    "admin.reason_bug": "bug 补偿",
    "admin.reason_goodwill": "客服关怀",
    "admin.reason_repair": "手工修复",
    "admin.reason_other": "其他",
    "admin.note_placeholder": "版本/工单/备注",
    "admin.save": "保存",
    "admin.saving": "保存中...",
    "admin.saved": "已保存",
    "admin.save_failed": "保存失败",
    "admin.cannot_connect": "无法连接",
    "admin.audit_eyebrow": "Audit",
    "admin.audit_heading": "最近权益调整",
    "admin.col_time": "时间",
    "admin.col_expiry_change": "到期变化",
    "admin.col_quota_change": "额度变化",
    "admin.no_adjustments": "暂无权益调整记录",
    "admin.codes_eyebrow": "Codes",
    "admin.codes_heading": "激活码状态",
    "admin.col_prefix": "前缀",
    "admin.col_status": "状态",
    "admin.col_entitlement_days": "权益",
    "admin.col_redeem_by": "兑换截止",
    "admin.col_redeemed_at": "兑换时间",
    "admin.col_redeemed_by": "兑换邮箱",
    "admin.no_codes": "暂无激活码",
    "admin.code_active": "可兑换",
    "admin.code_redeemed": "已兑换",
    "admin.code_expired": "已过期",
    "admin.code_disabled": "已停用",
    "admin.none": "无",
    "admin.entitlement_days_suffix": " 天",
  },

  en: {
    // ── shared ──────────────────────────────────────────────
    "lang.switch_to": "中文",
    "lang.label": "English",

    // ── login page ──────────────────────────────────────────
    "login.title": "FrameQ Login",
    "login.intro.desktop": "Enter your email to receive a verification code. After verification, you'll be redirected back to the FrameQ client.",
    "login.intro.web": "Enter your email to receive a verification code. After verification, you'll enter the FrameQ dashboard.",
    "login.email": "Email",
    "login.send_code": "Get code",
    "login.code": "Verification code",
    "login.verify_desktop": "Sign in to FrameQ",
    "login.verify_web": "Sign in to dashboard",
    "login.fallback": "Open FrameQ client",
    "login.success_title": "Sign-in successful",
    "login.success_body": "You can close this window. Return to FrameQ to continue.",
    "login.success_dashboard": "Go to Web Dashboard",
    "login.status_sending": "Sending verification code...",
    "login.status_sent": "Verification code sent. Please check your email. (In development, the code is printed in the server terminal.)",
    "login.status_verifying": "Verifying...",
    "login.status_verified_web": "Verification successful. Entering FrameQ dashboard...",
    "login.error_state_desktop": "Login request expired. Please restart login from FrameQ.",
    "login.error_callback": "Login callback URL is invalid. Please restart login from FrameQ.",
    "login.error_state_web": "Login request expired. Please refresh and try again.",
    "login.error_request": "Request failed. Please try again later.",
    "login.error_verify": "Verification failed. Please try again.",
    "login.error_invalid": "Invalid login request.",

    // ── dashboard page ──────────────────────────────────────
    "dashboard.title": "FrameQ Dashboard",
    "dashboard.logout": "Sign out",
    "dashboard.account_quota": "Account & quota",
    "dashboard.plan_status": "Plan status",
    "dashboard.expiry": "Expires at",
    "dashboard.credits_limit": "AI Credits limit",
    "dashboard.credits_used": "AI Credits used",
    "dashboard.credits_remaining": "AI Credits remaining",
    "dashboard.reset_time": "Quota resets at",
    "dashboard.llm_config": "Cloud LLM config",
    "dashboard.can_process": "Can transcribe locally",
    "dashboard.can_generate": "Can generate AI content",
    "dashboard.active": "Active",
    "dashboard.inactive": "Inactive",
    "dashboard.configured": "Configured",
    "dashboard.not_configured": "Not configured",
    "dashboard.yes": "Yes",
    "dashboard.no": "No",
    "dashboard.activation_code": "Activation code",
    "dashboard.current_binding": "Current binding",
    "dashboard.no_activation_code": "No activation code bound",
    "dashboard.bound_at": "bound on",
    "dashboard.task_history": "Task history",
    "dashboard.task_history_placeholder": "Coming soon. For now, view task history in the FrameQ desktop client.",
    "dashboard.preferences": "Preferences",
    "dashboard.preferences_placeholder": "Coming soon. For now, manage preferences in the FrameQ desktop client.",
    "dashboard.logging_out": "Signing out...",
    "dashboard.logout_failed": "Sign-out failed. Please try again.",
    "dashboard.network_error": "Network error. Please try again.",

    // ── admin login page ────────────────────────────────────
    "admin_login.title": "FrameQ Admin Login",
    "admin_login.heading": "Admin Sign-in",
    "admin_login.intro": "Use your admin email to get a verification code. After sign-in, you can generate and view activation codes.",
    "admin_login.email": "Admin email",
    "admin_login.send_code": "Get code",
    "admin_login.code": "Email verification code",
    "admin_login.code_placeholder": "6 digits",
    "admin_login.signin": "Sign in to FrameQ Admin",
    "admin_login.status_sending": "Sending verification code...",
    "admin_login.status_sent": "Verification code sent. Please check your email.",
    "admin_login.status_send_failed": "Failed to send verification code. Please verify your email permissions.",
    "admin_login.status_verifying": "Verifying...",
    "admin_login.status_success": "Sign-in successful. Entering admin...",
    "admin_login.status_code_error": "Verification code is incorrect or expired.",
    "admin_login.network_error": "Cannot connect to FrameQ server.",

    // ── admin page ─────────────────────────────────────────
    "admin.title": "FrameQ Admin",
    "admin.heading": "Activation Code Management",
    "admin.logged_in_as": "Signed in: ",
    "admin.logout": "Sign out",
    "admin.user_active": "Active",
    "admin.user_inactive": "Inactive",
    "admin.users_count": "Users",
    "admin.active_users": "Active users",
    "admin.available_codes": "Available codes",
    "admin.activation_eyebrow": "Activation code",
    "admin.activation_heading": "Generate monthly activation code",
    "admin.activation_desc": "Redeem for 31-day monthly entitlement. The full code is shown only once — copy and send it to the user. Only the hash and short prefix are stored in the database.",
    "admin.code_validity": "Code validity",
    "admin.days": "days",
    "admin.generate_code": "Generate code",
    "admin.new_code": "New activation code",
    "admin.copy": "Copy",
    "admin.generating": "Generating activation code...",
    "admin.generated": "Generated. Please copy and send to the user immediately.",
    "admin.generate_failed": "Generation failed. Please check the validity settings.",
    "admin.code_copied": "Activation code copied.",
    "admin.logout_failed": "Sign-out failed. Please refresh and try again.",
    "admin.users_eyebrow": "Users",
    "admin.users_heading": "User status",
    "admin.col_email": "Email",
    "admin.col_entitlement": "Entitlement",
    "admin.col_expiry": "Expires at",
    "admin.no_users": "No users",
    "admin.quota_eyebrow": "LLM quota",
    "admin.quota_heading": "LLM API call count (read-only)",
    "admin.col_total": "Total",
    "admin.col_used": "Used",
    "admin.col_remaining": "Remaining",
    "admin.compensation_eyebrow": "Compensation",
    "admin.compensation_heading": "Entitlement compensation (increase quota with audit trail)",
    "admin.col_current_expiry": "Current expiry",
    "admin.col_extend_days": "Extend days",
    "admin.col_add_quota": "Add LLM API calls",
    "admin.col_reason": "Reason",
    "admin.col_note": "Note",
    "admin.col_action": "Action",
    "admin.reason_bug": "Bug compensation",
    "admin.reason_goodwill": "Support goodwill",
    "admin.reason_repair": "Manual repair",
    "admin.reason_other": "Other",
    "admin.note_placeholder": "Version/ticket/note",
    "admin.save": "Save",
    "admin.saving": "Saving...",
    "admin.saved": "Saved",
    "admin.save_failed": "Save failed",
    "admin.cannot_connect": "Cannot connect",
    "admin.audit_eyebrow": "Audit",
    "admin.audit_heading": "Recent entitlement adjustments",
    "admin.col_time": "Time",
    "admin.col_expiry_change": "Expiry change",
    "admin.col_quota_change": "Quota change",
    "admin.no_adjustments": "No adjustment records",
    "admin.codes_eyebrow": "Codes",
    "admin.codes_heading": "Activation code status",
    "admin.col_prefix": "Prefix",
    "admin.col_status": "Status",
    "admin.col_entitlement_days": "Entitlement",
    "admin.col_redeem_by": "Redeem by",
    "admin.col_redeemed_at": "Redeemed at",
    "admin.col_redeemed_by": "Redeemed by",
    "admin.no_codes": "No activation codes",
    "admin.code_active": "Available",
    "admin.code_redeemed": "Redeemed",
    "admin.code_expired": "Expired",
    "admin.code_disabled": "Disabled",
    "admin.none": "None",
    "admin.entitlement_days_suffix": " days",
  },
};

export function t(locale: Locale, key: string): string {
  return STRINGS[locale]?.[key] ?? STRINGS[DEFAULT_LOCALE][key] ?? key;
}

/** Build a JSON object of all strings for a locale, for client-side JS use. */
export function buildClientStrings(locale: Locale): Record<string, string> {
  return { ...STRINGS[locale] };
}

/**
 * Detect the user's preferred locale from the `lang` cookie.
 * Falls back to DEFAULT_LOCALE.
 */
export function detectLocale(cookieHeader: string | undefined): Locale {
  const match = cookieHeader?.match(/(?:^|;\s*)lang=([^;]+)/);
  const raw = match?.[1];
  if (raw) {
    try {
      const value = decodeURIComponent(raw);
      if (value === "en" || value === "zh-CN") {
        return value;
      }
    } catch {
      // ignore malformed cookie value
    }
  }
  return DEFAULT_LOCALE;
}

const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Returns the HTML + inline script for a language switcher button.
 * Clicking the button sets the `lang` cookie and reloads the page.
 *
 * Usage: drop `${renderLangSwitcher(locale)}` anywhere in the page HTML.
 */
export function renderLangSwitcher(locale: Locale): string {
  const otherLocale: Locale = locale === "zh-CN" ? "en" : "zh-CN";
  const label = t(locale, "lang.switch_to");
  return `<button class="lang-switch" type="button" data-target-locale="${otherLocale}">${label}</button>
    <script>
      (function(){
        var btn = document.currentScript.previousElementSibling;
        if(!btn) return;
        btn.addEventListener("click", function(){
          var target = btn.getAttribute("data-target-locale");
          document.cookie = "lang=" + encodeURIComponent(target) + ";path=/;max-age=${LANG_COOKIE_MAX_AGE};samesite=lax";
          window.location.reload();
        });
      })();
    </script>`;
}

/** Returns the CSS for the language switcher button (shared across pages). */
export function langSwitcherStyles(): string {
  return `
    .lang-switch {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 6px 12px;
      border: 1px solid #d7dce3;
      border-radius: 7px;
      background: #ffffff;
      color: #303743;
      font: inherit;
      font-size: 0.82rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .lang-switch:hover {
      border-color: #c2c9d3;
      background: #f7f8fa;
    }
  `;
}

/** Returns the date-formatting locale string for a given locale. */
export function dateLocale(locale: Locale): string {
  return locale;
}
