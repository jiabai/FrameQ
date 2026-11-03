use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Component, Path};
use sha2::{Digest, Sha256};
#[cfg(unix)] #[path="safe_filesystem_unix.rs"] mod unix;

pub(crate) struct PinnedDirectory {file:File,path:std::path::PathBuf,identity:DirectoryIdentity,#[cfg(windows)] _ancestors:Vec<File>}
impl PinnedDirectory {
    pub(crate) fn check(&self)->io::Result<()> {if file_identity(&self.file)?!=self.identity{return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));}check_identity(&self.path,self.identity)}
    pub(crate) fn set_permissions(&self,permissions:fs::Permissions)->io::Result<()> {
        self.check()?;
        #[cfg(unix)] {self.file.set_permissions(permissions)}
        #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;let file=OpenOptions::new().read(true).access_mode(0x80|0x100).share_mode(0x1|0x2).custom_flags(0x0200_0000|0x0020_0000).open(&self.path)?;if file_identity(&file)?!=self.identity{return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));}file.set_permissions(permissions)}
    }
    pub(crate) fn create_new(&self,name:&std::ffi::OsStr)->io::Result<File> {
        self.check()?;
        #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;OpenOptions::new().read(true).write(true).create_new(true).access_mode(0x8000_0000|0x4000_0000|0x0001_0000).share_mode(0x1).custom_flags(0x0020_0000).open(self.path.join(name))}
        #[cfg(unix)] {unix::create_new(&self.file,name)}
    }
    pub(crate) fn create_dir(&self,name:&std::ffi::OsStr)->io::Result<()> {
        self.check()?;
        #[cfg(windows)] {fs::create_dir(self.path.join(name))}
        #[cfg(unix)] {unix::create_dir(&self.file,name)}
    }
}
pub(crate) fn rename_no_replace(source:&Path,target:&Path)->io::Result<()> {
    let source_parent=pin_directory(source.parent().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;let target_parent=pin_directory(target.parent().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;
    #[cfg(windows)] let file={use std::os::windows::fs::OpenOptionsExt;OpenOptions::new().read(true).access_mode(0x8000_0000|0x0001_0000).share_mode(0x1|0x2).custom_flags(0x0200_0000|0x0020_0000).open(source)?};
    #[cfg(unix)] let file={if fs::symlink_metadata(source)?.is_dir(){open_directory(source)?}else{open_regular(source)?}};
    if crate::atomic_files::is_link_or_reparse_point(&file.metadata()?){return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));}
    install_owned_file(&file,&source_parent,source.file_name().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?,&target_parent,target.file_name().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)
}
pub(crate) fn pin_directory(path:&Path)->io::Result<PinnedDirectory> {
    #[cfg(windows)] {let mut ancestors=Vec::new();for parent in path.ancestors().collect::<Vec<_>>().into_iter().rev(){ancestors.push(open_directory(parent)?);}let file=ancestors.last().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?.try_clone()?;let identity=file_identity(&file)?;Ok(PinnedDirectory{file,path:path.into(),identity,_ancestors:ancestors})}
    #[cfg(unix)] {let file=unix::open_directory(path)?;let identity=file_identity(&file)?;Ok(PinnedDirectory{file,path:path.into(),identity})}
}
pub(crate) fn install_owned_file(file:&File,source:&PinnedDirectory,source_name:&std::ffi::OsStr,target:&PinnedDirectory,target_name:&std::ffi::OsStr)->io::Result<()> {
    source.check()?;target.check()?;
    #[cfg(windows)] {
        use std::os::windows::{ffi::OsStrExt,io::AsRawHandle};
        #[repr(C)] struct RenameInfo {replace:u32,root:*mut core::ffi::c_void,length:u32,name:[u16;1]}
        #[link(name="kernel32")] extern "system" {fn SetFileInformationByHandle(handle:*mut core::ffi::c_void,class:u32,information:*const core::ffi::c_void,size:u32)->i32;}
        let name:Vec<u16>=target.path.join(target_name).as_os_str().encode_wide().collect();let size=std::mem::offset_of!(RenameInfo,name)+(name.len()+1)*2;let mut storage=vec![0u64;size.div_ceil(8)];let info=storage.as_mut_ptr().cast::<RenameInfo>();
        unsafe {(*info).replace=0;(*info).root=std::ptr::null_mut();(*info).length=(name.len()*2)as u32;std::ptr::copy_nonoverlapping(name.as_ptr(),std::ptr::addr_of_mut!((*info).name).cast::<u16>(),name.len());if SetFileInformationByHandle(file.as_raw_handle().cast(),3,info.cast(),size as u32)==0{return Err(io::Error::last_os_error());}}
        let _=source_name;Ok(())
    }
    #[cfg(unix)] {let _=file;unix::install(&source.file,source_name,&target.file,target_name)}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DirectoryIdentity { pub volume: u64, pub file: u64 }
