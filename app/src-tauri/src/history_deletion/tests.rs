use super::*;
use serde_json::json;
use std::fs;
use std::path::PathBuf;

const TASK: &str = "20261031-local-delete-note";
const OTHER: &str = "20261031-local-keep-note";

#[test]
fn webpage_delete_removes_its_snapshot_and_preserves_other_collection_members() {
    let fixture = Fixture::new();
    let output = fixture.paths.user_data_dir.join("outputs");
    crate::task_manifest::web_tests::write_task(&output, TASK, &crate::task_manifest::web_tests::manifest(TASK));
    crate::task_manifest::web_tests::write_task(&output, OTHER, &crate::task_manifest::web_tests::manifest(OTHER));
    assert_eq!(crate::task_manifest::SupportedTask::scan_read_only(&output).unwrap().into_tasks().len(), 2);
    let result = delete_from_paths(&fixture.paths, TASK, &ProcessSupervisors::default(), &HistoryDeletionState::default()).unwrap();
    assert_eq!(result.status, "completed");
    assert!(!output.join("tasks").join(TASK).exists());
    let remaining = crate::task_manifest::SupportedTask::open(&output, OTHER).unwrap();
    assert_eq!(remaining.read_source_text().unwrap().text, "第一段。\r\n\r\n第二段。\n");
    assert_eq!(fixture.members(), [OTHER, "missing-note"]);
}

struct Fixture { root: PathBuf, paths: RuntimePaths }

