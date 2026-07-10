use crate::account;
use crate::settings::{
    legacy_local_llm_env_removals, LLM_CHECKOUT_REQUEST_ID_ENV, LLM_CHECKOUT_URL_ENV,
    LLM_SESSION_TOKEN_ENV, LLM_SOURCE_ENV,
};
use crate::task_manifest;
use crate::{
    bundled_python_path, path_to_env_string, prepend_to_path, sanitize_diagnostic_text,
    truncate_for_log, ProcessVideoResult, RuntimePaths, ALLOW_REAL_ASR_ENV, CACHE_DIR_ENV,
    CACHE_DIR_NAME, MODELSCOPE_OFFLINE_ENV, MODEL_DIR_ENV, OUTPUT_DIR_ENV, RESOURCE_DIR_ENV,
    USER_DATA_DIR_ENV,
};
#[cfg(test)]
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::Mutex;

#[cfg(target_os = "windows")]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone)]
pub(crate) enum WorkerInvocation {
    ProcessVideo(String),
    RetryInsights(String),
    ResolveSourceIdentity(String),
    MigrateSourceData,
}

#[derive(Clone)]
pub(crate) struct WorkerCommandSpec {
    pub(crate) program: PathBuf,
    pub(crate) args: Vec<String>,
    pub(crate) env: Vec<(String, String)>,
    pub(crate) env_remove: Vec<String>,
    pub(crate) current_dir: PathBuf,
}

impl WorkerCommandSpec {
    #[cfg(test)]
    pub(crate) fn env_map(&self) -> HashMap<String, String> {
        self.env.iter().cloned().collect()
    }
}

#[derive(Default)]
pub(crate) struct WorkerProcessState {
    current_pid: Mutex<Option<u32>>,
    cancelled_pid: Mutex<Option<u32>>,
}

impl WorkerProcessState {
    pub(crate) fn register(&self, pid: u32) -> bool {
        let mut current_pid = self.current_pid.lock().expect("worker state lock poisoned");
        if current_pid.is_some() {
            return false;
        }

        *current_pid = Some(pid);
        true
    }

    pub(crate) fn current_pid(&self) -> Option<u32> {
        *self.current_pid.lock().expect("worker state lock poisoned")
    }

    pub(crate) fn clear_current(&self, pid: u32) {
        let mut current_pid = self.current_pid.lock().expect("worker state lock poisoned");
        if *current_pid == Some(pid) {
            *current_pid = None;
        }
    }

    pub(crate) fn mark_cancelled(&self, pid: u32) {
        let mut cancelled_pid = self
            .cancelled_pid
            .lock()
            .expect("worker cancelled state lock poisoned");
        *cancelled_pid = Some(pid);
    }

