use super::{WebPageError, WebResult};
#[cfg(target_os="macos")] use super::storage;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Birth { WindowsFiletime100ns(u64), MacUnixMicroseconds(u64) }

impl Birth {
    pub(super) fn valid(self) -> bool {
        match self {
            Self::WindowsFiletime100ns(value) => cfg!(windows) && value > 116_444_736_000_000_000,
            Self::MacUnixMicroseconds(value) => cfg!(target_os = "macos") && value > 0,
        }
    }
}

pub(super) struct Facts { pub(super) birth: Birth, pub(super) executable: PathBuf }

#[cfg(windows)]
mod windows {
    use super::*;
    use std::os::windows::ffi::OsStringExt;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
    use windows_sys::Win32::System::Threading::{OpenProcess, GetProcessTimes, QueryFullProcessImageNameW, GetExitCodeProcess, TerminateProcess, WaitForSingleObject};
    struct OwnedHandle(HANDLE);
    impl Drop for OwnedHandle { fn drop(&mut self) { unsafe { CloseHandle(self.0); } } }

    fn open(pid: u32, terminate: bool) -> WebResult<Option<OwnedHandle>> {
        let access = 0x1000 | if terminate { 0x0001 | 0x0010_0000 } else { 0 };
        let handle = unsafe { OpenProcess(access, 0, pid) };
        if handle.is_null() {
            return if std::io::Error::last_os_error().raw_os_error() == Some(87) { Ok(None) } else { Err(WebPageError::StorageFailed) };
        }
        Ok(Some(OwnedHandle(handle)))
    }
    fn read(handle: &OwnedHandle) -> WebResult<Option<Facts>> {
        let mut code = 0;
        if unsafe { GetExitCodeProcess(handle.0, &mut code) } == 0 { return Err(WebPageError::StorageFailed); }
        if code != 259 { return Ok(None); }
        let (mut created, mut exited, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        if unsafe { GetProcessTimes(handle.0, &mut created, &mut exited, &mut kernel, &mut user) } == 0 { return Err(WebPageError::StorageFailed); }
        let mut path = vec![0u16; 32768]; let mut size = path.len() as u32;
        if unsafe { QueryFullProcessImageNameW(handle.0, 0, path.as_mut_ptr(), &mut size) } == 0 { return Err(WebPageError::StorageFailed); }
        let birth = Birth::WindowsFiletime100ns((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime));
        if !birth.valid() { return Err(WebPageError::StorageFailed); }
        Ok(Some(Facts { birth, executable: PathBuf::from(std::ffi::OsString::from_wide(&path[..size as usize])) }))
    }
    pub(crate) fn query(pid: u32) -> WebResult<Option<Facts>> { match open(pid, false)? { Some(handle) => read(&handle), None => Ok(None) } }
    pub(crate) fn terminate(pid: u32, expected: Birth) -> WebResult<()> {
        terminate_before(pid, expected, Instant::now() + Duration::from_secs(10))
    }
    pub(crate) fn terminate_before(pid: u32, expected: Birth, deadline: Instant) -> WebResult<()> {
        if Instant::now() >= deadline { return Err(WebPageError::StorageFailed); }
        let Some(handle) = open(pid, true)? else { return Ok(()); };
        let Some(actual) = read(&handle)? else { return Ok(()); };
        if actual.birth != expected { return Ok(()); }
        if Instant::now() >= deadline { return Err(WebPageError::StorageFailed); }
        if unsafe { TerminateProcess(handle.0, 1) } == 0 { return Err(WebPageError::StorageFailed); }
        let remaining = deadline.saturating_duration_since(Instant::now());
        let timeout = remaining.as_millis().min(u128::from(u32::MAX - 1)) as u32;
        if unsafe { WaitForSingleObject(handle.0, timeout) } != 0 { return Err(WebPageError::StorageFailed); }
        Ok(())
    }
}

#[cfg(windows)] pub(super) use windows::{query, terminate, terminate_before};

#[cfg(windows)]
pub(super) fn system_console() -> WebResult<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut path = vec![0u16; 32768];
    let count = unsafe { GetSystemDirectoryW(path.as_mut_ptr(), path.len() as u32) } as usize;
    if count == 0 || count >= path.len() { return Err(WebPageError::StorageFailed); }
    Ok(PathBuf::from(std::ffi::OsString::from_wide(&path[..count])).join("conhost.exe"))
}

#[cfg(target_os="macos")]
pub(super) fn query(pid: u32) -> WebResult<Option<Facts>> {
    use std::os::unix::ffi::OsStrExt;
    fn info(pid: i32) -> WebResult<Option<libc::proc_bsdinfo>> {
        let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
        let size = std::mem::size_of::<libc::proc_bsdinfo>();
        let read = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, info.as_mut_ptr().cast(), size as i32) };
        if read != size as i32 {
            return if std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) { Ok(None) } else { Err(WebPageError::StorageFailed) };
        }
        Ok(Some(unsafe { info.assume_init() }))
    }
    let pid = i32::try_from(pid).map_err(storage)?;
    let Some(before) = info(pid)? else { return Ok(None); };
    let mut path = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    if unsafe { libc::proc_pidpath(pid, path.as_mut_ptr().cast(), path.len() as u32) } <= 0 { return Err(WebPageError::StorageFailed); }
    let Some(after) = info(pid)? else { return Ok(None); };
    if (before.pbi_start_tvsec, before.pbi_start_tvusec) != (after.pbi_start_tvsec, after.pbi_start_tvusec) { return Err(WebPageError::StorageFailed); }
    let path = std::ffi::CStr::from_bytes_until_nul(&path).map_err(storage)?;
    let birth = Birth::MacUnixMicroseconds(after.pbi_start_tvsec.checked_mul(1_000_000).and_then(|seconds| seconds.checked_add(after.pbi_start_tvusec)).ok_or(WebPageError::StorageFailed)?);
    Ok(Some(Facts { birth, executable: std::ffi::OsStr::from_bytes(path.to_bytes()).into() }))
}

#[cfg(not(any(windows, target_os="macos")))]
pub(super) fn query(_: u32) -> WebResult<Option<Facts>> { Err(WebPageError::StorageFailed) }
