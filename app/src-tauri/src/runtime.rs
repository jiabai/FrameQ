use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub(crate) const OUTPUT_DIR_ENV: &str = "APP_OUTPUT_DIR";
pub(crate) const CACHE_DIR_ENV: &str = "APP_CACHE_DIR";
pub(crate) const MODEL_DIR_ENV: &str = "APP_MODEL_DIR";
pub(crate) const RESOURCE_DIR_ENV: &str = "APP_RESOURCE_DIR";
pub(crate) const USER_DATA_DIR_ENV: &str = "APP_USER_DATA_DIR";
pub(crate) const PYTORCH_RUNTIME_DIR_ENV: &str = "APP_PYTORCH_RUNTIME_DIR";
pub(crate) const PYTORCH_RUNTIME_URL_ENV: &str = "APP_PYTORCH_RUNTIME_URL";
pub(crate) const PYTORCH_RUNTIME_SHA256_ENV: &str = "APP_PYTORCH_RUNTIME_SHA256";
pub(crate) const ALLOW_REAL_ASR_ENV: &str = "APP_ALLOW_REAL_ASR";
pub(crate) const MODELSCOPE_OFFLINE_ENV: &str = "MODELSCOPE_OFFLINE";
pub(crate) const AUDIO_REVIEW_CACHE_DIR_NAME: &str = ".frameq-audio-review";
#[cfg(test)]
pub(crate) const LEGACY_TEMP_DIR_NAME: &str = "work";
pub(crate) const DESKTOP_LOG_DIR_NAME: &str = "logs";
#[allow(dead_code)] // Consumed by the Task 3 facade before Task 4 runner wiring lands.
pub(crate) const ASR_DIAGNOSTIC_LOG_FILE_NAME: &str = "asr-model-download.log";

#[derive(Debug, Clone)]
pub(crate) struct RuntimePaths {
    pub(crate) resource_dir: PathBuf,
    pub(crate) user_data_dir: PathBuf,
}

pub(crate) fn resolve_runtime_paths(app: &AppHandle) -> Result<RuntimePaths, String> {
    resolve_fixed_paths(app)
}

pub(crate) fn resolve_fixed_paths(app: &AppHandle) -> Result<RuntimePaths, String> {
    let raw_resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    Ok(RuntimePaths {
        resource_dir: normalize_resource_dir(raw_resource_dir),
        user_data_dir: app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?,
    })
}

impl RuntimePaths {
    pub(crate) fn data_paths(&self) -> Result<crate::data_storage::DataPaths, String> {
        crate::data_storage::paths_for_config(&self.user_data_dir)
            .map_err(|error| error.to_string())
    }

    pub(crate) fn data_root(&self) -> Result<PathBuf, String> {
        Ok(self.data_paths()?.data_root)
    }

    pub(crate) fn output_root(&self) -> Result<PathBuf, String> {
        Ok(self.data_paths()?.output_root)
    }

    pub(crate) fn cache_root(&self) -> Result<PathBuf, String> {
        Ok(self.data_paths()?.cache_root)
    }

    pub(crate) fn models_root(&self) -> Result<PathBuf, String> {
        Ok(self.data_paths()?.models_root)
    }

    pub(crate) fn runtime_root(&self) -> Result<PathBuf, String> {
        Ok(self.data_paths()?.runtime_root)
    }

    pub(crate) fn collections_path(&self) -> Result<PathBuf, String> {
        Ok(self.data_paths()?.collections_path)
    }
}

pub(crate) fn normalize_resource_dir(resource_dir: PathBuf) -> PathBuf {
    if resource_dir_has_runtime(&resource_dir) {
        return resource_dir;
    }

    let nested_resources = resource_dir.join("resources");
    if resource_dir_has_runtime(&nested_resources) {
        return nested_resources;
    }

    resource_dir
}

