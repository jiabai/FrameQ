use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, Window};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;
use uuid::Uuid;

const PROGRESS_EVENT_NAME: &str = "worker-progress";
const PROGRESS_EVENT_PREFIX: &str = "FRAMEQ_PROGRESS ";
const ASR_MODEL_DOWNLOAD_EVENT_NAME: &str = "asr-model-download-progress";
const MODEL_DOWNLOAD_EVENT_PREFIX: &str = "FRAMEQ_MODEL_DOWNLOAD ";
const DOTENV_FILE_NAME: &str = ".env";
const LLM_PROVIDER_ENV: &str = "FRAMEQ_LLM_PROVIDER";
const LLM_BASE_URL_ENV: &str = "FRAMEQ_LLM_BASE_URL";
const LLM_API_KEY_ENV: &str = "FRAMEQ_LLM_API_KEY";
const LLM_MODEL_ENV: &str = "FRAMEQ_LLM_MODEL";
const LLM_TIMEOUT_ENV: &str = "FRAMEQ_LLM_TIMEOUT_SECONDS";
const LLM_SOURCE_ENV: &str = "FRAMEQ_LLM_SOURCE";
const LLM_CHECKOUT_URL_ENV: &str = "FRAMEQ_LLM_CHECKOUT_URL";
const LLM_SESSION_TOKEN_ENV: &str = "FRAMEQ_LLM_SESSION_TOKEN";
const LLM_CHECKOUT_REQUEST_ID_ENV: &str = "FRAMEQ_LLM_CHECKOUT_REQUEST_ID";
const LEGACY_LOCAL_LLM_ENV_KEYS: [&str; 5] = [
    LLM_PROVIDER_ENV,
    LLM_BASE_URL_ENV,
    LLM_API_KEY_ENV,
    LLM_MODEL_ENV,
    LLM_TIMEOUT_ENV,
];
const OUTPUT_DIR_ENV: &str = "FRAMEQ_OUTPUT_DIR";
const WORK_DIR_ENV: &str = "FRAMEQ_WORK_DIR";
const MODEL_DIR_ENV: &str = "FRAMEQ_MODEL_DIR";
const RESOURCE_DIR_ENV: &str = "FRAMEQ_RESOURCE_DIR";
const USER_DATA_DIR_ENV: &str = "FRAMEQ_USER_DATA_DIR";
const ALLOW_REAL_ASR_ENV: &str = "FRAMEQ_ALLOW_REAL_ASR";
const MODELSCOPE_OFFLINE_ENV: &str = "MODELSCOPE_OFFLINE";
const ASR_MODEL_ENV: &str = "FRAMEQ_ASR_MODEL";
const ASR_MODEL_DOWNLOAD_URL_ENV: &str = "FRAMEQ_ASR_MODEL_DOWNLOAD_URL";
const ASR_MODEL_DOWNLOAD_SHA256_ENV: &str = "FRAMEQ_ASR_MODEL_DOWNLOAD_SHA256";
const MODELSCOPE_ENDPOINT_ENV: &str = "FRAMEQ_MODELSCOPE_ENDPOINT";
const SENSEVOICE_REVISION_ENV: &str = "FRAMEQ_SENSEVOICE_REVISION";
const HISTORY_FILE_NAME: &str = "history.json";
const ACCOUNT_SESSION_FILE_NAME: &str = "session.json";
const ACCOUNT_PENDING_STATE_FILE_NAME: &str = "pending_auth_state.txt";
const MODEL_VERSION_FILE_NAME: &str = "MODEL_VERSION.txt";
const DEFAULT_SERVER_BASE_URL: &str = "http://127.0.0.1:8787";
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
    transcript_path: String,
    text: String,
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
    video_path: Option<String>,
    audio_path: Option<String>,
    text: String,
    insights: Vec<String>,
    transcript_path: Option<String>,
    insights_path: Option<String>,
    error: Option<WorkerError>,
}

