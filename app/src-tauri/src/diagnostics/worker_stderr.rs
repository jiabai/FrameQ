use super::append_desktop_log;
use crate::atomic_files::atomic_write;
use crate::runtime::ASR_DIAGNOSTIC_LOG_FILE_NAME;
use crate::{RuntimePaths, DESKTOP_LOG_DIR_NAME};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub(crate) const MAX_PAYLOAD_CHARS: usize = 1_000;
pub(crate) const FALLBACK_LINE_LIMIT: usize = 200;
pub(crate) const MAX_RECORDS_PER_INVOCATION: usize = 256;
pub(crate) const MAX_FALLBACK_SCAN_CHARS: usize = 4_096;
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
    pub(crate) fn parse_json(value: &str) -> Result<Self, ()> {
        let wire = serde_json::from_str::<DiagnosticEventWire>(value).map_err(|_| ())?;
        let event = Self {
            version: wire.version,
            operation: wire.operation,
            phase: wire.phase,
            category: wire.category,
            code: wire.code,
            exception_type: wire.exception_type,
            http_status: wire.http_status,
            os_error_code: wire.os_error_code,
        };
        event.is_valid().then_some(event).ok_or(())
    }

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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DiagnosticEventWire {
    version: u8,
    operation: DiagnosticOperation,
    phase: DiagnosticPhase,
    category: DiagnosticCategory,
    code: DiagnosticCode,
    exception_type: Option<String>,
    http_status: Option<u16>,
    os_error_code: Option<i32>,
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
    records_truncated: bool,
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
            records_truncated: false,
            records: Vec::new(),
        }
    }

    pub(crate) fn structured(&mut self, event: &ValidatedDiagnosticEvent) {
        if self.records_truncated {
            return;
        }
        if !event.is_valid() {
            self.rejected(DiagnosticRejectionCode::InvalidEvent);
            return;
        }
        let Ok(payload) = serde_json::to_string(event) else {
            self.internal("structured_serialization_failed", false);
            return;
        };
        self.push(StoredRecordKind::Structured, payload, false);
    }

    pub(crate) fn fallback_line(&mut self, line: &str) {
        if self.records_truncated {
            return;
        }
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
        if self.records_truncated {
            return;
        }
        self.push(
            StoredRecordKind::Rejected,
            code.payload().to_string(),
            false,
        );
    }

    pub(crate) fn finish(self) {
        if persist_records(&self.paths, self.utc_ms, self.records).is_err()
            && safe_asr_diagnostic_log_path(&self.paths).is_ok()
        {
            let _ = append_desktop_log(&self.paths, WRITE_FAILURE_EVENT, WRITE_FAILURE_DETAIL);
        }
    }

    fn internal(&mut self, payload: &str, truncated: bool) {
        if self.records_truncated {
            return;
        }
        self.push(StoredRecordKind::Internal, payload.to_string(), truncated);
    }

    fn push(&mut self, kind: StoredRecordKind, payload: String, already_truncated: bool) {
        if self.records_truncated {
            return;
        }
        let (payload, cap_truncated) = truncate_chars(&payload, MAX_PAYLOAD_CHARS);
        if let Some(previous) = self.records.last_mut() {
            if previous.kind == kind && previous.payload == payload {
                previous.count = previous.count.saturating_add(1);
                previous.truncated |= already_truncated || cap_truncated;
                return;
            }
        }
        if self.records.len() >= MAX_RECORDS_PER_INVOCATION.saturating_sub(1) {
            self.records_truncated = true;
            if self.records.len() < MAX_RECORDS_PER_INVOCATION {
                self.records.push(StoredDiagnosticRecord {
                    version: RECORD_VERSION,
                    utc_ms: self.utc_ms,
                    invocation: self.invocation.clone(),
                    kind: StoredRecordKind::Internal,
                    payload: "record_limit_reached".to_string(),
                    count: 1,
                    truncated: true,
                });
            }
            return;
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
    persist_records_using(paths, now_ms, pending, |path, bytes| {
        atomic_write(path, bytes).map_err(|_| ())
    })
}

fn persist_records_using<F>(
    paths: &RuntimePaths,
    now_ms: u64,
    pending: Vec<StoredDiagnosticRecord>,
    writer: F,
) -> Result<(), ()>
where
    F: FnOnce(&Path, &[u8]) -> Result<(), ()>,
{
    let _guard = STORE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = safe_asr_diagnostic_log_path(paths)?;
    let mut records = read_valid_records(path.clone(), now_ms).unwrap_or_default();
    records.extend(pending);
    records.sort_by_key(|record| record.utc_ms);

    let lines = records
        .into_iter()
        .filter_map(|record| serde_json::to_string(&record).ok())
        .collect::<Vec<_>>();
    let start = bounded_suffix_start(&lines, ASR_DIAGNOSTIC_MAX_BYTES);
    let selected = &lines[start..];
    let mut bytes = Vec::with_capacity(serialized_lines_len(selected));
    for line in selected {
        bytes.extend_from_slice(line.as_bytes());
        bytes.push(b'\n');
    }
    writer(&path, &bytes)
}

fn bounded_suffix_start(lines: &[String], max_bytes: usize) -> usize {
    let mut total = 0_usize;
    for (index, line) in lines.iter().enumerate().rev() {
        let line_bytes = line.len().saturating_add(1);
        if total.saturating_add(line_bytes) > max_bytes {
            return index + 1;
        }
        total += line_bytes;
    }
    0
}

fn safe_asr_diagnostic_log_path(paths: &RuntimePaths) -> Result<PathBuf, ()> {
    if let Ok(metadata) = fs::symlink_metadata(&paths.user_data_dir) {
        if !metadata.is_dir() || metadata_is_reparse_point(&metadata) {
            return Err(());
        }
    }
    fs::create_dir_all(&paths.user_data_dir).map_err(|_| ())?;
    let user_data_metadata = fs::symlink_metadata(&paths.user_data_dir).map_err(|_| ())?;
    if !user_data_metadata.is_dir() || metadata_is_reparse_point(&user_data_metadata) {
        return Err(());
    }
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
    let metadata = fs::symlink_metadata(&path).map_err(|_| ())?;
    if !metadata.is_file()
        || metadata_is_reparse_point(&metadata)
        || metadata.len() > ASR_DIAGNOSTIC_MAX_BYTES as u64
    {
        return Err(());
    }
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
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
            let event = ValidatedDiagnosticEvent::parse_json(&record.payload).ok()?;
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
                "fallback_limit_reached"
                    | "structured_serialization_failed"
                    | "record_limit_reached"
            ) {
                return None;
            }
        }
    }
    Some(record)
}

