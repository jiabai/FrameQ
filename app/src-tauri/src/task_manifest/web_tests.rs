use super::{SupportedTask, SourceTextKind, TaskArtifactMutation};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn output_root() -> PathBuf {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../build")
        .join(format!("rust-web-storage-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    root.canonicalize().unwrap()
}

pub(crate) fn manifest(task_id: &str) -> Value {
    json!({
        "schema_version":4,"source_privacy_migration_version":2,
        "source_privacy_quarantined":false,"task_id":task_id,
        "created_at":"2026-11-01T08:00:00Z","updated_at":"2026-11-01T08:00:00Z",
        "source_kind":"web_page","source_url":"https://example.com/article?id=12",
        "source_identity":null,"platform":"web","status":"completed",
        "model":null,"transcript":null,"web_source":{"title":"网页标题", "extracted_at":"2026-11-01T08:00:00Z"},
        "artifacts":{"article_txt":"article/article.txt","article_md":"article/article.md"},
        "text_preview":"正文","error":null,"insights_count":0
    })
}

pub(crate) fn write_task(root: &Path, task_id: &str, value: &Value) -> PathBuf {
    let task = root.join("tasks").join(task_id);
    fs::create_dir_all(task.join("article")).unwrap();
    fs::write(task.join("article/article.txt"), "第一段。\r\n\r\n第二段。\n").unwrap();
    fs::write(task.join("article/article.md"), "# 网页标题\n\n第一段。\n\n第二段。\n").unwrap();
    fs::write(task.join("frameq-task.json"), serde_json::to_vec_pretty(value).unwrap()).unwrap();
    task
}

#[test]
fn web_source_text_retains_exact_bytes_and_is_reloaded_each_time() {
    let root = output_root();
    let dir = write_task(&root, "web-1", &manifest("web-1"));
    let task = SupportedTask::open(&root, "web-1").unwrap();
    let first = task.read_source_text().unwrap();
    assert_eq!(first.kind, SourceTextKind::Article);
    assert_eq!(first.artifact_key, "article_txt");
    assert_eq!(first.raw_bytes, "第一段。\r\n\r\n第二段。\n".as_bytes());
    assert_eq!(first.text.as_bytes(), first.raw_bytes);
    assert_eq!(task.read_article_markdown().unwrap(), "# 网页标题\n\n第一段。\n\n第二段。\n");
    fs::write(dir.join("article/article.txt"), "新的正式正文。\n").unwrap();
    let second = task.read_source_text().unwrap();
    assert_ne!(first.sha256, second.sha256);
    assert_eq!(second.text, "新的正式正文。\n");
}

#[test]
fn web_manifest_rejects_mixed_missing_and_unknown_fields() {
    let root = output_root();
    let valid = manifest("web-1");
    let changes = [
        ("schema_version", json!(3)), ("schema_version", json!(5)),
        ("source_kind", json!("url")), ("source_identity", json!({})),
        ("model", json!("iic/SenseVoiceSmall")), ("transcript", json!({"source":"asr"})),
        ("platform", json!("youtube")), ("local_source", json!({"display_name":"clip.mp3","extension":"mp3","media_kind":"audio"})),
        ("source_url", json!("https://example.com/article?token=secret")),
        ("web_source", json!({"title":"Title","extracted_at":"2026-02-30T08:00:00Z"})),
        ("web_source", json!({"title":"Title","extracted_at":"2026-11-01T08:00:00+08:00"})),
        ("web_source", json!({"title":"Title","extracted_at":"2026-11-01T08:00:00Z","url":"https://example.com/"})),
    ];
    for (key, value) in changes {
        let mut altered = valid.clone(); altered[key] = value;
        write_task(&root, "web-1", &altered);
        assert!(SupportedTask::open(&root, "web-1").is_err(), "{key}");
    }
    for key in ["model", "transcript", "source_identity", "source_kind", "web_source"] {
        let mut altered = valid.clone(); altered.as_object_mut().unwrap().remove(key);
        write_task(&root, "web-1", &altered);
        assert!(SupportedTask::open(&root, "web-1").is_err(), "missing {key}");
    }
    for (key, value) in [("article_txt", "../article.txt"), ("article_md", "article/other.md"), ("transcript_txt", "transcript/transcript.txt"), ("unknown", "article/article.txt")] {
        let mut altered = valid.clone(); altered["artifacts"][key] = json!(value);
        write_task(&root, "web-1", &altered);
        assert!(SupportedTask::open(&root, "web-1").is_err(), "artifact {key}");
    }
}

#[test]
fn web_source_reader_rejects_hardlinks_missing_utf8_and_oversize() {
    let root = output_root();
    let dir = write_task(&root, "web-1", &manifest("web-1"));
    let path = dir.join("article/article.txt");
    let task = SupportedTask::open(&root, "web-1").unwrap();
    fs::hard_link(&path, root.join("linked.txt")).unwrap();
    assert!(task.read_source_text().is_err());
    fs::remove_file(root.join("linked.txt")).unwrap();
    fs::write(&path, [0xff, 0xfe]).unwrap();
    assert!(task.read_source_text().is_err());
    fs::write(&path, vec![b'a'; 2 * 1024 * 1024 + 1]).unwrap();
    assert!(task.read_source_text().is_err());
    fs::remove_file(path).unwrap();
    assert!(task.read_source_text().is_err());
}

#[test]
fn source_reader_rejects_replaced_task_directory_identity() {
    let root = output_root();
    let dir = write_task(&root, "web-1", &manifest("web-1"));
    let task = SupportedTask::open(&root, "web-1").unwrap();
    fs::rename(&dir, root.join("tasks/original-web-1")).unwrap();
    write_task(&root, "web-1", &manifest("web-1"));
    assert!(task.read_source_text().is_err());
    assert!(task.read_article_markdown().is_err());
    assert!(task.reload(&root).is_err());
}

#[cfg(windows)]
#[test]
fn web_source_reader_rejects_junction_parent() {
    let root = output_root();
    let dir = write_task(&root, "web-1", &manifest("web-1"));
    let outside = root.join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("article.txt"), "Private sentinel.\n").unwrap();
    let task = SupportedTask::open(&root, "web-1").unwrap();
    fs::rename(dir.join("article"), dir.join("original-article")).unwrap();
    let status = std::process::Command::new("cmd.exe").args(["/D", "/C", "mklink", "/J"])
        .arg(dir.join("article")).arg(&outside)
        .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().unwrap();
    assert!(status.success());
    assert!(task.read_source_text().is_err());
    assert_eq!(fs::read_to_string(outside.join("article.txt")).unwrap(), "Private sentinel.\n");
    fs::remove_dir(dir.join("article")).unwrap();
}

#[cfg(unix)]
#[test]
fn web_source_reader_rejects_symbolic_parent() {
    let root = output_root();
    let dir = write_task(&root, "web-1", &manifest("web-1"));
    let task = SupportedTask::open(&root, "web-1").unwrap();
    fs::rename(dir.join("article"), dir.join("original-article")).unwrap();
    std::os::unix::fs::symlink(dir.join("original-article"), dir.join("article")).unwrap();
    assert!(task.read_source_text().is_err());
}

#[test]
fn webpage_transaction_publishes_manifest_last_and_recovers_shared_journal() {
    let root = output_root();
    let task_dir = root.join("tasks/web-1");
    fs::create_dir_all(&task_dir).unwrap();
    super::commit_task_artifacts(&task_dir, vec![
        TaskArtifactMutation::manifest(serde_json::to_vec(&manifest("web-1")).unwrap()),
        TaskArtifactMutation::replace("article/article.txt", b"article\n".to_vec()),
        TaskArtifactMutation::replace("article/article.md", b"# article\n".to_vec()),
    ]).unwrap();
    assert_eq!(SupportedTask::open(&root, "web-1").unwrap().read_source_text().unwrap().text, "article\n");
    let id = "cccccccccccccccccccccccccccccccc";
    fs::write(task_dir.join("article/.frameq-artifact-cccccccccccccccccccccccccccccccc-0.rollback"), b"article\n").unwrap();
    fs::write(task_dir.join("article/article.txt"), b"interrupted").unwrap();
    fs::write(task_dir.join(super::transaction::JOURNAL_FILE_NAME), serde_json::to_vec(&json!({
        "schema_version":1,"transaction_id":id,"state":"prepared","entries":[{
            "destination":"article/article.txt", "staging":format!("article/.frameq-artifact-{id}-0.staging"),
            "rollback":format!("article/.frameq-artifact-{id}-0.rollback"),"existed_before":true
        }]
    })).unwrap()).unwrap();
    assert!(SupportedTask::scan_read_only(&root).unwrap().into_tasks().is_empty());
    let restored = SupportedTask::open(&root, "web-1").unwrap();
    assert_eq!(restored.read_source_text().unwrap().text, "article\n");
    assert!(!task_dir.join(super::transaction::JOURNAL_FILE_NAME).exists());
}

#[test]
#[ignore = "Runs real Python and Rust child processes; requires the installed worker Python environment"]
fn webpage_cross_language_journals_recover_real_process_interruptions() {
    const CHILD_TASK: &str = "FRAMEQ_STORAGE_TEST_TASK_DIR";
    let project = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
    if let Some(path) = std::env::var_os(CHILD_TASK) {
        let task = PathBuf::from(path).canonicalize().unwrap();
        assert!(task.starts_with(project.join("build")));
        super::transaction::interrupt_article_commit_for_test(&task);
        unreachable!();
    }
    let python = std::env::var_os("FRAMEQ_STORAGE_TEST_PYTHON").map(PathBuf::from)
        .unwrap_or_else(|| project.join(if cfg!(windows) { ".venv/Scripts/python.exe" } else { ".venv/bin/python" }));
    let helper = project.join("worker/tests/helpers/web_storage_interop.py");
    let root = output_root();
    let task = write_task(&root, "web-interop", &manifest("web-interop"));
    let original_text = fs::read(task.join("article/article.txt")).unwrap();
    let original_markdown = fs::read(task.join("article/article.md")).unwrap();
    let interrupted = std::process::Command::new(&python).arg(&helper).arg("interrupted").arg(&task)
        .env("PYTHONPATH", project.join("worker")).current_dir(&project).output().unwrap();
    assert_eq!(interrupted.status.code(), Some(73), "{}", String::from_utf8_lossy(&interrupted.stderr));
    assert_eq!(fs::read(task.join("article/article.txt")).unwrap(), b"Python article revision\n");
    assert_eq!(super::recover_task_artifacts(&task).unwrap(), super::transaction::RecoveryOutcome::RolledBack);
    assert_eq!(fs::read(task.join("article/article.txt")).unwrap(), original_text);
    assert_eq!(fs::read(task.join("article/article.md")).unwrap(), original_markdown);
    let interrupted = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "task_manifest::web_tests::webpage_cross_language_journals_recover_real_process_interruptions", "--ignored", "--nocapture"])
        .env(CHILD_TASK, &task).current_dir(&project).output().unwrap();
    assert_eq!(interrupted.status.code(), Some(74), "{}", String::from_utf8_lossy(&interrupted.stderr));
    assert_eq!(fs::read(task.join("article/article.txt")).unwrap(), b"Rust article revision\n");
    let recovered = std::process::Command::new(&python).arg(helper).arg("recover").arg(&task)
        .env("PYTHONPATH", project.join("worker")).current_dir(project).output().unwrap();
    assert!(recovered.status.success(), "{}", String::from_utf8_lossy(&recovered.stderr));
    assert_eq!(String::from_utf8(recovered.stdout).unwrap().trim(), "rolled_back");
    assert_eq!(fs::read(task.join("article/article.txt")).unwrap(), original_text);
    assert_eq!(fs::read(task.join("article/article.md")).unwrap(), original_markdown);
    assert!(!task.join(super::transaction::JOURNAL_FILE_NAME).exists());
}
