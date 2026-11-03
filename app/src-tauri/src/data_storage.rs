#[path = "data_storage/engine.rs"]
mod engine;
#[path = "data_storage/preflight.rs"]
mod preflight;

pub(crate) use engine::*;
pub(crate) use preflight::PreflightKind;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Window};
use tauri_plugin_dialog::DialogExt;

const PROGRESS_EVENT: &str = "data-storage-progress";
const MAX_SELECTIONS: usize = 32;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DirectoryPurpose { Target, LegacySource, Relink }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectorySelectionView { selection_token: String, path: String }

#[derive(Clone)]
struct SelectedDirectory {
    path: PathBuf,
    identity: crate::safe_filesystem::DirectoryIdentity,
    purpose: DirectoryPurpose,
    window: String,
    generation: u64,
}

#[derive(Default)]
struct MediaAccess {
    allowed: Vec<PathBuf>,
    last_paths: Vec<PathBuf>,
    revoked: HashSet<PathBuf>,
    restart_required: bool,
}

pub(crate) struct StorageService {
    fixed: crate::RuntimePaths,
    manager: Mutex<Option<Arc<DataStorageManager>>>,
    open_error: Mutex<Option<String>>,
    selections: Mutex<HashMap<String, SelectedDirectory>>,
    preflight: preflight::Registry,
    media: Mutex<MediaAccess>,
    web_recovery: Mutex<Option<Result<(), String>>>,
    validating: AtomicBool,
    close_requested: Mutex<HashSet<String>>,
    exit_requested: AtomicBool,
    restart_authorized: AtomicBool,
    close_authorized: AtomicBool,
    close_waiter: AtomicBool,
}

impl StorageService {
    fn new(fixed: crate::RuntimePaths) -> Self {
        let result = DataStorageManager::open(fixed.user_data_dir.clone(), fixed.resource_dir.clone());
        let (manager, open_error) = match result {
            Ok(manager) => (Some(Arc::new(manager)), None),
            Err(error) => (None, Some(error.to_string())),
        };
        Self {
            fixed, manager: Mutex::new(manager), open_error: Mutex::new(open_error),
            selections: Mutex::new(HashMap::new()), media: Mutex::new(MediaAccess::default()),
            preflight: preflight::Registry::default(),
            web_recovery: Mutex::new(None),
            validating: AtomicBool::new(false), close_requested: Mutex::new(HashSet::new()),
            exit_requested: AtomicBool::new(false),
            restart_authorized: AtomicBool::new(false), close_waiter: AtomicBool::new(false),
            close_authorized: AtomicBool::new(false),
        }
    }

    fn manager(&self) -> Result<Arc<DataStorageManager>, String> {
        if let Some(manager) = self.manager.lock().map_err(|_| "StorageIoFailed")?.clone() { return Ok(manager); }
        Err(self.open_error.lock().map_err(|_| "StorageIoFailed")?.clone()
            .unwrap_or_else(|| "DataUnavailable".to_string()))
    }

    fn web_admission<T>(&self, window: &str, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        // 准入与关闭共用锁，关闭开始后禁止登记或认领新的网页操作。
        let requested = self.close_requested.lock().map_err(|_| "WEB_STORAGE_FAILED")?;
        if requested.contains(window) || self.exit_requested.load(Ordering::SeqCst)
            || self.restart_authorized.load(Ordering::SeqCst) || self.close_authorized.load(Ordering::SeqCst)
        { return Err("WEB_CANCELLED".into()); }
        action()
    }

    fn retry_open(&self) -> Result<Arc<DataStorageManager>, String> {
        let mut slot = self.manager.lock().map_err(|_| "StorageIoFailed")?;
        if let Some(manager) = slot.as_ref() {
            manager.reload_invalid_control().map_err(|error| error.to_string())?;
            return Ok(Arc::clone(manager));
        }
        let manager = Arc::new(DataStorageManager::open(
            self.fixed.user_data_dir.clone(), self.fixed.resource_dir.clone(),
        ).map_err(|error| error.to_string())?);
        *slot = Some(Arc::clone(&manager));
        *self.open_error.lock().map_err(|_| "StorageIoFailed")? = None;
        Ok(manager)
    }

    fn selected(&self, token: &str, purpose: DirectoryPurpose, window: &str, generation: u64) -> Result<SelectedDirectory, String> {
        let selected = self.selections.lock().map_err(|_| "StorageIoFailed")?
            .get(token).cloned().ok_or("StaleOperation")?;
        if selected.purpose != purpose || selected.window != window || selected.generation != generation {
            return Err("StaleOperation".into());
        }
        crate::safe_filesystem::check_identity(&selected.path, selected.identity)
            .map_err(|_| "UnsafePath")?;
        Ok(selected)
    }

    fn register_selection(&self, path: PathBuf, purpose: DirectoryPurpose, window: &str, generation: u64) -> Result<DirectorySelectionView, String> {
        let identity = crate::safe_filesystem::identity(&path).map_err(|_| "UnsafePath")?;
        let mut selections = self.selections.lock().map_err(|_| "StorageIoFailed")?;
        if purpose != DirectoryPurpose::LegacySource {
            selections.retain(|_, selected| selected.window != window || selected.purpose != purpose);
        }
        if selections.len() >= MAX_SELECTIONS { return Err("StaleOperation".into()); }
        let token = uuid::Uuid::new_v4().to_string();
        selections.insert(token.clone(), SelectedDirectory {
            path: path.clone(), identity, purpose, window: window.into(), generation,
        });
        Ok(DirectorySelectionView { selection_token: token, path: crate::path_to_env_string(path) })
    }
}

pub(crate) fn initialize(app: &AppHandle) -> Result<(), String> {
    let fixed = crate::resolve_fixed_paths(app)?;
    crate::ensure_config_dirs(&fixed)?;
    app.manage(StorageService::new(fixed));
    Ok(())
}

fn manager(app: &AppHandle) -> Result<Arc<DataStorageManager>, String> {
    app.state::<StorageService>().manager()
}

