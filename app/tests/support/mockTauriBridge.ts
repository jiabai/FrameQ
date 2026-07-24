export type UiSmokeScenario = {
  deferredCommands?: string[];
  rejectedCommands?: Record<string, string>;
  responses?: Record<string, unknown>;
};

const firstHistoryTask = {
  task_id: "history-task-a",
  id: "history-task-a",
  created_at: "2026-07-11T08:00:00.000Z",
  source: {
    kind: "url",
    url: "https://www.douyin.com/video/7000000000000000001",
  },
  status: "completed",
  task_dir: "C:/FrameQ/outputs/tasks/history-task-a",
  output_dir: "C:/FrameQ/outputs",
  artifacts: {
    video: "media/video.mp4",
    audio: "media/audio.wav",
    transcript_txt: "transcript/transcript.txt",
    transcript_md: "transcript/transcript.md",
  },
  error: null,
  text_preview: "历史任务甲文字稿",
  insights_count: 0,
  text: "历史任务甲完整文字稿",
  summary: "",
  transcript: null,
  insights: [],
};

const secondHistoryTask = {
  ...firstHistoryTask,
  task_id: "history-task-b",
  id: "history-task-b",
  created_at: "2026-07-11T09:00:00.000Z",
  source: {
    kind: "url",
    url: "https://www.douyin.com/video/7000000000000000002",
  },
  task_dir: "C:/FrameQ/outputs/tasks/history-task-b",
  text_preview: "历史任务乙文字稿",
  text: "历史任务乙完整文字稿",
};

function historyDetailResponse(task: typeof firstHistoryTask) {
  return {
    task_id: task.task_id,
    source: task.source,
    status: task.status,
    task_dir: task.task_dir,
    artifacts: task.artifacts,
    error: task.error,
    text: task.text,
    summary: task.summary,
    transcript: task.transcript,
    insights: task.insights,
  };
}

const defaultResponses: Record<string, unknown> = {
  get_ui_preferences: {
    schemaVersion: 1,
    language: "zh-CN",
    recovered: false,
  },
  check_first_run: {
    user_data_dir: "C:/FrameQ",
    default_output_dir: "C:/FrameQ/outputs",
    asr_model: "iic/SenseVoiceSmall",
    asr_model_dir: "C:/FrameQ/models/SenseVoiceSmall",
    asr_model_available: true,
    asr_model_source: "modelscope",
  },
  get_account_status: {
    authenticated: true,
    email: "ui-smoke@frameq.local",
    entitlement_status: "active",
    entitlement_expires_at: null,
    llm_quota_limit: 20,
    llm_quota_used: 0,
    llm_quota_remaining: 20,
    llm_quota_resets_at: null,
    llm_configured: true,
    last_verified_at: null,
    can_process: true,
    can_generate_ai: true,
    server_error: null,
  },
  get_update_delivery: {
    inAppUpdates: false,
    releasesUrl: "https://example.invalid/releases",
  },
  get_update_preferences: {
    lastCheckedAt: null,
    postponedUntil: null,
    skippedVersion: null,
  },
  get_llm_config: {
    output_dir: "C:/FrameQ/outputs",
    asr_model: "iic/SenseVoiceSmall",
    supported_asr_models: ["iic/SenseVoiceSmall"],
    config_path: "C:/FrameQ/frameq-settings.json",
  },
  get_audio_review_cache_usage: {
    size_bytes: 1_572_864,
    cache_path: "C:/FrameQ/cache/.frameq-audio-review",
  },
  clear_audio_review_cache: {
    size_bytes: 0,
    cache_path: "C:/FrameQ/cache/.frameq-audio-review",
  },
  get_insight_preferences: {
    profile: {
      role: "content_creator",
      domain: "technology_rd",
      stage: "experienced_professional",
      cityContext: "new_tier1_city",
      genderPerspective: "unspecified",
      platforms: ["xiaohongshu"],
      defaultStyles: ["professional_analysis"],
      defaultAvoid: [],
    },
    profileSkipped: false,
    profileStatus: "valid",
    profileError: null,
    defaultGenerationPreferences: {
      goal: "content_creation",
      scenario: "personal_notes",
      angles: ["practical_advice"],
      audience: "self",
      styles: ["professional_analysis"],
      avoid: [],
    },
    preferencesPath: "C:/FrameQ/insight-preferences.json",
  },
  get_history: [firstHistoryTask, secondHistoryTask].map(
    ({ text: _text, summary: _summary, transcript: _transcript, insights: _insights, ...item }) => item,
  ),
  get_history_detail: {
    "history-task-a": historyDetailResponse(firstHistoryTask),
    "history-task-b": historyDetailResponse(secondHistoryTask),
  },
  process_video: {
    status: "completed",
    task_id: "live-task",
    task_dir: "C:/FrameQ/outputs/tasks/live-task",
    artifacts: firstHistoryTask.artifacts,
    text: "当前处理任务文字稿",
    summary: "",
    insights: [],
    transcript: null,
    error: null,
  },
  cancel_process: { status: "cancelling", error: null },
};

