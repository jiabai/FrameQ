use super::worker_stderr::{
    sanitize_fallback_line, StoredDiagnosticRecord, StoredRecordKind, ValidatedDiagnosticEvent,
    MAX_PAYLOAD_CHARS, RETENTION_MILLIS,
};
use crate::asr_model::DiagnosticModelSnapshot;
use crate::runtime::ASR_DIAGNOSTIC_LOG_FILE_NAME;
use crate::{RuntimePaths, DESKTOP_LOG_DIR_NAME};
use serde::Serialize;
use serde_json::Value;
use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

pub(crate) const MAX_ZIP_BYTES: usize = 5 * 1024 * 1024;
const MAX_SOURCE_BYTES: u64 = 16 * 1024 * 1024;
const PRECOMPRESSION_LOG_BUDGET: usize = 4 * 1024 * 1024;
const DESKTOP_LOG_FILE_NAME: &str = "frameq-desktop.log";
const MANIFEST_FILE_NAME: &str = "diagnostics.json";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum DiagnosticOs {
    Windows,
    Macos,
    Linux,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum DiagnosticArch {
    X86_64,
    Aarch64,
    X86,
    Arm,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum ManifestFileState {
    Included,
    Omitted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum OmissionReason {
    Missing,
    Unreadable,
    UnsafeFile,
    Malformed,
    NoEligibleRecords,
    SizeLimit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RecordOmissionReason {
    Malformed,
    OutsideWindow,
    SizeLimit,
    Multiple,
}

#[derive(Debug, Serialize)]
struct ManifestFileStatus {
    name: &'static str,
    status: ManifestFileState,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<OmissionReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    omitted_records: Option<u64>,
    #[serde(skip_serializing_if = "is_false")]
    omitted_records_unknown: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    record_omission_reason: Option<RecordOmissionReason>,
}

#[derive(Debug, Serialize)]
struct DiagnosticManifest {
    schema_version: u8,
    app_version: String,
    os: DiagnosticOs,
    arch: DiagnosticArch,
    exported_at_unix_ms: u64,
    window_start_unix_ms: u64,
    selected_model: crate::asr_model::SupportedDiagnosticModel,
    cache_status: crate::asr_model::DiagnosticCacheStatus,
    files: Vec<ManifestFileStatus>,
    truncated: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug)]
struct SafeRecord {
    utc_ms: u64,
    line: String,
    logical_count: u64,
}

#[derive(Debug)]
struct SafeLog {
    name: &'static str,
    records: Vec<SafeRecord>,
    omission: Option<OmissionReason>,
    truncated: bool,
    malformed_records: u64,
    outside_window_records: u64,
    size_limited_records: u64,
    size_limited_records_unknown: bool,
}

impl SafeLog {
    fn rendered(&self) -> Option<Vec<u8>> {
        if self.records.is_empty() {
            return None;
        }
        let mut bytes = Vec::new();
        for record in &self.records {
            bytes.extend_from_slice(record.line.as_bytes());
            bytes.push(b'\n');
        }
        Some(bytes)
    }

    fn status(&self) -> ManifestFileStatus {
        let omitted_records = (!self.size_limited_records_unknown).then(|| {
            self.malformed_records
                .saturating_add(self.outside_window_records)
                .saturating_add(self.size_limited_records)
        });
        let reason_count = [
            self.malformed_records,
            self.outside_window_records,
            if self.size_limited_records > 0 || self.size_limited_records_unknown {
                1
            } else {
                0
            },
        ]
        .into_iter()
        .filter(|count| *count > 0)
        .count();
        let record_omission_reason = match reason_count {
            0 => None,
            1 if self.malformed_records > 0 => Some(RecordOmissionReason::Malformed),
            1 if self.outside_window_records > 0 => Some(RecordOmissionReason::OutsideWindow),
            1 => Some(RecordOmissionReason::SizeLimit),
            _ => Some(RecordOmissionReason::Multiple),
        };
        if self.records.is_empty() {
            ManifestFileStatus {
                name: self.name,
                status: ManifestFileState::Omitted,
                reason: Some(self.omission.unwrap_or(OmissionReason::NoEligibleRecords)),
                omitted_records,
                omitted_records_unknown: self.size_limited_records_unknown,
                record_omission_reason,
            }
        } else {
            ManifestFileStatus {
                name: self.name,
                status: ManifestFileState::Included,
                reason: None,
                omitted_records,
                omitted_records_unknown: self.size_limited_records_unknown,
                record_omission_reason,
            }
        }
    }
}

pub(crate) fn assemble_diagnostic_zip(
    paths: &RuntimePaths,
    snapshot: &DiagnosticModelSnapshot,
    app_version: &str,
) -> Result<Vec<u8>, ()> {
    assemble_diagnostic_zip_at(paths, snapshot, app_version, utc_now_millis())
}

fn assemble_diagnostic_zip_at(
    paths: &RuntimePaths,
    snapshot: &DiagnosticModelSnapshot,
    app_version: &str,
    now_ms: u64,
) -> Result<Vec<u8>, ()> {
    let cutoff = now_ms.saturating_sub(RETENTION_MILLIS);
    let mut desktop = collect_desktop_log(paths, cutoff, now_ms);
    let mut asr = collect_asr_log(paths, cutoff, now_ms);
    let mut retained_log_bytes = enforce_precompression_budget(&mut desktop, &mut asr);

    loop {
        let truncated = desktop.truncated || asr.truncated;
        let manifest = DiagnosticManifest {
            schema_version: 1,
            app_version: safe_app_version(app_version),
            os: current_os(),
            arch: current_arch(),
            exported_at_unix_ms: now_ms,
            window_start_unix_ms: cutoff,
            selected_model: snapshot.model,
            cache_status: snapshot.cache_status,
            files: vec![
                ManifestFileStatus {
                    name: MANIFEST_FILE_NAME,
                    status: ManifestFileState::Included,
                    reason: None,
                    omitted_records: Some(0),
                    omitted_records_unknown: false,
                    record_omission_reason: None,
                },
                desktop.status(),
                asr.status(),
            ],
            truncated,
        };
        let bytes = build_zip(&manifest, &desktop, &asr)?;
        if bytes.len() <= MAX_ZIP_BYTES {
            return Ok(bytes);
        }
        let excess = bytes.len().saturating_sub(MAX_ZIP_BYTES);
        let batch_target = excess.max(retained_log_bytes.saturating_add(7) / 8);
        let removed = drop_oldest_bytes(&mut desktop, &mut asr, batch_target);
        if removed == 0 {
            return Err(());
        }
        retained_log_bytes = retained_log_bytes.saturating_sub(removed);
    }
}

fn collect_desktop_log(paths: &RuntimePaths, cutoff: u64, now_ms: u64) -> SafeLog {
    let path = paths
        .user_data_dir
        .join(DESKTOP_LOG_DIR_NAME)
        .join(DESKTOP_LOG_FILE_NAME);
    let source = read_fixed_source(paths, &path);
    let mut log = SafeLog {
        name: DESKTOP_LOG_FILE_NAME,
        records: Vec::new(),
        omission: None,
        truncated: false,
        malformed_records: 0,
        outside_window_records: 0,
        size_limited_records: 0,
        size_limited_records_unknown: false,
    };
    let bytes = match source {
        SourceBytes::Bytes { bytes, truncated } => {
            log.truncated = truncated;
            log.size_limited_records_unknown = truncated;
            bytes
        }
        SourceBytes::Omitted(reason) => {
            log.omission = Some(reason);
            return log;
        }
    };
    let Ok(text) = std::str::from_utf8(&bytes) else {
        log.omission = Some(OmissionReason::Malformed);
        return log;
    };
    let mut malformed = false;
    for line in text.lines() {
        match parse_desktop_line(line) {
            Some(record) if record.utc_ms >= cutoff && record.utc_ms <= now_ms => {
                log.records.push(record)
            }
            Some(record) => {
                log.truncated = true;
                log.outside_window_records = log
                    .outside_window_records
                    .saturating_add(record.logical_count);
            }
            None if !line.trim().is_empty() => {
                malformed = true;
                log.malformed_records = log.malformed_records.saturating_add(1);
            }
            None => {}
        }
    }
    log.truncated |= malformed;
    log.records
        .sort_by(|left, right| right.utc_ms.cmp(&left.utc_ms));
    if log.records.is_empty() {
        log.omission = Some(if malformed {
            OmissionReason::Malformed
        } else {
            OmissionReason::NoEligibleRecords
        });
    }
    log
}

fn parse_desktop_line(line: &str) -> Option<SafeRecord> {
    if line.len() > 4_096 || line.chars().any(char::is_control) {
        return None;
    }
    let mut tokens = line.split_ascii_whitespace();
    let utc_ms = tokens.next()?.strip_prefix("unix_ms=")?.parse().ok()?;
    let event = tokens.next()?.strip_prefix("event=")?;
    let safe_event = safe_desktop_event(event)?;
    let suffix = if event == "worker.download_asr_model.result" {
        let operation = tokens.next()?;
        let outcome = tokens.next()?;
        if operation != "operation=download_asr_model" || tokens.next().is_some() {
            return None;
        }
        let outcome = outcome.strip_prefix("outcome=")?;
        if !matches!(
            outcome,
            "idle_timeout"
                | "absolute_timeout"
                | "cancelled"
                | "structured"
                | "unstructured_failure"
        ) {
            return None;
        }
        format!(" outcome={outcome}")
    } else {
        String::new()
    };
    Some(SafeRecord {
        utc_ms,
        line: format!("unix_ms={utc_ms} event={safe_event}{suffix}"),
        logical_count: 1,
    })
}

fn safe_desktop_event(event: &str) -> Option<&'static str> {
    match event {
        "worker.download_asr_model.start" => Some("worker_download_asr_model_start"),
        "worker.download_asr_model.exit" => Some("worker_download_asr_model_exit"),
        "worker.download_asr_model.result" => Some("worker_download_asr_model_result"),
        "worker.download_asr_model.watchdog_signal_failed" => {
            Some("worker_download_asr_model_watchdog_signal_failed")
        }
        "worker.model_progress.invalid" => Some("worker_model_progress_invalid"),
        "asr_diagnostic.write_failed" => Some("asr_diagnostic_write_failed"),
        _ => None,
    }
}

fn collect_asr_log(paths: &RuntimePaths, cutoff: u64, now_ms: u64) -> SafeLog {
    let path = paths
        .user_data_dir
        .join(DESKTOP_LOG_DIR_NAME)
        .join(ASR_DIAGNOSTIC_LOG_FILE_NAME);
    let source = read_fixed_source(paths, &path);
    let mut log = SafeLog {
        name: ASR_DIAGNOSTIC_LOG_FILE_NAME,
        records: Vec::new(),
        omission: None,
        truncated: false,
        malformed_records: 0,
        outside_window_records: 0,
        size_limited_records: 0,
        size_limited_records_unknown: false,
    };
    let bytes = match source {
        SourceBytes::Bytes { bytes, truncated } => {
            log.truncated = truncated;
            log.size_limited_records_unknown = truncated;
            bytes
        }
        SourceBytes::Omitted(reason) => {
            log.omission = Some(reason);
            return log;
        }
    };
    let Ok(text) = std::str::from_utf8(&bytes) else {
        log.omission = Some(OmissionReason::Malformed);
        return log;
    };
    let mut malformed = false;
    for line in text.lines() {
        match parse_asr_line(line) {
            Some(record) if record.utc_ms >= cutoff && record.utc_ms <= now_ms => {
                log.records.push(record)
            }
            Some(record) => {
                log.truncated = true;
                log.outside_window_records = log
                    .outside_window_records
                    .saturating_add(record.logical_count);
            }
            None if !line.trim().is_empty() => {
                malformed = true;
                log.malformed_records = log.malformed_records.saturating_add(1);
            }
            None => {}
        }
    }
    log.truncated |= malformed;
    log.records
        .sort_by(|left, right| right.utc_ms.cmp(&left.utc_ms));
    if log.records.is_empty() {
        log.omission = Some(if malformed {
            OmissionReason::Malformed
        } else {
            OmissionReason::NoEligibleRecords
        });
    }
    log
}

fn parse_asr_line(line: &str) -> Option<SafeRecord> {
    if line.len() > 8_192 || line.chars().any(char::is_control) {
        return None;
    }
    let value = serde_json::from_str::<Value>(line).ok()?;
    let object = value.as_object()?;
    const FIELDS: [&str; 7] = [
        "v",
        "utc_ms",
        "invocation",
        "kind",
        "payload",
        "count",
        "truncated",
    ];
    if object.len() != FIELDS.len()
        || !FIELDS.iter().all(|field| object.contains_key(*field))
        || object.get("v")?.as_u64()? != 1
    {
        return None;
    }
    let record = serde_json::from_value::<StoredDiagnosticRecord>(value).ok()?;
    if !valid_invocation(&record.invocation)
        || record.count == 0
        || record.payload.chars().count() > MAX_PAYLOAD_CHARS
        || record.payload.chars().any(char::is_control)
    {
        return None;
    }
    let payload = match record.kind {
        StoredRecordKind::Structured => {
            let event = ValidatedDiagnosticEvent::parse_json(&record.payload).ok()?;
            serde_json::to_string(&event).ok()?
        }
        StoredRecordKind::Fallback => sanitize_fallback_line(&record.payload),
        StoredRecordKind::Rejected => {
            if !matches!(
                record.payload.as_str(),
                "diagnostic_event_rejected"
                    | "malformed_event"
                    | "invalid_event"
                    | "oversized_event"
            ) {
                return None;
            }
            "diagnostic_event_rejected".to_string()
        }
        StoredRecordKind::Internal => {
            if !matches!(
                record.payload.as_str(),
                "fallback_limit_reached"
                    | "structured_serialization_failed"
                    | "record_limit_reached"
            ) {
                return None;
            }
            record.payload
        }
    };
    let rendered = serde_json::json!({
        "v": 1,
        "utc_ms": record.utc_ms,
        "kind": record.kind,
        "payload": payload,
        "count": record.count,
        "truncated": record.truncated,
    });
    Some(SafeRecord {
        utc_ms: record.utc_ms,
        line: serde_json::to_string(&rendered).ok()?,
        logical_count: u64::from(record.count),
    })
}

fn valid_invocation(value: &str) -> bool {
    value.len() == 20
        && value.starts_with("inv-")
        && value[4..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

enum SourceBytes {
    Bytes { bytes: Vec<u8>, truncated: bool },
    Omitted(OmissionReason),
}

fn read_fixed_source(paths: &RuntimePaths, path: &Path) -> SourceBytes {
    read_fixed_source_with_hook(paths, path, || {})
}

fn read_fixed_source_with_hook<F>(paths: &RuntimePaths, path: &Path, hook: F) -> SourceBytes
where
    F: FnOnce(),
{
    let expected_logs = paths.user_data_dir.join(DESKTOP_LOG_DIR_NAME);
    if path.parent() != Some(expected_logs.as_path()) {
        return SourceBytes::Omitted(OmissionReason::UnsafeFile);
    }
    for directory in [&paths.user_data_dir, &expected_logs] {
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.is_dir() && !is_link_or_reparse(&metadata) => {}
            Ok(_) => return SourceBytes::Omitted(OmissionReason::UnsafeFile),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return SourceBytes::Omitted(OmissionReason::Missing)
            }
            Err(_) => return SourceBytes::Omitted(OmissionReason::Unreadable),
        }
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !is_link_or_reparse(&metadata) => {}
        Ok(_) => return SourceBytes::Omitted(OmissionReason::UnsafeFile),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return SourceBytes::Omitted(OmissionReason::Missing)
        }
        Err(_) => return SourceBytes::Omitted(OmissionReason::Unreadable),
    }
    let root_handle = match open_directory_no_follow(&paths.user_data_dir) {
        Ok(handle) => handle,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return SourceBytes::Omitted(OmissionReason::Missing)
        }
        Err(_) => return SourceBytes::Omitted(OmissionReason::UnsafeFile),
    };
    let logs_handle = match open_directory_no_follow(&expected_logs) {
        Ok(handle) => handle,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return SourceBytes::Omitted(OmissionReason::Missing)
        }
        Err(_) => return SourceBytes::Omitted(OmissionReason::UnsafeFile),
    };
    let pre_target = match open_no_follow(path) {
        Ok(handle) => handle,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return SourceBytes::Omitted(OmissionReason::Missing)
        }
        Err(_) => return SourceBytes::Omitted(OmissionReason::UnsafeFile),
    };
    if !handle_is_directory(&root_handle)
        || !handle_is_directory(&logs_handle)
        || !handle_is_regular_file(&pre_target)
    {
        return SourceBytes::Omitted(OmissionReason::UnsafeFile);
    }
    let Some(root_identity) = file_identity(&root_handle) else {
        return SourceBytes::Omitted(OmissionReason::Unreadable);
    };
    let Some(logs_identity) = file_identity(&logs_handle) else {
        return SourceBytes::Omitted(OmissionReason::Unreadable);
    };
    let Some(target_identity) = file_identity(&pre_target) else {
        return SourceBytes::Omitted(OmissionReason::Unreadable);
    };
    let Ok(root_final) = fs::canonicalize(&paths.user_data_dir) else {
        return SourceBytes::Omitted(OmissionReason::Unreadable);
    };
    let Ok(logs_final) = fs::canonicalize(&expected_logs) else {
        return SourceBytes::Omitted(OmissionReason::Unreadable);
    };
    let Ok(target_final) = fs::canonicalize(path) else {
        return SourceBytes::Omitted(OmissionReason::Unreadable);
    };
    if logs_final.parent() != Some(root_final.as_path())
        || target_final.parent() != Some(logs_final.as_path())
        || target_final.file_name() != path.file_name()
    {
        return SourceBytes::Omitted(OmissionReason::UnsafeFile);
    }
    drop(pre_target);
    hook();

    let current_root = match open_directory_no_follow(&paths.user_data_dir) {
        Ok(handle) => handle,
        Err(_) => return SourceBytes::Omitted(OmissionReason::UnsafeFile),
    };
    let current_logs = match open_directory_no_follow(&expected_logs) {
        Ok(handle) => handle,
        Err(_) => return SourceBytes::Omitted(OmissionReason::UnsafeFile),
    };
    let mut file = match open_no_follow(path) {
        Ok(file) => file,
        Err(_) => return SourceBytes::Omitted(OmissionReason::UnsafeFile),
    };
    if file_identity(&current_root) != Some(root_identity)
        || file_identity(&current_logs) != Some(logs_identity)
        || file_identity(&file) != Some(target_identity)
    {
        return SourceBytes::Omitted(OmissionReason::UnsafeFile);
    }
    let Ok(current_root_final) = fs::canonicalize(&paths.user_data_dir) else {
        return SourceBytes::Omitted(OmissionReason::UnsafeFile);
    };
    let Ok(current_logs_final) = fs::canonicalize(&expected_logs) else {
        return SourceBytes::Omitted(OmissionReason::UnsafeFile);
    };
    let Ok(current_target_final) = fs::canonicalize(path) else {
        return SourceBytes::Omitted(OmissionReason::UnsafeFile);
    };
    if current_root_final != root_final
        || current_logs_final != logs_final
        || current_target_final != target_final
    {
        return SourceBytes::Omitted(OmissionReason::UnsafeFile);
    }
    let handle_metadata = match file.metadata() {
        Ok(metadata) => metadata,
        Err(_) => return SourceBytes::Omitted(OmissionReason::Unreadable),
    };
    if !handle_metadata.is_file() || is_link_or_reparse(&handle_metadata) {
        return SourceBytes::Omitted(OmissionReason::UnsafeFile);
    }
    let truncated = handle_metadata.len() > MAX_SOURCE_BYTES;
    if truncated
        && file
            .seek(SeekFrom::End(-(MAX_SOURCE_BYTES as i64)))
            .is_err()
    {
        return SourceBytes::Omitted(OmissionReason::Unreadable);
    }
    let capacity = handle_metadata.len().min(MAX_SOURCE_BYTES) as usize;
    let mut bytes = Vec::with_capacity(capacity);
    if file
        .take(MAX_SOURCE_BYTES.saturating_add(1))
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() as u64 > MAX_SOURCE_BYTES
    {
        return SourceBytes::Omitted(OmissionReason::Unreadable);
    }
    if truncated {
        if let Some(newline) = bytes.iter().position(|byte| *byte == b'\n') {
            bytes.drain(..=newline);
        } else {
            bytes.clear();
        }
    }
    SourceBytes::Bytes { bytes, truncated }
}