pub(crate) fn entry_exists(path:&Path)->io::Result<bool> {
    match fs::symlink_metadata(path){Ok(_)=>Ok(true),Err(e) if e.kind()==io::ErrorKind::NotFound=>Ok(false),Err(e)=>Err(e)}
}

pub(crate) fn validate_ancestors(path: &Path) -> io::Result<()> {
    if !path.is_absolute() || path.components().any(|v| matches!(v, Component::CurDir | Component::ParentDir)) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "UnsafePath"));
    }
    for ancestor in path.ancestors() {
        let meta = fs::symlink_metadata(ancestor)?;
        if !meta.is_dir() || crate::atomic_files::is_link_or_reparse_point(&meta) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "UnsafePath"));
        }
    }
    Ok(())
}

pub(crate) fn open_directory(path: &Path) -> io::Result<File> {
    #[cfg(unix)] {return unix::open_directory(path);}
    #[cfg(windows)] {
    validate_ancestors(path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0200_0000 | 0x0020_0000).share_mode(0x1 | 0x2);
    }
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        #[cfg(target_os="linux")] options.custom_flags(0x20_000);
        #[cfg(not(target_os="linux"))] options.custom_flags(0x100);
    }
    let file = options.open(path)?;
    let meta = file.metadata()?;
    if !meta.is_dir() || crate::atomic_files::is_link_or_reparse_point(&meta) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));
    }
    Ok(file)
    }
}

pub(crate) fn open_regular(path: &Path) -> io::Result<File> {
    #[cfg(unix)] {let file=unix::open_regular(path)?;let meta=file.metadata()?;if !meta.is_file()||details(&file)?.1!=1{return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));}return Ok(file);}
    #[cfg(windows)] {
    validate_ancestors(path.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file() || crate::atomic_files::is_link_or_reparse_point(&meta) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000).share_mode(0x1);
    }
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        #[cfg(target_os="linux")] options.custom_flags(0x20_000);
        #[cfg(not(target_os="linux"))] options.custom_flags(0x100);
    }
    let file = options.open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() || crate::atomic_files::is_link_or_reparse_point(&meta) || details(&file)?.1 != 1 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));
    }
    Ok(file)
    }
}
pub(crate) fn open_control_snapshot(path:&Path)->io::Result<File> {
    #[cfg(unix)] {open_regular(path)}
    #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;validate_ancestors(path.parent().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;let file=OpenOptions::new().read(true).custom_flags(0x0020_0000).share_mode(0x1|0x4).open(path)?;let meta=file.metadata()?;if !meta.is_file()||crate::atomic_files::is_link_or_reparse_point(&meta)||details(&file)?.1!=1{return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));}Ok(file)}
}

