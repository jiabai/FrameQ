use crate::{environment::{string, wide}, lifecycle::Shared, policy};
use serde_json::Value;
use std::collections::HashSet;
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::core::PCWSTR;

const BYTE_LIMIT: f64 = (64 * 1024 * 1024) as f64;
const TRACKED_LIMIT: usize = 1024;

#[derive(Default)]
pub struct Activity {
    requests: HashSet<String>,
    bytes: f64,
    epoch: u64,
    enabled: bool,
}

impl Activity {
    pub fn busy(&self) -> bool { !self.requests.is_empty() }
    pub fn epoch(&self) -> u64 { self.epoch }
    pub fn enabled(&self) -> bool { self.enabled }

    pub fn observe(&mut self, event: &str, params: &Value) -> std::result::Result<(), &'static str> {
        let id = params.get("requestId").and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control))
            .ok_or("WEB_PROTOCOL_INVALID")?;
        match event {
            "Network.requestWillBeSent" => {
                let kind = match params.get("type") {
                    Some(value) => Some(value.as_str().ok_or("WEB_PROTOCOL_INVALID")?),
                    None => None,
                };
                if matches!(kind, Some("Document" | "Script" | "Stylesheet" | "XHR" | "Fetch")) {
                    if !self.requests.contains(id) && self.requests.len() >= TRACKED_LIMIT { return Err("WEB_RESOURCE_LIMIT"); }
                    self.requests.insert(id.to_owned());
                    self.epoch = self.epoch.checked_add(1).ok_or("WEB_RESOURCE_LIMIT")?;
                } else if kind.is_some() {
                    if self.requests.remove(id) { self.epoch = self.epoch.checked_add(1).ok_or("WEB_RESOURCE_LIMIT")?; }
                }
            }
            "Network.loadingFinished" => {
                let bytes = params.get("encodedDataLength").and_then(Value::as_f64)
                    .filter(|bytes| bytes.is_finite() && *bytes >= 0.0)
                    .ok_or("WEB_PROTOCOL_INVALID")?;
                let total = self.bytes + bytes;
                if !total.is_finite() || total > BYTE_LIMIT { return Err("WEB_RESOURCE_LIMIT"); }
                self.bytes = total;
                if self.requests.remove(id) { self.epoch = self.epoch.checked_add(1).ok_or("WEB_RESOURCE_LIMIT")?; }
            }
            "Network.loadingFailed" => {
                if self.requests.remove(id) { self.epoch = self.epoch.checked_add(1).ok_or("WEB_RESOURCE_LIMIT")?; }
            }
            _ => return Err("WEB_PROTOCOL_INVALID"),
        }
        Ok(())
    }
}