#[derive(Debug, Serialize)]
struct CancelProcessResult {
    cancelled: bool,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LlmConfigInput {
    #[serde(default)]
    output_dir: String,
    #[serde(default)]
    asr_model: String,
}

#[derive(Debug, Serialize)]
struct LlmConfigView {
    output_dir: String,
    asr_model: String,
    supported_asr_models: Vec<String>,
}

#[derive(Debug, Serialize)]
struct HistoryErrorView {
    code: String,
    message: String,
    stage: String,
}

#[derive(Debug, Serialize)]
struct HistoryItemView {
    id: String,
    created_at: String,
    url: String,
    status: String,
    output_dir: String,
    video_path: Option<String>,
    audio_path: Option<String>,
    transcript_path: Option<String>,
    insights_path: Option<String>,
    error: Option<HistoryErrorView>,
    text_preview: String,
    insights_count: usize,
    text: String,
    insights: Vec<String>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct AuthCallback {
    ticket: String,
    state: String,
}

#[derive(Debug, Serialize)]
struct BeginAuthFlowResult {
    auth_url: String,
    state: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AccountSessionFile {
    session_token: String,
    email: String,
    expires_at: String,
}

#[derive(Debug, Serialize)]
struct AccountStatusView {
    authenticated: bool,
    email: Option<String>,
    entitlement_status: String,
    entitlement_expires_at: Option<String>,
    llm_quota_limit: i32,
    llm_quota_used: i32,
    llm_quota_remaining: i32,
    llm_quota_resets_at: Option<String>,
    llm_configured: bool,
    last_verified_at: Option<String>,
    can_process: bool,
    server_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ServerAccountStatus {
    authenticated: bool,
    email: String,
    entitlement_status: String,
    entitlement_expires_at: Option<String>,
    llm_quota_limit: i32,
    llm_quota_used: i32,
    llm_quota_remaining: i32,
    llm_quota_resets_at: Option<String>,
    llm_configured: bool,
    last_verified_at: String,
    can_process: bool,
}

#[derive(Debug, Deserialize)]
struct SessionExchangeResponse {
    session_token: String,
    email: String,
    expires_at: String,
}

#[derive(Debug, Serialize)]
struct CompleteAuthFlowResult {
    authenticated: bool,
    email: String,
    can_process: bool,
}

#[derive(Debug, Serialize)]
struct WechatCheckoutView {
    order_id: String,
    amount_fen: i32,
    currency: String,
    code_url: String,
    expires_at: String,
    status: String,
}

#[derive(Debug, Deserialize)]
struct ServerWechatCheckout {
    order_id: String,
    amount_fen: i32,
    currency: String,
    code_url: String,
    expires_at: String,
    status: String,
}

#[derive(Debug, Serialize)]
struct CheckoutStatusView {
    order_id: String,
    status: String,
    entitlement_expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ServerCheckoutStatus {
    order_id: String,
    status: String,
    entitlement_expires_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct WindowPositionView {
    x: i32,
    y: i32,
}

#[derive(Debug, Clone)]
struct RuntimePaths {
    resource_dir: PathBuf,
    user_data_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct ServerManagedLlmInvocation {
    server_base_url: String,
    session_token: String,
    request_id: String,
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

fn resolve_runtime_paths(app: &AppHandle) -> Result<RuntimePaths, String> {
    let raw_resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    Ok(RuntimePaths {
        resource_dir: normalize_resource_dir(raw_resource_dir),
        user_data_dir: app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?,
    })
}

fn normalize_resource_dir(resource_dir: PathBuf) -> PathBuf {
    if resource_dir_has_runtime(&resource_dir) {
        return resource_dir;
    }

    let nested_resources = resource_dir.join("resources");
    if resource_dir_has_runtime(&nested_resources) {
        return nested_resources;
    }

    resource_dir
}

fn resource_dir_has_runtime(resource_dir: &Path) -> bool {
    bundled_python_path(resource_dir).is_file()
        || resource_dir.join("worker").is_dir()
        || resource_dir.join("bin").is_dir()
}

fn ensure_runtime_dirs(paths: &RuntimePaths) -> Result<(), String> {
    fs::create_dir_all(paths.user_data_dir.join("outputs")).map_err(|error| error.to_string())?;
    fs::create_dir_all(paths.user_data_dir.join("work")).map_err(|error| error.to_string())?;
    fs::create_dir_all(asr_model_dir(paths)).map_err(|error| error.to_string())
}

fn asr_model_dir(paths: &RuntimePaths) -> PathBuf {
    paths.user_data_dir.join("models")
}

fn account_auth_dir(paths: &RuntimePaths) -> PathBuf {
    paths.user_data_dir.join("auth")
}

fn account_session_path(paths: &RuntimePaths) -> PathBuf {
    account_auth_dir(paths).join(ACCOUNT_SESSION_FILE_NAME)
}

fn account_pending_state_path(paths: &RuntimePaths) -> PathBuf {
    account_auth_dir(paths).join(ACCOUNT_PENDING_STATE_FILE_NAME)
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
    server_managed_llm: Option<ServerManagedLlmInvocation>,
) -> Result<WorkerCommandSpec, String> {
    let include_server_managed_llm = worker_invocation_uses_server_managed_llm(&invocation);
    let (flag, payload) = match invocation {
        WorkerInvocation::ProcessVideo(payload) => ("--request-json", payload),
        WorkerInvocation::RetryInsights(payload) => ("--retry-insights-json", payload),
    };
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
            OUTPUT_DIR_ENV.to_string(),
            path_to_env_string(paths.user_data_dir.join("outputs")),
        ),
        (
            WORK_DIR_ENV.to_string(),
            path_to_env_string(paths.user_data_dir.join("work")),
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
        WorkerInvocation::ProcessVideo(payload) => process_video_request_generates_insights(payload),
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

fn legacy_local_llm_env_removals() -> Vec<String> {
    LEGACY_LOCAL_LLM_ENV_KEYS
        .iter()
        .map(|key| (*key).to_string())
        .collect()
}

fn configured_env_value(config_values: &HashMap<String, String>, key: &str) -> Option<String> {
    config_values
        .get(key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
}

fn asr_model_source(config_values: &HashMap<String, String>) -> String {
    if configured_env_value(config_values, ASR_MODEL_DOWNLOAD_URL_ENV).is_some() {
        "custom_url".to_string()
    } else {
        "modelscope".to_string()
    }
}

fn bundled_python_path(resource_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        resource_dir.join("python").join("python.exe")
    } else {
        resource_dir.join("python").join("bin").join("python3")
    }
}

fn prepend_to_path(path: &Path) -> Result<String, String> {
    let existing_path = std::env::var_os("PATH").unwrap_or_default();
    let paths = std::iter::once(path.to_path_buf()).chain(std::env::split_paths(&existing_path));
    std::env::join_paths(paths)
        .map(|value| value.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

fn path_to_env_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().replace('\\', "/")
}

fn spawn_worker_command(spec: WorkerCommandSpec) -> Result<std::process::Child, String> {
    let mut command = Command::new(spec.program);
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
    if let Err(error) = apply_configured_asr_model_to_request(&env_path(&paths), &mut request) {
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "failed".to_string(),
            video_path: None,
            audio_path: None,
            text: String::new(),
            insights: vec![],
            transcript_path: None,
            insights_path: None,
            error: Some(WorkerError {
                code: "ASR_MODEL_UNSUPPORTED".to_string(),
                message: error,
                stage: "video_transcribing".to_string(),
            }),
        }));
    }
    let request_json = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    let llm_invocation = server_managed_llm_invocation(&paths)?;
    let mut child = spawn_worker_command(build_worker_command_spec(
        &paths,
        WorkerInvocation::ProcessVideo(request_json),
        llm_invocation,
    )?)?;
    let worker_pid = child.id();
    if !process_state.register(worker_pid) {
        let _ = terminate_process_tree(worker_pid);
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "failed".to_string(),
            video_path: None,
            audio_path: None,
            text: String::new(),
            insights: vec![],
            transcript_path: None,
            insights_path: None,
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

    if was_cancelled {
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "failed".to_string(),
            video_path: None,
            audio_path: None,
            text: String::new(),
            insights: vec![],
            transcript_path: None,
            insights_path: None,
            error: Some(WorkerError {
                code: "WORKER_CANCELLED".to_string(),
                message: "Worker process was cancelled.".to_string(),
                stage: "video_extracting".to_string(),
            }),
        }));
    }

    parse_worker_output_or_fallback(
        &output,
        ProcessVideoResult {
            status: "failed".to_string(),
            video_path: None,
            audio_path: None,
            text: String::new(),
            insights: vec![],
            transcript_path: None,
            insights_path: None,
            error: Some(WorkerError {
                code: "WORKER_PROCESS_FAILED".to_string(),
                message: stderr,
                stage: "video_extracting".to_string(),
            }),
        },
    )
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
    let llm_invocation = server_managed_llm_invocation(&paths)?;
    let child = spawn_worker_command(build_worker_command_spec(
        &paths,
        WorkerInvocation::RetryInsights(request_json),
        llm_invocation,
    )?)?;
    let worker_pid = child.id();
    if !process_state.register(worker_pid) {
        let _ = terminate_process_tree(worker_pid);
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "partial_completed".to_string(),
            video_path: None,
            audio_path: None,
            text: request.text,
            insights: vec![],
            transcript_path: Some(request.transcript_path),
            insights_path: None,
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

    if was_cancelled {
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "partial_completed".to_string(),
            video_path: None,
            audio_path: None,
            text: request.text,
            insights: vec![],
            transcript_path: Some(request.transcript_path),
            insights_path: None,
            error: Some(WorkerError {
                code: "WORKER_CANCELLED".to_string(),
                message: "Worker process was cancelled.".to_string(),
                stage: "insights_generating".to_string(),
            }),
        }));
    }

