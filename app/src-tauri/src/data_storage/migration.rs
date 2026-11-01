use super::{control,inventory::{self,Inventory,Entry},location::*,DataStorageManager,create_safe_dirs};
use crate::safe_filesystem;
use std::{fs::{self,OpenOptions},io::{Read,Write},path::{Path,PathBuf},sync::atomic::Ordering};
use sha2::{Digest,Sha256};

impl DataStorageManager {
    pub(super) fn announce_waiting(&self,target:&Path,sources:&[PathBuf],window_id:&str,generation:u64)->Result<std::fs::File> {
        safe_filesystem::validate_ancestors(target)?;let target=target.canonicalize()?;let guard=safe_filesystem::open_directory(&target)?;let target_identity=safe_filesystem::file_identity(&guard)?;
        let mut inner=self.inner.lock().expect("storage mutex");if inner.running||inner.quiescing||inner.restart_prepared{return Err(StorageError::new("Busy"));}
        let mut value=inner.control.clone().ok_or_else(||StorageError::new("ControlInvalid"))?;
        if value.active.generation!=generation{return Err(StorageError::new("StaleOperation"));}validate_active(&value.active)?;
        if let Some(p)=value.pending.as_ref(){if p.phase!="waiting"||p.target!=target||p.target_identity!=target_identity||p.window_id!=window_id{return Err(StorageError::new("StaleOperation"));}return Ok(guard);}
        if fs::read_dir(&target)?.next().is_some(){return Err(StorageError::new("TargetConflict"));}
        let mut roots=vec![value.active.data_root.clone(),self.resource_root.clone()];roots.extend(sources.iter().cloned());if let Some(root)=&value.active.legacy_output_root{if root.is_absolute(){roots.push(root.clone());}}
        for root in roots{let root=if root.exists(){root.canonicalize()?}else{root};if target.starts_with(&root)||root.starts_with(&target){return Err(StorageError::new("UnsafePath"));}}
        value.pending=Some(Pending{operation_id:uuid::Uuid::new_v4().to_string(),phase:"waiting".into(),previous:value.active.clone(),target,target_identity,inventory_hash:String::new(),plan_token:uuid::Uuid::new_v4().to_string(),window_id:window_id.into(),files_total:0,bytes_total:0,files_completed:0,bytes_completed:0,last_error:None,legacy_sources:sources.to_vec(),owned_artifacts:vec![],source_relocations:vec![]});
        control::save(&self.config_root,&value)?;inner.control=Some(value);Ok(guard)
    }
    pub(super) fn prepare_inner(&self,target:PathBuf,legacy_sources:Vec<PathBuf>,window_id:&str,generation:u64,mut validator:Option<&mut dyn FnMut(&DataPaths,&[PathBuf])->Result<serde_json::Value>>)->Result<MigrationPreview> {
        if self.cancelled.load(Ordering::Acquire){return Err(StorageError::new("Cancelled"));}
        let mut value=self.snapshot()?;
        if value.active.generation!=generation{return Err(StorageError::new("StaleOperation"));}
        validate_active(&value.active)?;
        if self.config_root.join(".frameq-note-deletion.json").exists(){return Err(StorageError::new("Busy"));}
        safe_filesystem::validate_ancestors(&target)?;
        let target=target.canonicalize()?;let target_identity=safe_filesystem::identity(&target)?;
        let _target_guard=safe_filesystem::open_directory(&target)?;
        let previous_waiting=value.pending.as_ref().filter(|p|p.phase=="waiting"&&p.target==target&&p.window_id==window_id).cloned();
        if value.pending.is_some()&&previous_waiting.is_none(){return Err(StorageError::new("StaleOperation"));}
        if fs::read_dir(&target)?.next().is_some()&&previous_waiting.is_none(){return Err(StorageError::new("TargetConflict"));}
        let mut roots=vec![value.active.data_root.clone(),self.resource_root.clone()];
        if let Some(root)=&value.active.legacy_output_root {if root.is_absolute(){roots.push(root.clone());}}
        roots.extend(legacy_sources.iter().cloned());
        for root in &roots {
            let root=if root.exists(){root.canonicalize()?}else{root.clone()};
            if target.starts_with(&root)||root.starts_with(&target){return Err(StorageError::new("UnsafePath"));}
        }
        let id=previous_waiting.as_ref().map_or_else(||uuid::Uuid::new_v4().to_string(),|p|p.operation_id.clone());
        self.recover_owned_artifacts(&mut value)?;
        value.pending=Some(Pending{operation_id:id.clone(),phase:"waiting".into(),previous:value.active.clone(),target:target.clone(),target_identity,inventory_hash:String::new(),plan_token:uuid::Uuid::new_v4().to_string(),window_id:window_id.into(),files_total:0,bytes_total:0,files_completed:0,bytes_completed:0,last_error:None,legacy_sources:legacy_sources.clone(),owned_artifacts:vec![],source_relocations:vec![]});
        self.persist(&value)?;
        recover_task_transactions(&value.active,&legacy_sources)?;
        let estimate=inventory::estimate(&value.active,&legacy_sources,&value.cleanup_receipts,Some(&self.cancelled))?;
        check_space(&target,&self.config_root,&estimate)?;
        let mut output_sources=vec![value.active.data_root.join("outputs")];output_sources.extend(legacy_sources.iter().cloned());if let Some(root)=value.active.legacy_output_root.as_ref(){if root.is_absolute(){output_sources.push(root.clone());}}
        let validation=match validator.as_mut(){Some(capture)=>capture(&DataPaths::from_active(&value.active),&output_sources)?,None=>serde_json::Value::Null};
        let mut inventory=inventory::build_cancellable(&value.active,&legacy_sources,&value.cleanup_receipts,Some(&self.cancelled))?;inventory.validation=validation;
        if self.cancelled.load(Ordering::Acquire){return Err(StorageError::new("Cancelled"));}
        let (required,available)=check_space(&target,&self.config_root,&inventory)?;
        safe_filesystem::check_identity(&target,target_identity)?;
        let meta=target.join(".frameq-storage");
        if meta.exists(){
            if previous_waiting.is_none()||fs::read_dir(&target)?.any(|v|v.map(|v|v.file_name()!=".frameq-storage").unwrap_or(true)){return Err(StorageError::new("TargetConflict"));}
            safe_filesystem::validate_ancestors(&meta)?;
        } else {fs::create_dir(&meta).map_err(|e|if e.kind()==std::io::ErrorKind::AlreadyExists{StorageError::new("TargetConflict")}else{e.into()})?;}
        let operation=meta.join("operations").join(&id);create_safe_dirs(&operation)?;
        let probe_root=self.create_owned_artifact(&mut value,"probe",None)?;
        let probe_guard=safe_filesystem::pin_directory(&probe_root)?;
        probe(&probe_root)?;
        probe_destination_names(&probe_root,&inventory)?;
        drop(probe_guard);
        self.recover_owned_artifacts(&mut value)?;
        let pending=Pending{operation_id:id.clone(),phase:"prepared".into(),previous:value.active.clone(),target:target.clone(),target_identity,
            inventory_hash:inventory::digest(&inventory)?,plan_token:uuid::Uuid::new_v4().to_string(),window_id:window_id.into(),files_total:inventory.total_files,bytes_total:inventory.total_bytes,files_completed:0,bytes_completed:0,last_error:None,legacy_sources,owned_artifacts:vec![],source_relocations:vec![]};
        value.pending.as_mut().unwrap().inventory_hash=inventory::digest(&inventory)?;self.persist(&value)?;
        self.write_target_json(&mut value,&inventory::inventory_path(&target,&id),&inventory,inventory::MAX_INVENTORY)?;
        let preview=MigrationPreview{plan_token:pending.plan_token.clone(),operation_id:id,generation,source_paths:inventory.sources.iter().map(|s|display(&s.path)).collect(),target_path:display(&target),total_files:inventory.total_files,total_bytes:inventory.total_bytes,required_bytes:required,available_bytes:available};
        if self.cancelled.load(Ordering::Acquire){return Err(StorageError::new("Cancelled"));}value.pending=Some(pending);self.persist(&value)?;Ok(preview)
    }
    pub(super) fn start_inner(&self,token:&str,window:&str,progress:&mut dyn FnMut(StorageStateView))->Result<StorageStateView> {
        let mut value=self.snapshot()?;
        let mut pending=value.pending.clone().ok_or_else(||StorageError::new("StaleOperation"))?;
        if pending.plan_token!=token||pending.window_id!=window||!matches!(pending.phase.as_str(),"prepared"|"copying"|"verifying"|"publishing") {return Err(StorageError::new("StaleOperation"));}
        safe_filesystem::check_identity(&pending.target,pending.target_identity)?;
        validate_active(&pending.previous)?;
        let _target_guard=safe_filesystem::open_directory(&pending.target)?;
        let lock=safe_filesystem::open_lock_file(&pending.target.join(".frameq-storage/operation.lock"))?;
        lock.try_lock().map_err(|_|StorageError::new("Busy"))?;
        let inventory=inventory::read(&pending.target,&pending)?;
        inventory::verify_sources_cancellable(&inventory,Some(&self.cancelled))?;
        validate_operation_namespace(&pending.target,&pending,&value.cleanup_receipts,&value.cancelled_copy_refs,&inventory)?;
        let payload=inventory::payload_path(&pending.target,&pending.operation_id);create_safe_dirs(&payload)?;
        check_resume_space(&pending.target,&self.config_root,&payload,&inventory,pending.phase=="publishing",&self.cancelled)?;
        if pending.phase!="publishing" {
            pending.phase="copying".into();pending.files_completed=0;pending.bytes_completed=0;pending.last_error=None;
            value.pending=Some(pending.clone());self.persist(&value)?;progress(self.state());
            for entry in inventory::unique_entries(&inventory) {
                if self.cancelled.load(Ordering::Acquire){self.finish_cancel()?;return Err(StorageError::new("Cancelled"));}
                let destination=payload.join(&entry.destination);
                if entry.directory {create_safe_dirs(&destination)?;continue;}
                let base=pending.bytes_completed;
                copy_entry(entry,&destination,&pending.target.join(".frameq-storage/operations").join(&pending.operation_id).join("partial"),&self.cancelled,&mut |bytes|{
                    pending.bytes_completed=base+bytes;value.pending=Some(pending.clone());self.persist(&value)?;progress(self.state());Ok(())
                })?;
                pending.files_completed+=1;pending.bytes_completed=base+entry.length;value.pending=Some(pending.clone());self.persist(&value)?;progress(self.state());
            }
            pending.phase="verifying".into();pending.files_completed=0;pending.bytes_completed=0;value.pending=Some(pending.clone());self.persist(&value)?;progress(self.state());
            restore_directory_permissions(&payload,&inventory)?;
            self.verify_destination(&inventory,&payload,&mut value,&mut pending,Some(progress))?;
            inventory::verify_sources_cancellable(&inventory,Some(&self.cancelled))?;
            if self.cancelled.load(Ordering::Acquire){self.finish_cancel()?;return Err(StorageError::new("Cancelled"));}
            validate_operation_namespace(&pending.target,&pending,&value.cleanup_receipts,&value.cancelled_copy_refs,&inventory)?;
            pending.phase="publishing".into();value.pending=Some(pending.clone());self.persist(&value)?;progress(self.state());
        }
        validate_operation_namespace(&pending.target,&pending,&value.cleanup_receipts,&value.cancelled_copy_refs,&inventory)?;
        publish(&pending.target,&payload,&inventory)?;
        verify_published(&pending.target,&inventory)?;
        let generation=pending.previous.generation.checked_add(1).ok_or_else(||StorageError::new("ControlLimit"))?;
        let marker=StoreMarker{schema_version:1,library_id:pending.previous.library_id.clone(),generation,root_identity:pending.target_identity};
        self.write_target_json(&mut value,&pending.target.join(".frameq-storage/store.json"),&marker,64*1024)?;
        let receipt_dir=pending.target.join(".frameq-storage/receipts").join(&pending.operation_id);create_safe_dirs(&receipt_dir)?;
        let receipt_path=receipt_dir.join("inventory.json");
        self.write_target_json(&mut value,&receipt_path,&inventory,inventory::MAX_INVENTORY)?;
        let reference=ReceiptRef{operation_id:pending.operation_id.clone(),relative_path:receipt_path.strip_prefix(&pending.target).map_err(|_|StorageError::new("UnsafePath"))?.into(),sha256:inventory::digest(&inventory)?,source_paths:inventory.sources.iter().map(|s|s.path.clone()).collect(),total_files:inventory.total_files,total_bytes:inventory.total_bytes};
        value.active=ActiveStorage{mode:"managed".into(),library_id:pending.previous.library_id.clone(),generation,data_root:pending.target.clone(),root_identity:pending.target_identity,legacy_output_root:None};
        if !value.cleanup_receipts.iter().any(|r|r.operation_id==reference.operation_id){value.cleanup_receipts.push(reference);}
        pending.phase="restart_required".into();pending.files_completed=pending.files_total;pending.bytes_completed=pending.bytes_total;pending.last_error=None;value.pending=Some(pending);
        self.persist(&value)?;progress(self.state());Ok(self.state())
    }
    pub(crate) fn pending_preview(&self,window_id:&str)->Result<MigrationPreview> {
        self.cancelled.store(false,Ordering::Release);self.wait_exclusive()?;
        let mut result=self.pending_preview_inner(window_id);
        if let Err(e)=&result {if e.code=="Cancelled" {if let Err(e)=self.finish_cancel(){result=Err(e);}}else{self.record_error(e);}}
        self.release_exclusive();result
    }
    fn pending_preview_inner(&self,window_id:&str)->Result<MigrationPreview> {
        let mut value=self.snapshot()?;let p=value.pending.as_mut().ok_or_else(||StorageError::new("StaleOperation"))?;
        if p.phase!="prepared"{return Err(StorageError::new("StaleOperation"));}
        safe_filesystem::check_identity(&p.target,p.target_identity)?;
        let data=inventory::read(&p.target,p)?;inventory::verify_sources_cancellable(&data,Some(&self.cancelled))?;
        let(required,available)=check_space(&p.target,&self.config_root,&data)?;
        p.window_id=window_id.into();p.plan_token=uuid::Uuid::new_v4().to_string();
        let preview=MigrationPreview{plan_token:p.plan_token.clone(),operation_id:p.operation_id.clone(),generation:value.active.generation,source_paths:data.sources.iter().map(|s|display(&s.path)).collect(),target_path:display(&p.target),total_files:data.total_files,total_bytes:data.total_bytes,required_bytes:required,available_bytes:available};
        self.persist(&value)?;Ok(preview)
    }
    fn verify_destination(&self,inventory:&Inventory,root:&Path,value:&mut Control,pending:&mut Pending,mut callback:Option<&mut dyn FnMut(StorageStateView)>)->Result<()> {
        for entry in inventory::unique_entries(inventory) {
            if self.cancelled.load(Ordering::Acquire)&&pending.phase=="verifying"{self.finish_cancel()?;return Err(StorageError::new("Cancelled"));}
            let target=root.join(&entry.destination);
            verify_permissions(&target,entry)?;
            if entry.directory {let _=safe_filesystem::open_directory(&target)?;continue;}
            let base=pending.bytes_completed;let cancellable=pending.phase=="verifying";let mut notified=0u64;
            let(length,hash,_)=safe_filesystem::hash_file_with_progress(&target,||!cancellable||!self.cancelled.load(Ordering::Acquire),|bytes|{
                if bytes-notified>=8*1024*1024{pending.bytes_completed=base+bytes;value.pending=Some(pending.clone());self.persist(value).map_err(std::io::Error::other)?;if let Some(f)=callback.as_mut(){f(self.state());}notified=bytes;}Ok(())
            })?;
            if length!=entry.length||hash!=entry.sha256{return Err(StorageError::new("VerificationFailed"));}
            pending.files_completed+=1;pending.bytes_completed=base+length;value.pending=Some(pending.clone());self.persist(value)?;
            if let Some(f)=callback.as_mut(){f(self.state());}
        }
        let mut expected:std::collections::BTreeSet<_>=inventory::unique_entries(inventory).into_iter().map(|e|e.destination.clone()).collect();
        for entry in inventory::unique_entries(inventory){let mut path=entry.destination.parent();while let Some(parent)=path{if parent.as_os_str().is_empty(){break;}expected.insert(parent.into());path=parent.parent();}}
        let mut actual=std::collections::BTreeSet::new();collect_relative(root,root,&mut actual)?;
        if actual!=expected {return Err(StorageError::new("VerificationFailed"));}Ok(())
    }
    pub(super) fn recheck_inner(&self,mut validator:Option<&mut dyn FnMut(&DataPaths,&serde_json::Value)->Result<()>>)->Result<StorageStateView> {
        let mut value=self.snapshot()?;validate_active(&value.active)?;
        let Some(mut p)=value.pending.clone() else {return Ok(self.state());};
        if !matches!(p.phase.as_str(),"validating"|"restart_required"){return Ok(self.state());}
        if self.boot_generation.load(Ordering::Acquire)!=value.active.generation{return Ok(self.state());}
        self.wait_exclusive()?;
        let result=(||{
            p.phase="validating".into();p.files_completed=0;p.bytes_completed=0;value.pending=Some(p.clone());self.persist(&value)?;
            let inventory=inventory::read(&value.active.data_root,&p)?;
            // 已发布的数据项单独核对，操作库存及历史凭据只按受控命名空间排除。
            for entry in inventory::unique_entries(&inventory) {
                let path=value.active.data_root.join(&entry.destination);
                verify_permissions(&path,entry)?;
                if entry.directory {let _=safe_filesystem::open_directory(&path)?;continue;}
                let(length,hash,_)=safe_filesystem::hash_file(&path)?;
                if length!=entry.length||hash!=entry.sha256{return Err(StorageError::new("VerificationFailed"));}
                p.files_completed+=1;p.bytes_completed+=length;value.pending=Some(p.clone());self.persist(&value)?;
            }
            if let Some(check)=validator.as_mut(){check(&DataPaths::from_active(&value.active),&inventory.validation)?;}
            value.pending=None;self.persist(&value)?;Ok(())
        })();
        if let Err(e)=&result {self.record_error(e);}
        self.release_exclusive();result.map(|_|self.state())
    }
}

