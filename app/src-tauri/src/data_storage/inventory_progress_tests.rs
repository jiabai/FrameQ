use super::*;
use std::sync::atomic::{AtomicBool,Ordering};

fn fixture()->ActiveStorage {
    let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/storage-preflight-acceptance").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(root.join("outputs")).unwrap();
    let root=root.canonicalize().unwrap();
    ActiveStorage{mode:"legacy".into(),library_id:uuid::Uuid::new_v4().to_string(),generation:0,
        root_identity:safe_filesystem::identity(&root).unwrap(),data_root:root,legacy_output_root:None}
}

#[test]
fn inventory_preflight_reports_scanning_and_real_hash_chunks() {
    let active=fixture();
    fs::create_dir(active.data_root.join("cache")).unwrap();
    fs::write(active.data_root.join("cache/large.bin"),vec![37;3*1024*1024+17]).unwrap();
    let mut scan=Vec::new();
    let estimated=estimate_with_progress(&active,&[],&[],None,&mut |event|{scan.push(event);Ok(())}).unwrap();
    assert!(scan.iter().any(|event|event.stage==PreflightStage::InventoryScanning&&event.completed_files==1&&event.total_files.is_none()));
    assert!(scan.iter().all(|event|event.completed_bytes==0));
    let mut hashes=Vec::new();
    let verified=build_with_progress(&active,&[],&[],None,1,estimated.total_bytes,&mut |event|{hashes.push(event);Ok(())}).unwrap();
    assert_eq!(verified.total_files,1);
    assert_eq!(verified.entries.iter().find(|entry|!entry.directory).unwrap().sha256,format!("{:x}",Sha256::digest(vec![37;3*1024*1024+17])));
    assert!(hashes.iter().any(|event|event.current_file_bytes==1024*1024&&event.completed_files==0));
    let done=hashes.last().unwrap();
    assert_eq!(done.completed_files,1);assert_eq!(done.completed_bytes,3*1024*1024+17);
    assert_eq!(done.total_files,Some(1));assert_eq!(done.total_bytes,Some(3*1024*1024+17));
    assert!(hashes.windows(2).all(|pair|pair[1].completed_bytes>=pair[0].completed_bytes));
}

#[test]
fn inventory_preflight_cancellation_interrupts_a_real_large_file() {
    let active=fixture();fs::create_dir(active.data_root.join("cache")).unwrap();
    let bytes=vec![19;6*1024*1024];let path=active.data_root.join("cache/large.bin");fs::write(&path,&bytes).unwrap();
    let cancelled=AtomicBool::new(false);let mut read=0;
    let error=build_with_progress(&active,&[],&[],Some(&cancelled),1,bytes.len()as u64,&mut |event|{
        read=event.completed_bytes;if read>=1024*1024{cancelled.store(true,Ordering::Release);}Ok(())
    }).unwrap_err();
    assert_eq!(error.code,"Cancelled");assert_eq!(read,1024*1024);assert_eq!(fs::read(path).unwrap(),bytes);
}

#[test]
fn inventory_preflight_counts_all_reads_when_destinations_are_deduplicated() {
    let active=fixture();let source=active.data_root.parent().unwrap().join(uuid::Uuid::new_v4().to_string());
    for root in [active.data_root.join("outputs"),source.clone()] {
        fs::create_dir_all(root.join("tasks/shared")).unwrap();fs::write(root.join("tasks/shared/content.txt"),b"same content").unwrap();
    }
    let estimate=estimate_with_progress(&active,&[source.clone()],&[],None,&mut |_|Ok(())).unwrap();
    assert_eq!(estimate.total_files,1);
    let actual_files=estimate.entries.iter().filter(|entry|!entry.directory).count()as u64;
    let actual_bytes=estimate.entries.iter().filter(|entry|!entry.directory).map(|entry|entry.length).sum();
    assert_eq!(actual_files,2);
    let mut last=None;
    let inventory=build_with_progress(&active,&[source],&[],None,actual_files,actual_bytes,&mut |event|{last=Some(event);Ok(())}).unwrap();
    assert_eq!(inventory.total_files,1);let last=last.unwrap();assert_eq!(last.completed_files,2);assert_eq!(last.total_files,Some(2));
    assert_eq!(last.completed_bytes,24);
}