pub(crate) fn with_web_admission<T>(app: &AppHandle, window: &str, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    app.try_state::<StorageService>().ok_or("WEB_STORAGE_FAILED")?.web_admission(window, action)
}

struct StopProbeMonitor<'a>(&'a AtomicBool);
impl Drop for StopProbeMonitor<'_> {
    fn drop(&mut self) { self.0.store(true, Ordering::SeqCst); }
}

fn validation_snapshot(manager: &DataStorageManager, fixed: &crate::RuntimePaths, data: &DataPaths, roots: &[PathBuf], supervisors: &crate::ProcessSupervisors) -> Result<serde_json::Value, StorageError> {
    if manager.cancellation_requested() { return Err(StorageError::new("Cancelled")); }
    let finished = AtomicBool::new(false);
    std::thread::scope(|scope| {
        let monitor = scope.spawn(|| {
            while !finished.load(Ordering::SeqCst) {
                if manager.cancellation_requested() { let _result = supervisors.cancel_task(); }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        });
        let result = {
            let _stop = StopProbeMonitor(&finished);
            crate::data_storage_validation::capture_for_sources(fixed, data, roots, supervisors, &|| manager.cancellation_requested())
                .map_err(|code| StorageError::new(&code))
        };
        monitor.join().map_err(|_| StorageError::new("StorageValidationFailed"))?;
        if manager.cancellation_requested() { return Err(StorageError::new("Cancelled")); }
        serde_json::to_value(result?).map_err(|_| StorageError::new("ControlInvalid"))
    })
}

fn verified_recheck(manager: &DataStorageManager, fixed: &crate::RuntimePaths, supervisors: &crate::ProcessSupervisors) -> Result<StorageStateView, StorageError> {
    let merged=manager.state().operation.is_some_and(|operation|operation.merge);
    manager.recheck_with_validator(&mut |data, value| {
        let baseline = if merged && value.is_null() {
            crate::data_storage_validation::capture_for_sources(fixed,data,&[data.output_root.clone()],supervisors,&||false)
                .map_err(|code|StorageError::new(&code))?
        } else {
            serde_json::from_value::<crate::data_storage_validation::StorageValidationBaseline>(value.clone())
                .map_err(|_| StorageError::new("ControlInvalid"))?
        };
        crate::data_storage_validation::verify(fixed, data, &baseline, supervisors)
            .map_err(|code| StorageError::new(&code))
    })
}

fn recover_history_before_inventory(fixed: &crate::RuntimePaths, supervisors: &crate::ProcessSupervisors, deletion: &crate::HistoryDeletionState) -> Result<(), StorageError> {
    crate::web_page::recover_workspaces(fixed).map_err(|_| StorageError::new("TaskRecoveryFailed"))?;
    crate::history_deletion::prepare_storage_migration_from_paths(fixed, supervisors, deletion).map_err(|code| {
        StorageError::new(match code.as_str() {
            "HISTORY_DELETE_BUSY" | "HISTORY_DELETE_CLEANUP_PENDING" => "Busy",
            "HISTORY_DELETE_UNSAFE_STORAGE" => "UnsafePath",
            _ => "TaskRecoveryFailed",
        })
    })
}

pub(crate) fn acquire_data_access(app: &AppHandle) -> Result<DataOperationPermit, String> {
    if app.state::<StorageService>().media.lock().map_err(|_| "StorageIoFailed")?.restart_required {
        return Err("RestartRequired".into());
    }
    let manager = manager(app)?;
    if let Err(error) = recover_web_once(app.state::<StorageService>().inner(), &manager) {
        publish(app, manager.state());
        return Err(error);
    }
    match manager.acquire() {
        Ok(permit) => Ok(permit),
        Err(error) => { publish(app, manager.state()); Err(error.to_string()) }
    }
}

fn recover_web_once(service: &StorageService, manager: &Arc<DataStorageManager>) -> Result<(), String> {
    let mut recovery = service.web_recovery.lock().map_err(|_| "TaskRecoveryFailed")?;
    if crate::web_page::recovery_required(&service.fixed) {
        *recovery = Some(Err("TaskRecoveryFailed".into()));
    }
    if let Some(result) = recovery.as_ref() { return result.clone(); }
    let _permit = manager.acquire().map_err(|error| error.to_string())?;
    let result = crate::web_page::recover_workspaces(&service.fixed).map_err(|_| "TaskRecoveryFailed".to_string());
    *recovery = Some(result.clone());
    result
}

fn ensure_web_clear(app: &AppHandle) -> Result<(), String> {
    let service = app.state::<StorageService>();
    let blocked = crate::web_page::recovery_required(&service.fixed)
        || service.web_recovery.lock().map_err(|_| "TaskRecoveryFailed")?.as_ref().is_some_and(Result::is_err);
    if blocked {
        publish(app, service.manager()?.state());
        return Err("TaskRecoveryFailed".into());
    }
    Ok(())
}

pub(crate) fn notify_web_recovery(app: &AppHandle) {
    let service = app.state::<StorageService>();
    if crate::web_page::recovery_required(&service.fixed) {
        if let Ok(manager) = service.manager() { publish(app, manager.state()); }
    }
}

fn state_for_app(app: &AppHandle, mut state: StorageStateView) -> Result<StorageStateView, String> {
    let service = app.state::<StorageService>();
    if state.data_access == "ready" && recover_web_once(service.inner(), &service.manager()?).is_err() {
        state.data_access = "recovery_required".into();
        state.last_error = Some("TaskRecoveryFailed".into());
    }
    let mut media = service.media.lock().map_err(|_| "StorageIoFailed")?;
    let scope = app.asset_protocol_scope();
    if matches!(state.data_access.as_str(), "unavailable" | "recovery_required" | "restart_required") {
        let old = std::mem::take(&mut media.allowed);
        for path in old {
            scope.forbid_directory(&path, true).map_err(|_| "UnsafePath")?;
            media.revoked.insert(path);
        }
    } else if state.data_access == "ready" {
        let paths = paths_for_config(&service.fixed.user_data_dir).map_err(|error| error.to_string())?;
        // 仅授权任务媒体与回放副本，旧自定义输出根可能同时含有其他文件。
        let next = vec![paths.output_root.join("tasks"), paths.cache_root.join(crate::AUDIO_REVIEW_CACHE_DIR_NAME)];
        if (!media.last_paths.is_empty() && media.last_paths != next) || next.iter().any(|path| media.revoked.contains(path)) {
            media.restart_required = true;
            for path in std::mem::take(&mut media.allowed) {
                scope.forbid_directory(&path, true).map_err(|_| "UnsafePath")?;
                media.revoked.insert(path);
            }
        } else {
            for path in media.allowed.clone() {
                if !next.contains(&path) {
                    scope.forbid_directory(&path, true).map_err(|_| "UnsafePath")?;
                    media.revoked.insert(path);
                }
            }
            for path in &next {
                if !media.allowed.contains(path) {
                    scope.allow_directory(path, true).map_err(|_| "UnsafePath")?;
                }
            }
            media.last_paths = next.clone();
            media.allowed = next;
        }
        if media.restart_required {
            state.data_access = "restart_required".into();
            state.last_error = Some("RestartRequired".into());
        }
    }
    Ok(state)
}

fn publish(app: &AppHandle, state: StorageStateView) {
    // 通知不是提交权威；窗口关闭后仍由固定控制记录决定恢复位置。
    if let Ok(state) = state_for_app(app, state) {
        if app.emit(PROGRESS_EVENT, state).is_err() {
            eprintln!("[frameq] storage progress notification failed");
        }
    }
}

fn finish_requested_close(app: &AppHandle) {
    let service = app.state::<StorageService>();
    let Ok(manager) = service.manager() else { return; };
    if !ready_to_close(app, &manager) { return; }
    // 窗口销毁前保留关闭请求，拒绝晚到的网页准入。
    let labels = service.close_requested.lock().expect("storage close mutex").iter().cloned().collect::<Vec<_>>();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            if window.close().is_err() { eprintln!("[frameq] deferred window close failed"); }
        }
    }
    if service.exit_requested.load(Ordering::SeqCst) { app.exit(0); }
}

