import { KeyRound, ShieldCheck, UserRound, X } from "lucide-react";

import { canProcessWithAccount, type AccountStatus } from "../../accountState";

type AccountSheetProps = {
  open: boolean;
  account: AccountStatus;
  accountStatusText: string;
  accountNotice: string;
  accountLoading: boolean;
  activationCodeDraft: string;
  activationRedeeming: boolean;
  formatHistoryDate: (value: string) => string;
  onClose: () => void;
  onActivationCodeChange: (value: string) => void;
  onRedeemActivationCode: () => void;
  onSignOut: () => void;
  onStartLogin: () => void;
};

export function AccountSheet({
  open,
  account,
  accountStatusText,
  accountNotice,
  accountLoading,
  activationCodeDraft,
  activationRedeeming,
  formatHistoryDate,
  onClose,
  onActivationCodeChange,
  onRedeemActivationCode,
  onSignOut,
  onStartLogin,
}: AccountSheetProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={onClose}>
      <section
        className="sheet-panel detail-modal account-modal account-sheet"
        aria-label="账号与授权"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">Account</p>
            <h2>账号与授权</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭账号面板">
            <X size={18} />
          </button>
        </header>
        <div className="account-content">
          <p className="settings-warning privacy-callout">
            <ShieldCheck size={16} />
            <span>
              账号服务只验证登录、激活码、授权状态和 LLM API 调用额度；视频、音频、文字稿和历史记录仍保留在本机，LLM 配置由管理员统一管理。
            </span>
          </p>
          <div className={`account-status-card ${canProcessWithAccount(account) ? "active" : "inactive"}`}>
            <div>
              <span className="account-status-label">{accountStatusText}</span>
              <strong>{account.email ?? "FrameQ 账号"}</strong>
              {account.serverError ? <small>{account.serverError}</small> : null}
            </div>
          </div>

          {account.authenticated ? (
            <div className="account-quota-grid">
              <div>
                <span className="account-status-label">LLM API 调用额度</span>
                <strong>
                  {account.llmQuotaRemaining} / {account.llmQuotaLimit}
                </strong>
                <small>
                  {account.llmQuotaResetsAt
                    ? `随授权到期重置：${formatHistoryDate(account.llmQuotaResetsAt)}`
                    : "激活后获得 LLM API 调用次数"}
                </small>
              </div>
              <div>
                <span className="account-status-label">LLM 配置</span>
                <strong>{account.llmConfigured ? "已就绪" : "待管理员配置"}</strong>
                <small>客户端会在每次云端 LLM 调用前自动授权并领取配置。</small>
              </div>
            </div>
          ) : null}

          {account.authenticated && !canProcessWithAccount(account) ? (
            <div className="activation-panel">
              <div>
                <span className="account-status-label">激活码</span>
                <strong>输入管理员发放的激活码</strong>
                <small>兑换成功后将为当前邮箱增加 31 天权益。</small>
              </div>
              <input
                className="activation-code-input"
                value={activationCodeDraft}
                onChange={(event) => onActivationCodeChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onRedeemActivationCode();
                  }
                }}
                placeholder="FQ-XXXX-XXXX-XXXX-XXXX"
                disabled={activationRedeeming}
              />
            </div>
          ) : null}

          {accountNotice ? <p className="action-notice inline-notice">{accountNotice}</p> : null}
        </div>
        <div className="settings-actions sheet-footer">
          {account.authenticated ? (
            <button type="button" className="secondary-button" onClick={onSignOut} disabled={accountLoading}>
              <span>退出登录</span>
            </button>
          ) : (
            <button type="button" className="secondary-button" onClick={onClose}>
              <span>稍后</span>
            </button>
          )}
          {account.authenticated ? (
            <button
              type="button"
              className="primary-button"
              onClick={onRedeemActivationCode}
              disabled={activationRedeeming || canProcessWithAccount(account)}
            >
              <KeyRound size={16} />
              <span>{canProcessWithAccount(account) ? "授权已生效" : activationRedeeming ? "兑换中" : "兑换激活码"}</span>
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={onStartLogin} disabled={accountLoading}>
              <UserRound size={16} />
              <span>{accountLoading ? "登录中" : "邮箱登录"}</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
