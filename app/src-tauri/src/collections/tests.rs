use super::*;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};
use uuid::Uuid;

struct Fixture {
    paths: RuntimePaths,
    root: PathBuf,
}

#[test]
fn deletion_prunes_only_exact_note_and_preserves_unavailable_and_other_memberships() {
    let fixture = Fixture::new();
    fixture.task("note-delete");
    fixture.task("note-keep");
    let mut stored = fixture.create("Collection");
    stored.collections[0].task_ids = vec!["note-delete".into(), "note-keep".into(), "unavailable-note".into()];
    fs::write(fixture.store(), serde_json::to_vec(&stored).unwrap()).unwrap();
    prune_deleted_note_memberships(&fixture.paths, "note-delete").unwrap();
    let saved = read_store(&fixture.store()).unwrap();
    assert_eq!(saved.collections[0].task_ids, ["note-keep", "unavailable-note"]);
    assert_eq!(saved.collections[0].name, "Collection");
}

#[test]
fn deletion_prune_and_other_note_addition_use_fresh_serialized_collection_state() {
    let fixture = Fixture::new();
    let deleted = fixture.task("note-delete");
    fixture.task("note-keep");
    fixture.task("note-added");
    let mut stored = fixture.create("Collection");
    let collection_id = stored.collections[0].id.clone();
    stored.collections[0].task_ids = vec!["note-delete".into(), "note-keep".into()];
    fs::write(fixture.store(), serde_json::to_vec(&stored).unwrap()).unwrap();
    fs::rename(deleted, fixture.root.join("accepted-stage")).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let prune_paths = fixture.paths.clone();
    let prune_barrier = Arc::clone(&barrier);
    let pruning = std::thread::spawn(move || {
        prune_barrier.wait();
        prune_deleted_note_memberships(&prune_paths, "note-delete").unwrap();
    });
    barrier.wait();
    set_collection_task_membership_from_paths(&fixture.paths, &collection_id, "note-added", true).unwrap();
    pruning.join().unwrap();
    let saved = read_store(&fixture.store()).unwrap();
    assert_eq!(saved.collections[0].task_ids, ["note-keep", "note-added"]);
}

