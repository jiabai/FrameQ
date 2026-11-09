use super::*;

struct MergeFixture {base:PathBuf,config:PathBuf,resources:PathBuf,target:PathBuf}
impl MergeFixture {
    fn new()->Self {
        let base=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-merge").join(uuid::Uuid::new_v4().to_string());
        let config=base.join("config");let resources=base.join("resources");let target=base.join("target");
        for path in [&config,&resources,&target]{fs::create_dir_all(path).unwrap();}
        let config=config.canonicalize().unwrap();let resources=resources.canonicalize().unwrap();let target=target.canonicalize().unwrap();
        fs::write(config.join(".env"),format!("APP_OUTPUT_DIR={}\n",config.join("outputs").display())).unwrap();
        Self{base:base.canonicalize().unwrap(),config,resources,target}
    }
    fn write(&self,path:&str,bytes:&[u8]){let path=self.config.join(path);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(path,bytes).unwrap();}
    fn manager(&self)->Arc<DataStorageManager>{Arc::new(DataStorageManager::open(self.config.clone(),self.resources.clone()).unwrap())}
    fn prepare(&self,manager:&DataStorageManager)->MigrationPreview{manager.prepare(self.target.clone(),vec![],"main",manager.state().generation).unwrap()}
}

#[test]
fn nonempty_target_keeps_its_file_and_moves_unique_source_files() {
    let f=MergeFixture::new();
    f.write("cache/same.txt",b"source content deliberately different");
    f.write("cache/new.txt",b"source unique");
    fs::create_dir_all(f.target.join("cache/empty")).unwrap();
    fs::write(f.target.join("cache/same.txt"),b"target wins").unwrap();
    fs::write(f.target.join("cache/target-only.txt"),b"target unique").unwrap();
    let manager=f.manager();let preview=f.prepare(&manager);
    manager.start(&preview.plan_token,"main",&mut |_|{}).unwrap();
    assert_eq!(fs::read(f.target.join("cache/same.txt")).unwrap(),b"target wins");
    assert_eq!(fs::read(f.target.join("cache/new.txt")).unwrap(),b"source unique");
    assert_eq!(fs::read(f.target.join("cache/target-only.txt")).unwrap(),b"target unique");
    assert!(!f.config.join("cache").exists());
    assert!(f.config.join(".env").exists());
    drop(manager);let manager=f.manager();manager.recheck().unwrap();
    assert_eq!(manager.state().data_access,"ready");
    assert_eq!(paths_for_config(&f.config).unwrap().data_root,f.target);
}

#[test]
fn merge_cancellation_before_confirmation_preserves_both_locations() {
    let f=MergeFixture::new();f.write("cache/same",b"source");fs::create_dir_all(f.target.join("cache")).unwrap();fs::write(f.target.join("cache/same"),b"target").unwrap();
    let manager=f.manager();let preview=f.prepare(&manager);assert!(preview.merge);
    manager.cancel(&preview.operation_id,0).unwrap();
    assert_eq!(manager.state().data_access,"ready");
    assert_eq!(fs::read(f.config.join("cache/same")).unwrap(),b"source");assert_eq!(fs::read(f.target.join("cache/same")).unwrap(),b"target");
}

