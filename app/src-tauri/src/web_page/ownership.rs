use super::errors::{WebPageError, WebResult};
use crate::safe_filesystem::{self as safe, DirectoryIdentity};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use sysinfo::{Pid, Process, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind};

const OWNER: &str = "owner.json";
const MEMBERS: &str = "processes.json";
const ROOT: &str = ".frameq-web-pages";
mod process_identity;
mod removal;
mod quarantine;
mod native;
pub(super) use native::{NativeExecutable, NativeProcessStamp, native_remove_tree};
pub(super) use process_identity::Birth;
pub(crate) use quarantine::{recovery_required, require_recovery};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Executable { path: PathBuf, identity: DirectoryIdentity }

impl Executable {
    fn read_owner(path: &Path) -> WebResult<Self> {
        let parent = path.parent().ok_or(WebPageError::StorageFailed)?;
        let name = path.file_name().ok_or(WebPageError::StorageFailed)?;
        #[cfg(windows)]
        let (directory, file) = {
            use std::os::windows::fs::OpenOptionsExt;
            let directory = safe::pin_directory(parent).map_err(storage)?;
            let file = fs::OpenOptions::new().read(true).share_mode(0x1).custom_flags(0x0020_0000)
                .open(path).map_err(storage)?;
            (directory, file)
        };
        #[cfg(unix)]
        let (directory, file) = {
            use std::os::fd::{AsRawFd, FromRawFd};
            use std::os::unix::ffi::OsStrExt;
            let directory = safe::open_directory(parent).map_err(storage)?;
            let name = std::ffi::CString::new(name.as_bytes()).map_err(storage)?;
            let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
            if fd < 0 { return Err(WebPageError::StorageFailed); }
            (directory, unsafe { fs::File::from_raw_fd(fd) })
        };
        let metadata = file.metadata().map_err(storage)?;
        if !metadata.is_file() || crate::atomic_files::is_link_or_reparse_point(&metadata) { return Err(WebPageError::StorageFailed); }
        let canonical_parent = parent.canonicalize().map_err(storage)?;
        #[cfg(windows)] directory.check().map_err(storage)?;
        #[cfg(unix)] safe::check_identity(&canonical_parent, safe::file_identity(&directory).map_err(storage)?).map_err(storage)?;
        // 应用自身按进程实例及文件身份核验，允许构建工具为同一程序创建硬链接。
        Ok(Self { path: canonical_parent.join(name), identity: safe::file_identity(&file).map_err(storage)? })
    }
    fn read(path: &Path) -> WebResult<Self> {
        #[cfg(windows)] if path.file_name() == Some(OsStr::new("conhost.exe")) {
            let expected = process_identity::system_console()?.canonicalize().map_err(storage)?;
            let canonical = path.canonicalize().map_err(storage)?;
            if canonical == expected {
                use std::os::windows::fs::OpenOptionsExt;
                safe::validate_ancestors(canonical.parent().ok_or(WebPageError::StorageFailed)?).map_err(storage)?;
                let file = fs::OpenOptions::new().read(true).share_mode(0x1 | 0x4).custom_flags(0x0020_0000).open(&canonical).map_err(storage)?;
                let metadata = file.metadata().map_err(storage)?;
                if !metadata.is_file() || crate::atomic_files::is_link_or_reparse_point(&metadata) { return Err(WebPageError::StorageFailed); }
                return Ok(Self { path: canonical, identity: safe::file_identity(&file).map_err(storage)? });
            }
        }
        let file = safe::open_regular(path).map_err(storage)?;
        Ok(Self { path: path.canonicalize().map_err(storage)?, identity: safe::file_identity(&file).map_err(storage)? })
    }
    fn matches(&self, process: &Process) -> bool {
        process_identity::query(process.pid().as_u32()).ok().flatten()
            .filter(|facts| facts.executable.file_name() == self.path.file_name())
            .and_then(|facts| Self::read(&facts.executable).ok()).as_ref() == Some(self)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Member { pid: u32, birth: Birth, executable: Executable, group: Option<u32>, parent: Option<u32> }

impl Member {
    fn valid(&self) -> bool {
        self.pid > 0 && self.birth.valid() && self.executable.path.is_absolute()
            && if cfg!(windows) { self.group.is_none() } else { self.group.is_some_and(|group| group > 0 && group <= i32::MAX as u32) }
    }
    fn read(process: &Process) -> WebResult<Self> {
        Self::inspect(process, None)?.ok_or(WebPageError::StorageFailed)
    }
    fn read_owner(process: &Process) -> WebResult<Self> {
        if process.pid().as_u32() != std::process::id() { return Err(WebPageError::StorageFailed); }
        let facts = process_identity::query(std::process::id())?.ok_or(WebPageError::StorageFailed)?;
        Ok(Self { pid: std::process::id(), birth: facts.birth, executable: Executable::read_owner(&facts.executable)?,
            group: process_group(std::process::id())?, parent: process.parent().map(Pid::as_u32) })
    }
    fn inspect(process: &Process, minimum: Option<Birth>) -> WebResult<Option<Self>> {
        let Some(facts) = process_identity::query(process.pid().as_u32())? else { return Ok(None); };
        if minimum.is_some_and(|minimum| facts.birth < minimum) { return Ok(None); }
        Ok(Some(Self { pid: process.pid().as_u32(), birth: facts.birth,
            executable: Executable::read(&facts.executable)?,
            group: process_group(process.pid().as_u32())?, parent: process.parent().map(Pid::as_u32) }))
    }
    fn same_process(&self, other: &Self) -> bool {
        self.pid == other.pid && self.birth == other.birth && self.executable == other.executable && self.group == other.group
    }
    fn alive<'a>(&self, system: &'a System) -> WebResult<Option<&'a Process>> {
        self.alive_with(system, Executable::read)
    }
    fn owner_alive<'a>(&self, system: &'a System) -> WebResult<Option<&'a Process>> {
        self.alive_with(system, Executable::read_owner)
    }
    fn alive_with<'a>(&self, system: &'a System, read_executable: fn(&Path) -> WebResult<Executable>) -> WebResult<Option<&'a Process>> {
        let Some(facts) = process_identity::query(self.pid)? else { return Ok(None); };
        if facts.birth != self.birth { return Ok(None); }
        let process = system.process(Pid::from_u32(self.pid)).ok_or(WebPageError::StorageFailed)?;
        if process.status() == ProcessStatus::Zombie { return Ok(None); }
        if read_executable(&facts.executable)? != self.executable || process_group(self.pid)? != self.group { return Err(WebPageError::StorageFailed); }
        Ok(Some(process))
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Owner {
    schema_version: u8, operation_id: String, directory: DirectoryIdentity,
    owner: Member, browser: Executable, worker: Executable, component_root: PathBuf,
    component_identity: DirectoryIdentity, system_console: Option<Executable>, probe: bool,
}