    pub(crate) fn take_cancelled(&self, pid: u32) -> bool {
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

pub(crate) fn worker_command_log_detail(spec: &WorkerCommandSpec, kind: &str) -> String {
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
        if arg == "--request-json"
            || arg == "--retry-insights-json"
            || arg == "--resolve-source-json"
        {
            redact_next = true;
        }
    }

    redacted
}

pub(crate) fn worker_exit_log_detail(pid: u32, output: &Output, stderr: &str) -> String {
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

pub(crate) fn build_worker_command_spec(
    paths: &RuntimePaths,
    invocation: WorkerInvocation,
    server_managed_llm: Option<account::ServerManagedLlmInvocation>,
) -> Result<WorkerCommandSpec, String> {
    let include_server_managed_llm = worker_invocation_uses_server_managed_llm(&invocation);
    let args = match invocation {
        WorkerInvocation::ProcessVideo(payload) => {
            vec!["--request-json".to_string(), payload]
        }
        WorkerInvocation::RetryInsights(payload) => {
            vec!["--retry-insights-json".to_string(), payload]
        }
        WorkerInvocation::ResolveSourceIdentity(payload) => {
            vec!["--resolve-source-json".to_string(), payload]
        }
        WorkerInvocation::MigrateSourceData => vec!["--migrate-source-data".to_string()],
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
        args: [vec!["-m".to_string(), "frameq_worker".to_string()], args].concat(),
        env,
        env_remove: legacy_local_llm_env_removals(),
        current_dir: paths.user_data_dir.clone(),
    })
}

pub(crate) fn migrate_legacy_source_data_if_needed(paths: &RuntimePaths) -> Result<(), String> {
    let output_root = task_manifest::configured_output_root(paths)?;
    if !task_manifest::has_legacy_source_data(&output_root)? {
        return Ok(());
    }
    let spec = build_worker_command_spec(paths, WorkerInvocation::MigrateSourceData, None)?;
    let output = spawn_worker_command(spec)?
        .wait_with_output()
        .map_err(|_| "Source metadata migration worker failed to finish.".to_string())?;
    if !output.status.success() {
        return Err("Source metadata migration worker failed.".to_string());
    }
    let result = parse_worker_stdout(&output.stdout)
        .map_err(|_| "Source metadata migration returned an invalid result.".to_string())?;
    if result.get("status").and_then(serde_json::Value::as_str) == Some("completed") {
        Ok(())
    } else {
        Err("Source metadata migration did not complete.".to_string())
    }
}

fn worker_invocation_uses_server_managed_llm(invocation: &WorkerInvocation) -> bool {
    match invocation {
        WorkerInvocation::RetryInsights(_) => true,
        WorkerInvocation::ProcessVideo(_)
        | WorkerInvocation::ResolveSourceIdentity(_)
        | WorkerInvocation::MigrateSourceData => false,
    }
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

pub(crate) fn spawn_worker_command(spec: WorkerCommandSpec) -> Result<std::process::Child, String> {
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

pub(crate) fn parse_worker_stdout(stdout: &[u8]) -> Result<serde_json::Value, String> {
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
    let preview = sanitize_diagnostic_text(&preview);
    let detail = last_error.unwrap_or_else(|| "stdout did not contain JSON".to_string());
    Err(format!(
        "Worker stdout did not contain a structured JSON result: {detail}. stdout preview: {preview}"
    ))
}

pub(crate) fn parse_worker_output_or_fallback(
    output: &Output,
    fallback: ProcessVideoResult,
) -> Result<serde_json::Value, String> {
    match parse_worker_stdout(&output.stdout) {
        Ok(value) => Ok(value),
        Err(error) if output.status.success() => Err(error),
        Err(_) => Ok(serde_json::json!(fallback)),
    }
}

pub(crate) async fn run_blocking_worker_command<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Worker command task failed: {error}"))?
}

#[cfg(target_os = "windows")]
pub(crate) fn terminate_process_tree(pid: u32) -> Result<(), String> {
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
pub(crate) fn terminate_process_tree(pid: u32) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::{
        build_worker_command_spec, parse_worker_output_or_fallback, parse_worker_stdout,
        redact_worker_args_for_log, run_blocking_worker_command, WorkerCommandSpec,
        WorkerInvocation, WorkerProcessState,
    };
    use crate::account::ServerManagedLlmInvocation;
    use crate::{ProcessVideoResult, RuntimePaths, WorkerError};
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::process::Output;

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
    fn source_identity_preflight_payload_is_redacted_from_logs() {
        let secret_payload = r#"{"url":"https://xhslink.com/o/demo?xsec_token=review-secret"}"#;
        let redacted = redact_worker_args_for_log(&[
            "-m".to_string(),
            "frameq_worker".to_string(),
            "--resolve-source-json".to_string(),
            secret_payload.to_string(),
        ])
        .join(" ");

        assert!(redacted.contains("[json-payload]"));
        assert!(!redacted.contains("review-secret"));
        assert!(!redacted.contains("xsec_token"));
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
    fn worker_command_spec_skips_server_managed_llm_for_process_video_even_if_payload_requests_ai()
    {
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
        assert_eq!(env.get("FRAMEQ_LLM_SOURCE"), None);
        assert_eq!(env.get("FRAMEQ_LLM_CHECKOUT_URL"), None);
        assert_eq!(env.get("FRAMEQ_LLM_SESSION_TOKEN"), None);
        assert_eq!(env.get("FRAMEQ_LLM_CHECKOUT_REQUEST_ID"), None);
    }

    #[test]
    fn worker_command_spec_includes_server_managed_llm_checkout_env_for_retry_insights() {
        let paths = RuntimePaths {
            resource_dir: PathBuf::from("C:/Program Files/FrameQ/resources"),
            user_data_dir: PathBuf::from("C:/Users/demo/AppData/Local/com.frameq.desktop"),
        };
        let request_json = r#"{"task_id":"20260705-153012-douyin-demo","target":"summary"}"#;

        let spec = build_worker_command_spec(
            &paths,
            WorkerInvocation::RetryInsights(request_json.to_string()),
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