    parse_worker_output_or_fallback(
        &output,
        ProcessVideoResult {
            status: "partial_completed".to_string(),
            video_path: None,
            audio_path: None,
            text: request.text,
            insights: vec![],
            transcript_path: Some(request.transcript_path),
            insights_path: None,
            error: Some(WorkerError {
                code: "WORKER_PROCESS_FAILED".to_string(),
                message: String::from_utf8_lossy(&output.stderr).to_string(),
                stage: "insights_generating".to_string(),
            }),
        },
    )
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
fn get_llm_config(app: AppHandle) -> Result<LlmConfigView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    load_llm_config_from_file(&env_path(&paths))
}

#[tauri::command]
fn save_llm_config(app: AppHandle, config: LlmConfigInput) -> Result<LlmConfigView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    save_llm_config_to_file(&env_path(&paths), config)
}

#[tauri::command]
fn get_history(app: AppHandle) -> Result<Vec<HistoryItemView>, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    load_history_from_project(&paths.user_data_dir)
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
    let mut child =
        spawn_worker_command(build_model_download_command_spec(&paths, &config_values)?)?;
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

    if was_cancelled {
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

#[tauri::command]
fn begin_auth_flow(app: AppHandle) -> Result<BeginAuthFlowResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    fs::create_dir_all(account_auth_dir(&paths)).map_err(|error| error.to_string())?;
    let state = generate_auth_state();
    fs::write(account_pending_state_path(&paths), &state).map_err(|error| error.to_string())?;
    Ok(BeginAuthFlowResult {
        auth_url: build_auth_login_url(&server_base_url(), &state)?,
        state,
    })
}

#[tauri::command]
async fn complete_auth_flow(app: AppHandle, callback_url: String) -> Result<CompleteAuthFlowResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let pending_state = fs::read_to_string(account_pending_state_path(&paths))
        .map_err(|_| "No pending login state was found.".to_string())?;
    let callback = parse_auth_callback_url(&callback_url, pending_state.trim())?;
    let exchange = exchange_auth_ticket(&server_base_url(), &callback).await?;
    fs::create_dir_all(account_auth_dir(&paths)).map_err(|error| error.to_string())?;
    write_account_session(&account_session_path(&paths), &exchange)?;
    let _ = fs::remove_file(account_pending_state_path(&paths));
    let status = get_account_status_from_server(&server_base_url(), &exchange.session_token).await?;
    Ok(CompleteAuthFlowResult {
        authenticated: true,
        email: exchange.email,
        can_process: status.can_process,
    })
}

#[tauri::command]
async fn get_account_status(app: AppHandle) -> Result<AccountStatusView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let Some(session) = read_account_session(&account_session_path(&paths))? else {
        return Ok(guest_account_status());
    };
    match get_account_status_from_server(&server_base_url(), &session.session_token).await {
        Ok(status) => Ok(AccountStatusView {
            authenticated: status.authenticated,
            email: Some(status.email),
            entitlement_status: status.entitlement_status,
            entitlement_expires_at: status.entitlement_expires_at,
            llm_quota_limit: status.llm_quota_limit,
            llm_quota_used: status.llm_quota_used,
            llm_quota_remaining: status.llm_quota_remaining,
            llm_quota_resets_at: status.llm_quota_resets_at,
            llm_configured: status.llm_configured,
            last_verified_at: Some(status.last_verified_at),
            can_process: status.can_process,
            server_error: None,
        }),
        Err(error) => Ok(AccountStatusView {
            authenticated: true,
            email: Some(session.email),
            entitlement_status: "unknown".to_string(),
            entitlement_expires_at: None,
            llm_quota_limit: 0,
            llm_quota_used: 0,
            llm_quota_remaining: 0,
            llm_quota_resets_at: None,
            llm_configured: false,
            last_verified_at: None,
            can_process: false,
            server_error: Some(error),
        }),
    }
}

