use super::*;

#[test]
fn hardlinked_owner_executable_is_preserved_live_and_recovered_after_exit() {
    use std::process::{Command, Stdio};
    const NAME: &str = "web_page::ownership::tests::hardlinked_owner_executable_is_preserved_live_and_recovered_after_exit";
    const CACHE: &str = "APP_HARDLINKED_OWNER_CACHE";
    const COMPONENT: &str = "APP_HARDLINKED_OWNER_COMPONENT";
    if let Some(cache) = std::env::var_os(CACHE) {
        let cache = PathBuf::from(cache);
        let component = PathBuf::from(std::env::var_os(COMPONENT).unwrap());
        let executable = std::env::current_exe().unwrap();
        assert!(Executable::read(&executable).is_err());
        let system = processes();
        assert!(Member::read(system.process(Pid::from_u32(std::process::id())).unwrap()).is_err());
        assert!(OwnedWorkspace::new(&cache, &uuid::Uuid::new_v4().to_string(), &component,
            &executable, component.parent().unwrap(), false).is_err());
        let owned = OwnedWorkspace::new(&cache, &uuid::Uuid::new_v4().to_string(), &component,
            &component, component.parent().unwrap(), false).unwrap();
        fs::write(cache.join("ready.json"), serde_json::to_vec(&serde_json::json!({ "workspace": owned.path })).unwrap()).unwrap();
        std::thread::sleep(Duration::from_secs(30));
        drop(owned);
        return;
    }
    let cache = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/web-ownership")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&cache).unwrap();
    let cache = cache.canonicalize().unwrap();
    let executable = std::env::current_exe().unwrap().canonicalize().unwrap();
    let copied = cache.join(if cfg!(windows) { "owner-original.exe" } else { "owner-original" });
    let linked = cache.join(if cfg!(windows) { "owner-linked.exe" } else { "owner-linked" });
    fs::copy(&executable, &copied).unwrap();
    fs::hard_link(&copied, &linked).unwrap();
    assert!(Executable::read(&linked).is_err());
    let mut command = Command::new(&linked);
    command.args(["--exact", NAME, "--nocapture"]).env(CACHE, &cache).env(COMPONENT, &executable)
        .stdin(Stdio::null()).stdout(Stdio::from(fs::File::create(cache.join("stdout.log")).unwrap()))
        .stderr(Stdio::from(fs::File::create(cache.join("stderr.log")).unwrap()));
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x0800_0000); }
    let mut child = command.spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    while !cache.join("ready.json").is_file() && child.try_wait().unwrap().is_none() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(25));
    }
    let ready = fs::read(cache.join("ready.json")).unwrap_or_else(|error| {
        let _ = child.kill(); let _ = child.wait();
        panic!("owner did not publish a workspace: {error}; {}", fs::read_to_string(cache.join("stderr.log")).unwrap());
    });
    let ready: serde_json::Value = serde_json::from_slice(&ready).unwrap();
    let path = PathBuf::from(ready["workspace"].as_str().unwrap());
    let marker = fs::read(path.join(OWNER)).unwrap();
    recover(&cache).unwrap();
    assert_eq!(fs::read(path.join(OWNER)).unwrap(), marker);
    assert!(child.try_wait().unwrap().is_none());
    child.kill().unwrap(); child.wait().unwrap();
    recover(&cache).unwrap();
    assert!(!path.exists());
    assert!(Executable::read(&linked).is_err());
    fs::remove_file(linked).unwrap();
    fs::remove_file(copied).unwrap();
}

fn workspace() -> (PathBuf, OwnedWorkspace) {
    let cache = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/web-ownership")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&cache).unwrap();
    let cache = cache.canonicalize().unwrap();
    let executable = std::env::current_exe().unwrap();
    let owned = OwnedWorkspace::new(&cache, &uuid::Uuid::new_v4().to_string(), &executable,
        &executable, executable.parent().unwrap(), false).unwrap();
    (cache, owned)
}

#[test]
fn live_owner_workspace_is_preserved_and_normal_cleanup_checks_marker() {
    let (cache, mut owned) = workspace();
    let marker = fs::read(owned.path.join(OWNER)).unwrap();
    fs::write(owned.profile().join("sentinel"), b"local material").unwrap();
    recover(&cache).unwrap();
    assert_eq!(fs::read(owned.path.join(OWNER)).unwrap(), marker);
    assert_eq!(fs::read(owned.profile().join("sentinel")).unwrap(), b"local material");
    owned.cleanup().unwrap();
    assert!(!owned.path.exists());
}

