use crate::{environment::{self, Native}, extraction, policy::{self, Pending}};
use crate::protocol::{HostResult, Identity, Input, SCRIPT_LIMIT};
use serde_json::{json, Value};
use std::{cell::{Cell, RefCell}, collections::{HashMap, VecDeque}, rc::Rc, sync::mpsc::{Receiver, TryRecvError}, time::{Duration, Instant}};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{core::Interface, Win32::{System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED}, UI::WindowsAndMessaging::DestroyWindow}};

pub type Shared = Rc<RefCell<State>>;

pub fn fatal_process_failure(kind: COREWEBVIEW2_PROCESS_FAILED_KIND) -> bool {
    !matches!(kind, COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED | COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED)
}

fn main_response_failure(status: i32) -> Option<&'static str> {
    match status {
        401 | 403 | 407 => Some("WEB_PAGE_ACCESS_RESTRICTED"),
        200..=299 => None,
        _ => Some("WEB_PAGE_HTTP_FAILED"),
    }
}

pub struct State {
    pub identity: Identity,
    pub environment: ICoreWebView2Environment,
    pub script: String,
    pub generation: u64,
    pub navigation_id: u64,
    pub navigations: u32,
    pub requests: u64,
    pub pending: HashMap<u64, Pending>,
    pub queued: VecDeque<u64>,
    pub main_url: String,
    pub diagnostics: Vec<(&'static str, &'static str)>,
    pub network: crate::network_activity::Activity,
    pub extraction_announced: bool,
    pub error: Option<&'static str>,
    pub closing: bool,
    pub started: bool,
    pub context: Option<u64>,
    pub javascript_pending: bool,
    pub javascript_started: Instant,
    pub next_sample: Instant,
    pub stable_samples: u32,
    pub extracting: bool,
    pub article: Option<Value>,
}

impl State {
    pub fn current(&self, generation: u64) -> bool { !self.closing && self.error.is_none() && self.generation == generation }
    pub fn current_context(&self, generation: u64, context: u64) -> bool { self.current(generation) && self.context == Some(context) }
}

struct Com;
impl Drop for Com { fn drop(&mut self) { unsafe { CoUninitialize(); } } }

