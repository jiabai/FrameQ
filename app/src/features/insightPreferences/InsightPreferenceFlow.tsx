import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Lightbulb,
  RotateCcw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  INSIGHT_PREFERENCE_FIELDS,
  summarizeGenerationPreferences,
  summarizeInspirationProfile,
  type GenerationPreferenceField,
  type GenerationPreferences,
  type InspirationProfile,
} from "../../insightPreferences";
import {
  advanceGenerationStep,
  backGenerationStep,
  cancelProfileSetupInFlow,
  selectGenerationOption,
  startGenerationPreferenceEditing,
  startProfileSetupInFlow,
  useDefaultGenerationPreferences,
  type InsightPreferenceFlowState,
} from "../../insightPreferenceFlow";
import { InspirationProfileForm } from "./InspirationProfileForm";

type InsightPreferenceFlowProps = {
  flow: InsightPreferenceFlowState;
  busy: boolean;
  accountQuotaRemaining: number;
  transcriptLength: number;
  transcriptPath: string | null;
  onFlowChange: (flow: InsightPreferenceFlowState) => void;
  onSkipProfile: () => void;
  onSaveProfile: (profile: InspirationProfile) => void;
  onConfirm: (preferences: GenerationPreferences) => void;
  onCancel: () => void;
};

export function InsightPreferenceFlow({
  flow,
  busy,
  accountQuotaRemaining,
  transcriptLength,
  transcriptPath,
  onFlowChange,
  onSkipProfile,
  onSaveProfile,
  onConfirm,
  onCancel,
}: InsightPreferenceFlowProps) {
  const title =
    flow.screen === "profile_intro" || flow.screen === "profile_form"
      ? "我的灵感档案"
      : flow.screen === "confirmation"
        ? "确认 AI 整理"
        : "本次生成偏好";

  return (
    <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="sheet-panel detail-modal preference-flow-sheet"
        aria-label={title}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header sheet-header">
          <div>
            <p className="section-label">Insight direction</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="关闭偏好流程">
            <X size={18} />
          </button>
        </header>

        {flow.screen === "profile_intro" ? (
          <ProfileIntro
            resetRequired={flow.profileResetRequired}
            busy={busy}
            onStart={() => onFlowChange(startProfileSetupInFlow(flow))}
            onSkip={onSkipProfile}
          />
        ) : null}

        {flow.screen === "profile_form" ? (
          <InspirationProfileForm
            initialProfile={flow.profile}
            busy={busy}
            onCancel={() => {
              const nextFlow = cancelProfileSetupInFlow(flow);
              if (nextFlow) {
                onFlowChange(nextFlow);
                return;
              }
              onCancel();
            }}
            onSave={onSaveProfile}
          />
        ) : null}

        {flow.screen === "default_summary" ? (
          <DefaultSummary
            flow={flow}
            busy={busy}
            onDirect={() => onFlowChange(useDefaultGenerationPreferences(flow))}
            onModify={() => onFlowChange(startGenerationPreferenceEditing(flow))}
            onEditProfile={() => onFlowChange(startProfileSetupInFlow(flow))}
          />
        ) : null}

        {flow.screen === "generation_step" ? (
          <GenerationStep
            flow={flow}
            busy={busy}
            onFlowChange={onFlowChange}
          />
        ) : null}

        {flow.screen === "confirmation" ? (
          <ConfirmationStep
            flow={flow}
            busy={busy}
            accountQuotaRemaining={accountQuotaRemaining}
            transcriptLength={transcriptLength}
            transcriptPath={transcriptPath}
            onBack={() => onFlowChange(startGenerationPreferenceEditing(flow))}
            onConfirm={() => onConfirm(flow.generationPreferences)}
            onCancel={onCancel}
          />
        ) : null}
      </section>
    </div>
  );
}

function ProfileIntro({
  resetRequired,
  busy,
  onStart,
  onSkip,
}: {
  resetRequired: boolean;
  busy: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="preference-flow-content">
      <div className="preference-panel">
        <UserRound size={20} />
        <div>
          <strong>{resetRequired ? "灵感档案需要重新设置" : "先设置一次长期语境"}</strong>
          <p>
            {resetRequired
              ? "当前本地档案无法用于生成。"
              : "可设置角色、领域、城市语境和常用平台。"}
          </p>
        </div>
      </div>
      <div className="settings-actions sheet-footer">
        <button type="button" className="secondary-button" onClick={onSkip} disabled={busy}>
          <span>{busy ? "处理中" : "跳过"}</span>
        </button>
        <button type="button" className="primary-button" onClick={onStart} disabled={busy}>
          <UserRound size={16} />
          <span>开始设置</span>
        </button>
      </div>
    </div>
  );
}