#[test]
fn damaged_ownership_and_replaced_directory_are_retained() {
    let (cache, mut owned) = workspace();
    fs::write(owned.path.join(OWNER), b"{invalid").unwrap();
    assert_eq!(recover(&cache), Err(WebPageError::StorageFailed));
    assert_eq!(owned.cleanup(), Err(WebPageError::StorageFailed));
    assert!(recovery_required(&cache));
    assert!(owned.path.is_dir());
    fs::write(owned.path.join(OWNER), &owned.bytes).unwrap();
    let previous = owned.path.with_file_name(format!("{}-retained", owned.owner.operation_id));
    fs::rename(&owned.path, &previous).unwrap();
    fs::create_dir(&owned.path).unwrap();
    fs::write(owned.path.join("external-sentinel"), b"retain replacement").unwrap();
    assert_eq!(owned.cleanup(), Err(WebPageError::StorageFailed));
    assert_eq!(fs::read(owned.path.join("external-sentinel")).unwrap(), b"retain replacement");
    assert!(previous.join(OWNER).is_file());
}

#[test]
#[ignore = "requires actual bundled Python and permission to terminate owned child processes"]
fn interrupted_owner_recovery_terminates_only_recorded_real_python() {
    use std::process::{Command, Stdio};
    const FIXTURE: &str = "APP_OWNERSHIP_FIXTURE";
    const FOREIGN: &str = "APP_OWNERSHIP_FOREIGN";
    const BEFORE_RECORD: &str = "APP_OWNERSHIP_BEFORE_RECORD";
    const NAME: &str = "web_page::ownership::tests::interrupted_owner_recovery_terminates_only_recorded_real_python";
    let python = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/python")
        .join(if cfg!(windows) { "python.exe" } else { "bin/python3" }).canonicalize().unwrap();
    if std::env::var_os(FOREIGN).is_some() { std::thread::sleep(Duration::from_secs(60)); return; }
    if let Some(cache) = std::env::var_os(FIXTURE) {
        let cache = PathBuf::from(cache);
        fs::create_dir(cache.join("component")).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let owned = OwnedWorkspace::new(&cache, &id, &python, &python, &cache.join("component"), true).unwrap();
        let mut command = Command::new(&python);
        command.args(["-I", "-S", "-B", "-c", "import time; time.sleep(60)", "--web-operation-id", &id, "--frameq-engine-probe"])
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x0800_0000); }
        #[cfg(unix)] { use std::os::unix::process::CommandExt; command.process_group(0); }
        begin_worker(&owned.path).unwrap();
        let child = command.spawn().unwrap();
        if std::env::var_os(BEFORE_RECORD).is_none() { record_worker(&owned.path, child.id()).unwrap(); }
        fs::write(cache.join("ready.json"), serde_json::to_vec(&serde_json::json!({"pid":child.id(),"workspace":owned.path})).unwrap()).unwrap();
        std::thread::sleep(Duration::from_secs(60));
        return;
    }
    for before_record in [false, true] {
    let cache = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/web-ownership").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&cache).unwrap();
    let cache = cache.canonicalize().unwrap();
    let mut owner = Command::new(std::env::current_exe().unwrap());
    owner.args(["--exact", NAME, "--ignored", "--nocapture"]).env(FIXTURE, &cache)
        .stdin(Stdio::null()).stdout(Stdio::from(fs::File::create(cache.join("owner-stdout.log")).unwrap()))
        .stderr(Stdio::from(fs::File::create(cache.join("owner-stderr.log")).unwrap()));
    if before_record { owner.env(BEFORE_RECORD, "1"); }
    #[cfg(windows)] { use std::os::windows::process::CommandExt; owner.creation_flags(0x0800_0000); }
    let mut owner = owner.spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    while !cache.join("ready.json").is_file() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(25)); }
    let ready: serde_json::Value = serde_json::from_slice(&fs::read(cache.join("ready.json")).expect("actual owner wrote its receipt")).unwrap();
    let child_pid = Pid::from_u32(ready["pid"].as_u64().unwrap() as u32);
    let path = PathBuf::from(ready["workspace"].as_str().unwrap());
    let mut unrelated = Command::new(&python);
    unrelated.args(["-I", "-S", "-B", "-c", "import time; time.sleep(60)"])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; unrelated.creation_flags(0x0800_0000); }
    let mut unrelated = unrelated.spawn().unwrap();
    owner.kill().unwrap(); owner.wait().unwrap();
    assert!(processes().process(child_pid).is_some());
    #[cfg(target_os="macos")]
    if before_record {
        assert_eq!(recover(&cache), Err(WebPageError::StorageFailed));
        assert!(path.join(OWNER).is_file());
        let system = processes();
        let member = Member::read(system.process(child_pid).unwrap()).unwrap();
        terminate(&[member], &system).unwrap();
        unrelated.kill().unwrap(); unrelated.wait().unwrap();
        continue;
    }
    let original_members = fs::read(path.join(MEMBERS)).unwrap_or_else(|_| b"[]".to_vec());
    let mut foreign = Command::new(std::env::current_exe().unwrap());
    foreign.args(["--exact", NAME, "--ignored", "--nocapture"]).env(FOREIGN, "1")
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; foreign.creation_flags(0x0800_0000); }
    let mut foreign = foreign.spawn().unwrap();
    let system = processes();
    let child_member = Member::read(system.process(child_pid).unwrap()).unwrap();
    let unrelated_member = Member::read(system.process(Pid::from_u32(unrelated.id())).unwrap()).unwrap();
    assert!(child_member.birth.valid());
    assert_ne!(child_member.birth, unrelated_member.birth);
    let mut forged: Vec<Member> = serde_json::from_slice(&original_members).unwrap();
    forged.push(Member::read(system.process(Pid::from_u32(foreign.id())).unwrap()).unwrap());
    fs::write(path.join(MEMBERS), serde_json::to_vec(&forged).unwrap()).unwrap();
    assert_eq!(recover(&cache), Err(WebPageError::StorageFailed));
    assert!(foreign.try_wait().unwrap().is_none());
    assert!(processes().process(child_pid).is_some());
    forged.pop();
    forged.push(Member::read(system.process(Pid::from_u32(unrelated.id())).unwrap()).unwrap());
    fs::write(path.join(MEMBERS), serde_json::to_vec(&forged).unwrap()).unwrap();
    assert_eq!(recover(&cache), Err(WebPageError::StorageFailed));
    assert!(unrelated.try_wait().unwrap().is_none());
    fs::write(path.join(MEMBERS), original_members).unwrap();
    recover(&cache).unwrap();
    assert!(!path.exists());
    assert!(processes().process(child_pid).is_none());
    assert!(unrelated.try_wait().unwrap().is_none());
    foreign.kill().unwrap(); foreign.wait().unwrap();
    unrelated.kill().unwrap(); unrelated.wait().unwrap();
    }
}