pub(crate) fn open_lock_file(path:&Path)->io::Result<File> {
    #[cfg(unix)] {let file=unix::open_lock(path)?;if !file.metadata()?.is_file()||details(&file)?.1!=1{return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));}return Ok(file);}
    #[cfg(windows)] {
    validate_ancestors(path.parent().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;
    let mut options=OpenOptions::new();options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;options.custom_flags(0x0020_0000).share_mode(0x1|0x2);}
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;#[cfg(target_os="linux")] options.custom_flags(0x20_000);#[cfg(not(target_os="linux"))] options.custom_flags(0x100);}
    let file=options.open(path)?;let metadata=file.metadata()?;
    if !metadata.is_file()||crate::atomic_files::is_link_or_reparse_point(&metadata)||details(&file)?.1!=1{return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));}
    Ok(file)
    }
}
pub(crate) fn open_owned_writer(path:&Path,identity:DirectoryIdentity)->io::Result<File> {
    #[cfg(unix)] {let file=unix::open_writer(path)?;if details(&file)?.1!=1||file_identity(&file)?!=identity||!file.metadata()?.is_file(){return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));}return Ok(file);}
    #[cfg(windows)] {
    validate_ancestors(path.parent().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;
    let mut options=OpenOptions::new();options.write(true).read(true);
    #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;options.custom_flags(0x0020_0000).share_mode(0x1).access_mode(0x8000_0000|0x4000_0000|0x0001_0000);}
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;#[cfg(target_os="linux")] options.custom_flags(0x20_000);#[cfg(not(target_os="linux"))] options.custom_flags(0x100);}
    let file=options.open(path)?;let metadata=file.metadata()?;
    if !metadata.is_file()||crate::atomic_files::is_link_or_reparse_point(&metadata)||details(&file)?.1!=1||file_identity(&file)?!=identity{return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));}Ok(file)
    }
}

pub(crate) fn identity(path: &Path) -> io::Result<DirectoryIdentity> {
    details(&open_directory(path)?).map(|v| v.0)
}
pub(crate) fn file_identity(file: &File) -> io::Result<DirectoryIdentity> { details(file).map(|v| v.0) }
pub(crate) fn check_identity(path: &Path, expected: DirectoryIdentity) -> io::Result<()> {
    if identity(path)? != expected { return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath")); }
    Ok(())
}
pub(crate) fn remove_matching_file(path:&Path,expected:DirectoryIdentity,length:u64,sha256:&str)->io::Result<bool> {
    let parent=path.parent().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?;
    let parent_guard=pin_directory(parent)?;
    let mut options=OpenOptions::new();options.read(true);
    #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;options.access_mode(0x8000_0000|0x0001_0000).share_mode(0x1).custom_flags(0x0020_0000);}
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;#[cfg(target_os="linux")] options.custom_flags(0x20_000);#[cfg(not(target_os="linux"))] options.custom_flags(0x100);}
    let mut file=options.open(path)?;let meta=file.metadata()?;
    if !meta.is_file()||crate::atomic_files::is_link_or_reparse_point(&meta)||file_identity(&file)?!=expected||details(&file)?.1!=1{return Ok(false);}
    let mut hash=Sha256::new();let mut buffer=vec![0u8;1024*1024];let mut size=0u64;
    loop {let count=file.read(&mut buffer)?;if count==0{break;}hash.update(&buffer[..count]);size+=count as u64;}
    if size!=length||format!("{:x}",hash.finalize())!=sha256{return Ok(false);}
    #[cfg(windows)] {
        use std::os::windows::io::AsRawHandle;
        #[link(name="kernel32")] extern "system" {fn SetFileInformationByHandle(handle:*mut core::ffi::c_void,class:u32,information:*const core::ffi::c_void,size:u32)->i32;}
        let disposition:u8=1;
        if unsafe {SetFileInformationByHandle(file.as_raw_handle().cast(),4,(&disposition as *const u8).cast(),1)}==0{return Err(io::Error::last_os_error());}
    }
    #[cfg(unix)] {
        let current=open_regular(path)?;if file_identity(&current)?!=expected{return Ok(false);}drop(current);parent_guard.check()?;unix::remove_file(&parent_guard.file,path.file_name().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;
    }
    #[cfg(windows)] let _=parent_guard;
    Ok(true)
}
pub(crate) fn remove_file_by_identity(path:&Path,expected:DirectoryIdentity)->io::Result<bool> {
    let parent=pin_directory(path.parent().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;
    #[cfg(windows)] {
        use std::os::windows::{fs::OpenOptionsExt,io::AsRawHandle};
        let file=OpenOptions::new().read(true).access_mode(0x8000_0000|0x0001_0000|0x100).share_mode(0x1).custom_flags(0x0020_0000).open(path)?;
        let meta=file.metadata()?;
        if !meta.is_file()||crate::atomic_files::is_link_or_reparse_point(&meta)||details(&file)?.1!=1||file_identity(&file)?!=expected{return Ok(false);}
        if meta.permissions().readonly(){let mut permissions=meta.permissions();permissions.set_readonly(false);file.set_permissions(permissions)?;}
        #[link(name="kernel32")] extern "system" {fn SetFileInformationByHandle(handle:*mut core::ffi::c_void,class:u32,information:*const core::ffi::c_void,size:u32)->i32;}
        let disposition:u8=1;parent.check()?;
        if unsafe{SetFileInformationByHandle(file.as_raw_handle().cast(),4,(&disposition as *const u8).cast(),1)}==0{return Err(io::Error::last_os_error());}
    }
    #[cfg(unix)] {
        let file=open_regular(path)?;if file_identity(&file)?!=expected{return Ok(false);}
        let current=open_regular(path)?;if file_identity(&current)?!=expected{return Ok(false);}drop(current);
        parent.check()?;unix::remove_file(&parent.file,path.file_name().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;
    }
    Ok(true)
}
pub(crate) fn hash_file(path: &Path) -> io::Result<(u64, String, DirectoryIdentity)> {
    hash_file_while(path,||true)
}
pub(crate) fn hash_file_while(path:&Path,mut keep_going:impl FnMut()->bool)->io::Result<(u64,String,DirectoryIdentity)> {
    let mut file = open_regular(path)?;
    hash_open_file_while(&mut file,&mut keep_going)
}
pub(crate) fn hash_file_with_progress(path:&Path,keep_going:impl FnMut()->bool,progress:impl FnMut(u64)->io::Result<()>)->io::Result<(u64,String,DirectoryIdentity)> {
    let mut file=open_regular(path)?;hash_open_file_with_progress(&mut file,keep_going,progress)
}
pub(crate) fn hash_open_file_while(file:&mut File,mut keep_going:impl FnMut()->bool)->io::Result<(u64,String,DirectoryIdentity)> {
    hash_open_file_with_progress(file,&mut keep_going,|_|Ok(()))
}
fn hash_open_file_with_progress(file:&mut File,mut keep_going:impl FnMut()->bool,mut progress:impl FnMut(u64)->io::Result<()>)->io::Result<(u64,String,DirectoryIdentity)> {
    use std::io::{Seek,SeekFrom};file.seek(SeekFrom::Start(0))?;
    let before = file.metadata()?;
    let id = file_identity(file)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut length = 0u64;
    loop {
        if !keep_going(){return Err(io::Error::new(io::ErrorKind::Interrupted,"Cancelled"));}
        let count = file.read(&mut buffer)?;
        if count == 0 { break; }
        hash.update(&buffer[..count]); length += count as u64;progress(length)?;
    }
    let after = file.metadata()?;
    if before.len()!=after.len() || before.modified()?!=after.modified()? || length!=before.len() || file_identity(file)?!=id {
        return Err(io::Error::new(io::ErrorKind::InvalidData,"SourceChanged"));
    }
    Ok((length,format!("{:x}",hash.finalize()),id))
}

