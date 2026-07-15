use crate::account;
use crate::settings::{env_path, parse_dotenv_values, resolve_asr_model_value, ASR_MODEL_ENV};
use crate::task_manifest;
use crate::{
    append_desktop_log, build_worker_command_spec, ensure_runtime_dirs,
    parse_worker_output_or_fallback, parse_worker_stdout,
    path_to_env_string, resolve_runtime_paths, run_blocking_worker_command,
    spawn_supervised_worker_command, summarize_worker_result_for_log, terminate_process_tree,
    worker_command_log_detail, worker_exit_log_detail, CancelProcessResult, ProcessPhase,
    ProcessSupervisors, SupervisedSpawnError, WorkerInvocation, PROGRESS_EVENT_NAME,
    PROGRESS_EVENT_PREFIX,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State, Window};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProcessVideoRequest {
    url: String,
    language: String,
    output_formats: Vec<String>,
    model: String,
    insightflow_mode: String,
}

#[derive(Serialize)]
struct ProcessVideoWorkerRequest<'a> {
    url: &'a str,
    language: &'a str,
    output_formats: &'a [String],
    model: &'a str,
    insightflow_mode: &'a str,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct RetryInsightsRequest {
    task_id: String,
    target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    preference_snapshot: Option<serde_json::Value>,
    // Present only for target="draft" (identifies which insight to expand into a
    // draft). Omitted on the wire for summary/insights so those requests stay
    // byte-identical to the pre-draft worker contract.
    #[serde(skip_serializing_if = "Option::is_none")]
    insight_id: Option<i64>,
    // User-selected draft platform id; present only for target="draft". Omitted on
    // the wire for summary/insights so those requests stay byte-identical to the
    // pre-platform worker contract (same skip pattern as insight_id).
    #[serde(skip_serializing_if = "Option::is_none")]
    platform: Option<String>,
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
    // Generated draft markdown (empty string until the draft stage runs).
    // Defaults to empty so fallback objects and older worker output never panic.
    pub(crate) draft: String,
}

#[tauri::command]
pub(crate) async fn process_video(
    window: Window,
    app: AppHandle,
    process_state: State<'_, Arc<ProcessSupervisors>>,
    request: ProcessVideoRequest,
) -> Result<serde_json::Value, String> {
    let process_state = Arc::clone(process_state.inner());
    run_blocking_worker_command(move || process_video_blocking(window, app, process_state, request))
        .await
}