impl Fixture {
    fn new() -> Self {
        let build = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build");
        fs::create_dir_all(&build).unwrap();
        let root = build.canonicalize().unwrap().join(format!("note-deletion-{}", Uuid::new_v4()));
        let paths = RuntimePaths { resource_dir: root.join("resources"), user_data_dir: root.join("data") };
        fs::create_dir_all(paths.user_data_dir.join("cache")).unwrap();
        let fixture = Self { root, paths };
        fixture.task(TASK);
        fixture.task(OTHER);
        fixture.cache(TASK);
        fixture.cache(OTHER);
        fixture.collections(&[TASK, OTHER, "missing-note"]);
        fixture
    }
    fn task(&self, id: &str) -> PathBuf {
        let task = self.paths.user_data_dir.join("outputs/tasks").join(id);
        fs::create_dir_all(task.join("media")).unwrap();
        fs::create_dir_all(task.join("transcript")).unwrap();
        fs::write(task.join("media/audio.wav"), b"saved audio").unwrap();
        fs::write(task.join("transcript/transcript.txt"), b"Saved transcript.").unwrap();
        fs::write(task.join("frameq-note-metadata.json"), b"invalid settings remain deletable").unwrap();
        fs::write(task.join("frameq-task.json"), serde_json::to_vec(&json!({
            "schema_version": 3, "source_privacy_migration_version": 2, "task_id": id,
            "created_at": "2026-10-31T12:00:00Z", "source_kind": "local_file",
            "source_url": "", "source_identity": null, "platform": "local",
            "local_source": {"display_name":"sample.wav", "media_kind":"audio", "extension":"wav"},
            "status":"completed", "artifacts":{"audio":"media/audio.wav", "transcript_txt":"transcript/transcript.txt"},
            "text_preview":"Saved transcript.", "insights_count":0, "error":null,
        })).unwrap()).unwrap();
        task
    }
    fn cache(&self, id: &str) {
        for base in ["cache/tasks", "cache/.frameq-audio-review"] {
            let path = self.paths.user_data_dir.join(base).join(id);
            fs::create_dir_all(&path).unwrap();
            fs::write(path.join("cached.wav"), b"cached audio").unwrap();
        }
    }
    fn collections(&self, ids: &[&str]) {
        fs::write(self.paths.user_data_dir.join("collections.json"), serde_json::to_vec(&json!({
            "schemaVersion":1, "collections":[{"id":"6f154d56-c88f-4faa-a44b-ad2c848c81ba", "name":"Saved Collection", "taskIds":ids}],
        })).unwrap()).unwrap();
    }
    fn members(&self) -> Vec<String> {
        let value: serde_json::Value = serde_json::from_slice(&fs::read(self.paths.user_data_dir.join("collections.json")).unwrap()).unwrap();
        value["collections"][0]["taskIds"].as_array().unwrap().iter().map(|id| id.as_str().unwrap().to_string()).collect()
    }
    fn roots(&self) -> Roots { Roots::resolve(&self.paths).unwrap() }
    fn prepared(&self) -> Intent {
        let (job, _task) = prepare(&self.paths, &self.roots(), TASK).unwrap();
        intent::write(&self.paths, &job).unwrap();
        job
    }
    fn accepted(&self) -> Intent {
        let roots = self.roots();
        let mut job = self.prepared();
        storage::stage_directory(&roots.task(&job), &roots.task_stage(&job), job.task).unwrap();
        job.phase = Phase::Accepted;
        intent::write(&self.paths, &job).unwrap();
        job
    }
    fn resume(&self) -> Result<HistoryCleanupResult, HistoryDeleteError> {
        resume_from_paths(&self.paths, &ProcessSupervisors::default(), &HistoryDeletionState::default())
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let build = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build").canonicalize().unwrap();
        assert!(self.root.starts_with(&build) && self.root != build);
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn complete_delete_removes_only_selected_note_both_caches_and_exact_memberships() {
    let fixture = Fixture::new();
    let result = delete_from_paths(&fixture.paths, TASK, &ProcessSupervisors::default(), &HistoryDeletionState::default()).unwrap();
    assert_eq!(result.status, "completed");
    assert_eq!(result.error_code, None);
    assert!(!fixture.paths.user_data_dir.join("outputs/tasks").join(TASK).exists());
    for base in ["cache/tasks", "cache/.frameq-audio-review"] {
        assert!(!fixture.paths.user_data_dir.join(base).join(TASK).exists());
        assert!(fixture.paths.user_data_dir.join(base).join(OTHER).exists());
    }
    assert!(fixture.paths.user_data_dir.join("outputs/tasks").join(OTHER).exists());
    assert_eq!(fixture.members(), [OTHER, "missing-note"]);
    assert!(!intent::path(&fixture.paths).exists());
    assert_eq!(fixture.resume().unwrap().status, "idle");
}

#[test]
fn prepared_without_move_is_discarded_and_preserves_original_cache_and_memberships() {
    let fixture = Fixture::new();
    let job = fixture.prepared();
    let original = fixture.roots().task(&job);
    let metadata = fs::read(original.join("frameq-task.json")).unwrap();
    assert!(guard_pending_task(&fixture.paths, TASK).is_err());
    assert!(!deletion_is_accepted(&fixture.paths, TASK).unwrap());
    assert!(guard_pending_task(&fixture.paths, OTHER).is_ok());
    assert_eq!(fixture.resume().unwrap().status, "idle");
    assert_eq!(fs::read(original.join("frameq-task.json")).unwrap(), metadata);
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
    assert!(fixture.paths.user_data_dir.join("cache/tasks").join(TASK).exists());
}

#[test]
fn prepared_rename_crash_resumes_matching_staged_identity() {
    let fixture = Fixture::new();
    let job = fixture.prepared();
    let roots = fixture.roots();
    storage::stage_directory(&roots.task(&job), &roots.task_stage(&job), job.task).unwrap();
    assert_eq!(intent::read(&fixture.paths).unwrap().unwrap().phase, Phase::Prepared);
    assert!(deletion_is_accepted(&fixture.paths, TASK).unwrap());
    assert_eq!(fixture.resume().unwrap().status, "completed");
    assert!(!roots.task_stage(&job).exists());
    assert_eq!(fixture.members(), [OTHER, "missing-note"]);
}

#[test]
fn cleanup_does_not_touch_same_name_original_replacement() {
    let fixture = Fixture::new();
    let job = fixture.accepted();
    let replacement = fixture.task(TASK);
    fs::write(replacement.join("keep.txt"), b"replacement must remain").unwrap();
    assert_eq!(guard_pending_task(&fixture.paths, TASK).unwrap_err(), PENDING);
    assert_eq!(fixture.resume().unwrap().status, "completed");
    assert_eq!(fs::read(replacement.join("keep.txt")).unwrap(), b"replacement must remain");
    assert!(!fixture.roots().task_stage(&job).exists());
}

#[test]
fn stage_replacement_is_rejected_by_directory_identity() {
    let fixture = Fixture::new();
    let job = fixture.accepted();
    let roots = fixture.roots();
    let stage = roots.task_stage(&job);
    fs::rename(&stage, fixture.root.join("moved-accepted" )).unwrap();
    fs::create_dir(&stage).unwrap();
    fs::write(stage.join("keep.txt"), b"replacement").unwrap();
    assert_eq!(fixture.resume().unwrap().status, "cleanup_pending");
    assert_eq!(fs::read(stage.join("keep.txt")).unwrap(), b"replacement");
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
}

#[test]
fn successful_move_then_identity_change_returns_pending_and_retains_both_directories() {
    let fixture = Fixture::new();
    let job = fixture.prepared();
    let roots = fixture.roots();
    let stage = roots.task_stage(&job);
    storage::stage_directory(&roots.task(&job), &stage, job.task).unwrap();
    let original = fixture.root.join("moved-original");
    fs::rename(&stage, &original).unwrap();
    fs::create_dir(&stage).unwrap();
    fs::write(stage.join("replacement.txt"), b"replacement remains").unwrap();
    let result = complete_accepted_move(&fixture.paths, &roots, job.clone());
    assert_eq!(result.status, "cleanup_pending");
    assert_eq!(result.error_code, Some(PENDING));
    assert_eq!(intent::read(&fixture.paths).unwrap().unwrap().phase, Phase::Accepted);
    assert_eq!(storage::identity(&original).unwrap(), job.task);
    assert!(original.join("frameq-task.json").exists());
    assert_eq!(fs::read(stage.join("replacement.txt")).unwrap(), b"replacement remains");
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
    assert!(fixture.paths.user_data_dir.join("cache/tasks").join(TASK).exists());
    assert_eq!(fixture.resume().unwrap().status, "cleanup_pending");
    assert!(original.exists() && stage.exists());
}

#[test]
fn partially_removed_stage_requires_no_manifest_for_restart_cleanup() {
    let fixture = Fixture::new();
    let job = fixture.accepted();
    let roots = fixture.roots();
    fs::remove_file(roots.task_stage(&job).join("frameq-task.json")).unwrap();
    assert_eq!(fixture.resume().unwrap().status, "completed");
    assert!(!roots.task_stage(&job).exists());
}

#[test]
fn accepted_original_identity_moved_back_is_not_reported_as_physically_removed() {
    let fixture = Fixture::new();
    let job = fixture.accepted();
    let roots = fixture.roots();
    fs::rename(roots.task_stage(&job), roots.task(&job)).unwrap();
    assert_eq!(fixture.resume().unwrap().status, "cleanup_pending");
    assert!(roots.task(&job).join("frameq-task.json").exists());
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
}

#[test]
fn changed_root_keeps_pending_and_preserves_replacement() {
    let fixture = Fixture::new();
    let _job = fixture.accepted();
    let cache = fixture.paths.user_data_dir.join("cache");
    fs::rename(&cache, fixture.root.join("old-cache")).unwrap();
    fs::create_dir(&cache).unwrap();
    fs::write(cache.join("keep.txt"), b"new root").unwrap();
    assert_eq!(fixture.resume().unwrap().status, "cleanup_pending");
    assert_eq!(fs::read(cache.join("keep.txt")).unwrap(), b"new root");
    assert!(intent::path(&fixture.paths).exists());
}

#[test]
fn changed_prepared_root_returns_unaccepted_error_and_preserves_original() {
    let fixture = Fixture::new();
    let job = fixture.prepared();
    let cache = fixture.paths.user_data_dir.join("cache");
    fs::rename(&cache, fixture.root.join("old-cache")).unwrap();
    fs::create_dir(&cache).unwrap();
    assert_eq!(fixture.resume().unwrap_err(), HistoryDeleteError::UnsafeStorage);
    assert!(fixture.roots().task(&job).join("frameq-task.json").exists());
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
}

#[test]
fn hardlinked_artifact_and_journal_are_rejected_without_touching_other_link() {
    let fixture = Fixture::new();
    let original = fixture.paths.user_data_dir.join("outputs/tasks").join(TASK);
    let outside = fixture.root.join("outside-audio.wav");
    fs::hard_link(original.join("media/audio.wav"), &outside).unwrap();
    assert_eq!(delete_from_paths(&fixture.paths, TASK, &ProcessSupervisors::default(), &HistoryDeletionState::default()).unwrap_err(), HistoryDeleteError::UnsafeStorage);
    assert_eq!(fs::read(&outside).unwrap(), b"saved audio");
    fs::remove_file(&outside).unwrap();
    let _job = fixture.prepared();
    fs::hard_link(intent::path(&fixture.paths), fixture.root.join("outside-intent.json")).unwrap();
    assert_eq!(fixture.resume().unwrap_err(), HistoryDeleteError::UnsafeStorage);
    assert!(original.exists());
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
}

#[test]
fn accepted_cache_replacement_is_not_removed() {
    let fixture = Fixture::new();
    let _job = fixture.accepted();
    let cache = fixture.paths.user_data_dir.join("cache/tasks").join(TASK);
    fs::rename(&cache, fixture.root.join("old-task-cache")).unwrap();
    fs::create_dir(&cache).unwrap();
    fs::write(cache.join("keep.txt"), b"new cache").unwrap();
    assert_eq!(fixture.resume().unwrap().status, "cleanup_pending");
    assert_eq!(fs::read(cache.join("keep.txt")).unwrap(), b"new cache");
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
}

#[test]
fn malformed_unknown_and_oversized_intents_fail_closed() {
    let fixture = Fixture::new();
    for content in [b"{}".to_vec(), vec![b'x'; 16 * 1024 + 1], b"null".to_vec()] {
        fs::write(intent::path(&fixture.paths), content).unwrap();
        assert_eq!(fixture.resume().unwrap_err(), HistoryDeleteError::UnsafeStorage);
        assert!(fixture.paths.user_data_dir.join("outputs/tasks").join(TASK).exists());
        fs::remove_file(intent::path(&fixture.paths)).unwrap();
    }
    let mut job = fixture.prepared();
    job.schema_version = 99;
    fs::write(intent::path(&fixture.paths), serde_json::to_vec(&job).unwrap()).unwrap();
    assert_eq!(fixture.resume().unwrap_err(), HistoryDeleteError::UnsafeStorage);
}

#[test]
fn every_nullable_identity_field_is_required_in_persisted_intent() {
    let fixture = Fixture::new();
    let job = fixture.prepared();
    let payload = serde_json::to_value(&job).unwrap();
    for field in ["cache_root", "worker_root", "review_root", "worker_cache", "review_cache"] {
        let mut missing = payload.clone();
        missing.as_object_mut().unwrap().remove(field);
        fs::write(intent::path(&fixture.paths), serde_json::to_vec(&missing).unwrap()).unwrap();
        assert_eq!(fixture.resume().unwrap_err(), HistoryDeleteError::UnsafeStorage, "{field}");
        assert!(fixture.paths.user_data_dir.join("outputs/tasks").join(TASK).exists());
        assert!(fixture.paths.user_data_dir.join("cache/tasks").join(TASK).exists());
        assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
    }
}

#[test]
fn pending_note_stays_out_of_collection_projection_and_cannot_be_readded() {
    let fixture = Fixture::new();
    let _job = fixture.accepted();
    fixture.task(TASK);
    assert_eq!(guard_pending_task(&fixture.paths, &format!(" {TASK} ")).unwrap_err(), PENDING);
    let collections = crate::collections::get_collections_from_paths_for_test(&fixture.paths).unwrap();
    assert!(!collections.collections[0].task_ids.iter().any(|id| id == TASK));
    let before = fs::read(fixture.paths.user_data_dir.join("collections.json")).unwrap();
    assert!(crate::collections::include_note_for_test(&fixture.paths, "6f154d56-c88f-4faa-a44b-ad2c848c81ba", TASK).is_err());
    assert_eq!(fs::read(fixture.paths.user_data_dir.join("collections.json")).unwrap(), before);
}

#[test]
fn processing_task_lease_and_overlapping_delete_are_rejected() {
    let fixture = Fixture::new();
    let state = HistoryDeletionState::default();
    let supervisors = ProcessSupervisors::default();
    let _lease = task_manifest::acquire_task_mutation(&fixture.roots().output, TASK).unwrap();
    assert_eq!(delete_from_paths(&fixture.paths, TASK, &supervisors, &state).unwrap_err(), HistoryDeleteError::Busy);
    let _guard = state.lock.lock().unwrap();
    assert_eq!(delete_from_paths(&fixture.paths, OTHER, &supervisors, &state).unwrap_err(), HistoryDeleteError::Busy);
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
}

#[test]
fn running_native_child_keeps_delete_outside_filesystem_mutation() {
    use std::process::{Command, Stdio};
    let fixture = Fixture::new();
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "history_deletion::tests::deletion_busy_child", "--nocapture"])
        .env("APP_DELETION_BUSY_CHILD", "1")
        .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
    let supervisors = ProcessSupervisors::default();
    let instance = supervisors.activate_task_for_test(child.id());
    assert_eq!(delete_from_paths(&fixture.paths, TASK, &supervisors, &HistoryDeletionState::default()).unwrap_err(), HistoryDeleteError::Busy);
    assert!(fixture.paths.user_data_dir.join("outputs/tasks").join(TASK).exists());
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
    drop(child.stdin.take());
    assert!(child.wait().unwrap().success());
    supervisors.finish_task_for_test(instance);
}

