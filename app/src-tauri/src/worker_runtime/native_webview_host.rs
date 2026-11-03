use super::web_process_tree::WebProcessTree;
use crate::{safe_filesystem as safe, web_page::host_protocol::{self, HostMessage, HostStage, PolicyKind, MESSAGE_LIMIT}, RuntimePaths};
pub(crate) use crate::web_page::host_protocol::HostArticle;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::File, io::{BufReader, Read, Write}, path::{Component, Path, PathBuf}, process::{Child, Command, Stdio}, sync::{atomic::{AtomicBool, Ordering}, mpsc::{self, Receiver, SyncSender, TryRecvError}, Arc, Mutex}, thread::JoinHandle, time::{Duration, Instant}};

const INVALID: &str = "WEB_PROTOCOL_INVALID";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest { schema_version: u32, target: String, binary: String, bytes: u64, sha256: String }

fn target() -> &'static str {
    if cfg!(all(windows, target_arch="x86_64")) { "windows-x64" }
    else if cfg!(all(target_os="macos", target_arch="aarch64")) { "macos-arm64" }
    else if cfg!(all(target_os="macos", target_arch="x86_64")) { "macos-x64" }
    else { "unsupported" }
}

fn executable(paths: &RuntimePaths) -> Result<(PathBuf, File, safe::PinnedDirectory), String> {
    if target() == "unsupported" { return Err("WEB_PLATFORM_UNSUPPORTED".into()); }
    let root = paths.resource_dir.join("webview-host");
    let pinned = safe::pin_directory(&root).map_err(|_| "WEB_HOST_FAILED")?;
    let manifest = safe::open_regular(&root.join("manifest.json")).map_err(|_| "WEB_HOST_FAILED")?;
    if manifest.metadata().map_err(|_| "WEB_HOST_FAILED")?.len() > 16384 { return Err("WEB_HOST_FAILED".into()); }
    let manifest: Manifest = serde_json::from_reader(manifest).map_err(|_| "WEB_HOST_FAILED")?;
    let expected = if cfg!(windows) { "frameq-webview-host.exe" } else { "FrameQWebViewHost.app/Contents/MacOS/frameq-webview-host" };
    if manifest.schema_version != 1 || manifest.target != target() || manifest.binary != expected
        || manifest.bytes == 0 || manifest.bytes > 128 * 1024 * 1024
        || manifest.sha256.len() != 64 || !manifest.sha256.bytes().all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
        || Path::new(&manifest.binary).components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err("WEB_HOST_FAILED".into());
    }
    let path = root.join(&manifest.binary);
    let mut file = safe::open_regular(&path).map_err(|_| "WEB_HOST_FAILED")?;
    if file.metadata().map_err(|_| "WEB_HOST_FAILED")?.len() != manifest.bytes { return Err("WEB_HOST_FAILED".into()); }
    let mut hasher = Sha256::new();
    let mut bytes = [0u8; 65536];
    loop {
        let count = file.read(&mut bytes).map_err(|_| "WEB_HOST_FAILED")?;
        if count == 0 { break; }
        hasher.update(&bytes[..count]);
    }
    if format!("{:x}", hasher.finalize()) != manifest.sha256 { return Err("WEB_HOST_FAILED".into()); }
    pinned.check().map_err(|_| "WEB_HOST_FAILED")?;
    Ok((path, file, pinned))
}

pub(crate) fn helper_path(paths: &RuntimePaths) -> Result<PathBuf, String> {
    let (path, _file, _directory) = executable(paths)?;
    path.canonicalize().map_err(|_| "WEB_HOST_FAILED".into())
}

struct DnsRuntime(Option<tokio::runtime::Runtime>);
impl DnsRuntime {
    fn runtime(&self) -> &tokio::runtime::Runtime { self.0.as_ref().expect("active DNS runtime") }
}
impl Drop for DnsRuntime {
    fn drop(&mut self) { if let Some(runtime) = self.0.take() { runtime.shutdown_background(); } }
}

struct Pipes {
    writer: Option<SyncSender<Value>>,
    reader: Receiver<Result<Option<HostMessage>, String>>,
    writer_thread: Option<JoinHandle<()>>,
    reader_thread: Option<JoinHandle<()>>,
    diagnostic_thread: Option<JoinHandle<()>>,
    protocol_violation: Arc<AtomicBool>,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(untagged, deny_unknown_fields)]
