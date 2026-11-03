use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub(in crate::web_page) struct NativeExecutable(Executable);

impl NativeExecutable {
    pub(in crate::web_page) fn read(path: &Path) -> WebResult<Self> {
        Executable::read(path).map(Self)
    }
    pub(in crate::web_page) fn path(&self) -> &Path { &self.0.path }
    pub(in crate::web_page) fn check(&self) -> WebResult<()> {
        if Executable::read(&self.0.path)? != self.0 { return Err(WebPageError::StorageFailed); }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub(in crate::web_page) struct NativeProcessStamp(Member);

impl NativeProcessStamp {
    pub(in crate::web_page) fn owner() -> WebResult<Self> {
        let system = processes();
        Member::read_owner(system.process(Pid::from_u32(std::process::id()))
            .ok_or(WebPageError::StorageFailed)?).map(Self)
    }
    pub(in crate::web_page) fn capture(pid: u32, system_browser: bool) -> WebResult<Option<Self>> {
        let Some(facts) = process_identity::query(pid)? else { return Ok(None); };
        let system = processes();
        let process = system.process(Pid::from_u32(pid)).ok_or(WebPageError::StorageFailed)?;
        if process.status() == ProcessStatus::Zombie { return Ok(None); }
        let executable = if system_browser { Executable::read_owner(&facts.executable)? }
            else { Executable::read(&facts.executable)? };
        let stamp = Self(Member { pid, birth: facts.birth, executable,
            group: process_group(pid)?, parent: process.parent().map(Pid::as_u32) });
        if !stamp.0.valid() { return Err(WebPageError::StorageFailed); }
        Ok(Some(stamp))
    }
    pub(in crate::web_page) fn pid(&self) -> u32 { self.0.pid }
    pub(in crate::web_page) fn birth(&self) -> Birth { self.0.birth }
    pub(in crate::web_page) fn parent(&self) -> Option<u32> { self.0.parent }
    pub(in crate::web_page) fn executable(&self) -> NativeExecutable {
        NativeExecutable(self.0.executable.clone())
    }
    pub(in crate::web_page) fn valid(&self) -> bool { self.0.valid() }
    pub(in crate::web_page) fn alive(&self, system_browser: bool) -> WebResult<bool> {
        if self.pid() == std::process::id() {
            let system = processes();
            return self.0.owner_alive(&system).map(|process| process.is_some());
        }
        let Some(actual) = Self::capture(self.pid(), system_browser)? else { return Ok(false); };
        if self.birth() != actual.birth() { return Ok(false); }
        if !self.0.same_process(&actual.0) { return Err(WebPageError::StorageFailed); }
        Ok(true)
    }
    pub(in crate::web_page) fn owner_alive(&self) -> WebResult<bool> {
        let system = processes();
        self.0.owner_alive(&system).map(|process| process.is_some())
    }
    pub(in crate::web_page) fn command(&self, system_browser: bool) -> WebResult<Option<Vec<std::ffi::OsString>>> {
        if !self.alive(system_browser)? { return Ok(None); }
        let system = processes();
        let process = system.process(Pid::from_u32(self.pid())).ok_or(WebPageError::StorageFailed)?;
        let command = process.cmd().to_vec();
        if !self.alive(system_browser)? { return Err(WebPageError::StorageFailed); }
        Ok(Some(command))
    }
    pub(in crate::web_page) fn terminate(&self, system_browser: bool, deadline: Instant) -> WebResult<()> {
        if Instant::now() >= deadline { return Err(WebPageError::StorageFailed); }
        if self.pid() == std::process::id() { return Err(WebPageError::StorageFailed); }
        if !self.alive(system_browser)? { return Ok(()); }
        #[cfg(windows)] process_identity::terminate_before(self.pid(), self.birth(), deadline)?;
        #[cfg(target_os = "macos")] {
            if unsafe { libc::kill(i32::try_from(self.pid()).map_err(storage)?, libc::SIGKILL) } != 0
                && std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) {
                return Err(WebPageError::StorageFailed);
            }
        }
        #[cfg(not(any(windows, target_os = "macos")))] return Err(WebPageError::StorageFailed);
        Ok(())
    }
}

pub(in crate::web_page) fn native_remove_tree(
    path: &Path, identity: DirectoryIdentity, deadline: Instant,
) -> WebResult<()> {
    removal::remove_tree_before(path, identity, deadline).map_err(storage)
}