pub(crate) struct OwnedWorkspace { pub(crate) path: PathBuf, owner: Owner, bytes: Vec<u8>, cleaned: bool, cleanup_on_drop: bool }

fn storage<T>(_: T) -> WebPageError { WebPageError::StorageFailed }

fn processes() -> System {
    let mut system = System::new();
    system.refresh_processes_specifics(ProcessesToUpdate::All, true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::Always).with_cmd(UpdateKind::Always));
    system
}

fn write_new(path: &Path, value: &impl Serialize) -> WebResult<Vec<u8>> {
    let bytes = serde_json::to_vec(value).map_err(storage)?;
    let parent = safe::pin_directory(path.parent().ok_or(WebPageError::StorageFailed)?).map_err(storage)?;
    let mut file = parent.create_new(path.file_name().ok_or(WebPageError::StorageFailed)?).map_err(storage)?;
    file.write_all(&bytes).map_err(storage)?; file.sync_all().map_err(storage)?;
    #[cfg(unix)] safe::open_directory(path.parent().ok_or(WebPageError::StorageFailed)?).map_err(storage)?.sync_all().map_err(storage)?;
    Ok(bytes)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> WebResult<(T, Vec<u8>)> {
    let mut file = safe::open_regular(path).map_err(storage)?;
    if file.metadata().map_err(storage)?.len() > 256 * 1024 { return Err(WebPageError::StorageFailed); }
    let mut bytes = Vec::new(); Read::by_ref(&mut file).take(256 * 1024 + 1).read_to_end(&mut bytes).map_err(storage)?;
    let value = serde_json::from_slice(&bytes).map_err(storage)?;
    Ok((value, bytes))
}

impl OwnedWorkspace {
    pub(crate) fn new(cache: &Path, operation: &str, browser: &Path, worker: &Path, component: &Path, probe: bool) -> WebResult<Self> {
        if recovery_required(cache) { return Err(WebPageError::StorageFailed); }
        if uuid::Uuid::parse_str(operation).map_or(true, |id| id.to_string() != operation) { return Err(WebPageError::StorageFailed); }
        let system = processes();
        let owner_process = Member::read_owner(system.process(Pid::from_u32(std::process::id())).ok_or(WebPageError::StorageFailed)?)?;
        let browser = Executable::read(browser)?;
        let worker = Executable::read(worker)?;
        let component_root = component.canonicalize().map_err(storage)?;
        let component_identity = safe::identity(component).map_err(storage)?;
        #[cfg(windows)] let system_console = Some(Executable::read(&process_identity::system_console()?)?);
        #[cfg(not(windows))] let system_console = None;
        let parent = cache.join(ROOT);
        crate::data_storage::create_safe_dirs(&parent).map_err(storage)?;
        let pinned = safe::pin_directory(&parent).map_err(storage)?;
        pinned.create_dir(OsStr::new(operation)).map_err(storage)?;
        let path = parent.join(operation);
        let result = (|| {
        let directory = safe::identity(&path).map_err(storage)?;
        let root = safe::pin_directory(&path).map_err(storage)?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            root.set_permissions(fs::Permissions::from_mode(0o700)).map_err(storage)?;
        }
        let owner = Owner { schema_version: 1, operation_id: operation.into(), directory,
            owner: owner_process, browser, worker, component_root, component_identity, system_console, probe,
        };
        let bytes = write_new(&path.join(OWNER), &owner)?;
        root.create_dir(OsStr::new("profile")).map_err(storage)?;
        Ok(Self { path, owner, bytes, cleaned: false, cleanup_on_drop: true })
        })();
        if result.is_err() { require_recovery(cache); }
        result
    }
    pub(crate) fn profile(&self) -> PathBuf { self.path.join("profile") }
    pub(crate) fn cleanup(&mut self) -> WebResult<()> {
        let result = self.cleanup_inner();
        if result.is_err() {
            if let Some(cache) = self.path.parent().and_then(Path::parent) { require_recovery(cache); }
        }
        result
    }
    fn cleanup_inner(&mut self) -> WebResult<()> {
        if self.cleaned { return Ok(()); }
        self.check()?;
        check_pending(&self.path, &self.owner)?;
        let system = processes();
        let members = all_records(&self.path, &self.owner)?;
        if members.iter().any(|member| member.alive(&system).map_or(true, |value| value.is_some()))
            || find_roots(&self.path, &self.owner, &system)?.iter().any(|member| member.alive(&system).map_or(true, |value| value.is_some()))
            || unaccounted(&self.owner, &members, &system)
        { return Err(WebPageError::StorageFailed); }
        self.remove()?;
        Ok(())
    }
    fn check(&self) -> WebResult<()> {
        safe::check_identity(&self.path, self.owner.directory).map_err(storage)?;
        safe::check_identity(&self.owner.component_root, self.owner.component_identity).map_err(storage)?;
        #[cfg(windows)] if self.owner.system_console.as_ref() != Some(&Executable::read(&process_identity::system_console()?)?) {
            return Err(WebPageError::StorageFailed);
        }
        #[cfg(not(windows))] if self.owner.system_console.is_some() { return Err(WebPageError::StorageFailed); }
        let (_, bytes) = read_json::<Owner>(&self.path.join(OWNER))?;
        if bytes != self.bytes { return Err(WebPageError::StorageFailed); }
        safe::validate_ancestors(&self.path).map_err(storage)
    }
    fn remove(&mut self) -> WebResult<()> {
        self.check()?;
        removal::remove_tree(&self.path, self.owner.directory).map_err(storage)?;
        self.cleaned = true;
        Ok(())
    }
}

