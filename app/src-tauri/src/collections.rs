use crate::{atomic_files, resolve_runtime_paths, task_manifest, RuntimePaths};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::Path;
use std::sync::Mutex;
use tauri::AppHandle;
use uuid::Uuid;

const READ_FAILED: &str = "COLLECTIONS_READ_FAILED";
const WRITE_FAILED: &str = "COLLECTIONS_WRITE_FAILED";
const DATA_INVALID: &str = "COLLECTIONS_DATA_INVALID";
const NOT_FOUND: &str = "COLLECTION_NOT_FOUND";
const NAME_INVALID: &str = "COLLECTION_NAME_INVALID";
const NAME_EXISTS: &str = "COLLECTION_NAME_EXISTS";
const TASK_UNAVAILABLE: &str = "COLLECTION_TASK_UNAVAILABLE";
static COLLECTIONS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CollectionView {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) task_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CollectionsView {
    pub(crate) schema_version: u8,
    pub(crate) collections: Vec<CollectionView>,
}

impl Default for CollectionsView {
    fn default() -> Self {
        Self {
            schema_version: 1,
            collections: Vec::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateCollectionRequest {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RenameCollectionRequest {
    collection_id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CollectionRequest {
    collection_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MembershipRequest {
    collection_id: String,
    task_id: String,
    included: bool,
}

#[tauri::command]
pub(crate) fn get_collections(app: AppHandle) -> Result<CollectionsView, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let paths = resolve_runtime_paths(&app).map_err(|_| READ_FAILED.to_string())?;
    get_collections_from_paths(&paths).map_err(str::to_string)
}

#[tauri::command]
pub(crate) fn create_collection(
    app: AppHandle,
    request: CreateCollectionRequest,
) -> Result<CollectionsView, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let paths = resolve_runtime_paths(&app).map_err(|_| WRITE_FAILED.to_string())?;
    create_collection_from_paths(&paths, &request.name).map_err(str::to_string)
}

#[tauri::command]
pub(crate) fn rename_collection(
    app: AppHandle,
    request: RenameCollectionRequest,
) -> Result<CollectionsView, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let paths = resolve_runtime_paths(&app).map_err(|_| WRITE_FAILED.to_string())?;
    rename_collection_from_paths(&paths, &request.collection_id, &request.name)
        .map_err(str::to_string)
}

#[tauri::command]
pub(crate) fn delete_collection(
    app: AppHandle,
    request: CollectionRequest,
) -> Result<CollectionsView, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let paths = resolve_runtime_paths(&app).map_err(|_| WRITE_FAILED.to_string())?;
    delete_collection_from_paths(&paths, &request.collection_id).map_err(str::to_string)
}

#[tauri::command]
pub(crate) fn set_collection_task_membership(
    app: AppHandle,
    request: MembershipRequest,
) -> Result<CollectionsView, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let paths = resolve_runtime_paths(&app).map_err(|_| WRITE_FAILED.to_string())?;
    set_collection_task_membership_from_paths(
        &paths,
        &request.collection_id,
        &request.task_id,
        request.included,
    )
    .map_err(str::to_string)
}

fn get_collections_from_paths(paths: &RuntimePaths) -> Result<CollectionsView, &'static str> {
    let _guard = COLLECTIONS_LOCK.lock().map_err(|_| READ_FAILED)?;
    let stored = read_store(&paths.collections_path().map_err(|_| READ_FAILED)?)?;
    let tasks = available_tasks(paths)?;
    Ok(project_available_memberships(stored, &tasks))
}

#[cfg(test)]
pub(crate) fn get_collections_from_paths_for_test(paths: &RuntimePaths) -> Result<CollectionsView, &'static str> {
    get_collections_from_paths(paths)
}

#[cfg(test)]
pub(crate) fn include_note_for_test(paths: &RuntimePaths, collection_id: &str, task_id: &str) -> Result<CollectionsView, &'static str> {
    set_collection_task_membership_from_paths(paths, collection_id, task_id, true)
}

fn create_collection_from_paths(
    paths: &RuntimePaths,
    name: &str,
) -> Result<CollectionsView, &'static str> {
    let name = normalized_name(name)?;
    mutate_collections(paths, |stored, _tasks| {
        ensure_unique_name(stored, &name, None)?;
        stored.collections.push(CollectionView {
            id: Uuid::new_v4().hyphenated().to_string(),
            name,
            task_ids: Vec::new(),
        });
        Ok(())
    })
}

