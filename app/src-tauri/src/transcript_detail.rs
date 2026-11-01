mod audio_playback;
mod edit_storage;
mod segments;
#[cfg(test)]
mod tests;

use crate::{ensure_runtime_dirs, resolve_runtime_paths, task_manifest};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
pub(crate) struct LoadTranscriptDetailRequest {
    #[serde(alias = "taskId")]
    task_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SaveTranscriptEditRequest {
    #[serde(alias = "taskId")]
    task_id: String,
    text: String,
    #[serde(default)]
    segments: Vec<TranscriptSegmentView>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct TranscriptSegmentView {
    id: String,
    start_ms: u64,
    end_ms: u64,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    speaker: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct TranscriptDetailView {
    task_id: String,
    text: String,
    segments: Vec<TranscriptSegmentView>,
    audio_path: Option<String>,
    audio_asset_path: Option<String>,
    has_original_backup: bool,
    polished_text: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct SaveTranscriptEditResult {
    task_id: String,
    text: String,
    artifacts: HashMap<String, String>,
    has_original_backup: bool,
}

#[tauri::command]
pub(crate) fn load_transcript_detail(
    app: AppHandle,
    request: LoadTranscriptDetailRequest,
) -> Result<TranscriptDetailView, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let paths = resolve_runtime_paths(&app)?;
    crate::history_deletion::guard_pending_task(&paths, &request.task_id)?;
    ensure_runtime_dirs(&paths)?;
    load_transcript_detail_from_paths(&paths, request)
}

#[tauri::command]
pub(crate) fn save_transcript_edit(
    app: AppHandle,
    request: SaveTranscriptEditRequest,
) -> Result<SaveTranscriptEditResult, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let paths = resolve_runtime_paths(&app)?;
    crate::history_deletion::guard_pending_task(&paths, &request.task_id)?;
    ensure_runtime_dirs(&paths)?;
    save_transcript_edit_from_paths(&paths, request)
}

pub(crate) fn save_transcript_edit_from_paths(
    paths: &crate::RuntimePaths,
    request: SaveTranscriptEditRequest,
) -> Result<SaveTranscriptEditResult, String> {
    crate::history_deletion::guard_pending_task(paths, &request.task_id)?;
    let output_root = task_manifest::configured_output_root(&paths)?;
    let task = task_manifest::SupportedTask::open(&output_root, &request.task_id)?;
    crate::history_deletion::guard_pending_task(paths, &request.task_id)?;
    save_transcript_edit_to_task(task, request)
}

pub(crate) fn load_transcript_detail_from_paths(
    paths: &crate::RuntimePaths,
    request: LoadTranscriptDetailRequest,
) -> Result<TranscriptDetailView, String> {
    crate::history_deletion::guard_pending_task(paths, &request.task_id)?;
    let output_root = task_manifest::configured_output_root(paths)?;
    let task = task_manifest::SupportedTask::open(&output_root, &request.task_id)?;
    crate::history_deletion::guard_pending_task(paths, &request.task_id)?;
    load_transcript_detail_from_task(
        task,
        &paths.output_root()?,
        &paths.cache_root()?,
        request,
    )
}

#[cfg(test)]
pub(crate) fn load_transcript_detail_from_output_root(
    output_root: &Path,
    request: LoadTranscriptDetailRequest,
) -> Result<TranscriptDetailView, String> {
    load_transcript_detail_from_roots(
        output_root,
        output_root,
        &output_root.join("cache"),
        request,
    )
}

#[cfg(test)]
pub(crate) fn load_transcript_detail_from_roots(
    output_root: &Path,
    direct_audio_root: &Path,
    playback_cache_root: &Path,
    request: LoadTranscriptDetailRequest,
) -> Result<TranscriptDetailView, String> {
    let task = task_manifest::SupportedTask::open(output_root, &request.task_id)?;
    load_transcript_detail_from_task(task, direct_audio_root, playback_cache_root, request)
}

fn load_transcript_detail_from_task(
    task: task_manifest::SupportedTask,
    direct_audio_root: &Path,
    playback_cache_root: &Path,
    request: LoadTranscriptDetailRequest,
) -> Result<TranscriptDetailView, String> {
    let transcript = edit_storage::load_transcript(&task)?;
    let segments = segments::read_segments_sidecar(&task)?;
    let polished_text = edit_storage::load_polished_transcript(&task, &transcript.text);
    let audio_paths =
        audio_playback::load_audio_paths(&task, direct_audio_root, playback_cache_root)?;
    let (audio_path, audio_asset_path) = audio_paths
        .map(|paths| (Some(paths.source_path), Some(paths.asset_path)))
        .unwrap_or((None, None));

    Ok(TranscriptDetailView {
        task_id: request.task_id,
        text: transcript.text,
        segments,
        audio_path,
        audio_asset_path,
        has_original_backup: transcript.has_original_backup,
        polished_text,
    })
}

#[cfg(test)]
pub(crate) fn save_transcript_edit_to_output_root(
    output_root: &Path,
    request: SaveTranscriptEditRequest,
) -> Result<SaveTranscriptEditResult, String> {
    let task = task_manifest::SupportedTask::open(output_root, &request.task_id)?;
    save_transcript_edit_to_task(task, request)
}

fn save_transcript_edit_to_task(
    task: task_manifest::SupportedTask,
    request: SaveTranscriptEditRequest,
) -> Result<SaveTranscriptEditResult, String> {
    let saved = edit_storage::save_transcript(task, &request.text, &request.segments)?;

    Ok(SaveTranscriptEditResult {
        task_id: request.task_id,
        text: saved.text,
        artifacts: saved.artifacts,
        has_original_backup: saved.has_original_backup,
    })
}
