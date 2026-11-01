use super::HistoryDeleteError as Error;
use crate::atomic_files;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Identity {
    volume: u64,
    file: u64,
}

pub(super) fn validate_ancestors(path: &Path) -> Result<(), Error> {
    if !path.is_absolute() || path.components().any(|value| matches!(value,
        std::path::Component::CurDir | std::path::Component::ParentDir)) { return Err(Error::UnsafeStorage); }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if meta.is_dir() && !atomic_files::is_link_or_reparse_point(&meta) => {},
            Err(error) if error.kind() == io::ErrorKind::NotFound && ancestor == path => {},
            _ => return Err(Error::UnsafeStorage),
        }
    }
    Ok(())
}

pub(super) fn open_directory(path: &Path, owned: bool) -> Result<File, Error> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0200_0000 | 0x0020_0000).share_mode(0x1 | 0x2 | 0x4);
        if owned {
            options.access_mode(0x8000_0000 | 0x0001_0000).share_mode(0x1 | 0x2);
        }
    }
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        let _ = owned;
        #[cfg(target_os = "linux")] options.custom_flags(0x20_000);
        #[cfg(not(target_os = "linux"))] options.custom_flags(0x100);
    }
    let file = options.open(path).map_err(|_| if owned { Error::DeleteFailed } else { Error::UnsafeStorage })?;
    let meta = file.metadata().map_err(|_| Error::UnsafeStorage)?;
    if !meta.is_dir() || atomic_files::is_link_or_reparse_point(&meta) {
        return Err(Error::UnsafeStorage);
    }
    Ok(file)
}

pub(super) fn identity(path: &Path) -> Result<Identity, Error> {
    let file = open_directory(path, false)?;
    identity_of(&file)
}

pub(super) fn open_regular(path: &Path) -> Result<File, Error> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000).share_mode(0x1 | 0x2 | 0x4);
    }
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        #[cfg(target_os = "linux")] options.custom_flags(0x20_000);
        #[cfg(not(target_os = "linux"))] options.custom_flags(0x100);
    }
    let file = options.open(path).map_err(|_| Error::UnsafeStorage)?;
    let metadata = file.metadata().map_err(|_| Error::UnsafeStorage)?;
    if !metadata.is_file() || atomic_files::is_link_or_reparse_point(&metadata)
        || file_details(&file)?.1 != 1 { return Err(Error::UnsafeStorage); }
    Ok(file)
}

pub(super) fn optional_identity(path: &Path) -> Result<Option<Identity>, Error> {
    match fs::symlink_metadata(path) {
        Ok(_) => identity(path).map(Some),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(Error::UnsafeStorage),
    }
}

pub(super) fn check_identity(path: &Path, expected: Identity) -> Result<(), Error> {
    if identity(path)? != expected { return Err(Error::UnsafeStorage); }
    Ok(())
}

pub(super) fn pin_directory(path: &Path, expected: Identity) -> Result<File, Error> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0200_0000 | 0x0020_0000).share_mode(0x1 | 0x2);
    }
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        #[cfg(target_os = "linux")] options.custom_flags(0x20_000);
        #[cfg(not(target_os = "linux"))] options.custom_flags(0x100);
    }
    let file = options.open(path).map_err(|_| Error::UnsafeStorage)?;
    let metadata = file.metadata().map_err(|_| Error::UnsafeStorage)?;
    if !metadata.is_dir() || atomic_files::is_link_or_reparse_point(&metadata)
        || identity_of(&file)? != expected { return Err(Error::UnsafeStorage); }
    Ok(file)
}

pub(super) fn validate_tree(path: &Path) -> Result<(), Error> {
    fn visit(path: &Path, depth: usize, entries: &mut usize) -> Result<(), Error> {
        *entries += 1;
        if depth > 128 || *entries > 100_000 { return Err(Error::UnsafeStorage); }
        let meta = fs::symlink_metadata(path).map_err(|_| Error::UnsafeStorage)?;
        if atomic_files::is_link_or_reparse_point(&meta) { return Err(Error::UnsafeStorage); }
        if meta.is_file() { let _file = open_regular(path)?; return Ok(()); }
        if !meta.is_dir() { return Err(Error::UnsafeStorage); }
        let _handle = open_directory(path, false)?;
        for item in fs::read_dir(path).map_err(|_| Error::UnsafeStorage)? {
            visit(&item.map_err(|_| Error::UnsafeStorage)?.path(), depth + 1, entries)?;
        }
        Ok(())
    }
    visit(path, 0, &mut 0)
}

pub(super) fn stage_directory(source: &Path, target: &Path, expected: Identity) -> Result<(), Error> {
    if fs::symlink_metadata(target).is_ok() { return Err(Error::UnsafeStorage); }
    let handle = open_directory(source, true)?;
    if identity_of(&handle)? != expected { return Err(Error::UnsafeStorage); }
    #[cfg(windows)] rename_handle(&handle, target).map_err(|_| Error::DeleteFailed)?;
    #[cfg(not(windows))] fs::rename(source, target).map_err(|_| Error::DeleteFailed)?;
    drop(handle);
    Ok(())
}

