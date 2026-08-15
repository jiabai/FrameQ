use crate::progress_event::cancelled_model_download_event;
pub(crate) use crate::progress_event::ASR_MODEL_DOWNLOAD_EVENT_NAME;
#[allow(unused_imports)]
pub(crate) use crate::progress_event::MODEL_DOWNLOAD_EVENT_PREFIX;
use crate::settings::{
    asr_model_source, configured_env_value, env_path, parse_dotenv_values,
    ASR_MODEL_DOWNLOAD_SHA256_ENV, ASR_MODEL_DOWNLOAD_URL_ENV, MODELSCOPE_ENDPOINT_ENV,
    SENSEVOICE_REVISION_ENV,
};
use crate::worker_runtime::{
    AsrModelDownloadJob, ModelDownloadTerminalResult, ValidatedWorkerResult, WorkerRunError,
    WorkerRunErrorKind, WorkerRunOutcome, WorkerTimeoutKind, WORKER_PROTOCOL_MESSAGE,
};
use crate::{
    ensure_runtime_dirs, path_to_env_string, resolve_runtime_paths, run_blocking_worker_command,
    CancelProcessResult, ProcessSupervisors, RuntimePaths,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter, State, Window};

const MODEL_VERSION_FILE_NAME: &str = "MODEL_VERSION.txt";
pub(crate) const DEFAULT_ASR_MODEL: &str = "iic/SenseVoiceSmall";
pub(crate) const SENSEVOICE_SMALL_ONNX_MODEL: &str = "iic/SenseVoiceSmall-onnx";
const SENSEVOICE_VAD_MODEL: &str = "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch";
const SENSEVOICE_ONNX_VAD_MODEL: &str = "iic/speech_fsmn_vad_zh-cn-16k-common-onnx";
const ONNX_CACHE_DIR_NAME: &str = "onnx";
const SENSEVOICE_BPE_FILE_NAME: &str = "chn_jpn_yue_eng_ko_spectok.bpe.model";
pub(crate) const SUPPORTED_ASR_MODELS: &[&str] = &[DEFAULT_ASR_MODEL, SENSEVOICE_SMALL_ONNX_MODEL];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum SupportedDiagnosticModel {
    #[serde(rename = "iic/SenseVoiceSmall")]
    SenseVoiceSmall,
    #[serde(rename = "iic/SenseVoiceSmall-onnx")]
    SenseVoiceSmallOnnx,
}

