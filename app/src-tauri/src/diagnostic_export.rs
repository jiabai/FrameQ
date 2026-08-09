use crate::asr_model::diagnostic_model_snapshot;
use crate::atomic_files::atomic_write;
use crate::diagnostics::assemble_diagnostic_zip;
use crate::{resolve_runtime_paths, RuntimePaths};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const EXPORT_FAILED_CODE: &str = "DIAGNOSTIC_EXPORT_FAILED";

#[derive(Default)]
pub(crate) struct DiagnosticExportState {
    busy: AtomicBool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum DiagnosticExportResult {
    Exported,
    Cancelled,
    Failed { code: &'static str },
}

struct ExportGuard<'a> {
    state: &'a DiagnosticExportState,
}

impl Drop for ExportGuard<'_> {
    fn drop(&mut self) {
        self.state.busy.store(false, Ordering::Release);
    }
}

impl DiagnosticExportState {
    fn try_acquire(&self) -> Option<ExportGuard<'_>> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| ExportGuard { state: self })
    }
}

fn failed() -> DiagnosticExportResult {
    DiagnosticExportResult::Failed {
        code: EXPORT_FAILED_CODE,
    }
}

fn run_export_core<S, A, W>(
    state: &DiagnosticExportState,
    select: S,
    assemble: A,
    write: W,
) -> DiagnosticExportResult
where
    S: FnOnce() -> Result<Option<PathBuf>, ()>,
    A: FnOnce() -> Result<Vec<u8>, ()>,
    W: FnOnce(&Path, &[u8]) -> Result<(), ()>,
{
    let Some(_guard) = state.try_acquire() else {
        return failed();
    };
    let destination = match select() {
        Ok(Some(path)) => path,
        Ok(None) => return DiagnosticExportResult::Cancelled,
        Err(()) => return failed(),
    };
    let bytes = match assemble() {
        Ok(bytes) => bytes,
        Err(()) => return failed(),
    };
    if write(&destination, &bytes).is_err() {
        return failed();
    }
    DiagnosticExportResult::Exported
}

#[cfg(test)]
fn export_to_selection<A, W>(
    state: &DiagnosticExportState,
    selection: Option<PathBuf>,
    assemble: A,
    write: W,
) -> DiagnosticExportResult
where
    A: FnOnce() -> Result<Vec<u8>, ()>,
    W: FnOnce(&Path, &[u8]) -> Result<(), ()>,
{
    run_export_core(state, || Ok(selection), assemble, write)
}

#[tauri::command]
pub(crate) async fn export_diagnostics(app: AppHandle) -> DiagnosticExportResult {
    let state = Arc::clone(app.state::<Arc<DiagnosticExportState>>().inner());
    let command_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_export_core(
            &state,
            || {
                command_app
                    .dialog()
                    .file()
                    .set_file_name(default_export_file_name())
                    .add_filter("ZIP archive", &["zip"])
                    .blocking_save_file()
                    .map(|path| path.into_path().map_err(|_| ()))
                    .transpose()
            },
            || assemble_for_app(&command_app),
            |path, bytes| atomic_write(path, bytes).map_err(|_| ()),
        )
    })
    .await
    .unwrap_or_else(|_| failed())
}

fn assemble_for_app(app: &AppHandle) -> Result<Vec<u8>, ()> {
    let paths: RuntimePaths = resolve_runtime_paths(app).map_err(|_| ())?;
    let snapshot = diagnostic_model_snapshot(&paths);
    assemble_diagnostic_zip(&paths, &snapshot, env!("CARGO_PKG_VERSION"))
}

fn default_export_file_name() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = (seconds / 86_400).min(i64::MAX as u64) as i64;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_date_from_unix_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = seconds_of_day % 3_600 / 60;
    let second = seconds_of_day % 60;
    format!("FrameQ-diagnostics-{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}.zip")
}

