use crate::account;
use crate::settings::{env_path, parse_dotenv_values, resolve_asr_model_value, ASR_MODEL_ENV};
use crate::task_manifest;
use crate::{
    append_desktop_log, build_worker_command_spec, ensure_runtime_dirs,
    parse_worker_output_or_fallback, path_to_env_string, resolve_runtime_paths,
    run_blocking_worker_command, spawn_worker_command, summarize_worker_result_for_log,
    terminate_process_tree, worker_command_log_detail, worker_exit_log_detail, WorkerInvocation,
    WorkerProcessState, PROGRESS_EVENT_NAME, PROGRESS_EVENT_PREFIX,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State, Window};

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct ProcessVideoRequest {
    url: String,
    language: String,
    output_formats: Vec<String>,
    model: String,
    generate_insights: bool,
    insightflow_mode: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct RetryInsightsRequest {
    task_id: String,
    target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    preference_snapshot: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub(crate) struct WorkerError {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) stage: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ProcessVideoResult {
    pub(crate) status: String,
    pub(crate) task_id: Option<String>,
    pub(crate) task_dir: Option<String>,
    pub(crate) artifacts: HashMap<String, String>,
    pub(crate) text: String,
    pub(crate) summary: String,
    pub(crate) insights: Vec<task_manifest::InsightView>,
    pub(crate) transcript: Option<task_manifest::TranscriptMetadata>,
    pub(crate) error: Option<WorkerError>,
}

#[derive(Debug, Serialize)]
pub(crate) struct CancelProcessResult {
    pub(crate) cancelled: bool,
    pub(crate) error: Option<String>,
}

#[tauri::command]
pub(crate) async fn process_video(
    window: Window,
    app: AppHandle,
    process_state: State<'_, Arc<WorkerProcessState>>,
    request: ProcessVideoRequest,
) -> Result<serde_json::Value, String> {
    let process_state = Arc::clone(process_state.inner());
    run_blocking_worker_command(move || process_video_blocking(window, app, process_state, request))
        .await
}

fn process_video_blocking(
    window: Window,
    app: AppHandle,
    process_state: Arc<WorkerProcessState>,
    mut request: ProcessVideoRequest,
) -> Result<serde_json::Value, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let output_root = task_manifest::configured_output_root(&paths)?;
    if let Err(error) = apply_configured_asr_model_to_request(&env_path(&paths), &mut request) {
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "failed".to_string(),
            task_id: None,
            task_dir: None,
            artifacts: HashMap::new(),
            text: String::new(),
            summary: String::new(),
            insights: vec![],
            transcript: None,
            error: Some(WorkerError {
                code: "ASR_MODEL_UNSUPPORTED".to_string(),
                message: error,
                stage: "video_transcribing".to_string(),
            }),
        }));
    }
    if let Some(cached) = cached_process_result_for_request(&output_root, &request)? {
        let _ = append_desktop_log(
            &paths,
            "worker.process_video.cache_hit",
            &summarize_worker_result_for_log(&cached),
        );
        return Ok(cached);
    }
    let request_json = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    let spec = build_worker_command_spec(
        &paths,
        WorkerInvocation::ProcessVideo(request_json),
        None,
    )?;
    let _ = append_desktop_log(
        &paths,
        "worker.process_video.start",
        &worker_command_log_detail(&spec, "process_video"),
    );
    let mut child = spawn_worker_command(spec)?;
    let worker_pid = child.id();
    if !process_state.register(worker_pid) {
        let _ = terminate_process_tree(worker_pid);
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "failed".to_string(),
            task_id: None,
            task_dir: None,
            artifacts: HashMap::new(),
            text: String::new(),
            summary: String::new(),
            insights: vec![],
            transcript: None,
            error: Some(WorkerError {
                code: "WORKER_ALREADY_RUNNING".to_string(),
                message: "Another worker process is already running.".to_string(),
                stage: "video_extracting".to_string(),
            }),
        }));
    }

    let Some(stderr) = child.stderr.take() else {
        process_state.clear_current(worker_pid);
        let _ = terminate_process_tree(worker_pid);
        return Err("Could not capture worker stderr.".to_string());
    };
    let progress_window = window.clone();
    let stderr_reader = std::thread::spawn(move || {
        let mut diagnostic_lines = Vec::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(raw_event) = line.strip_prefix(PROGRESS_EVENT_PREFIX) {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(raw_event) {
                    let _ = progress_window.emit(PROGRESS_EVENT_NAME, payload);
                }
            } else if !line.trim().is_empty() {
                diagnostic_lines.push(line);
            }
        }
        diagnostic_lines.join("\n")
    });

    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(error) => {
            process_state.clear_current(worker_pid);
            let _ = process_state.take_cancelled(worker_pid);
            return Err(error.to_string());
        }
    };
    process_state.clear_current(worker_pid);
    let was_cancelled = process_state.take_cancelled(worker_pid);
    let stderr = stderr_reader
        .join()
        .unwrap_or_else(|_| "Worker stderr reader failed.".to_string());
    let _ = append_desktop_log(
        &paths,
        "worker.process_video.exit",
        &worker_exit_log_detail(worker_pid, &output, &stderr),
    );

    if was_cancelled {
        let _ = append_desktop_log(
            &paths,
            "worker.process_video.cancelled",
            &format!("pid={worker_pid}"),
        );
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "failed".to_string(),
            task_id: None,
            task_dir: None,
            artifacts: HashMap::new(),
            text: String::new(),
            summary: String::new(),
            insights: vec![],
            transcript: None,
            error: Some(WorkerError {
                code: "WORKER_CANCELLED".to_string(),
                message: "Worker process was cancelled.".to_string(),
                stage: "video_extracting".to_string(),
            }),
        }));
    }

    let parsed = parse_worker_output_or_fallback(
        &output,
        ProcessVideoResult {
            status: "failed".to_string(),
            task_id: None,
            task_dir: None,
            artifacts: HashMap::new(),
            text: String::new(),
            summary: String::new(),
            insights: vec![],
            transcript: None,
            error: Some(WorkerError {
                code: "WORKER_PROCESS_FAILED".to_string(),
                message: stderr,
                stage: "video_extracting".to_string(),
            }),
        },
    )?;
    let _ = append_desktop_log(
        &paths,
        "worker.process_video.result",
        &summarize_worker_result_for_log(&parsed),
    );
    Ok(parsed)
}

