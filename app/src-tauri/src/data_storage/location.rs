use serde::{Deserialize,Serialize};
use std::path::{Path,PathBuf};
use crate::safe_filesystem::{self,DirectoryIdentity};

pub(crate) type Result<T> = std::result::Result<T, StorageError>;
pub(super) fn required_nullable<'de,D,T>(deserializer:D)->std::result::Result<Option<T>,D::Error>
where D:serde::Deserializer<'de>,T:serde::Deserialize<'de>{Option::<T>::deserialize(deserializer)}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct StorageError { pub code:String }
impl StorageError { pub fn new(code:&str)->Self {Self{code:code.into()}} }
impl std::fmt::Display for StorageError {fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result {self.code.fmt(f)}}
impl std::error::Error for StorageError {}
impl From<std::io::Error> for StorageError {
    fn from(error:std::io::Error)->Self {
        if let Some(storage)=error.get_ref().and_then(|error|error.downcast_ref::<StorageError>()){return storage.clone();}
        Self::new(match error.kind() {
            std::io::ErrorKind::PermissionDenied=>"PermissionDenied",
            std::io::ErrorKind::StorageFull=>"InsufficientSpace",
            std::io::ErrorKind::NotFound=>"DataUnavailable",
            std::io::ErrorKind::InvalidInput=>"UnsafePath",
            std::io::ErrorKind::InvalidData=>"SourceChanged",
            std::io::ErrorKind::Interrupted=>"Cancelled",
            _=>"StorageIoFailed",
        })
    }
}

#[derive(Debug,Clone)]
pub(crate) struct DataPaths {
    pub data_root:PathBuf,pub output_root:PathBuf,pub cache_root:PathBuf,
    pub models_root:PathBuf,pub runtime_root:PathBuf,pub collections_path:PathBuf,
}
impl DataPaths {
    pub(super) fn from_active(active:&ActiveStorage)->Self {
        Self{data_root:active.data_root.clone(),output_root:active.legacy_output_root.clone().unwrap_or_else(||active.data_root.join("outputs")),
            cache_root:active.data_root.join("cache"),models_root:active.data_root.join("models"),runtime_root:active.data_root.join("runtime"),collections_path:active.data_root.join("collections.json")}
    }
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct ActiveStorage {
    pub mode:String,pub library_id:String,pub generation:u64,pub data_root:PathBuf,
    pub root_identity:DirectoryIdentity,#[serde(deserialize_with="required_nullable")] pub legacy_output_root:Option<PathBuf>,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct StoreMarker {pub schema_version:u8,pub library_id:String,pub generation:u64,pub root_identity:DirectoryIdentity}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct Control {
    pub schema_version:u8,pub active:ActiveStorage,#[serde(deserialize_with="required_nullable")] pub pending:Option<Pending>,
    pub cleanup_receipts:Vec<ReceiptRef>,pub cancelled_copy_refs:Vec<Pending>,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct Pending {
    pub operation_id:String,pub phase:String,pub previous:ActiveStorage,pub target:PathBuf,
    pub target_identity:DirectoryIdentity,pub inventory_hash:String,pub plan_token:String,pub window_id:String,
    pub files_total:u64,pub bytes_total:u64,pub files_completed:u64,pub bytes_completed:u64,
    #[serde(deserialize_with="required_nullable")] pub last_error:Option<String>,pub legacy_sources:Vec<PathBuf>,pub owned_artifacts:Vec<OwnedArtifact>,#[serde(default)] pub source_relocations:Vec<SourceRelocation>,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct SourceRelocation {pub old_root:PathBuf,pub new_root:PathBuf,pub root_identity:DirectoryIdentity}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct OwnedArtifact {pub relative_path:PathBuf,#[serde(deserialize_with="required_nullable")] pub identity:Option<DirectoryIdentity>,pub kind:String,pub expected_sha256:String,pub expected_length:u64,#[serde(deserialize_with="required_nullable")] pub destination:Option<PathBuf>}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct ReceiptRef {pub operation_id:String,pub relative_path:PathBuf,pub sha256:String,pub source_paths:Vec<PathBuf>,pub total_files:u64,pub total_bytes:u64}

#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct OperationView {
    pub operation_id:String,pub phase:String,pub source_paths:Vec<String>,pub target_path:String,
    pub total_files:u64,pub total_bytes:u64,pub completed_files:u64,pub completed_bytes:u64,
    pub can_cancel:bool,pub can_resume:bool,pub last_error:Option<String>,
}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct CleanupReceiptView {pub receipt_id:String,pub source_paths:Vec<String>,pub total_files:u64,pub total_bytes:u64}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct StorageStateView {
    pub schema_version:u8,pub generation:u64,pub data_access:String,pub mode:String,
    pub current_path:String,pub legacy_output_path:Option<String>,pub operation:Option<OperationView>,
    pub cleanup_receipts:Vec<CleanupReceiptView>,pub recovery_candidates:Vec<OperationView>,pub last_error:Option<String>,
}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct MigrationPreview {
    pub plan_token:String,pub operation_id:String,pub generation:u64,pub source_paths:Vec<String>,
    pub target_path:String,pub total_files:u64,pub total_bytes:u64,pub required_bytes:u64,pub available_bytes:u64,
}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct CleanupPreview {pub plan_token:String,pub receipt_id:String,pub generation:u64,pub total_files:u64,pub total_bytes:u64,pub retained_files:u64,pub source_paths:Vec<String>}

pub(super) fn display(path:&Path)->String {
    #[cfg(windows)] {
        use std::path::{Component,Prefix};let mut parts=path.components();
        if let Some(Component::Prefix(prefix))=parts.next(){let root=match prefix.kind(){Prefix::VerbatimDisk(drive)=>Some(format!("{}:/",char::from(drive))),Prefix::VerbatimUNC(server,share)=>Some(format!("//{}/{}/",server.to_string_lossy(),share.to_string_lossy())),_=>None};
            if let Some(root)=root{let tail:PathBuf=parts.filter(|part|!matches!(part,Component::RootDir)).collect();return root+&tail.to_string_lossy().replace('\\',"/");}
        }
    }
    path.to_string_lossy().replace('\\',"/")
}
pub(super) fn validate_active(active:&ActiveStorage)->Result<()> {
    safe_filesystem::check_identity(&active.data_root,active.root_identity)?;
    if active.mode=="managed" {
        let marker:StoreMarker=super::control::read_json(&active.data_root.join(".frameq-storage/store.json"),64*1024)?;
        if marker.schema_version!=1 || marker.library_id!=active.library_id || marker.generation!=active.generation || marker.root_identity!=active.root_identity {
            return Err(StorageError::new("DataUnavailable"));
        }
        let _outputs=safe_filesystem::open_directory(&active.data_root.join("outputs"))?;
    }
    Ok(())
}
