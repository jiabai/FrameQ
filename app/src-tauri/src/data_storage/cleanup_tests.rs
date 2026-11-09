use super::*;
use std::{path::PathBuf,sync::{Arc,atomic::{AtomicBool,Ordering}}};

struct Fixture {config:PathBuf,resources:PathBuf,target:PathBuf}
impl Fixture {
    fn new()->Self {
        let base=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-acceptance").join(uuid::Uuid::new_v4().to_string());
        let config=base.join("config");let resources=base.join("resources");let target=base.join("target");
        for path in [&config,&resources,&target]{fs::create_dir_all(path).unwrap();}
        let config=config.canonicalize().unwrap();
        fs::write(config.join(".env"),format!("APP_OUTPUT_DIR={}\n",config.join("outputs").display())).unwrap();
        Self{config,resources:resources.canonicalize().unwrap(),target:target.canonicalize().unwrap()}
    }
    fn write(&self,name:&str,bytes:&[u8]) {let file=self.config.join("cache").join(name);fs::create_dir_all(file.parent().unwrap()).unwrap();fs::write(file,bytes).unwrap();}
    fn manager(&self)->Arc<DataStorageManager>{Arc::new(DataStorageManager::open(self.config.clone(),self.resources.clone()).unwrap())}
    fn migrate(&self)->Arc<DataStorageManager> {
        let manager=self.manager();let preview=manager.prepare(self.target.clone(),vec![],"main",0).unwrap();
        manager.start(&preview.plan_token,"main",&mut |_|{}).unwrap();drop(manager);
        let manager=self.manager();manager.recheck().unwrap();manager
    }
    fn receipt(manager:&DataStorageManager)->String {manager.state().cleanup_receipts[0].receipt_id.clone()}
}

#[test]
fn cleanup_preflight_reports_both_real_reads_and_counts_missing_sources() {
    let f=Fixture::new();let length=5*1024*1024;f.write("large",&vec![17;length]);f.write("gone",b"already removed");
    let manager=f.migrate();fs::remove_file(f.config.join("cache/gone")).unwrap();
    let mut updates=Vec::new();let preview=manager.prepare_cleanup_observed(&Fixture::receipt(&manager),"main",&AtomicBool::new(false),&mut |progress|{updates.push(progress);Ok(())}).unwrap();
    assert_eq!(preview.total_files,1);assert_eq!(preview.total_bytes,length as u64);assert_eq!(preview.retained_files,0);
    assert!(updates.iter().all(|progress|progress.stage==PreflightStage::CleanupChecking));
    assert!(updates.iter().any(|progress|progress.total_files==Some(2)));
    assert!(updates.iter().any(|progress|progress.current_file_bytes>length as u64&&progress.current_file_bytes<2*length as u64));
    let last=updates.last().unwrap();assert_eq!(last.completed_files,2);assert_eq!(last.completed_bytes,2*length as u64);assert_eq!(last.total_bytes,None);
    assert!(fs::read(f.target.join("cache/large")).unwrap().iter().all(|byte|*byte==17));
}

#[test]
fn cleanup_preflight_cancel_during_second_file_read_stops_and_never_registers_token() {
    let f=Fixture::new();let length=5*1024*1024;f.write("large",&vec![23;length]);let manager=f.migrate();
    let cancel=AtomicBool::new(false);let mut reached=false;
    let result=manager.prepare_cleanup_observed(&Fixture::receipt(&manager),"main",&cancel,&mut |progress|{
        if progress.current_file_bytes>length as u64 {reached=true;cancel.store(true,Ordering::Release);}Ok(())
    });
    assert!(reached);assert_eq!(result.unwrap_err().code,"Cancelled");assert!(manager.inner.lock().unwrap().cleanup_tokens.is_empty());
    for path in [f.config.join("cache/large"),f.target.join("cache/large")] {let bytes=fs::read(path).unwrap();assert_eq!(bytes.len(),length);assert!(bytes.iter().all(|byte|*byte==23));}
    assert_eq!(manager.state().data_access,"ready");
}

