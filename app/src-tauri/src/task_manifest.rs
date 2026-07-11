use crate::{path_to_env_string, settings, RuntimePaths, OUTPUT_DIR_ENV};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use url::Url;

pub(crate) const TASK_MANIFEST_FILE_NAME: &str = "frameq-task.json";
pub(crate) const TASKS_DIR_NAME: &str = "tasks";
const SOURCE_IDENTITY_VERSION: u64 = 1;
pub(crate) const TASK_SCHEMA_VERSION: u64 = 3;
pub(crate) const SOURCE_PRIVACY_MIGRATION_VERSION: u64 = 2;
const MAX_CANONICAL_URL_LENGTH: usize = 2_048;
const MAX_SOURCE_STABLE_ID_LENGTH: usize = 80;
const MAX_SOURCE_QUERY_PAIRS: usize = 1;
const MAX_SOURCE_QUERY_COMPONENT_LENGTH: usize = 128;
const MAX_EFFECTIVE_PART: u64 = 100_000;
const SAFE_ARTIFACT_KEYS: [&str; 10] = [
    "video",
    "audio",
    "transcript_txt",
    "transcript_md",
    "segments",
    "summary",
    "mindmap",
    "insights",
    "insights_md",
    "preference_snapshot",
];

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct SourceIdentity {
    pub(crate) version: u64,
    pub(crate) platform: String,
    pub(crate) stable_id: String,
    #[serde(default)]
    pub(crate) effective_part: Option<u64>,
    pub(crate) canonical_url: String,
}

impl SourceIdentity {
    pub(crate) fn is_safe(&self) -> bool {
        if self.version != SOURCE_IDENTITY_VERSION
            || self.stable_id.is_empty()
            || self.stable_id.len() > MAX_SOURCE_STABLE_ID_LENGTH
            || !self
                .stable_id
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
            || self.canonical_url.is_empty()
            || self.canonical_url.len() > MAX_CANONICAL_URL_LENGTH
            || self.canonical_url.chars().any(char::is_control)
            || self.canonical_url.contains('%')
            || self
                .effective_part
                .is_some_and(|part| part == 0 || part > MAX_EFFECTIVE_PART)
        {
            return false;
        }
        if !platform_stable_id_is_valid(&self.platform, &self.stable_id) {
            return false;
        }
        let expected_host = match self.platform.as_str() {
            "xiaohongshu" => "www.xiaohongshu.com",
            "douyin" => "www.douyin.com",
            "bilibili" => "www.bilibili.com",
            "youtube" => "www.youtube.com",
            _ => return false,
        };
        let Ok(parsed) = Url::parse(&self.canonical_url) else {
            return false;
        };
        if parsed.scheme() != "https"
            || parsed.host_str() != Some(expected_host)
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.fragment().is_some()
            || parsed.port().is_some()
        {
            return false;
        }
        let query_pairs = parsed.query_pairs().collect::<Vec<_>>();
        if query_pairs.len() > MAX_SOURCE_QUERY_PAIRS
            || query_pairs.iter().any(|(key, value)| {
                key.is_empty()
                    || key.len() > MAX_SOURCE_QUERY_COMPONENT_LENGTH
                    || value.len() > MAX_SOURCE_QUERY_COMPONENT_LENGTH
                    || is_sensitive_parameter_name(key)
                    || (value.as_ref() != self.stable_id && is_sensitive_parameter_value(value))
            })
        {
            return false;
        }
        match self.platform.as_str() {
            "xiaohongshu" => {
                self.effective_part.is_none()
                    && parsed.query().is_none()
                    && parsed.path().strip_prefix("/explore/") == Some(self.stable_id.as_str())
            }
            "douyin" => {
                self.effective_part.is_none()
                    && parsed.query().is_none()
                    && parsed.path().strip_prefix("/video/") == Some(self.stable_id.as_str())
            }
            "bilibili" => {
                if parsed.path().strip_prefix("/video/") != Some(self.stable_id.as_str()) {
                    return false;
                }
                match self.effective_part {
                    Some(1) => parsed.query().is_none(),
                    Some(part) if part > 1 => {
                        query_pairs.len() == 1
                            && query_pairs[0].0 == "p"
                            && query_pairs[0].1 == part.to_string()
                    }
                    _ => false,
                }
            }
            "youtube" => {
                self.effective_part.is_none()
                    && parsed.path() == "/watch"
                    && query_pairs.len() == 1
                    && query_pairs[0].0 == "v"
                    && query_pairs[0].1 == self.stable_id.as_str()
            }
            _ => false,
        }
    }