impl Drop for OwnedWorkspace { fn drop(&mut self) { if self.cleanup_on_drop { let _ = self.cleanup(); } } }

fn load(path: &Path) -> WebResult<OwnedWorkspace> {
    let (owner, bytes) = read_json::<Owner>(&path.join(OWNER))?;
    if owner.schema_version != 1 || path.file_name() != Some(OsStr::new(&owner.operation_id))
        || uuid::Uuid::parse_str(&owner.operation_id).map_or(true, |id| id.to_string() != owner.operation_id)
        || !owner.owner.valid()
    { return Err(WebPageError::StorageFailed); }
    let workspace = OwnedWorkspace { path: path.into(), owner, bytes, cleaned: false, cleanup_on_drop: false };
    workspace.check()?;
    Ok(workspace)
}

fn members(path: &Path) -> WebResult<Vec<Member>> {
    if !safe::entry_exists(&path.join(MEMBERS)).map_err(storage)? { return Ok(Vec::new()); }
    let (members, _) = read_json::<Vec<Member>>(&path.join(MEMBERS))?;
    if members.len() > 256 || members.iter().any(|member| !member.valid())
        || members.iter().map(|member| member.pid).collect::<std::collections::BTreeSet<_>>().len() != members.len()
    { return Err(WebPageError::StorageFailed); }
    Ok(members)
}

