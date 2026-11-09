use app_webview_host::policy::{permitted_url, public_ip};
use serde_json::{json, Value};
use std::{io::{BufRead, BufReader, Write}, net::ToSocketAddrs, path::PathBuf, process::{Child, ChildStdin, Command, Stdio}, sync::{Arc, Mutex, mpsc::{self, Receiver}}, thread::JoinHandle, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};

const WECHAT_ARTICLE: &str = "https://mp.weixin.qq.com/s/C_TiIuY7ufTQMA43iZZpTg";
const WECHAT_TITLE: &str = "多项指标排名第一，全双工实时交互系统MOSS-Live发布";

struct Running {
    child: Child,
    directory: PathBuf,
    input: Arc<Mutex<ChildStdin>>,
    output: Receiver<Value>,
    identity: Value,
    resolvers: Vec<JoinHandle<()>>,
}

impl Running {
    fn launch(url: &str) -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize().unwrap();
        let directory = root.join(".tmp").join(format!("native-host-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&directory).unwrap();
        let script = std::fs::read_to_string(root.join("app/src-tauri/resources/web/extract-article.js")).expect("build the production extractor first");
        let mut child = Command::new(env!("CARGO_BIN_EXE_app-webview-host")).args(["--operation-id", "bbd02c47-7155-47e9-b72b-be6583cbff09"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let input = child.stdin.take().unwrap();
        let output = child.stdout.take().unwrap();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                if sender.send(serde_json::from_str::<Value>(&line.unwrap()).unwrap()).is_err() { return; }
            }
        });
        let identity = json!({"contract_version":1,"operation_id":"bbd02c47-7155-47e9-b72b-be6583cbff09","session_id":"7213a9bd-a39b-4d3b-b33c-c35408a53135"});
        let mut running = Self { child, directory, input: Arc::new(Mutex::new(input)), output: receiver, identity, resolvers: Vec::new() };
        let init = json!({"type":"init", "url":url, "extraction_script":script,
            "platform":{"kind":"windows", "user_data_dir":running.directory}, "deadline_ms":90000});
        running.send(init);
        let ready = running.next();
        assert_eq!(ready["type"], "ready", "native startup: {ready}");
        assert!(ready["browser_pid"].as_u64().unwrap() > 0);
        println!("actual Runtime {} browser PID {}", ready["runtime_version"], ready["browser_pid"]);
        running
    }

    fn send(&mut self, mut value: Value) {
        for (key, item) in self.identity.as_object().unwrap() { value[key] = item.clone(); }
        let mut input = self.input.lock().unwrap();
        writeln!(input,"{value}").unwrap();
        input.flush().unwrap();
    }

    fn next(&self) -> Value {
        self.output.recv_timeout(Duration::from_secs(20)).expect("native host response before deadline")
    }

    fn finish(&mut self, expected_success: bool) {
        let closed = self.next();
        assert_eq!(closed["type"], "closed");
        assert_eq!(closed["clean"], true, "actual browser exit: {closed}");
        assert_eq!(self.child.wait().unwrap().success(), expected_success);
        for resolver in self.resolvers.drain(..) { resolver.join().expect("real DNS worker completed"); }
        std::fs::remove_dir_all(&self.directory).expect("UDF released after BrowserProcessExited");
    }