#[tauri::command]
async fn logout_account(app: AppHandle) -> Result<(), String> {
    let paths = resolve_runtime_paths(&app)?;
    if let Some(session) = read_account_session(&account_session_path(&paths))? {
        let _ = reqwest::Client::new()
            .post(format!("{}/api/desktop/logout", server_base_url()))
            .bearer_auth(session.session_token)
            .send()
            .await;
    }
    let _ = fs::remove_file(account_session_path(&paths));
    Ok(())
}

#[tauri::command]
async fn redeem_activation_code(app: AppHandle, code: String) -> Result<AccountStatusView, String> {
    let paths = resolve_runtime_paths(&app)?;
    let session = require_account_session(&paths)?;
    let response = reqwest::Client::new()
        .post(build_activation_redeem_url(&server_base_url()))
        .bearer_auth(&session.session_token)
        .json(&serde_json::json!({ "code": code }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(response_error_message(response, "Activation code redeem failed.").await);
    }
    let status = response
        .json::<ServerAccountStatus>()
        .await
        .map_err(|error| error.to_string())?;
    Ok(account_status_view_from_server(status))
}

#[tauri::command]
async fn create_wechat_checkout(app: AppHandle) -> Result<WechatCheckoutView, String> {
    let paths = resolve_runtime_paths(&app)?;
    let session = require_account_session(&paths)?;
    let response = reqwest::Client::new()
        .post(format!("{}/api/desktop/billing/wechat-native", server_base_url()))
        .bearer_auth(session.session_token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Checkout failed with status {}.", response.status()));
    }
    let checkout = response
        .json::<ServerWechatCheckout>()
        .await
        .map_err(|error| error.to_string())?;
    Ok(WechatCheckoutView {
        order_id: checkout.order_id,
        amount_fen: checkout.amount_fen,
        currency: checkout.currency,
        code_url: checkout.code_url,
        expires_at: checkout.expires_at,
        status: checkout.status,
    })
}

#[tauri::command]
async fn get_checkout_status(app: AppHandle, order_id: String) -> Result<CheckoutStatusView, String> {
    let paths = resolve_runtime_paths(&app)?;
    let session = require_account_session(&paths)?;
    let response = reqwest::Client::new()
        .get(format!(
            "{}/api/desktop/billing/orders/{}",
            server_base_url(),
            percent_encode(&order_id)
        ))
        .bearer_auth(session.session_token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Order status failed with status {}.", response.status()));
    }
    let status = response
        .json::<ServerCheckoutStatus>()
        .await
        .map_err(|error| error.to_string())?;
    Ok(CheckoutStatusView {
        order_id: status.order_id,
        status: status.status,
        entitlement_expires_at: status.entitlement_expires_at,
    })
}

#[tauri::command]
fn start_window_drag(window: Window) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn close_window(window: Window) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn minimize_window(window: Window) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_maximize_window(window: Window) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn get_window_position(window: Window) -> Result<WindowPositionView, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    Ok(WindowPositionView {
        x: position.x,
        y: position.y,
    })
}

