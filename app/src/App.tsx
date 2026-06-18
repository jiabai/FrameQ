import { FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Download,
  FileText,
  FolderOpen,
  History as HistoryIcon,
  Lightbulb,
  LoaderCircle,
  Play,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
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
import { checkFirstRun, getLlmConfig, saveLlmConfig, type LlmConfigDraft } from "./settingsClient";
import { getHistory, historyItemToWorkerResult, type HistoryItem } from "./historyClient";
import {
  calculateDraggedWindowPosition,
  closeWindow,
  getWindowPosition,
  minimizeWindow,
  setWindowPosition,
  startWindowDrag,
  toggleMaximizeWindow,
  type WindowDragSession,
  type WindowPosition,
} from "./windowChrome";

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
    body: "正在使用内置 SenseVoice Small 识别语音内容。",
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

const historyStatusCopy: Record<HistoryItem["status"], string> = {
  completed: "已完成",
  partial_completed: "部分完成",
  failed: "失败",
};

const defaultAsrModels = ["iic/SenseVoiceSmall"];

const asrModelLabels: Record<string, string> = {
  "Qwen/Qwen3-ASR-0.6B": "Qwen3-ASR 0.6B",
  "iic/SenseVoiceSmall": "SenseVoice Small",
};

const stageSummary: Record<WorkflowState["stage"], string> = {
  waiting_input: "准备接收一个公开视频链接",
  video_extracting: "正在准备媒体文件",
  video_transcribing: "正在生成本地文字稿",
  insights_generating: "正在生成启发话题点",
  completed: "结果已可查看和导出",
  partial_completed: "文字稿已保留，可重试话题点",
  failed: "处理未完成，请查看原因",
};

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatProgressPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function getResultMeta(card: ResultCard, workflow: WorkflowState): string {
  if (card.id === "insights") {
    if (card.status === "failed") {
      return "生成失败，可仅重试话题点";
    }

    return `${workflow.insights.length} 个话题点`;
  }

  if (!workflow.text) {
    return "等待文字稿";
  }

  return `${workflow.text.length.toLocaleString("zh-CN")} 字`;
}

function App() {
  const [workflow, setWorkflow] = useState(createInitialWorkflow);
  const [detailTab, setDetailTab] = useState<DetailTab | null>(null);
  const [detailSearch, setDetailSearch] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<LlmConfigDraft>({
    baseUrl: "",
    apiKey: "",
    model: "",
    timeoutSeconds: "60",
    outputDir: "",
    asrModel: "iic/SenseVoiceSmall",
  });
  const [settingsSupportedAsrModels, setSettingsSupportedAsrModels] = useState(defaultAsrModels);
  const [settingsHasApiKey, setSettingsHasApiKey] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyNotice, setHistoryNotice] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const operationIdRef = useRef(0);
  const windowDragSessionRef = useRef<WindowDragSession | null>(null);
  const queuedWindowPositionRef = useRef<WindowPosition | null>(null);
  const windowMoveInFlightRef = useRef(false);
  const canSubmit = canSubmitUrl(workflow.url);
  const progressSteps = useMemo(() => getProgressSteps(workflow), [workflow]);
  const resultCards = useMemo(() => getResultCards(workflow), [workflow]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (detailTab) {
        setDetailTab(null);
        return;
      }

      if (historyOpen) {
        setHistoryOpen(false);
        return;
      }

      if (settingsOpen) {
        setSettingsOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailTab, historyOpen, settingsOpen]);

  useEffect(() => {
    let cancelled = false;

    async function openFirstRunSettingsIfNeeded() {
      try {
        const firstRun = await checkFirstRun();
        if (cancelled || !firstRun.missingLlmConfig) {
          return;
        }

        setSettingsOpen(true);
        await loadSettings(
          `首次启动：可现在配置启发话题点 LLM，也可以稍后配置。未配置时文字稿仍可生成，话题点稍后可重试。默认输出目录：${firstRun.defaultOutputDir}`,
        );
      } catch {
        // Browser-only development and tests do not always provide Tauri commands.
      }
    }

    void openFirstRunSettingsIfNeeded();
    return () => {
      cancelled = true;
    };
  }, []);

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
      setDetailSearch("");
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

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryItems([]);
    setHistoryNotice("正在读取历史记录。");
    try {
      const items = await getHistory();
      setHistoryItems(items);
      setHistoryNotice(items.length > 0 ? "" : "暂无历史任务。");
    } catch (error) {
      setHistoryNotice(`读取历史失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setHistoryLoading(false);
    }
  }

  function openHistoryItem(item: HistoryItem) {
    setWorkflow({
      ...summarizeWorkerResult(historyItemToWorkerResult(item)),
      url: item.url,
      submittedUrl: item.url,
    });
    setDetailTab(item.insights.length > 0 ? "insights" : item.text ? "transcript" : null);
    setActionNotice("");
    setHistoryOpen(false);
  }

  async function openSettings() {
    setSettingsOpen(true);
    await loadSettings();
  }

  async function loadSettings(successNotice?: string) {
    setSettingsLoading(true);
    setSettingsNotice("正在读取配置。");
    try {
      const config = await getLlmConfig();
      setSettingsDraft({
        baseUrl: config.baseUrl,
        apiKey: "",
        model: config.model,
        timeoutSeconds: config.timeoutSeconds,
        outputDir: config.outputDir,
        asrModel: config.asrModel,
      });
      setSettingsSupportedAsrModels(
        config.supportedAsrModels.length > 0 ? config.supportedAsrModels : defaultAsrModels,
      );
      setSettingsHasApiKey(config.hasApiKey);
      setSettingsNotice(
        successNotice ?? (config.hasApiKey ? "已保存密钥；留空可继续保留。" : "尚未保存密钥。"),
      );
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
        outputDir: config.outputDir,
        asrModel: config.asrModel,
      }));
      setSettingsSupportedAsrModels(
        config.supportedAsrModels.length > 0 ? config.supportedAsrModels : defaultAsrModels,
      );
      setSettingsHasApiKey(config.hasApiKey);
      setSettingsNotice("配置已保存，后续任务会使用新的 LLM 和输出目录设置。");
    } catch (error) {
      setSettingsNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSettingsSaving(false);
    }
  }

  function updateSettingsDraft(field: keyof LlmConfigDraft, value: string) {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  }

  function runWindowChromeAction(action: () => Promise<void>) {
    void action().catch((error) => {
      console.warn("Window chrome action failed", error);
    });
  }

  function flushQueuedWindowPosition() {
    if (windowMoveInFlightRef.current || !queuedWindowPositionRef.current) {
      return;
    }

    const position = queuedWindowPositionRef.current;
    queuedWindowPositionRef.current = null;
    windowMoveInFlightRef.current = true;
    void setWindowPosition(position)
      .catch((error) => {
        console.warn("Window drag move failed", error);
      })
      .finally(() => {
        windowMoveInFlightRef.current = false;
        flushQueuedWindowPosition();
      });
  }

  async function beginManualWindowDrag(pointerX: number, pointerY: number) {
    try {
      const position = await getWindowPosition();
      windowDragSessionRef.current = {
        pointerX,
        pointerY,
        windowX: position.x,
        windowY: position.y,
      };
    } catch (error) {
      console.warn("Manual window drag failed to start", error);
      runWindowChromeAction(startWindowDrag);
    }
  }

  function handleToolbarMouseDown(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a, [role='button']")) {
      return;
    }

    event.preventDefault();
    void beginManualWindowDrag(event.screenX, event.screenY);
  }

  useEffect(() => {
    function moveManualWindowDrag(event: globalThis.MouseEvent) {
      const session = windowDragSessionRef.current;
      if (!session) {
        return;
      }

      queuedWindowPositionRef.current = calculateDraggedWindowPosition(session, {
        pointerX: event.screenX,
        pointerY: event.screenY,
      });
      flushQueuedWindowPosition();
    }

    function stopManualWindowDrag() {
      windowDragSessionRef.current = null;
      queuedWindowPositionRef.current = null;
    }

    window.addEventListener("mousemove", moveManualWindowDrag);
    window.addEventListener("mouseup", stopManualWindowDrag);
    window.addEventListener("blur", stopManualWindowDrag);
    return () => {
      window.removeEventListener("mousemove", moveManualWindowDrag);
      window.removeEventListener("mouseup", stopManualWindowDrag);
      window.removeEventListener("blur", stopManualWindowDrag);
    };
  }, []);

  const activeCopy = stageCopy[workflow.stage];
  const progressPercent = formatProgressPercent(workflow.progressPercent);
  const detailTitle = detailTab === "insights" ? "启发话题点" : "完整文字稿";
  const detailText = detailTab ? getDetailText(detailTab, workflow) : "";
  const exportPath = detailTab ? getExportPath(detailTab, workflow) : null;
  const searchQuery = detailSearch.trim().toLocaleLowerCase();
  const visibleInsights = searchQuery
    ? workflow.insights.filter((insight) => insight.toLocaleLowerCase().includes(searchQuery))
    : workflow.insights;
  const visibleTranscript =
    searchQuery && workflow.text
      ? workflow.text
          .split(/\n+/)
          .filter((line) => line.toLocaleLowerCase().includes(searchQuery))
          .join("\n")
      : workflow.text;

  return (
    <main className="app-shell">
      <section className="desktop-window" aria-label="FrameQ 桌面窗口">
        <header className="app-toolbar topbar" data-tauri-drag-region="" onMouseDown={handleToolbarMouseDown}>
          <div className="traffic-lights" role="group" aria-label="窗口操作">
            <button
              className="traffic-light close"
              type="button"
              aria-label="关闭窗口"
              onClick={() => runWindowChromeAction(closeWindow)}
            />
            <button
              className="traffic-light minimize"
              type="button"
              aria-label="最小化窗口"
              onClick={() => runWindowChromeAction(minimizeWindow)}
            />
            <button
              className="traffic-light zoom"
              type="button"
              aria-label="最大化或还原窗口"
              onClick={() => runWindowChromeAction(toggleMaximizeWindow)}
            />
          </div>

          <div className="toolbar-title" data-tauri-drag-region="">
            <span className="app-mark" data-tauri-drag-region="">FQ</span>
            <div data-tauri-drag-region="">
              <p className="eyebrow" data-tauri-drag-region="">FrameQ</p>
              <h1 data-tauri-drag-region="">视频转文字</h1>
            </div>
          </div>

          <div className="topbar-actions toolbar-actions">
            <button className="icon-button" type="button" onClick={openHistory} aria-label="查看历史">
              <HistoryIcon size={17} />
            </button>
            <button className="icon-button" type="button" onClick={openSettings} aria-label="应用设置">
              <Settings size={17} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={resetOrCancelWorkflow}
              aria-label="处理新 URL"
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </header>

        <section
          className={`workspace ${workflow.showUrlInput ? "waiting-layout" : "active-layout"}`}
          aria-label="视频处理工作区"
        >
          <div className="workflow-column">
            {workflow.showUrlInput ? (
              <form className="command-panel input-pane" onSubmit={submitUrl}>
                <div className="panel-heading">
                  <div>
                    <p className="section-label">New task</p>
                    <h2>粘贴视频链接</h2>
                  </div>
                </div>

                <div className="url-row command-row">
                  <input
                    id="video-url"
                    aria-label="视频 URL"
                    value={workflow.url}
                    onChange={(event) => {
                      const url = event.currentTarget.value;
                      setWorkflow((current) => ({ ...current, url }));
                    }}
                    placeholder="https://www.douyin.com/video/7524373044106677544"
                  />
                  <button className="primary-button" type="submit" disabled={!canSubmit}>
                    <Play size={17} />
                    <span>确认</span>
                  </button>
                </div>
                <p className="status-line">{activeCopy.body}</p>
              </form>
            ) : (
              <section className={`process-monitor process-pane ${workflow.stage}`} aria-label="处理进度">
                <div className="process-heading">
                  <div>
                    <p className="section-label">Task monitor</p>
                    <h2>{activeCopy.title}</h2>
                  </div>
                  {isProcessingStage(workflow.stage) ? (
                    <button className="secondary-button danger-soft" type="button" onClick={cancelCurrentProcessing}>
                      <X size={17} />
                      <span>取消</span>
                    </button>
                  ) : null}
                </div>

                <div className="progress-summary">
                  <div>
                    <span className="progress-value">{progressPercent}</span>
                    <p>{stageSummary[workflow.stage]}</p>
                  </div>
                  <div className="progress-track">
                    <span
                      className={`progress-fill ${workflow.stage}`}
                      style={{ width: workflow.progressPercent ? progressPercent : undefined }}
                    />
                  </div>
                </div>

                <div className="steps" aria-label="处理阶段">
                  {progressSteps.map((step) => (
                    <div className={`step ${step.state}`} key={step.id}>
                      <span className="step-dot">
                        {step.state === "complete" ? (
                          <CheckCircle2 size={14} />
                        ) : step.state === "active" ? (
                          <LoaderCircle size={14} />
                        ) : (
                          <Circle size={14} />
                        )}
                      </span>
                      <span>{step.label}</span>
                    </div>
                  ))}
                </div>
                <p className="status-line worker-message">{workflow.statusMessage || activeCopy.body}</p>
              </section>
            )}
          </div>

          {!workflow.showUrlInput ? (
            <section className="result-workspace result-area" aria-label="结果总览">
              <div className="result-header">
                <div>
                  <p className="section-label">Results</p>
                  <h2>结果工作区</h2>
                </div>
              </div>

              {workflow.stage === "failed" && workflow.error ? (
                <div className="error-result">
                  <AlertTriangle size={20} />
                  <div>
                    <strong>{workflow.error.code}</strong>
                    <span>{formatWorkerError(workflow.error)}</span>
                    <small>失败阶段：{stageCopy[workflow.error.stage]?.title ?? workflow.error.stage}</small>
                  </div>
                </div>
              ) : resultCards.length > 0 ? (
                <div className="result-grid">
                  {resultCards.map((card) => (
                    <button
                      className={`result-card result-tile ${card.status}`}
                      key={card.id}
                      type="button"
                      onClick={() => openCard(card)}
                    >
                      <span className="result-icon">
                        {card.id === "insights" ? <Lightbulb size={22} /> : <FileText size={22} />}
                      </span>
                      <span>{card.title}</span>
                      <small>{getResultMeta(card, workflow)}</small>
                      <em>{card.action === "retry" ? "重试生成" : "打开详情"}</em>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="result-placeholder empty-result">
                  <div className="placeholder-icon">
                    <FileText size={20} />
                  </div>
                  <div>
                    <strong>结果生成中</strong>
                    <span>
                      {workflow.stage === "insights_generating" && workflow.text
                        ? "文字稿已保留，正在重新生成话题点。"
                        : "视频提取完成后将开始转译。"}
                    </span>
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </section>
      </section>

      {detailTab ? (
        <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={() => setDetailTab(null)}>
          <section
            className="sheet-panel detail-modal detail-sheet"
            aria-label="结果详情"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">Preview</p>
                <h2>{detailTitle}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setDetailTab(null)} aria-label="关闭详情">
                <X size={18} />
              </button>
            </header>
            <div className="tabs">
              <button
                className={detailTab === "insights" ? "selected" : ""}
                type="button"
                onClick={() => {
                  setDetailSearch("");
                  setDetailTab("insights");
                }}
              >
                启发话题点
              </button>
              <button
                className={detailTab === "transcript" ? "selected" : ""}
                type="button"
                onClick={() => {
                  setDetailSearch("");
                  setDetailTab("transcript");
                }}
              >
                完整文字稿
              </button>
            </div>
            <div className="modal-tools">
              <label className="search-box">
                <Search size={16} />
                <input
                  value={detailSearch}
                  onChange={(event) => setDetailSearch(event.currentTarget.value)}
                  placeholder="搜索关键词..."
                />
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
                  visibleInsights.length > 0 ? (
                    <ol>
                      {visibleInsights.map((insight) => (
                        <li key={insight}>{insight}</li>
                      ))}
                    </ol>
                  ) : (
                    <p>没有匹配的关键词。</p>
                  )
                ) : (
                  <p>话题点尚未生成。</p>
                )
              ) : (
                <p>{visibleTranscript || (searchQuery ? "没有匹配的关键词。" : "文字稿生成后将在这里显示。")}</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={() => setHistoryOpen(false)}>
          <section
            className="sheet-panel detail-modal history-modal history-sheet"
            aria-label="历史任务"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">History</p>
                <h2>历史任务</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setHistoryOpen(false)} aria-label="关闭历史">
                <X size={18} />
              </button>
            </header>
            {historyNotice ? <p className="action-notice">{historyNotice}</p> : null}
            <div className="history-list">
              {historyItems.map((item) => (
                <button
                  className={`history-item ${item.status}`}
                  key={item.id}
                  type="button"
                  onClick={() => openHistoryItem(item)}
                >
                  <div className="history-item-main">
                    <span className={`history-status ${item.status}`}>
                      {historyStatusCopy[item.status]}
                    </span>
                    <strong>{item.textPreview || item.url}</strong>
                  </div>
                  <div className="history-meta">
                    <span>
                      <Clock3 size={13} />
                      {formatHistoryDate(item.createdAt)}
                    </span>
                    <span>
                      <FolderOpen size={13} />
                      {item.outputDir || "outputs"}
                    </span>
                    <span>{item.error ? item.error.code : `${item.insightsCount} 个话题点`}</span>
                  </div>
                </button>
              ))}
              {!historyLoading && historyItems.length === 0 ? (
                <div className="history-empty">
                  <FileText size={18} />
                  <span>还没有可查看的历史任务。</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop sheet-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section
            className="sheet-panel detail-modal settings-modal settings-sheet"
            aria-label="应用设置"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header sheet-header">
              <div>
                <p className="section-label">FrameQ</p>
                <h2>应用设置</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭设置">
                <X size={18} />
              </button>
            </header>
            <form id="settings-form" className="settings-form" onSubmit={submitSettings}>
              <p className="settings-warning privacy-callout">
                <ShieldCheck size={16} />
                <span>
                  启用云端 LLM 后，文字稿片段会发送到你配置的服务。API Key 只写入本机
                  .env，读取时不会回显完整密钥。
                </span>
              </p>

              <section className="sheet-form-section">
                <div className="form-section-heading">
                  <h3>模型与输出</h3>
                  <p>这些设置只影响后续任务。</p>
                </div>
                <label className="field-row">
                  <span>ASR 模型</span>
                  <select
                    value={settingsDraft.asrModel}
                    onChange={(event) => updateSettingsDraft("asrModel", event.currentTarget.value)}
                    disabled={settingsLoading || settingsSaving}
                  >
                    {settingsSupportedAsrModels.map((model) => (
                      <option value={model} key={model}>
                        {asrModelLabels[model] ?? model}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-row">
                  <span>输出目录</span>
                  <input
                    value={settingsDraft.outputDir}
                    onChange={(event) => updateSettingsDraft("outputDir", event.currentTarget.value)}
                    placeholder="留空使用 outputs/"
                    disabled={settingsLoading || settingsSaving}
                  />
                </label>
              </section>

              <section className="sheet-form-section">
                <div className="form-section-heading">
                  <h3>启发话题点 LLM</h3>
                  <p>{settingsHasApiKey ? "已保存密钥，留空保持不变。" : "尚未保存密钥。"}</p>
                </div>
                <label className="field-row">
                  <span>Base URL</span>
                  <input
                    value={settingsDraft.baseUrl}
                    onChange={(event) => updateSettingsDraft("baseUrl", event.currentTarget.value)}
                    placeholder="https://api.openai.com/v1"
                    disabled={settingsLoading || settingsSaving}
                  />
                </label>
                <label className="field-row">
                  <span>API Key</span>
                  <input
                    value={settingsDraft.apiKey}
                    onChange={(event) => updateSettingsDraft("apiKey", event.currentTarget.value)}
                    placeholder={settingsHasApiKey ? "已保存密钥；留空保持不变" : "请输入 API Key"}
                    type="password"
                    disabled={settingsLoading || settingsSaving}
                  />
                </label>
                <label className="field-row">
                  <span>Model</span>
                  <input
                    value={settingsDraft.model}
                    onChange={(event) => updateSettingsDraft("model", event.currentTarget.value)}
                    placeholder="deepseek-ai/DeepSeek-V3.2"
                    disabled={settingsLoading || settingsSaving}
                  />
                </label>
                <label className="field-row">
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
              </section>

              {settingsNotice ? <p className="action-notice">{settingsNotice}</p> : null}
            </form>
            <div className="settings-actions sheet-footer">
              <button type="button" className="secondary-button" onClick={() => setSettingsOpen(false)}>
                <span>关闭</span>
              </button>
              <button
                className="primary-button"
                type="submit"
                form="settings-form"
                disabled={settingsLoading || settingsSaving}
              >
                <span>{settingsSaving ? "保存中" : "保存配置"}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