impl Fixture {
    fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../build")
            .join(format!("collections-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("data")).expect("create collection test data directory");
        let root = root.canonicalize().expect("resolve test directory");
        Self {
            paths: RuntimePaths {
                resource_dir: root.join("resources"),
                user_data_dir: root.join("data"),
            },
            root,
        }
    }

    fn store(&self) -> PathBuf {
        self.paths.user_data_dir.join("collections.json")
    }

    fn task(&self, task_id: &str) -> PathBuf {
        write_task(&self.paths.user_data_dir.join("outputs"), task_id)
    }

    fn create(&self, name: &str) -> CollectionsView {
        create_collection_from_paths(&self.paths, name).expect("create real collection")
    }
}

fn write_task(output_root: &Path, task_id: &str) -> PathBuf {
    let task = output_root.join("tasks").join(task_id);
    fs::create_dir_all(task.join("transcript")).expect("create task directory");
    fs::write(
        task.join("transcript/transcript.txt"),
        "Saved transcript.\n",
    )
    .expect("write task transcript");
    let manifest = json!({
        "schema_version": 3,
        "source_privacy_migration_version": 2,
        "task_id": task_id,
        "created_at": "2026-10-30T12:00:00Z",
        "source_kind": "local_file",
        "source_url": "",
        "source_identity": null,
        "local_source": {"display_name": "interview.mp4", "media_kind": "video", "extension": "mp4"},
        "platform": "local",
        "status": "completed",
        "artifacts": {"transcript_txt": "transcript/transcript.txt"},
        "error": null,
        "text_preview": "Saved transcript.",
        "insights_count": 0
    });
    fs::write(
        task.join("task.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .expect("write real task manifest");
    task
}

fn write_transaction_materials(task: &Path, state: Option<&str>) {
    let contract: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../contracts/task-artifact-transaction-v1.json"
    ))
    .unwrap();
    let transaction_id = "a".repeat(32);
    let name = |kind: &str| {
        contract["internalPath"]["fileNameTemplate"]
            .as_str()
            .unwrap()
            .replace("{transaction_id}", &transaction_id)
            .replace("{entry_index}", "0")
            .replace("{kind}", kind)
    };
    let staging = format!("transcript/{}", name("staging"));
    let rollback = format!("transcript/{}", name("rollback"));
    fs::write(task.join(&staging), "Staged transcript.\n").unwrap();
    fs::write(task.join(&rollback), "Saved transcript.\n").unwrap();
    fs::write(
        task.join("transcript/transcript.txt"),
        "Current transcript.\n",
    )
    .unwrap();
    if let Some(state) = state {
        let journal = json!({
            "schema_version": contract["journal"]["schemaVersion"],
            "transaction_id": transaction_id,
            "state": state,
            "entries": [{
                "destination": "transcript/transcript.txt",
                "staging": staging,
                "rollback": rollback,
                "existed_before": true
            }]
        });
        fs::write(
            task.join(contract["journalFileName"].as_str().unwrap()),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
    }
}

fn task_files(task: &Path) -> std::collections::BTreeMap<PathBuf, Vec<u8>> {
    fn visit(
        root: &Path,
        directory: &Path,
        files: &mut std::collections::BTreeMap<PathBuf, Vec<u8>>,
    ) {
        for entry in fs::read_dir(directory).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            let kind = entry.file_type().unwrap();
            assert!(!kind.is_symlink());
            if kind.is_dir() {
                visit(root, &path, files);
            } else {
                files.insert(
                    path.strip_prefix(root).unwrap().to_path_buf(),
                    fs::read(path).unwrap(),
                );
            }
        }
    }
    let mut files = std::collections::BTreeMap::new();
    visit(task, task, &mut files);
    files
}

#[test]
fn missing_store_is_empty_and_create_rename_reload_use_exact_wire_schema() {
    let fixture = Fixture::new();
    assert_eq!(
        get_collections_from_paths(&fixture.paths)
            .unwrap()
            .collections
            .len(),
        0
    );
    assert!(!fixture.store().exists());
    let created = fixture.create("  Interviews  ");
    let id = &created.collections[0].id;
    assert_eq!(Uuid::parse_str(id).unwrap().get_version_num(), 4);
    assert_eq!(created.collections[0].name, "Interviews");
    assert_eq!(created, get_collections_from_paths(&fixture.paths).unwrap());
    let renamed = rename_collection_from_paths(&fixture.paths, id, "  Research  ").unwrap();
    assert_eq!(renamed.collections[0].id, *id);
    assert_eq!(renamed.collections[0].name, "Research");
    assert_eq!(
        serde_json::to_value(&renamed).unwrap(),
        json!({"schemaVersion": 1, "collections": [{"id": id, "name": "Research", "taskIds": []}]})
    );
    assert_eq!(renamed, get_collections_from_paths(&fixture.paths).unwrap());
}

#[test]
fn invalid_and_case_insensitive_duplicate_names_preserve_committed_data() {
    let fixture = Fixture::new();
    let created = fixture.create("Résumé");
    let original = fs::read(fixture.store()).unwrap();
    for name in [
        "",
        "   ",
        "line\nbreak",
        "\tname",
        "name\u{7f}",
        &"字".repeat(81),
    ] {
        assert_eq!(
            create_collection_from_paths(&fixture.paths, name).unwrap_err(),
            "COLLECTION_NAME_INVALID"
        );
        assert_eq!(fs::read(fixture.store()).unwrap(), original);
    }
    assert_eq!(
        create_collection_from_paths(&fixture.paths, "  RÉSUMÉ ").unwrap_err(),
        "COLLECTION_NAME_EXISTS"
    );
    fixture.create("Another");
    let before_rename = fs::read(fixture.store()).unwrap();
    assert_eq!(
        rename_collection_from_paths(&fixture.paths, &created.collections[0].id, "ANOTHER")
            .unwrap_err(),
        "COLLECTION_NAME_EXISTS"
    );
    assert_eq!(fs::read(fixture.store()).unwrap(), before_rename);
    assert!(
        rename_collection_from_paths(&fixture.paths, &created.collections[0].id, "RÉSUMÉ").is_ok()
    );
    assert!(create_collection_from_paths(&fixture.paths, &"字".repeat(80)).is_ok());
}

#[test]
fn memberships_share_existing_tasks_and_filter_stale_refs_without_changing_task_files() {
    let fixture = Fixture::new();
    let task = fixture.task("task-a");
    let manifest = fs::read(task.join("task.json")).unwrap();
    let transcript = fs::read(task.join("transcript/transcript.txt")).unwrap();
    let first_id = fixture.create("First").collections[0].id.clone();
    let second_id = fixture.create("Second").collections[1].id.clone();
    set_collection_task_membership_from_paths(&fixture.paths, &first_id, "task-a", true).unwrap();
    let shared =
        set_collection_task_membership_from_paths(&fixture.paths, &second_id, "task-a", true)
            .unwrap();
    assert_eq!(shared.collections[0].task_ids, ["task-a"]);
    assert_eq!(shared.collections[1].task_ids, ["task-a"]);
    let repeated =
        set_collection_task_membership_from_paths(&fixture.paths, &second_id, "task-a", true)
            .unwrap();
    assert_eq!(repeated, shared);
    let removed =
        set_collection_task_membership_from_paths(&fixture.paths, &first_id, "task-a", false)
            .unwrap();
    assert!(removed.collections[0].task_ids.is_empty());
    assert_eq!(removed.collections[1].task_ids, ["task-a"]);
    let deleted = delete_collection_from_paths(&fixture.paths, &first_id).unwrap();
    assert_eq!(deleted.collections.len(), 1);
    assert_eq!(fs::read(task.join("task.json")).unwrap(), manifest);
    assert_eq!(
        fs::read(task.join("transcript/transcript.txt")).unwrap(),
        transcript
    );
    let stored = fs::read(fixture.store()).unwrap();
    fs::remove_file(task.join("task.json")).unwrap();
    assert!(get_collections_from_paths(&fixture.paths)
        .unwrap()
        .collections[0]
        .task_ids
        .is_empty());
    assert_eq!(fs::read(fixture.store()).unwrap(), stored);
    assert_eq!(
        set_collection_task_membership_from_paths(&fixture.paths, &second_id, "task-a", true)
            .unwrap_err(),
        "COLLECTION_TASK_UNAVAILABLE"
    );
    assert!(
        set_collection_task_membership_from_paths(&fixture.paths, &second_id, "task-a", false)
            .is_ok()
    );
}

#[test]
fn membership_uses_current_configured_output_root_and_rejects_unavailable_tasks() {
    let fixture = Fixture::new();
    fixture.task("previous-output-task");
    let configured = fixture.root.join("configured-outputs");
    write_task(&configured, "configured-task");
    fs::write(
        fixture.paths.user_data_dir.join(".env"),
        format!(
            "APP_OUTPUT_DIR={}\n",
            crate::path_to_env_string(&configured)
        ),
    )
    .unwrap();
    let id = fixture.create("Configured").collections[0].id.clone();
    for task_id in [
        "previous-output-task",
        "missing-task",
        "../outside",
        "D:/private",
        "task\\outside",
    ] {
        assert_eq!(
            set_collection_task_membership_from_paths(&fixture.paths, &id, task_id, true)
                .unwrap_err(),
            "COLLECTION_TASK_UNAVAILABLE"
        );
    }
    let view =
        set_collection_task_membership_from_paths(&fixture.paths, &id, "configured-task", true)
            .unwrap();
    assert_eq!(view.collections[0].task_ids, ["configured-task"]);
}

#[test]
fn busy_tasks_are_filtered_without_destroying_their_saved_memberships() {
    let fixture = Fixture::new();
    fixture.task("task-a");
    let id = fixture.create("Busy task").collections[0].id.clone();
    set_collection_task_membership_from_paths(&fixture.paths, &id, "task-a", true).unwrap();
    let original = fs::read(fixture.store()).unwrap();
    let task =
        task_manifest::SupportedTask::open(&fixture.paths.user_data_dir.join("outputs"), "task-a")
            .unwrap();
    assert!(get_collections_from_paths(&fixture.paths)
        .unwrap()
        .collections[0]
        .task_ids
        .is_empty());
    assert_eq!(
        set_collection_task_membership_from_paths(&fixture.paths, &id, "task-a", true).unwrap_err(),
        "COLLECTION_TASK_UNAVAILABLE"
    );
    assert_eq!(fs::read(fixture.store()).unwrap(), original);
    drop(task);
    assert_eq!(
        get_collections_from_paths(&fixture.paths)
            .unwrap()
            .collections[0]
            .task_ids,
        ["task-a"]
    );
}

#[test]
fn collection_reads_and_metadata_changes_preserve_pending_journals_and_orphans() {
    for state in [None, Some("prepared"), Some("committed")] {
        let fixture = Fixture::new();
        let task = fixture.task("task-a");
        let id = fixture.create("Original").collections[0].id.clone();
        set_collection_task_membership_from_paths(&fixture.paths, &id, "task-a", true).unwrap();
        write_transaction_materials(&task, state);
        let original = task_files(&task);
        let view = get_collections_from_paths(&fixture.paths).unwrap();
        assert_eq!(task_files(&task), original);
        assert_eq!(view.collections[0].task_ids.is_empty(), state.is_some());
        create_collection_from_paths(&fixture.paths, "Other").unwrap();
        assert_eq!(task_files(&task), original);
        rename_collection_from_paths(&fixture.paths, &id, "Renamed").unwrap();
        assert_eq!(task_files(&task), original);
        if state.is_some() {
            assert_eq!(
                set_collection_task_membership_from_paths(&fixture.paths, &id, "task-a", true)
                    .unwrap_err(),
                "COLLECTION_TASK_UNAVAILABLE"
            );
        }
        assert_eq!(task_files(&task), original);
        set_collection_task_membership_from_paths(&fixture.paths, &id, "task-a", false).unwrap();
        assert_eq!(task_files(&task), original);
        delete_collection_from_paths(&fixture.paths, &id).unwrap();
        assert_eq!(task_files(&task), original);

        let recovered = task_manifest::SupportedTask::open(
            &fixture.paths.user_data_dir.join("outputs"),
            "task-a",
        )
        .expect("the existing task owner can recover the actual transaction");
        assert_eq!(recovered.task_id(), "task-a");
        assert_ne!(task_files(&task), original);
        assert_eq!(
            fs::read_to_string(task.join("transcript/transcript.txt")).unwrap(),
            if state == Some("prepared") {
                "Saved transcript.\n"
            } else {
                "Current transcript.\n"
            }
        );
    }
}

#[cfg(windows)]
#[test]
fn failed_collection_writes_preserve_pending_journals_and_orphan_bytes() {
    use std::os::windows::fs::OpenOptionsExt;
    for state in [None, Some("prepared"), Some("committed")] {
        let fixture = Fixture::new();
        let task = fixture.task("task-a");
        let id = fixture.create("Original").collections[0].id.clone();
        write_transaction_materials(&task, state);
        let original_task = task_files(&task);
        let original_collections = fs::read(fixture.store()).unwrap();
        let _file = fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(fixture.store())
            .unwrap();
        assert_eq!(
            rename_collection_from_paths(&fixture.paths, &id, "Changed").unwrap_err(),
            "COLLECTIONS_WRITE_FAILED"
        );
        assert_eq!(fs::read(fixture.store()).unwrap(), original_collections);
        assert_eq!(task_files(&task), original_task);
    }
}

#[test]
fn missing_collection_errors_preserve_existing_store() {
    let fixture = Fixture::new();
    fixture.task("task-a");
    fixture.create("Present");
    let original = fs::read(fixture.store()).unwrap();
    let id = Uuid::new_v4().to_string();
    assert_eq!(
        rename_collection_from_paths(&fixture.paths, &id, "New name").unwrap_err(),
        "COLLECTION_NOT_FOUND"
    );
    assert_eq!(
        delete_collection_from_paths(&fixture.paths, &id).unwrap_err(),
        "COLLECTION_NOT_FOUND"
    );
    assert_eq!(
        set_collection_task_membership_from_paths(&fixture.paths, &id, "task-a", true).unwrap_err(),
        "COLLECTION_NOT_FOUND"
    );
    assert_eq!(fs::read(fixture.store()).unwrap(), original);
}

#[test]
fn corrupt_or_unknown_stored_fields_fail_without_replacing_metadata() {
    let fixture = Fixture::new();
    let id = Uuid::new_v4().to_string();
    for content in [
        "broken-json".to_string(),
        json!({"schemaVersion": 2, "collections": []}).to_string(),
        json!({"schemaVersion": 1, "collections": [], "unknown": true}).to_string(),
        json!({"schemaVersion": 1, "collections": [{"id": id, "name": " Name ", "taskIds": []}]}).to_string(),
        json!({"schemaVersion": 1, "collections": [{"id": "../outside", "name": "Name", "taskIds": []}]}).to_string(),
        json!({"schemaVersion": 1, "collections": [{"id": Uuid::nil().to_string(), "name": "Name", "taskIds": []}]}).to_string(),
        json!({"schemaVersion": 1, "collections": [{"id": "01234567-89AB-4DEF-8ABC-0123456789AB", "name": "Name", "taskIds": []}]}).to_string(),
        json!({"schemaVersion": 1, "collections": [{"id": id, "name": "Name", "taskIds": []}, {"id": id, "name": "Other", "taskIds": []}]}).to_string(),
        json!({"schemaVersion": 1, "collections": [{"id": id, "name": "Name", "taskIds": []}, {"id": Uuid::new_v4().to_string(), "name": "NAME", "taskIds": []}]}).to_string(),
        json!({"schemaVersion": 1, "collections": [{"id": id, "name": "Name", "taskIds": ["task-a", "task-a"]}]}).to_string(),
        json!({"schemaVersion": 1, "collections": [{"id": id, "name": "Name", "taskIds": ["../outside"]}]}).to_string(),
        json!({"schemaVersion": 1, "collections": [{"id": id, "name": "Name", "taskIds": [], "unknown": true}]}).to_string(),
    ] {
        fs::write(fixture.store(), &content).unwrap();
        assert_eq!(get_collections_from_paths(&fixture.paths).unwrap_err(), "COLLECTIONS_DATA_INVALID");
        assert_eq!(create_collection_from_paths(&fixture.paths, "Another").unwrap_err(), "COLLECTIONS_DATA_INVALID");
        assert_eq!(fs::read_to_string(fixture.store()).unwrap(), content);
    }
}

#[test]
fn concurrent_creations_serialize_read_modify_write_without_lost_updates() {
    let fixture = Fixture::new();
    let barrier = Arc::new(Barrier::new(12));
    let mut workers = Vec::new();
    for index in 0..12 {
        let paths = fixture.paths.clone();
        let barrier = Arc::clone(&barrier);
        workers.push(std::thread::spawn(move || {
            barrier.wait();
            create_collection_from_paths(&paths, &format!("Collection {index}")).unwrap();
        }));
    }
    for worker in workers {
        worker.join().expect("complete real concurrent creation");
    }
    let view = get_collections_from_paths(&fixture.paths).unwrap();
    assert_eq!(view.collections.len(), 12);
    assert_eq!(
        view.collections
            .iter()
            .map(|item| &item.id)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        12
    );
}

#[test]
fn command_request_fields_use_camel_case_and_reject_unknown_fields() {
    assert!(serde_json::from_value::<CreateCollectionRequest>(
        json!({"name":"Name", "path":"private"})
    )
    .is_err());
    assert!(serde_json::from_value::<RenameCollectionRequest>(
        json!({"collection_id":"id", "name":"Name"})
    )
    .is_err());
    assert!(serde_json::from_value::<CollectionRequest>(
        json!({"collectionId":"id", "taskId":"task"})
    )
    .is_err());
    let request: MembershipRequest =
        serde_json::from_value(json!({"collectionId":"id", "taskId":"task", "included":true}))
            .unwrap();
    assert_eq!(request.collection_id, "id");
    assert_eq!(request.task_id, "task");
    assert!(request.included);
}

#[cfg(windows)]
#[test]
fn a_real_windows_file_lock_rejects_atomic_replacement_and_preserves_original_store() {
    use std::os::windows::fs::OpenOptionsExt;
    let fixture = Fixture::new();
    let id = fixture.create("Original").collections[0].id.clone();
    let original = fs::read(fixture.store()).unwrap();
    let file = fs::OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(fixture.store())
        .unwrap();
    assert_eq!(
        rename_collection_from_paths(&fixture.paths, &id, "Changed").unwrap_err(),
        "COLLECTIONS_WRITE_FAILED"
    );
    assert_eq!(fs::read(fixture.store()).unwrap(), original);
    drop(file);
    assert!(rename_collection_from_paths(&fixture.paths, &id, "Changed").is_ok());
}

#[cfg(any(windows, unix))]
#[test]
fn linked_collection_storage_ancestor_is_rejected_without_replacing_target() {
    let fixture = Fixture::new();
    let outside = fixture.root.join("outside");
    fs::create_dir_all(outside.join("nested")).unwrap();
    let external_store = outside.join("nested/collections.json");
    let original = json!({"schemaVersion":1, "collections":[]}).to_string();
    fs::write(&external_store, &original).unwrap();
    let linked = fixture.root.join("linked-data");
    create_directory_link(&outside, &linked);
    let paths = RuntimePaths {
        user_data_dir: linked.join("nested"),
        ..fixture.paths
    };
    assert_eq!(
        get_collections_from_paths(&paths).unwrap_err(),
        "COLLECTIONS_READ_FAILED"
    );
    assert_eq!(
        create_collection_from_paths(&paths, "Name").unwrap_err(),
        "COLLECTIONS_WRITE_FAILED"
    );
    assert_eq!(fs::read_to_string(external_store).unwrap(), original);
}

#[cfg(windows)]
fn create_directory_link(source: &Path, link: &Path) {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(link)
        .arg(source)
        .creation_flags(0x08000000)
        .output()
        .expect("create actual storage junction");
    assert!(
        output.status.success(),
        "actual junction creation must succeed"
    );
}

#[cfg(unix)]
fn create_directory_link(source: &Path, link: &Path) {
    std::os::unix::fs::symlink(source, link).expect("create actual storage symlink");
}