fn begin_validation(app: &AppHandle, manager: Arc<DataStorageManager>) {
    let view = manager.state();
    if !view.operation.as_ref().is_some_and(|operation| operation.phase == "validating" && operation.last_error.is_none()) { return; }
    let service = app.state::<StorageService>();
    if service.validating.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() { return; }
    let fixed = service.fixed.clone();
    let supervisors = Arc::clone(app.state::<Arc<crate::ProcessSupervisors>>().inner());
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _result = verified_recheck(&manager, &fixed, &supervisors);
        publish(&app, manager.state());
        app.state::<StorageService>().validating.store(false, Ordering::SeqCst);
        finish_requested_close(&app);
    });
}

#[tauri::command]
pub(crate) async fn get_data_storage_state(app: AppHandle) -> Result<StorageStateView, String> {
    crate::run_blocking_worker_command(move || {
        let manager = manager(&app)?;
        let state = state_for_app(&app, manager.state())?;
        begin_validation(&app, manager);
        Ok(state)
    }).await
}

#[tauri::command]
pub(crate) async fn select_data_storage_directory(app: AppHandle, window: Window, purpose: DirectoryPurpose) -> Result<Option<DirectorySelectionView>, String> {
    let generation = manager(&app)?.state().generation;
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || dialog_app.dialog().file().blocking_pick_folder())
        .await.map_err(|_| "StorageIoFailed")?;
    let Some(selected) = selected else { return Ok(None); };
    let path = selected.into_path().map_err(|_| "UnsafePath")?;
    let service = app.state::<StorageService>();
    service.register_selection(path, purpose, window.label(), generation).map(Some)
}

#[tauri::command]
pub(crate) fn begin_data_storage_preflight(app:AppHandle,window:Window,request_id:String,kind:PreflightKind,expected_generation:u64)->Result<(),String> {
    let service=app.state::<StorageService>();
    let closing=service.close_requested.lock().map_err(|_|"StorageIoFailed")?;
    if closing.contains(window.label())||service.exit_requested.load(Ordering::SeqCst)||service.restart_authorized.load(Ordering::SeqCst){return Err("Busy".into());}
    if service.manager()?.state().generation!=expected_generation{return Err("StaleOperation".into());}
    service.preflight.begin(&request_id,window.label(),expected_generation,kind)
}

fn withdraw_preflight_preview(manager:&DataStorageManager,completion:preflight::Completion) {
    match completion {
        preflight::Completion::Migration{operation_id,generation}=>{
            let state=manager.state();
            if state.generation==generation&&state.operation.is_some_and(|operation|operation.operation_id==operation_id&&(matches!(operation.phase.as_str(),"prepared"|"waiting")||operation.can_resume&&operation.can_cancel)){let _=manager.cancel(&operation_id,generation);}
        },
        preflight::Completion::Cleanup{token}=>{manager.discard_cleanup_preview(&token);},
    }
}

#[tauri::command]
pub(crate) fn cancel_data_storage_preflight(app:AppHandle,window:Window,request_id:String)->Result<(),String> {
    let service=app.state::<StorageService>();let manager=service.manager()?;
    service.preflight.cancel(&request_id,window.label(),|kind,running,completion|{
        if running&&kind==PreflightKind::Migration{manager.signal_preparation_cancel();}
        if let Some(completion)=completion{withdraw_preflight_preview(&manager,completion);}
    })?;
    publish(&app,manager.state());finish_requested_close(&app);Ok(())
}

