use super::*;

fn request(url: &str) -> WebPageRequest {
    WebPageRequest { contract_version: 1, url: url.into(), operation_id: uuid::Uuid::new_v4().to_string() }
}

#[test]
fn web_task_identity_uses_standard_utc_date_and_fixed_contract_fields() {
    let now = time::Date::from_calendar_date(2026, time::Month::January, 2).unwrap()
        .with_hms(3, 4, 5).unwrap().assume_utc();
    let task_id = web_task_id(now).unwrap();
    let suffix = task_id.strip_prefix("20260102-030405-web-").unwrap();
    assert_eq!(suffix.len(), 16);
    assert!(suffix.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
    assert_ne!(web_task_id(now).unwrap(), task_id);
}

#[test]
fn pending_page_cancel_withdraws_admission_before_any_claim() {
    let operations = Arc::new(WebPageOperations::default());
    let input = request("https://quotes.toscrape.com/");
    OperationClaim::register(&operations, &input, "main").unwrap();
    assert_eq!(cancel_matching(&operations, &input.operation_id, "other").status, "not_running");
    assert_eq!(cancel_matching(&operations, &input.operation_id, "main").status, "cancelling");
    assert!(matches!(OperationClaim::adopt(operations, &input, "main"), Err(WebPageError::Cancelled)));
}

#[test]
fn page_admission_binds_complete_request_and_window_until_release() {
    let operations = Arc::new(WebPageOperations::default());
    let input = request("https://quotes.toscrape.com/");
    OperationClaim::register(&operations, &input, "main").unwrap();
    let mut changed = input.clone(); changed.url.push_str("js/");
    assert_eq!(OperationClaim::register(&operations, &changed, "main"), Err(WebPageError::RequestInvalid));
    assert!(matches!(OperationClaim::adopt(Arc::clone(&operations), &changed, "main"), Err(WebPageError::RequestInvalid)));
    assert!(matches!(OperationClaim::adopt(Arc::clone(&operations), &input, "other"), Err(WebPageError::RequestInvalid)));
    let claim = OperationClaim::adopt(Arc::clone(&operations), &input, "main").unwrap();
    assert_eq!(OperationClaim::register(&operations, &input, "main"), Err(WebPageError::AlreadyRunning));
    assert_eq!(cancel_matching(&operations, &input.operation_id, "main").status, "cancelling");
    assert!(claim.cancelled.load(Ordering::Acquire));
    drop(claim);
    assert!(operations.active.lock().unwrap().is_none());
}

#[test]
fn new_admission_replaces_only_unclaimed_metadata() {
    let operations = Arc::new(WebPageOperations::default());
    let old = request("https://quotes.toscrape.com/");
    let next = request("https://quotes.toscrape.com/js/");
    OperationClaim::register(&operations, &old, "main").unwrap();
    OperationClaim::register(&operations, &next, "main").unwrap();
    assert_eq!(cancel_matching(&operations, &old.operation_id, "main").status, "not_running");
    assert!(matches!(OperationClaim::adopt(Arc::clone(&operations), &old, "main"), Err(WebPageError::RequestInvalid)));
    let claim = OperationClaim::adopt(operations, &next, "main").unwrap();
    assert!(!claim.cancelled.load(Ordering::Acquire));
}

fn actual_paths() -> crate::RuntimePaths {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
    let config = repository.join("build/system-webview-acceptance").join(uuid::Uuid::new_v4().to_string());
    for name in ["outputs", "cache", "runtime", "models"] { fs::create_dir_all(config.join(name)).unwrap(); }
    crate::RuntimePaths { resource_dir: repository.join("app/src-tauri/resources"), user_data_dir: config }
}

#[test]
#[ignore = "requires the actual installed system WebView2, bundled worker and public network"]
fn real_system_webview_static_and_dynamic_notes_are_saved_and_reopened() {
    let paths = actual_paths();
    let operations = Arc::new(WebPageOperations::default());
    let supervisors = Arc::new(crate::ProcessSupervisors::default());
    let mut task_ids = Vec::new();
    for url in ["https://quotes.toscrape.com/?id=42&token=app-native-canary#part", "https://quotes.toscrape.com/js/"] {
        let result = run_web_page(&paths, request(url), Arc::clone(&operations), Arc::clone(&supervisors), "main".into(), ProgressRoute::None).unwrap();
        assert_eq!(serde_json::to_value(result.status).unwrap(), "completed");
        assert!(result.transcript.is_none());
        assert!(result.text.contains("Albert Einstein"));
        let id = result.task_id.as_ref().unwrap();
        let task = crate::task_manifest::SupportedTask::open(&paths.output_root().unwrap(), id).unwrap();
        assert!(result.validate_source_task(&task));
        assert!(!fs::read_to_string(task.task_dir().join("task.json")).unwrap().contains("app-native-canary"));
        drop(task);
        let detail = crate::history::load_history_detail_from_output_root(&paths.output_root().unwrap(),
            serde_json::from_value(serde_json::json!({"task_id":id})).unwrap()).unwrap();
        assert_eq!(detail.text, result.text); assert_eq!(detail.markdown, result.markdown);
        task_ids.push(id.clone());
        assert!(!supervisors.is_task_active());
    }
    assert_ne!(task_ids[0], task_ids[1]);
    assert_eq!(fs::read_dir(paths.cache_root().unwrap().join(".app-system-webviews")).unwrap().count(), 0);
    println!("system WebView saved: {}", serde_json::json!({"config":paths.user_data_dir,"tasks":task_ids}));
}

#[test]
#[ignore = "requires the actual installed system WebView2 and public network"]
fn real_system_webview_cancel_releases_lane_and_allows_another_note() {
    let paths = actual_paths();
    let operations = Arc::new(WebPageOperations::default());
    let supervisors = Arc::new(crate::ProcessSupervisors::default());
    let input = request("https://httpbin.org/delay/20");
    let id = input.operation_id.clone();
    let thread_paths = paths.clone(); let thread_ops = Arc::clone(&operations); let thread_supervisors = Arc::clone(&supervisors);
    let thread = std::thread::spawn(move || run_web_page(&thread_paths, input, thread_ops, thread_supervisors, "main".into(), ProgressRoute::None));
    let deadline = Instant::now() + Duration::from_secs(20);
    let root = paths.cache_root().unwrap().join(".app-system-webviews").join(&id);
    while !root.join("processes.json").exists() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(20)); }
    assert!(root.join("processes.json").exists());
    assert_eq!(cancel_matching(&operations, &id, "main").status, "cancelling");
    assert_eq!(thread.join().unwrap().unwrap_err(), "WEB_CANCELLED");
    assert!(!root.exists());
    assert!(!supervisors.is_task_active());
    let next = run_web_page(&paths, request("https://quotes.toscrape.com/js/"), operations, supervisors, "main".into(), ProgressRoute::None).unwrap();
    assert!(next.text.contains("Albert Einstein"));
}

