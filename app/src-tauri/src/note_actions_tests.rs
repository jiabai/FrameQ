use super::*;
use crate::task_manifest::{self, NoteTitle, NoteTitleStatus};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

pub(crate) struct Fixture {
    root: PathBuf,
    pub(crate) output_root: PathBuf,
    pub(crate) task_dir: PathBuf,
}

impl Fixture {
    pub(crate) fn new() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent().unwrap().parent().unwrap()
            .join("build").join("note-actions-tests").join(Uuid::new_v4().to_string());
        let output_root = root.join("outputs");
        let task_dir = output_root.join("tasks").join("note-1");
        fs::create_dir_all(task_dir.join("transcript")).unwrap();
        fs::create_dir_all(task_dir.join("ai")).unwrap();
        fs::write(task_dir.join("transcript/transcript.txt"), "Verified saved transcript.").unwrap();
        fs::write(task_dir.join("transcript/transcript.md"), "# Transcript\nVerified saved transcript.").unwrap();
        fs::write(task_dir.join("transcript/segments.json"), "[]").unwrap();
        fs::write(task_dir.join("ai/summary.md"), "# Saved summary").unwrap();
        fs::write(task_dir.join("ai/draft.md"), "# Saved draft").unwrap();
        fs::write(task_dir.join("ai/preference_snapshot.json"), "{}").unwrap();
        let manifest = json!({
            "schema_version":3,"source_privacy_migration_version":2,
            "task_id":"note-1","created_at":"2026-10-31T10:00:00Z",
            "source_url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "source_identity":{"version":1,"platform":"youtube","stable_id":"dQw4w9WgXcQ",
                "effective_part":null,"canonical_url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
            "platform":"youtube","status":"completed","error":null,
            "text_preview":"Verified saved transcript.","insights_count":0,
            "transcript":{"source":"asr","language":"en","engine":"sensevoice_small"},
            "artifacts":{"transcript_txt":"transcript/transcript.txt",
                "transcript_md":"transcript/transcript.md","segments":"transcript/segments.json",
                "summary":"ai/summary.md","draft":"ai/draft.md","mindmap":"ai/missing.mmd",
                "preference_snapshot":"ai/preference_snapshot.json"},
            "preserved":{"user":"existing metadata"}
        });
        fs::write(task_dir.join("frameq-task.json"), serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
        Self { root, output_root, task_dir }
    }

    fn metadata_path(&self) -> PathBuf { self.task_dir.join("frameq-note-metadata.json") }

    fn manifest(&self) -> Value {
        serde_json::from_slice(&fs::read(self.task_dir.join("frameq-task.json")).unwrap()).unwrap()
    }

    fn save_manifest(&self, manifest: &Value) {
        fs::write(self.task_dir.join("frameq-task.json"), serde_json::to_vec_pretty(manifest).unwrap()).unwrap();
    }

    fn pin(&self, pinned: bool) -> Result<NoteMutationResult, String> {
        set_note_pinned_from_root(&self.output_root, PinRequest { task_id:"note-1".into(), pinned })
    }

    fn rename(&self, title: &str) -> Result<NoteMutationResult, String> {
        rename_note_from_root(&self.output_root, RenameRequest { task_id:"note-1".into(), title:title.into() })
    }

    #[cfg(windows)]
    pub(crate) fn pending_replacement_paths(&self) -> crate::RuntimePaths {
        use std::os::windows::fs::OpenOptionsExt;
        let manifest = fs::read(self.task_dir.join("frameq-task.json")).unwrap();
        let paths = crate::RuntimePaths {
            resource_dir: self.root.join("resources"),
            user_data_dir: self.root.clone(),
        };
        fs::create_dir_all(self.root.join("cache")).unwrap();
        let collections = self.root.join("collections.json");
        fs::write(&collections, serde_json::to_vec(&json!({
            "schemaVersion":1,"collections":[{
                "id":"6f154d56-c88f-4faa-a44b-ad2c848c81ba",
                "name":"Saved Collection","taskIds":["note-1"]
            }]
        })).unwrap()).unwrap();
        let lock = fs::OpenOptions::new().read(true).share_mode(1).open(&collections).unwrap();
        let result = crate::history_deletion::delete_from_paths_for_test(
            &paths, "note-1", &crate::ProcessSupervisors::default(),
            &crate::HistoryDeletionState::default(),
        ).unwrap();
        assert_eq!(result.status, "cleanup_pending");
        assert!(!self.task_dir.exists());
        drop(lock);
        fs::create_dir_all(self.task_dir.join("transcript")).unwrap();
        fs::create_dir_all(self.task_dir.join("ai")).unwrap();
        fs::write(self.task_dir.join("frameq-task.json"), &manifest).unwrap();
        fs::write(self.task_dir.join("transcript/transcript.txt"), "Replacement transcript").unwrap();
        fs::write(self.task_dir.join("ai/draft.md"), "Replacement draft").unwrap();
        assert!(task_manifest::SupportedTask::open(&self.output_root, "note-1").is_ok());
        paths
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).expect("remove isolated note fixture");
    }
}

