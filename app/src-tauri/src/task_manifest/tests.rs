use super::{
    parse_insight_view,
    schema::{TaskManifest, TaskManifestError},
    storage::validate_task_artifact_path,
    SourceIdentity, SupportedTask, TaskArtifact,
};
use serde_json::json;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn task_error_code_and_message_never_echo_source_credentials() {
    let error = TaskManifestError {
        code: "xsec_token=review-secret".to_string(),
        message: "failed https://example.test/?xsec_token=review-secret".to_string(),
        stage: "video_extracting".to_string(),
    };

    assert_eq!(error.safe_code(), "TASK_FAILED");
    let message = error.safe_message();
    assert!(!message.contains("review-secret"));
    assert!(!message.contains("xsec_token"));
}

#[test]
fn safe_source_identity_requires_current_schema_marker_and_matching_source_url() {
    let base = json!({
        "schema_version": 3,
        "source_privacy_migration_version": 2,
        "task_id": "task",
        "created_at": "2026-07-10T12:00:00Z",
        "source_url": "https://www.youtube.com/watch?v=abcDEF_123-",
        "source_identity": {
            "version": 1,
            "platform": "youtube",
            "stable_id": "abcDEF_123-",
            "effective_part": null,
            "canonical_url": "https://www.youtube.com/watch?v=abcDEF_123-"
        },
        "status": "completed"
    });
    let ready: TaskManifest = serde_json::from_value(base.clone()).expect("ready manifest");
    assert!(ready.safe_source_identity().is_some());

    let mut missing_marker = base.clone();
    missing_marker["source_privacy_migration_version"] = json!(0);
    let missing_marker: TaskManifest =
        serde_json::from_value(missing_marker).expect("manifest without marker");
    assert!(missing_marker.safe_source_identity().is_none());

    let mut legacy_schema = base.clone();
    legacy_schema["schema_version"] = json!(2);
    let legacy_schema: TaskManifest =
        serde_json::from_value(legacy_schema).expect("legacy manifest");
    assert!(legacy_schema.safe_source_identity().is_none());
    assert!(!legacy_schema.source_privacy_ready());

    let mut mismatched = base;
    mismatched["source_url"] =
        json!("https://www.youtube.com/watch?v=abcDEF_123-&signature=review-secret");
    let mismatched: TaskManifest = serde_json::from_value(mismatched).expect("mismatched manifest");
    assert!(mismatched.safe_source_identity().is_none());
}

#[test]
fn source_identity_accepts_only_canonical_query_contract() {
    let identity = SourceIdentity {
        version: 1,
        platform: "youtube".to_string(),
        stable_id: "abcDEF_123-".to_string(),
        effective_part: None,
        canonical_url: "https://www.youtube.com/watch?v=abcDEF_123-".to_string(),
    };
    assert!(identity.is_safe());

    let noncanonical_path = SourceIdentity {
        canonical_url: "https://www.youtube.com/shorts/abcDEF_123-".to_string(),
        ..identity.clone()
    };
    assert!(!noncanonical_path.is_safe());

    let extra_query = SourceIdentity {
        canonical_url: "https://www.youtube.com/watch?v=abcDEF_123-&feature=share".to_string(),
        ..identity.clone()
    };
    assert!(!extra_query.is_safe());

    let youtube_with_part = SourceIdentity {
        effective_part: Some(2),
        ..identity.clone()
    };
    assert!(!youtube_with_part.is_safe());

    let sensitive = SourceIdentity {
        canonical_url: "https://www.youtube.com/watch?v=abcDEF_123-&signature=review-secret"
            .to_string(),
        ..identity.clone()
    };
    assert!(!sensitive.is_safe());

    let abbreviated_signature = SourceIdentity {
        canonical_url: "https://www.youtube.com/shorts/abcDEF_123-?s=review-secret".to_string(),
        ..identity.clone()
    };
    assert!(!abbreviated_signature.is_safe());

    let suspicious_value = SourceIdentity {
        canonical_url: "https://www.youtube.com/shorts/abcDEF_123-?source=review-secret"
            .to_string(),
        ..identity.clone()
    };
    assert!(!suspicious_value.is_safe());

    let wrong_host = SourceIdentity {
        canonical_url: "https://youtube.example/shorts/abcDEF_123-".to_string(),
        ..identity
    };
    assert!(!wrong_host.is_safe());

    let forged_xhs = SourceIdentity {
        version: 1,
        platform: "xiaohongshu".to_string(),
        stable_id: "xsec_token-review-secret".to_string(),
        effective_part: None,
        canonical_url: ("https://www.xiaohongshu.com/explore/xsec_token-review-secret").to_string(),
    };
    assert!(!forged_xhs.is_safe());

    let bilibili_part = SourceIdentity {
        version: 1,
        platform: "bilibili".to_string(),
        stable_id: "BV1Aa411c7mD".to_string(),
        effective_part: Some(2),
        canonical_url: "https://www.bilibili.com/video/BV1Aa411c7mD?p=2".to_string(),
    };
    assert!(bilibili_part.is_safe());

    let mismatched_part = SourceIdentity {
        effective_part: Some(3),
        ..bilibili_part.clone()
    };
    assert!(!mismatched_part.is_safe());

    let part_one_query = SourceIdentity {
        effective_part: Some(1),
        canonical_url: "https://www.bilibili.com/video/BV1Aa411c7mD?p=1".to_string(),
        ..bilibili_part.clone()
    };
    assert!(!part_one_query.is_safe());

    let xiaohongshu_query = SourceIdentity {
        version: 1,
        platform: "xiaohongshu".to_string(),
        stable_id: "64a1b2c3d4e5f67890123456".to_string(),
        effective_part: None,
        canonical_url: "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456?foo=bar"
            .to_string(),
    };
    assert!(!xiaohongshu_query.is_safe());
}

