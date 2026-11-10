use super::task_result::{map_task_worker_result, TaskCommandContext};
use crate::insight_preferences::InspirationProfile;
use crate::worker_runtime::{TaskTerminalResult, WorkerJob};
use crate::{
    append_desktop_log, ensure_runtime_dirs, resolve_runtime_paths, run_blocking_worker_command,
    task_manifest, ProcessSupervisors,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State, Window};

const INVALID_RETRY_PAYLOAD: &str = "INVALID_RETRY_PAYLOAD";

#[cfg(test)]
#[path = "note_title_tests.rs"]
mod note_title_tests;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
enum RetryInsightsTarget {
    #[serde(rename = "summary")]
    Summary,
    #[serde(rename = "insights")]
    Insights,
    #[serde(rename = "dissection")]
    Dissection,
    #[serde(rename = "draft")]
    Draft,
    #[serde(rename = "transcript")]
    Transcript,
    #[serde(rename = "title")]
    Title,
}

impl RetryInsightsTarget {
    fn as_str(self) -> &'static str {
        match self {
            Self::Summary => "summary",
            Self::Insights => "insights",
            Self::Dissection => "dissection",
            Self::Draft => "draft",
            Self::Transcript => "transcript",
            Self::Title => "title",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
enum OutputLanguage {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "zh-TW")]
    ZhTw,
    #[serde(rename = "en-US")]
    EnUs,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreferenceSnapshot {
    profile: Option<InspirationProfile>,
    profile_skipped: bool,
    generation_preferences: RetryGenerationPreferences,
    label_snapshot: PreferenceLabelSnapshot,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RetryGenerationPreferences {
    goal: String,
    scenario: String,
    angles: Vec<String>,
    audience: String,
    styles: Vec<String>,
    avoid: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreferenceLabelSnapshot {
    profile: Vec<ProfileLabelSnapshotItem>,
    generation_preferences: Vec<GenerationLabelSnapshotItem>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum ProfileField {
    Role,
    Domain,
    Stage,
    CityContext,
    GenderPerspective,
    Platforms,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum GenerationPreferenceField {
    Goal,
    Scenario,
    Angles,
    Audience,
    Styles,
    Avoid,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProfileLabelSnapshotItem {
    field: ProfileField,
    label: String,
    values: Vec<PreferenceLabelValue>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct GenerationLabelSnapshotItem {
    field: GenerationPreferenceField,
    label: String,
    values: Vec<PreferenceLabelValue>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PreferenceLabelValue {
    id: String,
    label: String,
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
struct RetryInsightsRequest {
    task_id: String,
    target: RetryInsightsTarget,
    output_language: OutputLanguage,
    #[serde(skip_serializing_if = "Option::is_none")]
    preference_snapshot: Option<PreferenceSnapshot>,
    // Present only for target="draft" (identifies which insight to expand into a
    // draft). Omitted on the wire for summary/insights/dissection so those
    // requests stay byte-identical to the pre-draft worker contract.
    #[serde(skip_serializing_if = "Option::is_none")]
    insight_id: Option<i64>,
    // User-selected draft platform id; present only for target="draft". Omitted
    // on the wire for other targets (same skip pattern as insight_id). The
    // worker validates the platform id against its closed vocabulary.
    #[serde(skip_serializing_if = "Option::is_none")]
    platform: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RetryInsightsWireRequest {
    task_id: String,
    target: RetryInsightsTarget,
    output_language: OutputLanguage,
    preference_snapshot: Option<PreferenceSnapshot>,
    insight_id: Option<i64>,
    platform: Option<String>,
}

fn parse_retry_insights_request(
    payload: serde_json::Value,
) -> Result<RetryInsightsRequest, String> {
    if payload.get("target").and_then(serde_json::Value::as_str) == Some("title")
        && payload.as_object().is_none_or(|object| {
            object.len() != 3 || object.keys().any(|key| !["task_id", "target", "output_language"].contains(&key.as_str()))
        })
    {
        return Err(INVALID_RETRY_PAYLOAD.to_string());
    }
    if payload
        .as_object()
        .and_then(|object| object.get("preference_snapshot"))
        .is_some_and(|snapshot| !snapshot.is_object())
    {
        return Err(INVALID_RETRY_PAYLOAD.to_string());
    }
    if payload
        .as_object()
        .and_then(|object| object.get("preference_snapshot"))
        .and_then(serde_json::Value::as_object)
        .is_some_and(|snapshot| !snapshot.contains_key("profile"))
    {
        return Err(INVALID_RETRY_PAYLOAD.to_string());
    }
    let wire: RetryInsightsWireRequest =
        serde_json::from_value(payload).map_err(|_| INVALID_RETRY_PAYLOAD.to_string())?;
    if wire.target != RetryInsightsTarget::Insights && wire.preference_snapshot.is_some() {
        return Err(INVALID_RETRY_PAYLOAD.to_string());
    }
    let (insight_id, platform) = match wire.target {
        RetryInsightsTarget::Draft => {
            let Some(insight_id) = wire.insight_id else {
                return Err(INVALID_RETRY_PAYLOAD.to_string());
            };
            let Some(platform) = wire.platform.as_deref().map(str::trim) else {
                return Err(INVALID_RETRY_PAYLOAD.to_string());
            };
            if platform.is_empty() {
                return Err(INVALID_RETRY_PAYLOAD.to_string());
            }
            (Some(insight_id), Some(platform.to_string()))
        }
        _ => {
            if wire.insight_id.is_some() || wire.platform.is_some() {
                return Err(INVALID_RETRY_PAYLOAD.to_string());
            }
            (None, None)
        }
    };
    Ok(RetryInsightsRequest {
        task_id: wire.task_id,
        target: wire.target,
        output_language: wire.output_language,
        preference_snapshot: wire.preference_snapshot,
        insight_id,
        platform,
    })
}

pub(super) async fn run_retry_insights(
    window: Window,
    app: AppHandle,
    process_state: State<'_, Arc<ProcessSupervisors>>,
    request: serde_json::Value,
) -> Result<TaskTerminalResult, String> {
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
) -> Result<TaskTerminalResult, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let paths = resolve_runtime_paths(&app)?;
    if request.target == RetryInsightsTarget::Draft
        && crate::llm_providers::draft_byok_requires_login(&paths)?
    {
        return Err("AI_DRAFT_REQUIRES_LOGIN".to_string());
    }
    crate::history_deletion::guard_pending_task(&paths, &request.task_id)?;
    ensure_runtime_dirs(&paths)?;
    let output_root = task_manifest::configured_output_root(&paths)?;
    let task_lease = open_retry_task(&paths, &output_root, &request.task_id)?;
    validate_retry_source(&task_lease, request.target)?;
    if request.target == RetryInsightsTarget::Title {
        drop(task_lease);
        return retry_note_title(window, &paths, &output_root, process_state, request);
    }
    let source_before = task_lease.source();
    let request_json = serde_json::to_string(&request)
        .map_err(|_| "Failed to encode worker request.".to_string())?;
    let _ = append_desktop_log(
        &paths,
        "worker.retry_insights.start",
        &retry_diagnostic_detail(&request, "started", None),
    );
    let mut parsed = map_task_worker_result(
        process_state
            .task_worker(&paths)
            .execute(WorkerJob::retry_insights(request_json, window))?,
        TaskCommandContext::RetryInsights,
    )?;
    drop(task_lease);
    if parsed.task_id.is_some() {
        let task = task_manifest::SupportedTask::open(&output_root, &request.task_id)?;
        if task.source() != source_before || !parsed.validate_source_task(&task) {
            return Err("WORKER_PROTOCOL_VIOLATION".to_string());
        }
    }
    if request.target == RetryInsightsTarget::Dissection && parsed.dissection.is_some() {
        let task = task_manifest::SupportedTask::open(&output_root, &request.task_id)
            .map_err(|_| "Task dissection artifact is invalid.".to_string())?;
        let view = task
            .read_dissection()
            .map_err(|_| "Task dissection artifact is invalid.".to_string())?
            .ok_or_else(|| "Task dissection artifact is invalid.".to_string())?;
        if view.source_status != task_manifest::DissectionSourceStatus::Current {
            return Err("Task dissection artifact is invalid.".to_string());
        }
        parsed.dissection = Some(view.report);
    }
    let _ = append_desktop_log(
        &paths,
        "worker.retry_insights.result",
        &retry_result_log_detail(&request, &parsed),
    );
    Ok(parsed)
}

fn validate_retry_source(task: &task_manifest::SupportedTask, target: RetryInsightsTarget) -> Result<(), String> {
    if task.is_web_page() && matches!(target, RetryInsightsTarget::Title | RetryInsightsTarget::Transcript) {
        return Err("WEB_RETRY_TARGET_UNSUPPORTED".to_string());
    }
    task.read_source_text()?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NoteTitleCancellationRequest {
    task_id: String,
    output_language: OutputLanguage,
    #[serde(deserialize_with = "deserialize_expected_note_title")]
    expected_note_title: Option<task_manifest::NoteTitle>,
}

fn deserialize_expected_note_title<'de, D>(deserializer: D) -> Result<Option<task_manifest::NoteTitle>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<task_manifest::NoteTitle>::deserialize(deserializer)
}

pub(super) async fn run_record_note_title_cancellation(
    app: AppHandle,
    request: serde_json::Value,
) -> Result<TaskTerminalResult, String> {
    let request: NoteTitleCancellationRequest = serde_json::from_value(request)
        .map_err(|_| "INVALID_TITLE_CANCELLATION_REQUEST".to_string())?;
    run_blocking_worker_command(move || {
        let _storage_access = crate::data_storage::acquire_data_access(&app)?;
        let paths = resolve_runtime_paths(&app)?;
        record_note_title_cancellation_from_paths(&paths, request)
    }).await
}

fn open_retry_task(
    paths: &crate::RuntimePaths,
    output_root: &std::path::Path,
    task_id: &str,
) -> Result<task_manifest::SupportedTask, String> {
    crate::history_deletion::guard_pending_task(paths, task_id)?;
    let task = task_manifest::SupportedTask::open(output_root, task_id)?;
    crate::history_deletion::guard_pending_task(paths, task_id)?;
    Ok(task)
}

fn record_note_title_cancellation_from_paths(
    paths: &crate::RuntimePaths,
    request: NoteTitleCancellationRequest,
) -> Result<TaskTerminalResult, String> {
    let output_root = task_manifest::configured_output_root(paths)?;
    let task = open_retry_task(paths, &output_root, &request.task_id)?;
    record_note_title_cancellation_to_task(task, request)
}

#[cfg(test)]
fn record_note_title_cancellation_from_root(
    output_root: &std::path::Path,
    request: NoteTitleCancellationRequest,
) -> Result<TaskTerminalResult, String> {
    let task = task_manifest::SupportedTask::open(output_root, &request.task_id)?;
    record_note_title_cancellation_to_task(task, request)
}

fn record_note_title_cancellation_to_task(
    mut task: task_manifest::SupportedTask,
    request: NoteTitleCancellationRequest,
) -> Result<TaskTerminalResult, String> {
    if task.is_web_page() {
        return Err("WEB_RETRY_TARGET_UNSUPPORTED".to_string());
    }
    task.read_text_artifact(task_manifest::TaskArtifact::TranscriptTxt)?
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "TITLE_TRANSCRIPT_REQUIRED".to_string())?;
    if task.note_title() == request.expected_note_title {
        let title = task_manifest::NoteTitle {
            text: task.note_title().and_then(|title| title.text),
            status: task_manifest::NoteTitleStatus::Cancelled,
            output_language: request.output_language.as_str().to_string(),
            error_code: Some("WORKER_CANCELLED".to_string()),
        };
        task.save_note_title(title).map_err(|_| "TITLE_SAVE_FAILED".to_string())?;
    }
    note_title_result_from_task(&task)
}

fn note_title_result_from_task(task: &task_manifest::SupportedTask) -> Result<TaskTerminalResult, String> {
    let title = task.note_title();
    let error = if let Some(title) = title.as_ref().filter(|title| title.status != task_manifest::NoteTitleStatus::Completed) {
        Some(serde_json::json!({
            "code": title.error_code.as_deref().unwrap_or("TITLE_GENERATION_INTERRUPTED"),
            "message": "Note title generation did not complete.",
            "stage": "title_generating"
        }))
    } else {
        task.safe_error().map(|error| serde_json::json!({"code":error.code,"message":error.message,"stage":error.stage}))
    };
    let dissection = task.read_dissection()?;
    TaskTerminalResult::from_value(serde_json::json!({
        "status": if title.as_ref().is_some_and(|title| title.status != task_manifest::NoteTitleStatus::Completed) { "partial_completed" } else { task.status() },
        "task_id": task.task_id(),
        "task_dir": task.task_dir_frontend_string(),
        "artifacts": task.declared_artifacts(),
        "text": task.read_text_artifact(task_manifest::TaskArtifact::TranscriptTxt)?.unwrap_or_default(),
        "summary": task.read_text_artifact(task_manifest::TaskArtifact::Summary)?.unwrap_or_default(),
        "insights": task.read_insights()?,
        "transcript": task.transcript_metadata(),
        "dissection": dissection.as_ref().map(|view| &view.report),
        "dissection_source_status": dissection.map(|view| view.source_status),
        "draft": task.read_text_artifact(task_manifest::TaskArtifact::Draft)?.unwrap_or_default(),
        "note_title": title,
        "task_created": false,
        "error": error
    })).map_err(|_| "TITLE_STATE_INVALID".to_string())
}

fn retry_note_title(
    window: Window,
    paths: &crate::RuntimePaths,
    output_root: &std::path::Path,
    process_state: Arc<ProcessSupervisors>,
    request: RetryInsightsRequest,
) -> Result<TaskTerminalResult, String> {
    let task = open_retry_task(paths, output_root, &request.task_id)?;
    validate_retry_source(&task, RetryInsightsTarget::Title)?;
    let transcript = task
        .read_text_artifact(task_manifest::TaskArtifact::TranscriptTxt)?
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "TITLE_TRANSCRIPT_REQUIRED".to_string())?;
    let request_json =
        serde_json::to_string(&request).map_err(|_| "Invalid title request.".to_string())?;
    let result = match process_state
        .task_worker(paths)
        .execute(WorkerJob::retry_insights(request_json, window))
    {
        Ok(outcome) => map_task_worker_result(outcome, TaskCommandContext::RetryInsights),
        Err(_) => Err("TITLE_GENERATION_FAILED".to_string()),
    };
    finish_note_title_attempt(
        task,
        output_root,
        request.output_language.as_str(),
        transcript,
        result,
    )
}

fn finish_note_title_attempt(
    task: task_manifest::SupportedTask,
    output_root: &std::path::Path,
    output_language: &str,
    transcript: String,
    result: Result<TaskTerminalResult, String>,
) -> Result<TaskTerminalResult, String> {
    let mut committed = task.reload(output_root)?;
    let candidate = result.ok();
    let same_task = candidate
        .as_ref()
        .is_some_and(|result| result.task_id.as_deref() == Some(task.task_id()));
    let published = candidate.as_ref().filter(|result| {
        same_task
            && result.status.as_str() == "completed"
            && result.error.is_none()
            && result.note_title.as_ref().is_some_and(|title| {
                title.status == task_manifest::NoteTitleStatus::Completed
                    && title.output_language == output_language
                    && Some(title) == committed.note_title().as_ref()
            })
    });
    if let Some(result) = published {
        let mut result = result.clone();
        result.task_created = false;
        result.task_dir = Some(committed.task_dir_frontend_string());
        result.artifacts = committed.declared_artifacts();
        result.text = transcript;
        return Ok(result);
    }
    let code = if let Some(result) = candidate.as_ref() {
        if result.task_id.is_some() && !same_task {
            "WORKER_PROTOCOL_VIOLATION".to_string()
        } else {
            result
                .error
                .as_ref()
                .map(|error| error.code.clone())
                .unwrap_or_else(|| "TITLE_OUTPUT_INVALID".to_string())
        }
    } else {
        "TITLE_GENERATION_FAILED".to_string()
    };
    let title = task_manifest::NoteTitle {
        text: committed.note_title().and_then(|title| title.text),
        status: if code == "WORKER_CANCELLED" {
            task_manifest::NoteTitleStatus::Cancelled
        } else {
            task_manifest::NoteTitleStatus::Failed
        },
        output_language: output_language.to_string(),
        error_code: Some(code.clone()),
    };
    let saved = committed.save_note_title(title.clone()).is_ok();
    let code = if saved {
        code
    } else {
        "TITLE_SAVE_FAILED".to_string()
    };
    let mut result = super::closed_task_result(serde_json::json!({
        "status": "partial_completed",
        "task_id": task.task_id(),
        "task_dir": committed.task_dir_frontend_string(),
        "artifacts": committed.declared_artifacts(),
        "text": transcript,
        "summary": committed.read_text_artifact(task_manifest::TaskArtifact::Summary)?.unwrap_or_default(),
        "insights": committed.read_insights()?,
        "transcript": committed.transcript_metadata(),
        "dissection": null,
        "draft": "",
        "error": {
            "code": code,
            "message": "Note title generation did not complete.",
            "stage": "title_generating"
        }
    }));
    result.note_title = if saved {
        Some(title)
    } else {
        task.note_title()
    };
    Ok(result)
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

fn retry_result_log_detail(request: &RetryInsightsRequest, result: &TaskTerminalResult) -> String {
    retry_diagnostic_detail(
        request,
        result.status.as_str(),
        result.error.as_ref().map(|error| error.code.as_str()),
    )
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

#[cfg(test)]
mod tests {
    use super::{parse_retry_insights_request, retry_result_log_detail, INVALID_RETRY_PAYLOAD};
    #[test]
    fn webpage_retry_reads_formal_source_and_rejects_media_targets() {
        let root = crate::task_manifest::web_tests::output_root();
        let dir = crate::task_manifest::web_tests::write_task(&root, "web-retry", &crate::task_manifest::web_tests::manifest("web-retry"));
        let task = crate::task_manifest::SupportedTask::open(&root, "web-retry").unwrap();
        for target in [super::RetryInsightsTarget::Title, super::RetryInsightsTarget::Transcript] {
            assert_eq!(super::validate_retry_source(&task, target).unwrap_err(), "WEB_RETRY_TARGET_UNSUPPORTED");
        }
        for target in [super::RetryInsightsTarget::Summary, super::RetryInsightsTarget::Insights, super::RetryInsightsTarget::Dissection, super::RetryInsightsTarget::Draft] {
            super::validate_retry_source(&task, target).unwrap();
        }
        std::fs::remove_file(dir.join("article/article.txt")).unwrap();
        assert!(super::validate_retry_source(&task, super::RetryInsightsTarget::Summary).is_err());
    }
    use crate::worker_runtime::TaskTerminalResult;

    #[test]
    fn retry_insights_request_round_trips_preference_snapshot_payload() {
        let payload = serde_json::json!({
            "task_id": "20260705-153012-douyin-demo",
            "target": "insights",
            "output_language": "zh-TW",
            "preference_snapshot": {
                "profile": {
                    "role": "content_creator",
                    "domain": "content_media",
                    "stage": "experienced_professional",
                    "cityContext": "new_tier1_city",
                    "genderPerspective": "neutral_perspective",
                    "platforms": ["douyin"]
                },
                "profileSkipped": false,
                "generationPreferences": {
                    "goal": "content_creation",
                    "scenario": "short_video",
                    "angles": ["topic_angle"],
                    "audience": "fans_readers",
                    "styles": ["grounded"],
                    "avoid": []
                },
                "labelSnapshot": {
                    "profile": [
                        {
                            "field": "role",
                            "label": "Role",
                            "values": [{"id": "content_creator", "label": "Content creator"}]
                        },
                        {
                            "field": "domain",
                            "label": "Domain",
                            "values": [{"id": "content_media", "label": "Content and media"}]
                        },
                        {
                            "field": "stage",
                            "label": "Stage",
                            "values": [{"id": "experienced_professional", "label": "Experienced professional"}]
                        },
                        {
                            "field": "cityContext",
                            "label": "City context",
                            "values": [{"id": "new_tier1_city", "label": "New tier-1 city"}]
                        },
                        {
                            "field": "genderPerspective",
                            "label": "Gender perspective",
                            "values": [{"id": "neutral_perspective", "label": "Neutral perspective"}]
                        },
                        {
                            "field": "platforms",
                            "label": "Platforms",
                            "values": [{"id": "douyin", "label": "Douyin"}]
                        }
                    ],
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
        assert_eq!(serialized["preference_snapshot"]["profileSkipped"], false);
        assert_eq!(
            serialized["preference_snapshot"]["profile"],
            serde_json::json!({
                "role": "content_creator",
                "domain": "content_media",
                "stage": "experienced_professional",
                "cityContext": "new_tier1_city",
                "genderPerspective": "neutral_perspective",
                "platforms": ["douyin"]
            })
        );
        assert_eq!(
            serialized["preference_snapshot"]["labelSnapshot"]["profile"]
                .as_array()
                .expect("profile label rows")
                .iter()
                .map(|row| row["field"].as_str().expect("profile field"))
                .collect::<Vec<_>>(),
            vec![
                "role",
                "domain",
                "stage",
                "cityContext",
                "genderPerspective",
                "platforms"
            ]
        );
        let serialized_text = serialized.to_string();
        for forbidden in ["defaultStyles", "defaultAvoid"] {
            assert!(!serialized_text.contains(forbidden));
        }
    }

    #[test]
    fn retry_insights_request_rejects_deprecated_snapshot_fields() {
        for legacy_field in ["defaultStyles", "defaultAvoid"] {
            let mut profile = serde_json::json!({
                "role": "content_creator",
                "domain": "content_media",
                "stage": "experienced_professional",
                "cityContext": "new_tier1_city",
                "genderPerspective": "neutral_perspective",
                "platforms": ["douyin"]
            });
            profile
                .as_object_mut()
                .expect("profile object")
                .insert(legacy_field.to_string(), serde_json::json!([]));
            let payload = serde_json::json!({
                "task_id": "20260705-153012-douyin-demo",
                "target": "insights",
                "output_language": "zh-TW",
                "preference_snapshot": {
                    "profile": profile,
                    "profileSkipped": false,
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

            let error = parse_retry_insights_request(payload).expect_err("reject legacy profile");

            assert_eq!(error, INVALID_RETRY_PAYLOAD);
        }
    }

    #[test]
    fn retry_insights_request_requires_explicit_nullable_profile() {
        let explicit_null = serde_json::json!({
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
        parse_retry_insights_request(explicit_null.clone()).expect("accept explicit null profile");

        let mut missing_profile = explicit_null;
        missing_profile["preference_snapshot"]
            .as_object_mut()
            .expect("snapshot object")
            .remove("profile");

        let error =
            parse_retry_insights_request(missing_profile).expect_err("reject missing profile");

        assert_eq!(error, INVALID_RETRY_PAYLOAD);
        assert!(!error.contains("20260705-153012-douyin-demo"));
    }

    #[test]
    fn retry_dissection_request_uses_only_common_fields() {
        let request = parse_retry_insights_request(serde_json::json!({
            "task_id": "20260705-153012-douyin-demo",
            "target": "dissection",
            "output_language": "en-US"
        }))
        .expect("valid dissection request");

        assert_eq!(
            serde_json::to_value(request).expect("serialize dissection request"),
            serde_json::json!({
                "task_id": "20260705-153012-douyin-demo",
                "target": "dissection",
                "output_language": "en-US"
            })
        );
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
                "target": "dissection",
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
    fn retry_transcript_request_uses_only_common_fields() {
        let request = parse_retry_insights_request(serde_json::json!({
            "task_id": "20260705-153012-douyin-demo",
            "target": "transcript",
            "output_language": "zh-CN"
        }))
        .expect("valid transcript request");

        assert_eq!(
            serde_json::to_value(request).expect("serialize transcript request"),
            serde_json::json!({
                "task_id": "20260705-153012-douyin-demo",
                "target": "transcript",
                "output_language": "zh-CN"
            })
        );
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
                    "generationPreferences": [{
                        "field": "goal",
                        "label": "private-preference",
                        "values": [{"id": "content_creation", "label": "Content creation"}]
                    }]
                }
            }
        }))
        .expect("valid retry request");
        let result = serde_json::json!({
            "status": "partial_completed",
            "task_id": "private-task-id",
            "task_dir": null,
            "artifacts": {},
            "text": "",
            "summary": "private generated body",
            "insights": [],
            "transcript": null,
            "dissection": null,
            "error": {
                "code": "LLM_REQUEST_FAILED",
                "message": "provider said prompt-secret https://secret.example",
                "stage": "insights_generating"
            }
        });
        let result = TaskTerminalResult::from_value(result).expect("closed retry result");

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
}
