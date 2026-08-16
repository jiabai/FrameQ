use std::path::Path;

use crate::RuntimePaths;

/// Runtime DLLs from the Microsoft Visual C++ 2015-2022 Redistributable that
/// third-party Python C extensions (numpy, onnxruntime, pycryptodome, ...)
/// link against. The installer bundles these app-local next to the standalone
/// Python so a clean Windows machine does not need the system redist installed.
pub(crate) const VC_RUNTIME_DLLS: &[&str] = &["msvcp140.dll", "vcruntime140_1.dll"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VcRuntimeStatus {
    /// All app-local runtime DLLs are present next to the bundled Python.
    Ok,
    /// The app-local bundle is missing a required runtime DLL (packaging defect
    /// or security-software quarantine).
    AppLocalMissing,
}

/// Pre-flight check before spawning a worker on Windows. macOS and Linux
/// runners are self-contained and skip the check.
#[cfg(windows)]
pub(crate) fn check_vc_runtime(paths: &RuntimePaths) -> VcRuntimeStatus {
    let python_root = paths.resource_dir.join("python");
    // Unpackaged/dev environments have no bundled python directory; skip the
    // check so development runs are not blocked.
    if !python_root.is_dir() {
        return VcRuntimeStatus::Ok;
    }
    check_vc_runtime_at(&python_root)
}

#[cfg(not(windows))]
pub(crate) fn check_vc_runtime(_paths: &RuntimePaths) -> VcRuntimeStatus {
    VcRuntimeStatus::Ok
}

/// Path-injected core so the three-way decision is testable on any platform.
pub(crate) fn check_vc_runtime_at(python_root: &Path) -> VcRuntimeStatus {
    let app_local_missing = VC_RUNTIME_DLLS
        .iter()
        .any(|dll| !python_root.join(dll).is_file());
    if app_local_missing {
        return VcRuntimeStatus::AppLocalMissing;
    }
    VcRuntimeStatus::Ok
}

#[cfg(test)]
mod tests {
    #[cfg(not(windows))]
    use super::check_vc_runtime;
    use super::{check_vc_runtime_at, VcRuntimeStatus, VC_RUNTIME_DLLS};
    #[cfg(not(windows))]
    use crate::RuntimePaths;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("frameq-vc-runtime-{test_name}-{unique}"));
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    fn populate_dlls(root: &Path, names: &[&str]) {
        for name in names {
            fs::write(root.join(name), "fake").expect("write fake dll");
        }
    }

    #[test]
    fn ok_when_all_app_local_dlls_are_present() {
        let root = temp_dir("ok");
        let python_root = root.join("python");
        fs::create_dir_all(&python_root).expect("python dir");
        populate_dlls(&python_root, VC_RUNTIME_DLLS);

        assert_eq!(check_vc_runtime_at(&python_root), VcRuntimeStatus::Ok);
    }

    #[test]
    fn app_local_missing_when_msvcp140_absent() {
        let root = temp_dir("missing-msvcp140");
        let python_root = root.join("python");
        fs::create_dir_all(&python_root).expect("python dir");
        populate_dlls(&python_root, &["vcruntime140_1.dll"]);

        assert_eq!(
            check_vc_runtime_at(&python_root),
            VcRuntimeStatus::AppLocalMissing
        );
    }

    #[test]
    fn app_local_missing_when_vcruntime140_1_absent() {
        let root = temp_dir("missing-vcruntime140-1");
        let python_root = root.join("python");
        fs::create_dir_all(&python_root).expect("python dir");
        populate_dlls(&python_root, &["msvcp140.dll"]);

        assert_eq!(
            check_vc_runtime_at(&python_root),
            VcRuntimeStatus::AppLocalMissing
        );
    }

    #[test]
    fn app_local_runtime_is_sufficient_without_system_redist() {
        let root = temp_dir("without-system-redist");
        let python_root = root.join("python");
        fs::create_dir_all(&python_root).expect("python dir");
        populate_dlls(&python_root, VC_RUNTIME_DLLS);

        assert_eq!(check_vc_runtime_at(&python_root), VcRuntimeStatus::Ok);
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_skips_the_check() {
        let root = temp_dir("skip");
        let paths = RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("app-data"),
        };
        assert_eq!(check_vc_runtime(&paths), VcRuntimeStatus::Ok);
    }
}
