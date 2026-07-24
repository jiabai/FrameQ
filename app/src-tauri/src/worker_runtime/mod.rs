mod command;
mod facade;
mod result_protocol;
mod runner;
mod supervisor;

use command::build_asr_model_download_command_spec;
pub(crate) use command::WorkerCommandSpec;
pub(crate) use facade::{AsrModelDownloadJob, TaskWorkerFacade, WorkerJob};
#[cfg(test)]
pub(crate) use result_protocol::SourceIdentityFailure;
pub(crate) use result_protocol::{
    ModelDownloadTerminalResult, SourceIdentityTerminalResult, TaskTerminalResult,
    ValidatedWorkerResult, WORKER_PROTOCOL_MESSAGE, WORKER_PROTOCOL_VIOLATION,
};
#[cfg(test)]
pub(crate) use runner::WorkerExitSummary;
use runner::{ProgressRoute, WorkerLane, WorkerOperation, WorkerRunRequest};
pub(crate) use runner::{WorkerRunError, WorkerRunErrorKind, WorkerRunOutcome, WorkerTimeoutKind};
pub(crate) use supervisor::CancelProcessResult;
use tauri::Window;

use crate::RuntimePaths;

#[derive(Default)]
pub(crate) struct ProcessSupervisors {
    task: WorkerLane,
    asr_model_download: WorkerLane,
}

impl ProcessSupervisors {
    pub(crate) fn task_worker<'a>(&'a self, paths: &'a RuntimePaths) -> TaskWorkerFacade<'a> {
        TaskWorkerFacade::new(paths, &self.task)
    }

    pub(crate) fn cancel_task(&self) -> CancelProcessResult {
        self.task.cancel()
    }

    pub(crate) fn is_task_active(&self) -> bool {
        self.task.is_active()
    }

    pub(crate) fn run_asr_model_download(
        &self,
        paths: &RuntimePaths,
        job: AsrModelDownloadJob,
        window: Window,
    ) -> Result<Result<WorkerRunOutcome, WorkerRunError>, String> {
        let request = prepare_asr_model_download_request(
            paths,
            job,
            ProgressRoute::asr_model_download(window),
        )?;
        Ok(self.asr_model_download.run(paths, request))
    }

    pub(crate) fn cancel_asr_model_download(&self) -> CancelProcessResult {
        self.asr_model_download.cancel()
    }

    #[cfg(test)]
    pub(crate) fn activate_task_for_test(&self, pid: u32) -> u64 {
        self.task.activate_for_test(pid)
    }

    #[cfg(test)]
    pub(crate) fn finish_task_for_test(&self, instance_id: u64) {
        self.task.finish_for_test(instance_id);
    }
}

fn prepare_asr_model_download_request(
    paths: &RuntimePaths,
    job: AsrModelDownloadJob,
    progress: ProgressRoute,
) -> Result<WorkerRunRequest, String> {
    Ok(WorkerRunRequest {
        operation: WorkerOperation::DownloadAsrModel,
        command: build_asr_model_download_command_spec(paths, &job)?,
        progress,
    })
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
    use super::facade::AsrModelDownloadJob;
    use super::{
        prepare_asr_model_download_request, run_blocking_worker_command, ProgressRoute,
        WorkerOperation,
    };
    use crate::RuntimePaths;
    use std::path::PathBuf;

    #[test]
    fn asr_model_download_job_derives_operation_progress_and_command() {
        let paths = RuntimePaths {
            resource_dir: PathBuf::from("frameq-test").join("resources"),
            user_data_dir: PathBuf::from("frameq-test").join("user-data"),
        };
        let job = AsrModelDownloadJob::new(None, None, None, None);

        let request =
            prepare_asr_model_download_request(&paths, job, ProgressRoute::asr_model_download(()))
                .expect("prepare model-download request");

        assert_eq!(request.operation, WorkerOperation::DownloadAsrModel);
        assert!(matches!(request.progress, ProgressRoute::AsrModelDownload));
        assert_eq!(
            request.command.args,
            vec!["-m", "frameq_worker", "--download-asr-model"]
        );
        assert_eq!(request.command.stdin_payload, None);
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
}
