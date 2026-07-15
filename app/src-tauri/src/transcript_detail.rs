use crate::{ensure_runtime_dirs, resolve_runtime_paths, task_manifest, CACHE_DIR_NAME};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const TRANSCRIPT_SECTION_MARKER: &str = "## Transcript";
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
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let output_root = task_manifest::configured_output_root(&paths)?;
    load_transcript_detail_from_roots(
        &output_root,
        &paths.user_data_dir.join("outputs"),
        &paths.user_data_dir.join(CACHE_DIR_NAME),
        request,
    )
}

#[tauri::command]
pub(crate) fn save_transcript_edit(
    app: AppHandle,
    request: SaveTranscriptEditRequest,
) -> Result<SaveTranscriptEditResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let output_root = task_manifest::configured_output_root(&paths)?;
    save_transcript_edit_to_output_root(&output_root, request)
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

pub(crate) fn load_transcript_detail_from_roots(
    output_root: &Path,
    direct_audio_root: &Path,
    playback_cache_root: &Path,
    request: LoadTranscriptDetailRequest,
) -> Result<TranscriptDetailView, String> {
    let (manifest, task_dir) = task_manifest::load_task_manifest(output_root, &request.task_id)?;
    ensure_task_source_privacy_ready(&manifest)?;
    let transcript_path =
        task_manifest::required_artifact_path(&task_dir, &manifest, "transcript_txt")?;
    validate_transcript_txt(&task_dir, &transcript_path)?;
    task_manifest::validate_task_artifact_path(&task_dir, &transcript_path, "transcript_txt")?;
    reject_linked_artifact_target(&transcript_path)?;

    let text = fs::read_to_string(&transcript_path)
        .map_err(|_| "Failed to read transcript.".to_string())?
        .trim()
        .to_string();
    let segments_path = task_manifest::artifact_path(&task_dir, &manifest, "segments")?
        .unwrap_or_else(|| default_segments_path(&task_dir));
    let segments = read_segments_sidecar(&task_dir, &segments_path)?;
    let audio_paths = load_audio_paths(
        &task_dir,
        &manifest,
        direct_audio_root,
        playback_cache_root,
        &manifest.task_id,
    )?;
    let (audio_path, audio_asset_path) = audio_paths
        .map(|paths| (Some(paths.source_path), Some(paths.asset_path)))
        .unwrap_or((None, None));

    Ok(TranscriptDetailView {
        task_id: request.task_id,
        text,
        segments,
        audio_path,
        audio_asset_path,
        has_original_backup: original_backup_path(&transcript_path).is_file(),
    })
}