fn open_directory_no_follow(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(all(unix, target_os = "linux"))]
    {
        use std::os::unix::fs::OpenOptionsExt;
        const O_NOFOLLOW: i32 = 0x20_000;
        options.custom_flags(O_NOFOLLOW);
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        use std::os::unix::fs::OpenOptionsExt;
        const O_NOFOLLOW: i32 = 0x100;
        options.custom_flags(O_NOFOLLOW);
    }
    options.open(path)
}

fn open_no_follow(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(all(unix, target_os = "linux"))]
    {
        use std::os::unix::fs::OpenOptionsExt;
        const O_NOFOLLOW: i32 = 0x20_000;
        options.custom_flags(O_NOFOLLOW);
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        use std::os::unix::fs::OpenOptionsExt;
        const O_NOFOLLOW: i32 = 0x100;
        options.custom_flags(O_NOFOLLOW);
    }
    options.open(path)
}

fn handle_is_directory(file: &File) -> bool {
    file.metadata()
        .map(|metadata| metadata.is_dir() && !is_link_or_reparse(&metadata))
        .unwrap_or(false)
}

fn handle_is_regular_file(file: &File) -> bool {
    file.metadata()
        .map(|metadata| metadata.is_file() && !is_link_or_reparse(&metadata))
        .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileIdentity(u64, u64);

#[cfg(windows)]
fn file_identity(file: &File) -> Option<FileIdentity> {
    use std::os::windows::io::AsRawHandle;

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    struct ByHandleFileInformation {
        attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(
            file: *mut core::ffi::c_void,
            information: *mut ByHandleFileInformation,
        ) -> i32;
    }

    let mut information = std::mem::MaybeUninit::<ByHandleFileInformation>::uninit();
    let succeeded = unsafe {
        GetFileInformationByHandle(file.as_raw_handle().cast(), information.as_mut_ptr())
    };
    if succeeded == 0 {
        return None;
    }
    let information = unsafe { information.assume_init() };
    let index =
        (u64::from(information.file_index_high) << 32) | u64::from(information.file_index_low);
    Some(FileIdentity(
        u64::from(information.volume_serial_number),
        index,
    ))
}

#[cfg(unix)]
fn file_identity(file: &File) -> Option<FileIdentity> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata().ok()?;
    Some(FileIdentity(metadata.dev(), metadata.ino()))
}