    fn permit_using_real_dns(&mut self, request: &Value) {
        let raw = request["url"].as_str().expect("request URL");
        assert!(permitted_url(raw));
        let url = url::Url::parse(raw).unwrap();
        let target = (url.host_str().unwrap().trim_matches(['[', ']']).to_owned(), url.port_or_known_default().unwrap());
        let request = request.clone();
        let identity = self.identity.clone();
        let input = Arc::clone(&self.input);
        self.resolvers.push(std::thread::spawn(move || {
            let (sender, receiver) = mpsc::channel();
            std::thread::spawn(move || { let _ = sender.send(target.to_socket_addrs().map(|addresses| addresses.collect::<Vec<_>>())); });
            let error = match receiver.recv_timeout(Duration::from_millis(1500)) {
                Ok(Ok(addresses)) if !addresses.is_empty() && addresses.iter().all(|address| public_ip(address.ip())) => None,
                Ok(Ok(addresses)) if !addresses.is_empty() => Some("WEB_URL_BLOCKED"),
                Ok(_) => Some("WEB_LOAD_FAILED"),
                Err(_) => Some("WEB_NETWORK_POLICY_TIMEOUT"),
            };
            let mut value = json!({"type":"policy_decision", "request_id":request["request_id"], "navigation_generation":request["navigation_generation"], "allow":error.is_none(), "error":error});
            for (key, item) in identity.as_object().unwrap() { value[key] = item.clone(); }
            let mut input = input.lock().unwrap();
            let _ = writeln!(input,"{value}").and_then(|_| input.flush());
        }));
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let cancel = json!({"type":"cancel", "contract_version":1, "operation_id":self.identity["operation_id"], "session_id":self.identity["session_id"]});
            {
                let mut input = self.input.lock().unwrap();
                let _ = writeln!(input,"{cancel}");
                let _ = input.flush();
            }
            let began = Instant::now();
            while self.child.try_wait().ok().flatten().is_none() && began.elapsed() < Duration::from_secs(17) {
                std::thread::sleep(Duration::from_millis(10));
            }
            if self.child.try_wait().ok().flatten().is_none() {
                self.child.kill().expect("terminate owned helper after failed test");
                self.child.wait().expect("reap owned helper");
            }
        }
    }
}

#[test]
#[ignore = "requires the actual installed Stable WebView2 Runtime and public Internet"]
fn native_runtime_extracts_real_static_public_article() {
    extract_public("https://example.com/", "Example Domain", "This domain");
}

#[test]
#[ignore = "requires the actual installed Stable WebView2 Runtime and public Internet"]
fn native_runtime_extracts_real_javascript_generated_article() {
    extract_public("https://quotes.toscrape.com/js/", "Quotes to Scrape", "Albert Einstein");
}

#[test]
#[ignore = "requires the actual installed Stable WebView2 Runtime and public Internet"]
fn native_runtime_extracts_real_wechat_article_with_many_resources() {
    let (article, requests) = extract_public(WECHAT_ARTICLE, WECHAT_TITLE, "MOSS-Live");
    assert!(requests > 100, "actual article must exercise the previous cumulative request limit, observed {requests}");
    let text = article["text"].as_str().unwrap();
    assert!(text.contains("支撑起自然、连贯、聊天和执行任务两不误的智能交互，将成为下一个阶段的重点。"));
    assert!(text.contains("© THE END"));
}

fn extract_public(url: &str, expected_title: &str, expected_text: &str) -> (Value, usize) {
    extract_with_resource_policy(url, expected_title, expected_text, false)
}

fn extract_with_resource_policy(url: &str, expected_title: &str, expected_text: &str, deny_report: bool) -> (Value, usize) {
    let mut running = Running::launch(url);
    running.send(json!({"type":"start"}));
    let mut requests = 0;
    let mut denied = false;
    loop {
        let value = running.next();
        match value["type"].as_str().unwrap() {
            "policy_check" => {
                requests += 1;
                let telemetry = value["kind"] == "resource" && url::Url::parse(value["url"].as_str().unwrap()).unwrap().path() == "/mp/appmsgreport";
                if deny_report && !denied && telemetry {
                    denied = true;
                    running.send(json!({"type":"policy_decision", "request_id":value["request_id"], "navigation_generation":value["navigation_generation"], "allow":false, "error":"WEB_URL_BLOCKED"}));
                } else { running.permit_using_real_dns(&value); }
            }
            "stage" => (),
            "article" => {
                assert!(requests > 0, "native resources passed actual DNS policy");
                assert_eq!(value["title"], expected_title);
                assert!(value["text"].as_str().unwrap().contains(expected_text));
                assert!(!value["markdown"].as_str().unwrap().is_empty());
                assert_eq!(denied, deny_report, "actual resource refusal must be exercised");
                println!("actual article title={} bytes={} requests={requests}", value["title"], value["text"].as_str().unwrap().len());
                running.finish(true);
                return (value, requests);
            }
            "error" => panic!("native public extraction: {value}"),
            kind => panic!("unexpected native event {kind}"),
        }
    }
}