    pub(crate) fn equality_key(&self) -> Option<(&str, &str, Option<u64>)> {
        self.is_safe().then_some((
            self.platform.as_str(),
            self.stable_id.as_str(),
            self.effective_part,
        ))
    }
}

fn platform_stable_id_is_valid(platform: &str, stable_id: &str) -> bool {
    match platform {
        "xiaohongshu" => {
            stable_id.len() == 24
                && stable_id
                    .chars()
                    .all(|ch| ch.is_ascii_digit() || matches!(ch, 'a'..='f'))
        }
        "douyin" => {
            (15..=24).contains(&stable_id.len()) && stable_id.chars().all(|ch| ch.is_ascii_digit())
        }
        "bilibili" => {
            (stable_id.len() == 12
                && stable_id.starts_with("BV")
                && stable_id[2..].chars().all(|ch| ch.is_ascii_alphanumeric()))
                || (stable_id.strip_prefix("av").is_some_and(|digits| {
                    (1..=20).contains(&digits.len()) && digits.chars().all(|ch| ch.is_ascii_digit())
                }))
        }
        "youtube" => {
            stable_id.len() == 11
                && stable_id
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
        }
        _ => false,
    }
}

fn is_sensitive_parameter_name(value: &str) -> bool {
    let normalized = value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    normalized.contains("token")
        || normalized.contains("signature")
        || matches!(normalized.as_str(), "s" | "sig")
        || normalized.contains("auth")
        || normalized.contains("cookie")
        || normalized.contains("session")
        || normalized.contains("credential")
        || normalized.contains("password")
        || normalized.contains("secret")
        || normalized == "key"
        || normalized.ends_with("key")
}

fn is_sensitive_parameter_value(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    normalized.contains("secret")
        || normalized.contains("bearer")
        || normalized.contains("xsec_token")
        || normalized.contains("access_token")
        || normalized.contains("signature=")
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct TaskManifestError {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) stage: String,
}

impl TaskManifestError {
    pub(crate) fn safe_code(&self) -> String {
        let is_safe = !self.code.is_empty()
            && self.code.len() <= 64
            && self.code.chars().enumerate().all(|(index, ch)| {
                if index == 0 {
                    ch.is_ascii_uppercase()
                } else {
                    ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_'
                }
            });
        if is_safe {
            self.code.clone()
        } else {
            "TASK_FAILED".to_string()
        }
    }

    pub(crate) fn safe_message(&self) -> String {
        let normalized = self.message.to_ascii_lowercase();
        if normalized.contains("http://")
            || normalized.contains("https://")
            || normalized.contains("token")
            || normalized.contains("signature")
            || normalized.contains("authorization")
            || normalized.contains("cookie")
            || normalized.contains("credential")
            || normalized.contains("password")
            || normalized.contains("secret")
            || normalized.contains("session")
        {
            format!("Previous task failed ({}).", self.safe_code())
        } else {
            self.message.clone()
        }
    }
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
    #[serde(default)]
    pub(crate) source_privacy_migration_version: u64,
    #[serde(default)]
    pub(crate) source_privacy_quarantined: bool,
    pub(crate) task_id: String,
    pub(crate) created_at: String,
    #[serde(default)]
    pub(crate) updated_at: Option<String>,
    #[serde(default)]
    pub(crate) source_url: String,
    #[serde(default)]
    pub(crate) source_identity: Option<SourceIdentity>,
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
    #[serde(flatten)]
    pub(crate) extra: HashMap<String, serde_json::Value>,
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
    pub(crate) fn safe_source_identity(&self) -> Option<&SourceIdentity> {
        if self.source_privacy_quarantined
            || self.schema_version != TASK_SCHEMA_VERSION
            || self.source_privacy_migration_version != SOURCE_PRIVACY_MIGRATION_VERSION
        {
            return None;
        }
        self.source_identity
            .as_ref()
            .filter(|identity| identity.is_safe() && self.source_url == identity.canonical_url)
    }

