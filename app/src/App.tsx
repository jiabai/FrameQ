import { FormEvent, useMemo, useRef, useState } from "react";
import {
  Copy,
  Download,
  FileText,
  Lightbulb,
  Play,
  RotateCcw,
  Search,
  Settings,
  X,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import "./App.css";
import {
  canSubmitUrl,
  cancelProcessing,
  createInitialWorkflow,
  formatWorkerError,
  getDetailText,
  getExportPath,
  getProgressSteps,
  getResultCards,
  isProcessingStage,
  mergeProgressEvent,
  startProcessing,
  startInsightRetry,
  summarizeWorkerResult,
  type DetailTab,
  type ResultCard,
  type WorkflowState,
} from "./workflow";
import { cancelProcess, processVideo, retryInsights } from "./workerClient";
import { getLlmConfig, saveLlmConfig, type LlmConfigDraft } from "./settingsClient";

const stageCopy: Record<WorkflowState["stage"], { title: string; body: string }> = {
  waiting_input: {
    title: "等待输入",
    body: "等待用户提交视频链接。",
  },
  video_extracting: {
    title: "视频提取中",
    body: "正在下载视频并提取音频，请保持网络连接。",
  },
  video_transcribing: {
    title: "视频转译中",
    body: "正在使用 Qwen3-ASR-0.6B 识别语音内容。",
  },
  insights_generating: {
    title: "话题点生成中",
    body: "正在使用 InsightFlow 从文字稿中提炼启发话题点。",
  },
  completed: {
    title: "文字稿完成",
    body: "文字稿和启发话题点已准备好。",
  },
  partial_completed: {
    title: "部分完成",
    body: "文字稿已生成，话题点稍后可以重试。",
  },
  failed: {
    title: "失败",
    body: "处理失败，请检查链接或稍后重试。",
  },
};

function App() {
  const [workflow, setWorkflow] = useState(createInitialWorkflow);
  const [detailTab, setDetailTab] = useState<DetailTab | null>(null);
  const [actionNotice, setActionNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<LlmConfigDraft>({
    baseUrl: "",
    apiKey: "",
    model: "",
    timeoutSeconds: "60",
  });
  const [settingsHasApiKey, setSettingsHasApiKey] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const operationIdRef = useRef(0);
  const canSubmit = canSubmitUrl(workflow.url);
  const progressSteps = useMemo(() => getProgressSteps(workflow), [workflow]);
  const resultCards = useMemo(() => getResultCards(workflow), [workflow]);

  async function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const submittedUrl = workflow.url;
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setWorkflow((current) => startProcessing(current, submittedUrl));
    const result = await processVideo(submittedUrl, undefined, (event) => {
      if (operationIdRef.current === operationId) {
        setWorkflow((current) => mergeProgressEvent(current, event));
      }
    });
    if (operationIdRef.current !== operationId) {
      return;
    }
    setWorkflow((current) => ({
      ...summarizeWorkerResult(result),
      url: submittedUrl,
      submittedUrl: current.submittedUrl || submittedUrl,
    }));
  }

  function resetWorkflow() {
    operationIdRef.current += 1;
    setDetailTab(null);
    setActionNotice("");
    setWorkflow(createInitialWorkflow());
  }

  function resetOrCancelWorkflow() {
    if (isProcessingStage(workflow.stage)) {
      void cancelCurrentProcessing();
      return;
    }

    resetWorkflow();
  }

  async function cancelCurrentProcessing() {
    operationIdRef.current += 1;
    setDetailTab(null);
    setActionNotice("");
    setWorkflow((current) => cancelProcessing(current));
    await cancelProcess();
  }

  function openCard(card: ResultCard) {
    if (card.action === "open") {
      setActionNotice("");
      setDetailTab(card.id);
      return;
    }

    if (card.action === "retry") {
      void retryInsightGeneration();
    }
  }

  async function retryInsightGeneration() {
    if (!workflow.transcriptPath) {
      return;
    }

    const transcriptPath = workflow.transcriptPath;
    const transcriptText = workflow.text;
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setDetailTab(null);
    setActionNotice("");
    setWorkflow((current) => startInsightRetry(current));

    const result = await retryInsights(transcriptPath, transcriptText);
    if (operationIdRef.current !== operationId) {
      return;
    }
    setWorkflow((current) => ({
      ...summarizeWorkerResult(result),
      url: current.url,
      submittedUrl: current.submittedUrl,
    }));
  }

  async function copyDetail() {
    if (!detailTab) {
      return;
    }
    const text = getDetailText(detailTab, workflow);
    if (!text) {
      setActionNotice("暂无可复制内容。");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setActionNotice("已复制到剪贴板。");
    } catch {
      setActionNotice("复制失败，请手动选择内容复制。");
    }
  }

  async function exportDetail() {
    if (!detailTab) {
      return;
    }
    const exportPath = getExportPath(detailTab, workflow);
    if (!exportPath) {
      setActionNotice("暂无可导出的文件。");
      return;
    }

    try {
      await revealItemInDir(exportPath);
      setActionNotice("已在文件管理器中定位导出文件。");
    } catch {
      setActionNotice(`无法定位文件：${exportPath}`);
    }
  }

  async function openSettings() {
    setSettingsOpen(true);
    setSettingsLoading(true);
    setSettingsNotice("正在读取配置。");
    try {
      const config = await getLlmConfig();
      setSettingsDraft({
        baseUrl: config.baseUrl,
        apiKey: "",
        model: config.model,
        timeoutSeconds: config.timeoutSeconds,
      });
      setSettingsHasApiKey(config.hasApiKey);
      setSettingsNotice(config.hasApiKey ? "已保存密钥；留空可继续保留。" : "尚未保存密钥。");
    } catch (error) {
      setSettingsNotice(`读取配置失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSettingsLoading(false);
    }
  }

  async function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsSaving(true);
    setSettingsNotice("");
    try {
      const config = await saveLlmConfig(settingsDraft);
      setSettingsDraft((current) => ({
        ...current,
        apiKey: "",
        baseUrl: config.baseUrl,
        model: config.model,
        timeoutSeconds: config.timeoutSeconds,
      }));
      setSettingsHasApiKey(config.hasApiKey);
      setSettingsNotice("配置已保存，后续话题点生成会使用新的 LLM 设置。");
    } catch (error) {
      setSettingsNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSettingsSaving(false);
    }
  }

  function updateSettingsDraft(field: keyof LlmConfigDraft, value: string) {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  }

  const activeCopy = stageCopy[workflow.stage];
  const detailTitle = detailTab === "insights" ? "启发话题点" : "完整文字稿";
  const detailText = detailTab ? getDetailText(detailTab, workflow) : "";
  const exportPath = detailTab ? getExportPath(detailTab, workflow) : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">FrameQ</p>
          <h1>视频转文字</h1>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" type="button" onClick={openSettings} aria-label="配置 LLM">
            <Settings size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={resetOrCancelWorkflow}
            aria-label="处理新 URL"
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      <section className="workspace" aria-label="视频处理工作区">
        {workflow.showUrlInput ? (
          <form className="input-pane" onSubmit={submitUrl}>
            <label htmlFor="video-url">视频 URL</label>
            <div className="url-row">
              <input
                id="video-url"
                value={workflow.url}
                onChange={(event) =>
                  setWorkflow((current) => ({ ...current, url: event.currentTarget.value }))
                }
                placeholder="https://www.douyin.com/video/7524373044106677544"
              />
              <button className="primary-button" type="submit" disabled={!canSubmit}>
                <Play size={18} />
                <span>确认并转文字</span>
              </button>
            </div>
            <p className="status-line">{activeCopy.body}</p>
          </form>
        ) : (
          <section className="process-pane" aria-label="处理进度">
            <div className="process-heading">
              <div>
                <p className="section-label">处理进度</p>
                <h2>{activeCopy.title}</h2>
              </div>
              {isProcessingStage(workflow.stage) ? (
                <button className="secondary-button" type="button" onClick={cancelCurrentProcessing}>
                  <X size={17} />
                  <span>取消</span>
                </button>
              ) : null}
            </div>

            <div className="steps" aria-label="处理阶段">
              {progressSteps.map((step) => (
                <div className={`step ${step.state}`} key={step.id}>
                  <span className="step-dot" />
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
            <div className="progress-track">
              <span
                className={`progress-fill ${workflow.stage}`}
                style={{ width: `${workflow.progressPercent || undefined}%` }}
              />
            </div>
            <p className="status-line">{workflow.statusMessage || activeCopy.body}</p>
          </section>
        )}

        <section className="result-area" aria-label="结果总览">
          {workflow.stage === "failed" && workflow.error ? (
            <div className="error-result">
              <X size={20} />
              <div>
                <strong>{workflow.error.code}</strong>
                <span>{formatWorkerError(workflow.error)}</span>
              </div>
            </div>
          ) : resultCards.length > 0 ? (
            <div className="result-grid">
              {resultCards.map((card) => (
                <button
                  className={`result-card ${card.status}`}
                  key={card.id}
                  type="button"
                  onClick={() => openCard(card)}
                >
                  {card.id === "insights" ? <Lightbulb size={22} /> : <FileText size={22} />}
                  <span>{card.title}</span>
                  <small>{card.action === "retry" ? "重试生成" : "打开详情"}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-result">
              <FileText size={20} />
              <span>
                {workflow.stage === "waiting_input"
                  ? "提交后开始处理。"
                  : workflow.stage === "insights_generating" && workflow.text
                    ? "文字稿已保留，正在重新生成话题点。"
                    : "视频提取完成后将开始转译。"}
              </span>
            </div>
          )}
        </section>
      </section>

      {detailTab ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setDetailTab(null)}>
          <section
            className="detail-modal"
            aria-label="结果详情"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <h2>{detailTitle}</h2>
              <button className="icon-button" type="button" onClick={() => setDetailTab(null)}>
                <X size={18} />
              </button>
            </header>
            <div className="tabs">
              <button
                className={detailTab === "insights" ? "selected" : ""}
                type="button"
                onClick={() => setDetailTab("insights")}
              >
                启发话题点
              </button>
              <button
                className={detailTab === "transcript" ? "selected" : ""}
                type="button"
                onClick={() => setDetailTab("transcript")}
              >
                完整文字稿
              </button>
            </div>
            <div className="modal-tools">
              <label className="search-box">
                <Search size={16} />
                <input placeholder="搜索关键词..." />
              </label>
              <div className="tool-actions">
                <button type="button" onClick={copyDetail} disabled={!detailText}>
                  <Copy size={16} />
                  <span>复制</span>
                </button>
                <button type="button" onClick={exportDetail} disabled={!exportPath}>
                  <Download size={16} />
                  <span>导出</span>
                </button>
              </div>
            </div>
            {actionNotice ? <p className="action-notice">{actionNotice}</p> : null}
            <div className="modal-content">
              {detailTab === "insights" ? (
                workflow.insights.length > 0 ? (
                  <ol>
                    {workflow.insights.map((insight) => (
                      <li key={insight}>{insight}</li>
                    ))}
                  </ol>
                ) : (
                  <p>话题点尚未生成。</p>
                )
              ) : (
                <p>{workflow.text || "文字稿生成后将在这里显示。"}</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section
            className="detail-modal settings-modal"
            aria-label="LLM 配置"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <div>
                <p className="section-label">InsightFlow</p>
                <h2>LLM 配置</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <form className="settings-form" onSubmit={submitSettings}>
              <p className="settings-warning">
                启用云端 LLM 后，文字稿片段会发送到你配置的服务。API Key 只写入本机
                .env，读取时不会回显完整密钥。
              </p>
              <label>
                <span>Base URL</span>
                <input
                  value={settingsDraft.baseUrl}
                  onChange={(event) => updateSettingsDraft("baseUrl", event.currentTarget.value)}
                  placeholder="https://api.openai.com/v1"
                  disabled={settingsLoading || settingsSaving}
                />
              </label>
              <label>
                <span>API Key</span>
                <input
                  value={settingsDraft.apiKey}
                  onChange={(event) => updateSettingsDraft("apiKey", event.currentTarget.value)}
                  placeholder={settingsHasApiKey ? "已保存密钥；留空保持不变" : "请输入 API Key"}
                  type="password"
                  disabled={settingsLoading || settingsSaving}
                />
              </label>
              <label>
                <span>Model</span>
                <input
                  value={settingsDraft.model}
                  onChange={(event) => updateSettingsDraft("model", event.currentTarget.value)}
                  placeholder="deepseek-ai/DeepSeek-V3.2"
                  disabled={settingsLoading || settingsSaving}
                />
              </label>
              <label>
                <span>Timeout seconds</span>
                <input
                  value={settingsDraft.timeoutSeconds}
                  onChange={(event) =>
                    updateSettingsDraft("timeoutSeconds", event.currentTarget.value)
                  }
                  inputMode="decimal"
                  placeholder="60"
                  disabled={settingsLoading || settingsSaving}
                />
              </label>
              {settingsNotice ? <p className="action-notice">{settingsNotice}</p> : null}
              <div className="settings-actions">
                <button type="button" className="secondary-button" onClick={() => setSettingsOpen(false)}>
                  <span>关闭</span>
                </button>
                <button className="primary-button" type="submit" disabled={settingsLoading || settingsSaving}>
                  <span>{settingsSaving ? "保存中" : "保存配置"}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