fn rename_collection_from_paths(
    paths: &RuntimePaths,
    collection_id: &str,
    name: &str,
) -> Result<CollectionsView, &'static str> {
    let name = normalized_name(name)?;
    mutate_collections(paths, |stored, _tasks| {
        let index = collection_index(stored, collection_id)?;
        ensure_unique_name(stored, &name, Some(collection_id))?;
        stored.collections[index].name = name;
        Ok(())
    })
}

fn delete_collection_from_paths(
    paths: &RuntimePaths,
    collection_id: &str,
) -> Result<CollectionsView, &'static str> {
    mutate_collections(paths, |stored, _tasks| {
        let index = collection_index(stored, collection_id)?;
        stored.collections.remove(index);
        Ok(())
    })
}

fn set_collection_task_membership_from_paths(
    paths: &RuntimePaths,
    collection_id: &str,
    task_id: &str,
    included: bool,
) -> Result<CollectionsView, &'static str> {
    if !valid_task_id(task_id) {
        return Err(TASK_UNAVAILABLE);
    }
    mutate_collections(paths, |stored, tasks| {
        let index = collection_index(stored, collection_id)?;
        if included {
            crate::history_deletion::guard_pending_task(paths, task_id).map_err(|_| TASK_UNAVAILABLE)?;
        }
        if included && !tasks.iter().any(|task| task.task_id() == task_id) {
            return Err(TASK_UNAVAILABLE);
        }
        let task_ids = &mut stored.collections[index].task_ids;
        if included {
            if !task_ids.iter().any(|id| id == task_id) {
                task_ids.push(task_id.to_string());
            }
        } else {
            task_ids.retain(|id| id != task_id);
        }
        Ok(())
    })
}

fn mutate_collections(
    paths: &RuntimePaths,
    mutate: impl FnOnce(
        &mut CollectionsView,
        &[task_manifest::SupportedTask],
    ) -> Result<(), &'static str>,
) -> Result<CollectionsView, &'static str> {
    let _guard = COLLECTIONS_LOCK.lock().map_err(|_| WRITE_FAILED)?;
    let path = paths.collections_path().map_err(|_| WRITE_FAILED)?;
    let mut stored = read_store(&path)?;
    let tasks = available_tasks(paths)?;
    mutate(&mut stored, &tasks)?;
    let content = serde_json::to_vec_pretty(&stored).map_err(|_| WRITE_FAILED)?;
    safe_storage_entry(&path).map_err(|_| WRITE_FAILED)?;
    atomic_files::atomic_write(&path, &content).map_err(|_| WRITE_FAILED)?;
    Ok(project_available_memberships(stored, &tasks))
}

fn available_tasks(
    paths: &RuntimePaths,
) -> Result<Vec<task_manifest::SupportedTask>, &'static str> {
    let output_root = task_manifest::configured_output_root(paths).map_err(|_| READ_FAILED)?;
    let tasks = task_manifest::SupportedTask::scan_read_only(&output_root)
        .map(|scan| scan.into_tasks()).map_err(|_| READ_FAILED)?;
    let mut available = Vec::new();
    for task in tasks {
        match crate::history_deletion::deletion_is_accepted(paths, task.task_id()) {
            Ok(false) => available.push(task),
            Ok(true) => {},
            Err(_) => return Err(READ_FAILED),
        }
    }
    Ok(available)
}

pub(crate) fn validate_for_note_deletion(paths: &RuntimePaths) -> Result<(), &'static str> {
    let _guard = COLLECTIONS_LOCK.lock().map_err(|_| READ_FAILED)?;
    read_store(&paths.collections_path().map_err(|_| READ_FAILED)?).map(|_| ())
}

pub(crate) fn read_for_storage_validation(path: &Path) -> Result<CollectionsView, String> {
    let _guard = COLLECTIONS_LOCK.lock().map_err(|_| READ_FAILED.to_string())?;
    read_store(path).map_err(str::to_string)
}

pub(crate) fn validate_storage_snapshot(stored: &CollectionsView) -> Result<(), String> {
    validate_store(stored).map_err(str::to_string)
}

