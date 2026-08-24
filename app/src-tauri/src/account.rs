use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use url::Url;
use uuid::Uuid;

use crate::{ensure_runtime_dirs, resolve_runtime_paths, RuntimePaths};

const ACCOUNT_SESSION_FILE_NAME: &str = "session.json";
const ACCOUNT_PENDING_STATE_FILE_NAME: &str = "pending_auth_state.txt";
const DEFAULT_SERVER_BASE_URL: &str = "https://frameq.8xf.pro";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AuthCallback {
    pub(crate) ticket: String,
    pub(crate) state: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct BeginAuthFlowResult {
    auth_url: String,
    state: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct AccountSessionFile {
    session_token: String,
    email: String,
    expires_at: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct AccountStatusView {
    authenticated: bool,
    email: Option<String>,
    entitlement_status: String,
    entitlement_expires_at: Option<String>,
    llm_quota_limit: i32,
    llm_quota_used: i32,
    llm_quota_remaining: i32,
    llm_quota_resets_at: Option<String>,
    llm_configured: bool,
    last_verified_at: Option<String>,
    can_process: bool,
    can_generate_ai: bool,
    can_request_activation_code: bool,
    server_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ServerAccountStatus {
    authenticated: bool,
    email: String,
    entitlement_status: String,
    entitlement_expires_at: Option<String>,
    llm_quota_limit: i32,
    llm_quota_used: i32,
    llm_quota_remaining: i32,
    llm_quota_resets_at: Option<String>,
    llm_configured: bool,
    last_verified_at: String,
    can_process: bool,
    can_generate_ai: bool,
    #[serde(default)]
    can_request_activation_code: bool,
}

#[derive(Debug, Deserialize)]
struct SessionExchangeResponse {
    session_token: String,
    email: String,
    expires_at: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CompleteAuthFlowResult {
    authenticated: bool,
    email: String,
    can_process: bool,
    can_generate_ai: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub(crate) struct ActivationCodeRequestView {
    status: String,
    retry_at: Option<String>,
    redeem_by: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub(crate) struct ActivationCodeRequestError {
    pub(crate) error_code: String,
    pub(crate) retry_at: Option<String>,
    pub(crate) message: String,
}

impl ActivationCodeRequestError {
    fn new(error_code: &str, message: &str) -> Self {
        Self {
            error_code: error_code.to_string(),
            retry_at: None,
            message: message.to_string(),
        }
    }

    fn with_retry_at(mut self, retry_at: Option<String>) -> Self {
        self.retry_at = retry_at.filter(|value| !value.trim().is_empty());
        self
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct WechatCheckoutView {
    order_id: String,
    amount_fen: i32,
    currency: String,
    code_url: String,
    expires_at: String,
    status: String,
}

#[derive(Debug, Deserialize)]
struct ServerWechatCheckout {
    order_id: String,
    amount_fen: i32,
    currency: String,
    code_url: String,
    expires_at: String,
    status: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CheckoutStatusView {
    order_id: String,
    status: String,
    entitlement_expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ServerCheckoutStatus {
    order_id: String,
    status: String,
    entitlement_expires_at: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ServerManagedLlmInvocation {
    pub(crate) server_base_url: String,
    pub(crate) session_token: String,
    pub(crate) request_id: String,
}

#[tauri::command]
pub(crate) fn begin_auth_flow(app: AppHandle) -> Result<BeginAuthFlowResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let state = generate_auth_state();
    fs::create_dir_all(account_auth_dir(&paths)).map_err(|error| error.to_string())?;
    fs::write(account_pending_state_path(&paths), &state).map_err(|error| error.to_string())?;
    Ok(BeginAuthFlowResult {
        auth_url: build_auth_login_url(&server_base_url(), &state)?,
        state,
    })
}

#[tauri::command]
pub(crate) async fn complete_auth_flow(
    app: AppHandle,
    callback_url: String,
) -> Result<CompleteAuthFlowResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let pending_state = fs::read_to_string(account_pending_state_path(&paths))
        .map_err(|_| "No pending login state was found.".to_string())?;
    let callback = parse_auth_callback_url(&callback_url, pending_state.trim())?;
    let exchange = exchange_auth_ticket(&server_base_url(), &callback).await?;
    fs::create_dir_all(account_auth_dir(&paths)).map_err(|error| error.to_string())?;
    write_account_session(&account_session_path(&paths), &exchange)?;
    let _ = fs::remove_file(account_pending_state_path(&paths));
    let status =
        get_account_status_from_server(&server_base_url(), &exchange.session_token).await?;
    Ok(CompleteAuthFlowResult {
        authenticated: true,
        email: exchange.email,
        can_process: status.can_process,
        can_generate_ai: status.can_generate_ai,
    })
}

#[tauri::command]
pub(crate) async fn get_account_status(app: AppHandle) -> Result<AccountStatusView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let Some(session) = read_account_session(&account_session_path(&paths))? else {
        return Ok(guest_account_status());
    };
    match get_account_status_from_server(&server_base_url(), &session.session_token).await {
        Ok(status) => Ok(AccountStatusView {
            authenticated: status.authenticated,
            email: Some(status.email),
            entitlement_status: status.entitlement_status,
            entitlement_expires_at: status.entitlement_expires_at,
            llm_quota_limit: status.llm_quota_limit,
            llm_quota_used: status.llm_quota_used,
            llm_quota_remaining: status.llm_quota_remaining,
            llm_quota_resets_at: status.llm_quota_resets_at,
            llm_configured: status.llm_configured,
            last_verified_at: Some(status.last_verified_at),
            can_process: status.can_process,
            can_generate_ai: status.can_generate_ai,
            can_request_activation_code: status.can_request_activation_code,
            server_error: None,
        }),
        Err(error) => Ok(AccountStatusView {
            authenticated: true,
            email: Some(session.email),
            entitlement_status: "unknown".to_string(),
            entitlement_expires_at: None,
            llm_quota_limit: 0,
            llm_quota_used: 0,
            llm_quota_remaining: 0,
            llm_quota_resets_at: None,
            llm_configured: false,
            last_verified_at: None,
            can_process: false,
            can_generate_ai: false,
            can_request_activation_code: false,
            server_error: Some(error),
        }),
    }
}

#[tauri::command]
pub(crate) async fn logout_account(app: AppHandle) -> Result<(), String> {
    let paths = resolve_runtime_paths(&app)?;
    if let Some(session) = read_account_session(&account_session_path(&paths))? {
        let _ = reqwest::Client::new()
            .post(format!("{}/api/desktop/logout", server_base_url()))
            .bearer_auth(session.session_token)
            .send()
            .await;
    }
    let _ = fs::remove_file(account_session_path(&paths));
    Ok(())
}

#[tauri::command]
pub(crate) async fn redeem_activation_code(
    app: AppHandle,
    code: String,
) -> Result<AccountStatusView, String> {
    let paths = resolve_runtime_paths(&app)?;
    let session = require_account_session(&paths)?;
    let response = reqwest::Client::new()
        .post(build_activation_redeem_url(&server_base_url()))
        .bearer_auth(&session.session_token)
        .json(&serde_json::json!({ "code": code }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(response_error_message(response, "Activation code redeem failed.").await);
    }
    let status = response
        .json::<ServerAccountStatus>()
        .await
        .map_err(|error| error.to_string())?;
    Ok(account_status_view_from_server(status))
}

#[tauri::command]
pub(crate) async fn request_activation_code(
    app: AppHandle,
    locale: String,
) -> Result<ActivationCodeRequestView, ActivationCodeRequestError> {
    let paths = resolve_runtime_paths(&app).map_err(|_| {
        ActivationCodeRequestError::new("INTERNAL_SERVER_ERROR", "Activation code request failed.")
    })?;
    ensure_runtime_dirs(&paths).map_err(|_| {
        ActivationCodeRequestError::new("INTERNAL_SERVER_ERROR", "Activation code request failed.")
    })?;
    let session = read_account_session(&account_session_path(&paths)).map_err(|_| {
        ActivationCodeRequestError::new("INTERNAL_SERVER_ERROR", "Activation code request failed.")
    })?;

    request_activation_code_with_session(
        &server_base_url(),
        session.as_ref().map(|value| value.session_token.as_str()),
        &locale,
    )
    .await
}

#[tauri::command]
pub(crate) async fn create_wechat_checkout(app: AppHandle) -> Result<WechatCheckoutView, String> {
    let paths = resolve_runtime_paths(&app)?;
    let session = require_account_session(&paths)?;
    let response = reqwest::Client::new()
        .post(format!(
            "{}/api/desktop/billing/wechat-native",
            server_base_url()
        ))
        .bearer_auth(session.session_token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Checkout failed with status {}.",
            response.status()
        ));
    }
    let checkout = response
        .json::<ServerWechatCheckout>()
        .await
        .map_err(|error| error.to_string())?;
    Ok(WechatCheckoutView {
        order_id: checkout.order_id,
        amount_fen: checkout.amount_fen,
        currency: checkout.currency,
        code_url: checkout.code_url,
        expires_at: checkout.expires_at,
        status: checkout.status,
    })
}

#[tauri::command]
pub(crate) async fn get_checkout_status(
    app: AppHandle,
    order_id: String,
) -> Result<CheckoutStatusView, String> {
    let paths = resolve_runtime_paths(&app)?;
    let session = require_account_session(&paths)?;
    let response = reqwest::Client::new()
        .get(format!(
            "{}/api/desktop/billing/orders/{}",
            server_base_url(),
            percent_encode(&order_id)
        ))
        .bearer_auth(session.session_token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Order status failed with status {}.",
            response.status()
        ));
    }
    let status = response
        .json::<ServerCheckoutStatus>()
        .await
        .map_err(|error| error.to_string())?;
    Ok(CheckoutStatusView {
        order_id: status.order_id,
        status: status.status,
        entitlement_expires_at: status.entitlement_expires_at,
    })
}

pub(crate) fn server_managed_llm_invocation(
    paths: &RuntimePaths,
) -> Result<Option<ServerManagedLlmInvocation>, String> {
    let Some(session) = read_account_session(&account_session_path(paths))? else {
        return Ok(None);
    };
    Ok(Some(ServerManagedLlmInvocation {
        server_base_url: server_base_url(),
        session_token: session.session_token,
        request_id: format!("llm-{}", Uuid::new_v4().simple()),
    }))
}

fn account_auth_dir(paths: &RuntimePaths) -> std::path::PathBuf {
    paths.user_data_dir.join("auth")
}

fn account_session_path(paths: &RuntimePaths) -> std::path::PathBuf {
    account_auth_dir(paths).join(ACCOUNT_SESSION_FILE_NAME)
}

fn account_pending_state_path(paths: &RuntimePaths) -> std::path::PathBuf {
    account_auth_dir(paths).join(ACCOUNT_PENDING_STATE_FILE_NAME)
}

pub(crate) fn server_base_url() -> String {
    std::env::var("FRAMEQ_SERVER_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SERVER_BASE_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

fn generate_auth_state() -> String {
    format!("state-{}", Uuid::new_v4().simple())
}

pub(crate) fn build_auth_login_url(server_base_url: &str, state: &str) -> Result<String, String> {
    validate_auth_state(state)?;
    let base = server_base_url.trim_end_matches('/');
    if !base.starts_with("http://") && !base.starts_with("https://") {
        return Err("FrameQ server URL must start with http:// or https://.".to_string());
    }
    Ok(format!(
        "{}/login?desktop=1&state={}&redirect_uri={}",
        base,
        percent_encode(state),
        percent_encode("frameq://auth/callback")
    ))
}

pub(crate) fn build_activation_redeem_url(server_base_url: &str) -> String {
    format!(
        "{}/api/desktop/activation-codes/redeem",
        server_base_url.trim_end_matches('/')
    )
}

pub(crate) fn build_activation_request_url(server_base_url: &str) -> String {
    format!(
        "{}/api/desktop/activation-codes/request",
        server_base_url.trim_end_matches('/')
    )
}

pub(crate) fn parse_auth_callback_url(
    callback_url: &str,
    expected_state: &str,
) -> Result<AuthCallback, String> {
    validate_auth_state(expected_state)?;
    let url = Url::parse(callback_url).map_err(|_| "Auth callback URL is invalid.".to_string())?;
    if url.scheme() != "frameq" || url.host_str() != Some("auth") || url.path() != "/callback" {
        return Err("Auth callback URL target is invalid.".to_string());
    }
    let mut ticket: Option<String> = None;
    let mut state: Option<String> = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "ticket" => ticket = Some(value.to_string()),
            "state" => state = Some(value.to_string()),
            _ => {}
        }
    }
    let Some(ticket) = ticket else {
        return Err("Auth callback is missing a login ticket.".to_string());
    };
    let Some(state) = state else {
        return Err("Auth callback is missing state.".to_string());
    };
    if state != expected_state {
        return Err("Auth callback state does not match this device.".to_string());
    }
    if !ticket.starts_with("flt_") || ticket.len() > 256 {
        return Err("Auth callback ticket is invalid.".to_string());
    }
    Ok(AuthCallback { ticket, state })
}

fn validate_auth_state(state: &str) -> Result<(), String> {
    if state.len() < 8
        || state.len() > 160
        || !state
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '~' | '-'))
    {
        return Err("Auth state is invalid.".to_string());
    }
    Ok(())
}

fn percent_encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

pub(crate) fn validate_activation_request_locale(
    locale: &str,
) -> Result<&str, ActivationCodeRequestError> {
    match locale {
        "zh-CN" | "zh-TW" | "en-US" => Ok(locale),
        _ => Err(ActivationCodeRequestError::new(
            "INVALID_LOCALE",
            "Activation code request locale is invalid.",
        )),
    }
}

async fn request_activation_code_with_session(
    server_base_url: &str,
    session_token: Option<&str>,
    locale: &str,
) -> Result<ActivationCodeRequestView, ActivationCodeRequestError> {
    let locale = validate_activation_request_locale(locale)?;
    let Some(session_token) = session_token.filter(|value| !value.trim().is_empty()) else {
        return Err(ActivationCodeRequestError::new(
            "AUTH_REQUIRED",
            "Please log in to FrameQ first.",
        ));
    };
    request_activation_code_from_server(server_base_url, session_token, locale).await
}

async fn request_activation_code_from_server(
    server_base_url: &str,
    session_token: &str,
    locale: &str,
) -> Result<ActivationCodeRequestView, ActivationCodeRequestError> {
    let response = reqwest::Client::new()
        .post(build_activation_request_url(server_base_url))
        .bearer_auth(session_token)
        .json(&serde_json::json!({ "locale": locale }))
        .send()
        .await
        .map_err(|_| {
            ActivationCodeRequestError::new(
                "SERVER_TEMPORARILY_UNAVAILABLE",
                "FrameQ server is temporarily unavailable.",
            )
        })?;

    let status = response.status();
    if status.is_success() {
        return response
            .json::<ActivationCodeRequestView>()
            .await
            .map_err(|_| {
                ActivationCodeRequestError::new(
                    "INTERNAL_SERVER_ERROR",
                    "Activation code request failed.",
                )
            });
    }

    let retry_at = extract_retry_at(&response, None);
    let body = response.text().await.unwrap_or_default();
    let payload = serde_json::from_str::<serde_json::Value>(&body).ok();
    let retry_at = extract_retry_at_from_value(payload.as_ref()).or(retry_at);
    Err(map_activation_request_error(status.as_u16(), retry_at))
}

async fn exchange_auth_ticket(
    server_base_url: &str,
    callback: &AuthCallback,
) -> Result<SessionExchangeResponse, String> {
    let response = reqwest::Client::new()
        .post(format!(
            "{}/api/desktop/sessions/exchange",
            server_base_url.trim_end_matches('/')
        ))
        .json(&serde_json::json!({
            "ticket": callback.ticket,
            "state": callback.state,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Login exchange failed with status {}.",
            response.status()
        ));
    }
    response
        .json::<SessionExchangeResponse>()
        .await
        .map_err(|error| error.to_string())
}

async fn get_account_status_from_server(
    server_base_url: &str,
    session_token: &str,
) -> Result<ServerAccountStatus, String> {
    let response = reqwest::Client::new()
        .get(format!(
            "{}/api/desktop/account",
            server_base_url.trim_end_matches('/')
        ))
        .bearer_auth(session_token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Account status failed with status {}.",
            response.status()
        ));
    }
    response
        .json::<ServerAccountStatus>()
        .await
        .map_err(|error| error.to_string())
}

fn account_status_view_from_server(status: ServerAccountStatus) -> AccountStatusView {
    AccountStatusView {
        authenticated: status.authenticated,
        email: Some(status.email),
        entitlement_status: status.entitlement_status,
        entitlement_expires_at: status.entitlement_expires_at,
        llm_quota_limit: status.llm_quota_limit,
        llm_quota_used: status.llm_quota_used,
        llm_quota_remaining: status.llm_quota_remaining,
        llm_quota_resets_at: status.llm_quota_resets_at,
        llm_configured: status.llm_configured,
        last_verified_at: Some(status.last_verified_at),
        can_process: status.can_process,
        can_generate_ai: status.can_generate_ai,
        can_request_activation_code: status.can_request_activation_code,
        server_error: None,
    }
}

async fn response_error_message(response: reqwest::Response, fallback: &str) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let server_error = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.as_str())
                .map(str::to_string)
        });
    match server_error {
        Some(message) if !message.trim().is_empty() => message,
        _ => format!("{fallback} Status {status}."),
    }
}

