use super::*;
use crate::task_manifest::{SupportedTask, TaskArtifact};

struct ReadingLibrary {
    config: PathBuf,
    resources: PathBuf,
    target: PathBuf,
}

impl ReadingLibrary {
    fn new() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../build/data-storage-acceptance")
            .join(format!("merge-reading-{}", uuid::Uuid::new_v4()));
        for name in ["config", "resources", "target"] {
            fs::create_dir_all(root.join(name)).unwrap();
        }
        let root = root.canonicalize().unwrap();
        Self { config: root.join("config"), resources: root.join("resources"), target: root.join("target") }
    }

    fn manager(&self) -> DataStorageManager {
        DataStorageManager::open(self.config.clone(), self.resources.clone()).unwrap()
    }

    fn runtime(&self) -> crate::RuntimePaths {
        crate::RuntimePaths { user_data_dir: self.config.clone(), resource_dir: self.resources.clone() }
    }

    fn merge_and_reopen(&self) -> DataStorageManager {
        let manager = self.manager();
        let preview = manager.prepare(self.target.clone(), vec![], "reading", manager.state().generation).unwrap();
        manager.start(&preview.plan_token, "reading", &mut |_| {}).unwrap();
        assert_eq!(manager.state().data_access, "restart_required");
        drop(manager);
        let manager = self.manager();
        assert_eq!(manager.state().operation.as_ref().unwrap().phase, "validating");
        assert_eq!(manager.recheck().unwrap().data_access, "ready");
        assert_eq!(paths_for_config(&self.config).unwrap().data_root, self.target);
        manager
    }
}