#[test]
fn deletion_busy_child() {
    if std::env::var_os("APP_DELETION_BUSY_CHILD").is_none() { return; }
    use std::io::Read;
    let mut bytes = Vec::new();
    std::io::stdin().read_to_end(&mut bytes).unwrap();
}

#[cfg(windows)]
#[test]
fn locked_original_directory_causes_pre_accept_failure_without_cache_changes() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    let fixture = Fixture::new();
    let original = fixture.paths.user_data_dir.join("outputs/tasks").join(TASK);
    let locked = OpenOptions::new().read(true).share_mode(0x1 | 0x2).custom_flags(0x0200_0000)
        .open(&original).unwrap();
    let result = delete_from_paths(&fixture.paths, TASK, &ProcessSupervisors::default(), &HistoryDeletionState::default());
    assert_eq!(result.unwrap_err(), HistoryDeleteError::DeleteFailed);
    assert!(original.join("frameq-task.json").exists());
    assert!(fixture.paths.user_data_dir.join("cache/tasks").join(TASK).exists());
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
    assert!(!intent::path(&fixture.paths).exists());
    drop(locked);
}

#[cfg(windows)]
#[test]
fn locked_staged_file_keeps_cleanup_pending_then_restarts_without_manifest() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    let fixture = Fixture::new();
    let job = fixture.accepted();
    let stage = fixture.roots().task_stage(&job);
    fs::remove_file(stage.join("frameq-task.json")).unwrap();
    let locked = OpenOptions::new().read(true).share_mode(0x1).open(stage.join("media/audio.wav")).unwrap();
    assert_eq!(fixture.resume().unwrap().status, "cleanup_pending");
    assert!(intent::path(&fixture.paths).exists());
    assert_eq!(fixture.members(), [OTHER, "missing-note"]);
    drop(locked);
    assert_eq!(fixture.resume().unwrap().status, "completed");
    assert!(!stage.exists());
}

