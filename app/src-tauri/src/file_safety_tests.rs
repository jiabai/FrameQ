use crate::{atomic_files, draft_detail, local_media, task_manifest, transcript_detail};
use serde_json::json;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const TASK_ID: &str = "20261029-120000-douyin-7645505408425004329";
const TRANSCRIPT: &str = "Original transcript.\n";
const TRANSCRIPT_MD: &str = "# Source\n\n## Transcript\n\nOriginal transcript.\n";
const DRAFT: &str = "# Draft\n\nOriginal draft.\n";
const OUTSIDE: &[u8] = b"Outside content must remain unchanged.\n";

struct TaskFixture {
    output: PathBuf,
    task: PathBuf,
}

impl TaskFixture {
    fn new(root: &Path) -> Self {
        let output = root.join("outputs");
        let task = output.join("tasks").join(TASK_ID);
        fs::create_dir_all(task.join("transcript")).expect("create transcript directory");
        fs::create_dir_all(task.join("ai")).expect("create draft directory");
        fs::write(task.join("transcript/transcript.txt"), TRANSCRIPT).expect("write transcript");
        fs::write(task.join("transcript/transcript.md"), TRANSCRIPT_MD).expect("write markdown");
        fs::write(task.join("ai/draft.md"), DRAFT).expect("write draft");
        let manifest = json!({
            "schema_version": 3,
            "source_privacy_migration_version": 2,
            "task_id": TASK_ID,
            "created_at": "2026-10-29T12:00:00Z",
            "source_url": "https://www.douyin.com/video/7645505408425004329",
            "source_identity": {
                "version": 1,
                "platform": "douyin",
                "stable_id": "7645505408425004329",
                "effective_part": null,
                "canonical_url": "https://www.douyin.com/video/7645505408425004329"
            },
            "platform": "douyin",
            "status": "completed",
            "artifacts": {
                "transcript_txt": "transcript/transcript.txt",
                "transcript_md": "transcript/transcript.md",
                "draft": "ai/draft.md"
            },
            "error": null,
            "text_preview": "Original transcript.",
            "insights_count": 0
        });
        fs::write(
            task.join("frameq-task.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .expect("write task manifest");
        Self { output, task }
    }

    fn manifest(&self) -> Vec<u8> {
        fs::read(self.task.join("frameq-task.json")).expect("read manifest")
    }

    fn save_transcript(&self, text: &str) -> bool {
        transcript_detail::save_transcript_edit_to_output_root(
            &self.output,
            serde_json::from_value(json!({ "task_id": TASK_ID, "text": text }))
                .expect("decode transcript request"),
        )
        .is_ok()
    }

    fn save_draft(&self, markdown: &str) -> bool {
        draft_detail::save_draft_edit_to_output_root(
            &self.output,
            serde_json::from_value(json!({ "task_id": TASK_ID, "markdown": markdown }))
                .expect("decode draft request"),
        )
        .is_ok()
    }

    fn assert_saves_rejected(&self) {
        let manifest = self.manifest();
        assert!(!self.save_transcript("Unwanted transcript replacement."));
        assert!(!self.save_draft("Unwanted draft replacement."));
        assert_eq!(self.manifest(), manifest);
        assert!(!self.task.join(".frameq-artifact-transaction.json").exists());
    }
}

fn root(label: &str) -> PathBuf {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../build")
        .join(format!("file-safety-{label}-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).expect("create safety test directory");
    path.canonicalize()
        .expect("resolve physical test directory")
}

fn assert_link(path: &Path) {
    let metadata = fs::symlink_metadata(path).expect("inspect actual link");
    assert!(task_manifest::is_link_or_reparse_point(&metadata));
    assert_eq!(
        task_manifest::reject_linked_artifact_target(path).unwrap_err(),
        "Task artifact cannot be a link or reparse point."
    );
}

#[test]
fn ordinary_paths_preserve_entry_type_rules_and_original_backup_layout() {
    let root = root("ordinary");
    let fixture = TaskFixture::new(&root);
    let media = root.join("source.mp3");
    fs::write(&media, b"ordinary source file").expect("write source file");
    for path in [&root, &media, &fixture.task] {
        assert!(!task_manifest::is_link_or_reparse_point(
            &fs::symlink_metadata(path).expect("inspect ordinary path")
        ));
        assert!(task_manifest::reject_linked_artifact_target(path).is_ok());
    }
    assert!(task_manifest::reject_linked_artifact_target(&root.join("absent.txt")).is_ok());
    assert_eq!(
        task_manifest::original_backup_path(&fixture.task.join("transcript/transcript.txt")),
        fixture.task.join("transcript/original/transcript.txt")
    );
    assert_eq!(
        task_manifest::original_backup_path(&fixture.task.join("ai/draft.md")),
        fixture.task.join("ai/original/draft.md")
    );
    let state = local_media::LocalMediaSelectionState::default();
    assert!(state.select_for_path(&media).is_ok());
    assert_eq!(
        state.select_for_path(&root).err(),
        Some("LOCAL_MEDIA_UNAVAILABLE")
    );
    atomic_files::atomic_write(&media, b"replaced source file").expect("replace ordinary file");
    assert_eq!(fs::read(&media).unwrap(), b"replaced source file");
    atomic_files::atomic_remove_file(&media).expect("remove ordinary file");
    assert!(!media.exists());
    assert!(atomic_files::atomic_write(&root, b"cannot replace directory").is_err());
    assert!(atomic_files::atomic_remove_file(&root).is_err());
    {
        let task = task_manifest::SupportedTask::open(&fixture.output, TASK_ID)
            .expect("open regular task directory");
        assert!(task
            .required_existing_artifact_path(task_manifest::TaskArtifact::TranscriptTxt)
            .is_ok());
        assert!(task
            .required_existing_artifact_path(task_manifest::TaskArtifact::Draft)
            .is_ok());
    }
    assert!(fixture.save_transcript("First edited transcript."));
    assert!(fixture.save_draft("First edited draft."));
    assert!(fixture.save_transcript("Second edited transcript."));
    assert!(fixture.save_draft("Second edited draft."));
    for (relative, content) in [
        ("transcript/original/transcript.txt", TRANSCRIPT),
        ("transcript/original/transcript.md", TRANSCRIPT_MD),
        ("ai/original/draft.md", DRAFT),
    ] {
        assert_eq!(
            fs::read_to_string(fixture.task.join(relative)).unwrap(),
            content
        );
    }
    assert!(!fixture
        .task
        .join(".frameq-artifact-transaction.json")
        .exists());
}

#[test]
fn ordinary_directories_cannot_replace_transcript_or_draft_files() {
    let root = root("directory-artifacts");
    let fixture = TaskFixture::new(&root);
    for relative in ["transcript/transcript.txt", "ai/draft.md"] {
        let path = fixture.task.join(relative);
        fs::remove_file(&path).expect("remove ordinary artifact file");
        fs::create_dir(&path).expect("create directory at artifact position");
    }
    fixture.assert_saves_rejected();
}

#[test]
fn file_symlinks_are_rejected_across_selection_storage_and_editing() {
    file_symlink_matrix(false);
}

#[test]
fn dangling_file_symlinks_are_rejected_without_creating_external_files() {
    file_symlink_matrix(true);
}

fn file_symlink_matrix(dangling: bool) {
    let root = root(if dangling {
        "dangling-file"
    } else {
        "file-link"
    });
    let outside = root.join("outside.txt");
    if !dangling {
        fs::write(&outside, OUTSIDE).expect("write external sentinel");
    }
    let media = root.join("linked-source.mp3");
    if !available_symlink(create_file_symlink(&outside, &media), "file symlink") {
        return;
    }
    assert_link(&media);
    let state = local_media::LocalMediaSelectionState::default();
    assert_eq!(
        state.select_for_path(&media).err(),
        Some("LOCAL_MEDIA_LINKED")
    );
    assert!(atomic_files::atomic_write(&media, b"unwanted write").is_err());
    assert!(atomic_files::atomic_remove_file(&media).is_err());

    let fixture = TaskFixture::new(&root.join("artifact-links"));
    for relative in ["transcript/transcript.txt", "ai/draft.md"] {
        let path = fixture.task.join(relative);
        fs::remove_file(&path).expect("remove original artifact before linking");
        create_file_symlink(&outside, &path).expect("create artifact symlink");
        assert_link(&path);
    }
    {
        let task = task_manifest::SupportedTask::open(&fixture.output, TASK_ID)
            .expect("open task with linked artifacts");
        for artifact in [
            task_manifest::TaskArtifact::TranscriptTxt,
            task_manifest::TaskArtifact::Draft,
        ] {
            assert!(task.required_existing_artifact_path(artifact).is_err());
        }
    }
    fixture.assert_saves_rejected();

    let backups = TaskFixture::new(&root.join("backup-links"));
    for relative in ["transcript/original/transcript.txt", "ai/original/draft.md"] {
        let path = backups.task.join(relative);
        fs::create_dir_all(path.parent().unwrap()).expect("create original directory");
        create_file_symlink(&outside, &path).expect("create original backup symlink");
        assert_link(&path);
    }
    backups.assert_saves_rejected();
    assert_eq!(
        fs::read_to_string(backups.task.join("transcript/transcript.txt")).unwrap(),
        TRANSCRIPT
    );
    assert_eq!(
        fs::read_to_string(backups.task.join("ai/draft.md")).unwrap(),
        DRAFT
    );
    if dangling {
        assert!(!outside.exists());
        assert!(fs::symlink_metadata(&outside).is_err());
    } else {
        assert_eq!(fs::read(&outside).unwrap(), OUTSIDE);
    }
}

#[test]
fn directory_symlinks_are_rejected_across_source_atomic_task_and_edit_entries() {
    directory_link_matrix(false);
}

#[cfg(windows)]
#[test]
fn windows_junctions_are_rejected_across_source_atomic_task_and_edit_entries() {
    directory_link_matrix(true);
}

fn directory_link_matrix(junction: bool) {
    let root = root(if junction {
        "junction"
    } else {
        "directory-link"
    });
    let outside = root.join("outside");
    fs::create_dir_all(&outside).expect("create external directory");
    let sentinel = outside.join("source.mp3");
    fs::write(&sentinel, OUTSIDE).expect("write external source sentinel");
    let linked_parent = root.join("linked-parent");
    let created = create_directory_link(&outside, &linked_parent, junction);
    if junction {
        created.expect("Windows junction creation is required");
    } else if !available_symlink(created, "directory symlink") {
        return;
    }
    assert_link(&linked_parent);
    let media = linked_parent.join("source.mp3");
    assert_eq!(
        task_manifest::reject_linked_artifact_target(&media).unwrap_err(),
        "Task artifact parent cannot be a link or reparse point."
    );
    let state = local_media::LocalMediaSelectionState::default();
    assert_eq!(
        state.select_for_path(&media).err(),
        Some("LOCAL_MEDIA_LINKED")
    );
    assert!(atomic_files::atomic_write(&media, b"unwanted write").is_err());
    assert!(atomic_files::atomic_remove_file(&media).is_err());
    assert_eq!(fs::read(&sentinel).unwrap(), OUTSIDE);

    let external_task = TaskFixture::new(&root.join("outside-task"));
    let alias_output = root.join("alias-output");
    fs::create_dir_all(alias_output.join("tasks")).expect("create alias task parent");
    create_directory_link(
        &external_task.task,
        &alias_output.join("tasks").join(TASK_ID),
        junction,
    )
    .expect("link task directory");
    let original_manifest = external_task.manifest();
    assert!(task_manifest::SupportedTask::open(&alias_output, TASK_ID).is_err());
    let alias = TaskFixture {
        output: alias_output,
        task: external_task.task.clone(),
    };
    alias.assert_saves_rejected();
    assert_eq!(external_task.manifest(), original_manifest);
    assert_eq!(
        fs::read_to_string(external_task.task.join("transcript/transcript.txt")).unwrap(),
        TRANSCRIPT
    );
    assert_eq!(
        fs::read_to_string(external_task.task.join("ai/draft.md")).unwrap(),
        DRAFT
    );

    let linked_artifacts = TaskFixture::new(&root.join("artifact-parents"));
    for (directory, files) in [
        ("transcript", &["transcript.txt", "transcript.md"][..]),
        ("ai", &["draft.md"][..]),
    ] {
        let target = outside.join(directory);
        fs::create_dir(&target).expect("create external artifact directory");
        let parent = linked_artifacts.task.join(directory);
        for file in files {
            fs::remove_file(parent.join(file)).expect("remove original artifact");
            fs::write(target.join(file), OUTSIDE).expect("write external artifact sentinel");
        }
        fs::remove_dir(&parent).expect("remove empty ordinary artifact directory");
        create_directory_link(&target, &parent, junction).expect("link artifact parent");
        assert_link(&parent);
    }
    linked_artifacts.assert_saves_rejected();
    for relative in [
        "transcript/transcript.txt",
        "transcript/transcript.md",
        "ai/draft.md",
    ] {
        assert_eq!(fs::read(outside.join(relative)).unwrap(), OUTSIDE);
    }

    let linked_backups = TaskFixture::new(&root.join("backup-parents"));
    for directory in ["transcript", "ai"] {
        let target = outside.join(format!("{directory}-original"));
        fs::create_dir(&target).expect("create external backup directory");
        create_directory_link(
            &target,
            &linked_backups.task.join(directory).join("original"),
            junction,
        )
        .expect("link original backup directory");
    }
    linked_backups.assert_saves_rejected();
    for directory in ["transcript", "ai"] {
        assert_eq!(
            fs::read_dir(outside.join(format!("{directory}-original")))
                .unwrap()
                .count(),
            0
        );
    }
}

fn available_symlink(result: io::Result<()>, kind: &str) -> bool {
    match result {
        Ok(()) => true,
        #[cfg(windows)]
        Err(error) if matches!(error.raw_os_error(), Some(5 | 1314)) => {
            eprintln!("PLATFORM LIMITATION: cannot create {kind}: {error}; junction coverage remains mandatory.");
            false
        }
        Err(error) => panic!("failed to create {kind}: {error}"),
    }
}

#[cfg(windows)]
fn create_file_symlink(source: &Path, link: &Path) -> io::Result<()> {
    std::os::windows::fs::symlink_file(source, link)
}

#[cfg(unix)]
fn create_file_symlink(source: &Path, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(source, link)
}

#[cfg(windows)]
fn create_directory_link(source: &Path, link: &Path, junction: bool) -> io::Result<()> {
    use std::os::windows::process::CommandExt;
    if !junction {
        return std::os::windows::fs::symlink_dir(source, link);
    }
    let output = std::process::Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(link)
        .arg(source)
        .creation_flags(0x08000000)
        .output()?;
    assert!(
        output.status.success(),
        "junction creation failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

#[cfg(unix)]
fn create_directory_link(source: &Path, link: &Path, junction: bool) -> io::Result<()> {
    assert!(!junction, "junction fixtures are Windows-specific");
    std::os::unix::fs::symlink(source, link)
}
