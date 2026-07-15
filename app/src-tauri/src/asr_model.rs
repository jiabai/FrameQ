use crate::progress_event::{
    cancelled_model_download_event, invalid_progress_log_detail, validate_model_download_event,
};
use crate::settings::{
    asr_model_source, configured_env_value, env_path, legacy_local_llm_env_removals,
    parse_dotenv_values, ASR_MODEL_DOWNLOAD_SHA256_ENV, ASR_MODEL_DOWNLOAD_URL_ENV,
    MODELSCOPE_ENDPOINT_ENV, SENSEVOICE_REVISION_ENV,
};
use crate::{
    append_desktop_log, bundled_python_path, ensure_runtime_dirs, parse_worker_stdout,
    path_to_env_string, prepend_to_path, resolve_runtime_paths, run_blocking_worker_command,
    spawn_worker_command, summarize_worker_result_for_log, terminate_process_tree,
    worker_command_log_detail, worker_exit_log_detail, CancelProcessResult, ProcessPhase,
    ProcessSupervisors, RuntimePaths, WorkerCommandSpec, MODEL_DIR_ENV, RESOURCE_DIR_ENV,
    USER_DATA_DIR_ENV,
};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State, Window};

pub(crate) const ASR_MODEL_DOWNLOAD_EVENT_NAME: &str = "asr-model-download-progress";
pub(crate) const MODEL_DOWNLOAD_EVENT_PREFIX: &str = "FRAMEQ_MODEL_DOWNLOAD ";
const MODEL_VERSION_FILE_NAME: &str = "MODEL_VERSION.txt";
pub(crate) const DEFAULT_ASR_MODEL: &str = "iic/SenseVoiceSmall";
const SENSEVOICE_VAD_MODEL: &str = "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch";
pub(crate) const SUPPORTED_ASR_MODELS: &[&str] = &[DEFAULT_ASR_MODEL];

#[derive(Debug, Serialize)]
pub(crate) struct FirstRunStatusView {
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

fn asr_model_dir(paths: &RuntimePaths) -> PathBuf {
    paths.user_data_dir.join("models")
}

fn asr_model_available(paths: &RuntimePaths) -> bool {
    model_marker_exists(&asr_model_dir(paths))
}

fn model_marker_exists(model_dir: &Path) -> bool {
    let marker = model_dir.join(MODEL_VERSION_FILE_NAME);
    marker.is_file()
        && required_model_files_exist(model_dir)
        && fs::read_to_string(marker)
            .map(|content| {
                content.contains(DEFAULT_ASR_MODEL) && content.contains(SENSEVOICE_VAD_MODEL)
            })
            .unwrap_or(false)
}

fn required_model_files_exist(model_dir: &Path) -> bool {
    [model_dir.to_path_buf(), model_dir.join("models")]
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
            sensevoice_model.is_file() && vad_model.is_file()
        })
}

fn build_model_download_command_spec(
    paths: &RuntimePaths,
    config_values: &HashMap<String, String>,
) -> Result<WorkerCommandSpec, String> {
    let resource_bin_dir = paths.resource_dir.join("bin");
    let path_value = prepend_to_path(&resource_bin_dir)?;
    let mut env = vec![
        (
            "PYTHONPATH".to_string(),
            path_to_env_string(paths.resource_dir.join("worker")),
        ),
        ("PYTHONUTF8".to_string(), "1".to_string()),
        ("PYTHONIOENCODING".to_string(), "utf-8".to_string()),
        ("PATH".to_string(), path_value),
        (
            MODEL_DIR_ENV.to_string(),
            path_to_env_string(asr_model_dir(paths)),
        ),
        (
            RESOURCE_DIR_ENV.to_string(),
            path_to_env_string(&paths.resource_dir),
        ),
        (
            USER_DATA_DIR_ENV.to_string(),
            path_to_env_string(&paths.user_data_dir),
        ),
    ];

    for key in [
        ASR_MODEL_DOWNLOAD_URL_ENV,
        ASR_MODEL_DOWNLOAD_SHA256_ENV,
        MODELSCOPE_ENDPOINT_ENV,
        SENSEVOICE_REVISION_ENV,
    ] {
        if let Some(value) = configured_env_value(config_values, key) {
            env.push((key.to_string(), value));
        }
    }

    Ok(WorkerCommandSpec {
        program: bundled_python_path(&paths.resource_dir),
        args: vec![
            "-m".to_string(),
            "frameq_worker".to_string(),
            "--download-asr-model".to_string(),
        ],
        stdin_payload: None,
        env,
        env_remove: legacy_local_llm_env_removals(),
        current_dir: paths.user_data_dir.clone(),
    })
}

#[tauri::command]
pub(crate) fn check_first_run(app: AppHandle) -> Result<FirstRunStatusView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let config_values = parse_dotenv_values(&env_path(&paths))?;
    Ok(FirstRunStatusView {
        user_data_dir: path_to_env_string(&paths.user_data_dir),
        default_output_dir: path_to_env_string(paths.user_data_dir.join("outputs")),
        asr_model: DEFAULT_ASR_MODEL.to_string(),
        asr_model_dir: path_to_env_string(asr_model_dir(&paths)),
        asr_model_available: asr_model_available(&paths),
        asr_model_source: asr_model_source(&config_values),
    })
}