fn write_account_session(path: &Path, session: &SessionExchangeResponse) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let session_file = AccountSessionFile {
        session_token: session.session_token.clone(),
        email: session.email.clone(),
        expires_at: session.expires_at.clone(),
    };
    fs::write(
        path,
        serde_json::to_string_pretty(&session_file).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn read_account_session(path: &Path) -> Result<Option<AccountSessionFile>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str::<AccountSessionFile>(&content)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn require_account_session(paths: &RuntimePaths) -> Result<AccountSessionFile, String> {
    read_account_session(&account_session_path(paths))?
        .ok_or_else(|| "Please log in to FrameQ first.".to_string())
}

fn guest_account_status() -> AccountStatusView {
    AccountStatusView {
        authenticated: false,
        email: None,
        entitlement_status: "inactive".to_string(),
        entitlement_expires_at: None,
        llm_quota_limit: 0,
        llm_quota_used: 0,
        llm_quota_remaining: 0,
        llm_quota_resets_at: None,
        llm_configured: false,
        last_verified_at: None,
        can_process: false,
        can_generate_ai: false,
        can_request_activation_code: false,
        server_error: None,
    }
}

fn map_activation_request_error(
    status_code: u16,
    retry_at: Option<String>,
) -> ActivationCodeRequestError {
    let error = match status_code {
        401 => ActivationCodeRequestError::new("AUTH_REQUIRED", "Please log in to FrameQ first."),
        404 => ActivationCodeRequestError::new(
            "ACTIVATION_REQUEST_NOT_AVAILABLE",
            "Activation code request is unavailable.",
        ),
        409 => ActivationCodeRequestError::new(
            "ACTIVATION_REQUEST_CONFLICT",
            "Activation code request cannot be completed right now.",
        ),
        429 => ActivationCodeRequestError::new(
            "ACTIVATION_REQUEST_RATE_LIMITED",
            "Activation code request is rate limited.",
        ),
        503 => ActivationCodeRequestError::new(
            "SERVER_TEMPORARILY_UNAVAILABLE",
            "FrameQ server is temporarily unavailable.",
        ),
        _ => ActivationCodeRequestError::new(
            "INTERNAL_SERVER_ERROR",
            "Activation code request failed.",
        ),
    };
    error.with_retry_at(retry_at)
}

fn extract_retry_at(response: &reqwest::Response, fallback: Option<String>) -> Option<String> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or(fallback)
}