#[test]
fn manifest_round_trip_preserves_unknown_fields() {
    let value = json!({
        "schema_version": 3,
        "source_privacy_migration_version": 2,
        "task_id": "task",
        "created_at": "2026-07-10T12:00:00Z",
        "source_url": "",
        "status": "completed",
        "future_worker_field": {"enabled": true}
    });
    let manifest: TaskManifest = serde_json::from_value(value).expect("manifest");
    let encoded = serde_json::to_value(manifest).expect("encoded manifest");
    assert_eq!(encoded["future_worker_field"]["enabled"], true);
}

#[test]
fn edit_session_preserves_unknown_fields_and_rejects_unsafe_paths_without_echo() {
    let output_root = temp_dir("task-edit-session-characterization");
    let task_id = "20260721-120000-youtube-dQw4w9WgXcQ";
    let task_dir = write_supported_task(&output_root, task_id, "dQw4w9WgXcQ");
    let manifest_path = task_dir.join(super::TASK_MANIFEST_FILE_NAME);
    let mut payload: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&manifest_path).expect("read manifest"))
            .expect("parse manifest");
    payload["future_worker_field"] = json!({"enabled": true});
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&payload).expect("encode manifest") + "\n",
    )
    .expect("write manifest");

    let task = SupportedTask::open(&output_root, task_id).expect("open supported task");
    let mut edit = task.into_edit_session();
    let error = edit
        .set_artifact(TaskArtifact::TranscriptMd, "../xsec_token=review-secret.md")
        .expect_err("escaping artifact must fail");
    assert!(!error.contains("review-secret"));
    assert!(!error.contains("xsec_token"));

    edit.set_artifact(TaskArtifact::TranscriptMd, "transcript/transcript.md")
        .expect("set safe artifact");
    edit.set_text_preview("updated preview".to_string());
    edit.save().expect("save edit session");

    let bytes = fs::read(&manifest_path).expect("read saved manifest");
    assert!(bytes.ends_with(b"\n"));
    let saved: serde_json::Value = serde_json::from_slice(&bytes).expect("parse saved manifest");
    assert_eq!(saved["future_worker_field"]["enabled"], true);
    assert_eq!(
        saved["artifacts"]["transcript_md"],
        "transcript/transcript.md"
    );
    assert_eq!(saved["text_preview"], "updated preview");
}

#[test]
fn artifact_resolution_errors_never_echo_untrusted_field_or_path_material() {
    let task_dir = temp_dir("safe-artifact-resolution-error");
    let missing = task_dir.join("review-secret").join("missing.txt");

    let error = validate_task_artifact_path(&task_dir, &missing, "xsec_token=review-secret")
        .expect_err("missing artifact must fail");

    assert!(!error.contains("review-secret"));
    assert!(!error.contains("xsec_token"));
    assert!(!error.contains("missing.txt"));
}