pub(super) fn remove_staged(path: &Path, expected: Identity) -> Result<(), Error> {
    let handle = open_directory(path, true)?;
    if identity_of(&handle)? != expected { return Err(Error::UnsafeStorage); }
    validate_tree(path)?;
    #[cfg(windows)] {
        remove_windows_contents(path)?;
        mark_deleted(&handle).map_err(|_| Error::DeleteFailed)?;
        drop(handle);
    }
    #[cfg(not(windows))] {
        check_identity(path, expected)?;
        fs::remove_dir_all(path).map_err(|_| Error::DeleteFailed)?;
    }
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        _ => Err(Error::DeleteFailed),
    }
}

#[cfg(windows)]
fn remove_windows_contents(path: &Path) -> Result<(), Error> {
    use std::os::windows::fs::OpenOptionsExt;
    for item in fs::read_dir(path).map_err(|_| Error::DeleteFailed)? {
        let child = item.map_err(|_| Error::DeleteFailed)?.path();
        let metadata = fs::symlink_metadata(&child).map_err(|_| Error::DeleteFailed)?;
        if atomic_files::is_link_or_reparse_point(&metadata) { return Err(Error::UnsafeStorage); }
        if metadata.is_dir() {
            let expected = identity(&child)?;
            remove_staged(&child, expected)?;
        } else if metadata.is_file() {
            let file = OpenOptions::new().read(true).access_mode(0x8000_0000 | 0x0001_0000)
                .share_mode(0x1 | 0x2).custom_flags(0x0020_0000).open(&child)
                .map_err(|_| Error::DeleteFailed)?;
            let metadata = file.metadata().map_err(|_| Error::DeleteFailed)?;
            if !metadata.is_file() || atomic_files::is_link_or_reparse_point(&metadata) {
                return Err(Error::UnsafeStorage);
            }
            mark_deleted(&file).map_err(|_| Error::DeleteFailed)?;
        } else { return Err(Error::UnsafeStorage); }
    }
    Ok(())
}

#[cfg(windows)]
fn mark_deleted(file: &File) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    let disposition: u8 = 1;
    #[link(name = "kernel32")]
    extern "system" {
        fn SetFileInformationByHandle(handle: *mut core::ffi::c_void, class: u32,
            information: *const core::ffi::c_void, size: u32) -> i32;
    }
    let success = unsafe { SetFileInformationByHandle(file.as_raw_handle().cast(), 4,
        (&disposition as *const u8).cast(), 1) };
    if success == 0 { return Err(io::Error::last_os_error()); }
    Ok(())
}

#[cfg(windows)]
fn rename_handle(file: &File, target: &Path) -> io::Result<()> {
    use std::os::windows::{ffi::OsStrExt, io::AsRawHandle};
    #[repr(C)]
    struct RenameInformation { replace: u32, root: *mut core::ffi::c_void, length: u32, name: [u16; 1] }
    #[link(name = "kernel32")]
    extern "system" {
        fn SetFileInformationByHandle(handle: *mut core::ffi::c_void, class: u32,
            information: *const core::ffi::c_void, size: u32) -> i32;
    }
    let name: Vec<u16> = target.as_os_str().encode_wide().collect();
    let size = std::mem::size_of::<RenameInformation>() + name.len() * 2;
    let mut buffer = vec![0u64; size.div_ceil(8)];
    let information = buffer.as_mut_ptr().cast::<RenameInformation>();
    unsafe {
        (*information).replace = 0;
        (*information).root = std::ptr::null_mut();
        (*information).length = (name.len() * 2) as u32;
        std::ptr::copy_nonoverlapping(name.as_ptr(), (*information).name.as_mut_ptr(), name.len());
    }
    let success = unsafe { SetFileInformationByHandle(file.as_raw_handle().cast(), 3,
        information.cast(), size as u32) };
    if success == 0 { return Err(io::Error::last_os_error()); }
    Ok(())
}

#[cfg(windows)]
pub(super) fn identity_of(file: &File) -> Result<Identity, Error> {
    file_details(file).map(|value| value.0)
}

#[cfg(windows)]
fn file_details(file: &File) -> Result<(Identity, u64), Error> {
    use std::os::windows::io::AsRawHandle;
    #[repr(C)] struct FileTime { low: u32, high: u32 }
    #[repr(C)] struct Information {
        attributes: u32, creation: FileTime, access: FileTime, write: FileTime,
        volume: u32, size_high: u32, size_low: u32, links: u32, index_high: u32, index_low: u32,
    }
    #[link(name = "kernel32")]
    extern "system" { fn GetFileInformationByHandle(handle: *mut core::ffi::c_void,
        information: *mut Information) -> i32; }
    let mut information = std::mem::MaybeUninit::<Information>::uninit();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle().cast(), information.as_mut_ptr()) } == 0 {
        return Err(Error::UnsafeStorage);
    }
    let information = unsafe { information.assume_init() };
    Ok((Identity { volume: u64::from(information.volume),
        file: (u64::from(information.index_high) << 32) | u64::from(information.index_low) },
        u64::from(information.links)))
}

#[cfg(unix)]
pub(super) fn identity_of(file: &File) -> Result<Identity, Error> {
    file_details(file).map(|value| value.0)
}

#[cfg(unix)]
fn file_details(file: &File) -> Result<(Identity, u64), Error> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata().map_err(|_| Error::UnsafeStorage)?;
    Ok((Identity { volume: metadata.dev(), file: metadata.ino() }, metadata.nlink()))
}
