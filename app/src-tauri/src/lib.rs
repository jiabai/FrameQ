use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, Window};
use tauri_plugin_deep_link::DeepLinkExt;

mod account;
mod diagnostics;
mod history;
mod insight_preferences;
mod runtime;
mod settings;
mod task_manifest;
mod transcript_detail;
mod updates;
mod window_chrome;

pub(crate) use runtime::{
    bundled_python_path, ensure_runtime_dirs, path_to_env_string, prepend_to_path,
    resolve_runtime_paths, RuntimePaths, ALLOW_REAL_ASR_ENV, CACHE_DIR_ENV, CACHE_DIR_NAME,
    DESKTOP_LOG_DIR_NAME, MODELSCOPE_OFFLINE_ENV, MODEL_DIR_ENV, OUTPUT_DIR_ENV, RESOURCE_DIR_ENV,
    USER_DATA_DIR_ENV,
};

pub(crate) use diagnostics::{
    append_desktop_log, sanitize_diagnostic_text, summarize_worker_result_for_log, truncate_for_log,
};

use settings::{
    asr_model_source, configured_env_value, env_path, legacy_local_llm_env_removals,
    parse_dotenv_values, resolve_asr_model_value, ASR_MODEL_DOWNLOAD_SHA256_ENV,
    ASR_MODEL_DOWNLOAD_URL_ENV, ASR_MODEL_ENV, LLM_CHECKOUT_REQUEST_ID_ENV, LLM_CHECKOUT_URL_ENV,
    LLM_SESSION_TOKEN_ENV, LLM_SOURCE_ENV, MODELSCOPE_ENDPOINT_ENV, SENSEVOICE_REVISION_ENV,
};

