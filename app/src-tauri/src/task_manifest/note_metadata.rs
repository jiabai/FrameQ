use super::{NoteTitle, NoteTitleStatus};
use crate::atomic_files;
use serde::{Deserialize, Deserializer, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use unicode_general_category::{get_general_category, GeneralCategory};

const FILE_NAME: &str = "frameq-note-metadata.json";
const MAX_FILE_BYTES: u64 = 4_096;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub(crate) struct NoteMetadataView {
    pub(crate) pinned: bool,
    pub(crate) display_title: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NoteMetadataError {
    Invalid,
    ReadFailed,
    WriteFailed,
    UnsafeStorage,
    TitleInvalid,
}

impl NoteMetadataError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Invalid => "NOTE_METADATA_INVALID",
            Self::ReadFailed => "NOTE_METADATA_READ_FAILED",
            Self::WriteFailed => "NOTE_METADATA_WRITE_FAILED",
            Self::UnsafeStorage => "NOTE_UNSAFE_STORAGE",
            Self::TitleInvalid => "NOTE_TITLE_INVALID",
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NoteMetadataFile {
    schema_version: u8,
    task_id: String,
    pinned: bool,
    #[serde(deserialize_with = "required_nullable")]
    display_title: Option<String>,
}

fn required_nullable<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

fn valid_display_title(title: &str) -> bool {
    NoteTitle {
        text: Some(title.to_string()),
        status: NoteTitleStatus::Completed,
        output_language: "en-US".to_string(),
        error_code: None,
    }
    .is_valid()
}

pub(super) fn normalize_display_title(title: &str) -> Result<String, NoteMetadataError> {
    if title.chars().any(|character| {
        matches!(
            get_general_category(character),
            GeneralCategory::Control
                | GeneralCategory::Format
                | GeneralCategory::LineSeparator
                | GeneralCategory::ParagraphSeparator
        )
    }) {
        return Err(NoteMetadataError::TitleInvalid);
    }
    let title = title.trim();
    if !valid_display_title(title) {
        return Err(NoteMetadataError::TitleInvalid);
    }
    Ok(title.to_string())
}

pub(super) fn load(
    task_dir: &Path,
    task_id: &str,
) -> Result<NoteMetadataView, NoteMetadataError> {
    let directories = BoundDirectories::open(task_dir)?;
    let result = read_file(task_dir, task_id)?;
    directories.verify()?;
    Ok(result)
}

pub(super) fn update(
    task_dir: &Path,
    task_id: &str,
    verify_owner: impl FnOnce() -> Result<(), NoteMetadataError>,
    change: impl FnOnce(&mut NoteMetadataView),
) -> Result<NoteMetadataView, NoteMetadataError> {
    let directories = BoundDirectories::open(task_dir)?;
    verify_owner()?;
    let mut current = read_file(task_dir, task_id)?;
    change(&mut current);
    if current
        .display_title
        .as_ref()
        .is_some_and(|title| !valid_display_title(title))
    {
        return Err(NoteMetadataError::TitleInvalid);
    }
    let payload = NoteMetadataFile {
        schema_version: 1,
        task_id: task_id.to_string(),
        pinned: current.pinned,
        display_title: current.display_title.clone(),
    };
    let mut bytes =
        serde_json::to_vec_pretty(&payload).map_err(|_| NoteMetadataError::WriteFailed)?;
    bytes.push(b'\n');
    directories.verify()?;
    validate_file_if_present(&task_dir.join(FILE_NAME))?;
    atomic_files::atomic_write(&task_dir.join(FILE_NAME), &bytes)
        .map_err(|_| NoteMetadataError::WriteFailed)?;
    directories.verify()?;
    Ok(current)
}

fn read_file(task_dir: &Path, task_id: &str) -> Result<NoteMetadataView, NoteMetadataError> {
    let path = task_dir.join(FILE_NAME);
    if !validate_file_if_present(&path)? {
        return Ok(NoteMetadataView::default());
    }
    let file = open_no_follow(&path, false).map_err(|_| NoteMetadataError::ReadFailed)?;
    let metadata = file.metadata().map_err(|_| NoteMetadataError::ReadFailed)?;
    if !metadata.is_file()
        || atomic_files::is_link_or_reparse_point(&metadata)
        || link_count(&file)? != 1
    {
        return Err(NoteMetadataError::UnsafeStorage);
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(NoteMetadataError::Invalid);
    }
    let identity = file_identity(&file)?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| NoteMetadataError::ReadFailed)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(NoteMetadataError::Invalid);
    }
    let current = open_no_follow(&path, false).map_err(|_| NoteMetadataError::ReadFailed)?;
    if file_identity(&current)? != identity || link_count(&current)? != 1 {
        return Err(NoteMetadataError::UnsafeStorage);
    }
    let stored: NoteMetadataFile =
        serde_json::from_slice(&bytes).map_err(|_| NoteMetadataError::Invalid)?;
    if stored.schema_version != 1
        || stored.task_id != task_id
        || stored
            .display_title
            .as_ref()
            .is_some_and(|title| !valid_display_title(title))
    {
        return Err(NoteMetadataError::Invalid);
    }
    Ok(NoteMetadataView {
        pinned: stored.pinned,
        display_title: stored.display_title,
    })
}