#[tauri::command]
fn set_window_position(window: Window, position: WindowPositionView) -> Result<(), String> {
    window
        .set_position(PhysicalPosition::new(position.x, position.y))
        .map_err(|error| error.to_string())
}

fn load_llm_config_from_file(path: &Path) -> Result<LlmConfigView, String> {
    let values = parse_dotenv_values(path)?;
    Ok(LlmConfigView {
        output_dir: values.get(OUTPUT_DIR_ENV).cloned().unwrap_or_default(),
        asr_model: resolve_asr_model_value(values.get(ASR_MODEL_ENV).cloned())?,
        supported_asr_models: supported_asr_models(),
    })
}

fn env_path(paths: &RuntimePaths) -> PathBuf {
    paths.user_data_dir.join(DOTENV_FILE_NAME)
}

fn server_base_url() -> String {
    std::env::var("FRAMEQ_SERVER_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SERVER_BASE_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

fn server_managed_llm_invocation(
    paths: &RuntimePaths,
) -> Result<Option<ServerManagedLlmInvocation>, String> {
    let Some(session) = read_account_session(&account_session_path(paths))? else {
        return Ok(None);
    };
    Ok(Some(ServerManagedLlmInvocation {
        server_base_url: server_base_url(),
        session_token: session.session_token,
        request_id: format!("llm-{}", Uuid::new_v4().simple()),
    }))
}

fn generate_auth_state() -> String {
    format!("state-{}", Uuid::new_v4().simple())
}

fn build_auth_login_url(server_base_url: &str, state: &str) -> Result<String, String> {
    validate_auth_state(state)?;
    let base = server_base_url.trim_end_matches('/');
    if !base.starts_with("http://") && !base.starts_with("https://") {
        return Err("FrameQ server URL must start with http:// or https://.".to_string());
    }
    Ok(format!(
        "{}/login?desktop=1&state={}&redirect_uri={}",
        base,
        percent_encode(state),
        percent_encode("frameq://auth/callback")
    ))
}

fn build_activation_redeem_url(server_base_url: &str) -> String {
    format!(
        "{}/api/desktop/activation-codes/redeem",
        server_base_url.trim_end_matches('/')
    )
}

fn parse_auth_callback_url(callback_url: &str, expected_state: &str) -> Result<AuthCallback, String> {
    validate_auth_state(expected_state)?;
    let url = Url::parse(callback_url).map_err(|_| "Auth callback URL is invalid.".to_string())?;
    if url.scheme() != "frameq" || url.host_str() != Some("auth") || url.path() != "/callback" {
        return Err("Auth callback URL target is invalid.".to_string());
    }
    let mut ticket: Option<String> = None;
    let mut state: Option<String> = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "ticket" => ticket = Some(value.to_string()),
            "state" => state = Some(value.to_string()),
            _ => {}
        }
    }
    let Some(ticket) = ticket else {
        return Err("Auth callback is missing a login ticket.".to_string());
    };
    let Some(state) = state else {
        return Err("Auth callback is missing state.".to_string());
    };
    if state != expected_state {
        return Err("Auth callback state does not match this device.".to_string());
    }
    if !ticket.starts_with("flt_") || ticket.len() > 256 {
        return Err("Auth callback ticket is invalid.".to_string());
    }
    Ok(AuthCallback { ticket, state })
}

fn validate_auth_state(state: &str) -> Result<(), String> {
    if state.len() < 8
        || state.len() > 160
        || !state
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '~' | '-'))
    {
        return Err("Auth state is invalid.".to_string());
    }
    Ok(())
}

fn percent_encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

