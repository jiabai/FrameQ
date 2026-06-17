use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, State, Window};

const PROGRESS_EVENT_NAME: &str = "worker-progress";
const PROGRESS_EVENT_PREFIX: &str = "FRAMEQ_PROGRESS ";
const DOTENV_FILE_NAME: &str = ".env";
const LLM_PROVIDER_ENV: &str = "FRAMEQ_LLM_PROVIDER";
const LLM_BASE_URL_ENV: &str = "FRAMEQ_LLM_BASE_URL";
const LLM_API_KEY_ENV: &str = "FRAMEQ_LLM_API_KEY";
const LLM_MODEL_ENV: &str = "FRAMEQ_LLM_MODEL";
const LLM_TIMEOUT_ENV: &str = "FRAMEQ_LLM_TIMEOUT_SECONDS";
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
}

#[derive(Debug, Serialize)]
struct LlmConfigView {
    provider: String,
    base_url: String,
    model: String,
    timeout_seconds: String,
    has_api_key: bool,
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
fn process_video(
    window: Window,
    process_state: State<'_, WorkerProcessState>,
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
fn retry_insights(
    process_state: State<'_, WorkerProcessState>,
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
    process_state: State<'_, WorkerProcessState>,
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
        has_api_key: values
            .get(LLM_API_KEY_ENV)
            .is_some_and(|value| !value.trim().is_empty()),
    })
}

fn save_llm_config_to_file(path: &Path, config: LlmConfigInput) -> Result<LlmConfigView, String> {
    let existing_values = parse_dotenv_values(path)?;
    let base_url = sanitize_required_env_value(config.base_url, "LLM base URL")?;
    if !base_url.starts_with("https://") && !base_url.starts_with("http://") {
        return Err("LLM base URL must start with http:// or https://.".to_string());
    }

    let model = sanitize_required_env_value(config.model, "LLM model")?;
    let timeout_seconds = sanitize_optional_env_value(config.timeout_seconds, LLM_TIMEOUT_ENV)?;
    let timeout_seconds = if timeout_seconds.is_empty() {
        DEFAULT_LLM_TIMEOUT_SECONDS.to_string()
    } else {
        timeout_seconds
    };
    validate_timeout_seconds(&timeout_seconds)?;

    let new_api_key = sanitize_optional_env_value(config.api_key, LLM_API_KEY_ENV)?;
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
    ];
    write_dotenv_updates(path, &updates)?;
    load_llm_config_from_file(path)
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

fn sanitize_required_env_value(value: String, label: &str) -> Result<String, String> {
    let value = sanitize_optional_env_value(value, label)?;
    if value.is_empty() {
        Err(format!("{label} is required."))
    } else {
        Ok(value)
    }
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
        .manage(WorkerProcessState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            process_video,
            retry_insights,
            cancel_process,
            get_llm_config,
            save_llm_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        load_llm_config_from_file, save_llm_config_to_file, LlmConfigInput, WorkerProcessState,
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
            ]
            .join("\n"),
        )
        .expect("write test env");

        let config = load_llm_config_from_file(&env_path).expect("load config");

        assert_eq!(config.provider, "openai_compatible");
        assert_eq!(config.base_url, "https://llm.example/v1");
        assert_eq!(config.model, "demo-model");
        assert_eq!(config.timeout_seconds, "42");
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
            },
        )
        .expect_err("missing key should fail");

        assert_eq!(error, "LLM API key is required unless one is already saved.");
    }

    fn temp_env_path(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("frameq-{test_name}-{unique}"));
        fs::create_dir_all(&dir).expect("create test dir");
        dir.join(".env")
    }
}
