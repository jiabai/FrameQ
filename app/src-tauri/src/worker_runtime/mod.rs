mod command;
mod facade;
mod result_protocol;
mod runner;
mod supervisor;

pub(crate) use command::WorkerCommandSpec;
pub(crate) use facade::{VideoWorkerFacade, WorkerJob};
pub(crate) use result_protocol::{
    ModelDownloadTerminalResult, SourceIdentityTerminalResult, TaskTerminalResult,
    ValidatedWorkerResult, WORKER_PROTOCOL_MESSAGE, WORKER_PROTOCOL_VIOLATION,
};
#[cfg(test)]
pub(crate) use runner::WorkerExitSummary;
use runner::{ProgressRoute, WorkerLane, WorkerOperation, WorkerRunRequest};
pub(crate) use runner::{WorkerRunError, WorkerRunErrorKind, WorkerRunOutcome};
pub(crate) use supervisor::CancelProcessResult;
use tauri::Window;

use crate::RuntimePaths;

#[derive(Default)]
pub(crate) struct ProcessSupervisors {
    video: WorkerLane,
    asr_model_download: WorkerLane,
}

impl ProcessSupervisors {
    pub(crate) fn video_worker<'a>(&'a self, paths: &'a RuntimePaths) -> VideoWorkerFacade<'a> {
        VideoWorkerFacade::new(paths, &self.video)
    }

    pub(crate) fn cancel_video(&self) -> CancelProcessResult {
        self.video.cancel()
    }

    pub(crate) fn is_video_active(&self) -> bool {
        self.video.is_active()
    }

    pub(crate) fn run_asr_model_download(
        &self,
        paths: &RuntimePaths,
        command: WorkerCommandSpec,
        window: Window,
    ) -> Result<WorkerRunOutcome, WorkerRunError> {
        self.asr_model_download.run(
            paths,
            WorkerRunRequest {
                operation: WorkerOperation::DownloadAsrModel,
                command,
                progress: ProgressRoute::asr_model_download(window),
            },
        )
    }

    pub(crate) fn cancel_asr_model_download(&self) -> CancelProcessResult {
        self.asr_model_download.cancel()
    }

    #[cfg(test)]
    pub(crate) fn activate_video_for_test(&self, pid: u32) -> u64 {
        self.video.activate_for_test(pid)
    }

    #[cfg(test)]
    pub(crate) fn finish_video_for_test(&self, instance_id: u64) {
        self.video.finish_for_test(instance_id);
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