#[test]
fn cleanup_preflight_cancel_after_last_file_blocks_late_confirmation_token() {
    let f=Fixture::new();f.write("file",b"unchanged");let manager=f.migrate();let cancel=AtomicBool::new(false);
    let result=manager.prepare_cleanup_observed(&Fixture::receipt(&manager),"main",&cancel,&mut |progress|{
        if progress.completed_files==1 {cancel.store(true,Ordering::Release);}Ok(())
    });
    assert_eq!(result.unwrap_err().code,"Cancelled");assert!(manager.inner.lock().unwrap().cleanup_tokens.is_empty());
    assert!(f.config.join("cache/file").is_file());assert!(f.target.join("cache/file").is_file());
}

#[test]
fn cleanup_preflight_retains_real_source_and_target_content_changes() {
    let f=Fixture::new();f.write("source",b"original");f.write("target",b"original");let manager=f.migrate();
    fs::write(f.config.join("cache/source"),b"new data").unwrap();fs::write(f.target.join("cache/target"),b"new data").unwrap();
    let preview=manager.prepare_cleanup_observed(&Fixture::receipt(&manager),"main",&AtomicBool::new(false),&mut |_|Ok(())).unwrap();
    assert_eq!(preview.total_files,0);assert_eq!(preview.retained_files,2);
    assert_eq!(fs::read(f.config.join("cache/source")).unwrap(),b"new data");assert_eq!(fs::read(f.target.join("cache/target")).unwrap(),b"new data");
}

#[test]
fn cleanup_preflight_changed_file_length_keeps_real_byte_progress_bounded() {
    let f=Fixture::new();f.write("file",b"original");let manager=f.migrate();let length=2*1024*1024;
    fs::write(f.config.join("cache/file"),vec![29;length]).unwrap();let mut updates=Vec::new();
    let preview=manager.prepare_cleanup_observed(&Fixture::receipt(&manager),"main",&AtomicBool::new(false),&mut |progress|{updates.push(progress);Ok(())}).unwrap();
    assert_eq!(preview.total_files,0);assert_eq!(preview.retained_files,1);
    assert!(updates.iter().all(|progress|progress.current_file_bytes<=progress.current_file_total_bytes));
    assert_eq!(updates.last().unwrap().completed_bytes,length as u64);
    assert_eq!(fs::read(f.target.join("cache/file")).unwrap(),b"original");
}

#[test]
fn cleanup_preflight_generation_or_pending_change_invalidates_result_before_token_registration() {
    let f=Fixture::new();f.write("file",b"original");let manager=f.migrate();let mut changed=false;
    let next=f.target.parent().unwrap().join("next");fs::create_dir(&next).unwrap();
    let result=manager.prepare_cleanup_observed(&Fixture::receipt(&manager),"main",&AtomicBool::new(false),&mut |progress|{
        if progress.completed_files==1&&!changed {changed=true;manager.prepare(next.clone(),vec![],"main",1)?;}Ok(())
    });
    assert!(changed);assert_eq!(result.unwrap_err().code,"StaleOperation");assert!(manager.inner.lock().unwrap().cleanup_tokens.is_empty());
    assert_eq!(fs::read(f.config.join("cache/file")).unwrap(),b"original");assert_eq!(fs::read(f.target.join("cache/file")).unwrap(),b"original");
}

#[test]
fn cleanup_preflight_confirmation_rechecks_target_modified_after_preview() {
    let f=Fixture::new();f.write("file",b"original");let manager=f.migrate();
    let preview=manager.prepare_cleanup_observed(&Fixture::receipt(&manager),"main",&AtomicBool::new(false),&mut |_|Ok(())).unwrap();
    assert_eq!(preview.total_files,1);fs::write(f.target.join("cache/file"),b"new data").unwrap();
    manager.confirm_cleanup(&preview.plan_token,"main",&mut |_|{}).unwrap();
    assert_eq!(fs::read(f.config.join("cache/file")).unwrap(),b"original");assert_eq!(fs::read(f.target.join("cache/file")).unwrap(),b"new data");
}