#[test]
fn legacy_metadata_is_default_and_info_contains_only_saved_user_fields() {
    let fixture = Fixture::new();
    let info = get_note_info_from_root(&fixture.output_root, "note-1").unwrap();
    assert_eq!(info.note_metadata, Some(task_manifest::NoteMetadataView::default()));
    assert_eq!(info.note_metadata_error, None);
    assert_eq!(info.artifact_types, ["transcript_txt", "transcript_md", "summary", "draft"]);
    assert_eq!(info.transcript.unwrap().engine.as_deref(), Some("sensevoice_small"));
    let payload = serde_json::to_value(get_note_info_from_root(&fixture.output_root, "note-1").unwrap()).unwrap();
    assert_eq!(payload.as_object().unwrap().len(), 10);
    assert_eq!(payload["source"]["url"], "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert!(!serde_json::to_string(&payload).unwrap().contains(&fixture.root.display().to_string()));
    assert!(!fixture.metadata_path().exists());
}

#[test]
fn pin_and_rename_reopen_latest_settings_without_changing_task_files() {
    let fixture = Fixture::new();
    let manifest_before = fs::read(fixture.task_dir.join("frameq-task.json")).unwrap();
    let transcript_before = fs::read(fixture.task_dir.join("transcript/transcript.txt")).unwrap();
    assert!(fixture.pin(true).unwrap().note_metadata.pinned);
    assert_eq!(fixture.rename("  我的手动标题  ").unwrap().note_metadata.display_title.as_deref(), Some("我的手动标题"));
    assert!(!fixture.pin(false).unwrap().note_metadata.pinned);
    let committed = fixture.rename("第二个手动标题").unwrap();
    assert!(!committed.note_metadata.pinned);
    let info = get_note_info_from_root(&fixture.output_root, "note-1").unwrap();
    assert_eq!(info.note_metadata.unwrap(), committed.note_metadata);
    assert_eq!(fs::read(fixture.task_dir.join("frameq-task.json")).unwrap(), manifest_before);
    assert_eq!(fs::read(fixture.task_dir.join("transcript/transcript.txt")).unwrap(), transcript_before);
    let stored: Value = serde_json::from_slice(&fs::read(fixture.metadata_path()).unwrap()).unwrap();
    assert_eq!(stored, json!({"schema_version":1,"task_id":"note-1","pinned":false,"display_title":"第二个手动标题"}));
}

#[test]
fn unrelated_manifest_title_transcript_and_draft_publication_preserve_settings() {
    let fixture = Fixture::new();
    fixture.rename("保留的手动标题").unwrap();
    fixture.pin(true).unwrap();
    let before = fs::read(fixture.metadata_path()).unwrap();
    let mut task = task_manifest::SupportedTask::open(&fixture.output_root, "note-1").unwrap();
    task.save_note_title(NoteTitle {
        text: Some("A committed generated title".into()), status: NoteTitleStatus::Completed,
        output_language:"en-US".into(), error_code:None,
    }).unwrap();
    let mut edit = task.into_edit_session();
    edit.set_text_preview("Updated preview".into());
    task_manifest::commit_task_artifacts(edit.task_dir(), vec![
        task_manifest::TaskArtifactMutation::replace("transcript/transcript.txt", b"Edited transcript".to_vec()),
        task_manifest::TaskArtifactMutation::replace("ai/draft.md", b"Edited draft".to_vec()),
        task_manifest::TaskArtifactMutation::manifest(edit.encoded_manifest().unwrap()),
    ]).unwrap();
    drop(edit);
    assert_eq!(fs::read(fixture.metadata_path()).unwrap(), before);
    assert_eq!(get_note_info_from_root(&fixture.output_root, "note-1").unwrap().note_metadata.unwrap().display_title.as_deref(), Some("保留的手动标题"));
}

#[test]
fn busy_owner_and_replaced_task_identity_prevent_mutations() {
    let fixture = Fixture::new();
    let task = task_manifest::SupportedTask::open(&fixture.output_root, "note-1").unwrap();
    assert_eq!(fixture.pin(true).unwrap_err(), BUSY);
    let mut edit = task.into_edit_session();
    let mut manifest = fixture.manifest();
    manifest["created_at"] = json!("2026-10-31T11:00:00Z");
    fixture.save_manifest(&manifest);
    assert_eq!(edit.set_note_display_title("Stale title"), Err(task_manifest::NoteMetadataError::UnsafeStorage));
    assert!(!fixture.metadata_path().exists());
}

#[test]
fn malformed_settings_remain_visible_and_are_never_overwritten() {
    let fixture = Fixture::new();
    let valid = json!({"schema_version":1,"task_id":"note-1","pinned":true,"display_title":null});
    let mut cases = vec![b"not JSON".to_vec(), b"null".to_vec(), vec![b'x';4097]];
    for field in ["schema_version", "task_id", "pinned", "display_title"] {
        let mut missing = valid.clone();
        missing.as_object_mut().unwrap().remove(field);
        cases.push(serde_json::to_vec(&missing).unwrap());
    }
    for (field, value) in [
        ("schema_version",json!(2)),("task_id",json!("another-note")),
        ("pinned",json!(1)),("display_title",json!(" bad title")),("unexpected",json!(true)),
    ] {
        let mut invalid = valid.clone(); invalid[field] = value;
        cases.push(serde_json::to_vec(&invalid).unwrap());
    }
    for bytes in cases {
        fs::write(fixture.metadata_path(), &bytes).unwrap();
        assert_eq!(fixture.pin(false).unwrap_err(), "NOTE_METADATA_INVALID");
        assert_eq!(fs::read(fixture.metadata_path()).unwrap(), bytes);
        let history = history::load_history_from_output_root(&fixture.output_root).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].note_metadata, None);
        assert_eq!(history[0].note_metadata_error.as_deref(), Some("NOTE_METADATA_INVALID"));
        assert_eq!(history[0].status, "completed");
        let detail = history::load_history_detail_from_output_root(&fixture.output_root,
            serde_json::from_value(json!({"task_id":"note-1"})).unwrap()).unwrap();
        assert_eq!(detail.text, "Verified saved transcript.");
        assert_eq!(detail.note_metadata_error.as_deref(), Some("NOTE_METADATA_INVALID"));
    }
}

