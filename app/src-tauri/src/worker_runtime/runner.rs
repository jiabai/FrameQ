use super::command::js_runtime_diagnostics;
use super::command::WorkerCommandSpec;
use super::supervisor::{
    hide_child_console_window, request_process_cancellation, terminate_process_tree,
    CancelProcessResult, ProcessInstance, ProcessPhase, ProcessSupervisor,
};
use crate::progress_event::{
    invalid_progress_log_detail, validate_model_download_event, validate_worker_progress_event,
};
use crate::{append_desktop_log, RuntimePaths};
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
#[cfg(not(test))]
use tauri::{Emitter, Window};

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
    let preview = crate::sanitize_diagnostic_text(&preview);
    let detail = last_error.unwrap_or_else(|| "stdout did not contain JSON".to_string());
    Err(format!(
        "Worker stdout did not contain a structured JSON result: {detail}. stdout preview: {preview}"
    ))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WorkerOperation {
    ProcessVideo,
    RetryInsights,
    ResolveSourceIdentity,
    DownloadAsrModel,
}

impl WorkerOperation {
    fn as_str(self) -> &'static str {
        match self {
            Self::ProcessVideo => "process_video",
            Self::RetryInsights => "retry_insights",
            Self::ResolveSourceIdentity => "resolve_source_identity",
            Self::DownloadAsrModel => "download_asr_model",
        }
    }

    fn event(self, phase: &str) -> String {
        format!("worker.{}.{}", self.as_str(), phase)
    }
}

#[cfg(not(test))]
pub(crate) enum ProgressRoute {
    None,
    Worker(Window),
    AsrModelDownload(Window),
}

#[cfg(test)]
pub(crate) enum ProgressRoute {
    None,
    Worker,
    AsrModelDownload,
}

impl ProgressRoute {
    #[cfg(not(test))]
    pub(crate) fn worker(window: Window) -> Self {
        Self::Worker(window)
    }

    #[cfg(not(test))]
    pub(crate) fn asr_model_download(window: Window) -> Self {
        Self::AsrModelDownload(window)
    }

    #[cfg(test)]
    pub(crate) fn worker<T>(_window: T) -> Self {
        Self::Worker
    }

    #[cfg(test)]
    pub(crate) fn asr_model_download<T>(_window: T) -> Self {
        Self::AsrModelDownload
    }

    fn protocol(&self) -> ProgressProtocol {
        #[cfg(not(test))]
        match self {
            Self::None => ProgressProtocol::None,
            Self::Worker(_) => ProgressProtocol::Worker,
            Self::AsrModelDownload(_) => ProgressProtocol::AsrModelDownload,
        }

        #[cfg(test)]
        match self {
            Self::None => ProgressProtocol::None,
            Self::Worker => ProgressProtocol::Worker,
            Self::AsrModelDownload => ProgressProtocol::AsrModelDownload,
        }
    }

