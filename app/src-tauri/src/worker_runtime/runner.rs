mod progress;
mod watchdog;

pub(crate) use progress::ProgressRoute;
use progress::{read_stderr, StderrSummary};
use watchdog::start_watchdog;
pub(super) use watchdog::WatchdogPolicy;

use super::command::js_runtime_diagnostics;
use super::command::WorkerCommandSpec;
use super::result_protocol::{
    parse_terminal_result, TerminalResultError, ValidatedWorkerResult, WORKER_PROTOCOL_MESSAGE,
};
use super::supervisor::{
    hide_child_console_window, request_process_cancellation, terminate_process_tree,
    CancelProcessResult, CleanupClaim, ProcessInstance, ProcessPhase, ProcessSupervisor,
};
use crate::{append_desktop_log, RuntimePaths};
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WorkerOperation {
    ProcessVideo,
    RetryInsights,
    ResolveSourceIdentity,
    DownloadAsrModel,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WorkerTimeoutKind {
    Idle,
    Absolute,
}

impl WorkerTimeoutKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Absolute => "absolute",
        }
    }
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

pub(crate) struct WorkerRunRequest {
    pub(crate) operation: WorkerOperation,
    pub(crate) command: WorkerCommandSpec,
    pub(crate) progress: ProgressRoute,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WorkerRunErrorKind {
    AlreadyRunning,
    SpawnFailed,
    WatchdogStartFailed,
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
            WORKER_PROTOCOL_MESSAGE,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WorkerExitSummary {
    pub(crate) exit_code: Option<i32>,
    pub(crate) stderr: &'static str,
}

#[derive(Debug, PartialEq)]
pub(crate) enum WorkerRunOutcome {
    Structured(ValidatedWorkerResult),
    Cancelled,
    TimedOut(WorkerTimeoutKind),
    UnstructuredFailure(WorkerExitSummary),
}

#[derive(Default)]
pub(crate) struct WorkerLane {
    supervisor: Arc<ProcessSupervisor>,
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
        let mut instance_guard = InstanceGuard::new(self.supervisor.as_ref(), instance);
        let watchdog = match start_watchdog(
            paths.clone(),
            operation,
            Arc::clone(&self.supervisor),
            instance,
            hooks.watchdog_policy(operation),
            hooks.watchdog_retry_backoff(),
            hooks.force_watchdog_start_failure(),
        ) {
            Ok(watchdog) => watchdog,
            Err(error) => {
                cleanup_registered_child(&mut child, self.supervisor.as_ref(), instance);
                instance_guard.finish();
                return Err(error);
            }
        };

        if deliver_worker_stdin(&mut child, stdin_payload).is_err() {
            watchdog.stop_and_join();
            cleanup_registered_child(&mut child, self.supervisor.as_ref(), instance);
            let phase = instance_guard.finish();
            if phase == Some(ProcessPhase::Cancelling) {
                return Ok(WorkerRunOutcome::Cancelled);
            }
            if let Some(ProcessPhase::TimingOut(kind)) = phase {
                return Ok(WorkerRunOutcome::TimedOut(kind));
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
            watchdog.stop_and_join();
            cleanup_registered_child(&mut child, self.supervisor.as_ref(), instance);
            instance_guard.finish();
            return Err(WorkerRunError::new(
                WorkerRunErrorKind::PipeUnavailable,
                "Worker stdout pipe was unavailable.",
            ));
        };
        let Some(stderr) = child.stderr.take() else {
            watchdog.stop_and_join();
            cleanup_registered_child(&mut child, self.supervisor.as_ref(), instance);
            instance_guard.finish();
            return Err(WorkerRunError::new(
                WorkerRunErrorKind::PipeUnavailable,
                "Worker stderr pipe was unavailable.",
            ));
        };

        let panic_stdout_reader = hooks.panic_stdout_reader;
        let stdout_reader = std::thread::spawn(move || {
            if panic_stdout_reader {
                panic!("forced stdout reader failure");
            }
            let mut stdout = stdout;
            let mut bytes = Vec::new();
            stdout.read_to_end(&mut bytes).map(|_| bytes)
        });
        let progress_paths = paths.clone();
        let reader_hooks = hooks.clone();
        let watchdog_activity = watchdog.activity();
        let stderr_reader = std::thread::spawn(move || {
            read_stderr(
                stderr,
                progress,
                progress_paths,
                reader_hooks,
                watchdog_activity,
            )
        });

        if hooks.force_wait_failure {
            watchdog.stop_and_join();
            cleanup_registered_child(&mut child, self.supervisor.as_ref(), instance);
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
                watchdog.stop_and_join();
                cleanup_registered_child(&mut child, self.supervisor.as_ref(), instance);
                instance_guard.finish();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(WorkerRunError::new(
                    WorkerRunErrorKind::WaitFailed,
                    "Worker process wait failed.",
                ));
            }
        };
        watchdog.stop_and_join();
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

        let outcome = classify_terminal(operation, &output, terminal_phase, stderr)?;
        let terminal = match &outcome {
            WorkerRunOutcome::Structured(_) => "structured",
            WorkerRunOutcome::Cancelled => "cancelled",
            WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Idle) => "idle_timeout",
            WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Absolute) => "absolute_timeout",
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
    panic_stdout_reader: bool,
    panic_stderr_reader: bool,
    reader_join_gate: Option<ReaderJoinGate>,
    #[cfg(test)]
    watchdog_policy: Option<WatchdogPolicy>,
    #[cfg(test)]
    watchdog_retry_backoff: Option<Duration>,
    #[cfg(test)]
    force_watchdog_start_failure: bool,
}

impl RunnerHooks {
    fn watchdog_policy(&self, operation: WorkerOperation) -> WatchdogPolicy {
        #[cfg(test)]
        if let Some(policy) = self.watchdog_policy {
            return policy;
        }
        operation.watchdog_policy()
    }