fn all_records(path: &Path, owner: &Owner) -> WebResult<Vec<Member>> {
    let mut result = members(path)?;
    for name in ["browser.json", "worker.json"] {
        if safe::entry_exists(&path.join(name)).map_err(storage)? {
            let (root, _) = read_json::<Member>(&path.join(name))?;
            let expected = if name == "browser.json" { &owner.browser } else { &owner.worker };
            if root.executable != *expected { return Err(WebPageError::StorageFailed); }
            if !result.contains(&root) { result.push(root); }
        }
    }
    if result.iter().any(|member| !member.valid() || member.pid == owner.owner.pid || member.birth < owner.owner.birth
        || (member.executable != owner.worker && !member.executable.path.starts_with(&owner.component_root)
            && Some(&member.executable) != owner.system_console.as_ref()))
    { return Err(WebPageError::StorageFailed); }
    Ok(result)
}

fn is_root(process: &Process, expected: &Executable, selector: &str) -> bool {
    expected.matches(process) && process.cmd().iter().any(|arg| arg == OsStr::new(selector))
}

fn find_roots(path: &Path, owner: &Owner, system: &System) -> WebResult<Vec<Member>> {
    let profile = format!("--user-data-dir={}", path.join("profile").display());
    let mut bindings = Vec::new();
    for (name, expected) in [("browser", &owner.browser), ("worker", &owner.worker)] {
        let receipt = path.join(format!("{name}.json"));
        let binding = if safe::entry_exists(&receipt).map_err(storage)? {
            let (member, _) = read_json::<Member>(&receipt)?;
            if !member.valid() || member.executable != *expected || member.birth < owner.owner.birth { return Err(WebPageError::StorageFailed); }
            Some(member)
        } else { None };
        bindings.push(binding);
    }
    let mut result = Vec::new();
    for process in system.processes().values() {
        let browser = is_root(process, &owner.browser, &profile)
            && !process.cmd().iter().any(|arg| arg == "--type" || arg.to_string_lossy().starts_with("--type="));
        let worker = owner.worker.matches(process)
            && process.cmd().windows(2).any(|pair| pair[0] == "--web-operation-id" && pair[1] == OsStr::new(&owner.operation_id))
            && if owner.probe {
                process.cmd().iter().any(|arg| arg == "--frameq-engine-probe")
            } else {
                process.cmd().iter().any(|arg| arg == "--process-web-page-stdin")
                    && process.cmd().windows(2).any(|pair| pair[0] == "-m" && pair[1] == "worker_core")
            };
        if browser || worker {
            let member = Member::read(process)?;
            if member.birth < owner.owner.birth { return Err(WebPageError::StorageFailed); }
            if let Some(binding) = &bindings[if browser { 0 } else { 1 }] {
                if !member.same_process(binding) { return Err(WebPageError::StorageFailed); }
            } else {
                let name = if browser { "browser" } else { "worker" };
                let marker = path.join(format!("{name}-starting.json"));
                let (_, bytes) = read_json::<Owner>(&marker)?;
                if bytes != serde_json::to_vec(owner).map_err(storage)? || member.parent != Some(owner.owner.pid)
                    || process_identity::query(owner.owner.pid)?.is_some_and(|facts| facts.birth != owner.owner.birth)
                    || cfg!(unix) && member.group != Some(member.pid)
                { return Err(WebPageError::StorageFailed); }
            }
            result.push(member);
        }
    }
    Ok(result)
}