#[test]
fn hardlinked_settings_are_rejected_without_changing_either_file() {
    let fixture = Fixture::new();
    fixture.pin(true).unwrap();
    let outside = fixture.root.join("other-settings.json");
    fs::hard_link(fixture.metadata_path(), &outside).unwrap();
    let before = fs::read(&outside).unwrap();
    assert_eq!(fixture.rename("Must not overwrite").unwrap_err(), "NOTE_UNSAFE_STORAGE");
    assert_eq!(fs::read(&outside).unwrap(), before);
    assert_eq!(fs::read(fixture.metadata_path()).unwrap(), before);
    let info = get_note_info_from_root(&fixture.output_root, "note-1").unwrap();
    assert_eq!(info.note_metadata, None);
    assert_eq!(info.note_metadata_error.as_deref(), Some("NOTE_UNSAFE_STORAGE"));
}

#[cfg(windows)]
#[test]
fn real_windows_file_lock_rejects_replacement_and_retains_prior_bytes() {
    use std::os::windows::fs::OpenOptionsExt;
    let fixture = Fixture::new();
    fixture.rename("Previous title").unwrap();
    let before = fs::read(fixture.metadata_path()).unwrap();
    let lock = std::fs::OpenOptions::new().read(true).share_mode(1)
        .open(fixture.metadata_path()).unwrap();
    assert_eq!(fixture.pin(true).unwrap_err(), "NOTE_METADATA_WRITE_FAILED");
    assert_eq!(fs::read(fixture.metadata_path()).unwrap(), before);
    assert!(!fs::read_dir(&fixture.task_dir).unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().contains(".part")));
    drop(lock);
    assert!(fixture.pin(true).unwrap().note_metadata.pinned);
}

