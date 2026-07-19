use super::{ProcessVideoResult, WorkerError};
use crate::task_manifest;
use crate::worker_runtime::TaskTerminalResult;
use std::path::Path;

pub(super) fn cached_process_result_for_url(
    output_root: &Path,
    requested_source_url: &str,
    asr_model: &str,
) -> Result<Option<TaskTerminalResult>, String> {
    let requested_source_url = requested_source_url.trim();
    if requested_source_url.is_empty() {
        return Ok(None);
    }

    cached_process_result(output_root, Some(requested_source_url), None, asr_model)
}

pub(super) fn cached_process_result_for_identity(
    output_root: &Path,
    requested_identity: &task_manifest::SourceIdentity,
    asr_model: &str,
) -> Result<Option<TaskTerminalResult>, String> {
    cached_process_result(output_root, None, Some(requested_identity), asr_model)
}

fn cached_process_result(
    output_root: &Path,
    requested_source_url: Option<&str>,
    requested_identity: Option<&task_manifest::SourceIdentity>,
    asr_model: &str,
) -> Result<Option<TaskTerminalResult>, String> {
    let mut newest_cached: Option<(String, TaskTerminalResult)> = None;
    for task in task_manifest::SupportedTask::scan(output_root)?.into_tasks() {
        if !reusable_task_matches(&task, requested_source_url, requested_identity, asr_model) {
            continue;
        }
        let Some((created_at, cached)) = cached_process_result_from_task(task)? else {
            continue;
        };
        if newest_cached
            .as_ref()
            .is_none_or(|(current_created_at, _)| created_at > *current_created_at)
        {
            newest_cached = Some((created_at, cached));
        }
    }

    Ok(newest_cached.map(|(_, value)| value))
}

fn reusable_task_matches(
    task: &task_manifest::SupportedTask,
    requested_source_url: Option<&str>,
    requested_identity: Option<&task_manifest::SourceIdentity>,
    asr_model: &str,
) -> bool {
    if !matches!(task.status(), "completed" | "partial_completed") {
        return false;
    }
    let source_matches = match requested_identity {
        Some(identity) => {
            identity.is_safe()
                && task
                    .source_identity()
                    .and_then(task_manifest::SourceIdentity::equality_key)
                    == identity.equality_key()
        }
        None => requested_source_url.is_some_and(|source_url| task.safe_source_url() == source_url),
    };
    if !source_matches {
        return false;
    }
    let manifest_model = task.model().trim();
    let request_model = asr_model.trim();
    manifest_model.is_empty() || request_model.is_empty() || manifest_model == request_model
}

fn cached_process_result_from_task(
    task: task_manifest::SupportedTask,
) -> Result<Option<(String, TaskTerminalResult)>, String> {
    let artifacts = task.existing_artifacts();
    if !artifacts.contains_key("transcript_txt") {
        return Ok(None);
    }

    let text = task
        .read_text_artifact(task_manifest::TaskArtifact::TranscriptTxt)?
        .unwrap_or_default();
    let summary = if artifacts.contains_key("summary") {
        task.read_text_artifact(task_manifest::TaskArtifact::Summary)?
            .unwrap_or_default()
    } else {
        String::new()
    };
    let insights = task.read_insights()?;
    let transcript = task.transcript_metadata();
    let status = task.status().to_string();
    let task_id = task.task_id().to_string();
    let created_at = task.created_at().to_string();
    let error = task.safe_error().map(|error| WorkerError {
        code: error.code,
        message: error.message,
        stage: error.stage,
    });

    let value = serde_json::json!(ProcessVideoResult {
        status,
        task_id: Some(task_id),
        task_dir: Some(task.task_dir_frontend_string()),
        artifacts,
        text,
        summary,
        insights,
        transcript,
        error,
    });
    let Ok(result) = TaskTerminalResult::from_value(value) else {
        return Ok(None);
    };
    Ok(Some((created_at, result)))
}