#[test]
#[ignore = "requires the actual installed system WebView2, bundled worker and public network"]
fn real_system_webview_wechat_note_is_complete_saved_and_reopened() {
    let paths = actual_paths();
    let supervisors = Arc::new(crate::ProcessSupervisors::default());
    let result = run_web_page(&paths, request("https://mp.weixin.qq.com/s/C_TiIuY7ufTQMA43iZZpTg"),
        Arc::new(WebPageOperations::default()), Arc::clone(&supervisors), "main".into(), ProgressRoute::None).unwrap();
    assert_eq!(serde_json::to_value(result.status).unwrap(), "completed");
    assert!(result.transcript.is_none());
    assert!(result.text.contains("MOSS-Live"));
    assert!(result.text.contains("支撑起自然、连贯、聊天和执行任务两不误的智能交互，将成为下一个阶段的重点。"));
    assert!(result.text.contains("THE END"));
    let id = result.task_id.as_ref().unwrap();
    let task = crate::task_manifest::SupportedTask::open(&paths.output_root().unwrap(), id).unwrap();
    assert!(result.validate_source_task(&task));
    drop(task);
    let detail = crate::history::load_history_detail_from_output_root(&paths.output_root().unwrap(),
        serde_json::from_value(serde_json::json!({"task_id":id})).unwrap()).unwrap();
    assert_eq!(detail.text, result.text);
    assert_eq!(detail.markdown, result.markdown);
    assert!(!supervisors.is_task_active());
    assert_eq!(fs::read_dir(paths.cache_root().unwrap().join(".app-system-webviews")).unwrap().count(), 0);
    println!("actual WeChat note saved and reopened: text_bytes={} task={id}", result.text.len());
}

#[test]
#[ignore = "requires the actual installed system WebView2, bundled worker and public network"]
fn real_system_webview_requested_wechat_note_is_saved_and_reopened() {
    let paths = actual_paths();
    let supervisors = Arc::new(crate::ProcessSupervisors::default());
    let result = run_web_page(&paths, request("https://mp.weixin.qq.com/s/e59b93IR-W8lEOgQbxaShA"),
        Arc::new(WebPageOperations::default()), Arc::clone(&supervisors), "main".into(), ProgressRoute::None).unwrap();
    assert_eq!(serde_json::to_value(result.status).unwrap(), "completed");
    assert!(result.transcript.is_none());
    assert!(result.text.starts_with("Harness 已经很准了，为什么还需要一个 Agent Native Database"));
    assert!(result.text.contains("6.6 工程实现与产品定位"));
    assert!(result.text.contains("RAGFlow 的联合创始人"));
    assert!(result.text.contains("\n\nEND\n\n"));
    let id = result.task_id.as_ref().unwrap();
    let task = crate::task_manifest::SupportedTask::open(&paths.output_root().unwrap(), id).unwrap();
    assert!(result.validate_source_task(&task));
    drop(task);
    let detail = crate::history::load_history_detail_from_output_root(&paths.output_root().unwrap(),
        serde_json::from_value(serde_json::json!({"task_id":id})).unwrap()).unwrap();
    assert_eq!(detail.text, result.text);
    assert_eq!(detail.markdown, result.markdown);
    assert!(!supervisors.is_task_active());
    assert_eq!(fs::read_dir(paths.cache_root().unwrap().join(".app-system-webviews")).unwrap().count(), 0);
    println!("requested WeChat note saved and reopened: config={} text_bytes={} task={id}", paths.user_data_dir.display(), result.text.len());
}