#[cfg(windows)]
fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_type().is_symlink() || metadata.file_attributes() & 0x0400 != 0
}

#[cfg(not(windows))]
fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn enforce_precompression_budget(desktop: &mut SafeLog, asr: &mut SafeLog) -> usize {
    enforce_precompression_budget_using(desktop, asr, |desktop, asr| {
        rendered_len(desktop).saturating_add(rendered_len(asr))
    })
}

fn enforce_precompression_budget_using<F>(
    desktop: &mut SafeLog,
    asr: &mut SafeLog,
    measure: F,
) -> usize
where
    F: FnOnce(&SafeLog, &SafeLog) -> usize,
{
    let mut total_bytes = measure(desktop, asr);
    while total_bytes > PRECOMPRESSION_LOG_BUDGET {
        let Some((removed_bytes, _logical_count)) = drop_oldest(desktop, asr) else {
            break;
        };
        total_bytes = total_bytes.saturating_sub(removed_bytes);
    }
    total_bytes
}

fn rendered_len(log: &SafeLog) -> usize {
    log.records
        .iter()
        .map(|record| record.line.len().saturating_add(1))
        .sum()
}

fn drop_oldest(desktop: &mut SafeLog, asr: &mut SafeLog) -> Option<(usize, u64)> {
    let desktop_oldest = desktop.records.last().map(|record| record.utc_ms);
    let asr_oldest = asr.records.last().map(|record| record.utc_ms);
    let target = match (desktop_oldest, asr_oldest) {
        (Some(left), Some(right)) if left <= right => desktop,
        (Some(_), Some(_)) => asr,
        (Some(_), None) => desktop,
        (None, Some(_)) => asr,
        (None, None) => return None,
    };
    let removed = target.records.pop().expect("selected log has a record");
    target.truncated = true;
    target.size_limited_records = target
        .size_limited_records
        .saturating_add(removed.logical_count);
    if target.records.is_empty() {
        target.omission = Some(OmissionReason::SizeLimit);
    }
    Some((removed.line.len().saturating_add(1), removed.logical_count))
}