#[test]
fn cleanup_preflight_discarded_token_cannot_delete_old_files() {
    let f=Fixture::new();f.write("file",b"original");let manager=f.migrate();
    let preview=manager.prepare_cleanup_observed(&Fixture::receipt(&manager),"main",&AtomicBool::new(false),&mut |_|Ok(())).unwrap();
    manager.discard_cleanup_preview(&preview.plan_token);
    assert_eq!(manager.confirm_cleanup(&preview.plan_token,"main",&mut |_|{}).unwrap_err().code,"StaleOperation");
    assert_eq!(fs::read(f.config.join("cache/file")).unwrap(),b"original");assert_eq!(fs::read(f.target.join("cache/file")).unwrap(),b"original");
}

#[cfg(windows)]
#[test]
fn cleanup_preflight_retains_files_when_windows_read_access_is_denied() {
    use std::os::windows::fs::OpenOptionsExt;
    let f=Fixture::new();f.write("file",b"original");let manager=f.migrate();
    let guard=fs::OpenOptions::new().read(true).share_mode(0).open(f.target.join("cache/file")).unwrap();
    let mut completed=0;let preview=manager.prepare_cleanup_observed(&Fixture::receipt(&manager),"main",&AtomicBool::new(false),&mut |progress|{completed=progress.completed_files;Ok(())}).unwrap();
    assert_eq!(preview.total_files,0);assert_eq!(preview.retained_files,1);assert_eq!(completed,1);drop(guard);
    assert_eq!(fs::read(f.config.join("cache/file")).unwrap(),b"original");assert_eq!(fs::read(f.target.join("cache/file")).unwrap(),b"original");
}