impl SupportedDiagnosticModel {
    fn from_id(value: &str) -> Option<Self> {
        match value {
            DEFAULT_ASR_MODEL => Some(Self::SenseVoiceSmall),
            SENSEVOICE_SMALL_ONNX_MODEL => Some(Self::SenseVoiceSmallOnnx),
            _ => None,
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::SenseVoiceSmall => DEFAULT_ASR_MODEL,
            Self::SenseVoiceSmallOnnx => SENSEVOICE_SMALL_ONNX_MODEL,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DiagnosticCacheStatus {
    Ready,
    Missing,
    Invalid,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) struct DiagnosticModelSnapshot {
    pub(crate) model: SupportedDiagnosticModel,
    pub(crate) cache_status: DiagnosticCacheStatus,
}

impl Default for DiagnosticModelSnapshot {
    fn default() -> Self {
        Self {
            model: SupportedDiagnosticModel::SenseVoiceSmall,
            cache_status: DiagnosticCacheStatus::Unknown,
        }
    }
}

#[derive(Default)]
pub(crate) struct DiagnosticModelState {
    snapshot: RwLock<DiagnosticModelSnapshot>,
}

impl DiagnosticModelState {
    pub(crate) fn snapshot(&self) -> DiagnosticModelSnapshot {
        self.snapshot.read().map(|value| *value).unwrap_or_default()
    }

    fn update(&self, snapshot: DiagnosticModelSnapshot) {
        if let Ok(mut current) = self.snapshot.write() {
            *current = snapshot;
        }
    }
}

fn diagnostic_model_snapshot_for(paths: &RuntimePaths, asr_model: &str) -> DiagnosticModelSnapshot {
    let Some(model) = SupportedDiagnosticModel::from_id(asr_model) else {
        return DiagnosticModelSnapshot::default();
    };
    let marker = asr_model_cache_dir(paths, model.id()).join(MODEL_VERSION_FILE_NAME);
    let cache_status = match marker.try_exists() {
        Ok(false) => DiagnosticCacheStatus::Missing,
        Ok(true) if asr_model_available(paths, model.id()) => DiagnosticCacheStatus::Ready,
        Ok(true) => DiagnosticCacheStatus::Invalid,
        Err(_) => DiagnosticCacheStatus::Unknown,
    };
    DiagnosticModelSnapshot {
        model,
        cache_status,
    }
}

pub(crate) fn refresh_diagnostic_model_state(
    paths: &RuntimePaths,
    asr_model: &str,
    state: &DiagnosticModelState,
) {
    state.update(diagnostic_model_snapshot_for(paths, asr_model));
}

#[derive(Debug, Serialize)]
pub(crate) struct AsrModelStatusView {
    user_data_dir: String,
    default_output_dir: String,
    asr_model: String,
    asr_model_dir: String,
    asr_model_available: bool,
    asr_model_source: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct AsrModelDownloadResult {
    started: bool,
    status: String,
}

fn asr_model_cache_dir(paths: &RuntimePaths, asr_model: &str) -> PathBuf {
    let root = paths.user_data_dir.join("models");
    if asr_model == SENSEVOICE_SMALL_ONNX_MODEL {
        root.join(ONNX_CACHE_DIR_NAME)
    } else {
        root
    }
}

fn asr_model_display_dir(paths: &RuntimePaths, asr_model: &str) -> PathBuf {
    let model_name = if asr_model == SENSEVOICE_SMALL_ONNX_MODEL {
        "SenseVoiceSmall-onnx"
    } else {
        "SenseVoiceSmall"
    };
    asr_model_cache_dir(paths, asr_model)
        .join("models")
        .join("iic")
        .join(model_name)
}

fn asr_model_available(paths: &RuntimePaths, asr_model: &str) -> bool {
    SUPPORTED_ASR_MODELS.contains(&asr_model)
        && model_marker_exists(&asr_model_cache_dir(paths, asr_model), asr_model)
}

fn plausible_torch_model(path: &Path) -> bool {
    use std::io::Read;

    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).is_ok() && magic == *b"PK\x03\x04"
}

fn model_marker_exists(model_dir: &Path, asr_model: &str) -> bool {
    let marker = model_dir.join(MODEL_VERSION_FILE_NAME);
    marker.is_file()
        && required_model_files_exist(model_dir, asr_model)
        && fs::read_to_string(marker)
            .map(|content| match asr_model {
                DEFAULT_ASR_MODEL => {
                    content.contains(DEFAULT_ASR_MODEL) && content.contains(SENSEVOICE_VAD_MODEL)
                }
                SENSEVOICE_SMALL_ONNX_MODEL => {
                    content.contains(SENSEVOICE_SMALL_ONNX_MODEL)
                        && content.contains(SENSEVOICE_ONNX_VAD_MODEL)
                }
                _ => false,
            })
            .unwrap_or(false)
}

fn required_model_files_exist(model_dir: &Path, asr_model: &str) -> bool {
    match asr_model {
        DEFAULT_ASR_MODEL => [model_dir.to_path_buf(), model_dir.join("models")]
            .iter()
            .any(|model_root| {
                let sensevoice_model = model_root
                    .join("iic")
                    .join("SenseVoiceSmall")
                    .join("model.pt");
                let vad_model = model_root
                    .join("iic")
                    .join("speech_fsmn_vad_zh-cn-16k-common-pytorch")
                    .join("model.pt");
                plausible_torch_model(&sensevoice_model) && plausible_torch_model(&vad_model)
            }),
        SENSEVOICE_SMALL_ONNX_MODEL => {
            let model_root = model_dir.join("models").join("iic");
            model_root
                .join("SenseVoiceSmall-onnx")
                .join("model_quant.onnx")
                .is_file()
                && model_root
                    .join("speech_fsmn_vad_zh-cn-16k-common-onnx")
                    .join("model_quant.onnx")
                    .is_file()
                && model_root
                    .join("SenseVoiceSmall-onnx")
                    .join(SENSEVOICE_BPE_FILE_NAME)
                    .is_file()
        }
        _ => false,
    }
}

#[tauri::command]
pub(crate) fn get_asr_model_status(
    app: AppHandle,
    diagnostic_state: State<'_, Arc<DiagnosticModelState>>,
    asr_model: String,
) -> Result<AsrModelStatusView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let asr_model = validate_asr_model(asr_model)?;
    let snapshot = diagnostic_model_snapshot_for(&paths, &asr_model);
    diagnostic_state.update(snapshot);
    let config_values = parse_dotenv_values(&env_path(&paths))?;
    let available = snapshot.cache_status == DiagnosticCacheStatus::Ready;
    Ok(AsrModelStatusView {
        user_data_dir: path_to_env_string(&paths.user_data_dir),
        default_output_dir: path_to_env_string(paths.user_data_dir.join("outputs")),
        asr_model_dir: path_to_env_string(asr_model_display_dir(&paths, &asr_model)),
        asr_model_available: available,
        asr_model_source: if asr_model == SENSEVOICE_SMALL_ONNX_MODEL {
            "modelscope".to_string()
        } else {
            asr_model_source(&config_values)
        },
        asr_model,
    })
}

#[tauri::command]
pub(crate) async fn download_asr_model(
    window: Window,
    app: AppHandle,
    process_supervisors: State<'_, Arc<ProcessSupervisors>>,
    diagnostic_state: State<'_, Arc<DiagnosticModelState>>,
    asr_model: String,
) -> Result<AsrModelDownloadResult, String> {
    let process_supervisors = Arc::clone(process_supervisors.inner());
    let diagnostic_state = Arc::clone(diagnostic_state.inner());
    run_blocking_worker_command(move || {
        download_asr_model_blocking(
            window,
            app,
            process_supervisors,
            diagnostic_state,
            asr_model.clone(),
        )
    })
    .await
}

fn download_asr_model_blocking(
    window: Window,
    app: AppHandle,
    process_supervisors: Arc<ProcessSupervisors>,
    diagnostic_state: Arc<DiagnosticModelState>,
    asr_model: String,
) -> Result<AsrModelDownloadResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let asr_model = validate_asr_model(asr_model)?;
    let initial_snapshot = diagnostic_model_snapshot_for(&paths, &asr_model);
    diagnostic_state.update(initial_snapshot);
    if initial_snapshot.cache_status == DiagnosticCacheStatus::Ready {
        return Ok(AsrModelDownloadResult {
            started: false,
            status: "already_available".to_string(),
        });
    }

    let config_values = parse_dotenv_values(&env_path(&paths))?;
    let job = if asr_model == DEFAULT_ASR_MODEL {
        AsrModelDownloadJob::new(
            asr_model.clone(),
            configured_env_value(&config_values, ASR_MODEL_DOWNLOAD_URL_ENV),
            configured_env_value(&config_values, ASR_MODEL_DOWNLOAD_SHA256_ENV),
            configured_env_value(&config_values, MODELSCOPE_ENDPOINT_ENV),
            configured_env_value(&config_values, SENSEVOICE_REVISION_ENV),
        )
    } else {
        // ONNX artifacts are intentionally fixed to official ModelScope sources.
        AsrModelDownloadJob::new(asr_model.clone(), None, None, None, None)
    };
    let run_result = process_supervisors.run_asr_model_download(&paths, job, window.clone())?;
    match map_model_download_run_result(run_result)? {
        ModelDownloadRunResult::Completed => {
            diagnostic_state.update(diagnostic_model_snapshot_for(&paths, &asr_model));
            Ok(AsrModelDownloadResult {
                started: true,
                status: "completed".to_string(),
            })
        }
        ModelDownloadRunResult::Cancelled => {
            diagnostic_state.update(diagnostic_model_snapshot_for(&paths, &asr_model));
            let _ = window.emit(
                ASR_MODEL_DOWNLOAD_EVENT_NAME,
                cancelled_model_download_event(),
            );
            Ok(AsrModelDownloadResult {
                started: false,
                status: "cancelled".to_string(),
            })
        }
    }
}

fn validate_asr_model(asr_model: String) -> Result<String, String> {
    if SUPPORTED_ASR_MODELS.contains(&asr_model.as_str()) {
        Ok(asr_model)
    } else {
        Err("ASR_MODEL_UNSUPPORTED".to_string())
    }
}

#[derive(Debug, Eq, PartialEq)]
enum ModelDownloadRunResult {
    Completed,
    Cancelled,
}

fn map_model_download_run_result(
    result: Result<WorkerRunOutcome, WorkerRunError>,
) -> Result<ModelDownloadRunResult, String> {
    match result {
        Ok(WorkerRunOutcome::Structured(ValidatedWorkerResult::ModelDownload(
            ModelDownloadTerminalResult::Completed { .. },
        ))) => Ok(ModelDownloadRunResult::Completed),
        Ok(WorkerRunOutcome::Structured(ValidatedWorkerResult::ModelDownload(
            ModelDownloadTerminalResult::Failed { message, .. },
        ))) => Err(message),
        Ok(WorkerRunOutcome::Structured(_)) => Err(WORKER_PROTOCOL_MESSAGE.to_string()),
        Ok(WorkerRunOutcome::Cancelled) => Ok(ModelDownloadRunResult::Cancelled),
        Ok(WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Idle)) => {
            Err("ASR_MODEL_DOWNLOAD_IDLE_TIMEOUT".to_string())
        }
        Ok(WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Absolute)) => {
            Err("ASR_MODEL_DOWNLOAD_EXECUTION_TIMEOUT".to_string())
        }
        Ok(WorkerRunOutcome::UnstructuredFailure(_)) => {
            Err("ASR model download failed before returning a structured result.".to_string())
        }
        Err(error) => Err(match error.kind {
            WorkerRunErrorKind::AlreadyRunning => "Another ASR model download is already running.",
            WorkerRunErrorKind::SpawnFailed | WorkerRunErrorKind::RequestDeliveryFailed => {
                "ASR model download request could not be delivered."
            }
            WorkerRunErrorKind::RuntimeUnavailable => "ASR_MODEL_RUNTIME_MISSING",
            WorkerRunErrorKind::WatchdogStartFailed => "Worker watchdog failed to start.",
            WorkerRunErrorKind::PipeUnavailable | WorkerRunErrorKind::WaitFailed => {
                "ASR model download runtime failed."
            }
            WorkerRunErrorKind::ProtocolViolation => WORKER_PROTOCOL_MESSAGE,
        }
        .to_string()),
    }
}

