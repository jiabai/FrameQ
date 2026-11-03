#[path="location.rs"] mod location;
#[path="control.rs"] mod control;
#[path="inventory.rs"] mod inventory;
#[path="migration.rs"] mod migration;
#[path="merge.rs"] mod merge;
#[path="cleanup.rs"] mod cleanup;
#[path="owned_artifacts.rs"] mod owned_artifacts;
#[cfg(test)] #[path="tests.rs"] mod tests;
#[cfg(test)] #[path="merge_reading_tests.rs"] mod merge_reading_tests;

pub(crate) use location::{DataPaths,StorageError,StorageStateView,MigrationPreview,CleanupPreview,PreflightProgress,PreflightStage};
pub(crate) use control::paths_for_config;
use location::*;
use crate::safe_filesystem;
use std::{collections::HashMap,fs::{self,File},path::{Path,PathBuf},sync::{Arc,Mutex,Condvar,atomic::{AtomicBool,AtomicU64,Ordering}}};

pub(crate) struct DataStorageManager {
    config_root:PathBuf,resource_root:PathBuf,_process_lock:File,
    inner:Mutex<Inner>,drained:Condvar,cancelled:AtomicBool,boot_generation:AtomicU64,
}
struct Inner {control:Option<Control>,initial_error:Option<String>,active_count:u64,quiescing:bool,running:bool,restart_prepared:bool,cleanup_tokens:HashMap<String,(String,String,u64)>}
pub(crate) struct DataOperationPermit {manager:Arc<DataStorageManager>}
impl Drop for DataOperationPermit {fn drop(&mut self){let mut inner=self.manager.inner.lock().expect("storage mutex");inner.active_count-=1;self.manager.drained.notify_all();}}

