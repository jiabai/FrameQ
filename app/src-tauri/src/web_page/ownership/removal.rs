use crate::safe_filesystem::{self as safe, DirectoryIdentity};
use std::{io, path::Path, time::Instant};

fn unsafe_path() -> io::Error { io::Error::new(io::ErrorKind::InvalidInput, "UnsafePath") }

#[cfg(any(windows, target_os = "macos"))]
fn is_owner(name: &std::ffi::OsStr) -> bool {
    name.as_encoded_bytes().eq_ignore_ascii_case(super::OWNER.as_bytes())
}

#[cfg(any(windows, target_os = "macos"))]
fn native_control(name: &std::ffi::OsStr) -> bool {
    is_owner(name) || name == "processes.json" || name == "save-receipt.json"
}

pub(super) fn remove_tree(path: &Path, expected: DirectoryIdentity) -> io::Result<()> {
    platform::Tree::open(path, expected)?.remove()
}

pub(super) fn remove_tree_before(path: &Path, expected: DirectoryIdentity, deadline: Instant) -> io::Result<()> {
    check_deadline(Some(deadline))?;
    platform::Tree::open(path, expected)?.remove_before(deadline)
}

fn check_deadline(deadline: Option<Instant>) -> io::Result<()> {
    if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
        return Err(io::Error::new(io::ErrorKind::TimedOut, "Web cleanup deadline expired"));
    }
    Ok(())
}