const PROGRESS_EVENT_NAME: &str = "worker-progress";
const PROGRESS_EVENT_PREFIX: &str = "FRAMEQ_PROGRESS ";
const ASR_MODEL_DOWNLOAD_EVENT_NAME: &str = "asr-model-download-progress";
const MODEL_DOWNLOAD_EVENT_PREFIX: &str = "FRAMEQ_MODEL_DOWNLOAD ";
#[cfg(target_os = "windows")]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;
const MODEL_VERSION_FILE_NAME: &str = "MODEL_VERSION.txt";
const DEFAULT_ASR_MODEL: &str = "iic/SenseVoiceSmall";
const SENSEVOICE_VAD_MODEL: &str = "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch";
const SUPPORTED_ASR_MODELS: &[&str] = &[DEFAULT_ASR_MODEL];
#[derive(Debug, Deserialize, Serialize)]
struct ProcessVideoRequest {
    url: String,
    language: String,
    output_formats: Vec<String>,
    model: String,
    generate_insights: bool,
    insightflow_mode: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct RetryInsightsRequest {
    task_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    preference_snapshot: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct WorkerError {
    code: String,
    message: String,
    stage: String,
}

#[derive(Debug, Serialize)]
struct ProcessVideoResult {
    status: String,
    task_id: Option<String>,
    task_dir: Option<String>,
    artifacts: HashMap<String, String>,
    text: String,
    summary: String,
    insights: Vec<task_manifest::InsightView>,
    transcript: Option<task_manifest::TranscriptMetadata>,
    error: Option<WorkerError>,
}

#[derive(Debug, Serialize)]
struct CancelProcessResult {
    cancelled: bool,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct FirstRunStatusView {
    user_data_dir: String,
    default_output_dir: String,
    asr_model: String,
    asr_model_dir: String,
    asr_model_available: bool,
    asr_model_source: String,
}

#[derive(Debug, Serialize)]
struct AsrModelDownloadResult {
    started: bool,
}

#[derive(Debug, Clone)]
enum WorkerInvocation {
    ProcessVideo(String),
    RetryInsights(String),
}

#[derive(Debug, Clone)]
struct WorkerCommandSpec {
    program: PathBuf,
    args: Vec<String>,
    env: Vec<(String, String)>,
    env_remove: Vec<String>,
    current_dir: PathBuf,
}

impl WorkerCommandSpec {
    #[cfg(test)]
    fn env_map(&self) -> HashMap<String, String> {
        self.env.iter().cloned().collect()
    }
}

#[derive(Default)]
struct WorkerProcessState {
    current_pid: Mutex<Option<u32>>,
    cancelled_pid: Mutex<Option<u32>>,
}

impl WorkerProcessState {
    fn register(&self, pid: u32) -> bool {
        let mut current_pid = self.current_pid.lock().expect("worker state lock poisoned");
        if current_pid.is_some() {
            return false;
        }

        *current_pid = Some(pid);
        true
    }

    fn current_pid(&self) -> Option<u32> {
        *self.current_pid.lock().expect("worker state lock poisoned")
    }

    fn clear_current(&self, pid: u32) {
        let mut current_pid = self.current_pid.lock().expect("worker state lock poisoned");
        if *current_pid == Some(pid) {
            *current_pid = None;
        }
    }

    fn mark_cancelled(&self, pid: u32) {
        let mut cancelled_pid = self
            .cancelled_pid
            .lock()
            .expect("worker cancelled state lock poisoned");
        *cancelled_pid = Some(pid);
    }

    fn take_cancelled(&self, pid: u32) -> bool {
        let mut cancelled_pid = self
            .cancelled_pid
            .lock()
            .expect("worker cancelled state lock poisoned");
        if *cancelled_pid == Some(pid) {
            *cancelled_pid = None;
            return true;
        }

        false
    }
}

#[derive(Default)]
struct ModelDownloadProcessState {
    current_pid: Mutex<Option<u32>>,
    cancelled_pid: Mutex<Option<u32>>,
}

impl ModelDownloadProcessState {
    fn register(&self, pid: u32) -> bool {
        let mut current_pid = self
            .current_pid
            .lock()
            .expect("download state lock poisoned");
        if current_pid.is_some() {
            return false;
        }

        *current_pid = Some(pid);
        true
    }

    fn current_pid(&self) -> Option<u32> {
        *self
            .current_pid
            .lock()
            .expect("download state lock poisoned")
    }

    fn clear_current(&self, pid: u32) {
        let mut current_pid = self
            .current_pid
            .lock()
            .expect("download state lock poisoned");
        if *current_pid == Some(pid) {
            *current_pid = None;
        }
    }

    fn mark_cancelled(&self, pid: u32) {
        let mut cancelled_pid = self
            .cancelled_pid
            .lock()
            .expect("download cancelled state lock poisoned");
        *cancelled_pid = Some(pid);
    }

    fn take_cancelled(&self, pid: u32) -> bool {
        let mut cancelled_pid = self
            .cancelled_pid
            .lock()
            .expect("download cancelled state lock poisoned");
        if *cancelled_pid == Some(pid) {
            *cancelled_pid = None;
            return true;
        }

        false
    }
}

fn worker_command_log_detail(spec: &WorkerCommandSpec, kind: &str) -> String {
    let args = redact_worker_args_for_log(&spec.args).join(" ");
    format!(
        "kind={kind} program={} current_dir={} args={} {}",
        path_to_env_string(&spec.program),
        path_to_env_string(&spec.current_dir),
        args,
        js_runtime_diagnostics(spec)
    )
}

fn redact_worker_args_for_log(args: &[String]) -> Vec<String> {
    let mut redacted = Vec::with_capacity(args.len());
    let mut redact_next = false;

    for arg in args {
        if redact_next {
            redacted.push("[json-payload]".to_string());
            redact_next = false;
            continue;
        }

        redacted.push(arg.clone());
        if arg == "--request-json" || arg == "--retry-insights-json" {
            redact_next = true;
        }
    }

    redacted
}

fn worker_exit_log_detail(pid: u32, output: &Output, stderr: &str) -> String {
    format!(
        "pid={pid} exit={} stderr={}",
        output
            .status
            .code()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "signal".to_string()),
        truncate_for_log(&sanitize_diagnostic_text(stderr), 1000)
    )
}

fn js_runtime_diagnostics(spec: &WorkerCommandSpec) -> String {
    let path_value = spec
        .env
        .iter()
        .find_map(|(key, value)| (key == "PATH").then_some(value.as_str()))
        .unwrap_or_default();
    let runtimes = [
        (
            "deno",
            executable_available_on_path(path_value, &["deno", "deno.exe"]),
        ),
        (
            "node",
            executable_available_on_path(path_value, &["node", "node.exe"]),
        ),
        (
            "quickjs",
            executable_available_on_path(path_value, &["qjs", "qjs.exe"]),
        ),
        (
            "bun",
            executable_available_on_path(path_value, &["bun", "bun.exe"]),
        ),
    ];
    let summary = runtimes
        .iter()
        .map(|(name, available)| {
            format!(
                "{name}:{}",
                if *available { "available" } else { "missing" }
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("js_runtimes={summary}")
}

fn executable_available_on_path(path_value: &str, binary_names: &[&str]) -> bool {
    std::env::split_paths(path_value).any(|directory| {
        binary_names
            .iter()
            .any(|binary_name| directory.join(binary_name).is_file())
    })
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

fn build_worker_command_spec(
    paths: &RuntimePaths,
    invocation: WorkerInvocation,
    server_managed_llm: Option<account::ServerManagedLlmInvocation>,
) -> Result<WorkerCommandSpec, String> {
    let include_server_managed_llm = worker_invocation_uses_server_managed_llm(&invocation);
    let (flag, payload) = match invocation {
        WorkerInvocation::ProcessVideo(payload) => ("--request-json", payload),
        WorkerInvocation::RetryInsights(payload) => ("--retry-insights-json", payload),
    };
    let resource_bin_dir = paths.resource_dir.join("bin");
    let path_value = prepend_to_path(&resource_bin_dir)?;
    let output_root = task_manifest::configured_output_root(paths)?;

    let mut env = vec![
        (
            "PYTHONPATH".to_string(),
            path_to_env_string(paths.resource_dir.join("worker")),
        ),
        ("PYTHONUTF8".to_string(), "1".to_string()),
        ("PYTHONIOENCODING".to_string(), "utf-8".to_string()),
        ("PATH".to_string(), path_value),
        (OUTPUT_DIR_ENV.to_string(), path_to_env_string(output_root)),
        (
            CACHE_DIR_ENV.to_string(),
            path_to_env_string(paths.user_data_dir.join(CACHE_DIR_NAME)),
        ),
        (
            MODEL_DIR_ENV.to_string(),
            path_to_env_string(paths.user_data_dir.join("models")),
        ),
        (
            RESOURCE_DIR_ENV.to_string(),
            path_to_env_string(&paths.resource_dir),
        ),
        (
            USER_DATA_DIR_ENV.to_string(),
            path_to_env_string(&paths.user_data_dir),
        ),
        (ALLOW_REAL_ASR_ENV.to_string(), "1".to_string()),
        (MODELSCOPE_OFFLINE_ENV.to_string(), "1".to_string()),
    ];
    if include_server_managed_llm {
        if let Some(llm) = server_managed_llm {
            env.push((LLM_SOURCE_ENV.to_string(), "server".to_string()));
            env.push((
                LLM_CHECKOUT_URL_ENV.to_string(),
                format!(
                    "{}/api/desktop/llm/checkouts",
                    llm.server_base_url.trim_end_matches('/')
                ),
            ));
            env.push((LLM_SESSION_TOKEN_ENV.to_string(), llm.session_token));
            env.push((LLM_CHECKOUT_REQUEST_ID_ENV.to_string(), llm.request_id));
        }
    }

    Ok(WorkerCommandSpec {
        program: bundled_python_path(&paths.resource_dir),
        args: vec![
            "-m".to_string(),
            "frameq_worker".to_string(),
            flag.to_string(),
            payload,
        ],
        env,
        env_remove: legacy_local_llm_env_removals(),
        current_dir: paths.user_data_dir.clone(),
    })
}

fn worker_invocation_uses_server_managed_llm(invocation: &WorkerInvocation) -> bool {
    match invocation {
        WorkerInvocation::RetryInsights(_) => true,
        WorkerInvocation::ProcessVideo(payload) => {
            process_video_request_generates_insights(payload)
        }
    }
}

fn process_video_request_generates_insights(payload: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| {
            value
                .get("generate_insights")
                .and_then(serde_json::Value::as_bool)
        })
        .unwrap_or(true)
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
        env,
        env_remove: legacy_local_llm_env_removals(),
        current_dir: paths.user_data_dir.clone(),
    })
}

#[cfg(target_os = "windows")]
fn windows_subprocess_creation_flags() -> u32 {
    WINDOWS_CREATE_NO_WINDOW
}

fn hide_child_console_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(windows_subprocess_creation_flags());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}

fn spawn_worker_command(spec: WorkerCommandSpec) -> Result<std::process::Child, String> {
    let mut command = Command::new(spec.program);
    hide_child_console_window(&mut command);
    for key in spec.env_remove {
        command.env_remove(key);
    }
    command
        .args(spec.args)
        .envs(spec.env)
        .current_dir(spec.current_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    command.spawn().map_err(|error| error.to_string())
}

#[tauri::command]
async fn process_video(
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
    let llm_invocation = account::server_managed_llm_invocation(&paths)?;
    let spec = build_worker_command_spec(
        &paths,
        WorkerInvocation::ProcessVideo(request_json),
        llm_invocation,
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
async fn retry_insights(
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

fn parse_worker_stdout(stdout: &[u8]) -> Result<serde_json::Value, String> {
    let text = String::from_utf8_lossy(stdout);
    let mut last_error = None;

    for raw_line in text.lines().rev() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(value) if value.get("status").is_some() => return Ok(value),
            Ok(_) => continue,
            Err(error) => last_error = Some(error.to_string()),
        }
    }

    let preview = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join("\n");
    let detail = last_error.unwrap_or_else(|| "stdout did not contain JSON".to_string());
    Err(format!(
        "Worker stdout did not contain a structured JSON result: {detail}. stdout preview: {preview}"
    ))
}

fn parse_worker_output_or_fallback(
    output: &Output,
    fallback: ProcessVideoResult,
) -> Result<serde_json::Value, String> {
    match parse_worker_stdout(&output.stdout) {
        Ok(value) => Ok(value),
        Err(error) if output.status.success() => Err(error),
        Err(_) => Ok(serde_json::json!(fallback)),
    }
}

#[tauri::command]
fn cancel_process(
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

#[tauri::command]
fn check_first_run(app: AppHandle) -> Result<FirstRunStatusView, String> {
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
async fn download_asr_model(
    window: Window,
    app: AppHandle,
    download_state: State<'_, Arc<ModelDownloadProcessState>>,
) -> Result<AsrModelDownloadResult, String> {
    let download_state = Arc::clone(download_state.inner());
    run_blocking_worker_command(move || download_asr_model_blocking(window, app, download_state))
        .await
}

fn download_asr_model_blocking(
    window: Window,
    app: AppHandle,
    download_state: Arc<ModelDownloadProcessState>,
) -> Result<AsrModelDownloadResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    if asr_model_available(&paths) {
        return Ok(AsrModelDownloadResult { started: false });
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
    if !download_state.register(download_pid) {
        let _ = terminate_process_tree(download_pid);
        return Err("Another ASR model download is already running.".to_string());
    }

    let Some(stderr) = child.stderr.take() else {
        download_state.clear_current(download_pid);
        let _ = terminate_process_tree(download_pid);
        return Err("Could not capture ASR model download stderr.".to_string());
    };
    let progress_window = window.clone();
    let stderr_reader = std::thread::spawn(move || {
        let mut diagnostic_lines = Vec::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(raw_event) = line.strip_prefix(MODEL_DOWNLOAD_EVENT_PREFIX) {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(raw_event) {
                    let _ = progress_window.emit(ASR_MODEL_DOWNLOAD_EVENT_NAME, payload);
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
            download_state.clear_current(download_pid);
            let _ = download_state.take_cancelled(download_pid);
            return Err(error.to_string());
        }
    };
    download_state.clear_current(download_pid);
    let was_cancelled = download_state.take_cancelled(download_pid);
    let stderr = stderr_reader
        .join()
        .unwrap_or_else(|_| "ASR model download stderr reader failed.".to_string());
    let _ = append_desktop_log(
        &paths,
        "worker.download_asr_model.exit",
        &worker_exit_log_detail(download_pid, &output, &stderr),
    );

    if was_cancelled {
        let _ = append_desktop_log(
            &paths,
            "worker.download_asr_model.cancelled",
            &format!("pid={download_pid}"),
        );
        let _ = window.emit(
            ASR_MODEL_DOWNLOAD_EVENT_NAME,
            serde_json::json!({
                "status": "cancelled",
                "message": "ASR model download was cancelled.",
                "progress": 0
            }),
        );
        return Ok(AsrModelDownloadResult { started: false });
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
        return Ok(AsrModelDownloadResult { started: true });
    }

    Err(result
        .get("message")
        .and_then(|message| message.as_str())
        .unwrap_or("ASR model download did not complete.")
        .to_string())
}

#[tauri::command]
fn cancel_asr_model_download(
    download_state: State<'_, Arc<ModelDownloadProcessState>>,
) -> Result<CancelProcessResult, String> {
    let Some(pid) = download_state.current_pid() else {
        return Ok(CancelProcessResult {
            cancelled: false,
            error: None,
        });
    };

    download_state.mark_cancelled(pid);
    match terminate_process_tree(pid) {
        Ok(()) => {
            download_state.clear_current(pid);
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

async fn run_blocking_worker_command<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Worker command task failed: {error}"))?
}

#[cfg(target_os = "windows")]
fn terminate_process_tree(pid: u32) -> Result<(), String> {
    let mut command = Command::new("taskkill");
    hide_child_console_window(&mut command);
    let output = command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err("taskkill failed to terminate the worker process.".to_string())
    } else {
        Err(stderr)
    }
}

#[cfg(not(target_os = "windows"))]
fn terminate_process_tree(pid: u32) -> Result<(), String> {
    let output = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

trait DeepLinkActivationWindow {
    fn unminimize_window(&self) -> Result<(), String>;
    fn show_window(&self) -> Result<(), String>;
    fn focus_window(&self) -> Result<(), String>;
    fn emit_deep_link_args(&self, argv: Vec<String>) -> Result<(), String>;
}

impl DeepLinkActivationWindow for WebviewWindow {
    fn unminimize_window(&self) -> Result<(), String> {
        self.unminimize().map_err(|error| error.to_string())
    }

    fn show_window(&self) -> Result<(), String> {
        self.show().map_err(|error| error.to_string())
    }

    fn focus_window(&self) -> Result<(), String> {
        self.set_focus().map_err(|error| error.to_string())
    }

    fn emit_deep_link_args(&self, argv: Vec<String>) -> Result<(), String> {
        self.emit("frameq-deep-link-args", argv)
            .map_err(|error| error.to_string())
    }
}

fn activate_main_window_for_deep_link<W: DeepLinkActivationWindow>(window: &W, argv: Vec<String>) {
    let _ = window.unminimize_window();
    let _ = window.show_window();
    let _ = window.focus_window();
    let _ = window.emit_deep_link_args(argv);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(WorkerProcessState::default()))
        .manage(Arc::new(ModelDownloadProcessState::default()))
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                activate_main_window_for_deep_link(&window, argv);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            if let Err(error) = app.deep_link().register_all() {
                eprintln!("[frameq] failed to register deep links: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            process_video,
            retry_insights,
            cancel_process,
            settings::get_llm_config,
            settings::save_llm_config,
            insight_preferences::get_insight_preferences,
            insight_preferences::save_inspiration_profile,
            insight_preferences::skip_inspiration_profile,
            insight_preferences::clear_inspiration_profile,
            insight_preferences::save_default_generation_preferences,
            history::get_history,
            transcript_detail::load_transcript_detail,
            transcript_detail::save_transcript_edit,
            updates::get_update_preferences,
            updates::save_update_preferences,
            updates::get_update_delivery,
            check_first_run,
            download_asr_model,
            cancel_asr_model_download,
            account::begin_auth_flow,
            account::complete_auth_flow,
            account::get_account_status,
            account::logout_account,
            account::redeem_activation_code,
            account::create_wechat_checkout,
            account::get_checkout_status,
            window_chrome::start_window_drag,
            window_chrome::close_window,
            window_chrome::minimize_window,
            window_chrome::toggle_maximize_window,
            window_chrome::get_window_position,
            window_chrome::set_window_position
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::account::{
        build_activation_redeem_url, build_auth_login_url, parse_auth_callback_url,
        server_base_url, AuthCallback, ServerManagedLlmInvocation,
    };
    use super::settings::{
        load_llm_config_from_file, save_llm_config_to_file, supported_asr_models, LlmConfigInput,
    };
    use super::{
        activate_main_window_for_deep_link, apply_configured_asr_model_to_request,
        asr_model_available, build_model_download_command_spec, build_worker_command_spec,
        cached_process_result_for_request, parse_worker_output_or_fallback, parse_worker_stdout,
        path_to_env_string, run_blocking_worker_command, DeepLinkActivationWindow,
        ProcessVideoRequest, ProcessVideoResult, RetryInsightsRequest, RuntimePaths,
        WorkerCommandSpec, WorkerError, WorkerInvocation, WorkerProcessState,
    };
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Output;
    use std::time::{SystemTime, UNIX_EPOCH};

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

    #[derive(Default)]
    struct FakeDeepLinkWindow {
        actions: RefCell<Vec<String>>,
    }

    impl FakeDeepLinkWindow {
        fn record(&self, action: &str) {
            self.actions.borrow_mut().push(action.to_string());
        }
    }

    impl DeepLinkActivationWindow for FakeDeepLinkWindow {
        fn unminimize_window(&self) -> Result<(), String> {
            self.record("unminimize");
            Ok(())
        }

        fn show_window(&self) -> Result<(), String> {
            self.record("show");
            Ok(())
        }

        fn focus_window(&self) -> Result<(), String> {
            self.record("focus");
            Ok(())
        }

        fn emit_deep_link_args(&self, argv: Vec<String>) -> Result<(), String> {
            self.record(&format!("emit:{}", argv.join("|")));
            Ok(())
        }
    }

    #[test]
    fn deep_link_activation_brings_existing_main_window_forward() {
        let window = FakeDeepLinkWindow::default();

        activate_main_window_for_deep_link(
            &window,
            vec!["frameq://auth/callback?ticket=flt_abc&state=state-1".to_string()],
        );

        assert_eq!(
            window.actions.into_inner(),
            vec![
                "unminimize",
                "show",
                "focus",
                "emit:frameq://auth/callback?ticket=flt_abc&state=state-1",
            ]
        );
    }

    #[test]
    fn worker_process_state_tracks_only_one_running_process() {
        let state = WorkerProcessState::default();

        assert!(state.register(10));
        assert_eq!(state.current_pid(), Some(10));
        assert!(!state.register(11));
        assert_eq!(state.current_pid(), Some(10));
    }

    #[test]
    fn worker_process_state_marks_cancelled_pid_once() {
        let state = WorkerProcessState::default();

        assert!(state.register(10));
        state.mark_cancelled(10);

        assert!(state.take_cancelled(10));
        assert!(!state.take_cancelled(10));
        assert!(!state.take_cancelled(11));
    }

    #[test]
    fn worker_process_state_clears_matching_current_process() {
        let state = WorkerProcessState::default();

        assert!(state.register(10));
        state.clear_current(11);
        assert_eq!(state.current_pid(), Some(10));
        state.clear_current(10);
        assert_eq!(state.current_pid(), None);
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
    fn blocking_worker_command_runs_on_background_thread() {
        let caller_thread = std::thread::current().id();

        let ran_on_background_thread =
            tauri::async_runtime::block_on(run_blocking_worker_command(move || {
                Ok(std::thread::current().id() != caller_thread)
            }))
            .expect("blocking command should complete");

        assert!(ran_on_background_thread);
    }

    #[test]
    fn parse_worker_stdout_uses_last_json_result_when_stdout_contains_logs() {
        let stdout = r##"[funasr] loading model cache
Some dependency logged to stdout
{"status":"completed","task_id":"20260705-153012-douyin-demo","task_dir":"D:/FrameQ/outputs/tasks/20260705-153012-douyin-demo","artifacts":{"transcript_txt":"transcript/transcript.txt","summary":"ai/summary.md","mindmap":"ai/mindmap.mmd","insights":"ai/insights.json"},"text":"ok","summary":"# summary","insights":[{"id":1,"topic":"topic","matchReason":"matched","followUpQuestions":["next"],"suitableUse":"content planning","sourceChunkId":1}],"error":null}
"##;

        let parsed = parse_worker_stdout(stdout.as_bytes()).expect("parse worker result");

        assert_eq!(parsed["status"], "completed");
        assert_eq!(parsed["task_id"], "20260705-153012-douyin-demo");
        assert_eq!(parsed["text"], "ok");
        assert_eq!(parsed["summary"], "# summary");
        assert_eq!(parsed["artifacts"]["summary"], "ai/summary.md");
        assert_eq!(parsed["artifacts"]["mindmap"], "ai/mindmap.mmd");
        assert_eq!(parsed["insights"][0]["topic"], "topic");
    }

    #[test]
    fn parse_worker_output_prefers_structured_stdout_even_when_exit_fails() {
        let output = Output {
            status: exit_status(1),
            stdout: br#"{"status":"failed","error":{"code":"ASR_MODEL_NOT_DOWNLOADED","message":"SenseVoice Small model is not downloaded yet.","stage":"video_transcribing"}}"#.to_vec(),
            stderr: b"third-party stderr".to_vec(),
        };
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
                message: "third-party stderr".to_string(),
                stage: "video_extracting".to_string(),
            }),
        };

        let parsed = parse_worker_output_or_fallback(&output, fallback)
            .expect("parse structured worker result");

        assert_eq!(parsed["status"], "failed");
        assert_eq!(parsed["error"]["code"], "ASR_MODEL_NOT_DOWNLOADED");
        assert_eq!(parsed["error"]["stage"], "video_transcribing");
    }

    #[test]
    fn parse_worker_output_fallback_includes_task_artifact_fields() {
        let output = Output {
            status: exit_status(1),
            stdout: b"not-json".to_vec(),
            stderr: b"worker failed before returning json".to_vec(),
        };
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
                message: "worker failed before returning json".to_string(),
                stage: "video_extracting".to_string(),
            }),
        };

        let parsed =
            parse_worker_output_or_fallback(&output, fallback).expect("fallback worker result");

        assert!(parsed.get("task_id").is_some());
        assert!(parsed.get("task_dir").is_some());
        assert!(parsed.get("artifacts").is_some());
        assert_eq!(parsed["task_id"], serde_json::Value::Null);
        assert_eq!(parsed["task_dir"], serde_json::Value::Null);
        assert_eq!(parsed["artifacts"], serde_json::json!({}));
    }

    #[test]
    fn worker_command_spec_uses_bundled_python_and_app_local_data() {
        let paths = RuntimePaths {
            resource_dir: PathBuf::from("C:/Program Files/FrameQ/resources"),
            user_data_dir: PathBuf::from("C:/Users/demo/AppData/Local/com.frameq.desktop"),
        };
        let request_json = r#"{"url":"https://www.douyin.com/video/7524373044106677544"}"#;

        let spec = build_worker_command_spec(
            &paths,
            WorkerInvocation::ProcessVideo(request_json.to_string()),
            None,
        )
        .expect("build worker command spec");
        let env = spec.env_map();

        assert_eq!(
            spec.program,
            PathBuf::from("C:/Program Files/FrameQ/resources/python/python.exe")
        );
        assert_eq!(
            spec.args,
            vec!["-m", "frameq_worker", "--request-json", request_json,]
        );
        assert!(!spec.program.to_string_lossy().contains("uv"));
        assert!(!spec.args.iter().any(|arg| arg == "uv"));
        assert_eq!(
            env.get("PYTHONPATH"),
            Some(&"C:/Program Files/FrameQ/resources/worker".to_string())
        );
        assert_eq!(
            env.get("FRAMEQ_OUTPUT_DIR"),
            Some(&"C:/Users/demo/AppData/Local/com.frameq.desktop/outputs".to_string())
        );
        assert_eq!(
            env.get("FRAMEQ_CACHE_DIR"),
            Some(&"C:/Users/demo/AppData/Local/com.frameq.desktop/cache".to_string())
        );
        assert_eq!(
            env.get("FRAMEQ_MODEL_DIR"),
            Some(&"C:/Users/demo/AppData/Local/com.frameq.desktop/models".to_string())
        );
        assert_eq!(
            env.get("FRAMEQ_RESOURCE_DIR"),
            Some(&"C:/Program Files/FrameQ/resources".to_string())
        );
        assert_eq!(env.get("FRAMEQ_ALLOW_REAL_ASR"), Some(&"1".to_string()));
        assert_eq!(env.get("MODELSCOPE_OFFLINE"), Some(&"1".to_string()));
        assert_removes_legacy_local_llm_env(&spec);
        assert_eq!(spec.current_dir, paths.user_data_dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_worker_subprocesses_suppress_console_window() {
        assert_eq!(
            super::windows_subprocess_creation_flags() & 0x08000000,
            0x08000000
        );
    }

    #[test]
    fn release_supported_asr_models_only_exposes_bundled_sensevoice() {
        assert_eq!(
            supported_asr_models(),
            vec!["iic/SenseVoiceSmall".to_string()]
        );
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
    fn worker_command_spec_includes_server_managed_llm_checkout_env() {
        let paths = RuntimePaths {
            resource_dir: PathBuf::from("C:/Program Files/FrameQ/resources"),
            user_data_dir: PathBuf::from("C:/Users/demo/AppData/Local/com.frameq.desktop"),
        };
        let request_json = r#"{"url":"https://www.douyin.com/video/7524373044106677544","generate_insights":true}"#;

        let spec = build_worker_command_spec(
            &paths,
            WorkerInvocation::ProcessVideo(request_json.to_string()),
            Some(ServerManagedLlmInvocation {
                server_base_url: "http://127.0.0.1:8787".to_string(),
                session_token: "desktop-token".to_string(),
                request_id: "llm-run-12345678".to_string(),
            }),
        )
        .expect("build worker command spec");
        let env = spec.env_map();

        assert_removes_legacy_local_llm_env(&spec);
        assert_eq!(env.get("FRAMEQ_LLM_SOURCE"), Some(&"server".to_string()));
        assert_eq!(
            env.get("FRAMEQ_LLM_CHECKOUT_URL"),
            Some(&"http://127.0.0.1:8787/api/desktop/llm/checkouts".to_string())
        );
        assert_eq!(
            env.get("FRAMEQ_LLM_SESSION_TOKEN"),
            Some(&"desktop-token".to_string())
        );
        assert_eq!(
            env.get("FRAMEQ_LLM_CHECKOUT_REQUEST_ID"),
            Some(&"llm-run-12345678".to_string())
        );
    }

    #[test]
    fn worker_command_spec_skips_server_managed_llm_for_transcript_only_process() {
        let paths = RuntimePaths {
            resource_dir: PathBuf::from("C:/Program Files/FrameQ/resources"),
            user_data_dir: PathBuf::from("C:/Users/demo/AppData/Local/com.frameq.desktop"),
        };
        let request_json = r#"{"url":"https://www.douyin.com/video/7524373044106677544","generate_insights":false}"#;

        let spec = build_worker_command_spec(
            &paths,
            WorkerInvocation::ProcessVideo(request_json.to_string()),
            Some(ServerManagedLlmInvocation {
                server_base_url: "http://127.0.0.1:8787".to_string(),
                session_token: "desktop-token".to_string(),
                request_id: "llm-run-12345678".to_string(),
            }),
        )
        .expect("build worker command spec");
        let env = spec.env_map();

        assert_removes_legacy_local_llm_env(&spec);
        assert_eq!(env.get("FRAMEQ_LLM_SOURCE"), None);
        assert_eq!(env.get("FRAMEQ_LLM_CHECKOUT_URL"), None);
        assert_eq!(env.get("FRAMEQ_LLM_SESSION_TOKEN"), None);
        assert_eq!(env.get("FRAMEQ_LLM_CHECKOUT_REQUEST_ID"), None);
    }

    #[test]
    fn retry_insights_request_round_trips_preference_snapshot_payload() {
        let payload = serde_json::json!({
            "task_id": "20260705-153012-douyin-demo",
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
            serialized["preference_snapshot"]["generationPreferences"]["goal"],
            "content_creation"
        );
        assert_eq!(serialized["preference_snapshot"]["profileSkipped"], true);
    }

    #[test]
    fn auth_login_url_includes_state_and_redirect_scheme() {
        let url =
            build_auth_login_url("https://frameq.example", "state-123456").expect("build auth url");

        assert_eq!(
            url,
            "https://frameq.example/login?desktop=1&state=state-123456&redirect_uri=frameq%3A%2F%2Fauth%2Fcallback"
        );
    }

    #[test]
    fn server_base_url_defaults_to_production_domain_and_allows_override() {
        let original = std::env::var("FRAMEQ_SERVER_BASE_URL").ok();
        std::env::remove_var("FRAMEQ_SERVER_BASE_URL");

        assert_eq!(server_base_url(), "https://frameq.8xf.pro");

        std::env::set_var("FRAMEQ_SERVER_BASE_URL", "http://127.0.0.1:8787/");

        assert_eq!(server_base_url(), "http://127.0.0.1:8787");

        match original {
            Some(value) => std::env::set_var("FRAMEQ_SERVER_BASE_URL", value),
            None => std::env::remove_var("FRAMEQ_SERVER_BASE_URL"),
        }
    }

    #[test]
    fn activation_redeem_url_targets_desktop_activation_route() {
        assert_eq!(
            build_activation_redeem_url("https://frameq.example/"),
            "https://frameq.example/api/desktop/activation-codes/redeem"
        );
    }

    #[test]
    fn auth_callback_parser_accepts_matching_state() {
        let callback = parse_auth_callback_url(
            "frameq://auth/callback?ticket=flt_abc123&state=state-123456",
            "state-123456",
        )
        .expect("parse auth callback");

        assert_eq!(
            callback,
            AuthCallback {
                ticket: "flt_abc123".to_string(),
                state: "state-123456".to_string(),
            }
        );
    }

    #[test]
    fn auth_callback_parser_rejects_wrong_state_or_path() {
        assert!(parse_auth_callback_url(
            "frameq://auth/callback?ticket=flt_abc123&state=other-state",
            "state-123456",
        )
        .is_err());
        assert!(parse_auth_callback_url(
            "frameq://billing/callback?ticket=flt_abc123&state=state-123456",
            "state-123456",
        )
        .is_err());
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
        let paths = RuntimePaths {
            resource_dir: PathBuf::from("C:/Program Files/FrameQ/resources"),
            user_data_dir: PathBuf::from("C:/Users/demo/AppData/Local/com.frameq.desktop"),
        };
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

        assert_eq!(
            spec.program,
            PathBuf::from("C:/Program Files/FrameQ/resources/python/python.exe")
        );
        assert_eq!(
            spec.args,
            vec!["-m", "frameq_worker", "--download-asr-model"]
        );
        assert!(!spec.program.to_string_lossy().contains("uv"));
        assert!(!spec.args.iter().any(|arg| arg == "uv"));
        assert_eq!(
            env.get("FRAMEQ_MODEL_DIR"),
            Some(&"C:/Users/demo/AppData/Local/com.frameq.desktop/models".to_string())
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

    #[test]
    fn load_llm_config_reads_only_local_app_settings() {
        let env_path = temp_env_path("load_llm_config_reads_only_local_app_settings");
        fs::write(
            &env_path,
            [
                "FRAMEQ_LLM_PROVIDER=openai_compatible",
                "FRAMEQ_LLM_BASE_URL=https://llm.example/v1",
                "FRAMEQ_LLM_API_KEY=secret-key",
                "FRAMEQ_LLM_MODEL=demo-model",
                "FRAMEQ_LLM_TIMEOUT_SECONDS=42",
                "FRAMEQ_OUTPUT_DIR=D:/FrameQ/results",
                "FRAMEQ_ASR_MODEL=iic/SenseVoiceSmall",
            ]
            .join("\n"),
        )
        .expect("write test env");

        let config = load_llm_config_from_file(&env_path).expect("load config");

        assert_eq!(config.output_dir, "D:/FrameQ/results");
        assert_eq!(config.asr_model, "iic/SenseVoiceSmall");
        assert_eq!(config.supported_asr_models, vec!["iic/SenseVoiceSmall"]);
    }

    #[test]
    fn load_llm_config_creates_app_local_env_template_and_reports_path() {
        let env_path = temp_env_path("load_llm_config_creates_app_local_env_template");

        let config = load_llm_config_from_file(&env_path).expect("load config");
        let saved = fs::read_to_string(&env_path).expect("read created env");

        assert_eq!(config.config_path, path_to_env_string(&env_path));
        assert_eq!(config.asr_model, "iic/SenseVoiceSmall");
        assert!(saved.contains("FrameQ desktop local settings"));
        assert!(saved.contains("FRAMEQ_OUTPUT_DIR="));
        assert!(saved.contains("FRAMEQ_ASR_MODEL=iic/SenseVoiceSmall"));
        assert!(!saved.contains("FRAMEQ_LLM_API_KEY"));
    }

    #[test]
    fn save_llm_config_updates_local_settings_and_removes_old_llm_values() {
        let env_path = temp_env_path("save_llm_config_updates_local_settings");
        fs::write(
            &env_path,
            [
                "# keep this comment",
                "FRAMEQ_LLM_PROVIDER=openai_compatible",
                "FRAMEQ_LLM_BASE_URL=https://old.example/v1",
                "FRAMEQ_LLM_API_KEY=old-secret",
                "FRAMEQ_LLM_MODEL=old-model",
                "FRAMEQ_LLM_TIMEOUT_SECONDS=44",
                "OTHER_SETTING=keep-me",
            ]
            .join("\n"),
        )
        .expect("write test env");

        let config = save_llm_config_to_file(
            &env_path,
            LlmConfigInput {
                output_dir: "D:/FrameQ/custom-results".to_string(),
                asr_model: "iic/SenseVoiceSmall".to_string(),
            },
        )
        .expect("save config");
        let saved = fs::read_to_string(&env_path).expect("read saved env");

        assert_eq!(config.output_dir, "D:/FrameQ/custom-results");
        assert_eq!(config.asr_model, "iic/SenseVoiceSmall");
        assert_eq!(config.config_path, path_to_env_string(&env_path));
        assert!(saved.contains("FRAMEQ_OUTPUT_DIR=D:/FrameQ/custom-results"));
        assert!(saved.contains("FRAMEQ_ASR_MODEL=iic/SenseVoiceSmall"));
        assert!(saved.contains("OTHER_SETTING=keep-me"));
        assert!(!saved.contains("FRAMEQ_LLM_PROVIDER"));
        assert!(!saved.contains("FRAMEQ_LLM_BASE_URL"));
        assert!(!saved.contains("FRAMEQ_LLM_API_KEY"));
        assert!(!saved.contains("FRAMEQ_LLM_MODEL"));
        assert!(!saved.contains("FRAMEQ_LLM_TIMEOUT_SECONDS"));
    }

    #[test]
    fn save_llm_config_allows_output_dir_without_llm_credentials() {
        let env_path = temp_env_path("save_llm_config_allows_output_dir_only");

        let config = save_llm_config_to_file(
            &env_path,
            LlmConfigInput {
                output_dir: "D:/FrameQ/results-only".to_string(),
                asr_model: "iic/SenseVoiceSmall".to_string(),
            },
        )
        .expect("save output directory");
        let saved = fs::read_to_string(&env_path).expect("read saved env");

        assert_eq!(config.output_dir, "D:/FrameQ/results-only");
        assert_eq!(config.asr_model, "iic/SenseVoiceSmall");
        assert!(saved.contains("FRAMEQ_OUTPUT_DIR=D:/FrameQ/results-only"));
        assert!(saved.contains("FRAMEQ_ASR_MODEL=iic/SenseVoiceSmall"));
        assert!(saved.contains("FrameQ desktop local settings"));
        assert!(!saved.contains("FRAMEQ_LLM_API_KEY"));
    }

    #[test]
    fn desktop_worker_contract_matches_tauri_constants() {
        let contract_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("contracts")
            .join("desktop-worker-contract.json");
        let contract: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(contract_path).expect("read desktop worker contract"),
        )
        .expect("parse desktop worker contract");

        assert_eq!(
            super::PROGRESS_EVENT_NAME,
            contract["events"]["workerProgress"]
        );
        assert_eq!(
            super::ASR_MODEL_DOWNLOAD_EVENT_NAME,
            contract["events"]["asrModelDownloadProgress"]
        );
        assert_eq!(
            super::PROGRESS_EVENT_PREFIX,
            contract["events"]["workerProgressPrefix"]
        );
        assert_eq!(
            super::MODEL_DOWNLOAD_EVENT_PREFIX,
            contract["events"]["asrModelDownloadPrefix"]
        );
        assert_eq!(super::DEFAULT_ASR_MODEL, contract["asr"]["defaultModel"]);
        assert_eq!(super::OUTPUT_DIR_ENV, contract["env"]["outputDir"]);
        assert_eq!(super::CACHE_DIR_ENV, contract["env"]["cacheDir"]);
        assert_eq!(super::MODEL_DIR_ENV, contract["env"]["modelDir"]);
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

    #[cfg(windows)]
    fn exit_status(code: u32) -> std::process::ExitStatus {
        use std::os::windows::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(code)
    }

    #[cfg(unix)]
    fn exit_status(code: i32) -> std::process::ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(code << 8)
    }
}