pub(crate) fn save_transcript_edit_to_output_root(
    output_root: &Path,
    request: SaveTranscriptEditRequest,
) -> Result<SaveTranscriptEditResult, String> {
    let text = request.text.trim();
    if text.is_empty() {
        return Err("Transcript text cannot be empty.".to_string());
    }

    let (mut manifest, task_dir) =
        task_manifest::load_task_manifest(output_root, &request.task_id)?;
    ensure_task_source_privacy_ready(&manifest)?;
    let transcript_path =
        task_manifest::required_artifact_path(&task_dir, &manifest, "transcript_txt")?;
    validate_transcript_txt(&task_dir, &transcript_path)?;
    task_manifest::validate_task_artifact_path(&task_dir, &transcript_path, "transcript_txt")?;
    reject_linked_artifact_target(&transcript_path)?;

    let md_path = task_manifest::artifact_path(&task_dir, &manifest, "transcript_md")?
        .unwrap_or_else(|| default_transcript_md_path(&task_dir));
    validate_transcript_md(&task_dir, &md_path)?;
    let segments_path = task_manifest::artifact_path(&task_dir, &manifest, "segments")?
        .unwrap_or_else(|| default_segments_path(&task_dir));
    validate_segments_path(&task_dir, &segments_path)?;

    reject_linked_artifact_target(&md_path)?;
    reject_linked_artifact_target(&segments_path)?;
    if md_path.exists() {
        task_manifest::validate_task_artifact_path(&task_dir, &md_path, "transcript_md")?;
    }
    if segments_path.exists() {
        task_manifest::validate_task_artifact_path(&task_dir, &segments_path, "segments")?;
    }

    task_manifest::ensure_artifact_parent(&task_dir, &transcript_path)?;
    task_manifest::ensure_artifact_parent(&task_dir, &md_path)?;
    task_manifest::ensure_artifact_parent(&task_dir, &segments_path)?;
    create_original_backups(&task_dir, &transcript_path, &md_path)?;

    fs::write(&transcript_path, format!("{text}\n"))
        .map_err(|_| "Failed to save transcript.".to_string())?;
    let existing_markdown = fs::read_to_string(&md_path).ok();
    fs::write(
        &md_path,
        format_transcript_markdown(existing_markdown.as_deref(), text),
    )
    .map_err(|_| "Failed to save transcript markdown.".to_string())?;

    if request.segments.is_empty() {
        if manifest.artifacts.contains_key("segments") {
            write_segments_sidecar(&segments_path, &[])?;
        }
    } else {
        write_segments_sidecar(&segments_path, &request.segments)?;
        manifest.artifacts.insert(
            "segments".to_string(),
            "transcript/segments.json".to_string(),
        );
    }

    manifest.artifacts.insert(
        "transcript_txt".to_string(),
        "transcript/transcript.txt".to_string(),
    );
    manifest.artifacts.insert(
        "transcript_md".to_string(),
        "transcript/transcript.md".to_string(),
    );
    manifest.text_preview = text.chars().take(180).collect();
    task_manifest::write_task_manifest(&task_dir, &manifest)?;

    Ok(SaveTranscriptEditResult {
        task_id: request.task_id,
        text: text.to_string(),
        artifacts: manifest.artifacts,
        has_original_backup: true,
    })
}

fn ensure_task_source_privacy_ready(manifest: &task_manifest::TaskManifest) -> Result<(), String> {
    if !manifest.source_privacy_ready() {
        return Err("Task is unavailable in the current history format.".to_string());
    }
    Ok(())
}

struct AudioPlaybackPaths {
    source_path: String,
    asset_path: String,
}

fn load_audio_paths(
    task_dir: &Path,
    manifest: &task_manifest::TaskManifest,
    direct_audio_root: &Path,
    playback_cache_root: &Path,
    task_id: &str,
) -> Result<Option<AudioPlaybackPaths>, String> {
    let Some(audio_path) = task_manifest::artifact_path(task_dir, manifest, "audio")? else {
        return Ok(None);
    };
    if !audio_path.exists() {
        return Ok(None);
    }
    validate_audio_path(&audio_path)?;
    task_manifest::validate_task_artifact_path(task_dir, &audio_path, "audio")?;
    let source_path = audio_path
        .canonicalize()
        .map_err(|_| "Failed to resolve audio artifact.".to_string())?;
    let asset_path = ensure_audio_asset_path(
        &source_path,
        direct_audio_root,
        playback_cache_root,
        task_id,
    )?;
    Ok(Some(AudioPlaybackPaths {
        source_path: task_manifest::path_to_frontend_string(source_path),
        asset_path: task_manifest::path_to_frontend_string(asset_path),
    }))
}

fn ensure_audio_asset_path(
    source_path: &Path,
    direct_audio_root: &Path,
    playback_cache_root: &Path,
    task_id: &str,
) -> Result<PathBuf, String> {
    let direct_audio_root = ensure_canonical_dir(direct_audio_root, "direct audio asset root")?;
    if source_path.starts_with(&direct_audio_root) {
        return Ok(source_path.to_path_buf());
    }
    let playback_cache_root =
        ensure_canonical_dir(playback_cache_root, "audio playback cache root")?;

    let extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .ok_or_else(|| "Audio artifact has no extension.".to_string())?
        .to_ascii_lowercase();
    let asset_dir = playback_cache_root
        .join(crate::AUDIO_REVIEW_CACHE_DIR_NAME)
        .join(task_id);
    fs::create_dir_all(&asset_dir)
        .map_err(|_| "Failed to create audio playback directory.".to_string())?;
    let asset_dir = asset_dir
        .canonicalize()
        .map_err(|_| "Failed to resolve audio playback directory.".to_string())?;
    if !asset_dir.starts_with(&playback_cache_root) {
        return Err("Refusing to create audio playback asset outside app-local cache.".to_string());
    }

    let asset_path = asset_dir.join(format!("audio.{extension}"));
    copy_audio_asset(source_path, &asset_dir, &asset_path, &extension)?;
    validate_audio_asset_path(&asset_path, &playback_cache_root)
}