    pub(crate) fn safe_source_url(&self) -> &str {
        self.safe_source_identity()
            .map(|identity| identity.canonical_url.as_str())
            .unwrap_or("")
    }

    pub(crate) fn safe_artifacts(&self) -> HashMap<String, String> {
        self.artifacts
            .iter()
            .filter(|(key, raw_path)| validate_relative_artifact_path(raw_path, key).is_ok())
            .map(|(key, raw_path)| (key.clone(), raw_path.clone()))
            .collect()
    }

    pub(crate) fn source_privacy_ready(&self) -> bool {
        self.schema_version == TASK_SCHEMA_VERSION
            && self.source_privacy_migration_version == SOURCE_PRIVACY_MIGRATION_VERSION
            && !self.source_privacy_quarantined
            && self.safe_source_identity().is_some()
    }

    pub(crate) fn transcript_metadata(&self) -> Option<TranscriptMetadata> {
        self.transcript.clone()
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
    validate_storage_entry(&task_dir, true, "task directory")?;
    let manifest_path = task_dir.join(TASK_MANIFEST_FILE_NAME);
    validate_storage_entry(&manifest_path, false, "task manifest")?;
    let content = fs::read_to_string(&manifest_path)
        .map_err(|_| "Failed to read task manifest.".to_string())?;
    let manifest: TaskManifest =
        serde_json::from_str(&content).map_err(|_| "Failed to parse task manifest.".to_string())?;
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
    for entry in
        fs::read_dir(tasks_dir).map_err(|_| "Failed to read task storage directory.".to_string())?
    {
        let entry = entry.map_err(|_| "Failed to inspect task storage entry.".to_string())?;
        let task_dir = entry.path();
        let Ok(task_metadata) = fs::symlink_metadata(&task_dir) else {
            continue;
        };
        if !task_metadata.is_dir() || is_link_or_reparse_point(&task_metadata) {
            continue;
        }
        let manifest_path = task_dir.join(TASK_MANIFEST_FILE_NAME);
        let Ok(manifest_metadata) = fs::symlink_metadata(&manifest_path) else {
            continue;
        };
        if manifest_metadata.is_file() && !is_link_or_reparse_point(&manifest_metadata) {
            paths.push(manifest_path);
        }
    }
    Ok(paths)
}

pub(crate) fn read_task_manifest_path(path: &Path) -> Result<(TaskManifest, PathBuf), String> {
    validate_storage_entry(path, false, "task manifest")?;
    let content =
        fs::read_to_string(path).map_err(|_| "Failed to read task manifest.".to_string())?;
    let manifest: TaskManifest =
        serde_json::from_str(&content).map_err(|_| "Failed to parse task manifest.".to_string())?;
    let task_dir = path
        .parent()
        .ok_or_else(|| "Task manifest has no parent directory.".to_string())?
        .to_path_buf();
    validate_storage_entry(&task_dir, true, "task directory")?;
    Ok((manifest, task_dir))
}

pub(crate) fn write_task_manifest(task_dir: &Path, manifest: &TaskManifest) -> Result<(), String> {
    fs::write(
        task_dir.join(TASK_MANIFEST_FILE_NAME),
        serde_json::to_string_pretty(manifest)
            .map_err(|_| "Failed to encode task manifest.".to_string())?
            + "\n",
    )
    .map_err(|_| "Failed to save task manifest.".to_string())
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
    _field: &str,
) -> Result<(), String> {
    let task_dir = task_dir
        .canonicalize()
        .map_err(|_| "Failed to resolve task directory.".to_string())?;
    let path = path
        .canonicalize()
        .map_err(|_| "Failed to resolve requested task artifact.".to_string())?;
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
    fs::create_dir_all(parent).map_err(|_| "Failed to create artifact directory.".to_string())?;

    let task_dir = task_dir
        .canonicalize()
        .map_err(|_| "Failed to resolve task directory.".to_string())?;
    let parent = parent
        .canonicalize()
        .map_err(|_| "Failed to resolve artifact directory.".to_string())?;
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
    if !SAFE_ARTIFACT_KEYS.contains(&field) {
        return Err("Task manifest contains an unsupported artifact field.".to_string());
    }
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} artifact path cannot be empty."));
    }
    let path = PathBuf::from(trimmed);
    let normalized = trimmed.to_ascii_lowercase();
    let contains_sensitive_material = normalized.contains("://")
        || normalized.contains("xsec_token")
        || normalized.contains("token=")
        || normalized.contains("signature")
        || normalized.contains("authorization")
        || normalized.contains("credential")
        || normalized.contains("password")
        || normalized.contains("secret")
        || normalized.contains("session")
        || normalized.contains("cookie");
    if path.is_absolute() || has_forbidden_component(&path) || contains_sensitive_material {
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

fn validate_storage_entry(path: &Path, expect_directory: bool, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| format!("Failed to inspect {label}."))?;
    if is_link_or_reparse_point(&metadata) {
        return Err(format!("Refusing to use linked {label}."));
    }
    if expect_directory && !metadata.is_dir() {
        return Err(format!("{label} is not a directory."));
    }
    if !expect_directory && !metadata.is_file() {
        return Err(format!("{label} is not a file."));
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::{
        parse_insight_view, validate_task_artifact_path, SourceIdentity, TaskManifest,
        TaskManifestError,
    };
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn task_error_code_and_message_never_echo_source_credentials() {
        let error = TaskManifestError {
            code: "xsec_token=review-secret".to_string(),
            message: "failed https://example.test/?xsec_token=review-secret".to_string(),
            stage: "video_extracting".to_string(),
        };

        assert_eq!(error.safe_code(), "TASK_FAILED");
        let message = error.safe_message();
        assert!(!message.contains("review-secret"));
        assert!(!message.contains("xsec_token"));
    }

    #[test]
    fn safe_source_identity_requires_current_schema_marker_and_matching_source_url() {
        let base = json!({
            "schema_version": 3,
            "source_privacy_migration_version": 2,
            "task_id": "task",
            "created_at": "2026-07-10T12:00:00Z",
            "source_url": "https://www.youtube.com/watch?v=abcDEF_123-",
            "source_identity": {
                "version": 1,
                "platform": "youtube",
                "stable_id": "abcDEF_123-",
                "effective_part": null,
                "canonical_url": "https://www.youtube.com/watch?v=abcDEF_123-"
            },
            "status": "completed"
        });
        let ready: TaskManifest = serde_json::from_value(base.clone()).expect("ready manifest");
        assert!(ready.safe_source_identity().is_some());

        let mut missing_marker = base.clone();
        missing_marker["source_privacy_migration_version"] = json!(0);
        let missing_marker: TaskManifest =
            serde_json::from_value(missing_marker).expect("manifest without marker");
        assert!(missing_marker.safe_source_identity().is_none());

        let mut legacy_schema = base.clone();
        legacy_schema["schema_version"] = json!(2);
        let legacy_schema: TaskManifest =
            serde_json::from_value(legacy_schema).expect("legacy manifest");
        assert!(legacy_schema.safe_source_identity().is_none());
        assert!(!legacy_schema.source_privacy_ready());

        let mut mismatched = base;
        mismatched["source_url"] =
            json!("https://www.youtube.com/watch?v=abcDEF_123-&signature=review-secret");
        let mismatched: TaskManifest =
            serde_json::from_value(mismatched).expect("mismatched manifest");
        assert!(mismatched.safe_source_identity().is_none());
    }

    #[test]
    fn source_identity_accepts_only_canonical_query_contract() {
        let identity = SourceIdentity {
            version: 1,
            platform: "youtube".to_string(),
            stable_id: "abcDEF_123-".to_string(),
            effective_part: None,
            canonical_url: "https://www.youtube.com/watch?v=abcDEF_123-".to_string(),
        };
        assert!(identity.is_safe());

        let noncanonical_path = SourceIdentity {
            canonical_url: "https://www.youtube.com/shorts/abcDEF_123-".to_string(),
            ..identity.clone()
        };
        assert!(!noncanonical_path.is_safe());

        let extra_query = SourceIdentity {
            canonical_url: "https://www.youtube.com/watch?v=abcDEF_123-&feature=share".to_string(),
            ..identity.clone()
        };
        assert!(!extra_query.is_safe());

        let youtube_with_part = SourceIdentity {
            effective_part: Some(2),
            ..identity.clone()
        };
        assert!(!youtube_with_part.is_safe());

        let sensitive = SourceIdentity {
            canonical_url: "https://www.youtube.com/watch?v=abcDEF_123-&signature=review-secret"
                .to_string(),
            ..identity.clone()
        };
        assert!(!sensitive.is_safe());

        let abbreviated_signature = SourceIdentity {
            canonical_url: "https://www.youtube.com/shorts/abcDEF_123-?s=review-secret".to_string(),
            ..identity.clone()
        };
        assert!(!abbreviated_signature.is_safe());

        let suspicious_value = SourceIdentity {
            canonical_url: "https://www.youtube.com/shorts/abcDEF_123-?source=review-secret"
                .to_string(),
            ..identity.clone()
        };
        assert!(!suspicious_value.is_safe());

        let wrong_host = SourceIdentity {
            canonical_url: "https://youtube.example/shorts/abcDEF_123-".to_string(),
            ..identity
        };
        assert!(!wrong_host.is_safe());

        let forged_xhs = SourceIdentity {
            version: 1,
            platform: "xiaohongshu".to_string(),
            stable_id: "xsec_token-review-secret".to_string(),
            effective_part: None,
            canonical_url: ("https://www.xiaohongshu.com/explore/xsec_token-review-secret")
                .to_string(),
        };
        assert!(!forged_xhs.is_safe());

        let bilibili_part = SourceIdentity {
            version: 1,
            platform: "bilibili".to_string(),
            stable_id: "BV1Aa411c7mD".to_string(),
            effective_part: Some(2),
            canonical_url: "https://www.bilibili.com/video/BV1Aa411c7mD?p=2".to_string(),
        };
        assert!(bilibili_part.is_safe());

        let mismatched_part = SourceIdentity {
            effective_part: Some(3),
            ..bilibili_part.clone()
        };
        assert!(!mismatched_part.is_safe());

        let part_one_query = SourceIdentity {
            effective_part: Some(1),
            canonical_url: "https://www.bilibili.com/video/BV1Aa411c7mD?p=1".to_string(),
            ..bilibili_part.clone()
        };
        assert!(!part_one_query.is_safe());

        let xiaohongshu_query = SourceIdentity {
            version: 1,
            platform: "xiaohongshu".to_string(),
            stable_id: "64a1b2c3d4e5f67890123456".to_string(),
            effective_part: None,
            canonical_url: "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456?foo=bar"
                .to_string(),
        };
        assert!(!xiaohongshu_query.is_safe());
    }

    #[test]
    fn manifest_round_trip_preserves_unknown_fields() {
        let value = json!({
            "schema_version": 3,
            "source_privacy_migration_version": 2,
            "task_id": "task",
            "created_at": "2026-07-10T12:00:00Z",
            "source_url": "",
            "status": "completed",
            "future_worker_field": {"enabled": true}
        });
        let manifest: TaskManifest = serde_json::from_value(value).expect("manifest");
        let encoded = serde_json::to_value(manifest).expect("encoded manifest");
        assert_eq!(encoded["future_worker_field"]["enabled"], true);
    }

    #[test]
    fn artifact_resolution_errors_never_echo_untrusted_field_or_path_material() {
        let task_dir = temp_dir("safe-artifact-resolution-error");
        let missing = task_dir.join("review-secret").join("missing.txt");

        let error = validate_task_artifact_path(&task_dir, &missing, "xsec_token=review-secret")
            .expect_err("missing artifact must fail");

        assert!(!error.contains("review-secret"));
        assert!(!error.contains("xsec_token"));
        assert!(!error.contains("missing.txt"));
    }

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

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("frameq-{name}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }
}