fn collect(path: &Path, owner: &Owner, system: &System) -> WebResult<Vec<Member>> {
    let mut known: BTreeMap<u32, Member> = all_records(path, owner)?.into_iter().map(|member| (member.pid, member)).collect();
    for member in find_roots(path, owner, system)? { known.insert(member.pid, member); }
    loop {
        let before = known.len();
        for process in system.processes().values() {
            if known.contains_key(&process.pid().as_u32()) { continue; }
            if let Some(parent) = process.parent().and_then(|pid| known.get(&pid.as_u32())) {
                if parent.alive(system)?.is_some() {
                    let Some(member) = Member::inspect(process, Some(parent.birth))? else { continue; };
                    if member.parent != Some(parent.pid) || member.birth < parent.birth { return Err(WebPageError::StorageFailed); }
                    if member.executable != owner.worker && !member.executable.path.starts_with(&owner.component_root)
                        && Some(&member.executable) != owner.system_console.as_ref() {
                        return Err(WebPageError::StorageFailed);
                    }
                    known.insert(member.pid, member);
                }
            }
        }
        if known.len() == before { break; }
        if known.len() > 256 { return Err(WebPageError::StorageFailed); }
    }
    Ok(known.into_values().collect())
}

fn unaccounted(owner: &Owner, members: &[Member], system: &System) -> bool {
    system.processes().values().any(|process| {
        if process.pid().as_u32() == owner.owner.pid || process.status() == ProcessStatus::Zombie { return false; }
        #[cfg(unix)] if members.iter().any(|member| member.group.is_some()
            && process_group(process.pid().as_u32()).ok().flatten() == member.group) { return true; }
        let linked = process.parent().is_some_and(|parent| members.iter().any(|member|
            member.pid == parent.as_u32() && process_identity::query(process.pid().as_u32())
                .map_or(true, |facts| facts.is_some_and(|facts| facts.birth >= member.birth))));
        linked
    })
}