fn cached_process_result_for_request(
    output_root: &Path,
    request: &ProcessVideoRequest,
) -> Result<Option<serde_json::Value>, String> {
    let requested_source_url = normalize_cache_source_url(&request.url);
    if requested_source_url.is_empty() {
        return Ok(None);
    }

    let mut newest_cached: Option<(String, serde_json::Value)> = None;
    for manifest_path in task_manifest::list_task_manifest_paths(output_root)? {
        let Ok((manifest, task_dir)) = task_manifest::read_task_manifest_path(&manifest_path)
        else {
            continue;
        };
        if !reusable_task_manifest_matches(&manifest, &requested_source_url, request) {
            continue;
        }
        let Some((created_at, cached)) = cached_process_result_from_manifest(&task_dir, manifest)?
        else {
            continue;
        };
        if newest_cached
            .as_ref()
            .is_none_or(|(current_created_at, _)| created_at > *current_created_at)
        {
            newest_cached = Some((created_at, cached));
        }
    }

    Ok(newest_cached.map(|(_, value)| value))
}

fn reusable_task_manifest_matches(
    manifest: &task_manifest::TaskManifest,
    requested_source_url: &str,
    request: &ProcessVideoRequest,
) -> bool {
    if !matches!(manifest.status.as_str(), "completed" | "partial_completed") {
        return false;
    }
    if normalize_cache_source_url(&manifest.source_url) != requested_source_url {
        return false;
    }
    let manifest_model = manifest.model.trim();
    let request_model = request.model.trim();
    manifest_model.is_empty() || request_model.is_empty() || manifest_model == request_model
}

fn cached_process_result_from_manifest(
    task_dir: &Path,
    manifest: task_manifest::TaskManifest,
) -> Result<Option<(String, serde_json::Value)>, String> {
    let artifacts = cached_existing_artifacts(task_dir, &manifest);
    if !artifacts.contains_key("transcript_txt") {
        return Ok(None);
    }

    let text = read_cached_text_artifact(task_dir, &manifest, "transcript_txt").unwrap_or_default();
    let summary = read_cached_text_artifact(task_dir, &manifest, "summary").unwrap_or_default();
    let insights = read_cached_insights_artifact(task_dir, &manifest);
    let transcript = manifest.transcript_metadata();
    let status = manifest.status;
    let task_id = manifest.task_id;
    let created_at = manifest.created_at;
    let error = manifest.error.as_ref().map(|error| WorkerError {
        code: error.code.clone(),
        message: error.message.clone(),
        stage: error.stage.clone(),
    });

    let value = serde_json::json!(ProcessVideoResult {
        status,
        task_id: Some(task_id),
        task_dir: Some(path_to_env_string(task_dir)),
        artifacts,
        text,
        summary,
        insights,
        transcript,
        error,
    });
    Ok(Some((created_at, value)))
}

