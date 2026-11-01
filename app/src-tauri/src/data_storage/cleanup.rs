use super::{control,inventory::{self,Inventory},location::*,DataStorageManager};
use crate::safe_filesystem;
use std::{fs,path::Path};

impl DataStorageManager {
    fn cleanup_inventory(&self,value:&Control,id:&str)->Result<Inventory> {
        validate_active(&value.active)?;
        let reference=value.cleanup_receipts.iter().find(|r|r.operation_id==id).ok_or_else(||StorageError::new("StaleOperation"))?;
        let data:Inventory=control::read_json(&value.active.data_root.join(&reference.relative_path),inventory::MAX_INVENTORY)?;
        if inventory::digest(&data)?!=reference.sha256{return Err(StorageError::new("ControlInvalid"));}
        for entry in &data.entries {if !control::safe_relative(&entry.destination)||!entry.source.is_absolute(){return Err(StorageError::new("ControlInvalid"));}}
        Ok(data)
    }
    pub(crate) fn prepare_cleanup(&self,receipt_id:&str,window_id:&str)->Result<CleanupPreview> {
        let value=self.snapshot()?;
        if value.pending.is_some(){return Err(StorageError::new("Busy"));}
        let data=self.cleanup_inventory(&value,receipt_id)?;
        let mut files=0u64;let mut bytes=0u64;let mut retained=0u64;
        for entry in &data.entries {if entry.directory{continue;}
            if !safe_filesystem::entry_exists(&entry.source)?{continue;}
            if cleanup_candidate(&value.active.data_root,entry)? {files+=1;bytes=bytes.checked_add(entry.length).ok_or_else(||StorageError::new("ControlInvalid"))?;}else{retained+=1;}
        }
        let token=uuid::Uuid::new_v4().to_string();
        self.inner.lock().expect("storage mutex").cleanup_tokens.insert(token.clone(),(receipt_id.into(),window_id.into(),value.active.generation));
        Ok(CleanupPreview{plan_token:token,receipt_id:receipt_id.into(),generation:value.active.generation,total_files:files,total_bytes:bytes,retained_files:retained,source_paths:data.sources.iter().map(|s|display(&s.path)).collect()})
    }
    pub(crate) fn confirm_cleanup(&self,token:&str,window_id:&str,progress:&mut dyn FnMut(StorageStateView))->Result<StorageStateView> {
        self.wait_exclusive()?;
        let result=(||{
            let(id,window,generation)=self.inner.lock().expect("storage mutex").cleanup_tokens.remove(token).ok_or_else(||StorageError::new("StaleOperation"))?;
            let mut value=self.snapshot()?;
            if window!=window_id||generation!=value.active.generation||value.pending.is_some(){return Err(StorageError::new("StaleOperation"));}
            let data=self.cleanup_inventory(&value,&id)?;
            let pending=Pending{operation_id:id.clone(),phase:"cleaning".into(),previous:value.active.clone(),target:value.active.data_root.clone(),target_identity:value.active.root_identity,inventory_hash:inventory::digest(&data)?,plan_token:token.into(),window_id:window_id.into(),files_total:data.entries.iter().filter(|e|!e.directory).count()as u64,bytes_total:data.entries.iter().map(|e|e.length).sum(),files_completed:0,bytes_completed:0,last_error:None,legacy_sources:vec![],owned_artifacts:vec![],source_relocations:vec![]};
            value.pending=Some(pending);self.persist(&value)?;
            self.clean_entries(&mut value,&data,progress)?;Ok(())
        })();
        if let Err(e)=&result {self.record_error(e);}
        self.release_exclusive();result.map(|_|self.state())
    }
    fn clean_entries(&self,value:&mut Control,data:&Inventory,progress:&mut dyn FnMut(StorageStateView))->Result<()> {
        let id=value.pending.as_ref().ok_or_else(||StorageError::new("StaleOperation"))?.operation_id.clone();
        let mut retained=false;
        for entry in &data.entries {
            if entry.directory{continue;}
            if safe_filesystem::entry_exists(&entry.source)? {
                if cleanup_candidate(&value.active.data_root,entry)? {
                    // 同时固定两端祖先和普通文件，删除前再次核对身份与散列。
                    let parent=entry.source.parent().ok_or_else(||StorageError::new("UnsafePath"))?;
                    let _parent=safe_filesystem::open_directory(parent)?;
                    let current=value.active.data_root.join(&entry.destination);
                    let _target_parent=safe_filesystem::open_directory(current.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;
                    if let Some(_target_guard)=cleanup_target_guard(&current,entry)? {if !safe_filesystem::remove_matching_file(&entry.source,entry.identity,entry.length,&entry.sha256)?{retained=true;}}
                    else {retained=true;}
                } else {retained=true;}
            }
            let pending=value.pending.as_mut().unwrap();pending.files_completed+=1;pending.bytes_completed+=entry.length;
            self.persist(value)?;progress(self.state());
        }
        // 只清空已列入库存且身份仍一致的应用子目录，来源根始终保留。
        let mut directories:Vec<_>=data.entries.iter().filter(|e|e.directory).collect();
        directories.sort_by_key(|e|std::cmp::Reverse(e.source.components().count()));
        for entry in directories {
            if !safe_filesystem::entry_exists(&entry.source)?||entry.source.starts_with(&value.active.data_root)||data.sources.iter().any(|s|s.path==entry.source){continue;}
            if safe_filesystem::check_identity(&entry.source,entry.identity).is_ok()&&fs::read_dir(&entry.source)?.next().is_none(){fs::remove_dir(&entry.source)?;}
        }
        value.pending=None;
        if !retained {value.cleanup_receipts.retain(|r|r.operation_id!=id);}
        else {
            let mut files=0;let mut bytes=0;
            for entry in &data.entries{if !entry.directory&&safe_filesystem::entry_exists(&entry.source)?{files+=1;bytes+=entry.length;}}
            if let Some(reference)=value.cleanup_receipts.iter_mut().find(|r|r.operation_id==id){reference.total_files=files;reference.total_bytes=bytes;}
        }
        self.persist(value)
    }
    pub(crate) fn resume_cleanup(&self,operation_id:&str,window_id:&str,progress:&mut dyn FnMut(StorageStateView))->Result<StorageStateView> {
        self.wait_exclusive()?;
        let result=(||{let mut value=self.snapshot()?;let p=value.pending.as_ref().ok_or_else(||StorageError::new("StaleOperation"))?;
            if p.phase!="cleaning"||p.operation_id!=operation_id{return Err(StorageError::new("StaleOperation"));}
            let data=self.cleanup_inventory(&value,operation_id)?;
            let p=value.pending.as_mut().unwrap();p.window_id=window_id.into();p.files_completed=0;p.bytes_completed=0;
            self.clean_entries(&mut value,&data,progress)})();
        if let Err(e)=&result {self.record_error(e);}self.release_exclusive();result.map(|_|self.state())
    }
    pub(crate) fn stop_cleanup(&self,operation_id:&str)->Result<StorageStateView> {
        self.wait_exclusive()?;
        let result=(||{let mut value=self.snapshot()?;
        let p=value.pending.as_ref().ok_or_else(||StorageError::new("StaleOperation"))?;
        if p.phase!="cleaning"||p.operation_id!=operation_id{return Err(StorageError::new("StaleOperation"));}
        value.pending=None;self.persist(&value)?;Ok(())})();self.release_exclusive();result.map(|_|self.state())
    }
}

pub(super) fn cleanup_target_guard(path:&Path,entry:&inventory::Entry)->Result<Option<std::fs::File>> {
    let mut file=match safe_filesystem::open_regular(path){Ok(file)=>file,Err(_)=>return Ok(None)};
    let(length,hash,_)=safe_filesystem::hash_open_file_while(&mut file,||true)?;
    if length!=entry.length||hash!=entry.sha256{return Ok(None);}Ok(Some(file))
}

fn cleanup_candidate(active_root:&Path,entry:&inventory::Entry)->Result<bool> {
    if entry.source.starts_with(active_root){return Ok(false);}
    let original=match safe_filesystem::hash_file(&entry.source){Ok(value)=>value,Err(_)=>return Ok(false)};
    if original.0!=entry.length||original.1!=entry.sha256||original.2!=entry.identity{return Ok(false);}
    let target=match safe_filesystem::hash_file(&active_root.join(&entry.destination)){Ok(value)=>value,Err(_)=>return Ok(false)};
    Ok(target.0==entry.length&&target.1==entry.sha256)
}
