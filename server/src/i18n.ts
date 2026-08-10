/**
 * Server-side i18n for FrameQ web pages (login, dashboard, admin).
 *
 * Locale is detected from the `lang` cookie (set by the language switcher)
 * with a fallback to zh-CN.  All user-visible strings are keyed flat and
 * resolved via `t(locale, key)`.
 */

export type Locale = "zh-CN" | "en" | "zh-TW";

export const SUPPORTED_LOCALES: Locale[] = ["zh-CN", "en", "zh-TW"];

export const DEFAULT_LOCALE: Locale = "zh-CN";

/** Native-name labels for the language switcher dropdown. */
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "中文",
  "en": "English",
  "zh-TW": "繁體中文",
};

const STRINGS: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    // ── shared ──────────────────────────────────────────────
    "lang.switch_to": "English",
    "lang.label": "中文",
    "lang.select_label": "语言",

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

  "zh-TW": {
    // ── shared ──────────────────────────────────────────────
    "lang.switch_to": "English",
    "lang.label": "繁體中文",
    "lang.select_label": "語言",

    // ── login page ──────────────────────────────────────────
    "login.title": "FrameQ Login",
    "login.intro.desktop": "輸入電子郵件取得驗證碼，驗證成功後會自動回到 FrameQ 用戶端。",
    "login.intro.web": "輸入電子郵件取得驗證碼，驗證成功後會進入 FrameQ 控制台。",
    "login.email": "電子郵件",
    "login.send_code": "取得驗證碼",
    "login.code": "驗證碼",
    "login.verify_desktop": "登入 FrameQ",
    "login.verify_web": "登入控制台",
    "login.fallback": "開啟 FrameQ 用戶端",
    "login.success_title": "登入成功",
    "login.success_body": "此視窗可關閉，請返回並繼續使用 FrameQ",
    "login.success_dashboard": "前往 Web Dashboard",
    "login.status_sending": "正在發送驗證碼...",
    "login.status_sent": "驗證碼已發送，請檢查電子郵件。開發環境會在伺服器端終端輸出驗證碼。",
    "login.status_verifying": "正在驗證...",
    "login.status_verified_web": "驗證成功，正在進入 FrameQ 控制台...",
    "login.error_state_desktop": "登入請求已失效，請回到 FrameQ 重新發起登入。",
    "login.error_callback": "登入回呼網址無效，請回到 FrameQ 重新發起登入。",
    "login.error_state_web": "登入請求已失效，請重新整理頁面重試。",
    "login.error_request": "請求失敗，請稍後重試。",
    "login.error_verify": "驗證失敗，請重試。",
    "login.error_invalid": "登入請求無效。",

    // ── dashboard page ──────────────────────────────────────
    "dashboard.title": "FrameQ 控制台",
    "dashboard.logout": "登出",
    "dashboard.account_quota": "帳號與額度",
    "dashboard.plan_status": "方案狀態",
    "dashboard.expiry": "到期時間",
    "dashboard.credits_limit": "AI Credits 上限",
    "dashboard.credits_used": "AI Credits 已用",
    "dashboard.credits_remaining": "AI Credits 剩餘",
    "dashboard.reset_time": "額度重置時間",
    "dashboard.llm_config": "雲端 LLM 設定",
    "dashboard.can_process": "可本機轉錄",
    "dashboard.can_generate": "可產生 AI 內容",
    "dashboard.active": "已啟用",
    "dashboard.inactive": "未啟用",
    "dashboard.configured": "已設定",
    "dashboard.not_configured": "未設定",
    "dashboard.yes": "是",
    "dashboard.no": "否",
    "dashboard.activation_code": "啟用碼",
    "dashboard.current_binding": "目前綁定",
    "dashboard.no_activation_code": "未綁定啟用碼",
    "dashboard.bound_at": "綁定於",
    "dashboard.task_history": "任務歷程",
    "dashboard.task_history_placeholder": "即將推出。目前請在 FrameQ 桌面用戶端查看任務歷程。",
    "dashboard.preferences": "偏好設定",
    "dashboard.preferences_placeholder": "即將推出。目前請在 FrameQ 桌面用戶端管理偏好設定。",
    "dashboard.logging_out": "正在登出...",
    "dashboard.logout_failed": "登出失敗，請重試。",
    "dashboard.network_error": "網路錯誤，請重試。",

    // ── admin login page ────────────────────────────────────
    "admin_login.title": "FrameQ Admin Login",
    "admin_login.heading": "管理員登入",
    "admin_login.intro": "使用管理員電子郵件取得驗證碼，登入後可產生與查看啟用碼。",
    "admin_login.email": "管理員電子郵件",
    "admin_login.send_code": "取得驗證碼",
    "admin_login.code": "電子郵件驗證碼",
    "admin_login.code_placeholder": "6 位數字",
    "admin_login.signin": "登入 FrameQ Admin",
    "admin_login.status_sending": "正在發送驗證碼...",
    "admin_login.status_sent": "驗證碼已發送，請查看電子郵件。",
    "admin_login.status_send_failed": "驗證碼發送失敗，請確認電子郵件權限。",
    "admin_login.status_verifying": "正在驗證...",
    "admin_login.status_success": "登入成功，正在進入後台...",
    "admin_login.status_code_error": "驗證碼錯誤或已過期。",
    "admin_login.network_error": "無法連線 FrameQ 伺服器端。",

    // ── admin page ─────────────────────────────────────────
    "admin.title": "FrameQ Admin",
    "admin.heading": "啟用碼管理",
    "admin.logged_in_as": "已登入：",
    "admin.logout": "登出",
    "admin.user_active": "已啟用",
    "admin.user_inactive": "未啟用",
    "admin.users_count": "使用者數",
    "admin.active_users": "已啟用使用者",
    "admin.available_codes": "可兌換啟用碼",
    "admin.activation_eyebrow": "Activation code",
    "admin.activation_heading": "產生月卡啟用碼",
    "admin.activation_desc": "兌換後取得 31 天月卡權益。完整啟用碼只在此顯示一次，複製後發送給使用者，資料庫只儲存雜湊與短前綴。",
    "admin.code_validity": "啟用碼有效期",
    "admin.days": "天",
    "admin.generate_code": "產生啟用碼",
    "admin.new_code": "新啟用碼",
    "admin.copy": "複製",
    "admin.generating": "正在產生啟用碼...",
    "admin.generated": "已產生。請立即複製並妥善發送給使用者。",
    "admin.generate_failed": "產生失敗，請檢查有效期設定。",
    "admin.code_copied": "啟用碼已複製。",
    "admin.logout_failed": "登出失敗，請重新整理後重試。",
    "admin.users_eyebrow": "Users",
    "admin.users_heading": "使用者狀態",
    "admin.col_email": "電子郵件",
    "admin.col_entitlement": "權益",
    "admin.col_expiry": "到期時間",
    "admin.no_users": "暫無使用者",
    "admin.quota_eyebrow": "LLM quota",
    "admin.quota_heading": "LLM API 呼叫次數（唯讀）",
    "admin.col_total": "總次數",
    "admin.col_used": "已用",
    "admin.col_remaining": "剩餘次數",
    "admin.compensation_eyebrow": "Compensation",
    "admin.compensation_heading": "權益補償（增加額度並留痕）",
    "admin.col_current_expiry": "目前到期",
    "admin.col_extend_days": "延長天數",
    "admin.col_add_quota": "增加 LLM API 呼叫次數",
    "admin.col_reason": "原因",
    "admin.col_note": "備註",
    "admin.col_action": "操作",
    "admin.reason_bug": "bug 補償",
    "admin.reason_goodwill": "客服關懷",
    "admin.reason_repair": "手動修復",
    "admin.reason_other": "其他",
    "admin.note_placeholder": "版本/工單/備註",
    "admin.save": "儲存",
    "admin.saving": "儲存中...",
    "admin.saved": "已儲存",
    "admin.save_failed": "儲存失敗",
    "admin.cannot_connect": "無法連線",
    "admin.audit_eyebrow": "Audit",
    "admin.audit_heading": "最近權益調整",
    "admin.col_time": "時間",
    "admin.col_expiry_change": "到期變化",
    "admin.col_quota_change": "額度變化",
    "admin.no_adjustments": "暫無權益調整紀錄",
    "admin.codes_eyebrow": "Codes",
    "admin.codes_heading": "啟用碼狀態",
    "admin.col_prefix": "前綴",
    "admin.col_status": "狀態",
    "admin.col_entitlement_days": "權益",
    "admin.col_redeem_by": "兌換截止",
    "admin.col_redeemed_at": "兌換時間",
    "admin.col_redeemed_by": "兌換電子郵件",
    "admin.no_codes": "暫無啟用碼",
    "admin.code_active": "可兌換",
    "admin.code_redeemed": "已兌換",
    "admin.code_expired": "已過期",
    "admin.code_disabled": "已停用",
    "admin.none": "無",
    "admin.entitlement_days_suffix": " 天",
  },

  en: {
    // ── shared ──────────────────────────────────────────────
    "lang.switch_to": "中文",
    "lang.label": "English",
    "lang.select_label": "Language",

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
 * Detect the user's preferred locale.
 *
 * Resolution order:
 *   1. `lang` cookie (explicit, persisted choice; wins across pages/sessions)
 *   2. `?lang=` query param (desktop deep-link hint, e.g. /login?lang=zh-TW)
 *   3. `Accept-Language` request header (first-visit browser default)
 *   4. DEFAULT_LOCALE
 *
 * The cookie is the only durable signal. `Accept-Language` and the query param
 * influence a single render only and are never written back as cookies here.
 */
export function detectLocale(input: {
  cookie?: string | null;
  queryLang?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  const cookieLocale = asSupportedLocale(extractLangCookie(input.cookie));
  if (cookieLocale) return cookieLocale;

  const queryLocale = asSupportedLocale(input.queryLang);
  if (queryLocale) return queryLocale;

  const headerLocale = parseAcceptLanguage(input.acceptLanguage);
  if (headerLocale) return headerLocale;

  return DEFAULT_LOCALE;
}

/** Extract the `lang` cookie value from a Cookie header, if present. */
function extractLangCookie(cookieHeader: string | null | undefined): string | null {
  const match = cookieHeader?.match(/(?:^|;\s*)lang=([^;]+)/);
  return match?.[1] ?? null;
}

/** Resolve the `lang` cookie to a supported locale, or null if absent/malformed/unknown. */
export function resolveCookieLocale(cookieHeader: string | null | undefined): Locale | null {
  return asSupportedLocale(extractLangCookie(cookieHeader));
}

/** Validate a raw token (cookie value or query param) against the closed set. */
function asSupportedLocale(raw: string | null | undefined): Locale | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // malformed percent-encoding; reject below
  }
  return (SUPPORTED_LOCALES as string[]).includes(value) ? (value as Locale) : null;
}

