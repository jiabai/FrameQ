use super::{control,location::*};
use crate::safe_filesystem::{self,DirectoryIdentity};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{collections::{BTreeMap,BTreeSet},fs,path::{Path,PathBuf}};

#[cfg(test)]
#[path="inventory_progress_tests.rs"]
mod progress_tests;

pub(super) const MAX_INVENTORY:u64=1024*1024*1024;
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct Entry {
    pub source:PathBuf,pub destination:PathBuf,pub directory:bool,pub length:u64,pub sha256:String,
    pub identity:DirectoryIdentity,pub readonly:bool,#[serde(deserialize_with="super::location::required_nullable")] pub unix_mode:Option<u32>,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct Source {pub path:PathBuf,pub destination:PathBuf,pub identity:DirectoryIdentity,pub entry_start:usize,pub entry_count:usize}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct Inventory {pub schema_version:u8,pub sources:Vec<Source>,pub entries:Vec<Entry>,pub total_files:u64,pub total_bytes:u64,pub validation:serde_json::Value}
pub(super) fn inventory_path(target:&Path,id:&str)->PathBuf {target.join(".app-storage/operations").join(id).join("inventory.json")}
pub(super) fn payload_path(target:&Path,id:&str)->PathBuf {target.join(".app-storage/operations").join(id).join("payload")}
pub(super) fn digest(value:&Inventory)->Result<String> {
    Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(value).map_err(|_|StorageError::new("ControlInvalid"))?)))
}
struct ScanProgress<'a> {
    state:PreflightProgress,
    observer:&'a mut dyn FnMut(PreflightProgress)->Result<()>,
}
impl ScanProgress<'_> {
    fn report(&mut self)->Result<()> {
        if self.state.total_files.is_some_and(|total|self.state.completed_files>total){self.state.total_files=None;}
        if self.state.total_bytes.is_some_and(|total|self.state.completed_bytes>total){self.state.total_bytes=None;}
        (self.observer)(self.state.clone())
    }
}

fn visit(source:&Path,destination:&Path,entries:&mut Vec<Entry>,depth:usize,cancel:Option<&std::sync::atomic::AtomicBool>,hash:bool,progress:&mut ScanProgress<'_>)->Result<()> {
    if cancel.is_some_and(|v|v.load(std::sync::atomic::Ordering::Acquire)){return Err(StorageError::new("Cancelled"));}
    if depth>128 || entries.len()>1_000_000 || !control::safe_relative(destination) {return Err(StorageError::new("UnsafePath"));}
    let meta=fs::symlink_metadata(source)?;
    if crate::atomic_files::is_link_or_reparse_point(&meta) {return Err(StorageError::new("UnsafePath"));}
    if meta.is_dir() {
        let id=safe_filesystem::identity(source)?;
        entries.push(Entry{source:source.into(),destination:destination.into(),directory:true,length:0,sha256:String::new(),identity:id,readonly:meta.permissions().readonly(),unix_mode:unix_mode(&meta)});
        let mut children=fs::read_dir(source)?.map(|v|v.map(|v|v.path())).collect::<std::io::Result<Vec<_>>>()?;
        children.sort();
        for child in children {visit(&child,&destination.join(child.file_name().ok_or_else(||StorageError::new("UnsafePath"))?),entries,depth+1,cancel,hash,progress)?;}
        safe_filesystem::check_identity(source,id)?;
    } else if meta.is_file() {
        let base=progress.state.completed_bytes;
        progress.state.current_file_bytes=0;progress.state.current_file_total_bytes=if hash{meta.len()}else{0};progress.report()?;
        let(length,digest,id)=if hash {safe_filesystem::hash_file_with_progress(source,||!cancel.is_some_and(|v|v.load(std::sync::atomic::Ordering::Acquire)),|bytes|{
            if bytes>meta.len(){return Err(std::io::Error::other(StorageError::new("SourceChanged")));}
            progress.state.current_file_bytes=bytes;
            progress.state.completed_bytes=base.checked_add(bytes).ok_or_else(||std::io::Error::other(StorageError::new("ControlLimit")))?;
            progress.report().map_err(std::io::Error::other)
        })?}
            else {let file=safe_filesystem::open_regular(source)?;(file.metadata()?.len(),String::new(),safe_filesystem::file_identity(&file)?)};
        if hash&&length!=meta.len(){return Err(StorageError::new("SourceChanged"));}
        entries.push(Entry{source:source.into(),destination:destination.into(),directory:false,length,sha256:digest,identity:id,readonly:meta.permissions().readonly(),unix_mode:unix_mode(&meta)});
        progress.state.completed_files=progress.state.completed_files.checked_add(1).ok_or_else(||StorageError::new("ControlLimit"))?;
        progress.report()?;
    } else {return Err(StorageError::new("UnsafePath"));}
    Ok(())
}
#[cfg(unix)] fn unix_mode(meta:&fs::Metadata)->Option<u32> {use std::os::unix::fs::PermissionsExt;Some(meta.permissions().mode())}
#[cfg(not(unix))] fn unix_mode(_meta:&fs::Metadata)->Option<u32> {None}