fn validate_file_if_present(path: &Path) -> Result<bool, NoteMetadataError> {
    match fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.is_file() && !atomic_files::is_link_or_reparse_point(&metadata) =>
        {
            let file =
                open_no_follow(path, false).map_err(|_| NoteMetadataError::ReadFailed)?;
            if link_count(&file)? != 1 {
                return Err(NoteMetadataError::UnsafeStorage);
            }
            Ok(true)
        }
        Ok(_) => Err(NoteMetadataError::UnsafeStorage),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(NoteMetadataError::ReadFailed),
    }
}

struct BoundDirectories(Vec<(PathBuf, File)>);

impl BoundDirectories {
    fn open(task_dir: &Path) -> Result<Self, NoteMetadataError> {
        if !task_dir.is_absolute() {
            return Err(NoteMetadataError::UnsafeStorage);
        }
        let mut directories = Vec::new();
        for path in task_dir.ancestors() {
            let metadata =
                fs::symlink_metadata(path).map_err(|_| NoteMetadataError::UnsafeStorage)?;
            if !metadata.is_dir() || atomic_files::is_link_or_reparse_point(&metadata) {
                return Err(NoteMetadataError::UnsafeStorage);
            }
            let handle =
                open_no_follow(path, true).map_err(|_| NoteMetadataError::UnsafeStorage)?;
            if !handle.metadata().is_ok_and(|metadata| {
                metadata.is_dir() && !atomic_files::is_link_or_reparse_point(&metadata)
            }) {
                return Err(NoteMetadataError::UnsafeStorage);
            }
            directories.push((path.to_path_buf(), handle));
        }
        let result = Self(directories);
        result.verify()?;
        Ok(result)
    }

    fn verify(&self) -> Result<(), NoteMetadataError> {
        for (path, handle) in &self.0 {
            let current =
                open_no_follow(path, true).map_err(|_| NoteMetadataError::UnsafeStorage)?;
            if !current.metadata().is_ok_and(|metadata| {
                metadata.is_dir() && !atomic_files::is_link_or_reparse_point(&metadata)
            }) || file_identity(&current)? != file_identity(handle)?
            {
                return Err(NoteMetadataError::UnsafeStorage);
            }
        }
        Ok(())
    }
}

fn open_no_follow(path: &Path, directory: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        options.custom_flags(
            FILE_FLAG_OPEN_REPARSE_POINT
                | if directory {
                    FILE_FLAG_BACKUP_SEMANTICS
                } else {
                    0
                },
        );
        if directory {
            options.share_mode(0x0000_0001 | 0x0000_0002);
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        #[cfg(target_os = "linux")]
        const O_NOFOLLOW: i32 = 0x20_000;
        #[cfg(not(target_os = "linux"))]
        const O_NOFOLLOW: i32 = 0x100;
        let _ = directory;
        options.custom_flags(O_NOFOLLOW);
    }
    options.open(path)
}

#[cfg(windows)]
fn file_information(file: &File) -> Result<(u64, u64, u64), NoteMetadataError> {
    use std::os::windows::io::AsRawHandle;
    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    struct FileInformation {
        attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(
            file: *mut core::ffi::c_void,
            information: *mut FileInformation,
        ) -> i32;
    }
    let mut information = std::mem::MaybeUninit::<FileInformation>::uninit();
    if unsafe {
        GetFileInformationByHandle(file.as_raw_handle().cast(), information.as_mut_ptr())
    } == 0 {
        return Err(NoteMetadataError::UnsafeStorage);
    }
    let information = unsafe { information.assume_init() };
    Ok((
        u64::from(information.volume_serial_number),
        (u64::from(information.file_index_high) << 32) | u64::from(information.file_index_low),
        u64::from(information.number_of_links),
    ))
}

fn file_identity(file: &File) -> Result<(u64, u64), NoteMetadataError> {
    #[cfg(windows)]
    {
        let (volume, index, _) = file_information(file)?;
        Ok((volume, index))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata().map_err(|_| NoteMetadataError::UnsafeStorage)?;
        Ok((metadata.dev(), metadata.ino()))
    }
}

fn link_count(file: &File) -> Result<u64, NoteMetadataError> {
    #[cfg(windows)]
    {
        file_information(file).map(|(_, _, links)| links)
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        file.metadata()
            .map(|metadata| metadata.nlink())
            .map_err(|_| NoteMetadataError::UnsafeStorage)
    }
}

#[cfg(test)]
#[path = "note_metadata_tests.rs"]
mod tests;