enum NativeFailureDetails {
    Process { kind: i32, reason: i32, exit_code: i32 },
    Policy { reason: DiagnosticReason, resource: DiagnosticResource },
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum DiagnosticReason { BlockedUrl, DnsFailed, DnsTimeout, ConnectionFailed, ConnectionTimeout, QueueTimeout, QueueFull, MediaSkipped, StaleGeneration, Cancelled, ByteLimit }

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum DiagnosticResource { Document, Subdocument, Script, Stylesheet, Image, Media, Font, Xhr, Fetch, Other, Connection }

fn forward_host_messages(reader: &mut impl std::io::BufRead, sender: &SyncSender<Result<Option<HostMessage>, String>>, violation: &AtomicBool) {
    let mut total = 0usize;
    let mut saw_closed = false;
    loop {
        let record = host_protocol::read_message(reader).and_then(|value| {
            if let Some((_, bytes)) = &value { total = total.saturating_add(*bytes); }
            if total > MESSAGE_LIMIT { return Err(INVALID.into()); }
            Ok(value.map(|(message, _)| message))
        });
        if record.is_err() || (saw_closed && matches!(&record, Ok(Some(_)))) {
            violation.store(true, Ordering::Release);
        }
        if matches!(&record, Ok(Some(HostMessage::Closed { .. }))) { saw_closed = true; }
        let finished = !matches!(&record, Ok(Some(_)));
        if sender.send(record).is_err() || finished { return; }
    }
}

impl Pipes {
    fn start(child: &mut Child, paths: &RuntimePaths) -> Result<Self, String> {
        let mut stdin = child.stdin.take().ok_or(INVALID)?;
        let stdout = child.stdout.take().ok_or(INVALID)?;
        let stderr = child.stderr.take().ok_or(INVALID)?;
        let paths = paths.clone();
        let diagnostic_thread = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            if stderr.take(4097).read_to_end(&mut bytes).is_ok() && bytes.len() <= 4096 {
                for line in bytes.split(|byte| *byte == b'\n').filter(|line| !line.is_empty()).take(16) {
                    if let Ok(details) = serde_json::from_slice::<NativeFailureDetails>(line) {
                        let event = match details { NativeFailureDetails::Process { .. } => "web.host.process", NativeFailureDetails::Policy { .. } => "web.host.policy" };
                        let detail = serde_json::to_string(&details).expect("closed diagnostic fields");
                        let _ = crate::append_desktop_log(&paths, event, &detail);
                    }
                }
            }
        });
        let (writer, outgoing) = mpsc::sync_channel::<Value>(16);
        let writer_thread = std::thread::spawn(move || {
            while let Ok(value) = outgoing.recv() {
                let Ok(mut bytes) = serde_json::to_vec(&value) else { break; };
                bytes.push(b'\n');
                if bytes.len() > MESSAGE_LIMIT || stdin.write_all(&bytes).and_then(|_| stdin.flush()).is_err() { break; }
            }
        });
        let (sender, reader) = mpsc::sync_channel(16);
        let protocol_violation = Arc::new(AtomicBool::new(false));
        let reader_violation = Arc::clone(&protocol_violation);
        let reader_thread = std::thread::spawn(move || {
            let mut stdout = BufReader::new(stdout);
            forward_host_messages(&mut stdout, &sender, &reader_violation);
        });
        Ok(Self { writer: Some(writer), reader, writer_thread: Some(writer_thread), reader_thread: Some(reader_thread), diagnostic_thread: Some(diagnostic_thread), protocol_violation })
    }

    fn send(&self, mut value: Value, operation: &str, session: &str) -> Result<(), String> {
        value["contract_version"] = 1.into(); value["operation_id"] = operation.into(); value["session_id"] = session.into();
        if serde_json::to_vec(&value).map_err(|_| INVALID)?.len() + 1 > MESSAGE_LIMIT { return Err(INVALID.into()); }
        self.writer.as_ref().ok_or(INVALID)?.try_send(value).map_err(|_| INVALID.into())
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn extract(paths: &RuntimePaths, operation_id: &str, session_id: &str, url: &str, profile: &Path, script: &str,
    proxy_url: Option<&str>, cancel: &AtomicBool, on_stage: &dyn Fn(&str) -> Result<(), String>, record: &mut dyn FnMut(&str, u32) -> Result<(), String>, work_deadline: Instant) -> Result<HostArticle, String> {
    extract_with_cleanup_budget(paths, operation_id, session_id, url, profile, script, proxy_url, cancel, on_stage,
        record, work_deadline, &Mutex::new(None))
}

fn cleanup_deadline(budget: &Mutex<Option<Instant>>) -> Result<Instant, String> {
    let mut budget = budget.lock().map_err(|_| "WEB_CLEANUP_FAILED")?;
    Ok(*budget.get_or_insert_with(|| Instant::now() + Duration::from_secs(15)))
}

fn reap_before(child: &mut Child, deadline: Instant) -> Option<std::process::ExitStatus> {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
            _ => return None,
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn extract_with_cleanup_budget(paths: &RuntimePaths, operation_id: &str, session_id: &str, url: &str, profile: &Path, script: &str,
    proxy_url: Option<&str>, cancel: &AtomicBool, on_stage: &dyn Fn(&str) -> Result<(), String>, record: &mut dyn FnMut(&str, u32) -> Result<(), String>, work_deadline: Instant,
    cleanup_budget: &Mutex<Option<Instant>>) -> Result<HostArticle, String> {
    for id in [operation_id, session_id] { if uuid::Uuid::parse_str(id).map_or(true, |id_value| id_value.to_string() != id) { return Err(INVALID.into()); } }
    if cancel.load(Ordering::Acquire) { return Err("WEB_CANCELLED".into()); }
    if Instant::now() >= work_deadline { return Err("WEB_TIMEOUT".into()); }
    if cfg!(windows) && std::env::vars_os().any(|(key,_)| {
        let key = key.to_string_lossy().to_ascii_uppercase();
        key.starts_with("WEBVIEW2_") || key.starts_with("COREWEBVIEW2_")
    }) { return Err("WEB_RUNTIME_UNSAFE_CONFIGURATION".into()); }
    public_dns(url)?;
    let (binary, _file, _pinned) = executable(paths)?;
    let mut command = Command::new(binary);
    command.args(["--operation-id", operation_id]);
    command.env_clear().stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for key in ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "HOMEDRIVE", "HOMEPATH", "HOME", "LANG"] {
        if let Some(value) = std::env::var_os(key) { command.env(key, value); }
    }
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x0800_0000).env("TEMP", profile).env("TMP", profile); }
    #[cfg(unix)] { use std::os::unix::process::CommandExt; command.process_group(0); }
    let mut child = command.spawn().map_err(|_| "WEB_HOST_FAILED")?;
    let mut tree = match WebProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(_) => {
            let deadline = cleanup_deadline(cleanup_budget)?;
            let _ = child.kill(); let _ = reap_before(&mut child, deadline);
            return Err("WEB_CLEANUP_FAILED".into());
        }
    };
    let mut pipes = match Pipes::start(&mut child, paths) {
        Ok(pipes) => pipes,
        Err(code) => {
            let deadline = cleanup_deadline(cleanup_budget)?;
            let clean = tree.terminate_and_wait_before(deadline.min(Instant::now() + Duration::from_secs(10))).is_ok()
                && reap_before(&mut child, deadline).is_some();
            if !clean { tree.stop_cleanup_wait(); }
            return Err(if clean { code } else { "WEB_CLEANUP_FAILED".into() });
        }
    };
    let result = (|| {
        record("helper", child.id())?;
        if cancel.load(Ordering::Acquire) { return Err("WEB_CANCELLED".into()); }
        if Instant::now() >= work_deadline { return Err("WEB_TIMEOUT".into()); }
        let platform = if cfg!(windows) { json!({"kind":"windows", "user_data_dir":profile}) }
            else { json!({"kind":"macos", "proxy_url":proxy_url.ok_or(INVALID)?}) };
        pipes.send(json!({"type":"init", "url":url, "extraction_script":script, "platform":platform, "deadline_ms":90000}), operation_id, session_id)?;
        protocol(&pipes, &tree, operation_id, session_id, cancel, on_stage, record, work_deadline, cleanup_budget)
    })();
    let deadline = cleanup_deadline(cleanup_budget)?;
    let _ = pipes.send(json!({"type":"cancel"}), operation_id, session_id);
    pipes.writer.take();
    let cleanup = Instant::now();
    let exited = loop {
        while pipes.reader.try_recv().is_ok() {}
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if cleanup.elapsed() < Duration::from_secs(1) && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => break None,
        }
    };
    let tree_clean = tree.terminate_and_wait_before(deadline.min(Instant::now() + Duration::from_secs(10))).is_ok();
    let status = match exited {
        Some(status) => Some(status),
        None if tree_clean => reap_before(&mut child, deadline),
        None => {
            let _ = child.kill();
            let began = Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => break Some(status),
                    Ok(None) if began.elapsed() < Duration::from_millis(500) && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
                    _ => break None,
                }
            }
        }
    };
    while pipes.reader.try_recv().is_ok() {}
    if !tree_clean || status.is_none() {
        tree.stop_cleanup_wait();
        drop(pipes.reader);
        return Err("WEB_CLEANUP_FAILED".into());
    }
    let writer_clean = pipes.writer_thread.take().is_some_and(|thread| thread.join().is_ok());
    drop(pipes.reader);
    let reader_clean = pipes.reader_thread.take().is_some_and(|thread| thread.join().is_ok());
    let diagnostic_clean = pipes.diagnostic_thread.take().is_some_and(|thread| thread.join().is_ok());
    if !tree_clean || !writer_clean || !reader_clean || !diagnostic_clean || status.is_none() { return Err("WEB_CLEANUP_FAILED".into()); }
    if Instant::now() >= deadline { return Err("WEB_CLEANUP_FAILED".into()); }
    if result.is_ok() && pipes.protocol_violation.load(Ordering::Acquire) { return Err(INVALID.into()); }
    if result.is_ok() && !status.is_some_and(|status| status.success()) { return Err("WEB_HOST_FAILED".into()); }
    if cancel.load(Ordering::Acquire) { return Err("WEB_CANCELLED".into()); }
    result
}

