use crate::{ensure_runtime_dirs, resolve_runtime_paths, task_manifest};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
pub(crate) struct LoadDraftDetailRequest {
    #[serde(alias = "taskId")]
    task_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SaveDraftEditRequest {
    #[serde(alias = "taskId")]
    task_id: String,
    markdown: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct DraftDetailView {
    task_id: String,
    markdown: String,
    has_original_backup: bool,
    draft_seed_insight_id: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct SaveDraftEditResult {
    task_id: String,
    markdown: String,
    artifacts: HashMap<String, String>,
    has_original_backup: bool,
}

#[tauri::command]
pub(crate) fn load_draft_detail(
    app: AppHandle,
    request: LoadDraftDetailRequest,
) -> Result<DraftDetailView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let output_root = task_manifest::configured_output_root(&paths)?;
    load_draft_detail_from_output_root(&output_root, request)
}

#[tauri::command]
pub(crate) fn save_draft_edit(
    app: AppHandle,
    request: SaveDraftEditRequest,
) -> Result<SaveDraftEditResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let output_root = task_manifest::configured_output_root(&paths)?;
    save_draft_edit_to_output_root(&output_root, request)
}

pub(crate) fn load_draft_detail_from_output_root(
    output_root: &Path,
    request: LoadDraftDetailRequest,
) -> Result<DraftDetailView, String> {
    let (manifest, task_dir) = task_manifest::load_task_manifest(output_root, &request.task_id)?;
    ensure_task_source_privacy_ready(&manifest)?;

    let draft_path = task_manifest::artifact_path(&task_dir, &manifest, "draft")?;
    let draft_path = match draft_path {
        Some(path) => path,
        None => {
            return Ok(DraftDetailView {
                task_id: request.task_id,
                markdown: String::new(),
                has_original_backup: false,
                draft_seed_insight_id: manifest.draft_seed_insight_id,
            });
        }
    };

    if draft_path.exists() {
        task_manifest::validate_task_artifact_path(&task_dir, &draft_path, "draft")?;
        reject_linked_artifact_target(&draft_path)?;
    }

    let markdown = fs::read_to_string(&draft_path)
        .map(|content| content.trim().to_string())
        .unwrap_or_default();
    let has_original_backup = original_backup_path(&draft_path).is_file();

    Ok(DraftDetailView {
        task_id: request.task_id,
        markdown,
        has_original_backup,
        draft_seed_insight_id: manifest.draft_seed_insight_id,
    })
}

pub(crate) fn save_draft_edit_to_output_root(
    output_root: &Path,
    request: SaveDraftEditRequest,
) -> Result<SaveDraftEditResult, String> {
    let text = request.markdown.trim();
    if text.is_empty() {
        return Err("Draft text cannot be empty.".to_string());
    }

    let (mut manifest, task_dir) =
        task_manifest::load_task_manifest(output_root, &request.task_id)?;
    ensure_task_source_privacy_ready(&manifest)?;
    let draft_path =
        task_manifest::required_artifact_path(&task_dir, &manifest, "draft")?;
    task_manifest::validate_task_artifact_path(&task_dir, &draft_path, "draft")?;
    reject_linked_artifact_target(&draft_path)?;

    task_manifest::ensure_artifact_parent(&task_dir, &draft_path)?;

    let backup_path = original_backup_path(&draft_path);
    task_manifest::ensure_artifact_parent(&task_dir, &backup_path)?;
    reject_linked_artifact_target(&backup_path)?;
    if !backup_path.exists() {
        fs::copy(&draft_path, &backup_path)
            .map_err(|_| "Failed to create draft backup.".to_string())?;
    }

    fs::write(&draft_path, format!("{text}\n"))
        .map_err(|_| "Failed to save draft.".to_string())?;

    manifest
        .artifacts
        .insert("draft".into(), "ai/draft.md".into());
    task_manifest::write_task_manifest(&task_dir, &manifest)?;

    Ok(SaveDraftEditResult {
        task_id: request.task_id,
        markdown: text.to_string(),
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

fn original_backup_path(path: &Path) -> PathBuf {
    let file_name = path.file_name().unwrap_or_default();
    path.parent()
        .unwrap_or_else(|| Path::new(""))
        .join("original")
        .join(file_name)
}

#[cfg(test)]
mod tests {
    use super::{
        load_draft_detail_from_output_root, save_draft_edit_to_output_root, LoadDraftDetailRequest,
        SaveDraftEditRequest,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn load_detail_reads_markdown_and_backup_status_and_seed_id() {
        let output_root = temp_dir("load_detail_reads_markdown");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("ai").join("draft.md"), "AI generated draft\n")
            .expect("write draft");
        write_manifest_with_draft(&task_dir, task_id, Some(42));

        let detail = load_draft_detail_from_output_root(
            &output_root,
            LoadDraftDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .expect("load detail");

        assert_eq!(detail.task_id, task_id);
        assert_eq!(detail.markdown, "AI generated draft");
        assert!(!detail.has_original_backup);
        assert_eq!(detail.draft_seed_insight_id, Some(42));
    }

    #[test]
    fn load_detail_returns_empty_view_when_draft_file_missing() {
        let output_root = temp_dir("load_detail_missing_draft_file");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        write_manifest_with_draft(&task_dir, task_id, None);

        let detail = load_draft_detail_from_output_root(
            &output_root,
            LoadDraftDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .expect("load detail even without draft file");

        assert_eq!(detail.markdown, "");
        assert!(!detail.has_original_backup);
        assert_eq!(detail.draft_seed_insight_id, None);
    }

    #[test]
    fn load_detail_returns_empty_view_when_manifest_has_no_draft_artifact() {
        let output_root = temp_dir("load_detail_no_draft_artifact");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        write_manifest(&task_dir, task_id);

        let detail = load_draft_detail_from_output_root(
            &output_root,
            LoadDraftDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .expect("load detail even without draft artifact");

        assert_eq!(detail.markdown, "");
        assert!(!detail.has_original_backup);
        assert_eq!(detail.draft_seed_insight_id, None);
    }

    #[test]
    fn load_detail_rejects_quarantined_tasks() {
        let output_root = temp_dir("load_detail_rejects_quarantined");
        let task_id = "20260710-120000-xiaohongshu-review-secret";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("ai").join("draft.md"), "AI draft\n").expect("write draft");
        write_quarantined_manifest(&task_dir, task_id);

        let error = load_draft_detail_from_output_root(
            &output_root,
            LoadDraftDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .expect_err("quarantined task must fail");
        assert!(error.contains("current history format"));
    }

    #[test]
    fn load_detail_rejects_legacy_format_tasks() {
        let output_root = temp_dir("load_detail_rejects_legacy");
        let task_id = "20260710-120000-xiaohongshu-legacy";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("ai").join("draft.md"), "AI draft\n").expect("write draft");
        write_legacy_manifest(&task_dir, task_id);

        let error = load_draft_detail_from_output_root(
            &output_root,
            LoadDraftDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .expect_err("legacy task must fail");
        assert!(error.contains("current history format"));
    }

    #[test]
    fn save_detail_writes_file_creates_original_and_updates_manifest() {
        let output_root = temp_dir("save_detail_writes_and_backs_up");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("ai").join("draft.md"), "original AI draft\n")
            .expect("write draft");
        write_manifest_with_draft(&task_dir, task_id, None);

        let result = save_draft_edit_to_output_root(
            &output_root,
            SaveDraftEditRequest {
                task_id: task_id.to_string(),
                markdown: "user edited draft".to_string(),
            },
        )
        .expect("save draft");

        assert_eq!(result.markdown, "user edited draft");
        assert!(result.has_original_backup);
        assert_eq!(
            fs::read_to_string(
                task_dir
                    .join("ai")
                    .join("original")
                    .join("draft.md")
            )
            .expect("read backup"),
            "original AI draft\n"
        );
        assert_eq!(
            fs::read_to_string(task_dir.join("ai").join("draft.md")).expect("read saved"),
            "user edited draft\n"
        );
        let manifest = fs::read_to_string(task_dir.join("frameq-task.json")).expect("read manifest");
        assert!(manifest.contains(r#""draft": "ai/draft.md""#));
    }

    #[test]
    fn save_detail_does_not_overwrite_original_on_second_save() {
        let output_root = temp_dir("save_detail_no_overwrite_original");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("ai").join("draft.md"), "original AI draft\n")
            .expect("write draft");
        write_manifest_with_draft(&task_dir, task_id, None);

        save_draft_edit_to_output_root(
            &output_root,
            SaveDraftEditRequest {
                task_id: task_id.to_string(),
                markdown: "first edit".to_string(),
            },
        )
        .expect("save first time");

        save_draft_edit_to_output_root(
            &output_root,
            SaveDraftEditRequest {
                task_id: task_id.to_string(),
                markdown: "second edit".to_string(),
            },
        )
        .expect("save second time");

        assert_eq!(
            fs::read_to_string(
                task_dir
                    .join("ai")
                    .join("original")
                    .join("draft.md")
            )
            .expect("read backup"),
            "original AI draft\n"
        );
    }

    #[test]
    fn save_detail_rejects_empty_markdown() {
        let output_root = temp_dir("save_detail_rejects_empty");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("ai").join("draft.md"), "original AI draft\n")
            .expect("write draft");
        write_manifest_with_draft(&task_dir, task_id, None);

        let error = save_draft_edit_to_output_root(
            &output_root,
            SaveDraftEditRequest {
                task_id: task_id.to_string(),
                markdown: "   ".to_string(),
            },
        )
        .expect_err("empty markdown must be rejected");

        assert!(error.contains("cannot be empty"));
        assert!(!task_dir.join("ai").join("original").exists());
        assert_eq!(
            fs::read_to_string(task_dir.join("ai").join("draft.md")).expect("read unchanged"),
            "original AI draft\n"
        );
    }

    #[test]
    fn save_detail_rejects_missing_draft_artifact() {
        let output_root = temp_dir("save_detail_rejects_no_artifact");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        write_manifest(&task_dir, task_id);

        let error = save_draft_edit_to_output_root(
            &output_root,
            SaveDraftEditRequest {
                task_id: task_id.to_string(),
                markdown: "edited text".to_string(),
            },
        )
        .expect_err("missing draft artifact must fail");

        assert!(error.contains("draft") || error.contains("artifact"));
    }

    #[test]
    fn save_detail_rejects_quarantined_tasks() {
        let output_root = temp_dir("save_detail_rejects_quarantined");
        let task_id = "20260710-120000-xiaohongshu-review-secret";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("ai").join("draft.md"), "AI draft\n").expect("write draft");
        write_quarantined_manifest_with_draft(&task_dir, task_id);

        let error = save_draft_edit_to_output_root(
            &output_root,
            SaveDraftEditRequest {
                task_id: task_id.to_string(),
                markdown: "edited".to_string(),
            },
        )
        .expect_err("quarantined save must fail");
        assert!(error.contains("current history format"));
        assert_eq!(
            fs::read_to_string(task_dir.join("ai").join("draft.md")).expect("read unchanged"),
            "AI draft\n"
        );
    }

    #[test]
    fn save_detail_rejects_linked_draft_file() {
        let output_root = temp_dir("save_detail_rejects_linked");
        let outside_dir = temp_dir("save_detail_outside");
        let task_id = "20260705-153012-douyin-7645505408425004329";
        let task_dir = create_task(&output_root, task_id);
        let outside_target = outside_dir.join("outside.md");
        fs::write(&outside_target, "external content\n").expect("write outside draft");
        let linked_draft = task_dir.join("ai").join("draft.md");
        if let Err(error) = create_file_symlink(&outside_target, &linked_draft) {
            eprintln!("skipping symlink regression; symlink creation is unavailable: {error}");
            return;
        }
        write_manifest_with_draft(&task_dir, task_id, None);

        let error = save_draft_edit_to_output_root(
            &output_root,
            SaveDraftEditRequest {
                task_id: task_id.to_string(),
                markdown: "edited".to_string(),
            },
        )
        .expect_err("linked draft must be rejected");

        assert!(error.contains("link") || error.contains("outside"));
        assert_eq!(
            fs::read_to_string(&outside_target).expect("read outside draft"),
            "external content\n"
        );
    }

    #[test]
    fn save_and_load_reject_path_traversal() {
        let output_root = temp_dir("draft_rejects_traversal");
        let task_id = "20260705-153012-source-demo";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("ai").join("draft.md"), "draft\n").expect("write draft");

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
    "draft": "../outside.txt"
  }},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write unsafe manifest");

        assert!(load_draft_detail_from_output_root(
            &output_root,
            LoadDraftDetailRequest {
                task_id: task_id.to_string(),
            },
        )
        .is_err());
    }

    #[test]
    fn save_detail_rejects_path_traversal_without_writing() {
        let output_root = temp_dir("draft_save_rejects_traversal");
        let task_id = "20260705-153012-douyin-traversal";
        let task_dir = create_task(&output_root, task_id);
        fs::write(task_dir.join("ai").join("draft.md"), "original\n").expect("write draft");

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
    "draft": "../outside.txt"
  }},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write unsafe manifest");

        let error = save_draft_edit_to_output_root(
            &output_root,
            SaveDraftEditRequest {
                task_id: task_id.to_string(),
                markdown: "should not be written".to_string(),
            },
        )
        .expect_err("save with path traversal must fail");

        assert!(error.contains("outside") || error.contains("path") || error.contains("directory"));
        assert_eq!(
            fs::read_to_string(task_dir.join("ai").join("draft.md")).expect("read unchanged"),
            "original\n"
        );
        assert!(!task_dir.join("ai").join("original").exists());
    }

