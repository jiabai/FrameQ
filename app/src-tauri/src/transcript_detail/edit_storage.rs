use super::{segments, TranscriptSegmentView};
use crate::task_manifest;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const TRANSCRIPT_SECTION_MARKER: &str = "## Transcript";

pub(super) struct LoadedTranscript {
    pub(super) text: String,
    pub(super) has_original_backup: bool,
}

pub(super) struct SavedTranscript {
    pub(super) text: String,
    pub(super) artifacts: HashMap<String, String>,
    pub(super) has_original_backup: bool,
}

pub(super) fn load_transcript(
    task: &task_manifest::SupportedTask,
) -> Result<LoadedTranscript, String> {
    let transcript_path =
        task.required_existing_artifact_path(task_manifest::TaskArtifact::TranscriptTxt)?;
    validate_transcript_txt(task.task_dir(), &transcript_path)?;
    reject_linked_artifact_target(&transcript_path)?;

    let text = fs::read_to_string(&transcript_path)
        .map_err(|_| "Failed to read transcript.".to_string())?
        .trim()
        .to_string();
    Ok(LoadedTranscript {
        text,
        has_original_backup: original_backup_path(&transcript_path).is_file(),
    })
}

pub(super) fn save_transcript(
    task: task_manifest::SupportedTask,
    text: &str,
    segments: &[TranscriptSegmentView],
) -> Result<SavedTranscript, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Transcript text cannot be empty.".to_string());
    }

    let mut edit = task.into_edit_session();
    let transcript_path =
        edit.required_existing_artifact_path(task_manifest::TaskArtifact::TranscriptTxt)?;
    validate_transcript_txt(edit.task_dir(), &transcript_path)?;
    reject_linked_artifact_target(&transcript_path)?;

    let md_path = edit.artifact_path_or_default(
        task_manifest::TaskArtifact::TranscriptMd,
        "transcript/transcript.md",
    )?;
    validate_transcript_md(edit.task_dir(), &md_path)?;
    let segments_path = edit.artifact_path_or_default(
        task_manifest::TaskArtifact::Segments,
        "transcript/segments.json",
    )?;
    segments::validate_segments_path(edit.task_dir(), &segments_path)?;

    reject_linked_artifact_target(&md_path)?;
    reject_linked_artifact_target(&segments_path)?;
    if md_path.exists() {
        edit.validate_existing_path(&md_path, task_manifest::TaskArtifact::TranscriptMd)?;
    }
    if segments_path.exists() {
        edit.validate_existing_path(&segments_path, task_manifest::TaskArtifact::Segments)?;
    }

    edit.ensure_artifact_parent(&transcript_path)?;
    edit.ensure_artifact_parent(&md_path)?;
    edit.ensure_artifact_parent(&segments_path)?;
    create_original_backups(&edit, &transcript_path, &md_path)?;

    fs::write(&transcript_path, format!("{text}\n"))
        .map_err(|_| "Failed to save transcript.".to_string())?;
    let existing_markdown = fs::read_to_string(&md_path).ok();
    fs::write(
        &md_path,
        format_transcript_markdown(existing_markdown.as_deref(), text),
    )
    .map_err(|_| "Failed to save transcript markdown.".to_string())?;

    if segments.is_empty() {
        if edit.has_artifact(task_manifest::TaskArtifact::Segments) {
            segments::write_segments_sidecar(&segments_path, &[])?;
        }
    } else {
        segments::write_segments_sidecar(&segments_path, segments)?;
        edit.set_artifact(
            task_manifest::TaskArtifact::Segments,
            "transcript/segments.json",
        )?;
    }

    edit.set_artifact(
        task_manifest::TaskArtifact::TranscriptTxt,
        "transcript/transcript.txt",
    )?;
    edit.set_artifact(
        task_manifest::TaskArtifact::TranscriptMd,
        "transcript/transcript.md",
    )?;
    edit.set_text_preview(text.chars().take(180).collect());
    edit.save()?;

    Ok(SavedTranscript {
        text: text.to_string(),
        artifacts: edit.declared_artifacts(),
        has_original_backup: true,
    })
}

fn create_original_backups(
    edit: &task_manifest::TaskEditSession,
    txt_path: &Path,
    md_path: &Path,
) -> Result<(), String> {
    let txt_backup_path = original_backup_path(txt_path);
    edit.ensure_artifact_parent(&txt_backup_path)?;
    reject_linked_artifact_target(&txt_backup_path)?;
    if !txt_backup_path.exists() {
        fs::copy(txt_path, &txt_backup_path)
            .map_err(|_| "Failed to create transcript backup.".to_string())?;
    }

    if md_path.exists() {
        let md_backup_path = original_backup_path(md_path);
        edit.ensure_artifact_parent(&md_backup_path)?;
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

fn reject_linked_artifact_target(path: &Path) -> Result<(), String> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if task_manifest::is_link_or_reparse_point(&metadata) {
            return Err("Task artifact cannot be a link or reparse point.".to_string());
        }
    }
    if let Some(parent) = path.parent() {
        if let Ok(metadata) = fs::symlink_metadata(parent) {
            if task_manifest::is_link_or_reparse_point(&metadata) {
                return Err("Task artifact parent cannot be a link or reparse point.".to_string());
            }
        }
    }
    Ok(())
}
