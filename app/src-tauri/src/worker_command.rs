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
use serde::Serialize;
#[cfg(test)]
use std::collections::HashMap;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::Mutex;
#[cfg(unix)]
use std::time::Duration;

#[cfg(target_os = "windows")]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;
const MAX_WORKER_STDIN_PAYLOAD_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub(crate) enum WorkerInvocation {
    ProcessVideo(String),
    RetryInsights(String),
    ResolveSourceIdentity(String),
}

#[derive(Clone)]
pub(crate) struct WorkerCommandSpec {
    pub(crate) program: PathBuf,
    pub(crate) args: Vec<String>,
    pub(crate) stdin_payload: Option<String>,
    pub(crate) env: Vec<(String, String)>,
    pub(crate) env_remove: Vec<String>,
    pub(crate) current_dir: PathBuf,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum SupervisedSpawnError {
    AlreadyRunning,
    Cancelled,
    Failed(String),
}

impl WorkerCommandSpec {
    #[cfg(test)]
    pub(crate) fn env_map(&self) -> HashMap<String, String> {
        self.env.iter().cloned().collect()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProcessPhase {
    Running,
    Cancelling,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ProcessInstance {
    pub(crate) instance_id: u64,
    pub(crate) pid: u32,
    pub(crate) process_group_id: Option<u32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CancelClaim {
    Claimed(ProcessInstance),
    AlreadyCancelling(ProcessInstance),
    NotRunning,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum CancelRequestOutcome {
    Signalled(ProcessInstance),
    AlreadyCancelling(ProcessInstance),
    NotRunning,
    Failed {
        instance: ProcessInstance,
        error: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CancelProcessStatus {
    Cancelling,
    AlreadyCancelling,
    NotRunning,
    Failed,
}

#[derive(Debug, Serialize)]
pub(crate) struct CancelProcessResult {
    pub(crate) status: CancelProcessStatus,
    pub(crate) error: Option<String>,
}

#[derive(Default)]
pub(crate) struct ProcessSupervisor {
    state: Mutex<ProcessSupervisorState>,
}

#[derive(Default)]
pub(crate) struct ProcessSupervisors {
    pub(crate) video: ProcessSupervisor,
    pub(crate) asr_model_download: ProcessSupervisor,
}

#[derive(Default)]
struct ProcessSupervisorState {
    next_instance_id: u64,
    current: Option<(ProcessInstance, ProcessPhase)>,
}

impl ProcessSupervisor {
    pub(crate) fn start(&self, pid: u32) -> Option<ProcessInstance> {
        let mut state = self.state.lock().expect("process supervisor lock poisoned");
        if state.current.is_some() {
            return None;
        }

        state.next_instance_id += 1;
        let instance = ProcessInstance {
            instance_id: state.next_instance_id,
            pid,
            process_group_id: cfg!(unix).then_some(pid),
        };
        state.current = Some((instance, ProcessPhase::Running));
        Some(instance)
    }

    #[cfg(test)]
    pub(crate) fn current(&self) -> Option<ProcessInstance> {
        self.state
            .lock()
            .expect("process supervisor lock poisoned")
            .current
            .map(|(instance, _)| instance)
    }

    #[cfg(test)]
    pub(crate) fn phase(&self) -> Option<ProcessPhase> {
        self.state
            .lock()
            .expect("process supervisor lock poisoned")
            .current
            .map(|(_, phase)| phase)
    }

    pub(crate) fn claim_cancel(&self) -> CancelClaim {
        let mut state = self.state.lock().expect("process supervisor lock poisoned");
        match state.current.as_mut() {
            Some((instance, phase @ ProcessPhase::Running)) => {
                *phase = ProcessPhase::Cancelling;
                CancelClaim::Claimed(*instance)
            }
            Some((instance, ProcessPhase::Cancelling)) => CancelClaim::AlreadyCancelling(*instance),
            None => CancelClaim::NotRunning,
        }
    }

    pub(crate) fn restore_running(&self, instance_id: u64) -> bool {
        let mut state = self.state.lock().expect("process supervisor lock poisoned");
        match state.current.as_mut() {
            Some((instance, phase @ ProcessPhase::Cancelling))
                if instance.instance_id == instance_id =>
            {
                *phase = ProcessPhase::Running;
                true
            }
            _ => false,
        }
    }

    pub(crate) fn finish(&self, instance_id: u64) -> Option<ProcessPhase> {
        let mut state = self.state.lock().expect("process supervisor lock poisoned");
        let (instance, phase) = state.current?;
        if instance.instance_id != instance_id {
            return None;
        }
        state.current = None;
        Some(phase)
    }

    pub(crate) fn request_cancel<F>(&self, terminate: F) -> CancelRequestOutcome
    where
        F: FnOnce(ProcessInstance) -> Result<(), String>,
    {
        match self.claim_cancel() {
            CancelClaim::Claimed(instance) => match terminate(instance) {
                Ok(()) => CancelRequestOutcome::Signalled(instance),
                Err(error) => {
                    self.restore_running(instance.instance_id);
                    CancelRequestOutcome::Failed { instance, error }
                }
            },
            CancelClaim::AlreadyCancelling(instance) => {
                CancelRequestOutcome::AlreadyCancelling(instance)
            }
            CancelClaim::NotRunning => CancelRequestOutcome::NotRunning,
        }
    }
}

pub(crate) fn request_process_cancellation(supervisor: &ProcessSupervisor) -> CancelProcessResult {
    match supervisor.request_cancel(|instance| {
        terminate_process_tree(instance.process_group_id.unwrap_or(instance.pid))
    }) {
        CancelRequestOutcome::Signalled(_) => CancelProcessResult {
            status: CancelProcessStatus::Cancelling,
            error: None,
        },
        CancelRequestOutcome::AlreadyCancelling(_) => CancelProcessResult {
            status: CancelProcessStatus::AlreadyCancelling,
            error: None,
        },
        CancelRequestOutcome::NotRunning => CancelProcessResult {
            status: CancelProcessStatus::NotRunning,
            error: None,
        },
        CancelRequestOutcome::Failed { error, .. } => CancelProcessResult {
            status: CancelProcessStatus::Failed,
            error: Some(error),
        },
    }
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProcessPlatform {
    Windows,
    Unix,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProcessSignal {
    Term,
    Kill,
}

pub(crate) fn termination_command_spec(
    platform: ProcessPlatform,
    pid: u32,
    signal: ProcessSignal,
) -> (String, Vec<String>) {
    match platform {
        ProcessPlatform::Windows => (
            "taskkill".to_string(),
            vec![
                "/PID".to_string(),
                pid.to_string(),
                "/T".to_string(),
                "/F".to_string(),
            ],
        ),
        ProcessPlatform::Unix => (
            "kill".to_string(),
            vec![
                match signal {
                    ProcessSignal::Term => "-TERM".to_string(),
                    ProcessSignal::Kill => "-KILL".to_string(),
                },
                "--".to_string(),
                format!("-{pid}"),
            ],
        ),
    }
}

pub(crate) fn worker_command_log_detail(spec: &WorkerCommandSpec, kind: &str) -> String {
    let args = spec.args.join(" ");
    format!(
        "kind={kind} program={} current_dir={} args={} {}",
        path_to_env_string(&spec.program),
        path_to_env_string(&spec.current_dir),
        args,
        js_runtime_diagnostics(spec)
    )
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
    let (args, stdin_payload) = match invocation {
        WorkerInvocation::ProcessVideo(payload) => {
            (vec!["--request-stdin".to_string()], Some(payload))
        }
        WorkerInvocation::RetryInsights(payload) => {
            (vec!["--retry-insights-stdin".to_string()], Some(payload))
        }
        WorkerInvocation::ResolveSourceIdentity(payload) => {
            (vec!["--resolve-source-stdin".to_string()], Some(payload))
        }
    };
    if stdin_payload
        .as_ref()
        .is_some_and(|payload| payload.len() > MAX_WORKER_STDIN_PAYLOAD_BYTES)
    {
        return Err("Worker request stdin payload was too large.".to_string());
    }
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
        stdin_payload,
        env,
        env_remove: legacy_local_llm_env_removals(),
        current_dir: paths.user_data_dir.clone(),
    })
}

fn worker_invocation_uses_server_managed_llm(invocation: &WorkerInvocation) -> bool {
    match invocation {
        WorkerInvocation::RetryInsights(_) => true,
        WorkerInvocation::ProcessVideo(_)
        | WorkerInvocation::ResolveSourceIdentity(_) => false,
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

fn configure_child_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        command.process_group(0);
    }

    #[cfg(not(unix))]
    {
        let _ = command;
    }
}

fn spawn_worker_process(
    spec: WorkerCommandSpec,
) -> Result<(std::process::Child, Option<String>), String> {
    let WorkerCommandSpec {
        program,
        args,
        stdin_payload,
        env,
        env_remove,
        current_dir,
    } = spec;
    let mut command = Command::new(program);
    hide_child_console_window(&mut command);
    configure_child_process_group(&mut command);
    for key in env_remove {
        command.env_remove(key);
    }
    command
        .args(args)
        .envs(env)
        .current_dir(current_dir)
        .stdin(if stdin_payload.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    command
        .spawn()
        .map(|child| (child, stdin_payload))
        .map_err(|error| error.to_string())
}

fn deliver_worker_stdin(
    child: &mut std::process::Child,
    stdin_payload: Option<String>,
) -> Result<(), String> {
    let Some(payload) = stdin_payload else {
        return Ok(());
    };
    child
        .stdin
        .take()
        .ok_or(())
        .and_then(|mut stdin| stdin.write_all(payload.as_bytes()).map_err(|_| ()))
        .map_err(|_| "Failed to deliver worker request through stdin.".to_string())
}

pub(crate) fn spawn_worker_command(spec: WorkerCommandSpec) -> Result<std::process::Child, String> {
    let (mut child, stdin_payload) = spawn_worker_process(spec)?;
    if let Err(error) = deliver_worker_stdin(&mut child, stdin_payload) {
        let _ = terminate_process_tree(child.id());
        let _ = child.wait();
        return Err(error);
    }
    Ok(child)
}

pub(crate) fn spawn_supervised_worker_command(
    spec: WorkerCommandSpec,
    supervisor: &ProcessSupervisor,
) -> Result<(std::process::Child, ProcessInstance), SupervisedSpawnError> {
    let (mut child, stdin_payload) =
        spawn_worker_process(spec).map_err(SupervisedSpawnError::Failed)?;
    let Some(instance) = supervisor.start(child.id()) else {
        let _ = terminate_process_tree(child.id());
        let _ = child.wait();
        return Err(SupervisedSpawnError::AlreadyRunning);
    };
    if let Err(error) = deliver_worker_stdin(&mut child, stdin_payload) {
        let terminal_phase = supervisor.finish(instance.instance_id);
        let _ = terminate_process_tree(instance.process_group_id.unwrap_or(instance.pid));
        let _ = child.wait();
        return if terminal_phase == Some(ProcessPhase::Cancelling) {
            Err(SupervisedSpawnError::Cancelled)
        } else {
            Err(SupervisedSpawnError::Failed(error))
        };
    }
    Ok((child, instance))
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

fn termination_failure_detail(output: &Output, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        fallback.to_string()
    } else {
        stderr
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn terminate_process_tree(pid: u32) -> Result<(), String> {
    let (program, args) =
        termination_command_spec(ProcessPlatform::Windows, pid, ProcessSignal::Term);
    let mut command = Command::new(program);
    hide_child_console_window(&mut command);
    let output = command
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        return Ok(());
    }

    Err(termination_failure_detail(
        &output,
        "taskkill failed to terminate the worker process.",
    ))
}

#[cfg(unix)]
pub(crate) fn terminate_process_tree(pid: u32) -> Result<(), String> {
    send_process_group_signal(pid, ProcessSignal::Term)?;
    std::thread::sleep(Duration::from_millis(500));
    if process_group_exists(pid)? {
        send_process_group_signal(pid, ProcessSignal::Kill)?;
    }
    Ok(())
}

#[cfg(unix)]
fn send_process_group_signal(pid: u32, signal: ProcessSignal) -> Result<(), String> {
    let (program, args) = termination_command_spec(ProcessPlatform::Unix, pid, signal);
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(termination_failure_detail(
            &output,
            "Unable to signal the worker process group.",
        ))
    }
}

#[cfg(unix)]
fn process_group_exists(pid: u32) -> Result<bool, String> {
    let (_, args) = termination_command_spec(ProcessPlatform::Unix, pid, ProcessSignal::Term);
    let output = Command::new("kill")
        .args(["-0", "--", &args[2]])
        .output()
        .map_err(|error| error.to_string())?;
    Ok(output.status.success())
}

#[cfg(test)]
mod tests {
    use super::{
        build_worker_command_spec, parse_worker_output_or_fallback, parse_worker_stdout,
        run_blocking_worker_command, spawn_worker_command, termination_command_spec, CancelClaim,
        CancelRequestOutcome, ProcessPhase, ProcessPlatform, ProcessSignal, ProcessSupervisor,
        ProcessSupervisors, WorkerCommandSpec, WorkerInvocation,
    };
    use crate::account::ServerManagedLlmInvocation;
    use crate::{
        bundled_python_path, path_to_env_string, ProcessVideoResult, RuntimePaths, WorkerError,
    };
    use std::collections::HashMap;
    use std::io::Read;
    use std::path::PathBuf;
    #[cfg(unix)]
    use std::process::Command;
    use std::process::Output;

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
    fn process_supervisor_claims_cancellation_once_and_rolls_back_only_matching_instance() {
        let supervisor = ProcessSupervisor::default();
        let first = supervisor.start(101).expect("first worker starts");

        assert_eq!(first.instance_id, 1);
        assert_eq!(first.pid, 101);
        assert_eq!(first.process_group_id, cfg!(unix).then_some(101));
        assert_eq!(supervisor.phase(), Some(ProcessPhase::Running));
        assert!(matches!(
            supervisor.claim_cancel(),
            CancelClaim::Claimed(instance) if instance == first
        ));
        assert!(matches!(
            supervisor.claim_cancel(),
            CancelClaim::AlreadyCancelling(instance) if instance == first
        ));
        assert!(!supervisor.restore_running(999));
        assert!(supervisor.restore_running(first.instance_id));
        assert_eq!(supervisor.phase(), Some(ProcessPhase::Running));

        assert_eq!(
            supervisor.finish(first.instance_id),
            Some(ProcessPhase::Running)
        );
        let second = supervisor.start(202).expect("second worker starts");
        assert_eq!(second.instance_id, 2);
        assert_eq!(supervisor.phase(), Some(ProcessPhase::Running));
        assert_eq!(supervisor.finish(first.instance_id), None);
        assert_eq!(supervisor.current(), Some(second));
    }

    #[test]
    fn process_supervisor_preserves_real_completion_after_cancellation_claim() {
        let supervisor = ProcessSupervisor::default();
        let instance = supervisor.start(303).expect("worker starts");

        assert!(matches!(
            supervisor.claim_cancel(),
            CancelClaim::Claimed(current) if current == instance
        ));
        assert_eq!(
            supervisor.finish(instance.instance_id),
            Some(ProcessPhase::Cancelling)
        );
        assert_eq!(supervisor.phase(), None);
    }

    #[test]
    fn process_supervisor_restores_running_when_process_termination_fails() {
        let supervisor = ProcessSupervisor::default();
        let instance = supervisor.start(404).expect("worker starts");

        assert!(matches!(
            supervisor.request_cancel(|current| {
                assert_eq!(current, instance);
                Err("tree termination failed".to_string())
            }),
            CancelRequestOutcome::Failed { instance: current, .. } if current == instance
        ));
        assert_eq!(supervisor.phase(), Some(ProcessPhase::Running));
        assert_eq!(
            supervisor.finish(instance.instance_id),
            Some(ProcessPhase::Running)
        );
    }

    #[test]
    fn video_and_asr_download_use_the_same_instance_safe_supervisor_semantics() {
        let supervisors = ProcessSupervisors::default();
        let video = supervisors.video.start(505).expect("video worker starts");
        let model = supervisors
            .asr_model_download
            .start(606)
            .expect("model download starts");

        assert!(matches!(
            supervisors.video.claim_cancel(),
            CancelClaim::Claimed(instance) if instance == video
        ));
        assert_eq!(
            supervisors.video.finish(video.instance_id),
            Some(ProcessPhase::Cancelling)
        );
        assert_eq!(
            supervisors.asr_model_download.finish(model.instance_id),
            Some(ProcessPhase::Running)
        );
    }

    #[test]
    fn termination_command_specs_cover_windows_tree_and_unix_process_group_signals() {
        assert_eq!(
            termination_command_spec(ProcessPlatform::Windows, 404, ProcessSignal::Term),
            (
                "taskkill".to_string(),
                vec!["/PID", "404", "/T", "/F"]
                    .into_iter()
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            )
        );
        assert_eq!(
            termination_command_spec(ProcessPlatform::Unix, 505, ProcessSignal::Term),
            (
                "kill".to_string(),
                vec!["-TERM", "--", "-505"]
                    .into_iter()
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            )
        );
        assert_eq!(
            termination_command_spec(ProcessPlatform::Unix, 505, ProcessSignal::Kill),
            (
                "kill".to_string(),
                vec!["-KILL", "--", "-505"]
                    .into_iter()
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            )
        );
    }

    #[cfg(unix)]
    #[test]
    fn unix_termination_stops_a_parent_and_child_in_the_managed_process_group() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30 & wait"]);
        super::configure_child_process_group(&mut command);
        let mut child = command.spawn().expect("fixture parent starts");
        let process_group_id = child.id();

        assert!(super::process_group_exists(process_group_id).expect("group probe succeeds"));
        super::terminate_process_tree(process_group_id).expect("group termination succeeds");
        child.wait().expect("fixture parent is reaped");
        assert!(
            !super::process_group_exists(process_group_id).expect("group probe after termination")
        );
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
        let paths = command_test_paths();
        let request_json = r#"{"url":"https://www.douyin.com/video/7524373044106677544"}"#;

        let spec = build_worker_command_spec(
            &paths,
            WorkerInvocation::ProcessVideo(request_json.to_string()),
            None,
        )
        .expect("build worker command spec");
        let env = spec.env_map();

        assert_eq!(spec.program, bundled_python_path(&paths.resource_dir));
        assert_eq!(spec.args, vec!["-m", "frameq_worker", "--request-stdin"]);
        assert_eq!(spec.stdin_payload.as_deref(), Some(request_json));
        assert!(!spec.args.join(" ").contains(request_json));
        assert!(!spec.args.join(" ").contains("xsec_token"));
        assert!(!env.values().any(|value| value.contains(request_json)));
        assert!(!spec.program.to_string_lossy().contains("uv"));
        assert!(!spec.args.iter().any(|arg| arg == "uv"));
        assert_eq!(
            env.get("PYTHONPATH"),
            Some(&path_to_env_string(paths.resource_dir.join("worker")))
        );
        assert_eq!(
            env.get("FRAMEQ_OUTPUT_DIR"),
            Some(&path_to_env_string(paths.user_data_dir.join("outputs")))
        );
        assert_eq!(
            env.get("FRAMEQ_CACHE_DIR"),
            Some(&path_to_env_string(paths.user_data_dir.join("cache")))
        );
        assert_eq!(
            env.get("FRAMEQ_MODEL_DIR"),
            Some(&path_to_env_string(paths.user_data_dir.join("models")))
        );
        assert_eq!(
            env.get("FRAMEQ_RESOURCE_DIR"),
            Some(&path_to_env_string(&paths.resource_dir))
        );
        assert_eq!(env.get("FRAMEQ_ALLOW_REAL_ASR"), Some(&"1".to_string()));
        assert_eq!(env.get("MODELSCOPE_OFFLINE"), Some(&"1".to_string()));
        assert_removes_legacy_local_llm_env(&spec);
        assert_eq!(spec.current_dir, paths.user_data_dir);
    }

    #[test]
    fn serialized_worker_requests_never_enter_argv_or_environment() {
        let paths = command_test_paths();
        let secret = "review-secret";
        let cases = [
            (
                WorkerInvocation::ProcessVideo(format!(
                    r#"{{"url":"https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456?xsec_token={secret}"}}"#
                )),
                "--request-stdin",
            ),
            (
                WorkerInvocation::ResolveSourceIdentity(format!(
                    r#"{{"url":"https://xhslink.com/demo?xsec_token={secret}"}}"#
                )),
                "--resolve-source-stdin",
            ),
            (
                WorkerInvocation::RetryInsights(
                    r#"{"task_id":"safe-task","target":"summary"}"#.to_string(),
                ),
                "--retry-insights-stdin",
            ),
        ];

        for (invocation, expected_mode) in cases {
            let spec = build_worker_command_spec(&paths, invocation, None)
                .expect("build stdin worker command");
            assert_eq!(
                spec.args,
                vec![
                    "-m".to_string(),
                    "frameq_worker".to_string(),
                    expected_mode.to_string()
                ]
            );
            assert!(!spec.args.iter().any(|value| value.contains(secret)));
            assert!(!spec.args.iter().any(|value| value.contains("xsec_token")));
            assert!(!spec.env.iter().any(|(_, value)| value.contains(secret)));
            assert!(!spec
                .env
                .iter()
                .any(|(_, value)| value.contains("xsec_token")));
            let log = super::worker_command_log_detail(&spec, "privacy_probe");
            assert!(!log.contains(secret));
            assert!(!log.contains("xsec_token"));
        }
    }

    #[test]
    fn oversized_worker_stdin_payload_fails_without_echoing_content() {
        let paths = RuntimePaths {
            resource_dir: PathBuf::from("C:/Program Files/FrameQ/resources"),
            user_data_dir: PathBuf::from("C:/Users/demo/AppData/Local/com.frameq.desktop"),
        };
        let payload = format!("review-secret{}", "x".repeat(1024 * 1024));

        let error = match build_worker_command_spec(
            &paths,
            WorkerInvocation::ProcessVideo(payload),
            None,
        ) {
            Ok(_) => panic!("oversized stdin payload unexpectedly accepted"),
            Err(error) => error,
        };

        assert_eq!(error, "Worker request stdin payload was too large.");
        assert!(!error.contains("review-secret"));
    }

    #[test]
    fn spawned_worker_receives_sensitive_request_only_through_stdin() {
        const PROBE_ENV: &str = "FRAMEQ_STDIN_REQUEST_PROBE";
        const TEST_NAME: &str =
            "worker_command::tests::spawned_worker_receives_sensitive_request_only_through_stdin";
        const SECRET: &str = "review-secret";

        if std::env::var_os(PROBE_ENV).is_some() {
            let mut stdin = String::new();
            std::io::stdin()
                .read_to_string(&mut stdin)
                .expect("probe reads stdin");
            let argv = std::env::args().collect::<Vec<_>>().join(" ");
            let env_contains_secret = std::env::vars().any(|(_, value)| value.contains(SECRET));
            println!(
                "{}",
                serde_json::json!({
                    "stdin_received": stdin.contains(SECRET),
                    "argv_contains_secret": argv.contains(SECRET),
                    "env_contains_secret": env_contains_secret,
                })
            );
            return;
        }

        let payload = format!(
            r#"{{"url":"https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456?xsec_token={SECRET}"}}"#
        );
        let spec = WorkerCommandSpec {
            program: std::env::current_exe().expect("resolve test executable"),
            args: vec![
                "--exact".to_string(),
                TEST_NAME.to_string(),
                "--nocapture".to_string(),
            ],
            stdin_payload: Some(payload.clone()),
            env: vec![(PROBE_ENV.to_string(), "1".to_string())],
            env_remove: vec![],
            current_dir: std::env::current_dir().expect("resolve test directory"),
        };

        assert!(!spec.args.iter().any(|value| value.contains(SECRET)));
        assert!(!spec.env.iter().any(|(_, value)| value.contains(SECRET)));
        let output = spawn_worker_command(spec)
            .expect("spawn stdin probe")
            .wait_with_output()
            .expect("wait for stdin probe");
        assert!(output.status.success());
        let stdout = String::from_utf8(output.stdout).expect("probe stdout is utf-8");
        let result = stdout
            .lines()
            .find_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .expect("probe emits JSON result");

        assert_eq!(result["stdin_received"], true);
        assert_eq!(result["argv_contains_secret"], false);
        assert_eq!(result["env_contains_secret"], false);
        assert!(!stdout.contains(SECRET));
        assert!(!String::from_utf8_lossy(&output.stderr).contains(SECRET));
    }

    #[test]
    fn stdin_delivery_failure_is_sanitized_and_reaps_the_child() {
        const PROBE_ENV: &str = "FRAMEQ_STDIN_FAILURE_PROBE";
        const TEST_NAME: &str =
            "worker_command::tests::stdin_delivery_failure_is_sanitized_and_reaps_the_child";
        const SECRET: &str = "review-secret";

        if std::env::var_os(PROBE_ENV).is_some() {
            return;
        }

        let spec = WorkerCommandSpec {
            program: std::env::current_exe().expect("resolve test executable"),
            args: vec![
                "--exact".to_string(),
                TEST_NAME.to_string(),
                "--nocapture".to_string(),
            ],
            stdin_payload: Some(SECRET.repeat(256 * 1024)),
            env: vec![(PROBE_ENV.to_string(), "1".to_string())],
            env_remove: vec![],
            current_dir: std::env::current_dir().expect("resolve test directory"),
        };

        let error = match spawn_worker_command(spec) {
            Ok(mut child) => {
                let _ = child.wait();
                panic!("stdin delivery unexpectedly succeeded")
            }
            Err(error) => error,
        };
        assert_eq!(error, "Failed to deliver worker request through stdin.");
        assert!(!error.contains(SECRET));
    }

    #[test]
    fn stdin_worker_remains_cancellable_after_request_delivery() {
        const PROBE_ENV: &str = "FRAMEQ_STDIN_CANCELLATION_PROBE";
        const TEST_NAME: &str =
            "worker_command::tests::stdin_worker_remains_cancellable_after_request_delivery";

        if std::env::var_os(PROBE_ENV).is_some() {
            let mut stdin = Vec::new();
            std::io::stdin()
                .read_to_end(&mut stdin)
                .expect("cancellation probe reads stdin");
            assert!(!stdin.is_empty());
            std::thread::sleep(std::time::Duration::from_secs(30));
            return;
        }

        let spec = WorkerCommandSpec {
            program: std::env::current_exe().expect("resolve test executable"),
            args: vec![
                "--exact".to_string(),
                TEST_NAME.to_string(),
                "--nocapture".to_string(),
            ],
            stdin_payload: Some("x".repeat(256 * 1024)),
            env: vec![(PROBE_ENV.to_string(), "1".to_string())],
            env_remove: vec![],
            current_dir: std::env::current_dir().expect("resolve test directory"),
        };
        let child = spawn_worker_command(spec).expect("spawn cancellable stdin worker");
        let supervisor = ProcessSupervisor::default();
        let instance = supervisor.start(child.id()).expect("claim stdin worker");

        assert!(matches!(
            supervisor.request_cancel(|current| {
                super::terminate_process_tree(current.process_group_id.unwrap_or(current.pid))
            }),
            CancelRequestOutcome::Signalled(current) if current == instance
        ));
        let output = child
            .wait_with_output()
            .expect("reap cancelled stdin worker");
        assert!(!output.status.success());
        assert_eq!(
            supervisor.finish(instance.instance_id),
            Some(ProcessPhase::Cancelling)
        );
    }

    #[test]
    fn supervised_stdin_worker_can_be_cancelled_while_delivery_is_blocked() {
        const PROBE_ENV: &str = "FRAMEQ_STDIN_BLOCKED_DELIVERY_PROBE";
        const TEST_NAME: &str = "worker_command::tests::supervised_stdin_worker_can_be_cancelled_while_delivery_is_blocked";

        if std::env::var_os(PROBE_ENV).is_some() {
            std::thread::sleep(std::time::Duration::from_secs(30));
            return;
        }

        let spec = WorkerCommandSpec {
            program: std::env::current_exe().expect("resolve test executable"),
            args: vec![
                "--exact".to_string(),
                TEST_NAME.to_string(),
                "--nocapture".to_string(),
            ],
            stdin_payload: Some("x".repeat(256 * 1024)),
            env: vec![(PROBE_ENV.to_string(), "1".to_string())],
            env_remove: vec![],
            current_dir: std::env::current_dir().expect("resolve test directory"),
        };
        let supervisor = std::sync::Arc::new(ProcessSupervisor::default());
        let operation_supervisor = std::sync::Arc::clone(&supervisor);
        let operation = std::thread::spawn(move || {
            super::spawn_supervised_worker_command(spec, &operation_supervisor)
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while supervisor.current().is_none() && std::time::Instant::now() < deadline {
            std::thread::yield_now();
        }
        let instance = supervisor
            .current()
            .expect("blocked delivery is supervised");

        assert!(matches!(
            supervisor.request_cancel(|current| {
                super::terminate_process_tree(current.process_group_id.unwrap_or(current.pid))
            }),
            CancelRequestOutcome::Signalled(current) if current == instance
        ));
        assert!(matches!(
            operation.join().expect("delivery thread completes"),
            Err(super::SupervisedSpawnError::Cancelled)
        ));
        assert_eq!(supervisor.current(), None);
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
    fn worker_command_spec_skips_server_managed_llm_for_process_video() {
        let paths = command_test_paths();
        let request_json = r#"{"url":"https://www.douyin.com/video/7524373044106677544"}"#;

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
        assert_eq!(spec.stdin_payload.as_deref(), Some(request_json));
        assert_eq!(env.get("FRAMEQ_LLM_SOURCE"), None);
        assert_eq!(env.get("FRAMEQ_LLM_CHECKOUT_URL"), None);
        assert_eq!(env.get("FRAMEQ_LLM_SESSION_TOKEN"), None);
        assert_eq!(env.get("FRAMEQ_LLM_CHECKOUT_REQUEST_ID"), None);
    }

    #[test]
    fn worker_command_spec_includes_server_managed_llm_checkout_env_for_retry_insights() {
        let paths = command_test_paths();
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
        assert_eq!(spec.stdin_payload.as_deref(), Some(request_json));
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