fn write_note(root: &Path, id: &str, text: &str, draft: &str, title: &str) {
    let task = root.join("outputs/tasks").join(id);
    for name in ["transcript", "ai"] { fs::create_dir_all(task.join(name)).unwrap(); }
    fs::write(task.join("transcript/transcript.txt"), text).unwrap();
    fs::write(task.join("ai/draft.md"), draft).unwrap();
    let manifest = serde_json::json!({
        "schema_version":3,"source_privacy_migration_version":2,"source_privacy_quarantined":false,
        "task_id":id,"created_at":"2026-11-03T00:00:00Z","source_kind":"local_file",
        "source_url":"","source_identity":null,
        "local_source":{"display_name":"recording.wav","media_kind":"audio","extension":"wav"},
        "platform":"local","status":"completed","model":"iic/SenseVoiceSmall",
        "artifacts":{"transcript_txt":"transcript/transcript.txt","draft":"ai/draft.md"},
        "error":null,"text_preview":text,"insights_count":0,
    });
    fs::write(task.join("frameq-task.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    let mut note = SupportedTask::open(&root.join("outputs"), id).unwrap().into_edit_session();
    note.set_note_display_title(title).unwrap();
    note.set_note_pinned(true).unwrap();
}

fn write_collection(root: &Path, name: &str, ids: &[&str]) -> crate::collections::CollectionsView {
    let collections = crate::collections::CollectionsView {
        schema_version: 1,
        collections: vec![crate::collections::CollectionView {
            id: uuid::Uuid::new_v4().to_string(), name: name.into(),
            task_ids: ids.iter().map(|id| (*id).into()).collect(),
        }],
    };
    fs::write(root.join("collections.json"), serde_json::to_vec(&collections).unwrap()).unwrap();
    collections
}

fn assert_note(output: &Path, id: &str, text: &str, draft: &str, title: &str) {
    let request = serde_json::from_value(serde_json::json!({"task_id":id})).unwrap();
    let detail = crate::history::load_history_detail_from_output_root(output, request).unwrap();
    assert_eq!(detail.text, text);
    let metadata = detail.note_metadata.unwrap();
    assert!(metadata.pinned);
    assert_eq!(metadata.display_title.as_deref(), Some(title));
    let task = SupportedTask::open(output, id).unwrap();
    assert_eq!(task.read_text_artifact(TaskArtifact::Draft).unwrap().as_deref(), Some(draft));
}

#[test]
fn merge_reopens_real_history_drafts_and_target_collections_with_target_content_priority() {
    let library = ReadingLibrary::new();
    write_note(&library.config, "source-only", "来源独有正文", "# 来源独有作品", "来源独有标题");
    write_note(&library.config, "shared-note", "来源重复正文", "# 来源重复作品", "来源重复标题");
    write_collection(&library.config, "来源合集", &["source-only", "shared-note"]);
    write_note(&library.target, "target-only", "目标独有正文", "# 目标独有作品", "目标独有标题");
    write_note(&library.target, "shared-note", "目标重复正文", "# 目标重复作品", "目标重复标题");
    let target_collections = write_collection(&library.target, "目标合集", &["target-only", "shared-note"]);
    let metadata = library.target.join(".frameq-storage");
    fs::create_dir_all(metadata.join("receipts")).unwrap();
    let old_marker = StoreMarker { schema_version: 1, library_id: uuid::Uuid::new_v4().to_string(),
        generation: 29, root_identity: safe_filesystem::identity(&library.target).unwrap() };
    fs::write(metadata.join("store.json"), serde_json::to_vec(&old_marker).unwrap()).unwrap();
    let retained = metadata.join("receipts/unregistered-record.json");
    fs::write(&retained, b"retained target metadata").unwrap();
    fs::write(library.config.join("auth-preserved.json"), b"fixed settings").unwrap();
    let target_manifest = fs::read(library.target.join("outputs/tasks/shared-note/frameq-task.json")).unwrap();
    let manager = library.merge_and_reopen();
    let output = library.target.join("outputs");
    let mut ids = crate::history::load_history_from_output_root(&output).unwrap()
        .into_iter().map(|item| item.task_id).collect::<Vec<_>>();
    ids.sort();
    assert_eq!(ids, ["shared-note", "source-only", "target-only"]);
    assert_note(&output, "source-only", "来源独有正文", "# 来源独有作品", "来源独有标题");
    assert_note(&output, "target-only", "目标独有正文", "# 目标独有作品", "目标独有标题");
    assert_note(&output, "shared-note", "目标重复正文", "# 目标重复作品", "目标重复标题");
    assert_eq!(fs::read(output.join("tasks/shared-note/frameq-task.json")).unwrap(), target_manifest);
    assert_eq!(crate::collections::get_collections_from_paths_for_test(&library.runtime()).unwrap(), target_collections);
    assert!(!library.config.join("collections.json").exists());
    assert!(!library.config.join("outputs").exists());
    assert_eq!(fs::read(&retained).unwrap(), b"retained target metadata");
    assert_eq!(fs::read(library.config.join("auth-preserved.json")).unwrap(), b"fixed settings");
    assert!(manager.state().cleanup_receipts.is_empty());
    let marker: StoreMarker = control::read_json(&metadata.join("store.json"), 64 * 1024).unwrap();
    assert_ne!(marker.library_id, old_marker.library_id);
    assert_eq!(marker.generation, 1);
    assert_eq!(marker.library_id, manager.snapshot().unwrap().active.library_id);
}

#[test]
fn merge_moves_source_collection_when_target_has_no_collection_file() {
    let library = ReadingLibrary::new();
    write_note(&library.config, "source-note", "来源笔记正文", "# 来源笔记作品", "来源笔记标题");
    let collections = write_collection(&library.config, "来源合集", &["source-note"]);
    write_note(&library.target, "target-note", "目标笔记正文", "# 目标笔记作品", "目标笔记标题");
    let _manager = library.merge_and_reopen();
    assert_eq!(crate::collections::get_collections_from_paths_for_test(&library.runtime()).unwrap(), collections);
    assert_note(&library.target.join("outputs"), "source-note", "来源笔记正文", "# 来源笔记作品", "来源笔记标题");
    assert_note(&library.target.join("outputs"), "target-note", "目标笔记正文", "# 目标笔记作品", "目标笔记标题");
    assert!(!library.config.join("outputs").exists());
}

#[test]
fn empty_target_keeps_source_note_and_existing_copy_cleanup_flow() {
    let library = ReadingLibrary::new();
    write_note(&library.config, "copied-note", "复制笔记正文", "# 复制笔记作品", "复制笔记标题");
    let collections = write_collection(&library.config, "复制合集", &["copied-note"]);
    let manager = library.merge_and_reopen();
    assert_note(&library.target.join("outputs"), "copied-note", "复制笔记正文", "# 复制笔记作品", "复制笔记标题");
    assert_note(&library.config.join("outputs"), "copied-note", "复制笔记正文", "# 复制笔记作品", "复制笔记标题");
    assert_eq!(crate::collections::get_collections_from_paths_for_test(&library.runtime()).unwrap(), collections);
    assert_eq!(crate::collections::read_for_storage_validation(&library.config.join("collections.json")).unwrap(), collections);
    assert_eq!(manager.state().cleanup_receipts.len(), 1);
}

#[test]
fn managed_source_merges_into_existing_library_and_reopens_target_notes() {
    let library = ReadingLibrary::new();
    write_note(&library.config, "managed-source-note", "受管来源正文", "# 受管来源作品", "受管来源标题");
    let source = library.config.parent().unwrap().join("managed-source");
    fs::create_dir(&source).unwrap();
    let manager = library.manager();
    let preview = manager.prepare(source.clone(), vec![], "reading", 0).unwrap();
    manager.start(&preview.plan_token, "reading", &mut |_| {}).unwrap();
    drop(manager);
    let manager = library.manager();
    manager.recheck().unwrap();
    assert_eq!(manager.state().generation, 1);
    write_note(&library.target, "existing-target-note", "受管目标正文", "# 受管目标作品", "受管目标标题");
    let preview = manager.prepare(library.target.clone(), vec![], "reading", 1).unwrap();
    manager.start(&preview.plan_token, "reading", &mut |_| {}).unwrap();
    drop(manager);
    let manager = library.manager();
    assert_eq!(manager.recheck().unwrap().data_access, "ready");
    assert_eq!(manager.state().generation, 2);
    assert_note(&library.target.join("outputs"), "managed-source-note", "受管来源正文", "# 受管来源作品", "受管来源标题");
    assert_note(&library.target.join("outputs"), "existing-target-note", "受管目标正文", "# 受管目标作品", "受管目标标题");
    assert!(!source.join("outputs").exists());
    assert!(library.config.join("outputs/tasks/managed-source-note/frameq-task.json").is_file());
}

#[test]
fn merge_deletes_readonly_duplicate_source_note_and_preserves_readonly_target_note() {
    let library = ReadingLibrary::new();
    write_note(&library.config, "shared-note", "只读来源正文", "# 只读来源作品", "只读来源标题");
    write_note(&library.target, "shared-note", "只读目标正文", "# 只读目标作品", "只读目标标题");
    let relative = "outputs/tasks/shared-note/transcript/transcript.txt";
    for path in [library.config.join(relative), library.target.join(relative)] {
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions).unwrap();
    }
    let _manager = library.merge_and_reopen();
    assert_note(&library.target.join("outputs"), "shared-note", "只读目标正文", "# 只读目标作品", "只读目标标题");
    assert!(fs::metadata(library.target.join(relative)).unwrap().permissions().readonly());
    assert!(!library.config.join("outputs").exists());
}
