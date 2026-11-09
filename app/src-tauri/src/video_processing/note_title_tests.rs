use super::{finish_note_title_attempt, parse_retry_insights_request, record_note_title_cancellation_from_root, NoteTitleCancellationRequest};
use crate::task_manifest::{NoteTitle, NoteTitleStatus, SupportedTask};
use crate::worker_runtime::TaskTerminalResult;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(windows)]
#[test]
fn pending_deletion_rejects_retry_and_cancellation_before_task_changes() {
    let fixture = crate::note_actions::tests::Fixture::new();
    let paths = fixture.pending_replacement_paths();
    let before = fs::read(fixture.task_dir.join("task.json")).unwrap();
    assert_eq!(super::open_retry_task(&paths, &fixture.output_root, "note-1").unwrap_err(),
        "HISTORY_DELETE_CLEANUP_PENDING");
    let request: NoteTitleCancellationRequest = serde_json::from_value(json!({
        "task_id":"note-1","output_language":"en-US","expected_note_title":null,
    })).unwrap();
    assert_eq!(super::record_note_title_cancellation_from_paths(&paths, request).unwrap_err(),
        "HISTORY_DELETE_CLEANUP_PENDING");
    assert_eq!(fs::read(fixture.task_dir.join("task.json")).unwrap(), before);
    assert_eq!(fs::read_to_string(fixture.task_dir.join("transcript/transcript.txt")).unwrap(),
        "Replacement transcript");
}