#[tauri::command]
pub(crate) fn cancel_asr_model_download(
    process_supervisors: State<'_, Arc<ProcessSupervisors>>,
) -> Result<CancelProcessResult, String> {
    Ok(process_supervisors.cancel_asr_model_download())
}

#[cfg(test)]
mod tests {
    use super::{
        asr_model_available, asr_model_display_dir, cancelled_model_download_event,
        diagnostic_model_snapshot_for, map_model_download_run_result, DiagnosticCacheStatus,
        ModelDownloadRunResult, SupportedDiagnosticModel, DEFAULT_ASR_MODEL,
        SENSEVOICE_SMALL_ONNX_MODEL,
    };
    use crate::settings::supported_asr_models;
    use crate::worker_runtime::{
        ModelDownloadTerminalResult, ValidatedWorkerResult, WorkerExitSummary, WorkerRunError,
        WorkerRunErrorKind, WorkerRunOutcome, WorkerTimeoutKind, WORKER_PROTOCOL_MESSAGE,
    };
    use crate::RuntimePaths;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn release_supported_asr_models_exposes_pytorch_and_onnx_sensevoice() {
        assert_eq!(
            supported_asr_models(),
            vec![
                "iic/SenseVoiceSmall".to_string(),
                "iic/SenseVoiceSmall-onnx".to_string(),
            ]
        );
    }

