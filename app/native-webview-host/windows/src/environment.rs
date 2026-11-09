use crate::protocol::HostResult;
use std::{cell::RefCell, os::windows::fs::MetadataExt, path::{Path, PathBuf}, rc::Rc};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{core::{w, Interface, PCWSTR, PWSTR}, Win32::{Foundation::*, System::Registry::*, UI::WindowsAndMessaging::*}};

pub struct Native {
    pub environment: ICoreWebView2Environment,
    pub controller: ICoreWebView2Controller,
    pub webview: ICoreWebView2,
    pub runtime: String,
    pub browser_pid: u32,
    pub hwnd: HWND,
}

pub fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(Some(0)).collect() }

pub unsafe fn string(getter: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> windows::core::Result<String> {
    let mut value = PWSTR::null();
    getter(&mut value)?;
    let owned = CoTaskMemPWSTR::from(value);
    Ok(owned.to_string())
}

pub fn validate_version(version: &str) -> HostResult<()> {
    let parts = version.split('.').map(str::parse::<u32>).collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| "WEB_RUNTIME_UNSUPPORTED")?;
    if parts.len() != 4 || parts.as_slice() < [143, 0, 3650, 58].as_slice() {
        return Err("WEB_RUNTIME_UNSUPPORTED");
    }
    Ok(())
}

pub fn validate_directory(value: &str) -> HostResult<PathBuf> {
    let path = Path::new(value);
    if !path.is_absolute() || value.contains('\0') { return Err("WEB_HOST_FAILED"); }
    for ancestor in path.ancestors() {
        let metadata = std::fs::symlink_metadata(ancestor).map_err(|_| "WEB_HOST_FAILED")?;
        if !metadata.is_dir() || metadata.file_attributes() & 0x400 != 0 { return Err("WEB_HOST_FAILED"); }
    }
    let mut entries = std::fs::read_dir(path).map_err(|_| "WEB_HOST_FAILED")?;
    if entries.next().is_some() { return Err("WEB_HOST_FAILED"); }
    std::fs::canonicalize(path).map_err(|_| "WEB_HOST_FAILED")
}

pub fn reject_overrides() -> HostResult<()> {
    if std::env::vars_os().any(|(key, _)| {
        let key = key.to_string_lossy().to_ascii_uppercase();
        key.starts_with("WEBVIEW2_") || key.starts_with("COREWEBVIEW2_")
    }) { return Err("WEB_RUNTIME_UNSAFE_CONFIGURATION"); }
    unsafe {
        for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            for view in [KEY_WOW64_32KEY, KEY_WOW64_64KEY] {
                for name in ["BrowserExecutableFolder", "UserDataFolder", "AdditionalBrowserArguments", "ReleaseChannels", "ChannelSearchKind"] {
                    let key_path = wide(&format!("Software\\Policies\\Microsoft\\Edge\\WebView2\\{name}"));
                    let mut key = HKEY::default();
                    let status = RegOpenKeyExW(root, PCWSTR(key_path.as_ptr()), None, KEY_READ | view, &mut key);
                    if status == ERROR_FILE_NOT_FOUND { continue; }
                    if status != ERROR_SUCCESS { return Err("WEB_RUNTIME_UNSAFE_CONFIGURATION"); }
                    let mut values = 0;
                    let query = RegQueryInfoKeyW(key, None, None, None, None, None, None, Some(&mut values), None, None, None, None);
                    let close = RegCloseKey(key);
                    if query != ERROR_SUCCESS || close != ERROR_SUCCESS || values > 0 { return Err("WEB_RUNTIME_UNSAFE_CONFIGURATION"); }
                }
            }
        }
    }
    Ok(())
}

pub type Preparation = Rc<RefCell<Option<windows::core::Result<Native>>>>;

