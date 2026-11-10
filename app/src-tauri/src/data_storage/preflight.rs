use super::engine::{PreflightProgress,StorageError};
use serde::{Deserialize,Serialize};
use std::{collections::{HashMap,VecDeque},sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU8,AtomicU64,Ordering}},time::{Duration,Instant}};

pub(super) const EVENT:&str="data-storage-preflight-progress";

#[derive(Debug,Clone,Copy,PartialEq,Eq,Deserialize,Serialize)]
#[serde(rename_all="snake_case")]
pub(crate) enum PreflightKind {Migration,Cleanup}

#[derive(Clone)]
pub(super) enum Completion {Migration{operation_id:String,generation:u64},Cleanup{token:String}}

struct Session {
    id:String,window:String,generation:u64,kind:PreflightKind,cancelled:Arc<AtomicBool>,
    phase:AtomicU8,cancellable:Arc<AtomicBool>,sequence:AtomicU64,completion:Mutex<Option<Completion>>,
}
#[derive(Default)]
struct Sessions {entries:HashMap<String,Arc<Session>>,order:VecDeque<String>}
#[derive(Default)]
pub(super) struct Registry {sessions:Mutex<Sessions>}

impl Registry {
    pub(super) fn begin(&self,id:&str,window:&str,generation:u64,kind:PreflightKind)->Result<(),String> {
        if !uuid::Uuid::parse_str(id).is_ok_and(|value|value.to_string()==id){return Err("InvalidToken".into());}
        let mut sessions=self.sessions.lock().map_err(|_|"StorageIoFailed")?;
        if sessions.entries.contains_key(id){return Err("InvalidToken".into());}
        if sessions.entries.values().any(|entry|entry.phase.load(Ordering::Acquire)<2){return Err("Busy".into());}
        if kind==PreflightKind::Migration {
            for entry in sessions.entries.values().filter(|entry|entry.window==window&&entry.generation==generation&&entry.phase.load(Ordering::Acquire)==2) {
                let mut completion=entry.completion.lock().map_err(|_|"StorageIoFailed")?;
                if matches!(*completion,Some(Completion::Migration{..})){*completion=None;}
            }
        }
        while sessions.order.len()>=32 {let previous=sessions.order.pop_front().expect("bounded sessions");sessions.entries.remove(&previous);}
        sessions.entries.insert(id.into(),Arc::new(Session{id:id.into(),window:window.into(),generation,kind,
            cancelled:Arc::new(AtomicBool::new(false)),phase:AtomicU8::new(0),cancellable:Arc::new(AtomicBool::new(true)),sequence:AtomicU64::new(0),completion:Mutex::new(None)}));
        sessions.order.push_back(id.into());Ok(())
    }
    pub(super) fn claim(&self,id:&str,window:&str,generation:u64,kind:PreflightKind)->Result<Claim,String> {
        let sessions=self.sessions.lock().map_err(|_|"StorageIoFailed")?;
        let session=sessions.entries.get(id).ok_or("InvalidToken")?;
        if session.window!=window||session.generation!=generation||session.kind!=kind{return Err("StaleOperation".into());}
        if session.cancelled.load(Ordering::Acquire){return Err("Cancelled".into());}
        session.phase.compare_exchange(0,1,Ordering::AcqRel,Ordering::Acquire).map_err(|_|"Busy")?;
        Ok(Claim{session:Arc::clone(session),last_emit:None,last_stage:None})
    }
    pub(super) fn cancel(&self,id:&str,window:&str,mut stop:impl FnMut(PreflightKind,bool,Option<Completion>))->Result<(),String> {
        let sessions=self.sessions.lock().map_err(|_|"StorageIoFailed")?;
        let Some(session)=sessions.entries.get(id) else{return Ok(());};
        if session.window!=window{return Err("InvalidToken".into());}
        let phase=session.phase.load(Ordering::Acquire);
        if phase==1&&!session.cancellable.load(Ordering::Acquire){return Err("Busy".into());}
        session.cancelled.store(true,Ordering::Release);
        if phase==0 {session.phase.store(2,Ordering::Release);}
        let completion=session.completion.lock().map_err(|_|"StorageIoFailed")?.clone();
        stop(session.kind,phase==1,completion);Ok(())
    }
    pub(super) fn cancel_window(&self,window:Option<&str>,mut stop:impl FnMut(PreflightKind,bool,Option<Completion>)) {
        let sessions=self.sessions.lock().expect("preflight sessions");
        for session in sessions.entries.values().filter(|entry|window.is_none_or(|window|entry.window==window)) {
            let phase=session.phase.load(Ordering::Acquire);
            if phase==1&&!session.cancellable.load(Ordering::Acquire){continue;}
            session.cancelled.store(true,Ordering::Release);
            if phase==0 {session.phase.store(2,Ordering::Release);}
            let completion=session.completion.lock().expect("preflight completion").clone();
            if phase==1||completion.is_some(){stop(session.kind,phase==1,completion);}
        }
    }
    pub(super) fn active(&self)->bool {self.sessions.lock().expect("preflight sessions").entries.values().any(|entry|entry.phase.load(Ordering::Acquire)==1)}
}