#[tauri::command]
pub(crate) async fn prepare_data_storage_migration(app: AppHandle, window: Window, target_token: String, legacy_source_tokens: Vec<String>, expected_generation: u64, request_id:String) -> Result<MigrationPreview, String> {
    let service = app.state::<StorageService>();
    let manager = service.manager()?;
    let mut claim=service.preflight.claim(&request_id,window.label(),expected_generation,PreflightKind::Migration)?;
    ensure_web_clear(&app)?;
    let target = service.selected(&target_token, DirectoryPurpose::Target, window.label(), expected_generation)?;
    let sources = legacy_source_tokens.iter().map(|token| {
        service.selected(token, DirectoryPurpose::LegacySource, window.label(), expected_generation).map(|selected| selected.path)
    }).collect::<Result<Vec<_>, _>>()?;
    let fixed = service.fixed.clone();
    let supervisors = Arc::clone(app.state::<Arc<crate::ProcessSupervisors>>().inner());
    let deletion = Arc::clone(app.state::<Arc<crate::HistoryDeletionState>>().inner());
    let label = window.label().to_string();
    let progress_window=window.clone();
    let result:Result<MigrationPreview,String> = tauri::async_runtime::spawn_blocking(move || {
        let target_path=target.path.clone();
        let result=manager.prepare_with_validation_and_progress(target.path, sources, &label, expected_generation,
            &mut || recover_history_before_inventory(&fixed, &supervisors, &deletion),
            &mut |data, roots| validation_snapshot(&manager, &fixed, data, roots, &supervisors),
            &mut |progress|claim.report(progress,|event|{let _=progress_window.emit(preflight::EVENT,event);}));
        let preview=match result {Ok(preview)=>preview,Err(error)=>{
            if let Some(operation_id)=manager.waiting_preparation_id(&label,expected_generation,Some(&target_path)) {
                let completion=preflight::Completion::Migration{operation_id,generation:expected_generation};claim.finish(completion.clone());
                if claim.check().is_err(){withdraw_preflight_preview(&manager,completion);}
            }
            return Err(error.to_string());
        }};
        let completion=preflight::Completion::Migration{operation_id:preview.operation_id.clone(),generation:preview.generation};
        claim.finish(completion.clone());
        if claim.check().is_err(){withdraw_preflight_preview(&manager,completion);return Err("Cancelled".into());}
        Ok(preview)
    }).await.map_err(|_| "StorageIoFailed")?;
    finish_requested_close(&app);
    let preview = result?;
    let mut selections = service.selections.lock().map_err(|_| "StorageIoFailed")?;
    selections.remove(&target_token);
    for token in legacy_source_tokens { selections.remove(&token); }
    drop(selections);
    Ok(preview)
}

#[tauri::command]
pub(crate) fn get_pending_data_storage_preview(app: AppHandle, window: Window) -> Result<MigrationPreview, String> {
    manager(&app)?.pending_preview(window.label()).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn confirm_data_storage_migration(app: AppHandle, window: Window, plan_token: String) -> Result<StorageStateView, String> {
    ensure_web_clear(&app)?;
    let manager = manager(&app)?;
    let worker_app = app.clone();
    let label = window.label().to_string();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = manager.start(&plan_token, &label, &mut |state| publish(&worker_app, state));
        publish(&worker_app, manager.state());
        result.map_err(|error| error.to_string())
    }).await.map_err(|_| "StorageIoFailed")?;
    finish_requested_close(&app);
    state_for_app(&app, result?)
}

#[tauri::command]
pub(crate) fn cancel_data_storage_migration(app: AppHandle, operation_id: String, expected_generation: u64) -> Result<StorageStateView, String> {
    let manager = manager(&app)?;
    let state = stop_operation(&manager, &operation_id, expected_generation)?;
    publish(&app, state.clone());
    finish_requested_close(&app);
    state_for_app(&app, state)
}

#[tauri::command]
pub(crate) async fn resume_data_storage_migration(app: AppHandle, window: Window, operation_id: String, expected_generation: u64, legacy_source_tokens: Vec<String>, request_id:String) -> Result<StorageStateView, String> {
    let manager = manager(&app)?;
    let service = app.state::<StorageService>();
    let mut claim=Some(service.preflight.claim(&request_id,window.label(),expected_generation,PreflightKind::Migration)?);
    ensure_web_clear(&app)?;
    let protection=claim.as_ref().expect("claimed preflight").protection();
    if manager.state().operation.is_some_and(|operation|matches!(operation.phase.as_str(),"merging"|"publishing"|"restart_required"|"validating"|"cleaning")){claim.as_ref().expect("claimed preflight").protect();}
    let sources = legacy_source_tokens.iter().map(|token| {
        service.selected(token, DirectoryPurpose::LegacySource, window.label(), expected_generation).map(|selected| selected.path)
    }).collect::<Result<Vec<_>, _>>()?;
    let worker_app = app.clone();
    let label = window.label().to_string();
    let fixed = app.state::<StorageService>().fixed.clone();
    let supervisors = Arc::clone(app.state::<Arc<crate::ProcessSupervisors>>().inner());
    let deletion = Arc::clone(app.state::<Arc<crate::HistoryDeletionState>>().inner());
    let progress_window=window.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = manager.state();
        let operation = state.operation.as_ref().filter(|operation| operation.operation_id == operation_id)
            .or_else(|| state.recovery_candidates.iter().find(|operation| operation.operation_id == operation_id));
        if state.generation != expected_generation || operation.is_none() { return Err("StaleOperation".into()); }
        if !operation.is_some_and(|operation|operation.can_resume){return Err("Busy".into());}
        if let Some(claim)=claim.as_ref(){claim.finish(preflight::Completion::Migration{operation_id:operation_id.clone(),generation:expected_generation});}
        let needs_preparation=manager.requires_preparation_with_progress(&operation_id,&mut |progress|if let Some(claim)=claim.as_mut(){claim.report(progress,|event|{let _=progress_window.emit(preflight::EVENT,event);})}else{Ok(())}).map_err(|error|error.to_string())?;
        let result = if needs_preparation {
            manager.resume_preparation_with_progress(&operation_id, expected_generation, &label, (!sources.is_empty()).then_some(sources),
                &mut || recover_history_before_inventory(&fixed, &supervisors, &deletion),
                &mut |data, roots| validation_snapshot(&manager, &fixed, data, roots, &supervisors),
                &mut |progress|if let Some(claim)=claim.as_mut(){claim.report(progress,|event|{let _=progress_window.emit(preflight::EVENT,event);})}else{Ok(())}).and_then(|preview|{
                    if let Some(claim)=claim.as_ref(){let completion=preflight::Completion::Migration{operation_id:preview.operation_id,generation:preview.generation};claim.finish(completion.clone());if claim.check().is_err(){withdraw_preflight_preview(&manager,completion);return Err(StorageError::new("Cancelled"));}}
                    Ok(manager.state())
                })
        } else if !sources.is_empty() {
            Err(StorageError::new("StaleOperation"))
        } else if operation.is_some_and(|operation| operation.phase == "validating") {
            verified_recheck(&manager, &fixed, &supervisors)
        } else {
            manager.resume_with_preflight(&operation_id, expected_generation, &label, &mut |state| {
                if state.operation.as_ref().is_some_and(|operation|matches!(operation.phase.as_str(),"merging"|"publishing"|"restart_required"|"validating"|"cleaning")){protection.store(false,Ordering::Release);}
                publish(&worker_app, state)
            },
                &mut |progress|if let Some(claim)=claim.as_mut(){claim.report(progress,|event|{let _=progress_window.emit(preflight::EVENT,event);})}else{Ok(())})
        };
        if let Ok(state)=&result {
            if let Some(operation)=state.operation.as_ref().filter(|operation|operation.phase=="prepared") {
                if let Some(claim)=claim.as_ref() {
                    let completion=preflight::Completion::Migration{operation_id:operation.operation_id.clone(),generation:state.generation};
                    claim.finish(completion.clone());
                    if claim.check().is_err(){withdraw_preflight_preview(&manager,completion);return Err("Cancelled".into());}
                }
            }
        }
        let current=manager.state();
        if !current.operation.as_ref().is_some_and(|operation|matches!(operation.phase.as_str(),"waiting"|"prepared")){publish(&worker_app,current);}
        result.map_err(|error| error.to_string())
    }).await.map_err(|_| "StorageIoFailed")?;
    finish_requested_close(&app);
    let state = result?;
    let mut selections = service.selections.lock().map_err(|_| "StorageIoFailed")?;
    for token in legacy_source_tokens { selections.remove(&token); }
    drop(selections);
    state_for_app(&app, state)
}

