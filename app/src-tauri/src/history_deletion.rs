mod intent;
mod storage;

use crate::{append_desktop_log, collections, resolve_runtime_paths, task_manifest,
    ProcessSupervisors, RuntimePaths, AUDIO_REVIEW_CACHE_DIR_NAME};
use intent::{Intent, Phase};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};
use uuid::Uuid;

const PENDING: &str = "HISTORY_DELETE_CLEANUP_PENDING";

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct HistoryDeleteResult {
    pub(crate) task_id: String,
    pub(crate) status: &'static str,
    pub(crate) error_code: Option<&'static str>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct HistoryCleanupResult {
    pub(crate) task_id: Option<String>,
    pub(crate) status: &'static str,
    pub(crate) error_code: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HistoryDeleteError { Busy, Unavailable, UnsafeStorage, DeleteFailed }

impl HistoryDeleteError {
    fn public_code(self) -> &'static str {
        match self {
            Self::Busy => "HISTORY_DELETE_BUSY", Self::Unavailable => "HISTORY_DELETE_UNAVAILABLE",
            Self::UnsafeStorage => "HISTORY_DELETE_UNSAFE_STORAGE", Self::DeleteFailed => "HISTORY_DELETE_FAILED",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HistoryDeleteRequest {
    #[serde(alias = "taskId")]
    pub(crate) task_id: String,
}

#[derive(Default)]
pub(crate) struct HistoryDeletionState { lock: Mutex<()> }

struct Roots { output: PathBuf, cache: PathBuf, tasks: PathBuf }

impl Roots {
    fn resolve(paths: &RuntimePaths) -> Result<Self, HistoryDeleteError> {
        let output = task_manifest::configured_output_root(paths).map_err(|_| HistoryDeleteError::UnsafeStorage)?;
        storage::validate_ancestors(&paths.user_data_dir)?;
        storage::validate_ancestors(&output)?;
        let output = output.canonicalize().map_err(|_| HistoryDeleteError::UnsafeStorage)?;
        let cache = paths.cache_root().map_err(|_| HistoryDeleteError::UnsafeStorage)?;
        storage::validate_ancestors(&cache)?;
        let tasks = output.join(task_manifest::TASKS_DIR_NAME);
        storage::validate_ancestors(&tasks)?;
        Ok(Self { output, cache, tasks })
    }
    fn task(&self, job: &Intent) -> PathBuf { self.tasks.join(&job.task_id) }
    fn task_stage(&self, job: &Intent) -> PathBuf { self.output.join(format!(".app-delete-{}", job.operation_id)) }
    fn worker_root(&self) -> PathBuf { self.cache.join("tasks") }
    fn review_root(&self) -> PathBuf { self.cache.join(AUDIO_REVIEW_CACHE_DIR_NAME) }
    fn cache_stage(&self, job: &Intent, kind: &str) -> PathBuf {
        self.cache.join(format!(".app-delete-{}-{kind}", job.operation_id))
    }
    fn validate(&self, paths: &RuntimePaths, job: &Intent) -> Result<(), HistoryDeleteError> {
        storage::validate_ancestors(&paths.user_data_dir)?;
        storage::validate_ancestors(&self.output)?;
        storage::check_identity(&paths.user_data_dir, job.user_root)?;
        storage::check_identity(&self.output, job.output_root)?;
        storage::check_identity(&self.tasks, job.tasks_root)?;
        if let Some(expected) = job.cache_root { storage::check_identity(&self.cache, expected)?; }
        if let Some(expected) = job.worker_root { storage::check_identity(&self.worker_root(), expected)?; }
        if let Some(expected) = job.review_root { storage::check_identity(&self.review_root(), expected)?; }
        Ok(())
    }
    fn pin(&self, paths: &RuntimePaths, job: &Intent) -> Result<Vec<std::fs::File>, HistoryDeleteError> {
        self.validate(paths, job)?;
        let mut handles = Vec::new();
        for (path, expected) in [(&paths.user_data_dir, job.user_root), (&self.output, job.output_root), (&self.tasks, job.tasks_root)] {
            handles.push(storage::pin_directory(path, expected)?);
        }
        if let Some(expected) = job.cache_root { handles.push(storage::pin_directory(&self.cache, expected)?); }
        if let Some(expected) = job.worker_root { handles.push(storage::pin_directory(&self.worker_root(), expected)?); }
        if let Some(expected) = job.review_root { handles.push(storage::pin_directory(&self.review_root(), expected)?); }
        Ok(handles)
    }
}

pub(crate) fn guard_pending_task(paths: &RuntimePaths, task_id: &str) -> Result<(), String> {
    match intent::read(paths).map_err(|error| error.public_code().to_string())? {
        Some(job) if job.task_id == task_id.trim() => Err(PENDING.to_string()),
        _ => Ok(()),
    }
}

pub(crate) fn deletion_is_accepted(paths: &RuntimePaths, task_id: &str) -> Result<bool, String> {
    let inspect = || -> Result<bool, HistoryDeleteError> {
        let Some(job) = intent::read(paths)? else { return Ok(false); };
        if job.task_id != task_id.trim() { return Ok(false); }
        if job.phase == Phase::Accepted { return Ok(true); }
        let roots = Roots::resolve(paths)?;
        roots.validate(paths, &job)?;
        match storage::optional_identity(&roots.task_stage(&job))? {
            Some(identity) if identity == job.task => Ok(true),
            Some(_) => Err(HistoryDeleteError::UnsafeStorage),
            None if storage::optional_identity(&roots.task(&job))? == Some(job.task) => Ok(false),
            None => Err(HistoryDeleteError::UnsafeStorage),
        }
    };
    inspect().map_err(|error| error.public_code().to_string())
}

fn prepare(paths: &RuntimePaths, roots: &Roots, task_id: &str) -> Result<(Intent, task_manifest::SupportedTask), HistoryDeleteError> {
    if !intent::valid_task_id(task_id) { return Err(HistoryDeleteError::Unavailable); }
    let task = task_manifest::SupportedTask::open(&roots.output, task_id)
        .map_err(|error| if error == "Task is busy. Try again shortly." { HistoryDeleteError::Busy } else { HistoryDeleteError::Unavailable })?;
    storage::validate_tree(task.task_dir())?;
    let worker = roots.worker_root().join(task_id);
    let review = roots.review_root().join(task_id);
    let worker_cache = storage::optional_identity(&worker)?;
    let review_cache = storage::optional_identity(&review)?;
    if worker_cache.is_some() { storage::validate_ancestors(&roots.worker_root())?; storage::validate_tree(&worker)?; }
    if review_cache.is_some() { storage::validate_ancestors(&roots.review_root())?; storage::validate_tree(&review)?; }
    collections::validate_for_note_deletion(paths).map_err(|_| HistoryDeleteError::DeleteFailed)?;
    let job = Intent { schema_version: 1, operation_id: Uuid::new_v4().hyphenated().to_string(),
        task_id: task_id.to_string(), phase: Phase::Prepared,
        user_root: storage::identity(&paths.user_data_dir)?, output_root: storage::identity(&roots.output)?,
        tasks_root: storage::identity(&roots.tasks)?, task: storage::identity(task.task_dir())?,
        cache_root: storage::optional_identity(&roots.cache)?,
        worker_root: storage::optional_identity(&roots.worker_root())?,
        review_root: storage::optional_identity(&roots.review_root())?, worker_cache, review_cache,
    };
    Ok((job, task))
}

fn pending(job: &Intent) -> HistoryDeleteResult {
    HistoryDeleteResult { task_id: job.task_id.clone(), status: "cleanup_pending", error_code: Some(PENDING) }
}

fn stage_cache(source: &Path, target: &Path, expected: Option<storage::Identity>) -> Result<(), HistoryDeleteError> {
    let Some(expected) = expected else { return Ok(()); };
    if let Some(staged) = storage::optional_identity(target)? {
        if staged != expected { return Err(HistoryDeleteError::UnsafeStorage); }
        return Ok(());
    }
    match storage::optional_identity(source)? {
        Some(actual) if actual == expected => {
            storage::stage_directory(source, target, expected)?;
            storage::check_identity(target, expected)
        },
        Some(_) => Err(HistoryDeleteError::UnsafeStorage),
        None => Ok(()),
    }
}

fn finish_cleanup(paths: &RuntimePaths, roots: &Roots, job: &Intent) -> Result<(), HistoryDeleteError> {
    roots.validate(paths, job)?;
    stage_cache(&roots.worker_root().join(&job.task_id), &roots.cache_stage(job, "worker"), job.worker_cache)?;
    roots.validate(paths, job)?;
    stage_cache(&roots.review_root().join(&job.task_id), &roots.cache_stage(job, "review"), job.review_cache)?;
    roots.validate(paths, job)?;
    collections::prune_deleted_note_memberships(paths, &job.task_id).map_err(|_| HistoryDeleteError::DeleteFailed)?;
    for (path, expected) in [(roots.task_stage(job), Some(job.task)),
        (roots.cache_stage(job, "worker"), job.worker_cache), (roots.cache_stage(job, "review"), job.review_cache)] {
        roots.validate(paths, job)?;
        if let Some(actual) = storage::optional_identity(&path)? {
            if Some(actual) != expected { return Err(HistoryDeleteError::UnsafeStorage); }
            storage::remove_staged(&path, actual)?;
        }
    }
    roots.validate(paths, job)?;
    intent::clear(paths, job)
}

fn complete_accepted_move(paths: &RuntimePaths, roots: &Roots, mut job: Intent) -> HistoryDeleteResult {
    job.phase = Phase::Accepted;
    if intent::write(paths, &job).is_err()
        || storage::check_identity(&roots.task_stage(&job), job.task).is_err()
        || finish_cleanup(paths, roots, &job).is_err() {
        return pending(&job);
    }
    HistoryDeleteResult { task_id: job.task_id, status: "completed", error_code: None }
}

fn delete_from_paths(
    paths: &RuntimePaths, task_id: &str, supervisors: &ProcessSupervisors, state: &HistoryDeletionState,
) -> Result<HistoryDeleteResult, HistoryDeleteError> {
    let _guard = state.lock.try_lock().map_err(|_| HistoryDeleteError::Busy)?;
    if supervisors.is_task_active() || intent::read(paths)?.is_some() { return Err(HistoryDeleteError::Busy); }
    let roots = Roots::resolve(paths)?;
    let (job, _task_lease) = prepare(paths, &roots, task_id)?;
    let _root_handles = roots.pin(paths, &job)?;
    intent::write(paths, &job)?;
    roots.validate(paths, &job)?;
    if storage::stage_directory(&roots.task(&job), &roots.task_stage(&job), job.task).is_err() {
        if storage::optional_identity(&roots.task_stage(&job))? == Some(job.task) {
            return Ok(pending(&job));
        }
        if storage::optional_identity(&roots.task_stage(&job))?.is_none()
            && storage::optional_identity(&roots.task(&job))? == Some(job.task) {
            intent::clear(paths, &job)?;
            return Err(HistoryDeleteError::DeleteFailed);
        }
        return Err(HistoryDeleteError::UnsafeStorage);
    }
    Ok(complete_accepted_move(paths, &roots, job))
}

#[cfg(test)]
pub(crate) fn delete_from_paths_for_test(
    paths: &RuntimePaths, task_id: &str, supervisors: &ProcessSupervisors, state: &HistoryDeletionState,
) -> Result<HistoryDeleteResult, HistoryDeleteError> {
    delete_from_paths(paths, task_id, supervisors, state)
}

fn resume_from_paths(
    paths: &RuntimePaths, supervisors: &ProcessSupervisors, state: &HistoryDeletionState,
) -> Result<HistoryCleanupResult, HistoryDeleteError> {
    let _guard = state.lock.try_lock().map_err(|_| HistoryDeleteError::Busy)?;
    if supervisors.is_task_active() { return Err(HistoryDeleteError::Busy); }
    let Some(mut job) = intent::read(paths)? else {
        return Ok(HistoryCleanupResult { task_id: None, status: "idle", error_code: None });
    };
    let roots = match Roots::resolve(paths) {
        Ok(roots) => roots,
        Err(_) if job.phase == Phase::Prepared => return Err(HistoryDeleteError::UnsafeStorage),
        Err(_) => return Ok(HistoryCleanupResult { task_id: Some(job.task_id), status: "cleanup_pending", error_code: Some(PENDING) }),
    };
    let _lease = task_manifest::acquire_task_mutation(&roots.output, &job.task_id).map_err(|_| HistoryDeleteError::Busy)?;
    let _root_handles = match roots.pin(paths, &job) {
        Ok(handles) => handles,
        Err(_) if job.phase == Phase::Prepared => return Err(HistoryDeleteError::UnsafeStorage),
        Err(_) => return Ok(HistoryCleanupResult { task_id: Some(job.task_id), status: "cleanup_pending", error_code: Some(PENDING) }),
    };
    let staged = match storage::optional_identity(&roots.task_stage(&job)) {
        Ok(staged) => staged,
        Err(_) if job.phase == Phase::Accepted => return Ok(HistoryCleanupResult {
            task_id: Some(job.task_id), status: "cleanup_pending", error_code: Some(PENDING),
        }),
        Err(error) => return Err(error),
    };
    if job.phase == Phase::Prepared && staged.is_none() {
        if storage::optional_identity(&roots.task(&job))? != Some(job.task) { return Err(HistoryDeleteError::UnsafeStorage); }
        intent::clear(paths, &job)?;
        return Ok(HistoryCleanupResult { task_id: None, status: "idle", error_code: None });
    }
    if staged.is_some_and(|actual| actual != job.task) {
        if job.phase == Phase::Prepared { return Err(HistoryDeleteError::UnsafeStorage); }
        return Ok(HistoryCleanupResult { task_id: Some(job.task_id), status: "cleanup_pending", error_code: Some(PENDING) });
    }
    if staged.is_none() {
        match storage::optional_identity(&roots.task(&job)) {
            Ok(Some(original)) if original == job.task => return Ok(HistoryCleanupResult {
                task_id: Some(job.task_id), status: "cleanup_pending", error_code: Some(PENDING),
            }),
            Err(_) => return Ok(HistoryCleanupResult {
                task_id: Some(job.task_id), status: "cleanup_pending", error_code: Some(PENDING),
            }),
            _ => {},
        }
    }
    job.phase = Phase::Accepted;
    let completed = intent::write(paths, &job).and_then(|_| finish_cleanup(paths, &roots, &job)).is_ok();
    Ok(HistoryCleanupResult { task_id: Some(job.task_id),
        status: if completed { "completed" } else { "cleanup_pending" },
        error_code: if completed { None } else { Some(PENDING) } })
}

pub(crate) fn prepare_storage_migration_from_paths(
    paths: &RuntimePaths,
    supervisors: &ProcessSupervisors,
    state: &HistoryDeletionState,
) -> Result<(), String> {
    let result = resume_from_paths(paths, supervisors, state)
        .map_err(|error| error.public_code().to_string())?;
    if result.status == "cleanup_pending" {
        return Err(PENDING.to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_history_task(
    app: AppHandle, process_supervisors: State<'_, Arc<ProcessSupervisors>>,
    deletion_state: State<'_, Arc<HistoryDeletionState>>, request: HistoryDeleteRequest,
) -> Result<HistoryDeleteResult, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let paths = resolve_runtime_paths(&app).map_err(|_| "HISTORY_DELETE_FAILED".to_string())?;
    let result = delete_from_paths(&paths, &request.task_id, process_supervisors.inner(), deletion_state.inner());
    let outcome = match &result { Ok(value) => value.status, Err(error) => error.public_code() };
    let _ = append_desktop_log(&paths, "history.delete", &format!("outcome={outcome}"));
    result.map_err(|error| error.public_code().to_string())
}

#[tauri::command]
pub(crate) fn resume_note_deletion_cleanup(
    app: AppHandle, process_supervisors: State<'_, Arc<ProcessSupervisors>>,
    deletion_state: State<'_, Arc<HistoryDeletionState>>,
) -> Result<HistoryCleanupResult, String> {
    let _storage_access = crate::data_storage::acquire_data_access(&app)?;
    let paths = resolve_runtime_paths(&app).map_err(|_| "HISTORY_DELETE_FAILED".to_string())?;
    resume_from_paths(&paths, process_supervisors.inner(), deletion_state.inner())
        .map_err(|error| error.public_code().to_string())
}

#[cfg(test)] mod tests;
