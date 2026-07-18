mod command;
mod runner;
mod supervisor;

pub(crate) use command::{
    build_worker_command_spec, worker_command_log_detail, WorkerCommandSpec, WorkerInvocation,
};
pub(crate) use runner::{
    parse_worker_stdout, spawn_supervised_worker_command, spawn_worker_command, ProgressRoute,
    SupervisedSpawnError, WorkerExitSummary, WorkerLane, WorkerOperation, WorkerRunError,
    WorkerRunErrorKind, WorkerRunOutcome, WorkerRunRequest,
};
#[cfg(test)]
pub(crate) use supervisor::CancelRequestOutcome;
pub(crate) use supervisor::{
    request_process_cancellation, terminate_process_tree, CancelProcessResult, ProcessPhase,
    ProcessSupervisor, ProcessSupervisors,
};

use crate::{sanitize_diagnostic_text, truncate_for_log, ProcessVideoResult};
use std::process::Output;

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

#[cfg(test)]
mod tests {
    use super::{
        parse_worker_output_or_fallback, parse_worker_stdout, run_blocking_worker_command,
        spawn_worker_command, CancelRequestOutcome, ProcessPhase, ProcessSupervisor,
        WorkerCommandSpec,
    };
    use crate::{ProcessVideoResult, WorkerError};
    use std::collections::HashMap;
    use std::io::Read;
    use std::process::Output;

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
    fn parse_worker_output_rejects_success_without_structured_result() {
        let output = Output {
            status: exit_status(0),
            stdout: b"dependency completed without worker json".to_vec(),
            stderr: b"diagnostic only".to_vec(),
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
                message: "fixed fallback".to_string(),
                stage: "video_extracting".to_string(),
            }),
        };

        let error = parse_worker_output_or_fallback(&output, fallback)
            .expect_err("successful worker exit requires structured json");

        assert!(error.contains("structured JSON result"));
        assert!(!error.contains("fixed fallback"));
    }

    #[test]
    fn spawned_worker_receives_sensitive_request_only_through_stdin() {
        const PROBE_ENV: &str = "FRAMEQ_STDIN_REQUEST_PROBE";
        const TEST_NAME: &str =
            "worker_runtime::tests::spawned_worker_receives_sensitive_request_only_through_stdin";
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
            "worker_runtime::tests::stdin_delivery_failure_is_sanitized_and_reaps_the_child";
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
            "worker_runtime::tests::stdin_worker_remains_cancellable_after_request_delivery";

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
        const TEST_NAME: &str = "worker_runtime::tests::supervised_stdin_worker_can_be_cancelled_while_delivery_is_blocked";

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