/**
 * Parse an `Accept-Language` header into the best supported locale.
 * `zh-TW` / `zh-Hant` (any region) map to `zh-TW`; generic `zh` / `zh-CN` /
 * `zh-Hans` map to `zh-CN`; `en` maps to `en`. Unmatched/zero-q ranges are skipped.
 */
function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranges = header
    .split(",")
    .map((part) => {
      const segs = part.trim().split(";");
      const tag = (segs[0] ?? "").trim().toLowerCase();
      let q = 1;
      const qSeg = segs.find((s) => s.trim().toLowerCase().startsWith("q="));
      if (qSeg) {
        const parsed = Number(qSeg.trim().slice(2));
        q = Number.isNaN(parsed) ? 0 : parsed;
      }
      return { tag, q };
    })
    .filter((r) => r.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranges) {
    if (tag === "zh-tw" || tag === "zh-hant" || tag.startsWith("zh-hant")) return "zh-TW";
    if (tag === "zh-cn" || tag === "zh-hans" || tag === "zh" || tag.startsWith("zh-hans")) {
      return "zh-CN";
    }
    if (tag === "en") return "en";
  }
  return null;
}

/** Pull the `lang` query param from a Fastify `request.query` object. */
export function extractQueryLang(query: unknown): string | null {
  const value = (query as Record<string, unknown> | undefined)?.lang;
  return typeof value === "string" ? value : null;
}

export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Returns the HTML + inline script for a language switcher dropdown.
 * Selecting an option sets the `lang` cookie and reloads the page.
 *
 * Usage: drop `${renderLangSwitcher(locale)}` anywhere in the page HTML.
 */
export function renderLangSwitcher(locale: Locale): string {
  const options = SUPPORTED_LOCALES.map((loc) => {
    const selected = loc === locale ? " selected" : "";
    return `        <option value="${loc}"${selected}>${LOCALE_LABELS[loc]}</option>`;
  }).join("\n");
  return `<select class="lang-switch" aria-label="${t(locale, "lang.select_label")}">
${options}
    </select>
    <script>
      (function(){
        var sel = document.currentScript.previousElementSibling;
        if(!sel) return;
        sel.addEventListener("change", function(){
          var target = sel.value;
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
      border: 1px solid var(--fq-border);
      border-radius: var(--fq-radius);
      background: var(--fq-surface);
      color: var(--fq-text);
      font: inherit;
      font-size: 0.82rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .lang-switch:hover {
      border-color: var(--fq-border-strong);
      background: var(--fq-surface-soft);
    }
  `;
}

/** Returns the date-formatting locale string for a given locale. */
export function dateLocale(locale: Locale): string {
  return locale;
}
