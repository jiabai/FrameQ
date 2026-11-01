use super::*;
use std::io::Write;

struct Fixture {base:PathBuf,config:PathBuf,resources:PathBuf,target:PathBuf}
impl Fixture {
    fn new()->Self {
        let base=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-acceptance").join(uuid::Uuid::new_v4().to_string());
        let config=base.join("config");let resources=base.join("resources");let target=base.join("target");
        for path in [&config,&resources,&target]{fs::create_dir_all(path).unwrap();}
        let config=config.canonicalize().unwrap();let resources=resources.canonicalize().unwrap();let target=target.canonicalize().unwrap();
        fs::write(config.join(".env"),format!("FRAMEQ_OUTPUT_DIR={}\n",config.join("outputs").display())).unwrap();
        Self{base:base.canonicalize().unwrap(),config,resources,target}
    }
    fn write(&self,path:&str,bytes:&[u8]) {let path=self.config.join(path);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(path,bytes).unwrap();}
    fn manager(&self)->Arc<DataStorageManager>{Arc::new(DataStorageManager::open(self.config.clone(),self.resources.clone()).unwrap())}
    fn prepare(&self,manager:&DataStorageManager)->MigrationPreview {manager.prepare(self.target.clone(),vec![],"main",manager.state().generation).unwrap()}
    fn migrate(&self,manager:&DataStorageManager){let p=self.prepare(manager);manager.start(&p.plan_token,"main",&mut |_|{}).unwrap();}
}

#[test]
fn complete_tree_copy_keeps_metadata_configs_and_requires_new_process_view() {
    let f=Fixture::new();
    for path in ["outputs/tasks/a/frameq-task.json","outputs/tasks/a/frameq-note-metadata.json","outputs/tasks/a/transcript/original/transcript.txt","models/MODEL_VERSION.txt","runtime/pytorch/v/runtime-manifest.json","cache/tasks/a/scratch.bin","cache/.frameq-audio-review/a/audio.wav","collections.json","work/legacy.txt"] {f.write(path,path.as_bytes());}
    f.write("auth/session.json",b"private credential");f.write("logs/desktop.log",b"fixed log");
    let m=f.manager();f.migrate(&m);
    assert_eq!(m.state().data_access,"restart_required");assert!(m.acquire().is_err());assert!(m.can_restart());
    assert_eq!(m.recheck().unwrap().data_access,"restart_required");
    assert!(!f.target.join("auth").exists());assert!(!f.target.join("logs").exists());assert!(!f.target.join(".env").exists());
    assert_eq!(fs::read(f.target.join("cache/legacy-work/legacy.txt")).unwrap(),b"work/legacy.txt");
    assert_eq!(fs::read(f.config.join("auth/session.json")).unwrap(),b"private credential");
    drop(m);let m=f.manager();assert_eq!(m.state().operation.as_ref().unwrap().phase,"validating");
    m.recheck().unwrap();assert_eq!(m.state().data_access,"ready");
    let paths=paths_for_config(&f.config).unwrap();assert_eq!(paths.data_root,f.target);
    assert!(paths.models_root.join("MODEL_VERSION.txt").is_file());
    fs::write(f.target.join("outputs/tasks/a/frameq-note-metadata.json"),b"later legitimate edit").unwrap();
    drop(m);let m=f.manager();assert_eq!(m.state().data_access,"ready");
}

#[test]
fn duplicate_task_ids_require_identical_entire_trees() {
    let f=Fixture::new();let other=f.base.join("other");fs::create_dir_all(other.join("tasks/a")).unwrap();
    f.write("outputs/tasks/a/transcript.txt",b"original");fs::write(other.join("tasks/a/transcript.txt"),b"original").unwrap();fs::write(other.join("tasks/a/extra.txt"),b"different tree").unwrap();
    let m=f.manager();let e=m.prepare(f.target.clone(),vec![other],"main",0).unwrap_err();assert_eq!(e.code,"TargetConflict");
    assert_eq!(fs::read(f.config.join("outputs/tasks/a/transcript.txt")).unwrap(),b"original");
}

#[test]
fn identical_sources_are_copied_once_and_both_originals_retained() {
    let f=Fixture::new();let other=f.base.join("other");fs::create_dir_all(other.join("tasks/a")).unwrap();
    f.write("outputs/tasks/a/transcript.txt",b"same");fs::write(other.join("tasks/a/transcript.txt"),b"same").unwrap();
    let m=f.manager();let p=m.prepare(f.target.clone(),vec![other.clone()],"main",0).unwrap();assert_eq!(p.total_files,1);
    m.start(&p.plan_token,"main",&mut |_|{}).unwrap();assert_eq!(fs::read(f.target.join("outputs/tasks/a/transcript.txt")).unwrap(),b"same");assert!(other.join("tasks/a/transcript.txt").is_file());
}

#[test]
fn nonempty_nested_and_replaced_targets_fail_without_source_mutation() {
    let f=Fixture::new();f.write("outputs/tasks/a/value",b"saved");let m=f.manager();
    fs::write(f.target.join("unrelated"),b"keep").unwrap();assert_eq!(m.prepare(f.target.clone(),vec![],"main",0).unwrap_err().code,"TargetConflict");fs::remove_file(f.target.join("unrelated")).unwrap();
    let nested=f.config.join("inside");fs::create_dir(&nested).unwrap();assert_eq!(m.prepare(nested,vec![],"main",0).unwrap_err().code,"UnsafePath");
    let p=f.prepare(&m);fs::rename(&f.target,f.base.join("moved-target")).unwrap();fs::create_dir(&f.target).unwrap();
    assert!(m.start(&p.plan_token,"main",&mut |_|{}).is_err());assert!(f.config.join("outputs/tasks/a/value").exists());
}