export function createUiSmokeBridgeScript(scenario: UiSmokeScenario): string {
  const config = JSON.stringify({
    deferredCommands: scenario.deferredCommands ?? [],
    rejectedCommands: scenario.rejectedCommands ?? {},
    responses: { ...defaultResponses, ...(scenario.responses ?? {}) },
  });

  return `
    (() => {
      const scenario = ${config};
      const callbacks = {};
      const pending = {};
      let callbackId = 1;

      const smoke = {
        ready: true,
        commands: [],
        pending,
        resolve(command, value) {
          const queue = pending[command] || [];
          const entry = queue.shift();
          if (!entry) throw new Error("No pending mock command: " + command);
          entry.resolve(value === undefined ? scenario.responses[command] : value);
        },
        reject(command, message) {
          const queue = pending[command] || [];
          const entry = queue.shift();
          if (!entry) throw new Error("No pending mock command: " + command);
          entry.reject(new Error(message || "mock command failed"));
        }
      };
      window.__FRAMEQ_UI_SMOKE__ = smoke;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      window.__TAURI_INTERNALS__ = {
        callbacks,
        transformCallback(callback) {
          const id = callbackId++;
          callbacks[id] = callback;
          return id;
        },
        unregisterCallback(id) {
          delete callbacks[id];
        },
        invoke(command, args) {
          smoke.commands.push({ command, args: args || {} });
          if (command === "plugin:deep-link|get_current") {
            return Promise.resolve(
              scenario.responses["plugin:deep-link|get_current"] || []
            );
          }
          if (command === "plugin:event|listen") return Promise.resolve(1);
          if (command === "plugin:event|unlisten") return Promise.resolve(null);
          if (Object.prototype.hasOwnProperty.call(scenario.rejectedCommands, command)) {
            return Promise.reject(new Error(scenario.rejectedCommands[command]));
          }
          if (scenario.deferredCommands.includes(command)) {
            return new Promise((resolve, reject) => {
              (pending[command] ||= []).push({ resolve, reject });
            });
          }
          if (command === "get_history_detail") {
            const taskId = args?.request?.task_id;
            return Promise.resolve(scenario.responses.get_history_detail?.[taskId]);
          }
          if (command === "delete_history_task") {
            return Promise.resolve({
              task_id: args?.request?.task_id,
              deleted: true
            });
          }
          if (command === "load_transcript_detail") {
            const taskId = args?.request?.task_id;
            if (scenario.responses.load_transcript_detail) {
              return Promise.resolve({
                ...scenario.responses.load_transcript_detail,
                task_id: taskId,
              });
            }
            const text = taskId === "history-task-b"
              ? "历史任务乙完整文字稿"
              : "历史任务甲完整文字稿";
            return Promise.resolve({
              task_id: taskId,
              text,
              segments: [],
              audio_path: null,
              audio_asset_path: null,
              has_original_backup: false
            });
          }
          if (command === "save_transcript_edit") {
            return Promise.resolve({
              task_id: args?.request?.task_id,
              text: args?.request?.text,
              artifacts: { transcript_txt: "transcript/transcript.txt" },
              has_original_backup: true
            });
          }
          if (command === "save_default_generation_preferences") {
            return Promise.resolve({
              ...scenario.responses.get_insight_preferences,
              defaultGenerationPreferences: args?.preferences
            });
          }
          if (command === "save_ui_preferences") {
            return Promise.resolve({
              schemaVersion: 1,
              language: args?.preferences?.language,
              recovered: false
            });
          }
          if (command === "retry_insights") {
            const target = args?.request?.target;
            return Promise.resolve({
              status: "completed",
              task_id: args?.request?.task_id,
              task_dir: null,
              artifacts: target === "summary"
                ? { summary: "ai/summary.md", mindmap: "ai/mindmap.mmd" }
                : { insights: "ai/insights.json" },
              text: "",
              summary: target === "summary" ? "模拟要点总结" : "",
              insights: target === "insights" ? [{
                id: 1,
                topic: "模拟灵感",
                matchReason: "测试路由",
                followUpQuestions: ["下一步"],
                suitableUse: "自动化验证",
                sourceChunkId: 1
              }] : [],
              transcript: null,
              error: null
            });
          }
          if (Object.prototype.hasOwnProperty.call(scenario.responses, command)) {
            return Promise.resolve(scenario.responses[command]);
          }
          return Promise.reject(new Error("Unexpected mock command: " + command));
        },
        convertFileSrc(filePath) {
          return filePath;
        }
      };
    })();
  `;
}
