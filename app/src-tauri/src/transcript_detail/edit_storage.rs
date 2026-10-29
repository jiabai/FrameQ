use super::{segments, TranscriptSegmentView};
use crate::task_manifest::{self, original_backup_path, reject_linked_artifact_target};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const TRANSCRIPT_SECTION_MARKER: &str = "## Transcript";
const POLISHED_SOURCE_KEY: &str = "sourceTranscriptSha256";

pub(super) struct LoadedTranscript {
    pub(super) text: String,
    pub(super) has_original_backup: bool,
}

/// 读取 LLM 整理稿（``transcript/polished.txt``）。
///
/// 整理稿是独立副本，桌面端只在它仍对得上当前正式稿时才提供：meta 里的
/// ``sourceTranscriptSha256`` 与正式稿摘要不一致（用户改过原稿）或 meta 缺失时，
/// 一律视作没有整理稿。
pub(super) fn load_polished_transcript(
    task: &task_manifest::SupportedTask,
    official_text: &str,
) -> Option<String> {
    let polished_path = task.task_dir().join("transcript").join("polished.txt");
    if reject_linked_artifact_target(&polished_path).is_err() || !polished_path.is_file() {
        return None;
    }
    let meta_path = task
        .task_dir()
        .join("transcript")
        .join("polished.meta.json");
    if reject_linked_artifact_target(&meta_path).is_err() {
        return None;
    }
    let expected = transcript_sha256(official_text);
    let recorded = read_polished_source_sha256(&meta_path)?;
    if recorded != expected {
        return None;
    }
    let text = fs::read_to_string(&polished_path).ok()?.trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(text)
}

fn read_polished_source_sha256(meta_path: &Path) -> Option<String> {
    let raw = fs::read_to_string(meta_path).ok()?;
    let payload: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let value = payload.get(POLISHED_SOURCE_KEY)?.as_str()?.trim();
    if value.is_empty() {
        return None;
    }
    Some(value.to_string())
}

fn transcript_sha256(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
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
    let existing_markdown = fs::read_to_string(&md_path).ok();
    let transcript_bytes = format!("{text}\n").into_bytes();
    let markdown_bytes =
        format_transcript_markdown(existing_markdown.as_deref(), text).into_bytes();
    let mut mutations = Vec::new();
    create_original_backups(&edit, &transcript_path, &md_path, &mut mutations)?;

    let segments_bytes = if segments.is_empty() {
        if edit.has_artifact(task_manifest::TaskArtifact::Segments) {
            Some(segments::encode_segments_sidecar(&[])?)
        } else {
            None
        }
    } else {
        let encoded = segments::encode_segments_sidecar(segments)?;
        edit.set_artifact(
            task_manifest::TaskArtifact::Segments,
            "transcript/segments.json",
        )?;
        Some(encoded)
    };

    edit.set_artifact(
        task_manifest::TaskArtifact::TranscriptTxt,
        "transcript/transcript.txt",
    )?;
    edit.set_artifact(
        task_manifest::TaskArtifact::TranscriptMd,
        "transcript/transcript.md",
    )?;
    edit.set_text_preview(text.chars().take(180).collect());
    let manifest_bytes = edit.encoded_manifest()?;

    mutations.push(task_manifest::TaskArtifactMutation::replace(
        "transcript/transcript.txt",
        transcript_bytes,
    ));
    mutations.push(task_manifest::TaskArtifactMutation::replace(
        "transcript/transcript.md",
        markdown_bytes,
    ));
    if let Some(segments_bytes) = segments_bytes {
        mutations.push(task_manifest::TaskArtifactMutation::replace(
            "transcript/segments.json",
            segments_bytes,
        ));
    }
    mutations.push(task_manifest::TaskArtifactMutation::manifest(
        manifest_bytes,
    ));
    task_manifest::commit_task_artifacts(edit.task_dir(), mutations)?;

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
    mutations: &mut Vec<task_manifest::TaskArtifactMutation>,
) -> Result<(), String> {
    let txt_backup_path = original_backup_path(txt_path);
    edit.ensure_artifact_parent(&txt_backup_path)?;
    reject_linked_artifact_target(&txt_backup_path)?;
    if !txt_backup_path.exists() {
        let bytes =
            fs::read(txt_path).map_err(|_| "Failed to create transcript backup.".to_string())?;
        mutations.push(task_manifest::TaskArtifactMutation::replace(
            "transcript/original/transcript.txt",
            bytes,
        ));
    }

    if md_path.exists() {
        let md_backup_path = original_backup_path(md_path);
        edit.ensure_artifact_parent(&md_backup_path)?;
        reject_linked_artifact_target(&md_backup_path)?;
        if !md_backup_path.exists() {
            let bytes =
                fs::read(md_path).map_err(|_| "Failed to create markdown backup.".to_string())?;
            mutations.push(task_manifest::TaskArtifactMutation::replace(
                "transcript/original/transcript.md",
                bytes,
            ));
        }
    }
    Ok(())
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