fn extract_retry_at_from_value(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|payload| payload.get("retry_at"))
        .and_then(|retry_at| retry_at.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::{
        account_status_view_from_server, build_activation_request_url, guest_account_status,
        request_activation_code_from_server, request_activation_code_with_session,
        validate_activation_request_locale, ActivationCodeRequestError, ServerAccountStatus,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    #[test]
    fn account_status_view_preserves_separate_processing_and_ai_gates() {
        let status: ServerAccountStatus = serde_json::from_value(json!({
            "authenticated": true,
            "email": "user@example.com",
            "entitlement_status": "active",
            "entitlement_expires_at": "2026-07-22T08:00:00.000Z",
            "llm_quota_limit": 20,
            "llm_quota_used": 20,
            "llm_quota_remaining": 0,
            "llm_quota_resets_at": "2026-07-22T08:00:00.000Z",
            "llm_configured": false,
            "last_verified_at": "2026-06-21T08:00:00.000Z",
            "can_process": true,
            "can_generate_ai": false
        }))
        .expect("deserialize server account status");

        let view = account_status_view_from_server(status);
        let value = serde_json::to_value(view).expect("serialize account status view");

        assert_eq!(value["can_process"], true);
        assert_eq!(value["can_generate_ai"], false);
    }

    #[test]
    fn server_account_status_defaults_missing_activation_request_capability_to_false() {
        let status: ServerAccountStatus = serde_json::from_value(json!({
            "authenticated": true,
            "email": "user@example.com",
            "entitlement_status": "active",
            "entitlement_expires_at": "2026-07-22T08:00:00.000Z",
            "llm_quota_limit": 20,
            "llm_quota_used": 3,
            "llm_quota_remaining": 17,
            "llm_quota_resets_at": "2026-07-22T08:00:00.000Z",
            "llm_configured": true,
            "last_verified_at": "2026-06-21T08:00:00.000Z",
            "can_process": true,
            "can_generate_ai": true
        }))
        .expect("deserialize server account status");

        let view = account_status_view_from_server(status);
        let value = serde_json::to_value(view).expect("serialize account status view");

        assert_eq!(value["can_request_activation_code"], false);
    }

    #[test]
    fn guest_account_status_blocks_processing_and_ai_generation() {
        let value = serde_json::to_value(guest_account_status()).expect("serialize guest status");

        assert_eq!(value["can_process"], false);
        assert_eq!(value["can_generate_ai"], false);
        assert_eq!(value["can_request_activation_code"], false);
    }

    #[test]
    fn activation_request_locale_accepts_only_whitelist_values() {
        for locale in ["zh-CN", "zh-TW", "en-US"] {
            assert_eq!(
                validate_activation_request_locale(locale).expect("accept locale"),
                locale
            );
        }

        let error =
            validate_activation_request_locale("ja-JP").expect_err("reject unsupported locale");
        assert_eq!(
            error,
            ActivationCodeRequestError::new(
                "INVALID_LOCALE",
                "Activation code request locale is invalid.",
            )
        );
    }

    #[test]
    fn activation_request_url_targets_desktop_request_route() {
        assert_eq!(
            build_activation_request_url("https://frameq.example/"),
            "https://frameq.example/api/desktop/activation-codes/request"
        );
    }

    #[test]
    fn request_activation_code_success_uses_expected_http_shape_and_redacts_sensitive_fields() {
        let server = TestHttpServer::spawn(TestHttpResponse {
            status_line: "HTTP/1.1 200 OK".to_string(),
            headers: vec![("Content-Type".to_string(), "application/json".to_string())],
            body: r#"{"status":"sent","retry_at":"2026-08-24T12:30:00Z","redeem_by":"2026-08-31T00:00:00Z","code":"SECRET-CODE","email":"user@example.com"}"#.to_string(),
        });

        let result = tauri::async_runtime::block_on(request_activation_code_from_server(
            &server.base_url(),
            "session-secret",
            "zh-CN",
        ))
        .expect("request activation code");
        let request = server.finish();
        let value = serde_json::to_value(result).expect("serialize activation request view");

        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/api/desktop/activation-codes/request");
        assert_eq!(
            request.headers.get("authorization"),
            Some(&"Bearer session-secret".to_string())
        );
        assert_eq!(
            request.headers.get("content-type"),
            Some(&"application/json".to_string())
        );
        assert_eq!(request.body, r#"{"locale":"zh-CN"}"#);
        assert_eq!(value["status"], "sent");
        assert_eq!(value["retry_at"], "2026-08-24T12:30:00Z");
        assert_eq!(value["redeem_by"], "2026-08-31T00:00:00Z");
        assert!(value.get("code").is_none());
        assert!(value.get("email").is_none());
    }

    #[test]
    fn request_activation_code_requires_existing_session_before_http() {
        let error = tauri::async_runtime::block_on(request_activation_code_with_session(
            "https://frameq.example",
            None,
            "en-US",
        ))
        .expect_err("missing session must fail");

        assert_eq!(error.error_code, "AUTH_REQUIRED");
        assert_eq!(error.message, "Please log in to FrameQ first.");
    }

    #[test]
    fn request_activation_code_rejects_invalid_locale_before_http() {
        let error = tauri::async_runtime::block_on(request_activation_code_with_session(
            "http://127.0.0.1:9",
            Some("session-secret"),
            "ja-JP",
        ))
        .expect_err("invalid locale must fail");

        assert_eq!(error.error_code, "INVALID_LOCALE");
        assert_eq!(error.message, "Activation code request locale is invalid.");
    }

    #[test]
    fn request_activation_code_maps_http_errors_to_structured_errors() {
        let cases = [
            (
                401,
                vec![],
                r#"{"error_code":"AUTH_REQUIRED","retry_at":"2026-08-24T13:00:00Z","message":"secret body"}"#,
                "AUTH_REQUIRED",
                Some("2026-08-24T13:00:00Z"),
                "Please log in to FrameQ first.",
            ),
            (
                404,
                vec![],
                r#"{"error_code":"NOT_FOUND"}"#,
                "ACTIVATION_REQUEST_NOT_AVAILABLE",
                None,
                "Activation code request is unavailable.",
            ),
            (
                409,
                vec![],
                r#"{"error_code":"ALREADY_REQUESTED","retry_at":"2026-08-24T14:00:00Z"}"#,
                "ACTIVATION_REQUEST_CONFLICT",
                Some("2026-08-24T14:00:00Z"),
                "Activation code request cannot be completed right now.",
            ),
            (
                429,
                vec![(
                    "Retry-After".to_string(),
                    "2026-08-24T15:00:00Z".to_string(),
                )],
                r#"{"error_code":"RATE_LIMITED"}"#,
                "ACTIVATION_REQUEST_RATE_LIMITED",
                Some("2026-08-24T15:00:00Z"),
                "Activation code request is rate limited.",
            ),
            (
                503,
                vec![],
                r#"{"error_code":"SERVER_BUSY"}"#,
                "SERVER_TEMPORARILY_UNAVAILABLE",
                None,
                "FrameQ server is temporarily unavailable.",
            ),
            (
                500,
                vec![],
                r#"{"error_code":"INTERNAL","message":"token SECRET"}"#,
                "INTERNAL_SERVER_ERROR",
                None,
                "Activation code request failed.",
            ),
        ];

        for (status, headers, body, expected_code, expected_retry_at, expected_message) in cases {
            let server = TestHttpServer::spawn(TestHttpResponse {
                status_line: format!("HTTP/1.1 {status} Test"),
                headers,
                body: body.to_string(),
            });

            let error = tauri::async_runtime::block_on(request_activation_code_from_server(
                &server.base_url(),
                "session-secret",
                "en-US",
            ))
            .expect_err("request should fail");
            let request = server.finish();

            assert_eq!(request.method, "POST");
            assert_eq!(error.error_code, expected_code);
            assert_eq!(error.retry_at.as_deref(), expected_retry_at);
            assert_eq!(error.message, expected_message);
            assert!(!error.message.contains("SECRET"));
        }
    }

    #[test]
    fn request_activation_code_sanitizes_invalid_server_json_and_bodies() {
        let invalid_json_server = TestHttpServer::spawn(TestHttpResponse {
            status_line: "HTTP/1.1 200 OK".to_string(),
            headers: vec![("Content-Type".to_string(), "application/json".to_string())],
            body: r#"{"status":"sent","retry_at":"token-SECRET"}"#.to_string(),
        });

        let invalid_json_error =
            tauri::async_runtime::block_on(request_activation_code_from_server(
                &invalid_json_server.base_url(),
                "session-secret",
                "en-US",
            ))
            .expect_err("invalid success payload must fail");

        assert_eq!(invalid_json_error.error_code, "INTERNAL_SERVER_ERROR");
        assert!(!invalid_json_error.message.contains("SECRET"));

        let invalid_error_server = TestHttpServer::spawn(TestHttpResponse {
            status_line: "HTTP/1.1 429 Too Many Requests".to_string(),
            headers: vec![("Content-Type".to_string(), "application/json".to_string())],
            body: r#"not-json-secret-token"#.to_string(),
        });

        let invalid_error = tauri::async_runtime::block_on(request_activation_code_from_server(
            &invalid_error_server.base_url(),
            "session-secret",
            "en-US",
        ))
        .expect_err("invalid error payload must fail");

        assert_eq!(invalid_error.error_code, "ACTIVATION_REQUEST_RATE_LIMITED");
        assert!(!invalid_error.message.contains("secret"));
    }

    #[derive(Debug)]
    struct TestHttpRequest {
        method: String,
        path: String,
        headers: HashMap<String, String>,
        body: String,
    }

    struct TestHttpResponse {
        status_line: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    struct TestHttpServer {
        base_url: String,
        request_rx: mpsc::Receiver<TestHttpRequest>,
        thread: Option<thread::JoinHandle<()>>,
    }

    impl TestHttpServer {
        fn spawn(response: TestHttpResponse) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
            let address = listener.local_addr().expect("test server address");
            let (request_tx, request_rx) = mpsc::channel();
            let thread = thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept request");
                let mut buffer = Vec::new();
                loop {
                    let mut chunk = [0_u8; 1024];
                    let read = stream.read(&mut chunk).expect("read request");
                    if read == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                    if find_header_end(&buffer).is_some() {
                        break;
                    }
                }

                let header_end = find_header_end(&buffer).expect("header end");
                let header_text =
                    String::from_utf8(buffer[..header_end].to_vec()).expect("request headers utf8");
                let mut lines = header_text.split("\r\n");
                let request_line = lines.next().expect("request line");
                let mut request_parts = request_line.split_whitespace();
                let method = request_parts.next().expect("request method").to_string();
                let path = request_parts.next().expect("request path").to_string();
                let mut headers = HashMap::new();
                for line in lines {
                    if line.is_empty() {
                        continue;
                    }
                    if let Some((name, value)) = line.split_once(':') {
                        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
                    }
                }
                let content_length = headers
                    .get("content-length")
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                let mut body_bytes = buffer[(header_end + 4)..].to_vec();
                while body_bytes.len() < content_length {
                    let mut chunk = vec![0_u8; content_length - body_bytes.len()];
                    let read = stream.read(&mut chunk).expect("read request body");
                    if read == 0 {
                        break;
                    }
                    body_bytes.extend_from_slice(&chunk[..read]);
                }
                request_tx
                    .send(TestHttpRequest {
                        method,
                        path,
                        headers,
                        body: String::from_utf8(body_bytes).expect("request body utf8"),
                    })
                    .expect("send test request");

                let mut response_bytes = format!(
                    "{}\r\nContent-Length: {}\r\nConnection: close\r\n",
                    response.status_line,
                    response.body.as_bytes().len()
                )
                .into_bytes();
                for (name, value) in response.headers {
                    response_bytes.extend_from_slice(format!("{name}: {value}\r\n").as_bytes());
                }
                response_bytes.extend_from_slice(b"\r\n");
                response_bytes.extend_from_slice(response.body.as_bytes());
                stream
                    .write_all(&response_bytes)
                    .expect("write test response");
            });

            Self {
                base_url: format!("http://{}", address),
                request_rx,
                thread: Some(thread),
            }
        }

        fn base_url(&self) -> String {
            self.base_url.clone()
        }

        fn finish(mut self) -> TestHttpRequest {
            let request = self.request_rx.recv().expect("receive test request");
            if let Some(thread) = self.thread.take() {
                thread.join().expect("join test server");
            }
            request
        }
    }

    fn find_header_end(buffer: &[u8]) -> Option<usize> {
        buffer.windows(4).position(|window| window == b"\r\n\r\n")
    }
}