fn validate_members(path: &Path, owner: &Owner, members: &[Member], system: &System) -> WebResult<()> {
    let roots = ["browser.json", "worker.json"].into_iter().filter_map(|name| {
        match safe::entry_exists(&path.join(name)) { Ok(false) => None, _ => Some(read_json::<Member>(&path.join(name)).map(|(member, _)| member)) }
    }).collect::<WebResult<Vec<_>>>()?;
    let actual_roots = find_roots(path, owner, system)?;
    for root in &roots {
        if root.alive(system)?.is_some() && !actual_roots.iter().any(|actual| actual.same_process(root)) { return Err(WebPageError::StorageFailed); }
    }
    for member in members {
        let Some(process) = member.alive(system)? else { continue; };
        if roots.contains(member) || actual_roots.contains(member) { continue; }
        #[cfg(unix)] {
            if !roots.iter().any(|root| root.group == member.group && root.group == Some(root.pid) && member.birth >= root.birth) {
                return Err(WebPageError::StorageFailed);
            }
        }
        #[cfg(windows)] {
            if process.parent().map(Pid::as_u32) != member.parent { return Err(WebPageError::StorageFailed); }
            let mut cursor = member;
            let mut seen = std::collections::BTreeSet::new();
            while !roots.contains(cursor) {
                if !seen.insert(cursor.pid) { return Err(WebPageError::StorageFailed); }
                cursor = members.iter().find(|parent| Some(parent.pid) == cursor.parent && parent.birth <= cursor.birth)
                    .ok_or(WebPageError::StorageFailed)?;
            }
        }
        #[cfg(not(windows))] let _ = process;
    }
    Ok(())
}

pub(crate) fn observe(path: &Path) -> WebResult<()> {
    let workspace = load(path)?;
    let system = processes();
    let current = members(path)?;
    let next = collect(path, &workspace.owner, &system)?;
    if current != next {
        let bytes = serde_json::to_vec(&next).map_err(storage)?;
        workspace.check()?;
        crate::atomic_files::atomic_write(&path.join(MEMBERS), &bytes).map_err(storage)?;
    }
    Ok(())
}

pub(crate) fn record_worker(path: &Path, pid: u32) -> WebResult<()> { record_root(path, pid, false) }
pub(crate) fn begin_worker(path: &Path) -> WebResult<()> { begin(path, "worker-starting.json") }

fn begin(path: &Path, name: &str) -> WebResult<()> {
    let workspace = load(path)?;
    write_new(&path.join(name), &workspace.owner)?;
    Ok(())
}

fn check_pending(path: &Path, owner: &Owner) -> WebResult<()> {
    for kind in ["browser", "worker"] {
        let marker = path.join(format!("{kind}-starting.json"));
        if safe::entry_exists(&marker).map_err(storage)? {
            let (_, bytes) = read_json::<Owner>(&marker)?;
            if bytes != serde_json::to_vec(owner).map_err(storage)?
                || !safe::entry_exists(&path.join(format!("{kind}.json"))).map_err(storage)?
            { return Err(WebPageError::StorageFailed); }
        }
    }
    Ok(())
}

fn recover_pending(path: &Path, owner: &Owner, system: &System) -> WebResult<()> {
    for kind in ["browser", "worker"] {
        let marker = path.join(format!("{kind}-starting.json"));
        if !safe::entry_exists(&marker).map_err(storage)? || safe::entry_exists(&path.join(format!("{kind}.json"))).map_err(storage)? { continue; }
        let (_, bytes) = read_json::<Owner>(&marker)?;
        if bytes != serde_json::to_vec(owner).map_err(storage)? { return Err(WebPageError::StorageFailed); }
        let expected = if kind == "browser" { &owner.browser } else { &owner.worker };
        let candidates = find_roots(path, owner, system)?.into_iter().filter(|member| {
            member.executable == *expected && member.parent == Some(owner.owner.pid)
                && (!cfg!(unix) || member.group == Some(member.pid))
        }).collect::<Vec<_>>();
        if candidates.len() != 1 { return Err(WebPageError::StorageFailed); }
        write_new(&path.join(format!("{kind}.json")), &candidates[0])?;
    }
    check_pending(path, owner)
}

