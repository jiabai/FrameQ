use super::append_desktop_log;
use crate::runtime::ASR_DIAGNOSTIC_LOG_FILE_NAME;
use crate::{RuntimePaths, DESKTOP_LOG_DIR_NAME};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub(crate) const MAX_PAYLOAD_CHARS: usize = 1_000;
pub(crate) const FALLBACK_LINE_LIMIT: usize = 200;
pub(crate) const ASR_DIAGNOSTIC_MAX_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const RETENTION_MILLIS: u64 = 7 * 24 * 60 * 60 * 1_000;
const RECORD_VERSION: u8 = 1;
const WRITE_FAILURE_EVENT: &str = "asr_diagnostic.write_failed";
const WRITE_FAILURE_DETAIL: &str = "supplemental";
static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DiagnosticPhase {
    Preparing,
    PrimaryModel,
    VadModel,
    BpeModel,
    ArchiveDownload,
    ArchiveValidate,
    CacheValidate,
    CachePromote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DiagnosticCategory {
    Network,
    Tls,
    Proxy,
    Http,
    Filesystem,
    Integrity,
    Dependency,
    Unexpected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DiagnosticCode {
    DnsResolutionFailed,
    ConnectionTimeout,
    ConnectionFailed,
    TlsVerificationFailed,
    TlsHandshakeFailed,
    ProxyConfigurationFailed,
    ProxyConnectionFailed,
    HttpStatusFailed,
    PermissionDenied,
    DiskFull,
    FilesystemIoFailed,
    ChecksumMismatch,
    ArchiveInvalid,
    CacheInvalid,
    DependencyUnavailable,
    UnexpectedFailure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DiagnosticOperation {
    DownloadAsrModel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ValidatedDiagnosticEvent {
    version: u8,
    operation: DiagnosticOperation,
    phase: DiagnosticPhase,
    category: DiagnosticCategory,
    code: DiagnosticCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    exception_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    os_error_code: Option<i32>,
}

impl ValidatedDiagnosticEvent {
    pub(crate) fn new(
        phase: DiagnosticPhase,
        category: DiagnosticCategory,
        code: DiagnosticCode,
    ) -> Result<Self, &'static str> {
        if !category_accepts_code(category, code) {
            return Err("invalid_category_code");
        }
        Ok(Self {
            version: 1,
            operation: DiagnosticOperation::DownloadAsrModel,
            phase,
            category,
            code,
            exception_type: None,
            http_status: None,
            os_error_code: None,
        })
    }

    pub(crate) fn with_exception_type(mut self, value: &str) -> Result<Self, &'static str> {
        if !valid_exception_type(value) {
            return Err("invalid_exception_type");
        }
        self.exception_type = Some(value.to_string());
        Ok(self)
    }

    pub(crate) fn with_http_status(mut self, value: u16) -> Result<Self, &'static str> {
        if self.category != DiagnosticCategory::Http
            || self.code != DiagnosticCode::HttpStatusFailed
            || !(100..=599).contains(&value)
        {
            return Err("invalid_http_status");
        }
        self.http_status = Some(value);
        Ok(self)
    }

    pub(crate) fn with_os_error_code(mut self, value: i32) -> Result<Self, &'static str> {
        if !matches!(
            self.category,
            DiagnosticCategory::Network | DiagnosticCategory::Filesystem
        ) {
            return Err("invalid_os_error_code");
        }
        self.os_error_code = Some(value);
        Ok(self)
    }

    fn is_valid(&self) -> bool {
        self.version == 1
            && self.operation == DiagnosticOperation::DownloadAsrModel
            && category_accepts_code(self.category, self.code)
            && self
                .exception_type
                .as_deref()
                .is_none_or(valid_exception_type)
            && self.http_status.is_none_or(|status| {
                self.category == DiagnosticCategory::Http
                    && self.code == DiagnosticCode::HttpStatusFailed
                    && (100..=599).contains(&status)
            })
            && self.os_error_code.is_none_or(|_| {
                matches!(
                    self.category,
                    DiagnosticCategory::Network | DiagnosticCategory::Filesystem
                )
            })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DiagnosticRejectionCode {
    MalformedEvent,
    InvalidEvent,
    OversizedEvent,
}

impl DiagnosticRejectionCode {
    fn payload(self) -> &'static str {
        match self {
            Self::MalformedEvent => "malformed_event",
            Self::InvalidEvent => "invalid_event",
            Self::OversizedEvent => "oversized_event",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StoredRecordKind {
    Structured,
    Fallback,
    Rejected,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredDiagnosticRecord {
    #[serde(rename = "v")]
    version: u8,
    pub(crate) utc_ms: u64,
    pub(crate) invocation: String,
    pub(crate) kind: StoredRecordKind,
    pub(crate) payload: String,
    pub(crate) count: u32,
    pub(crate) truncated: bool,
}

pub(crate) struct AsrDiagnosticSink {
    paths: RuntimePaths,
    invocation: String,
    utc_ms: u64,
    fallback_lines: usize,
    fallback_limit_recorded: bool,
    records: Vec<StoredDiagnosticRecord>,
}

impl AsrDiagnosticSink {
    pub(crate) fn new(paths: &RuntimePaths) -> Self {
        Self::new_at(paths, utc_now_millis(), &random_invocation_token())
    }

    fn new_at(paths: &RuntimePaths, utc_ms: u64, invocation: &str) -> Self {
        Self {
            paths: paths.clone(),
            invocation: invocation.to_string(),
            utc_ms,
            fallback_lines: 0,
            fallback_limit_recorded: false,
            records: Vec::new(),
        }
    }

    pub(crate) fn structured(&mut self, event: &ValidatedDiagnosticEvent) {
        let Ok(payload) = serde_json::to_string(event) else {
            self.internal("structured_serialization_failed", false);
            return;
        };
        self.push(StoredRecordKind::Structured, payload, false);
    }

    pub(crate) fn fallback_line(&mut self, line: &str) {
        if self.fallback_lines >= FALLBACK_LINE_LIMIT {
            if !self.fallback_limit_recorded {
                self.internal("fallback_limit_reached", true);
                self.fallback_limit_recorded = true;
            }
            return;
        }
        self.fallback_lines += 1;
        let (payload, truncated) = sanitize_fallback_line_bounded(line);
        self.push(StoredRecordKind::Fallback, payload, truncated);
    }

    pub(crate) fn rejected(&mut self, code: DiagnosticRejectionCode) {
        self.push(
            StoredRecordKind::Rejected,
            code.payload().to_string(),
            false,
        );
    }

    pub(crate) fn finish(self) {
        if persist_records(&self.paths, self.utc_ms, self.records).is_err() {
            let _ = append_desktop_log(&self.paths, WRITE_FAILURE_EVENT, WRITE_FAILURE_DETAIL);
        }
    }

    fn internal(&mut self, payload: &str, truncated: bool) {
        self.push(StoredRecordKind::Internal, payload.to_string(), truncated);
    }

    fn push(&mut self, kind: StoredRecordKind, payload: String, already_truncated: bool) {
        let (payload, cap_truncated) = truncate_chars(&payload, MAX_PAYLOAD_CHARS);
        if let Some(previous) = self.records.last_mut() {
            if previous.kind == kind && previous.payload == payload {
                previous.count = previous.count.saturating_add(1);
                previous.truncated |= already_truncated || cap_truncated;
                return;
            }
        }
        self.records.push(StoredDiagnosticRecord {
            version: RECORD_VERSION,
            utc_ms: self.utc_ms,
            invocation: self.invocation.clone(),
            kind,
            payload,
            count: 1,
            truncated: already_truncated || cap_truncated,
        });
    }
}

pub(crate) fn read_recent_records(paths: &RuntimePaths) -> Vec<StoredDiagnosticRecord> {
    read_recent_records_at(paths, utc_now_millis())
}

fn read_recent_records_at(paths: &RuntimePaths, now_ms: u64) -> Vec<StoredDiagnosticRecord> {
    let Ok(path) = safe_asr_diagnostic_log_path(paths) else {
        return Vec::new();
    };
    read_valid_records(path, now_ms).unwrap_or_default()
}

fn asr_diagnostic_log_path(paths: &RuntimePaths) -> PathBuf {
    paths
        .user_data_dir
        .join(DESKTOP_LOG_DIR_NAME)
        .join(ASR_DIAGNOSTIC_LOG_FILE_NAME)
}

fn persist_records(
    paths: &RuntimePaths,
    now_ms: u64,
    pending: Vec<StoredDiagnosticRecord>,
) -> Result<(), ()> {
    let _guard = STORE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = safe_asr_diagnostic_log_path(paths)?;
    let mut records = read_valid_records(path.clone(), now_ms).unwrap_or_default();
    records.extend(pending);
    records.sort_by_key(|record| record.utc_ms);

    let mut lines = records
        .into_iter()
        .filter_map(|record| serde_json::to_string(&record).ok())
        .collect::<Vec<_>>();
    let mut total_bytes = serialized_lines_len(&lines);
    while total_bytes > ASR_DIAGNOSTIC_MAX_BYTES && !lines.is_empty() {
        total_bytes = total_bytes.saturating_sub(lines[0].len() + 1);
        lines.remove(0);
    }

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|_| ())?;
    for line in lines {
        file.write_all(line.as_bytes()).map_err(|_| ())?;
        file.write_all(b"\n").map_err(|_| ())?;
    }
    file.flush().map_err(|_| ())
}

fn safe_asr_diagnostic_log_path(paths: &RuntimePaths) -> Result<PathBuf, ()> {
    fs::create_dir_all(&paths.user_data_dir).map_err(|_| ())?;
    let logs_dir = paths.user_data_dir.join(DESKTOP_LOG_DIR_NAME);
    if let Ok(metadata) = fs::symlink_metadata(&logs_dir) {
        if !metadata.is_dir() || metadata_is_reparse_point(&metadata) {
            return Err(());
        }
    }
    fs::create_dir_all(&logs_dir).map_err(|_| ())?;

    let canonical_root = paths.user_data_dir.canonicalize().map_err(|_| ())?;
    let canonical_logs = logs_dir.canonicalize().map_err(|_| ())?;
    if canonical_logs == canonical_root || !canonical_logs.starts_with(&canonical_root) {
        return Err(());
    }

    let path = asr_diagnostic_log_path(paths);
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if !metadata.is_file() || metadata_is_reparse_point(&metadata) {
            return Err(());
        }
    }
    Ok(path)
}

#[cfg(windows)]
fn metadata_is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn metadata_is_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn read_valid_records(path: PathBuf, now_ms: u64) -> Result<Vec<StoredDiagnosticRecord>, ()> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(()),
    };
    let cutoff = now_ms.saturating_sub(RETENTION_MILLIS);
    Ok(raw
        .lines()
        .filter_map(|line| serde_json::from_str::<StoredDiagnosticRecord>(line).ok())
        .filter_map(normalize_stored_record)
        .filter(|record| record.utc_ms >= cutoff && record.utc_ms <= now_ms)
        .collect())
}

fn normalize_stored_record(mut record: StoredDiagnosticRecord) -> Option<StoredDiagnosticRecord> {
    if record.version != RECORD_VERSION {
        return None;
    }
    if !valid_invocation_token(&record.invocation)
        || record.count == 0
        || record.payload.chars().count() > MAX_PAYLOAD_CHARS
        || record
            .payload
            .chars()
            .any(|character| character.is_control())
    {
        return None;
    }

    match record.kind {
        StoredRecordKind::Structured => {
            let event = serde_json::from_str::<ValidatedDiagnosticEvent>(&record.payload).ok()?;
            if !event.is_valid() {
                return None;
            }
            record.payload = serde_json::to_string(&event).ok()?;
        }
        StoredRecordKind::Fallback => {
            let (payload, truncated) = sanitize_fallback_line_bounded(&record.payload);
            record.payload = payload;
            record.truncated |= truncated;
        }
        StoredRecordKind::Rejected => {
            if !matches!(
                record.payload.as_str(),
                "malformed_event" | "invalid_event" | "oversized_event"
            ) {
                return None;
            }
        }
        StoredRecordKind::Internal => {
            if !matches!(
                record.payload.as_str(),
                "fallback_limit_reached" | "structured_serialization_failed"
            ) {
                return None;
            }
        }
    }
    Some(record)
}

fn valid_invocation_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 40
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn random_invocation_token() -> String {
    let simple = Uuid::new_v4().simple().to_string();
    format!("inv-{}", &simple[..16])
}

fn utc_now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

pub(crate) fn sanitize_fallback_line(line: &str) -> String {
    sanitize_fallback_line_bounded(line).0
}

fn sanitize_fallback_line_bounded(line: &str) -> (String, bool) {
    let lower_line = line.to_ascii_lowercase();
    let had_traceback = (lower_line.contains("traceback") && !lower_line.contains("[traceback]"))
        || line
            .lines()
            .any(|value| value.trim_start().starts_with("File \""));
    let had_control = line
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'));
    let normalized = line
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let mut output = Vec::new();
    if had_traceback {
        output.push("[traceback]".to_string());
    }
    if had_control {
        output.push("[control]".to_string());
    }

    let mut credential_tail = 0_u8;
    let mut identity_tail = false;
    for raw_token in normalized.split_whitespace() {
        if is_fixed_replacement(raw_token) {
            output.push(raw_token.to_string());
            continue;
        }
        if identity_tail {
            output.push("[identity]".to_string());
            identity_tail = false;
            continue;
        }
        if credential_tail > 0 {
            credential_tail -= 1;
            if raw_token.eq_ignore_ascii_case("bearer") {
                continue;
            }
            output.push("[credential]".to_string());
            continue;
        }
        let token = raw_token.trim_matches(|character: char| {
            matches!(
                character,
                '"' | '\'' | ',' | ';' | '(' | ')' | '[' | ']' | '{' | '}'
            )
        });
        let lower = token.to_ascii_lowercase();
        let label = lower.trim_end_matches(':');
        if matches!(
            label,
            "username" | "user" | "hostname" | "host" | "computername"
        ) {
            output.push("[identity]".to_string());
            identity_tail = true;
        } else if lower.starts_with("authorization:")
            || lower.starts_with("cookie:")
            || lower.starts_with("set-cookie:")
        {
            output.push("[credential]".to_string());
            credential_tail = if lower == "authorization:" {
                2
            } else if lower == "authorization:bearer" {
                1
            } else if lower == "cookie:" || lower == "set-cookie:" {
                1
            } else {
                0
            };
        } else if looks_like_url(&lower) {
            output.push("[url]".to_string());
        } else if looks_like_path(token) {
            output.push("[path]".to_string());
        } else if let Some((key, value)) = token.split_once('=') {
            let key_lower = key.to_ascii_lowercase();
            if key_lower.contains("task") || key_lower.ends_with("_id") {
                output.push("[identifier]".to_string());
            } else if is_sensitive_key(&key_lower) {
                output.push("[credential]".to_string());
            } else if looks_opaque(value) {
                output.push("[opaque]".to_string());
            } else {
                output.push("[assignment]".to_string());
            }
        } else if looks_like_ip(token) {
            output.push("[ip]".to_string());
        } else if looks_like_email(token) {
            output.push("[email]".to_string());
        } else if looks_task_identifier(token) {
            output.push("[identifier]".to_string());
        } else if looks_opaque(token) {
            output.push("[opaque]".to_string());
        } else if lower == "traceback" {
            continue;
        } else {
            output.push(token.to_string());
        }
    }

    let collapsed = output.join(" ");
    let (bounded, truncated) = truncate_chars(&collapsed, MAX_PAYLOAD_CHARS);
    if bounded.is_empty() {
        ("[empty]".to_string(), truncated)
    } else {
        (bounded, truncated)
    }
}

fn is_fixed_replacement(value: &str) -> bool {
    matches!(
        value,
        "[traceback]"
            | "[path]"
            | "[assignment]"
            | "[url]"
            | "[credential]"
            | "[identifier]"
            | "[opaque]"
            | "[control]"
            | "[identity]"
            | "[email]"
            | "[ip]"
            | "[empty]"
    )
}

fn looks_like_url(value: &str) -> bool {
    value.contains("://")
        || value.starts_with("www.")
        || value.starts_with("proxy.")
        || value.contains("?http")
}

fn looks_like_path(value: &str) -> bool {
    let trimmed = value.trim_matches(|character: char| matches!(character, '"' | '\'' | ':' | ','));
    let bytes = trimmed.as_bytes();
    (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/'))
        || trimmed.starts_with("\\\\")
        || trimmed.starts_with('/')
        || trimmed.starts_with("~/")
        || trimmed.starts_with("~\\")
        || trimmed.contains("\\Users\\")
        || trimmed.contains("/Users/")
        || trimmed.contains("/home/")
}

fn is_sensitive_key(key: &str) -> bool {
    [
        "authorization",
        "cookie",
        "token",
        "key",
        "secret",
        "password",
        "passwd",
        "credential",
        "proxy",
        "signature",
        "session",
    ]
    .iter()
    .any(|marker| key.contains(marker))
}

fn looks_like_email(value: &str) -> bool {
    let mut parts = value.split('@');
    matches!((parts.next(), parts.next(), parts.next()), (Some(local), Some(domain), None) if !local.is_empty() && domain.contains('.'))
}

fn looks_like_ip(value: &str) -> bool {
    let trimmed = value.trim_matches(|character: char| {
        !character.is_ascii_hexdigit() && character != '.' && character != ':'
    });
    trimmed.parse::<std::net::IpAddr>().is_ok()
}

fn looks_task_identifier(value: &str) -> bool {
    let digits = value.chars().filter(char::is_ascii_digit).count();
    value.len() >= 20 && value.matches('-').count() >= 2 && digits >= 12
}

fn looks_opaque(value: &str) -> bool {
    let trimmed = value.trim_matches(|character: char| !character.is_ascii_alphanumeric());
    trimmed.len() >= 32
        && trimmed
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
        && trimmed.chars().any(|character| character.is_ascii_digit())
        && trimmed
            .chars()
            .any(|character| character.is_ascii_alphabetic())
}

fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
    if value.chars().count() <= max_chars {
        return (value.to_string(), false);
    }
    (
        value
            .chars()
            .take(max_chars.saturating_sub(3))
            .collect::<String>()
            + "...",
        true,
    )
}

fn serialized_lines_len(lines: &[String]) -> usize {
    lines.iter().map(|line| line.len() + 1).sum()
}

fn valid_exception_type(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_alphabetic())
        && value.len() <= 80
        && chars.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn category_accepts_code(category: DiagnosticCategory, code: DiagnosticCode) -> bool {
    matches!(
        (category, code),
        (
            DiagnosticCategory::Network,
            DiagnosticCode::DnsResolutionFailed
                | DiagnosticCode::ConnectionTimeout
                | DiagnosticCode::ConnectionFailed
        ) | (
            DiagnosticCategory::Tls,
            DiagnosticCode::TlsVerificationFailed | DiagnosticCode::TlsHandshakeFailed
        ) | (
            DiagnosticCategory::Proxy,
            DiagnosticCode::ProxyConfigurationFailed | DiagnosticCode::ProxyConnectionFailed
        ) | (DiagnosticCategory::Http, DiagnosticCode::HttpStatusFailed)
            | (
                DiagnosticCategory::Filesystem,
                DiagnosticCode::PermissionDenied
                    | DiagnosticCode::DiskFull
                    | DiagnosticCode::FilesystemIoFailed
            )
            | (
                DiagnosticCategory::Integrity,
                DiagnosticCode::ChecksumMismatch
                    | DiagnosticCode::ArchiveInvalid
                    | DiagnosticCode::CacheInvalid
            )
            | (
                DiagnosticCategory::Dependency,
                DiagnosticCode::DependencyUnavailable
            )
            | (
                DiagnosticCategory::Unexpected,
                DiagnosticCode::UnexpectedFailure
            )
    )
}

#[cfg(test)]
mod tests {
    use super::{
        asr_diagnostic_log_path, read_recent_records_at, sanitize_fallback_line, AsrDiagnosticSink,
        DiagnosticCategory, DiagnosticCode, DiagnosticPhase, DiagnosticRejectionCode,
        StoredRecordKind, ValidatedDiagnosticEvent, ASR_DIAGNOSTIC_MAX_BYTES, FALLBACK_LINE_LIMIT,
        MAX_PAYLOAD_CHARS, RETENTION_MILLIS,
    };
    use crate::RuntimePaths;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn log_path_is_fixed_under_app_local_logs() {
        let paths = runtime_paths("fixed-path");

        assert_eq!(
            asr_diagnostic_log_path(&paths),
            paths
                .user_data_dir
                .join("logs")
                .join("asr-model-download.log")
        );
    }

    #[test]
    fn stores_structured_records_and_filters_by_parsed_utc_timestamp() {
        let paths = runtime_paths("structured-retention");
        let now = 1_800_000_000_000_u64;
        write_raw_lines(
            &paths,
            &[
                record_line(now - RETENTION_MILLIS - 1, "old", "fallback", "expired"),
                record_line(now - RETENTION_MILLIS, "edge", "fallback", "kept"),
                "not-json".to_string(),
            ],
        );
        let mut sink = AsrDiagnosticSink::new_at(&paths, now, "inv-safe");
        sink.structured(&sample_event());
        sink.finish();

        let records = read_recent_records_at(&paths, now);
        assert_eq!(records.len(), 2);
        assert!(records
            .iter()
            .all(|record| record.utc_ms >= now - RETENTION_MILLIS));
        assert!(records.iter().any(|record| {
            record.invocation == "inv-safe" && record.kind == StoredRecordKind::Structured
        }));
        let raw = fs::read_to_string(asr_diagnostic_log_path(&paths)).expect("read log");
        assert!(!raw.contains("expired"));
        assert!(!raw.contains("not-json"));
    }

    #[test]
    fn caps_payloads_and_collapses_adjacent_duplicates() {
        let paths = runtime_paths("bounded-deduplicated");
        let mut sink = AsrDiagnosticSink::new_at(&paths, 1_800_000_000_000, "inv-safe");
        let long_line = "safe ".repeat(MAX_PAYLOAD_CHARS);
        sink.fallback_line(&long_line);
        sink.fallback_line(&long_line);
        sink.rejected(DiagnosticRejectionCode::MalformedEvent);
        sink.finish();

        let records = read_recent_records_at(&paths, 1_800_000_000_000);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].kind, StoredRecordKind::Fallback);
        assert_eq!(records[0].count, 2);
        assert!(records[0].truncated);
        assert!(records[0].payload.chars().count() <= MAX_PAYLOAD_CHARS);
        assert_eq!(records[1].kind, StoredRecordKind::Rejected);
    }

    #[test]
    fn limits_fallback_lines_per_invocation() {
        let paths = runtime_paths("fallback-limit");
        let mut sink = AsrDiagnosticSink::new_at(&paths, 1_800_000_000_000, "inv-safe");
        for index in 0..FALLBACK_LINE_LIMIT + 10 {
            sink.fallback_line(&format!("failure number {index}"));
        }
        sink.finish();

        let records = read_recent_records_at(&paths, 1_800_000_000_000);
        let fallback_count = records
            .iter()
            .filter(|record| record.kind == StoredRecordKind::Fallback)
            .count();
        assert_eq!(fallback_count, FALLBACK_LINE_LIMIT);
        assert!(records.iter().any(|record| {
            record.kind == StoredRecordKind::Internal
                && record.payload == "fallback_limit_reached"
                && record.truncated
        }));
    }

    #[test]
    fn rotates_to_four_mib_and_drops_malformed_prior_lines() {
        let paths = runtime_paths("size-rotation");
        let now = 1_800_000_000_000_u64;
        let payload = "x".repeat(MAX_PAYLOAD_CHARS);
        let line = record_line(now, "prior", "fallback", &payload);
        let mut lines = Vec::new();
        while lines
            .iter()
            .map(|value: &String| value.len() + 1)
            .sum::<usize>()
            <= ASR_DIAGNOSTIC_MAX_BYTES + line.len()
        {
            lines.push(line.clone());
        }
        lines.insert(0, "corrupt-secret-prior-line".to_string());
        write_raw_lines(&paths, &lines);

        let mut sink = AsrDiagnosticSink::new_at(&paths, now, "inv-safe");
        sink.fallback_line("latest safe failure");
        sink.finish();

        let bytes = fs::read(asr_diagnostic_log_path(&paths)).expect("read bounded log");
        assert!(bytes.len() <= ASR_DIAGNOSTIC_MAX_BYTES);
        let text = String::from_utf8(bytes).expect("utf8 log");
        assert!(!text.contains("corrupt-secret-prior-line"));
        assert!(text.contains("latest safe failure"));
    }

    #[test]
    fn rewrites_parseable_prior_records_through_the_current_sanitizer() {
        let paths = runtime_paths("resanitize-prior");
        let now = 1_800_000_000_000_u64;
        write_raw_lines(
            &paths,
            &[record_line(
                now,
                "prior",
                "fallback",
                "failed at C:\\Users\\alice\\private token=prior-secret",
            )],
        );

        let sink = AsrDiagnosticSink::new_at(&paths, now, "inv-safe");
        sink.finish();

        let raw = fs::read_to_string(asr_diagnostic_log_path(&paths)).expect("read log");
        assert!(!raw.contains("alice"));
        assert!(!raw.contains("private"));
        assert!(!raw.contains("prior-secret"));
        assert!(raw.contains("[path]"));
        assert!(raw.contains("[credential]"));
    }

    #[test]
    fn unreadable_or_locked_log_is_supplemental() {
        let paths = runtime_paths("unreadable-neutral");
        let log_path = asr_diagnostic_log_path(&paths);
        fs::create_dir_all(&log_path).expect("replace expected file with directory");

        let mut sink = AsrDiagnosticSink::new_at(&paths, 1_800_000_000_000, "inv-safe");
        sink.fallback_line("download failed");
        sink.finish();

        assert!(log_path.is_dir());
        assert!(read_recent_records_at(&paths, 1_800_000_000_000).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn diagnostic_log_symlink_never_writes_to_an_arbitrary_target() {
        use std::os::windows::fs::symlink_file;

        let paths = runtime_paths("symlink-refusal");
        let log_path = asr_diagnostic_log_path(&paths);
        fs::create_dir_all(log_path.parent().expect("log parent")).expect("create log parent");
        let outside = paths
            .user_data_dir
            .parent()
            .expect("outside parent")
            .join("outside.txt");
        fs::write(&outside, "outside-secret").expect("write outside target");
        if symlink_file(&outside, &log_path).is_err() {
            return;
        }

        let mut sink = AsrDiagnosticSink::new_at(&paths, 1_800_000_000_000, "inv-safe");
        sink.fallback_line("safe failure");
        sink.finish();

        assert_eq!(
            fs::read_to_string(outside).expect("read outside target"),
            "outside-secret"
        );
    }

    #[test]
    fn concurrent_finishes_do_not_lose_invocations() {
        let paths = runtime_paths("concurrent-finish");
        let now = 1_800_000_000_000_u64;
        let handles = (0..8)
            .map(|index| {
                let paths = paths.clone();
                std::thread::spawn(move || {
                    let mut sink = AsrDiagnosticSink::new_at(&paths, now, &format!("inv-{index}"));
                    sink.fallback_line(&format!("safe failure {index}"));
                    sink.finish();
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().expect("diagnostic writer thread");
        }

        let records = read_recent_records_at(&paths, now);
        assert_eq!(records.len(), 8);
        for index in 0..8 {
            assert!(
                records
                    .iter()
                    .any(|record| record.invocation == format!("inv-{index}")),
                "missing invocation {index}"
            );
        }
    }

    #[test]
    fn structured_dto_rejects_invalid_pairs_and_optional_fields() {
        assert!(ValidatedDiagnosticEvent::new(
            DiagnosticPhase::Preparing,
            DiagnosticCategory::Network,
            DiagnosticCode::DiskFull,
        )
        .is_err());
        let network = ValidatedDiagnosticEvent::new(
            DiagnosticPhase::Preparing,
            DiagnosticCategory::Network,
            DiagnosticCode::ConnectionFailed,
        )
        .expect("network event");
        assert!(network.with_http_status(503).is_err());
        let http = ValidatedDiagnosticEvent::new(
            DiagnosticPhase::ArchiveDownload,
            DiagnosticCategory::Http,
            DiagnosticCode::HttpStatusFailed,
        )
        .expect("http event");
        assert!(http.with_http_status(503).is_ok());
    }

    #[test]
    fn sanitizer_replaces_hostile_values_with_fixed_tokens() {
        let hostile = concat!(
            "Traceback File C:\\Users\\alice\\AppData\\Local\\com.frameq.desktop\\logs\\x.py ",
            "UNC=\\\\workstation\\share\\secret POSIX=/home/alice/private HOME=~/private ",
            "user=alice hostname=DESKTOP-SECRET ip=192.168.1.42 ipv6=2001:db8::1 ",
            "email=alice@example.com url=https://alice:pw@example.com/model?q=secret ",
            "proxy=http://proxy-user:proxy-pass@proxy.local:8080 TOKEN=token-secret ",
            "Authorization: Bearer bearer-secret Cookie: sid=cookie-secret API_KEY=key-secret ",
            "task_id=20260810-120000-private-abcdef0123456789 ",
            "opaque=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef control=\u{0007}\u{001b}[31m"
        );

        let sanitized = sanitize_fallback_line(hostile);

        for secret in [
            "alice",
            "workstation",
            "secret",
            "private",
            "DESKTOP-SECRET",
            "192.168.1.42",
            "2001:db8::1",
            "example.com",
            "proxy-user",
            "proxy-pass",
            "proxy.local",
            "token-secret",
            "bearer-secret",
            "cookie-secret",
            "key-secret",
            "20260810-120000-private-abcdef0123456789",
            "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef",
            "x.py",
        ] {
            assert!(!sanitized.contains(secret), "leaked hostile seed: {secret}");
        }
        for replacement in [
            "[traceback]",
            "[path]",
            "[assignment]",
            "[url]",
            "[credential]",
            "[identifier]",
            "[opaque]",
            "[control]",
        ] {
            assert!(
                sanitized.contains(replacement),
                "missing fixed replacement: {replacement}; got {sanitized}"
            );
        }
        assert!(!sanitized.contains('\n'));
        assert!(!sanitized.contains('\r'));
        assert!(sanitized.chars().count() <= MAX_PAYLOAD_CHARS);
    }

    #[test]
    fn multiline_traceback_never_survives_as_multiline_or_raw_content() {
        let sanitized = sanitize_fallback_line(
            "Traceback (most recent call last):\n  File \"/Users/alice/app.py\", line 1\nRuntimeError: token=top-secret",
        );

        assert!(!sanitized.contains("alice"));
        assert!(!sanitized.contains("app.py"));
        assert!(!sanitized.contains("top-secret"));
        assert!(!sanitized.contains('\n'));
        assert!(sanitized.contains("[traceback]"));
        assert!(sanitized.contains("[path]"));
        assert!(sanitized.contains("[credential]") || sanitized.contains("[assignment]"));
    }

    #[test]
    fn sanitizer_handles_compact_headers_and_label_value_identities() {
        let sanitized = sanitize_fallback_line(
            "Authorization:Bearer compact-secret Cookie:SID=cookie-secret username: alice hostname: DESKTOP-PRIVATE alice@example.com 10.0.0.8 [2001:db8::8]",
        );

        for secret in [
            "compact-secret",
            "cookie-secret",
            "alice",
            "DESKTOP-PRIVATE",
            "example.com",
            "10.0.0.8",
            "2001:db8::8",
        ] {
            assert!(
                !sanitized.contains(secret),
                "leaked compact hostile seed: {secret}; got {sanitized}"
            );
        }
        assert!(sanitized.contains("[credential]"));
        assert!(sanitized.contains("[identity]"));
        assert!(sanitized.contains("[email]"));
        assert!(sanitized.contains("[ip]"));
    }

    #[test]
    fn sanitizer_is_idempotent_for_fixed_replacement_tokens() {
        let fixed = "[traceback] [path] [assignment] [url] [credential] [identifier] [opaque] [control] [identity] [email] [ip] [empty]";

        assert_eq!(sanitize_fallback_line(fixed), fixed);
    }

    #[cfg(windows)]
    #[test]
    fn exclusively_locked_prior_file_does_not_escape_finish() {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;

        let paths = runtime_paths("locked-neutral");
        let log_path = asr_diagnostic_log_path(&paths);
        fs::create_dir_all(log_path.parent().expect("log parent")).expect("create log parent");
        let locked = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&log_path)
            .expect("lock diagnostic log");

        let mut sink = AsrDiagnosticSink::new_at(&paths, 1_800_000_000_000, "inv-safe");
        sink.fallback_line("safe failure");
        sink.finish();

        drop(locked);
        assert!(log_path.is_file());
    }

    fn sample_event() -> ValidatedDiagnosticEvent {
        ValidatedDiagnosticEvent::new(
            DiagnosticPhase::PrimaryModel,
            DiagnosticCategory::Network,
            DiagnosticCode::ConnectionTimeout,
        )
        .expect("valid category and code")
        .with_exception_type("TimeoutError")
        .expect("valid exception type")
        .with_os_error_code(10060)
        .expect("valid os code")
    }

    fn runtime_paths(name: &str) -> RuntimePaths {
        let root = temp_dir(name);
        RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("app-data"),
        }
    }

    fn write_raw_lines(paths: &RuntimePaths, lines: &[String]) {
        let path = asr_diagnostic_log_path(paths);
        fs::create_dir_all(path.parent().expect("log parent")).expect("create log parent");
        fs::write(path, lines.join("\n") + "\n").expect("write fixture log");
    }

    fn record_line(utc_ms: u64, invocation: &str, kind: &str, payload: &str) -> String {
        serde_json::json!({
            "v": 1,
            "utc_ms": utc_ms,
            "invocation": invocation,
            "kind": kind,
            "payload": payload,
            "count": 1,
            "truncated": false,
        })
        .to_string()
    }

    fn temp_dir(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("frameq-task3-{test_name}-{unique}"));
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }
}