#[test]
fn leases_are_owned_send_and_preparation_waits_for_active_call() {
    fn send<T:Send>(){}send::<DataOperationPermit>();
    let f=Fixture::new();let m=f.manager();let permit=m.acquire().unwrap();let target=f.target.clone();let manager=Arc::clone(&m);
    let child=std::thread::spawn(move||manager.prepare(target,vec![],"main",0));
    let until=std::time::Instant::now()+std::time::Duration::from_secs(5);
    while !m.inner.lock().unwrap().quiescing {assert!(std::time::Instant::now()<until);std::thread::yield_now();}
    assert_eq!(m.state().operation.unwrap().phase,"waiting");assert_eq!(m.acquire().err().unwrap().code,"Busy");drop(permit);assert!(child.join().unwrap().is_ok());
}

#[test]
fn waiting_can_be_cancelled_while_the_existing_writer_finishes() {
    let f=Fixture::new();let m=f.manager();let permit=m.acquire().unwrap();let target=f.target.clone();let manager=Arc::clone(&m);let child=std::thread::spawn(move||manager.prepare(target,vec![],"main",0));
    let until=std::time::Instant::now()+std::time::Duration::from_secs(5);let operation=loop{if let Some(p)=m.state().operation{break p;}assert!(std::time::Instant::now()<until);std::thread::yield_now();};
    assert_eq!(operation.phase,"waiting");m.cancel(&operation.operation_id,0).unwrap();assert_eq!(child.join().unwrap().unwrap_err().code,"Cancelled");
    f.write("cache/existing-writer",b"finished");drop(permit);assert_eq!(m.state().data_access,"ready");assert!(m.acquire().is_ok());assert!(!f.target.join(".frameq-storage").exists());
}

#[test]
fn relinking_same_physical_root_updates_pending_validation_without_rewriting_sources() {
    let f=Fixture::new();f.write("cache/file",b"saved");let m=f.manager();f.migrate(&m);drop(m);let moved=f.base.join("reconnected");fs::rename(&f.target,&moved).unwrap();
    let m=f.manager();assert_eq!(m.state().data_access,"unavailable");m.relink(moved.clone(),1).unwrap();m.recheck().unwrap();assert_eq!(m.state().data_access,"ready");
    assert_eq!(paths_for_config(&f.config).unwrap().data_root,moved.canonicalize().unwrap());assert_eq!(fs::read(moved.join("cache/file")).unwrap(),b"saved");assert!(f.config.join("cache/file").is_file());
}

#[test]
fn uncommitted_managed_relink_replans_or_resolves_publishing_after_real_termination() {
    use std::io::BufRead;
    for phase in ["prepared","copying","verifying","publishing"] {
        let f=Fixture::new();f.write("cache/file",b"preserved");let m=f.manager();f.migrate(&m);drop(m);let m=f.manager();m.recheck().unwrap();
        if phase!="prepared"{fs::write(f.target.join("cache/large"),vec![51;9*1024*1024]).unwrap();}
        let target=f.base.join("second-target");fs::create_dir(&target).unwrap();let p=m.prepare(target.clone(),vec![],"main",1).unwrap();let inventory_path=inventory::inventory_path(&target,&p.operation_id);let original_inventory=fs::read(&inventory_path).unwrap();drop(m);
        if phase!="prepared" {
            let mut child=child_command(&f,"start",phase).spawn().unwrap();let stdout=child.stdout.take().unwrap();let(send,receive)=std::sync::mpsc::channel();
            std::thread::spawn(move||{for line in std::io::BufReader::new(stdout).lines(){let line=line.unwrap();if line.starts_with("STORAGE_DURABLE_PHASE:"){send.send(line).unwrap();return;}}});
            let reached=receive.recv_timeout(std::time::Duration::from_secs(30));child.kill().unwrap();let output=child.wait_with_output().unwrap();assert!(reached.is_ok(),"{phase}: {}",String::from_utf8_lossy(&output.stderr));
        }
        let reconnected=f.base.join("reconnected-active");fs::rename(&f.target,&reconnected).unwrap();let m=f.manager();assert_eq!(m.state().data_access,"unavailable");m.relink(reconnected.clone(),1).unwrap();
        if phase=="publishing" {
            assert_eq!(m.state().operation.as_ref().unwrap().phase,"publishing");assert_eq!(fs::read(&inventory_path).unwrap(),original_inventory);m.resume(&p.operation_id,1,"recovery",&mut |_|{}).unwrap();
        }else {
            let waiting=m.state().operation.unwrap();assert_eq!(waiting.phase,"waiting");assert_ne!(waiting.operation_id,p.operation_id);let next=m.resume_preparation(&waiting.operation_id,1,"recovery",None,&mut ||Ok(()),&mut |_,_|Ok(serde_json::Value::Null)).unwrap();m.start(&next.plan_token,"recovery",&mut |_|{}).unwrap();assert_eq!(fs::read(&inventory_path).unwrap(),original_inventory);
        }
        drop(m);let m=f.manager();m.recheck().unwrap();assert_eq!(m.state().data_access,"ready");assert_eq!(fs::read(target.join("cache/file")).unwrap(),b"preserved");assert!(reconnected.join("cache/file").is_file());
    }
}