#[allow(clippy::too_many_arguments)]
fn protocol(pipes: &Pipes, tree: &WebProcessTree, operation: &str, session: &str, cancel: &AtomicBool, on_stage: &dyn Fn(&str) -> Result<(), String>,
    record: &mut dyn FnMut(&str, u32) -> Result<(), String>, work_deadline: Instant, cleanup_budget: &Mutex<Option<Instant>>) -> Result<HostArticle, String> {
    let began = Instant::now();
    let mut ready = false;
    let mut generation = 0u64;
    let mut extracting_generation = None;
    let mut requests = 0u64;
    let mut article = None;
    let mut failure = None;
    let mut shutting_down = None;
    let mut last_memory = Instant::now();
    let resolver = DnsRuntime(Some(tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().map_err(|_| "WEB_HOST_FAILED")?));
    let (dns_sender, dns_receiver) = mpsc::sync_channel::<(u64, u64, Result<(), String>)>(16);
    let mut dns_pending = std::collections::HashMap::new();
    loop {
        if shutting_down.is_none() {
            let reason = if cancel.load(Ordering::Acquire) { Some("WEB_CANCELLED") }
                else if Instant::now() >= work_deadline { Some("WEB_TIMEOUT") }
                else if !ready && began.elapsed() >= Duration::from_secs(15) { Some("WEB_PREPARE_TIMEOUT") }
                else { None };
            if let Some(reason) = reason {
                cleanup_deadline(cleanup_budget)?;
                article = None;
                failure = Some(reason.to_owned());
                shutting_down = Some(Instant::now());
                pipes.send(json!({"type":"cancel"}), operation, session)?;
            }
        }
        if cleanup_budget.lock().map_err(|_| "WEB_CLEANUP_FAILED")?.is_some_and(|deadline| Instant::now() >= deadline) {
            return Err("WEB_CLEANUP_FAILED".into());
        }
        if shutting_down.is_some_and(|time: Instant| time.elapsed() >= Duration::from_secs(3)) { return Err(failure.unwrap_or_else(|| "WEB_CLEANUP_FAILED".into())); }
        while let Ok((request_id, request_generation, result)) = dns_receiver.try_recv() {
            let started: Instant = dns_pending.remove(&request_id).ok_or(INVALID)?;
            let result = result.and_then(|_| if started.elapsed() < Duration::from_secs(2) { Ok(()) } else { Err("WEB_NETWORK_POLICY_TIMEOUT".to_string()) });
            let allow = result.is_ok() && request_generation == generation && failure.is_none()
                && !cancel.load(Ordering::Acquire) && Instant::now() < work_deadline;
            pipes.send(json!({"type":"policy_decision", "request_id":request_id, "navigation_generation":request_generation, "allow":allow,
                "error":if allow { Value::Null } else { result.err().unwrap_or_else(|| "WEB_CANCELLED".into()).into() }}), operation, session)?;
        }
        if last_memory.elapsed() >= Duration::from_millis(250) {
            if tree.resident_bytes().map_err(|_| "WEB_RESOURCE_LIMIT")? > 2 * 1024 * 1024 * 1024 { return Err("WEB_RESOURCE_LIMIT".into()); }
            last_memory = Instant::now();
        }
        let message = match pipes.reader.try_recv() {
            Ok(value) => value?.ok_or("WEB_HOST_FAILED")?,
            Err(TryRecvError::Empty) => { std::thread::sleep(Duration::from_millis(5)); continue; }
            Err(TryRecvError::Disconnected) => return Err("WEB_HOST_FAILED".into()),
        };
        if !message.matches(operation, session) { return Err(INVALID.into()); }
        match message {
            HostMessage::Ready { browser_pid, runtime_version, .. } => {
                if ready || runtime_version.is_empty() || runtime_version.len() > 128 { return Err(INVALID.into()); }
                if cfg!(windows) {
                    let pid = browser_pid.filter(|pid| *pid > 0).ok_or(INVALID)?;
                    record("browser", pid)?;
                    tree.include_pid(pid).map_err(|_| "WEB_CLEANUP_FAILED")?;
                } else if browser_pid.is_some() { return Err(INVALID.into()); }
                ready = true;
                pipes.send(json!({"type":if failure.is_none() { "start" } else { "cancel" }}), operation, session)?;
            }
            HostMessage::Stage { navigation_generation, stage, .. } => {
                if failure.is_some() { continue; }
                if !ready || failure.is_some() || article.is_some() || navigation_generation == 0 { return Err(INVALID.into()); }
                match stage {
                    HostStage::WebLoading => { if navigation_generation <= generation || navigation_generation > 6 { return Err(INVALID.into()); } generation = navigation_generation; extracting_generation = None; on_stage("web_loading")?; }
                    HostStage::WebExtracting => { if navigation_generation != generation || extracting_generation.is_some() { return Err(INVALID.into()); } extracting_generation = Some(generation); on_stage("web_extracting")?; }
                }
            }
            HostMessage::PolicyCheck { request_id, navigation_generation, url, kind, .. } => {
                if failure.is_some() { continue; }
                if !ready || article.is_some() || navigation_generation != generation || request_id <= requests || dns_pending.len() >= 16 { return Err(INVALID.into()); }
                requests = request_id;
                match kind { PolicyKind::Resource | PolicyKind::Navigation => () }
                dns_pending.insert(request_id, Instant::now());
                let sender = dns_sender.clone();
                resolver.runtime().spawn(async move {
                    let result = check_dns(&url).await;
                    let _ = sender.send((request_id, navigation_generation, result));
                });
            }
            HostMessage::Article { navigation_generation, final_url, title, text, markdown, .. } => {
                cleanup_deadline(cleanup_budget)?;
                if failure.is_some() { continue; }
                if !ready || article.is_some() || navigation_generation != generation || generation == 0 || extracting_generation != Some(generation) { return Err(INVALID.into()); }
                if failure.is_none() && !cancel.load(Ordering::Acquire) && Instant::now() < work_deadline {
                    let value = HostArticle { navigation_generation, final_url, title, text, markdown };
                    value.validate()?;
                    resolver.runtime().block_on(check_dns(&value.final_url))?;
                    if cancel.load(Ordering::Acquire) { return Err("WEB_CANCELLED".into()); }
                    if Instant::now() >= work_deadline { return Err("WEB_TIMEOUT".into()); }
                    article = Some(value);
                }
            }
            HostMessage::Error { code, .. } => {
                cleanup_deadline(cleanup_budget)?;
                if !code.starts_with("WEB_") || code.len() > 128 || !code.bytes().all(|ch| ch.is_ascii_uppercase() || ch == b'_') { return Err(INVALID.into()); }
                article = None;
                if failure.is_none() { failure = Some(code); }
                shutting_down.get_or_insert(Instant::now());
            }
            HostMessage::Closed { clean, .. } => {
                if !clean { return Err(failure.unwrap_or_else(|| "WEB_CLEANUP_FAILED".into())); }
                if let Some(code) = failure { return Err(code); }
                return article.ok_or_else(|| "WEB_EXTRACTION_FAILED".into());
            }
        }
    }
}

