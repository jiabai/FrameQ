use super::super::{
    ProgressRoute, ReaderJoinGate, RunnerHooks, WorkerLane, WorkerOperation, WorkerRunErrorKind,
    WorkerRunOutcome, WorkerRunRequest,
};
use super::fixtures::{fixture_request, terminal_fixture_request, test_paths, wait_until_active};
use crate::worker_runtime::command::WorkerCommandSpec;
use crate::worker_runtime::result_protocol::{TaskTerminalStatus, ValidatedWorkerResult};
use crate::worker_runtime::supervisor::CancelProcessStatus;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[test]
fn reserved_lane_excludes_other_admissions_through_real_child_cancellation() {
    let lane = Arc::new(WorkerLane::default());
    let paths = test_paths("reserved-cancellation");
    let request = || super::fixtures::watchdog_fixture_request(
        WorkerOperation::ProcessWebPage, ProgressRoute::None,
        super::fixtures::silent_fixture_script(), None,
    );
    let reservation = lane.reserve().unwrap();
    assert!(lane.is_reserved());
    assert!(!lane.is_active());
    assert_eq!(lane.cancel().status, CancelProcessStatus::NotRunning);
    assert_eq!(lane.run(&paths, request()).unwrap_err().kind, WorkerRunErrorKind::AlreadyRunning);
    assert!(lane.reserve().is_err());
    drop(reservation);
    let worker_lane = Arc::clone(&lane);
    let worker_paths = paths.clone();
    let operation = std::thread::spawn(move || {
        let _reservation = worker_lane.reserve().unwrap();
        worker_lane.run_reserved(&worker_paths, super::fixtures::watchdog_fixture_request(
            WorkerOperation::ProcessWebPage, ProgressRoute::None,
            super::fixtures::silent_fixture_script(), None,
        ))
    });
    wait_until_active(&lane);
    assert!(lane.is_reserved());
    assert_eq!(lane.run(&paths, request()).unwrap_err().kind, WorkerRunErrorKind::AlreadyRunning);
    assert_eq!(lane.cancel().status, CancelProcessStatus::Cancelling);
    assert_eq!(operation.join().unwrap().unwrap(), WorkerRunOutcome::Cancelled);
    assert!(!lane.is_reserved());
    assert!(!lane.is_active());
    assert_eq!(lane.cancel().status, CancelProcessStatus::NotRunning);
}

#[test]
fn spawn_failure_is_typed_and_never_activates_the_lane() {
    let lane = WorkerLane::default();
    let paths = test_paths("spawn-failure");
    let request = WorkerRunRequest {
        operation: WorkerOperation::ResolveSourceIdentity,
        command: WorkerCommandSpec {
            clear_env: false,
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
    const PROBE_ENV: &str = "APP_RUNNER_MISSING_PIPE_PROBE";
    const TEST_NAME: &str = "worker_runtime::runner::tests::lifecycle::missing_required_pipe_terminates_reaps_and_clears_the_lane";
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
    const PROBE_ENV: &str = "APP_RUNNER_WAIT_FAILURE_PROBE";
    const TEST_NAME: &str =
        "worker_runtime::runner::tests::lifecycle::wait_failure_terminates_reaps_and_clears_the_lane";
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
    const PROBE_ENV: &str = "APP_RUNNER_STDIN_FAILURE_PROBE";
    const TEST_NAME: &str = "worker_runtime::runner::tests::lifecycle::stdin_delivery_failure_is_typed_sanitized_and_clears_the_lane";
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
    const PROBE_ENV: &str = "APP_RUNNER_BLOCKED_STDIN_PROBE";
    const TEST_NAME: &str =
        "worker_runtime::runner::tests::lifecycle::blocked_stdin_delivery_remains_cancellable";
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

fn web_orphan_request(paths: &crate::RuntimePaths, mode: &str) -> WorkerRunRequest {
    let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let resources = repository.join("app/src-tauri/resources");
    let python = std::env::var_os("APP_PROCESS_TEST_PYTHON").map(std::path::PathBuf::from)
        .unwrap_or_else(|| crate::bundled_python_path(&resources));
    assert!(python.is_absolute() && python.is_file(), "A real absolute Python executable is required");
    let mut env = Vec::new();
    for name in ["SYSTEMROOT", "WINDIR", "SYSTEMDRIVE"] {
        if let Ok(value) = std::env::var(name) { env.push((name.into(), value)); }
    }
    WorkerRunRequest {
        operation: WorkerOperation::ProcessWebPage,
        command: WorkerCommandSpec {
            program: python,
            args: vec!["-I".into(), "-B".into(), repository.join("worker/tests/fixtures/web_worker_orphan.py").to_string_lossy().into_owned(), mode.into(), paths.user_data_dir.join("tree.json").to_string_lossy().into_owned()],
            stdin_payload: Some("start".into()), env, clear_env: true, env_remove: Vec::new(),
            current_dir: paths.user_data_dir.clone(),
        },
        progress: ProgressRoute::None,
    }
}

fn assert_web_orphan_tree_gone(paths: &crate::RuntimePaths) {
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(paths.user_data_dir.join("tree.json")).unwrap()).unwrap();
    for field in ["root", "child"] {
        super::fixtures::wait_until_fixture_process_is_gone(value[field].as_u64().unwrap() as u32);
    }
}

#[test]
fn web_root_crash_reaps_inherited_pipe_descendant_before_readers_join() {
    let paths = test_paths("web-orphan-crash");
    let lane = WorkerLane::default();
    let started = Instant::now();
    let outcome = lane.run(&paths, web_orphan_request(&paths, "crash")).unwrap();
    assert!(started.elapsed() < Duration::from_secs(10));
    assert!(matches!(outcome, WorkerRunOutcome::UnstructuredFailure(value) if value.exit_code == Some(7)));
    assert_web_orphan_tree_gone(&paths);
    assert!(!lane.is_active());
    assert!(!lane.is_reserved());
}

#[test]
fn web_root_success_without_protocol_still_reaps_inherited_pipe_descendant() {
    let paths = test_paths("web-orphan-success");
    let lane = WorkerLane::default();
    let started = Instant::now();
    let error = lane.run(&paths, web_orphan_request(&paths, "success")).unwrap_err();
    assert!(started.elapsed() < Duration::from_secs(10));
    assert_eq!(error.kind, WorkerRunErrorKind::ProtocolViolation);
    assert_web_orphan_tree_gone(&paths);
}

#[test]
fn web_cancellation_reaps_real_root_and_pipe_inheriting_descendant() {
    let paths = test_paths("web-orphan-cancel");
    let lane = Arc::new(WorkerLane::default());
    let worker = Arc::clone(&lane); let running_paths = paths.clone();
    let started = Instant::now();
    let task = std::thread::spawn(move || worker.run(&running_paths, web_orphan_request(&running_paths, "wait")));
    let deadline = Instant::now() + Duration::from_secs(5);
    while !paths.user_data_dir.join("tree.json").exists() {
        assert!(Instant::now() < deadline); std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(lane.cancel().status, CancelProcessStatus::Cancelling);
    assert_eq!(task.join().unwrap().unwrap(), WorkerRunOutcome::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(10));
    assert_web_orphan_tree_gone(&paths);
}
