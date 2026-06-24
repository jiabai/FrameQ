use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::{ensure_runtime_dirs, path_to_env_string, resolve_runtime_paths, RuntimePaths};

pub(crate) const DOTENV_FILE_NAME: &str = ".env";
pub(crate) const LLM_PROVIDER_ENV: &str = "FRAMEQ_LLM_PROVIDER";
pub(crate) const LLM_BASE_URL_ENV: &str = "FRAMEQ_LLM_BASE_URL";
pub(crate) const LLM_API_KEY_ENV: &str = "FRAMEQ_LLM_API_KEY";
pub(crate) const LLM_MODEL_ENV: &str = "FRAMEQ_LLM_MODEL";
pub(crate) const LLM_TIMEOUT_ENV: &str = "FRAMEQ_LLM_TIMEOUT_SECONDS";
pub(crate) const LLM_SOURCE_ENV: &str = "FRAMEQ_LLM_SOURCE";
pub(crate) const LLM_CHECKOUT_URL_ENV: &str = "FRAMEQ_LLM_CHECKOUT_URL";
pub(crate) const LLM_SESSION_TOKEN_ENV: &str = "FRAMEQ_LLM_SESSION_TOKEN";
pub(crate) const LLM_CHECKOUT_REQUEST_ID_ENV: &str = "FRAMEQ_LLM_CHECKOUT_REQUEST_ID";
pub(crate) const ASR_MODEL_ENV: &str = "FRAMEQ_ASR_MODEL";
pub(crate) const ASR_MODEL_DOWNLOAD_URL_ENV: &str = "FRAMEQ_ASR_MODEL_DOWNLOAD_URL";
pub(crate) const ASR_MODEL_DOWNLOAD_SHA256_ENV: &str = "FRAMEQ_ASR_MODEL_DOWNLOAD_SHA256";
pub(crate) const MODELSCOPE_ENDPOINT_ENV: &str = "FRAMEQ_MODELSCOPE_ENDPOINT";
pub(crate) const SENSEVOICE_REVISION_ENV: &str = "FRAMEQ_SENSEVOICE_REVISION";

const LEGACY_LOCAL_LLM_ENV_KEYS: [&str; 5] = [
    LLM_PROVIDER_ENV,
    LLM_BASE_URL_ENV,
    LLM_API_KEY_ENV,
    LLM_MODEL_ENV,
    LLM_TIMEOUT_ENV,
];
const APP_SETTINGS_DOTENV_TEMPLATE: &str = "# FrameQ desktop local settings.\n\
# This file lives in app-local data and is read by the desktop client/worker.\n\
# Insight LLM configuration is managed by the FrameQ server Admin Web.\n\
# Do not put FRAMEQ_LLM_* keys here.\n\
\n\
# Optional output directory for generated videos, transcripts, and insights.\n\
# Leave blank to use app-local data outputs/.\n\
FRAMEQ_OUTPUT_DIR=\n\
\n\
# Local ASR model for new transcription tasks.\n\
FRAMEQ_ASR_MODEL=iic/SenseVoiceSmall\n\
\n\
# Optional release ASR model download overrides.\n\
# FRAMEQ_ASR_MODEL_DOWNLOAD_URL=\n\
# FRAMEQ_ASR_MODEL_DOWNLOAD_SHA256=\n\
# FRAMEQ_MODELSCOPE_ENDPOINT=\n\
# FRAMEQ_SENSEVOICE_REVISION=master\n";

#[derive(Debug, Deserialize)]
pub(crate) struct LlmConfigInput {
    #[serde(default)]
    pub(crate) output_dir: String,
    #[serde(default)]
    pub(crate) asr_model: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct LlmConfigView {
    pub(crate) output_dir: String,
    pub(crate) asr_model: String,
    pub(crate) supported_asr_models: Vec<String>,
    pub(crate) config_path: String,
}

#[tauri::command]
pub(crate) fn get_llm_config(app: AppHandle) -> Result<LlmConfigView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    load_llm_config_from_file(&env_path(&paths))
}

#[tauri::command]
pub(crate) fn save_llm_config(
    app: AppHandle,
    config: LlmConfigInput,
) -> Result<LlmConfigView, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    save_llm_config_to_file(&env_path(&paths), config)
}

pub(crate) fn load_llm_config_from_file(path: &Path) -> Result<LlmConfigView, String> {
    ensure_app_settings_dotenv(path)?;
    let values = parse_dotenv_values(path)?;
    Ok(LlmConfigView {
        output_dir: values.get(crate::OUTPUT_DIR_ENV).cloned().unwrap_or_default(),
        asr_model: resolve_asr_model_value(values.get(ASR_MODEL_ENV).cloned())?,
        supported_asr_models: supported_asr_models(),
        config_path: path_to_env_string(path),
    })
}