fn process_video_blocking(
    window: Window,
    app: AppHandle,
    process_state: Arc<ProcessSupervisors>,
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
            draft: String::new(),
        }));
    };
    if let Some(cached) = cached_process_result_for_request(&output_root, &request)? {
        let _ = append_desktop_log(
            &paths,
            "worker.process_video.cache_hit",
            &summarize_worker_result_for_log(&cached),
        );
        return Ok(cached);
    }
    let resolved_source_identity =
        match resolve_source_identity_for_cache(&paths, &request.url, &process_state.video) {
            Ok(identity) => identity,
            Err(SupervisedSpawnError::Cancelled) => {
                return Ok(cancelled_worker_result("video_extracting", "failed"));
            }
            Err(SupervisedSpawnError::AlreadyRunning) => {
                return Ok(worker_already_running_result("video_extracting", "failed"));
            }
            Err(SupervisedSpawnError::Failed(_)) => {
                return Ok(worker_transport_failure_result(
                    "video_extracting",
                    "failed",
                ));
            }
        };
    if let Some(source_identity) = resolved_source_identity.as_ref() {
        if let Some(cached) =
            cached_process_result_for_identity(&output_root, &request, source_identity)?
        {
            let _ = append_desktop_log(
                &paths,
                "worker.process_video.cache_hit",
                &summarize_worker_result_for_log(&cached),
            );
            return Ok(cached);
        }
    }
    let request_json = serialize_process_video_request(&request)?;
    let spec =
        build_worker_command_spec(&paths, WorkerInvocation::ProcessVideo(request_json), None)?;
    let _ = append_desktop_log(
        &paths,
        "worker.process_video.start",
        &worker_command_log_detail(&spec, "process_video"),
    );
    let (mut child, worker_instance) =
        match spawn_supervised_worker_command(spec, &process_state.video) {
            Ok(spawned) => spawned,
            Err(SupervisedSpawnError::Cancelled) => {
                return Ok(cancelled_worker_result("video_extracting", "failed"));
            }
            Err(SupervisedSpawnError::AlreadyRunning) => {
                return Ok(worker_already_running_result("video_extracting", "failed"));
            }
            Err(SupervisedSpawnError::Failed(_)) => {
                return Ok(worker_transport_failure_result(
                    "video_extracting",
                    "failed",
                ));
            }
        };
    let worker_pid = worker_instance.pid;

    let Some(stderr) = child.stderr.take() else {
        process_state.video.finish(worker_instance.instance_id);
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
            process_state.video.finish(worker_instance.instance_id);
            return Err(error.to_string());
        }
    };
    let terminal_phase = process_state.video.finish(worker_instance.instance_id);
    let stderr = stderr_reader
        .join()
        .unwrap_or_else(|_| "Worker stderr reader failed.".to_string());
    let _ = append_desktop_log(
        &paths,
        "worker.process_video.exit",
        &worker_exit_log_detail(worker_pid, &output, &stderr),
    );

    let parsed = match parse_worker_stdout(&output.stdout) {
        Ok(value) => Some(value),
        Err(error) if output.status.success() => return Err(error),
        Err(_) => None,
    };
    if let Some(parsed) = parsed {
        let _ = append_desktop_log(
            &paths,
            "worker.process_video.result",
            &summarize_worker_result_for_log(&parsed),
        );
        return Ok(parsed);
    };

    if terminal_phase == Some(ProcessPhase::Cancelling) {
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
            draft: String::new(),
        }));
    };

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
                message: "Worker process failed before returning a structured result.".to_string(),
                stage: "video_extracting".to_string(),
            }),
            draft: String::new(),
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
    let requested_source_url = request.url.trim();
    if requested_source_url.is_empty() {
        return Ok(None);
    }

    cached_process_result(output_root, request, Some(requested_source_url), None)
}

fn serialize_process_video_request(request: &ProcessVideoRequest) -> Result<String, String> {
    serde_json::to_string(&ProcessVideoWorkerRequest {
        url: &request.url,
        language: &request.language,
        output_formats: &request.output_formats,
        model: &request.model,
        insightflow_mode: &request.insightflow_mode,
    })
    .map_err(|_| "Failed to encode worker request.".to_string())
}

fn cached_process_result_for_identity(
    output_root: &Path,
    request: &ProcessVideoRequest,
    source_identity: &task_manifest::SourceIdentity,
) -> Result<Option<serde_json::Value>, String> {
    cached_process_result(output_root, request, None, Some(source_identity))
}

