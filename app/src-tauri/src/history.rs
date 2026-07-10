use crate::{
    ensure_runtime_dirs, migrate_legacy_source_data_if_needed, resolve_runtime_paths, task_manifest,
};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub(crate) struct HistoryErrorView {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) stage: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub(crate) struct HistoryItemView {
    pub(crate) task_id: String,
    pub(crate) id: String,
    pub(crate) created_at: String,
    pub(crate) url: String,
    pub(crate) source_url: String,
    pub(crate) status: String,
    pub(crate) task_dir: String,
    pub(crate) output_dir: String,
    pub(crate) artifacts: HashMap<String, String>,
    pub(crate) error: Option<HistoryErrorView>,
    pub(crate) text_preview: String,
    pub(crate) insights_count: usize,
    pub(crate) text: String,
    pub(crate) summary: String,
    pub(crate) transcript: Option<task_manifest::TranscriptMetadata>,
    pub(crate) insights: Vec<task_manifest::InsightView>,
}

#[tauri::command]
pub(crate) fn get_history(app: AppHandle) -> Result<Vec<HistoryItemView>, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let output_root = task_manifest::configured_output_root(&paths)?;
    let _ = migrate_legacy_source_data_if_needed(&paths);
    load_history_from_output_root(&output_root)
}

pub(crate) fn load_history_from_output_root(
    output_root: &Path,
) -> Result<Vec<HistoryItemView>, String> {
    let mut items = Vec::new();
    for manifest_path in task_manifest::list_task_manifest_paths(output_root)? {
        match history_item_from_manifest_path(output_root, &manifest_path) {
            Ok(Some(item)) => items.push(item),
            Ok(None) => continue,
            Err(error) if is_isolatable_manifest_read_error(&error) => continue,
            Err(error) => return Err(error),
        }
    }
    items.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(items)
}

fn is_isolatable_manifest_read_error(error: &str) -> bool {
    matches!(
        error,
        "Failed to read task manifest." | "Failed to parse task manifest."
    )
}

fn history_item_from_manifest_path(
    output_root: &Path,
    manifest_path: &Path,
) -> Result<Option<HistoryItemView>, String> {
    let (manifest, task_dir) = task_manifest::read_task_manifest_path(manifest_path)?;
    if manifest.task_id.trim().is_empty()
        || manifest.source_privacy_quarantined
        || !manifest.source_privacy_ready()
    {
        return Ok(None);
    }

    let text = read_text_artifact(&task_dir, &manifest, "transcript_txt")?.unwrap_or_default();
    let summary = read_text_artifact(&task_dir, &manifest, "summary")?.unwrap_or_default();
    let insights = read_insights_artifact(&task_dir, &manifest)?;
    let transcript = manifest.transcript_metadata();
    let artifacts = manifest.safe_artifacts();

    let safe_source_url = manifest.safe_source_url().to_string();
    Ok(Some(HistoryItemView {
        task_id: manifest.task_id.clone(),
        id: manifest.task_id,
        created_at: manifest.created_at,
        url: safe_source_url.clone(),
        source_url: safe_source_url,
        status: manifest.status,
        task_dir: task_manifest::path_to_frontend_string(&task_dir),
        output_dir: task_manifest::path_to_frontend_string(output_root),
        artifacts,
        error: manifest.error.map(|error| {
            let code = error.safe_code();
            let message = error.safe_message();
            HistoryErrorView {
                code,
                message,
                stage: error.stage,
            }
        }),
        text_preview: manifest.text_preview,
        insights_count: manifest.insights_count,
        text,
        summary,
        transcript,
        insights,
    }))
}

fn read_text_artifact(
    task_dir: &Path,
    manifest: &task_manifest::TaskManifest,
    key: &str,
) -> Result<Option<String>, String> {
    let Some(path) = task_manifest::artifact_path(task_dir, manifest, key)? else {
        return Ok(None);
    };
    task_manifest::validate_task_artifact_path(task_dir, &path, key)?;
    Ok(fs::read_to_string(path)
        .ok()
        .map(|text| text.trim().to_string()))
}

fn read_insights_artifact(
    task_dir: &Path,
    manifest: &task_manifest::TaskManifest,
) -> Result<Vec<task_manifest::InsightView>, String> {
    let Some(path) = task_manifest::artifact_path(task_dir, manifest, "insights")? else {
        return Ok(vec![]);
    };
    if !path.exists() {
        return Ok(vec![]);
    }
    task_manifest::validate_task_artifact_path(task_dir, &path, "insights")?;
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(vec![]);
    };
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Ok(vec![]);
    };
    Ok(task_manifest::parse_insights_payload(&payload))
}

