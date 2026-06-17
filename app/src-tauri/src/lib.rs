use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State, Window};

const PROGRESS_EVENT_NAME: &str = "worker-progress";
const PROGRESS_EVENT_PREFIX: &str = "FRAMEQ_PROGRESS ";
const DOTENV_FILE_NAME: &str = ".env";
const LLM_PROVIDER_ENV: &str = "FRAMEQ_LLM_PROVIDER";
const LLM_BASE_URL_ENV: &str = "FRAMEQ_LLM_BASE_URL";
const LLM_API_KEY_ENV: &str = "FRAMEQ_LLM_API_KEY";
const LLM_MODEL_ENV: &str = "FRAMEQ_LLM_MODEL";
const LLM_TIMEOUT_ENV: &str = "FRAMEQ_LLM_TIMEOUT_SECONDS";
const OUTPUT_DIR_ENV: &str = "FRAMEQ_OUTPUT_DIR";
const HISTORY_FILE_NAME: &str = "history.json";
const DEFAULT_LLM_PROVIDER: &str = "openai_compatible";
const DEFAULT_LLM_TIMEOUT_SECONDS: &str = "60";

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
    base_url: String,
    api_key: String,
    model: String,
    timeout_seconds: String,
    #[serde(default)]
    output_dir: String,
}

#[derive(Debug, Serialize)]
struct LlmConfigView {
    provider: String,
    base_url: String,
    model: String,
    timeout_seconds: String,
    output_dir: String,
    has_api_key: bool,
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

#[tauri::command]
async fn process_video(
    window: Window,
    process_state: State<'_, Arc<WorkerProcessState>>,
    request: ProcessVideoRequest,
) -> Result<serde_json::Value, String> {
    let process_state = Arc::clone(process_state.inner());
    run_blocking_worker_command(move || process_video_blocking(window, process_state, request))
        .await
}

fn process_video_blocking(
    window: Window,
    process_state: Arc<WorkerProcessState>,
    request: ProcessVideoRequest,
) -> Result<serde_json::Value, String> {
    let project_root = find_project_root()
        .ok_or_else(|| "Could not find FrameQ project root for worker execution.".to_string())?;
    let request_json = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    let worker_path = project_root.join("worker");
    let mut child = Command::new("uv")
        .args(["run", "python", "-m", "frameq_worker", "--request-json", &request_json])
        .env("PYTHONPATH", worker_path)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .current_dir(project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let worker_pid = child.id();
    if !process_state.register(worker_pid) {
        let _ = terminate_process_tree(worker_pid);
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "failed".to_string(),
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

    if !output.status.success() {
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "failed".to_string(),
            text: String::new(),
            insights: vec![],
            transcript_path: None,
            insights_path: None,
            error: Some(WorkerError {
                code: "WORKER_PROCESS_FAILED".to_string(),
                message: stderr,
                stage: "video_extracting".to_string(),
            }),
        }));
    }

    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
}

#[tauri::command]
async fn retry_insights(
    process_state: State<'_, Arc<WorkerProcessState>>,
    request: RetryInsightsRequest,
) -> Result<serde_json::Value, String> {
    let process_state = Arc::clone(process_state.inner());
    run_blocking_worker_command(move || retry_insights_blocking(process_state, request)).await
}

