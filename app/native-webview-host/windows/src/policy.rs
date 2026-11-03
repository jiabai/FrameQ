use crate::{environment::{string, wide}, lifecycle::Shared};
use std::{net::IpAddr, time::{Duration, Instant}};
use serde_json::json;
use url::{Host, Url};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::core::{w, Interface, PCWSTR};

pub struct Pending {
    pub generation: u64,
    pub created: Instant,
    pub started: Option<Instant>,
    pub completed: bool,
    pub url: String,
    pub main: bool,
    pub resource: &'static str,
    pub args: ICoreWebView2WebResourceRequestedEventArgs,
    pub deferral: ICoreWebView2Deferral,
}

pub fn diagnostic(state: &mut crate::lifecycle::State, reason: &'static str, resource: &'static str) {
    if state.diagnostics.len() < 16 && !state.diagnostics.contains(&(reason, resource)) {
        state.diagnostics.push((reason, resource));
        eprintln!("{}", json!({"reason":reason,"resource":resource}));
    }
}

pub fn checking_document(state: &crate::lifecycle::State) -> bool {
    state.pending.values().any(|request| !request.completed && request.generation == state.generation && matches!(request.resource, "document" | "script" | "stylesheet"))
}

fn main_document_target(request: &str, navigation: &str) -> bool {
    let (Ok(mut request), Ok(mut navigation)) = (Url::parse(request), Url::parse(navigation)) else { return false; };
    request.set_fragment(None);
    navigation.set_fragment(None);
    request == navigation
}

pub fn permitted_url(value: &str) -> bool {
    if value.chars().count() > 16384 || value.trim() != value || value.chars().any(|ch| ch.is_control() || ch.is_whitespace()) || value.contains('\\') { return false; }
    let Ok(url) = Url::parse(value) else { return false; };
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() || value.contains('\0') { return false; }
    if !matches!(url.port_or_known_default(), Some(80 | 443)) { return false; }
    match url.host() {
        Some(Host::Domain(domain)) => {
            let domain = domain.to_ascii_lowercase();
            domain.len() <= 253 && domain.contains('.') && !domain.ends_with('.')
                && !domain.rsplit('.').next().is_some_and(|label| label.bytes().all(|byte| byte.is_ascii_digit()))
                && domain.split('.').all(|label| !label.is_empty() && label.len() <= 63 && !label.starts_with('-') && !label.ends_with('-') && label.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'))
                && !["localhost", "local", "internal", "home", "test", "invalid", "example", "arpa", "onion"].iter()
                .any(|suffix| domain == *suffix || domain.ends_with(&format!(".{suffix}")))
        }
        Some(Host::Ipv4(address)) => public_ip(IpAddr::V4(address)),
        Some(Host::Ipv6(address)) => public_ip(IpAddr::V6(address)),
        None => false,
    }
}

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a,b,c,_] = ip.octets();
            !(a == 0 || a == 10 || a == 127 || a >= 224 || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254) || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2)) || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            let segments = ip.segments();
            segments[0] & 0xe000 == 0x2000
                && !(segments[0] == 0x2001 && (segments[1] < 0x200 || segments[1] == 0xdb8))
                && segments[0] != 0x2002
                && !(segments[0] == 0x3fff && segments[1] < 0x1000)
        }
    }
}

pub unsafe fn block(environment: &ICoreWebView2Environment, pending: &Pending) -> windows::core::Result<()> {
    if pending.completed { return Ok(()); }
    let response = environment.CreateWebResourceResponse(None, 403, w!("Forbidden"), w!("Content-Length: 0\r\nCache-Control: no-store\r\n"))?;
    pending.args.SetResponse(&response)?;
    pending.deferral.Complete()
}

pub unsafe fn decide(shared: &Shared, request_id: u64, generation: u64, allow: bool, error: Option<&str>) -> windows::core::Result<()> {
    let (pending, environment, active) = {
        let mut state = shared.borrow_mut();
        (state.pending.remove(&request_id), state.environment.clone(), state.generation == generation && !state.closing)
    };
    let Some(pending) = pending else { return Ok(()); };
    if pending.completed { return dispatch(shared); }
    if pending.generation != generation || !active || !allow || pending.started.is_none_or(|time| time.elapsed() >= Duration::from_secs(2)) {
        let mut state = shared.borrow_mut();
        let code = if pending.started.is_some_and(|time| time.elapsed() >= Duration::from_secs(2)) { "WEB_NETWORK_POLICY_TIMEOUT" }
            else { match error { Some("WEB_LOAD_FAILED") => "WEB_LOAD_FAILED", Some("WEB_NETWORK_POLICY_TIMEOUT") => "WEB_NETWORK_POLICY_TIMEOUT", _ => "WEB_URL_BLOCKED" } };
        let reason = if !active { "stale_generation" } else { match code { "WEB_LOAD_FAILED" => "dns_failed", "WEB_NETWORK_POLICY_TIMEOUT" => "dns_timeout", _ => "blocked_url" } };
        diagnostic(&mut state, reason, pending.resource);
        if pending.main && active { state.error = Some(code); }
        drop(state);
        block(&environment, &pending)?;
    } else {
        pending.deferral.Complete()?;
    }
    dispatch(shared)
}

