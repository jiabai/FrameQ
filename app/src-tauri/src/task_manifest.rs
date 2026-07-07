use crate::{path_to_env_string, settings, RuntimePaths, OUTPUT_DIR_ENV};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub(crate) const TASK_MANIFEST_FILE_NAME: &str = "frameq-task.json";
pub(crate) const TASKS_DIR_NAME: &str = "tasks";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct TaskManifestError {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) stage: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct TranscriptMetadata {
    pub(crate) source: String,
    #[serde(default)]
    pub(crate) language: Option<String>,
    #[serde(default)]
    pub(crate) engine: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InsightView {
    pub(crate) id: u64,
    pub(crate) topic: String,
    pub(crate) match_reason: String,
    pub(crate) follow_up_questions: Vec<String>,
    pub(crate) suitable_use: String,
    pub(crate) source_chunk_id: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct TaskManifest {
    #[serde(default)]
    pub(crate) schema_version: u64,
    pub(crate) task_id: String,
    pub(crate) created_at: String,
    #[serde(default)]
    pub(crate) updated_at: Option<String>,
    #[serde(default)]
    pub(crate) source_url: String,
    #[serde(default)]
    pub(crate) platform: String,
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) app_version: String,
    #[serde(default)]
    pub(crate) worker_version: String,
    #[serde(default)]
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) transcript: Option<TranscriptMetadata>,
    #[serde(default)]
    pub(crate) artifacts: HashMap<String, String>,
    #[serde(default)]
    pub(crate) error: Option<TaskManifestError>,
    #[serde(default)]
    pub(crate) text_preview: String,
    #[serde(default)]
    pub(crate) insights_count: usize,
}

pub(crate) fn parse_insight_view(value: &serde_json::Value) -> Option<InsightView> {
    let id = value.get("id").and_then(serde_json::Value::as_u64)?;
    let topic = required_trimmed_string(value, "topic")?;
    let match_reason = required_trimmed_string(value, "matchReason")?;
    let follow_up_questions = value
        .get("followUpQuestions")
        .and_then(serde_json::Value::as_array)?
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_string)
        })
        .collect::<Option<Vec<_>>>()?;
    if follow_up_questions.is_empty() {
        return None;
    }
    let suitable_use = required_trimmed_string(value, "suitableUse")?;
    let source_chunk_id = match value.get("sourceChunkId")? {
        serde_json::Value::Null => None,
        raw => Some(raw.as_u64()?),
    };

    Some(InsightView {
        id,
        topic,
        match_reason,
        follow_up_questions,
        suitable_use,
        source_chunk_id,
    })
}

pub(crate) fn parse_insights_payload(payload: &serde_json::Value) -> Vec<InsightView> {
    if payload
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        return vec![];
    }

    let Some(items) = payload
        .get("insights")
        .and_then(serde_json::Value::as_array)
    else {
        return vec![];
    };

    items
        .iter()
        .map(parse_insight_view)
        .collect::<Option<Vec<_>>>()
        .unwrap_or_default()
}

fn required_trimmed_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

impl TaskManifest {
    pub(crate) fn transcript_metadata(&self) -> Option<TranscriptMetadata> {
        self.transcript.clone().or_else(|| {
            if self.schema_version <= 1 {
                Some(TranscriptMetadata {
                    source: "asr".to_string(),
                    language: None,
                    engine: if self.model.trim().is_empty() {
                        None
                    } else {
                        Some(self.model.clone())
                    },
                })
            } else {
                None
            }
        })
    }
}

pub(crate) fn configured_output_root(paths: &RuntimePaths) -> Result<PathBuf, String> {
    configured_output_root_from_project(&paths.user_data_dir)
}

pub(crate) fn configured_output_root_from_project(project_root: &Path) -> Result<PathBuf, String> {
    let config_values =
        settings::parse_dotenv_values(&project_root.join(settings::DOTENV_FILE_NAME))?;
    let output_root = settings::configured_env_value(&config_values, OUTPUT_DIR_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| project_root.join("outputs"));
    Ok(output_root)
}

pub(crate) fn path_to_frontend_string(path: impl AsRef<Path>) -> String {
    path_to_env_string(path)
}

pub(crate) fn load_task_manifest(
    output_root: &Path,
    task_id: &str,
) -> Result<(TaskManifest, PathBuf), String> {
    let task_dir = task_dir_for(output_root, task_id)?;
    let manifest_path = task_dir.join(TASK_MANIFEST_FILE_NAME);
    let content = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Failed to read task manifest: {error}"))?;
    let manifest: TaskManifest = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse task manifest: {error}"))?;
    if manifest.task_id != task_id.trim() {
        return Err("Task manifest id does not match requested task.".to_string());
    }
    Ok((manifest, task_dir))
}

pub(crate) fn task_dir_for(output_root: &Path, task_id: &str) -> Result<PathBuf, String> {
    let task_id = validate_task_id(task_id)?;
    Ok(output_root.join(TASKS_DIR_NAME).join(task_id))
}