#[test]
#[ignore = "requires actual bundled Python and permission to terminate owned child processes"]
fn exited_root_receipt_never_adopts_a_new_python_with_the_same_operation() {
    use std::process::{Command, Stdio};
    let cache = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/web-ownership").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&cache).unwrap();
    let cache = cache.canonicalize().unwrap();
    let mut creator = Command::new(std::env::current_exe().unwrap());
    creator.args(["--exact", "web_page::ownership::tests::interrupted_owner_recovery_terminates_only_recorded_real_python", "--ignored", "--nocapture"])
        .env("APP_OWNERSHIP_FIXTURE", &cache)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; creator.creation_flags(0x0800_0000); }
    let mut creator = creator.spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    while !cache.join("ready.json").is_file() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(25)); }
    let ready: serde_json::Value = serde_json::from_slice(&fs::read(cache.join("ready.json")).unwrap()).unwrap();
    let path = PathBuf::from(ready["workspace"].as_str().unwrap());
    let workspace = load(&path).unwrap();
    let records = all_records(&path, &workspace.owner).unwrap();
    let system = processes();
    validate_members(&path, &workspace.owner, &records, &system).unwrap();
    terminate(&records, &system).unwrap();
    creator.kill().unwrap(); creator.wait().unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while records.iter().any(|member| member.alive(&processes()).map_or(true, |value| value.is_some())) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(25));
    }
    assert!(records.iter().all(|member| member.alive(&processes()).is_ok_and(|value| value.is_none())));
    let mut replacement = Command::new(&workspace.owner.worker.path);
    replacement.args(["-I", "-S", "-B", "-c", "import time; time.sleep(60)", "--web-operation-id", &workspace.owner.operation_id, "--frameq-engine-probe"])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; replacement.creation_flags(0x0800_0000); }
    #[cfg(unix)] { use std::os::unix::process::CommandExt; replacement.process_group(0); }
    let mut replacement = replacement.spawn().unwrap();
    let recorded = fs::read(path.join("worker.json")).unwrap();
    assert_eq!(recover(&cache), Err(WebPageError::StorageFailed));
    assert!(replacement.try_wait().unwrap().is_none());
    assert_eq!(fs::read(path.join("worker.json")).unwrap(), recorded);
    assert_eq!(fs::read(path.join(OWNER)).unwrap(), workspace.bytes);
    replacement.kill().unwrap(); replacement.wait().unwrap();
    recover(&cache).unwrap();
    assert!(!path.exists());
}