#[cfg(windows)]
#[test]
fn cleanup_target_guard_blocks_real_concurrent_writes_and_deletion() {
    let f=Fixture::new();f.write("cache/file",b"saved");let m=f.manager();f.migrate(&m);drop(m);let m=f.manager();m.recheck().unwrap();let value=m.snapshot().unwrap();
    let receipt=&value.cleanup_receipts[0];let inventory:inventory::Inventory=control::read_json(&value.active.data_root.join(&receipt.relative_path),inventory::MAX_INVENTORY).unwrap();
    let entry=inventory.entries.iter().find(|e|!e.directory).unwrap();let target=value.active.data_root.join(&entry.destination);let guard=super::cleanup::cleanup_target_guard(&target,entry).unwrap().unwrap();
    let path=target.clone();let attempt=std::thread::spawn(move||{assert!(fs::write(&path,b"changed").is_err());assert!(fs::remove_file(&path).is_err());});attempt.join().unwrap();
    assert_eq!(fs::read(&target).unwrap(),b"saved");drop(guard);fs::write(target,b"allowed after releasing verified guard").unwrap();
}

#[test]
fn real_copy_cancellation_keeps_active_source_and_can_recheck_partial_files() {
    let f=Fixture::new();f.write("cache/large",&vec![23;16*1024*1024]);let m=f.manager();let p=f.prepare(&m);
    let mut cancelled=false;let result=m.start(&p.plan_token,"main",&mut |state|{
        if !cancelled&&state.operation.as_ref().is_some_and(|p|p.phase=="copying"&&p.completed_bytes>0){cancelled=true;m.cancel(&p.operation_id,0).unwrap();}
    });
    assert_eq!(result.unwrap_err().code,"Cancelled");assert_eq!(m.state().data_access,"ready");assert!(m.acquire().is_ok());
    assert_eq!(fs::metadata(f.config.join("cache/large")).unwrap().len(),16*1024*1024);
}

#[test]
fn edited_source_after_cancellation_gets_a_new_preview_and_keeps_old_copy() {
    let f=Fixture::new();f.write("cache/large",&vec![23;16*1024*1024]);let m=f.manager();let p=f.prepare(&m);let mut stopped=false;
    let result=m.start(&p.plan_token,"main",&mut |state|{if !stopped&&state.operation.as_ref().is_some_and(|p|p.phase=="copying"&&p.completed_bytes>0){stopped=true;m.cancel(&p.operation_id,0).unwrap();}});assert_eq!(result.unwrap_err().code,"Cancelled");
    fs::write(f.config.join("cache/large"),b"edited while using the original library").unwrap();assert!(m.requires_preparation(&p.operation_id));
    let next=m.resume_preparation(&p.operation_id,0,"main",None,&mut ||Ok(()),&mut |_,_|Ok(serde_json::Value::Null)).unwrap();assert_ne!(next.operation_id,p.operation_id);assert_ne!(next.plan_token,p.plan_token);assert_eq!(m.state().operation.unwrap().phase,"prepared");
    assert!(inventory::inventory_path(&f.target,&p.operation_id).is_file());m.start(&next.plan_token,"main",&mut |_|{}).unwrap();assert_eq!(fs::read(f.target.join("cache/large")).unwrap(),b"edited while using the original library");
}

#[test]
fn verification_reports_real_chunks_and_can_cancel_before_a_large_file_finishes() {
    let f=Fixture::new();f.write("cache/large",&vec![37;16*1024*1024]);let m=f.manager();let p=f.prepare(&m);let mut stopped=false;
    let result=m.start(&p.plan_token,"main",&mut |state|{if !stopped&&state.operation.as_ref().is_some_and(|p|p.phase=="verifying"&&p.completed_bytes>0&&p.completed_files==0){stopped=true;m.cancel(&p.operation_id,0).unwrap();}});
    assert!(stopped);assert_eq!(result.unwrap_err().code,"Cancelled");assert_eq!(m.state().data_access,"ready");assert_eq!(paths_for_config(&f.config).unwrap().data_root,f.config);
}

#[cfg(windows)]
#[test]
fn copy_pins_destination_and_partial_ancestors_against_real_directory_replacement() {
    let f=Fixture::new();f.write("cache/deep/large",&vec![79;16*1024*1024]);let m=f.manager();let p=f.prepare(&m);let payload=inventory::payload_path(&f.target,&p.operation_id);let mut attempted=false;
    m.start(&p.plan_token,"main",&mut |state|{if !attempted&&state.operation.as_ref().is_some_and(|p|p.phase=="copying"&&p.completed_bytes>0){attempted=true;let root=payload.clone();let moved=f.base.join("replaced-payload");std::thread::spawn(move||{assert!(fs::rename(root.join("cache/deep"),moved.with_file_name("replaced-deep")).is_err());assert!(fs::rename(&root,&moved).is_err());}).join().unwrap();}}).unwrap();
    assert!(attempted);assert_eq!(fs::metadata(f.target.join("cache/deep/large")).unwrap().len(),16*1024*1024);assert!(!f.base.join("replaced-payload").exists());
}

#[test]
fn final_close_blocks_new_access_and_keeps_process_lock_until_drop() {
    let f=Fixture::new();let m=f.manager();let permit=m.acquire().unwrap();assert_eq!(m.prepare_close().unwrap_err().code,"Busy");drop(permit);m.prepare_close().unwrap();assert_eq!(m.acquire().err().unwrap().code,"Busy");assert_eq!(DataStorageManager::open(f.config.clone(),f.resources.clone()).err().unwrap().code,"Busy");drop(m);assert!(f.manager().acquire().is_ok());
    let f=Fixture::new();fs::write(f.config.join("data-storage.json"),b"damaged").unwrap();let m=f.manager();assert!(m.prepare_close().is_ok());
}

