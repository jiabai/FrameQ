use super::host_protocol::HostArticle;
use super::ownership::{NativeExecutable, NativeProcessStamp, native_remove_tree};
use crate::safe_filesystem::{self as safe, DirectoryIdentity};
use crate::worker_runtime::TaskTerminalResult;
use crate::RuntimePaths;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

const ROOT: &str = ".app-system-webviews";
const OWNER: &str = "owner.json";
const MEMBERS: &str = "processes.json";
const SAVE: &str = "save-receipt.json";
const RECEIPT_LIMIT: u64 = 256 * 1024;

fn storage<T>(_: T) -> String { "WEB_STORAGE_FAILED".into() }
fn canonical_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Owner {
    schema_version: u8,
    operation_id: String,
    session_id: String,
    directory: DirectoryIdentity,
    profile: DirectoryIdentity,
    owner: NativeProcessStamp,
    helper: NativeExecutable,
    worker: NativeExecutable,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Member { role: String, process: NativeProcessStamp }

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveReceipt {
    schema_version: u8,
    operation_id: String,
    session_id: String,
    task_id: String,
    source_url: String,
    title: String,
    text_sha256: String,
    markdown_sha256: String,
    text_bytes: usize,
    markdown_bytes: usize,
}

pub(crate) struct NativeSession {
    pub(crate) path: PathBuf,
    owner: Owner,
    owner_bytes: Vec<u8>,
    mutation: Mutex<()>,
    runtime: RuntimePaths,
}

fn write_new(path: &Path, value: &impl Serialize) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(value).map_err(storage)?;
    if bytes.len() as u64 > RECEIPT_LIMIT { return Err(storage(())); }
    let parent = safe::pin_directory(path.parent().ok_or_else(|| storage(()))?).map_err(storage)?;
    let mut file = parent.create_new(path.file_name().ok_or_else(|| storage(()))?).map_err(storage)?;
    file.write_all(&bytes).map_err(storage)?;
    file.sync_all().map_err(storage)?;
    #[cfg(unix)] safe::open_directory(path.parent().ok_or_else(|| storage(()))?).map_err(storage)?
        .sync_all().map_err(storage)?;
    Ok(bytes)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<(T, Vec<u8>), String> {
    let file = safe::open_regular(path).map_err(storage)?;
    if file.metadata().map_err(storage)?.len() > RECEIPT_LIMIT { return Err(storage(())); }
    let mut bytes = Vec::new();
    file.take(RECEIPT_LIMIT + 1).read_to_end(&mut bytes).map_err(storage)?;
    if bytes.len() as u64 > RECEIPT_LIMIT { return Err(storage(())); }
    let value = serde_json::from_slice(&bytes).map_err(storage)?;
    Ok((value, bytes))
}

impl NativeSession {
    pub(crate) fn create(
        paths: &RuntimePaths, operation_id: &str, session_id: &str, helper: &Path,
    ) -> Result<Self, String> {
        if !canonical_uuid(operation_id) || !canonical_uuid(session_id) {
            return Err(storage(()));
        }
        let helper = NativeExecutable::read(helper).map_err(storage)?;
        let worker = NativeExecutable::read(&crate::bundled_python_path(&paths.resource_dir))
            .map_err(storage)?;
        let owner = NativeProcessStamp::owner().map_err(storage)?;
        let parent = paths.cache_root()?.join(ROOT);
        crate::data_storage::create_safe_dirs(&parent).map_err(storage)?;
        let pinned = safe::pin_directory(&parent).map_err(storage)?;
        pinned.create_dir(OsStr::new(operation_id)).map_err(storage)?;
        let path = parent.join(operation_id);
        let directory = safe::pin_directory(&path).map_err(storage)?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            directory.set_permissions(fs::Permissions::from_mode(0o700)).map_err(storage)?;
        }
        directory.create_dir(OsStr::new("profile")).map_err(storage)?;
        let owner = Owner { schema_version: 1, operation_id: operation_id.into(),
            session_id: session_id.into(), directory: safe::identity(&path).map_err(storage)?,
            profile: safe::identity(&path.join("profile")).map_err(storage)?, owner, helper, worker };
        let owner_bytes = write_new(&path.join(OWNER), &owner)?;
        write_new(&path.join(MEMBERS), &Vec::<Member>::new())?;
        Ok(Self { path, owner, owner_bytes, mutation: Mutex::new(()), runtime: paths.clone() })
    }

    pub(crate) fn profile(&self) -> PathBuf { self.path.join("profile") }

    fn load(path: &Path, paths: &RuntimePaths) -> Result<Self, String> {
        let (owner, owner_bytes): (Owner, _) = read_json(&path.join(OWNER))?;
        if owner.schema_version != 1 || !canonical_uuid(&owner.operation_id)
            || !canonical_uuid(&owner.session_id) || !owner.owner.valid()
            || path.file_name() != Some(OsStr::new(&owner.operation_id)) {
            return Err(storage(()));
        }
        let session = Self { path: path.into(), owner, owner_bytes, mutation: Mutex::new(()),
            runtime: paths.clone() };
        session.check()?;
        Ok(session)
    }

    fn check(&self) -> Result<(), String> {
        safe::validate_ancestors(&self.path).map_err(storage)?;
        safe::check_identity(&self.path, self.owner.directory).map_err(storage)?;
        safe::check_identity(&self.profile(), self.owner.profile).map_err(storage)?;
        let (_, bytes): (Owner, _) = read_json(&self.path.join(OWNER))?;
        if bytes != self.owner_bytes { return Err(storage(())); }
        self.owner.helper.check().map_err(storage)?;
        self.owner.worker.check().map_err(storage)?;
        Ok(())
    }

    fn members(&self) -> Result<Vec<Member>, String> {
        let (members, _): (Vec<Member>, _) = read_json(&self.path.join(MEMBERS))?;
        if members.len() > 3 || members.iter().any(|member| {
            !matches!(member.role.as_str(), "helper" | "browser" | "worker")
                || !member.process.valid() || member.process.pid() == self.owner.owner.pid()
                || member.process.birth() < self.owner.owner.birth()
        }) { return Err(storage(())); }
        let mut roles = std::collections::BTreeSet::new();
        let mut pids = std::collections::BTreeSet::new();
        for member in &members {
            if !roles.insert(&member.role) || !pids.insert(member.process.pid()) {
                return Err(storage(()));
            }
            match member.role.as_str() {
                "helper" if member.process.executable() != self.owner.helper => return Err(storage(())),
                "worker" if member.process.executable() != self.owner.worker => return Err(storage(())),
                "browser" if !browser_executable(member.process.executable().path()) => return Err(storage(())),
                _ => {},
            }
        }
        Ok(members)
    }

    fn validate_member(&self, member: &Member, members: &[Member]) -> Result<bool, String> {
        let browser = member.role == "browser";
        let Some(command) = member.process.command(browser).map_err(storage)? else { return Ok(false); };
        let valid = match member.role.as_str() {
            "helper" => selector(&command, "--operation-id", &self.owner.operation_id)
                && member.process.parent() == Some(self.owner.owner.pid()),
            "worker" => selector(&command, "--web-operation-id", &self.owner.operation_id)
                && command.iter().any(|arg| arg == "--save-web-page-stdin")
                && selector(&command, "-m", "worker_core")
                && member.process.parent() == Some(self.owner.owner.pid()),
            "browser" => members.iter().find(|member| member.role == "helper")
                .is_some_and(|helper| member.process.birth() >= helper.process.birth())
                && profile_matches(&command, self.owner.profile)?,
            _ => false,
        };
        if !valid { return Err(storage(())); }
        Ok(true)
    }

    pub(crate) fn record(&self, role: &str, pid: u32) -> Result<(), String> {
        let _guard = self.mutation.lock().map_err(storage)?;
        self.check()?;
        if !matches!(role, "helper" | "browser" | "worker") || pid == 0 || pid == self.owner.owner.pid() {
            return Err(storage(()));
        }
        let Some(process) = NativeProcessStamp::capture(pid, role == "browser").map_err(storage)?
            else { return if role == "worker" { Ok(()) } else { Err(storage(())) }; };
        let mut members = self.members()?;
        if let Some(existing) = members.iter().find(|member| member.role == role) {
            if existing.process != process { return Err(storage(())); }
            self.validate_member(existing, &members)?;
            return Ok(());
        }
        members.push(Member { role: role.into(), process });
        let member = members.last().ok_or_else(|| storage(()))?;
        if member.process.birth() < self.owner.owner.birth()
            || members[..members.len() - 1].iter().any(|known| known.process.pid() == pid) {
            return Err(storage(()));
        }
        self.validate_member(member, &members)?;
        match role {
            "helper" if member.process.executable() != self.owner.helper => return Err(storage(())),
            "worker" if member.process.executable() != self.owner.worker => return Err(storage(())),
            "browser" if !browser_executable(member.process.executable().path()) => return Err(storage(())),
            _ => {},
        }
        self.check()?;
        crate::atomic_files::atomic_write(&self.path.join(MEMBERS),
            &serde_json::to_vec(&members).map_err(storage)?).map_err(storage)?;
        self.members()?;
        Ok(())
    }

    pub(crate) fn prepare_save(&self, task_id: &str, article: &HostArticle) -> Result<(), String> {
        let _guard = self.mutation.lock().map_err(storage)?;
        self.check()?;
        article.validate()?;
        if !safe_task_id(task_id) { return Err(storage(())); }
        let source_url = crate::task_manifest::canonical_web_url(&article.final_url)?;
        let receipt = SaveReceipt { schema_version: 1, operation_id: self.owner.operation_id.clone(),
            session_id: self.owner.session_id.clone(), task_id: task_id.into(), source_url,
            title: article.title.clone(), text_sha256: digest(article.text.as_bytes()),
            markdown_sha256: digest(article.markdown.as_bytes()), text_bytes: article.text.len(),
            markdown_bytes: article.markdown.len() };
        write_new(&self.path.join(SAVE), &receipt)?;
        Ok(())
    }

    pub(crate) fn recover_saved(&self, paths: &RuntimePaths) -> Result<Option<TaskTerminalResult>, String> {
        self.check()?;
        if !safe::entry_exists(&self.path.join(SAVE)).map_err(storage)? { return Ok(None); }
        let (receipt, _): (SaveReceipt, _) = read_json(&self.path.join(SAVE))?;
        if receipt.schema_version != 1 || receipt.operation_id != self.owner.operation_id
            || receipt.session_id != self.owner.session_id || !safe_task_id(&receipt.task_id)
            || receipt.text_bytes > 2 * 1024 * 1024 || receipt.markdown_bytes > 4 * 1024 * 1024
            || !valid_hash(&receipt.text_sha256) || !valid_hash(&receipt.markdown_sha256) {
            return Err(storage(()));
        }
        let output = paths.output_root()?;
        let manifest = output.join("tasks").join(&receipt.task_id).join("task.json");
        for parent in manifest.parent().ok_or_else(|| storage(()))?.ancestors() {
            match fs::symlink_metadata(parent) {
                Ok(_) => { safe::validate_ancestors(parent).map_err(storage)?; break; },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(storage(error)),
            }
        }
        let task_dir = manifest.parent().ok_or_else(|| storage(()))?;
        if !safe::entry_exists(task_dir).map_err(storage)? { return Ok(None); }
        let directory = safe::pin_directory(task_dir).map_err(storage)?;
        {
            let _lease = crate::task_manifest::acquire_task_mutation(&output, &receipt.task_id)?;
            crate::task_manifest::recover_task_artifacts(task_dir)?;
        }
        directory.check().map_err(storage)?;
        if !safe::entry_exists(&manifest).map_err(storage)? { return Ok(None); }
        let task = crate::task_manifest::SupportedTask::open(&output, &receipt.task_id)?;
        let result = TaskTerminalResult::from_saved_web_task(&task)?;
        let crate::task_manifest::TaskSourceSummary::WebPage { url, title, extracted_at } = task.source()
            else { return Err(storage(())); };
        let safe_title = escaped_title(&title);
        let prefix = format!("# {safe_title}\n\n<{url}>\n\n{extracted_at}\n\n");
        let markdown = result.markdown.strip_prefix(&prefix).ok_or_else(|| storage(()))?;
        if url != receipt.source_url || title != receipt.title
            || result.text.len() != receipt.text_bytes || digest(result.text.as_bytes()) != receipt.text_sha256
            || markdown.len() != receipt.markdown_bytes || digest(markdown.as_bytes()) != receipt.markdown_sha256 {
            return Err(storage(()));
        }
        Ok(Some(result))
    }

    pub(crate) fn cleanup(&self) -> Result<(), String> {
        self.cleanup_before(Instant::now() + Duration::from_secs(15))
    }

    pub(crate) fn cleanup_before(&self, deadline: Instant) -> Result<(), String> {
        let _guard = self.mutation.lock().map_err(storage)?;
        if !safe::entry_exists(&self.path).map_err(storage)? { return Ok(()); }
        self.check()?;
        let members = self.members()?;
        for member in &members {
            if Instant::now() >= deadline { return Err(storage(())); }
            if self.validate_member(member, &members)? { return Err(storage(())); }
        }
        self.ensure_profile_idle()?;
        self.recover_saved(&self.runtime)?;
        if Instant::now() >= deadline { return Err(storage(())); }
        native_remove_tree(&self.path, self.owner.directory, deadline).map_err(storage)
    }

    fn ensure_profile_idle(&self) -> Result<(), String> {
        let mut system = System::new();
        system.refresh_processes_specifics(ProcessesToUpdate::All, true,
            ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always));
        for process in system.processes().values() {
            if process.pid().as_u32() == self.owner.owner.pid() { continue; }
            if profile_matches(process.cmd(), self.owner.profile)?
                || selector(process.cmd(), "--operation-id", &self.owner.operation_id)
                || selector(process.cmd(), "--web-operation-id", &self.owner.operation_id) {
                return Err(storage(()));
            }
        }
        Ok(())
    }
}