fn copy_audio_asset(
    source_path: &Path,
    asset_dir: &Path,
    asset_path: &Path,
    extension: &str,
) -> Result<(), String> {
    prepare_audio_asset_path(asset_path)?;
    let temp_path = asset_dir.join(format!(".audio-{}.{}.tmp", uuid::Uuid::new_v4(), extension));
    let mut source_file = fs::File::open(source_path)
        .map_err(|_| "Failed to read source audio for playback.".to_string())?;
    let mut temp_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(|_| "Failed to create temporary audio playback asset.".to_string())?;

    if io::copy(&mut source_file, &mut temp_file).is_err() {
        let _ = fs::remove_file(&temp_path);
        return Err("Failed to copy audio for playback.".to_string());
    }
    drop(temp_file);

    if fs::rename(&temp_path, asset_path).is_err() {
        let _ = fs::remove_file(&temp_path);
        return Err("Failed to install audio playback asset.".to_string());
    }

    Ok(())
}

fn prepare_audio_asset_path(asset_path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(asset_path) {
        Ok(metadata) => {
            if is_link_or_reparse_point(&metadata) {
                return Err("Refusing to replace linked audio playback asset.".to_string());
            }
            if !metadata.is_file() {
                return Err("Refusing to replace non-file audio playback asset.".to_string());
            }
            fs::remove_file(asset_path)
                .map_err(|_| "Failed to replace audio playback asset.".to_string())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Failed to inspect audio playback asset.".to_string()),
    }
}

fn validate_audio_asset_path(
    asset_path: &Path,
    playback_cache_root: &Path,
) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(asset_path)
        .map_err(|_| "Failed to inspect audio playback asset.".to_string())?;
    if is_link_or_reparse_point(&metadata) {
        return Err("Refusing to expose linked audio playback asset.".to_string());
    }
    if !metadata.is_file() {
        return Err("Refusing to expose non-file audio playback asset.".to_string());
    }

    let asset_path = asset_path
        .canonicalize()
        .map_err(|_| "Failed to resolve audio playback asset.".to_string())?;
    if asset_path.starts_with(playback_cache_root) {
        Ok(asset_path)
    } else {
        Err("Refusing to expose audio playback asset outside app-local cache.".to_string())
    }
}

fn is_link_or_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink() || is_windows_reparse_point(metadata)
}

#[cfg(windows)]
fn is_windows_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_windows_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn ensure_canonical_dir(path: &Path, label: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(path).map_err(|_| format!("Failed to create {label}."))?;
    path.canonicalize()
        .map_err(|_| format!("Failed to resolve {label}."))
}

fn read_segments_sidecar(
    task_dir: &Path,
    path: &Path,
) -> Result<Vec<TranscriptSegmentView>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    validate_segments_path(task_dir, path)?;
    task_manifest::validate_task_artifact_path(task_dir, path, "segments")?;
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(vec![]);
    };
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Ok(vec![]);
    };
    let Some(items) = payload
        .get("segments")
        .and_then(serde_json::Value::as_array)
    else {
        return Ok(vec![]);
    };

    Ok(items
        .iter()
        .filter_map(|item| segment_from_value(item).ok())
        .collect())
}

fn segment_from_value(value: &serde_json::Value) -> Result<TranscriptSegmentView, String> {
    let id = value
        .get("id")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Transcript segment is missing id.".to_string())?
        .to_string();
    let start_ms = value
        .get("start_ms")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "Transcript segment is missing start_ms.".to_string())?;
    let end_ms = value
        .get("end_ms")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "Transcript segment is missing end_ms.".to_string())?;
    if end_ms <= start_ms {
        return Err("Transcript segment timing is invalid.".to_string());
    }
    let text = value
        .get("text")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Transcript segment is missing text.".to_string())?
        .to_string();
    let speaker = value
        .get("speaker")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    Ok(TranscriptSegmentView {
        id,
        start_ms,
        end_ms,
        text,
        speaker,
    })
}