    fn watchdog_retry_backoff(&self) -> Duration {
        #[cfg(test)]
        if let Some(backoff) = self.watchdog_retry_backoff {
            return backoff;
        }
        Duration::from_secs(1)
    }

    fn force_watchdog_start_failure(&self) -> bool {
        #[cfg(test)]
        {
            return self.force_watchdog_start_failure;
        }
        #[cfg(not(test))]
        false
    }
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

fn cleanup_registered_child(
    child: &mut std::process::Child,
    supervisor: &ProcessSupervisor,
    instance: ProcessInstance,
) {
    loop {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        match supervisor.claim_cleanup(instance.instance_id) {
            CleanupClaim::Claimed(claimed) => {
                let _ = terminate_process_tree(claimed.process_group_id.unwrap_or(claimed.pid));
                let _ = child.wait();
                return;
            }
            CleanupClaim::AlreadyTerminating(_) => {
                std::thread::sleep(Duration::from_millis(10));
            }
            CleanupClaim::NotRunning => {
                let _ = child.wait();
                return;
            }
        }
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
    operation: WorkerOperation,
    output: &Output,
    terminal_phase: Option<ProcessPhase>,
    stderr: StderrSummary,
) -> Result<WorkerRunOutcome, WorkerRunError> {
    let parse_error = match parse_terminal_result(operation, &output.stdout) {
        Ok(value) => return Ok(WorkerRunOutcome::Structured(value)),
        Err(error) => error,
    };
    if terminal_phase == Some(ProcessPhase::Cancelling) {
        return Ok(WorkerRunOutcome::Cancelled);
    }
    if let Some(ProcessPhase::TimingOut(kind)) = terminal_phase {
        return Ok(WorkerRunOutcome::TimedOut(kind));
    }
    match parse_error {
        TerminalResultError::Invalid => Err(WorkerRunError::protocol_violation()),
        TerminalResultError::Missing if output.status.success() => {
            Err(WorkerRunError::protocol_violation())
        }
        TerminalResultError::Missing => {
            Ok(WorkerRunOutcome::UnstructuredFailure(WorkerExitSummary {
                exit_code: output.status.code(),
                stderr: stderr.marker(),
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::progress::{inspect_progress_line, ProgressProtocol, ProgressRecord, StderrSummary};
    use super::watchdog::{
        run_watchdog_with_terminator, select_watchdog_deadline, WatchdogControl,
    };
    use super::{
        classify_terminal, safe_exit_log_detail, safe_start_log_detail, ProgressRoute,
        ReaderJoinGate, RunnerHooks, WatchdogPolicy, WorkerLane, WorkerOperation,
        WorkerRunErrorKind, WorkerRunOutcome, WorkerRunRequest, WorkerTimeoutKind,
    };
    use crate::worker_runtime::result_protocol::{TaskTerminalStatus, ValidatedWorkerResult};
    use crate::worker_runtime::supervisor::CancelProcessStatus;
    use crate::worker_runtime::supervisor::ProcessPhase;
    use crate::worker_runtime::WorkerCommandSpec;
    use crate::RuntimePaths;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Output, Stdio};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    fn collect_runner_rust_sources(dir: &Path, sources: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("read Rust source directory") {
            let path = entry.expect("read Rust source entry").path();
            if path.is_dir() {
                collect_runner_rust_sources(&path, sources);
            } else if path.extension().and_then(|value| value.to_str()) == Some("rs") {
                sources.push(path);
            }
        }
    }

    fn direct_rust_file_names(dir: &Path) -> Vec<String> {
        let mut names = std::fs::read_dir(dir)
            .expect("read Rust owner directory")
            .map(|entry| entry.expect("read Rust owner entry").path())
            .filter(|path| path.is_file())
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("rs"))
            .map(|path| {
                path.file_name()
                    .and_then(|value| value.to_str())
                    .expect("UTF-8 Rust file name")
                    .to_string()
            })
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    #[test]
    fn worker_runner_module_boundary_matches_approved_private_owners() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let runtime_dir = src.join("worker_runtime");
        let root_path = runtime_dir.join("runner.rs");
        let module_dir = runtime_dir.join("runner");
        let root = std::fs::read_to_string(&root_path).expect("read runner root");
        let progress_event = std::fs::read_to_string(src.join("progress_event.rs"))
            .expect("read shared progress boundary");
        let asr_model =
            std::fs::read_to_string(src.join("asr_model.rs")).expect("read ASR model owner");
        let process_io = std::fs::read_to_string(module_dir.join("process_io.rs"))
            .expect("read process I/O owner");
        let watchdog =
            std::fs::read_to_string(module_dir.join("watchdog.rs")).expect("read watchdog owner");
        let progress =
            std::fs::read_to_string(module_dir.join("progress.rs")).expect("read progress owner");
        let terminal =
            std::fs::read_to_string(module_dir.join("terminal.rs")).expect("read terminal owner");

        assert_eq!(
            direct_rust_file_names(&module_dir),
            vec![
                String::from("process_io.rs"),
                String::from("progress.rs"),
                String::from("terminal.rs"),
                String::from("tests.rs"),
                String::from("watchdog.rs"),
            ]
        );
        assert_eq!(
            direct_rust_file_names(&module_dir.join("tests")),
            vec![
                String::from("fixtures.rs"),
                String::from("lifecycle.rs"),
                String::from("progress.rs"),
                String::from("terminal.rs"),
                String::from("watchdog.rs"),
            ]
        );

        assert!(root.lines().count() <= 500, "runner root exceeds 500 lines");
        for (name, source) in [
            ("process_io", process_io.as_str()),
            ("watchdog", watchdog.as_str()),
            ("progress", progress.as_str()),
            ("terminal", terminal.as_str()),
        ] {
            assert!(
                source.lines().count() <= 400,
                "{name} exceeds the approved 400-line review alarm"
            );
        }
        for relative in [
            "tests.rs",
            "tests/fixtures.rs",
            "tests/lifecycle.rs",
            "tests/progress.rs",
            "tests/terminal.rs",
            "tests/watchdog.rs",
        ] {
            let source = std::fs::read_to_string(module_dir.join(relative))
                .unwrap_or_else(|_| panic!("read test owner {relative}"));
            assert!(
                source.lines().count() <= 500,
                "{relative} recreates a test hotspot"
            );
        }

        for module in ["process_io", "progress", "terminal", "watchdog", "tests"] {
            let declaration = format!("mod {module};");
            assert!(
                root.lines().any(|line| line.trim() == declaration.as_str()),
                "missing private {declaration}"
            );
        }
        assert!(root.contains("pub(crate) use progress::ProgressRoute;"));
        assert!(root.contains("pub(crate) use terminal::WorkerExitSummary;"));
        assert!(root.contains("pub(super) use watchdog::WatchdogPolicy;"));

        for moved in [
            "fn configure_child_process_group",
            "struct WatchdogControl",
            "pub(crate) enum ProgressRoute",
            "fn read_stderr",
            "fn safe_start_log_detail",
            "fn classify_terminal",
        ] {
            assert!(!root.contains(moved), "runner root still owns {moved}");
        }
        assert!(root.contains("pub(crate) struct WorkerLane"));
        assert!(root.contains("fn run_inner"));
        assert!(root.contains("struct InstanceGuard"));
        assert!(root.contains("struct RunnerHooks"));

        for required in [
            "pub(super) fn configure_child_process_group",
            "pub(super) fn spawn_worker_process",
            "pub(super) fn deliver_worker_stdin",
            "pub(super) fn read_worker_stdout",
            "pub(super) fn terminate_and_reap",
            "pub(super) fn cleanup_registered_child",
        ] {
            assert!(
                process_io.contains(required),
                "process_io missing {required}"
            );
        }
        for required in [
            "pub(in crate::worker_runtime) struct WatchdogPolicy",
            "pub(in crate::worker_runtime) fn idle_timeout",
            "pub(in crate::worker_runtime) fn absolute_timeout",
            "pub(in crate::worker_runtime) fn watchdog_policy",
            "pub(super) struct WatchdogControl",
            "pub(super) fn record_validated_progress",
            "pub(super) struct WatchdogHandle",
            "pub(super) fn start_watchdog",
            "pub(super) fn run_watchdog_with_terminator",
        ] {
            assert!(watchdog.contains(required), "watchdog missing {required}");
        }
        for required in [
            "pub(crate) enum ProgressRoute",
            "pub(super) struct StderrSummary",
            "pub(super) fn read_stderr",
            "pub(super) fn inspect_progress_line",
        ] {
            assert!(progress.contains(required), "progress missing {required}");
        }
        for required in [
            "pub(crate) struct WorkerExitSummary",
            "pub(super) fn safe_start_log_detail",
            "pub(super) fn safe_exit_log_detail",
            "pub(super) fn classify_terminal",
        ] {
            assert!(terminal.contains(required), "terminal missing {required}");
        }

        assert!(progress.contains("super::watchdog"));
        assert!(terminal.contains("super::progress"));
        for constant in [
            "ASR_MODEL_DOWNLOAD_EVENT_NAME",
            "MODEL_DOWNLOAD_EVENT_PREFIX",
        ] {
            let definition = format!("pub(crate) const {constant}");
            assert!(
                progress_event.contains(definition.as_str()),
                "shared progress boundary must define {constant}"
            );
            assert!(
                asr_model.contains("pub(crate) use crate::progress_event")
                    && asr_model.contains(constant),
                "ASR model compatibility path must re-export {constant}"
            );
            assert!(
                !asr_model.contains(definition.as_str()),
                "ASR model must not define {constant}"
            );
        }
        for (name, source, forbidden_edges) in [
            (
                "process_io",
                process_io.as_str(),
                ["super::watchdog", "super::progress", "super::terminal"].as_slice(),
            ),
            (
                "watchdog",
                watchdog.as_str(),
                ["super::process_io", "super::progress", "super::terminal"].as_slice(),
            ),
            (
                "progress",
                progress.as_str(),
                ["super::process_io", "super::terminal"].as_slice(),
            ),
            (
                "terminal",
                terminal.as_str(),
                ["super::process_io", "super::watchdog"].as_slice(),
            ),
        ] {
            for &forbidden in forbidden_edges {
                assert!(
                    !source.contains(forbidden),
                    "{name} has forbidden dependency {forbidden}"
                );
            }
            for forbidden in [
                "crate::worker_runtime::runner::",
                "crate::account",
                "crate::asr_model",
                "crate::history",
                "crate::insight_preferences",
                "crate::settings",
                "crate::task_manifest",
                "crate::transcript_detail",
                "crate::ui_preferences",
                "crate::updates",
                "crate::video_processing",
                "termination_command_spec",
                "send_process_group_signal",
                "ProcessSignal",
                "taskkill",
                "tauri::command",
                "struct WorkerLane",
                "fn run_inner",
                "fn cancel(",
                "fn is_active(",
            ] {
                assert!(
                    !source.contains(forbidden),
                    "{name} contains forbidden ownership {forbidden}"
                );
            }
        }

        let mut sources = Vec::new();
        collect_runner_rust_sources(&src, &mut sources);
        for path in sources {
            if path == root_path || path.starts_with(&module_dir) {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("read Rust caller");
            for forbidden in [
                "runner::process_io",
                "runner::watchdog",
                "runner::progress",
                "runner::terminal",
            ] {
                assert!(
                    !source.contains(forbidden),
                    "{} bypasses the stable runner through {forbidden}",
                    path.display()
                );
            }
        }
    }

    #[test]
    fn worker_operations_own_exact_closed_production_watchdog_policies() {
        let cases = [
            (
                WorkerOperation::ProcessVideo,
                WatchdogPolicy {
                    idle_timeout: Some(Duration::from_secs(45 * 60)),
                    absolute_timeout: Duration::from_secs(8 * 60 * 60),
                },
            ),
            (
                WorkerOperation::RetryInsights,
                WatchdogPolicy {
                    idle_timeout: Some(Duration::from_secs(10 * 60)),
                    absolute_timeout: Duration::from_secs(30 * 60),
                },
            ),
            (
                WorkerOperation::ResolveSourceIdentity,
                WatchdogPolicy {
                    idle_timeout: None,
                    absolute_timeout: Duration::from_secs(3 * 60),
                },
            ),
            (
                WorkerOperation::DownloadAsrModel,
                WatchdogPolicy {
                    idle_timeout: Some(Duration::from_secs(10 * 60)),
                    absolute_timeout: Duration::from_secs(4 * 60 * 60),
                },
            ),
        ];

        for (operation, expected) in cases {
            assert_eq!(operation.watchdog_policy(), expected);
        }
    }

    #[test]
    fn watchdog_deadline_selection_prefers_absolute_on_an_exact_tie() {
        let origin = Instant::now();
        let idle_first = origin + Duration::from_secs(1);
        let absolute_later = origin + Duration::from_secs(2);

        assert_eq!(
            select_watchdog_deadline(Some(idle_first), absolute_later),
            (idle_first, WorkerTimeoutKind::Idle)
        );
        assert_eq!(
            select_watchdog_deadline(Some(absolute_later), idle_first),
            (idle_first, WorkerTimeoutKind::Absolute)
        );
        assert_eq!(
            select_watchdog_deadline(Some(idle_first), idle_first),
            (idle_first, WorkerTimeoutKind::Absolute)
        );
        assert_eq!(
            select_watchdog_deadline(None, absolute_later),
            (absolute_later, WorkerTimeoutKind::Absolute)
        );
    }

    #[test]
    fn failed_timeout_signal_rolls_back_logs_safely_and_retries_with_backoff() {
        const RAW_FAILURE: &str = "WATCHDOG_RAW_FAILURE_SENTINEL";
        let supervisor = Arc::new(crate::worker_runtime::supervisor::ProcessSupervisor::default());
        let instance = supervisor.start(404).expect("worker starts");
        let control = Arc::new(WatchdogControl::new());
        let attempts = Arc::new(AtomicUsize::new(0));
        let paths = test_paths("watchdog-signal-retry");
        let thread_supervisor = Arc::clone(&supervisor);
        let thread_control = Arc::clone(&control);
        let thread_attempts = Arc::clone(&attempts);
        let thread_paths = paths.clone();
        let watchdog = std::thread::spawn(move || {
            run_watchdog_with_terminator(
                &thread_paths,
                WorkerOperation::ProcessVideo,
                &thread_supervisor,
                instance,
                WatchdogPolicy {
                    idle_timeout: None,
                    absolute_timeout: Duration::from_millis(5),
                },
                Duration::from_millis(15),
                &thread_control,
                |_| {
                    thread_attempts.fetch_add(1, Ordering::SeqCst);
                    Err(RAW_FAILURE.to_string())
                },
            );
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        while attempts.load(Ordering::SeqCst) < 3 && Instant::now() < deadline {
            std::thread::yield_now();
        }
        control.stop();
        watchdog.join().expect("watchdog exits after stop");

        assert!(attempts.load(Ordering::SeqCst) >= 3);
        assert_eq!(
            supervisor.phase_for(instance.instance_id),
            Some(ProcessPhase::Running)
        );
        let log = std::fs::read_to_string(crate::diagnostics::desktop_log_path(&paths))
            .expect("read watchdog log");
        assert!(log.contains("timeout=absolute signal=failed"));
        assert!(!log.contains(RAW_FAILURE));
        assert_eq!(
            supervisor.finish(instance.instance_id),
            Some(ProcessPhase::Running)
        );
    }

    #[test]
    fn structured_result_wins_a_concurrent_cancellation_claim() {
        let output = Output {
            status: exit_status(1),
            stdout: valid_task_stdout().as_bytes().to_vec(),
            stderr: Vec::new(),
        };

        let outcome = classify_terminal(
            WorkerOperation::ProcessVideo,
            &output,
            Some(ProcessPhase::Cancelling),
            StderrSummary::default(),
        )
        .expect("structured result remains authoritative");

        assert!(matches!(
            outcome,
            WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(value))
                if value.status == TaskTerminalStatus::Completed
        ));
    }

    #[test]
    fn structured_result_wins_a_concurrent_timeout_claim() {
        let output = Output {
            status: exit_status(1),
            stdout: valid_task_stdout().as_bytes().to_vec(),
            stderr: Vec::new(),
        };

        let outcome = classify_terminal(
            WorkerOperation::ProcessVideo,
            &output,
            Some(ProcessPhase::TimingOut(WorkerTimeoutKind::Idle)),
            StderrSummary::default(),
        )
        .expect("structured result remains authoritative");

        assert!(matches!(
            outcome,
            WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(value))
                if value.status == TaskTerminalStatus::Completed
        ));
    }

    #[test]
    fn timeout_phase_is_classified_only_when_no_structured_result_exists() {
        let output = Output {
            status: exit_status(1),
            stdout: Vec::new(),
            stderr: Vec::new(),
        };

        assert_eq!(
            classify_terminal(
                WorkerOperation::ProcessVideo,
                &output,
                Some(ProcessPhase::TimingOut(WorkerTimeoutKind::Absolute)),
                StderrSummary::default(),
            ),
            Ok(WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Absolute))
        );
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
        let missing_failure = Output {
            status: exit_status(1),
            stdout: Vec::new(),
            stderr: Vec::new(),
        };

        assert!(matches!(
            classify_terminal(
                WorkerOperation::ProcessVideo,
                &malformed_failure,
                Some(ProcessPhase::Cancelling),
                StderrSummary::default(),
            ),
            Ok(WorkerRunOutcome::Cancelled)
        ));
        assert!(matches!(
            classify_terminal(
                WorkerOperation::ProcessVideo,
                &malformed_success,
                Some(ProcessPhase::Running),
                StderrSummary::default(),
            ),
            Err(error) if error.kind == WorkerRunErrorKind::ProtocolViolation
        ));
        assert!(matches!(
            classify_terminal(
                WorkerOperation::ProcessVideo,
                &missing_failure,
                Some(ProcessPhase::Running),
                StderrSummary {
                    had_diagnostic_output: true,
                    reader_failed: false,
                },
            ),
            Ok(WorkerRunOutcome::UnstructuredFailure(summary))
                if summary.exit_code == Some(1) && summary.stderr == "present"
        ));
        assert!(matches!(
            classify_terminal(
                WorkerOperation::ProcessVideo,
                &malformed_failure,
                Some(ProcessPhase::Running),
                StderrSummary::default(),
            ),
            Err(error)
                if error.kind == WorkerRunErrorKind::ProtocolViolation
                    && error.detail == "Worker result violated the terminal protocol."
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
        const SECRET: &str = "runner-review-secret";

        let lane = WorkerLane::default();
        let paths = test_paths("stdin-privacy");
        let payload = format!(r#"{{"url":"https://example.invalid/video?token={SECRET}"}}"#);
        let request = terminal_fixture_request(Some(payload), true);

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
            WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(value))
                if value.status == TaskTerminalStatus::Completed
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
        let lane = Arc::new(WorkerLane::default());
        let gate = ReaderJoinGate::default();
        let operation_gate = gate.clone();
        let operation_lane = Arc::clone(&lane);
        let paths = test_paths("reader-gate");
        let operation_paths = paths.clone();
        let operation = std::thread::spawn(move || {
            operation_lane.run_with_hooks(
                &operation_paths,
                terminal_fixture_request(None, false),
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
            WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(value))
                if value.status == TaskTerminalStatus::Completed
        ));
    }

    #[test]
    fn stderr_reader_panic_keeps_terminal_outcome_and_uses_fixed_marker() {
        let lane = WorkerLane::default();
        let paths = test_paths("reader-panic");
        let outcome = lane
            .run_with_hooks(
                &paths,
                terminal_fixture_request(None, false),
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
            WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(value))
                if value.status == TaskTerminalStatus::Completed
        ));
        assert!(log.contains("stderr=reader_failed"));
    }

    #[test]
    fn stdout_reader_panic_finishes_lane_and_returns_fixed_protocol_error() {
        let lane = WorkerLane::default();
        let paths = test_paths("stdout-reader-panic");
        let error = lane
            .run_with_hooks(
                &paths,
                terminal_fixture_request(None, false),
                RunnerHooks {
                    panic_stdout_reader: true,
                    ..RunnerHooks::default()
                },
            )
            .expect_err("stdout reader panic must remain a protocol error");

        assert_eq!(error.kind, WorkerRunErrorKind::ProtocolViolation);
        assert_eq!(error.detail, "Worker stdout reader failed.");
        assert!(!lane.is_active());
    }

    #[test]
    fn silent_fixture_hits_the_idle_deadline_and_clears_the_lane() {
        let lane = WorkerLane::default();
        let paths = test_paths("watchdog-silent-idle");

        let outcome = lane
            .run_with_hooks(
                &paths,
                watchdog_fixture_request(
                    WorkerOperation::ProcessVideo,
                    ProgressRoute::Worker,
                    silent_fixture_script(),
                    None,
                ),
                watchdog_hooks(Some(1_500), 8_000),
            )
            .expect("silent worker is a timeout outcome");

        assert_eq!(outcome, WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Idle));
        assert!(!lane.is_active());
        assert!(matches!(
            lane.run(&paths, terminal_fixture_request(None, false))
                .expect("timeout cleanup admits a second task"),
            WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(value))
                if value.status == TaskTerminalStatus::Completed
        ));
        assert!(!lane.is_active());
    }

    #[test]
    fn validated_progress_resets_idle_activity_until_normal_completion() {
        let lane = WorkerLane::default();
        let paths = test_paths("watchdog-valid-progress");

        let outcome = lane
            .run_with_hooks(
                &paths,
                watchdog_fixture_request(
                    WorkerOperation::ProcessVideo,
                    ProgressRoute::Worker,
                    progress_then_result_fixture_script(),
                    None,
                ),
                watchdog_hooks(Some(1_500), 8_000),
            )
            .expect("validated progress keeps the idle deadline alive");

        assert!(matches!(
            outcome,
            WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(value))
                if value.status == TaskTerminalStatus::Completed
        ));
        assert!(!lane.is_active());
    }

    #[test]
    fn endless_validated_progress_cannot_extend_the_absolute_deadline() {
        let lane = WorkerLane::default();
        let paths = test_paths("watchdog-absolute");

        let outcome = lane
            .run_with_hooks(
                &paths,
                watchdog_fixture_request(
                    WorkerOperation::ProcessVideo,
                    ProgressRoute::Worker,
                    endless_progress_fixture_script(),
                    None,
                ),
                watchdog_hooks(Some(1_500), 2_500),
            )
            .expect("absolute timeout is a typed outcome");

        assert_eq!(
            outcome,
            WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Absolute)
        );
        assert!(!lane.is_active());
    }

    #[test]
    fn malformed_diagnostic_empty_and_stdout_spam_do_not_reset_idle_activity() {
        let lane = WorkerLane::default();
        let paths = test_paths("watchdog-untrusted-spam");

        let outcome = lane
            .run_with_hooks(
                &paths,
                watchdog_fixture_request(
                    WorkerOperation::ProcessVideo,
                    ProgressRoute::Worker,
                    untrusted_spam_fixture_script(),
                    None,
                ),
                watchdog_hooks(Some(1_500), 8_000),
            )
            .expect("untrusted output cannot keep the worker alive");

        assert_eq!(outcome, WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Idle));
        assert!(!lane.is_active());
    }