#[cfg(test)]
mod tests {
    use super::{cached_process_result_for_identity, cached_process_result_for_url};
    use crate::worker_runtime::TaskTerminalResult;
    use crate::{path_to_env_string, task_manifest::SourceIdentity};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    const ASR_MODEL: &str = "iic/SenseVoiceSmall";

    fn task_value(result: &TaskTerminalResult) -> serde_json::Value {
        serde_json::to_value(result).expect("serialize closed task result")
    }

    #[test]
    fn cached_process_result_reuses_completed_task_for_same_source_url() {
        let output_root = temp_dir("cached_process_result_reuses_completed_task");
        let task_id = "20260705-153012-youtube-dQw4w9WgXcQ";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
        fs::create_dir_all(task_dir.join("ai")).expect("create ai dir");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "cached transcript\n",
        )
        .expect("write transcript");
        fs::write(task_dir.join("ai").join("summary.md"), "# cached summary\n")
            .expect("write summary");
        fs::write(
            task_dir.join("ai").join("insights.json"),
            r#"{"schemaVersion":1,"insights":[{"id":1,"topic":"cached topic","matchReason":"matched","followUpQuestions":["next question"],"suitableUse":"content planning","sourceChunkId":3}]}"#,
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
  "model": "iic/SenseVoiceSmall",
  "transcript": {{
    "source": "subtitle",
    "language": "zh-Hans",
    "engine": null
  }},
  "artifacts": {{
    "transcript_txt": "transcript/transcript.txt",
    "summary": "ai/summary.md",
    "insights": "ai/insights.json"
  }},
  "error": null,
  "text_preview": "cached transcript",
  "insights_count": 1
}}"#
            ),
        )
        .expect("write manifest");

        let cached = cached_process_result_for_url(
            &output_root,
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            ASR_MODEL,
        )
        .expect("read cached result")
        .expect("same URL should reuse cached task");
        let cached = task_value(&cached);

        assert_eq!(cached["status"], "completed");
        assert_eq!(cached["task_id"], task_id);
        assert_eq!(
            cached["task_dir"],
            path_to_env_string(output_root.join("tasks").join(task_id))
        );
        assert_eq!(cached["text"], "cached transcript");
        assert_eq!(cached["summary"], "# cached summary");
        assert_eq!(cached["insights"][0]["topic"], "cached topic");
        assert_eq!(cached["insights"][0]["matchReason"], "matched");
        assert_eq!(cached["insights"][0]["sourceChunkId"], 3);
        assert_eq!(cached["transcript"]["source"], "subtitle");
        assert_eq!(cached["transcript"]["language"], "zh-Hans");
        assert!(cached["transcript"]["engine"].is_null());
    }

    #[test]
    fn cached_process_result_matches_sensitive_request_by_canonical_identity() {
        let output_root = temp_dir("cached_process_result_matches_canonical_identity");
        let note_id = "64a1b2c3d4e5f67890123456";
        let task_id = "20260710-120000-xiaohongshu-64a1b2c3d4e5f67890123456";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "cached transcript\n",
        )
        .expect("write transcript");
        let canonical_url = format!("https://www.xiaohongshu.com/explore/{note_id}");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 3,
  "source_privacy_migration_version": 2,
  "task_id": "{task_id}",
  "created_at": "2026-07-10T12:00:00Z",
  "source_url": "{canonical_url}",
  "source_identity": {{
    "version": 1,
    "platform": "xiaohongshu",
    "stable_id": "{note_id}",
    "effective_part": null,
    "canonical_url": "{canonical_url}"
  }},
  "platform": "xiaohongshu",
  "status": "completed",
  "model": "iic/SenseVoiceSmall",
  "artifacts": {{"transcript_txt": "transcript/transcript.txt"}},
  "error": null,
  "text_preview": "cached transcript",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");
        let sensitive_url = format!("{canonical_url}?xsec_token=review-secret&source=web");
        let identity = SourceIdentity {
            version: 1,
            platform: "xiaohongshu".to_string(),
            stable_id: note_id.to_string(),
            effective_part: None,
            canonical_url,
        };

        assert!(
            cached_process_result_for_url(&output_root, &sensitive_url, ASR_MODEL)
                .expect("exact lookup")
                .is_none()
        );
        let cached = cached_process_result_for_identity(&output_root, &identity, ASR_MODEL)
            .expect("canonical lookup")
            .expect("canonical identity should reuse cached task");
        let cached = task_value(&cached);

        assert_eq!(cached["task_id"], task_id);
        let serialized = cached.to_string();
        assert!(!serialized.contains("review-secret"));
        assert!(!serialized.contains("xsec_token"));
    }

    #[test]
    fn cached_process_result_never_reuses_quarantined_task() {
        let output_root = temp_dir("cached_process_result_rejects_quarantine");
        let task_id = "20260710-120000-xiaohongshu-review-secret";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "cached transcript\n",
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
  "source_url": "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456",
  "source_identity": {{
    "version": 1,
    "platform": "xiaohongshu",
    "stable_id": "64a1b2c3d4e5f67890123456",
    "effective_part": null,
    "canonical_url": "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456"
  }},
  "platform": "xiaohongshu",
  "status": "completed",
  "model": "iic/SenseVoiceSmall",
  "artifacts": {{"transcript_txt": "transcript/transcript.txt"}},
  "error": null,
  "text_preview": "cached transcript",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");

        assert!(cached_process_result_for_url(
            &output_root,
            "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456",
            ASR_MODEL,
        )
        .expect("cache lookup")
        .is_none());
    }

    #[test]
    fn cached_process_result_ignores_insights_without_v1_schema() {
        let output_root = temp_dir("cached_process_result_ignores_insights_without_schema");
        let task_id = "20260705-153012-youtube-dQw4w9WgXcQ";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
        fs::create_dir_all(task_dir.join("ai")).expect("create ai dir");
        fs::write(
            task_dir.join("transcript").join("transcript.txt"),
            "cached transcript\n",
        )
        .expect("write transcript");
        fs::write(task_dir.join("ai").join("summary.md"), "# cached summary\n")
            .expect("write summary");
        fs::write(
            task_dir.join("ai").join("insights.json"),
            r#"{"insights":[{"id":1,"topic":"cached topic","matchReason":"matched","followUpQuestions":["next question"],"suitableUse":"content planning","sourceChunkId":3}]}"#,
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
  "artifacts": {{
    "transcript_txt": "transcript/transcript.txt",
    "summary": "ai/summary.md",
    "insights": "ai/insights.json"
  }},
  "error": null,
  "text_preview": "cached transcript",
  "insights_count": 1
}}"#
            ),
        )
        .expect("write manifest");

        let cached = cached_process_result_for_url(
            &output_root,
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            ASR_MODEL,
        )
        .expect("read cached result")
        .expect("same URL should reuse cached task");
        let cached = task_value(&cached);

        assert_eq!(cached["status"], "completed");
        assert_eq!(cached["text"], "cached transcript");
        assert!(cached["insights"]
            .as_array()
            .expect("insights array")
            .is_empty());
    }

    #[test]
    fn cached_process_result_ignores_unusable_history_without_blocking_new_url() {
        let output_root = temp_dir("cached_process_result_ignores_unusable_history");
        let task_id = "20260705-153012-youtube-missing";
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(&task_dir).expect("create task dir");
        fs::write(
            task_dir.join("frameq-task.json"),
            format!(
                r#"{{
  "schema_version": 1,
  "task_id": "{task_id}",
  "created_at": "2026-07-05T15:30:12Z",
  "source_url": "https://www.youtube.com/watch?v=missing",
  "platform": "youtube",
  "status": "completed",
  "artifacts": {{
    "transcript_txt": "transcript/transcript.txt"
  }},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");

        let cached = cached_process_result_for_url(
            &output_root,
            "https://www.youtube.com/watch?v=new-video",
            ASR_MODEL,
        )
        .expect("broken history should not block processing");

        assert!(cached.is_none());
    }

    fn temp_dir(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("frameq-{test_name}-{unique}"));
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }
}