pub(crate) fn save_llm_config_to_file(
    path: &Path,
    config: LlmConfigInput,
) -> Result<LlmConfigView, String> {
    ensure_app_settings_dotenv(path)?;
    let output_dir = sanitize_optional_env_value(config.output_dir, crate::OUTPUT_DIR_ENV)?;
    let asr_model = resolve_asr_model_value(Some(config.asr_model))?;
    write_dotenv_updates_removing(
        path,
        &[(crate::OUTPUT_DIR_ENV, output_dir), (ASR_MODEL_ENV, asr_model)],
        &[
            LLM_PROVIDER_ENV,
            LLM_BASE_URL_ENV,
            LLM_API_KEY_ENV,
            LLM_MODEL_ENV,
            LLM_TIMEOUT_ENV,
        ],
    )?;
    load_llm_config_from_file(path)
}

pub(crate) fn env_path(paths: &RuntimePaths) -> PathBuf {
    paths.user_data_dir.join(DOTENV_FILE_NAME)
}

pub(crate) fn legacy_local_llm_env_removals() -> Vec<String> {
    LEGACY_LOCAL_LLM_ENV_KEYS
        .iter()
        .map(|key| (*key).to_string())
        .collect()
}

pub(crate) fn configured_env_value(
    config_values: &HashMap<String, String>,
    key: &str,
) -> Option<String> {
    config_values
        .get(key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
}

pub(crate) fn asr_model_source(config_values: &HashMap<String, String>) -> String {
    if configured_env_value(config_values, ASR_MODEL_DOWNLOAD_URL_ENV).is_some() {
        "custom_url".to_string()
    } else {
        "modelscope".to_string()
    }
}

pub(crate) fn supported_asr_models() -> Vec<String> {
    crate::SUPPORTED_ASR_MODELS
        .iter()
        .map(|model| (*model).to_string())
        .collect()
}

pub(crate) fn resolve_asr_model_value(value: Option<String>) -> Result<String, String> {
    let model = value.unwrap_or_default().trim().to_string();
    if model.is_empty() {
        return Ok(crate::DEFAULT_ASR_MODEL.to_string());
    }

    if crate::SUPPORTED_ASR_MODELS.contains(&model.as_str()) {
        Ok(model)
    } else {
        Err(format!("Unsupported ASR model: {model}"))
    }
}

pub(crate) fn parse_dotenv_values(path: &Path) -> Result<HashMap<String, String>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut values = HashMap::new();
    for raw_line in content.lines() {
        let Some((key, value)) = parse_dotenv_assignment(raw_line) else {
            continue;
        };
        values.insert(key.to_string(), strip_env_quotes(value.trim()).to_string());
    }
    Ok(values)
}

fn ensure_app_settings_dotenv(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, APP_SETTINGS_DOTENV_TEMPLATE).map_err(|error| error.to_string())
}

fn write_dotenv_updates_removing(
    path: &Path,
    updates: &[(&str, String)],
    remove_keys: &[&str],
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let existing_content = if path.exists() {
        fs::read_to_string(path).map_err(|error| error.to_string())?
    } else {
        String::new()
    };
    let update_map: HashMap<&str, &str> = updates
        .iter()
        .map(|(key, value)| (*key, value.as_str()))
        .collect();
    let mut written_keys: Vec<String> = Vec::new();
    let mut lines = Vec::new();

    for line in existing_content.lines() {
        if let Some((key, _)) = parse_dotenv_assignment(line) {
            if remove_keys.iter().any(|remove_key| remove_key == &key) {
                continue;
            }

            if let Some(value) = update_map.get(key) {
                if !written_keys.iter().any(|written| written == key) {
                    lines.push(format!("{key}={value}"));
                    written_keys.push(key.to_string());
                }
                continue;
            }
        }

        lines.push(line.to_string());
    }

    for (key, value) in updates {
        if !written_keys.iter().any(|written| written == key) {
            lines.push(format!("{key}={value}"));
        }
    }

    fs::write(path, format!("{}\n", lines.join("\n"))).map_err(|error| error.to_string())
}

fn parse_dotenv_assignment(line: &str) -> Option<(&str, &str)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') || !line.contains('=') {
        return None;
    }

    let line = line.strip_prefix("export ").unwrap_or(line).trim();
    let (key, value) = line.split_once('=')?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }

    Some((key, value))
}

fn strip_env_quotes(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

fn sanitize_optional_env_value(value: String, label: &str) -> Result<String, String> {
    if value.contains('\n') || value.contains('\r') {
        return Err(format!("{label} must be a single line."));
    }

    Ok(value.trim().to_string())
}
