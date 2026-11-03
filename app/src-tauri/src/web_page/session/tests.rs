use super::*;
use std::process::{Command, Stdio};
use std::sync::Arc;

fn context() -> (RuntimePaths, PathBuf) {
    let project = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
    let resource_dir = project.join("app/src-tauri/resources");
    let helper = crate::worker_runtime::native_webview_host::helper_path(&RuntimePaths {
        resource_dir: resource_dir.clone(), user_data_dir: project.join("build/host-resource-check"),
    }).expect("a built, manifest-verified native helper is required");
    let root = project.join("build/native-session-tests").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&root).unwrap();
    (RuntimePaths { resource_dir, user_data_dir: root.canonicalize().unwrap() }, helper)
}

fn session(paths: &RuntimePaths, helper: &Path) -> NativeSession {
    NativeSession::create(paths, &uuid::Uuid::new_v4().to_string(),
        &uuid::Uuid::new_v4().to_string(), helper).unwrap()
}

fn hide(command: &mut Command) {
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))] let _ = command;
}

#[test]
#[ignore = "Requires the built native helper and bundled Python runtime"]
fn native_session_records_real_helper_and_retains_live_profile() {
    let (paths, helper) = context();
    let session = session(&paths, &helper);
    let mut command = Command::new(&helper);
    command.args(["--operation-id", &session.owner.operation_id])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    hide(&mut command);
    let mut child = command.spawn().unwrap();
    session.record("helper", child.id()).unwrap();
    assert!(session.record("worker", child.id()).is_err());
    assert!(session.record("helper", std::process::id()).is_err());
    assert!(session.cleanup().is_err());
    let before = fs::read(session.path.join(OWNER)).unwrap();
    recover(&paths).unwrap();
    assert_eq!(fs::read(session.path.join(OWNER)).unwrap(), before);
    drop(child.stdin.take());
    child.wait().unwrap();
    session.cleanup().unwrap();
    assert!(!session.path.exists());
}

