//! Local BYOK LLM provider configuration.
//!
//! Metadata lives in app-local `llm_providers.json`; API keys live only in the OS
//! credential store. Nothing in this module writes a key to disk, logs, argv,
//! progress events, or diagnostic exports.

use crate::account::ServerManagedLlmInvocation;
use crate::RuntimePaths;
use serde::{Deserialize, Serialize};
#[cfg(test)]
use std::collections::BTreeMap;
use std::fmt;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
#[cfg(test)]
use std::sync::Mutex;
use tauri::AppHandle;

pub(crate) const LLM_PROVIDERS_FILE_NAME: &str = "llm_providers.json";
const KEYRING_SERVICE: &str = "pro.8xf.app.llm";
const STATE_SCHEMA_VERSION: u32 = 1;
const DEFAULT_TIMEOUT_SECONDS: u32 = 30;
const MAX_TIMEOUT_SECONDS: u32 = 300;
const ALLOWED_PROVIDERS: [&str; 2] = ["openai", "openai_compatible"];

const ERR_INVALID: &str = "LLM_PROVIDER_INVALID";
const ERR_STATE_INVALID: &str = "LLM_PROVIDER_STATE_INVALID";
const ERR_NOT_FOUND: &str = "LLM_PROVIDER_NOT_FOUND";
const ERR_KEY_REQUIRED: &str = "LLM_PROVIDER_API_KEY_REQUIRED";
const ERR_NOT_CONFIGURED: &str = "LLM_PROVIDER_NOT_CONFIGURED";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LlmSource {
    #[default]
    Managed,
    Byok,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LlmProviderRecord {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) provider: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) timeout_seconds: u32,
}

impl fmt::Debug for LlmProviderRecord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LlmProviderRecord")
            .field("id", &self.id)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LlmProvidersState {
    pub(crate) schema_version: u32,
    pub(crate) source: LlmSource,
    pub(crate) active_id: Option<String>,
    pub(crate) providers: Vec<LlmProviderRecord>,
}

impl Default for LlmProvidersState {
    fn default() -> Self {
        Self {
            schema_version: STATE_SCHEMA_VERSION,
            source: LlmSource::Managed,
            active_id: None,
            providers: Vec::new(),
        }
    }
}

/// Runtime-only LLM credentials. `Debug` is intentionally redacted.
#[derive(Clone)]
pub(crate) struct ByokLlmRuntime {
    pub(crate) provider: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    pub(crate) timeout_seconds: u32,
}

impl fmt::Debug for ByokLlmRuntime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ByokLlmRuntime(REDACTED)")
    }
}