fn cached_process_result(
    output_root: &Path,
    request: &ProcessVideoRequest,
    requested_source_url: Option<&str>,
    requested_identity: Option<&task_manifest::SourceIdentity>,
) -> Result<Option<serde_json::Value>, String> {
    let mut newest_cached: Option<(String, serde_json::Value)> = None;
    for manifest_path in task_manifest::list_task_manifest_paths(output_root)? {
        let Ok((manifest, task_dir)) = task_manifest::read_task_manifest_path(&manifest_path)
        else {
            continue;
        };
        if !reusable_task_manifest_matches(
            &manifest,
            requested_source_url,
            requested_identity,
            request,
        ) {
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
    requested_source_url: Option<&str>,
    requested_identity: Option<&task_manifest::SourceIdentity>,
    request: &ProcessVideoRequest,
) -> bool {
    if !manifest.source_privacy_ready()
        || !matches!(manifest.status.as_str(), "completed" | "partial_completed")
    {
        return false;
    }
    let source_matches = match requested_identity {
        Some(identity) => {
            identity.is_safe()
                && manifest
                    .safe_source_identity()
                    .and_then(task_manifest::SourceIdentity::equality_key)
                    == identity.equality_key()
        }
        None => {
            requested_source_url.is_some_and(|source_url| manifest.safe_source_url() == source_url)
        }
    };
    if !source_matches {
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
    if !manifest.source_privacy_ready() {
        return Ok(None);
    }
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
        code: error.safe_code(),
        message: error.safe_message(),
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
        // Draft is generated on demand via retry_insights(target="draft"); the
        // cached process result never carries a draft body, so default to empty.
        draft: String::new(),
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

fn resolve_source_identity_for_cache(
    paths: &crate::RuntimePaths,
    raw_url: &str,
    supervisor: &crate::worker_command::ProcessSupervisor,
) -> Result<Option<task_manifest::SourceIdentity>, SupervisedSpawnError> {
    let payload = serde_json::json!({"url": raw_url}).to_string();
    let spec = build_worker_command_spec(
        paths,
        WorkerInvocation::ResolveSourceIdentity(payload),
        None,
    )
    .map_err(SupervisedSpawnError::Failed)?;
    let (child, instance) = spawn_supervised_worker_command(spec, supervisor)?;
    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(_) => {
            let phase = supervisor.finish(instance.instance_id);
            return if phase == Some(ProcessPhase::Cancelling) {
                Err(SupervisedSpawnError::Cancelled)
            } else {
                Err(SupervisedSpawnError::Failed(
                    "Source identity worker failed to finish.".to_string(),
                ))
            };
        }
    };
    if supervisor.finish(instance.instance_id) == Some(ProcessPhase::Cancelling) {
        return Err(SupervisedSpawnError::Cancelled);
    }
    if !output.status.success() {
        return Ok(None);
    }
    let Some(value) = parse_worker_stdout(&output.stdout).ok() else {
        return Ok(None);
    };
    let identity = serde_json::from_value::<task_manifest::SourceIdentity>(
        value
            .get("source_identity")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
    )
    .ok();
    Ok(identity.filter(task_manifest::SourceIdentity::is_safe))
}

#[tauri::command]
pub(crate) async fn retry_insights(
    app: AppHandle,
    process_state: State<'_, Arc<ProcessSupervisors>>,
    request: RetryInsightsRequest,
) -> Result<serde_json::Value, String> {
    let process_state = Arc::clone(process_state.inner());
    run_blocking_worker_command(move || retry_insights_blocking(app, process_state, request)).await
}

fn retry_insights_blocking(
    app: AppHandle,
    process_state: Arc<ProcessSupervisors>,
    request: RetryInsightsRequest,
) -> Result<serde_json::Value, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let request_json = serde_json::to_string(&request)
        .map_err(|_| "Failed to encode worker request.".to_string())?;
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
    let (child, worker_instance) = match spawn_supervised_worker_command(spec, &process_state.video)
    {
        Ok(spawned) => spawned,
        Err(SupervisedSpawnError::Cancelled) => {
            return Ok(cancelled_worker_result(
                "insights_generating",
                "partial_completed",
            ));
        }
        Err(SupervisedSpawnError::AlreadyRunning) => {
            return Ok(worker_already_running_result(
                "insights_generating",
                "partial_completed",
            ));
        }
        Err(SupervisedSpawnError::Failed(_)) => {
            return Ok(worker_transport_failure_result(
                "insights_generating",
                "partial_completed",
            ));
        }
    };
    let worker_pid = worker_instance.pid;

    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(error) => {
            process_state.video.finish(worker_instance.instance_id);
            return Err(error.to_string());
        }
    };
    let terminal_phase = process_state.video.finish(worker_instance.instance_id);
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let _ = append_desktop_log(
        &paths,
        "worker.retry_insights.exit",
        &worker_exit_log_detail(worker_pid, &output, &stderr),
    );

    let parsed = match parse_worker_stdout(&output.stdout) {
        Ok(value) => Some(value),
        Err(error) if output.status.success() => return Err(error),
        Err(_) => None,
    };
    if let Some(parsed) = parsed {
        let _ = append_desktop_log(
            &paths,
            "worker.retry_insights.result",
            &summarize_worker_result_for_log(&parsed),
        );
        return Ok(parsed);
    }

    if terminal_phase == Some(ProcessPhase::Cancelling) {
        let _ = append_desktop_log(
            &paths,
            "worker.retry_insights.cancelled",
            &format!("pid={worker_pid}"),
        );
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "partial_completed".to_string(),
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
                stage: "insights_generating".to_string(),
            }),
            draft: String::new(),
        }));
    }

    let parsed = parse_worker_output_or_fallback(
        &output,
        ProcessVideoResult {
            status: "partial_completed".to_string(),
            task_id: None,
            task_dir: None,
            artifacts: HashMap::new(),
            text: String::new(),
            summary: String::new(),
            insights: vec![],
            transcript: None,
            error: Some(WorkerError {
                code: "WORKER_PROCESS_FAILED".to_string(),
                message: "AI generation worker failed before returning a structured result."
                    .to_string(),
                stage: "insights_generating".to_string(),
            }),
            draft: String::new(),
        },
    )?;
    let _ = append_desktop_log(
        &paths,
        "worker.retry_insights.result",
        &summarize_worker_result_for_log(&parsed),
    );
    Ok(parsed)
}