pub(super) fn build_cancellable(active:&ActiveStorage,legacy_sources:&[PathBuf],receipts:&[ReceiptRef],cancel:Option<&std::sync::atomic::AtomicBool>)->Result<Inventory> {
    build_inner(active,legacy_sources,receipts,cancel,true,None,&mut |_|Ok(()))
}
pub(super) fn estimate(active:&ActiveStorage,legacy_sources:&[PathBuf],receipts:&[ReceiptRef],cancel:Option<&std::sync::atomic::AtomicBool>)->Result<Inventory> {
    estimate_with_progress(active,legacy_sources,receipts,cancel,&mut |_|Ok(()))
}
pub(super) fn estimate_with_progress(active:&ActiveStorage,legacy_sources:&[PathBuf],receipts:&[ReceiptRef],cancel:Option<&std::sync::atomic::AtomicBool>,observer:&mut dyn FnMut(PreflightProgress)->Result<()>)->Result<Inventory> {
    build_inner(active,legacy_sources,receipts,cancel,false,None,observer)
}
pub(super) fn build_with_progress(active:&ActiveStorage,legacy_sources:&[PathBuf],receipts:&[ReceiptRef],cancel:Option<&std::sync::atomic::AtomicBool>,expected_files:u64,expected_bytes:u64,observer:&mut dyn FnMut(PreflightProgress)->Result<()>)->Result<Inventory> {
    build_inner(active,legacy_sources,receipts,cancel,true,Some((expected_files,expected_bytes)),observer)
}
fn build_inner(active:&ActiveStorage,legacy_sources:&[PathBuf],receipts:&[ReceiptRef],cancel:Option<&std::sync::atomic::AtomicBool>,hash:bool,expected:Option<(u64,u64)>,observer:&mut dyn FnMut(PreflightProgress)->Result<()>)->Result<Inventory> {
    let mut state=PreflightProgress::stage(if hash{PreflightStage::IntegrityCheck}else{PreflightStage::InventoryScanning});
    if let Some((files,bytes))=expected{state.total_files=Some(files);state.total_bytes=Some(bytes);}
    let mut progress=ScanProgress{state,observer};progress.report()?;
    validate_active(active)?;
    if active.data_root.join("work").exists() && active.data_root.join("cache/legacy-work").exists() {return Err(StorageError::new("TargetConflict"));}
    let mut mappings=vec![(active.data_root.join("outputs"),PathBuf::from("outputs")),(active.data_root.join("cache"),"cache".into()),
        (active.data_root.join("models"),"models".into()),(active.data_root.join("runtime"),"runtime".into()),
        (active.data_root.join("collections.json"),"collections.json".into()),(active.data_root.join("work"),"cache/legacy-work".into())];
    let mut output_roots=legacy_sources.to_vec();
    if let Some(output)=&active.legacy_output_root {
        if output.is_absolute() {output_roots.push(output.clone());}
        else if legacy_sources.is_empty() {return Err(StorageError::new("LegacySourceAmbiguous"));}
    }
    for root in output_roots {
        if root==active.data_root.join("outputs"){continue;}
        safe_filesystem::validate_ancestors(&root)?;
        let canonical=root.canonicalize()?;
        if canonical==active.data_root.join("outputs").canonicalize().unwrap_or_else(|_|active.data_root.join("outputs")) {continue;}
        for child in fs::read_dir(&root)? {
            let child=child?;
            if child.file_name()!="tasks" {return Err(StorageError::new("LegacySourceAmbiguous"));}
        }
        mappings.push((root.join("tasks"),PathBuf::from("outputs/tasks")));
    }
    for receipt in receipts {
        mappings.push((active.data_root.join(&receipt.relative_path),receipt.relative_path.clone()));
    }
    let mut entries=Vec::new();let mut sources=Vec::new();let mut physical=BTreeSet::new();
    let mut tasks:BTreeMap<PathBuf,BTreeMap<PathBuf,(bool,u64,String)>>=BTreeMap::new();
    for(source,destination)in mappings {
        match fs::symlink_metadata(&source) {Err(e) if e.kind()==std::io::ErrorKind::NotFound=>continue,Err(e)=>return Err(e.into()),Ok(_)=>{}}
        let is_directory=fs::symlink_metadata(&source)?.is_dir();
        let id=if is_directory {safe_filesystem::identity(&source)?} else {let file=safe_filesystem::open_regular(&source)?;safe_filesystem::file_identity(&file)?};
        if !physical.insert((id.volume,id.file)) {continue;}
        let mut current=Vec::new();visit(&source,&destination,&mut current,0,cancel,hash,&mut progress)?;
        let mut source_tasks:BTreeMap<PathBuf,BTreeMap<PathBuf,(bool,u64,String)>>=BTreeMap::new();
        for entry in &current {
            let parts:Vec<_>=entry.destination.components().collect();
            if parts.len()>=3 && parts[0].as_os_str()=="outputs" && parts[1].as_os_str()=="tasks" {
                let task:PathBuf=parts[..3].iter().map(|p|p.as_os_str()).collect();
                source_tasks.entry(task.clone()).or_default().insert(entry.destination.strip_prefix(task).unwrap().into(),(entry.directory,entry.length,entry.sha256.clone()));
            }
        }
        for(task,tree)in source_tasks {
            if let Some(existing)=tasks.get(&task) {if *existing!=tree {return Err(StorageError::new("TargetConflict"));}}
            else {tasks.insert(task,tree);}
        }
        sources.push(Source{path:source,destination,identity:id,entry_start:entries.len(),entry_count:current.len()});entries.extend(current);
    }
    let mut destinations:BTreeMap<PathBuf,&Entry>=BTreeMap::new();
    for entry in &entries {
        if let Some(previous)=destinations.get(&entry.destination) {
            if previous.directory!=entry.directory || previous.length!=entry.length || previous.sha256!=entry.sha256 {return Err(StorageError::new("TargetConflict"));}
        } else {destinations.insert(entry.destination.clone(),entry);}
    }
    let unique:Vec<_>=destinations.values().map(|v|(*v).clone()).collect();
    let total_bytes=unique.iter().try_fold(0u64,|a,v|a.checked_add(v.length).ok_or_else(||StorageError::new("InsufficientSpace")))?;
    let total_files=unique.iter().filter(|v|!v.directory).count() as u64;
    if hash{progress.state.total_files=Some(progress.state.completed_files);progress.state.total_bytes=Some(progress.state.completed_bytes);}
    progress.report()?;
    Ok(Inventory{schema_version:1,sources,entries,total_files,total_bytes,validation:serde_json::Value::Null})
}
pub(super) fn unique_entries(inventory:&Inventory)->Vec<&Entry> {
    let mut values=BTreeMap::new();for entry in &inventory.entries {values.entry(&entry.destination).or_insert(entry);}values.into_values().collect()
}
pub(super) fn verify_sources_cancellable(inventory:&Inventory,cancel:Option<&std::sync::atomic::AtomicBool>)->Result<()> {
    verify_sources_with_progress(inventory,cancel,&mut |_|Ok(()))
}
pub(super) fn verify_sources_with_progress(inventory:&Inventory,cancel:Option<&std::sync::atomic::AtomicBool>,observer:&mut dyn FnMut(PreflightProgress)->Result<()>)->Result<()> {
    let mut state=PreflightProgress::stage(PreflightStage::IntegrityCheck);
    state.total_files=Some(inventory.entries.iter().filter(|entry|!entry.directory).count()as u64);
    state.total_bytes=Some(inventory.entries.iter().filter(|entry|!entry.directory).try_fold(0u64,|total,entry|total.checked_add(entry.length).ok_or_else(||StorageError::new("InsufficientSpace")))?);
    let mut progress=ScanProgress{state,observer};progress.report()?;
    for source in &inventory.sources {
        let end=source.entry_start.checked_add(source.entry_count).ok_or_else(||StorageError::new("ControlInvalid"))?;
        let expected_range=inventory.entries.get(source.entry_start..end).ok_or_else(||StorageError::new("ControlInvalid"))?;
        let expected:std::collections::HashMap<&Path,&Entry>=expected_range.iter().map(|entry|(entry.destination.as_path(),entry)).collect();
        let mut current=Vec::new();visit_verified(&source.path,&source.destination,&mut current,0,cancel,&expected,&mut progress)?;
        if current!=expected_range {return Err(StorageError::new("SourceChanged"));}
    }
    progress.report()?;
    Ok(())
}
/// 与 build 期 `visit` 的区别：文件先做廉价判定——同一物理文件（identity 一致）且长度与
/// 权限都未变时，直接沿用清单里的 SHA-256，不重新哈希。判定不匹配才重哈希并参与最终比对。
/// 同 identity 同长度的原地内容篡改不在这里防：复制阶段 `copy_entry` 边读源边比对清单哈希，
/// 会在写入前拦下 `SourceChanged`。
fn visit_verified(source:&Path,destination:&Path,entries:&mut Vec<Entry>,depth:usize,cancel:Option<&std::sync::atomic::AtomicBool>,expected:&std::collections::HashMap<&Path,&Entry>,progress:&mut ScanProgress<'_>)->Result<()> {
    if cancel.is_some_and(|v|v.load(std::sync::atomic::Ordering::Acquire)){return Err(StorageError::new("Cancelled"));}
    if depth>128 || entries.len()>1_000_000 || !control::safe_relative(destination) {return Err(StorageError::new("UnsafePath"));}
    let meta=fs::symlink_metadata(source)?;
    if crate::atomic_files::is_link_or_reparse_point(&meta) {return Err(StorageError::new("UnsafePath"));}
    if meta.is_dir() {
        let id=safe_filesystem::identity(source)?;
        entries.push(Entry{source:source.into(),destination:destination.into(),directory:true,length:0,sha256:String::new(),identity:id,readonly:meta.permissions().readonly(),unix_mode:unix_mode(&meta)});
        let mut children=fs::read_dir(source)?.map(|v|v.map(|v|v.path())).collect::<std::io::Result<Vec<_>>>()?;
        children.sort();
        for child in children {visit_verified(&child,&destination.join(child.file_name().ok_or_else(||StorageError::new("UnsafePath"))?),entries,depth+1,cancel,expected,progress)?;}
        safe_filesystem::check_identity(source,id)?;
    } else if meta.is_file() {
        let base=progress.state.completed_bytes;
        progress.state.current_file_bytes=0;progress.state.current_file_total_bytes=meta.len();
        let file=safe_filesystem::open_regular(source)?;
        let identity=safe_filesystem::file_identity(&file)?;
        drop(file);
        let readonly=meta.permissions().readonly();
        let mode=unix_mode(&meta);
        let cheap=expected.get(destination).is_some_and(|entry|!entry.directory&&entry.length==meta.len()&&entry.identity==identity&&!entry.sha256.is_empty()&&entry.readonly==readonly&&entry.unix_mode==mode);
        let (length,digest)=if cheap {
            let entry=expected.get(destination).unwrap();
            progress.state.current_file_bytes=entry.length;
            (entry.length,entry.sha256.clone())
        } else {
            safe_filesystem::hash_file_with_progress(source,||!cancel.is_some_and(|v|v.load(std::sync::atomic::Ordering::Acquire)),|bytes|{
                if bytes>meta.len(){return Err(std::io::Error::other(StorageError::new("SourceChanged")));}
                progress.state.current_file_bytes=bytes;
                progress.state.completed_bytes=base.checked_add(bytes).ok_or_else(||std::io::Error::other(StorageError::new("ControlLimit")))?;
                progress.report().map_err(std::io::Error::other)
            }).map(|(length,digest,_)|(length,digest))?
        };
        if length!=meta.len(){return Err(StorageError::new("SourceChanged"));}
        entries.push(Entry{source:source.into(),destination:destination.into(),directory:false,length,sha256:digest,identity,readonly,unix_mode:mode});
        progress.state.completed_bytes=base.checked_add(length).ok_or_else(||StorageError::new("ControlLimit"))?;
        progress.state.completed_files=progress.state.completed_files.checked_add(1).ok_or_else(||StorageError::new("ControlLimit"))?;
        progress.report()?;
    } else {return Err(StorageError::new("UnsafePath"));}
    Ok(())
}
pub(super) fn read(target:&Path,pending:&Pending)->Result<Inventory> {
    let mut value:Inventory=control::read_json(&inventory_path(target,&pending.operation_id),MAX_INVENTORY)?;
    if value.schema_version!=1 || digest(&value)?!=pending.inventory_hash || value.entries.iter().any(|e|!control::safe_relative(&e.destination)||!e.source.is_absolute()) {
        return Err(StorageError::new("ControlInvalid"));
    }
    for source in &mut value.sources{source.path=relocated_path(&source.path,&pending.source_relocations);}
    for entry in &mut value.entries{entry.source=relocated_path(&entry.source,&pending.source_relocations);}
    Ok(value)
}
pub(super) fn relocated_path(path:&Path,relocations:&[SourceRelocation])->PathBuf {let mut path=path.to_path_buf();for relocation in relocations{if let Ok(relative)=path.strip_prefix(&relocation.old_root){path=relocation.new_root.join(relative);}}path}