#[test]
fn immutable_control_snapshot_does_not_block_atomic_control_replacement() {
    let f=Fixture::new();let m=f.manager();let _snapshot=safe_filesystem::open_control_snapshot(&f.config.join("data-storage.json")).unwrap();assert!(m.prepare(f.target.clone(),vec![],"main",0).is_ok());
}

#[cfg(windows)]
#[test]
fn actual_canonical_windows_path_displays_without_internal_device_prefix() {
    let f=Fixture::new();let canonical=f.target.canonicalize().unwrap();let fixture_name=f.base.file_name().unwrap().to_string_lossy();assert_eq!(location::display(&canonical),format!("D:/Github/FrameQ/build/data-storage-acceptance/{fixture_name}/target"));assert_eq!(location::display(Path::new(r"\\?\UNC\server\share\notes")),"//server/share/notes");
}

#[test]
fn pinned_file_install_uses_the_held_file_and_refuses_existing_targets() {
    let f=Fixture::new();let directory=safe_filesystem::pin_directory(&f.target).unwrap();let mut file=directory.create_new(std::ffi::OsStr::new("source")).unwrap();file.write_all(b"verified").unwrap();file.sync_all().unwrap();
    safe_filesystem::install_owned_file(&file,&directory,std::ffi::OsStr::new("source"),&directory,std::ffi::OsStr::new("installed")).expect("native pinned installation");assert_eq!(fs::read(f.target.join("installed")).unwrap(),b"verified");
    let second=directory.create_new(std::ffi::OsStr::new("second")).unwrap();assert!(safe_filesystem::install_owned_file(&second,&directory,std::ffi::OsStr::new("second"),&directory,std::ffi::OsStr::new("installed")).is_err());
}

#[test]
fn cleanup_keeps_changed_and_unrelated_files_and_uses_current_library() {
    let f=Fixture::new();f.write("outputs/tasks/a/file",b"original");f.write("cache/equal",b"equal");let m=f.manager();f.migrate(&m);drop(m);
    let m=f.manager();m.recheck().unwrap();fs::write(f.target.join("outputs/tasks/a/file"),b"new edit").unwrap();
    f.write("unrelated.txt",b"not migrated");let id=m.state().cleanup_receipts[0].receipt_id.clone();let p=m.prepare_cleanup(&id,"main").unwrap();assert_eq!(p.retained_files,1);
    m.confirm_cleanup(&p.plan_token,"main",&mut |_|{}).unwrap();
    assert!(f.config.join("outputs/tasks/a/file").is_file());assert!(!f.config.join("cache/equal").exists());assert_eq!(fs::read(f.config.join("unrelated.txt")).unwrap(),b"not migrated");
}

#[test]
fn two_migrations_preserve_receipts_and_cleanup_validates_latest_root() {
    let f=Fixture::new();f.write("outputs/tasks/a/file",b"saved");let m=f.manager();f.migrate(&m);drop(m);
    let m=f.manager();m.recheck().unwrap();let first=m.state().cleanup_receipts[0].receipt_id.clone();let next=f.base.join("next");fs::create_dir(&next).unwrap();
    let p=m.prepare(next.clone(),vec![],"main",1).unwrap();m.start(&p.plan_token,"main",&mut |_|{}).unwrap();drop(m);
    let m=f.manager();m.recheck().unwrap();fs::write(f.target.join("outputs/tasks/a/file"),b"stale B was changed").unwrap();
    let p=m.prepare_cleanup(&first,"main").unwrap();assert_eq!(p.total_files,1);m.confirm_cleanup(&p.plan_token,"main",&mut |_|{}).unwrap();
    assert!(!f.config.join("outputs/tasks/a/file").exists());assert_eq!(fs::read(next.join("outputs/tasks/a/file")).unwrap(),b"saved");
}

#[test]
fn corrupted_control_and_offline_root_do_not_create_default_library() {
    let f=Fixture::new();fs::write(f.config.join("data-storage.json"),b"broken").unwrap();let m=f.manager();assert_eq!(m.state().data_access,"unavailable");assert!(!f.config.join("outputs").exists());drop(m);
    fs::remove_file(f.config.join("data-storage.json")).unwrap();f.write("cache/file",b"value");let m=f.manager();f.migrate(&m);drop(m);
    fs::rename(&f.target,f.base.join("offline")).unwrap();let m=f.manager();assert_eq!(m.state().data_access,"unavailable");assert!(m.acquire().is_err());assert!(!f.target.exists());
}

#[test]
fn externally_restored_control_is_reloaded_only_after_invalid_bootstrap() {
    let f=Fixture::new();f.write("cache/saved",b"original");let m=f.manager();f.migrate(&m);drop(m);let path=f.config.join("data-storage.json");let saved=fs::read(&path).unwrap();fs::write(&path,b"invalid json").unwrap();
    let m=f.manager();assert_eq!(m.state().last_error.as_deref(),Some("ControlInvalid"));fs::remove_file(&path).unwrap();assert_eq!(m.reload_invalid_control().unwrap_err().code,"ControlInvalid");assert!(!path.exists());
    fs::write(&path,saved).unwrap();assert_eq!(m.reload_invalid_control().unwrap().operation.unwrap().phase,"validating");m.recheck().unwrap();assert_eq!(m.state().data_access,"ready");assert_eq!(fs::read(f.target.join("cache/saved")).unwrap(),b"original");
    fs::write(&path,b"new external corruption").unwrap();assert_eq!(m.reload_invalid_control().unwrap().data_access,"ready");
}