fn check_space(target:&Path,config:&Path,inventory:&Inventory)->Result<(u64,u64)> {
    let stats=fs4::statvfs(target)?;
    let overhead=(inventory.entries.len() as u64).checked_mul(stats.allocation_granularity()).ok_or_else(||StorageError::new("InsufficientSpace"))?;
    let required=inventory.total_bytes.checked_add(overhead).and_then(|v|v.checked_add(64*1024*1024)).ok_or_else(||StorageError::new("InsufficientSpace"))?;
    if stats.available_space()<required||fs4::available_space(config)?<2*control::MAX_CONTROL+1024*1024{return Err(StorageError::new("InsufficientSpace"));}
    Ok((required,stats.available_space()))
}
fn check_resume_space(target:&Path,config:&Path,payload:&Path,inventory:&Inventory,publishing:bool,cancel:&std::sync::atomic::AtomicBool)->Result<()> {
    let stats=fs4::statvfs(target)?;let mut remaining=0u64;
    for entry in inventory::unique_entries(inventory){
        let candidate=if publishing&&target.join(&entry.destination).exists(){target.join(&entry.destination)}else{payload.join(&entry.destination)};
        let reusable=if entry.directory{candidate.is_dir()}else{
            match safe_filesystem::hash_file_while(&candidate,||publishing||!cancel.load(Ordering::Acquire)){
                Ok(v)=>v.0==entry.length&&v.1==entry.sha256,
                Err(e) if e.kind()==std::io::ErrorKind::Interrupted=>return Err(e.into()),Err(_)=>false,
            }
        };
        if !reusable {remaining=remaining.checked_add(entry.length).and_then(|v|v.checked_add(stats.allocation_granularity())).ok_or_else(||StorageError::new("InsufficientSpace"))?;}
    }
    if stats.available_space()<remaining.saturating_add(64*1024*1024)||fs4::available_space(config)?<2*control::MAX_CONTROL+1024*1024{return Err(StorageError::new("InsufficientSpace"));}Ok(())
}
fn probe(root:&Path)->Result<()> {
    let a=root.join("probe-a");let b=root.join("probe-b");
    let mut file=OpenOptions::new().write(true).create_new(true).open(&a)?;file.write_all(b"FrameQ storage probe")?;file.sync_all()?;drop(file);
        if safe_filesystem::hash_file(&a)?.0!=20{return Err(StorageError::new("VerificationFailed"));}
    fs::rename(&a,&b)?;let _file=safe_filesystem::open_regular(&b)?;drop(_file);fs::remove_file(b)?;Ok(())
}
fn probe_destination_names(operation:&Path,inventory:&Inventory)->Result<()> {
    let root=operation.join("name-probe");fs::create_dir(&root).map_err(name_probe_error)?;
    let root_identity=safe_filesystem::identity(&root)?;
    let mut created:Vec<(PathBuf,bool,crate::safe_filesystem::DirectoryIdentity)>=vec![];
    let result=(||{
        let mut expected=std::collections::BTreeMap::new();
        for entry in inventory::unique_entries(inventory){
            if expected.insert(entry.destination.clone(),entry.directory).is_some_and(|directory|directory!=entry.directory){return Err(StorageError::new("TargetConflict"));}
            let mut parent=entry.destination.parent();while let Some(path)=parent{if path.as_os_str().is_empty(){break;}if expected.insert(path.into(),true)==Some(false){return Err(StorageError::new("TargetConflict"));}parent=path.parent();}
        }
        let mut entries:Vec<_>=expected.iter().collect();entries.sort_by_key(|(path,directory)|(path.components().count(),!**directory));
        for (relative,directory) in entries {
            let path=root.join(relative);
            let parent=safe_filesystem::pin_directory(path.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;
            if *directory {parent.create_dir(path.file_name().ok_or_else(||StorageError::new("UnsafePath"))?).map_err(name_probe_error)?;created.push((path.clone(),true,safe_filesystem::identity(&path)?));}
            else {let file=parent.create_new(path.file_name().ok_or_else(||StorageError::new("UnsafePath"))?).map_err(name_probe_error)?;let identity=safe_filesystem::file_identity(&file)?;drop(file);created.push((path,false,identity));}
        }
        let mut actual=std::collections::BTreeSet::new();collect_relative(&root,&root,&mut actual)?;
        if actual!=expected.into_keys().collect(){return Err(StorageError::new("TargetConflict"));}Ok(())
    })();
    let cleanup=(||{
        for (path,directory,identity) in created.into_iter().rev(){
            if directory {safe_filesystem::check_identity(&path,identity)?;fs::remove_dir(path)?;}
            else if !safe_filesystem::remove_matching_file(&path,identity,0,&format!("{:x}",Sha256::digest([])))?{return Err(StorageError::new("TargetConflict"));}
        }
        safe_filesystem::check_identity(&root,root_identity)?;fs::remove_dir(root)?;Ok(())
    })();
    match result {Err(error)=>{cleanup?;Err(error)},Ok(())=>cleanup}
}
fn name_probe_error(error:std::io::Error)->StorageError {
    if matches!(error.kind(),std::io::ErrorKind::AlreadyExists|std::io::ErrorKind::InvalidInput)||matches!(error.raw_os_error(),Some(123|206)){StorageError::new("TargetConflict")}else{error.into()}
}
fn copy_entry(entry:&Entry,destination:&Path,partial_root:&Path,cancel:&std::sync::atomic::AtomicBool,progress:&mut dyn FnMut(u64)->Result<()>)->Result<()> {
    create_safe_dirs(destination.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;create_safe_dirs(partial_root)?;
    let destination_parent=safe_filesystem::pin_directory(destination.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;let partial_parent=safe_filesystem::pin_directory(partial_root)?;
    if safe_filesystem::entry_exists(destination)?{let(length,hash,_)=safe_filesystem::hash_file_while(destination,||!cancel.load(Ordering::Acquire))?;if length==entry.length&&hash==entry.sha256{return Ok(());}return Err(StorageError::new("TargetConflict"));}
    let name=format!("{:x}-{}.part",Sha256::digest(display(&entry.destination).as_bytes()),uuid::Uuid::new_v4());let partial=partial_root.join(name);
    let mut source=safe_filesystem::open_regular(&entry.source)?;
    if safe_filesystem::file_identity(&source)?!=entry.identity{return Err(StorageError::new("SourceChanged"));}
    let mut target=partial_parent.create_new(partial.file_name().ok_or_else(||StorageError::new("UnsafePath"))?)?;
    let mut hash=Sha256::new();let mut buffer=vec![0u8;1024*1024];let mut length=0u64;
    let mut notified=0;
    loop {if cancel.load(Ordering::Acquire){return Err(StorageError::new("Cancelled"));}let count=source.read(&mut buffer)?;if count==0{break;}target.write_all(&buffer[..count])?;hash.update(&buffer[..count]);length+=count as u64;
        if length-notified>=8*1024*1024 {progress(length)?;notified=length;}}
    target.sync_all()?;
    if length!=entry.length||format!("{:x}",hash.finalize())!=entry.sha256 {return Err(StorageError::new("SourceChanged"));}
    if safe_filesystem::hash_open_file_while(&mut target,||!cancel.load(Ordering::Acquire))?.1!=entry.sha256 {return Err(StorageError::new("VerificationFailed"));}
    safe_filesystem::install_owned_file(&target,&partial_parent,partial.file_name().ok_or_else(||StorageError::new("UnsafePath"))?,&destination_parent,destination.file_name().ok_or_else(||StorageError::new("UnsafePath"))?)?;
    #[cfg(unix)] if let Some(mode)=entry.unix_mode {use std::os::unix::fs::PermissionsExt;target.set_permissions(fs::Permissions::from_mode(mode))?;}
    #[cfg(windows)] if entry.readonly {let mut p=target.metadata()?.permissions();p.set_readonly(true);target.set_permissions(p)?;}
    Ok(())
}
fn collect_relative(root:&Path,path:&Path,entries:&mut std::collections::BTreeSet<PathBuf>)->Result<()> {
    let _guard=safe_filesystem::open_directory(path)?;
    for item in fs::read_dir(path)? {let path=item?.path();let meta=fs::symlink_metadata(&path)?;
        if crate::atomic_files::is_link_or_reparse_point(&meta){return Err(StorageError::new("UnsafePath"));}
        entries.insert(path.strip_prefix(root).map_err(|_|StorageError::new("UnsafePath"))?.into());
        if meta.is_dir(){collect_relative(root,&path,entries)?;}else {let _f=safe_filesystem::open_regular(&path)?;}
    }Ok(())
}
fn publish(target:&Path,payload:&Path,inventory:&Inventory)->Result<()> {
    for item in fs::read_dir(target)? {let name=item?.file_name();if ![".frameq-storage","outputs","cache","models","runtime","collections.json"].iter().any(|v|name==*v){return Err(StorageError::new("TargetConflict"));}}
    let mut tops=std::collections::BTreeSet::new();
    for entry in inventory::unique_entries(inventory) {
        if entry.destination.starts_with(".frameq-storage/receipts") {
            let parent=entry.destination.parent().ok_or_else(||StorageError::new("UnsafePath"))?;
            create_safe_dirs(&target.join(parent))?;
            if !entry.directory {
                let source=payload.join(&entry.destination);let final_path=target.join(&entry.destination);
                if safe_filesystem::entry_exists(&final_path)?{if safe_filesystem::hash_file(&final_path)?.1!=entry.sha256{return Err(StorageError::new("TargetConflict"));}}
                else {safe_filesystem::rename_no_replace(&source,&final_path)?;}
            }
            continue;
        }
        let top=entry.destination.components().next().ok_or_else(||StorageError::new("UnsafePath"))?.as_os_str().to_os_string();
        if !["outputs","cache","models","runtime","collections.json"].iter().any(|name|top==*name){return Err(StorageError::new("UnsafePath"));}
        tops.insert(top);
    }
    for top in tops {let source=payload.join(&top);let destination=target.join(&top);
        if safe_filesystem::entry_exists(&destination)?{if safe_filesystem::entry_exists(&source)?{return Err(StorageError::new("TargetConflict"));}}
        else {safe_filesystem::rename_no_replace(&source,&destination)?;}
    }
    // 空资料库也发布标准空目录，避免首次正常写入依赖旧根。
    for name in ["outputs","cache","models","runtime"] {create_safe_dirs(&target.join(name))?;}
    Ok(())
}
fn verify_published(target:&Path,inventory:&Inventory)->Result<()> {
    let mut expected=std::collections::BTreeSet::new();
    for entry in inventory::unique_entries(inventory){
        let path=target.join(&entry.destination);
        verify_permissions(&path,entry)?;
        if entry.directory {let _guard=safe_filesystem::open_directory(&path)?;}else{let(length,hash,_)=safe_filesystem::hash_file(&path)?;if length!=entry.length||hash!=entry.sha256{return Err(StorageError::new("VerificationFailed"));}}
        if entry.destination.starts_with(".frameq-storage"){continue;}
        expected.insert(entry.destination.clone());let mut path=entry.destination.parent();while let Some(p)=path {if p.as_os_str().is_empty(){break;}expected.insert(p.into());path=p.parent();}
    }
    for name in ["outputs","cache","models","runtime"]{expected.insert(PathBuf::from(name));}
    let mut actual=std::collections::BTreeSet::new();
    for name in ["outputs","cache","models","runtime"]{let root=target.join(name);actual.insert(PathBuf::from(name));collect_relative(target,&root,&mut actual)?;}
    if target.join("collections.json").exists(){actual.insert(PathBuf::from("collections.json"));}
    if actual!=expected{return Err(StorageError::new("VerificationFailed"));}Ok(())
}
fn restore_directory_permissions(payload:&Path,inventory:&Inventory)->Result<()> {
    let mut entries:Vec<_>=inventory::unique_entries(inventory).into_iter().filter(|e|e.directory).collect();
    entries.sort_by_key(|e|std::cmp::Reverse(e.destination.components().count()));
    for entry in entries {let target=payload.join(&entry.destination);
        let directory=safe_filesystem::pin_directory(&target)?;
        #[cfg(unix)] if let Some(mode)=entry.unix_mode {use std::os::unix::fs::PermissionsExt;directory.set_permissions(fs::Permissions::from_mode(mode))?;}
        #[cfg(windows)] {let mut p=fs::metadata(&target)?.permissions();p.set_readonly(entry.readonly);directory.set_permissions(p)?;}
    }Ok(())
}
fn verify_permissions(path:&Path,entry:&Entry)->Result<()> {
    let meta=fs::symlink_metadata(path)?;
    #[cfg(unix)] if let Some(mode)=entry.unix_mode {use std::os::unix::fs::PermissionsExt;if meta.permissions().mode()!=mode{return Err(StorageError::new("VerificationFailed"));}}
    #[cfg(windows)] if meta.permissions().readonly()!=entry.readonly{return Err(StorageError::new("VerificationFailed"));}
    Ok(())
}
fn validate_operation_namespace(target:&Path,pending:&Pending,receipts:&[ReceiptRef],preserved:&[Pending],inventory:&Inventory)->Result<()> {
    let meta=target.join(".frameq-storage");let _guard=safe_filesystem::open_directory(&meta)?;
    for child in fs::read_dir(&meta)? {let child=child?;if !["operations","receipts","store.json","operation.lock"].iter().any(|n|child.file_name()==*n){return Err(StorageError::new("TargetConflict"));}}
    if meta.join("operation.lock").exists(){let file=fs::symlink_metadata(meta.join("operation.lock"))?;if !file.is_file()||crate::atomic_files::is_link_or_reparse_point(&file){return Err(StorageError::new("UnsafePath"));}}
    if meta.join("store.json").exists(){let marker:StoreMarker=control::read_json(&meta.join("store.json"),64*1024)?;
        if marker.library_id!=pending.previous.library_id||marker.generation!=pending.previous.generation+1||marker.root_identity!=pending.target_identity{return Err(StorageError::new("TargetConflict"));}}
    let operations=meta.join("operations");let _operations=safe_filesystem::open_directory(&operations)?;
    for item in fs::read_dir(&operations)? {let item=item?;if item.file_name()!=pending.operation_id.as_str(){
        let reference=preserved.iter().find(|p|p.target==target&&p.target_identity==pending.target_identity&&item.file_name()==p.operation_id.as_str()).ok_or_else(||StorageError::new("TargetConflict"))?;
        validate_preserved_operation(&item.path(),reference)?;
    }}
    let operation=operations.join(&pending.operation_id);let _operation=safe_filesystem::open_directory(&operation)?;
    for item in fs::read_dir(&operation)? {let name=item?.file_name();if !["inventory.json","payload","partial","temporary"].iter().any(|n|name==*n){return Err(StorageError::new("TargetConflict"));}}
    validate_temporary_references(&operation,pending)?;
    let payload=operation.join("payload");
    if payload.exists(){let mut actual=std::collections::BTreeSet::new();collect_relative(&payload,&payload,&mut actual)?;
        let mut allowed=std::collections::BTreeSet::new();for entry in inventory::unique_entries(inventory){allowed.insert(entry.destination.clone());let mut p=entry.destination.parent();while let Some(parent)=p{if parent.as_os_str().is_empty(){break;}allowed.insert(parent.into());p=parent.parent();}}
        if !actual.is_subset(&allowed){return Err(StorageError::new("TargetConflict"));}}
    let partial=operation.join("partial");
    if partial.exists(){let _partial=safe_filesystem::open_directory(&partial)?;
        for item in fs::read_dir(&partial)?{let item=item?;if !item.file_name().to_str().is_some_and(|n|valid_partial_name(n,inventory)){return Err(StorageError::new("TargetConflict"));}let _file=safe_filesystem::open_regular(&item.path())?;}}
    let receipts_dir=meta.join("receipts");if receipts_dir.exists(){let _receipts=safe_filesystem::open_directory(&receipts_dir)?;
        for item in fs::read_dir(&receipts_dir)?{let item=item?;let name=item.file_name();let Some(id)=name.to_str()else{return Err(StorageError::new("TargetConflict"));};
            if id!=pending.operation_id&&!receipts.iter().any(|r|r.operation_id==id){return Err(StorageError::new("TargetConflict"));}
            let _directory=safe_filesystem::open_directory(&item.path())?;
            for child in fs::read_dir(item.path())?{let child=child?;if child.file_name()!="inventory.json"{return Err(StorageError::new("TargetConflict"));}let _file=safe_filesystem::open_regular(&child.path())?;}
        }
    }Ok(())
}
fn validate_preserved_operation(operation:&Path,pending:&Pending)->Result<()> {
    let _guard=safe_filesystem::open_directory(operation)?;
    if pending.phase=="waiting" {
        for item in fs::read_dir(operation)?{let item=item?;if item.file_name()=="inventory.json"&&!pending.inventory_hash.is_empty(){let _data=inventory::read(&pending.target,pending)?;}else if item.file_name()!="temporary"{return Err(StorageError::new("TargetConflict"));}}
        return validate_temporary_references(operation,pending);
    }
    let inventory=inventory::read(&pending.target,pending)?;
    let mut allowed=std::collections::BTreeSet::new();for entry in inventory::unique_entries(&inventory){allowed.insert(entry.destination.clone());let mut p=entry.destination.parent();while let Some(parent)=p{if parent.as_os_str().is_empty(){break;}allowed.insert(parent.into());p=parent.parent();}}
    for item in fs::read_dir(operation)?{let item=item?;let name=item.file_name();
        if name=="inventory.json"{continue;}
        if name=="payload"{let mut actual=std::collections::BTreeSet::new();collect_relative(&item.path(),&item.path(),&mut actual)?;if !actual.is_subset(&allowed){return Err(StorageError::new("TargetConflict"));}}
        else if name=="partial"{let _dir=safe_filesystem::open_directory(&item.path())?;for file in fs::read_dir(item.path())?{let file=file?;if !file.file_name().to_str().is_some_and(|n|valid_partial_name(n,&inventory)){return Err(StorageError::new("TargetConflict"));}let _file=safe_filesystem::open_regular(&file.path())?;}}
        else if name=="temporary"{validate_temporary_references(operation,pending)?;}
        else{return Err(StorageError::new("TargetConflict"));}
    }Ok(())
}
fn valid_partial_name(name:&str,inventory:&Inventory)->bool {
    let Some(name)=name.strip_suffix(".part")else{return false;};let Some((hash,id))=name.split_once('-')else{return false;};
    uuid::Uuid::parse_str(id).is_ok_and(|value|!value.is_nil()&&value.to_string()==id)&&inventory::unique_entries(inventory).into_iter().any(|entry|!entry.directory&&format!("{:x}",Sha256::digest(display(&entry.destination).as_bytes()))==hash)
}
fn validate_temporary_references(operation:&Path,pending:&Pending)->Result<()> {
    let temporary=operation.join("temporary");if !temporary.exists(){return Ok(());}let _dir=safe_filesystem::open_directory(&temporary)?;
    for artifact in fs::read_dir(&temporary)?{let artifact=artifact?;let relative=artifact.path().strip_prefix(&pending.target).map_err(|_|StorageError::new("UnsafePath"))?.to_path_buf();let reference=pending.owned_artifacts.iter().find(|a|a.relative_path==relative).ok_or_else(||StorageError::new("TargetConflict"))?;
        if reference.kind=="probe"{let identity=safe_filesystem::identity(&artifact.path())?;if reference.identity.is_some_and(|id|id!=identity){return Err(StorageError::new("TargetConflict"));}let mut contents=std::collections::BTreeSet::new();collect_relative(&artifact.path(),&artifact.path(),&mut contents)?;}
        else {let file=safe_filesystem::open_regular(&artifact.path())?;let identity=safe_filesystem::file_identity(&file)?;if reference.identity.is_some_and(|id|id!=identity)||file.metadata()?.len()>reference.expected_length{return Err(StorageError::new("TargetConflict"));}}
    }Ok(())
}
fn recover_task_transactions(active:&ActiveStorage,sources:&[PathBuf])->Result<()> {
    let mut roots=vec![active.data_root.join("outputs")];roots.extend(sources.iter().cloned());
    if let Some(root)=&active.legacy_output_root {if root.is_absolute(){roots.push(root.clone());}}
    for root in roots {let tasks=root.join("tasks");if !tasks.exists(){continue;}let _guard=safe_filesystem::open_directory(&tasks)?;
        for task in fs::read_dir(&tasks)? {let task=task?.path();if task.join(".frameq-artifact-transaction.json").exists(){let _guard=safe_filesystem::open_directory(&task)?;crate::task_manifest::recover_task_artifacts(&task).map_err(|_|StorageError::new("TaskRecoveryFailed"))?;}}
    }Ok(())
}