unsafe fn dispatch(shared: &Shared) -> windows::core::Result<()> {
    let mut state = shared.borrow_mut();
    while !state.closing && state.error.is_none() && state.pending.values().filter(|item| item.started.is_some()).count() < 16 {
        let Some(id) = state.queued.pop_front() else { break; };
        let generation = state.generation;
        let Some(pending) = state.pending.get_mut(&id) else { continue; };
        if pending.generation != generation {
            let pending = state.pending.remove(&id).expect("queued request");
            block(&state.environment, &pending)?;
            continue;
        }
        pending.started = Some(Instant::now());
        let event = json!({"type":"policy_check", "request_id":id, "navigation_generation":generation, "url":pending.url, "kind":if pending.main {"navigation"} else {"resource"}});
        if let Err(code) = state.identity.emit(event) { state.error = Some(code); }
    }
    Ok(())
}

pub unsafe fn expire(shared: &Shared, all: bool) -> windows::core::Result<()> {
    {
        let mut state = shared.borrow_mut();
        let expired = state.pending.iter().filter(|(_, p)| all || (!p.completed && p.started.map_or_else(|| p.created.elapsed() >= Duration::from_secs(10), |time| time.elapsed() >= Duration::from_secs(2)))).map(|(id,_)| *id).collect::<Vec<_>>();
        let pending = expired.into_iter().map(|id| (id, state.pending.remove(&id).expect("existing request"))).collect::<Vec<_>>();
        for (_, request) in &pending {
            if !all {
                diagnostic(&mut state, if request.started.is_some() { "dns_timeout" } else { "queue_timeout" }, request.resource);
                if request.generation == state.generation && (request.main || request.started.is_none()) { state.error = Some("WEB_NETWORK_POLICY_TIMEOUT"); }
            }
        }
        for (id, mut request) in pending {
            block(&state.environment, &request)?;
            request.completed = true;
            if !all && request.started.is_some() {
                // 已阻断请求仍占用检查名额，直到父进程回复，避免两端在途计数不一致。
                state.pending.insert(id, request);
            }
        }
        let live = state.pending.keys().copied().collect::<std::collections::HashSet<_>>();
        state.queued.retain(|id| live.contains(id));
    }
    if !all { dispatch(shared)?; }
    Ok(())
}