    #[test]
    fn asr_model_display_directory_points_to_selected_runtime_leaf() {
        let paths = RuntimePaths {
            resource_dir: PathBuf::from("resources"),
            user_data_dir: PathBuf::from("app-data"),
        };

        assert_eq!(
            asr_model_display_dir(&paths, DEFAULT_ASR_MODEL),
            paths
                .user_data_dir
                .join("models")
                .join("models")
                .join("iic")
                .join("SenseVoiceSmall")
        );
        assert_eq!(
            asr_model_display_dir(&paths, SENSEVOICE_SMALL_ONNX_MODEL),
            paths
                .user_data_dir
                .join("models")
                .join("onnx")
                .join("models")
                .join("iic")
                .join("SenseVoiceSmall-onnx")
        );
    }

    #[test]
    fn synthesized_model_cancellation_uses_structured_contract_event() {
        let payload = cancelled_model_download_event();

        assert_eq!(payload["status"], "cancelled");
        assert_eq!(payload["progress"], 0);
        assert_eq!(payload["message_code"], "model.download.cancelled");
        assert!(payload.get("message").is_none());
        assert!(payload.get("current_file").is_none());
    }

    #[test]
    fn typed_runner_outcomes_preserve_model_download_product_mapping() {
        assert_eq!(
            map_model_download_run_result(Ok(WorkerRunOutcome::Structured(
                ValidatedWorkerResult::ModelDownload(ModelDownloadTerminalResult::Completed {
                    model: "iic/SenseVoiceSmall".to_string(),
                }),
            ))),
            Ok(ModelDownloadRunResult::Completed)
        );
        assert_eq!(
            map_model_download_run_result(Ok(WorkerRunOutcome::Structured(
                ValidatedWorkerResult::ModelDownload(ModelDownloadTerminalResult::Failed {
                    code: "MODEL_DOWNLOAD_FAILED".to_string(),
                    message: "ASR model download failed.".to_string(),
                }),
            ))),
            Err("ASR model download failed.".to_string())
        );
        assert_eq!(
            map_model_download_run_result(Ok(WorkerRunOutcome::Cancelled)),
            Ok(ModelDownloadRunResult::Cancelled)
        );
        assert_eq!(
            map_model_download_run_result(Ok(WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Idle,))),
            Err("ASR_MODEL_DOWNLOAD_IDLE_TIMEOUT".to_string())
        );
        assert_eq!(
            map_model_download_run_result(Ok(WorkerRunOutcome::TimedOut(
                WorkerTimeoutKind::Absolute,
            ))),
            Err("ASR_MODEL_DOWNLOAD_EXECUTION_TIMEOUT".to_string())
        );
        assert_eq!(
            map_model_download_run_result(Ok(WorkerRunOutcome::UnstructuredFailure(
                WorkerExitSummary {
                    exit_code: Some(1),
                    stderr: "present",
                },
            ))),
            Err("ASR model download failed before returning a structured result.".to_string())
        );
        assert_eq!(
            map_model_download_run_result(Err(WorkerRunError {
                kind: WorkerRunErrorKind::AlreadyRunning,
                detail: "unused",
            })),
            Err("Another ASR model download is already running.".to_string())
        );
    }

    #[test]
    fn model_download_runtime_errors_use_closed_safe_messages() {
        for (kind, expected) in [
            (
                WorkerRunErrorKind::SpawnFailed,
                "ASR model download request could not be delivered.",
            ),
            (
                WorkerRunErrorKind::RequestDeliveryFailed,
                "ASR model download request could not be delivered.",
            ),
            (
                WorkerRunErrorKind::WatchdogStartFailed,
                "Worker watchdog failed to start.",
            ),
            (
                WorkerRunErrorKind::PipeUnavailable,
                "ASR model download runtime failed.",
            ),
            (
                WorkerRunErrorKind::WaitFailed,
                "ASR model download runtime failed.",
            ),
            (
                WorkerRunErrorKind::RuntimeUnavailable,
                "ASR_MODEL_RUNTIME_MISSING",
            ),
            (
                WorkerRunErrorKind::ProtocolViolation,
                WORKER_PROTOCOL_MESSAGE,
            ),
        ] {
            let result = map_model_download_run_result(Err(WorkerRunError {
                kind,
                detail: "review-secret https://secret.example/private",
            }))
            .expect_err("runtime failure remains an error");

            assert_eq!(result, expected);
            assert!(!result.contains("review-secret"));
            assert!(!result.contains("https://"));
        }
    }

    #[test]
    fn asr_model_availability_requires_marker_and_model_files() {
        let root = temp_dir("asr_model_availability_requires_marker_and_model_files");
        let paths = RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("app-data"),
        };
        let model_root = paths.user_data_dir.join("models");
        fs::create_dir_all(&model_root).expect("create user model dir");

        assert!(!asr_model_available(&paths, DEFAULT_ASR_MODEL));

        fs::write(
            model_root.join("MODEL_VERSION.txt"),
            "model=iic/SenseVoiceSmall\nvad=iic/speech_fsmn_vad_zh-cn-16k-common-pytorch\n",
        )
        .expect("write model marker");

        assert!(!asr_model_available(&paths, DEFAULT_ASR_MODEL));

        let sensevoice_dir = model_root
            .join("models")
            .join("iic")
            .join("SenseVoiceSmall");
        let vad_dir = model_root
            .join("models")
            .join("iic")
            .join("speech_fsmn_vad_zh-cn-16k-common-pytorch");
        fs::create_dir_all(&sensevoice_dir).expect("create sensevoice dir");
        fs::create_dir_all(&vad_dir).expect("create vad dir");
        fs::write(sensevoice_dir.join("model.pt"), b"PK\x03\x04sensevoice")
            .expect("write sensevoice model");
        fs::write(vad_dir.join("model.pt"), b"PK\x03\x04vad").expect("write vad model");

        assert!(asr_model_available(&paths, DEFAULT_ASR_MODEL));
    }

    #[test]
    fn diagnostic_snapshot_is_path_free_and_distinguishes_cache_states() {
        let root = temp_dir("diagnostic_snapshot_cache_states");
        let paths = RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("app-data"),
        };

        let missing = diagnostic_model_snapshot_for(&paths, DEFAULT_ASR_MODEL);
        assert_eq!(missing.model, SupportedDiagnosticModel::SenseVoiceSmall);
        assert_eq!(missing.cache_status, DiagnosticCacheStatus::Missing);

        let model_root = paths.user_data_dir.join("models");
        fs::create_dir_all(&model_root).expect("model root");
        fs::write(
            model_root.join("MODEL_VERSION.txt"),
            "model=iic/SenseVoiceSmall\nvad=iic/speech_fsmn_vad_zh-cn-16k-common-pytorch\n",
        )
        .expect("marker");
        assert_eq!(
            diagnostic_model_snapshot_for(&paths, DEFAULT_ASR_MODEL).cache_status,
            DiagnosticCacheStatus::Invalid
        );

        let serialized =
            serde_json::to_value(diagnostic_model_snapshot_for(&paths, DEFAULT_ASR_MODEL))
                .expect("serialize snapshot");
        assert_eq!(serialized["model"], DEFAULT_ASR_MODEL);
        assert_eq!(serialized["cache_status"], "invalid");
        let rendered = serialized.to_string();
        assert!(!rendered.contains(root.to_string_lossy().as_ref()));
        assert_eq!(serialized.as_object().expect("object").len(), 2);
    }

    #[test]
    fn diagnostic_snapshot_maps_unsupported_configuration_to_closed_unknown() {
        let root = temp_dir("diagnostic_snapshot_unknown");
        let paths = RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("app-data"),
        };
        fs::create_dir_all(&paths.user_data_dir).expect("app data");
        fs::write(
            paths.user_data_dir.join(".env"),
            "FRAMEQ_ASR_MODEL=private/vendor-model\n",
        )
        .expect("settings");

        let snapshot = diagnostic_model_snapshot_for(&paths, "private/vendor-model");
        assert_eq!(snapshot.model, SupportedDiagnosticModel::SenseVoiceSmall);
        assert_eq!(snapshot.cache_status, DiagnosticCacheStatus::Unknown);
        assert!(!serde_json::to_string(&snapshot)
            .expect("serialize")
            .contains("private"));

        fs::write(
            paths.user_data_dir.join(".env"),
            format!("FRAMEQ_ASR_MODEL={SENSEVOICE_SMALL_ONNX_MODEL}\n"),
        )
        .expect("onnx settings");
        let onnx = diagnostic_model_snapshot_for(&paths, SENSEVOICE_SMALL_ONNX_MODEL);
        assert_eq!(onnx.model, SupportedDiagnosticModel::SenseVoiceSmallOnnx);
        assert_eq!(onnx.cache_status, DiagnosticCacheStatus::Missing);
        assert_eq!(
            serde_json::to_value(onnx).expect("serialize onnx")["model"],
            SENSEVOICE_SMALL_ONNX_MODEL
        );
    }

    #[test]
    fn managed_diagnostic_snapshot_defaults_unknown_and_clones_only_closed_values() {
        let state = super::DiagnosticModelState::default();
        assert_eq!(
            state.snapshot(),
            super::DiagnosticModelSnapshot {
                model: SupportedDiagnosticModel::SenseVoiceSmall,
                cache_status: DiagnosticCacheStatus::Unknown,
            }
        );
        state.update(super::DiagnosticModelSnapshot {
            model: SupportedDiagnosticModel::SenseVoiceSmallOnnx,
            cache_status: DiagnosticCacheStatus::Ready,
        });
        assert_eq!(
            state.snapshot(),
            super::DiagnosticModelSnapshot {
                model: SupportedDiagnosticModel::SenseVoiceSmallOnnx,
                cache_status: DiagnosticCacheStatus::Ready,
            }
        );
        assert_eq!(
            serde_json::to_string(&state.snapshot()).expect("serialize"),
            "{\"model\":\"iic/SenseVoiceSmall-onnx\",\"cache_status\":\"ready\"}"
        );
    }

    #[test]
    fn asr_model_availability_accepts_modelscope_snapshot_layout() {
        let root = temp_dir("asr_model_availability_accepts_modelscope_snapshot_layout");
        let paths = RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("app-data"),
        };
        let model_root = paths.user_data_dir.join("models");
        fs::write(
            create_parent(model_root.join("MODEL_VERSION.txt")),
            "model=iic/SenseVoiceSmall\nvad=iic/speech_fsmn_vad_zh-cn-16k-common-pytorch\n",
        )
        .expect("write model marker");

        let sensevoice_dir = model_root.join("iic").join("SenseVoiceSmall");
        let vad_dir = model_root
            .join("iic")
            .join("speech_fsmn_vad_zh-cn-16k-common-pytorch");
        fs::create_dir_all(&sensevoice_dir).expect("create sensevoice dir");
        fs::create_dir_all(&vad_dir).expect("create vad dir");
        fs::write(sensevoice_dir.join("model.pt"), b"PK\x03\x04sensevoice")
            .expect("write sensevoice model");
        fs::write(vad_dir.join("model.pt"), b"PK\x03\x04vad").expect("write vad model");

        assert!(asr_model_available(&paths, DEFAULT_ASR_MODEL));
    }

    #[test]
    fn asr_model_availability_ignores_resource_model_marker() {
        let root = temp_dir("asr_model_availability_ignores_resource_model_marker");
        let paths = RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("app-data"),
        };
        fs::create_dir_all(paths.resource_dir.join("models")).expect("create resource model dir");
        fs::write(
            paths.resource_dir.join("models").join("MODEL_VERSION.txt"),
            "model=iic/SenseVoiceSmall\n",
        )
        .expect("write model marker");

        assert!(!asr_model_available(&paths, DEFAULT_ASR_MODEL));
    }

    #[test]
    fn onnx_availability_requires_its_quantized_asr_vad_and_bpe_files() {
        let root = temp_dir("onnx_availability_requires_its_quantized_asr_vad_and_bpe_files");
        let paths = RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("app-data"),
        };
        let model_root = paths.user_data_dir.join("models").join("onnx");
        fs::create_dir_all(&model_root).expect("create ONNX model root");
        fs::write(
            model_root.join("MODEL_VERSION.txt"),
            "model=iic/SenseVoiceSmall-onnx\nvad=iic/speech_fsmn_vad_zh-cn-16k-common-onnx\n",
        )
        .expect("write ONNX marker");

        assert!(!asr_model_available(&paths, SENSEVOICE_SMALL_ONNX_MODEL));

        let asr_dir = model_root
            .join("models")
            .join("iic")
            .join("SenseVoiceSmall-onnx");
        let vad_dir = model_root
            .join("models")
            .join("iic")
            .join("speech_fsmn_vad_zh-cn-16k-common-onnx");
        let bpe_dir = model_root
            .join("models")
            .join("iic")
            .join("SenseVoiceSmall-onnx");
        fs::create_dir_all(&asr_dir).expect("create ONNX ASR dir");
        fs::create_dir_all(&vad_dir).expect("create ONNX VAD dir");
        fs::create_dir_all(&bpe_dir).expect("create ONNX BPE dir");
        fs::write(asr_dir.join("model_quant.onnx"), "asr").expect("write ONNX ASR");
        fs::write(vad_dir.join("model_quant.onnx"), "vad").expect("write ONNX VAD");
        fs::write(bpe_dir.join("chn_jpn_yue_eng_ko_spectok.bpe.model"), "bpe")
            .expect("write ONNX BPE");

        assert!(asr_model_available(&paths, SENSEVOICE_SMALL_ONNX_MODEL));
    }

    fn create_parent(path: PathBuf) -> PathBuf {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        path
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
