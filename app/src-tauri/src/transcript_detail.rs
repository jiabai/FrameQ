use crate::{ensure_runtime_dirs, resolve_runtime_paths, task_manifest};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
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
    load_transcript_detail_from_output_root(&output_root, request)
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

pub(crate) fn load_transcript_detail_from_output_root(
    output_root: &Path,
    request: LoadTranscriptDetailRequest,
) -> Result<TranscriptDetailView, String> {
    let (manifest, task_dir) = task_manifest::load_task_manifest(output_root, &request.task_id)?;
    let transcript_path = task_manifest::required_artifact_path(&task_dir, &manifest, "transcript_txt")?;
    validate_transcript_txt(&transcript_path)?;
    task_manifest::validate_task_artifact_path(&task_dir, &transcript_path, "transcript_txt")?;

    let text = fs::read_to_string(&transcript_path)
        .map_err(|error| format!("Failed to read transcript: {error}"))?
        .trim()
        .to_string();
    let segments_path = task_manifest::artifact_path(&task_dir, &manifest, "segments")?
        .unwrap_or_else(|| default_segments_path(&task_dir));
    let segments = read_segments_sidecar(&task_dir, &segments_path)?;
    let audio_path = load_audio_path(&task_dir, &manifest)?;

    Ok(TranscriptDetailView {
        task_id: request.task_id,
        text,
        segments,
        audio_path,
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

    let (mut manifest, task_dir) = task_manifest::load_task_manifest(output_root, &request.task_id)?;
    let transcript_path = task_manifest::required_artifact_path(&task_dir, &manifest, "transcript_txt")?;
    validate_transcript_txt(&transcript_path)?;
    task_manifest::validate_task_artifact_path(&task_dir, &transcript_path, "transcript_txt")?;

    let md_path = task_manifest::artifact_path(&task_dir, &manifest, "transcript_md")?
        .unwrap_or_else(|| default_transcript_md_path(&task_dir));
    validate_transcript_md(&md_path)?;
    let segments_path = task_manifest::artifact_path(&task_dir, &manifest, "segments")?
        .unwrap_or_else(|| default_segments_path(&task_dir));
    validate_segments_path(&segments_path)?;

    task_manifest::ensure_artifact_parent(&task_dir, &transcript_path)?;
    task_manifest::ensure_artifact_parent(&task_dir, &md_path)?;
    task_manifest::ensure_artifact_parent(&task_dir, &segments_path)?;
    create_original_backups(&transcript_path, &md_path)?;

    fs::write(&transcript_path, format!("{text}\n"))
        .map_err(|error| format!("Failed to save transcript: {error}"))?;
    let existing_markdown = fs::read_to_string(&md_path).ok();
    fs::write(
        &md_path,
        format_transcript_markdown(existing_markdown.as_deref(), text),
    )
    .map_err(|error| format!("Failed to save transcript markdown: {error}"))?;

    if request.segments.is_empty() {
        if manifest.artifacts.contains_key("segments") {
            write_segments_sidecar(&segments_path, &[])?;
        }
    } else {
        write_segments_sidecar(&segments_path, &request.segments)?;
        manifest
            .artifacts
            .insert("segments".to_string(), "transcript/segments.json".to_string());
    }

    manifest
        .artifacts
        .insert("transcript_txt".to_string(), "transcript/transcript.txt".to_string());
    manifest
        .artifacts
        .insert("transcript_md".to_string(), "transcript/transcript.md".to_string());
    manifest.text_preview = text.chars().take(180).collect();
    task_manifest::write_task_manifest(&task_dir, &manifest)?;

    Ok(SaveTranscriptEditResult {
        task_id: request.task_id,
        text: text.to_string(),
        artifacts: manifest.artifacts,
        has_original_backup: true,
    })
}

fn load_audio_path(
    task_dir: &Path,
    manifest: &task_manifest::TaskManifest,
) -> Result<Option<String>, String> {
    let Some(audio_path) = task_manifest::artifact_path(task_dir, manifest, "audio")? else {
        return Ok(None);
    };
    if !audio_path.exists() {
        return Ok(None);
    }
    validate_audio_path(&audio_path)?;
    task_manifest::validate_task_artifact_path(task_dir, &audio_path, "audio")?;
    Ok(Some(task_manifest::path_to_frontend_string(
        audio_path
            .canonicalize()
            .map_err(|error| format!("Failed to resolve audio: {error}"))?,
    )))
}

fn read_segments_sidecar(
    task_dir: &Path,
    path: &Path,
) -> Result<Vec<TranscriptSegmentView>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    validate_segments_path(path)?;
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
            .map_err(|error| format!("Failed to encode transcript segments: {error}"))?
            + "\n",
    )
    .map_err(|error| format!("Failed to save transcript segments: {error}"))
}