    // --- Test helpers ---

    fn create_task(output_root: &Path, task_id: &str) -> PathBuf {
        let task_dir = output_root.join("tasks").join(task_id);
        fs::create_dir_all(task_dir.join("media")).expect("create media dir");
        fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
        fs::create_dir_all(task_dir.join("ai")).expect("create ai dir");
        task_dir
    }

    fn write_manifest(task_dir: &Path, task_id: &str) {
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
    "transcript_txt": "transcript/transcript.txt"
  }},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest");
    }

    fn write_manifest_with_draft(task_dir: &Path, task_id: &str, seed_insight_id: Option<i64>) {
        let seed_entry = match seed_insight_id {
            Some(id) => format!(r#", "draft_seed_insight_id": {id}"#),
            None => String::new(),
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
    "draft": "ai/draft.md"
  }}{seed_entry},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write manifest with draft");
    }

    fn write_quarantined_manifest(task_dir: &Path, task_id: &str) {
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
  "artifacts": {{
    "draft": "ai/draft.md"
  }},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write quarantined manifest");
    }

    fn write_quarantined_manifest_with_draft(task_dir: &Path, task_id: &str) {
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
  "artifacts": {{
    "audio": "media/audio.wav",
    "draft": "ai/draft.md"
  }},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write quarantined manifest with draft");
    }

    fn write_legacy_manifest(task_dir: &Path, task_id: &str) {
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
    "draft": "ai/draft.md"
  }},
  "error": null,
  "text_preview": "",
  "insights_count": 0
}}"#
            ),
        )
        .expect("write legacy manifest");
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