#[test]
fn stored_inventory_reference_contract_resumes_actual_interrupted_copy_and_rejects_wrong_refs() {
    use std::io::BufRead;
    let f=Fixture::new();f.write("cache/large",&vec![61;9*1024*1024]);let m=f.manager();let p=f.prepare(&m);drop(m);
    let mut child=child_command(&f,"start","copying").spawn().unwrap();let stdout=child.stdout.take().unwrap();let(send,receive)=std::sync::mpsc::channel();std::thread::spawn(move||{for line in std::io::BufReader::new(stdout).lines(){let line=line.unwrap();if line.starts_with("STORAGE_DURABLE_PHASE:"){send.send(line).unwrap();return;}}});
    let reached=receive.recv_timeout(std::time::Duration::from_secs(30));child.kill().unwrap();let output=child.wait_with_output().unwrap();assert!(reached.is_ok(),"{}",String::from_utf8_lossy(&output.stderr));
    let path=f.config.join("data-storage.json");let mut stored:serde_json::Value=serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();let pending=stored.get_mut("pending").unwrap().as_object_mut().unwrap();assert_eq!(pending["phase"],"copying");let hash=pending["inventoryHash"].clone();pending.remove("sourceRelocations");
    pending.insert("inventoryVersions".into(),serde_json::json!([{"relativePath":format!(".frameq-storage/operations/{}/inventory.json",p.operation_id),"sha256":hash}]));
    let mut invalid=stored.clone();invalid["pending"]["inventoryVersions"][0]["relativePath"]=serde_json::json!(".frameq-storage/foreign/inventory.json");control::write_json(&path,&invalid,control::MAX_CONTROL).unwrap();let invalid_manager=f.manager();assert_eq!(invalid_manager.state().last_error.as_deref(),Some("ControlInvalid"));drop(invalid_manager);
    control::write_json(&path,&stored,control::MAX_CONTROL).unwrap();let m=f.manager();assert_eq!(m.state().operation.as_ref().unwrap().phase,"copying");m.resume(&p.operation_id,0,"recovery",&mut |_|{}).unwrap();drop(m);let m=f.manager();m.recheck().unwrap();assert_eq!(m.state().data_access,"ready");assert_eq!(fs::metadata(f.target.join("cache/large")).unwrap().len(),9*1024*1024);assert!(f.config.join("cache/large").is_file());
}

#[test]
fn relative_legacy_requires_explicit_source_and_unrecognized_custom_files_block() {
    let f=Fixture::new();fs::write(f.config.join(".env"),b"FRAMEQ_OUTPUT_DIR=relative-results\n").unwrap();let m=f.manager();
    assert_eq!(m.prepare(f.target.clone(),vec![],"main",0).unwrap_err().code,"LegacySourceAmbiguous");
    let f=Fixture::new();let custom=f.base.join("custom");fs::create_dir(&custom).unwrap();fs::write(custom.join("unowned"),b"keep").unwrap();let m=f.manager();
    assert_eq!(m.prepare(f.target.clone(),vec![custom],"main",0).unwrap_err().code,"LegacySourceAmbiguous");
}

#[test]
fn hardlinks_are_rejected_without_following_or_deleting_them() {
    let f=Fixture::new();f.write("cache/original",b"shared inode");fs::hard_link(f.config.join("cache/original"),f.config.join("cache/alias")).unwrap();let m=f.manager();
    assert!(m.prepare(f.target.clone(),vec![],"main",0).is_err());assert!(f.config.join("cache/alias").exists());
}

#[test]
fn pending_preview_rebinds_window_and_stale_tokens_never_start_copy() {
    let f=Fixture::new();f.write("cache/file",b"value");let m=f.manager();let p=f.prepare(&m);let latest=m.pending_preview("second").unwrap();
    assert!(m.start(&p.plan_token,"main",&mut |_|{}).is_err());m.start(&latest.plan_token,"second",&mut |_|{}).unwrap();
}

#[test]
fn source_changes_after_preflight_do_not_commit_or_overwrite() {
    let f=Fixture::new();f.write("cache/file",b"before");let m=f.manager();let p=f.prepare(&m);fs::write(f.config.join("cache/file"),b"after").unwrap();
    assert_eq!(m.start(&p.plan_token,"main",&mut |_|{}).unwrap_err().code,"SourceChanged");assert_eq!(paths_for_config(&f.config).unwrap().data_root,f.config);
}

#[test]
fn empty_library_can_migrate_and_restart_without_models() {
    let f=Fixture::new();let m=f.manager();f.migrate(&m);drop(m);let m=f.manager();m.recheck().unwrap();
    assert_eq!(m.state().data_access,"ready");assert!(f.target.join("models").is_dir());
}

#[test]
fn process_lock_is_real_and_released_when_manager_drops() {
    let f=Fixture::new();let m=f.manager();assert_eq!(DataStorageManager::open(f.config.clone(),f.resources.clone()).err().unwrap().code,"Busy");drop(m);assert!(DataStorageManager::open(f.config,f.resources).is_ok());
}