#[test]
#[ignore = "requires the actual installed Stable WebView2 Runtime and public Internet"]
fn native_runtime_preserves_complete_article_when_telemetry_is_denied() {
    let (baseline, _) = extract_public(WECHAT_ARTICLE, WECHAT_TITLE, "MOSS-Live");
    let (article, requests) = extract_with_resource_policy(WECHAT_ARTICLE, WECHAT_TITLE, "MOSS-Live", true);
    assert!(requests > 100);
    assert!(article["text"].as_str().unwrap().contains("支撑起自然、连贯、聊天和执行任务两不误的智能交互，将成为下一个阶段的重点。"));
    assert!(article["text"].as_str().unwrap().contains("© THE END"));
    let core = |value: &Value| {
        let text = value["text"].as_str().unwrap().chars().filter(|ch| !ch.is_whitespace()).collect::<String>();
        let start = text.find("还记得电影《Her》里的Samantha吗？").expect("actual article opening paragraph");
        let end = text.find("©THEEND").expect("actual article ending");
        text[start..end].to_owned()
    };
    let expected = core(&baseline);
    let actual = core(&article);
    let prefix = expected.chars().zip(actual.chars()).take_while(|(left, right)| left == right).count();
    assert!(expected == actual, "article core changed after refusal: expected={} actual={} common_prefix={}", expected.len(), actual.len(), prefix);
}

#[test]
#[ignore = "requires the actual installed Stable WebView2 Runtime"]
fn native_runtime_main_policy_denial_is_fatal_and_releases_browser() {
    let mut running = Running::launch("https://example.com/");
    running.send(json!({"type":"start"}));
    let mut denied = false;
    loop {
        let value = running.next();
        match value["type"].as_str().unwrap() {
            "policy_check" => {
                assert_eq!(value["kind"], "navigation");
                assert!(!denied);
                denied = true;
                running.send(json!({"type":"policy_decision", "request_id":value["request_id"], "navigation_generation":value["navigation_generation"], "allow":false, "error":"WEB_URL_BLOCKED"}));
            }
            "stage" => (),
            "error" => {
                assert!(denied);
                assert_eq!(value["code"], "WEB_URL_BLOCKED");
                running.finish(false);
                break;
            }
            kind => panic!("main refusal emitted unexpected event {kind}"),
        }
    }
}

#[test]
#[ignore = "requires the actual installed Stable WebView2 Runtime and public Internet"]
fn native_runtime_cancel_with_full_policy_window_releases_queued_requests() {
    let mut running = Running::launch(WECHAT_ARTICLE);
    running.send(json!({"type":"start"}));
    let mut pending = 0;
    let mut cancelled = false;
    loop {
        let value = running.next();
        match value["type"].as_str().unwrap() {
            "policy_check" if value["kind"] == "navigation" => running.permit_using_real_dns(&value),
            "policy_check" => {
                assert!(!cancelled, "no queued checks may start after cancellation");
                pending += 1;
                assert!(pending <= 16, "only sixteen actual checks may be in flight");
                if pending == 16 {
                    assert!(matches!(running.output.recv_timeout(Duration::from_millis(50)), Err(mpsc::RecvTimeoutError::Timeout)), "excess resource checks must wait in the host queue");
                    running.send(json!({"type":"cancel"}));
                    cancelled = true;
                }
            }
            "stage" => (),
            "error" => {
                assert!(cancelled);
                assert_eq!(pending, 16);
                assert_eq!(value["code"], "WEB_CANCELLED");
                running.finish(false);
                break;
            }
            kind => panic!("queued cancellation emitted unexpected event {kind}"),
        }
    }
}

#[test]
#[ignore = "requires the actual installed Stable WebView2 Runtime"]
fn native_runtime_blocks_unanswered_resource_policy_and_closes() {
    let mut running = Running::launch("https://example.com/");
    running.send(json!({"type":"start"}));
    let mut checks = 0;
    loop {
        let value = running.next();
        match value["type"].as_str().unwrap() {
            "policy_check" => checks += 1,
            "stage" => (),
            "error" => { assert!(checks > 0); assert_eq!(value["code"], "WEB_NETWORK_POLICY_TIMEOUT"); running.finish(false); break; }
            kind => panic!("unexpected native event {kind}"),
        }
    }
}