#[test]
#[ignore="只读核对当前真实资料库与工作区独立副本；需要显式APP_STORAGE_READONLY_CONFIG及足够可用空间"]
fn cleanup_preflight_checks_real_library_snapshot_and_cancels_without_user_mutation() {
    let config=PathBuf::from(std::env::var_os("APP_STORAGE_READONLY_CONFIG").expect("explicit readonly library config"));
    let before=fs::read(config.join("data-storage.json")).unwrap();
    let control=control::load(&config).unwrap().unwrap();
    assert!(control.pending.is_none(),"真实资料必须处于静止状态");
    let estimate=inventory::estimate_with_progress(&control.active,&[],&control.cleanup_receipts,None,&mut |_|Ok(())).unwrap();
    let total_files=estimate.entries.iter().filter(|entry|!entry.directory).count()as u64;
    let total_bytes=estimate.entries.iter().filter(|entry|!entry.directory).try_fold(0u64,|total,entry|total.checked_add(entry.length)).unwrap();
    assert!(total_files>18_000,"必须使用当前真实大资料库");
    let data=inventory::build_with_progress(&control.active,&[],&control.cleanup_receipts,None,total_files,total_bytes,&mut |_|Ok(())).unwrap();
    assert_eq!(data.total_files,total_files);assert_eq!(data.total_bytes,total_bytes);

    let workspace=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
    let user_root=control.active.data_root.canonicalize().unwrap();
    let artifact_root=workspace.join("build/data-storage-acceptance");
    assert!(!artifact_root.starts_with(&user_root));assert!(!user_root.starts_with(&artifact_root));
    fs::create_dir_all(&artifact_root).unwrap();
    let artifact_root=artifact_root.canonicalize().unwrap();
    assert!(artifact_root.starts_with(&workspace));assert!(!artifact_root.starts_with(&user_root));
    let required=total_bytes.checked_add(total_files.checked_mul(4096).unwrap()).unwrap().checked_add(64*1024*1024).unwrap();
    let available=fs4::available_space(&artifact_root).expect("read actual workspace volume free capacity");
    assert!(available>=required,"工作区实际可用空间不足：available={available} required={required}");
    let snapshot=artifact_root.join(uuid::Uuid::new_v4().to_string()).join("snapshot");fs::create_dir_all(&snapshot).unwrap();
    let snapshot=snapshot.canonicalize().unwrap();
    assert!(snapshot.starts_with(&artifact_root));assert!(!snapshot.starts_with(&user_root));assert!(!user_root.starts_with(&snapshot));
    let mut copied_files=0;let mut copied_bytes=0u64;
    for entry in inventory::unique_entries(&data) {
        assert!(control::safe_relative(&entry.destination));
        let destination=snapshot.join(&entry.destination);
        assert!(destination.starts_with(&snapshot));
        if entry.directory {fs::create_dir_all(&destination).unwrap();continue;}
        fs::create_dir_all(destination.parent().unwrap()).unwrap();assert!(!destination.exists());
        // 固定真实来源文件，副本仅写入工作区独立目录。
        let source=safe_filesystem::open_regular(&entry.source).unwrap();
        assert_eq!(safe_filesystem::file_identity(&source).unwrap(),entry.identity);
        let bytes=fs::copy(&entry.source,&destination).expect("copy actual file into isolated workspace snapshot");
        assert_eq!(bytes,entry.length);assert_eq!(safe_filesystem::file_identity(&source).unwrap(),entry.identity);
        let copied=safe_filesystem::open_regular(&destination).unwrap();
        assert_ne!(safe_filesystem::file_identity(&copied).unwrap(),entry.identity,"独立副本不得使用hardlink");
        copied_files+=1;copied_bytes=copied_bytes.checked_add(bytes).unwrap();
    }
    assert_eq!(copied_files,total_files);assert_eq!(copied_bytes,total_bytes);
    assert_eq!(fs::read(config.join("data-storage.json")).unwrap(),before);

    let expected_read=total_bytes.checked_mul(2).unwrap();let mut reports=0u64;let mut last_files=0;let mut last_bytes=0;
    let mut saw_large_second_read=false;
    let totals=scan_cleanup_entries(&snapshot,&data,&AtomicBool::new(false),&mut |progress|{
        assert_eq!(progress.stage,PreflightStage::CleanupChecking);assert_eq!(progress.total_files,Some(total_files));
        assert!(progress.completed_files>=last_files);assert!(progress.completed_bytes>=last_bytes);
        assert!(progress.current_file_bytes<=progress.current_file_total_bytes);
        if progress.current_file_total_bytes>4*1024*1024&&progress.current_file_bytes>progress.current_file_total_bytes/2
            &&progress.current_file_bytes<progress.current_file_total_bytes{saw_large_second_read=true;}
        reports+=1;last_files=progress.completed_files;last_bytes=progress.completed_bytes;Ok(())
    }).unwrap();
    assert_eq!(totals.deletable_files,total_files);assert_eq!(totals.deletable_bytes,total_bytes);assert_eq!(totals.retained_files,0);
    assert_eq!(last_files,total_files);assert_eq!(last_bytes,expected_read);assert!(reports>=total_files);assert!(saw_large_second_read);

    let cancel=AtomicBool::new(false);let mut stopped=0;
    let error=scan_cleanup_entries(&snapshot,&data,&cancel,&mut |progress|{
        stopped=progress.completed_files;if stopped>=10{cancel.store(true,Ordering::Release);}Ok(())
    }).err().expect("actual second readonly scan must stop on cancellation");
    assert_eq!(error.code,"Cancelled");assert_eq!(stopped,10);
    assert_eq!(fs::read(config.join("data-storage.json")).unwrap(),before);
    assert!(control::load(&config).unwrap().unwrap().pending.is_none());
    println!("readonly cleanup preflight: files={total_files} bytes={total_bytes} read_bytes={last_bytes} reports={reports} cancelled_after={stopped} snapshot={}",snapshot.display());
}