#[tauri::command]
pub(crate) async fn recheck_data_storage(app: AppHandle) -> Result<StorageStateView, String> {
    *app.state::<StorageService>().web_recovery.lock().map_err(|_| "TaskRecoveryFailed")? = None;
    let manager = app.state::<StorageService>().retry_open()?;
    let worker_app = app.clone();
    let fixed = app.state::<StorageService>().fixed.clone();
    let supervisors = Arc::clone(app.state::<Arc<crate::ProcessSupervisors>>().inner());
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = verified_recheck(&manager, &fixed, &supervisors);
        publish(&worker_app, manager.state());
        result.map_err(|error| error.to_string())
    }).await.map_err(|_| "StorageIoFailed")?;
    finish_requested_close(&app);
    state_for_app(&app, result?)
}

#[tauri::command]
pub(crate) async fn relink_data_storage(app: AppHandle, window: Window, selection_token: String) -> Result<StorageStateView, String> {
    let service = app.state::<StorageService>();
    let manager = service.manager()?;
    let generation = manager.state().generation;
    let selected = service.selected(&selection_token, DirectoryPurpose::Relink, window.label(), generation)?;
    let state = tauri::async_runtime::spawn_blocking(move || manager.relink(selected.path, generation).map_err(|error| error.to_string()))
        .await.map_err(|_| "StorageIoFailed")??;
    service.selections.lock().map_err(|_| "StorageIoFailed")?.remove(&selection_token);
    publish(&app, state.clone());
    state_for_app(&app, state)
}

#[tauri::command]
pub(crate) async fn prepare_old_storage_cleanup(app: AppHandle, window: Window, receipt_id: String, request_id:String) -> Result<CleanupPreview, String> {
    ensure_web_clear(&app)?;
    let manager = manager(&app)?;
    let mut claim=app.state::<StorageService>().preflight.claim(&request_id,window.label(),manager.state().generation,PreflightKind::Cleanup)?;
    let cancel=claim.cancellation();
    let progress_window=window.clone();
    let label = window.label().to_string();
    let result=tauri::async_runtime::spawn_blocking(move || {
        let _permit=manager.acquire().map_err(|error|error.to_string())?;
        claim.check().map_err(|error|error.to_string())?;
        let preview=manager.prepare_cleanup_observed(&receipt_id,&label,&cancel,&mut |progress|claim.report(progress,|event|{let _=progress_window.emit(preflight::EVENT,event);})).map_err(|error|error.to_string())?;
        let completion=preflight::Completion::Cleanup{token:preview.plan_token.clone()};claim.finish(completion.clone());
        if claim.check().is_err(){withdraw_preflight_preview(&manager,completion);return Err("Cancelled".into());}
        Ok(preview)
    }).await.map_err(|_| "StorageIoFailed")?;
    finish_requested_close(&app);result
}

#[tauri::command]
pub(crate) async fn confirm_old_storage_cleanup(app: AppHandle, window: Window, plan_token: String) -> Result<StorageStateView, String> {
    ensure_web_clear(&app)?;
    let manager = manager(&app)?;
    let worker_app = app.clone();
    let label = window.label().to_string();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = manager.confirm_cleanup(&plan_token, &label, &mut |state| publish(&worker_app, state));
        publish(&worker_app, manager.state());
        result.map_err(|error| error.to_string())
    }).await.map_err(|_| "StorageIoFailed")?;
    finish_requested_close(&app);
    state_for_app(&app, result?)
}

