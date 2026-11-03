use serde_json::{json, Value};
use std::{io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, Command, Stdio}, sync::mpsc, time::{Duration, SystemTime, UNIX_EPOCH}};

struct Running { child: Child, directory: PathBuf }
impl Drop for Running {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            self.child.kill().expect("terminate owned helper after failed test");
            self.child.wait().expect("reap owned helper");
        }
    }
}

#[test]
#[ignore = "requires the actual installed Stable WebView2 Runtime"]
fn native_runtime_ready_cancel_and_browser_exit() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize().unwrap();
    let directory = root.join(".tmp").join(format!("native-host-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&directory).unwrap();
    let script = std::fs::read_to_string(root.join("app/src-tauri/resources/web/extract-article.js")).expect("build the production extractor first");
    let child = Command::new(env!("CARGO_BIN_EXE_frameq-webview-host")).args(["--operation-id", "bbd02c47-7155-47e9-b72b-be6583cbff09"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
    let mut running = Running { child, directory };
    let mut input = running.child.stdin.take().unwrap();
    let output = running.child.stdout.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            if sender.send(serde_json::from_str::<Value>(&line.unwrap()).unwrap()).is_err() { return; }
        }
    });
    let identity = json!({"contract_version":1,"operation_id":"bbd02c47-7155-47e9-b72b-be6583cbff09","session_id":"7213a9bd-a39b-4d3b-b33c-c35408a53135"});
    let mut init = identity.clone();
    init["type"] = "init".into();
    init["url"] = "https://example.com/".into();
    init["extraction_script"] = script.into();
    init["platform"] = json!({"kind":"windows", "user_data_dir":running.directory});
    init["deadline_ms"] = 90_000.into();
    writeln!(input,"{init}").unwrap();
    input.flush().unwrap();
    let ready = receiver.recv_timeout(Duration::from_secs(20)).unwrap();
    assert_eq!(ready["type"], "ready", "native startup: {ready}");
    assert!(ready["browser_pid"].as_u64().unwrap() > 0);
    println!("actual Runtime {} browser PID {}", ready["runtime_version"], ready["browser_pid"]);
    let mut cancel = identity;
    cancel["type"] = "cancel".into();
    writeln!(input,"{cancel}").unwrap();
    input.flush().unwrap();
    let error = receiver.recv_timeout(Duration::from_secs(20)).unwrap();
    assert_eq!(error["code"], "WEB_CANCELLED", "native cancel: {error}");
    let closed = receiver.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(closed["type"], "closed");
    assert_eq!(closed["clean"], true, "actual browser exit: {closed}");
    assert!(!running.child.wait().unwrap().success());
    std::fs::remove_dir_all(&running.directory).expect("UDF released after BrowserProcessExited");
}

#[test]
#[ignore = "requires the actual installed Stable WebView2 Runtime"]
fn native_runtime_cancel_during_preparation_waits_for_browser_exit() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize().unwrap();
    let directory = root.join(".tmp").join(format!("native-prepare-cancel-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&directory).unwrap();
    let script = std::fs::read_to_string(root.join("app/src-tauri/resources/web/extract-article.js")).unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_frameq-webview-host")).args(["--operation-id", "bbd02c47-7155-47e9-b72b-be6583cbff09"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
    let mut running = Running { child, directory };
    let mut input = running.child.stdin.take().unwrap();
    let mut output = BufReader::new(running.child.stdout.take().unwrap());
    let base = json!({"contract_version":1,"operation_id":"bbd02c47-7155-47e9-b72b-be6583cbff09","session_id":"7213a9bd-a39b-4d3b-b33c-c35408a53135"});
    let mut init = base.clone();
    init["type"] = "init".into(); init["url"] = "https://example.com/".into();
    init["extraction_script"] = script.into(); init["deadline_ms"] = 90_000.into();
    init["platform"] = json!({"kind":"windows", "user_data_dir":running.directory});
    let mut cancel = base; cancel["type"] = "cancel".into();
    writeln!(input, "{init}\n{cancel}").unwrap(); input.flush().unwrap();
    let mut error_seen = false;
    loop {
        let mut line = String::new();
        assert!(output.read_line(&mut line).unwrap() > 0);
        let record: Value = serde_json::from_str(&line).unwrap();
        match record["type"].as_str().unwrap() {
            "ready" => (),
            "error" => { assert_eq!(record["code"], "WEB_CANCELLED"); error_seen = true; }
            "closed" => { assert!(error_seen); assert_eq!(record["clean"], true); break; }
            kind => panic!("preparation cancellation emitted {kind}"),
        }
    }
    assert!(!running.child.wait().unwrap().success());
    std::fs::remove_dir_all(&running.directory).expect("preparation cancellation released UDF");
}
