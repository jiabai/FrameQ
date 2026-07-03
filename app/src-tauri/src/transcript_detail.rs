use crate::{ensure_runtime_dirs, resolve_runtime_paths};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

const HISTORY_FILE_NAME: &str = "history.json";
const TRANSCRIPT_SUFFIX: &str = "_transcript";
const TRANSCRIPT_SECTION_MARKER: &str = "## Transcript";

#[derive(Debug, Deserialize)]
pub(crate) struct LoadTranscriptDetailRequest {
    #[serde(alias = "transcriptPath")]
    transcript_path: String,
    #[serde(default, alias = "audioPath")]
    audio_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SaveTranscriptEditRequest {
    #[serde(alias = "transcriptPath")]
    transcript_path: String,
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
    text: String,
    segments: Vec<TranscriptSegmentView>,
    audio_path: Option<String>,
    has_original_backup: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct SaveTranscriptEditResult {
    text: String,
    transcript_path: String,
    segments_path: Option<String>,
    has_original_backup: bool,
}

#[tauri::command]
pub(crate) fn load_transcript_detail(
    app: AppHandle,
    request: LoadTranscriptDetailRequest,
) -> Result<TranscriptDetailView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    load_transcript_detail_from_project(&paths.user_data_dir, request)
}

#[tauri::command]
pub(crate) fn save_transcript_edit(
    app: AppHandle,
    request: SaveTranscriptEditRequest,
) -> Result<SaveTranscriptEditResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    save_transcript_edit_to_project(&paths.user_data_dir, request)
}

pub(crate) fn load_transcript_detail_from_project(
    project_root: &Path,
    request: LoadTranscriptDetailRequest,
) -> Result<TranscriptDetailView, String> {
    let transcript_path = resolve_existing_transcript_path(project_root, &request.transcript_path)?;
    ensure_approved_path(project_root, &transcript_path, "transcript_path")?;

    let text = fs::read_to_string(&transcript_path)
        .map_err(|error| format!("Failed to read transcript: {error}"))?
        .trim()
        .to_string();
    let segments = read_segments_sidecar(&segments_path_for(&transcript_path))?;
    let audio_path = match request.audio_path.as_deref().map(str::trim) {
        Some("") | None => None,
        Some(raw_path) => resolve_audio_path(project_root, raw_path)?,
    };

    Ok(TranscriptDetailView {
        text,
        segments,
        audio_path: audio_path.map(|path| path.to_string_lossy().to_string()),
        has_original_backup: original_txt_backup_path(&transcript_path).is_file(),
    })
}

pub(crate) fn save_transcript_edit_to_project(
    project_root: &Path,
    request: SaveTranscriptEditRequest,
) -> Result<SaveTranscriptEditResult, String> {
    let text = request.text.trim();
    if text.is_empty() {
        return Err("Transcript text cannot be empty.".to_string());
    }

    let transcript_path = resolve_existing_transcript_path(project_root, &request.transcript_path)?;
    ensure_approved_path(project_root, &transcript_path, "transcript_path")?;
    let md_path = transcript_path.with_extension("md");
    let segments_path = segments_path_for(&transcript_path);

    create_original_backups(&transcript_path, &md_path)?;

    fs::write(&transcript_path, format!("{text}\n"))
        .map_err(|error| format!("Failed to save transcript: {error}"))?;
    let existing_markdown = fs::read_to_string(&md_path).ok();
    fs::write(
        &md_path,
        format_transcript_markdown(existing_markdown.as_deref(), text),
    )
    .map_err(|error| format!("Failed to save transcript markdown: {error}"))?;

    let segments_path_result = if request.segments.is_empty() {
        None
    } else {
        write_segments_sidecar(&segments_path, &request.segments)?;
        Some(segments_path.to_string_lossy().to_string())
    };
    update_history_preview(project_root, &transcript_path, text)?;

    Ok(SaveTranscriptEditResult {
        text: text.to_string(),
        transcript_path: transcript_path.to_string_lossy().to_string(),
        segments_path: segments_path_result,
        has_original_backup: true,
    })
}