#[cfg(windows)]
#[test]
fn collection_file_lock_keeps_accepted_files_until_fresh_memberships_can_commit() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    let fixture = Fixture::new();
    let job = fixture.accepted();
    let locked = OpenOptions::new().read(true).share_mode(0x1).open(fixture.paths.user_data_dir.join("collections.json")).unwrap();
    assert_eq!(fixture.resume().unwrap().status, "cleanup_pending");
    assert!(fixture.roots().task_stage(&job).join("frameq-task.json").exists());
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
    drop(locked);
    fixture.collections(&[TASK, OTHER, "missing-note", "interleaved-new-member"]);
    assert_eq!(fixture.resume().unwrap().status, "completed");
    assert_eq!(fixture.members(), [OTHER, "missing-note", "interleaved-new-member"]);
}

#[cfg(windows)]
#[test]
fn locked_cache_directory_retries_staging_after_acceptance() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    let fixture = Fixture::new();
    let job = fixture.accepted();
    let cache = fixture.paths.user_data_dir.join("cache/tasks").join(TASK);
    let locked = OpenOptions::new().read(true).share_mode(0x1 | 0x2).custom_flags(0x0200_0000).open(&cache).unwrap();
    assert_eq!(fixture.resume().unwrap().status, "cleanup_pending");
    assert!(fixture.roots().task_stage(&job).exists());
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
    drop(locked);
    assert_eq!(fixture.resume().unwrap().status, "completed");
}