pub unsafe fn install(webview: &ICoreWebView2, shared: Shared) -> windows::core::Result<()> {
    let mut token = 0;
    for event in ["Network.requestWillBeSent", "Network.loadingFinished", "Network.loadingFailed"] {
        let method = wide(event);
        let receiver = webview.GetDevToolsProtocolEventReceiver(PCWSTR(method.as_ptr()))?;
        let shared = shared.clone();
        receiver.add_DevToolsProtocolEventReceived(&DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
            if shared.borrow().closing { return Ok(()); }
            let args = args.ok_or_else(windows::core::Error::from_win32)?;
            let params = string(|value| args.ParameterObjectAsJson(value))?;
            let mut state = shared.borrow_mut();
            let result = if params.len() > 2 * 1024 * 1024 { Err("WEB_RESOURCE_LIMIT") }
                else { serde_json::from_str::<Value>(&params).map_err(|_| "WEB_PROTOCOL_INVALID")
                    .and_then(|value| state.network.observe(event, &value)) };
            if let Err(code) = result {
                if code == "WEB_RESOURCE_LIMIT" {
                    let reason = if params.len() > 2 * 1024 * 1024 || event == "Network.loadingFinished" { "byte_limit" } else { "queue_full" };
                    policy::diagnostic(&mut state, reason, "other");
                }
                state.error = Some(code);
            }
            Ok(())
        })), &mut token)?;
    }
    let method = wide("Network.enable");
    let params = wide(r#"{"maxTotalBufferSize":0,"maxResourceBufferSize":0,"maxPostDataSize":0}"#);
    webview.CallDevToolsProtocolMethod(PCWSTR(method.as_ptr()), PCWSTR(params.as_ptr()),
        &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, _| {
            let mut state = shared.borrow_mut();
            if !state.closing {
                if status.is_err() { state.error = Some("WEB_RUNTIME_UNSUPPORTED"); }
                else { state.network.enabled = true; }
            }
            Ok(())
        })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn required_downloads_remain_busy_until_native_completion() {
        let mut activity = Activity::default();
        for (id, kind) in [("121.1", "Document"), ("121.2", "Script"), ("121.3", "Stylesheet"), ("121.4", "XHR"), ("121.5", "Fetch")] {
            activity.observe("Network.requestWillBeSent", &json!({"requestId":id,"type":kind})).unwrap();
        }
        assert!(activity.busy());
        assert_eq!(activity.epoch(), 5);
        for id in ["121.1", "121.2", "121.3", "121.4"] {
            activity.observe("Network.loadingFinished", &json!({"requestId":id,"encodedDataLength":1024})).unwrap();
        }
        assert!(activity.busy());
        activity.observe("Network.loadingFailed", &json!({"requestId":"121.5","errorText":"net::ERR_NAME_NOT_RESOLVED"})).unwrap();
        assert!(!activity.busy());
    }

    #[test]
    fn optional_media_does_not_count_as_required_work() {
        let mut activity = Activity::default();
        for kind in ["Image", "Media", "Font", "Ping", "Other"] {
            activity.observe("Network.requestWillBeSent", &json!({"requestId":kind,"type":kind})).unwrap();
        }
        assert!(!activity.busy());
        assert_eq!(activity.epoch(), 0);
        activity.observe("Network.requestWillBeSent", &json!({"requestId":"121.7","type":"Fetch"})).unwrap();
        assert!(activity.busy());
        assert_eq!(activity.epoch(), 1);
    }

    #[test]
    fn redirects_reuse_the_native_identifier_until_final_completion() {
        let mut activity = Activity::default();
        for _ in 0..5 {
            activity.observe("Network.requestWillBeSent", &json!({"requestId":"121.1","type":"Document","redirectResponse":{"status":302}})).unwrap();
        }
        assert!(activity.busy());
        assert_eq!(activity.epoch(), 5);
        activity.observe("Network.loadingFinished", &json!({"requestId":"121.1","encodedDataLength":4096})).unwrap();
        assert!(!activity.busy());
    }

    #[test]
    fn actual_completed_byte_budget_includes_optional_resources() {
        let mut activity = Activity::default();
        activity.observe("Network.loadingFinished", &json!({"requestId":"121.1","encodedDataLength":64 * 1024 * 1024})).unwrap();
        assert_eq!(activity.observe("Network.loadingFinished", &json!({"requestId":"121.2","encodedDataLength":1})), Err("WEB_RESOURCE_LIMIT"));
    }

    #[test]
    fn malformed_identifiers_and_lengths_fail_before_state_changes() {
        for request in [json!({}), json!({"requestId":""}), json!({"requestId":"x".repeat(257)}), json!({"requestId":7})] {
            let mut activity = Activity::default();
            assert_eq!(activity.observe("Network.requestWillBeSent", &request), Err("WEB_PROTOCOL_INVALID"));
            assert!(!activity.busy());
        }
        for length in [json!(-1), json!("100"), json!(null)] {
            let mut activity = Activity::default();
            assert_eq!(activity.observe("Network.loadingFinished", &json!({"requestId":"121.1","encodedDataLength":length})), Err("WEB_PROTOCOL_INVALID"));
        }
    }

    #[test]
    fn missing_optional_resource_type_is_not_a_protocol_failure() {
        let mut activity = Activity::default();
        activity.observe("Network.requestWillBeSent", &json!({"requestId":"121.1"})).unwrap();
        assert!(!activity.busy());
        assert_eq!(activity.epoch(), 0);
    }

    #[test]
    fn resource_tracking_is_bounded_and_slots_are_released() {
        let mut activity = Activity::default();
        for request in 0..1024 {
            activity.observe("Network.requestWillBeSent", &json!({"requestId":request.to_string(),"type":"Fetch"})).unwrap();
        }
        assert_eq!(activity.observe("Network.requestWillBeSent", &json!({"requestId":"overflow","type":"Script"})), Err("WEB_RESOURCE_LIMIT"));
        activity.observe("Network.loadingFailed", &json!({"requestId":"0"})).unwrap();
        activity.observe("Network.requestWillBeSent", &json!({"requestId":"replacement","type":"Script"})).unwrap();
        assert_eq!(activity.epoch(), 1026);
    }
}