fn selector(command: &[OsString], key: &str, value: &str) -> bool {
    command.windows(2).any(|pair| pair[0] == key && pair[1] == value)
}
fn profile_matches(command: &[OsString], expected: DirectoryIdentity) -> Result<bool, String> {
    let mut paths = Vec::new();
    for (index, argument) in command.iter().enumerate() {
        if argument == "--user-data-dir" {
            if let Some(value) = command.get(index + 1) { paths.push(PathBuf::from(value)); }
        } else if let Some(value) = argument.to_str().and_then(|arg| arg.strip_prefix("--user-data-dir=")) {
            paths.push(PathBuf::from(value));
        }
    }
    for path in paths {
        if safe::identity(&path).is_ok_and(|identity| identity == expected) { return Ok(true); }
        if cfg!(windows) && path.file_name().is_some_and(|name| name.eq_ignore_ascii_case("EBWebView"))
            && path.parent().is_some_and(|parent| safe::identity(parent).is_ok_and(|identity| identity == expected))
            && safe::open_directory(&path).is_ok() {
            return Ok(true);
        }
    }
    Ok(false)
}
fn browser_executable(path: &Path) -> bool {
    cfg!(windows) && path.file_name().is_some_and(|name| name.eq_ignore_ascii_case("msedgewebview2.exe"))
}
fn safe_task_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36 && bytes.get(8) == Some(&b'-') && bytes.get(15..20) == Some(b"-web-")
        && bytes[..8].iter().chain(&bytes[9..15]).all(u8::is_ascii_digit)
        && bytes[20..].iter().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn escaped_title(title: &str) -> String {
    let mut escaped = String::new();
    for character in title.chars() {
        if "\\`*_{}[]<>()#+-.!|".contains(character) { escaped.push('\\'); }
        escaped.push(character);
    }
    escaped
}

