use crate::account;
use crate::settings::{env_path, parse_dotenv_values, resolve_asr_model_value, ASR_MODEL_ENV};
use crate::task_manifest;
use crate::worker_runtime::{
    ProgressRoute, WorkerLane, WorkerOperation, WorkerRunError, WorkerRunErrorKind,
    WorkerRunOutcome, WorkerRunRequest,
};
use crate::{
    append_desktop_log, build_worker_command_spec, ensure_runtime_dirs, path_to_env_string,
    resolve_runtime_paths, run_blocking_worker_command, summarize_worker_result_for_log,
    CancelProcessResult, ProcessSupervisors, WorkerInvocation,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State, Window};

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

pub(crate) const INVALID_RETRY_PAYLOAD: &str = "INVALID_RETRY_PAYLOAD";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) enum RetryInsightsTarget {
    #[serde(rename = "summary")]
    Summary,
    #[serde(rename = "insights")]
    Insights,
}

impl RetryInsightsTarget {
    fn as_str(self) -> &'static str {
        match self {
            Self::Summary => "summary",
            Self::Insights => "insights",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) enum OutputLanguage {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "zh-TW")]
    ZhTw,
    #[serde(rename = "en-US")]
    EnUs,
}

impl OutputLanguage {
    fn as_str(self) -> &'static str {
        match self {
            Self::ZhCn => "zh-CN",
            Self::ZhTw => "zh-TW",
            Self::EnUs => "en-US",
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct RetryInsightsRequest {
    task_id: String,
    target: RetryInsightsTarget,
    output_language: OutputLanguage,
    #[serde(skip_serializing_if = "Option::is_none")]
    preference_snapshot: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RetryInsightsWireRequest {
    task_id: String,
    target: RetryInsightsTarget,
    output_language: OutputLanguage,
    preference_snapshot: Option<serde_json::Value>,
}

pub(crate) fn parse_retry_insights_request(
    payload: serde_json::Value,
) -> Result<RetryInsightsRequest, String> {
    if payload
        .as_object()
        .and_then(|object| object.get("preference_snapshot"))
        .is_some_and(|snapshot| !snapshot.is_object())
    {
        return Err(INVALID_RETRY_PAYLOAD.to_string());
    }
    let wire: RetryInsightsWireRequest =
        serde_json::from_value(payload).map_err(|_| INVALID_RETRY_PAYLOAD.to_string())?;
    if wire
        .preference_snapshot
        .as_ref()
        .is_some_and(|snapshot| !snapshot.is_object())
        || (wire.target == RetryInsightsTarget::Summary && wire.preference_snapshot.is_some())
    {
        return Err(INVALID_RETRY_PAYLOAD.to_string());
    }
    Ok(RetryInsightsRequest {
        task_id: wire.task_id,
        target: wire.target,
        output_language: wire.output_language,
        preference_snapshot: wire.preference_snapshot,
    })
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
            Err(SourceIdentityPreflightError::Cancelled) => {
                return Ok(cancelled_worker_result("video_extracting", "failed"));
            }
            Err(SourceIdentityPreflightError::AlreadyRunning) => {
                return Ok(worker_already_running_result("video_extracting", "failed"));
            }
            Err(SourceIdentityPreflightError::Transport) => {
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
    map_worker_run_result(
        process_state.video.run(
            &paths,
            WorkerRunRequest {
                operation: WorkerOperation::ProcessVideo,
                command: spec,
                progress: ProgressRoute::worker(window),
            },
        ),
        "video_extracting",
        "failed",
        "Worker process failed before returning a structured result.",
    )
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

enum SourceIdentityPreflightError {
    Cancelled,
    AlreadyRunning,
    Transport,
}

fn resolve_source_identity_for_cache(
    paths: &crate::RuntimePaths,
    raw_url: &str,
    lane: &WorkerLane,
) -> Result<Option<task_manifest::SourceIdentity>, SourceIdentityPreflightError> {
    let payload = serde_json::json!({"url": raw_url}).to_string();
    let spec = build_worker_command_spec(
        paths,
        WorkerInvocation::ResolveSourceIdentity(payload),
        None,
    )
    .map_err(|_| SourceIdentityPreflightError::Transport)?;
    let value = match lane.run(
        paths,
        WorkerRunRequest {
            operation: WorkerOperation::ResolveSourceIdentity,
            command: spec,
            progress: ProgressRoute::None,
        },
    ) {
        Ok(WorkerRunOutcome::Structured(value)) => value,
        Ok(WorkerRunOutcome::Cancelled) => return Err(SourceIdentityPreflightError::Cancelled),
        Ok(WorkerRunOutcome::UnstructuredFailure(_)) => return Ok(None),
        Err(error) if error.kind == WorkerRunErrorKind::AlreadyRunning => {
            return Err(SourceIdentityPreflightError::AlreadyRunning)
        }
        Err(error) if error.kind == WorkerRunErrorKind::ProtocolViolation => return Ok(None),
        Err(_) => return Err(SourceIdentityPreflightError::Transport),
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
    window: Window,
    app: AppHandle,
    process_state: State<'_, Arc<ProcessSupervisors>>,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let request = parse_retry_insights_request(request)?;
    let process_state = Arc::clone(process_state.inner());
    run_blocking_worker_command(move || {
        retry_insights_blocking(window, app, process_state, request)
    })
    .await
}

fn retry_insights_blocking(
    window: Window,
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
        &retry_diagnostic_detail(&request, "started", None),
    );
    let parsed = map_worker_run_result(
        process_state.video.run(
            &paths,
            WorkerRunRequest {
                operation: WorkerOperation::RetryInsights,
                command: spec,
                progress: ProgressRoute::worker(window),
            },
        ),
        "insights_generating",
        "partial_completed",
        "AI generation worker failed before returning a structured result.",
    )?;
    let _ = append_desktop_log(
        &paths,
        "worker.retry_insights.result",
        &retry_result_log_detail(&request, &parsed),
    );
    Ok(parsed)
}

fn retry_diagnostic_detail(
    request: &RetryInsightsRequest,
    status: &str,
    error_code: Option<&str>,
) -> String {
    let mut detail = format!(
        "target={} output_language={} status={}",
        request.target.as_str(),
        request.output_language.as_str(),
        safe_retry_status(status)
    );
    if let Some(error_code) = error_code {
        detail.push_str(" error_code=");
        detail.push_str(&safe_retry_error_code(error_code));
    }
    detail
}

fn retry_result_log_detail(request: &RetryInsightsRequest, result: &serde_json::Value) -> String {
    let status = result
        .get("status")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    let error_code = result
        .get("error")
        .and_then(serde_json::Value::as_object)
        .and_then(|error| error.get("code"))
        .and_then(serde_json::Value::as_str);
    retry_diagnostic_detail(request, status, error_code)
}

fn safe_retry_status(status: &str) -> &'static str {
    match status {
        "started" => "started",
        "exited" => "exited",
        "completed" => "completed",
        "partial_completed" => "partial_completed",
        "failed" => "failed",
        "cancelled" => "cancelled",
        _ => "unknown",
    }
}

fn safe_retry_error_code(code: &str) -> String {
    if (1..=64).contains(&code.len())
        && code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    {
        code.to_string()
    } else {
        "INVALID_ERROR_CODE".to_string()
    }
}

fn map_worker_run_result(
    result: Result<WorkerRunOutcome, WorkerRunError>,
    stage: &str,
    status: &str,
    unstructured_message: &str,
) -> Result<serde_json::Value, String> {
    match result {
        Ok(WorkerRunOutcome::Structured(value)) => Ok(value),
        Ok(WorkerRunOutcome::Cancelled) => Ok(cancelled_worker_result(stage, status)),
        Ok(WorkerRunOutcome::UnstructuredFailure(_)) => Ok(worker_failure_result(
            status,
            stage,
            "WORKER_PROCESS_FAILED",
            unstructured_message,
        )),
        Err(error) => match error.kind {
            WorkerRunErrorKind::AlreadyRunning => Ok(worker_already_running_result(stage, status)),
            WorkerRunErrorKind::SpawnFailed | WorkerRunErrorKind::RequestDeliveryFailed => {
                Ok(worker_transport_failure_result(stage, status))
            }
            WorkerRunErrorKind::PipeUnavailable
            | WorkerRunErrorKind::WaitFailed
            | WorkerRunErrorKind::ProtocolViolation => Err(error.detail.to_string()),
        },
    }
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
    Ok(process_state.video.cancel())
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
        cached_process_result_for_request, cancelled_worker_result, map_worker_run_result,
        parse_retry_insights_request, retry_result_log_detail, serialize_process_video_request,
        worker_already_running_result, worker_transport_failure_result, ProcessVideoRequest,
        INVALID_RETRY_PAYLOAD,
    };
    use crate::worker_runtime::{
        WorkerExitSummary, WorkerRunError, WorkerRunErrorKind, WorkerRunOutcome,
    };
    use crate::{path_to_env_string, task_manifest::SourceIdentity};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn worker_lifecycle_failures_keep_process_and_retry_public_shapes() {
        let process_cancelled = cancelled_worker_result("video_extracting", "failed");
        assert_eq!(process_cancelled["status"], "failed");
        assert_eq!(process_cancelled["error"]["code"], "WORKER_CANCELLED");
        assert_eq!(process_cancelled["error"]["stage"], "video_extracting");

        let retry_cancelled = cancelled_worker_result("insights_generating", "partial_completed");
        assert_eq!(retry_cancelled["status"], "partial_completed");
        assert_eq!(retry_cancelled["error"]["code"], "WORKER_CANCELLED");
        assert_eq!(retry_cancelled["error"]["stage"], "insights_generating");

        let already_running = worker_already_running_result("video_extracting", "failed");
        assert_eq!(already_running["error"]["code"], "WORKER_ALREADY_RUNNING");

        let transport = worker_transport_failure_result("video_extracting", "failed");
        assert_eq!(
            transport["error"]["code"],
            "WORKER_REQUEST_TRANSPORT_FAILED"
        );
    }

    #[test]
    fn typed_runner_outcomes_preserve_process_and_retry_adapter_shapes() {
        let process_failure = map_worker_run_result(
            Ok(WorkerRunOutcome::UnstructuredFailure(WorkerExitSummary {
                exit_code: Some(1),
                stderr: "present",
            })),
            "video_extracting",
            "failed",
            "Worker process failed before returning a structured result.",
        )
        .expect("map process failure");
        assert_eq!(process_failure["status"], "failed");
        assert_eq!(process_failure["error"]["code"], "WORKER_PROCESS_FAILED");
        assert_eq!(process_failure["error"]["stage"], "video_extracting");

        let retry_cancelled = map_worker_run_result(
            Ok(WorkerRunOutcome::Cancelled),
            "insights_generating",
            "partial_completed",
            "unused",
        )
        .expect("map retry cancellation");
        assert_eq!(retry_cancelled["status"], "partial_completed");
        assert_eq!(retry_cancelled["error"]["code"], "WORKER_CANCELLED");

        let transport = map_worker_run_result(
            Err(WorkerRunError {
                kind: WorkerRunErrorKind::SpawnFailed,
                detail: "fixed spawn failure",
            }),
            "video_extracting",
            "failed",
            "unused",
        )
        .expect("map transport failure");
        assert_eq!(
            transport["error"]["code"],
            "WORKER_REQUEST_TRANSPORT_FAILED"
        );

        let protocol_error = map_worker_run_result(
            Err(WorkerRunError {
                kind: WorkerRunErrorKind::ProtocolViolation,
                detail: "fixed protocol failure",
            }),
            "video_extracting",
            "failed",
            "unused",
        )
        .expect_err("protocol violation remains a command error");
        assert_eq!(protocol_error, "fixed protocol failure");
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
            "output_language": "zh-TW",
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

        let request = parse_retry_insights_request(payload).expect("deserialize retry request");
        let serialized = serde_json::to_value(&request).expect("serialize retry request");

        assert_eq!(serialized["target"], "insights");
        assert_eq!(serialized["output_language"], "zh-TW");
        assert_eq!(
            serialized["preference_snapshot"]["generationPreferences"]["goal"],
            "content_creation"
        );
        assert_eq!(serialized["preference_snapshot"]["profileSkipped"], true);
    }

    #[test]
    fn retry_insights_request_rejects_missing_or_invalid_output_language() {
        for payload in [
            serde_json::json!({
                "task_id": "20260705-153012-douyin-demo",
                "target": "summary"
            }),
            serde_json::json!({
                "task_id": "20260705-153012-douyin-demo",
                "target": "summary",
                "output_language": "fr-FR"
            }),
            serde_json::json!({
                "task_id": "20260705-153012-douyin-demo",
                "target": "summary",
                "output_language": 7
            }),
            serde_json::json!({
                "task_id": "20260705-153012-douyin-demo",
                "target": "draft",
                "output_language": "en-US"
            }),
            serde_json::json!({
                "task_id": 7,
                "target": "summary",
                "output_language": "en-US"
            }),
        ] {
            let error = parse_retry_insights_request(payload).expect_err("reject retry request");
            assert_eq!(error, INVALID_RETRY_PAYLOAD);
        }
    }

    #[test]
    fn retry_insights_request_rejects_unknown_fields_and_summary_snapshot() {
        for payload in [
            serde_json::json!({
                "task_id": "20260705-153012-douyin-demo",
                "target": "summary",
                "output_language": "en-US",
                "legacy_default": true
            }),
            serde_json::json!({
                "task_id": "20260705-153012-douyin-demo",
                "target": "summary",
                "output_language": "en-US",
                "preference_snapshot": {}
            }),
            serde_json::json!({
                "task_id": "20260705-153012-douyin-demo",
                "target": "insights",
                "output_language": "en-US",
                "preference_snapshot": null
            }),
        ] {
            let error = parse_retry_insights_request(payload).expect_err("reject retry request");
            assert_eq!(error, INVALID_RETRY_PAYLOAD);
        }
    }

    #[test]
    fn retry_insights_request_accepts_exactly_three_output_languages() {
        for output_language in ["zh-CN", "zh-TW", "en-US"] {
            let payload = serde_json::json!({
                "task_id": "20260705-153012-douyin-demo",
                "target": "summary",
                "output_language": output_language
            });

            let request = parse_retry_insights_request(payload).expect("valid retry request");
            let serialized = serde_json::to_value(request).expect("serialize retry request");

            assert_eq!(serialized["output_language"], output_language);
        }
    }

    #[test]
    fn retry_insights_request_rejects_non_object_snapshot_without_echoing_input() {
        let payload = serde_json::json!({
            "task_id": "task-secret-value",
            "target": "insights",
            "output_language": "en-US",
            "preference_snapshot": "prompt-secret-value"
        });

        let error = parse_retry_insights_request(payload).expect_err("reject snapshot");

        assert_eq!(error, INVALID_RETRY_PAYLOAD);
        assert!(!error.contains("task-secret-value"));
        assert!(!error.contains("prompt-secret-value"));
    }

    #[test]
    fn retry_result_diagnostic_contains_only_validated_target_language_status_and_code() {
        let request = parse_retry_insights_request(serde_json::json!({
            "task_id": "private-task-id",
            "target": "insights",
            "output_language": "zh-CN",
            "preference_snapshot": {"prompt": "private-preference"}
        }))
        .expect("valid retry request");
        let result = serde_json::json!({
            "status": "partial_completed",
            "task_id": "private-task-id",
            "summary": "private generated body",
            "error": {
                "code": "LLM_REQUEST_FAILED",
                "message": "provider said prompt-secret https://secret.example"
            }
        });

        let detail = retry_result_log_detail(&request, &result);

        assert_eq!(
            detail,
            "target=insights output_language=zh-CN status=partial_completed error_code=LLM_REQUEST_FAILED"
        );
        for forbidden in [
            "private-task-id",
            "private-preference",
            "private generated body",
            "provider said",
            "prompt-secret",
            "https://",
        ] {
            assert!(!detail.contains(forbidden));
        }
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
