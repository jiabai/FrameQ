//! PyTorch 运行时组件的下载编排。
//!
//! 组件以 GitHub Releases 资产随桌面端一起发布：`v<版本>` 下按平台存放
//! `frameq-pytorch-runtime-<target>.zip`。这里负责拼资产地址、组件目录
//! （`<user_data>/runtime/pytorch/<版本>`），并复用模型下载 lane 跑 worker。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State, Window};

use crate::asr_model::{
    map_model_download_run_result, ModelDownloadRunResult,
};
use crate::worker_runtime::{
    run_blocking_worker_command, ProcessSupervisors, RuntimeComponentDownloadJob,
};
use crate::{ensure_runtime_dirs, resolve_runtime_paths};

/// 发行资产所在仓库，与 `tauri.conf.json` 的 updater endpoint 保持一致。
const RELEASE_REPO: &str = "jiabai/FrameQ";

#[derive(Debug, Serialize)]
pub(crate) struct RuntimeComponentDownloadResult {
    started: bool,
    status: String,
}

/// 当前平台的组件资产标识，与 `scripts/build-installer.mjs` 的 target 命名一致。
pub(crate) fn component_target() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "windows-x64"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "macos-arm64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "macos-x64"
    }
}

pub(crate) fn component_release_url(version: &str, target: &str) -> String {
    format!(
        "https://github.com/{RELEASE_REPO}/releases/download/v{version}/frameq-pytorch-runtime-{target}.zip"
    )
}

pub(crate) fn component_dir(user_data_dir: &Path, version: &str) -> PathBuf {
    user_data_dir.join("runtime").join("pytorch").join(version)
}

#[tauri::command]
pub(crate) async fn download_runtime_component(
    window: Window,
    app: AppHandle,
    process_supervisors: State<'_, Arc<ProcessSupervisors>>,
) -> Result<RuntimeComponentDownloadResult, String> {
    let process_supervisors = Arc::clone(process_supervisors.inner());
    run_blocking_worker_command(move || {
        download_runtime_component_blocking(window, app, process_supervisors)
    })
    .await
}

fn download_runtime_component_blocking(
    window: Window,
    app: AppHandle,
    process_supervisors: Arc<ProcessSupervisors>,
) -> Result<RuntimeComponentDownloadResult, String> {
    let paths = resolve_runtime_paths(&app)?;
    ensure_runtime_dirs(&paths)?;
    let version = env!("CARGO_PKG_VERSION");
    let job = RuntimeComponentDownloadJob::new(
        component_dir(&paths.user_data_dir, version),
        component_release_url(version, component_target()),
        None,
    );
    let run_result = process_supervisors.run_runtime_component_download(&paths, job, window)?;
    match map_model_download_run_result(run_result)? {
        ModelDownloadRunResult::Completed => Ok(RuntimeComponentDownloadResult {
            started: true,
            status: "completed".to_string(),
        }),
        ModelDownloadRunResult::Cancelled => Ok(RuntimeComponentDownloadResult {
            started: false,
            status: "cancelled".to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_url_targets_the_versioned_platform_asset() {
        assert_eq!(
            component_release_url("0.3.9", "windows-x64"),
            "https://github.com/jiabai/FrameQ/releases/download/v0.3.9/frameq-pytorch-runtime-windows-x64.zip"
        );
        assert_eq!(
            component_release_url("0.3.9", "macos-arm64"),
            "https://github.com/jiabai/FrameQ/releases/download/v0.3.9/frameq-pytorch-runtime-macos-arm64.zip"
        );
    }

    #[test]
    fn component_dir_is_versioned_under_user_data() {
        assert_eq!(
            component_dir(Path::new("/data/frameq"), "0.3.9"),
            PathBuf::from("/data/frameq").join("runtime").join("pytorch").join("0.3.9")
        );
    }

    #[test]
    fn current_target_is_one_of_the_release_targets() {
        assert!(["windows-x64", "macos-arm64", "macos-x64"].contains(&component_target()));
    }
}
