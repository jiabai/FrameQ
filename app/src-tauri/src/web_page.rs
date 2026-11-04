#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod errors;
#[cfg(any(target_os = "macos", test))]
mod network;
pub(crate) mod ownership;
pub(crate) mod host_protocol;
pub(crate) mod session;

use errors::{WebPageError, WebResult};
use serde::{Deserialize, Serialize};
use std::io::Read;
#[cfg(test)] use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State, Window};
use crate::worker_runtime::{ProgressRoute, TaskTerminalResult, ValidatedWorkerResult, WorkerJob, WorkerRunOutcome};

#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct WebPageRequest {
    contract_version: u8,
    url: String,
    operation_id: String,
}

impl WebPageRequest {
    fn validate(&self) -> WebResult<()> {
        if self.contract_version != 1 || uuid::Uuid::parse_str(&self.operation_id)
            .map_or(true, |id| id.to_string() != self.operation_id)
        { return Err(WebPageError::RequestInvalid); }
        crate::task_manifest::validate_web_request_url(&self.url).map_err(|_| WebPageError::RequestInvalid)?;
        Ok(())
    }
}

struct ActiveOperation {
    request: WebPageRequest,
    window: String,
    claimed: bool,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
pub(crate) struct WebPageOperations { active: Mutex<Option<ActiveOperation>> }

#[derive(Serialize)]
pub(crate) struct WebCancellation { status: &'static str, error: Option<&'static str> }

pub(crate) fn is_active(app: &AppHandle) -> bool {
    app.try_state::<Arc<WebPageOperations>>().is_some_and(|state| state.active.lock().expect("web operation mutex").is_some())
}

pub(crate) fn cancel_for_close(app: &AppHandle) {
    if let Some(state) = app.try_state::<Arc<WebPageOperations>>() {
        let mut active = state.active.lock().expect("web operation mutex");
        if let Some(operation) = active.as_ref() {
            if operation.claimed { operation.cancelled.store(true, Ordering::Release); }
            else { *active = None; }
        }
    }
}

pub(crate) fn recover_workspaces(paths: &crate::RuntimePaths) -> Result<(), String> {
    let cache = paths.cache_root()?;
    if ownership::recovery_required(&cache) { return Err(WebPageError::StorageFailed.to_string()); }
    ownership::recover(&cache).map_err(|error| error.to_string())?;
    session::recover(paths)
}

pub(crate) fn recovery_required(paths: &crate::RuntimePaths) -> bool {
    paths.cache_root().map_or(true, |cache| ownership::recovery_required(&cache))
}

#[tauri::command]
pub(crate) fn cancel_web_page(
    window: Window, operations: State<'_, Arc<WebPageOperations>>, operation_id: String,
) -> WebCancellation {
    cancel_matching(&operations, &operation_id, window.label())
}

fn cancel_matching(operations: &WebPageOperations, operation_id: &str, window_label: &str) -> WebCancellation {
    let mut active = operations.active.lock().expect("web operation mutex");
    let Some(operation) = active.as_ref().filter(|active| active.request.operation_id == operation_id && active.window == window_label) else {
        return WebCancellation { status: "not_running", error: None };
    };
    let was_cancelled = operation.cancelled.swap(true, Ordering::AcqRel);
    if !operation.claimed { *active = None; }
    WebCancellation { status: if was_cancelled { "already_cancelling" } else { "cancelling" }, error: None }
}

struct OperationClaim {
    operations: Arc<WebPageOperations>,
    id: String,
    cancelled: Arc<AtomicBool>,
}

impl OperationClaim {
    fn register(operations: &WebPageOperations, request: &WebPageRequest, window: &str) -> WebResult<()> {
        let mut active = operations.active.lock().expect("web operation mutex");
        if let Some(operation) = active.as_ref() {
            if operation.claimed || operation.window != window { return Err(WebPageError::AlreadyRunning); }
            if operation.request.operation_id == request.operation_id {
                return if operation.request == *request { Ok(()) } else { Err(WebPageError::RequestInvalid) };
            }
        }
        *active = Some(ActiveOperation { request: request.clone(), window: window.into(), claimed: false,
            cancelled: Arc::new(AtomicBool::new(false)) });
        Ok(())
    }