#[tauri::command]
pub(crate) fn restart_for_data_storage(app: AppHandle) -> Result<(), String> {
    let service = app.state::<StorageService>();
    let requested = service.close_requested.lock().map_err(|_| "StorageIoFailed")?;
    if !requested.is_empty() || service.exit_requested.load(Ordering::SeqCst)
        || crate::web_page::is_active(&app) { return Err("Busy".into()); }
    let manager = service.manager()?;
    let state = manager.state();
    let media_restart = service.media.lock().map_err(|_| "StorageIoFailed")?.restart_required;
    if state.data_access != "restart_required" && !media_restart { return Err("Busy".into()); }
    manager.prepare_restart().map_err(|error| error.to_string())?;
    service.restart_authorized.store(true, Ordering::SeqCst);
    drop(requested);
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub(crate) fn restart_application(app: AppHandle) -> Result<(), String> {
    let service = app.state::<StorageService>();
    let requested = service.close_requested.lock().map_err(|_| "StorageIoFailed")?;
    if !requested.is_empty() || service.exit_requested.load(Ordering::SeqCst)
        || crate::web_page::is_active(&app) { return Err("Busy".into()); }
    service.manager()?.prepare_restart().map_err(|error| error.to_string())?;
    service.restart_authorized.store(true, Ordering::SeqCst);
    drop(requested);
    app.request_restart();
    Ok(())
}

pub(crate) fn request_window_close(app: &AppHandle, label: &str) -> bool {
    let Some(service) = app.try_state::<StorageService>() else { return false; };
    {
        let mut requested = service.close_requested.lock().expect("storage close mutex");
        if service.restart_authorized.load(Ordering::SeqCst) || service.close_authorized.load(Ordering::SeqCst) { return false; }
        requested.insert(label.into());
    }
    crate::web_page::cancel_for_close(app);
    let Ok(manager) = service.manager() else { return false; };
    service.preflight.cancel_window(Some(label),|kind,running,completion|{
        if running&&kind==PreflightKind::Migration{manager.signal_preparation_cancel();}
        if let Some(completion)=completion{withdraw_preflight_preview(&manager,completion);}
    });
    if ready_to_close(app, &manager) { return false; }
    request_cancellation(app, manager);
    await_requested_close(app);
    true
}

pub(crate) fn request_exit(app: &AppHandle) -> bool {
    let Some(service) = app.try_state::<StorageService>() else { return false; };
    {
        let _requested = service.close_requested.lock().expect("storage close mutex");
        if service.restart_authorized.load(Ordering::SeqCst) || service.close_authorized.load(Ordering::SeqCst) { return false; }
        service.exit_requested.store(true, Ordering::SeqCst);
    }
    crate::web_page::cancel_for_close(app);
    let Ok(manager) = service.manager() else { return false; };
    service.preflight.cancel_window(None,|kind,running,completion|{
        if running&&kind==PreflightKind::Migration{manager.signal_preparation_cancel();}
        if let Some(completion)=completion{withdraw_preflight_preview(&manager,completion);}
    });
    if ready_to_close(app, &manager) && manager.prepare_close().is_ok() {
        service.close_authorized.store(true, Ordering::SeqCst);
        return false;
    }
    request_cancellation(app, manager);
    await_requested_close(app);
    true
}

pub(crate) fn prepare_window_destroy(app: &AppHandle, label: &str) -> Result<(), String> {
    if request_window_close(app, label) { return Err("Busy".into()); }
    let service = app.state::<StorageService>();
    if service.close_authorized.load(Ordering::SeqCst) { return Ok(()); }
    if let Ok(manager) = service.manager() { manager.prepare_close().map_err(|error| error.to_string())?; }
    service.close_authorized.store(true, Ordering::SeqCst);
    Ok(())
}

fn stop_operation(manager: &DataStorageManager, operation_id: &str, generation: u64) -> Result<StorageStateView, String> {
    let state = manager.state();
    if state.generation != generation { return Err("StaleOperation".into()); }
    let operation = state.operation.as_ref().filter(|operation| operation.operation_id == operation_id).ok_or("StaleOperation")?;
    let result = if operation.phase == "cleaning" { manager.stop_cleanup(operation_id) } else { manager.cancel(operation_id, generation) };
    result.map_err(|error| error.to_string())
}

fn ready_to_close(app: &AppHandle, manager: &DataStorageManager) -> bool {
    !crate::web_page::is_active(app)
        && !app.state::<StorageService>().preflight.active()
        && manager.can_close() && !manager.state().operation.is_some_and(|operation| operation.can_cancel)
}

fn await_requested_close(app: &AppHandle) {
    let service = app.state::<StorageService>();
    if service.close_waiter.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() { return; }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        loop {
            let service = app.state::<StorageService>();
            let Ok(manager) = service.manager() else { break; };
            if ready_to_close(&app, &manager) { finish_requested_close(&app); break; }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        app.state::<StorageService>().close_waiter.store(false, Ordering::SeqCst);
    });
}

fn request_cancellation(app: &AppHandle, manager: Arc<DataStorageManager>) {
    let state = manager.state();
    if let Some(operation) = state.operation.filter(|operation| operation.can_cancel) {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _result = stop_operation(&manager, &operation.operation_id, state.generation);
            publish(&app, manager.state());
            finish_requested_close(&app);
        });
    }
}

#[cfg(test)]
mod selection_tests {
    use super::*;
    use std::fs;