fn worker_failure_result(
    status: &str,
    stage: &str,
    code: &str,
    message: &str,
) -> serde_json::Value {
    serde_json::json!(ProcessVideoResult {
        status: status.to_string(),
        task_id: None,
        task_dir: None,
        artifacts: HashMap::new(),
        text: String::new(),
        summary: String::new(),
        insights: vec![],
        transcript: None,
        error: Some(WorkerError {
            code: code.to_string(),
            message: message.to_string(),
            stage: stage.to_string(),
        }),
        draft: String::new(),
    })
}

fn cancelled_worker_result(stage: &str, status: &str) -> serde_json::Value {
    worker_failure_result(
        status,
        stage,
        "WORKER_CANCELLED",
        "Worker process was cancelled.",
    )
}

fn worker_already_running_result(stage: &str, status: &str) -> serde_json::Value {
    worker_failure_result(
        status,
        stage,
        "WORKER_ALREADY_RUNNING",
        "Another worker process is already running.",
    )
}

fn worker_transport_failure_result(stage: &str, status: &str) -> serde_json::Value {
    worker_failure_result(
        status,
        stage,
        "WORKER_REQUEST_TRANSPORT_FAILED",
        "Worker request could not be delivered.",
    )
}

#[tauri::command]
pub(crate) fn cancel_process(
    process_state: State<'_, Arc<ProcessSupervisors>>,
) -> Result<CancelProcessResult, String> {
    Ok(crate::request_process_cancellation(&process_state.video))
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
        apply_configured_asr_model_to_request, cached_process_result_for_identity,
        cached_process_result_for_request, serialize_process_video_request, ProcessVideoRequest,
        ProcessVideoResult, RetryInsightsRequest, WorkerError,
    };
    use crate::{path_to_env_string, task_manifest::SourceIdentity};
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn retry_insights_request_serializes_insight_id_for_draft_target() {
        let request = RetryInsightsRequest {
            task_id: "20260714-100000-douyin-demo".to_string(),
            target: "draft".to_string(),
            preference_snapshot: None,
            insight_id: Some(7),
            platform: None,
        };
        let serialized = serde_json::to_value(&request).expect("serialize retry request");

        assert_eq!(serialized["target"], "draft");
        assert_eq!(serialized["insight_id"], 7);
        assert!(
            serialized.get("preference_snapshot").is_none(),
            "preference_snapshot must be absent when None so summary/insights requests stay unchanged on the wire"
        );
    }

    #[test]
    fn retry_insights_request_omits_insight_id_when_none() {
        let request = RetryInsightsRequest {
            task_id: "20260714-100000-douyin-demo".to_string(),
            target: "insights".to_string(),
            preference_snapshot: None,
            insight_id: None,
            platform: None,
        };
        let serialized = serde_json::to_value(&request).expect("serialize retry request");

        assert!(
            serialized.get("insight_id").is_none(),
            "insight_id key must be absent for non-draft targets"
        );
    }

    #[test]
    fn retry_insights_request_round_trips_insight_id_for_draft() {
        let payload = serde_json::json!({
            "task_id": "20260714-100000-douyin-demo",
            "target": "draft",
            "insight_id": 42
        });

        let request: RetryInsightsRequest =
            serde_json::from_value(payload).expect("deserialize draft retry request");
        let serialized = serde_json::to_value(&request).expect("serialize draft retry request");

        assert_eq!(serialized["target"], "draft");
        assert_eq!(serialized["insight_id"], 42);
        assert!(serialized.get("preference_snapshot").is_none());
    }

    #[test]
    fn retry_insights_request_serializes_platform_for_draft_target() {
        let request = RetryInsightsRequest {
            task_id: "20260714-100000-douyin-demo".to_string(),
            target: "draft".to_string(),
            preference_snapshot: None,
            insight_id: Some(7),
            platform: Some("douyin".to_string()),
        };
        let serialized = serde_json::to_value(&request).expect("serialize retry request");

        assert_eq!(serialized["target"], "draft");
        assert_eq!(serialized["platform"], "douyin");
    }

    #[test]
    fn retry_insights_request_omits_platform_when_none() {
        let request = RetryInsightsRequest {
            task_id: "20260714-100000-douyin-demo".to_string(),
            target: "insights".to_string(),
            preference_snapshot: None,
            insight_id: None,
            platform: None,
        };
        let serialized = serde_json::to_value(&request).expect("serialize retry request");

        assert!(
            serialized.get("platform").is_none(),
            "platform key must be absent when None so non-draft requests stay byte-identical on the wire"
        );
    }

    #[test]
    fn retry_insights_request_round_trips_platform_for_draft() {
        let payload = serde_json::json!({
            "task_id": "20260714-100000-douyin-demo",
            "target": "draft",
            "insight_id": 42,
            "platform": "xiaohongshu"
        });

        let request: RetryInsightsRequest =
            serde_json::from_value(payload).expect("deserialize draft retry request");
        let serialized = serde_json::to_value(&request).expect("serialize draft retry request");

        assert_eq!(serialized["target"], "draft");
        assert_eq!(serialized["platform"], "xiaohongshu");
        assert!(serialized.get("preference_snapshot").is_none());
    }

    #[test]
    fn process_video_result_fallback_carries_empty_draft() {
        let fallback = ProcessVideoResult {
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
                message: "transport failure".to_string(),
                stage: "insights_generating".to_string(),
            }),
            draft: String::new(),
        };
        let serialized = serde_json::to_value(&fallback).expect("serialize fallback result");

        assert_eq!(serialized["draft"], "");
        // A fallback must never pretend to carry a real draft body.
        assert_ne!(serialized["draft"], "# some markdown");
    }

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
  "schema_version": 3,
  "source_privacy_migration_version": 2,
  "task_id": "{task_id}",
  "created_at": "2026-07-05T15:30:12Z",
  "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "source_identity": {{
    "version": 1,
    "platform": "youtube",
    "stable_id": "dQw4w9WgXcQ",
    "effective_part": null,
    "canonical_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }},
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
    fn cached_process_result_matches_sensitive_request_by_canonical_identity() {
        let output_root = temp_dir("cached_process_result_matches_canonical_identity");
        let note_id = "64a1b2c3d4e5f67890123456";
        let task_id = "20260710-120000-xiaohongshu-64a1b2c3d4e5f67890123456";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "cached transcript\n",
        )
        .expect("write transcript");
        let canonical_url = format!("https://www.xiaohongshu.com/explore/{note_id}");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 3,
  "source_privacy_migration_version": 2,
  "task_id": "{task_id}",
  "created_at": "2026-07-10T12:00:00Z",
  "source_url": "{canonical_url}",
  "source_identity": {{
    "version": 1,
    "platform": "xiaohongshu",
    "stable_id": "{note_id}",
    "effective_part": null,
    "canonical_url": "{canonical_url}"
  }},
  "platform": "xiaohongshu",
  "status": "completed",
  "model": "iic/SenseVoiceSmall",
  "artifacts": {{"transcript_txt": "transcript/transcript.txt"}},
  "error": null,
  "text_preview": "cached transcript",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");
        let request = ProcessVideoRequest {
            url: format!("{canonical_url}?xsec_token=review-secret&source=web"),
            language: "Chinese".to_string(),
            output_formats: vec!["txt".to_string(), "md".to_string()],
            model: "iic/SenseVoiceSmall".to_string(),
            insightflow_mode: "embedded".to_string(),
        };
        let identity = SourceIdentity {
            version: 1,
            platform: "xiaohongshu".to_string(),
            stable_id: note_id.to_string(),
            effective_part: None,
            canonical_url,
        };

        assert!(cached_process_result_for_request(&output_root, &request)
            .expect("exact lookup")
            .is_none());
        let cached = cached_process_result_for_identity(&output_root, &request, &identity)
            .expect("canonical lookup")
            .expect("canonical identity should reuse cached task");

        assert_eq!(cached["task_id"], task_id);
        let serialized = cached.to_string();
        assert!(!serialized.contains("review-secret"));
        assert!(!serialized.contains("xsec_token"));
    }

    #[test]
    fn process_request_serialization_never_includes_preflight_source_identity() {
        let request = ProcessVideoRequest {
            url: "https://xhslink.com/short?xsec_token=review-secret".to_string(),
            language: "Chinese".to_string(),
            output_formats: vec!["txt".to_string(), "md".to_string()],
            model: "iic/SenseVoiceSmall".to_string(),
            insightflow_mode: "embedded".to_string(),
        };

        let encoded = serialize_process_video_request(&request).expect("serialize request");
        let payload: serde_json::Value = serde_json::from_str(&encoded).expect("request json");

        assert_eq!(payload["url"], request.url);
        assert!(payload.get("source_identity").is_none());
        assert!(payload.get("generate_insights").is_none());
    }

    #[test]
    fn process_request_rejects_retired_ai_generation_field_without_echoing_source() {
        let raw = r#"{
          "url":"https://user:review-secret@example.com/private",
          "language":"Chinese",
          "output_formats":["txt","md"],
          "model":"iic/SenseVoiceSmall",
          "generate_insights":true,
          "insightflow_mode":"embedded"
        }"#;

        let error = match serde_json::from_str::<ProcessVideoRequest>(raw) {
            Ok(_) => panic!("retired process-video AI field must be rejected"),
            Err(error) => error.to_string(),
        };

        assert!(!error.contains("review-secret"));
        assert!(!error.contains("https://"));
    }

    #[test]
    fn cached_process_result_never_reuses_quarantined_task() {
        let output_root = temp_dir("cached_process_result_rejects_quarantine");
        let task_id = "20260710-120000-xiaohongshu-review-secret";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "cached transcript\n",
        )
        .expect("write transcript");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 3,
  "source_privacy_migration_version": 2,
  "source_privacy_quarantined": true,
  "task_id": "{task_id}",
  "created_at": "2026-07-10T12:00:00Z",
  "source_url": "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456",
  "source_identity": {{
    "version": 1,
    "platform": "xiaohongshu",
    "stable_id": "64a1b2c3d4e5f67890123456",
    "effective_part": null,
    "canonical_url": "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456"
  }},
  "platform": "xiaohongshu",
  "status": "completed",
  "model": "iic/SenseVoiceSmall",
  "artifacts": {{"transcript_txt": "transcript/transcript.txt"}},
  "error": null,
  "text_preview": "cached transcript",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");
        let request = ProcessVideoRequest {
            url: "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456".to_string(),
            language: "Chinese".to_string(),
            output_formats: vec!["txt".to_string()],
            model: "iic/SenseVoiceSmall".to_string(),
            insightflow_mode: "embedded".to_string(),
        };

        assert!(cached_process_result_for_request(&output_root, &request)
            .expect("cache lookup")
            .is_none());
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
  "schema_version": 3,
  "source_privacy_migration_version": 2,
  "task_id": "{task_id}",
  "created_at": "2026-07-05T15:30:12Z",
  "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "source_identity": {{
    "version": 1,
    "platform": "youtube",
    "stable_id": "dQw4w9WgXcQ",
    "effective_part": null,
    "canonical_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }},
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

        assert_eq!(serialized["target"], "insights");
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