#[tauri::command]
pub(crate) async fn download_asr_model(
    window: Window,
    app: AppHandle,
    process_supervisors: State<'_, Arc<ProcessSupervisors>>,
) -> Result<AsrModelDownloadResult, String> {
    let process_supervisors = Arc::clone(process_supervisors.inner());
    run_blocking_worker_command(move || {
        download_asr_model_blocking(window, app, process_supervisors)
    })
    .await
}

fn download_asr_model_blocking(
    window: Window,
    app: AppHandle,
    process_supervisors: Arc<ProcessSupervisors>,
) -> Result<AsrModelDownloadResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    if asr_model_available(&paths) {
        return Ok(AsrModelDownloadResult {
            started: false,
            status: "already_available".to_string(),
        });
    }

    let config_values = parse_dotenv_values(&env_path(&paths))?;
    let spec = build_model_download_command_spec(&paths, &config_values)?;
    let _ = append_desktop_log(
        &paths,
        "worker.download_asr_model.start",
        &worker_command_log_detail(&spec, "download_asr_model"),
    );
    let mut child = spawn_worker_command(spec)?;
    let download_pid = child.id();
    let Some(download_instance) = process_supervisors.asr_model_download.start(download_pid) else {
        let _ = terminate_process_tree(download_pid);
        return Err("Another ASR model download is already running.".to_string());
    };

    let Some(stderr) = child.stderr.take() else {
        process_supervisors
            .asr_model_download
            .finish(download_instance.instance_id);
        let _ = terminate_process_tree(download_pid);
        return Err("Could not capture ASR model download stderr.".to_string());
    };
    let progress_window = window.clone();
    let progress_paths = paths.clone();
    let stderr_reader = std::thread::spawn(move || {
        let mut diagnostic_lines = Vec::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(raw_event) = line.strip_prefix(MODEL_DOWNLOAD_EVENT_PREFIX) {
                let parsed = serde_json::from_str::<serde_json::Value>(raw_event).ok();
                if let Some(payload) = parsed
                    .as_ref()
                    .and_then(|payload| validate_model_download_event(payload).ok())
                {
                    let _ = progress_window.emit(ASR_MODEL_DOWNLOAD_EVENT_NAME, payload);
                } else {
                    let detail = parsed
                        .as_ref()
                        .map(invalid_progress_log_detail)
                        .unwrap_or_else(|| "message_code=invalid".to_string());
                    let _ = append_desktop_log(
                        &progress_paths,
                        "worker.model_progress.invalid",
                        &detail,
                    );
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
            process_supervisors
                .asr_model_download
                .finish(download_instance.instance_id);
            return Err(error.to_string());
        }
    };
    let terminal_phase = process_supervisors
        .asr_model_download
        .finish(download_instance.instance_id);
    let stderr = stderr_reader
        .join()
        .unwrap_or_else(|_| "ASR model download stderr reader failed.".to_string());
    let _ = append_desktop_log(
        &paths,
        "worker.download_asr_model.exit",
        &worker_exit_log_detail(download_pid, &output, &stderr),
    );

    if output.status.success()
        && parse_worker_stdout(&output.stdout)
            .ok()
            .and_then(|value| {
                value
                    .get("status")
                    .and_then(|status| status.as_str())
                    .map(str::to_string)
            })
            .is_some_and(|status| status == "completed")
    {
        let result = parse_worker_stdout(&output.stdout)?;
        let _ = append_desktop_log(
            &paths,
            "worker.download_asr_model.result",
            &summarize_worker_result_for_log(&result),
        );
        return Ok(AsrModelDownloadResult {
            started: true,
            status: "completed".to_string(),
        });
    }

    if terminal_phase == Some(ProcessPhase::Cancelling) {
        let _ = append_desktop_log(
            &paths,
            "worker.download_asr_model.cancelled",
            &format!("pid={download_pid}"),
        );
        let _ = window.emit(
            ASR_MODEL_DOWNLOAD_EVENT_NAME,
            cancelled_model_download_event(),
        );
        return Ok(AsrModelDownloadResult {
            started: false,
            status: "cancelled".to_string(),
        });
    }

    if !output.status.success() {
        let detail = parse_worker_stdout(&output.stdout)
            .ok()
            .and_then(|value| {
                value
                    .get("message")
                    .and_then(|message| message.as_str())
                    .map(|message| message.to_string())
            })
            .filter(|message| !message.trim().is_empty())
            .unwrap_or(stderr);
        return Err(detail);
    }

    let result = parse_worker_stdout(&output.stdout)?;
    let _ = append_desktop_log(
        &paths,
        "worker.download_asr_model.result",
        &summarize_worker_result_for_log(&result),
    );
    if result
        .get("status")
        .and_then(|status| status.as_str())
        .is_some_and(|status| status == "completed")
    {
        return Ok(AsrModelDownloadResult {
            started: true,
            status: "completed".to_string(),
        });
    }

    Err(result
        .get("message")
        .and_then(|message| message.as_str())
        .unwrap_or("ASR model download did not complete.")
        .to_string())
}

#[tauri::command]
pub(crate) fn cancel_asr_model_download(
    process_supervisors: State<'_, Arc<ProcessSupervisors>>,
) -> Result<CancelProcessResult, String> {
    Ok(crate::request_process_cancellation(
        &process_supervisors.asr_model_download,
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        asr_model_available, build_model_download_command_spec, cancelled_model_download_event,
    };
    use crate::settings::supported_asr_models;
    use crate::{bundled_python_path, path_to_env_string, RuntimePaths, WorkerCommandSpec};
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn command_test_paths() -> RuntimePaths {
        RuntimePaths {
            resource_dir: PathBuf::from("frameq-test").join("resources"),
            user_data_dir: PathBuf::from("frameq-test").join("user-data"),
        }
    }

    fn assert_removes_legacy_local_llm_env(spec: &WorkerCommandSpec) {
        for key in [
            "FRAMEQ_LLM_PROVIDER",
            "FRAMEQ_LLM_BASE_URL",
            "FRAMEQ_LLM_API_KEY",
            "FRAMEQ_LLM_MODEL",
            "FRAMEQ_LLM_TIMEOUT_SECONDS",
        ] {
            assert!(spec.env_remove.iter().any(|value| value == key));
        }
        for key in [
            "FRAMEQ_LLM_SOURCE",
            "FRAMEQ_LLM_CHECKOUT_URL",
            "FRAMEQ_LLM_SESSION_TOKEN",
            "FRAMEQ_LLM_CHECKOUT_REQUEST_ID",
        ] {
            assert!(!spec.env_remove.iter().any(|value| value == key));
        }
    }

    #[test]
    fn release_supported_asr_models_only_exposes_bundled_sensevoice() {
        assert_eq!(
            supported_asr_models(),
            vec!["iic/SenseVoiceSmall".to_string()]
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
    fn asr_model_availability_requires_marker_and_model_files() {
        let root = temp_dir("asr_model_availability_requires_marker_and_model_files");
        let paths = RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("app-data"),
        };
        let model_root = paths.user_data_dir.join("models");
        fs::create_dir_all(&model_root).expect("create user model dir");

        assert!(!asr_model_available(&paths));

        fs::write(
            model_root.join("MODEL_VERSION.txt"),
            "model=iic/SenseVoiceSmall\nvad=iic/speech_fsmn_vad_zh-cn-16k-common-pytorch\n",
        )
        .expect("write model marker");

        assert!(!asr_model_available(&paths));

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
        fs::write(sensevoice_dir.join("model.pt"), "sensevoice").expect("write sensevoice model");
        fs::write(vad_dir.join("model.pt"), "vad").expect("write vad model");

        assert!(asr_model_available(&paths));
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
        fs::write(sensevoice_dir.join("model.pt"), "sensevoice").expect("write sensevoice model");
        fs::write(vad_dir.join("model.pt"), "vad").expect("write vad model");

        assert!(asr_model_available(&paths));
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

        assert!(!asr_model_available(&paths));
    }

    #[test]
    fn model_download_command_spec_uses_bundled_python_and_user_model_dir() {
        let paths = command_test_paths();
        let spec = build_model_download_command_spec(
            &paths,
            &HashMap::from([
                (
                    "FRAMEQ_ASR_MODEL_DOWNLOAD_URL".to_string(),
                    "https://cdn.example/sensevoice.zip".to_string(),
                ),
                (
                    "FRAMEQ_ASR_MODEL_DOWNLOAD_SHA256".to_string(),
                    "abc123".to_string(),
                ),
            ]),
        )
        .expect("build download command spec");
        let env = spec.env_map();

        assert_eq!(spec.program, bundled_python_path(&paths.resource_dir));
        assert_eq!(
            spec.args,
            vec!["-m", "frameq_worker", "--download-asr-model"]
        );
        assert!(!spec.program.to_string_lossy().contains("uv"));
        assert!(!spec.args.iter().any(|arg| arg == "uv"));
        assert_eq!(
            env.get("FRAMEQ_MODEL_DIR"),
            Some(&path_to_env_string(paths.user_data_dir.join("models")))
        );
        assert_eq!(
            env.get("FRAMEQ_ASR_MODEL_DOWNLOAD_URL"),
            Some(&"https://cdn.example/sensevoice.zip".to_string())
        );
        assert_eq!(
            env.get("FRAMEQ_ASR_MODEL_DOWNLOAD_SHA256"),
            Some(&"abc123".to_string())
        );
        assert_removes_legacy_local_llm_env(&spec);
        assert_eq!(spec.current_dir, paths.user_data_dir);
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