async fn exchange_auth_ticket(
    server_base_url: &str,
    callback: &AuthCallback,
) -> Result<SessionExchangeResponse, String> {
    let response = reqwest::Client::new()
        .post(format!("{}/api/desktop/sessions/exchange", server_base_url.trim_end_matches('/')))
        .json(&serde_json::json!({
            "ticket": callback.ticket,
            "state": callback.state,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Login exchange failed with status {}.", response.status()));
    }
    response
        .json::<SessionExchangeResponse>()
        .await
        .map_err(|error| error.to_string())
}

async fn get_account_status_from_server(
    server_base_url: &str,
    session_token: &str,
) -> Result<ServerAccountStatus, String> {
    let response = reqwest::Client::new()
        .get(format!("{}/api/desktop/account", server_base_url.trim_end_matches('/')))
        .bearer_auth(session_token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Account status failed with status {}.", response.status()));
    }
    response
        .json::<ServerAccountStatus>()
        .await
        .map_err(|error| error.to_string())
}

fn account_status_view_from_server(status: ServerAccountStatus) -> AccountStatusView {
    AccountStatusView {
        authenticated: status.authenticated,
        email: Some(status.email),
        entitlement_status: status.entitlement_status,
        entitlement_expires_at: status.entitlement_expires_at,
        llm_quota_limit: status.llm_quota_limit,
        llm_quota_used: status.llm_quota_used,
        llm_quota_remaining: status.llm_quota_remaining,
        llm_quota_resets_at: status.llm_quota_resets_at,
        llm_configured: status.llm_configured,
        last_verified_at: Some(status.last_verified_at),
        can_process: status.can_process,
        server_error: None,
    }
}

async fn response_error_message(response: reqwest::Response, fallback: &str) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let server_error = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| value.get("error").and_then(|error| error.as_str()).map(str::to_string));
    match server_error {
        Some(message) if !message.trim().is_empty() => message,
        _ => format!("{fallback} Status {status}."),
    }
}

fn write_account_session(path: &Path, session: &SessionExchangeResponse) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let session_file = AccountSessionFile {
        session_token: session.session_token.clone(),
        email: session.email.clone(),
        expires_at: session.expires_at.clone(),
    };
    fs::write(
        path,
        serde_json::to_string_pretty(&session_file).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn read_account_session(path: &Path) -> Result<Option<AccountSessionFile>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str::<AccountSessionFile>(&content)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn require_account_session(paths: &RuntimePaths) -> Result<AccountSessionFile, String> {
    read_account_session(&account_session_path(paths))?
        .ok_or_else(|| "Please log in to FrameQ first.".to_string())
}

fn guest_account_status() -> AccountStatusView {
    AccountStatusView {
        authenticated: false,
        email: None,
        entitlement_status: "inactive".to_string(),
        entitlement_expires_at: None,
        llm_quota_limit: 0,
        llm_quota_used: 0,
        llm_quota_remaining: 0,
        llm_quota_resets_at: None,
        llm_configured: false,
        last_verified_at: None,
        can_process: false,
        server_error: None,
    }
}

fn save_llm_config_to_file(path: &Path, config: LlmConfigInput) -> Result<LlmConfigView, String> {
    let output_dir = sanitize_optional_env_value(config.output_dir, OUTPUT_DIR_ENV)?;
    let asr_model = resolve_asr_model_value(Some(config.asr_model))?;
    write_dotenv_updates_removing(
        path,
        &[(OUTPUT_DIR_ENV, output_dir), (ASR_MODEL_ENV, asr_model)],
        &[
            LLM_PROVIDER_ENV,
            LLM_BASE_URL_ENV,
            LLM_API_KEY_ENV,
            LLM_MODEL_ENV,
            LLM_TIMEOUT_ENV,
        ],
    )?;
    load_llm_config_from_file(path)
}

fn load_history_from_project(project_root: &Path) -> Result<Vec<HistoryItemView>, String> {
    let history_path = project_root.join("work").join(HISTORY_FILE_NAME);
    if !history_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&history_path).map_err(|error| error.to_string())?;
    let history: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    let Some(items) = history.get("items").and_then(serde_json::Value::as_array) else {
        return Ok(vec![]);
    };

    Ok(items
        .iter()
        .filter_map(|item| history_item_from_value(project_root, item))
        .collect())
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

fn supported_asr_models() -> Vec<String> {
    SUPPORTED_ASR_MODELS
        .iter()
        .map(|model| (*model).to_string())
        .collect()
}

fn resolve_asr_model_value(value: Option<String>) -> Result<String, String> {
    let model = value.unwrap_or_default().trim().to_string();
    if model.is_empty() {
        return Ok(DEFAULT_ASR_MODEL.to_string());
    }

    if SUPPORTED_ASR_MODELS.contains(&model.as_str()) {
        Ok(model)
    } else {
        Err(format!("Unsupported ASR model: {model}"))
    }
}

fn history_item_from_value(
    project_root: &Path,
    item: &serde_json::Value,
) -> Option<HistoryItemView> {
    let transcript_path = optional_string(item, "transcript_path");
    let insights_path = optional_string(item, "insights_path");
    let text = transcript_path
        .as_deref()
        .and_then(|path| read_text_file_if_exists(project_root, path))
        .unwrap_or_default();
    let insights = insights_path
        .as_deref()
        .map(|path| read_insights_file_if_exists(project_root, path))
        .unwrap_or_default();

    Some(HistoryItemView {
        id: required_string(item, "id")?,
        created_at: required_string(item, "created_at")?,
        url: required_string(item, "url")?,
        status: required_string(item, "status")?,
        output_dir: required_string(item, "output_dir")?,
        video_path: optional_string(item, "video_path"),
        audio_path: optional_string(item, "audio_path"),
        transcript_path,
        insights_path,
        error: history_error_from_value(item.get("error")),
        text_preview: optional_string(item, "text_preview").unwrap_or_default(),
        insights_count: item
            .get("insights_count")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0) as usize,
        text,
        insights,
    })
}