#[derive(Clone)]
pub(crate) enum WorkerLlmConfig {
    Managed(Option<ServerManagedLlmInvocation>),
    Byok {
        provider: ByokLlmRuntime,
        anysearch: Option<ServerManagedLlmInvocation>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct LlmProviderView {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) provider: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) timeout_seconds: u32,
    pub(crate) has_key: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct LlmProvidersView {
    pub(crate) source: LlmSource,
    pub(crate) active_id: Option<String>,
    pub(crate) providers: Vec<LlmProviderView>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct LlmProbeView {
    pub(crate) ok: bool,
    pub(crate) error_code: Option<String>,
    pub(crate) latency_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LlmProviderInput {
    #[serde(default)]
    pub(crate) id: Option<String>,
    pub(crate) label: String,
    pub(crate) provider: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    #[serde(default = "default_timeout_seconds")]
    pub(crate) timeout_seconds: u32,
}

fn default_timeout_seconds() -> u32 {
    DEFAULT_TIMEOUT_SECONDS
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LlmProbeConfigInput {
    pub(crate) provider: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    #[serde(default = "default_timeout_seconds")]
    pub(crate) timeout_seconds: u32,
}

/// Abstraction over the OS credential store so tests never need a real keychain.
pub(crate) trait SecretStore {
    fn get(&self, id: &str) -> Result<Option<String>, String>;
    fn set(&self, id: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, id: &str) -> Result<(), String>;
}

pub(crate) struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        let entry = keyring::v1::Entry::new(KEYRING_SERVICE, id)
            .map_err(|_| "Credential store is unavailable.".to_string())?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::v1::Error::NoEntry) => Ok(None),
            Err(_) => Err("Failed to read the saved API key.".to_string()),
        }
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        let entry = keyring::v1::Entry::new(KEYRING_SERVICE, id)
            .map_err(|_| "Credential store is unavailable.".to_string())?;
        entry
            .set_password(secret)
            .map_err(|_| "Failed to save the API key.".to_string())
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        let entry = keyring::v1::Entry::new(KEYRING_SERVICE, id)
            .map_err(|_| "Credential store is unavailable.".to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
            Err(_) => Err("Failed to remove the saved API key.".to_string()),
        }
    }
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct InMemorySecretStore {
    entries: Mutex<BTreeMap<String, String>>,
}

#[cfg(test)]
impl SecretStore for InMemorySecretStore {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        Ok(self
            .entries
            .lock()
            .map_err(|_| "secret store lock poisoned".to_string())?
            .get(id)
            .cloned())
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        self.entries
            .lock()
            .map_err(|_| "secret store lock poisoned".to_string())?
            .insert(id.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        self.entries
            .lock()
            .map_err(|_| "secret store lock poisoned".to_string())?
            .remove(id);
        Ok(())
    }
}

fn state_path(user_data_dir: &Path) -> PathBuf {
    user_data_dir.join(LLM_PROVIDERS_FILE_NAME)
}

fn load_state(user_data_dir: &Path) -> Result<LlmProvidersState, String> {
    let path = state_path(user_data_dir);
    if !path.exists() {
        return Ok(LlmProvidersState::default());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|_| format!("{ERR_STATE_INVALID}: unreadable"))?;
    let state: LlmProvidersState =
        serde_json::from_str(&raw).map_err(|_| format!("{ERR_STATE_INVALID}: malformed"))?;
    if state.schema_version != STATE_SCHEMA_VERSION {
        return Err(format!("{ERR_STATE_INVALID}: unsupported version"));
    }
    Ok(state)
}

fn save_state(user_data_dir: &Path, state: &LlmProvidersState) -> Result<(), String> {
    std::fs::create_dir_all(user_data_dir)
        .map_err(|_| "Failed to create the app settings directory.".to_string())?;
    let path = state_path(user_data_dir);
    let temporary = user_data_dir.join(format!("{LLM_PROVIDERS_FILE_NAME}.tmp"));
    let raw = serde_json::to_string_pretty(state)
        .map_err(|_| "Failed to encode LLM provider settings.".to_string())?;
    std::fs::write(&temporary, raw)
        .map_err(|_| "Failed to write LLM provider settings.".to_string())?;
    let _ = std::fs::remove_file(&path);
    std::fs::rename(&temporary, &path)
        .map_err(|_| "Failed to commit LLM provider settings.".to_string())?;
    Ok(())
}

fn validate_input(input: &LlmProviderInput) -> Result<(), String> {
    let valid = !input.label.trim().is_empty()
        && ALLOWED_PROVIDERS.contains(&input.provider.as_str())
        && !input.model.trim().is_empty()
        && (input.base_url.starts_with("https://") || input.base_url.starts_with("http://"))
        && (1..=MAX_TIMEOUT_SECONDS).contains(&input.timeout_seconds);
    if valid {
        Ok(())
    } else {
        Err(ERR_INVALID.to_string())
    }
}

fn list_view(user_data_dir: &Path, store: &impl SecretStore) -> Result<LlmProvidersView, String> {
    let state = load_state(user_data_dir)?;
    let providers = state
        .providers
        .iter()
        .map(|record| {
            Ok(LlmProviderView {
                id: record.id.clone(),
                label: record.label.clone(),
                provider: record.provider.clone(),
                base_url: record.base_url.clone(),
                model: record.model.clone(),
                timeout_seconds: record.timeout_seconds,
                has_key: store.get(&record.id)?.is_some(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(LlmProvidersView {
        source: state.source,
        active_id: state.active_id,
        providers,
    })
}

fn save_provider(
    user_data_dir: &Path,
    store: &impl SecretStore,
    input: LlmProviderInput,
    api_key: Option<String>,
) -> Result<LlmProvidersView, String> {
    validate_input(&input)?;
    let mut state = load_state(user_data_dir)?;
    let is_edit = input.id.is_some();
    let id = match input.id.clone() {
        Some(existing) => {
            if !state.providers.iter().any(|record| record.id == existing) {
                return Err(ERR_NOT_FOUND.to_string());
            }
            existing
        }
        None => format!("llm-{}", uuid::Uuid::new_v4().simple()),
    };
    let new_key = match api_key {
        Some(value) if !value.trim().is_empty() => Some(value),
        _ => {
            if is_edit && store.get(&id)?.is_some() {
                None
            } else {
                return Err(ERR_KEY_REQUIRED.to_string());
            }
        }
    };
    let record = LlmProviderRecord {
        id: id.clone(),
        label: input.label,
        provider: input.provider,
        base_url: input.base_url,
        model: input.model,
        timeout_seconds: input.timeout_seconds,
    };
    if let Some(existing) = state.providers.iter_mut().find(|item| item.id == id) {
        *existing = record;
    } else {
        state.providers.push(record);
    }
    if state.active_id.is_none() {
        state.active_id = Some(id.clone());
    }
    // Commit metadata before the secret: a failed metadata write must not
    // leave a keychain entry that no state record references — new saves
    // generate a fresh id, so such orphans would be unreachable and invisible.
    // The reverse failure (metadata committed, secret missing) surfaces as
    // `has_key: false` in the list view and `ERR_KEY_REQUIRED` at task start,
    // which the user can see and fix by editing the provider.
    save_state(user_data_dir, &state)?;
    if let Some(value) = new_key {
        store.set(&id, &value)?;
    }
    list_view(user_data_dir, store)
}

fn delete_provider(
    user_data_dir: &Path,
    store: &impl SecretStore,
    id: &str,
) -> Result<LlmProvidersView, String> {
    let mut state = load_state(user_data_dir)?;
    let before = state.providers.len();
    state.providers.retain(|record| record.id != id);
    if state.providers.len() == before {
        return Err(ERR_NOT_FOUND.to_string());
    }
    store.delete(id)?;
    if state.active_id.as_deref() == Some(id) {
        state.active_id = state.providers.first().map(|record| record.id.clone());
    }
    save_state(user_data_dir, &state)?;
    list_view(user_data_dir, store)
}

fn set_active_provider(user_data_dir: &Path, id: &str) -> Result<(), String> {
    let mut state = load_state(user_data_dir)?;
    if !state.providers.iter().any(|record| record.id == id) {
        return Err(ERR_NOT_FOUND.to_string());
    }
    state.active_id = Some(id.to_string());
    save_state(user_data_dir, &state)
}

fn set_source(user_data_dir: &Path, source: LlmSource) -> Result<(), String> {
    let mut state = load_state(user_data_dir)?;
    state.source = source;
    save_state(user_data_dir, &state)
}

pub(crate) fn choose_worker_llm_config(
    state: &LlmProvidersState,
    provider: Option<ByokLlmRuntime>,
    session: Option<ServerManagedLlmInvocation>,
) -> Result<WorkerLlmConfig, String> {
    match state.source {
        LlmSource::Managed => Ok(WorkerLlmConfig::Managed(session)),
        LlmSource::Byok => Ok(WorkerLlmConfig::Byok {
            provider: provider.ok_or_else(|| ERR_NOT_CONFIGURED.to_string())?,
            anysearch: session,
        }),
    }
}

pub(crate) fn resolve_worker_llm_config(paths: &RuntimePaths) -> Result<WorkerLlmConfig, String> {
    let state = load_state(&paths.user_data_dir)?;
    let session = crate::account::server_managed_llm_invocation(paths)?;
    let runtime = if state.source == LlmSource::Byok {
        let id = state
            .active_id
            .clone()
            .ok_or_else(|| ERR_NOT_CONFIGURED.to_string())?;
        let record = state
            .providers
            .iter()
            .find(|item| item.id == id)
            .ok_or_else(|| ERR_NOT_CONFIGURED.to_string())?;
        let api_key = KeyringSecretStore
            .get(&id)?
            .ok_or_else(|| ERR_KEY_REQUIRED.to_string())?;
        Some(ByokLlmRuntime {
            provider: record.provider.clone(),
            base_url: record.base_url.clone(),
            api_key,
            model: record.model.clone(),
            timeout_seconds: record.timeout_seconds,
        })
    } else {
        None
    };
    choose_worker_llm_config(&state, runtime, session)
}

pub(crate) fn draft_byok_requires_login(paths: &RuntimePaths) -> Result<bool, String> {
    let state = load_state(&paths.user_data_dir)?;
    if state.source != LlmSource::Byok {
        return Ok(false);
    }
    Ok(crate::account::server_managed_llm_invocation(paths)?.is_none())
}

fn run_probe(
    paths: &RuntimePaths,
    config: &LlmProbeConfigInput,
    api_key: &str,
) -> Result<LlmProbeView, String> {
    let payload = serde_json::json!({
        "base_url": config.base_url,
        "api_key": api_key,
        "model": config.model,
        "provider": config.provider,
    })
    .to_string();
    let mut command = Command::new(crate::bundled_python_path(&paths.resource_dir));
    command
        .args(["-m", "worker_core", "--probe-llm-stdin"])
        .current_dir(&paths.user_data_dir);
    for (key, value) in crate::worker_python_bootstrap_env(&paths.resource_dir)? {
        command.env(key, value);
    }
    command
        .env_remove(crate::settings::LLM_PROVIDER_ENV)
        .env_remove(crate::settings::LLM_BASE_URL_ENV)
        .env_remove(crate::settings::LLM_API_KEY_ENV)
        .env_remove(crate::settings::LLM_MODEL_ENV)
        .env_remove(crate::settings::LLM_TIMEOUT_ENV)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|_| "Failed to start the connection probe.".to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload.as_bytes())
            .map_err(|_| "Failed to send the connection probe.".to_string())?;
    }
    let output = child
        .wait_with_output()
        .map_err(|_| "Failed to read the connection probe result.".to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .rev()
        .find(|candidate| !candidate.trim().is_empty())
        .unwrap_or("");
    serde_json::from_str::<LlmProbeView>(line).map_err(|_| {
        "LLM_PROBE_UNEXPECTED_ERROR".to_string()
    })
}

#[tauri::command]
pub(crate) fn list_llm_providers(app: AppHandle) -> Result<LlmProvidersView, String> {
    let paths = crate::resolve_fixed_paths(&app)?;
    list_view(&paths.user_data_dir, &KeyringSecretStore)
}

#[tauri::command]
pub(crate) fn save_llm_provider(
    app: AppHandle,
    provider: LlmProviderInput,
    api_key: Option<String>,
) -> Result<LlmProvidersView, String> {
    let paths = crate::resolve_fixed_paths(&app)?;
    save_provider(&paths.user_data_dir, &KeyringSecretStore, provider, api_key)
}

#[tauri::command]
pub(crate) fn delete_llm_provider(app: AppHandle, id: String) -> Result<LlmProvidersView, String> {
    let paths = crate::resolve_fixed_paths(&app)?;
    delete_provider(&paths.user_data_dir, &KeyringSecretStore, &id)
}

#[tauri::command]
pub(crate) fn set_active_llm_provider(
    app: AppHandle,
    id: String,
) -> Result<LlmProvidersView, String> {
    let paths = crate::resolve_fixed_paths(&app)?;
    set_active_provider(&paths.user_data_dir, &id)?;
    list_view(&paths.user_data_dir, &KeyringSecretStore)
}

#[tauri::command]
pub(crate) fn set_llm_source(app: AppHandle, source: LlmSource) -> Result<LlmProvidersView, String> {
    let paths = crate::resolve_fixed_paths(&app)?;
    set_source(&paths.user_data_dir, source)?;
    list_view(&paths.user_data_dir, &KeyringSecretStore)
}

#[tauri::command]
pub(crate) async fn test_llm_connection(
    app: AppHandle,
    config: LlmProbeConfigInput,
    api_key: Option<String>,
    id: Option<String>,
) -> Result<LlmProbeView, String> {
    if !(1..=MAX_TIMEOUT_SECONDS).contains(&config.timeout_seconds) {
        return Err(ERR_INVALID.to_string());
    }
    let paths = crate::resolve_fixed_paths(&app)?;
    let key = match api_key {
        Some(value) if !value.trim().is_empty() => value,
        _ => {
            let provider_id = id.ok_or_else(|| "LLM_PROBE_API_KEY_REQUIRED".to_string())?;
            KeyringSecretStore
                .get(&provider_id)?
                .ok_or_else(|| "LLM_PROBE_API_KEY_REQUIRED".to_string())?
        }
    };
    tokio::task::spawn_blocking(move || run_probe(&paths, &config, &key))
        .await
        .map_err(|_| "LLM_PROBE_UNEXPECTED_ERROR".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "locus-llm-providers-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn input(label: &str) -> LlmProviderInput {
        LlmProviderInput {
            id: None,
            label: label.to_string(),
            provider: "openai_compatible".to_string(),
            base_url: "https://api.example.com/v1".to_string(),
            model: "test-model".to_string(),
            timeout_seconds: 30,
        }
    }

    /// Extract the error without requiring `Debug` on any type that may hold credentials.
    fn expect_error<T>(result: Result<T, String>, label: &str) -> String {
        match result {
            Err(error) => error,
            Ok(_) => panic!("{label}: expected an error"),
        }
    }

    #[test]
    fn default_state_is_managed_with_no_providers() {
        let dir = temp_dir();
        let store = InMemorySecretStore::default();
        let view = load_state(&dir).expect("load default state");
        assert_eq!(view.source, LlmSource::Managed);
        assert!(view.providers.is_empty());
        assert_eq!(view.active_id, None);
        let rendered = list_view(&dir, &store).expect("list default");
        assert_eq!(rendered.source, LlmSource::Managed);
        assert!(rendered.providers.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_persists_metadata_but_never_the_key_on_disk() {
        let dir = temp_dir();
        let store = InMemorySecretStore::default();
        let view = save_provider(&dir, &store, input("DeepSeek"), Some("sk-SECRET-123".into()))
            .expect("save provider");
        assert_eq!(view.providers.len(), 1);
        assert!(view.providers[0].has_key);
        assert_eq!(view.active_id.as_deref(), Some(view.providers[0].id.as_str()));

        let raw = fs::read_to_string(state_path(&dir)).expect("state file");
        assert!(!raw.contains("sk-SECRET-123"));
        assert!(!raw.contains("api_key"));
        assert!(raw.contains("api.example.com"));
        assert_eq!(
            store.get(&view.providers[0].id).expect("key lookup"),
            Some("sk-SECRET-123".to_string())
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn edit_without_key_keeps_the_saved_secret() {
        let dir = temp_dir();
        let store = InMemorySecretStore::default();
        let first = save_provider(&dir, &store, input("one"), Some("sk-FIRST".into()))
            .expect("first save");
        let id = first.providers[0].id.clone();
        let mut edit = input("renamed");
        edit.id = Some(id.clone());
        let second = save_provider(&dir, &store, edit, None).expect("edit");
        assert_eq!(second.providers.len(), 1);
        assert_eq!(second.providers[0].label, "renamed");
        assert!(second.providers[0].has_key);
        assert_eq!(store.get(&id).expect("key"), Some("sk-FIRST".to_string()));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn deleting_a_provider_removes_its_secret_and_clears_active() {
        let dir = temp_dir();
        let store = InMemorySecretStore::default();
        let view = save_provider(&dir, &store, input("one"), Some("sk-ONE".into())).expect("save");
        let id = view.providers[0].id.clone();
        let after = delete_provider(&dir, &store, &id).expect("delete");
        assert!(after.providers.is_empty());
        assert_eq!(after.active_id, None);
        assert_eq!(store.get(&id).expect("key"), None);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_invalid_provider_and_unknown_active_id() {
        let dir = temp_dir();
        let store = InMemorySecretStore::default();
        let mut bad = input("bad");
        bad.provider = "anthropic".to_string();
        let error = expect_error(
            save_provider(&dir, &store, bad, Some("sk".into())),
            "invalid provider",
        );
        assert!(error.contains(ERR_INVALID), "unexpected error: {error}");
        let error = set_active_provider(&dir, "missing").unwrap_err();
        assert!(error.contains(ERR_NOT_FOUND), "unexpected error: {error}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupt_state_file_is_rejected() {
        let dir = temp_dir();
        fs::write(state_path(&dir), "{not-json").expect("seed corrupt file");
        let error = expect_error(load_state(&dir), "corrupt state");
        assert!(error.contains(ERR_STATE_INVALID), "unexpected error: {error}");
        let _ = fs::remove_dir_all(dir);
    }

    /// Secret store whose writes always fail, to prove metadata-first ordering.
    struct RejectingSetStore;

    impl SecretStore for RejectingSetStore {
        fn get(&self, _id: &str) -> Result<Option<String>, String> {
            Ok(None)
        }

        fn set(&self, _id: &str, _secret: &str) -> Result<(), String> {
            Err("simulated keychain failure".to_string())
        }

        fn delete(&self, _id: &str) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn metadata_commits_before_the_secret_so_failures_stay_visible() {
        let dir = temp_dir();
        let error = expect_error(
            save_provider(&dir, &RejectingSetStore, input("one"), Some("sk-ONE".into())),
            "rejecting store",
        );
        assert!(
            error.contains("simulated keychain failure"),
            "unexpected error: {error}"
        );
        let state = load_state(&dir).expect("metadata persisted despite store failure");
        assert_eq!(state.providers.len(), 1);
        let id = state.providers[0].id.clone();
        assert_eq!(state.active_id.as_deref(), Some(id.as_str()));

        let store = InMemorySecretStore::default();
        let mut retry = input("one");
        retry.id = Some(id);
        let view = save_provider(&dir, &store, retry, Some("sk-ONE".into())).expect("retry save");
        assert!(view.providers[0].has_key);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn runtime_debug_never_leaks_the_key() {
        let runtime = ByokLlmRuntime {
            provider: "openai_compatible".to_string(),
            base_url: "https://api.example.com/v1".to_string(),
            api_key: "sk-TOP-SECRET".to_string(),
            model: "test-model".to_string(),
            timeout_seconds: 30,
        };
        assert!(!format!("{runtime:?}").contains("sk-TOP-SECRET"));
    }

    #[test]
    fn choosing_managed_keeps_the_session_and_byok_keeps_anysearch_only() {
        let state = LlmProvidersState::default();
        let managed = choose_worker_llm_config(&state, None, None).expect("managed");
        assert!(matches!(managed, WorkerLlmConfig::Managed(None)));

        let mut byok_state = LlmProvidersState::default();
        byok_state.source = LlmSource::Byok;
        let runtime = ByokLlmRuntime {
            provider: "openai_compatible".to_string(),
            base_url: "https://api.example.com/v1".to_string(),
            api_key: "sk-KEY".to_string(),
            model: "test-model".to_string(),
            timeout_seconds: 30,
        };
        let byok = choose_worker_llm_config(&byok_state, Some(runtime), None).expect("byok");
        match byok {
            WorkerLlmConfig::Byok { provider, anysearch } => {
                assert_eq!(provider.base_url, "https://api.example.com/v1");
                assert!(anysearch.is_none());
            }
            WorkerLlmConfig::Managed(_) => panic!("expected BYOK"),
        }
        let error = expect_error(
            choose_worker_llm_config(&byok_state, None, None),
            "missing BYOK provider",
        );
        assert!(error.contains(ERR_NOT_CONFIGURED));
    }

    #[test]
    fn source_switch_round_trips_without_touching_secrets() {
        let dir = temp_dir();
        let store = InMemorySecretStore::default();
        save_provider(&dir, &store, input("one"), Some("sk-ONE".into())).expect("save");
        set_source(&dir, LlmSource::Byok).expect("switch to byok");
        let view = list_view(&dir, &store).expect("list");
        assert_eq!(view.source, LlmSource::Byok);
        assert!(view.providers[0].has_key);
        set_source(&dir, LlmSource::Managed).expect("switch back");
        assert_eq!(list_view(&dir, &store).expect("list").source, LlmSource::Managed);
        let _ = fs::remove_dir_all(dir);
    }
}