    #[test]
    fn source_identity_is_absolute_only_even_when_stderr_looks_like_progress() {
        let lane = WorkerLane::default();
        let paths = test_paths("watchdog-source-identity");

        let outcome = lane
            .run_with_hooks(
                &paths,
                watchdog_fixture_request(
                    WorkerOperation::ResolveSourceIdentity,
                    ProgressRoute::None,
                    endless_progress_fixture_script(),
                    None,
                ),
                watchdog_hooks(None, 2_000),
            )
            .expect("source identity uses an absolute-only timeout");

        assert_eq!(
            outcome,
            WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Absolute)
        );
        assert!(!lane.is_active());
    }

    #[test]
    fn watchdog_times_out_while_stdin_delivery_is_blocked() {
        let lane = WorkerLane::default();
        let paths = test_paths("watchdog-blocked-stdin");

        let outcome = lane
            .run_with_hooks(
                &paths,
                watchdog_fixture_request(
                    WorkerOperation::ProcessVideo,
                    ProgressRoute::Worker,
                    silent_fixture_script(),
                    Some("x".repeat(4 * 1024 * 1024)),
                ),
                watchdog_hooks(Some(1_500), 8_000),
            )
            .expect("watchdog must act while stdin delivery blocks");

        assert_eq!(outcome, WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Idle));
        assert!(!lane.is_active());
    }

    #[test]
    fn watchdog_timeout_terminates_parent_and_descendant_then_admits_second_task() {
        let lane = Arc::new(WorkerLane::default());
        let paths = test_paths("watchdog-native-tree");
        let pid_file = paths.user_data_dir.join("descendant.pid");
        std::fs::create_dir_all(&paths.user_data_dir).expect("create fixture directory");

        let runner_lane = Arc::clone(&lane);
        let runner_paths = paths.clone();
        let runner_pid_file = pid_file.clone();
        let runner = std::thread::spawn(move || {
            runner_lane.run_with_hooks(
                &runner_paths,
                watchdog_tree_fixture_request(&runner_pid_file),
                watchdog_hooks(Some(4_000), 12_000),
            )
        });

        let descendant_pid = match wait_for_numeric_fixture_pid(&pid_file, Duration::from_secs(3)) {
            Some(pid) => pid,
            None => {
                let _ = runner.join();
                panic!("fixture descendant did not publish a numeric PID");
            }
        };
        assert!(fixture_process_is_alive(descendant_pid));
        assert!(lane.is_active());

        let outcome = runner
            .join()
            .expect("watchdog fixture runner joins")
            .expect("watchdog timeout is a typed outcome");
        assert_eq!(outcome, WorkerRunOutcome::TimedOut(WorkerTimeoutKind::Idle));
        assert!(!lane.is_active());
        wait_until_fixture_process_is_gone(descendant_pid);

        assert!(matches!(
            lane.run(&paths, terminal_fixture_request(None, false))
                .expect("joined watchdog admits a second task on the same lane"),
            WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(value))
                if value.status == TaskTerminalStatus::Completed
        ));
        assert!(!lane.is_active());
    }

    #[test]
    fn structured_result_written_before_timeout_remains_authoritative() {
        let lane = WorkerLane::default();
        let paths = test_paths("watchdog-structured-first");

        let outcome = lane
            .run_with_hooks(
                &paths,
                watchdog_fixture_request(
                    WorkerOperation::ProcessVideo,
                    ProgressRoute::Worker,
                    result_then_stall_fixture_script(),
                    None,
                ),
                watchdog_hooks(Some(1_500), 8_000),
            )
            .expect("valid stdout wins a concurrent timeout claim");

        assert!(matches!(
            outcome,
            WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(value))
                if value.status == TaskTerminalStatus::Completed
        ));
        assert!(!lane.is_active());
    }

    #[test]
    fn watchdog_start_failure_reaps_clears_and_admits_a_second_task() {
        let lane = WorkerLane::default();
        let paths = test_paths("watchdog-start-failure");
        let error = lane
            .run_with_hooks(
                &paths,
                watchdog_fixture_request(
                    WorkerOperation::ProcessVideo,
                    ProgressRoute::Worker,
                    silent_fixture_script(),
                    None,
                ),
                RunnerHooks {
                    watchdog_policy: Some(WatchdogPolicy {
                        idle_timeout: Some(Duration::from_millis(1_500)),
                        absolute_timeout: Duration::from_millis(8_000),
                    }),
                    force_watchdog_start_failure: true,
                    ..RunnerHooks::default()
                },
            )
            .expect_err("forced watchdog startup failure is typed");

        assert_eq!(error.kind, WorkerRunErrorKind::WatchdogStartFailed);
        assert_eq!(error.detail, "Worker watchdog failed to start.");
        assert!(!lane.is_active());

        assert!(matches!(
            lane.run(&paths, terminal_fixture_request(None, false))
                .expect("a second task starts only after cleanup"),
            WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(value))
                if value.status == TaskTerminalStatus::Completed
        ));
        assert!(!lane.is_active());
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

    fn watchdog_hooks(idle_timeout_ms: Option<u64>, absolute_timeout_ms: u64) -> RunnerHooks {
        RunnerHooks {
            watchdog_policy: Some(WatchdogPolicy {
                idle_timeout: idle_timeout_ms.map(Duration::from_millis),
                absolute_timeout: Duration::from_millis(absolute_timeout_ms),
            }),
            watchdog_retry_backoff: Some(Duration::from_millis(25)),
            ..RunnerHooks::default()
        }
    }

    fn watchdog_fixture_request(
        operation: WorkerOperation,
        progress: ProgressRoute,
        script: String,
        stdin_payload: Option<String>,
    ) -> WorkerRunRequest {
        let (program, args) = shell_fixture_command(script);
        WorkerRunRequest {
            operation,
            command: WorkerCommandSpec {
                program,
                args,
                stdin_payload,
                env: Vec::new(),
                env_remove: Vec::new(),
                current_dir: std::env::current_dir().expect("resolve test directory"),
            },
            progress,
        }
    }

    fn watchdog_tree_fixture_request(pid_file: &Path) -> WorkerRunRequest {
        let (program, args) = shell_fixture_command(watchdog_tree_fixture_script());
        WorkerRunRequest {
            operation: WorkerOperation::ProcessVideo,
            command: WorkerCommandSpec {
                program,
                args,
                stdin_payload: None,
                env: vec![(
                    "FRAMEQ_TEST_CHILD_PID_FILE".to_string(),
                    pid_file.to_string_lossy().into_owned(),
                )],
                env_remove: Vec::new(),
                current_dir: std::env::current_dir().expect("resolve test directory"),
            },
            progress: ProgressRoute::None,
        }
    }

    #[cfg(windows)]
    fn shell_fixture_command(script: String) -> (PathBuf, Vec<String>) {
        (
            PathBuf::from("powershell.exe"),
            vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                script,
            ],
        )
    }

    #[cfg(unix)]
    fn shell_fixture_command(script: String) -> (PathBuf, Vec<String>) {
        (PathBuf::from("/bin/sh"), vec!["-c".to_string(), script])
    }

    fn valid_progress_line() -> &'static str {
        r#"FRAMEQ_PROGRESS {"stage":"video_extracting","progress":22,"message_code":"video.download.preparing"}"#
    }

    #[cfg(windows)]
    fn silent_fixture_script() -> String {
        "Start-Sleep -Seconds 30".to_string()
    }

    #[cfg(unix)]
    fn silent_fixture_script() -> String {
        "sleep 30".to_string()
    }

    #[cfg(windows)]
    fn watchdog_tree_fixture_script() -> String {
        "$child = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30') -PassThru -WindowStyle Hidden; [System.IO.File]::WriteAllText($env:FRAMEQ_TEST_CHILD_PID_FILE, [string]$child.Id); Wait-Process -Id $child.Id".to_string()
    }

    #[cfg(unix)]
    fn watchdog_tree_fixture_script() -> String {
        "sleep 30 & child_pid=$!; printf '%s' \"$child_pid\" > \"$FRAMEQ_TEST_CHILD_PID_FILE\"; trap 'wait \"$child_pid\" 2>/dev/null; exit 143' TERM INT HUP; wait \"$child_pid\"".to_string()
    }

    #[cfg(windows)]
    fn progress_then_result_fixture_script() -> String {
        format!(
            "for ($i = 0; $i -lt 6; $i++) {{ [Console]::Error.WriteLine('{}'); [Console]::Error.Flush(); Start-Sleep -Milliseconds 400 }}; [Console]::Out.WriteLine('{}')",
            valid_progress_line(),
            valid_task_stdout()
        )
    }

    #[cfg(unix)]
    fn progress_then_result_fixture_script() -> String {
        format!(
            "for i in 1 2 3 4 5 6; do printf '%s\\n' '{}' >&2; sleep 0.4; done; printf '%s\\n' '{}'",
            valid_progress_line(),
            valid_task_stdout()
        )
    }

    #[cfg(windows)]
    fn endless_progress_fixture_script() -> String {
        format!(
            "while ($true) {{ [Console]::Error.WriteLine('{}'); [Console]::Error.Flush(); Start-Sleep -Milliseconds 250 }}",
            valid_progress_line()
        )
    }

    #[cfg(unix)]
    fn endless_progress_fixture_script() -> String {
        format!(
            "while :; do printf '%s\\n' '{}' >&2; sleep 0.25; done",
            valid_progress_line()
        )
    }

    #[cfg(windows)]
    fn untrusted_spam_fixture_script() -> String {
        "while ($true) { [Console]::Error.WriteLine('FRAMEQ_PROGRESS {not-json'); [Console]::Error.WriteLine('diagnostic'); [Console]::Error.WriteLine(''); [Console]::Out.WriteLine('stdout-noise'); [Console]::Error.Flush(); [Console]::Out.Flush(); Start-Sleep -Milliseconds 250 }".to_string()
    }

    #[cfg(unix)]
    fn untrusted_spam_fixture_script() -> String {
        "while :; do printf '%s\\n' 'FRAMEQ_PROGRESS {not-json' 'diagnostic' '' >&2; printf '%s\\n' 'stdout-noise'; sleep 0.25; done".to_string()
    }

    #[cfg(windows)]
    fn result_then_stall_fixture_script() -> String {
        format!(
            "[Console]::Out.WriteLine('{}'); [Console]::Out.Flush(); Start-Sleep -Seconds 30",
            valid_task_stdout()
        )
    }

    #[cfg(unix)]
    fn result_then_stall_fixture_script() -> String {
        format!("printf '%s\\n' '{}'; sleep 30", valid_task_stdout())
    }

    fn terminal_fixture_request(
        stdin_payload: Option<String>,
        require_stdin: bool,
    ) -> WorkerRunRequest {
        let (program, args) = terminal_fixture_command(require_stdin);
        WorkerRunRequest {
            operation: WorkerOperation::ProcessVideo,
            command: WorkerCommandSpec {
                program,
                args,
                stdin_payload,
                env: Vec::new(),
                env_remove: Vec::new(),
                current_dir: std::env::current_dir().expect("resolve test directory"),
            },
            progress: ProgressRoute::None,
        }
    }

    #[cfg(windows)]
    fn terminal_fixture_command(require_stdin: bool) -> (PathBuf, Vec<String>) {
        let stdin_check = if require_stdin {
            "$payload = [Console]::In.ReadToEnd(); if ([string]::IsNullOrEmpty($payload)) { exit 17 }; "
        } else {
            ""
        };
        let script = format!(
            "{stdin_check}[Console]::Out.WriteLine('{}')",
            valid_task_stdout()
        );
        (
            PathBuf::from("powershell.exe"),
            vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                script,
            ],
        )
    }

    #[cfg(unix)]
    fn terminal_fixture_command(require_stdin: bool) -> (PathBuf, Vec<String>) {
        let stdin_check = if require_stdin {
            "payload=$(cat); test -n \"$payload\" || exit 17; "
        } else {
            ""
        };
        let script = format!("{stdin_check}printf '%s\\n' '{}'", valid_task_stdout());
        (PathBuf::from("/bin/sh"), vec!["-c".to_string(), script])
    }

    fn valid_task_stdout() -> &'static str {
        r#"{"status":"completed","task_id":"safe-task","task_dir":null,"artifacts":{},"text":"","summary":"","insights":[],"transcript":null,"error":null}"#
    }

    fn wait_until_active(lane: &WorkerLane) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !lane.is_active() && Instant::now() < deadline {
            std::thread::yield_now();
        }
        assert!(lane.is_active(), "runner did not become active");
    }

    fn wait_for_numeric_fixture_pid(path: &Path, timeout: Duration) -> Option<u32> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Ok(value) = std::fs::read_to_string(path) {
                if !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) {
                    if let Ok(pid) = value.parse::<u32>() {
                        if pid > 0 {
                            return Some(pid);
                        }
                    }
                }
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait_until_fixture_process_is_gone(pid: u32) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while fixture_process_is_alive(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(
            !fixture_process_is_alive(pid),
            "watchdog left the fixture descendant alive"
        );
    }

    #[cfg(unix)]
    fn fixture_process_is_alive(pid: u32) -> bool {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    #[cfg(windows)]
    fn fixture_process_is_alive(pid: u32) -> bool {
        let mut command = Command::new("powershell.exe");
        super::hide_child_console_window(&mut command);
        command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!(
                    "if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{ exit 0 }} else {{ exit 1 }}"
                ),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
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