fn resolve_existing_transcript_path(
    project_root: &Path,
    raw_path: &str,
) -> Result<PathBuf, String> {
    let candidate = resolve_user_path(project_root, raw_path)?;
    if !candidate.is_file() {
        return Err("Transcript file does not exist.".to_string());
    }
    if !is_transcript_file(&candidate) {
        return Err("Path is not a supported transcript file.".to_string());
    }
    candidate
        .canonicalize()
        .map_err(|error| format!("Failed to resolve transcript path: {error}"))
}

fn resolve_audio_path(project_root: &Path, raw_path: &str) -> Result<Option<PathBuf>, String> {
    let candidate = resolve_user_path(project_root, raw_path)?;
    if !candidate.exists() {
        return Ok(None);
    }
    if !is_audio_file(&candidate) {
        return Err("Path is not a supported audio file.".to_string());
    }
    let audio_path = candidate
        .canonicalize()
        .map_err(|error| format!("Failed to resolve audio path: {error}"))?;
    ensure_approved_path(project_root, &audio_path, "audio_path")?;
    Ok(Some(audio_path))
}

fn resolve_user_path(project_root: &Path, raw_path: &str) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty.".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() && has_parent_dir_component(&path) {
        return Err("Path traversal is not allowed.".to_string());
    }
    Ok(if path.is_absolute() {
        path
    } else {
        project_root.join(path)
    })
}

fn has_parent_dir_component(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn ensure_approved_path(project_root: &Path, path: &Path, field: &str) -> Result<(), String> {
    if is_within_project(project_root, path) || history_references_path(project_root, field, path) {
        return Ok(());
    }
    Err("Path is outside the current task or local history boundary.".to_string())
}

fn is_within_project(project_root: &Path, path: &Path) -> bool {
    let Ok(project_root) = project_root.canonicalize() else {
        return false;
    };
    path.starts_with(project_root)
}

fn history_references_path(project_root: &Path, field: &str, candidate: &Path) -> bool {
    let history_path = project_root.join("work").join(HISTORY_FILE_NAME);
    let Ok(content) = fs::read_to_string(history_path) else {
        return false;
    };
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };
    let Some(items) = payload.get("items").and_then(serde_json::Value::as_array) else {
        return false;
    };

    items.iter().any(|item| {
        item.get(field)
            .and_then(serde_json::Value::as_str)
            .and_then(|raw_path| resolve_user_path(project_root, raw_path).ok())
            .and_then(|path| path.canonicalize().ok())
            .is_some_and(|path| path == candidate)
    })
}

fn is_transcript_file(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return false;
    };
    if extension.to_ascii_lowercase() != "txt" {
        return false;
    }
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .is_some_and(|stem| stem.ends_with(TRANSCRIPT_SUFFIX))
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "wav" | "mp3" | "m4a" | "aac" | "flac" | "ogg"
            )
        })
        .unwrap_or(false)
}

fn segments_path_for(transcript_path: &Path) -> PathBuf {
    let stem = transcript_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("transcript");
    transcript_path.with_file_name(format!("{stem}_segments.json"))
}

fn read_segments_sidecar(path: &Path) -> Result<Vec<TranscriptSegmentView>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
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

    Ok(items.iter().filter_map(|item| segment_from_value(item).ok()).collect())
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
    let payload = serde_json::json!({ "segments": segments });
    fs::write(
        path,
        serde_json::to_string_pretty(&payload)
            .map_err(|error| format!("Failed to encode transcript segments: {error}"))?
            + "\n",
    )
    .map_err(|error| format!("Failed to save transcript segments: {error}"))
}

fn create_original_backups(txt_path: &Path, md_path: &Path) -> Result<(), String> {
    let txt_backup_path = original_txt_backup_path(txt_path);
    if !txt_backup_path.exists() {
        fs::copy(txt_path, &txt_backup_path)
            .map_err(|error| format!("Failed to create transcript backup: {error}"))?;
    }

    if md_path.exists() {
        let md_backup_path = original_md_backup_path(md_path);
        if !md_backup_path.exists() {
            fs::copy(md_path, md_backup_path)
                .map_err(|error| format!("Failed to create markdown backup: {error}"))?;
        }
    }
    Ok(())
}

fn original_txt_backup_path(txt_path: &Path) -> PathBuf {
    backup_path_with_extension(txt_path, "original.txt")
}