function DefaultSummary({
  flow,
  busy,
  onDirect,
  onModify,
  onEditProfile,
}: {
  flow: InsightPreferenceFlowState;
  busy: boolean;
  onDirect: () => void;
  onModify: () => void;
  onEditProfile: () => void;
}) {
  return (
    <div className="preference-flow-content">
      <SummaryGroup title="灵感档案" lines={summarizeInspirationProfile(flow.profile)} />
      <SummaryGroup
        title="默认生成偏好"
        lines={
          flow.defaultGenerationPreferences
            ? summarizeGenerationPreferences(flow.defaultGenerationPreferences)
            : []
        }
      />
      <div className="settings-actions sheet-footer">
        <button type="button" className="secondary-button" onClick={onEditProfile} disabled={busy}>
          <UserRound size={16} />
          <span>编辑档案</span>
        </button>
        <button type="button" className="secondary-button" onClick={onModify} disabled={busy}>
          <RotateCcw size={16} />
          <span>修改方向</span>
        </button>
        <button type="button" className="primary-button" onClick={onDirect} disabled={busy}>
          <ChevronRight size={16} />
          <span>直接生成</span>
        </button>
      </div>
    </div>
  );
}

function GenerationStep({
  flow,
  busy,
  onFlowChange,
}: {
  flow: InsightPreferenceFlowState;
  busy: boolean;
  onFlowChange: (flow: InsightPreferenceFlowState) => void;
}) {
  const config = INSIGHT_PREFERENCE_FIELDS[flow.currentStep];
  const rawValue = flow.generationPreferences[flow.currentStep];
  const selectedValues = Array.isArray(rawValue) ? rawValue : [rawValue];
  const maxReached = Array.isArray(rawValue) && rawValue.length >= config.max;
  const isFinalStep = flow.currentStep === "avoid";

  return (
    <div className="preference-flow-content">
      <div className="preference-step-header">
        <span>{flow.currentStepIndex + 1} / 6</span>
        <h3>{config.label}</h3>
      </div>
      <div className="preference-options large">
        {config.options.map((option) => {
          const selected = selectedValues.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className={`preference-option ${selected ? "selected" : ""}`}
              disabled={busy || (!selected && maxReached)}
              onClick={() =>
                onFlowChange(
                  selectGenerationOption(
                    flow,
                    flow.currentStep as GenerationPreferenceField,
                    option.id,
                  ),
                )
              }
            >
              {selected ? <CheckCircle2 size={14} /> : null}
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      <div className="settings-actions sheet-footer">
        <button
          type="button"
          className="secondary-button"
          disabled={busy || flow.currentStepIndex === 0}
          onClick={() => onFlowChange(backGenerationStep(flow))}
        >
          <ArrowLeft size={16} />
          <span>上一步</span>
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !flow.canAdvance}
          onClick={() => onFlowChange(advanceGenerationStep(flow))}
        >
          <ChevronRight size={16} />
          <span>{isFinalStep ? "完成选择" : "下一步"}</span>
        </button>
      </div>
    </div>
  );
}

function ConfirmationStep({
  flow,
  busy,
  accountQuotaRemaining,
  transcriptLength,
  transcriptPath,
  onBack,
  onConfirm,
  onCancel,
}: {
  flow: InsightPreferenceFlowState;
  busy: boolean;
  accountQuotaRemaining: number;
  transcriptLength: number;
  transcriptPath: string | null;
  onBack: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="preference-flow-content">
      <p className="settings-warning privacy-callout">
        <ShieldCheck size={16} />
        <span>
          确认后会把文字稿片段发送到管理员配置的云端 LLM；偏好快照只用于启发话题点，不用于要点总结或 Mermaid mindmap。
        </span>
      </p>
      <div className="confirm-summary preference-confirm-grid">
        <div>
          <span className="account-status-label">当前文字稿</span>
          <strong>{transcriptLength > 0 ? `${transcriptLength.toLocaleString("zh-CN")} 字` : "等待文字稿"}</strong>
          <small>{transcriptPath || "文字稿文件生成后才能继续。"}</small>
        </div>
        <div>
          <span className="account-status-label">账号额度</span>
          <strong>{accountQuotaRemaining} 次可用</strong>
          <small>确认后消耗 1 次，失败或部分失败也扣除。</small>
        </div>
      </div>
      <SummaryGroup title="灵感档案" lines={summarizeInspirationProfile(flow.profile)} />
      <SummaryGroup
        title="本次生成偏好"
        lines={summarizeGenerationPreferences(flow.generationPreferences)}
      />
      <div className="settings-actions sheet-footer">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
          <span>取消</span>
        </button>
        <button type="button" className="secondary-button" onClick={onBack} disabled={busy}>
          <ArrowLeft size={16} />
          <span>返回修改</span>
        </button>
        <button type="button" className="primary-button" onClick={onConfirm} disabled={busy}>
          <Lightbulb size={16} />
          <span>{busy ? "启动中" : "确认"}</span>
        </button>
      </div>
    </div>
  );
}

function SummaryGroup({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section className="preference-summary-group">
      <h3>{title}</h3>
      <div className="preference-summary-list">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    </section>
  );
}
