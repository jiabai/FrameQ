use super::{storage, HistoryDeleteError as Error};
use crate::{atomic_files, RuntimePaths};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;
use uuid::Uuid;

pub(super) const FILE_NAME: &str = ".frameq-note-deletion.json";
const MAX_BYTES: u64 = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Phase { Prepared, Accepted }

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Intent {
    pub schema_version: u8,
    pub operation_id: String,
    pub task_id: String,
    pub phase: Phase,
    pub user_root: storage::Identity,
    pub output_root: storage::Identity,
    pub tasks_root: storage::Identity,
    #[serde(deserialize_with = "required_nullable")]
    pub cache_root: Option<storage::Identity>,
    #[serde(deserialize_with = "required_nullable")]
    pub worker_root: Option<storage::Identity>,
    #[serde(deserialize_with = "required_nullable")]
    pub review_root: Option<storage::Identity>,
    pub task: storage::Identity,
    #[serde(deserialize_with = "required_nullable")]
    pub worker_cache: Option<storage::Identity>,
    #[serde(deserialize_with = "required_nullable")]
    pub review_cache: Option<storage::Identity>,
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where D: serde::Deserializer<'de>, T: Deserialize<'de> {
    Option::<T>::deserialize(deserializer)
}

impl Intent {
    fn validate(&self) -> Result<(), Error> {
        if self.schema_version != 1 || !valid_task_id(&self.task_id)
            || Uuid::parse_str(&self.operation_id).ok().filter(|id| !id.is_nil())
                .map(|id| id.hyphenated().to_string()).as_deref() != Some(self.operation_id.as_str())
            || (self.worker_cache.is_some() && (self.worker_root.is_none() || self.cache_root.is_none()))
            || (self.review_cache.is_some() && (self.review_root.is_none() || self.cache_root.is_none()))
            || (self.cache_root.is_none() && (self.worker_root.is_some() || self.review_root.is_some()))
        { return Err(Error::UnsafeStorage); }
        Ok(())
    }
}

pub(super) fn valid_task_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 255 && value == value.trim()
        && !matches!(value, "." | "..")
        && !value.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
}

pub(super) fn path(paths: &RuntimePaths) -> PathBuf { paths.user_data_dir.join(FILE_NAME) }

pub(super) fn read(paths: &RuntimePaths) -> Result<Option<Intent>, Error> {
    storage::validate_ancestors(&paths.user_data_dir)?;
    let path = path(paths);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Ok(meta) if meta.is_file() && !atomic_files::is_link_or_reparse_point(&meta)
            && meta.len() <= MAX_BYTES => {},
        _ => return Err(Error::UnsafeStorage),
    }
    let mut bytes = Vec::new();
    storage::open_regular(&path)?.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes).map_err(|_| Error::UnsafeStorage)?;
    if bytes.len() as u64 > MAX_BYTES { return Err(Error::UnsafeStorage); }
    let intent: Intent = serde_json::from_slice(&bytes).map_err(|_| Error::UnsafeStorage)?;
    intent.validate()?;
    Ok(Some(intent))
}

pub(super) fn write(paths: &RuntimePaths, intent: &Intent) -> Result<(), Error> {
    intent.validate()?;
    storage::check_identity(&paths.user_data_dir, intent.user_root)?;
    let path = path(paths);
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if !metadata.is_file() || atomic_files::is_link_or_reparse_point(&metadata) {
            return Err(Error::UnsafeStorage);
        }
    }
    let bytes = serde_json::to_vec(intent).map_err(|_| Error::DeleteFailed)?;
    if bytes.len() as u64 > MAX_BYTES { return Err(Error::UnsafeStorage); }
    atomic_files::atomic_write(&path, &bytes).map_err(|_| Error::DeleteFailed)
}

pub(super) fn clear(paths: &RuntimePaths, expected: &Intent) -> Result<(), Error> {
    let current = read(paths)?.ok_or(Error::UnsafeStorage)?;
    if current.operation_id != expected.operation_id { return Err(Error::UnsafeStorage); }
    storage::check_identity(&paths.user_data_dir, expected.user_root)?;
    fs::remove_file(path(paths)).map_err(|_| Error::DeleteFailed)
}
