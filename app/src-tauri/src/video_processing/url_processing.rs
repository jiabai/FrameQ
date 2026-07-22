use super::task_result::{map_task_worker_result, TaskCommandContext};
use super::url_cache;
use super::{closed_task_result, ProcessVideoResult, WorkerError};
use crate::settings::{env_path, parse_dotenv_values, resolve_asr_model_value, ASR_MODEL_ENV};
use crate::task_manifest;
use crate::worker_runtime::{
    SourceIdentityTerminalResult, TaskTerminalResult, ValidatedWorkerResult, WorkerJob,
    WorkerRunErrorKind, WorkerRunOutcome,
};
use crate::{
    append_desktop_log, ensure_runtime_dirs, resolve_runtime_paths, run_blocking_worker_command,
    summarize_worker_result_for_log, ProcessSupervisors,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State, Window};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProcessVideoIpcRequest {
    url: String,
}

#[derive(Serialize)]
struct ProcessVideoWorkerRequest {
    contract_version: u32,
    url: String,
    asr_model: String,
}

pub(crate) const PROCESS_VIDEO_CONTRACT_VERSION: u32 = 3;

pub(super) async fn run_process_video(
    window: Window,
    app: AppHandle,
    process_state: State<'_, Arc<ProcessSupervisors>>,
    request: ProcessVideoIpcRequest,
) -> Result<TaskTerminalResult, String> {
    let process_state = Arc::clone(process_state.inner());
    run_blocking_worker_command(move || process_video_blocking(window, app, process_state, request))
        .await
}

fn process_video_blocking(
    window: Window,
    app: AppHandle,
    process_state: Arc<ProcessSupervisors>,
    request: ProcessVideoIpcRequest,
) -> Result<TaskTerminalResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let output_root = task_manifest::configured_output_root(&paths)?;
    let request = match resolve_process_video_worker_request(&env_path(&paths), request) {
        Ok(request) => request,
        Err(error) => {
            return Ok(closed_task_result(serde_json::json!(ProcessVideoResult {
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
            })))
        }
    };
    if let Some(cached) =
        url_cache::cached_process_result_for_url(&output_root, &request.url, &request.asr_model)?
    {
        let _ = append_desktop_log(
            &paths,
            "worker.process_video.cache_hit",
            &summarize_task_result_for_log(&cached),
        );
        return Ok(cached);
    }
    let resolved_source_identity =
        match resolve_source_identity_for_cache(&paths, &request.url, process_state.as_ref()) {
            Ok(identity) => identity,
            Err(error) => {
                return map_task_worker_result(
                    error.into_task_worker_result(),
                    TaskCommandContext::ProcessVideo,
                );
            }
        };
    if let Some(source_identity) = resolved_source_identity.as_ref() {
        if let Some(cached) = url_cache::cached_process_result_for_identity(
            &output_root,
            source_identity,
            &request.asr_model,
        )? {
            let _ = append_desktop_log(
                &paths,
                "worker.process_video.cache_hit",
                &summarize_task_result_for_log(&cached),
            );
            return Ok(cached);
        }
    }
    let request_json = serialize_process_video_request(&request)?;
    map_task_worker_result(
        process_state
            .video_worker(&paths)
            .execute(WorkerJob::process_video(request_json, window))?,
        TaskCommandContext::ProcessVideo,
    )
}

fn serialize_process_video_request(request: &ProcessVideoWorkerRequest) -> Result<String, String> {
    serde_json::to_string(request).map_err(|_| "Failed to encode worker request.".to_string())
}

#[derive(Debug)]
enum SourceIdentityPreflightError {
    Cancelled,
    AlreadyRunning,
    Transport,
}

impl SourceIdentityPreflightError {
    fn into_task_worker_result(
        self,
    ) -> Result<WorkerRunOutcome, crate::worker_runtime::WorkerRunError> {
        match self {
            Self::Cancelled => Ok(WorkerRunOutcome::Cancelled),
            Self::AlreadyRunning => Err(crate::worker_runtime::WorkerRunError {
                kind: WorkerRunErrorKind::AlreadyRunning,
                detail: "Source identity worker is already running.",
            }),
            Self::Transport => Err(crate::worker_runtime::WorkerRunError {
                kind: WorkerRunErrorKind::RequestDeliveryFailed,
                detail: "Source identity request could not be delivered.",
            }),
        }
    }
}