fn fixture(label: &str) -> (PathBuf, PathBuf) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().join("build").join("note-title-tests")
        .join(format!("{label}-{}", uuid::Uuid::new_v4()));
    let task = root.join("tasks").join("title-task");
    fs::create_dir_all(task.join("transcript")).unwrap();
    fs::create_dir_all(task.join("ai")).unwrap();
    fs::write(task.join("transcript/transcript.txt"), "authoritative saved transcript\n").unwrap();
    fs::write(task.join("ai/summary.md"), "existing summary\n").unwrap();
    let manifest = json!({
        "schema_version":3,"source_privacy_migration_version":2,"task_id":"title-task",
        "created_at":"2026-10-31T00:00:00Z","source_url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "source_identity":{"version":1,"platform":"youtube","stable_id":"dQw4w9WgXcQ","effective_part":null,"canonical_url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
        "platform":"youtube","model":"iic/SenseVoiceSmall-onnx","status":"completed",
        "artifacts":{"transcript_txt":"transcript/transcript.txt","summary":"ai/summary.md"},
        "note_title":{"text":"Previously saved title","status":"completed","output_language":"en-US","error_code":null},
        "extension_metadata":{"keep":true}
    });
    fs::write(task.join("task.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    (root, task)
}

fn result(task_id: Option<&str>, code: Option<&str>) -> TaskTerminalResult {
    TaskTerminalResult::from_value(json!({
        "status":if code.is_some(){"partial_completed"}else{"completed"},"task_id":task_id,
        "task_dir":null,"artifacts":{},"text":"","summary":"","insights":[],"transcript":null,"dissection":null,"draft":"",
        "error":code.map(|code|json!({"code":code,"message":"","stage":"title_generating"}))
    })).unwrap()
}

fn assert_preserved(task: &Path) {
    assert_eq!(fs::read_to_string(task.join("transcript/transcript.txt")).unwrap(), "authoritative saved transcript\n");
    assert_eq!(fs::read_to_string(task.join("ai/summary.md")).unwrap(), "existing summary\n");
    let manifest: serde_json::Value = serde_json::from_slice(&fs::read(task.join("task.json")).unwrap()).unwrap();
    assert_eq!(manifest["extension_metadata"], json!({"keep":true}));
}

#[test]
fn cancellation_and_preparation_failure_preserve_the_saved_transcript_and_previous_title() {
    for (label, result, code, state) in [
        ("cancel", Ok(result(None, Some("WORKER_CANCELLED"))), "WORKER_CANCELLED", NoteTitleStatus::Cancelled),
        ("prepare", Err("private checkout configuration".to_string()), "TITLE_GENERATION_FAILED", NoteTitleStatus::Failed),
        ("quota", Ok(result(Some("title-task"), Some("AI_LLM_QUOTA_UNAVAILABLE"))), "AI_LLM_QUOTA_UNAVAILABLE", NoteTitleStatus::Failed),
    ] {
        let (root, task_dir) = fixture(label);
        let task = SupportedTask::open(&root, "title-task").unwrap();
        let output = finish_note_title_attempt(task, &root, "en-US", "authoritative saved transcript".to_string(), result).unwrap();
        assert_eq!(output.task_id.as_deref(), Some("title-task"));
        assert_eq!(output.error.unwrap().code, code);
        assert!(!output.task_created);
        assert_eq!(output.note_title.as_ref().unwrap().status, state);
        assert_eq!(output.note_title.unwrap().text.as_deref(), Some("Previously saved title"));
        assert_preserved(&task_dir);
        assert_eq!(SupportedTask::open(&root, "title-task").unwrap().note_title().unwrap().status, state);
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn a_result_for_another_task_cannot_replace_the_original_title() {
    let (root, task_dir) = fixture("stale");
    let task = SupportedTask::open(&root, "title-task").unwrap();
    let output = finish_note_title_attempt(task, &root, "en-US", "authoritative saved transcript".to_string(), Ok(result(Some("another-task"), None))).unwrap();
    assert_eq!(output.error.unwrap().code, "WORKER_PROTOCOL_VIOLATION");
    assert_eq!(output.note_title.unwrap().text.as_deref(), Some("Previously saved title"));
    assert_preserved(&task_dir);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_title_is_legacy_compatible_but_present_invalid_metadata_is_rejected() {
    let (root, task_dir) = fixture("legacy");
    let path = task_dir.join("task.json");
    let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest.as_object_mut().unwrap().remove("note_title");
    fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(SupportedTask::open(&root, "title-task").unwrap().note_title().is_none());
    for invalid in [serde_json::Value::Null, json!({"text":"missing status"})] {
        manifest["note_title"] = invalid;
        fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(SupportedTask::open(&root, "title-task").is_err());
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn accepts_a_title_only_after_the_same_value_is_committed_for_the_requested_locale() {
    let (root, task_dir) = fixture("committed");
    let task = SupportedTask::open(&root, "title-task").unwrap();
    let title = NoteTitle {
        text: Some("A new concise title".to_string()),
        status: NoteTitleStatus::Completed,
        output_language: "en-US".to_string(),
        error_code: None,
    };
    let mut writer = task.clone();
    writer.save_note_title(title.clone()).unwrap();
    let mut worker_result = result(Some("title-task"), None);
    worker_result.note_title = Some(title.clone());
    let output = finish_note_title_attempt(task, &root, "en-US", "authoritative saved transcript".to_string(), Ok(worker_result)).unwrap();
    assert_eq!(output.note_title, Some(title.clone()));
    assert!(output.error.is_none());
    let mut edit = writer.into_edit_session();
    edit.set_text_preview("edited preview".to_string());
    crate::task_manifest::commit_task_artifacts(edit.task_dir(), vec![crate::task_manifest::TaskArtifactMutation::manifest(edit.encoded_manifest().unwrap())]).unwrap();
    drop(edit);
    assert_eq!(SupportedTask::open(&root, "title-task").unwrap().note_title(), Some(title));
    assert_preserved(&task_dir);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn uncommitted_title_output_is_rejected_and_cannot_rename_the_task() {
    let (root, task_dir) = fixture("uncommitted");
    let task = SupportedTask::open(&root, "title-task").unwrap();
    let mut worker_result = result(Some("title-task"), None);
    worker_result.note_title = Some(NoteTitle {
        text: Some("Unpublished result".to_string()),
        status: NoteTitleStatus::Completed,
        output_language: "en-US".to_string(),
        error_code: None,
    });
    let output = finish_note_title_attempt(task, &root, "en-US", "authoritative saved transcript".to_string(), Ok(worker_result)).unwrap();
    assert_eq!(output.error.unwrap().code, "TITLE_OUTPUT_INVALID");
    assert_eq!(output.note_title.unwrap().text.as_deref(), Some("Previously saved title"));
    assert_preserved(&task_dir);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancellation_after_publication_keeps_the_latest_committed_title_text() {
    let (root, task_dir) = fixture("cancel-after-publication");
    let task = SupportedTask::open(&root, "title-task").unwrap();
    let mut writer = task.clone();
    writer.save_note_title(NoteTitle {
        text: Some("Latest committed title".to_string()),
        status: NoteTitleStatus::Completed,
        output_language: "en-US".to_string(),
        error_code: None,
    }).unwrap();
    drop(writer);
    let output = finish_note_title_attempt(task, &root, "en-US", "authoritative saved transcript".to_string(), Ok(result(None, Some("WORKER_CANCELLED")))).unwrap();
    assert_eq!(output.note_title.unwrap().text.as_deref(), Some("Latest committed title"));
    assert_preserved(&task_dir);
    assert_eq!(SupportedTask::open(&root, "title-task").unwrap().note_title().unwrap().text.as_deref(), Some("Latest committed title"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancellation_before_title_admission_is_persisted_without_worker_execution() {
    let (root, task_dir) = fixture("cancel-before-admission");
    let path = task_dir.join("task.json");
    let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest.as_object_mut().unwrap().remove("note_title");
    fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let request: NoteTitleCancellationRequest = serde_json::from_value(json!({
        "task_id":"title-task","output_language":"zh-TW","expected_note_title":null
    })).unwrap();
    let result = record_note_title_cancellation_from_root(&root, request).unwrap();
    assert_eq!(result.status.as_str(), "partial_completed");
    assert_eq!(result.error.unwrap().code, "WORKER_CANCELLED");
    let title = result.note_title.unwrap();
    assert_eq!(title.status, NoteTitleStatus::Cancelled);
    assert_eq!(title.output_language, "zh-TW");
    assert!(title.text.is_none());
    assert_eq!(SupportedTask::open(&root, "title-task").unwrap().note_title(), Some(title));
    assert_preserved(&task_dir);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancellation_cannot_overwrite_title_metadata_changed_since_the_submission_snapshot() {
    let (root, task_dir) = fixture("cancel-compare");
    let path = task_dir.join("task.json");
    let original = fs::read(&path).unwrap();
    let actual = SupportedTask::open(&root, "title-task").unwrap().note_title();
    let request: NoteTitleCancellationRequest = serde_json::from_value(json!({
        "task_id":"title-task","output_language":"zh-CN","expected_note_title":null
    })).unwrap();
    let result = record_note_title_cancellation_from_root(&root, request).unwrap();
    assert_eq!(result.status.as_str(), "completed");
    assert!(result.error.is_none());
    assert_eq!(result.note_title, actual);
    assert_eq!(fs::read(&path).unwrap(), original);
    assert_preserved(&task_dir);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancellation_metadata_rejects_stale_task_identity_and_busy_ownership() {
    let (root, task_dir) = fixture("cancel-owner");
    let original = fs::read(task_dir.join("task.json")).unwrap();
    let owner = SupportedTask::open(&root, "title-task").unwrap();
    let request: NoteTitleCancellationRequest = serde_json::from_value(json!({
        "task_id":"title-task","output_language":"en-US","expected_note_title":owner.note_title()
    })).unwrap();
    assert!(record_note_title_cancellation_from_root(&root, request).is_err());
    drop(owner);
    let stale: NoteTitleCancellationRequest = serde_json::from_value(json!({
        "task_id":"unrelated-task","output_language":"en-US","expected_note_title":null
    })).unwrap();
    assert!(record_note_title_cancellation_from_root(&root, stale).is_err());
    assert_eq!(fs::read(task_dir.join("task.json")).unwrap(), original);
    assert_preserved(&task_dir);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancellation_rejects_incoherent_saved_state_with_a_stable_error() {
    let (root, task_dir) = fixture("cancel-invalid-state");
    let path = task_dir.join("task.json");
    let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest["status"] = json!("unknown-state");
    let original = serde_json::to_vec(&manifest).unwrap();
    fs::write(&path, &original).unwrap();
    let request: NoteTitleCancellationRequest = serde_json::from_value(json!({
        "task_id":"title-task","output_language":"en-US","expected_note_title":null
    })).unwrap();
    assert_eq!(record_note_title_cancellation_from_root(&root, request).unwrap_err(), "TITLE_STATE_INVALID");
    assert_eq!(fs::read(path).unwrap(), original);
    assert_preserved(&task_dir);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn title_cancellation_and_generation_requests_are_closed_before_any_task_or_provider_access() {
    let cancellation = json!({"task_id":"title-task","output_language":"en-US","expected_note_title":null});
    serde_json::from_value::<NoteTitleCancellationRequest>(cancellation.clone()).unwrap();
    for field in ["task_id", "output_language", "expected_note_title"] {
        let mut missing = cancellation.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<NoteTitleCancellationRequest>(missing).is_err());
    }
    let mut unknown = cancellation;
    unknown["private_path"] = json!("rejected");
    assert!(serde_json::from_value::<NoteTitleCancellationRequest>(unknown).is_err());
    let generation = json!({"task_id":"title-task","target":"title","output_language":"en-US"});
    parse_retry_insights_request(generation.clone()).unwrap();
    for field in ["platform", "insight_id", "preference_snapshot"] {
        let mut invalid = generation.clone();
        invalid[field] = serde_json::Value::Null;
        assert!(parse_retry_insights_request(invalid).is_err());
    }
}

#[cfg(windows)]
#[test]
fn a_real_manifest_file_lock_prevents_title_replacement_without_changing_saved_bytes() {
    use std::os::windows::fs::OpenOptionsExt;
    let (root, task_dir) = fixture("locked");
    let path = task_dir.join("task.json");
    let original = fs::read(&path).unwrap();
    let mut task = SupportedTask::open(&root, "title-task").unwrap();
    let lock = fs::OpenOptions::new().read(true).share_mode(1).open(&path).unwrap();
    assert!(task.save_note_title(NoteTitle {
        text: Some("Replacement title".to_string()),
        status: NoteTitleStatus::Completed,
        output_language: "en-US".to_string(),
        error_code: None,
    }).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
    assert_preserved(&task_dir);
    drop(lock);
    drop(task);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(any(unix, windows))]
#[test]
fn linked_task_storage_is_rejected_without_touching_the_link_target() {
    let (root, task_dir) = fixture("linked");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let target = root.join("outside-task");
        fs::rename(&task_dir, &target).unwrap();
        let original = fs::read(target.join("task.json")).unwrap();
        let output = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&task_dir)
            .arg(&target)
            .creation_flags(0x08000000)
            .output().unwrap();
        assert!(output.status.success(), "create real Windows junction: {:?}", output);
        assert!(SupportedTask::open(&root, "title-task").is_err());
        assert_eq!(fs::read(target.join("task.json")).unwrap(), original);
        assert_eq!(fs::read_to_string(target.join("transcript/transcript.txt")).unwrap(), "authoritative saved transcript\n");
        fs::remove_dir(task_dir).unwrap();
    }
    #[cfg(unix)]
    {
    let path = task_dir.join("task.json");
    let target = root.join("outside-manifest.json");
    fs::rename(&path, &target).unwrap();
    let original = fs::read(&target).unwrap();
    std::os::unix::fs::symlink(&target, &path).unwrap();
    assert!(SupportedTask::open(&root, "title-task").is_err());
    assert_eq!(fs::read(&target).unwrap(), original);
    assert_eq!(fs::read_to_string(task_dir.join("transcript/transcript.txt")).unwrap(), "authoritative saved transcript\n");
    fs::remove_file(path).unwrap();
    }
    fs::remove_dir_all(root).unwrap();
}
