use super::location::*;
use std::fs;
use std::io::Read;
use std::path::Path;
use crate::safe_filesystem;

pub(super) const MAX_CONTROL:u64=256*1024;
pub(super) fn read_json<T:serde::de::DeserializeOwned>(path:&Path,max:u64)->Result<T> {
    let file=safe_filesystem::open_control_snapshot(path)?;
    if file.metadata()?.len()>max {return Err(StorageError::new("ControlInvalid"));}
    let mut bytes=Vec::new();file.take(max+1).read_to_end(&mut bytes)?;
    if bytes.len() as u64>max {return Err(StorageError::new("ControlInvalid"));}
    serde_json::from_slice(&bytes).map_err(|_|StorageError::new("ControlInvalid"))
}
pub(super) fn write_json<T:serde::Serialize>(path:&Path,value:&T,max:u64)->Result<()> {
    let bytes=serde_json::to_vec(value).map_err(|_|StorageError::new("ControlInvalid"))?;
    if bytes.len() as u64>max {return Err(StorageError::new("ControlLimit"));}
    safe_filesystem::validate_ancestors(path.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;
    crate::atomic_files::atomic_write(path,&bytes).map_err(|_|StorageError::new("CommitFailed"))
}
pub(super) fn load(root:&Path)->Result<Option<Control>> {
    let path=root.join("data-storage.json");
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(None),
        Err(e)=>Err(e.into()),
        Ok(_)=>{
            let mut serialized:serde_json::Value=read_json(&path,MAX_CONTROL)?;
            if let Some(pending)=serialized.get_mut("pending"){normalize_inventory_reference(pending)?;}
            if let Some(references)=serialized.get_mut("cancelledCopyRefs").and_then(serde_json::Value::as_array_mut){for pending in references{normalize_inventory_reference(pending)?;}}
            let value:Control=serde_json::from_value(serialized).map_err(|_|StorageError::new("ControlInvalid"))?;
            validate(&value)?;Ok(Some(value))
        }
    }
}
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct StoredInventoryReference {relative_path:std::path::PathBuf,sha256:String}
fn normalize_inventory_reference(value:&mut serde_json::Value)->Result<()> {
    let Some(object)=value.as_object_mut()else{return Ok(());};let Some(references)=object.remove("inventoryVersions")else{return Ok(());};
    let references:Vec<StoredInventoryReference>=serde_json::from_value(references).map_err(|_|StorageError::new("ControlInvalid"))?;
    let id=object.get("operationId").and_then(serde_json::Value::as_str).ok_or_else(||StorageError::new("ControlInvalid"))?;
    let digest=object.get("inventoryHash").and_then(serde_json::Value::as_str).ok_or_else(||StorageError::new("ControlInvalid"))?;
    if references.is_empty()&&(digest.is_empty()||object.get("phase").and_then(serde_json::Value::as_str)==Some("cleaning")){return Ok(());}
    let expected=std::path::PathBuf::from(".frameq-storage/operations").join(id).join("inventory.json");
    if references.len()!=1||references[0].relative_path!=expected||references[0].sha256!=digest{return Err(StorageError::new("ControlInvalid"));}Ok(())
}
pub(super) fn validate(value:&Control)->Result<()> {
    if value.schema_version!=1 || !["legacy","managed"].contains(&value.active.mode.as_str())
        || !valid_uuid(&value.active.library_id) || !safe_absolute(&value.active.data_root)
        || (value.active.mode=="managed" && value.active.legacy_output_root.is_some()) {
        return Err(StorageError::new("ControlInvalid"));
    }
    let phases=["waiting","prepared","copying","verifying","publishing","restart_required","validating","cleaning"];
    let mut operation_ids=std::collections::HashSet::new();
    for pending in value.pending.iter().chain(value.cancelled_copy_refs.iter()) {
        if !phases.contains(&pending.phase.as_str()) || !valid_uuid(&pending.operation_id)||!valid_uuid(&pending.plan_token)||!operation_ids.insert(&pending.operation_id)
            || !safe_absolute(&pending.target) || !safe_absolute(&pending.previous.data_root) || !valid_uuid(&pending.previous.library_id)
            || pending.previous.library_id!=value.active.library_id || !["legacy","managed"].contains(&pending.previous.mode.as_str())
            || pending.window_id.is_empty() || pending.window_id.len()>128 || pending.legacy_sources.iter().any(|p|!safe_absolute(p))
            || (pending.phase!="waiting"&&!valid_hash(&pending.inventory_hash)) || (pending.phase=="waiting"&&!pending.inventory_hash.is_empty()&&!valid_hash(&pending.inventory_hash))
            || pending.files_completed>pending.files_total || pending.bytes_completed>pending.bytes_total {
            return Err(StorageError::new("ControlInvalid"));
        }
        let mut artifacts=std::collections::HashSet::new();
        for relocation in &pending.source_relocations{if !safe_absolute(&relocation.old_root)||!safe_absolute(&relocation.new_root)||relocation.old_root==relocation.new_root||relocation.root_identity!=pending.previous.root_identity||super::inventory::relocated_path(&relocation.new_root,&pending.source_relocations)!=pending.previous.data_root{return Err(StorageError::new("ControlInvalid"));}}
        for artifact in &pending.owned_artifacts {
            let expected_parent=std::path::PathBuf::from(".frameq-storage/operations").join(&pending.operation_id).join("temporary");
            if artifact.relative_path.parent()!=Some(expected_parent.as_path())||!artifact.relative_path.file_name().and_then(|n|n.to_str()).is_some_and(valid_uuid)||!["probe","json"].contains(&artifact.kind.as_str())||!artifacts.insert(&artifact.relative_path){return Err(StorageError::new("ControlInvalid"));}
            if artifact.kind=="probe"{if artifact.destination.is_some()||!artifact.expected_sha256.is_empty()||artifact.expected_length!=0{return Err(StorageError::new("ControlInvalid"));}}
            else {let inventory=std::path::PathBuf::from(".frameq-storage/operations").join(&pending.operation_id).join("inventory.json");let receipt=std::path::PathBuf::from(".frameq-storage/receipts").join(&pending.operation_id).join("inventory.json");if !valid_hash(&artifact.expected_sha256)||artifact.expected_length>super::inventory::MAX_INVENTORY||!artifact.destination.as_ref().is_some_and(|path|path==&inventory||path==&receipt||path==Path::new(".frameq-storage/store.json")){return Err(StorageError::new("ControlInvalid"));}}
        }
    }
    if let Some(p)=value.pending.as_ref(){
        let committed=matches!(p.phase.as_str(),"restart_required"|"validating");
        if committed {
            if p.previous.generation.checked_add(1)!=Some(value.active.generation)||p.target!=value.active.data_root||p.target_identity!=value.active.root_identity{return Err(StorageError::new("ControlInvalid"));}
        }else if p.previous.generation!=value.active.generation||p.previous.data_root!=value.active.data_root||p.previous.root_identity!=value.active.root_identity {
            return Err(StorageError::new("ControlInvalid"));
        }
    }
    let mut receipt_ids=std::collections::HashSet::new();
    for receipt in &value.cleanup_receipts {
        let expected=std::path::PathBuf::from(".frameq-storage/receipts").join(&receipt.operation_id).join("inventory.json");
        if !valid_uuid(&receipt.operation_id) || !valid_hash(&receipt.sha256)||!receipt_ids.insert(&receipt.operation_id)
            || receipt.relative_path!=expected || receipt.source_paths.iter().any(|p|!safe_absolute(p)) {
            return Err(StorageError::new("ControlInvalid"));
        }
    }
    Ok(())
}
fn valid_uuid(value:&str)->bool {uuid::Uuid::parse_str(value).is_ok_and(|id|!id.is_nil()&&id.hyphenated().to_string()==value)}
fn valid_hash(value:&str)->bool {value.len()==64&&value.bytes().all(|v|v.is_ascii_digit()||(b'a'..=b'f').contains(&v))}
fn safe_absolute(path:&Path)->bool {path.is_absolute()&&!path.components().any(|v|matches!(v,std::path::Component::ParentDir|std::path::Component::CurDir))}
pub(super) fn save(root:&Path,value:&Control)->Result<()> {
    validate(value)?;write_json(&root.join("data-storage.json"),value,MAX_CONTROL)
}
pub(super) fn safe_relative(path:&Path)->bool {
    !path.as_os_str().is_empty() && path.components().all(|v|matches!(v,std::path::Component::Normal(_)))
}
pub(super) fn legacy(root:&Path)->Result<ActiveStorage> {
    let values=crate::settings::parse_dotenv_values(&root.join(crate::settings::DOTENV_FILE_NAME)).map_err(|_|StorageError::new("ControlInvalid"))?;
    let output=crate::settings::configured_env_value(&values,crate::OUTPUT_DIR_ENV).map(std::path::PathBuf::from);
    Ok(ActiveStorage{mode:"legacy".into(),library_id:uuid::Uuid::new_v4().to_string(),generation:0,data_root:root.to_path_buf(),root_identity:safe_filesystem::identity(root)?,legacy_output_root:output})
}

pub(crate) fn paths_for_config(root:&Path)->Result<DataPaths> {
    let active=match load(root)? {Some(value)=>value.active,None=>legacy(root)?};
    validate_active(&active)?;
    Ok(DataPaths::from_active(&active))
}