    fn adopt(operations: Arc<WebPageOperations>, request: &WebPageRequest, window: &str) -> WebResult<Self> {
        let cancelled = {
            let mut active = operations.active.lock().expect("web operation mutex");
            let operation = active.as_mut().ok_or(WebPageError::Cancelled)?;
            if operation.request != *request || operation.window != window { return Err(WebPageError::RequestInvalid); }
            if operation.claimed { return Err(WebPageError::AlreadyRunning); }
            operation.claimed = true;
            Arc::clone(&operation.cancelled)
        };
        Ok(Self { operations, id: request.operation_id.clone(), cancelled })
    }
}

impl Drop for OperationClaim {
    fn drop(&mut self) {
        let mut active = self.operations.active.lock().expect("web operation mutex");
        if active.as_ref().is_some_and(|active| Arc::ptr_eq(&active.cancelled, &self.cancelled)) { *active = None; }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProcessWebPageArguments { request: WebPageRequest }

fn page_admission(message: &tauri::ipc::InvokeMessage) -> Result<(AppHandle, Window, WebPageRequest, Arc<WebPageOperations>), String> {
    let window = message.webview_ref().window();
    if window.label() != "main" { return Err(WebPageError::RequestInvalid.to_string()); }
    let app = window.app_handle().clone();
    let arguments: ProcessWebPageArguments = match message.payload() {
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .map_err(|_| WebPageError::RequestInvalid.to_string())?,
        tauri::ipc::InvokeBody::Raw(_) => return Err(WebPageError::RequestInvalid.to_string()),
    };
    let request = arguments.request;
    request.validate().map_err(|error| error.to_string())?;
    let operations = app.try_state::<Arc<WebPageOperations>>()
        .map(|state| Arc::clone(state.inner())).ok_or_else(|| WebPageError::StorageFailed.to_string())?;
    Ok((app, window, request, operations))
}

pub(crate) fn begin_web_page(invoke: tauri::ipc::Invoke) -> bool {
    let admission = page_admission(&invoke.message).and_then(|(_, window, request, operations)| {
        crate::data_storage::with_web_admission(window.app_handle(), window.label(), || {
            OperationClaim::register(&operations, &request, window.label()).map_err(|error| error.to_string())
        })
    });
    invoke.resolver.respond(admission.map_err(tauri::ipc::InvokeError::from));
    true
}

pub(crate) fn process_web_page(invoke: tauri::ipc::Invoke) -> bool {
    let admission = (|| -> Result<_, String> {
        let (app, window, request, operations) = page_admission(&invoke.message)?;
        let supervisors = app.try_state::<Arc<crate::ProcessSupervisors>>()
            .map(|state| Arc::clone(state.inner())).ok_or_else(|| WebPageError::StorageFailed.to_string())?;
        let claim = crate::data_storage::with_web_admission(&app, window.label(), || {
            OperationClaim::adopt(operations, &request, window.label()).map_err(|error| error.to_string())
        })?;
        Ok((app, window, request, claim, supervisors))
    })();
    match admission {
        Ok((app, window, request, claim, supervisors)) => invoke.resolver.respond_async(async move {
            process_claimed_web_page(app, window, request, claim, supervisors).await
                .map_err(tauri::ipc::InvokeError::from)
        }),
        Err(error) => invoke.resolver.reject(error),
    }
    true
}

async fn process_claimed_web_page(
    app: AppHandle, window: Window, request: WebPageRequest, claim: OperationClaim,
    supervisors: Arc<crate::ProcessSupervisors>,
) -> Result<TaskTerminalResult, String> {
    let notification_app = app.clone();
    let result = crate::run_blocking_worker_command(move || {
        if claim.cancelled.load(Ordering::Acquire) { return Err(WebPageError::Cancelled.to_string()); }
        let _access = crate::data_storage::acquire_data_access(&app)?;
        let paths = crate::resolve_runtime_paths(&app)?;
        run_claimed_web_page(&paths, request, claim, supervisors, ProgressRoute::worker(window))
    }).await;
    crate::data_storage::notify_web_recovery(&notification_app);
    result
}

#[cfg(test)]
fn run_web_page(
    paths: &crate::RuntimePaths, request: WebPageRequest, operations: Arc<WebPageOperations>,
    supervisors: Arc<crate::ProcessSupervisors>, window_label: String, progress: ProgressRoute,
) -> Result<TaskTerminalResult, String> {
        request.validate().map_err(|error| error.to_string())?;
        OperationClaim::register(&operations, &request, &window_label).map_err(|error| error.to_string())?;
        let claim = OperationClaim::adopt(operations, &request, &window_label)
            .map_err(|error| error.to_string())?;
        run_claimed_web_page(paths, request, claim, supervisors, progress)
}

fn run_claimed_web_page(
    paths: &crate::RuntimePaths, request: WebPageRequest, claim: OperationClaim,
    supervisors: Arc<crate::ProcessSupervisors>, progress: ProgressRoute,
) -> Result<TaskTerminalResult, String> {
        if claim.cancelled.load(Ordering::Acquire) { return Err(WebPageError::Cancelled.to_string()); }
        let reserved = supervisors.task_worker(paths).reserve()?;
        let started = Instant::now();
        recover_workspaces(paths)?;
        let helper = crate::worker_runtime::native_webview_host::helper_path(paths)?;
        let session_id = uuid::Uuid::new_v4().to_string();
        let workspace = Arc::new(session::NativeSession::create(paths, &claim.id, &session_id, &helper)?);
        let cleanup_budget = Arc::new(Mutex::new(None));
        let outcome = (|| {
        let bundle = paths.resource_dir.join("web/extract-article.js");
        let script = load_extractor(&bundle)?;
        #[cfg(target_os = "macos")]
        let mut proxy = network::PublicProxy::start().map_err(|error| error.to_string())?;
        #[cfg(target_os = "macos")]
        let proxy_url = Some(proxy.url());
        #[cfg(not(target_os = "macos"))]
        let proxy_url: Option<String> = None;
        let mut record = |role: &str, pid: u32| {
            let result = workspace.record(role, pid);
            if result.is_err() {
                let _ = crate::append_desktop_log(paths, "web.host.ownership.failed", &format!("role={role} pid={pid}"));
            }
            result
        };
        let extraction = crate::worker_runtime::native_webview_host::extract_with_cleanup_budget(paths, &claim.id, &session_id,
            &request.url, &workspace.profile(), &script, proxy_url.as_deref(), &claim.cancelled,
            &|stage| progress.web_stage(stage), &mut record, started + Duration::from_secs(90), &cleanup_budget);
        #[cfg(target_os = "macos")]
        {
            proxy.stop().map_err(|error| error.to_string())?;
            for (reason, resource) in proxy.state.take_diagnostics() {
                let _ = crate::append_desktop_log(paths, "web.proxy.policy", &format!("reason={reason} resource={resource}"));
            }
            let failure = proxy.state.failure();
            if let Some(error) = failure { return Err(error.to_string()); }
        }
        let mut article = extraction?;
        if claim.cancelled.load(Ordering::Acquire) { return Err(WebPageError::Cancelled.to_string()); }
        if started.elapsed() >= Duration::from_secs(90) { return Err(WebPageError::Timeout.to_string()); }
        article.final_url = crate::task_manifest::canonical_web_url(&article.final_url)?;
        *cleanup_budget.lock().map_err(|_| "WEB_CLEANUP_FAILED")? = None;
        let format = time::format_description::parse_borrowed::<3>("[year][month][day]-[hour][minute][second]")
            .map_err(|_| WebPageError::StorageFailed.to_string())?;
        let stamp = time::OffsetDateTime::now_utc().format(&format).map_err(|_| WebPageError::StorageFailed.to_string())?;
        let task_id = format!("{stamp}-web-{}", &uuid::Uuid::new_v4().simple().to_string()[..16]);
        workspace.prepare_save(&task_id, &article)?;
        let expected_task_id = task_id.clone();
        let payload = serde_json::json!({
            "contract_version":2, "operation_id":claim.id, "task_id":task_id,
            "article":{"title":article.title,"sourceUrl":article.final_url,"text":article.text,"markdown":article.markdown},
        }).to_string();
        let mut watchdog = SaveWatchdog::start(Arc::clone(&supervisors), Arc::clone(&claim.cancelled), started, Arc::clone(&cleanup_budget))?;
        let run_result = if claim.cancelled.load(Ordering::Acquire) {
            Err(WebPageError::Cancelled.to_string())
        } else {
            reserved.execute(WorkerJob::save_web_page(payload, progress.with_web_session(Arc::clone(&workspace))))
        };
        watchdog.finish()?;
        if let Ok(Ok(WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(result)))) = &run_result {
            if result.task_id.as_deref().is_some_and(|id| id != expected_task_id) {
                return Err("WORKER_PROTOCOL_VIOLATION".into());
            }
        }
        let durable = workspace.recover_saved(paths)?;
        let result = match (durable, run_result) {
            (Some(result), _) => result,
            (None, Ok(Ok(WorkerRunOutcome::Structured(ValidatedWorkerResult::Task(result))))) => result,
            _ => return Err(if started.elapsed() >= Duration::from_secs(90) { WebPageError::Timeout }
                else if claim.cancelled.load(Ordering::Acquire) { WebPageError::Cancelled } else { WebPageError::LoadFailed }.to_string()),
        };
        if let Some(task_id) = result.task_id.as_deref() {
            if task_id != expected_task_id {
                return Err("WORKER_PROTOCOL_VIOLATION".into());
            }
            let task = crate::task_manifest::SupportedTask::open(&paths.output_root()?, task_id)?;
            if !result.validate_source_task(&task) { return Err("WORKER_PROTOCOL_VIOLATION".into()); }
        }
        Ok(result)
        })();
        let deadline = *cleanup_budget.lock().map_err(|_| "WEB_CLEANUP_FAILED")?
            .get_or_insert_with(|| Instant::now() + Duration::from_secs(15));
        if let Err(error) = workspace.cleanup_before(deadline) {
            ownership::require_recovery(&paths.cache_root()?);
            return Err(error);
        }
        outcome
}

fn load_extractor(path: &Path) -> Result<String, String> {
    validate_extractor(path).map_err(|_| "WEB_HOST_FAILED".to_owned())
}

fn validate_extractor(path: &Path) -> WebResult<String> {
    use sha2::{Digest, Sha256};
    let manifest_path = path.with_file_name("extract-article.manifest.json");
    let file = crate::safe_filesystem::open_regular(&manifest_path).map_err(|_| WebPageError::BrowserFailed)?;
    let manifest: serde_json::Value = serde_json::from_reader(std::io::Read::take(file, 128 * 1024))
        .map_err(|_| WebPageError::BrowserFailed)?;
    let mut bundle = crate::safe_filesystem::open_regular(path).map_err(|_| WebPageError::BrowserFailed)?;
    let size = bundle.metadata().map_err(|_| WebPageError::BrowserFailed)?.len();
    if size == 0 || size > 2 * 1024 * 1024 || manifest.get("bytes").and_then(serde_json::Value::as_u64) != Some(size) {
        return Err(WebPageError::BrowserFailed);
    }
    let mut bytes = Vec::with_capacity(size as usize);
    std::io::Read::by_ref(&mut bundle).take(2 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| WebPageError::BrowserFailed)?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    if manifest.get("sha256").and_then(serde_json::Value::as_str) != Some(digest.as_str()) { return Err(WebPageError::BrowserFailed); }
    String::from_utf8(bytes).map_err(|_| WebPageError::BrowserFailed)
}

struct SaveWatchdog {
    done: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl SaveWatchdog {
    fn start(supervisors: Arc<crate::ProcessSupervisors>, cancelled: Arc<AtomicBool>, started: Instant,
        cleanup_budget: Arc<Mutex<Option<Instant>>>) -> Result<Self, String> {
        let done = Arc::new(AtomicBool::new(false));
        let finished = Arc::clone(&done);
        let thread = std::thread::Builder::new().name("web-operation-watchdog".into()).spawn(move || {
            while !finished.load(Ordering::Acquire) {
                if cancelled.load(Ordering::Acquire) || started.elapsed() >= Duration::from_secs(90) {
                    cancelled.store(true, Ordering::Release);
                    cleanup_budget.lock().expect("web cleanup mutex")
                        .get_or_insert_with(|| Instant::now() + Duration::from_secs(15));
                    let _ = supervisors.cancel_task();
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }).map_err(|_| WebPageError::BrowserFailed.to_string())?;
        Ok(Self { done, thread: Some(thread) })
    }
    fn finish(&mut self) -> Result<(), String> {
        self.done.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() { thread.join().map_err(|_| WebPageError::BrowserFailed.to_string())?; }
        Ok(())
    }
}
impl Drop for SaveWatchdog { fn drop(&mut self) { let _ = self.finish(); } }

#[cfg(test)]
mod tests;