#[test]
fn abrupt_subprocess_exit_after_rename_is_recovered_by_identity() {
    use std::process::{Command, Stdio};
    let fixture = Fixture::new();
    let status = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "history_deletion::tests::deletion_crash_child", "--nocapture"])
        .env("APP_DELETION_TEST_ROOT", &fixture.root)
        .stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap();
    assert_eq!(status.code(), Some(73));
    let job = intent::read(&fixture.paths).unwrap().unwrap();
    assert_eq!(job.phase, Phase::Prepared);
    assert!(fixture.roots().task_stage(&job).exists());
    assert_eq!(fixture.resume().unwrap().status, "completed");
    assert!(fixture.paths.user_data_dir.join("outputs/tasks").join(OTHER).exists());
}

#[test]
fn deletion_crash_child() {
    let Some(root) = std::env::var_os("APP_DELETION_TEST_ROOT") else { return; };
    let root = PathBuf::from(root);
    let build = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build").canonicalize().unwrap();
    assert!(root.starts_with(&build) && root != build);
    let paths = RuntimePaths { resource_dir: root.join("resources"), user_data_dir: root.join("data") };
    let roots = Roots::resolve(&paths).unwrap();
    let (job, _task) = prepare(&paths, &roots, TASK).unwrap();
    intent::write(&paths, &job).unwrap();
    storage::stage_directory(&roots.task(&job), &roots.task_stage(&job), job.task).unwrap();
    std::process::exit(73);
}