fn valid_invocation_token(value: &str) -> bool {
    value.len() == 20
        && value.starts_with("inv-")
        && value[4..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
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
    let mut input_chars = line.chars();
    let scanned = input_chars
        .by_ref()
        .take(MAX_FALLBACK_SCAN_CHARS)
        .collect::<String>();
    let scan_truncated = input_chars.next().is_some();
    let lower_line = scanned.to_ascii_lowercase();
    let had_traceback = (lower_line.contains("traceback") && !lower_line.contains("[traceback]"))
        || scanned
            .lines()
            .any(|value| value.trim_start().starts_with("File \""));
    if had_traceback {
        return fixed_line_replacement("[traceback]", scan_truncated);
    }
    if contains_exception_line(&scanned) {
        return fixed_line_replacement("[exception]", scan_truncated);
    }

    let had_control = scanned
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'));
    let normalized = scanned
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
    if scan_truncated {
        output.push("[truncated]".to_string());
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
        } else if looks_like_hostname(token) {
            output.push("[host]".to_string());
        } else if looks_task_identifier(token) {
            output.push("[identifier]".to_string());
        } else if looks_opaque(token) {
            output.push("[opaque]".to_string());
        } else if lower == "traceback" {
            continue;
        } else if let Some(safe_word) = safe_fallback_word(&lower) {
            output.push(safe_word.to_string());
        } else {
            output.push("[text]".to_string());
        }
    }

    output.dedup();
    let collapsed = output.join(" ");
    let (bounded, payload_truncated) = truncate_chars(&collapsed, MAX_PAYLOAD_CHARS);
    if bounded.is_empty() {
        ("[empty]".to_string(), scan_truncated || payload_truncated)
    } else {
        (bounded, scan_truncated || payload_truncated)
    }
}