fn history_error_from_value(value: Option<&serde_json::Value>) -> Option<HistoryErrorView> {
    let value = value?;
    if value.is_null() {
        return None;
    }

    Some(HistoryErrorView {
        code: required_string(value, "code")?,
        message: required_string(value, "message")?,
        stage: required_string(value, "stage")?,
    })
}

fn required_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::to_string)
}

fn optional_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn read_text_file_if_exists(project_root: &Path, raw_path: &str) -> Option<String> {
    let path = resolve_history_path(project_root, raw_path);
    fs::read_to_string(path)
        .ok()
        .map(|text| text.trim().to_string())
}

fn read_insights_file_if_exists(project_root: &Path, raw_path: &str) -> Vec<String> {
    let path = resolve_history_path(project_root, raw_path);
    let Ok(content) = fs::read_to_string(path) else {
        return vec![];
    };
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&content) else {
        return vec![];
    };
    let Some(insights) = payload
        .get("insights")
        .and_then(serde_json::Value::as_array)
    else {
        return vec![];
    };

    insights
        .iter()
        .filter_map(|item| {
            item.as_str().map(str::to_string).or_else(|| {
                item.get("text")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
        })
        .collect()
}

fn resolve_history_path(project_root: &Path, raw_path: &str) -> PathBuf {
    let path = PathBuf::from(raw_path);
    if path.is_absolute() {
        path
    } else {
        project_root.join(path)
    }
}

fn parse_dotenv_values(path: &Path) -> Result<HashMap<String, String>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut values = HashMap::new();
    for raw_line in content.lines() {
        let Some((key, value)) = parse_dotenv_assignment(raw_line) else {
            continue;
        };
        values.insert(key.to_string(), strip_env_quotes(value.trim()).to_string());
    }
    Ok(values)
}

fn write_dotenv_updates_removing(
    path: &Path,
    updates: &[(&str, String)],
    remove_keys: &[&str],
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let existing_content = if path.exists() {
        fs::read_to_string(path).map_err(|error| error.to_string())?
    } else {
        String::new()
    };
    let update_map: HashMap<&str, &str> = updates
        .iter()
        .map(|(key, value)| (*key, value.as_str()))
        .collect();
    let mut written_keys: Vec<String> = Vec::new();
    let mut lines = Vec::new();

    for line in existing_content.lines() {
        if let Some((key, _)) = parse_dotenv_assignment(line) {
            if remove_keys.iter().any(|remove_key| remove_key == &key) {
                continue;
            }

            if let Some(value) = update_map.get(key) {
                if !written_keys.iter().any(|written| written == key) {
                    lines.push(format!("{key}={value}"));
                    written_keys.push(key.to_string());
                }
                continue;
            }
        }

        lines.push(line.to_string());
    }

    for (key, value) in updates {
        if !written_keys.iter().any(|written| written == key) {
            lines.push(format!("{key}={value}"));
        }
    }

    fs::write(path, format!("{}\n", lines.join("\n"))).map_err(|error| error.to_string())
}

fn parse_dotenv_assignment(line: &str) -> Option<(&str, &str)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') || !line.contains('=') {
        return None;
    }

    let line = line.strip_prefix("export ").unwrap_or(line).trim();
    let (key, value) = line.split_once('=')?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }

    Some((key, value))
}

fn strip_env_quotes(value: &str) -> &str {
    if value.len() >= 2 {
        let first = value.as_bytes()[0];
        let last = value.as_bytes()[value.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return &value[1..value.len() - 1];
        }
    }

    value
}

fn sanitize_optional_env_value(value: String, label: &str) -> Result<String, String> {
    if value.contains('\n') || value.contains('\r') {
        return Err(format!("{label} must be a single line."));
    }

    Ok(value.trim().to_string())
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
    let output = Command::new("taskkill")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(WorkerProcessState::default()))
        .manage(Arc::new(ModelDownloadProcessState::default()))
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("frameq-deep-link-args", argv);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
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
            get_llm_config,
            save_llm_config,
            get_history,
            check_first_run,
            download_asr_model,
            cancel_asr_model_download,
            begin_auth_flow,
            complete_auth_flow,
            get_account_status,
            logout_account,
            redeem_activation_code,
            create_wechat_checkout,
            get_checkout_status,
            start_window_drag,
            close_window,
            minimize_window,
            toggle_maximize_window,
            get_window_position,
            set_window_position
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        apply_configured_asr_model_to_request, asr_model_available,
        build_activation_redeem_url, build_auth_login_url, build_model_download_command_spec,
        build_worker_command_spec, load_history_from_project, load_llm_config_from_file,
        normalize_resource_dir, parse_auth_callback_url, parse_worker_output_or_fallback,
        parse_worker_stdout, run_blocking_worker_command, save_llm_config_to_file,
        supported_asr_models, AuthCallback, LlmConfigInput, ProcessVideoRequest,
        ProcessVideoResult, RuntimePaths, ServerManagedLlmInvocation, WorkerCommandSpec,
        WorkerError, WorkerInvocation, WorkerProcessState,
    };
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
        let stdout = br#"[funasr] loading model cache