#[test]
fn merge_preserves_target_collections_even_with_different_source_bytes() {
    let f=MergeFixture::new();f.write("collections.json",br#"{"source":"ignored"}"#);fs::write(f.target.join("collections.json"),br#"{"target":"kept"}"#).unwrap();
    fs::create_dir_all(f.config.join("outputs/empty")).unwrap();
    let manager=f.manager();let preview=f.prepare(&manager);manager.start(&preview.plan_token,"main",&mut |_|{}).unwrap();
    assert_eq!(fs::read(f.target.join("collections.json")).unwrap(),br#"{"target":"kept"}"#);assert!(!f.config.join("collections.json").exists());assert!(f.target.join("outputs/empty").is_dir());
}

#[test]
fn merge_type_conflict_fails_before_deleting_sources() {
    let f=MergeFixture::new();f.write("cache/item/leaf",b"keep source");fs::create_dir_all(f.target.join("cache")).unwrap();fs::write(f.target.join("cache/item"),b"file blocks directory").unwrap();
    let manager=f.manager();assert!(manager.prepare(f.target.clone(),vec![],"main",0).is_err());
    assert_eq!(fs::read(f.config.join("cache/item/leaf")).unwrap(),b"keep source");assert_eq!(fs::read(f.target.join("cache/item")).unwrap(),b"file blocks directory");
}

#[test]
fn merge_rechecks_replaced_target_before_deleting_sources() {
    let f=MergeFixture::new();f.write("cache/item",b"keep source");fs::create_dir_all(f.target.join("cache")).unwrap();fs::write(f.target.join("cache/item"),b"target").unwrap();
    let manager=f.manager();let preview=f.prepare(&manager);fs::rename(f.target.join("cache/item"),f.target.join("cache/old")).unwrap();fs::write(f.target.join("cache/item"),b"replacement").unwrap();
    assert_eq!(manager.start(&preview.plan_token,"main",&mut |_|{}).unwrap_err().code,"SourceChanged");assert_eq!(fs::read(f.config.join("cache/item")).unwrap(),b"keep source");
}

#[cfg(windows)]
#[test]
fn merge_permission_failure_after_moving_a_file_requires_resume() {
    use std::os::windows::fs::OpenOptionsExt;
    let f=MergeFixture::new();f.write("cache/a",b"move first");f.write("cache/b",b"locked second");fs::write(f.target.join("existing"),b"keep").unwrap();
    let manager=f.manager();let preview=f.prepare(&manager);
    let lock=std::fs::OpenOptions::new().read(true).share_mode(1).open(f.config.join("cache/b")).unwrap();
    let error=manager.start(&preview.plan_token,"main",&mut |_|{}).unwrap_err();assert!(matches!(error.code.as_str(),"PermissionDenied"|"StorageIoFailed"));
    assert!(f.target.join("cache/a").is_file());assert!(!f.config.join("cache/a").exists());assert_eq!(manager.state().operation.unwrap().phase,"merging");assert!(manager.acquire().is_err());assert_eq!(manager.cancel(&preview.operation_id,0).unwrap_err().code,"Busy");
    drop(lock);manager.resume(&preview.operation_id,0,"main",&mut |_|{}).unwrap();assert_eq!(fs::read(f.target.join("cache/b")).unwrap(),b"locked second");assert!(!f.config.join("cache").exists());
}

#[test]
fn merge_rejects_hardlink_targets_before_deleting_sources() {
    let f=MergeFixture::new();f.write("cache/item",b"source");fs::create_dir_all(f.target.join("cache")).unwrap();fs::write(f.target.join("cache/item"),b"target").unwrap();fs::hard_link(f.target.join("cache/item"),f.target.join("alias")).unwrap();
    let manager=f.manager();assert!(manager.prepare(f.target.clone(),vec![],"main",0).is_err());assert_eq!(fs::read(f.config.join("cache/item")).unwrap(),b"source");
}

#[test]
fn merge_resumes_after_real_child_process_is_terminated() {
    use std::io::BufRead;
    let f=MergeFixture::new();for index in 0..5{f.write(&format!("cache/{index}"),format!("contents {index}").as_bytes());}fs::write(f.target.join("existing"),b"target preserved").unwrap();
    let manager=f.manager();let preview=f.prepare(&manager);drop(manager);
    let mut child=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","data_storage::engine::merge::tests::merge_child_process_entry","--ignored","--nocapture"])
        .env("APP_MERGE_CHILD_ROOT",&f.base).env("APP_MERGE_CHILD_TOKEN",&preview.plan_token).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap();
    let stdout=child.stdout.take().unwrap();let(send,receive)=std::sync::mpsc::channel();std::thread::spawn(move||{for line in std::io::BufReader::new(stdout).lines(){if line.unwrap().starts_with("MERGE_FILE_MOVED"){send.send(()).unwrap();return;}}});
    let reached=receive.recv_timeout(std::time::Duration::from_secs(30));child.kill().unwrap();let output=child.wait_with_output().unwrap();assert!(reached.is_ok(),"{}",String::from_utf8_lossy(&output.stderr));
    let manager=f.manager();assert_eq!(manager.state().operation.as_ref().unwrap().phase,"merging");assert!(!f.config.join("cache/0").exists());assert!(manager.acquire().is_err());
    manager.resume(&preview.operation_id,0,"main",&mut |_|{}).unwrap();drop(manager);let manager=f.manager();manager.recheck().unwrap();assert_eq!(manager.state().data_access,"ready");
    for index in 0..5{assert_eq!(fs::read(f.target.join(format!("cache/{index}"))).unwrap(),format!("contents {index}").as_bytes());}assert!(!f.config.join("cache").exists());
}

#[test]
#[ignore="由合并终止恢复测试启动的真实子进程入口"]
fn merge_child_process_entry() {
    use std::io::Write;
    let root=PathBuf::from(std::env::var_os("APP_MERGE_CHILD_ROOT").unwrap());let token=std::env::var("APP_MERGE_CHILD_TOKEN").unwrap();
    let manager=DataStorageManager::open(root.join("config"),root.join("resources")).unwrap();
    let after_mutation=std::env::var_os("APP_MERGE_CHILD_AFTER_MUTATION").is_some();
    manager.start(&token,"main",&mut |state|{if state.operation.as_ref().is_some_and(|operation|operation.phase=="merging"&&if after_mutation{operation.completed_files==0&&operation.completed_bytes>0}else{operation.completed_files==1}){println!("MERGE_FILE_MOVED");std::io::stdout().flush().unwrap();loop{std::thread::park();}}}).unwrap();
}

#[test]
fn merge_recovers_real_termination_between_file_mutation_and_state_write() {
    use std::io::BufRead;
    for duplicate in [false,true]{
        let f=MergeFixture::new();f.write("cache/0",b"source original");f.write("cache/1",b"second original");fs::write(f.target.join("existing"),b"target only").unwrap();
        if duplicate{fs::create_dir(f.target.join("cache")).unwrap();fs::write(f.target.join("cache/0"),b"target priority").unwrap();}
        let manager=f.manager();let preview=f.prepare(&manager);drop(manager);
        let mut child=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","data_storage::engine::merge::tests::merge_child_process_entry","--ignored","--nocapture"])
            .env("APP_MERGE_CHILD_ROOT",&f.base).env("APP_MERGE_CHILD_TOKEN",&preview.plan_token).env("APP_MERGE_CHILD_AFTER_MUTATION","1").stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap();
        let stdout=child.stdout.take().unwrap();let(send,receive)=std::sync::mpsc::channel();std::thread::spawn(move||{for line in std::io::BufReader::new(stdout).lines(){if line.unwrap().starts_with("MERGE_FILE_MOVED"){send.send(()).unwrap();return;}}});
        let reached=receive.recv_timeout(std::time::Duration::from_secs(30));child.kill().unwrap();let output=child.wait_with_output().unwrap();assert!(reached.is_ok(),"{}",String::from_utf8_lossy(&output.stderr));
        assert!(!f.config.join("cache/0").exists());let manager=f.manager();manager.resume(&preview.operation_id,0,"main",&mut |_|{}).unwrap();drop(manager);let manager=f.manager();manager.recheck().unwrap();
        assert_eq!(fs::read(f.target.join("cache/0")).unwrap(),if duplicate{b"target priority".as_slice()}else{b"source original".as_slice()});assert_eq!(manager.state().data_access,"ready");
    }
}

#[test]
#[ignore="设置 APP_STORAGE_CROSS_VOLUME_ROOT 后执行真实跨卷迁移"]
fn merge_moves_real_files_across_distinct_volumes() {
    use std::io::BufRead;
    let f=MergeFixture::new();f.write("cache/same",b"source duplicate");f.write("cache/large",&vec![83;5*1024*1024+7]);
    let root=PathBuf::from(std::env::var_os("APP_STORAGE_CROSS_VOLUME_ROOT").unwrap()).join(uuid::Uuid::new_v4().to_string());fs::create_dir_all(root.join("cache")).unwrap();let target=root.canonicalize().unwrap();fs::write(target.join("cache/same"),b"target duplicate").unwrap();
    assert_ne!(safe_filesystem::identity(&f.config).unwrap().volume,safe_filesystem::identity(&target).unwrap().volume);
    let expected=safe_filesystem::hash_file(&f.config.join("cache/large")).unwrap();let manager=f.manager();let preview=manager.prepare(target.clone(),vec![],"main",0).unwrap();assert!(preview.merge);drop(manager);
    let mut child=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","data_storage::engine::merge::tests::merge_child_process_entry","--ignored","--nocapture"])
        .env("APP_MERGE_CHILD_ROOT",&f.base).env("APP_MERGE_CHILD_TOKEN",&preview.plan_token).env("APP_MERGE_CHILD_AFTER_MUTATION","1").stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap();
    let stdout=child.stdout.take().unwrap();let(send,receive)=std::sync::mpsc::channel();std::thread::spawn(move||{for line in std::io::BufReader::new(stdout).lines(){if line.unwrap().starts_with("MERGE_FILE_MOVED"){send.send(()).unwrap();return;}}});
    let reached=receive.recv_timeout(std::time::Duration::from_secs(30));child.kill().unwrap();let output=child.wait_with_output().unwrap();assert!(reached.is_ok(),"{}",String::from_utf8_lossy(&output.stderr));
    assert!(f.config.join("cache/large").is_file());assert!(!target.join("cache/large").exists());
    let manager=f.manager();let pending=manager.snapshot().unwrap().pending.unwrap();let partial=operation_root(&pending).join("merge-partial/0.part");assert!(fs::metadata(partial).unwrap().len()>0);
    manager.resume(&preview.operation_id,0,"main",&mut |_|{}).unwrap();
    assert_eq!(safe_filesystem::hash_file(&target.join("cache/large")).unwrap().1,expected.1);assert_eq!(fs::read(target.join("cache/same")).unwrap(),b"target duplicate");assert!(!f.config.join("cache").exists());drop(manager);let manager=f.manager();manager.recheck().unwrap();assert_eq!(manager.state().data_access,"ready");
    println!("CROSS_VOLUME_MERGE_VERIFIED {}",target.display());
}