#[cfg(windows)]
#[test]
fn junction_descendant_is_rejected_before_acceptance() {
    use std::process::{Command, Stdio};
    let fixture = Fixture::new();
    let outside = fixture.root.join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("keep.txt"), b"outside").unwrap();
    let link = fixture.paths.user_data_dir.join("outputs/tasks").join(TASK).join("linked");
    let status = Command::new("cmd.exe").args(["/D", "/C", "mklink", "/J"])
        .arg(&link).arg(&outside).stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap();
    assert!(status.success());
    assert_eq!(delete_from_paths(&fixture.paths, TASK, &ProcessSupervisors::default(), &HistoryDeletionState::default()).unwrap_err(), HistoryDeleteError::UnsafeStorage);
    assert_eq!(fs::read(outside.join("keep.txt")).unwrap(), b"outside");
    fs::remove_dir(&link).unwrap();
}

#[test]
fn requests_and_responses_are_closed_and_path_free() {
    assert!(serde_json::from_value::<HistoryDeleteRequest>(json!({"task_id":TASK,"path":"secret"})).is_err());
    let result = HistoryDeleteResult { task_id: TASK.to_string(), status: "cleanup_pending", error_code: Some(PENDING) };
    let value = serde_json::to_value(result).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 3);
    assert!(value.get("deleted").is_none());
}