fn public_dns(raw: &str) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|_| "WEB_HOST_FAILED")?;
    let result = runtime.block_on(check_dns(raw));
    runtime.shutdown_background();
    result
}

async fn check_dns(raw: &str) -> Result<(), String> {
    let url = crate::task_manifest::validate_web_request_url(raw).map_err(|_| "WEB_URL_BLOCKED")?;
    let host = url.host_str().ok_or("WEB_URL_BLOCKED")?.trim_matches(['[', ']']);
    let addresses = tokio::time::timeout(Duration::from_millis(1500), tokio::net::lookup_host((host, url.port_or_known_default().ok_or("WEB_URL_BLOCKED")?)))
        .await.map_err(|_| "WEB_NETWORK_POLICY_TIMEOUT")?.map_err(|_| "WEB_LOAD_FAILED")?.collect::<Vec<_>>();
    if addresses.is_empty() { return Err("WEB_LOAD_FAILED".into()); }
    if addresses.iter().any(|address| !crate::task_manifest::is_public_web_address(address.ip())) { return Err("WEB_URL_BLOCKED".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reader_requires_eof_after_closed() {
        let closed = serde_json::json!({"type":"closed", "contract_version":1,
            "operation_id":"bbd02c47-7155-47e9-b72b-be6583cbff09", "session_id":"7213a9bd-a39b-4d3b-b33c-c35408a53135", "clean":true});
        let error = serde_json::json!({"type":"error", "contract_version":1,
            "operation_id":"bbd02c47-7155-47e9-b72b-be6583cbff09", "session_id":"7213a9bd-a39b-4d3b-b33c-c35408a53135", "code":"WEB_HOST_FAILED"});
        for (suffix, rejected) in [(String::new(), false), (format!("{error}\n"), true), (format!("{closed}\n"), true), ("{\"unknown\":true}\n".into(), true)] {
            let mut input = std::io::Cursor::new(format!("{closed}\n{suffix}"));
            let (sender, receiver) = mpsc::sync_channel(16);
            let violation = AtomicBool::new(false);
            forward_host_messages(&mut input, &sender, &violation);
            assert_eq!(violation.load(Ordering::Acquire), rejected);
            assert!(receiver.try_iter().next().is_some());
        }
    }

    #[test]
    fn reader_retains_parse_failure_after_message_is_consumed() {
        let mut input = std::io::Cursor::new(b"{\"type\":\"unknown\"}\n");
        let (sender, receiver) = mpsc::sync_channel(16);
        let violation = AtomicBool::new(false);
        forward_host_messages(&mut input, &sender, &violation);
        assert!(receiver.try_recv().unwrap().is_err());
        assert!(receiver.try_recv().is_err());
        assert!(violation.load(Ordering::Acquire));
    }

    #[test]
    fn shared_cleanup_deadline_is_never_extended() {
        let existing = Instant::now() - Duration::from_secs(1);
        let budget = Mutex::new(Some(existing));
        assert_eq!(cleanup_deadline(&budget).unwrap(), existing);
        assert_eq!(cleanup_deadline(&budget).unwrap(), existing);
    }

    #[test]
    fn cleanup_stamps_one_fifteen_second_deadline() {
        let began = Instant::now();
        let budget = Mutex::new(None);
        let deadline = cleanup_deadline(&budget).unwrap();
        assert!(deadline >= began + Duration::from_secs(15));
        assert!(deadline <= Instant::now() + Duration::from_secs(15));
        assert_eq!(cleanup_deadline(&budget).unwrap(), deadline);
    }

    #[test]
    fn native_failure_diagnostics_accept_only_closed_numeric_fields() {
        assert!(serde_json::from_str::<NativeFailureDetails>(r#"{"kind":3,"reason":0,"exit_code":1}"#).is_ok());
        for value in [
            r#"{"kind":3,"reason":0,"exit_code":1,"url":"https://example.com/private"}"#,
            r#"{"kind":"page content","reason":0,"exit_code":1}"#,
        ] { assert!(serde_json::from_str::<NativeFailureDetails>(value).is_err()); }
    }

    #[test]
    fn resource_diagnostics_accept_closed_categories_without_request_data() {
        assert!(serde_json::from_str::<NativeFailureDetails>(r#"{"reason":"dns_failed","resource":"script"}"#).is_ok());
        for value in [
            r#"{"reason":"dns_failed","resource":"script","url":"https://private.example/"}"#,
            r#"{"reason":"private.example","resource":"script"}"#,
            r#"{"reason":"dns_failed","resource":"private.example"}"#,
        ] { assert!(serde_json::from_str::<NativeFailureDetails>(value).is_err()); }
    }

    #[test]
    fn cancelled_registration_cannot_start_a_native_helper() {
        let cancelled = AtomicBool::new(true);
        let paths = RuntimePaths { resource_dir: PathBuf::from("unavailable"), user_data_dir: PathBuf::from("unused") };
        let id = uuid::Uuid::new_v4().to_string();
        let result = extract(&paths, &id, &id, "https://example.com/", Path::new("unused"), "script", None, &cancelled, &|_| Ok(()), &mut |_,_| panic!("cancelled operation must not record any process"), Instant::now() + Duration::from_secs(90));
        assert_eq!(result.unwrap_err(), "WEB_CANCELLED");
    }

    #[test]
    #[cfg(windows)]
    #[ignore = "requires the packaged native helper, actual Stable Runtime and public Internet"]
    fn real_native_parent_extracts_public_article_and_reaps_owned_processes() {
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").canonicalize().unwrap();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.tmp").canonicalize().unwrap();
        let workspace = root.join(format!("native-parent-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&workspace).unwrap();
        let profile = workspace.join("profile");
        std::fs::create_dir(&profile).unwrap();
        let paths = RuntimePaths { resource_dir: resources.clone(), user_data_dir: workspace.clone() };
        let script = std::fs::read_to_string(resources.join("web/extract-article.js")).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let session = uuid::Uuid::new_v4().to_string();
        let mut recorded = Vec::new();
        let mut inspect = |role: &str, pid: u32| {
            let mut system = sysinfo::System::new();
            system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            let process = system.process(sysinfo::Pid::from_u32(pid)).ok_or("WEB_HOST_FAILED")?;
            let executable = process.exe().ok_or("WEB_HOST_FAILED")?;
            assert_eq!(executable.file_name().and_then(|name| name.to_str()), Some(if role == "helper" { "frameq-webview-host.exe" } else { "msedgewebview2.exe" }));
            recorded.push((role.to_owned(), pid));
            Ok(())
        };
        let article = extract(&paths, &id, &session, "https://quotes.toscrape.com/js/", &profile, &script, None,
            &AtomicBool::new(false), &|stage| { println!("actual parent stage {stage}"); Ok(()) }, &mut inspect, Instant::now() + Duration::from_secs(90)).expect("actual native parent extraction");
        assert_eq!(article.title, "Quotes to Scrape");
        assert!(article.text.contains("Albert Einstein"));
        assert_eq!(recorded.iter().map(|(role,_)| role.as_str()).collect::<Vec<_>>(), ["helper", "browser"]);
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        for (_,pid) in recorded { assert!(system.process(sysinfo::Pid::from_u32(pid)).is_none(), "owned PID {pid} remains alive"); }
        std::fs::remove_dir_all(&workspace).expect("actual UDF released and owned processes reaped");
        println!("actual production parent article {} bytes", article.text.len());
    }
}