pub(crate) fn list_task_manifest_paths(output_root: &Path) -> Result<Vec<PathBuf>, String> {
    let tasks_dir = output_root.join(TASKS_DIR_NAME);
    if !tasks_dir.exists() {
        return Ok(vec![]);
    }

    let mut paths = Vec::new();
    for entry in fs::read_dir(tasks_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let manifest_path = entry.path().join(TASK_MANIFEST_FILE_NAME);
        if manifest_path.is_file() {
            paths.push(manifest_path);
        }
    }
    Ok(paths)
}

pub(crate) fn read_task_manifest_path(path: &Path) -> Result<(TaskManifest, PathBuf), String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read task manifest: {error}"))?;
    let manifest: TaskManifest = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse task manifest: {error}"))?;
    let task_dir = path
        .parent()
        .ok_or_else(|| "Task manifest has no parent directory.".to_string())?
        .to_path_buf();
    Ok((manifest, task_dir))
}

pub(crate) fn write_task_manifest(task_dir: &Path, manifest: &TaskManifest) -> Result<(), String> {
    fs::write(
        task_dir.join(TASK_MANIFEST_FILE_NAME),
        serde_json::to_string_pretty(manifest)
            .map_err(|error| format!("Failed to encode task manifest: {error}"))?
            + "\n",
    )
    .map_err(|error| format!("Failed to save task manifest: {error}"))
}

pub(crate) fn artifact_path(
    task_dir: &Path,
    manifest: &TaskManifest,
    key: &str,
) -> Result<Option<PathBuf>, String> {
    let Some(raw_path) = manifest.artifacts.get(key).map(String::as_str) else {
        return Ok(None);
    };
    let relative = validate_relative_artifact_path(raw_path, key)?;
    Ok(Some(task_dir.join(relative)))
}

pub(crate) fn required_artifact_path(
    task_dir: &Path,
    manifest: &TaskManifest,
    key: &str,
) -> Result<PathBuf, String> {
    artifact_path(task_dir, manifest, key)?
        .ok_or_else(|| format!("Task manifest is missing {key} artifact."))
}

pub(crate) fn validate_task_artifact_path(
    task_dir: &Path,
    path: &Path,
    field: &str,
) -> Result<(), String> {
    let task_dir = task_dir
        .canonicalize()
        .map_err(|error| format!("Failed to resolve task directory: {error}"))?;
    let path = path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {field}: {error}"))?;
    if path.starts_with(task_dir) {
        Ok(())
    } else {
        Err("Path is outside the requested task directory.".to_string())
    }
}

pub(crate) fn ensure_artifact_parent(task_dir: &Path, path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Artifact path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create artifact directory: {error}"))?;

    let task_dir = task_dir
        .canonicalize()
        .map_err(|error| format!("Failed to resolve task directory: {error}"))?;
    let parent = parent
        .canonicalize()
        .map_err(|error| format!("Failed to resolve artifact directory: {error}"))?;
    if parent.starts_with(task_dir) {
        Ok(())
    } else {
        Err("Artifact path is outside the requested task directory.".to_string())
    }
}

pub(crate) fn validate_relative_artifact_path(
    raw_path: &str,
    field: &str,
) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} artifact path cannot be empty."));
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() || has_forbidden_component(&path) {
        return Err(format!(
            "{field} artifact path must stay inside the task directory."
        ));
    }
    Ok(path)
}

fn validate_task_id(task_id: &str) -> Result<String, String> {
    let task_id = task_id.trim();
    if task_id.is_empty() {
        return Err("Task id cannot be empty.".to_string());
    }
    let path = Path::new(task_id);
    if path.is_absolute()
        || has_forbidden_component(path)
        || task_id.contains('/')
        || task_id.contains('\\')
    {
        return Err("Task id must be a single directory name.".to_string());
    }
    Ok(task_id.to_string())
}

fn has_forbidden_component(path: &Path) -> bool {
    path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    })
}

#[cfg(test)]
mod tests {
    use super::parse_insight_view;
    use serde_json::json;

    #[test]
    fn parse_insight_view_rejects_missing_required_fields() {
        let value = json!({
            "id": 1,
            "topic": "topic",
            "followUpQuestions": ["next"],
            "suitableUse": "content planning",
            "sourceChunkId": 7
        });

        assert!(parse_insight_view(&value).is_none());
    }

    #[test]
    fn parse_insight_view_rejects_blank_required_fields() {
        let value = json!({
            "id": 1,
            "topic": "topic",
            "matchReason": " ",
            "followUpQuestions": ["next"],
            "suitableUse": "content planning",
            "sourceChunkId": 7
        });

        assert!(parse_insight_view(&value).is_none());
    }

    #[test]
    fn parse_insight_view_requires_source_chunk_id_key() {
        let value = json!({
            "id": 1,
            "topic": "topic",
            "matchReason": "matched",
            "followUpQuestions": ["next"],
            "suitableUse": "content planning"
        });

        assert!(parse_insight_view(&value).is_none());
    }

    #[test]
    fn parse_insight_view_accepts_explicit_null_source_chunk_id() {
        let value = json!({
            "id": 1,
            "topic": "topic",
            "matchReason": "matched",
            "followUpQuestions": ["next"],
            "suitableUse": "content planning",
            "sourceChunkId": null
        });

        let insight = parse_insight_view(&value).expect("parse insight");

        assert_eq!(insight.source_chunk_id, None);
    }
}