pub(crate) fn prune_deleted_note_memberships(
    paths: &RuntimePaths, task_id: &str,
) -> Result<(), &'static str> {
    if !valid_task_id(task_id) { return Err(TASK_UNAVAILABLE); }
    let _guard = COLLECTIONS_LOCK.lock().map_err(|_| WRITE_FAILED)?;
    let path = paths.collections_path().map_err(|_| WRITE_FAILED)?;
    let mut stored = read_store(&path)?;
    let mut changed = false;
    for collection in &mut stored.collections {
        let previous = collection.task_ids.len();
        collection.task_ids.retain(|id| id != task_id);
        changed |= previous != collection.task_ids.len();
    }
    if !changed { return Ok(()); }
    let content = serde_json::to_vec_pretty(&stored).map_err(|_| WRITE_FAILED)?;
    safe_storage_entry(&path).map_err(|_| WRITE_FAILED)?;
    atomic_files::atomic_write(&path, &content).map_err(|_| WRITE_FAILED)
}

fn project_available_memberships(
    mut stored: CollectionsView,
    tasks: &[task_manifest::SupportedTask],
) -> CollectionsView {
    let available: HashSet<&str> = tasks.iter().map(|task| task.task_id()).collect();
    for collection in &mut stored.collections {
        collection
            .task_ids
            .retain(|id| available.contains(id.as_str()));
    }
    stored
}

fn collection_index(stored: &CollectionsView, id: &str) -> Result<usize, &'static str> {
    stored
        .collections
        .iter()
        .position(|collection| collection.id == id)
        .ok_or(NOT_FOUND)
}

fn ensure_unique_name(
    stored: &CollectionsView,
    name: &str,
    excluded_id: Option<&str>,
) -> Result<(), &'static str> {
    let normalized = name.to_lowercase();
    if stored.collections.iter().any(|collection| {
        Some(collection.id.as_str()) != excluded_id && collection.name.to_lowercase() == normalized
    }) {
        return Err(NAME_EXISTS);
    }
    Ok(())
}

fn normalized_name(name: &str) -> Result<String, &'static str> {
    if name.chars().any(char::is_control) {
        return Err(NAME_INVALID);
    }
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 80 {
        return Err(NAME_INVALID);
    }
    Ok(trimmed.to_string())
}

fn valid_task_id(task_id: &str) -> bool {
    !task_id.is_empty()
        && task_id == task_id.trim()
        && !matches!(task_id, "." | "..")
        && !task_id
            .chars()
            .any(|value| value.is_control() || matches!(value, '/' | '\\' | ':'))
}

fn read_store(path: &Path) -> Result<CollectionsView, &'static str> {
    if !safe_storage_entry(path).map_err(|_| READ_FAILED)? {
        return Ok(CollectionsView::default());
    }
    let content = fs::read(path).map_err(|_| READ_FAILED)?;
    let stored: CollectionsView = serde_json::from_slice(&content).map_err(|_| DATA_INVALID)?;
    validate_store(&stored)?;
    Ok(stored)
}

fn validate_store(stored: &CollectionsView) -> Result<(), &'static str> {
    if stored.schema_version != 1 {
        return Err(DATA_INVALID);
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for collection in &stored.collections {
        let id = Uuid::parse_str(&collection.id).map_err(|_| DATA_INVALID)?;
        if id.is_nil()
            || id.hyphenated().to_string() != collection.id
            || !ids.insert(&collection.id)
            || normalized_name(&collection.name).map_err(|_| DATA_INVALID)? != collection.name
            || !names.insert(collection.name.to_lowercase())
        {
            return Err(DATA_INVALID);
        }
        let mut task_ids = HashSet::new();
        for task_id in &collection.task_ids {
            if !valid_task_id(task_id) || !task_ids.insert(task_id) {
                return Err(DATA_INVALID);
            }
        }
    }
    Ok(())
}

fn safe_storage_entry(path: &Path) -> Result<bool, ()> {
    if !path.is_absolute() {
        return Err(());
    }
    let mut file_exists = false;
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                if atomic_files::is_link_or_reparse_point(&metadata)
                    || (ancestor == path && !metadata.is_file())
                    || (ancestor != path && !metadata.is_dir())
                {
                    return Err(());
                }
                if ancestor == path {
                    file_exists = true;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err(()),
        }
    }
    Ok(file_exists)
}

#[cfg(test)]
mod tests;
