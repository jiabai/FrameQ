use super::task_result::{map_task_worker_result, TaskCommandContext};
use crate::worker_runtime::{TaskTerminalResult, WorkerJob};
use crate::{
    append_desktop_log, ensure_runtime_dirs, resolve_runtime_paths, run_blocking_worker_command,
    task_manifest, ProcessSupervisors,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State, Window};

const INVALID_RETRY_PAYLOAD: &str = "INVALID_RETRY_PAYLOAD";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
enum RetryInsightsTarget {
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
enum OutputLanguage {
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
struct RetryInsightsRequest {
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

fn parse_retry_insights_request(
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
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let output_root = task_manifest::configured_output_root(&paths)?;
    let _task_lease = task_manifest::acquire_task_mutation(&output_root, &request.task_id)?;
    let request_json = serde_json::to_string(&request)
        .map_err(|_| "Failed to encode worker request.".to_string())?;
    let _ = append_desktop_log(
        &paths,
        "worker.retry_insights.start",
        &retry_diagnostic_detail(&request, "started", None),
    );
    let parsed = map_task_worker_result(
        process_state
            .video_worker(&paths)
            .execute(WorkerJob::retry_insights(request_json, window))?,
        TaskCommandContext::RetryInsights,
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
    use crate::worker_runtime::TaskTerminalResult;

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
            "task_dir": null,
            "artifacts": {},
            "text": "",
            "summary": "private generated body",
            "insights": [],
            "transcript": null,
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