pub unsafe fn begin(directory: &Path) -> HostResult<Preparation> {
    let hwnd = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, w!("STATIC"), w!("Locus Web Page"),
        WS_OVERLAPPEDWINDOW, 0, 0, 1280, 900, None, None, None, None).map_err(|_| "WEB_HOST_FAILED")?;
    let output: Preparation = Rc::new(RefCell::new(None));
    let result = output.clone();
    let expected_directory = directory.to_owned();
    let options: ICoreWebView2EnvironmentOptions = CoreWebView2EnvironmentOptions::default().into();
    options.SetAllowSingleSignOnUsingOSPrimaryAccount(false).map_err(|_| "WEB_HOST_FAILED")?;
    options.cast::<ICoreWebView2EnvironmentOptions2>().map_err(|_| "WEB_RUNTIME_UNSUPPORTED")?
        .SetExclusiveUserDataFolderAccess(true).map_err(|_| "WEB_HOST_FAILED")?;
    options.cast::<ICoreWebView2EnvironmentOptions6>().map_err(|_| "WEB_RUNTIME_UNSUPPORTED")?
        .SetAreBrowserExtensionsEnabled(false).map_err(|_| "WEB_HOST_FAILED")?;
    options.cast::<ICoreWebView2EnvironmentOptions7>().map_err(|_| "WEB_RUNTIME_UNSUPPORTED")?
        .SetReleaseChannels(COREWEBVIEW2_RELEASE_CHANNELS_STABLE).map_err(|_| "WEB_HOST_FAILED")?;
    let available = string(|value| GetAvailableCoreWebView2BrowserVersionStringWithOptions(PCWSTR::null(), &options, value))
        .map_err(|_| "WEB_RUNTIME_MISSING")?;
    validate_version(&available)?;
    let handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(move |status, environment| {
        let ready = (|| -> windows::core::Result<_> {
            status?;
            let environment = environment.ok_or_else(windows::core::Error::from_win32)?;
            let actual = string(|value| environment.cast::<ICoreWebView2Environment7>()?.UserDataFolder(value))?;
            let canonical = std::fs::canonicalize(actual).map_err(|_| windows::core::Error::from(E_ACCESSDENIED))?;
            if canonical != expected_directory { return Err(E_ACCESSDENIED.into()); }
            let runtime = string(|value| environment.BrowserVersionString(value))?;
            validate_version(&runtime).map_err(|_| windows::core::Error::from(E_NOINTERFACE))?;
            let environment10 = environment.cast::<ICoreWebView2Environment10>()?;
            let options = environment10.CreateCoreWebView2ControllerOptions()?;
            options.SetProfileName(w!("Locus"))?;
            options.SetIsInPrivateModeEnabled(true)?;
            let controller_output = result.clone();
            let env = environment.clone();
            let handler = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |status, controller| {
                let ready = (|| -> windows::core::Result<_> {
                    status?;
                    let controller = controller.ok_or_else(windows::core::Error::from_win32)?;
                    controller.SetBounds(RECT { left: 0, top: 0, right: 1280, bottom: 900 })?;
                    controller.SetIsVisible(false)?;
                    controller.cast::<ICoreWebView2Controller4>()?.SetAllowExternalDrop(false)?;
                    let webview = controller.CoreWebView2()?;
                    let mut in_private = windows::core::BOOL::default();
                    webview.cast::<ICoreWebView2_13>()?.Profile()?.IsInPrivateModeEnabled(&mut in_private)?;
                    if !in_private.as_bool() { return Err(E_ACCESSDENIED.into()); }
                    let mut browser_pid = 0;
                    webview.BrowserProcessId(&mut browser_pid)?;
                    Ok(Native { environment: env, controller, webview, runtime, browser_pid, hwnd })
                })();
                *controller_output.borrow_mut() = Some(ready);
                Ok(())
            }));
            environment10.CreateCoreWebView2ControllerWithOptions(hwnd, &options, &handler)?;
            Ok(())
        })();
        if let Err(error) = ready { *result.borrow_mut() = Some(Err(error)); }
        Ok(())
    }));
    let directory = wide(directory.to_str().ok_or("WEB_HOST_FAILED")?);
    CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), PCWSTR(directory.as_ptr()), &options, &handler)
        .map_err(|_| "WEB_RUNTIME_MISSING")?;
    Ok(output)
}

pub fn pump() {
    unsafe {
        let mut message = MSG::default();
        while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_runtime_minimum_is_enforced() {
        assert!(validate_version("143.0.3650.58").is_ok());
        assert!(validate_version("156.0.4314.58").is_ok());
        for version in ["142.9.9999.99", "143.0.3650.57", "156.0.4314.58 dev", "156", ""] {
            assert!(validate_version(version).is_err());
        }
    }
}