#[cfg(windows)]
fn details(file: &File) -> io::Result<(DirectoryIdentity,u64)> {
    use std::os::windows::io::AsRawHandle;
    #[repr(C)] struct FileTime { low:u32, high:u32 }
    #[repr(C)] struct Information { attributes:u32,creation:FileTime,access:FileTime,write:FileTime,
        volume:u32,size_high:u32,size_low:u32,links:u32,index_high:u32,index_low:u32 }
    #[link(name="kernel32")] extern "system" { fn GetFileInformationByHandle(handle:*mut core::ffi::c_void,information:*mut Information)->i32; }
    let mut information=std::mem::MaybeUninit::<Information>::uninit();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle().cast(),information.as_mut_ptr()) }==0 { return Err(io::Error::last_os_error()); }
    let value=unsafe { information.assume_init() };
    Ok((DirectoryIdentity{volume:u64::from(value.volume),file:(u64::from(value.index_high)<<32)|u64::from(value.index_low)},u64::from(value.links)))
}
#[cfg(unix)]
fn details(file:&File)->io::Result<(DirectoryIdentity,u64)> {
    use std::os::unix::fs::MetadataExt;
    let meta=file.metadata()?;
    Ok((DirectoryIdentity{volume:meta.dev(),file:meta.ino()},meta.nlink()))
}
