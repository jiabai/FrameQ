use super::watchdog::WatchdogControl;
use super::{RunnerHooks, WorkerOperation};
use crate::diagnostics::{AsrDiagnosticSink, DiagnosticRejectionCode, ValidatedDiagnosticEvent};
#[cfg(not(test))]
use crate::progress_event::ASR_MODEL_DOWNLOAD_EVENT_NAME;
use crate::progress_event::{
    invalid_progress_log_detail, validate_model_download_event, validate_worker_progress_event,
    MODEL_DOWNLOAD_EVENT_PREFIX,
};
use crate::{append_desktop_log, RuntimePaths, DIAGNOSTIC_EVENT_PREFIX};
use std::io::{BufRead, BufReader};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
#[cfg(not(test))]
use tauri::{Emitter, Window};

const MAX_DIAGNOSTIC_EVENT_CHARS: usize = 1_000;

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
                let _ = window.emit(ASR_MODEL_DOWNLOAD_EVENT_NAME, payload);
            }
        }

        #[cfg(test)]
        let _ = (self, payload);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ProgressProtocol {
    None,
    Worker,
    AsrModelDownload,
}

#[derive(Debug, PartialEq)]
pub(super) enum ProgressRecord {
    Validated(serde_json::Value),
    Invalid(String),
    Diagnostic,
    Empty,
}

#[derive(Debug, PartialEq)]
pub(super) enum StderrRecord {
    ValidatedProgress(serde_json::Value),
    InvalidProgress(String),
    ValidatedDiagnostic(ValidatedDiagnosticEvent),
    InvalidDiagnostic,
    Diagnostic,
    Empty,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(super) struct StderrSummary {
    pub(super) had_diagnostic_output: bool,
    pub(super) reader_failed: bool,
}

impl StderrSummary {
    pub(super) fn marker(self) -> &'static str {
        if self.reader_failed {
            "reader_failed"
        } else if self.had_diagnostic_output {
            "present"
        } else {
            "empty"
        }
    }
}

pub(super) fn read_stderr(
    stderr: std::process::ChildStderr,
    operation: WorkerOperation,
    progress: ProgressRoute,
    paths: RuntimePaths,
    hooks: RunnerHooks,
    watchdog: Arc<WatchdogControl>,
    diagnostic_sink: Option<AsrDiagnosticSink>,
) -> StderrSummary {
    let protocol = progress.protocol();
    let mut summary = StderrSummary::default();
    let mut diagnostic_sink = DiagnosticSinkGuard::new(operation, diagnostic_sink);
    for line in BufReader::new(stderr).lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => {
                summary.reader_failed = true;
                break;
            }
        };
        route_stderr_record(
            inspect_stderr_line(protocol, &line),
            protocol,
            &progress,
            &paths,
            &watchdog,
            diagnostic_sink.sink_mut(),
            &line,
            &mut summary,
        );
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

struct DiagnosticSinkGuard(Option<AsrDiagnosticSink>);

impl DiagnosticSinkGuard {
    fn new(operation: WorkerOperation, sink: Option<AsrDiagnosticSink>) -> Self {
        if operation == WorkerOperation::DownloadAsrModel {
            Self(sink)
        } else {
            Self(None)
        }
    }

    fn sink_mut(&mut self) -> Option<&mut AsrDiagnosticSink> {
        self.0.as_mut()
    }
}

impl Drop for DiagnosticSinkGuard {
    fn drop(&mut self) {
        if let Some(sink) = self.0.take() {
            sink.finish();
        }
    }
}

pub(super) fn route_stderr_record(
    record: StderrRecord,
    protocol: ProgressProtocol,
    progress: &ProgressRoute,
    paths: &RuntimePaths,
    watchdog: &WatchdogControl,
    diagnostic_sink: Option<&mut AsrDiagnosticSink>,
    raw_line: &str,
    summary: &mut StderrSummary,
) {
    match record {
        StderrRecord::ValidatedProgress(payload) => {
            watchdog.record_validated_progress();
            progress.emit(payload);
        }
        StderrRecord::InvalidProgress(detail) => {
            let event = match protocol {
                ProgressProtocol::AsrModelDownload => "worker.model_progress.invalid",
                ProgressProtocol::Worker | ProgressProtocol::None => "worker.progress.invalid",
            };
            let _ = append_desktop_log(paths, event, &detail);
        }
        StderrRecord::ValidatedDiagnostic(event) => {
            summary.had_diagnostic_output = true;
            if let Some(sink) = diagnostic_sink {
                sink.structured(&event);
            }
        }
        StderrRecord::InvalidDiagnostic => {
            summary.had_diagnostic_output = true;
            if let Some(sink) = diagnostic_sink {
                sink.rejected(DiagnosticRejectionCode::DiagnosticEventRejected);
            }
        }
        StderrRecord::Diagnostic => {
            summary.had_diagnostic_output = true;
            if let Some(sink) = diagnostic_sink {
                sink.fallback_line(raw_line);
            }
        }
        StderrRecord::Empty => {}
    }
}

pub(super) fn inspect_stderr_line(protocol: ProgressProtocol, line: &str) -> StderrRecord {
    if line.trim().is_empty() {
        return StderrRecord::Empty;
    }
    if let Some(raw_event) = line.strip_prefix(DIAGNOSTIC_EVENT_PREFIX) {
        if raw_event.chars().count() > MAX_DIAGNOSTIC_EVENT_CHARS {
            return StderrRecord::InvalidDiagnostic;
        }
        // The strict Task 3 DTO deserializer rejects duplicate and unknown fields before
        // applying the closed enum, category/code, numeric, and identifier invariants.
        return ValidatedDiagnosticEvent::parse_json(raw_event)
            .map(StderrRecord::ValidatedDiagnostic)
            .unwrap_or(StderrRecord::InvalidDiagnostic);
    }

    match inspect_progress_line(protocol, line) {
        ProgressRecord::Validated(payload) => StderrRecord::ValidatedProgress(payload),
        ProgressRecord::Invalid(detail) => StderrRecord::InvalidProgress(detail),
        ProgressRecord::Diagnostic => StderrRecord::Diagnostic,
        ProgressRecord::Empty => StderrRecord::Empty,
    }
}

pub(super) fn inspect_progress_line(protocol: ProgressProtocol, line: &str) -> ProgressRecord {
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
        ProgressProtocol::AsrModelDownload => {
            (MODEL_DOWNLOAD_EVENT_PREFIX, validate_model_download_event)
        }
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