fn civil_date_from_unix_days(days: i64) -> (i64, i64, i64) {
    let shifted = days.saturating_add(719_468);
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::{export_to_selection, DiagnosticExportResult, DiagnosticExportState};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn default_name_uses_fixed_zip_shape() {
        let name = super::default_export_file_name();
        assert!(name.starts_with("FrameQ-diagnostics-"));
        assert!(name.ends_with(".zip"));
        assert_eq!(name.len(), "FrameQ-diagnostics-20260810-123456.zip".len());
        assert_eq!(super::civil_date_from_unix_days(0), (1970, 1, 1));
        assert_eq!(super::civil_date_from_unix_days(20_675), (2026, 8, 10));
    }

    #[test]
    fn cancellation_is_path_free_and_does_no_work() {
        let state = DiagnosticExportState::default();
        let result = export_to_selection(
            &state,
            None,
            || panic!("no assembly"),
            |_, _| panic!("no write"),
        );
        assert_eq!(result, DiagnosticExportResult::Cancelled);
        assert_eq!(
            serde_json::to_value(result).expect("serialize"),
            serde_json::json!({"status":"cancelled"})
        );
    }

    #[test]
    fn busy_export_returns_only_closed_failure_code() {
        let state = Arc::new(DiagnosticExportState::default());
        let first = state.clone();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let handle = std::thread::spawn(move || {
            export_to_selection(
                &first,
                Some(PathBuf::from("first.zip")),
                || {
                    entered_tx.send(()).expect("entered");
                    release_rx.recv().expect("release");
                    Ok(vec![1])
                },
                |_, _| Ok(()),
            )
        });
        entered_rx.recv().expect("first entered");
        let second = export_to_selection(
            &state,
            Some(PathBuf::from("second.zip")),
            || Ok(vec![2]),
            |_, _| Ok(()),
        );
        release_tx.send(()).expect("release first");
        assert_eq!(
            handle.join().expect("join"),
            DiagnosticExportResult::Exported
        );
        assert_eq!(
            second,
            DiagnosticExportResult::Failed {
                code: "DIAGNOSTIC_EXPORT_FAILED"
            }
        );
    }

    #[test]
    fn writer_failure_preserves_existing_destination_and_result_has_no_path() {
        let root = temp_dir("preserve");
        let destination = root.join("diagnostics.zip");
        fs::write(&destination, b"existing").expect("seed destination");
        let state = DiagnosticExportState::default();
        let result = export_to_selection(
            &state,
            Some(destination.clone()),
            || Ok(vec![1, 2, 3]),
            |path, bytes| {
                crate::atomic_files::atomic_write_with_replace_for_test(
                    path,
                    bytes,
                    |staging, selected| {
                        assert_eq!(staging.parent(), selected.parent());
                        assert!(staging
                            .file_name()
                            .expect("staging name")
                            .to_string_lossy()
                            .contains(".part"));
                        Err(std::io::Error::other("injected replacement failure"))
                    },
                )
                .map_err(|_| ())
            },
        );
        assert_eq!(fs::read(&destination).expect("read existing"), b"existing");
        assert!(fs::read_dir(&root)
            .expect("list root")
            .filter_map(Result::ok)
            .all(|entry| !entry.file_name().to_string_lossy().contains(".part")));
        let rendered = serde_json::to_string(&result).expect("serialize");
        assert_eq!(
            rendered,
            "{\"status\":\"failed\",\"code\":\"DIAGNOSTIC_EXPORT_FAILED\"}"
        );
        assert!(!rendered.contains(destination.to_string_lossy().as_ref()));
    }

    #[test]
    fn selection_and_assembly_failures_are_closed_and_do_not_write() {
        let state = DiagnosticExportState::default();
        let selection_failed = super::run_export_core(
            &state,
            || Err(()),
            || panic!("no assembly"),
            |_, _| panic!("no write"),
        );
        assert_eq!(
            selection_failed,
            DiagnosticExportResult::Failed {
                code: "DIAGNOSTIC_EXPORT_FAILED"
            }
        );

        let assembly_failed = export_to_selection(
            &state,
            Some(PathBuf::from("ignored.zip")),
            || Err(()),
            |_, _| panic!("no write"),
        );
        assert_eq!(
            assembly_failed,
            DiagnosticExportResult::Failed {
                code: "DIAGNOSTIC_EXPORT_FAILED"
            }
        );
    }

    #[test]
    fn successful_write_uses_selected_destination_without_app_local_copy() {
        let root = temp_dir("success");
        let destination = root.join("chosen.zip");
        let app_local = root.join("app-local");
        fs::create_dir_all(&app_local).expect("app local");
        let state = DiagnosticExportState::default();
        let result = export_to_selection(
            &state,
            Some(destination.clone()),
            || Ok(vec![1, 2, 3]),
            |path, bytes| {
                assert_eq!(path, destination.as_path());
                crate::atomic_files::atomic_write(path, bytes).map_err(|_| ())
            },
        );
        assert_eq!(result, DiagnosticExportResult::Exported);
        assert_eq!(fs::read(destination).expect("zip"), vec![1, 2, 3]);
        assert!(fs::read_dir(app_local)
            .expect("list app local")
            .next()
            .is_none());
        assert!(fs::read_dir(root)
            .expect("list root")
            .filter_map(Result::ok)
            .all(|entry| !entry.file_name().to_string_lossy().contains(".part")));
    }

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("frameq-command-{name}-{unique}"));
        fs::create_dir_all(&root).expect("root");
        root
    }
}