const MAX_ENTRIES: usize = 100_000;
const MAX_DEPTH: usize = 128;

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{fs::{self, File}, os::windows::{ffi::OsStrExt, fs::MetadataExt, io::{AsRawHandle, FromRawHandle}}, path::PathBuf};
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, SetFileInformationByHandle, FileDispositionInfoEx,
        DELETE, FILE_READ_ATTRIBUTES, FILE_LIST_DIRECTORY, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_DISPOSITION_INFO_EX,
        FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
    };

    pub(super) struct Tree { root: File, path: PathBuf, _parent: safe::PinnedDirectory }

    fn open_entry(path: &Path) -> io::Result<File> {
        let name = path.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
        let handle = unsafe { CreateFileW(name.as_ptr(), DELETE | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE, std::ptr::null(), OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, std::ptr::null_mut()) };
        if handle == INVALID_HANDLE_VALUE { return Err(io::Error::last_os_error()); }
        Ok(unsafe { File::from_raw_handle(handle.cast()) })
    }

    impl Tree {
        pub(super) fn open(path: &Path, expected: DirectoryIdentity) -> io::Result<Self> {
            let parent = safe::pin_directory(path.parent().ok_or_else(unsafe_path)?)?;
            let root = open_entry(path)?;
            let metadata = root.metadata()?;
            if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
                || safe::file_identity(&root)? != expected { return Err(unsafe_path()); }
            Ok(Self { root, path: path.into(), _parent: parent })
        }
        pub(super) fn remove(self) -> io::Result<()> {
            remove_entry(self.root, &self.path, &mut 0, 0, None, false)
        }
        pub(super) fn remove_before(self, deadline: Instant) -> io::Result<()> {
            remove_entry(self.root, &self.path, &mut 0, 0, Some(deadline), false)
        }
    }

    fn remove_entry(file: File, path: &Path, count: &mut usize, depth: usize, deadline: Option<Instant>, keep_directory: bool) -> io::Result<()> {
        check_deadline(deadline)?;
        *count += 1;
        if *count > MAX_ENTRIES || depth > MAX_DEPTH { return Err(unsafe_path()); }
        let metadata = file.metadata()?;
        let mut retained = Vec::new();
        let mut owner_present = false;
        if metadata.is_dir() && metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
            // 此句柄禁止目录重命名；每个子项也在递归期间保持同样的删除权限句柄。
            let mut entries = Vec::new();
            for entry in fs::read_dir(path)? {
                check_deadline(deadline)?;
                entries.push(entry?);
                if entries.len() > MAX_ENTRIES - *count { return Err(unsafe_path()); }
            }
            entries.sort_by_key(|entry| depth == 0 && is_owner(&entry.file_name()));
            for entry in entries {
                check_deadline(deadline)?;
                let child = path.join(entry.file_name());
                let file = open_entry(&child)?;
                if depth == 0 && deadline.is_some()
                    && (native_control(&entry.file_name()) || entry.file_name() == "profile") {
                    let metadata = file.metadata()?;
                    if native_control(&entry.file_name()) && (!metadata.is_file()
                        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0) {
                        return Err(unsafe_path());
                    }
                    if is_owner(&entry.file_name()) {
                        if owner_present || !metadata.is_file()
                            || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                            return Err(unsafe_path());
                        }
                        owner_present = true;
                    }
                    if metadata.is_dir() && metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
                        remove_entry(file.try_clone()?, &child, count, depth + 1, deadline, true)?;
                    } else {
                        *count += 1;
                        if *count > MAX_ENTRIES { return Err(unsafe_path()); }
                    }
                    retained.push(file);
                } else {
                    remove_entry(file, &child, count, depth + 1, deadline, false)?;
                }
            }
        }
        check_deadline(deadline)?;
        if keep_directory { return Ok(()); }
        if depth == 0 && deadline.is_some() {
            if !owner_present { return Err(unsafe_path()); }
            // 控制文件与第一层目录身份保留到最终提交，收据最后删除。
            for entry in retained { mark_removed(&entry)?; }
        }
        mark_removed(&file)
    }

    fn mark_removed(file: &File) -> io::Result<()> {
        let disposition = FILE_DISPOSITION_INFO_EX {
            Flags: FILE_DISPOSITION_FLAG_DELETE | FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
        };
        if unsafe { SetFileInformationByHandle(file.as_raw_handle().cast(), FileDispositionInfoEx,
            (&disposition as *const FILE_DISPOSITION_INFO_EX).cast(), std::mem::size_of_val(&disposition) as u32) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    #[cfg(test)]
    #[path = "removal_windows_tests.rs"]
    mod tests;
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::{ffi::{CStr, CString}, fs::File, os::{fd::{AsRawFd, FromRawFd}, unix::ffi::OsStrExt}};

    pub(super) struct Tree { root: File, parent: File, name: CString, expected: DirectoryIdentity }
    struct RetainedEntry { name: CString, identity: DirectoryIdentity, directory: bool }

    fn stat_at(parent: &File, name: &CStr) -> io::Result<libc::stat> {
        let mut value = std::mem::MaybeUninit::<libc::stat>::zeroed();
        if unsafe { libc::fstatat(parent.as_raw_fd(), name.as_ptr(), value.as_mut_ptr(), libc::AT_SYMLINK_NOFOLLOW) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(unsafe { value.assume_init() })
    }

    fn open_dir(parent: &File, name: &CStr) -> io::Result<File> {
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
        if fd < 0 { return Err(io::Error::last_os_error()); }
        Ok(unsafe { File::from_raw_fd(fd) })
    }

    fn identity(value: &libc::stat) -> DirectoryIdentity {
        DirectoryIdentity { volume: value.st_dev as u64, file: value.st_ino }
    }

    impl Tree {
        pub(super) fn open(path: &Path, expected: DirectoryIdentity) -> io::Result<Self> {
            let parent = safe::open_directory(path.parent().ok_or_else(unsafe_path)?)?;
            let name = CString::new(path.file_name().ok_or_else(unsafe_path)?.as_bytes()).map_err(|_| unsafe_path())?;
            let root = open_dir(&parent, &name)?;
            if safe::file_identity(&root)? != expected { return Err(unsafe_path()); }
            Ok(Self { root, parent, name, expected })
        }
        pub(super) fn remove(self) -> io::Result<()> {
            self.remove_with(None)
        }
        pub(super) fn remove_before(self, deadline: Instant) -> io::Result<()> {
            self.remove_with(Some(deadline))
        }
        fn remove_with(self, deadline: Option<Instant>) -> io::Result<()> {
            let retained = remove_contents(&self.root, self.expected.volume, &mut 0, 0, deadline)?;
            check_deadline(deadline)?;
            // unlinkat 只移除空目录；名称被替换后保留替换目录及其中全部内容。
            if identity(&stat_at(&self.parent, &self.name)?) != self.expected { return Err(unsafe_path()); }
            if deadline.is_some() {
                if !retained.iter().any(|entry| is_owner(std::ffi::OsStr::from_bytes(entry.name.to_bytes()))) {
                    return Err(unsafe_path());
                }
                for entry in &retained {
                    check_deadline(deadline)?;
                    if identity(&stat_at(&self.root, &entry.name)?) != entry.identity { return Err(unsafe_path()); }
                }
                check_deadline(deadline)?;
                // 控制文件与第一层目录身份保留到最终提交，收据最后删除。
                for entry in retained {
                    let flags = if entry.directory { libc::AT_REMOVEDIR } else { 0 };
                    if unsafe { libc::unlinkat(self.root.as_raw_fd(), entry.name.as_ptr(), flags) } != 0 {
                        return Err(io::Error::last_os_error());
                    }
                }
            }
            if unsafe { libc::unlinkat(self.parent.as_raw_fd(), self.name.as_ptr(), libc::AT_REMOVEDIR) } != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
    }

    struct Entries(*mut libc::DIR);
    impl Drop for Entries { fn drop(&mut self) { unsafe { libc::closedir(self.0); } } }

    fn remove_contents(directory: &File, volume: u64, count: &mut usize, depth: usize, deadline: Option<Instant>) -> io::Result<Vec<RetainedEntry>> {
        check_deadline(deadline)?;
        if depth > MAX_DEPTH { return Err(unsafe_path()); }
        let fd = unsafe { libc::dup(directory.as_raw_fd()) };
        if fd < 0 { return Err(io::Error::last_os_error()); }
        let pointer = unsafe { libc::fdopendir(fd) };
        if pointer.is_null() { unsafe { libc::close(fd); } return Err(io::Error::last_os_error()); }
        let entries = Entries(pointer);
        let mut names = Vec::new();
        loop {
            check_deadline(deadline)?;
            unsafe { *libc::__error() = 0; }
            let entry = unsafe { libc::readdir(entries.0) };
            if entry.is_null() {
                if unsafe { *libc::__error() } != 0 { return Err(io::Error::last_os_error()); }
                break;
            }
            let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
            if matches!(name.to_bytes(), b"." | b"..") { continue; }
            names.push(name.to_owned());
            if names.len() > MAX_ENTRIES - *count { return Err(unsafe_path()); }
        }
        names.sort_by_key(|name| depth == 0 && is_owner(std::ffi::OsStr::from_bytes(name.to_bytes())));
        let mut retained = Vec::new();
        let mut owner_present = false;
        for name in names {
            check_deadline(deadline)?;
            *count += 1;
            if *count > MAX_ENTRIES { return Err(unsafe_path()); }
            let before = stat_at(directory, &name)?;
            if before.st_dev as u64 != volume { return Err(unsafe_path()); }
            if depth == 0 && deadline.is_some() && is_owner(std::ffi::OsStr::from_bytes(name.to_bytes())) {
                if owner_present || before.st_mode & libc::S_IFMT != libc::S_IFREG { return Err(unsafe_path()); }
                owner_present = true;
            }
            let is_directory = before.st_mode & libc::S_IFMT == libc::S_IFDIR;
            if is_directory {
                let child = open_dir(directory, &name)?;
                if safe::file_identity(&child)? != identity(&before) { return Err(unsafe_path()); }
                remove_contents(&child, volume, count, depth + 1, deadline)?;
                if identity(&stat_at(directory, &name)?) != identity(&before) { return Err(unsafe_path()); }
            }
            if depth == 0 && deadline.is_some()
                && (native_control(std::ffi::OsStr::from_bytes(name.to_bytes())) || name.to_bytes() == b"profile") {
                if native_control(std::ffi::OsStr::from_bytes(name.to_bytes()))
                    && before.st_mode & libc::S_IFMT != libc::S_IFREG { return Err(unsafe_path()); }
                retained.push(RetainedEntry { name, identity: identity(&before), directory: is_directory });
                continue;
            }
            check_deadline(deadline)?;
            let flag = if is_directory { libc::AT_REMOVEDIR } else { 0 };
            if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), flag) } != 0 { return Err(io::Error::last_os_error()); }
        }
        Ok(retained)
    }

    #[cfg(test)]
    #[path = "removal_macos_tests.rs"]
    mod tests;
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::*;
    pub(super) struct Tree;
    impl Tree {
        pub(super) fn open(_: &Path, _: DirectoryIdentity) -> io::Result<Self> { Err(unsafe_path()) }
        pub(super) fn remove(self) -> io::Result<()> { Err(unsafe_path()) }
        pub(super) fn remove_before(self, _: Instant) -> io::Result<()> { Err(unsafe_path()) }
    }
}