fn cached_existing_artifacts(
    task_dir: &Path,
    manifest: &task_manifest::TaskManifest,
) -> HashMap<String, String> {
    manifest
        .artifacts
        .iter()
        .filter_map(|(key, raw_path)| {
            let relative = task_manifest::validate_relative_artifact_path(raw_path, key).ok()?;
            let path = task_dir.join(relative);
            if !path.is_file()
                || task_manifest::validate_task_artifact_path(task_dir, &path, key).is_err()
            {
                return None;
            }
            Some((key.clone(), raw_path.clone()))
        })
        .collect()
}

fn read_cached_text_artifact(
    task_dir: &Path,
    manifest: &task_manifest::TaskManifest,
    key: &str,
) -> Option<String> {
    let path = task_manifest::artifact_path(task_dir, manifest, key).ok()??;
    task_manifest::validate_task_artifact_path(task_dir, &path, key).ok()?;
    fs::read_to_string(path)
        .ok()
        .map(|text| text.trim().to_string())
}

fn read_cached_insights_artifact(
    task_dir: &Path,
    manifest: &task_manifest::TaskManifest,
) -> Vec<task_manifest::InsightView> {
    let Some(content) = read_cached_text_artifact(task_dir, manifest, "insights") else {
        return vec![];
    };
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&content) else {
        return vec![];
    };
    task_manifest::parse_insights_payload(&payload)
}

fn normalize_cache_source_url(value: &str) -> String {
    value.trim().to_string()
}

#[tauri::command]
pub(crate) async fn retry_insights(
    app: AppHandle,
    process_state: State<'_, Arc<WorkerProcessState>>,
    request: RetryInsightsRequest,
) -> Result<serde_json::Value, String> {
    let process_state = Arc::clone(process_state.inner());
    run_blocking_worker_command(move || retry_insights_blocking(app, process_state, request)).await
}

fn retry_insights_blocking(
    app: AppHandle,
    process_state: Arc<WorkerProcessState>,
    request: RetryInsightsRequest,
) -> Result<serde_json::Value, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let request_json = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    let llm_invocation = account::server_managed_llm_invocation(&paths)?;
    let spec = build_worker_command_spec(
        &paths,
        WorkerInvocation::RetryInsights(request_json),
        llm_invocation,
    )?;
    let _ = append_desktop_log(
        &paths,
        "worker.retry_insights.start",
        &worker_command_log_detail(&spec, "retry_insights"),
    );
    let child = spawn_worker_command(spec)?;
    let worker_pid = child.id();
    if !process_state.register(worker_pid) {
        let _ = terminate_process_tree(worker_pid);
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "partial_completed".to_string(),
            task_id: Some(request.task_id),
            task_dir: None,
            artifacts: HashMap::new(),
            text: String::new(),
            summary: String::new(),
            insights: vec![],
            transcript: None,
            error: Some(WorkerError {
                code: "WORKER_ALREADY_RUNNING".to_string(),
                message: "Another worker process is already running.".to_string(),
                stage: "insights_generating".to_string(),
            }),
        }));
    }

    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(error) => {
            process_state.clear_current(worker_pid);
            let _ = process_state.take_cancelled(worker_pid);
            return Err(error.to_string());
        }
    };
    process_state.clear_current(worker_pid);
    let was_cancelled = process_state.take_cancelled(worker_pid);
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let _ = append_desktop_log(
        &paths,
        "worker.retry_insights.exit",
        &worker_exit_log_detail(worker_pid, &output, &stderr),
    );

    if was_cancelled {
        let _ = append_desktop_log(
            &paths,
            "worker.retry_insights.cancelled",
            &format!("pid={worker_pid} task_id={}", request.task_id),
        );
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "partial_completed".to_string(),
            task_id: Some(request.task_id),
            task_dir: None,
            artifacts: HashMap::new(),
            text: String::new(),
            summary: String::new(),
            insights: vec![],
            transcript: None,
            error: Some(WorkerError {
                code: "WORKER_CANCELLED".to_string(),
                message: "Worker process was cancelled.".to_string(),
                stage: "insights_generating".to_string(),
            }),
        }));
    }

    let parsed = parse_worker_output_or_fallback(
        &output,
        ProcessVideoResult {
            status: "partial_completed".to_string(),
            task_id: Some(request.task_id),
            task_dir: None,
            artifacts: HashMap::new(),
            text: String::new(),
            summary: String::new(),
            insights: vec![],
            transcript: None,
            error: Some(WorkerError {
                code: "WORKER_PROCESS_FAILED".to_string(),
                message: stderr,
                stage: "insights_generating".to_string(),
            }),
        },
    )?;
    let _ = append_desktop_log(
        &paths,
        "worker.retry_insights.result",
        &summarize_worker_result_for_log(&parsed),
    );
    Ok(parsed)
}