#[cfg(windows)]
#[test]
fn junction_settings_and_parent_directories_cannot_receive_metadata() {
    use std::os::windows::process::CommandExt;
    let fixture = Fixture::new();
    let outside = fixture.root.join("external-directory");
    fs::create_dir_all(&outside).unwrap();
    let result = std::process::Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(fixture.metadata_path()).arg(&outside).creation_flags(0x08000000).output().unwrap();
    assert!(result.status.success(), "junction creation failed: {}", String::from_utf8_lossy(&result.stderr));
    assert_eq!(fixture.pin(true).unwrap_err(), "NOTE_UNSAFE_STORAGE");
    assert_eq!(history::load_history_from_output_root(&fixture.output_root).unwrap().len(), 1);
    assert!(fs::read_dir(&outside).unwrap().next().is_none());
    fs::remove_dir(fixture.metadata_path()).unwrap();
    let tasks = fixture.output_root.join("tasks");
    let moved = fixture.root.join("moved-tasks");
    fs::rename(&tasks, &moved).unwrap();
    let result = std::process::Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(&tasks).arg(&moved).creation_flags(0x08000000).output().unwrap();
    assert!(result.status.success());
    assert_eq!(fixture.pin(true).unwrap_err(), "NOTE_UNSAFE_STORAGE");
    assert!(!moved.join("note-1/frameq-note-metadata.json").exists());
    fs::remove_dir(&tasks).unwrap();
}

#[cfg(unix)]
#[test]
fn symlink_settings_cannot_receive_metadata() {
    let fixture = Fixture::new();
    let outside = fixture.root.join("outside.json");
    fs::write(&outside, "external bytes").unwrap();
    std::os::unix::fs::symlink(&outside, fixture.metadata_path()).unwrap();
    assert_eq!(fixture.pin(true).unwrap_err(), "NOTE_UNSAFE_STORAGE");
    assert_eq!(fs::read_to_string(outside).unwrap(), "external bytes");
}

