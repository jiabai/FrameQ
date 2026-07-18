use serde::Serialize;
use std::process::{Command, Output};
use std::sync::Mutex;
#[cfg(unix)]
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
pub(crate) fn windows_subprocess_creation_flags() -> u32 {
    WINDOWS_CREATE_NO_WINDOW
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
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
struct ProcessSupervisorState {
    next_instance_id: u64,
    current: Option<(ProcessInstance, ProcessPhase)>,
}

impl ProcessSupervisor {
    pub(crate) fn is_active(&self) -> bool {
        self.state
            .lock()
            .expect("process supervisor lock poisoned")
            .current
            .is_some()
    }

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

pub(super) fn hide_child_console_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(windows_subprocess_creation_flags());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
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
        termination_command_spec, CancelClaim, CancelRequestOutcome, ProcessPhase, ProcessPlatform,
        ProcessSignal, ProcessSupervisor,
    };
    #[cfg(unix)]
    use std::os::unix::process::CommandExt;
    #[cfg(unix)]
    use std::process::Command;

    #[test]
    fn process_supervisor_claims_cancellation_once_and_rolls_back_only_matching_instance() {
        let supervisor = ProcessSupervisor::default();
        assert!(!supervisor.is_active());
        let first = supervisor.start(101).expect("first worker starts");
        assert!(supervisor.is_active());

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
        assert!(!supervisor.is_active());
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
    fn independent_lanes_use_the_same_instance_safe_supervisor_semantics() {
        let video = ProcessSupervisor::default();
        let model_download = ProcessSupervisor::default();
        let video_instance = video.start(505).expect("video worker starts");
        let model_instance = model_download.start(606).expect("model download starts");

        assert!(matches!(
            video.claim_cancel(),
            CancelClaim::Claimed(instance) if instance == video_instance
        ));
        assert_eq!(
            video.finish(video_instance.instance_id),
            Some(ProcessPhase::Cancelling)
        );
        assert_eq!(
            model_download.finish(model_instance.instance_id),
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
        command.process_group(0);
        let mut child = command.spawn().expect("fixture parent starts");
        let process_group_id = child.id();

        assert!(super::process_group_exists(process_group_id).expect("group probe succeeds"));
        super::terminate_process_tree(process_group_id).expect("group termination succeeds");
        child.wait().expect("fixture parent is reaped");
        assert!(
            !super::process_group_exists(process_group_id).expect("group probe after termination")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_worker_subprocesses_suppress_console_window() {
        assert_eq!(
            super::windows_subprocess_creation_flags() & 0x08000000,
            0x08000000
        );
    }
}