fn resource_dir_has_runtime(resource_dir: &Path) -> bool {
    bundled_python_path(resource_dir).is_file()
        || resource_dir.join("worker").is_dir()
        || resource_dir.join("bin").is_dir()
}

pub(crate) fn ensure_runtime_dirs(paths: &RuntimePaths) -> Result<(), String> {
    ensure_config_dirs(paths)?;
    let data = paths.data_paths()?;
    for root in [&data.output_root, &data.cache_root, &data.models_root, &data.runtime_root] {
        fs::create_dir_all(root).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn ensure_config_dirs(paths: &RuntimePaths) -> Result<(), String> {
    fs::create_dir_all(paths.user_data_dir.join(DESKTOP_LOG_DIR_NAME))
        .map_err(|error| error.to_string())
}

pub(crate) fn bundled_python_path(resource_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        resource_dir.join("python").join("python.exe")
    } else {
        resource_dir.join("python").join("bin").join("python3")
    }
}

pub(crate) fn prepend_to_path(path: &Path) -> Result<String, String> {
    let existing_path = std::env::var_os("PATH").unwrap_or_default();
    let paths = std::iter::once(path.to_path_buf()).chain(std::env::split_paths(&existing_path));
    std::env::join_paths(paths)
        .map(|value| value.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

pub(crate) fn path_to_env_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::{
        bundled_python_path, ensure_config_dirs, ensure_runtime_dirs, normalize_resource_dir, RuntimePaths,
        LEGACY_TEMP_DIR_NAME,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn fixed_configuration_remains_available_when_storage_control_is_invalid() {
        let root = temp_dir("fixed_configuration_without_data");
        let paths = RuntimePaths { resource_dir: root.join("resources"), user_data_dir: root.join("config") };
        fs::create_dir_all(&paths.user_data_dir).expect("config root");
        fs::write(paths.user_data_dir.join("data-storage.json"), b"invalid storage control").expect("damaged control fixture");
        ensure_config_dirs(&paths).expect("fixed config service");
        assert!(paths.user_data_dir.join("logs").is_dir());
        assert!(ensure_runtime_dirs(&paths).is_err());
        for name in ["outputs", "cache", "models", "runtime"] {
            assert!(!paths.user_data_dir.join(name).exists());
        }
    }

    #[test]
    fn ensure_runtime_dirs_creates_app_local_cache_dir() {
        let root = temp_dir("ensure_runtime_dirs_creates_app_local_cache_dir");
        let paths = RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("user-data"),
        };
        let legacy_temp_dir = paths.user_data_dir.join(LEGACY_TEMP_DIR_NAME);
        fs::create_dir_all(&legacy_temp_dir).expect("create legacy temp dir");
        fs::write(legacy_temp_dir.join("history.json"), "{}").expect("write legacy temp file");

        ensure_runtime_dirs(&paths).expect("ensure runtime dirs");

        assert!(paths.user_data_dir.join("outputs").is_dir());
        assert!(paths.user_data_dir.join("cache").is_dir());
        assert!(paths.user_data_dir.join("logs").is_dir());
        assert!(legacy_temp_dir.join("history.json").is_file());
    }

    #[test]
    fn normalize_resource_dir_uses_packaged_resources_subdir_when_tauri_returns_install_root() {
        let root = temp_dir("normalize_resource_dir_uses_packaged_resources_subdir");
        let install_root = root.join("FrameQ");
        let resources = install_root.join("resources");
        let python = bundled_python_path(&resources);
        fs::create_dir_all(python.parent().expect("packaged python parent"))
            .expect("create packaged python dir");
        fs::write(python, "python").expect("write python");

        assert_eq!(normalize_resource_dir(install_root), resources);
    }

    fn temp_dir(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../build/data-storage-acceptance")
            .join(format!("runtime-{test_name}-{unique}"));
        fs::create_dir_all(&dir).expect("create test dir");
        dir.canonicalize().expect("resolve test dir")
    }
}