#[test]
#[ignore = "Runs the formal bundled Python CLI and requires the built native helper"]
fn native_session_recovers_actual_atomic_save_after_stdout_interruption() {
    let (paths, helper) = context();
    let session = session(&paths, &helper);
    let article = HostArticle {
        navigation_generation: 1, final_url: "https://www.python.org/doc/?id=12".into(),
        title: "持久正文[原始字节]🙂".into(), text: "真实正文 UTF-8 🙂。\r\n".repeat(30_000),
        markdown: "## 真实正文\r\n\r\n段落保留原始字节🙂。\r\n".repeat(20_000),
    };
    let task_id = format!("20261102-123456-web-{}", &uuid::Uuid::new_v4().simple().to_string()[..16]);
    session.prepare_save(&task_id, &article).unwrap();
    assert!(session.recover_saved(&paths).unwrap().is_none());
    let payload = serde_json::json!({
        "contract_version": 2, "operation_id": session.owner.operation_id,
        "task_id": task_id, "article": { "title": article.title, "sourceUrl": article.final_url,
            "text": article.text, "markdown": article.markdown },
    });
    let output = paths.output_root().unwrap();
    let mut command = Command::new(crate::bundled_python_path(&paths.resource_dir));
    command.args(["-m", "frameq_worker", "--save-web-page-stdin", "--web-operation-id",
        &session.owner.operation_id]).env_clear()
        .env("PYTHONPATH", Path::new(env!("CARGO_MANIFEST_DIR")).join("../../worker").canonicalize().unwrap())
        .env("PYTHONUTF8", "1").env("PYTHONDONTWRITEBYTECODE", "1").env("PYTHONNOUSERSITE", "1")
        .env("FRAMEQ_OUTPUT_DIR", &output).env("FRAMEQ_CACHE_DIR", paths.cache_root().unwrap())
        .current_dir(&paths.user_data_dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for key in ["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "HOMEDRIVE", "HOMEPATH",
        "TEMP", "TMP", "TMPDIR"] {
        command.env(key, &paths.user_data_dir);
    }
    for key in ["SYSTEMROOT", "WINDIR", "SYSTEMDRIVE"] {
        if let Some(value) = std::env::var_os(key) { command.env(key, value); }
    }
    hide(&mut command);
    let mut child = command.spawn().unwrap();
    session.record("worker", child.id()).unwrap();
    let delivered = child.stdin.take().unwrap().write_all(&serde_json::to_vec(&payload).unwrap());
    if let Err(error) = delivered {
        let _ = child.kill();
        let output = child.wait_with_output().unwrap();
        panic!("real CLI request delivery failed: {error}; stdout={}; stderr={}",
            String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    }
    let task = output.join("tasks").join(&task_id);
    let deadline = Instant::now() + Duration::from_secs(60);
    while !(task.join("frameq-task.json").is_file()
        && !task.join(".frameq-artifact-transaction.json").exists()) {
        if child.try_wait().unwrap().is_some() || Instant::now() >= deadline {
            let _ = child.kill();
            let output = child.wait_with_output().unwrap();
            panic!("real save did not publish: {}", String::from_utf8_lossy(&output.stderr));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(child.try_wait().unwrap().is_none(), "stdout pipe must apply actual backpressure");
    child.kill().unwrap(); child.wait().unwrap();
    let recovered = session.recover_saved(&paths).unwrap().expect("published durable task");
    assert_eq!(recovered.task_id.as_deref(), Some(task_id.as_str()));
    assert_eq!(recovered.text.as_bytes(), article.text.as_bytes());
    assert!(recovered.markdown.ends_with(&article.markdown));
    fs::write(task.join("article/article.txt"), "Changed authoritative body\r\n").unwrap();
    assert!(session.recover_saved(&paths).is_err());
    assert!(session.cleanup().is_err());
    assert!(session.path.join(SAVE).exists());
    fs::write(task.join("article/article.txt"), article.text.as_bytes()).unwrap();
    session.cleanup().unwrap();
    assert!(task.join("frameq-task.json").is_file());
}

#[test]
#[ignore = "Requires the built native helper and bundled Python runtime"]
fn native_session_rejects_replaced_owner_and_preserves_material() {
    let (paths, helper) = context();
    let session = session(&paths, &helper);
    fs::write(session.profile().join("sentinel"), b"retain uncertain profile").unwrap();
    assert!(session.cleanup_before(Instant::now()).is_err());
    assert_eq!(fs::read(session.path.join(OWNER)).unwrap(), session.owner_bytes);
    assert_eq!(fs::read(session.profile().join("sentinel")).unwrap(), b"retain uncertain profile");
    let mut owner: serde_json::Value = serde_json::from_slice(&session.owner_bytes).unwrap();
    owner["session_id"] = serde_json::json!(uuid::Uuid::new_v4().to_string());
    fs::write(session.path.join(OWNER), serde_json::to_vec(&owner).unwrap()).unwrap();
    assert!(session.cleanup().is_err());
    assert_eq!(fs::read(session.profile().join("sentinel")).unwrap(), b"retain uncertain profile");
}

#[test]
#[ignore = "Requires the built native helper and bundled Python runtime"]
fn native_session_deadline_retains_identity_and_allows_cleanup_retry() {
    let (paths, helper) = context();
    let session = session(&paths, &helper);
    for index in 0..1_000 {
        fs::write(session.profile().join(format!("cache-{index}.bin")), b"owned cache data").unwrap();
    }
    assert!(session.cleanup_before(Instant::now() + Duration::from_millis(1)).is_err());
    assert_eq!(fs::read(session.path.join(OWNER)).unwrap(), session.owner_bytes);
    assert!(session.path.join(MEMBERS).is_file());
    assert_eq!(safe::identity(&session.profile()).unwrap(), session.owner.profile);
    session.cleanup().unwrap();
    assert!(!session.path.exists());
}

#[test]
#[ignore = "Runs real owner and native helper processes"]
fn native_session_recovers_verified_receipt_after_actual_owner_exit() {
    const CONFIG: &str = "FRAMEQ_NATIVE_SESSION_OWNER_CONFIG";
    if let Some(config) = std::env::var_os(CONFIG) {
        let resource_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").canonicalize().unwrap();
        let paths = RuntimePaths { resource_dir, user_data_dir: PathBuf::from(config) };
        let helper = crate::worker_runtime::native_webview_host::helper_path(&paths).unwrap();
        let session = Arc::new(session(&paths, &helper));
        let mut command = Command::new(helper);
        command.args(["--operation-id", &session.owner.operation_id])
            .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
        hide(&mut command);
        let mut child = command.spawn().unwrap();
        session.record("helper", child.id()).unwrap();
        let task_id = if std::env::var_os("FRAMEQ_NATIVE_SESSION_PUBLISH").is_some() {
            let article = HostArticle {
                navigation_generation: 1, final_url: "https://www.python.org/doc/".into(),
                title: "重启恢复正文".into(), text: "持久正文 Unicode 🙂。\r\n".repeat(20),
                markdown: "## 正文\r\n\r\n原始段落🙂。\r\n".into(),
            };
            let id = format!("20261102-123456-web-{}", &uuid::Uuid::new_v4().simple().to_string()[..16]);
            session.prepare_save(&id, &article).unwrap();
            let payload = serde_json::json!({
                "contract_version": 2, "operation_id": session.owner.operation_id,
                "task_id": id, "article": { "title": article.title, "sourceUrl": article.final_url,
                    "text": article.text, "markdown": article.markdown },
            }).to_string();
            let supervisors = crate::ProcessSupervisors::default();
            let outcome = supervisors.task_worker(&paths).execute(
                crate::worker_runtime::WorkerJob::save_web_page(payload,
                    crate::worker_runtime::ProgressRoute::None.with_web_session(Arc::clone(&session))),
            ).unwrap().unwrap();
            assert!(matches!(outcome, crate::worker_runtime::WorkerRunOutcome::Structured(
                crate::worker_runtime::ValidatedWorkerResult::Task(_))));
            Some(id)
        } else { None };
        fs::write(session.profile().join("sentinel"), b"owned profile").unwrap();
        fs::write(paths.user_data_dir.join("owner-ready.json"), serde_json::to_vec(
            &serde_json::json!({ "path": session.path, "helper_pid": child.id(), "task_id": task_id }),
        ).unwrap()).unwrap();
        std::thread::sleep(Duration::from_secs(90));
        child.kill().unwrap(); child.wait().unwrap();
        return;
    }
    for published in [false, true] { verify_owner_exit(published); }
}

fn verify_owner_exit(published: bool) {
    const CASE: &str = "web_page::session::tests::native_session_recovers_verified_receipt_after_actual_owner_exit";
    const CONFIG: &str = "FRAMEQ_NATIVE_SESSION_OWNER_CONFIG";
    let (paths, _) = context();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.args(["--exact", CASE, "--ignored", "--nocapture"])
        .env(CONFIG, &paths.user_data_dir).stdin(Stdio::null())
        .stdout(Stdio::from(fs::File::create(paths.user_data_dir.join("owner-stdout.log")).unwrap()))
        .stderr(Stdio::from(fs::File::create(paths.user_data_dir.join("owner-stderr.log")).unwrap()));
    hide(&mut command);
    if published { command.env("FRAMEQ_NATIVE_SESSION_PUBLISH", "1"); }
    let mut owner = command.spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    let ready = paths.user_data_dir.join("owner-ready.json");
    while !ready.exists() {
        if owner.try_wait().unwrap().is_some() || Instant::now() >= deadline {
            let _ = owner.kill(); let _ = owner.wait();
            panic!("owner failed to record its real helper: {}",
                fs::read_to_string(paths.user_data_dir.join("owner-stderr.log")).unwrap());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let ready: serde_json::Value = serde_json::from_slice(&fs::read(ready).unwrap()).unwrap();
    let owned = PathBuf::from(ready["path"].as_str().unwrap());
    recover(&paths).unwrap();
    assert_eq!(fs::read(owned.join("profile/sentinel")).unwrap(), b"owned profile");
    owner.kill().unwrap(); owner.wait().unwrap();
    if published {
        let id = ready["task_id"].as_str().unwrap();
        let text = paths.output_root().unwrap().join("tasks").join(id).join("article/article.txt");
        fs::write(&text, b"changed authoritative article").unwrap();
        assert!(recover(&paths).is_err());
        assert!(owned.join(OWNER).is_file());
        fs::write(&text, "持久正文 Unicode 🙂。\r\n".repeat(20)).unwrap();
    }
    recover(&paths).unwrap();
    assert!(!owned.exists());
}