fn write_segments_sidecar(path: &Path, segments: &[TranscriptSegmentView]) -> Result<(), String> {
    for segment in segments {
        if segment.id.trim().is_empty() {
            return Err("Transcript segment id cannot be empty.".to_string());
        }
        if segment.end_ms <= segment.start_ms {
            return Err("Transcript segment timing is invalid.".to_string());
        }
    }
    fs::write(
        path,
        serde_json::to_string_pretty(&serde_json::json!({ "segments": segments }))
            .map_err(|_| "Failed to encode transcript segments.".to_string())?
            + "\n",
    )
    .map_err(|_| "Failed to save transcript segments.".to_string())
}

fn create_original_backups(task_dir: &Path, txt_path: &Path, md_path: &Path) -> Result<(), String> {
    let txt_backup_path = original_backup_path(txt_path);
    task_manifest::ensure_artifact_parent(task_dir, &txt_backup_path)?;
    reject_linked_artifact_target(&txt_backup_path)?;
    if !txt_backup_path.exists() {
        fs::copy(txt_path, &txt_backup_path)
            .map_err(|_| "Failed to create transcript backup.".to_string())?;
    }

    if md_path.exists() {
        let md_backup_path = original_backup_path(md_path);
        task_manifest::ensure_artifact_parent(task_dir, &md_backup_path)?;
        reject_linked_artifact_target(&md_backup_path)?;
        if !md_backup_path.exists() {
            fs::copy(md_path, md_backup_path)
                .map_err(|_| "Failed to create markdown backup.".to_string())?;
        }
    }
    Ok(())
}

fn original_backup_path(path: &Path) -> PathBuf {
    let file_name = path.file_name().unwrap_or_default();
    path.parent()
        .unwrap_or_else(|| Path::new(""))
        .join("original")
        .join(file_name)
}

fn format_transcript_markdown(existing_markdown: Option<&str>, text: &str) -> String {
    if let Some(existing_markdown) = existing_markdown {
        if let Some((prefix, _)) = existing_markdown.split_once(TRANSCRIPT_SECTION_MARKER) {
            return format!("{prefix}{TRANSCRIPT_SECTION_MARKER}\n\n{text}\n");
        }
    }

    format!("# Transcript\n\n{TRANSCRIPT_SECTION_MARKER}\n\n{text}\n")
}

fn default_transcript_md_path(task_dir: &Path) -> PathBuf {
    task_dir.join("transcript").join("transcript.md")
}

fn default_segments_path(task_dir: &Path) -> PathBuf {
    task_dir.join("transcript").join("segments.json")
}

fn validate_transcript_txt(task_dir: &Path, path: &Path) -> Result<(), String> {
    if path == task_dir.join("transcript").join("transcript.txt") {
        Ok(())
    } else {
        Err("Task transcript must be transcript/transcript.txt.".to_string())
    }
}

fn validate_transcript_md(task_dir: &Path, path: &Path) -> Result<(), String> {
    if path == task_dir.join("transcript").join("transcript.md") {
        Ok(())
    } else {
        Err("Task markdown transcript must be transcript/transcript.md.".to_string())
    }
}

fn validate_segments_path(task_dir: &Path, path: &Path) -> Result<(), String> {
    if path == task_dir.join("transcript").join("segments.json") {
        Ok(())
    } else {
        Err("Task segments must be transcript/segments.json.".to_string())
    }
}

fn reject_linked_artifact_target(path: &Path) -> Result<(), String> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if is_link_or_reparse_point(&metadata) {
            return Err("Task artifact cannot be a link or reparse point.".to_string());
        }
    }
    if let Some(parent) = path.parent() {
        if let Ok(metadata) = fs::symlink_metadata(parent) {
            if is_link_or_reparse_point(&metadata) {
                return Err("Task artifact parent cannot be a link or reparse point.".to_string());
            }
        }
    }
    Ok(())
}

