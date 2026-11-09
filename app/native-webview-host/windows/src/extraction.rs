use crate::{environment::{string, wide}, lifecycle::Shared, policy};
use crate::protocol::HostResult;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::core::PCWSTR;

const SAMPLE: &str = r#"(() => {
  if (!/^(text\/html|application\/xhtml\+xml)$/i.test(document.contentType)) throw Error('article_extraction:unsupported_page');
  if (!document.documentElement || !document.body) throw Error('article_extraction:no_document');
  const walker = document.createTreeWalker(document, 0xffffffff);
  let nodes = 0;
  while(walker.nextNode()) if (++nodes > 100000) throw Error('article_extraction:dom_limit');
  const html = document.documentElement.outerHTML;
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > 8388608) throw Error('article_extraction:input_limit');
  const stable = globalThis.__appPreviousDom === html;
  globalThis.__appPreviousDom = html;
  return {stable, nodes, bytes};
})()"#;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Article {
    title: String,
    text: String,
    markdown: String,
    #[serde(rename = "sourceUrl")]
    source_url: String,
}

pub fn validate_article(value: &Value) -> HostResult<()> {
    let article: Article = serde_json::from_value(value.clone()).map_err(|_| "WEB_EXTRACTION_FAILED")?;
    if article.title.trim().is_empty() || article.title.chars().count() > 512
        || article.text.chars().filter(|c| !c.is_whitespace()).count() < 50
        || article.text.len() > 2 * 1024 * 1024 || article.markdown.trim().is_empty()
        || article.markdown.len() > 4 * 1024 * 1024 || !policy::permitted_url(&article.source_url) {
        return Err("WEB_EXTRACTION_FAILED");
    }
    Ok(())
}

fn fail(shared: &Shared, generation: u64, code: &'static str) {
    let mut state = shared.borrow_mut();
    if !state.closing && state.generation == generation { state.error = Some(code); }
}

unsafe fn call(webview: &ICoreWebView2, method: &str, parameters: Value, completed: impl FnOnce(windows::core::Result<()>, String) -> windows::core::Result<()> + 'static) -> windows::core::Result<()> {
    let method = wide(method);
    let params = wide(&parameters.to_string());
    webview.CallDevToolsProtocolMethod(PCWSTR(method.as_ptr()), PCWSTR(params.as_ptr()),
        &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(completed)))
}

pub unsafe fn create_world(webview: &ICoreWebView2, shared: Shared, generation: u64) -> windows::core::Result<()> {
    let view = webview.clone();
    call(webview, "Page.getFrameTree", json!({}), move |status, response| {
        if !shared.borrow().current(generation) { return Ok(()); }
        if status.is_err() { fail(&shared, generation, "WEB_EXTRACTION_FAILED"); return Ok(()); }
        let frame = serde_json::from_str::<Value>(&response).ok()
            .and_then(|v| v.pointer("/frameTree/frame/id").and_then(Value::as_str).map(str::to_owned));
        let Some(frame) = frame else { fail(&shared, generation, "WEB_EXTRACTION_FAILED"); return Ok(()); };
        let state = shared.clone();
        let view2 = view.clone();
        call(&view, "Page.createIsolatedWorld", json!({"frameId":frame, "worldName":format!("app-{}-{generation}", shared.borrow().identity.session_id)}), move |status, response| {
            if !state.borrow().current(generation) { return Ok(()); }
            if status.is_err() { fail(&state, generation, "WEB_EXTRACTION_FAILED"); return Ok(()); }
            let context = serde_json::from_str::<Value>(&response).ok().and_then(|v| v.get("executionContextId").and_then(Value::as_u64));
            let Some(context) = context else { fail(&state, generation, "WEB_EXTRACTION_FAILED"); return Ok(()); };
            {
                let mut state = state.borrow_mut();
                state.context = Some(context);
                state.javascript_pending = false;
                state.next_sample = Instant::now();
            }
            sample(&view2, state.clone(), generation)
        })
    })
}

pub unsafe fn sample(webview: &ICoreWebView2, shared: Shared, generation: u64) -> windows::core::Result<()> {
    let context = {
        let mut state = shared.borrow_mut();
        if !state.current(generation) || state.javascript_pending || state.context.is_none() || state.article.is_some() || policy::checking_document(&state) || state.network.busy() { return Ok(()); }
        state.javascript_pending = true;
        state.javascript_started = Instant::now();
        state.context.expect("checked context")
    };
    let view = webview.clone();
    call(webview, "Runtime.evaluate", json!({"expression":SAMPLE, "contextId":context, "returnByValue":true, "awaitPromise":true}), move |status, response| {
        if !shared.borrow().current_context(generation, context) { return Ok(()); }
        let value = evaluated_value(status, &response);
        let Ok(value) = value else { fail(&shared, generation, "WEB_EXTRACTION_FAILED"); return Ok(()); };
        let Some(stable) = value.get("stable").and_then(Value::as_bool) else { fail(&shared, generation, "WEB_EXTRACTION_FAILED"); return Ok(()); };
        let ready = {
            let mut state = shared.borrow_mut();
            state.javascript_pending = false;
            state.stable_samples = if stable && !policy::checking_document(&state) && !state.network.busy() { state.stable_samples + 1 } else { 0 };
            state.next_sample = Instant::now() + Duration::from_millis(500);
            state.stable_samples >= 3
        };
        if ready { extract(&view, shared.clone(), generation, context)?; }
        Ok(())
    })
}