#[test]
fn source_resolution_preserves_canonical_parameters_and_rejects_local_or_unsafe_identity() {
    let fixture = Fixture::new();
    for (platform, stable_id, part, url) in [
        ("youtube", "dQw4w9WgXcQ", None, "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("bilibili", "BV1234567890", Some(3), "https://www.bilibili.com/video/BV1234567890?p=3"),
    ] {
        let mut manifest = fixture.manifest();
        manifest["source_url"] = json!(url);
        manifest["platform"] = json!(platform);
        manifest["source_identity"] = json!({"version":1,"platform":platform,"stable_id":stable_id,"effective_part":part,"canonical_url":url});
        fixture.save_manifest(&manifest);
        let task = open_task(&fixture.output_root, "note-1").unwrap();
        assert_eq!(canonical_source(&task).unwrap(), url);
    }
    let mut local = fixture.manifest();
    local["source_kind"] = json!("local_file"); local["source_url"] = json!("");
    local["source_identity"] = Value::Null; local["platform"] = json!("local");
    local["local_source"] = json!({"display_name":"Interview.mp4","media_kind":"video","extension":"mp4"});
    fixture.save_manifest(&local);
    let task = open_task(&fixture.output_root, "note-1").unwrap();
    assert_eq!(canonical_source(&task).unwrap_err(), SOURCE_UNAVAILABLE);
    drop(task);
    let info = get_note_info_from_root(&fixture.output_root, "note-1").unwrap();
    assert_eq!(serde_json::to_value(info.source).unwrap(), json!({"kind":"local_file","displayName":"Interview.mp4","mediaKind":"video"}));
    local["source_privacy_quarantined"] = json!(true);
    fixture.save_manifest(&local);
    assert_eq!(open_task(&fixture.output_root, "note-1").unwrap_err(), UNAVAILABLE);
}

#[test]
fn source_actions_reject_url_normalization_instead_of_opening_raw_noncanonical_values() {
    let fixture = Fixture::new();
    for url in [
        " https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com:443/watch?v=dQw4w9WgXcQ",
        "https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/unused/../watch?v=dQw4w9WgXcQ",
    ] {
        let mut manifest = fixture.manifest();
        manifest["source_url"] = json!(url);
        manifest["source_identity"]["canonical_url"] = json!(url);
        fixture.save_manifest(&manifest);
        let task = open_task(&fixture.output_root, "note-1").unwrap();
        assert_eq!(canonical_source(&task).unwrap_err(), SOURCE_UNAVAILABLE);
        drop(task);
        assert_eq!(get_note_info_from_root(&fixture.output_root, "note-1").unwrap_err(), SOURCE_UNAVAILABLE);
    }
}

#[test]
fn closed_requests_and_stale_task_ids_fail_without_writes() {
    let fixture = Fixture::new();
    assert!(parse_request::<TaskRequest>(json!({"task_id":"note-1","url":"https://example.com"})).is_err());
    assert!(parse_request::<PinRequest>(json!({"task_id":"note-1","pinned":1})).is_err());
    assert!(parse_request::<RenameRequest>(json!({"task_id":"note-1","title":"Title","pinned":true})).is_err());
    for task_id in ["", "../note-1", "note-1/", "https://example.com", " note-1", "unknown-note"] {
        assert!(open_task(&fixture.output_root, task_id).is_err());
    }
    for title in ["", "  ", "\nValid title", "Title\u{200b}"] {
        assert_eq!(fixture.rename(title).unwrap_err(), "NOTE_TITLE_INVALID");
    }
    assert!(!fixture.metadata_path().exists());
}

#[cfg(windows)]
#[test]
fn pending_deletion_blocks_replacement_note_settings_info_and_existing_edit_commands() {
    let fixture = Fixture::new();
    let paths = fixture.pending_replacement_paths();
    let manifest = fs::read(fixture.task_dir.join("frameq-task.json")).unwrap();
    assert_eq!(set_note_pinned_from_paths(&paths, PinRequest {
        task_id:"note-1".into(), pinned:true,
    }).unwrap_err(), "NOTE_BUSY");
    assert_eq!(rename_note_from_paths(&paths, RenameRequest {
        task_id:"note-1".into(), title:"Blocked replacement title".into(),
    }).unwrap_err(), "NOTE_BUSY");
    assert_eq!(open_task_from_paths(&paths, "note-1").unwrap_err(), "NOTE_BUSY");
    let transcript = crate::transcript_detail::save_transcript_edit_from_paths(
        &paths, serde_json::from_value(json!({"task_id":"note-1","text":"Must not save"})).unwrap(),
    );
    assert_eq!(transcript.unwrap_err(), "HISTORY_DELETE_CLEANUP_PENDING");
    let draft = crate::draft_detail::save_draft_edit_from_paths(
        &paths, serde_json::from_value(json!({"task_id":"note-1","markdown":"Must not save"})).unwrap(),
    );
    assert_eq!(draft.unwrap_err(), "HISTORY_DELETE_CLEANUP_PENDING");
    let transcript_detail = crate::transcript_detail::load_transcript_detail_from_paths(
        &paths, serde_json::from_value(json!({"task_id":"note-1"})).unwrap(),
    );
    assert_eq!(transcript_detail.unwrap_err(), "HISTORY_DELETE_CLEANUP_PENDING");
    let draft_detail = crate::draft_detail::load_draft_detail_from_paths(
        &paths, serde_json::from_value(json!({"task_id":"note-1"})).unwrap(),
    );
    assert_eq!(draft_detail.unwrap_err(), "HISTORY_DELETE_CLEANUP_PENDING");
    assert_eq!(fs::read(fixture.task_dir.join("frameq-task.json")).unwrap(), manifest);
    assert_eq!(fs::read_to_string(fixture.task_dir.join("transcript/transcript.txt")).unwrap(), "Replacement transcript");
    assert_eq!(fs::read_to_string(fixture.task_dir.join("ai/draft.md")).unwrap(), "Replacement draft");
    assert!(!fixture.metadata_path().exists());
    assert!(!fixture.task_dir.join("transcript/original").exists());
    assert!(!fixture.task_dir.join("ai/original").exists());
}