pub fn run(identity: Identity, url: String, script: String, directory: String, deadline_ms: u64, receiver: Receiver<HostResult<Option<Input>>>) -> HostResult<bool> {
    if deadline_ms != 90_000 || script.is_empty() || script.len() > SCRIPT_LIMIT || script.contains('\0') || !policy::permitted_url(&url) {
        return Err("WEB_PROTOCOL_INVALID");
    }
    environment::reject_overrides()?;
    let directory = environment::validate_directory(&directory)?;
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|_| "WEB_HOST_FAILED")?; }
    let _com = Com;
    let began = Instant::now();
    let preparation = unsafe { environment::begin(&directory)? };
    let mut preparation_failure = None;
    let native = loop {
        environment::pump();
        if let Some(result) = preparation.borrow_mut().take() { break result.map_err(|_| "WEB_RUNTIME_UNSUPPORTED")?; }
        if began.elapsed() >= Duration::from_secs(15) { return Err(preparation_failure.unwrap_or("WEB_PREPARE_TIMEOUT")); }
        match receiver.try_recv() {
            Ok(Ok(Some(input))) if identity.matches(&input) && matches!(input, Input::Cancel { .. }) => { preparation_failure.get_or_insert("WEB_CANCELLED"); }
            Err(TryRecvError::Empty) => (),
            _ => { preparation_failure.get_or_insert("WEB_PROTOCOL_INVALID"); }
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let state = Rc::new(RefCell::new(State {
        identity: identity.clone(), environment: native.environment.clone(), script,
        generation: 0, navigation_id: 0, navigations: 0, requests: 0, pending: HashMap::new(),
        queued: VecDeque::new(), main_url: String::new(), diagnostics: Vec::new(),
        network: crate::network_activity::Activity::default(), extraction_announced: false,
        error: None, closing: false, started: false, context: None, javascript_pending: false,
        javascript_started: Instant::now(), next_sample: Instant::now(), stable_samples: 0, extracting: false, article: None,
    }));
    let exited = Rc::new(Cell::new(false));
    let exited_state = exited.clone();
    let browser_pid = native.browser_pid;
    let mut exit_token = 0;
    unsafe {
        native.environment.cast::<ICoreWebView2Environment5>().map_err(|_| "WEB_RUNTIME_UNSUPPORTED")?
            .add_BrowserProcessExited(&BrowserProcessExitedEventHandler::create(Box::new(move |_, args| {
                let args = args.ok_or_else(windows::core::Error::from_win32)?;
                let mut pid = 0;
                args.BrowserProcessId(&mut pid)?;
                if pid == browser_pid { exited_state.set(true); }
                Ok(())
            })), &mut exit_token).map_err(|_| "WEB_HOST_FAILED")?;
    }
    let result = if let Some(code) = preparation_failure { Err(code) }
        else { unsafe { session(&native, state.clone(), &receiver, &url, began) } };
    let clean = unsafe { close(&native, &state, &exited) };
    unsafe {
        let _ = native.environment.cast::<ICoreWebView2Environment5>().and_then(|env| env.remove_BrowserProcessExited(exit_token));
        let _ = DestroyWindow(native.hwnd);
    }
    if let Err(code) = result { identity.emit(json!({"type":"error", "code":code}))?; }
    if !clean && result.is_ok() { identity.emit(json!({"type":"error", "code":"WEB_CLEANUP_FAILED"}))?; }
    identity.emit(json!({"type":"closed", "clean":clean}))?;
    Ok(result.is_ok() && clean)
}

unsafe fn session(native: &Native, shared: Shared, receiver: &Receiver<HostResult<Option<Input>>>, url: &str, began: Instant) -> HostResult<()> {
    install_navigation(&native.webview, shared.clone()).map_err(|_| "WEB_RUNTIME_UNSUPPORTED")?;
    policy::install(&native.webview, shared.clone()).map_err(|_| "WEB_RUNTIME_UNSUPPORTED")?;
    extraction::install(&native.webview, shared.clone()).map_err(|_| "WEB_RUNTIME_UNSUPPORTED")?;
    crate::network_activity::install(&native.webview, shared.clone()).map_err(|_| "WEB_RUNTIME_UNSUPPORTED")?;
    shared.borrow().identity.emit(json!({"type":"ready", "runtime_version":native.runtime, "browser_pid":native.browser_pid}))?;
    let mut navigation_began = None;
    let mut start_requested = false;
    loop {
        environment::pump();
        for _ in 0..32 {
            match receiver.try_recv() {
                Ok(record) => {
                    let input = record?.ok_or("WEB_HOST_FAILED")?;
                    if !shared.borrow().identity.matches(&input) { return Err("WEB_PROTOCOL_INVALID"); }
                    match input {
                        Input::Cancel { .. } => return Err("WEB_CANCELLED"),
                        Input::Start { .. } => {
                            if shared.borrow().started { return Err("WEB_PROTOCOL_INVALID"); }
                            shared.borrow_mut().started = true;
                            start_requested = true;
                        }
                        Input::PolicyDecision { request_id, navigation_generation, allow, error, .. } => {
                            if (allow && error.is_some()) || (!allow && error.as_ref().is_none_or(String::is_empty)) { return Err("WEB_PROTOCOL_INVALID"); }
                            policy::decide(&shared, request_id, navigation_generation, allow, error.as_deref()).map_err(|_| "WEB_PROTOCOL_INVALID")?;
                        }
                        Input::Init { .. } => return Err("WEB_PROTOCOL_INVALID"),
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return Err("WEB_HOST_FAILED"),
            }
        }
        policy::expire(&shared, false).map_err(|_| "WEB_HOST_FAILED")?;
        if let Some(code) = shared.borrow().error { return Err(code); }
        if start_requested && navigation_began.is_none() {
            if shared.borrow().network.enabled() {
                let url = environment::wide(url);
                native.webview.Navigate(windows::core::PCWSTR(url.as_ptr())).map_err(|_| "WEB_NAVIGATION_FAILED")?;
                navigation_began = Some(Instant::now());
            } else if began.elapsed() >= Duration::from_secs(15) { return Err("WEB_PREPARE_TIMEOUT"); }
        }
        if began.elapsed() >= Duration::from_millis(90_000) { return Err("WEB_TIMEOUT"); }
        if navigation_began.is_some_and(|time| time.elapsed() >= Duration::from_secs(60)) { return Err("WEB_NAVIGATION_TIMEOUT"); }
        {
            let state = shared.borrow();
            if state.javascript_pending && state.javascript_started.elapsed() >= Duration::from_secs(2) { return Err("WEB_EXTRACTION_TIMEOUT"); }
        }
        let article = shared.borrow_mut().article.take();
        if let Some(article) = article {
            shared.borrow().identity.emit(article)?;
            return Ok(());
        }
        let sample = {
            let state = shared.borrow();
            state.context.is_some() && !state.javascript_pending && !state.extracting && Instant::now() >= state.next_sample
        };
        if sample {
            let generation = shared.borrow().generation;
            extraction::sample(&native.webview, shared.clone(), generation).map_err(|_| "WEB_EXTRACTION_FAILED")?;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

unsafe fn install_navigation(webview: &ICoreWebView2, shared: Shared) -> windows::core::Result<()> {
    let mut token = 0;
    let navigation = shared.clone();
    webview.add_NavigationStarting(&NavigationStartingEventHandler::create(Box::new(move |_, args| {
        let args = args.ok_or_else(windows::core::Error::from_win32)?;
        let url = environment::string(|value| args.Uri(value))?;
        let mut state = navigation.borrow_mut();
        if state.closing || !state.started || !policy::permitted_url(&url) || state.navigations >= 6 {
            args.SetCancel(true)?;
            if state.started && !state.closing { state.error = Some("WEB_URL_BLOCKED"); }
            return Ok(());
        }
        state.generation += 1;
        state.main_url = url;
        state.navigations += 1;
        args.NavigationId(&mut state.navigation_id)?;
        state.context = None;
        state.javascript_pending = false;
        state.stable_samples = 0;
        state.extracting = false;
        state.extraction_announced = false;
        state.article = None;
        let generation = state.generation;
        if let Err(code) = state.identity.emit(json!({"type":"stage", "navigation_generation":generation, "stage":"web_loading"})) { state.error = Some(code); }
        Ok(())
    })), &mut token)?;
    let completed = shared.clone();
    let view = webview.clone();
    webview.add_NavigationCompleted(&NavigationCompletedEventHandler::create(Box::new(move |_, args| {
        let args = args.ok_or_else(windows::core::Error::from_win32)?;
        let mut navigation_id = 0;
        args.NavigationId(&mut navigation_id)?;
        let generation = {
            let mut state = completed.borrow_mut();
            if state.closing || state.error.is_some() || !state.started || state.navigation_id != navigation_id { return Ok(()); }
            let mut success = windows::core::BOOL::default();
            args.IsSuccess(&mut success)?;
            if !success.as_bool() { state.error = Some("WEB_NAVIGATION_FAILED"); return Ok(()); }
            let mut status = 0;
            args.cast::<ICoreWebView2NavigationCompletedEventArgs2>()?.HttpStatusCode(&mut status)?;
            if let Some(code) = main_response_failure(status) { state.error = Some(code); return Ok(()); }
            state.javascript_pending = true;
            state.javascript_started = Instant::now();
            state.generation
        };
        extraction::create_world(&view, completed.clone(), generation)
    })), &mut token)?;
    let failed = shared.clone();
    webview.add_ProcessFailed(&ProcessFailedEventHandler::create(Box::new(move |_, args| {
        let mut state = failed.borrow_mut();
        if !state.closing {
            let args = args.ok_or_else(windows::core::Error::from_win32)?;
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            let mut reason = COREWEBVIEW2_PROCESS_FAILED_REASON::default();
            let mut exit_code = 0;
            args.ProcessFailedKind(&mut kind)?;
            let details = args.cast::<ICoreWebView2ProcessFailedEventArgs2>()?;
            details.Reason(&mut reason)?;
            details.ExitCode(&mut exit_code)?;
            eprintln!("{}", json!({"kind":kind.0, "reason":reason.0, "exit_code":exit_code}));
            if fatal_process_failure(kind) {
                state.error = Some("WEB_PROCESS_FAILED"); state.context = None;
            }
        }
        Ok(())
    })), &mut token)?;
    let closed = shared.clone();
    webview.add_WindowCloseRequested(&WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
        closed.borrow_mut().error = Some("WEB_NAVIGATION_FAILED");
        Ok(())
    })), &mut token)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completed_http_error_pages_cannot_be_saved_as_articles() {
        for status in [401, 403, 407] { assert_eq!(main_response_failure(status), Some("WEB_PAGE_ACCESS_RESTRICTED")); }
        for status in [0, 301, 404, 500] { assert_eq!(main_response_failure(status), Some("WEB_PAGE_HTTP_FAILED")); }
        assert_eq!(main_response_failure(200), None);
    }
    #[test]
    fn browser_and_renderer_failures_invalidate_the_document() {
        for kind in [COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE] {
            assert!(fatal_process_failure(kind));
        }
        assert!(!fatal_process_failure(COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED));
        assert!(!fatal_process_failure(COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED));
    }
}

unsafe fn close(native: &Native, shared: &Shared, exited: &Rc<Cell<bool>>) -> bool {
    {
        let mut state = shared.borrow_mut();
        state.closing = true;
        state.context = None;
        state.article = None;
    }
    let blocked = policy::expire(shared, true).is_ok();
    let stopped = native.webview.Stop().is_ok();
    let closed = native.controller.Close().is_ok();
    let began = Instant::now();
    while !exited.get() && began.elapsed() < Duration::from_secs(15) {
        environment::pump();
        std::thread::sleep(Duration::from_millis(5));
    }
    blocked && stopped && closed && exited.get()
}