#[test]
fn interrupted_copy_is_reopened_from_durable_operation() {
    let f=Fixture::new();f.write("cache/large",&vec![8;16*1024*1024]);let m=f.manager();let p=f.prepare(&m);let output=f.base.join("phase.txt");
    let mut file=fs::File::create(output).unwrap();file.write_all(p.operation_id.as_bytes()).unwrap();file.sync_all().unwrap();
    // 先持久准备后释放实例，以相同生产控制记录建立新的进程视图。
    drop(m);let m=f.manager();assert_eq!(m.state().data_access,"recovery_required");let p=m.pending_preview("reopened").unwrap();
    m.start(&p.plan_token,"reopened",&mut |_|{}).unwrap();assert_eq!(m.state().data_access,"restart_required");
}

#[test]
#[ignore="由阶段终止测试在独立真实进程中执行"]
fn storage_child_process() {
    let config=PathBuf::from(std::env::var_os("FRAMEQ_TEST_STORAGE_CONFIG").expect("isolated test config"));
    let base=config.parent().unwrap();let resources=base.join("resources");let target=base.join("target");
    let action=std::env::var("FRAMEQ_TEST_STORAGE_ACTION").unwrap();
    if action=="lock" {
        let result=DataStorageManager::open(config,resources);assert_eq!(result.err().unwrap().code,"Busy");println!("STORAGE_BUSY_CONFIRMED");return;
    }
    let m=DataStorageManager::open(config,resources).unwrap();
    let stop=std::env::var("FRAMEQ_TEST_STORAGE_PHASE").unwrap();
    let notify=|phase:&str|{println!("STORAGE_DURABLE_PHASE:{phase}");std::io::stdout().flush().unwrap();loop{std::thread::park();}};
    if action=="prepare" {m.prepare(target,vec![],"worker",m.state().generation).unwrap();notify("prepared");}
    else if action=="start" {
        let p=m.pending_preview("worker").unwrap();
        m.start(&p.plan_token,"worker",&mut |state|{
            let p=state.operation.unwrap();
            if p.phase==stop&&(stop!="copying"||p.completed_bytes>0){notify(&p.phase);}
        }).unwrap();
    } else if action=="validate" {
        m.recheck_with_validator(&mut |_,_|{notify("validating");Ok(())}).unwrap();
    } else if action=="cleanup" {
        let id=m.state().cleanup_receipts[0].receipt_id.clone();let p=m.prepare_cleanup(&id,"worker").unwrap();
        m.confirm_cleanup(&p.plan_token,"worker",&mut |state|{if state.operation.as_ref().is_some_and(|p|p.completed_files>0){notify("cleaning");}}).unwrap();
    } else {panic!("Unknown child operation");}
    panic!("Requested durable phase was not reached");
}

fn child_command(f:&Fixture,action:&str,phase:&str)->std::process::Command {
    let mut command=std::process::Command::new(std::env::current_exe().unwrap());
    let module=module_path!().split_once("::").unwrap().1;
    command.args(["--ignored","--exact",&format!("{module}::storage_child_process"),"--nocapture"])
        .env("FRAMEQ_TEST_STORAGE_CONFIG",&f.config).env("FRAMEQ_TEST_STORAGE_ACTION",action).env("FRAMEQ_TEST_STORAGE_PHASE",phase)
        .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());command
}

#[test]
fn independent_process_lock_and_each_durable_stage_survive_real_termination() {
    use std::io::BufRead;
    let f=Fixture::new();let m=f.manager();let locked=child_command(&f,"lock","").output().unwrap();assert!(locked.status.success());assert!(String::from_utf8_lossy(&locked.stdout).contains("STORAGE_BUSY_CONFIRMED"));drop(m);
    for phase in ["prepared","copying","verifying","publishing","restart_required","validating","cleaning"] {
        let f=Fixture::new();f.write("cache/a-large",&vec![91;9*1024*1024]);f.write("outputs/tasks/a/transcript.txt",b"preserved original");f.write("collections.json",b"[]");
        let action=if phase=="prepared"{"prepare"}else if phase=="validating"{"validate"}else if phase=="cleaning"{"cleanup"}else{"start"};
        if phase!="prepared" {
            let m=f.manager();let p=f.prepare(&m);
            if matches!(phase,"validating"|"cleaning"){m.start(&p.plan_token,"main",&mut |_|{}).unwrap();}
            drop(m);
            if phase=="cleaning"{let m=f.manager();m.recheck().unwrap();}
        }
        let mut child=child_command(&f,action,phase).spawn().unwrap();
        let stdout=child.stdout.take().unwrap();let (send,receive)=std::sync::mpsc::channel();
        std::thread::spawn(move||{for line in std::io::BufReader::new(stdout).lines(){let line=line.unwrap();if line.starts_with("STORAGE_DURABLE_PHASE:"){send.send(line).unwrap();return;}}});
        let ready=receive.recv_timeout(std::time::Duration::from_secs(30));
        if ready.is_err(){let _=child.kill();let output=child.wait_with_output().unwrap();panic!("stage {phase} not reached: {}",String::from_utf8_lossy(&output.stderr));}
        child.kill().unwrap();child.wait().unwrap();
        let m=f.manager();let state=m.state();
        if matches!(phase,"restart_required"|"validating"){m.recheck().unwrap();}
        else if phase=="cleaning"{let id=state.operation.unwrap().operation_id;m.resume_cleanup(&id,"recovery",&mut |_|{}).unwrap();}
        else if phase=="prepared"{let p=m.pending_preview("recovery").unwrap();m.start(&p.plan_token,"recovery",&mut |_|{}).unwrap();}
        else {let id=state.operation.unwrap().operation_id;m.resume(&id,state.generation,"recovery",&mut |_|{}).unwrap();}
        drop(m);let m=f.manager();m.recheck().unwrap();assert_eq!(m.state().data_access,"ready","phase {phase}");
        assert_eq!(fs::read(f.target.join("outputs/tasks/a/transcript.txt")).unwrap(),b"preserved original");
    }
}