Some dependency logged to stdout
{"status":"completed","text":"ok","insights":["topic"],"transcript_path":"outputs/demo.txt","insights_path":"outputs/demo_insights.json","error":null}
"#;

        let parsed = parse_worker_stdout(stdout).expect("parse worker result");

        assert_eq!(parsed["status"], "completed");
        assert_eq!(parsed["text"], "ok");
        assert_eq!(parsed["insights"][0], "topic");
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
            video_path: None,
            audio_path: None,
            text: String::new(),
            insights: vec![],
            transcript_path: None,
            insights_path: None,
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
    fn parse_worker_output_fallback_includes_media_path_fields() {
        let output = Output {
            status: exit_status(1),
            stdout: b"not-json".to_vec(),
            stderr: b"worker failed before returning json".to_vec(),
        };
        let fallback = ProcessVideoResult {
            status: "failed".to_string(),
            video_path: None,
            audio_path: None,
            text: String::new(),
            insights: vec![],
            transcript_path: None,
            insights_path: None,
            error: Some(WorkerError {
                code: "WORKER_PROCESS_FAILED".to_string(),
                message: "worker failed before returning json".to_string(),
                stage: "video_extracting".to_string(),
            }),
        };

        let parsed = parse_worker_output_or_fallback(&output, fallback)
            .expect("fallback worker result");

        assert!(parsed.get("video_path").is_some());
        assert!(parsed.get("audio_path").is_some());
        assert_eq!(parsed["video_path"], serde_json::Value::Null);
        assert_eq!(parsed["audio_path"], serde_json::Value::Null);
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
            env.get("FRAMEQ_WORK_DIR"),
            Some(&"C:/Users/demo/AppData/Local/com.frameq.desktop/work".to_string())
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

    #[test]
    fn normalize_resource_dir_uses_packaged_resources_subdir_when_tauri_returns_install_root() {
        let root = temp_dir("normalize_resource_dir_uses_packaged_resources_subdir");
        let install_root = root.join("FrameQ");
        let resources = install_root.join("resources");
        fs::create_dir_all(resources.join("python")).expect("create packaged python dir");
        fs::write(resources.join("python").join("python.exe"), "python").expect("write python");

        assert_eq!(normalize_resource_dir(install_root), resources);
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
        let request_json =
            r#"{"url":"https://www.douyin.com/video/7524373044106677544","generate_insights":true}"#;

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
        let request_json =
            r#"{"url":"https://www.douyin.com/video/7524373044106677544","generate_insights":false}"#;

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
    fn auth_login_url_includes_state_and_redirect_scheme() {
        let url = build_auth_login_url("https://frameq.example", "state-123456")
            .expect("build auth url");

        assert_eq!(
            url,
            "https://frameq.example/login?desktop=1&state=state-123456&redirect_uri=frameq%3A%2F%2Fauth%2Fcallback"
        );
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
        assert!(!saved.contains("FRAMEQ_LLM_API_KEY"));
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

    #[test]
    fn load_history_from_project_reads_items_and_available_result_text() {
        let project_root = temp_dir("load_history_from_project");
        let output_dir = project_root.join("outputs");
        let work_dir = project_root.join("work");
        fs::create_dir_all(&output_dir).expect("create output dir");
        fs::create_dir_all(&work_dir).expect("create work dir");
        let transcript_path = output_dir.join("demo_transcript.txt");
        let insights_path = output_dir.join("demo_insights.json");
        fs::write(&transcript_path, "完整文字稿内容").expect("write transcript");
        fs::write(
            &insights_path,
            r#"{"file_id":"demo","insights":[{"id":1,"text":"第一个话题点"},{"id":2,"text":"第二个话题点"}]}"#,
        )
        .expect("write insights");
        fs::write(
            work_dir.join("history.json"),
            format!(
                r#"{{
  "items": [
    {{
      "id": "20260617183000-demo",
      "created_at": "2026-06-17T18:30:00Z",
      "url": "https://www.douyin.com/video/7646789377271647540",
      "status": "completed",
      "output_dir": "{}",
      "video_path": "{}",
      "audio_path": "{}",
      "transcript_path": "{}",
      "insights_path": "{}",
      "error": null,
      "text_preview": "完整文字稿内容",
      "insights_count": 2
    }}
  ]
}}"#,
                path_string(&output_dir),
                path_string(&output_dir.join("demo.mp4")),
                path_string(&work_dir.join("demo.wav")),
                path_string(&transcript_path),
                path_string(&insights_path)
            ),
        )
        .expect("write history");

        let history = load_history_from_project(&project_root).expect("load history");

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "20260617183000-demo");
        assert_eq!(history[0].status, "completed");
        assert_eq!(history[0].text, "完整文字稿内容");
        assert_eq!(history[0].insights, vec!["第一个话题点", "第二个话题点"]);
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

    fn path_string(path: &std::path::Path) -> String {
        path.to_string_lossy().replace('\\', "/")
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
