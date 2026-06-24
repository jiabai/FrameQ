use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const HISTORY_FILE_NAME: &str = "history.json";

#[derive(Debug, Serialize)]
pub(crate) struct HistoryErrorView {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) stage: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct HistoryItemView {
    pub(crate) id: String,
    pub(crate) created_at: String,
    pub(crate) url: String,
    pub(crate) status: String,
    pub(crate) output_dir: String,
    pub(crate) video_path: Option<String>,
    pub(crate) audio_path: Option<String>,
    pub(crate) transcript_path: Option<String>,
    pub(crate) insights_path: Option<String>,
    pub(crate) error: Option<HistoryErrorView>,
    pub(crate) text_preview: String,
    pub(crate) insights_count: usize,
    pub(crate) text: String,
    pub(crate) insights: Vec<String>,
}

#[tauri::command]
pub(crate) fn get_history(app: AppHandle) -> Result<Vec<HistoryItemView>, String> {
    let user_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    ensure_history_runtime_dirs(&user_data_dir)?;
    load_history_from_project(&user_data_dir)
}

pub(crate) fn load_history_from_project(project_root: &Path) -> Result<Vec<HistoryItemView>, String> {
    let history_path = project_root.join("work").join(HISTORY_FILE_NAME);
    if !history_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&history_path).map_err(|error| error.to_string())?;
    let history: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    let Some(items) = history.get("items").and_then(serde_json::Value::as_array) else {
        return Ok(vec![]);
    };

    Ok(items
        .iter()
        .filter_map(|item| history_item_from_value(project_root, item))
        .collect())
}

fn ensure_history_runtime_dirs(user_data_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(user_data_dir.join("outputs")).map_err(|error| error.to_string())?;
    fs::create_dir_all(user_data_dir.join("work")).map_err(|error| error.to_string())?;
    fs::create_dir_all(user_data_dir.join("models")).map_err(|error| error.to_string())
}

fn history_item_from_value(
    project_root: &Path,
    item: &serde_json::Value,
) -> Option<HistoryItemView> {
    let transcript_path = optional_string(item, "transcript_path");
    let insights_path = optional_string(item, "insights_path");
    let text = transcript_path
        .as_deref()
        .and_then(|path| read_text_file_if_exists(project_root, path))
        .unwrap_or_default();
    let insights = insights_path
        .as_deref()
        .map(|path| read_insights_file_if_exists(project_root, path))
        .unwrap_or_default();

    Some(HistoryItemView {
        id: required_string(item, "id")?,
        created_at: required_string(item, "created_at")?,
        url: required_string(item, "url")?,
        status: required_string(item, "status")?,
        output_dir: required_string(item, "output_dir")?,
        video_path: optional_string(item, "video_path"),
        audio_path: optional_string(item, "audio_path"),
        transcript_path,
        insights_path,
        error: history_error_from_value(item.get("error")),
        text_preview: optional_string(item, "text_preview").unwrap_or_default(),
        insights_count: item
            .get("insights_count")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0) as usize,
        text,
        insights,
    })
}

fn history_error_from_value(value: Option<&serde_json::Value>) -> Option<HistoryErrorView> {
    let value = value?;
    if value.is_null() {
        return None;
    }

    Some(HistoryErrorView {
        code: required_string(value, "code")?,
        message: required_string(value, "message")?,
        stage: required_string(value, "stage")?,
    })
}

fn required_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::to_string)
}

fn optional_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn read_text_file_if_exists(project_root: &Path, raw_path: &str) -> Option<String> {
    let path = resolve_history_path(project_root, raw_path);
    fs::read_to_string(path)
        .ok()
        .map(|text| text.trim().to_string())
}

fn read_insights_file_if_exists(project_root: &Path, raw_path: &str) -> Vec<String> {
    let path = resolve_history_path(project_root, raw_path);
    let Ok(content) = fs::read_to_string(path) else {
        return vec![];
    };
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&content) else {
        return vec![];
    };
    let Some(insights) = payload
        .get("insights")
        .and_then(serde_json::Value::as_array)
    else {
        return vec![];
    };

    insights
        .iter()
        .filter_map(|item| {
            item.as_str().map(str::to_string).or_else(|| {
                item.get("text")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
        })
        .collect()
}

fn resolve_history_path(project_root: &Path, raw_path: &str) -> PathBuf {
    let path = PathBuf::from(raw_path);
    if path.is_absolute() {
        path
    } else {
        project_root.join(path)
    }
}