pub(crate) fn recover(paths: &RuntimePaths) -> Result<(), String> {
    let cache = paths.cache_root()?;
    let parent = cache.join(ROOT);
    if !safe::entry_exists(&parent).map_err(storage)? { return Ok(()); }
    let _guard = safe::pin_directory(&parent).map_err(storage)?;
    let entries = fs::read_dir(&parent).map_err(storage)?.collect::<Result<Vec<_>, _>>().map_err(storage)?;
    if entries.len() > 256 { return Err(storage(())); }
    let deadline = Instant::now() + Duration::from_secs(15);
    for entry in entries {
        if Instant::now() >= deadline { return Err(storage(())); }
        let session = NativeSession::load(&entry.path(), paths)?;
        if session.owner.owner.owner_alive().map_err(storage)? { continue; }
        let members = session.members()?;
        for member in &members {
            if session.validate_member(member, &members)? {
                member.process.terminate(member.role == "browser", deadline).map_err(storage)?;
            }
        }
        loop {
            let mut active = false;
            for member in &members {
                active |= member.process.alive(member.role == "browser").map_err(storage)?;
            }
            if !active { break; }
            if Instant::now() >= deadline { return Err(storage(())); }
            std::thread::sleep(Duration::from_millis(25));
        }
        session.cleanup_before(deadline)?;
    }
    Ok(())
}

#[cfg(all(test, any(windows, target_os = "macos")))]
mod tests;