#[test]
fn supported_task_opens_only_current_tasks_and_reads_validated_artifacts() {
    let output_root = temp_dir("supported-task-facade");
    let task_id = "20260718-120000-youtube-dQw4w9WgXcQ";
    write_supported_task(&output_root, task_id, "dQw4w9WgXcQ");

    let task = SupportedTask::open(&output_root, task_id).expect("open supported task");

    assert_eq!(task.task_id(), task_id);
    assert_eq!(
        task.safe_source_url(),
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    assert_eq!(
        task.read_text_artifact(TaskArtifact::TranscriptTxt)
            .expect("read transcript")
            .as_deref(),
        Some("facade transcript")
    );
    assert_eq!(
        task.existing_artifacts()["transcript_txt"],
        "transcript/transcript.txt"
    );
}

#[test]
fn supported_task_scan_isolates_corrupt_and_unsupported_manifests() {
    let output_root = temp_dir("supported-task-scan");
    write_supported_task(
        &output_root,
        "20260718-120000-youtube-dQw4w9WgXcQ",
        "dQw4w9WgXcQ",
    );
    let corrupt_dir = output_root.join("tasks").join("corrupt-task");
    fs::create_dir_all(&corrupt_dir).expect("create corrupt task");
    fs::write(corrupt_dir.join("frameq-task.json"), b"{not-json").expect("write corrupt manifest");
    let legacy_dir = output_root.join("tasks").join("legacy-task");
    fs::create_dir_all(&legacy_dir).expect("create legacy task");
    fs::write(
        legacy_dir.join("frameq-task.json"),
        r#"{"schema_version":2,"task_id":"legacy-task","created_at":"2026-07-18T12:00:00Z","status":"completed"}"#,
    )
    .expect("write legacy manifest");

    let scan = SupportedTask::scan(&output_root).expect("scan tasks");

    let ignored_count = scan.ignored_count();
    assert_eq!(scan.into_tasks().len(), 1);
    assert_eq!(ignored_count, 2);
}

#[test]
fn supported_task_artifact_errors_do_not_echo_manifest_path_material() {
    let output_root = temp_dir("supported-task-safe-artifact-error");
    let task_id = "20260718-120000-youtube-dQw4w9WgXcQ";
    let task_dir = write_supported_task(&output_root, task_id, "dQw4w9WgXcQ");
    let manifest_path = task_dir.join("frameq-task.json");
    let manifest = fs::read_to_string(&manifest_path).expect("read manifest");
    fs::write(
        &manifest_path,
        manifest.replace(
            "transcript/transcript.txt",
            "../xsec_token=review-secret.txt",
        ),
    )
    .expect("write unsafe artifact");

    let task = SupportedTask::open(&output_root, task_id).expect("open supported task");
    let error = task
        .read_text_artifact(TaskArtifact::TranscriptTxt)
        .expect_err("unsafe artifact must fail");

    assert!(!error.contains("review-secret"));
    assert!(!error.contains("xsec_token"));
}

#[test]
fn parse_insight_view_rejects_missing_required_fields() {
    let value = json!({
        "id": 1,
        "topic": "topic",
        "followUpQuestions": ["next"],
        "suitableUse": "content planning",
        "sourceChunkId": 7
    });

    assert!(parse_insight_view(&value).is_none());
}

#[test]
fn parse_insight_view_rejects_blank_required_fields() {
    let value = json!({
        "id": 1,
        "topic": "topic",
        "matchReason": " ",
        "followUpQuestions": ["next"],
        "suitableUse": "content planning",
        "sourceChunkId": 7
    });

    assert!(parse_insight_view(&value).is_none());
}

#[test]
fn parse_insight_view_requires_source_chunk_id_key() {
    let value = json!({
        "id": 1,
        "topic": "topic",
        "matchReason": "matched",
        "followUpQuestions": ["next"],
        "suitableUse": "content planning"
    });

    assert!(parse_insight_view(&value).is_none());
}

#[test]
fn parse_insight_view_accepts_explicit_null_source_chunk_id() {
    let value = json!({
        "id": 1,
        "topic": "topic",
        "matchReason": "matched",
        "followUpQuestions": ["next"],
        "suitableUse": "content planning",
        "sourceChunkId": null
    });

    let insight = parse_insight_view(&value).expect("parse insight");

    assert_eq!(insight.source_chunk_id, None);
}

#[test]
fn task_manifest_module_boundary_matches_approved_private_owners() {
    use std::path::Path;

    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let module_dir = src.join("task_manifest");
    let root = fs::read_to_string(src.join("task_manifest.rs")).expect("read root");
    let source_identity =
        fs::read_to_string(module_dir.join("source_identity.rs")).expect("read source owner");
    let schema = fs::read_to_string(module_dir.join("schema.rs")).expect("read schema owner");
    let storage = fs::read_to_string(module_dir.join("storage.rs")).expect("read storage owner");
    let access = fs::read_to_string(module_dir.join("access.rs")).expect("read access owner");
    let tests = fs::read_to_string(module_dir.join("tests.rs")).expect("read tests owner");

    assert!(
        root.lines().count() <= 100,
        "root must remain a narrow surface"
    );
    for declaration in [
        "mod access;",
        "mod schema;",
        "mod source_identity;",
        "mod storage;",
        "mod tests;",
    ] {
        assert!(root.contains(declaration), "missing {declaration}");
    }
    assert!(!root.contains("pub mod "));
    for forbidden in [
        "struct TaskManifest",
        "impl SupportedTask",
        "impl TaskEditSession",
        "Url::parse",
        "fs::read_to_string",
        "fs::write",
    ] {
        assert!(!root.contains(forbidden), "root owns {forbidden}");
    }

    assert!(source_identity.contains("pub(crate) struct SourceIdentity"));
    assert!(source_identity.contains("impl SourceIdentity"));
    assert!(schema.contains("struct TaskManifest"));
    assert!(schema.contains("pub(crate) enum TaskArtifact"));
    assert!(schema.contains("pub(crate) fn parse_insights_payload"));
    assert!(storage.contains("fn load_task_manifest"));
    assert!(storage.contains("pub(crate) fn configured_output_root"));
    assert!(storage.contains("pub(crate) fn is_link_or_reparse_point"));
    assert!(access.contains("pub(crate) struct SupportedTask"));
    assert!(access.contains("pub(crate) struct TaskEditSession"));
    assert!(tests.contains("edit_session_preserves_unknown_fields"));

    for pure_owner in [&source_identity, &schema] {
        assert!(!pure_owner.contains("std::fs"));
        assert!(!pure_owner.contains("RuntimePaths"));
        assert!(!pure_owner.contains("settings::"));
    }
    assert!(!access.contains("RuntimePaths"));
    assert!(!access.contains("settings::"));
    for child in [&source_identity, &schema, &storage, &access] {
        for forbidden in [
            "tauri::",
            "crate::history",
            "crate::history_deletion",
            "crate::transcript_detail",
            "crate::video_processing",
            "crate::worker_runtime",
            "crate::diagnostics",
        ] {
            assert!(!child.contains(forbidden), "child imports {forbidden}");
        }
    }

    let stable_root = src.join("task_manifest.rs");
    let mut rust_sources = Vec::new();
    collect_rust_sources(&src, &mut rust_sources);
    for path in rust_sources {
        if path == stable_root || path.starts_with(&module_dir) {
            continue;
        }
        let production_source = fs::read_to_string(&path).expect("read production Rust source");
        for forbidden in [
            "task_manifest::source_identity",
            "task_manifest::schema",
            "task_manifest::storage",
            "task_manifest::access",
        ] {
            assert!(
                !production_source.contains(forbidden),
                "{} bypasses the stable root through {forbidden}",
                path.display()
            );
        }
    }
}

fn collect_rust_sources(dir: &std::path::Path, sources: &mut Vec<std::path::PathBuf>) {
    for entry in fs::read_dir(dir).expect("read Rust source directory") {
        let path = entry.expect("read Rust source entry").path();
        if path.is_dir() {
            collect_rust_sources(&path, sources);
        } else if path.extension().and_then(|value| value.to_str()) == Some("rs") {
            sources.push(path);
        }
    }
}

fn temp_dir(name: &str) -> std::path::PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("frameq-{name}-{unique}"));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn write_supported_task(
    output_root: &std::path::Path,
    task_id: &str,
    stable_id: &str,
) -> std::path::PathBuf {
    let task_dir = output_root.join("tasks").join(task_id);
    fs::create_dir_all(task_dir.join("transcript")).expect("create transcript dir");
    fs::write(
        task_dir.join("transcript").join("transcript.txt"),
        "facade transcript\n",
    )
    .expect("write transcript");
    fs::write(
        task_dir.join("frameq-task.json"),
        format!(
            r#"{{
  "schema_version": 3,
  "source_privacy_migration_version": 2,
  "source_privacy_quarantined": false,
  "task_id": "{task_id}",
  "created_at": "2026-07-18T12:00:00Z",
  "source_url": "https://www.youtube.com/watch?v={stable_id}",
  "source_identity": {{
"version": 1,
"platform": "youtube",
"stable_id": "{stable_id}",
"effective_part": null,
"canonical_url": "https://www.youtube.com/watch?v={stable_id}"
  }},
  "platform": "youtube",
  "status": "completed",
  "model": "iic/SenseVoiceSmall",
  "artifacts": {{"transcript_txt": "transcript/transcript.txt"}},
  "error": null,
  "text_preview": "facade transcript",
  "insights_count": 0
}}"#
        ),
    )
    .expect("write manifest");
    task_dir
}