#[test]
fn inventory_preflight_source_change_after_hashing_requires_reverification() {
    let active=fixture();fs::create_dir(active.data_root.join("cache")).unwrap();
    let path=active.data_root.join("cache/content.bin");fs::write(&path,b"original content").unwrap();
    let inventory=build_with_progress(&active,&[],&[],None,1,16,&mut |_|Ok(())).unwrap();
    fs::write(&path,b"legitimate later edit").unwrap();
    assert_eq!(verify_sources_with_progress(&inventory,None,&mut |_|Ok(())).unwrap_err().code,"SourceChanged");
    assert_eq!(fs::read(path).unwrap(),b"legitimate later edit");
}

#[test]
fn inventory_preflight_source_reverification_reports_real_chunks_and_cancels() {
    let active=fixture();fs::create_dir(active.data_root.join("cache")).unwrap();
    let path=active.data_root.join("cache/large.bin");let bytes=vec![57;3*1024*1024];fs::write(&path,&bytes).unwrap();
    let inventory=build_cancellable(&active,&[],&[],None).unwrap();let cancel=AtomicBool::new(false);let mut last=None;
    let error=verify_sources_with_progress(&inventory,Some(&cancel),&mut |event|{
        if event.current_file_bytes>=1024*1024{cancel.store(true,Ordering::Release);}last=Some(event);Ok(())
    }).unwrap_err();
    assert_eq!(error.code,"Cancelled");let last=last.unwrap();assert_eq!(last.current_file_bytes,1024*1024);
    assert_eq!(last.completed_files,0);assert_eq!(last.total_files,Some(1));assert_eq!(last.total_bytes,Some(3*1024*1024));
    assert_eq!(fs::read(path).unwrap(),bytes);
}

#[cfg(windows)]
#[test]
fn inventory_preflight_reports_real_read_permission_failure_without_completion() {
    let active=fixture();fs::create_dir(active.data_root.join("cache")).unwrap();
    let file=active.data_root.join("cache/denied.bin");fs::write(&file,b"keep original").unwrap();
    struct Restore(PathBuf);
    impl Drop for Restore {fn drop(&mut self){assert!(std::process::Command::new("icacls").arg(&self.0).args(["/remove:d","*S-1-1-0"]).output().unwrap().status.success());}}
    assert!(std::process::Command::new("icacls").arg(&file).args(["/deny","*S-1-1-0:(R)"]).output().unwrap().status.success());
    let restore=Restore(file.clone());let mut completed=0;
    let error=build_with_progress(&active,&[],&[],None,1,13,&mut |event|{completed=event.completed_files;Ok(())}).unwrap_err();
    assert_eq!(error.code,"PermissionDenied");assert_eq!(completed,0);drop(restore);assert_eq!(fs::read(file).unwrap(),b"keep original");
}

#[test]
#[ignore="只读扫描当前真实资料库；需要显式APP_STORAGE_READONLY_CONFIG指向固定配置目录"]
fn inventory_preflight_reads_real_user_library_without_mutation() {
    let config=PathBuf::from(std::env::var_os("APP_STORAGE_READONLY_CONFIG").expect("explicit readonly library config"));
    let control=control::load(&config).unwrap().unwrap();
    assert!(control.pending.is_none(),"真实资料必须处于静止状态");
    let before=fs::read(config.join("data-storage.json")).unwrap();let mut scanned=0;
    let estimated=estimate_with_progress(&control.active,&[],&control.cleanup_receipts,None,&mut |event|{scanned=event.completed_files;Ok(())}).unwrap();
    let total_files=estimated.entries.iter().filter(|entry|!entry.directory).count()as u64;
    let total_bytes=estimated.entries.iter().filter(|entry|!entry.directory).map(|entry|entry.length).sum();
    assert!(scanned>18_000,"必须使用当前真实大资料库");
    let mut reports=0;let mut last=None;
    let inventory=build_with_progress(&control.active,&[],&control.cleanup_receipts,None,total_files,total_bytes,&mut |event|{reports+=1;last=Some(event);Ok(())}).unwrap();
    let completed=last.unwrap();assert_eq!(completed.completed_files,total_files);assert_eq!(completed.completed_bytes,total_bytes);assert!(reports>=total_files);
    let cancel=AtomicBool::new(false);let mut stopped=0;
    let error=build_with_progress(&control.active,&[],&control.cleanup_receipts,Some(&cancel),total_files,total_bytes,&mut |event|{
        stopped=event.completed_files;if event.completed_files>=10{cancel.store(true,Ordering::Release);}Ok(())
    }).unwrap_err();
    assert_eq!(error.code,"Cancelled");assert!(stopped<total_files);
    assert_eq!(fs::read(config.join("data-storage.json")).unwrap(),before);
    println!("readonly inventory preflight: files={} bytes={} reports={} cancelled_after={}",inventory.total_files,inventory.total_bytes,reports,stopped);
}
