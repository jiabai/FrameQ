use std::io;
use std::process::Child;
use std::time::{Duration, Instant};

pub(super) fn finish_web_tree(tree: &mut Option<WebProcessTree>, workspace: Option<&std::path::Path>) -> Result<(), super::runner::WorkerRunError> {
    if let Some(tree) = tree {
        if tree.terminate_and_wait().is_err() {
            if let Some(cache) = workspace.and_then(std::path::Path::parent).and_then(std::path::Path::parent) {
                crate::web_page::ownership::require_recovery(cache);
            }
            return Err(super::runner::WorkerRunError { kind: super::runner::WorkerRunErrorKind::WaitFailed, detail: "WEB_PROCESS_TREE_CLEANUP_FAILED" });
        }
    }
    Ok(())
}

pub(super) struct WebProcessTree {
    #[cfg(windows)] job: windows_sys::Win32::Foundation::HANDLE,
    #[cfg(unix)] group: i32,
    finished: bool,
}

impl WebProcessTree {
    pub(super) fn stop_cleanup_wait(&mut self) {
        // 调用方保留恢复状态；关闭 Job 句柄继续执行系统终止，不重复等待期限。
        self.finished = true;
    }

    pub(super) fn include_pid(&self, pid: u32) -> io::Result<()> {
        #[cfg(windows)] {
            use windows_sys::Win32::{Foundation::{CloseHandle, FALSE}, System::{JobObjects::{AssignProcessToJobObject, IsProcessInJob}, Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE}}};
            let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA | PROCESS_TERMINATE, FALSE, pid) };
            if process.is_null() { return Err(io::Error::last_os_error()); }
            let mut included = 0;
            let checked = unsafe { IsProcessInJob(process, self.job, &mut included) };
            let assigned = checked != 0 && (included != 0 || unsafe { AssignProcessToJobObject(self.job, process) } != 0);
            let error = io::Error::last_os_error();
            unsafe { CloseHandle(process); }
            if !assigned { return Err(error); }
        }
        #[cfg(unix)] { if unsafe { libc::getpgid(pid as i32) } != self.group { return Err(io::Error::other("Invalid process group")); } }
        Ok(())
    }

    pub(super) fn resident_bytes(&self) -> io::Result<u64> {
        #[cfg(windows)] {
            use windows_sys::Win32::{Foundation::{CloseHandle, FALSE}, System::{JobObjects::{QueryInformationJobObject, JobObjectBasicProcessIdList, JOBOBJECT_BASIC_PROCESS_ID_LIST, IsProcessInJob}, ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS}, Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ}}};
            let mut storage = vec![0usize; 1026];
            let list = storage.as_mut_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>();
            if unsafe { QueryInformationJobObject(self.job, JobObjectBasicProcessIdList, list.cast(), (storage.len() * std::mem::size_of::<usize>()) as u32, std::ptr::null_mut()) } == 0 { return Err(io::Error::last_os_error()); }
            let count = unsafe { (*list).NumberOfProcessIdsInList } as usize;
            if count > 1024 { return Err(io::Error::other("Invalid job process count")); }
            let ids = unsafe { std::slice::from_raw_parts(std::ptr::addr_of!((*list).ProcessIdList).cast::<usize>(), count) };
            let mut total = 0u64;
            for id in ids {
                let process = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, *id as u32) };
                if process.is_null() { continue; }
                let mut included = 0;
                let mut counters = PROCESS_MEMORY_COUNTERS::default();
                counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                let checked = unsafe { IsProcessInJob(process, self.job, &mut included) } != 0;
                let measured = checked && included != 0 && unsafe { K32GetProcessMemoryInfo(process, &mut counters, counters.cb) } != 0;
                unsafe { CloseHandle(process); }
                if measured { total = total.checked_add(counters.WorkingSetSize as u64).ok_or_else(|| io::Error::other("Memory overflow"))?; }
            }
            Ok(total)
        }
        #[cfg(unix)] {
            let mut system = sysinfo::System::new();
            system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            Ok(system.processes().iter().filter(|(pid,_)| unsafe { libc::getpgid(pid.as_u32() as i32) } == self.group).map(|(_,process)| process.memory()).sum())
        }
    }

    pub(super) fn attach(child: &Child) -> io::Result<Self> {
        #[cfg(windows)] {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
                JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            };
            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job.is_null() { return Err(io::Error::last_os_error()); }
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = unsafe { SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) };
            if configured == 0 || unsafe { AssignProcessToJobObject(job, child.as_raw_handle().cast()) } == 0 {
                let error = io::Error::last_os_error(); unsafe { CloseHandle(job); } return Err(error);
            }
            Ok(Self { job, finished: false })
        }
        #[cfg(unix)] { Ok(Self { group: i32::try_from(child.id()).map_err(|_| io::Error::other("Invalid process group"))?, finished: false }) }
    }

    pub(super) fn terminate_and_wait(&mut self) -> io::Result<()> {
        self.terminate_and_wait_before(Instant::now() + Duration::from_secs(10))
    }

    pub(super) fn terminate_and_wait_before(&mut self, deadline: Instant) -> io::Result<()> {
        if self.finished { return Ok(()); }
        #[cfg(windows)] {
            use windows_sys::Win32::System::JobObjects::{
                QueryInformationJobObject, TerminateJobObject, JobObjectBasicAccountingInformation,
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
            };
            if unsafe { TerminateJobObject(self.job, 1) } == 0 { return Err(io::Error::last_os_error()); }
            loop {
                let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
                if unsafe { QueryInformationJobObject(self.job, JobObjectBasicAccountingInformation,
                    (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    std::ptr::null_mut()) } == 0 { return Err(io::Error::last_os_error()); }
                if info.ActiveProcesses == 0 { break; }
                if Instant::now() >= deadline { return Err(io::Error::new(io::ErrorKind::TimedOut, "Web process tree cleanup timed out")); }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        #[cfg(unix)] {
            if unsafe { libc::kill(-self.group, libc::SIGKILL) } != 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(libc::ESRCH) { return Err(error); }
            }
            loop {
                if unsafe { libc::kill(-self.group, 0) } != 0 {
                    let error = io::Error::last_os_error();
                    if error.raw_os_error() == Some(libc::ESRCH) { break; }
                    return Err(error);
                }
                let mut system = sysinfo::System::new();
                system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
                let mut live = false;
                for (pid, process) in system.processes() {
                    if process.status() != sysinfo::ProcessStatus::Zombie {
                        let group = unsafe { libc::getpgid(pid.as_u32() as i32) };
                        if group == self.group { live = true; break; }
                        if group < 0 && io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) { return Err(io::Error::last_os_error()); }
                    }
                }
                if !live { break; }
                if Instant::now() >= deadline { return Err(io::Error::new(io::ErrorKind::TimedOut, "Web process group cleanup timed out")); }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        self.finished = true;
        Ok(())
    }
}

impl Drop for WebProcessTree {
    fn drop(&mut self) {
        let _cleanup = self.terminate_and_wait();
        #[cfg(windows)] unsafe { windows_sys::Win32::Foundation::CloseHandle(self.job); }
    }
}
