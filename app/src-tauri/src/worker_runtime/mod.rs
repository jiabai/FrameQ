mod command;
mod runner;
mod supervisor;

pub(crate) use command::{build_worker_command_spec, WorkerCommandSpec, WorkerInvocation};
#[cfg(test)]
pub(crate) use runner::WorkerExitSummary;
pub(crate) use runner::{
    ProgressRoute, WorkerLane, WorkerOperation, WorkerRunError, WorkerRunErrorKind,
    WorkerRunOutcome, WorkerRunRequest,
};
pub(crate) use supervisor::CancelProcessResult;

#[derive(Default)]
pub(crate) struct ProcessSupervisors {
    pub(crate) video: WorkerLane,
    pub(crate) asr_model_download: WorkerLane,
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
    use super::run_blocking_worker_command;

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
}