fn drop_oldest_bytes(desktop: &mut SafeLog, asr: &mut SafeLog, target_bytes: usize) -> usize {
    let mut removed_bytes = 0_usize;
    while removed_bytes < target_bytes {
        let Some((record_bytes, _logical_count)) = drop_oldest(desktop, asr) else {
            break;
        };
        removed_bytes = removed_bytes.saturating_add(record_bytes);
    }
    removed_bytes
}

fn build_zip(
    manifest: &DiagnosticManifest,
    desktop: &SafeLog,
    asr: &SafeLog,
) -> Result<Vec<u8>, ()> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600);
    let manifest_bytes = serde_json::to_vec(manifest).map_err(|_| ())?;
    writer
        .start_file(MANIFEST_FILE_NAME, options)
        .map_err(|_| ())?;
    writer.write_all(&manifest_bytes).map_err(|_| ())?;
    if let Some(bytes) = desktop.rendered() {
        writer
            .start_file(DESKTOP_LOG_FILE_NAME, options)
            .map_err(|_| ())?;
        writer.write_all(&bytes).map_err(|_| ())?;
    }
    if let Some(bytes) = asr.rendered() {
        writer
            .start_file(ASR_DIAGNOSTIC_LOG_FILE_NAME, options)
            .map_err(|_| ())?;
        writer.write_all(&bytes).map_err(|_| ())?;
    }
    Ok(writer.finish().map_err(|_| ())?.into_inner())
}