fn create_original_backups(txt_path: &Path, md_path: &Path) -> Result<(), String> {
    let txt_backup_path = original_backup_path(txt_path);
    if !txt_backup_path.exists() {
        if let Some(parent) = txt_backup_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create transcript backup directory: {error}"))?;
        }
        fs::copy(txt_path, &txt_backup_path)
            .map_err(|error| format!("Failed to create transcript backup: {error}"))?;
    }

    if md_path.exists() {
        let md_backup_path = original_backup_path(md_path);
        if !md_backup_path.exists() {
            if let Some(parent) = md_backup_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Failed to create transcript backup directory: {error}")
                })?;
            }
            fs::copy(md_path, md_backup_path)
                .map_err(|error| format!("Failed to create markdown backup: {error}"))?;
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

fn validate_transcript_txt(path: &Path) -> Result<(), String> {
    if path.file_name().and_then(|name| name.to_str()) == Some("transcript.txt") {
        Ok(())
    } else {
        Err("Task transcript must be transcript/transcript.txt.".to_string())
    }
}

fn validate_transcript_md(path: &Path) -> Result<(), String> {
    if path.file_name().and_then(|name| name.to_str()) == Some("transcript.md") {
        Ok(())
    } else {
        Err("Task markdown transcript must be transcript/transcript.md.".to_string())
    }
}

fn validate_segments_path(path: &Path) -> Result<(), String> {
    if path.file_name().and_then(|name| name.to_str()) == Some("segments.json") {
        Ok(())
    } else {
        Err("Task segments must be transcript/segments.json.".to_string())
    }
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
        load_transcript_detail_from_output_root, save_transcript_edit_to_output_root,
        LoadTranscriptDetailRequest, SaveTranscriptEditRequest, TranscriptSegmentView,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn load_detail_reads_text_segments_audio_and_backup_status() {
        let output_root = temp_dir("load_detail_task");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("transcript").join("transcript.txt"), "original text\n")
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
        assert!(detail.audio_path.expect("audio path").ends_with("media/audio.wav"));
        assert!(!detail.has_original_backup);
    }

    #[test]
    fn save_detail_creates_original_backup_once_and_updates_manifest() {
        let output_root = temp_dir("save_detail_task");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("transcript").join("transcript.txt"), "first version\n")
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
            fs::read_to_string(task_dir.join("transcript").join("original").join("transcript.txt"))
                .expect("read backup"),
            "first version\n"
        );
        assert_eq!(
            fs::read_to_string(task_dir.join("transcript").join("transcript.txt"))
                .expect("read saved"),
            "second version\n"
        );
        assert!(fs::read_to_string(task_dir.join("transcript").join("segments.json"))
            .expect("read segments")
            .contains("seg-0001"));
        let manifest = fs::read_to_string(task_dir.join("frameq-task.json")).expect("read manifest");
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
            fs::read_to_string(task_dir.join("transcript").join("original").join("transcript.txt"))
                .expect("read backup again"),
            "first version\n"
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
  "schema_version": 1,
  "task_id": "{task_id}",
  "created_at": "2026-07-05T15:30:12Z",
  "source_url": "https://www.douyin.com/video/7645505408425004329",
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
}