fn original_md_backup_path(md_path: &Path) -> PathBuf {
    backup_path_with_extension(md_path, "original.md")
}

fn backup_path_with_extension(path: &Path, extension: &str) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("transcript");
    path.with_file_name(format!("{stem}.{extension}"))
}

fn format_transcript_markdown(existing_markdown: Option<&str>, text: &str) -> String {
    if let Some(existing_markdown) = existing_markdown {
        if let Some((prefix, _)) = existing_markdown.split_once(TRANSCRIPT_SECTION_MARKER) {
            return format!("{prefix}{TRANSCRIPT_SECTION_MARKER}\n\n{text}\n");
        }
    }

    format!("# 视频文字稿\n\n{TRANSCRIPT_SECTION_MARKER}\n\n{text}\n")
}

fn update_history_preview(
    project_root: &Path,
    transcript_path: &Path,
    text: &str,
) -> Result<(), String> {
    let history_path = project_root.join("work").join(HISTORY_FILE_NAME);
    if !history_path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&history_path)
        .map_err(|error| format!("Failed to read history: {error}"))?;
    let mut payload: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse history: {error}"))?;
    let Some(items) = payload
        .get_mut("items")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return Ok(());
    };

    let preview: String = text.trim().chars().take(180).collect();
    for item in items {
        let Some(raw_path) = item
            .get("transcript_path")
            .and_then(serde_json::Value::as_str)
        else {
            continue;
        };
        let Ok(candidate) = resolve_user_path(project_root, raw_path).and_then(|path| {
            path.canonicalize()
                .map_err(|error| format!("Failed to resolve history transcript: {error}"))
        }) else {
            continue;
        };
        if candidate == transcript_path {
            item["text_preview"] = serde_json::Value::String(preview.clone());
        }
    }

    fs::write(
        &history_path,
        serde_json::to_string_pretty(&payload)
            .map_err(|error| format!("Failed to encode history: {error}"))?
            + "\n",
    )
    .map_err(|error| format!("Failed to save history: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        load_transcript_detail_from_project, save_transcript_edit_to_project,
        LoadTranscriptDetailRequest, SaveTranscriptEditRequest, TranscriptSegmentView,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn load_detail_reads_text_segments_audio_and_backup_status() {
        let project_root = temp_dir("load_detail_reads_text_segments_audio");
        let output_dir = project_root.join("outputs");
        fs::create_dir_all(&output_dir).expect("create outputs");
        let transcript_path = output_dir.join("demo_transcript.txt");
        let segments_path = output_dir.join("demo_transcript_segments.json");
        let audio_path = project_root.join("work").join("demo.wav");
        fs::create_dir_all(audio_path.parent().expect("audio parent")).expect("create work");
        fs::write(&transcript_path, "original text\n").expect("write transcript");
        fs::write(&audio_path, b"fake wav").expect("write audio");
        fs::write(
            &segments_path,
            r#"{"segments":[{"id":"seg-0001","start_ms":0,"end_ms":1200,"text":"original text","speaker":"solo"}]}"#,
        )
        .expect("write segments");

        let detail = load_transcript_detail_from_project(
            &project_root,
            LoadTranscriptDetailRequest {
                transcript_path: transcript_path.to_string_lossy().to_string(),
                audio_path: Some(audio_path.to_string_lossy().to_string()),
            },
        )
        .expect("load detail");

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
        assert_eq!(
            detail.audio_path,
            Some(
                audio_path
                    .canonicalize()
                    .expect("canonical audio")
                    .to_string_lossy()
                    .to_string()
            )
        );
        assert!(!detail.has_original_backup);
    }

    #[test]
    fn load_detail_ignores_malformed_segments_sidecar_but_keeps_audio() {
        let project_root = temp_dir("load_detail_ignores_malformed_segments");
        let output_dir = project_root.join("outputs");
        fs::create_dir_all(&output_dir).expect("create outputs");
        let transcript_path = output_dir.join("demo_transcript.txt");
        let segments_path = output_dir.join("demo_transcript_segments.json");
        let audio_path = project_root.join("work").join("demo.wav");
        fs::create_dir_all(audio_path.parent().expect("audio parent")).expect("create work");
        fs::write(&transcript_path, "text is still readable\n").expect("write transcript");
        fs::write(&audio_path, b"fake wav").expect("write audio");
        fs::write(&segments_path, "{not valid json").expect("write malformed segments");

        let detail = load_transcript_detail_from_project(
            &project_root,
            LoadTranscriptDetailRequest {
                transcript_path: transcript_path.to_string_lossy().to_string(),
                audio_path: Some(audio_path.to_string_lossy().to_string()),
            },
        )
        .expect("load detail despite malformed sidecar");

        assert_eq!(detail.text, "text is still readable");
        assert!(detail.segments.is_empty());
        assert_eq!(
            detail.audio_path,
            Some(
                audio_path
                    .canonicalize()
                    .expect("canonical audio")
                    .to_string_lossy()
                    .to_string()
            )
        );
    }

    #[test]
    fn save_detail_creates_backup_once_and_updates_history_preview() {
        let project_root = temp_dir("save_detail_creates_backup_once");
        let output_dir = project_root.join("outputs");
        let work_dir = project_root.join("work");
        fs::create_dir_all(&output_dir).expect("create outputs");
        fs::create_dir_all(&work_dir).expect("create work");
        let transcript_path = output_dir.join("demo_transcript.txt");
        let md_path = output_dir.join("demo_transcript.md");
        fs::write(&transcript_path, "first version\n").expect("write transcript");
        fs::write(&md_path, "# 视频文字稿\n\n## Transcript\n\nfirst version\n")
            .expect("write markdown");
        let history_payload = serde_json::json!({
            "items": [
                {
                    "transcript_path": transcript_path.to_string_lossy(),
                    "text_preview": "first version",
                }
            ]
        });
        fs::write(
            work_dir.join("history.json"),
            serde_json::to_string(&history_payload).expect("encode history"),
        )
        .expect("write history");

        let result = save_transcript_edit_to_project(
            &project_root,
            SaveTranscriptEditRequest {
                transcript_path: transcript_path.to_string_lossy().to_string(),
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
            fs::read_to_string(output_dir.join("demo_transcript.original.txt"))
                .expect("read backup"),
            "first version\n"
        );
        assert_eq!(
            fs::read_to_string(&transcript_path).expect("read saved"),
            "second version\n"
        );
        assert!(fs::read_to_string(&md_path)
            .expect("read markdown")
            .contains("## Transcript\n\nsecond version\n"));
        assert!(result
            .segments_path
            .expect("segments path")
            .ends_with("demo_transcript_segments.json"));
        assert!(fs::read_to_string(work_dir.join("history.json"))
            .expect("read history")
            .contains(r#""text_preview": "second version""#));

        save_transcript_edit_to_project(
            &project_root,
            SaveTranscriptEditRequest {
                transcript_path: transcript_path.to_string_lossy().to_string(),
                text: "third version".to_string(),
                segments: vec![],
            },
        )
        .expect("save again");

        assert_eq!(
            fs::read_to_string(output_dir.join("demo_transcript.original.txt"))
                .expect("read backup after second save"),
            "first version\n"
        );
    }

    #[test]
    fn save_detail_rejects_empty_text_and_non_transcript_files() {
        let project_root = temp_dir("save_detail_rejects_invalid_input");
        let output_dir = project_root.join("outputs");
        fs::create_dir_all(&output_dir).expect("create outputs");
        let transcript_path = output_dir.join("demo_transcript.txt");
        let note_path = output_dir.join("note.txt");
        fs::write(&transcript_path, "text\n").expect("write transcript");
        fs::write(&note_path, "text\n").expect("write note");

        assert!(save_transcript_edit_to_project(
            &project_root,
            SaveTranscriptEditRequest {
                transcript_path: transcript_path.to_string_lossy().to_string(),
                text: " ".to_string(),
                segments: vec![],
            },
        )
        .is_err());

        assert!(save_transcript_edit_to_project(
            &project_root,
            SaveTranscriptEditRequest {
                transcript_path: note_path.to_string_lossy().to_string(),
                text: "ok".to_string(),
                segments: vec![],
            },
        )
        .is_err());
    }

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("frameq_{name}_{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }
}