fn resolve_source_identity_for_cache(
    paths: &crate::RuntimePaths,
    raw_url: &str,
    process_supervisors: &ProcessSupervisors,
) -> Result<Option<task_manifest::SourceIdentity>, SourceIdentityPreflightError> {
    let payload = serde_json::json!({"url": raw_url}).to_string();
    let result = process_supervisors
        .video_worker(paths)
        .execute(WorkerJob::resolve_source_identity(payload))
        .map_err(|_| SourceIdentityPreflightError::Transport)?;
    classify_source_identity_preflight_result(result)
}

fn classify_source_identity_preflight_result(
    result: Result<WorkerRunOutcome, crate::worker_runtime::WorkerRunError>,
) -> Result<Option<task_manifest::SourceIdentity>, SourceIdentityPreflightError> {
    match result {
        Ok(WorkerRunOutcome::Structured(ValidatedWorkerResult::SourceIdentity(
            SourceIdentityTerminalResult::Completed {
                source_identity, ..
            },
        ))) => Ok(Some(source_identity)),
        Ok(WorkerRunOutcome::Structured(ValidatedWorkerResult::SourceIdentity(
            SourceIdentityTerminalResult::Failed { .. },
        ))) => Ok(None),
        Ok(WorkerRunOutcome::Structured(_)) => Ok(None),
        Ok(WorkerRunOutcome::Cancelled) => Err(SourceIdentityPreflightError::Cancelled),
        Ok(WorkerRunOutcome::TimedOut(_)) => Ok(None),
        Ok(WorkerRunOutcome::UnstructuredFailure(_)) => Ok(None),
        Err(error) if error.kind == WorkerRunErrorKind::AlreadyRunning => {
            Err(SourceIdentityPreflightError::AlreadyRunning)
        }
        Err(error) if error.kind == WorkerRunErrorKind::ProtocolViolation => Ok(None),
        Err(_) => Err(SourceIdentityPreflightError::Transport),
    }
}

fn summarize_task_result_for_log(result: &TaskTerminalResult) -> String {
    serde_json::to_value(result)
        .map(|value| summarize_worker_result_for_log(&value))
        .unwrap_or_else(|_| "status=unknown".to_string())
}