#[tauri::command]
pub(crate) fn cancel_process(
    process_state: State<'_, Arc<WorkerProcessState>>,
) -> Result<CancelProcessResult, String> {
    let Some(pid) = process_state.current_pid() else {
        return Ok(CancelProcessResult {
            cancelled: false,
            error: None,
        });
    };

    process_state.mark_cancelled(pid);
    match terminate_process_tree(pid) {
        Ok(()) => {
            process_state.clear_current(pid);
            Ok(CancelProcessResult {
                cancelled: true,
                error: None,
            })
        }
        Err(error) => Ok(CancelProcessResult {
            cancelled: false,
            error: Some(error),
        }),
    }
}

fn apply_configured_asr_model_to_request(
    dotenv_path: &Path,
    request: &mut ProcessVideoRequest,
) -> Result<(), String> {
    let values = parse_dotenv_values(dotenv_path)?;
    let configured_model = values.get(ASR_MODEL_ENV).cloned();
    if configured_model.as_deref().unwrap_or("").trim().is_empty() {
        request.model = resolve_asr_model_value(Some(request.model.clone()))?;
    } else {
        request.model = resolve_asr_model_value(configured_model)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_configured_asr_model_to_request, cached_process_result_for_request,
        ProcessVideoRequest, RetryInsightsRequest,
    };
    use crate::path_to_env_string;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn cached_process_result_reuses_completed_task_for_same_source_url() {
        let output_root = temp_dir("cached_process_result_reuses_completed_task");
        let task_id = "20260705-153012-youtube-dQw4w9WgXcQ";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
        fs::create_dir_all(task_dir.join("ai")).expect("create ai dir");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "cached transcript\n",
        )
        .expect("write transcript");
        fs::write(task_dir.join("ai").join("summary.md"), "# cached summary\n")
            .expect("write summary");
        fs::write(
            task_dir.join("ai").join("insights.json"),
            r#"{"schemaVersion":1,"insights":[{"id":1,"topic":"cached topic","matchReason":"matched","followUpQuestions":["next question"],"suitableUse":"content planning","sourceChunkId":3}]}"#,
        )
        .expect("write insights");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 2,
  "task_id": "{task_id}",
  "created_at": "2026-07-05T15:30:12Z",
  "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "platform": "youtube",
  "status": "completed",
  "model": "iic/SenseVoiceSmall",
  "transcript": {{
    "source": "subtitle",
    "language": "zh-Hans",
    "engine": null
  }},
  "artifacts": {{
    "transcript_txt": "transcript/transcript.txt",
    "summary": "ai/summary.md",
    "insights": "ai/insights.json"
  }},
  "error": null,
  "text_preview": "cached transcript",
  "insights_count": 1
}}"#
            ),
        )
        .expect("write manifest");

        let request = ProcessVideoRequest {
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
            language: "Chinese".to_string(),
            output_formats: vec!["txt".to_string(), "md".to_string()],
            model: "iic/SenseVoiceSmall".to_string(),
            generate_insights: true,
            insightflow_mode: "embedded".to_string(),
        };

        let cached = cached_process_result_for_request(&output_root, &request)
            .expect("read cached result")
            .expect("same URL should reuse cached task");

        assert_eq!(cached["status"], "completed");
        assert_eq!(cached["task_id"], task_id);
        assert_eq!(
            cached["task_dir"],
            path_to_env_string(output_root.join("tasks").join(task_id))
        );
        assert_eq!(cached["text"], "cached transcript");
        assert_eq!(cached["summary"], "# cached summary");
        assert_eq!(cached["insights"][0]["topic"], "cached topic");
        assert_eq!(cached["insights"][0]["matchReason"], "matched");
        assert_eq!(cached["insights"][0]["sourceChunkId"], 3);
        assert_eq!(cached["transcript"]["source"], "subtitle");
        assert_eq!(cached["transcript"]["language"], "zh-Hans");
        assert!(cached["transcript"]["engine"].is_null());
    }

    #[test]
    fn cached_process_result_ignores_insights_without_v1_schema() {
        let output_root = temp_dir("cached_process_result_ignores_insights_without_schema");
        let task_id = "20260705-153012-youtube-dQw4w9WgXcQ";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
        fs::create_dir_all(task_dir.join("ai")).expect("create ai dir");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "cached transcript\n",
        )
        .expect("write transcript");
        fs::write(task_dir.join("ai").join("summary.md"), "# cached summary\n")
            .expect("write summary");
        fs::write(
            task_dir.join("ai").join("insights.json"),
            r#"{"insights":[{"id":1,"topic":"cached topic","matchReason":"matched","followUpQuestions":["next question"],"suitableUse":"content planning","sourceChunkId":3}]}"#,
        )
        .expect("write insights");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 2,
  "task_id": "{task_id}",
  "created_at": "2026-07-05T15:30:12Z",
  "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "platform": "youtube",
  "status": "completed",
  "artifacts": {{
    "transcript_txt": "transcript/transcript.txt",
    "summary": "ai/summary.md",
    "insights": "ai/insights.json"
  }},
  "error": null,
  "text_preview": "cached transcript",
  "insights_count": 1
}}"#
            ),
        )
        .expect("write manifest");

        let request = ProcessVideoRequest {
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
            language: "Chinese".to_string(),
            output_formats: vec!["txt".to_string(), "md".to_string()],
            model: "iic/SenseVoiceSmall".to_string(),
            generate_insights: true,
            insightflow_mode: "embedded".to_string(),
        };

        let cached = cached_process_result_for_request(&output_root, &request)
            .expect("read cached result")
            .expect("same URL should reuse cached task");

        assert_eq!(cached["status"], "completed");
        assert_eq!(cached["text"], "cached transcript");
        assert!(cached["insights"]
            .as_array()
            .expect("insights array")
            .is_empty());
    }

    #[test]
    fn cached_process_result_ignores_unusable_history_without_blocking_new_url() {
        let output_root = temp_dir("cached_process_result_ignores_unusable_history");
        let task_id = "20260705-153012-youtube-missing";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(&task_dir).expect("create task dir");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 1,
  "task_id": "{task_id}",
  "created_at": "2026-07-05T15:30:12Z",
  "source_url": "https://www.youtube.com/watch?v=missing",
  "platform": "youtube",
  "status": "completed",
  "artifacts": {{
    "transcript_txt": "transcript/transcript.txt"
  }},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");
        let request = ProcessVideoRequest {
            url: "https://www.youtube.com/watch?v=new-video".to_string(),
            language: "Chinese".to_string(),
            output_formats: vec!["txt".to_string(), "md".to_string()],
            model: "iic/SenseVoiceSmall".to_string(),
            generate_insights: true,
            insightflow_mode: "embedded".to_string(),
        };

        let cached = cached_process_result_for_request(&output_root, &request)
            .expect("broken history should not block processing");

        assert!(cached.is_none());
    }

    #[test]
    fn retry_insights_request_round_trips_preference_snapshot_payload() {
        let payload = serde_json::json!({
            "task_id": "20260705-153012-douyin-demo",
            "target": "insights",
            "preference_snapshot": {
                "profile": null,
                "profileSkipped": true,
                "generationPreferences": {
                    "goal": "content_creation",
                    "scenario": "short_video",
                    "angles": ["topic_angle"],
                    "audience": "fans_readers",
                    "styles": ["grounded"],
                    "avoid": []
                },
                "labelSnapshot": {
                    "profile": [],
                    "generationPreferences": []
                }
            }
        });

        let request: RetryInsightsRequest =
            serde_json::from_value(payload).expect("deserialize retry request");
        let serialized = serde_json::to_value(&request).expect("serialize retry request");

        assert_eq!(
            serialized["target"],
            "insights"
        );
        assert_eq!(
            serialized["preference_snapshot"]["generationPreferences"]["goal"],
            "content_creation"
        );
        assert_eq!(serialized["preference_snapshot"]["profileSkipped"], true);
    }

    #[test]
    fn apply_configured_asr_model_overrides_worker_request_model() {
        let env_path = temp_env_path("apply_configured_asr_model");
        fs::write(&env_path, "FRAMEQ_ASR_MODEL=iic/SenseVoiceSmall").expect("write test env");
        let mut request = ProcessVideoRequest {
            url: "https://www.douyin.com/video/7646789377271647540".to_string(),
            language: "Chinese".to_string(),
            output_formats: vec!["txt".to_string(), "md".to_string()],
            model: "iic/SenseVoiceSmall".to_string(),
            generate_insights: true,
            insightflow_mode: "embedded".to_string(),
        };

        apply_configured_asr_model_to_request(&env_path, &mut request).expect("apply asr model");

        assert_eq!(request.model, "iic/SenseVoiceSmall");
    }

    fn temp_env_path(test_name: &str) -> PathBuf {
        temp_dir(test_name).join(".env")
    }

    fn temp_dir(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("frameq-{test_name}-{unique}"));
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }
}