fn record_root(path: &Path, pid: u32, browser: bool) -> WebResult<()> {
    let workspace = load(path)?;
    let deadline = Instant::now() + Duration::from_secs(2);
    let member = loop {
        let system = processes();
        if let Some(member) = find_roots(path, &workspace.owner, &system)?.into_iter().find(|member| member.pid == pid) { break member; }
        if Instant::now() >= deadline { return Err(WebPageError::StorageFailed); }
        std::thread::sleep(Duration::from_millis(25));
    };
    let expected = if browser { &workspace.owner.browser } else { &workspace.owner.worker };
    if member.executable != *expected { return Err(WebPageError::StorageFailed); }
    write_new(&path.join(if browser { "browser.json" } else { "worker.json" }), &member)?;
    observe(path)
}

pub(super) fn recover(cache: &Path) -> WebResult<()> {
    let parent = cache.join(ROOT);
    if !safe::entry_exists(&parent).map_err(storage)? { return Ok(()); }
    let _guard = safe::pin_directory(&parent).map_err(storage)?;
    let entries = fs::read_dir(&parent).map_err(storage)?.collect::<Result<Vec<_>, _>>().map_err(storage)?;
    if entries.len() > 256 { return Err(WebPageError::StorageFailed); }
    for entry in entries {
        let mut workspace = load(&entry.path())?;
        let mut system = processes();
        if workspace.owner.owner.owner_alive(&system)?.is_some() { continue; }
        recover_pending(&workspace.path, &workspace.owner, &system)?;
        let mut pending = collect(&workspace.path, &workspace.owner, &system)?;
        for name in ["browser.json", "worker.json"] {
            if safe::entry_exists(&workspace.path.join(name)).map_err(storage)? {
                let (root, _) = read_json::<Member>(&workspace.path.join(name))?;
                if !pending.contains(&root) { pending.push(root); }
            }
        }
        validate_members(&workspace.path, &workspace.owner, &pending, &system)?;
        terminate(&pending, &system)?;
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            system = processes();
            if pending.iter().all(|member| member.alive(&system).is_ok_and(|process| process.is_none())) { break; }
            if Instant::now() >= deadline { return Err(WebPageError::StorageFailed); }
            std::thread::sleep(Duration::from_millis(25));
        }
        if unaccounted(&workspace.owner, &pending, &system) { return Err(WebPageError::StorageFailed); }
        workspace.remove()?;
    }
    Ok(())
}

#[cfg(windows)]
fn terminate(members: &[Member], system: &System) -> WebResult<()> {
    for member in members.iter().rev() {
        if member.alive(system)?.is_some() {
            process_identity::terminate(member.pid, member.birth)?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn terminate(members: &[Member], system: &System) -> WebResult<()> {
    let mut groups = std::collections::BTreeSet::new();
    for member in members {
        if member.alive(system)?.is_some() { groups.insert(member.group.ok_or(WebPageError::StorageFailed)?); }
    }
    for group in groups {
        if group == process_group(std::process::id())?.ok_or(WebPageError::StorageFailed)? { return Err(WebPageError::StorageFailed); }
        for process in system.processes().values() {
            if process_group(process.pid().as_u32()).ok().flatten() == Some(group)
                && !members.iter().any(|member| member.pid == process.pid().as_u32() && member.alive(system).is_ok_and(|value| value.is_some()))
            { return Err(WebPageError::StorageFailed); }
        }
        unsafe extern "C" { fn kill(pid: i32, signal: i32) -> i32; }
        if unsafe { kill(-(group as i32), 9) } != 0 { return Err(WebPageError::StorageFailed); }
    }
    Ok(())
}

#[cfg(unix)]
fn process_group(pid: u32) -> WebResult<Option<u32>> {
    unsafe extern "C" { fn getpgid(pid: i32) -> i32; }
    let group = unsafe { getpgid(i32::try_from(pid).map_err(storage)?) };
    if group < 1 { Err(WebPageError::StorageFailed) } else { Ok(Some(group as u32)) }
}
#[cfg(windows)]
fn process_group(_: u32) -> WebResult<Option<u32>> { Ok(None) }

#[cfg(all(test, any(windows, target_os="macos")))]
mod tests;