pub(crate) fn create_safe_dirs(path:&Path)->location::Result<()> {
    if fs::symlink_metadata(path).is_ok() {safe_filesystem::validate_ancestors(path)?;return Ok(());}
    let parent=path.parent().ok_or_else(||StorageError::new("UnsafePath"))?;
    create_safe_dirs(parent)?;
    let guard=safe_filesystem::pin_directory(parent)?;
    match guard.create_dir(path.file_name().ok_or_else(||StorageError::new("UnsafePath"))?) {Ok(())=>{},Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>{},Err(e)=>return Err(e.into())}
    safe_filesystem::validate_ancestors(path)?;Ok(())
}
impl DataStorageManager {
    pub(crate) fn open(config_root:PathBuf,resource_root:PathBuf)->location::Result<Self> {
        create_safe_dirs(&config_root)?;
        let config_root=config_root.canonicalize()?;
        let lock_path=config_root.join(".data-storage.lock");
        if let Ok(meta)=fs::symlink_metadata(&lock_path) {if !meta.is_file()||crate::atomic_files::is_link_or_reparse_point(&meta){return Err(StorageError::new("UnsafePath"));}}
        let file=safe_filesystem::open_lock_file(&lock_path)?;
        file.try_lock().map_err(|_|StorageError::new("Busy"))?;
        let (value,error)=match control::load(&config_root) {
            Ok(Some(value))=>(Some(value),None),
            Ok(None)=>match control::legacy(&config_root) {
                Ok(active)=>{
                    let value=Control{schema_version:1,active,pending:None,cleanup_receipts:vec![],cancelled_copy_refs:vec![]};
                    control::save(&config_root,&value)?;(Some(value),None)
                },Err(e)=>(None,Some(e.code)),
            },Err(e)=>(None,Some(e.code)),
        };
        let mut value=value;
        if let Some(value)=value.as_mut(){if let Some(p)=value.pending.as_mut(){if p.phase=="restart_required"{p.phase="validating".into();p.files_completed=0;p.bytes_completed=0;control::save(&config_root,value)?;}}}
        let generation=value.as_ref().map_or(0,|c|c.active.generation);
        Ok(Self{config_root,resource_root,_process_lock:file,inner:Mutex::new(Inner{control:value,initial_error:error,active_count:0,quiescing:false,running:false,restart_prepared:false,cleanup_tokens:HashMap::new()}),drained:Condvar::new(),cancelled:AtomicBool::new(false),boot_generation:AtomicU64::new(generation)})
    }
    pub(crate) fn reload_invalid_control(&self)->location::Result<StorageStateView> {
        let mut inner=self.inner.lock().expect("storage mutex");
        if inner.control.is_some(){drop(inner);return Ok(self.state());}
        if inner.active_count!=0||inner.running||inner.quiescing||inner.restart_prepared{return Err(StorageError::new("Busy"));}
        let mut value=control::load(&self.config_root)?.ok_or_else(||StorageError::new("ControlInvalid"))?;
        if let Some(p)=value.pending.as_mut(){if p.phase=="restart_required"{p.phase="validating".into();p.files_completed=0;p.bytes_completed=0;control::save(&self.config_root,&value)?;}}
        self.boot_generation.store(value.active.generation,Ordering::Release);inner.control=Some(value);inner.initial_error=None;drop(inner);Ok(self.state())
    }
    pub(crate) fn acquire(self:&Arc<Self>)->location::Result<DataOperationPermit> {
        let mut inner=self.inner.lock().expect("storage mutex");
        let value=inner.control.as_ref().ok_or_else(||StorageError::new(inner.initial_error.as_deref().unwrap_or("ControlInvalid")))?;
        if inner.quiescing||inner.running||value.pending.is_some(){return Err(StorageError::new("Busy"));}
        validate_active(&value.active)?;
        inner.active_count+=1;
        Ok(DataOperationPermit{manager:Arc::clone(self)})
    }
    pub(crate) fn cancellation_requested(&self)->bool {self.cancelled.load(Ordering::Acquire)}
    fn reset_preparation_cancel(&self)->location::Result<()> {
        let inner=self.inner.lock().expect("storage mutex");
        if inner.running||inner.quiescing||inner.restart_prepared{return Err(StorageError::new("Busy"));}
        self.cancelled.store(false,Ordering::Release);Ok(())
    }
    pub(crate) fn signal_preparation_cancel(&self) {let inner=self.inner.lock().expect("storage mutex");if inner.control.as_ref().and_then(|value|value.pending.as_ref()).is_some_and(|pending|matches!(pending.phase.as_str(),"merging"|"publishing"|"restart_required"|"validating"|"cleaning")){return;}self.cancelled.store(true,Ordering::Release);self.drained.notify_all();}
    pub(crate) fn waiting_preparation_id(&self,window:&str,generation:u64,target:Option<&Path>)->Option<String> {
        let inner=self.inner.lock().expect("storage mutex");let value=inner.control.as_ref()?;
        let pending=value.pending.as_ref()?;
        (value.active.generation==generation&&pending.window_id==window&&pending.phase=="waiting"&&target.is_none_or(|target|pending.target==target)).then(||pending.operation_id.clone())
    }
    pub(crate) fn state(&self)->StorageStateView {
        let inner=self.inner.lock().expect("storage mutex");
        let Some(value)=inner.control.as_ref() else {return StorageStateView{schema_version:1,generation:0,data_access:"unavailable".into(),mode:"legacy".into(),current_path:display(&self.config_root),legacy_output_path:None,operation:None,cleanup_receipts:vec![],recovery_candidates:vec![],last_error:inner.initial_error.clone()};};
        let active_error=validate_active(&value.active).err().map(|e|e.code);
        let pending=value.pending.as_ref();
        let access=if active_error.is_some(){"unavailable"}else if let Some(p)=pending {
            if p.phase=="restart_required" {"restart_required"}else if inner.running||inner.quiescing||p.phase=="validating" {"quiescing"}else {"recovery_required"}
        } else if inner.quiescing {"quiescing"}else{"ready"};
        StorageStateView{schema_version:1,generation:value.active.generation,data_access:access.into(),mode:value.active.mode.clone(),current_path:display(&value.active.data_root),legacy_output_path:value.active.legacy_output_root.as_deref().map(display),
            operation:pending.map(|p|OperationView{operation_id:p.operation_id.clone(),merge:p.merge,phase:p.phase.clone(),source_paths:vec![display(&p.previous.data_root)],target_path:display(&p.target),total_files:p.files_total,total_bytes:p.bytes_total,completed_files:p.files_completed,completed_bytes:p.bytes_completed,can_cancel:if p.phase=="cleaning"{!inner.running}else{!matches!(p.phase.as_str(),"merging"|"publishing"|"restart_required"|"validating")},can_resume:!inner.running,last_error:p.last_error.clone()}),
            cleanup_receipts:value.cleanup_receipts.iter().map(|r|CleanupReceiptView{receipt_id:r.operation_id.clone(),source_paths:r.source_paths.iter().map(|p|display(p)).collect(),total_files:r.total_files,total_bytes:r.total_bytes}).collect(),
            recovery_candidates:value.cancelled_copy_refs.iter().map(|p|OperationView{operation_id:p.operation_id.clone(),merge:p.merge,phase:"cancelled".into(),source_paths:vec![display(&p.previous.data_root)],target_path:display(&p.target),total_files:p.files_total,total_bytes:p.bytes_total,completed_files:p.files_completed,completed_bytes:p.bytes_completed,can_cancel:false,can_resume:p.previous.generation==value.active.generation&&p.previous.root_identity==value.active.root_identity,last_error:p.last_error.clone()}).collect(),last_error:active_error.or_else(||inner.initial_error.clone())}
    }
    fn snapshot(&self)->location::Result<Control> {let inner=self.inner.lock().expect("storage mutex");inner.control.clone().ok_or_else(||StorageError::new(inner.initial_error.as_deref().unwrap_or("ControlInvalid")))}
    fn persist(&self,value:&Control)->location::Result<()> {let mut inner=self.inner.lock().expect("storage mutex");if inner.restart_prepared{return Err(StorageError::new("Busy"));}if value.pending.as_ref().is_some_and(|p|matches!(p.phase.as_str(),"merging"|"publishing"))&&inner.control.as_ref().and_then(|v|v.pending.as_ref()).is_some_and(|p|!matches!(p.phase.as_str(),"merging"|"publishing"))&&self.cancelled.load(Ordering::Acquire){return Err(StorageError::new("Cancelled"));}control::save(&self.config_root,value)?;inner.control=Some(value.clone());Ok(())}
    fn wait_exclusive(&self)->location::Result<()> {
        let mut inner=self.inner.lock().expect("storage mutex");
        if inner.running||inner.quiescing {return Err(StorageError::new("Busy"));}
        inner.quiescing=true;
        while inner.active_count>0 {if self.cancelled.load(Ordering::Acquire){inner.quiescing=false;return Err(StorageError::new("Cancelled"));}inner=self.drained.wait(inner).expect("storage mutex");if self.cancelled.load(Ordering::Acquire){inner.quiescing=false;return Err(StorageError::new("Cancelled"));}}
        inner.running=true;Ok(())
    }
    fn release_exclusive(&self){let mut inner=self.inner.lock().expect("storage mutex");inner.running=false;inner.quiescing=false;self.drained.notify_all();}
    fn record_error(&self,error:&StorageError){if let Ok(mut value)=self.snapshot(){if let Some(p)=value.pending.as_mut(){p.last_error=Some(error.code.clone());let _=self.persist(&value);}}}
    pub(crate) fn prepare(&self,target:PathBuf,legacy_sources:Vec<PathBuf>,window_id:&str,expected_generation:u64)->location::Result<MigrationPreview> {
        self.reset_preparation_cancel()?;let _target_guard=self.announce_waiting(&target,&legacy_sources,window_id,expected_generation)?;self.wait_exclusive()?;
        let mut result=self.prepare_inner(target,legacy_sources,window_id,expected_generation,None,&mut |_|Ok(()));
        if let Err(e)=&result {if e.code=="Cancelled"{if let Err(e)=self.finish_cancel(){result=Err(e);}}else{self.record_error(e);}}
        self.release_exclusive();result
    }
    pub(crate) fn prepare_with_validation(&self,target:PathBuf,legacy_sources:Vec<PathBuf>,window_id:&str,generation:u64,before_inventory:&mut dyn FnMut()->location::Result<()>,validator:&mut dyn FnMut(&DataPaths,&[PathBuf])->location::Result<serde_json::Value>)->location::Result<MigrationPreview> {
        self.prepare_with_validation_and_progress(target,legacy_sources,window_id,generation,before_inventory,validator,&mut |_|Ok(()))
    }
    pub(crate) fn prepare_with_validation_and_progress(&self,target:PathBuf,legacy_sources:Vec<PathBuf>,window_id:&str,generation:u64,before_inventory:&mut dyn FnMut()->location::Result<()>,validator:&mut dyn FnMut(&DataPaths,&[PathBuf])->location::Result<serde_json::Value>,observer:&mut dyn FnMut(PreflightProgress)->location::Result<()>)->location::Result<MigrationPreview> {
        self.reset_preparation_cancel()?;observer(PreflightProgress::stage(PreflightStage::Waiting))?;
        let _target_guard=self.announce_waiting(&target,&legacy_sources,window_id,generation)?;
        let mut acquired=false;
        let mut result=(||{self.wait_exclusive()?;acquired=true;if self.cancelled.load(Ordering::Acquire){return Err(StorageError::new("Cancelled"));}observer(PreflightProgress::stage(PreflightStage::SourceValidation))?;before_inventory()?;self.prepare_inner(target,legacy_sources,window_id,generation,Some(validator),observer)})();
        if let Err(e)=&result {if e.code=="Cancelled"{if let Err(e)=self.finish_cancel(){result=Err(e);}}else{self.record_error(e);}}
        if acquired{self.release_exclusive();}result
    }
    pub(crate) fn resume_preparation(&self,operation_id:&str,generation:u64,window_id:&str,legacy_sources:Option<Vec<PathBuf>>,before_inventory:&mut dyn FnMut()->location::Result<()>,validator:&mut dyn FnMut(&DataPaths,&[PathBuf])->location::Result<serde_json::Value>)->location::Result<MigrationPreview> {
        self.resume_preparation_with_progress(operation_id,generation,window_id,legacy_sources,before_inventory,validator,&mut |_|Ok(()))
    }
    pub(crate) fn resume_preparation_with_progress(&self,operation_id:&str,generation:u64,window_id:&str,legacy_sources:Option<Vec<PathBuf>>,before_inventory:&mut dyn FnMut()->location::Result<()>,validator:&mut dyn FnMut(&DataPaths,&[PathBuf])->location::Result<serde_json::Value>,observer:&mut dyn FnMut(PreflightProgress)->location::Result<()>)->location::Result<MigrationPreview> {
        self.reset_preparation_cancel()?;observer(PreflightProgress::stage(PreflightStage::Waiting))?;self.wait_exclusive()?;
        let mut result=(||{let mut value=self.snapshot()?;
        if value.active.generation!=generation{return Err(StorageError::new("StaleOperation"));}
        if value.pending.is_none(){let position=value.cancelled_copy_refs.iter().position(|p|p.operation_id==operation_id).ok_or_else(||StorageError::new("StaleOperation"))?;value.pending=Some(value.cancelled_copy_refs.remove(position));}
        let old=value.pending.as_ref().ok_or_else(||StorageError::new("StaleOperation"))?;
        if old.operation_id!=operation_id||old.previous.generation!=generation||old.previous.root_identity!=value.active.root_identity{return Err(StorageError::new("StaleOperation"));}
        if old.phase!="waiting"||!old.owned_artifacts.is_empty()||old.previous.data_root!=value.active.data_root {
            if !["waiting","prepared","copying","verifying"].contains(&old.phase.as_str()){return Err(StorageError::new("Busy"));}
            let old=value.pending.take().unwrap();let old_root=old.previous.data_root.clone();let mut pending=old.clone();value.cancelled_copy_refs.push(old);
            pending.operation_id=uuid::Uuid::new_v4().to_string();pending.phase="waiting".into();pending.previous=value.active.clone();pending.inventory_hash.clear();pending.source_relocations.clear();pending.plan_token=uuid::Uuid::new_v4().to_string();pending.files_total=0;pending.bytes_total=0;pending.files_completed=0;pending.bytes_completed=0;pending.last_error=None;pending.owned_artifacts.clear();for source in &mut pending.legacy_sources{if let Ok(relative)=source.strip_prefix(&old_root){*source=value.active.data_root.join(relative);}}value.pending=Some(pending);
        }
        let p=value.pending.as_mut().ok_or_else(||StorageError::new("StaleOperation"))?;
        if p.phase!="waiting"{return Err(StorageError::new("StaleOperation"));}
        p.window_id=window_id.into();if let Some(sources)=legacy_sources{p.legacy_sources=sources;}let target=p.target.clone();let sources=p.legacy_sources.clone();let _target_guard=safe_filesystem::open_directory(&target)?;self.persist(&value)?;
        if self.cancelled.load(Ordering::Acquire){return Err(StorageError::new("Cancelled"));}observer(PreflightProgress::stage(PreflightStage::SourceValidation))?;before_inventory()?;self.prepare_inner(target,sources,window_id,generation,Some(validator),observer)})();
        if let Err(e)=&result {if e.code=="Cancelled"{if let Err(e)=self.finish_cancel(){result=Err(e);}}else{self.record_error(e);}}self.release_exclusive();result
    }
    pub(crate) fn start(&self,plan_token:&str,window_id:&str,progress:&mut dyn FnMut(StorageStateView))->location::Result<StorageStateView> {
        self.start_with_preflight(plan_token,window_id,progress,&mut |_|Ok(()))
    }
    pub(crate) fn start_with_preflight(&self,plan_token:&str,window_id:&str,progress:&mut dyn FnMut(StorageStateView),observer:&mut dyn FnMut(PreflightProgress)->location::Result<()>)->location::Result<StorageStateView> {
        self.reset_preparation_cancel()?;observer(PreflightProgress::stage(PreflightStage::Waiting))?;self.wait_exclusive()?;
        let mut result=self.start_inner_with_preflight(plan_token,window_id,progress,observer);
        if let Err(e)=&result {if e.code=="Cancelled"{if let Err(e)=self.finish_cancel(){result=Err(e);}}else{self.record_error(e);}}
        self.release_exclusive();result
    }
    pub(crate) fn cancel(&self,operation_id:&str,expected_generation:u64)->location::Result<StorageStateView> {
        let mut inner=self.inner.lock().expect("storage mutex");if inner.restart_prepared{return Err(StorageError::new("Busy"));}let mut value=inner.control.clone().ok_or_else(||StorageError::new("ControlInvalid"))?;let pending=value.pending.as_ref().ok_or_else(||StorageError::new("StaleOperation"))?;
        if pending.operation_id!=operation_id||value.active.generation!=expected_generation{return Err(StorageError::new("StaleOperation"));}
        if matches!(pending.phase.as_str(),"merging"|"publishing"|"restart_required"|"validating"|"cleaning"){return Err(StorageError::new("Busy"));}
        self.cancelled.store(true,Ordering::Release);self.drained.notify_all();
        if !inner.running {if let Some(p)=value.pending.take(){value.cancelled_copy_refs.push(p);}control::save(&self.config_root,&value)?;inner.control=Some(value);}
        drop(inner);
        Ok(self.state())
    }
    fn finish_cancel(&self)->location::Result<()> {
        let mut value=self.snapshot()?;
        if let Some(p)=value.pending.take(){if matches!(p.phase.as_str(),"merging"|"publishing"|"restart_required"|"validating"|"cleaning"){return Err(StorageError::new("Busy"));}value.cancelled_copy_refs.push(p);}
        self.persist(&value)
    }
    pub(crate) fn resume(&self,operation_id:&str,expected_generation:u64,window_id:&str,progress:&mut dyn FnMut(StorageStateView))->location::Result<StorageStateView> {
        self.resume_with_preflight(operation_id,expected_generation,window_id,progress,&mut |_|Ok(()))
    }
    pub(crate) fn resume_with_preflight(&self,operation_id:&str,expected_generation:u64,window_id:&str,progress:&mut dyn FnMut(StorageStateView),observer:&mut dyn FnMut(PreflightProgress)->location::Result<()>)->location::Result<StorageStateView> {
        observer(PreflightProgress::stage(PreflightStage::Waiting))?;
        let mut value=self.snapshot()?;
        if value.active.generation!=expected_generation{return Err(StorageError::new("StaleOperation"));}
        if value.pending.is_none(){
            let position=value.cancelled_copy_refs.iter().position(|p|p.operation_id==operation_id).ok_or_else(||StorageError::new("StaleOperation"))?;
            let mut p=value.cancelled_copy_refs.remove(position);p.window_id=window_id.into();value.pending=Some(p);self.persist(&value)?;
        }
        let p=value.pending.as_ref().ok_or_else(||StorageError::new("StaleOperation"))?;
        if p.operation_id!=operation_id{return Err(StorageError::new("StaleOperation"));}
        if p.phase=="cleaning"{return self.resume_cleanup(operation_id,window_id,progress);}
        if matches!(p.phase.as_str(),"restart_required"|"validating"){return self.recheck();}
        if p.phase=="prepared"{return Ok(self.state());}
        if p.phase=="waiting"{
            let target=p.target.clone();let sources=p.legacy_sources.clone();
            if p.window_id!=window_id {value.pending.as_mut().unwrap().window_id=window_id.into();self.persist(&value)?;}
            self.prepare(target,sources,window_id,expected_generation)?;return Ok(self.state());
        }
        let token=p.plan_token.clone();
        if p.window_id!=window_id {let mut value=value;value.pending.as_mut().unwrap().window_id=window_id.into();self.persist(&value)?;}
        self.start_with_preflight(&token,window_id,progress,observer)
    }
    pub(crate) fn recheck(&self)->location::Result<StorageStateView> {self.recheck_inner(None)}
    pub(crate) fn recheck_with_validator(&self,validator:&mut dyn FnMut(&DataPaths,&serde_json::Value)->location::Result<()>)->location::Result<StorageStateView> {self.recheck_inner(Some(validator))}
    #[cfg(test)]
    pub(crate) fn can_restart(&self)->bool {
        let inner=self.inner.lock().expect("storage mutex");
        if inner.running||inner.quiescing||inner.active_count!=0||inner.initial_error.is_some(){return false;}
        match inner.control.as_ref().and_then(|v|v.pending.as_ref()) {None=>inner.control.as_ref().is_some_and(|v|validate_active(&v.active).is_ok()),Some(p)=>p.phase=="restart_required"}
    }
    pub(crate) fn prepare_restart(&self)->location::Result<()> {
        let mut inner=self.inner.lock().expect("storage mutex");
        if inner.running||inner.quiescing||inner.active_count!=0||inner.initial_error.is_some(){return Err(StorageError::new("Busy"));}
        let value=inner.control.as_ref().ok_or_else(||StorageError::new("ControlInvalid"))?;validate_active(&value.active)?;
        if value.pending.as_ref().is_some_and(|p|p.phase!="restart_required"){return Err(StorageError::new("Busy"));}
        inner.quiescing=true;inner.restart_prepared=true;
        if let Err(e)=self._process_lock.unlock(){inner.quiescing=false;inner.restart_prepared=false;return Err(e.into());}
        Ok(())
    }
    pub(crate) fn prepare_close(&self)->location::Result<()> {
        let mut inner=self.inner.lock().expect("storage mutex");
        if inner.running||inner.quiescing||inner.active_count!=0||inner.restart_prepared{return Err(StorageError::new("Busy"));}
        if inner.control.as_ref().and_then(|v|v.pending.as_ref()).is_some_and(|p|!["restart_required","validating","publishing","merging"].contains(&p.phase.as_str())){return Err(StorageError::new("Busy"));}
        inner.quiescing=true;inner.restart_prepared=true;Ok(())
    }
    pub(crate) fn can_close(&self)->bool {let inner=self.inner.lock().expect("storage mutex");!inner.running&&!inner.quiescing&&inner.active_count==0}
    pub(crate) fn requires_preparation(&self,operation_id:&str)->bool {self.snapshot().is_ok_and(|v|v.pending.iter().chain(v.cancelled_copy_refs.iter()).any(|p|p.operation_id==operation_id&&(p.phase=="waiting"||["prepared","copying","verifying"].contains(&p.phase.as_str())&&(p.previous.data_root!=v.active.data_root||p.last_error.as_deref()==Some("SourceChanged")||inventory::read(&p.target,p).and_then(|inventory|inventory::verify_sources_cancellable(&inventory,None)).is_err_and(|e|e.code=="SourceChanged")))))}
    pub(crate) fn requires_preparation_with_progress(&self,operation_id:&str,observer:&mut dyn FnMut(PreflightProgress)->location::Result<()>)->location::Result<bool> {
        self.reset_preparation_cancel()?;observer(PreflightProgress::stage(PreflightStage::Waiting))?;
        let value=self.snapshot()?;
        let pending=value.pending.iter().chain(value.cancelled_copy_refs.iter()).find(|pending|pending.operation_id==operation_id).ok_or_else(||StorageError::new("StaleOperation"))?;
        if pending.phase=="waiting"{return Ok(true);}
        if !["prepared","copying","verifying"].contains(&pending.phase.as_str()){return Ok(false);}
        if pending.previous.data_root!=value.active.data_root||pending.last_error.as_deref()==Some("SourceChanged"){return Ok(true);}
        let inventory=inventory::read(&pending.target,pending)?;
        match inventory::verify_sources_with_progress(&inventory,Some(&self.cancelled),observer) {
            Ok(())=>Ok(false),Err(error)if error.code=="SourceChanged"=>Ok(true),Err(error)=>Err(error),
        }
    }
    pub(crate) fn relink(&self,path:PathBuf,expected_generation:u64)->location::Result<StorageStateView> {
        self.wait_exclusive()?;
        let result=(||{let mut value=self.snapshot()?;if value.active.generation!=expected_generation{return Err(StorageError::new("StaleOperation"));}
            let path=path.canonicalize()?;let _new_root=safe_filesystem::open_directory(&path)?;safe_filesystem::check_identity(&path,value.active.root_identity)?;
            let old_root=value.active.data_root.clone();if path==old_root{return Ok(self.state());}let mut active=value.active.clone();active.data_root=path.clone();if let Some(output)=active.legacy_output_root.as_mut(){if let Ok(relative)=output.strip_prefix(&old_root){*output=path.join(relative);}}validate_active(&active)?;
            if let Some(mut p)=value.pending.take(){
                match p.phase.as_str(){
                    "restart_required"|"validating"|"cleaning"=>{p.target=path.clone();if p.phase=="cleaning"{p.previous=active.clone();}value.pending=Some(p);},
                    "publishing"|"merging"=>{
                        p.source_relocations.push(SourceRelocation{old_root:old_root.clone(),new_root:path.clone(),root_identity:active.root_identity});p.previous=active.clone();
                        let resolved=inventory::read(&p.target,&p)?;if !p.merge{inventory::verify_sources_cancellable(&resolved,None)?;}value.pending=Some(p);
                    },
                    "waiting"|"prepared"|"copying"|"verifying"=>{
                        let mut fresh=p.clone();value.cancelled_copy_refs.push(p);fresh.operation_id=uuid::Uuid::new_v4().to_string();fresh.phase="waiting".into();fresh.previous=active.clone();fresh.inventory_hash.clear();fresh.plan_token=uuid::Uuid::new_v4().to_string();fresh.files_total=0;fresh.bytes_total=0;fresh.files_completed=0;fresh.bytes_completed=0;fresh.last_error=None;fresh.owned_artifacts.clear();fresh.source_relocations.clear();
                        for source in &mut fresh.legacy_sources{if let Ok(relative)=source.strip_prefix(&old_root){*source=path.join(relative);}}value.pending=Some(fresh);
                    },_=>return Err(StorageError::new("ControlInvalid")),
                }
            }
            value.active=active;self.persist(&value)?;Ok(self.state())})();
        self.release_exclusive();result.map(|_|self.state())
    }
}