fn validate_audio_path(path: &Path) -> Result<(), String> {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return Err("Audio artifact has no extension.".to_string());
    };
    if matches!(
        extension.to_ascii_lowercase().as_str(),
        "wav" | "mp3" | "m4a" | "aac" | "flac" | "ogg"
    ) {
        Ok(())
    } else {
        Err("Path is not a supported audio file.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        load_transcript_detail_from_output_root, load_transcript_detail_from_roots,
        save_transcript_edit_to_output_root, LoadTranscriptDetailRequest,
        SaveTranscriptEditRequest, TranscriptSegmentView,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn load_detail_reads_text_segments_audio_and_backup_status() {
        let output_root = temp_dir("load_detail_task");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "original text\n",
        )
        .expect("write transcript");
        fs::write(task_dir.join("media").join("audio.wav"), b"fake wav").expect("write audio");
        fs::write(
            task_dir.join("transcript").join("segments.json"),
            r#"{"segments":[{"id":"seg-0001","start_ms":0,"end_ms":1200,"text":"original text","speaker":"solo"}]}"#,
        )
        .expect("write segments");
        write_manifest(&task_dir, task_id, true);

        let detail = load_transcript_detail_from_output_root(
            &output_root,
            LoadTranscriptDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .expect("load detail");

        assert_eq!(detail.task_id, task_id);
        assert_eq!(detail.text, "original text");
        assert_eq!(
            detail.segments,
            vec![TranscriptSegmentView {
                id: "seg-0001".to_string(),
                start_ms: 0,
                end_ms: 1200,
                text: "original text".to_string(),
                speaker: Some("solo".to_string()),
            }]
        );
        assert!(detail
            .audio_path
            .expect("audio path")
            .ends_with("media/audio.wav"));
        assert!(!detail.has_original_backup);
    }

    #[test]
    fn load_detail_copies_external_output_audio_to_app_local_playback_path() {
        let output_root = temp_dir("load_detail_external_output_root");
        let app_local_root = temp_dir("load_detail_app_local");
        let app_local_outputs = app_local_root.join("outputs");
        let app_local_cache = app_local_root.join("cache");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        let source_audio_path = task_dir.join("media").join("audio.wav");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "original text\n",
        )
        .expect("write transcript");
        fs::write(&source_audio_path, b"fake wav").expect("write audio");
        write_manifest(&task_dir, task_id, false);

        let detail = load_transcript_detail_from_roots(
            &output_root,
            &app_local_outputs,
            &app_local_cache,
            LoadTranscriptDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .expect("load detail");

        let audio_path = detail.audio_path.expect("audio path");
        let audio_asset_path = detail.audio_asset_path.expect("audio asset path");
        assert!(audio_path.ends_with("media/audio.wav"));
        assert!(audio_asset_path.ends_with(
            "cache/.frameq-audio-review/20260705-153012-douyin-7645505408425004329/audio.wav"
        ));
        assert_ne!(audio_path, audio_asset_path);
        let app_local_cache = app_local_cache
            .canonicalize()
            .expect("resolve app-local cache")
            .to_string_lossy()
            .replace('\\', "/");
        assert!(audio_asset_path.starts_with(&app_local_cache));
        assert_eq!(
            fs::read(audio_asset_path).expect("read copied audio"),
            b"fake wav"
        );
    }

    #[test]
    fn load_detail_replaces_existing_cache_link_without_overwriting_link_target() {
        let output_root = temp_dir("load_detail_replaces_cache_link_output");
        let app_local_root = temp_dir("load_detail_replaces_cache_link_app_local");
        let app_local_outputs = app_local_root.join("outputs");
        let app_local_cache = app_local_root.join("cache");
        let outside_dir = temp_dir("load_detail_replaces_cache_link_outside");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        let source_audio_path = task_dir.join("media").join("audio.wav");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "original text\n",
        )
        .expect("write transcript");
        fs::write(&source_audio_path, b"fake wav").expect("write audio");
        write_manifest(&task_dir, task_id, false);

        let asset_dir = app_local_cache
            .join(crate::AUDIO_REVIEW_CACHE_DIR_NAME)
            .join(task_id);
        fs::create_dir_all(&asset_dir).expect("create asset dir");
        let outside_target = outside_dir.join("outside.wav");
        fs::write(&outside_target, b"do not overwrite").expect("write outside target");
        let asset_path = asset_dir.join("audio.wav");
        fs::hard_link(&outside_target, &asset_path).expect("create cache hard link");

        let detail = load_transcript_detail_from_roots(
            &output_root,
            &app_local_outputs,
            &app_local_cache,
            LoadTranscriptDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .expect("load detail");

        assert!(detail
            .audio_asset_path
            .expect("audio asset path")
            .ends_with(
                "cache/.frameq-audio-review/20260705-153012-douyin-7645505408425004329/audio.wav"
            ));
        assert_eq!(
            fs::read(&outside_target).expect("read outside target"),
            b"do not overwrite"
        );
        assert_eq!(
            fs::read(&asset_path).expect("read copied audio"),
            b"fake wav"
        );
    }

    #[test]
    fn load_detail_rejects_symlinked_audio_cache_target_before_copying() {
        let output_root = temp_dir("load_detail_rejects_symlinked_cache_output");
        let app_local_root = temp_dir("load_detail_rejects_symlinked_cache_app_local");
        let app_local_outputs = app_local_root.join("outputs");
        let app_local_cache = app_local_root.join("cache");
        let outside_dir = temp_dir("load_detail_rejects_symlinked_cache_outside");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        let source_audio_path = task_dir.join("media").join("audio.wav");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "original text\n",
        )
        .expect("write transcript");
        fs::write(&source_audio_path, b"fake wav").expect("write audio");
        write_manifest(&task_dir, task_id, false);

        let asset_dir = app_local_cache
            .join(crate::AUDIO_REVIEW_CACHE_DIR_NAME)
            .join(task_id);
        fs::create_dir_all(&asset_dir).expect("create asset dir");
        let outside_target = outside_dir.join("outside.wav");
        fs::write(&outside_target, b"do not overwrite").expect("write outside target");
        let asset_path = asset_dir.join("audio.wav");
        if let Err(error) = create_file_symlink(&outside_target, &asset_path) {
            eprintln!("skipping symlink regression; symlink creation is unavailable: {error}");
            return;
        }

        let error = load_transcript_detail_from_roots(
            &output_root,
            &app_local_outputs,
            &app_local_cache,
            LoadTranscriptDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .expect_err("reject symlinked cache target");

        assert!(error.contains("linked audio playback asset"));
        assert_eq!(
            fs::read(&outside_target).expect("read outside target"),
            b"do not overwrite"
        );
    }

    #[test]
    fn save_detail_creates_original_backup_once_and_updates_manifest() {
        let output_root = temp_dir("save_detail_task");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "first version\n",
        )
        .expect("write transcript");
        fs::write(
            task_dir.join("transcript").join("transcript.md"),
            "# Transcript\n\n## Transcript\n\nfirst version\n",
        )
        .expect("write markdown");
        write_manifest(&task_dir, task_id, false);

        let result = save_transcript_edit_to_output_root(
            &output_root,
            SaveTranscriptEditRequest {
                task_id: task_id.to_string(),
                text: "second version".to_string(),
                segments: vec![TranscriptSegmentView {
                    id: "seg-0001".to_string(),
                    start_ms: 0,
                    end_ms: 900,
                    text: "second version".to_string(),
                    speaker: None,
                }],
            },
        )
        .expect("save transcript");

        assert_eq!(result.text, "second version");
        assert!(result.has_original_backup);
        assert_eq!(
            fs::read_to_string(
                task_dir
                    .join("transcript")
                    .join("original")
                    .join("transcript.txt")
            )
            .expect("read backup"),
            "first version\n"
        );
        assert_eq!(
            fs::read_to_string(task_dir.join("transcript").join("transcript.txt"))
                .expect("read saved"),
            "second version\n"
        );
        assert!(
            fs::read_to_string(task_dir.join("transcript").join("segments.json"))
                .expect("read segments")
                .contains("seg-0001")
        );
        let manifest =
            fs::read_to_string(task_dir.join("frameq-task.json")).expect("read manifest");
        assert!(manifest.contains(r#""text_preview": "second version""#));
        assert!(manifest.contains(r#""segments": "transcript/segments.json""#));

        save_transcript_edit_to_output_root(
            &output_root,
            SaveTranscriptEditRequest {
                task_id: task_id.to_string(),
                text: "third version".to_string(),
                segments: vec![],
            },
        )
        .expect("save again");
        assert_eq!(
            fs::read_to_string(
                task_dir
                    .join("transcript")
                    .join("original")
                    .join("transcript.txt")
            )
            .expect("read backup again"),
            "first version\n"
        );
    }

    #[test]
    fn save_detail_rejects_linked_markdown_without_touching_external_target() {
        let output_root = temp_dir("save_detail_rejects_linked_markdown");
        let outside_dir = temp_dir("save_detail_external_markdown");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "first version\n",
        )
        .expect("write transcript");
        let outside_target = outside_dir.join("outside.md");
        fs::write(&outside_target, "external content\n").expect("write outside markdown");
        let linked_markdown = task_dir.join("transcript").join("transcript.md");
        if let Err(error) = create_file_symlink(&outside_target, &linked_markdown) {
            eprintln!("skipping symlink regression; symlink creation is unavailable: {error}");
            return;
        }
        write_manifest(&task_dir, task_id, false);

        let error = save_transcript_edit_to_output_root(
            &output_root,
            SaveTranscriptEditRequest {
                task_id: task_id.to_string(),
                text: "second version".to_string(),
                segments: vec![],
            },
        )
        .expect_err("linked markdown must be rejected");

        assert!(error.contains("link") || error.contains("outside"));
        assert_eq!(
            fs::read_to_string(&outside_target).expect("read outside markdown"),
            "external content\n"
        );
    }

    #[test]
    fn save_detail_rejects_nested_alternate_transcript_path() {
        let output_root = temp_dir("save_detail_rejects_alternate_transcript");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        let alternate_dir = task_dir.join("alternate").join("transcript");
        fs::create_dir_all(&alternate_dir).expect("create alternate transcript dir");
        let alternate_txt = alternate_dir.join("transcript.txt");
        fs::write(&alternate_txt, "alternate original\n").expect("write alternate transcript");
        write_manifest(&task_dir, task_id, false);
        let manifest_path = task_dir.join("frameq-task.json");
        let manifest = fs::read_to_string(&manifest_path)
            .expect("read manifest")
            .replace(
                "transcript/transcript.txt",
                "alternate/transcript/transcript.txt",
            );
        fs::write(&manifest_path, manifest).expect("write alternate manifest");

        let error = save_transcript_edit_to_output_root(
            &output_root,
            SaveTranscriptEditRequest {
                task_id: task_id.to_string(),
                text: "edited text".to_string(),
                segments: vec![],
            },
        )
        .expect_err("alternate transcript path must be rejected");

        assert!(error.contains("transcript/transcript.txt"));
        assert_eq!(
            fs::read_to_string(alternate_txt).expect("read unchanged alternate transcript"),
            "alternate original\n"
        );
        assert!(!task_dir.join("transcript").join("transcript.txt").exists());
    }

    #[test]
    fn save_detail_never_backs_up_sensitive_legacy_source_metadata() {
        let output_root = temp_dir("save_detail_rejects_sensitive_legacy_source");
        let task_id = "20260710-120000-xiaohongshu-legacy";
        let task_dir = create_task(&output_root, task_id);
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "first version\n",
        )
        .expect("write transcript");
        fs::write(
            task_dir.join("transcript").join("transcript.md"),
            "# Transcript\n\n## Metadata\n\n".to_string()
                + "- Source URL: https://www.xiaohongshu.com/explore/"
                + "64a1b2c3d4e5f67890123456?xsec_token=review-secret\n\n"
                + "## Transcript\n\nfirst version\n",
        )
        .expect("write markdown");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 2,
  "task_id": "{task_id}",
  "created_at": "2026-07-10T12:00:00Z",
  "source_url": "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456?xsec_token=review-secret",
  "platform": "xiaohongshu",
  "status": "completed",
  "artifacts": {{
    "transcript_txt": "transcript/transcript.txt",
    "transcript_md": "transcript/transcript.md"
  }},
  "error": null,
  "text_preview": "first version",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");

        let error = save_transcript_edit_to_output_root(
            &output_root,
            SaveTranscriptEditRequest {
                task_id: task_id.to_string(),
                text: "second version".to_string(),
                segments: vec![],
            },
        )
        .expect_err("legacy source must be migrated first");

        assert!(error.contains("current history format"));
        assert!(!task_dir.join("transcript").join("original").exists());
    }

    #[test]
    fn transcript_load_and_save_reject_quarantined_tasks() {
        let output_root = temp_dir("transcript_rejects_quarantined_task");
        let task_id = "20260710-120000-xiaohongshu-review-secret";
        let task_dir = create_task(&output_root, task_id);
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "original text\n",
        )
        .expect("write transcript");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 3,
  "source_privacy_migration_version": 2,
  "source_privacy_quarantined": true,
  "task_id": "{task_id}",
  "created_at": "2026-07-10T12:00:00Z",
  "source_url": "",
  "platform": "xiaohongshu",
  "status": "completed",
  "artifacts": {{"transcript_txt": "transcript/transcript.txt"}},
  "error": null,
  "text_preview": "original text",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");

        let load_error = load_transcript_detail_from_output_root(
            &output_root,
            LoadTranscriptDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .expect_err("quarantined transcript load must fail");
        assert!(load_error.contains("current history format"));

        let save_error = save_transcript_edit_to_output_root(
            &output_root,
            SaveTranscriptEditRequest {
                task_id: task_id.to_string(),
                text: "changed".to_string(),
                segments: vec![],
            },
        )
        .expect_err("quarantined transcript save must fail");
        assert!(save_error.contains("current history format"));
        assert_eq!(
            fs::read_to_string(task_dir.join("transcript").join("transcript.txt"))
                .expect("read unchanged transcript"),
            "original text\n"
        );
    }

    #[test]
    fn save_detail_rejects_empty_text_and_path_traversal() {
        let output_root = temp_dir("save_detail_rejects_invalid");
        let task_id = "20260705-153012-source-demo";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("transcript").join("transcript.txt"), "text\n")
            .expect("write transcript");
        write_manifest(&task_dir, task_id, false);

        assert!(save_transcript_edit_to_output_root(
            &output_root,
            SaveTranscriptEditRequest {
                task_id: task_id.to_string(),
                text: " ".to_string(),
                segments: vec![],
            },
        )
        .is_err());

        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 1,
  "task_id": "{task_id}",
  "created_at": "2026-07-05T15:30:12Z",
  "source_url": "https://example.test/video",
  "status": "completed",
  "artifacts": {{"transcript_txt": "../outside.txt"}},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write unsafe manifest");

        assert!(load_transcript_detail_from_output_root(
            &output_root,
            LoadTranscriptDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .is_err());
    }

    fn create_task(output_root: &Path, task_id: &str) -> PathBuf {
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("media")).expect("create media dir");
        fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
        fs::create_dir_all(task_dir.join("ai")).expect("create ai dir");
        task_dir
    }

    fn write_manifest(task_dir: &Path, task_id: &str, include_segments: bool) {
        let segments_entry = if include_segments {
            r#",
    "segments": "transcript/segments.json""#
        } else {
            ""
        };
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 3,
  "source_privacy_migration_version": 2,
  "task_id": "{task_id}",
  "created_at": "2026-07-05T15:30:12Z",
  "source_url": "https://www.douyin.com/video/7645505408425004329",
  "source_identity": {{
    "version": 1,
    "platform": "douyin",
    "stable_id": "7645505408425004329",
    "effective_part": null,
    "canonical_url": "https://www.douyin.com/video/7645505408425004329"
  }},
  "platform": "douyin",
  "status": "completed",
  "artifacts": {{
    "audio": "media/audio.wav",
    "transcript_txt": "transcript/transcript.txt",
    "transcript_md": "transcript/transcript.md"{segments_entry}
  }},
  "error": null,
  "text_preview": "original text",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");
    }

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("frameq-{name}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[cfg(windows)]
    fn create_file_symlink(source: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_file(source, link)
    }

    #[cfg(unix)]
    fn create_file_symlink(source: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(source, link)
    }
}