fn retry_insights_blocking(
    process_state: Arc<WorkerProcessState>,
    request: RetryInsightsRequest,
) -> Result<serde_json::Value, String> {
    let project_root = find_project_root()
        .ok_or_else(|| "Could not find FrameQ project root for worker execution.".to_string())?;
    let request_json = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    let worker_path = project_root.join("worker");
    let child = Command::new("uv")
        .args([
            "run",
            "python",
            "-m",
            "frameq_worker",
            "--retry-insights-json",
            &request_json,
        ])
        .env("PYTHONPATH", worker_path)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .current_dir(project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let worker_pid = child.id();
    if !process_state.register(worker_pid) {
        let _ = terminate_process_tree(worker_pid);
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "partial_completed".to_string(),
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

    if !output.status.success() {
        return Ok(serde_json::json!(ProcessVideoResult {
            status: "partial_completed".to_string(),
            text: request.text,
            insights: vec![],
            transcript_path: Some(request.transcript_path),
            insights_path: None,
            error: Some(WorkerError {
                code: "WORKER_PROCESS_FAILED".to_string(),
                message: String::from_utf8_lossy(&output.stderr).to_string(),
                stage: "insights_generating".to_string(),
            }),
        }));
    }

    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
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
fn get_llm_config() -> Result<LlmConfigView, String> {
    let project_root = find_project_root()
        .ok_or_else(|| "Could not find FrameQ project root for configuration.".to_string())?;
    load_llm_config_from_file(&project_root.join(DOTENV_FILE_NAME))
}

#[tauri::command]
fn save_llm_config(config: LlmConfigInput) -> Result<LlmConfigView, String> {
    let project_root = find_project_root()
        .ok_or_else(|| "Could not find FrameQ project root for configuration.".to_string())?;
    save_llm_config_to_file(&project_root.join(DOTENV_FILE_NAME), config)
}

#[tauri::command]
fn get_history() -> Result<Vec<HistoryItemView>, String> {
    let project_root = find_project_root()
        .ok_or_else(|| "Could not find FrameQ project root for history.".to_string())?;
    load_history_from_project(&project_root)
}

fn load_llm_config_from_file(path: &Path) -> Result<LlmConfigView, String> {
    let values = parse_dotenv_values(path)?;
    Ok(LlmConfigView {
        provider: values
            .get(LLM_PROVIDER_ENV)
            .cloned()
            .unwrap_or_else(|| DEFAULT_LLM_PROVIDER.to_string()),
        base_url: values.get(LLM_BASE_URL_ENV).cloned().unwrap_or_default(),
        model: values.get(LLM_MODEL_ENV).cloned().unwrap_or_default(),
        timeout_seconds: values
            .get(LLM_TIMEOUT_ENV)
            .cloned()
            .unwrap_or_else(|| DEFAULT_LLM_TIMEOUT_SECONDS.to_string()),
        output_dir: values.get(OUTPUT_DIR_ENV).cloned().unwrap_or_default(),
        has_api_key: values
            .get(LLM_API_KEY_ENV)
            .is_some_and(|value| !value.trim().is_empty()),
    })
}

fn save_llm_config_to_file(path: &Path, config: LlmConfigInput) -> Result<LlmConfigView, String> {
    let existing_values = parse_dotenv_values(path)?;
    let base_url = sanitize_optional_env_value(config.base_url, "LLM base URL")?;
    let model = sanitize_optional_env_value(config.model, "LLM model")?;
    let timeout_seconds = sanitize_optional_env_value(config.timeout_seconds, LLM_TIMEOUT_ENV)?;
    let output_dir = sanitize_optional_env_value(config.output_dir, OUTPUT_DIR_ENV)?;
    let new_api_key = sanitize_optional_env_value(config.api_key, LLM_API_KEY_ENV)?;
    let should_save_llm =
        !base_url.is_empty() || !model.is_empty() || !new_api_key.is_empty();

    if !should_save_llm {
        write_dotenv_updates(path, &[(OUTPUT_DIR_ENV, output_dir)])?;
        return load_llm_config_from_file(path);
    }

    if base_url.is_empty() {
        return Err("LLM base URL is required.".to_string());
    }
    if !base_url.starts_with("https://") && !base_url.starts_with("http://") {
        return Err("LLM base URL must start with http:// or https://.".to_string());
    }

    if model.is_empty() {
        return Err("LLM model is required.".to_string());
    }

    let timeout_seconds = if timeout_seconds.is_empty() {
        DEFAULT_LLM_TIMEOUT_SECONDS.to_string()
    } else {
        timeout_seconds
    };
    validate_timeout_seconds(&timeout_seconds)?;

    let existing_api_key = existing_values
        .get(LLM_API_KEY_ENV)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let api_key_to_save = if new_api_key.is_empty() {
        existing_api_key
            .ok_or_else(|| "LLM API key is required unless one is already saved.".to_string())?
            .to_string()
    } else {
        new_api_key
    };

    let updates = [
        (LLM_PROVIDER_ENV, DEFAULT_LLM_PROVIDER.to_string()),
        (LLM_BASE_URL_ENV, base_url),
        (LLM_API_KEY_ENV, api_key_to_save),
        (LLM_MODEL_ENV, model),
        (LLM_TIMEOUT_ENV, timeout_seconds),
        (OUTPUT_DIR_ENV, output_dir),
    ];
    write_dotenv_updates(path, &updates)?;
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

fn history_item_from_value(project_root: &Path, item: &serde_json::Value) -> Option<HistoryItemView> {
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
    fs::read_to_string(path).ok().map(|text| text.trim().to_string())
}

fn read_insights_file_if_exists(project_root: &Path, raw_path: &str) -> Vec<String> {
    let path = resolve_history_path(project_root, raw_path);
    let Ok(content) = fs::read_to_string(path) else {
        return vec![];
    };
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&content) else {
        return vec![];
    };
    let Some(insights) = payload.get("insights").and_then(serde_json::Value::as_array) else {
        return vec![];
    };

    insights
        .iter()
        .filter_map(|item| {
            item.as_str()
                .map(str::to_string)
                .or_else(|| item.get("text").and_then(serde_json::Value::as_str).map(str::to_string))
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

fn write_dotenv_updates(path: &Path, updates: &[(&str, String)]) -> Result<(), String> {
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

fn validate_timeout_seconds(value: &str) -> Result<(), String> {
    match value.parse::<f64>() {
        Ok(timeout) if timeout > 0.0 => Ok(()),
        _ => Err("LLM timeout must be a positive number of seconds.".to_string()),
    }
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

fn find_project_root() -> Option<PathBuf> {
    let current_dir = std::env::current_dir().ok()?;
    current_dir
        .ancestors()
        .find(|path| is_project_root(path))
        .map(Path::to_path_buf)
}

fn is_project_root(path: &Path) -> bool {
    path.join("pyproject.toml").exists() && path.join("worker").exists()
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(WorkerProcessState::default()))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            process_video,
            retry_insights,
            cancel_process,
            get_llm_config,
            save_llm_config,
            get_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        load_history_from_project, load_llm_config_from_file, run_blocking_worker_command,
        save_llm_config_to_file, LlmConfigInput, WorkerProcessState,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

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

        let ran_on_background_thread = tauri::async_runtime::block_on(
            run_blocking_worker_command(move || {
                Ok(std::thread::current().id() != caller_thread)
            }),
        )
        .expect("blocking command should complete");

        assert!(ran_on_background_thread);
    }

    #[test]
    fn load_llm_config_hides_saved_api_key() {
        let env_path = temp_env_path("load_llm_config_hides_saved_api_key");
        fs::write(
            &env_path,
            [
                "FRAMEQ_LLM_PROVIDER=openai_compatible",
                "FRAMEQ_LLM_BASE_URL=https://llm.example/v1",
                "FRAMEQ_LLM_API_KEY=secret-key",
                "FRAMEQ_LLM_MODEL=demo-model",
                "FRAMEQ_LLM_TIMEOUT_SECONDS=42",
                "FRAMEQ_OUTPUT_DIR=D:/FrameQ/results",
            ]
            .join("\n"),
        )
        .expect("write test env");

        let config = load_llm_config_from_file(&env_path).expect("load config");

        assert_eq!(config.provider, "openai_compatible");
        assert_eq!(config.base_url, "https://llm.example/v1");
        assert_eq!(config.model, "demo-model");
        assert_eq!(config.timeout_seconds, "42");
        assert_eq!(config.output_dir, "D:/FrameQ/results");
        assert!(config.has_api_key);
    }

    #[test]
    fn save_llm_config_preserves_existing_key_when_new_key_is_blank() {
        let env_path = temp_env_path("save_llm_config_preserves_existing_key");
        fs::write(
            &env_path,
            [
                "# keep this comment",
                "FRAMEQ_LLM_API_KEY=old-secret",
                "OTHER_SETTING=keep-me",
            ]
            .join("\n"),
        )
        .expect("write test env");

        let config = save_llm_config_to_file(
            &env_path,
            LlmConfigInput {
                base_url: "https://new.example/v1".to_string(),
                api_key: "".to_string(),
                model: "new-model".to_string(),
                timeout_seconds: "35".to_string(),
                output_dir: "D:/FrameQ/custom-results".to_string(),
            },
        )
        .expect("save config");
        let saved = fs::read_to_string(&env_path).expect("read saved env");

        assert!(config.has_api_key);
        assert!(saved.contains("FRAMEQ_LLM_PROVIDER=openai_compatible"));
        assert!(saved.contains("FRAMEQ_LLM_BASE_URL=https://new.example/v1"));
        assert!(saved.contains("FRAMEQ_LLM_API_KEY=old-secret"));
        assert!(saved.contains("FRAMEQ_LLM_MODEL=new-model"));
        assert!(saved.contains("FRAMEQ_LLM_TIMEOUT_SECONDS=35"));
        assert!(saved.contains("FRAMEQ_OUTPUT_DIR=D:/FrameQ/custom-results"));
        assert!(saved.contains("OTHER_SETTING=keep-me"));
    }

    #[test]
    fn save_llm_config_rejects_missing_api_key_when_none_is_saved() {
        let env_path = temp_env_path("save_llm_config_rejects_missing_key");

        let error = save_llm_config_to_file(
            &env_path,
            LlmConfigInput {
                base_url: "https://llm.example/v1".to_string(),
                api_key: "".to_string(),
                model: "demo-model".to_string(),
                timeout_seconds: "30".to_string(),
                output_dir: "".to_string(),
            },
        )
        .expect_err("missing key should fail");

        assert_eq!(error, "LLM API key is required unless one is already saved.");
    }

    #[test]
    fn save_llm_config_allows_output_dir_without_llm_credentials() {
        let env_path = temp_env_path("save_llm_config_allows_output_dir_only");

        let config = save_llm_config_to_file(
            &env_path,
            LlmConfigInput {
                base_url: "".to_string(),
                api_key: "".to_string(),
                model: "".to_string(),
                timeout_seconds: "".to_string(),
                output_dir: "D:/FrameQ/results-only".to_string(),
            },
        )
        .expect("save output directory");
        let saved = fs::read_to_string(&env_path).expect("read saved env");

        assert_eq!(config.output_dir, "D:/FrameQ/results-only");
        assert!(!config.has_api_key);
        assert!(saved.contains("FRAMEQ_OUTPUT_DIR=D:/FrameQ/results-only"));
        assert!(!saved.contains("FRAMEQ_LLM_API_KEY"));
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
}
