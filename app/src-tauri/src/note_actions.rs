use crate::{history, resolve_runtime_paths, task_manifest};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const REQUEST_INVALID: &str = "NOTE_REQUEST_INVALID";
const UNAVAILABLE: &str = "NOTE_UNAVAILABLE";
const BUSY: &str = "NOTE_BUSY";
const SOURCE_UNAVAILABLE: &str = "NOTE_SOURCE_UNAVAILABLE";
const SOURCE_OPEN_FAILED: &str = "NOTE_SOURCE_OPEN_FAILED";
const INFO_INVALID: &str = "NOTE_INFO_INVALID";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskRequest {
    task_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PinRequest {
    task_id: String,
    pinned: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RenameRequest {
    task_id: String,
    title: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct NoteMutationResult {
    pub(crate) task_id: String,
    pub(crate) note_metadata: task_manifest::NoteMetadataView,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct NoteSourceOpenResult {
    pub(crate) task_id: String,
    pub(crate) opened: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct NoteInfoView {
    pub(crate) task_id: String,
    pub(crate) source: task_manifest::TaskSourceSummary,
    pub(crate) created_at: String,
    pub(crate) status: String,
    pub(crate) note_title: Option<task_manifest::NoteTitle>,
    pub(crate) note_metadata: Option<task_manifest::NoteMetadataView>,
    pub(crate) note_metadata_error: Option<String>,
    pub(crate) transcript: Option<task_manifest::TranscriptMetadata>,
    pub(crate) artifact_types: Vec<String>,
    pub(crate) text_preview: String,
}

#[tauri::command]
pub(crate) fn set_note_pinned(
    app: AppHandle,
    request: serde_json::Value,
) -> Result<NoteMutationResult, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let request: PinRequest = parse_request(request)?;
    let paths = resolve_runtime_paths(&app).map_err(|_| UNAVAILABLE.to_string())?;
    set_note_pinned_from_paths(&paths, request)
}

#[tauri::command]
pub(crate) fn rename_note(
    app: AppHandle,
    request: serde_json::Value,
) -> Result<NoteMutationResult, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let request: RenameRequest = parse_request(request)?;
    let paths = resolve_runtime_paths(&app).map_err(|_| UNAVAILABLE.to_string())?;
    rename_note_from_paths(&paths, request)
}

#[tauri::command]
pub(crate) fn get_note_info(
    app: AppHandle,
    request: serde_json::Value,
) -> Result<NoteInfoView, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let request: TaskRequest = parse_request(request)?;
    let paths = resolve_runtime_paths(&app).map_err(|_| UNAVAILABLE.to_string())?;
    note_info_from_task(open_task_from_paths(&paths, &request.task_id)?)
}

#[tauri::command]
pub(crate) fn open_note_source(
    app: AppHandle,
    request: serde_json::Value,
) -> Result<NoteSourceOpenResult, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let request: TaskRequest = parse_request(request)?;
    let paths = resolve_runtime_paths(&app).map_err(|_| UNAVAILABLE.to_string())?;
    let task = open_task_from_paths(&paths, &request.task_id)?;
    let url = canonical_source(&task)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| SOURCE_OPEN_FAILED.to_string())?;
    drop(task);
    Ok(NoteSourceOpenResult {
        task_id: request.task_id,
        opened: true,
    })
}

fn parse_request<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|_| REQUEST_INVALID.to_string())
}

fn guard_note_task(paths: &crate::RuntimePaths, task_id: &str) -> Result<(), String> {
    crate::history_deletion::guard_pending_task(paths, task_id).map_err(|error| {
        if error == "HISTORY_DELETE_CLEANUP_PENDING" {
            BUSY
        } else {
            "NOTE_UNSAFE_STORAGE"
        }
        .to_string()
    })
}

fn open_task_from_paths(
    paths: &crate::RuntimePaths,
    task_id: &str,
) -> Result<task_manifest::SupportedTask, String> {
    guard_note_task(paths, task_id)?;
    let output_root = task_manifest::configured_output_root(paths)
        .map_err(|_| UNAVAILABLE.to_string())?;
    let task = open_task(&output_root, task_id)?;
    guard_note_task(paths, task_id)?;
    Ok(task)
}

fn open_task(output_root: &Path, task_id: &str) -> Result<task_manifest::SupportedTask, String> {
    if task_id.is_empty()
        || task_id.len() > 240
        || !task_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(REQUEST_INVALID.to_string());
    }
    task_manifest::SupportedTask::open(output_root, task_id).map_err(|error| {
        if error == "Task is busy. Try again shortly." {
            BUSY
        } else {
            UNAVAILABLE
        }
        .to_string()
    })
}