fn safe_app_version(value: &str) -> String {
    if !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
    {
        value.to_string()
    } else {
        "unknown".to_string()
    }
}

fn current_os() -> DiagnosticOs {
    if cfg!(target_os = "windows") {
        DiagnosticOs::Windows
    } else if cfg!(target_os = "macos") {
        DiagnosticOs::Macos
    } else if cfg!(target_os = "linux") {
        DiagnosticOs::Linux
    } else {
        DiagnosticOs::Unknown
    }
}

fn current_arch() -> DiagnosticArch {
    if cfg!(target_arch = "x86_64") {
        DiagnosticArch::X86_64
    } else if cfg!(target_arch = "aarch64") {
        DiagnosticArch::Aarch64
    } else if cfg!(target_arch = "x86") {
        DiagnosticArch::X86
    } else if cfg!(target_arch = "arm") {
        DiagnosticArch::Arm
    } else {
        DiagnosticArch::Unknown
    }
}

fn utc_now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{
        assemble_diagnostic_zip_at, enforce_precompression_budget_using, parse_desktop_line,
        read_fixed_source_with_hook, rendered_len, SafeLog, SafeRecord, SourceBytes,
        MAX_SOURCE_BYTES, MAX_ZIP_BYTES, PRECOMPRESSION_LOG_BUDGET,
    };
    use crate::asr_model::{
        DiagnosticCacheStatus, DiagnosticModelSnapshot, SupportedDiagnosticModel,
    };
    use crate::runtime::ASR_DIAGNOSTIC_LOG_FILE_NAME;
    use crate::RuntimePaths;
    use serde_json::Value;
    use std::fs;
    use std::io::{Cursor, Read};
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::ZipArchive;

    const NOW: u64 = 1_800_000_000_000;

    #[test]
    fn precompression_budget_measures_total_once_and_drops_oldest_across_logs() {
        let mut desktop = safe_log(
            "frameq-desktop.log",
            (0..60_000_u64)
                .map(|index| safe_record(NOW - index * 2, 96))
                .collect(),
        );
        let mut asr = safe_log(
            "asr-model-download.log",
            (0..60_000_u64)
                .map(|index| safe_record(NOW - index * 2 - 1, 96))
                .collect(),
        );
        let measurements = std::cell::Cell::new(0_u32);

        enforce_precompression_budget_using(&mut desktop, &mut asr, |desktop, asr| {
            measurements.set(measurements.get() + 1);
            rendered_len(desktop).saturating_add(rendered_len(asr))
        });

        assert_eq!(measurements.get(), 1);
        assert!(
            rendered_len(&desktop).saturating_add(rendered_len(&asr)) <= PRECOMPRESSION_LOG_BUDGET
        );
        let newest_removed = [desktop.records.last(), asr.records.last()]
            .into_iter()
            .flatten()
            .map(|record| record.utc_ms)
            .min()
            .expect("retained records");
        assert!(desktop
            .records
            .iter()
            .all(|record| record.utc_ms >= newest_removed));
        assert!(asr
            .records
            .iter()
            .all(|record| record.utc_ms >= newest_removed));
        assert!(
            desktop
                .records
                .last()
                .expect("desktop oldest")
                .utc_ms
                .abs_diff(asr.records.last().expect("asr oldest").utc_ms)
                <= 1
        );
    }

    #[test]
    fn source_tail_truncation_reports_unknown_size_limit_for_valid_logs() {
        let paths = runtime_paths("tail-truncation-unknown-count");
        let logs = paths.user_data_dir.join("logs");
        fs::create_dir_all(&logs).expect("logs");
        let desktop_line = padded_line(
            &format!("unix_ms={NOW} event=worker.download_asr_model.start"),
            1_024,
        );
        let asr_record = serde_json::json!({
            "v": 1,
            "utc_ms": NOW,
            "invocation": "inv-0123456789abcdef",
            "kind": "rejected",
            "payload": "diagnostic_event_rejected",
            "count": 1,
            "truncated": false
        });
        let asr_line = padded_line(&asr_record.to_string(), 1_024);
        let repeats = MAX_SOURCE_BYTES as usize / 1_024;
        fs::write(
            logs.join("frameq-desktop.log"),
            format!("{desktop_line}{}", desktop_line.repeat(repeats)),
        )
        .expect("oversized desktop");
        fs::write(
            logs.join(ASR_DIAGNOSTIC_LOG_FILE_NAME),
            format!("{asr_line}{}", asr_line.repeat(repeats)),
        )
        .expect("oversized asr");

        let bytes =
            assemble_diagnostic_zip_at(&paths, &snapshot(), "0.3.1", NOW).expect("assemble zip");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("zip");
        let manifest: Value = serde_json::from_slice(&read_entry(&mut archive, "diagnostics.json"))
            .expect("manifest");
        assert_eq!(manifest["truncated"], true);
        for name in ["frameq-desktop.log", "asr-model-download.log"] {
            let status = manifest["files"]
                .as_array()
                .expect("files")
                .iter()
                .find(|entry| entry["name"] == name)
                .expect("status");
            assert_eq!(status["status"], "included");
            assert!(status.get("omitted_records").is_none());
            assert_eq!(status["omitted_records_unknown"], true);
            assert_eq!(status["record_omission_reason"], "size_limit");
        }
    }

    #[test]
    fn unknown_source_count_combines_with_known_record_omissions_as_multiple() {
        let mut log = safe_log("frameq-desktop.log", vec![safe_record(NOW, 64)]);
        log.truncated = true;
        log.size_limited_records_unknown = true;
        log.malformed_records = 2;

        let status = serde_json::to_value(log.status()).expect("status");
        assert!(status.get("omitted_records").is_none());
        assert_eq!(status["omitted_records_unknown"], true);
        assert_eq!(status["record_omission_reason"], "multiple");
    }

    #[test]
    fn archive_has_only_fixed_root_entries_and_closed_manifest() {
        let paths = runtime_paths("fixed-entries");
        seed_desktop(
            &paths,
            NOW,
            "worker.download_asr_model.start",
            "token=secret",
        );
        seed_asr(&paths, NOW, "connection_timeout");

        let bytes =
            assemble_diagnostic_zip_at(&paths, &snapshot(), "0.3.1", NOW).expect("assemble zip");
        assert!(bytes.len() <= MAX_ZIP_BYTES);
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("open zip");
        let names = (0..archive.len())
            .map(|index| archive.by_index(index).expect("entry").name().to_string())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "diagnostics.json",
                "frameq-desktop.log",
                "asr-model-download.log"
            ]
        );
        let manifest: Value = serde_json::from_slice(&read_entry(&mut archive, "diagnostics.json"))
            .expect("manifest json");
        assert_eq!(manifest["schema_version"], 1);
        assert_eq!(manifest["selected_model"], "iic/SenseVoiceSmall");
        assert_eq!(manifest["cache_status"], "ready");
        assert_eq!(manifest.as_object().expect("object").len(), 10);
        let rendered = serde_json::to_string(&manifest).expect("render");
        for forbidden in ["secret", "token=", "C:\\\\Users", "http://", "task_id"] {
            assert!(!rendered.contains(forbidden));
        }
    }

    #[test]
    fn export_filters_old_records_and_resanitizes_desktop_text() {
        let paths = runtime_paths("retention-resanitize");
        seed_desktop(
            &paths,
            NOW - 1_000,
            "worker.download_asr_model.exit",
            "https://private.example C:\\\\Users\\alice\\secret token=abc transcript words",
        );
        seed_desktop(
            &paths,
            NOW - 8 * 24 * 60 * 60 * 1_000,
            "worker.download_asr_model.start",
            "old-secret",
        );

        let bytes =
            assemble_diagnostic_zip_at(&paths, &snapshot(), "0.3.1", NOW).expect("assemble zip");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("open zip");
        let desktop = String::from_utf8(read_entry(&mut archive, "frameq-desktop.log"))
            .expect("desktop utf8");
        assert!(desktop.contains("worker_download_asr_model_exit"));
        for forbidden in [
            "private.example",
            "alice",
            "secret",
            "transcript",
            "old-secret",
        ] {
            assert!(!desktop.contains(forbidden));
        }
    }

    #[test]
    fn malformed_and_linked_sources_are_fixed_omissions() {
        let paths = runtime_paths("source-omissions");
        let logs = paths.user_data_dir.join("logs");
        fs::create_dir_all(&logs).expect("logs");
        fs::write(logs.join("frameq-desktop.log"), "not-a-record\n").expect("malformed");

        let bytes =
            assemble_diagnostic_zip_at(&paths, &snapshot(), "0.3.1", NOW).expect("assemble zip");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("open zip");
        assert_eq!(archive.len(), 1);
        let manifest =
            String::from_utf8(read_entry(&mut archive, "diagnostics.json")).expect("manifest utf8");
        assert!(manifest.contains("malformed"));
        assert!(manifest.contains("missing"));
        assert!(manifest.contains("\"truncated\":true"));
        assert!(!manifest.contains(paths.user_data_dir.to_string_lossy().as_ref()));

        let unsafe_paths = runtime_paths("unsafe-source");
        fs::create_dir_all(&unsafe_paths.user_data_dir).expect("app data");
        fs::write(unsafe_paths.user_data_dir.join("logs"), "not-a-directory")
            .expect("unsafe logs node");
        let unsafe_bytes = assemble_diagnostic_zip_at(&unsafe_paths, &snapshot(), "0.3.1", NOW)
            .expect("assemble unsafe source zip");
        let mut unsafe_archive = ZipArchive::new(Cursor::new(unsafe_bytes)).expect("open zip");
        let unsafe_manifest =
            String::from_utf8(read_entry(&mut unsafe_archive, "diagnostics.json"))
                .expect("manifest utf8");
        assert!(unsafe_manifest.contains("unsafe_file"));
    }

    #[test]
    fn asr_fallback_is_resanitized_and_malformed_records_never_cross_zip() {
        let paths = runtime_paths("asr-resanitize");
        let logs = paths.user_data_dir.join("logs");
        fs::create_dir_all(&logs).expect("logs");
        let hostile = serde_json::json!({
            "v": 1,
            "utc_ms": NOW,
            "invocation": "inv-0123456789abcdef",
            "kind": "fallback",
            "payload": "Traceback File C:\\\\Users\\alice\\worker.py RuntimeError: transcript-secret https://private.example token=credential-omega",
            "count": 1,
            "truncated": false
        });
        fs::write(
            logs.join(ASR_DIAGNOSTIC_LOG_FILE_NAME),
            format!("{hostile}\n{{\"unknown\":\"raw-secret\"}}\n"),
        )
        .expect("asr source");

        let bytes =
            assemble_diagnostic_zip_at(&paths, &snapshot(), "0.3.1", NOW).expect("assemble zip");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("open zip");
        let exported = String::from_utf8(read_entry(&mut archive, "asr-model-download.log"))
            .expect("asr utf8");
        assert!(exported.contains("[traceback]"));
        for forbidden in [
            "alice",
            "worker.py",
            "transcript-secret",
            "private.example",
            "credential-omega",
            "raw-secret",
        ] {
            assert!(!exported.contains(forbidden), "leaked {forbidden}");
        }
        let manifest =
            String::from_utf8(read_entry(&mut archive, "diagnostics.json")).expect("manifest utf8");
        assert!(manifest.contains("\"truncated\":true"));
    }

    #[test]
    fn newest_records_win_budget_and_manifest_reports_truncation() {
        let paths = runtime_paths("budget");
        let logs = paths.user_data_dir.join("logs");
        fs::create_dir_all(&logs).expect("logs");
        let mut lines = String::new();
        for index in 0..90_000_u64 {
            lines.push_str(&format!(
                "unix_ms={} event=worker.download_asr_model.exit untrusted={}\n",
                NOW - index,
                index
            ));
        }
        fs::write(logs.join("frameq-desktop.log"), lines).expect("desktop source");

        let bytes =
            assemble_diagnostic_zip_at(&paths, &snapshot(), "0.3.1", NOW).expect("assemble zip");
        assert!(bytes.len() <= MAX_ZIP_BYTES);
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("open zip");
        let manifest =
            String::from_utf8(read_entry(&mut archive, "diagnostics.json")).expect("manifest utf8");
        assert!(manifest.contains("\"truncated\":true"));
        let desktop = String::from_utf8(read_entry(&mut archive, "frameq-desktop.log"))
            .expect("desktop utf8");
        assert!(desktop
            .lines()
            .next()
            .expect("newest")
            .contains(&NOW.to_string()));
    }

    #[test]
    fn model_result_preserves_only_the_closed_outcome_set() {
        for outcome in [
            "idle_timeout",
            "absolute_timeout",
            "cancelled",
            "structured",
            "unstructured_failure",
        ] {
            let parsed = parse_desktop_line(&format!(
                "unix_ms={NOW} event=worker.download_asr_model.result operation=download_asr_model outcome={outcome}"
            ))
            .expect("closed outcome");
            assert!(parsed.line.contains(&format!("outcome={outcome}")));
        }
        for invalid in ["success", "review-secret", "structured extra=private"] {
            assert!(parse_desktop_line(&format!(
                "unix_ms={NOW} event=worker.download_asr_model.result operation=download_asr_model outcome={invalid}"
            ))
            .is_none());
        }
    }

    #[test]
    fn mixed_valid_and_malformed_sources_report_closed_record_omissions() {
        let paths = runtime_paths("mixed-records");
        let logs = paths.user_data_dir.join("logs");
        fs::create_dir_all(&logs).expect("logs");
        fs::write(
            logs.join("frameq-desktop.log"),
            format!(
                "unix_ms={NOW} event=worker.download_asr_model.result operation=download_asr_model outcome=structured\nraw desktop secret\n"
            ),
        )
        .expect("desktop mixed");
        let valid = serde_json::json!({
            "v": 1,
            "utc_ms": NOW,
            "invocation": "inv-0123456789abcdef",
            "kind": "rejected",
            "payload": "diagnostic_event_rejected",
            "count": 1,
            "truncated": false
        });
        fs::write(
            logs.join(ASR_DIAGNOSTIC_LOG_FILE_NAME),
            format!("{valid}\n{{\"payload\":\"raw asr secret\"}}\n"),
        )
        .expect("asr mixed");

        let bytes =
            assemble_diagnostic_zip_at(&paths, &snapshot(), "0.3.1", NOW).expect("assemble zip");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("open zip");
        let manifest: Value = serde_json::from_slice(&read_entry(&mut archive, "diagnostics.json"))
            .expect("manifest");
        assert_eq!(manifest["truncated"], true);
        for name in ["frameq-desktop.log", "asr-model-download.log"] {
            let status = manifest["files"]
                .as_array()
                .expect("files")
                .iter()
                .find(|entry| entry["name"] == name)
                .expect("file status");
            assert_eq!(status["status"], "included");
            assert_eq!(status["omitted_records"], 1);
            assert_eq!(status["record_omission_reason"], "malformed");
            assert!(status.get("reason").is_none());
        }
    }

    #[test]
    fn asr_omission_count_preserves_collapsed_record_multiplicity() {
        let paths = runtime_paths("collapsed-omission-count");
        let logs = paths.user_data_dir.join("logs");
        fs::create_dir_all(&logs).expect("logs");
        let current = serde_json::json!({
            "v": 1,
            "utc_ms": NOW,
            "invocation": "inv-0123456789abcdef",
            "kind": "rejected",
            "payload": "diagnostic_event_rejected",
            "count": 1,
            "truncated": false
        });
        let old = serde_json::json!({
            "v": 1,
            "utc_ms": NOW - 8 * 24 * 60 * 60 * 1_000,
            "invocation": "inv-fedcba9876543210",
            "kind": "rejected",
            "payload": "diagnostic_event_rejected",
            "count": 7,
            "truncated": false
        });
        fs::write(
            logs.join(ASR_DIAGNOSTIC_LOG_FILE_NAME),
            format!("{current}\n{old}\n"),
        )
        .expect("asr source");

        let bytes =
            assemble_diagnostic_zip_at(&paths, &snapshot(), "0.3.1", NOW).expect("assemble zip");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("zip");
        let manifest: Value = serde_json::from_slice(&read_entry(&mut archive, "diagnostics.json"))
            .expect("manifest");
        let status = manifest["files"]
            .as_array()
            .expect("files")
            .iter()
            .find(|entry| entry["name"] == "asr-model-download.log")
            .expect("asr status");
        assert_eq!(status["omitted_records"], 7);
        assert_eq!(status["record_omission_reason"], "outside_window");
    }

    #[test]
    fn source_identity_rejects_target_replacement_between_validation_and_open() {
        let paths = runtime_paths("target-replacement");
        let logs = paths.user_data_dir.join("logs");
        fs::create_dir_all(&logs).expect("logs");
        let target = logs.join("frameq-desktop.log");
        fs::write(
            &target,
            format!("unix_ms={NOW} event=asr_diagnostic.write_failed\n"),
        )
        .expect("original");
        let backup = logs.join("original.log");
        let result = read_fixed_source_with_hook(&paths, &target, || {
            fs::rename(&target, &backup).expect("move original");
            fs::write(
                &target,
                format!("unix_ms={NOW} event=worker.download_asr_model.start\n"),
            )
            .expect("replacement");
        });
        assert!(matches!(
            result,
            SourceBytes::Omitted(super::OmissionReason::UnsafeFile)
        ));
    }

    #[test]
    fn source_identity_rejects_parent_replacement_between_validation_and_open() {
        let paths = runtime_paths("parent-replacement");
        let logs = paths.user_data_dir.join("logs");
        fs::create_dir_all(&logs).expect("logs");
        let target = logs.join("frameq-desktop.log");
        fs::write(
            &target,
            format!("unix_ms={NOW} event=asr_diagnostic.write_failed\n"),
        )
        .expect("original");
        let moved_logs = paths.user_data_dir.join("logs-original");
        let result = read_fixed_source_with_hook(&paths, &target, || {
            fs::rename(&logs, &moved_logs).expect("move logs");
            fs::create_dir_all(&logs).expect("replacement logs");
            fs::write(
                &target,
                format!("unix_ms={NOW} event=worker.download_asr_model.start\n"),
            )
            .expect("replacement target");
        });
        assert!(matches!(
            result,
            SourceBytes::Omitted(super::OmissionReason::UnsafeFile)
        ));
    }

    fn snapshot() -> DiagnosticModelSnapshot {
        DiagnosticModelSnapshot {
            model: SupportedDiagnosticModel::SenseVoiceSmall,
            cache_status: DiagnosticCacheStatus::Ready,
        }
    }

    fn safe_log(name: &'static str, records: Vec<SafeRecord>) -> SafeLog {
        SafeLog {
            name,
            records,
            omission: None,
            truncated: false,
            malformed_records: 0,
            outside_window_records: 0,
            size_limited_records: 0,
            size_limited_records_unknown: false,
        }
    }

    fn safe_record(utc_ms: u64, rendered_bytes: usize) -> SafeRecord {
        SafeRecord {
            utc_ms,
            line: "x".repeat(rendered_bytes - 1),
            logical_count: 1,
        }
    }

    fn padded_line(content: &str, total_bytes: usize) -> String {
        assert!(content.len() < total_bytes);
        format!("{content}{}\n", " ".repeat(total_bytes - content.len() - 1))
    }

    fn seed_desktop(paths: &RuntimePaths, utc_ms: u64, event: &str, detail: &str) {
        let logs = paths.user_data_dir.join("logs");
        fs::create_dir_all(&logs).expect("logs");
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(logs.join("frameq-desktop.log"))
            .expect("open desktop log");
        writeln!(file, "unix_ms={utc_ms} event={event} {detail}").expect("desktop log");
    }

    fn seed_asr(paths: &RuntimePaths, utc_ms: u64, code: &str) {
        let logs = paths.user_data_dir.join("logs");
        fs::create_dir_all(&logs).expect("logs");
        let payload = format!(
            "{{\"version\":1,\"operation\":\"download_asr_model\",\"phase\":\"primary_model\",\"category\":\"network\",\"code\":\"{code}\"}}"
        );
        let line = serde_json::json!({
            "v": 1,
            "utc_ms": utc_ms,
            "invocation": "inv-0123456789abcdef",
            "kind": "structured",
            "payload": payload,
            "count": 1,
            "truncated": false
        });
        fs::write(logs.join(ASR_DIAGNOSTIC_LOG_FILE_NAME), format!("{line}\n")).expect("asr log");
    }

    fn read_entry(archive: &mut ZipArchive<Cursor<Vec<u8>>>, name: &str) -> Vec<u8> {
        let mut entry = archive.by_name(name).expect("named entry");
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).expect("read entry");
        bytes
    }

    fn runtime_paths(name: &str) -> RuntimePaths {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("frameq-export-{name}-{unique}"));
        fs::create_dir_all(&root).expect("root");
        RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("app-data"),
        }
    }
}