#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(super) struct Event<'a> {
    request_id:&'a str,generation:u64,sequence:u64,kind:PreflightKind,
    #[serde(flatten)] progress:PreflightProgress,
}

pub(super) struct Claim {session:Arc<Session>,last_emit:Option<Instant>,last_stage:Option<super::engine::PreflightStage>}
impl Claim {
    pub(super) fn cancellation(&self)->Arc<AtomicBool> {Arc::clone(&self.session.cancelled)}
    pub(super) fn protect(&self) {self.session.cancellable.store(false,Ordering::Release);}
    pub(super) fn protection(&self)->Arc<AtomicBool> {Arc::clone(&self.session.cancellable)}
    pub(super) fn check(&self)->Result<(),StorageError> {if self.session.cancelled.load(Ordering::Acquire){Err(StorageError::new("Cancelled"))}else{Ok(())}}
    pub(super) fn report(&mut self,progress:PreflightProgress,mut emit:impl FnMut(Event<'_>))->Result<(),StorageError> {
        self.check()?;
        let complete=progress.total_files.is_some_and(|total|progress.completed_files==total);
        if self.last_stage!=Some(progress.stage)||complete||self.last_emit.is_none_or(|time|time.elapsed()>=Duration::from_millis(100)) {
            self.last_stage=Some(progress.stage);self.last_emit=Some(Instant::now());
            let sequence=self.session.sequence.fetch_add(1,Ordering::AcqRel)+1;
            emit(Event{request_id:&self.session.id,generation:self.session.generation,sequence,kind:self.session.kind,progress});
        }
        self.check()
    }
    pub(super) fn finish(&self,completion:Completion) { *self.session.completion.lock().expect("preflight completion")=Some(completion); }
}
impl Drop for Claim {fn drop(&mut self){self.session.phase.store(2,Ordering::Release);}}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancelled_registration_cannot_be_claimed_and_other_windows_cannot_cancel() {
        let registry=Registry::default();let id=uuid::Uuid::new_v4().to_string();
        registry.begin(&id,"main",4,PreflightKind::Cleanup).unwrap();
        assert!(registry.cancel(&id,"other",|_,_,_|panic!("wrong window")).is_err());
        registry.cancel(&id,"main",|_,running,_|assert!(!running)).unwrap();
        assert!(matches!(registry.claim(&id,"main",4,PreflightKind::Cleanup),Err(error) if error=="Cancelled"));
    }
    #[test]
    fn cancellation_keeps_running_scope_owned_until_actual_finish_and_retains_completed_preview() {
        let registry=Registry::default();let id=uuid::Uuid::new_v4().to_string();
        registry.begin(&id,"main",4,PreflightKind::Migration).unwrap();
        let claim=registry.claim(&id,"main",4,PreflightKind::Migration).unwrap();
        registry.cancel(&id,"main",|_,running,_|assert!(running)).unwrap();
        assert!(registry.active());assert!(claim.check().is_err());
        assert!(registry.begin(&uuid::Uuid::new_v4().to_string(),"main",4,PreflightKind::Cleanup).is_err());
        claim.finish(Completion::Migration{operation_id:"operation".into(),generation:4});
        assert!(registry.active());drop(claim);
        registry.cancel(&id,"main",|_,running,completion|{assert!(!running);assert!(matches!(completion,Some(Completion::Migration{generation:4,..})));}).unwrap();
        assert!(!registry.active());
    }
    #[test]
    fn a_new_scope_invalidates_old_migration_withdrawal_and_protected_work_waits_for_completion() {
        let registry=Registry::default();let old=uuid::Uuid::new_v4().to_string();let next=uuid::Uuid::new_v4().to_string();
        registry.begin(&old,"main",4,PreflightKind::Migration).unwrap();let claim=registry.claim(&old,"main",4,PreflightKind::Migration).unwrap();
        claim.finish(Completion::Migration{operation_id:"reused".into(),generation:4});drop(claim);
        registry.begin(&next,"main",4,PreflightKind::Migration).unwrap();
        registry.cancel(&old,"main",|_,_,completion|assert!(completion.is_none())).unwrap();
        let claim=registry.claim(&next,"main",4,PreflightKind::Migration).unwrap();claim.protect();
        assert_eq!(registry.cancel(&next,"main",|_,_,_|panic!("protected work")),Err("Busy".into()));
        registry.cancel_window(Some("main"),|_,_,_|panic!("protected work"));
        assert!(claim.check().is_ok());assert!(registry.active());drop(claim);assert!(!registry.active());
    }
    #[test]
    fn preflight_event_has_only_bounded_identity_and_numeric_progress() {
        let registry=Registry::default();let id=uuid::Uuid::new_v4().to_string();
        registry.begin(&id,"main",4,PreflightKind::Cleanup).unwrap();let mut claim=registry.claim(&id,"main",4,PreflightKind::Cleanup).unwrap();
        claim.report(PreflightProgress::stage(super::super::engine::PreflightStage::CleanupChecking),|event|{
            let event=serde_json::to_value(event).unwrap();assert_eq!(event["requestId"],id);assert_eq!(event["sequence"],1);assert_eq!(event["totalFiles"],serde_json::Value::Null);assert!(event.get("path").is_none());
        }).unwrap();
    }
    #[test]
    fn cancelling_a_completed_real_preparation_withdraws_its_actual_plan() {
        let root=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-acceptance").join(uuid::Uuid::new_v4().to_string());
        for directory in ["config/cache","resources","target"]{std::fs::create_dir_all(root.join(directory)).unwrap();}
        let root=root.canonicalize().unwrap();
        std::fs::write(root.join("config/cache/original.bin"),b"original bytes").unwrap();
        let manager=super::super::engine::DataStorageManager::open(root.join("config"),root.join("resources")).unwrap();
        let registry=Registry::default();let id=uuid::Uuid::new_v4().to_string();registry.begin(&id,"main",0,PreflightKind::Migration).unwrap();
        let claim=registry.claim(&id,"main",0,PreflightKind::Migration).unwrap();
        let preview=manager.prepare(root.join("target").canonicalize().unwrap(),vec![],"main",0).unwrap();
        claim.finish(Completion::Migration{operation_id:preview.operation_id,generation:0});drop(claim);
        registry.cancel(&id,"main",|_,running,completion|{assert!(!running);super::super::withdraw_preflight_preview(&manager,completion.unwrap());}).unwrap();
        assert!(manager.state().operation.is_none());assert_eq!(manager.state().data_access,"ready");
        assert!(manager.start(&preview.plan_token,"main",&mut |_|{}).is_err());
        assert_eq!(std::fs::read(root.join("config/cache/original.bin")).unwrap(),b"original bytes");
    }
    #[test]
    fn cancelled_resume_reverification_restores_the_previous_location() {
        let root=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-acceptance").join(uuid::Uuid::new_v4().to_string());
        for directory in ["config/cache","resources","target"]{std::fs::create_dir_all(root.join(directory)).unwrap();}
        let root=root.canonicalize().unwrap();std::fs::write(root.join("config/cache/original.bin"),vec![7;3*1024*1024]).unwrap();
        let manager=super::super::engine::DataStorageManager::open(root.join("config"),root.join("resources")).unwrap();
        let preview=manager.prepare(root.join("target").canonicalize().unwrap(),vec![],"main",0).unwrap();
        // 廉价判定按 identity+length 放行未变文件；改变长度使其在重验时走重哈希，才能测分块取消。
        let mut edited=vec![7;3*1024*1024];edited.push(1);std::fs::write(root.join("config/cache/original.bin"),&edited).unwrap();
        let registry=Registry::default();let id=uuid::Uuid::new_v4().to_string();registry.begin(&id,"main",0,PreflightKind::Migration).unwrap();
        let mut claim=registry.claim(&id,"main",0,PreflightKind::Migration).unwrap();claim.finish(Completion::Migration{operation_id:preview.operation_id.clone(),generation:0});
        let error=manager.requires_preparation_with_progress(&preview.operation_id,&mut |progress|{
            let cancel=progress.current_file_bytes>=1024*1024;
            claim.report(progress,|_|if cancel {registry.cancel(&id,"main",|_,_,completion|super::super::withdraw_preflight_preview(&manager,completion.unwrap())).unwrap();})
        }).unwrap_err();
        assert_eq!(error.code,"Cancelled");assert!(manager.state().operation.is_none());assert_eq!(manager.state().data_access,"ready");
        assert_eq!(std::fs::metadata(root.join("config/cache/original.bin")).unwrap().len(),3*1024*1024+1);
    }
}