fn resolve_process_video_worker_request(
    dotenv_path: &Path,
    request: ProcessVideoIpcRequest,
) -> Result<ProcessVideoWorkerRequest, String> {
    let values = parse_dotenv_values(dotenv_path)?;
    let configured_model = values.get(ASR_MODEL_ENV).cloned();
    let asr_model = resolve_asr_model_value(configured_model)?;
    Ok(ProcessVideoWorkerRequest {
        contract_version: PROCESS_VIDEO_CONTRACT_VERSION,
        url: request.url,
        asr_model,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        classify_source_identity_preflight_result, resolve_process_video_worker_request,
        serialize_process_video_request, ProcessVideoIpcRequest, ProcessVideoWorkerRequest,
        SourceIdentityPreflightError, PROCESS_VIDEO_CONTRACT_VERSION,
    };
    use crate::task_manifest::SourceIdentity;
    use crate::worker_runtime::{
        ModelDownloadTerminalResult, SourceIdentityFailure, SourceIdentityTerminalResult,
        ValidatedWorkerResult, WorkerExitSummary, WorkerRunError, WorkerRunErrorKind,
        WorkerRunOutcome, WorkerTimeoutKind,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn source_identity_preflight_uses_completed_identity_for_second_cache_lookup() {
        let identity = SourceIdentity {
            version: 1,
            platform: "xiaohongshu".to_string(),
            stable_id: "64a1b2c3d4e5f67890123456".to_string(),
            effective_part: None,
            canonical_url: "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456"
                .to_string(),
        };
        let result = Ok(WorkerRunOutcome::Structured(
            ValidatedWorkerResult::SourceIdentity(SourceIdentityTerminalResult::Completed {
                source_url: "https://xhslink.com/review".to_string(),
                source_identity: identity.clone(),
            }),
        ));

        let classified = classify_source_identity_preflight_result(result)
            .expect("completed identity should remain usable");

        assert_eq!(classified, Some(identity));
    }

    #[test]
    fn source_identity_preflight_continues_without_identity_for_best_effort_failures() {
        let results = [
            Ok(WorkerRunOutcome::Structured(
                ValidatedWorkerResult::SourceIdentity(SourceIdentityTerminalResult::Failed {
                    error: SourceIdentityFailure {
                        code: "SOURCE_IDENTITY_UNAVAILABLE".to_string(),
                    },
                }),
            )),
            Ok(WorkerRunOutcome::Structured(
                ValidatedWorkerResult::ModelDownload(ModelDownloadTerminalResult::Completed {
                    model: "iic/SenseVoiceSmall".to_string(),
                }),
            )),
            Ok(WorkerRunOutcome::UnstructuredFailure(WorkerExitSummary {
                exit_code: Some(1),
                stderr: "worker diagnostic must not be surfaced",
            })),
            Err(WorkerRunError {
                kind: WorkerRunErrorKind::ProtocolViolation,
                detail: "Worker result violated the protocol.",
            }),
            Ok(WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Idle)),
            Ok(WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Absolute)),
        ];

        for result in results {
            assert!(classify_source_identity_preflight_result(result)
                .expect("best-effort preflight failure should continue processing")
                .is_none());
        }
    }

    #[test]
    fn source_identity_preflight_preserves_cancelled_and_busy_terminal_decisions() {
        assert!(matches!(
            classify_source_identity_preflight_result(Ok(WorkerRunOutcome::Cancelled)),
            Err(SourceIdentityPreflightError::Cancelled)
        ));
        assert!(matches!(
            classify_source_identity_preflight_result(Err(WorkerRunError {
                kind: WorkerRunErrorKind::AlreadyRunning,
                detail: "Source identity worker is already running.",
            })),
            Err(SourceIdentityPreflightError::AlreadyRunning)
        ));
    }

    #[test]
    fn source_identity_preflight_maps_remaining_runtime_errors_to_transport() {
        for kind in [
            WorkerRunErrorKind::SpawnFailed,
            WorkerRunErrorKind::RequestDeliveryFailed,
            WorkerRunErrorKind::PipeUnavailable,
            WorkerRunErrorKind::WaitFailed,
            WorkerRunErrorKind::WatchdogStartFailed,
        ] {
            assert!(matches!(
                classify_source_identity_preflight_result(Err(WorkerRunError {
                    kind,
                    detail: "Source identity request transport failed.",
                })),
                Err(SourceIdentityPreflightError::Transport)
            ));
        }
    }

    #[test]
    fn process_request_serialization_never_includes_preflight_source_identity() {
        let request = ProcessVideoWorkerRequest {
            contract_version: PROCESS_VIDEO_CONTRACT_VERSION,
            url: "https://xhslink.com/short?xsec_token=review-secret".to_string(),
            asr_model: "iic/SenseVoiceSmall".to_string(),
        };

        let encoded = serialize_process_video_request(&request).expect("serialize request");
        let payload: serde_json::Value = serde_json::from_str(&encoded).expect("request json");

        assert_eq!(
            payload,
            serde_json::json!({
                "contract_version": 3,
                "url": request.url,
                "asr_model": request.asr_model,
            })
        );
    }

    #[test]
    fn process_ipc_request_accepts_url_only() {
        let request = serde_json::from_str::<ProcessVideoIpcRequest>(
            r#"{"url":"https://www.douyin.com/video/7524373044106677544"}"#,
        )
        .expect("URL-only process intent");

        assert_eq!(
            request.url,
            "https://www.douyin.com/video/7524373044106677544"
        );
    }

    #[test]
    fn process_ipc_request_rejects_legacy_false_contract_fields() {
        let raw = r#"{
          "url":"https://user:review-secret@example.com/private",
          "language":"Chinese",
          "output_formats":["txt","md"],
          "model":"iic/SenseVoiceSmall",
          "insightflow_mode":"embedded"
        }"#;

        let error = match serde_json::from_str::<ProcessVideoIpcRequest>(raw) {
            Ok(_) => panic!("legacy false process-video fields must be rejected"),
            Err(error) => error.to_string(),
        };

        assert!(!error.contains("review-secret"));
        assert!(!error.contains("https://"));
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

        let error = match serde_json::from_str::<ProcessVideoIpcRequest>(raw) {
            Ok(_) => panic!("retired process-video AI field must be rejected"),
            Err(error) => error.to_string(),
        };

        assert!(!error.contains("review-secret"));
        assert!(!error.contains("https://"));
    }

    #[test]
    fn resolve_process_video_worker_request_uses_configured_asr_model() {
        let env_path = temp_env_path("resolve_process_video_worker_request");
        fs::write(&env_path, "FRAMEQ_ASR_MODEL=iic/SenseVoiceSmall").expect("write test env");
        let request = ProcessVideoIpcRequest {
            url: "https://www.douyin.com/video/7646789377271647540".to_string(),
        };

        let request = resolve_process_video_worker_request(&env_path, request)
            .expect("resolve worker request");

        assert_eq!(request.contract_version, PROCESS_VIDEO_CONTRACT_VERSION);
        assert_eq!(request.asr_model, "iic/SenseVoiceSmall");
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
