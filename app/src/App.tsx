import { FormEvent, useMemo, useState } from "react";
import {
  Copy,
  Download,
  FileText,
  Lightbulb,
  Play,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import "./App.css";
import {
  canSubmitUrl,
  createInitialWorkflow,
  getProgressSteps,
  getResultCards,
  isProcessingStage,
  startProcessing,
  summarizeWorkerResult,
  type ResultCard,
  type WorkflowState,
} from "./workflow";
import { processVideo } from "./workerClient";

type DetailTab = ResultCard["id"];

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
  const canSubmit = canSubmitUrl(workflow.url);
  const progressSteps = useMemo(() => getProgressSteps(workflow), [workflow]);
  const resultCards = useMemo(() => getResultCards(workflow), [workflow]);

  async function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const submittedUrl = workflow.url;
    setWorkflow((current) => startProcessing(current, submittedUrl));
    const result = await processVideo(submittedUrl);
    setWorkflow((current) => ({
      ...summarizeWorkerResult(result),
      url: submittedUrl,
      submittedUrl: current.submittedUrl || submittedUrl,
    }));
  }

  function resetWorkflow() {
    setDetailTab(null);
    setWorkflow(createInitialWorkflow());
  }

  function openCard(card: ResultCard) {
    if (card.action === "open") {
      setDetailTab(card.id);
    }
  }

  const activeCopy = stageCopy[workflow.stage];
  const detailTitle = detailTab === "insights" ? "启发话题点" : "完整文字稿";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">FrameQ</p>
          <h1>视频转文字</h1>
        </div>
        <button className="icon-button" type="button" onClick={resetWorkflow} aria-label="处理新 URL">
          <RotateCcw size={18} />
        </button>
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
                <button className="secondary-button" type="button" onClick={resetWorkflow}>
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
              <span className={`progress-fill ${workflow.stage}`} />
            </div>
            <p className="status-line">{activeCopy.body}</p>
          </section>
        )}

        <section className="result-area" aria-label="结果总览">
          {workflow.stage === "failed" && workflow.error ? (
            <div className="error-result">
              <X size={20} />
              <div>
                <strong>{workflow.error.code}</strong>
                <span>{workflow.error.message}</span>
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
                {workflow.stage === "waiting_input" ? "提交后开始处理。" : "视频提取完成后将开始转译。"}
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
                <button type="button">
                  <Copy size={16} />
                  <span>复制</span>
                </button>
                <button type="button">
                  <Download size={16} />
                  <span>导出</span>
                </button>
              </div>
            </div>
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
    </main>
  );
}

export default App;
