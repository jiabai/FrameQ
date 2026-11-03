use std::{ffi::{CString,OsStr},fs::File,io,os::{fd::{AsRawFd,FromRawFd},unix::ffi::OsStrExt},path::{Component,Path}};
#[cfg(target_os="linux")] const DIRECTORY:i32=0x10000;
#[cfg(target_os="macos")] const DIRECTORY:i32=0x100000;
#[cfg(target_os="linux")] const NOFOLLOW:i32=0x20000;
#[cfg(target_os="macos")] const NOFOLLOW:i32=0x100;
#[cfg(target_os="linux")] const CLOEXEC:i32=0x80000;
#[cfg(target_os="macos")] const CLOEXEC:i32=0x1000000;
#[cfg(target_os="linux")] const CREATE_EXCLUSIVE:i32=0x40|0x80;
#[cfg(target_os="macos")] const CREATE_EXCLUSIVE:i32=0x200|0x800;
extern "C" {fn openat(directory:i32,name:*const core::ffi::c_char,flags:i32,...)->i32;fn unlinkat(directory:i32,name:*const core::ffi::c_char,flags:i32)->i32;}
#[cfg(target_os="linux")] extern "C" {fn mkdirat(directory:i32,name:*const core::ffi::c_char,mode:u32)->i32;}
#[cfg(target_os="macos")] extern "C" {fn mkdirat(directory:i32,name:*const core::ffi::c_char,mode:u16)->i32;}
fn name(value:&OsStr)->io::Result<CString> {if Path::new(value).components().count()!=1||!Path::new(value).components().all(|part|matches!(part,Component::Normal(_))){return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));}CString::new(value.as_bytes()).map_err(|_|io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))}
fn open_child(parent:&File,part:&OsStr,flags:i32)->io::Result<File> {let name=name(part)?;let fd=unsafe{openat(parent.as_raw_fd(),name.as_ptr(),flags|NOFOLLOW|CLOEXEC,0o600u32)};if fd<0{return Err(io::Error::last_os_error());}Ok(unsafe{File::from_raw_fd(fd)})}
pub(super) fn open_directory(path:&Path)->io::Result<File> {
    if !path.is_absolute(){return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"));}
    let canonical=path.canonicalize()?;let mut file=File::open("/")?;
    for component in canonical.components(){match component{Component::RootDir=>{},Component::Normal(part)=>file=open_child(&file,part,DIRECTORY)?,_=>return Err(io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))}}
    Ok(file)
}
pub(super) fn open_regular(path:&Path)->io::Result<File> {let parent=open_directory(path.parent().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;open_child(&parent,path.file_name().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?,0)}
pub(super) fn open_writer(path:&Path)->io::Result<File> {let parent=open_directory(path.parent().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;open_child(&parent,path.file_name().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?,2)}
pub(super) fn open_lock(path:&Path)->io::Result<File> {let parent=open_directory(path.parent().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?)?;#[cfg(target_os="linux")] let create=0x40;#[cfg(target_os="macos")] let create=0x200;open_child(&parent,path.file_name().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"UnsafePath"))?,2|create)}
pub(super) fn remove_file(parent:&File,part:&OsStr)->io::Result<()> {let part=name(part)?;if unsafe{unlinkat(parent.as_raw_fd(),part.as_ptr(),0)}!=0{return Err(io::Error::last_os_error());}Ok(())}
pub(super) fn create_new(parent:&File,name:&OsStr)->io::Result<File> {open_child(parent,name,2|CREATE_EXCLUSIVE)}
pub(super) fn create_dir(parent:&File,part:&OsStr)->io::Result<()> {let part=name(part)?;if unsafe{mkdirat(parent.as_raw_fd(),part.as_ptr(),0o777)}!=0{return Err(io::Error::last_os_error());}Ok(())}
pub(super) fn install(source:&File,source_name:&OsStr,target:&File,target_name:&OsStr)->io::Result<()> {
    let source_name=name(source_name)?;let target_name=name(target_name)?;
    #[cfg(target_os="linux")] let result={extern "C" {fn renameat2(old_dir:i32,old:*const core::ffi::c_char,new_dir:i32,new:*const core::ffi::c_char,flags:u32)->i32;}unsafe{renameat2(source.as_raw_fd(),source_name.as_ptr(),target.as_raw_fd(),target_name.as_ptr(),1)}};
    #[cfg(target_os="macos")] let result={extern "C" {fn renameatx_np(old_dir:i32,old:*const core::ffi::c_char,new_dir:i32,new:*const core::ffi::c_char,flags:u32)->i32;}unsafe{renameatx_np(source.as_raw_fd(),source_name.as_ptr(),target.as_raw_fd(),target_name.as_ptr(),4)}};
    if result!=0{return Err(io::Error::last_os_error());}Ok(())
}
