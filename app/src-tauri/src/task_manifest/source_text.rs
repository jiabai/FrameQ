use super::{SupportedTask, TaskArtifact};
use crate::safe_filesystem;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::PathBuf;

const INVALID_SOURCE: &str = "SOURCE_TEXT_INVALID";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SourceTextKind {
    Transcript,
    Article,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceText {
    pub(crate) kind: SourceTextKind,
    pub(crate) artifact_key: &'static str,
    pub(crate) path: PathBuf,
    pub(crate) raw_bytes: Vec<u8>,
    pub(crate) text: String,
    pub(crate) sha256: String,
}

pub(super) fn read(task: &SupportedTask) -> Result<SourceText, String> {
    task.verify_source_directory()?;
    let (kind, artifact, limit) = if task.is_web_page() {
        (SourceTextKind::Article, TaskArtifact::ArticleTxt, 2 * 1024 * 1024)
    } else {
        (SourceTextKind::Transcript, TaskArtifact::TranscriptTxt, 32 * 1024 * 1024)
    };
    let relative = if kind == SourceTextKind::Article { "article/article.txt" } else { "transcript/transcript.txt" };
    if task.declared_artifacts().get(artifact.as_str()).map(String::as_str) != Some(relative) {
        return Err(INVALID_SOURCE.to_string());
    }
    let path = task.required_existing_artifact_path(artifact)
        .map_err(|_| INVALID_SOURCE.to_string())?;
    let raw_bytes = read_bounded(&path, limit)?;
    task.verify_source_directory()?;
    let text = std::str::from_utf8(&raw_bytes).map_err(|_| INVALID_SOURCE.to_string())?.to_string();
    if text.trim().is_empty() {
        return Err(INVALID_SOURCE.to_string());
    }
    Ok(SourceText { kind, artifact_key: artifact.as_str(), path, sha256: format!("{:x}", Sha256::digest(&raw_bytes)), raw_bytes, text })
}

pub(super) fn read_bounded(path: &std::path::Path, limit: u64) -> Result<Vec<u8>, String> {
    let read = || -> Result<Vec<u8>, std::io::Error> {
        let parent = safe_filesystem::pin_directory(path.parent().ok_or_else(|| std::io::Error::from(std::io::ErrorKind::InvalidInput))?)?;
        let mut file = safe_filesystem::open_regular(path)?;
        let before = file.metadata()?;
        let identity = safe_filesystem::file_identity(&file)?;
        if before.len() > limit {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
        let mut bytes = Vec::with_capacity(before.len() as usize);
        file.by_ref().take(limit + 1).read_to_end(&mut bytes)?;
        let after = file.metadata()?;
        let current = safe_filesystem::open_regular(path)?;
        parent.check()?;
        if bytes.len() as u64 != before.len() || before.len() != after.len()
            || before.modified()? != after.modified()?
            || safe_filesystem::file_identity(&current)? != identity
        {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
        Ok(bytes)
    };
    read().map_err(|_| INVALID_SOURCE.to_string())
}
