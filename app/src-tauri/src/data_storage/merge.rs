use super::*;
use serde::{Deserialize,Serialize};
use inventory::{Entry,Inventory};
use safe_filesystem::DirectoryIdentity;
use std::collections::{BTreeMap,BTreeSet};
use std::io::{Read,Write};

#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct MergePlan {schema_version:u8,operation_id:String,inventory_hash:String,items:Vec<MergeItem>}
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct MergeItem {destination:PathBuf,source_indices:Vec<usize>,target_identity:Option<DirectoryIdentity>}
#[derive(Default,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct ItemState {target_identity:Option<DirectoryIdentity>,temporary_identity:Option<DirectoryIdentity>,sources_completed:usize}

pub(super) fn requires_merge(target:&Path,value:&Control)->location::Result<bool> {
    let names=fs::read_dir(target)?.map(|entry|entry.map(|entry|entry.file_name())).collect::<std::io::Result<Vec<_>>>()?;
    if names.is_empty(){return Ok(false);}
    if names.len()==1&&names[0]==".app-storage"&&value.cancelled_copy_refs.iter().any(|pending|!pending.merge&&pending.target==target){return Ok(false);}
    Ok(true)
}
fn operation_root(pending:&Pending)->PathBuf{pending.target.join(".app-storage/operations").join(&pending.operation_id)}
fn plan_path(pending:&Pending)->PathBuf{operation_root(pending).join("merge.json")}
fn state_path(pending:&Pending,index:usize)->PathBuf{operation_root(pending).join("merge-state").join(format!("{index}.json"))}
fn write_owned_json<T:Serialize>(path:&Path,data:&T,max:u64)->location::Result<()> {
    let parent=safe_filesystem::pin_directory(path.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;
    if safe_filesystem::entry_exists(path)?{let _file=safe_filesystem::open_control_snapshot(path)?;}
    parent.check()?;control::write_json(path,data,max)?;parent.check()?;Ok(())
}
fn load_state(pending:&Pending,index:usize,item:&MergeItem)->location::Result<ItemState>{
    let path=state_path(pending,index);
    let state=if safe_filesystem::entry_exists(&path)?{control::read_json::<ItemState>(&path,64*1024)?}else{ItemState{target_identity:item.target_identity,..ItemState::default()}};
    if state.sources_completed>item.source_indices.len()||item.target_identity.is_some_and(|identity|state.target_identity!=Some(identity)) {return Err(StorageError::new("ControlInvalid"));}
    Ok(state)
}
fn load_plan(pending:&Pending,inventory:&Inventory)->location::Result<MergePlan> {
    let plan:MergePlan=control::read_json(&plan_path(pending),inventory::MAX_INVENTORY)?;
    if plan.schema_version!=1||plan.operation_id!=pending.operation_id||plan.inventory_hash!=pending.inventory_hash{return Err(StorageError::new("ControlInvalid"));}
    let mut visited=BTreeSet::new();let mut destinations=BTreeSet::new();
    for item in &plan.items {
        if !control::safe_relative(&item.destination)||!destinations.insert(&item.destination)||item.source_indices.is_empty(){return Err(StorageError::new("ControlInvalid"));}
        for index in &item.source_indices {let entry=inventory.entries.get(*index).ok_or_else(||StorageError::new("ControlInvalid"))?;
            if entry.directory||entry.destination!=item.destination||!visited.insert(*index){return Err(StorageError::new("ControlInvalid"));}}
    }
    if visited.len()!=inventory.entries.iter().filter(|entry|!entry.directory).count(){return Err(StorageError::new("ControlInvalid"));}Ok(plan)
}
fn inspect_target(target:&Path,cancel:&AtomicBool,observer:&mut dyn FnMut(PreflightProgress)->location::Result<()>)->location::Result<()> {
    fn visit(path:&Path,depth:usize,count:&mut u64,cancel:&AtomicBool,observer:&mut dyn FnMut(PreflightProgress)->location::Result<()>)->location::Result<()> {
        if cancel.load(Ordering::Acquire){return Err(StorageError::new("Cancelled"));}
        if depth>128||*count>1_000_000{return Err(StorageError::new("ControlLimit"));}
        let _guard=safe_filesystem::open_directory(path)?;
        for child in fs::read_dir(path)?{let path=child?.path();let meta=fs::symlink_metadata(&path)?;
            if crate::atomic_files::is_link_or_reparse_point(&meta){return Err(StorageError::new("UnsafePath"));}
            if meta.is_dir(){visit(&path,depth+1,count,cancel,observer)?;}else{let _file=safe_filesystem::open_regular(&path)?;*count+=1;
                let mut progress=PreflightProgress::stage(PreflightStage::TargetCheck);progress.completed_files=*count;observer(progress)?;}}
        Ok(())
    }
    visit(target,0,&mut 0,cancel,observer)
}
fn destination_identity(target:&Path,entry:&Entry)->location::Result<Option<DirectoryIdentity>> {
    let path=target.join(&entry.destination);
    // 仅检查已存在的父目录，缺失目录将在确认后创建。
    let mut parent=path.parent();while let Some(directory)=parent{if directory==target{break;}if safe_filesystem::entry_exists(directory)?{let _guard=safe_filesystem::open_directory(directory)?;}parent=directory.parent();}
    if !safe_filesystem::entry_exists(&path)?{return Ok(None);}
    if entry.directory{Ok(Some(safe_filesystem::identity(&path)?))}else{let file=safe_filesystem::open_regular(&path)?;Ok(Some(safe_filesystem::file_identity(&file)?))}
}
fn merge_space(target:&Path,config:&Path,inventory:&Inventory)->location::Result<(u64,u64)> {
    let target_identity=safe_filesystem::identity(target)?;let stats=fs4::statvfs(target)?;
    let metadata_entries=(inventory.entries.len()as u64).checked_add(inventory.total_files.checked_mul(2).ok_or_else(||StorageError::new("InsufficientSpace"))?).ok_or_else(||StorageError::new("InsufficientSpace"))?;
    let mut required=metadata_entries.checked_mul(stats.allocation_granularity()).and_then(|bytes|bytes.checked_add(64*1024*1024)).ok_or_else(||StorageError::new("InsufficientSpace"))?;
    for entry in inventory::unique_entries(inventory){
        if !entry.directory&&destination_identity(target,entry)?.is_none()&&entry.identity.volume!=target_identity.volume {required=required.checked_add(entry.length).ok_or_else(||StorageError::new("InsufficientSpace"))?;}
    }
    let available=fs4::available_space(target)?;
    if available<required||fs4::available_space(config)?<2*control::MAX_CONTROL+1024*1024{return Err(StorageError::new("InsufficientSpace"));}Ok((required,available))
}
impl DataStorageManager {
    pub(super) fn prepare_merge_inner(&self,mut value:Control,inventory:Inventory,window:&str,generation:u64,observer:&mut dyn FnMut(PreflightProgress)->location::Result<()>)->location::Result<MigrationPreview> {
        let mut pending=value.pending.clone().ok_or_else(||StorageError::new("StaleOperation"))?;
        let mut target_active=value.active.clone();target_active.mode="legacy".into();target_active.data_root=pending.target.clone();target_active.root_identity=pending.target_identity;target_active.legacy_output_root=None;
        super::migration::recover_task_transactions(&target_active,&[],&self.cancelled)?;
        inspect_target(&pending.target,&self.cancelled,observer)?;
        let marker_path=pending.target.join(".app-storage/store.json");
        if marker_path.exists(){let marker:StoreMarker=control::read_json(&marker_path,64*1024)?;
            if marker.schema_version!=1||uuid::Uuid::parse_str(&marker.library_id).is_err(){return Err(StorageError::new("ControlInvalid"));}}
        let (required,available)=merge_space(&pending.target,&self.config_root,&inventory)?;
        let mut grouped:BTreeMap<PathBuf,MergeItem>=BTreeMap::new();
        for (index,entry) in inventory.entries.iter().enumerate(){let identity=destination_identity(&pending.target,entry)?;
            if !entry.directory{grouped.entry(entry.destination.clone()).or_insert_with(||MergeItem{destination:entry.destination.clone(),source_indices:vec![],target_identity:identity}).source_indices.push(index);}}
        let root=operation_root(&pending);create_safe_dirs(&root)?;create_safe_dirs(&root.join("merge-state"))?;create_safe_dirs(&root.join("merge-partial"))?;
        let probe=self.create_owned_artifact(&mut value,"probe",None)?;
        let probe_guard=safe_filesystem::pin_directory(&probe)?;
        super::migration::probe(&probe)?;
        super::migration::probe_destination_names(&probe,&inventory,&self.cancelled,observer)?;
        drop(probe_guard);self.recover_owned_artifacts(&mut value)?;
        pending.inventory_hash=inventory::digest(&inventory)?;value.pending=Some(pending.clone());self.persist(&value)?;
        self.write_target_json(&mut value,&inventory::inventory_path(&pending.target,&pending.operation_id),&inventory,inventory::MAX_INVENTORY)?;
        let plan=MergePlan{schema_version:1,operation_id:pending.operation_id.clone(),inventory_hash:pending.inventory_hash.clone(),items:grouped.into_values().collect()};
        write_owned_json(&plan_path(&pending),&plan,inventory::MAX_INVENTORY)?;
        if self.cancelled.load(Ordering::Acquire){return Err(StorageError::new("Cancelled"));}
        pending.phase="prepared".into();pending.plan_token=uuid::Uuid::new_v4().to_string();pending.window_id=window.into();pending.files_total=inventory.total_files;pending.bytes_total=inventory.total_bytes;value.pending=Some(pending.clone());self.persist(&value)?;
        Ok(MigrationPreview{merge:true,plan_token:pending.plan_token,operation_id:pending.operation_id,generation,source_paths:inventory.sources.iter().map(|source|display(&source.path)).collect(),target_path:display(&pending.target),total_files:inventory.total_files,total_bytes:inventory.total_bytes,required_bytes:required,available_bytes:available})
    }
    pub(super) fn pending_merge_preview(&self,window:&str)->location::Result<MigrationPreview> {
        let mut value=self.snapshot()?;let mut pending=value.pending.clone().ok_or_else(||StorageError::new("StaleOperation"))?;
        let inventory=inventory::read(&pending.target,&pending)?;let _plan=load_plan(&pending,&inventory)?;
        inventory::verify_sources_cancellable(&inventory,Some(&self.cancelled))?;
        let(required,available)=merge_space(&pending.target,&self.config_root,&inventory)?;
        pending.window_id=window.into();pending.plan_token=uuid::Uuid::new_v4().to_string();value.pending=Some(pending.clone());self.persist(&value)?;
        Ok(MigrationPreview{merge:true,plan_token:pending.plan_token,operation_id:pending.operation_id,generation:value.active.generation,source_paths:inventory.sources.iter().map(|source|display(&source.path)).collect(),target_path:display(&pending.target),total_files:inventory.total_files,total_bytes:inventory.total_bytes,required_bytes:required,available_bytes:available})
    }
    pub(super) fn start_merge_inner(&self,token:&str,window:&str,progress:&mut dyn FnMut(StorageStateView),observer:&mut dyn FnMut(PreflightProgress)->location::Result<()>)->location::Result<StorageStateView> {
        let mut value=self.snapshot()?;let mut pending=value.pending.clone().ok_or_else(||StorageError::new("StaleOperation"))?;
        if !pending.merge||pending.plan_token!=token||pending.window_id!=window||!matches!(pending.phase.as_str(),"prepared"|"merging"){return Err(StorageError::new("StaleOperation"));}
        validate_active(&pending.previous)?;safe_filesystem::check_identity(&pending.target,pending.target_identity)?;
        let _root=safe_filesystem::pin_directory(&pending.target)?;let _operation=safe_filesystem::pin_directory(&operation_root(&pending))?;
        let lock=safe_filesystem::open_lock_file(&pending.target.join(".app-storage/operation.lock"))?;lock.try_lock().map_err(|_|StorageError::new("Busy"))?;
        let inventory=inventory::read(&pending.target,&pending)?;let plan=load_plan(&pending,&inventory)?;
        if pending.phase=="prepared" {
            inventory::verify_sources_with_progress(&inventory,Some(&self.cancelled),observer)?;
            for entry in &inventory.entries{let _identity=destination_identity(&pending.target,entry)?;}
            for item in &plan.items {let entry=&inventory.entries[item.source_indices[0]];if destination_identity(&pending.target,entry)?!=item.target_identity{return Err(StorageError::new("SourceChanged"));}}
            merge_space(&pending.target,&self.config_root,&inventory)?;
            if self.cancelled.load(Ordering::Acquire){return Err(StorageError::new("Cancelled"));}
            pending.phase="merging".into();pending.files_completed=0;pending.bytes_completed=0;pending.last_error=None;value.pending=Some(pending.clone());self.persist(&value)?;progress(self.state());
        }
        create_safe_dirs(&pending.target.join("outputs"))?;
        for entry in inventory::unique_entries(&inventory){if entry.directory{create_safe_dirs(&pending.target.join(&entry.destination))?;}}
        pending.files_completed=0;pending.bytes_completed=0;
        for (index,item) in plan.items.iter().enumerate(){
            let mut state=load_state(&pending,index,item)?;
            self.merge_item(&pending,&inventory,item,index,&mut state,&mut |bytes|{let mut state=self.state();if let Some(operation)=state.operation.as_mut(){operation.completed_files=pending.files_completed;operation.completed_bytes=pending.bytes_completed+bytes;}progress(state);})?;
            let entry=&inventory.entries[item.source_indices[0]];pending.files_completed+=1;pending.bytes_completed+=entry.length;value.pending=Some(pending.clone());self.persist(&value)?;progress(self.state());
        }
        self.verify_merge_destination(&mut value,&mut pending)?;
        let generation=pending.previous.generation.checked_add(1).ok_or_else(||StorageError::new("ControlLimit"))?;
        let marker=StoreMarker{schema_version:1,library_id:pending.previous.library_id.clone(),generation,root_identity:pending.target_identity};
        write_owned_json(&pending.target.join(".app-storage/store.json"),&marker,64*1024)?;
        let mut valid_receipts=Vec::new();
        for receipt in &value.cleanup_receipts{let path=pending.target.join(&receipt.relative_path);if safe_filesystem::entry_exists(&path)?&&safe_filesystem::hash_file(&path)?.1==receipt.sha256{valid_receipts.push(receipt.clone());}}
        value.cleanup_receipts=valid_receipts;
        value.active=ActiveStorage{mode:"managed".into(),library_id:pending.previous.library_id.clone(),generation,data_root:pending.target.clone(),root_identity:pending.target_identity,legacy_output_root:None};
        pending.phase="restart_required".into();pending.files_completed=pending.files_total;pending.bytes_completed=pending.bytes_total;pending.last_error=None;value.pending=Some(pending.clone());self.persist(&value)?;progress(self.state());
        cleanup_empty_sources(&inventory,&pending.previous,&self.config_root)?;Ok(self.state())
    }
    fn merge_item(&self,pending:&Pending,inventory:&Inventory,item:&MergeItem,index:usize,state:&mut ItemState,progress:&mut dyn FnMut(u64))->location::Result<()> {
        let destination=pending.target.join(&item.destination);let first=&inventory.entries[item.source_indices[0]];
        create_safe_dirs(destination.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;
        if state.target_identity.is_none(){
            if safe_filesystem::entry_exists(&destination)? {
                let file=safe_filesystem::open_regular(&destination)?;let identity=safe_filesystem::file_identity(&file)?;
                if identity!=first.identity&&Some(identity)!=state.temporary_identity{return Err(StorageError::new("SourceChanged"));}
                state.target_identity=Some(identity);write_owned_json(&state_path(pending,index),state,64*1024)?;
            }else{
                let source=safe_filesystem::open_regular(&first.source)?;
                if safe_filesystem::file_identity(&source)?!=first.identity{return Err(StorageError::new("SourceChanged"));}drop(source);
                if first.identity.volume==pending.target_identity.volume {
                    safe_filesystem::rename_no_replace(&first.source,&destination)?;state.target_identity=Some(first.identity);
                }else{copy_cross_volume(pending,index,first,&destination,state,progress)?;}
                progress(first.length);
                write_owned_json(&state_path(pending,index),state,64*1024)?;
            }
        }
        let target=safe_filesystem::open_regular(&destination)?;
        if Some(safe_filesystem::file_identity(&target)?)!=state.target_identity{return Err(StorageError::new("SourceChanged"));}
        if item.target_identity.is_none(){restore_owned_permissions(&target,&destination,first)?;}
        for source_index in item.source_indices.iter().skip(state.sources_completed){let source=&inventory.entries[*source_index];
            if safe_filesystem::entry_exists(&source.source)? {
                if !safe_filesystem::remove_file_by_identity(&source.source,source.identity)?{return Err(StorageError::new("SourceChanged"));}
                progress(first.length);
            }
            state.sources_completed+=1;write_owned_json(&state_path(pending,index),state,64*1024)?;
        }
        drop(target);Ok(())
    }
    pub(super) fn verify_merge_destination(&self,value:&mut Control,pending:&mut Pending)->location::Result<()> {
        let inventory=inventory::read(&pending.target,pending)?;let plan=load_plan(pending,&inventory)?;
        pending.files_completed=0;pending.bytes_completed=0;
        for(index,item)in plan.items.iter().enumerate(){let state=load_state(pending,index,item)?;
            if state.sources_completed!=item.source_indices.len(){return Err(StorageError::new("VerificationFailed"));}
            let path=pending.target.join(&item.destination);let file=safe_filesystem::open_regular(&path)?;
            if Some(safe_filesystem::file_identity(&file)?)!=state.target_identity{return Err(StorageError::new("SourceChanged"));}
            let first=&inventory.entries[item.source_indices[0]];
            if item.target_identity.is_none(){let(length,hash,_)=safe_filesystem::hash_file(&path)?;if length!=first.length||hash!=first.sha256{return Err(StorageError::new("VerificationFailed"));}}
            pending.files_completed+=1;pending.bytes_completed+=first.length;
        }
        value.pending=Some(pending.clone());self.persist(value)?;
        if value.active.data_root==pending.target{cleanup_empty_sources(&inventory,&pending.previous,&self.config_root)?;}
        Ok(())
    }
}
fn restore_owned_permissions(file:&File,path:&Path,entry:&Entry)->location::Result<()> {
    #[cfg(unix)] {let _=path;if let Some(mode)=entry.unix_mode{use std::os::unix::fs::PermissionsExt;file.set_permissions(fs::Permissions::from_mode(mode))?;}}
    #[cfg(windows)] {let mut permissions=file.metadata()?.permissions();if permissions.readonly()!=entry.readonly{permissions.set_readonly(entry.readonly);fs::set_permissions(path,permissions)?;}}
    Ok(())
}
fn copy_cross_volume(pending:&Pending,index:usize,entry:&Entry,destination:&Path,state:&mut ItemState,progress:&mut dyn FnMut(u64))->location::Result<()> {
    let temporary=operation_root(pending).join("merge-partial").join(format!("{index}.part"));
    let parent=safe_filesystem::pin_directory(temporary.parent().unwrap())?;
    let mut target=if safe_filesystem::entry_exists(&temporary)? {
        let expected=if let Some(identity)=state.temporary_identity{identity}else{let file=safe_filesystem::open_regular(&temporary)?;if file.metadata()?.len()!=0{return Err(StorageError::new("ControlInvalid"));}let identity=safe_filesystem::file_identity(&file)?;state.temporary_identity=Some(identity);write_owned_json(&state_path(pending,index),state,64*1024)?;identity};safe_filesystem::open_owned_writer(&temporary,expected)?
    }else{
        let file=parent.create_new(temporary.file_name().unwrap())?;state.temporary_identity=Some(safe_filesystem::file_identity(&file)?);write_owned_json(&state_path(pending,index),state,64*1024)?;file
    };
    target.set_len(0)?;
    let mut source=safe_filesystem::open_regular(&entry.source)?;
    if safe_filesystem::file_identity(&source)?!=entry.identity{return Err(StorageError::new("SourceChanged"));}
    let mut buffer=vec![0u8;1024*1024];let mut copied=0u64;
    loop{let count=source.read(&mut buffer)?;if count==0{break;}target.write_all(&buffer[..count])?;copied+=count as u64;if copied>entry.length{return Err(StorageError::new("SourceChanged"));}progress(copied);}
    target.sync_all()?;let(length,hash,_)=safe_filesystem::hash_open_file_while(&mut target,||true)?;
    if length!=entry.length||hash!=entry.sha256{return Err(StorageError::new("SourceChanged"));}
    let destination_parent=safe_filesystem::pin_directory(destination.parent().unwrap())?;
    safe_filesystem::install_owned_file(&target,&parent,temporary.file_name().unwrap(),&destination_parent,destination.file_name().unwrap())?;
    #[cfg(unix)] if let Some(mode)=entry.unix_mode{use std::os::unix::fs::PermissionsExt;target.set_permissions(fs::Permissions::from_mode(mode))?;}
    #[cfg(windows)] if entry.readonly{let mut permissions=target.metadata()?.permissions();permissions.set_readonly(true);target.set_permissions(permissions)?;}
    state.target_identity=state.temporary_identity;Ok(())
}
fn cleanup_empty_sources(inventory:&Inventory,previous:&ActiveStorage,config:&Path)->location::Result<()> {
    let mut entries:Vec<_>=inventory.entries.iter().filter(|entry|entry.directory).collect();entries.sort_by_key(|entry|std::cmp::Reverse(entry.source.components().count()));
    for entry in entries{if entry.source==config||entry.source==previous.data_root{continue;}if !safe_filesystem::entry_exists(&entry.source)?{continue;}
        safe_filesystem::check_identity(&entry.source,entry.identity)?;
        if fs::read_dir(&entry.source)?.next().is_none(){fs::remove_dir(&entry.source)?;}}
    Ok(())
}

#[cfg(test)]
#[path="merge_tests.rs"]
mod tests;
