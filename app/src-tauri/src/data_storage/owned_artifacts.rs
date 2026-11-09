use super::{control,location::*,DataStorageManager,create_safe_dirs};
use crate::safe_filesystem;
use std::{fs,io::Write,path::Path};
use sha2::{Digest,Sha256};

impl DataStorageManager {
    pub(super) fn create_owned_artifact(&self,value:&mut Control,kind:&str,expected:Option<(&Path,&[u8])>)->Result<std::path::PathBuf> {
        let pending=value.pending.as_mut().ok_or_else(||StorageError::new("StaleOperation"))?;
        let relative=std::path::PathBuf::from(".app-storage/operations").join(&pending.operation_id).join("temporary").join(uuid::Uuid::new_v4().to_string());
        let path=pending.target.join(&relative);create_safe_dirs(path.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;
        let (destination,expected_sha256,expected_length)=if let Some((destination,bytes))=expected{(Some(destination.strip_prefix(&pending.target).map_err(|_|StorageError::new("UnsafePath"))?.to_path_buf()),format!("{:x}",Sha256::digest(bytes)),bytes.len()as u64)}else{(None,String::new(),0)};
        pending.owned_artifacts.push(OwnedArtifact{relative_path:relative,identity:None,kind:kind.into(),expected_sha256,expected_length,destination});self.persist(value)?;
        let parent=safe_filesystem::pin_directory(path.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;
        let identity=if kind=="probe"{parent.create_dir(path.file_name().ok_or_else(||StorageError::new("UnsafePath"))?)?;safe_filesystem::identity(&path)?}else{let file=parent.create_new(path.file_name().ok_or_else(||StorageError::new("UnsafePath"))?)?;safe_filesystem::file_identity(&file)?};
        value.pending.as_mut().unwrap().owned_artifacts.last_mut().unwrap().identity=Some(identity);self.persist(value)?;Ok(path)
    }
    pub(super) fn recover_owned_artifacts(&self,value:&mut Control)->Result<()> {
        let pending=value.pending.as_ref().ok_or_else(||StorageError::new("StaleOperation"))?;
        safe_filesystem::check_identity(&pending.target,pending.target_identity)?;
        for artifact in &pending.owned_artifacts {
            let path=pending.target.join(&artifact.relative_path);
            if !safe_filesystem::entry_exists(&path)?{continue;}
            if artifact.identity.is_none(){return Err(StorageError::new("TargetConflict"));}
            if artifact.kind=="probe" {
                let identity=safe_filesystem::identity(&path)?;
                if artifact.identity.is_some_and(|expected|expected!=identity){return Err(StorageError::new("TargetConflict"));}
                if fs::read_dir(&path)?.next().is_some(){return Err(StorageError::new("TargetConflict"));}
                safe_filesystem::check_identity(&path,identity)?;fs::remove_dir(&path)?;
            }else {
                let(length,hash,identity)=safe_filesystem::hash_file(&path)?;
                if artifact.identity.is_some_and(|expected|expected!=identity)||length!=0{return Err(StorageError::new("TargetConflict"));}
                if !safe_filesystem::remove_matching_file(&path,identity,length,&hash)?{return Err(StorageError::new("TargetConflict"));}
            }
        }
        value.pending.as_mut().unwrap().owned_artifacts.clear();self.persist(value)
    }
    pub(super) fn write_target_json<T:serde::Serialize>(&self,value:&mut Control,path:&Path,data:&T,max:u64)->Result<()> {
        let bytes=serde_json::to_vec(data).map_err(|_|StorageError::new("ControlInvalid"))?;
        if bytes.len()as u64>max{return Err(StorageError::new("ControlLimit"));}
        let relative=path.strip_prefix(&value.pending.as_ref().ok_or_else(||StorageError::new("StaleOperation"))?.target).map_err(|_|StorageError::new("UnsafePath"))?.to_path_buf();
        let expected_sha=format!("{:x}",Sha256::digest(&bytes));
        let pending=value.pending.as_ref().unwrap();let artifacts=pending.owned_artifacts.clone();
        for artifact in artifacts {if artifact.destination.as_ref()!=Some(&relative){continue;}
            if artifact.expected_length!=bytes.len()as u64||artifact.expected_sha256!=expected_sha{return Err(StorageError::new("TargetConflict"));}
            let temporary=value.pending.as_ref().unwrap().target.join(&artifact.relative_path);
            if safe_filesystem::entry_exists(&temporary)?{let(length,hash,identity)=safe_filesystem::hash_file(&temporary)?;
                if artifact.identity.is_none(){if length==0{continue;}return Err(StorageError::new("TargetConflict"));}
                if artifact.identity.is_some_and(|expected|expected!=identity)||artifact.identity.is_none()&&length!=0||length>bytes.len()as u64{return Err(StorageError::new("TargetConflict"));}
                let actual=fs::read(&temporary)?;if !bytes.starts_with(&actual)||!safe_filesystem::remove_matching_file(&temporary,identity,length,&hash)?{return Err(StorageError::new("TargetConflict"));}
            }
            value.pending.as_mut().unwrap().owned_artifacts.retain(|a|a.relative_path!=artifact.relative_path);self.persist(value)?;
        }
        if safe_filesystem::entry_exists(path)? {
            let expected:serde_json::Value=serde_json::from_slice(&bytes).map_err(|_|StorageError::new("ControlInvalid"))?;
            let actual:serde_json::Value=control::read_json(path,max)?;if actual!=expected{return Err(StorageError::new("TargetConflict"));}return Ok(());
        }
        let temporary=self.create_owned_artifact(value,"json",Some((path,&bytes)))?;
        let identity=value.pending.as_ref().unwrap().owned_artifacts.last().unwrap().identity.unwrap();
        let mut file=safe_filesystem::open_owned_writer(&temporary,identity)?;
        if safe_filesystem::file_identity(&file)?!=identity||file.metadata()?.len()!=0{return Err(StorageError::new("TargetConflict"));}
        for chunk in bytes.chunks(1024*1024){if value.pending.as_ref().is_some_and(|p|p.phase=="waiting")&&self.cancelled.load(std::sync::atomic::Ordering::Acquire){return Err(StorageError::new("Cancelled"));}file.write_all(chunk)?;}file.sync_all()?;
        if safe_filesystem::hash_open_file_while(&mut file,||true)?.1!=expected_sha{return Err(StorageError::new("VerificationFailed"));}
        create_safe_dirs(path.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;
        if safe_filesystem::entry_exists(path)?{return Err(StorageError::new("TargetConflict"));}
        let source=safe_filesystem::pin_directory(temporary.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;let target=safe_filesystem::pin_directory(path.parent().ok_or_else(||StorageError::new("UnsafePath"))?)?;
        safe_filesystem::install_owned_file(&file,&source,temporary.file_name().ok_or_else(||StorageError::new("UnsafePath"))?,&target,path.file_name().ok_or_else(||StorageError::new("UnsafePath"))?)?;
        let relative=temporary.strip_prefix(&value.pending.as_ref().unwrap().target).map_err(|_|StorageError::new("UnsafePath"))?.to_path_buf();
        value.pending.as_mut().unwrap().owned_artifacts.retain(|a|a.relative_path!=relative);
        self.persist(value)
    }
}