    fn emit(&self, payload: serde_json::Value) {
        #[cfg(not(test))]
        match self {
            Self::None => {}
            Self::Worker(window) => {
                let _ = window.emit(crate::PROGRESS_EVENT_NAME, payload);
            }
            Self::AsrModelDownload(window) => {
                let _ = window.emit(crate::asr_model::ASR_MODEL_DOWNLOAD_EVENT_NAME, payload);
            }
        }

        #[cfg(test)]
        let _ = (self, payload);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProgressProtocol {
    None,
    Worker,
    AsrModelDownload,
}

#[derive(Debug, PartialEq)]
enum ProgressRecord {
    Validated(serde_json::Value),
    Invalid(String),
    Diagnostic,
    Empty,
}

pub(crate) struct WorkerRunRequest {
    pub(crate) operation: WorkerOperation,
    pub(crate) command: WorkerCommandSpec,
    pub(crate) progress: ProgressRoute,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WorkerRunErrorKind {
    AlreadyRunning,
    SpawnFailed,
    RequestDeliveryFailed,
    PipeUnavailable,
    WaitFailed,
    ProtocolViolation,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct WorkerRunError {
    pub(crate) kind: WorkerRunErrorKind,
    pub(crate) detail: &'static str,
}

impl WorkerRunError {
    fn new(kind: WorkerRunErrorKind, detail: &'static str) -> Self {
        Self { kind, detail }
    }

    fn protocol_violation() -> Self {
        Self::new(
            WorkerRunErrorKind::ProtocolViolation,
            "Worker exited successfully without a structured result.",
        )
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct StderrSummary {
    had_diagnostic_output: bool,
    reader_failed: bool,
}

impl StderrSummary {
    fn marker(self) -> &'static str {
        if self.reader_failed {
            "reader_failed"
        } else if self.had_diagnostic_output {
            "present"
        } else {
            "empty"
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WorkerExitSummary {
    pub(crate) exit_code: Option<i32>,
    pub(crate) stderr: &'static str,
}

#[derive(Debug, PartialEq)]
pub(crate) enum WorkerRunOutcome {
    Structured(serde_json::Value),
    Cancelled,
    UnstructuredFailure(WorkerExitSummary),
}

#[derive(Default)]
pub(crate) struct WorkerLane {
    supervisor: ProcessSupervisor,
}

impl WorkerLane {
    pub(crate) fn run(
        &self,
        paths: &RuntimePaths,
        request: WorkerRunRequest,
    ) -> Result<WorkerRunOutcome, WorkerRunError> {
        self.run_inner(paths, request, RunnerHooks::default())
    }

    pub(crate) fn cancel(&self) -> CancelProcessResult {
        request_process_cancellation(&self.supervisor)
    }

    pub(crate) fn is_active(&self) -> bool {
        self.supervisor.is_active()
    }

    #[cfg(test)]
    pub(crate) fn activate_for_test(&self, pid: u32) -> u64 {
        self.supervisor
            .start(pid)
            .expect("test worker lane must be idle")
            .instance_id
    }

    #[cfg(test)]
    pub(crate) fn finish_for_test(&self, instance_id: u64) {
        self.supervisor.finish(instance_id);
    }

    #[cfg(test)]
    fn run_with_hooks(
        &self,
        paths: &RuntimePaths,
        request: WorkerRunRequest,
        hooks: RunnerHooks,
    ) -> Result<WorkerRunOutcome, WorkerRunError> {
        self.run_inner(paths, request, hooks)
    }

    fn run_inner(
        &self,
        paths: &RuntimePaths,
        request: WorkerRunRequest,
        hooks: RunnerHooks,
    ) -> Result<WorkerRunOutcome, WorkerRunError> {
        let WorkerRunRequest {
            operation,
            command,
            progress,
        } = request;
        let _ = append_desktop_log(
            paths,
            &operation.event("start"),
            &safe_start_log_detail(operation, &command),
        );

        let (mut child, stdin_payload) = spawn_worker_process(command).map_err(|_| {
            WorkerRunError::new(
                WorkerRunErrorKind::SpawnFailed,
                "Worker process failed to start.",
            )
        })?;
        let Some(instance) = self.supervisor.start(child.id()) else {
            let pid = child.id();
            terminate_and_reap(&mut child, pid);
            return Err(WorkerRunError::new(
                WorkerRunErrorKind::AlreadyRunning,
                "Another worker operation is already running.",
            ));
        };
        let mut instance_guard = InstanceGuard::new(&self.supervisor, instance);

        if deliver_worker_stdin(&mut child, stdin_payload).is_err() {
            terminate_and_reap(
                &mut child,
                instance.process_group_id.unwrap_or(instance.pid),
            );
            let phase = instance_guard.finish();
            if phase == Some(ProcessPhase::Cancelling) {
                return Ok(WorkerRunOutcome::Cancelled);
            }
            return Err(WorkerRunError::new(
                WorkerRunErrorKind::RequestDeliveryFailed,
                "Worker request delivery failed.",
            ));
        }

        if hooks.force_missing_stderr {
            drop(child.stderr.take());
        }
        let Some(stdout) = child.stdout.take() else {
            terminate_and_reap(
                &mut child,
                instance.process_group_id.unwrap_or(instance.pid),
            );
            instance_guard.finish();
            return Err(WorkerRunError::new(
                WorkerRunErrorKind::PipeUnavailable,
                "Worker stdout pipe was unavailable.",
            ));
        };
        let Some(stderr) = child.stderr.take() else {
            terminate_and_reap(
                &mut child,
                instance.process_group_id.unwrap_or(instance.pid),
            );
            instance_guard.finish();
            return Err(WorkerRunError::new(
                WorkerRunErrorKind::PipeUnavailable,
                "Worker stderr pipe was unavailable.",
            ));
        };

        let stdout_reader = std::thread::spawn(move || {
            let mut stdout = stdout;
            let mut bytes = Vec::new();
            stdout.read_to_end(&mut bytes).map(|_| bytes)
        });
        let progress_paths = paths.clone();
        let reader_hooks = hooks.clone();
        let stderr_reader =
            std::thread::spawn(move || read_stderr(stderr, progress, progress_paths, reader_hooks));

        if hooks.force_wait_failure {
            terminate_and_reap(
                &mut child,
                instance.process_group_id.unwrap_or(instance.pid),
            );
            instance_guard.finish();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(WorkerRunError::new(
                WorkerRunErrorKind::WaitFailed,
                "Worker process wait failed.",
            ));
        }

        let status = match child.wait() {
            Ok(status) => status,
            Err(_) => {
                terminate_and_reap(
                    &mut child,
                    instance.process_group_id.unwrap_or(instance.pid),
                );
                instance_guard.finish();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(WorkerRunError::new(
                    WorkerRunErrorKind::WaitFailed,
                    "Worker process wait failed.",
                ));
            }
        };
        let terminal_phase = instance_guard.finish();
        let stdout = stdout_reader
            .join()
            .ok()
            .and_then(Result::ok)
            .ok_or_else(|| {
                WorkerRunError::new(
                    WorkerRunErrorKind::ProtocolViolation,
                    "Worker stdout reader failed.",
                )
            })?;
        let stderr = stderr_reader.join().unwrap_or(StderrSummary {
            had_diagnostic_output: false,
            reader_failed: true,
        });
        let output = Output {
            status,
            stdout,
            stderr: Vec::new(),
        };
        let _ = append_desktop_log(
            paths,
            &operation.event("exit"),
            &safe_exit_log_detail(operation, instance.pid, &output, stderr),
        );

        let outcome = classify_terminal(&output, terminal_phase, stderr)?;
        let terminal = match &outcome {
            WorkerRunOutcome::Structured(_) => "structured",
            WorkerRunOutcome::Cancelled => "cancelled",
            WorkerRunOutcome::UnstructuredFailure(_) => "unstructured_failure",
        };
        let _ = append_desktop_log(
            paths,
            &operation.event("result"),
            &format!("operation={} outcome={terminal}", operation.as_str()),
        );
        Ok(outcome)
    }
}

struct InstanceGuard<'a> {
    supervisor: &'a ProcessSupervisor,
    instance_id: u64,
    finished: bool,
}

impl<'a> InstanceGuard<'a> {
    fn new(supervisor: &'a ProcessSupervisor, instance: ProcessInstance) -> Self {
        Self {
            supervisor,
            instance_id: instance.instance_id,
            finished: false,
        }
    }

    fn finish(&mut self) -> Option<ProcessPhase> {
        if self.finished {
            return None;
        }
        self.finished = true;
        self.supervisor.finish(self.instance_id)
    }
}

impl Drop for InstanceGuard<'_> {
    fn drop(&mut self) {
        if !self.finished {
            self.supervisor.finish(self.instance_id);
            self.finished = true;
        }
    }
}

#[derive(Clone, Default)]
struct RunnerHooks {
    force_missing_stderr: bool,
    force_wait_failure: bool,
    panic_stderr_reader: bool,
    reader_join_gate: Option<ReaderJoinGate>,
}

#[derive(Clone, Default)]
struct ReaderJoinGate {
    waiting: Arc<AtomicBool>,
    release: Arc<AtomicBool>,
}

fn terminate_and_reap(child: &mut std::process::Child, process_group_id: u32) {
    let _ = terminate_process_tree(process_group_id);
    let _ = child.wait();
}

fn read_stderr(
    stderr: std::process::ChildStderr,
    progress: ProgressRoute,
    paths: RuntimePaths,
    hooks: RunnerHooks,
) -> StderrSummary {
    let protocol = progress.protocol();
    let mut summary = StderrSummary::default();
    for line in BufReader::new(stderr).lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => {
                summary.reader_failed = true;
                break;
            }
        };
        match inspect_progress_line(protocol, &line) {
            ProgressRecord::Validated(payload) => progress.emit(payload),
            ProgressRecord::Invalid(detail) => {
                let event = match protocol {
                    ProgressProtocol::AsrModelDownload => "worker.model_progress.invalid",
                    ProgressProtocol::Worker | ProgressProtocol::None => "worker.progress.invalid",
                };
                let _ = append_desktop_log(&paths, event, &detail);
            }
            ProgressRecord::Diagnostic => summary.had_diagnostic_output = true,
            ProgressRecord::Empty => {}
        }
    }

    if hooks.panic_stderr_reader {
        panic!("forced stderr reader failure");
    }
    if let Some(gate) = hooks.reader_join_gate {
        gate.waiting.store(true, Ordering::SeqCst);
        let deadline = Instant::now() + Duration::from_secs(10);
        while !gate.release.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::yield_now();
        }
    }
    summary
}

fn inspect_progress_line(protocol: ProgressProtocol, line: &str) -> ProgressRecord {
    if line.trim().is_empty() {
        return ProgressRecord::Empty;
    }
    let (prefix, validator): (
        &str,
        fn(
            &serde_json::Value,
        ) -> Result<serde_json::Value, crate::progress_event::InvalidProgressEvent>,
    ) = match protocol {
        ProgressProtocol::None => return ProgressRecord::Diagnostic,
        ProgressProtocol::Worker => (crate::PROGRESS_EVENT_PREFIX, validate_worker_progress_event),
        ProgressProtocol::AsrModelDownload => (
            crate::asr_model::MODEL_DOWNLOAD_EVENT_PREFIX,
            validate_model_download_event,
        ),
    };
    let Some(raw_event) = line.strip_prefix(prefix) else {
        return ProgressRecord::Diagnostic;
    };
    let parsed = serde_json::from_str::<serde_json::Value>(raw_event).ok();
    if let Some(payload) = parsed.as_ref().and_then(|value| validator(value).ok()) {
        ProgressRecord::Validated(payload)
    } else {
        ProgressRecord::Invalid(
            parsed
                .as_ref()
                .map(invalid_progress_log_detail)
                .unwrap_or_else(|| "message_code=invalid".to_string()),
        )
    }
}

fn safe_start_log_detail(operation: WorkerOperation, spec: &WorkerCommandSpec) -> String {
    format!(
        "operation={} {}",
        operation.as_str(),
        js_runtime_diagnostics(spec)
    )
}

fn safe_exit_log_detail(
    operation: WorkerOperation,
    pid: u32,
    output: &Output,
    stderr: StderrSummary,
) -> String {
    format!(
        "operation={} pid={pid} exit={} stderr={}",
        operation.as_str(),
        output
            .status
            .code()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "signal".to_string()),
        stderr.marker()
    )
}

fn classify_terminal(
    output: &Output,
    terminal_phase: Option<ProcessPhase>,
    stderr: StderrSummary,
) -> Result<WorkerRunOutcome, WorkerRunError> {
    if let Ok(value) = parse_worker_stdout(&output.stdout) {
        return Ok(WorkerRunOutcome::Structured(value));
    }
    if terminal_phase == Some(ProcessPhase::Cancelling) {
        return Ok(WorkerRunOutcome::Cancelled);
    }
    if output.status.success() {
        return Err(WorkerRunError::protocol_violation());
    }
    Ok(WorkerRunOutcome::UnstructuredFailure(WorkerExitSummary {
        exit_code: output.status.code(),
        stderr: stderr.marker(),
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        classify_terminal, inspect_progress_line, safe_exit_log_detail, safe_start_log_detail,
        ProgressProtocol, ProgressRecord, ProgressRoute, ReaderJoinGate, RunnerHooks,
        StderrSummary, WorkerLane, WorkerOperation, WorkerRunErrorKind, WorkerRunOutcome,
        WorkerRunRequest,
    };
    use crate::worker_runtime::supervisor::CancelProcessStatus;
    use crate::worker_runtime::supervisor::ProcessPhase;
    use crate::worker_runtime::WorkerCommandSpec;
    use crate::RuntimePaths;
    use std::io::Read;
    use std::path::PathBuf;
    use std::process::Output;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    #[test]
    fn structured_result_wins_a_concurrent_cancellation_claim() {
        let output = Output {
            status: exit_status(1),
            stdout: br#"{"status":"completed","task_id":"safe-task"}"#.to_vec(),
            stderr: Vec::new(),
        };

        let outcome = classify_terminal(
            &output,
            Some(ProcessPhase::Cancelling),
            StderrSummary::default(),
        )
        .expect("structured result remains authoritative");

        assert!(matches!(
            outcome,
            WorkerRunOutcome::Structured(value) if value["status"] == "completed"
        ));
    }

    #[test]
    fn terminal_matrix_is_closed_and_deterministic() {
        let malformed_success = Output {
            status: exit_status(0),
            stdout: b"not-json".to_vec(),
            stderr: Vec::new(),
        };
        let malformed_failure = Output {
            status: exit_status(1),
            stdout: b"not-json".to_vec(),
            stderr: Vec::new(),
        };

        assert!(matches!(
            classify_terminal(
                &malformed_failure,
                Some(ProcessPhase::Cancelling),
                StderrSummary::default(),
            ),
            Ok(WorkerRunOutcome::Cancelled)
        ));
        assert!(matches!(
            classify_terminal(
                &malformed_success,
                Some(ProcessPhase::Running),
                StderrSummary::default(),
            ),
            Err(error) if error.kind == WorkerRunErrorKind::ProtocolViolation
        ));
        assert!(matches!(
            classify_terminal(
                &malformed_failure,
                Some(ProcessPhase::Running),
                StderrSummary {
                    had_diagnostic_output: true,
                    reader_failed: false,
                },
            ),
            Ok(WorkerRunOutcome::UnstructuredFailure(summary))
                if summary.exit_code == Some(1) && summary.stderr == "present"
        ));
    }

    #[test]
    fn progress_protocols_validate_before_routing_and_drop_invalid_payloads() {
        let worker = inspect_progress_line(
            ProgressProtocol::Worker,
            r#"FRAMEQ_PROGRESS {"stage":"video_extracting","progress":22,"message_code":"video.download.preparing"}"#,
        );
        let model = inspect_progress_line(
            ProgressProtocol::AsrModelDownload,
            r#"FRAMEQ_MODEL_DOWNLOAD {"status":"started","progress":0,"message_code":"model.download.preparing","message_args":{"model":"iic/SenseVoiceSmall"}}"#,
        );
        let invalid = inspect_progress_line(
            ProgressProtocol::Worker,
            r#"FRAMEQ_PROGRESS {"stage":"video_extracting","progress":22,"message_code":"unknown.action.state"}"#,
        );
        let ignored_by_none = inspect_progress_line(
            ProgressProtocol::None,
            r#"FRAMEQ_PROGRESS {"stage":"video_extracting","progress":22,"message_code":"video.download.preparing"}"#,
        );

        assert!(matches!(
            worker,
            ProgressRecord::Validated(value) if value["message_code"] == "video.download.preparing"
        ));
        assert!(matches!(
            model,
            ProgressRecord::Validated(value) if value["status"] == "started"
        ));
        assert_eq!(
            invalid,
            ProgressRecord::Invalid("message_code=unknown.action.state".to_string())
        );
        assert_eq!(ignored_by_none, ProgressRecord::Diagnostic);
    }

    #[test]
    fn lifecycle_log_details_exclude_command_request_paths_and_worker_content() {
        let secret = "RUNNER_PRIVACY_SENTINEL";
        let spec = WorkerCommandSpec {
            program: PathBuf::from(format!("C:/private/{secret}/python.exe")),
            args: vec![format!("--prompt={secret}")],
            stdin_payload: Some(format!(r#"{{"transcript":"{secret}"}}"#)),
            env: vec![("FRAMEQ_LLM_SESSION_TOKEN".to_string(), secret.to_string())],
            env_remove: Vec::new(),
            current_dir: PathBuf::from(format!("C:/private/{secret}/data")),
        };
        let output = Output {
            status: exit_status(1),
            stdout: format!(r#"{{"generated_content":"{secret}"}}"#).into_bytes(),
            stderr: secret.as_bytes().to_vec(),
        };

        let start = safe_start_log_detail(WorkerOperation::ProcessVideo, &spec);
        let exit = safe_exit_log_detail(
            WorkerOperation::ProcessVideo,
            404,
            &output,
            StderrSummary {
                had_diagnostic_output: true,
                reader_failed: false,
            },
        );

        assert!(!start.contains(secret));
        assert!(!start.contains("private"));
        assert!(!start.contains("--prompt"));
        assert!(!exit.contains(secret));
        assert_eq!(
            exit,
            "operation=process_video pid=404 exit=1 stderr=present"
        );
    }

    #[test]
    fn spawn_failure_is_typed_and_never_activates_the_lane() {
        let lane = WorkerLane::default();
        let paths = test_paths("spawn-failure");
        let request = WorkerRunRequest {
            operation: WorkerOperation::ResolveSourceIdentity,
            command: WorkerCommandSpec {
                program: paths.user_data_dir.join("missing-worker-executable"),
                args: Vec::new(),
                stdin_payload: None,
                env: Vec::new(),
                env_remove: Vec::new(),
                current_dir: paths.user_data_dir.clone(),
            },
            progress: ProgressRoute::None,
        };

        let error = lane
            .run(&paths, request)
            .expect_err("missing executable must fail to spawn");

        assert_eq!(error.kind, WorkerRunErrorKind::SpawnFailed);
        assert!(!lane.is_active());
    }

    #[test]
    fn missing_required_pipe_terminates_reaps_and_clears_the_lane() {
        const PROBE_ENV: &str = "FRAMEQ_RUNNER_MISSING_PIPE_PROBE";
        const TEST_NAME: &str = "worker_runtime::runner::tests::missing_required_pipe_terminates_reaps_and_clears_the_lane";
        if std::env::var_os(PROBE_ENV).is_some() {
            std::thread::sleep(Duration::from_secs(30));
            return;
        }

        let lane = WorkerLane::default();
        let paths = test_paths("missing-pipe");
        let error = lane
            .run_with_hooks(
                &paths,
                fixture_request(TEST_NAME, PROBE_ENV, None),
                RunnerHooks {
                    force_missing_stderr: true,
                    ..RunnerHooks::default()
                },
            )
            .expect_err("missing stderr must fail setup");

        assert_eq!(error.kind, WorkerRunErrorKind::PipeUnavailable);
        assert!(!lane.is_active());
    }

    #[test]
    fn wait_failure_terminates_reaps_and_clears_the_lane() {
        const PROBE_ENV: &str = "FRAMEQ_RUNNER_WAIT_FAILURE_PROBE";
        const TEST_NAME: &str =
            "worker_runtime::runner::tests::wait_failure_terminates_reaps_and_clears_the_lane";
        if std::env::var_os(PROBE_ENV).is_some() {
            std::thread::sleep(Duration::from_secs(30));
            return;
        }

        let lane = WorkerLane::default();
        let paths = test_paths("wait-failure");
        let error = lane
            .run_with_hooks(
                &paths,
                fixture_request(TEST_NAME, PROBE_ENV, None),
                RunnerHooks {
                    force_wait_failure: true,
                    ..RunnerHooks::default()
                },
            )
            .expect_err("forced wait failure must be typed");

        assert_eq!(error.kind, WorkerRunErrorKind::WaitFailed);
        assert!(!lane.is_active());
    }

    #[test]
    fn sensitive_request_is_delivered_only_through_stdin() {
        const PROBE_ENV: &str = "FRAMEQ_RUNNER_STDIN_PRIVACY_PROBE";
        const TEST_NAME: &str =
            "worker_runtime::runner::tests::sensitive_request_is_delivered_only_through_stdin";
        const SECRET: &str = "runner-review-secret";
        if std::env::var_os(PROBE_ENV).is_some() {
            let mut stdin = String::new();
            std::io::stdin()
                .read_to_string(&mut stdin)
                .expect("privacy probe reads stdin");
            let argv = std::env::args().collect::<Vec<_>>().join(" ");
            let env_contains_secret = std::env::vars().any(|(_, value)| value.contains(SECRET));
            println!(
                "{}",
                serde_json::json!({
                    "status": "completed",
                    "stdin_received": stdin.contains(SECRET),
                    "argv_contains_secret": argv.contains(SECRET),
                    "env_contains_secret": env_contains_secret,
                })
            );
            return;
        }

        let lane = WorkerLane::default();
        let paths = test_paths("stdin-privacy");
        let payload = format!(r#"{{"url":"https://example.invalid/video?token={SECRET}"}}"#);
        let request = fixture_request(TEST_NAME, PROBE_ENV, Some(payload));

        assert!(!request
            .command
            .args
            .iter()
            .any(|value| value.contains(SECRET)));
        assert!(!request
            .command
            .env
            .iter()
            .any(|(_, value)| value.contains(SECRET)));
        let outcome = lane
            .run(&paths, request)
            .expect("stdin privacy probe succeeds");
        let log = std::fs::read_to_string(crate::diagnostics::desktop_log_path(&paths))
            .expect("read runner log");

        assert!(matches!(
            outcome,
            WorkerRunOutcome::Structured(value)
                if value["stdin_received"] == true
                    && value["argv_contains_secret"] == false
                    && value["env_contains_secret"] == false
        ));
        assert!(!log.contains(SECRET));
        assert!(!lane.is_active());
    }

    #[test]
    fn stdin_delivery_failure_is_typed_sanitized_and_clears_the_lane() {
        const PROBE_ENV: &str = "FRAMEQ_RUNNER_STDIN_FAILURE_PROBE";
        const TEST_NAME: &str = "worker_runtime::runner::tests::stdin_delivery_failure_is_typed_sanitized_and_clears_the_lane";
        const SECRET: &str = "runner-review-secret";
        if std::env::var_os(PROBE_ENV).is_some() {
            return;
        }

        let lane = WorkerLane::default();
        let paths = test_paths("stdin-failure");
        let error = lane
            .run(
                &paths,
                fixture_request(TEST_NAME, PROBE_ENV, Some(SECRET.repeat(256 * 1024))),
            )
            .expect_err("closed child stdin must fail request delivery");
        let log = std::fs::read_to_string(crate::diagnostics::desktop_log_path(&paths))
            .expect("read runner log");

        assert_eq!(error.kind, WorkerRunErrorKind::RequestDeliveryFailed);
        assert_eq!(error.detail, "Worker request delivery failed.");
        assert!(!error.detail.contains(SECRET));
        assert!(!log.contains(SECRET));
        assert!(!lane.is_active());
    }

    #[test]
    fn blocked_stdin_delivery_remains_cancellable() {
        const PROBE_ENV: &str = "FRAMEQ_RUNNER_BLOCKED_STDIN_PROBE";
        const TEST_NAME: &str =
            "worker_runtime::runner::tests::blocked_stdin_delivery_remains_cancellable";
        if std::env::var_os(PROBE_ENV).is_some() {
            std::thread::sleep(Duration::from_secs(30));
            return;
        }

        let lane = Arc::new(WorkerLane::default());
        let operation_lane = Arc::clone(&lane);
        let paths = test_paths("blocked-stdin");
        let operation_paths = paths.clone();
        let operation = std::thread::spawn(move || {
            operation_lane.run(
                &operation_paths,
                fixture_request(TEST_NAME, PROBE_ENV, Some("x".repeat(256 * 1024))),
            )
        });
        wait_until_active(&lane);

        let cancellation = lane.cancel();
        let outcome = operation
            .join()
            .expect("runner thread completes")
            .expect("cancellation is an outcome");

        assert_eq!(cancellation.status, CancelProcessStatus::Cancelling);
        assert_eq!(outcome, WorkerRunOutcome::Cancelled);
        assert!(!lane.is_active());
    }

    #[test]
    fn terminal_observation_finishes_lane_before_stderr_reader_join() {
        const PROBE_ENV: &str = "FRAMEQ_RUNNER_READER_GATE_PROBE";
        const TEST_NAME: &str = "worker_runtime::runner::tests::terminal_observation_finishes_lane_before_stderr_reader_join";
        if std::env::var_os(PROBE_ENV).is_some() {
            println!(r#"{{"status":"completed","task_id":"safe-task"}}"#);
            return;
        }

        let lane = Arc::new(WorkerLane::default());
        let gate = ReaderJoinGate::default();
        let operation_gate = gate.clone();
        let operation_lane = Arc::clone(&lane);
        let paths = test_paths("reader-gate");
        let operation_paths = paths.clone();
        let operation = std::thread::spawn(move || {
            operation_lane.run_with_hooks(
                &operation_paths,
                fixture_request(TEST_NAME, PROBE_ENV, None),
                RunnerHooks {
                    reader_join_gate: Some(operation_gate),
                    ..RunnerHooks::default()
                },
            )
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        while !gate.waiting.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::yield_now();
        }

        assert!(gate.waiting.load(Ordering::SeqCst));
        let finish_deadline = Instant::now() + Duration::from_secs(5);
        while lane.is_active() && Instant::now() < finish_deadline {
            std::thread::yield_now();
        }
        assert!(!lane.is_active());
        assert_eq!(lane.cancel().status, CancelProcessStatus::NotRunning);
        gate.release.store(true, Ordering::SeqCst);
        assert!(matches!(
            operation
                .join()
                .expect("runner thread completes")
                .expect("structured fixture succeeds"),
            WorkerRunOutcome::Structured(value) if value["status"] == "completed"
        ));
    }

    #[test]
    fn stderr_reader_panic_keeps_terminal_outcome_and_uses_fixed_marker() {
        const PROBE_ENV: &str = "FRAMEQ_RUNNER_READER_PANIC_PROBE";
        const TEST_NAME: &str = "worker_runtime::runner::tests::stderr_reader_panic_keeps_terminal_outcome_and_uses_fixed_marker";
        if std::env::var_os(PROBE_ENV).is_some() {
            println!(r#"{{"status":"completed","task_id":"safe-task"}}"#);
            return;
        }

        let lane = WorkerLane::default();
        let paths = test_paths("reader-panic");
        let outcome = lane
            .run_with_hooks(
                &paths,
                fixture_request(TEST_NAME, PROBE_ENV, None),
                RunnerHooks {
                    panic_stderr_reader: true,
                    ..RunnerHooks::default()
                },
            )
            .expect("reader panic must not replace child outcome");
        let log = std::fs::read_to_string(crate::diagnostics::desktop_log_path(&paths))
            .expect("read runner log");

        assert!(matches!(
            outcome,
            WorkerRunOutcome::Structured(value) if value["status"] == "completed"
        ));
        assert!(log.contains("stderr=reader_failed"));
    }

    fn fixture_request(
        test_name: &str,
        probe_env: &str,
        stdin_payload: Option<String>,
    ) -> WorkerRunRequest {
        WorkerRunRequest {
            operation: WorkerOperation::ProcessVideo,
            command: WorkerCommandSpec {
                program: std::env::current_exe().expect("resolve test executable"),
                args: vec![
                    "--exact".to_string(),
                    test_name.to_string(),
                    "--nocapture".to_string(),
                ],
                stdin_payload,
                env: vec![(probe_env.to_string(), "1".to_string())],
                env_remove: Vec::new(),
                current_dir: std::env::current_dir().expect("resolve test directory"),
            },
            progress: ProgressRoute::None,
        }
    }

    fn wait_until_active(lane: &WorkerLane) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !lane.is_active() && Instant::now() < deadline {
            std::thread::yield_now();
        }
        assert!(lane.is_active(), "runner did not become active");
    }

    fn test_paths(label: &str) -> RuntimePaths {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "frameq-worker-runner-{label}-{}-{nonce}",
            std::process::id()
        ));
        RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("user-data"),
        }
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