#[cfg(test)]
fn set_note_pinned_from_root(
    output_root: &Path,
    request: PinRequest,
) -> Result<NoteMutationResult, String> {
    set_note_pinned_on_task(open_task(output_root, &request.task_id)?, request)
}

fn set_note_pinned_from_paths(
    paths: &crate::RuntimePaths,
    request: PinRequest,
) -> Result<NoteMutationResult, String> {
    set_note_pinned_on_task(open_task_from_paths(paths, &request.task_id)?, request)
}

fn set_note_pinned_on_task(
    task: task_manifest::SupportedTask,
    request: PinRequest,
) -> Result<NoteMutationResult, String> {
    let mut task = task.into_edit_session();
    let note_metadata = task
        .set_note_pinned(request.pinned)
        .map_err(|error| error.code().to_string())?;
    Ok(NoteMutationResult {
        task_id: request.task_id,
        note_metadata,
    })
}

#[cfg(test)]
fn rename_note_from_root(
    output_root: &Path,
    request: RenameRequest,
) -> Result<NoteMutationResult, String> {
    rename_note_on_task(open_task(output_root, &request.task_id)?, request)
}

fn rename_note_from_paths(
    paths: &crate::RuntimePaths,
    request: RenameRequest,
) -> Result<NoteMutationResult, String> {
    rename_note_on_task(open_task_from_paths(paths, &request.task_id)?, request)
}

fn rename_note_on_task(
    task: task_manifest::SupportedTask,
    request: RenameRequest,
) -> Result<NoteMutationResult, String> {
    let mut task = task.into_edit_session();
    let note_metadata = task
        .set_note_display_title(&request.title)
        .map_err(|error| error.code().to_string())?;
    Ok(NoteMutationResult {
        task_id: request.task_id,
        note_metadata,
    })
}

#[cfg(test)]
fn get_note_info_from_root(output_root: &Path, task_id: &str) -> Result<NoteInfoView, String> {
    note_info_from_task(open_task(output_root, task_id)?)
}

fn note_info_from_task(task: task_manifest::SupportedTask) -> Result<NoteInfoView, String> {
    if matches!(task.source(), task_manifest::TaskSourceSummary::Url { .. }) {
        canonical_source(&task)?;
    }
    if !["completed", "partial_completed", "failed"].contains(&task.status()) {
        return Err(INFO_INVALID.to_string());
    }
    let (note_metadata, note_metadata_error) = history::note_metadata_projection(&task);
    let note_title = task.note_title();
    let status = if note_title
        .as_ref()
        .is_some_and(|title| title.status != task_manifest::NoteTitleStatus::Completed)
    {
        "partial_completed"
    } else {
        task.status()
    }
    .to_string();
    let available = task.existing_artifacts();
    const USER_ARTIFACTS: &[&str] = &[
        "video",
        "audio",
        "transcript_txt",
        "transcript_md",
        "summary",
        "mindmap",
        "insights",
        "insights_md",
        "dissection",
        "dissection_md",
        "draft",
    ];
    let artifact_types = USER_ARTIFACTS
        .iter()
        .filter(|key| {
            available.get(**key).is_some_and(|relative| {
                std::fs::symlink_metadata(task.task_dir().join(relative)).is_ok_and(|metadata| {
                    metadata.is_file() && !task_manifest::is_link_or_reparse_point(&metadata)
                })
            })
        })
        .map(|key| key.to_string())
        .collect();
    Ok(NoteInfoView {
        task_id: task.task_id().to_string(),
        source: task.source(),
        created_at: task.created_at().to_string(),
        status,
        note_title,
        note_metadata,
        note_metadata_error,
        transcript: task.transcript_metadata(),
        artifact_types,
        text_preview: task.text_preview().to_string(),
    })
}

fn canonical_source(task: &task_manifest::SupportedTask) -> Result<String, String> {
    let identity = task
        .source_identity()
        .ok_or_else(|| SOURCE_UNAVAILABLE.to_string())?;
    if !identity.is_safe()
        || task.safe_source_url() != identity.canonical_url
        || url::Url::parse(&identity.canonical_url)
            .map_or(true, |parsed| parsed.as_str() != identity.canonical_url)
    {
        return Err(SOURCE_UNAVAILABLE.to_string());
    }
    Ok(identity.canonical_url.clone())
}

#[cfg(test)]
#[path = "note_actions_tests.rs"]
pub(crate) mod tests;
