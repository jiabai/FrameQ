use super::*;
use std::sync::atomic::AtomicBool;

fn probe_fixture()->(PathBuf,Inventory,PathBuf) {
    let base=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/storage-preflight-acceptance").join(uuid::Uuid::new_v4().to_string());
    let source=base.join("source");let probe=base.join("probe");
    fs::create_dir_all(source.join("cache/deep")).unwrap();fs::create_dir(&probe).unwrap();
    fs::write(source.join("cache/deep/first"),b"first content").unwrap();fs::write(source.join("cache/deep/second"),b"second content").unwrap();
    let source=source.canonicalize().unwrap();let probe=probe.canonicalize().unwrap();
    let active=ActiveStorage{mode:"legacy".into(),library_id:uuid::Uuid::new_v4().to_string(),generation:0,root_identity:safe_filesystem::identity(&source).unwrap(),data_root:source.clone(),legacy_output_root:None};
    let inventory=inventory::estimate(&active,&[],&[],None).unwrap();(probe,inventory,source)
}

#[test]
fn target_preflight_reports_files_and_removes_its_real_probe_entries() {
    let(probe,inventory,source)=probe_fixture();let mut events=Vec::new();
    probe_destination_names(&probe,&inventory,&AtomicBool::new(false),&mut |event|{events.push(event);Ok(())}).unwrap();
    assert!(events.iter().all(|event|event.stage==PreflightStage::TargetCheck&&event.total_files==Some(2)));
    assert!(events.iter().any(|event|event.completed_files==1));assert_eq!(events.last().unwrap().completed_files,2);
    assert_eq!(fs::read_dir(probe).unwrap().count(),0);assert_eq!(fs::read(source.join("cache/deep/first")).unwrap(),b"first content");
}

#[test]
fn target_preflight_cancel_removes_created_probes_and_keeps_sources() {
    let(probe,inventory,source)=probe_fixture();let cancel=AtomicBool::new(false);let mut completed=0;
    let error=probe_destination_names(&probe,&inventory,&cancel,&mut |event|{
        completed=event.completed_files;if completed==1{cancel.store(true,Ordering::Release);}Ok(())
    }).unwrap_err();
    assert_eq!(error.code,"Cancelled");assert_eq!(completed,1);assert_eq!(fs::read_dir(probe).unwrap().count(),0);
    assert_eq!(fs::read(source.join("cache/deep/first")).unwrap(),b"first content");assert_eq!(fs::read(source.join("cache/deep/second")).unwrap(),b"second content");
}

#[test]
fn target_preflight_callback_rejection_cleans_its_created_entries() {
    let(probe,inventory,_)=probe_fixture();
    let error=probe_destination_names(&probe,&inventory,&AtomicBool::new(false),&mut |event|{
        if event.completed_files==1{Err(StorageError::new("Cancelled"))}else{Ok(())}
    }).unwrap_err();
    assert_eq!(error.code,"Cancelled");assert_eq!(fs::read_dir(probe).unwrap().count(),0);
}

fn migration_manager(source:&Path)->DataStorageManager {
    fs::write(source.join(".env"),format!("FRAMEQ_OUTPUT_DIR={}\n",source.join("outputs").display())).unwrap();
    let resources=source.parent().unwrap().join("resources");fs::create_dir_all(&resources).unwrap();
    DataStorageManager::open(source.into(),resources.canonicalize().unwrap()).unwrap()
}

#[test]
fn migration_start_preflight_reverification_can_cancel_before_copying() {
    let(target,_,source)=probe_fixture();let bytes=vec![71;3*1024*1024];fs::write(source.join("cache/large.bin"),&bytes).unwrap();
    let manager=migration_manager(&source);let preview=manager.prepare(target.clone(),vec![],"main",0).unwrap();
    let mut durable_phases=Vec::new();let mut read=0;
    let error=manager.start_with_preflight(&preview.plan_token,"main",&mut |state|{durable_phases.push(state.operation.map(|operation|operation.phase));},&mut |event|{
        if event.stage==PreflightStage::IntegrityCheck&&event.current_file_bytes>=1024*1024{read=event.current_file_bytes;manager.signal_preparation_cancel();}Ok(())
    }).unwrap_err();
    assert_eq!(error.code,"Cancelled");assert_eq!(read,1024*1024);assert!(durable_phases.is_empty());
    assert_eq!(manager.state().data_access,"ready");assert_eq!(super::super::paths_for_config(&source).unwrap().data_root,source);
    assert_eq!(fs::read(source.join("cache/large.bin")).unwrap(),bytes);assert!(!target.join("cache").exists());
}

#[test]
fn migration_start_preflight_reports_real_reverification_before_native_copy() {
    let(target,_,source)=probe_fixture();let manager=migration_manager(&source);let preview=manager.prepare(target.clone(),vec![],"main",0).unwrap();
    let mut preflight=Vec::new();let mut durable=Vec::new();
    let state=manager.start_with_preflight(&preview.plan_token,"main",&mut |state|{durable.push(state.operation.map(|operation|operation.phase));},&mut |event|{preflight.push(event);Ok(())}).unwrap();
    assert_eq!(preflight.first().unwrap().stage,PreflightStage::Waiting);
    let completed=preflight.iter().rev().find(|event|event.stage==PreflightStage::IntegrityCheck).unwrap();assert_eq!(completed.completed_files,2);assert_eq!(completed.total_files,Some(2));
    assert!(preflight.iter().any(|event|event.stage==PreflightStage::TargetCheck&&event.completed_files==2));
    assert!(durable.iter().any(|phase|phase.as_deref()==Some("copying")));assert_eq!(state.data_access,"restart_required");
    assert_eq!(fs::read(target.join("cache/deep/first")).unwrap(),b"first content");assert_eq!(fs::read(source.join("cache/deep/first")).unwrap(),b"first content");
}

#[test]
fn target_preflight_resume_space_reports_actual_partial_copy_reads_and_cancel() {
    let(target,_,source)=probe_fixture();let bytes=vec![83;3*1024*1024];fs::write(source.join("cache/large.bin"),&bytes).unwrap();
    let active=ActiveStorage{mode:"legacy".into(),library_id:uuid::Uuid::new_v4().to_string(),generation:0,root_identity:safe_filesystem::identity(&source).unwrap(),data_root:source.clone(),legacy_output_root:None};
    let inventory=inventory::build_cancellable(&active,&[],&[],None).unwrap();let payload=target.join("payload");fs::create_dir_all(payload.join("cache")).unwrap();
    fs::copy(source.join("cache/large.bin"),payload.join("cache/large.bin")).unwrap();let cancel=AtomicBool::new(false);let mut last=None;
    let error=check_resume_space(&target,&source,&payload,&inventory,false,&cancel,&mut |event|{
        if event.current_file_bytes>=1024*1024{cancel.store(true,Ordering::Release);}last=Some(event);Ok(())
    }).unwrap_err();
    assert_eq!(error.code,"Cancelled");let event=last.unwrap();assert_eq!(event.stage,PreflightStage::TargetCheck);assert_eq!(event.current_file_bytes,1024*1024);
    assert_eq!(event.current_file_total_bytes,3*1024*1024);assert_eq!(fs::read(payload.join("cache/large.bin")).unwrap(),bytes);
    assert_eq!(fs::read(source.join("cache/large.bin")).unwrap(),bytes);
}
