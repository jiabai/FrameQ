use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{Emitter, Window};

const PROGRESS_EVENT_NAME: &str = "worker-progress";
const PROGRESS_EVENT_PREFIX: &str = "FRAMEQ_PROGRESS ";

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

#[tauri::command]
fn process_video(window: Window, request: ProcessVideoRequest) -> Result<serde_json::Value, String> {
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

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture worker stderr.".to_string())?;
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

    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    let stderr = stderr_reader
        .join()
        .unwrap_or_else(|_| "Worker stderr reader failed.".to_string());

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
fn retry_insights(request: RetryInsightsRequest) -> Result<serde_json::Value, String> {
    let project_root = find_project_root()
        .ok_or_else(|| "Could not find FrameQ project root for worker execution.".to_string())?;
    let request_json = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    let worker_path = project_root.join("worker");
    let output = Command::new("uv")
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
        .output()
        .map_err(|error| error.to_string())?;

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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, process_video, retry_insights])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