#[test]
fn rejects_linked_tasks_root_before_removal() {
    let fixture = Fixture::new();
    let tasks = fixture.paths.user_data_dir.join("outputs/tasks");
    let actual = fixture.root.join("actual-tasks");
    fs::rename(&tasks, &actual).unwrap();
    create_dir_link(&actual, &tasks);
    assert_eq!(delete_from_paths(&fixture.paths, TASK, &ProcessSupervisors::default(), &HistoryDeletionState::default()).unwrap_err(), HistoryDeleteError::UnsafeStorage);
    assert!(actual.join(TASK).join("frameq-task.json").exists());
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
    remove_dir_link(&tasks);
}

#[test]
fn rejects_linked_playback_cache_root_before_task_removal() {
    let fixture = Fixture::new();
    let review = fixture.paths.user_data_dir.join("cache/.frameq-audio-review");
    let actual = fixture.root.join("actual-review");
    fs::rename(&review, &actual).unwrap();
    create_dir_link(&actual, &review);
    assert_eq!(delete_from_paths(&fixture.paths, TASK, &ProcessSupervisors::default(), &HistoryDeletionState::default()).unwrap_err(), HistoryDeleteError::UnsafeStorage);
    assert!(actual.join(TASK).join("cached.wav").exists());
    assert!(fixture.paths.user_data_dir.join("outputs/tasks").join(TASK).exists());
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
    remove_dir_link(&review);
}

#[cfg(unix)]
#[test]
fn rejects_dangling_playback_cache_symlink_before_task_removal() {
    let fixture = Fixture::new();
    let target = fixture.paths.user_data_dir.join("cache/.frameq-audio-review").join(TASK);
    fs::remove_dir_all(&target).unwrap();
    std::os::unix::fs::symlink(fixture.root.join("missing-target"), &target).unwrap();
    assert_eq!(delete_from_paths(&fixture.paths, TASK, &ProcessSupervisors::default(), &HistoryDeletionState::default()).unwrap_err(), HistoryDeleteError::UnsafeStorage);
    assert!(fixture.paths.user_data_dir.join("outputs/tasks").join(TASK).exists());
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
    fs::remove_file(target).unwrap();
}

#[cfg(unix)]
#[test]
fn rejects_linked_descendants_before_removal() {
    let fixture = Fixture::new();
    let outside = fixture.root.join("outside-transcript.txt");
    fs::write(&outside, b"outside transcript").unwrap();
    let link = fixture.paths.user_data_dir.join("outputs/tasks").join(TASK).join("transcript/linked.txt");
    std::os::unix::fs::symlink(&outside, &link).unwrap();
    assert_eq!(delete_from_paths(&fixture.paths, TASK, &ProcessSupervisors::default(), &HistoryDeletionState::default()).unwrap_err(), HistoryDeleteError::UnsafeStorage);
    assert_eq!(fs::read(outside).unwrap(), b"outside transcript");
    assert_eq!(fixture.members(), [TASK, OTHER, "missing-note"]);
    fs::remove_file(link).unwrap();
}

#[cfg(windows)]
fn create_dir_link(source: &Path, destination: &Path) {
    use std::process::{Command, Stdio};
    let status = Command::new("cmd.exe").args(["/D", "/C", "mklink", "/J"])
        .arg(destination).arg(source).stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap();
    assert!(status.success());
}

#[cfg(unix)]
fn create_dir_link(source: &Path, destination: &Path) {
    std::os::unix::fs::symlink(source, destination).unwrap();
}

#[cfg(windows)]
fn remove_dir_link(path: &Path) { fs::remove_dir(path).unwrap(); }

#[cfg(unix)]
fn remove_dir_link(path: &Path) { fs::remove_file(path).unwrap(); }