#[cfg(test)]
mod tests {
    use super::load_history_from_output_root;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn load_history_from_output_root_reads_task_manifests() {
        let output_root = temp_dir("history_from_manifests");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
        fs::create_dir_all(task_dir.join("ai")).expect("create ai dir");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "full transcript\n",
        )
        .expect("write transcript");
        fs::write(task_dir.join("ai").join("summary.md"), "# summary\n").expect("write summary");
        fs::write(
            task_dir.join("ai").join("insights.json"),
            r#"{"schemaVersion":1,"insights":[{"id":1,"topic":"first topic","matchReason":"matched","followUpQuestions":["next question"],"suitableUse":"content planning","sourceChunkId":7}]}"#,
        )
        .expect("write insights");
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
    "transcript_txt": "transcript/transcript.txt",
    "summary": "ai/summary.md",
    "insights": "ai/insights.json",
    "debug_url": "https://example.test/?xsec_token=review-secret"
  }},
  "error": null,
  "text_preview": "full transcript",
  "insights_count": 1
}}"#
            ),
        )
        .expect("write manifest");

        let history = load_history_from_output_root(&output_root).expect("load history");

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].task_id, task_id);
        assert_eq!(
            history[0].url,
            "https://www.douyin.com/video/7645505408425004329"
        );
        assert_eq!(history[0].text, "full transcript");
        assert_eq!(history[0].summary, "# summary");
        assert_eq!(history[0].insights[0].topic, "first topic");
        assert_eq!(history[0].insights[0].match_reason, "matched");
        assert_eq!(
            history[0].insights[0].follow_up_questions,
            vec!["next question"]
        );
        assert_eq!(history[0].insights[0].source_chunk_id, Some(7));
        assert_eq!(history[0].artifacts["summary"], "ai/summary.md");
        assert!(!history[0].artifacts.contains_key("debug_url"));
        assert!(!serde_json::to_string(&history)
            .expect("serialize history")
            .contains("review-secret"));
    }

    #[test]
    fn load_history_never_returns_sensitive_legacy_source_url() {
        let output_root = temp_dir("history_redacts_sensitive_legacy_source");
        let task_id = "20260710-120000-xiaohongshu-legacy";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(&task_dir).expect("create task dir");
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
  "artifacts": {{}},
  "error": {{
    "code": "VIDEO_DOWNLOAD_FAILED",
    "message": "failed https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456?xsec_token=review-secret",
    "stage": "video_extracting"
  }},
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");

        let history = load_history_from_output_root(&output_root).expect("load history");

        assert!(history.is_empty());
        let serialized = serde_json::to_string(&history).expect("serialize history");
        assert!(!serialized.contains("review-secret"));
        assert!(!serialized.contains("xsec_token"));
    }

    #[test]
    fn load_history_skips_corrupt_manifest_without_hiding_valid_tasks() {
        let output_root = temp_dir("history_skips_corrupt_manifest");
        let corrupt_dir = output_root.join("tasks").join("corrupt-task");
        fs::create_dir_all(&corrupt_dir).expect("create corrupt task");
        fs::write(corrupt_dir.join("frameq-task.json"), b"{not-json")
            .expect("write corrupt manifest");

        let valid_task_id = "20260710-120000-douyin-7645505408425004329";
        let valid_task_dir = output_root.join("tasks").join(valid_task_id);
        fs::create_dir_all(valid_task_dir.join("transcript")).expect("create valid task");
        fs::write(
            valid_task_dir.join("transcript").join("transcript.txt"),
            "valid transcript\n",
        )
        .expect("write valid transcript");
        fs::write(
            valid_task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 3,
  "source_privacy_migration_version": 2,
  "source_privacy_quarantined": false,
  "task_id": "{valid_task_id}",
  "created_at": "2026-07-10T12:00:00Z",
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
  "artifacts": {{"transcript_txt": "transcript/transcript.txt"}},
  "error": null,
  "text_preview": "valid transcript",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write valid manifest");

        let history = load_history_from_output_root(&output_root)
            .expect("corrupt manifest should be isolated");

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].task_id, valid_task_id);
    }

    #[test]
    fn load_history_hides_ai_artifacts_until_source_privacy_is_ready() {
        let output_root = temp_dir("history_hides_ai_until_source_privacy_ready");
        let task_id = "20260710-120000-xiaohongshu-incomplete";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("ai")).expect("create ai dir");
        fs::write(
            task_dir.join("ai").join("summary.md"),
            "secret summary review-secret",
        )
        .expect("write summary");
        fs::write(
            task_dir.join("ai").join("insights.json"),
            r#"{"schemaVersion":1,"insights":[{"id":1,"topic":"review-secret","matchReason":"matched","followUpQuestions":["next"],"suitableUse":"planning","sourceChunkId":1}]}"#,
        )
        .expect("write insights");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 3,
  "source_privacy_migration_version": 0,
  "task_id": "{task_id}",
  "created_at": "2026-07-10T12:00:00Z",
  "source_url": "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456?xsec_token=review-secret",
  "platform": "xiaohongshu",
  "status": "completed",
  "artifacts": {{
    "summary": "ai/summary.md",
    "insights": "ai/insights.json"
  }},
  "error": null,
  "text_preview": "",
  "insights_count": 1
}}"#
            ),
        )
        .expect("write manifest");

        let history = load_history_from_output_root(&output_root).expect("load history");

        assert!(history.is_empty());
        let serialized = serde_json::to_string(&history).expect("serialize history");
        assert!(!serialized.contains("review-secret"));
        assert!(!serialized.contains("xsec_token"));
    }

    #[test]
    fn load_history_skips_quarantined_tasks() {
        let output_root = temp_dir("history_skips_quarantined_tasks");
        let task_id = "20260710-120000-xiaohongshu-review-secret";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(&task_dir).expect("create task dir");
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
  "artifacts": {{}},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");

        let history = load_history_from_output_root(&output_root).expect("load history");

        assert!(history.is_empty());
    }

    #[test]
    fn load_history_rejects_artifact_path_traversal() {
        let output_root = temp_dir("history_rejects_traversal");
        let task_id = "20260705-153012-source-demo";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(&task_dir).expect("create task dir");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 3,
  "source_privacy_migration_version": 2,
  "task_id": "{task_id}",
  "created_at": "2026-07-05T15:30:12Z",
  "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "source_identity": {{
    "version": 1,
    "platform": "youtube",
    "stable_id": "dQw4w9WgXcQ",
    "effective_part": null,
    "canonical_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }},
  "status": "completed",
  "artifacts": {{"transcript_txt": "../outside.txt"}},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");

        assert!(load_history_from_output_root(&output_root).is_err());
    }

    #[test]
    fn load_history_ignores_insights_without_v1_schema() {
        let output_root = temp_dir("history_ignores_insights_without_schema");
        let task_id = "20260705-153012-source-demo";
        write_task_with_insights_payload(
            &output_root,
            task_id,
            r#"{"insights":[{"id":1,"topic":"first topic","matchReason":"matched","followUpQuestions":["next question"],"suitableUse":"content planning","sourceChunkId":7}]}"#,
        );

        let history = load_history_from_output_root(&output_root).expect("load history");

        assert_eq!(history.len(), 1);
        assert!(history[0].insights.is_empty());
    }

    #[test]
    fn load_history_ignores_insights_when_any_item_is_invalid() {
        let output_root = temp_dir("history_ignores_invalid_insight_item");
        let task_id = "20260705-153012-source-demo";
        write_task_with_insights_payload(
            &output_root,
            task_id,
            r#"{"schemaVersion":1,"insights":[{"id":1,"topic":"first topic","matchReason":"matched","followUpQuestions":["next question"],"suitableUse":"content planning","sourceChunkId":7},{"id":2,"topic":"second topic","followUpQuestions":["next question"],"suitableUse":"content planning","sourceChunkId":8}]}"#,
        );

        let history = load_history_from_output_root(&output_root).expect("load history");

        assert_eq!(history.len(), 1);
        assert!(history[0].insights.is_empty());
    }

    fn write_task_with_insights_payload(
        output_root: &PathBuf,
        task_id: &str,
        insights_payload: &str,
    ) {
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("ai")).expect("create ai dir");
        fs::write(task_dir.join("ai").join("insights.json"), insights_payload)
            .expect("write insights");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 3,
  "source_privacy_migration_version": 2,
  "task_id": "{task_id}",
  "created_at": "2026-07-05T15:30:12Z",
  "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "source_identity": {{
    "version": 1,
    "platform": "youtube",
    "stable_id": "dQw4w9WgXcQ",
    "effective_part": null,
    "canonical_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }},
  "platform": "youtube",
  "status": "completed",
  "artifacts": {{"insights": "ai/insights.json"}},
  "error": null,
  "text_preview": "",
  "insights_count": 1
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