fn fixed_line_replacement(marker: &str, truncated: bool) -> (String, bool) {
    if truncated {
        (format!("{marker} [truncated]"), true)
    } else {
        (marker.to_string(), false)
    }
}

fn contains_exception_line(value: &str) -> bool {
    value.lines().any(|line| {
        let head = line
            .trim_start()
            .split(|character: char| {
                character == ':' || character == '(' || character.is_whitespace()
            })
            .next()
            .unwrap_or_default();
        let class_name = head.rsplit('.').next().unwrap_or_default().trim();
        let lower = class_name.to_ascii_lowercase();
        (lower.ends_with("error") || lower.ends_with("exception"))
            && !class_name.is_empty()
            && class_name.len() <= 80
            && class_name
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
    })
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
            | "[exception]"
            | "[host]"
            | "[text]"
            | "[truncated]"
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

fn looks_like_hostname(value: &str) -> bool {
    let trimmed = value.trim_matches(|character: char| {
        !character.is_ascii_alphanumeric() && character != '.' && character != '-'
    });
    let labels = trimmed.split('.').collect::<Vec<_>>();
    labels.len() >= 2
        && labels.iter().all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '-')
                && !label.starts_with('-')
                && !label.ends_with('-')
        })
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

fn safe_fallback_word(value: &str) -> Option<&'static str> {
    let candidate = value.trim_matches(|character: char| {
        !character.is_ascii_alphanumeric() && character != '_' && character != '-'
    });
    match candidate {
        "download" => Some("download"),
        "model" => Some("model"),
        "archive" => Some("archive"),
        "cache" => Some("cache"),
        "network" => Some("network"),
        "connection" => Some("connection"),
        "timeout" | "timed_out" => Some("timeout"),
        "failed" => Some("failed"),
        "failure" => Some("failure"),
        "permission" => Some("permission"),
        "denied" => Some("denied"),
        "disk" => Some("disk"),
        "full" => Some("full"),
        "checksum" => Some("checksum"),
        "invalid" => Some("invalid"),
        "dependency" => Some("dependency"),
        "unavailable" => Some("unavailable"),
        "dns" => Some("dns"),
        "tls" => Some("tls"),
        "proxy" => Some("proxy"),
        "http" => Some("http"),
        "preparing" => Some("preparing"),
        "primary_model" => Some("primary_model"),
        "vad_model" => Some("vad_model"),
        "bpe_model" => Some("bpe_model"),
        "archive_download" => Some("archive_download"),
        "archive_validate" => Some("archive_validate"),
        "cache_validate" => Some("cache_validate"),
        "cache_promote" => Some("cache_promote"),
        "modelscope" => Some("modelscope"),
        "requests" => Some("requests"),
        "urllib" => Some("urllib"),
        "ssl" => Some("ssl"),
        "httpx" => Some("httpx"),
        "aiohttp" => Some("aiohttp"),
        "onnxruntime" => Some("onnxruntime"),
        "funasr" => Some("funasr"),
        _ => None,
    }
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
        asr_diagnostic_log_path, read_recent_records_at, sanitize_fallback_line,
        sanitize_fallback_line_bounded, AsrDiagnosticSink, DiagnosticCategory, DiagnosticCode,
        DiagnosticOperation, DiagnosticPhase, DiagnosticRejectionCode, StoredRecordKind,
        ValidatedDiagnosticEvent, ASR_DIAGNOSTIC_MAX_BYTES, FALLBACK_LINE_LIMIT,
        MAX_FALLBACK_SCAN_CHARS, MAX_PAYLOAD_CHARS, MAX_RECORDS_PER_INVOCATION, RETENTION_MILLIS,
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
                record_line(
                    now - RETENTION_MILLIS - 1,
                    "inv-0000000000000001",
                    "fallback",
                    "expired",
                ),
                record_line(
                    now - RETENTION_MILLIS,
                    "inv-0000000000000002",
                    "fallback",
                    "kept",
                ),
                "not-json".to_string(),
            ],
        );
        let mut sink = AsrDiagnosticSink::new_at(&paths, now, "inv-0000000000000003");
        sink.structured(&sample_event());
        sink.finish();

        let records = read_recent_records_at(&paths, now);
        assert_eq!(records.len(), 2);
        assert!(records
            .iter()
            .all(|record| record.utc_ms >= now - RETENTION_MILLIS));
        assert!(records.iter().any(|record| {
            record.invocation == "inv-0000000000000003"
                && record.kind == StoredRecordKind::Structured
        }));
        let raw = fs::read_to_string(asr_diagnostic_log_path(&paths)).expect("read log");
        assert!(!raw.contains("expired"));
        assert!(!raw.contains("not-json"));
    }

    #[test]
    fn caps_payloads_and_collapses_adjacent_duplicates() {
        let paths = runtime_paths("bounded-deduplicated");
        let mut sink = AsrDiagnosticSink::new_at(&paths, 1_800_000_000_000, "inv-0123456789abcdef");
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
        let mut sink = AsrDiagnosticSink::new_at(&paths, 1_800_000_000_000, "inv-0123456789abcdef");
        for index in 0..FALLBACK_LINE_LIMIT + 10 {
            sink.fallback_line(&format!("failure number {index}"));
        }
        sink.finish();

        let records = read_recent_records_at(&paths, 1_800_000_000_000);
        let fallback_records = records
            .iter()
            .filter(|record| record.kind == StoredRecordKind::Fallback)
            .collect::<Vec<_>>();
        assert_eq!(fallback_records.len(), 1);
        assert_eq!(fallback_records[0].count as usize, FALLBACK_LINE_LIMIT);
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
        let line = record_line(now, "inv-0000000000000004", "fallback", &payload);
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

        let mut sink = AsrDiagnosticSink::new_at(&paths, now, "inv-0123456789abcdef");
        sink.fallback_line("latest safe failure");
        sink.finish();

        let bytes = fs::read(asr_diagnostic_log_path(&paths)).expect("read bounded log");
        assert!(bytes.len() <= ASR_DIAGNOSTIC_MAX_BYTES);
        let text = String::from_utf8(bytes).expect("utf8 log");
        assert!(!text.contains("corrupt-secret-prior-line"));
        assert!(text.contains("failure"));
        assert!(!text.contains("latest safe"));
    }

    #[test]
    fn rewrites_parseable_prior_records_through_the_current_sanitizer() {
        let paths = runtime_paths("resanitize-prior");
        let now = 1_800_000_000_000_u64;
        write_raw_lines(
            &paths,
            &[record_line(
                now,
                "inv-0000000000000005",
                "fallback",
                "failed at C:\\Users\\alice\\private token=prior-secret",
            )],
        );

        let sink = AsrDiagnosticSink::new_at(&paths, now, "inv-0123456789abcdef");
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

        let mut sink = AsrDiagnosticSink::new_at(&paths, 1_800_000_000_000, "inv-0123456789abcdef");
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

        let mut sink = AsrDiagnosticSink::new_at(&paths, 1_800_000_000_000, "inv-0123456789abcdef");
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
                    let mut sink =
                        AsrDiagnosticSink::new_at(&paths, now, &format!("inv-{index:016x}"));
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
                    .any(|record| record.invocation == format!("inv-{index:016x}")),
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
    fn structured_defensively_rejects_forged_invalid_events_before_storage() {
        let paths = runtime_paths("forged-structured-events");
        let now = 1_800_000_000_000_u64;
        let invalid_exception = ValidatedDiagnosticEvent {
            version: 1,
            operation: DiagnosticOperation::DownloadAsrModel,
            phase: DiagnosticPhase::Preparing,
            category: DiagnosticCategory::Network,
            code: DiagnosticCode::ConnectionFailed,
            exception_type: Some("C:\\Users\\alice\\private".to_string()),
            http_status: None,
            os_error_code: None,
        };
        let invalid_combination = ValidatedDiagnosticEvent {
            version: 1,
            operation: DiagnosticOperation::DownloadAsrModel,
            phase: DiagnosticPhase::ArchiveDownload,
            category: DiagnosticCategory::Network,
            code: DiagnosticCode::ConnectionFailed,
            exception_type: None,
            http_status: Some(503),
            os_error_code: None,
        };
        let mut sink = AsrDiagnosticSink::new_at(&paths, now, "inv-0123456789abcdef");

        sink.structured(&invalid_exception);
        sink.structured(&invalid_combination);
        sink.finish();

        let records = read_recent_records_at(&paths, now);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].kind, StoredRecordKind::Rejected);
        assert_eq!(records[0].payload, "invalid_event");
        assert_eq!(records[0].count, 2);
        let raw = fs::read_to_string(asr_diagnostic_log_path(&paths)).expect("read log");
        assert!(!raw.contains("alice"));
        assert!(!raw.contains("http_status"));
    }

    #[test]
    fn stored_structured_payloads_can_only_enter_through_the_private_strict_parser() {
        let paths = runtime_paths("strict-stored-structured-parser");
        let now = 1_800_000_000_000_u64;
        let forged_payload = serde_json::json!({
            "version": 1,
            "operation": "download_asr_model",
            "phase": "preparing",
            "category": "network",
            "code": "connection_failed",
            "exception_type": "C:\\Users\\alice\\private",
            "http_status": 503,
            "message": "reviewer-secret",
        })
        .to_string();
        write_raw_lines(
            &paths,
            &[record_line(
                now,
                "inv-0123456789abcdef",
                "structured",
                &forged_payload,
            )],
        );

        assert!(read_recent_records_at(&paths, now).is_empty());
    }

    #[test]
    fn oversized_prior_log_is_rejected_before_parsing_and_pending_replaces_it() {
        let paths = runtime_paths("oversized-prior");
        let now = 1_800_000_000_000_u64;
        let log_path = asr_diagnostic_log_path(&paths);
        fs::create_dir_all(log_path.parent().expect("log parent")).expect("create log parent");
        fs::write(&log_path, vec![b'x'; ASR_DIAGNOSTIC_MAX_BYTES + 1])
            .expect("write oversized prior log");

        assert!(super::read_valid_records(log_path.clone(), now).is_err());
        let mut sink = AsrDiagnosticSink::new_at(&paths, now, "inv-0123456789abcdef");
        sink.fallback_line("download failure");
        sink.finish();

        let raw = fs::read_to_string(log_path).expect("read replaced log");
        assert!(raw.contains("download failure"));
        assert!(raw.len() < ASR_DIAGNOSTIC_MAX_BYTES);
        assert!(!raw.contains(&"x".repeat(1_024)));
    }

    #[test]
    fn invocation_tokens_must_match_the_exact_random_correlation_shape() {
        let paths = runtime_paths("strict-invocation-token");
        let now = 1_800_000_000_000_u64;
        write_raw_lines(
            &paths,
            &[
                record_line(now, "alice-private-task-123", "fallback", "failure"),
                record_line(now, "inv-0123456789ABCDEF", "fallback", "failure"),
                record_line(now, "inv-0123456789abcdef", "fallback", "download failure"),
            ],
        );

        let records = read_recent_records_at(&paths, now);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].invocation, "inv-0123456789abcdef");
    }

    #[test]
    fn linked_user_data_or_logs_directory_is_rejected() {
        let root = temp_dir("linked-directories");
        let external_user_data = root.join("external-user-data");
        fs::create_dir_all(&external_user_data).expect("create external user data");
        let linked_user_data = root.join("linked-user-data");
        if create_directory_link(&external_user_data, &linked_user_data).is_ok() {
            let linked_paths = RuntimePaths {
                resource_dir: root.join("resources"),
                user_data_dir: linked_user_data,
            };
            let mut sink =
                AsrDiagnosticSink::new_at(&linked_paths, 1_800_000_000_000, "inv-0123456789abcdef");
            sink.fallback_line("download failure");
            sink.finish();
            assert!(!external_user_data.join("logs").exists());
        }

        let real_user_data = root.join("real-user-data");
        fs::create_dir_all(&real_user_data).expect("create real user data");
        let external_logs = root.join("external-logs");
        fs::create_dir_all(&external_logs).expect("create external logs");
        if create_directory_link(&external_logs, &real_user_data.join("logs")).is_ok() {
            let real_paths = RuntimePaths {
                resource_dir: root.join("resources"),
                user_data_dir: real_user_data,
            };
            let mut sink =
                AsrDiagnosticSink::new_at(&real_paths, 1_800_000_000_000, "inv-0123456789abcdef");
            sink.fallback_line("download failure");
            sink.finish();
            assert!(!external_logs.join("asr-model-download.log").exists());
        }
    }

    #[test]
    fn injected_atomic_install_failure_preserves_the_prior_log() {
        let paths = runtime_paths("atomic-failure-preserves-old");
        let now = 1_800_000_000_000_u64;
        let prior = record_line(now, "inv-0000000000000001", "fallback", "download failure") + "\n";
        let log_path = asr_diagnostic_log_path(&paths);
        fs::create_dir_all(log_path.parent().expect("log parent")).expect("create log parent");
        fs::write(&log_path, &prior).expect("write prior log");
        let pending = vec![super::StoredDiagnosticRecord {
            version: super::RECORD_VERSION,
            utc_ms: now,
            invocation: "inv-0000000000000002".to_string(),
            kind: StoredRecordKind::Fallback,
            payload: "network failure".to_string(),
            count: 1,
            truncated: false,
        }];

        let result = super::persist_records_using(&paths, now, pending, |_path, _bytes| Err(()));

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(log_path).expect("read prior log"), prior);
    }

    #[test]
    fn many_legal_records_are_parsed_without_front_removal_behavior() {
        let paths = runtime_paths("many-legal-records");
        let now = 1_800_000_000_000_u64;
        let lines = (0..2_500)
            .map(|index| {
                record_line(
                    now,
                    &format!("inv-{index:016x}"),
                    "fallback",
                    "download failure",
                )
            })
            .collect::<Vec<_>>();
        write_raw_lines(&paths, &lines);

        let records = super::read_valid_records(asr_diagnostic_log_path(&paths), now)
            .expect("read bounded legal records");

        assert_eq!(records.len(), 2_500);
        assert_eq!(
            records.first().expect("first").invocation,
            "inv-0000000000000000"
        );
        assert_eq!(
            records.last().expect("last").invocation,
            "inv-00000000000009c3"
        );
    }

    #[test]
    fn sanitizer_replaces_hostile_values_with_fixed_tokens() {
        let hostile = concat!(
            "failure at C:\\Users\\alice\\AppData\\Local\\com.frameq.desktop\\logs\\x.py ",
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
        assert_eq!(sanitized, "[traceback]");
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
    fn sanitizer_fails_closed_for_exception_and_unknown_freeform_text() {
        let reviewer_seed = "RuntimeError: user Alice on download.internal.example exposed reviewer-secret transcript-content";
        let generic_seed =
            "download failed download.internal.example Alice reviewer-secret transcript-content";

        assert_eq!(sanitize_fallback_line(reviewer_seed), "[exception]");
        let generic = sanitize_fallback_line(generic_seed);
        assert_eq!(generic, "download failed [host] [text]");
        for forbidden in [
            "RuntimeError",
            "Alice",
            "download.internal.example",
            "reviewer-secret",
            "transcript-content",
        ] {
            assert!(!generic.contains(forbidden));
            assert!(!sanitize_fallback_line(reviewer_seed).contains(forbidden));
        }
    }

    #[test]
    fn all_sink_entry_points_share_one_hard_record_limit_and_one_marker() {
        let paths = runtime_paths("total-record-limit");
        let mut sink = AsrDiagnosticSink::new_at(&paths, 1_800_000_000_000, "inv-0123456789abcdef");
        for index in 0..400 {
            sink.structured(&sample_event());
            sink.rejected(DiagnosticRejectionCode::InvalidEvent);
            sink.internal("structured_serialization_failed", false);
            sink.fallback_line(&format!("download failure number {index}"));
        }

        assert_eq!(sink.records.len(), MAX_RECORDS_PER_INVOCATION);
        assert_eq!(
            sink.records
                .iter()
                .filter(|record| {
                    record.kind == StoredRecordKind::Internal
                        && record.payload == "record_limit_reached"
                })
                .count(),
            1
        );
        assert_eq!(
            sink.records.last().map(|record| record.payload.as_str()),
            Some("record_limit_reached")
        );
        sink.finish();
        let persisted = read_recent_records_at(&paths, 1_800_000_000_000);
        assert_eq!(persisted.len(), MAX_RECORDS_PER_INVOCATION);
        assert_eq!(
            persisted
                .iter()
                .filter(|record| record.payload == "record_limit_reached")
                .count(),
            1
        );
    }

    #[test]
    fn fallback_scan_stops_before_late_exception_content() {
        let mut input = "download failure ".repeat(MAX_FALLBACK_SCAN_CHARS);
        input.push_str("Traceback RuntimeError: late-reviewer-secret");

        let (sanitized, truncated) = sanitize_fallback_line_bounded(&input);

        assert!(truncated);
        assert!(sanitized.chars().count() <= MAX_PAYLOAD_CHARS);
        assert!(sanitized.contains("[truncated]"));
        assert!(!sanitized.contains("[traceback]"));
        assert!(!sanitized.contains("RuntimeError"));
        assert!(!sanitized.contains("late-reviewer-secret"));
    }

    #[test]
    fn dotted_exception_class_line_is_replaced_whole() {
        let seed = "requests.exceptions.ConnectionError(host='download.internal.example', token='reviewer-secret')";

        assert_eq!(sanitize_fallback_line(seed), "[exception]");
    }

    #[test]
    fn sanitizer_is_idempotent_for_fixed_replacement_tokens() {
        let fixed = "[traceback] [exception] [path] [assignment] [url] [credential] [identifier] [opaque] [control] [identity] [host] [email] [ip] [text] [truncated] [empty]";

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

        let mut sink = AsrDiagnosticSink::new_at(&paths, 1_800_000_000_000, "inv-0123456789abcdef");
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

    #[cfg(windows)]
    fn create_directory_link(
        target: &std::path::Path,
        link: &std::path::Path,
    ) -> std::io::Result<()> {
        std::os::windows::fs::symlink_dir(target, link)
    }

    #[cfg(not(windows))]
    fn create_directory_link(
        target: &std::path::Path,
        link: &std::path::Path,
    ) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }
}