#[test]
fn real_termination_inside_preflight_probe_and_inventory_write_can_resume() {
    for kind in ["probe","json"] {
        let f=Fixture::new();let cache=f.config.join("cache");fs::create_dir(&cache).unwrap();
        let suffix="long-inventory-name-".repeat(8);for index in 0..4000{fs::write(cache.join(format!("{index:05}-{suffix}")),b"preserve").unwrap();}
        let mut child=child_command(&f,"prepare","prepared").spawn().unwrap();let until=std::time::Instant::now()+std::time::Duration::from_secs(90);let mut observed=false;
        while std::time::Instant::now()<until {
            if let Ok(bytes)=fs::read(f.config.join("data-storage.json")){if let Ok(value)=serde_json::from_slice::<location::Control>(&bytes){if let Some(pending)=value.pending{for artifact in pending.owned_artifacts{
                if artifact.kind==kind&&artifact.identity.is_some(){let path=pending.target.join(artifact.relative_path);let reached=if kind=="probe"{path.join("name-probe").is_dir()}else{fs::metadata(path).is_ok_and(|m|m.len()>0)};if reached{observed=true;break;}}
            }}}}
            if observed||child.try_wait().unwrap().is_some(){break;}std::thread::yield_now();
        }
        child.kill().unwrap();let output=child.wait_with_output().unwrap();assert!(observed,"{kind} was not observed: {}",String::from_utf8_lossy(&output.stderr));
        let m=f.manager();let id=m.state().operation.unwrap().operation_id;let preview=m.resume_preparation(&id,0,"recovery",None,&mut ||Ok(()),&mut |_,_|Ok(serde_json::Value::Null)).unwrap();
        assert_eq!(preview.total_files,4000);assert_eq!(m.state().operation.unwrap().phase,"prepared");m.cancel(&preview.operation_id,0).unwrap();assert_eq!(m.state().data_access,"ready");assert_eq!(fs::read_dir(cache).unwrap().count(),4000);
    }
}

#[test]
fn target_is_pinned_during_long_preflight_and_foreign_metadata_never_commits() {
    let f=Fixture::new();f.write("cache/file",b"saved");let m=f.manager();let moved=f.base.join("moved");let mut renamed=false;
    let result=m.prepare_with_validation(f.target.clone(),vec![],"main",0,&mut ||Ok(()),&mut |_,_|{
        if fs::rename(&f.target,&moved).is_ok(){renamed=true;fs::create_dir(&f.target).unwrap();}
        Ok(serde_json::Value::Null)
    });
    if renamed {assert!(result.is_err());assert!(!f.target.join(".frameq-storage").exists());}else{assert!(result.is_ok());}
    let f=Fixture::new();f.write("cache/file",b"saved");let m=f.manager();let p=f.prepare(&m);let mut added=false;
    let result=m.start(&p.plan_token,"main",&mut |s|{if !added&&s.operation.as_ref().is_some_and(|p|p.phase=="copying"&&p.completed_files>0){fs::write(f.target.join(".frameq-storage/foreign"),b"unrelated").unwrap();added=true;}});
    assert_eq!(result.unwrap_err().code,"TargetConflict");assert_eq!(paths_for_config(&f.config).unwrap().data_root,f.config);
    assert_eq!(fs::read(f.target.join(".frameq-storage/foreign")).unwrap(),b"unrelated");assert!(f.config.join("cache/file").exists());
}

#[test]
fn actual_sparse_file_over_available_capacity_is_rejected_before_hashing() {
    let f=Fixture::new();let source=f.config.join("cache/sparse");fs::create_dir(source.parent().unwrap()).unwrap();let file=fs::File::create(&source).unwrap();
    #[cfg(windows)] {
        use std::os::windows::io::AsRawHandle;
        #[link(name="kernel32")] extern "system" {fn DeviceIoControl(handle:*mut core::ffi::c_void,code:u32,input:*const core::ffi::c_void,input_size:u32,output:*mut core::ffi::c_void,output_size:u32,returned:*mut u32,overlapped:*mut core::ffi::c_void)->i32;}
        let mut returned=0;assert_ne!(unsafe{DeviceIoControl(file.as_raw_handle().cast(),0x0009_00c4,std::ptr::null(),0,std::ptr::null_mut(),0,&mut returned,std::ptr::null_mut())},0);
    }
    let available=fs4::available_space(&f.target).unwrap();file.set_len(available+128*1024*1024).unwrap();drop(file);
    let m=f.manager();assert_eq!(m.prepare(f.target.clone(),vec![],"main",0).unwrap_err().code,"InsufficientSpace");assert!(f.config.join("cache/sparse").is_file());
}