pub unsafe fn install(webview: &ICoreWebView2, shared: Shared) -> windows::core::Result<()> {
    let settings = webview.Settings()?;
    settings.SetIsWebMessageEnabled(false)?;
    settings.SetAreHostObjectsAllowed(false)?;
    settings.SetAreDevToolsEnabled(false)?;
    settings.SetAreDefaultScriptDialogsEnabled(false)?;
    settings.SetAreDefaultContextMenusEnabled(false)?;
    settings.SetIsStatusBarEnabled(false)?;
    settings.SetIsBuiltInErrorPageEnabled(false)?;
    settings.cast::<ICoreWebView2Settings3>()?.SetAreBrowserAcceleratorKeysEnabled(false)?;
    let settings4 = settings.cast::<ICoreWebView2Settings4>()?;
    settings4.SetIsPasswordAutosaveEnabled(false)?;
    settings4.SetIsGeneralAutofillEnabled(false)?;
    webview.cast::<ICoreWebView2_8>()?.SetIsMuted(true)?;
    let mut token = 0;
    webview.add_PermissionRequested(&PermissionRequestedEventHandler::create(Box::new(|_, args| {
        let args = args.ok_or_else(windows::core::Error::from_win32)?;
        args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
        args.cast::<ICoreWebView2PermissionRequestedEventArgs3>()?.SetSavesInProfile(false)?;
        args.cast::<ICoreWebView2PermissionRequestedEventArgs2>()?.SetHandled(true)
    })), &mut token)?;
    webview.add_NewWindowRequested(&NewWindowRequestedEventHandler::create(Box::new(|_, args| args.ok_or_else(windows::core::Error::from_win32)?.SetHandled(true))), &mut token)?;
    webview.cast::<ICoreWebView2_4>()?.add_DownloadStarting(&DownloadStartingEventHandler::create(Box::new(|_, args| {
        let args = args.ok_or_else(windows::core::Error::from_win32)?;
        args.SetCancel(true)?;
        args.SetHandled(true)
    })), &mut token)?;
    webview.cast::<ICoreWebView2_5>()?.add_ClientCertificateRequested(&ClientCertificateRequestedEventHandler::create(Box::new(|_, args| {
        let args = args.ok_or_else(windows::core::Error::from_win32)?;
        args.SetCancel(true)?;
        args.SetHandled(true)
    })), &mut token)?;
    webview.cast::<ICoreWebView2_10>()?.add_BasicAuthenticationRequested(&BasicAuthenticationRequestedEventHandler::create(Box::new(|_, args| args.ok_or_else(windows::core::Error::from_win32)?.SetCancel(true))), &mut token)?;
    webview.cast::<ICoreWebView2_14>()?.add_ServerCertificateErrorDetected(&ServerCertificateErrorDetectedEventHandler::create(Box::new(|_, args| args.ok_or_else(windows::core::Error::from_win32)?.SetAction(COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL))), &mut token)?;
    webview.cast::<ICoreWebView2_18>()?.add_LaunchingExternalUriScheme(&LaunchingExternalUriSchemeEventHandler::create(Box::new(|_, args| args.ok_or_else(windows::core::Error::from_win32)?.SetCancel(true))), &mut token)?;
    webview.cast::<ICoreWebView2_25>()?.add_SaveAsUIShowing(&SaveAsUIShowingEventHandler::create(Box::new(|_, args| args.ok_or_else(windows::core::Error::from_win32)?.SetCancel(true))), &mut token)?;
    let frame_state = shared.clone();
    webview.add_FrameNavigationStarting(&NavigationStartingEventHandler::create(Box::new(move |_, args| {
        let args = args.ok_or_else(windows::core::Error::from_win32)?;
        let url = string(|value| args.Uri(value))?;
        if !permitted_url(&url) || frame_state.borrow().closing { args.SetCancel(true)?; }
        Ok(())
    })), &mut token)?;
    let resource_state = shared.clone();
    webview.add_WebResourceRequested(&WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
        let args = args.ok_or_else(windows::core::Error::from_win32)?;
        let request = args.Request()?;
        let url = string(|value| request.Uri(value))?;
        let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
        args.ResourceContext(&mut context)?;
        let deferral = args.GetDeferral()?;
        let mut state = resource_state.borrow_mut();
        state.requests += 1;
        let media = [COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT].contains(&context);
        let main = context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT && main_document_target(&url, &state.main_url);
        let resource = match context {
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT => if main { "document" } else { "subdocument" },
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT => "script", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET => "stylesheet",
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE => "image", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA => "media", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT => "font",
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST => "xhr", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH => "fetch", _ => "other",
        };
        let pending = Pending { generation: state.generation, created: Instant::now(), started: None, completed: false, url: url.clone(), main, resource, args, deferral };
        if state.closing || media || !permitted_url(&url) || state.queued.len() >= 512 {
            if !state.closing {
                let reason = if media { "media_skipped" } else if !permitted_url(&url) { "blocked_url" } else { "queue_full" };
                diagnostic(&mut state, reason, resource);
                if main || reason == "queue_full" { state.error = Some(if reason == "queue_full" { "WEB_RESOURCE_LIMIT" } else { "WEB_URL_BLOCKED" }); }
            }
            let environment = state.environment.clone();
            drop(state);
            return block(&environment, &pending);
        }
        let request_id = state.requests;
        state.pending.insert(request_id, pending);
        state.queued.push_back(request_id);
        if matches!(resource, "document" | "script" | "stylesheet") { state.stable_samples = 0; }
        drop(state);
        dispatch(&resource_state)
    })), &mut token)?;
    let all = wide("*");
    webview.cast::<ICoreWebView2_22>()?.AddWebResourceRequestedFilterWithRequestSourceKinds(PCWSTR(all.as_ptr()), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL)?;
    for getter in [ICoreWebView2Settings::IsWebMessageEnabled, ICoreWebView2Settings::AreHostObjectsAllowed,
        ICoreWebView2Settings::AreDevToolsEnabled, ICoreWebView2Settings::AreDefaultScriptDialogsEnabled,
        ICoreWebView2Settings::AreDefaultContextMenusEnabled] {
        let mut enabled = windows::core::BOOL::default();
        getter(&settings, &mut enabled)?;
        if enabled.as_bool() { return Err(windows::Win32::Foundation::E_ACCESSDENIED.into()); }
    }
    let mut enabled = windows::core::BOOL::default();
    settings4.IsPasswordAutosaveEnabled(&mut enabled)?;
    if enabled.as_bool() { return Err(windows::Win32::Foundation::E_ACCESSDENIED.into()); }
    settings4.IsGeneralAutofillEnabled(&mut enabled)?;
    if enabled.as_bool() { return Err(windows::Win32::Foundation::E_ACCESSDENIED.into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn main_document_policy_matches_navigation_with_fragment() {
        assert!(main_document_target("https://example.com/article", "https://example.com/article#section"));
        assert!(!main_document_target("https://example.com/frame", "https://example.com/article#section"));
    }
    #[test]
    fn local_and_dangerous_targets_fail_synchronous_validation() {
        for url in ["file:///C:/Users/test", "http://127.1/", "http://[::ffff:127.0.0.1]/", "http://192.168.1.1/", "http://10.0.0.1/", "http://localhost/", "http://printer.local/", "https://example.com:22/", "https://user:secret@example.com/", "https://[2001:db8::1]/"] { assert!(!permitted_url(url), "{url}"); }
        assert!(permitted_url("https://example.com/article"));
    }
}