    fn workspace() -> PathBuf {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-acceptance")
            .join(format!("selection-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(path.join("config/outputs")).expect("create isolated configuration");
        let path = path.canonicalize().expect("resolve workspace");
        fs::write(path.join("config/.env"), format!("FRAMEQ_OUTPUT_DIR={}\n", crate::path_to_env_string(path.join("config/outputs"))))
            .expect("write isolated configuration");
        path
    }

    #[test]
    fn web_admission_stops_for_each_real_shutdown_marker() {
        let root = workspace();
        let service = StorageService::new(crate::RuntimePaths { user_data_dir: root.join("config"), resource_dir: root.join("resources") });
        assert!(service.web_admission("main", || Ok(())).is_ok());
        service.close_requested.lock().unwrap().insert("main".into());
        assert_eq!(service.web_admission("main", || Ok(())).unwrap_err(), "WEB_CANCELLED");
        service.close_requested.lock().unwrap().clear();
        for marker in [&service.exit_requested, &service.restart_authorized, &service.close_authorized] {
            marker.store(true, Ordering::SeqCst);
            assert_eq!(service.web_admission("main", || Ok(())).unwrap_err(), "WEB_CANCELLED");
            marker.store(false, Ordering::SeqCst);
        }
        assert!(service.web_admission("main", || Ok(())).is_ok());
    }

    #[test]
    fn selected_directory_is_bound_to_window_purpose_generation_and_physical_identity() {
        let root = workspace();
        let target = root.join("target");
        fs::create_dir(&target).expect("create selected target");
        let service = StorageService::new(crate::RuntimePaths { user_data_dir: root.join("config"), resource_dir: root.join("resources") });
        let state = service.manager().expect("manager").state();
        assert_eq!(state.data_access, "ready");
        let generation = state.generation;
        let selected = service.register_selection(target.clone(), DirectoryPurpose::Target, "main", generation).expect("register selection");
        assert!(service.selected(&selected.selection_token, DirectoryPurpose::Target, "main", generation).is_ok());
        assert_eq!(service.selected(&selected.selection_token, DirectoryPurpose::Relink, "main", generation).err().as_deref(), Some("StaleOperation"));
        assert_eq!(service.selected(&selected.selection_token, DirectoryPurpose::Target, "other", generation).err().as_deref(), Some("StaleOperation"));
        assert_eq!(service.selected(&selected.selection_token, DirectoryPurpose::Target, "main", generation + 1).err().as_deref(), Some("StaleOperation"));
        fs::rename(&target, root.join("original-target")).expect("move selected directory");
        fs::create_dir(&target).expect("replace selected directory");
        assert_eq!(service.selected(&selected.selection_token, DirectoryPurpose::Target, "main", generation).err().as_deref(), Some("UnsafePath"));
        assert!(root.join("original-target").is_dir());
    }

    #[test]
    fn selection_capacity_is_bounded_and_unknown_tokens_fail_closed() {
        let root = workspace();
        let target = root.join("target");
        fs::create_dir(&target).expect("create target");
        let service = StorageService::new(crate::RuntimePaths { user_data_dir: root.join("config"), resource_dir: root.join("resources") });
        assert_eq!(service.selected("unknown", DirectoryPurpose::Target, "main", 0).err().as_deref(), Some("StaleOperation"));
        for index in 0..MAX_SELECTIONS {
            service.register_selection(target.clone(), DirectoryPurpose::Target, &format!("window-{index}"), 0).expect("selection within capacity");
        }
        assert_eq!(service.register_selection(target, DirectoryPurpose::Target, "another-window", 0).err().as_deref(), Some("StaleOperation"));
    }

    #[test]
    fn choosing_a_new_target_revokes_the_previous_target_token() {
        let root = workspace();
        let target = root.join("target");
        fs::create_dir(&target).expect("create target");
        let service = StorageService::new(crate::RuntimePaths { user_data_dir: root.join("config"), resource_dir: root.join("resources") });
        let first = service.register_selection(target.clone(), DirectoryPurpose::Target, "main", 0).expect("first target");
        let next = service.register_selection(target, DirectoryPurpose::Target, "main", 0).expect("new target");
        assert_eq!(service.selected(&first.selection_token, DirectoryPurpose::Target, "main", 0).err().as_deref(), Some("StaleOperation"));
        assert!(service.selected(&next.selection_token, DirectoryPurpose::Target, "main", 0).is_ok());
    }

    #[test]
    #[ignore = "需要显式指定另一真实卷的隔离 FRAMEQ_STORAGE_CROSS_VOLUME_ROOT"]
    fn cross_volume_source_is_copied_verified_and_retained() {
        let root = workspace();
        let other = PathBuf::from(std::env::var_os("FRAMEQ_STORAGE_CROSS_VOLUME_ROOT").expect("isolated second volume root"));
        assert!(other.is_absolute());
        let source = other.join(format!("cross-volume-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(source.join("tasks/cross-volume/transcript")).unwrap();
        let source = source.canonicalize().unwrap();
        let target = root.join("target");
        fs::create_dir(&target).unwrap();
        let target = target.canonicalize().unwrap();
        assert_ne!(crate::safe_filesystem::identity(&source).unwrap().volume, crate::safe_filesystem::identity(&target).unwrap().volume);
        let original = source.join("tasks/cross-volume/transcript/transcript.txt");
        fs::write(&original, "真实跨卷迁移验收。\n").unwrap();
        let manager = DataStorageManager::open(root.join("config"), root.join("resources")).unwrap();
        let preview = manager.prepare(target.clone(), vec![source], "test", 0).unwrap();
        assert_eq!(preview.total_files, 1);
        manager.start(&preview.plan_token, "test", &mut |_| {}).unwrap();
        assert_eq!(manager.state().data_access, "restart_required");
        drop(manager);
        let manager = DataStorageManager::open(root.join("config"), root.join("resources")).unwrap();
        manager.recheck().unwrap();
        assert_eq!(manager.state().data_access, "ready");
        let copied = target.join("outputs/tasks/cross-volume/transcript/transcript.txt");
        let original_hash = crate::safe_filesystem::hash_file(&original).unwrap();
        let copied_hash = crate::safe_filesystem::hash_file(&copied).unwrap();
        assert_eq!((original_hash.0, original_hash.1), (copied_hash.0, copied_hash.1));
        assert!(original.is_file());
    }

    #[test]
    #[ignore = "需要预构建的真实 Python 和 worker 资源"]
    fn merged_target_restarts_through_real_offline_worker_validation() {
        let root=workspace();
        let resources=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").canonicalize().unwrap();
        let fixed=crate::RuntimePaths{user_data_dir:root.join("config"),resource_dir:resources.clone()};
        let target=root.join("target");fs::create_dir_all(target.join("cache")).unwrap();
        fs::create_dir_all(fixed.user_data_dir.join("cache")).unwrap();
        fs::write(fixed.user_data_dir.join("cache/same.bin"),b"source duplicate").unwrap();
        fs::write(target.join("cache/same.bin"),b"retained destination").unwrap();
        fs::write(fixed.user_data_dir.join("collections.json"),br#"{"schemaVersion":1,"collections":[]}"#).unwrap();
        let collections=serde_json::json!({"schemaVersion":1,"collections":[{"id":uuid::Uuid::new_v4().to_string(),"name":"Retained destination","taskIds":[]}]});
        let target_collections=serde_json::to_vec(&collections).unwrap();fs::write(target.join("collections.json"),&target_collections).unwrap();
        let manager=DataStorageManager::open(fixed.user_data_dir.clone(),resources.clone()).unwrap();
        let preview=manager.prepare(target.clone(),vec![],"test",0).unwrap();assert!(preview.merge);
        manager.start(&preview.plan_token,"test",&mut |_|{}).unwrap();drop(manager);
        let manager=DataStorageManager::open(fixed.user_data_dir.clone(),resources).unwrap();
        let supervisors=crate::ProcessSupervisors::default();
        assert_eq!(verified_recheck(&manager,&fixed,&supervisors).unwrap().data_access,"ready");
        assert_eq!(fs::read(target.join("cache/same.bin")).unwrap(),b"retained destination");
        assert_eq!(fs::read(target.join("collections.json")).unwrap(),target_collections);
        assert!(!fixed.user_data_dir.join("cache/same.bin").exists());
        assert!(std::sync::Arc::new(manager).acquire().is_ok());
        assert!(!supervisors.is_task_active());
    }

    #[test]
    #[ignore = "需要预构建的真实 Python 和 worker 资源"]
    fn cancelling_preparation_terminates_its_actual_readonly_worker_and_releases_access() {
        let root = workspace();
        let target = root.join("target");
        fs::create_dir(&target).unwrap();
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").canonicalize().unwrap();
        let fixed = crate::RuntimePaths { user_data_dir: root.join("config"), resource_dir: resources.clone() };
        let manager = Arc::new(DataStorageManager::open(fixed.user_data_dir.clone(), resources).unwrap());
        let supervisors = Arc::new(crate::ProcessSupervisors::default());
        let worker_manager = Arc::clone(&manager);
        let worker_supervisors = Arc::clone(&supervisors);
        let worker = std::thread::spawn(move || worker_manager.prepare_with_validation(target, vec![], "test", 0,
            &mut || Ok(()), &mut |data, roots| validation_snapshot(&worker_manager, &fixed, data, roots, &worker_supervisors)));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        while !supervisors.is_task_active() {
            assert!(!worker.is_finished(), "readonly worker finished before cancellation observation");
            assert!(std::time::Instant::now() < deadline, "actual readonly worker did not start");
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let state = manager.state();
        manager.cancel(&state.operation.unwrap().operation_id, state.generation).unwrap();
        assert_eq!(worker.join().unwrap().unwrap_err().code, "Cancelled");
        assert!(!supervisors.is_task_active());
        assert_eq!(manager.state().data_access, "ready");
        assert!(manager.acquire().is_ok());
    }

    #[test]
    #[cfg(any(windows, target_os = "macos"))]
    fn uncertain_web_cleanup_blocks_cached_ready_and_recheck_for_its_library() {
        let root = workspace();
        let service = StorageService::new(crate::RuntimePaths {
            user_data_dir: root.join("config"), resource_dir: root.join("resources"),
        });
        let manager = service.manager().unwrap();
        recover_web_once(&service, &manager).unwrap();
        let executable = std::env::current_exe().unwrap();
        let owned = crate::web_page::ownership::OwnedWorkspace::new(
            &service.fixed.cache_root().unwrap(), &uuid::Uuid::new_v4().to_string(),
            &executable, &executable, executable.parent().unwrap(), false,
        ).unwrap();
        fs::write(owned.profile().join("sentinel"), b"retain uncertain local material").unwrap();
        fs::write(owned.path.join("owner.json"), b"{invalid").unwrap();
        let retained = owned.path.clone();
        drop(owned);
        assert!(crate::web_page::recovery_required(&service.fixed));
        assert_eq!(recover_web_once(&service, &manager), Err("TaskRecoveryFailed".into()));
        *service.web_recovery.lock().unwrap() = None;
        assert_eq!(recover_web_once(&service, &manager), Err("TaskRecoveryFailed".into()));
        assert_eq!(fs::read(retained.join("profile/sentinel")).unwrap(), b"retain uncertain local material");
        let other = workspace();
        let other_service = StorageService::new(crate::RuntimePaths {
            user_data_dir: other.join("config"), resource_dir: other.join("resources"),
        });
        assert!(recover_web_once(&other_service, &other_service.manager().unwrap()).is_ok());
    }

    #[test]
    #[ignore = "仅用于指定独立 bundle ID 的真实原生迁移恢复验收"]
    fn prepare_existing_isolated_native_library_for_restart_acceptance() {
        let config = PathBuf::from(std::env::var_os("FRAMEQ_NATIVE_ACCEPTANCE_CONFIG").expect("isolated native configuration")).canonicalize().unwrap();
        assert_eq!(config.file_name().unwrap(), "com.frameq.storage-acceptance-20261101-3e8a");
        assert!(!config.join("auth").exists());
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").canonicalize().unwrap();
        let target = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-acceptance/native-target").canonicalize().unwrap();
        assert!(fs::read_dir(&target).unwrap().next().is_none());
        let fixed = crate::RuntimePaths { user_data_dir: config.clone(), resource_dir: resources.clone() };
        let manager = DataStorageManager::open(config, resources).unwrap();
        assert_eq!(manager.state().generation, 0);
        assert_eq!(manager.state().data_access, "ready");
        let supervisors = crate::ProcessSupervisors::default();
        let deletion = crate::HistoryDeletionState::default();
        let preview = manager.prepare_with_validation(target, vec![], "main", 0,
            &mut || recover_history_before_inventory(&fixed, &supervisors, &deletion),
            &mut |data, roots| validation_snapshot(&manager, &fixed, data, roots, &supervisors)).unwrap();
        assert!(preview.total_files >= 20);
        assert_eq!(manager.state().operation.unwrap().phase, "prepared");
        println!("NATIVE_PREPARED files={} bytes={}", preview.total_files, preview.total_bytes);
    }
}