#[cfg(windows)]
#[test]
fn actual_target_acl_denial_preserves_original_and_can_be_restored() {
    let f=Fixture::new();f.write("cache/original",b"preserve");
    struct Restore(PathBuf);impl Drop for Restore {fn drop(&mut self){let status=std::process::Command::new("icacls").arg(&self.0).args(["/remove:d","*S-1-1-0"]).output().unwrap();assert!(status.status.success());}}
    let denied=std::process::Command::new("icacls").arg(&f.target).args(["/deny","*S-1-1-0:(W)"]).output().unwrap();assert!(denied.status.success());let restore=Restore(f.target.clone());
    let m=f.manager();assert_eq!(m.prepare(f.target.clone(),vec![],"main",0).unwrap_err().code,"PermissionDenied");assert!(f.config.join("cache/original").is_file());drop(restore);
    fs::write(f.target.join("permission-restored"),b"ok").unwrap();
}

#[cfg(windows)]
#[test]
fn real_control_readonly_failure_cannot_commit_new_root() {
    let f=Fixture::new();f.write("cache/file",b"saved");let m=f.manager();let p=f.prepare(&m);let control=f.config.join("data-storage.json");
    let mut permissions=fs::metadata(&control).unwrap().permissions();permissions.set_readonly(true);fs::set_permissions(&control,permissions).unwrap();
    let result=m.start(&p.plan_token,"main",&mut |_|{});
    let mut permissions=fs::metadata(&control).unwrap().permissions();permissions.set_readonly(false);fs::set_permissions(&control,permissions).unwrap();
    assert_eq!(result.unwrap_err().code,"CommitFailed");assert_eq!(paths_for_config(&f.config).unwrap().data_root,f.config);assert_eq!(fs::read(f.config.join("cache/file")).unwrap(),b"saved");
}

#[test]
fn control_semantics_reject_nil_ids_and_cross_phase_root_switches() {
    let f=Fixture::new();let m=f.manager();let mut control=m.snapshot().unwrap();drop(m);
    control.active.library_id=uuid::Uuid::nil().to_string();
    fs::write(f.config.join("data-storage.json"),serde_json::to_vec(&control).unwrap()).unwrap();let m=f.manager();assert_eq!(m.state().last_error.as_deref(),Some("ControlInvalid"));drop(m);
    fs::remove_file(f.config.join("data-storage.json")).unwrap();let m=f.manager();let _p=f.prepare(&m);let mut control=m.snapshot().unwrap();drop(m);
    control.pending.as_mut().unwrap().previous.generation=99;
    fs::write(f.config.join("data-storage.json"),serde_json::to_vec(&control).unwrap()).unwrap();let m=f.manager();assert_eq!(m.state().last_error.as_deref(),Some("ControlInvalid"));
}

#[test]
fn restart_handoff_atomically_stops_old_writer_before_releasing_process_lock() {
    let f=Fixture::new();let m=f.manager();let lease=m.acquire().unwrap();assert_eq!(m.prepare_restart().unwrap_err().code,"Busy");drop(lease);
    m.prepare_restart().unwrap();assert_eq!(m.acquire().err().unwrap().code,"Busy");let next=f.manager();assert_eq!(next.state().data_access,"ready");assert!(next.acquire().is_ok());
}

#[cfg(windows)]
#[test]
fn target_case_aliases_are_rejected_by_real_preflight_name_creation() {
    let f=Fixture::new();f.write("outputs/tasks/Case/file",b"first");let other=f.base.join("custom");fs::create_dir_all(other.join("tasks/case")).unwrap();fs::write(other.join("tasks/case/file"),b"second").unwrap();let m=f.manager();
    assert_eq!(m.prepare(f.target.clone(),vec![other.clone()],"main",0).unwrap_err().code,"TargetConflict");
    assert!(!f.target.join("outputs").exists());assert_eq!(fs::read(f.config.join("outputs/tasks/Case/file")).unwrap(),b"first");assert_eq!(fs::read(other.join("tasks/case/file")).unwrap(),b"second");
}

#[cfg(windows)]
#[test]
fn failed_cleanup_can_be_stopped_without_blocking_the_current_library() {
    let f=Fixture::new();for name in ["a","b","c"]{f.write(&format!("cache/{name}"),b"saved");}let m=f.manager();f.migrate(&m);drop(m);let m=f.manager();m.recheck().unwrap();
    let control=f.config.join("data-storage.json");let mut blocked=false;
    let id=m.state().cleanup_receipts[0].receipt_id.clone();let p=m.prepare_cleanup(&id,"main").unwrap();
    let result=m.confirm_cleanup(&p.plan_token,"main",&mut |_|{if !blocked{let mut permissions=fs::metadata(&control).unwrap().permissions();permissions.set_readonly(true);fs::set_permissions(&control,permissions).unwrap();blocked=true;}});
    let mut permissions=fs::metadata(&control).unwrap().permissions();permissions.set_readonly(false);fs::set_permissions(&control,permissions).unwrap();
    assert_eq!(result.unwrap_err().code,"CommitFailed");assert!(m.state().operation.unwrap().can_cancel);m.stop_cleanup(&id).unwrap();assert!(m.acquire().is_ok());assert!(f.config.join("cache/c").is_file());
}

#[cfg(unix)]
#[test]
fn unix_directory_modes_are_restored_after_children_and_verified() {
    use std::os::unix::fs::PermissionsExt;
    let f=Fixture::new();f.write("runtime/pytorch/v/exec",b"data");let path=f.config.join("runtime/pytorch/v");fs::set_permissions(&path,fs::Permissions::from_mode(0o550)).unwrap();let m=f.manager();f.migrate(&m);
    assert_eq!(fs::metadata(f.target.join("runtime/pytorch/v")).unwrap().permissions().mode()&0o777,0o550);
}