fn evaluated_value(status: windows::core::Result<()>, response: &str) -> HostResult<Value> {
    status.map_err(|_| "WEB_EXTRACTION_FAILED")?;
    let result: Value = serde_json::from_str(response).map_err(|_| "WEB_EXTRACTION_FAILED")?;
    if result.get("exceptionDetails").is_some() { return Err("WEB_EXTRACTION_FAILED"); }
    result.pointer("/result/value").cloned().ok_or("WEB_EXTRACTION_FAILED")
}

unsafe fn extract(webview: &ICoreWebView2, shared: Shared, generation: u64, context: u64) -> windows::core::Result<()> {
    let final_url = string(|value| webview.Source(value))?;
    if !policy::permitted_url(&final_url) { fail(&shared, generation, "WEB_URL_BLOCKED"); return Ok(()); }
    let (expression, network_epoch) = {
        let mut state = shared.borrow_mut();
        if !state.extraction_announced {
            if let Err(code) = state.identity.emit(json!({"type":"stage", "navigation_generation":generation, "stage":"web_extracting"})) { state.error = Some(code); return Ok(()); }
            state.extraction_announced = true;
        }
        state.javascript_pending = true;
        state.extracting = true;
        state.javascript_started = Instant::now();
        (format!("{}\n;globalThis.__appExtractArticle(document, {})", state.script, serde_json::to_string(&final_url).expect("URL JSON")), state.network.epoch())
    };
    let view = webview.clone();
    call(webview, "Runtime.evaluate", json!({"expression":expression, "contextId":context, "returnByValue":true, "awaitPromise":true}), move |status, response| {
        if !shared.borrow().current_context(generation, context) { return Ok(()); }
        let value = evaluated_value(status, &response);
        let Ok(article) = value else { fail(&shared, generation, "WEB_EXTRACTION_FAILED"); return Ok(()); };
        if validate_article(&article).is_err() { fail(&shared, generation, "WEB_EXTRACTION_FAILED"); return Ok(()); }
        let actual = string(|value| view.Source(value))?;
        if actual != final_url || !policy::permitted_url(&actual) { fail(&shared, generation, "WEB_URL_BLOCKED"); return Ok(()); }
        let mut state = shared.borrow_mut();
        if policy::checking_document(&state) || state.network.busy() || state.network.epoch() != network_epoch {
            state.javascript_pending = false;
            state.extracting = false;
            state.stable_samples = 0;
            state.next_sample = Instant::now() + Duration::from_millis(500);
            return Ok(());
        }
        state.javascript_pending = false;
        state.article = Some(json!({"type":"article", "navigation_generation":generation, "final_url":actual,
            "title":article["title"], "text":article["text"], "markdown":article["markdown"]}));
        Ok(())
    })
}

pub unsafe fn install(webview: &ICoreWebView2, shared: Shared) -> windows::core::Result<()> {
    let mut token = 0;
    for (event, cleared) in [("Runtime.executionContextDestroyed", false), ("Runtime.executionContextsCleared", true)] {
        let method = wide(event);
        let receiver = webview.GetDevToolsProtocolEventReceiver(PCWSTR(method.as_ptr()))?;
        let state = shared.clone();
        receiver.add_DevToolsProtocolEventReceived(&DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
            let args = args.ok_or_else(windows::core::Error::from_win32)?;
            let value = string(|value| args.ParameterObjectAsJson(value))?;
            let parsed: Value = serde_json::from_str(&value).map_err(|_| windows::core::Error::from(windows::Win32::Foundation::E_INVALIDARG))?;
            let mut state = state.borrow_mut();
            if !state.closing && state.context.is_some() && (cleared || parsed.get("executionContextId").and_then(Value::as_u64) == state.context) {
                state.context = None;
                state.error = Some("WEB_EXTRACTION_FAILED");
            }
            Ok(())
        })), &mut token)?;
    }
    let state = shared.clone();
    call(webview, "Runtime.enable", json!({}), move |status, _| {
        if status.is_err() { state.borrow_mut().error = Some("WEB_RUNTIME_UNSUPPORTED"); }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extraction_result_requires_native_value_and_bounded_article() {
        assert!(evaluated_value(Ok(()), r#"{"exceptionDetails":{"text":"Error"},"result":{}}"#).is_err());
        assert!(validate_article(&json!({"title":"Article", "text":"x".repeat(100), "markdown":"content", "sourceUrl":"https://example.com/"})).is_ok());
        assert!(validate_article(&json!({"title":"Article", "text":"short", "markdown":"content", "sourceUrl":"https://example.com/"})).is_err());
    }
}
