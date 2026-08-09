use super::super::progress::{
    inspect_progress_line, inspect_stderr_line, ProgressProtocol, ProgressRecord, StderrRecord,
};
use super::super::{ProgressRoute, RunnerHooks, WorkerLane, WorkerOperation, WorkerRunOutcome};
use super::fixtures::{test_paths, watchdog_fixture_request};

const VALID_DIAGNOSTIC: &str = r#"FRAMEQ_DIAGNOSTIC {"version":1,"operation":"download_asr_model","phase":"primary_model","category":"network","code":"connection_timeout","exception_type":"ReadTimeout"}"#;

#[test]
fn progress_protocols_validate_before_routing_and_drop_invalid_payloads() {
    let worker = inspect_progress_line(
        ProgressProtocol::Worker,
        r#"FRAMEQ_PROGRESS {"stage":"video_extracting","progress":22,"message_code":"video.download.preparing"}"#,
    );
    let model = inspect_progress_line(
        ProgressProtocol::AsrModelDownload,
        r#"FRAMEQ_MODEL_DOWNLOAD {"status":"started","progress":0,"message_code":"model.download.preparing","message_args":{"model":"iic/SenseVoiceSmall"}}"#,
    );
    let invalid = inspect_progress_line(
        ProgressProtocol::Worker,
        r#"FRAMEQ_PROGRESS {"stage":"video_extracting","progress":22,"message_code":"unknown.action.state"}"#,
    );
    let ignored_by_none = inspect_progress_line(
        ProgressProtocol::None,
        r#"FRAMEQ_PROGRESS {"stage":"video_extracting","progress":22,"message_code":"video.download.preparing"}"#,
    );

    assert!(matches!(
        worker,
        ProgressRecord::Validated(value) if value["message_code"] == "video.download.preparing"
    ));
    assert!(matches!(
        model,
        ProgressRecord::Validated(value) if value["status"] == "started"
    ));
    assert_eq!(
        invalid,
        ProgressRecord::Invalid("message_code=unknown.action.state".to_string())
    );
    assert_eq!(ignored_by_none, ProgressRecord::Diagnostic);
}

#[test]
fn diagnostic_protocol_is_distinct_from_progress_and_accepts_only_closed_events() {
    let valid = inspect_stderr_line(ProgressProtocol::AsrModelDownload, VALID_DIAGNOSTIC);
    let ordinary = inspect_stderr_line(
        ProgressProtocol::AsrModelDownload,
        "model downloader unavailable",
    );

    assert!(matches!(valid, StderrRecord::ValidatedDiagnostic(_)));
    assert_eq!(ordinary, StderrRecord::Diagnostic);
}

#[test]
fn diagnostic_protocol_rejects_untrusted_shapes_without_echoing_input() {
    let secret = "PRIVATE_DIAGNOSTIC_SENTINEL";
    let invalid = [
        format!(r#"FRAMEQ_DIAGNOSTIC {{not-json-{secret}"#),
        r#"FRAMEQ_DIAGNOSTIC {"version":1,"version":1,"operation":"download_asr_model","phase":"preparing","category":"unexpected","code":"unexpected_failure"}"#.to_string(),
        r#"FRAMEQ_DIAGNOSTIC {"version":1,"operation":"download_asr_model","phase":"preparing","category":"unexpected","code":"unexpected_failure","unknown":1}"#.to_string(),
        r#"FRAMEQ_DIAGNOSTIC {"version":1,"operation":"download_asr_model","phase":"preparing","category":"unexpected","code":"unexpected_failure","message":"private"}"#.to_string(),
        r#"FRAMEQ_DIAGNOSTIC {"version":1,"operation":"download_asr_model","phase":"unknown","category":"unexpected","code":"unexpected_failure"}"#.to_string(),
        r#"FRAMEQ_DIAGNOSTIC {"version":1,"operation":"download_asr_model","phase":"preparing","category":"network","code":"tls_handshake_failed"}"#.to_string(),
        r#"FRAMEQ_DIAGNOSTIC {"version":1,"operation":"download_asr_model","phase":"preparing","category":"http","code":"http_status_failed","http_status":99}"#.to_string(),
        r#"FRAMEQ_DIAGNOSTIC {"version":1,"operation":"download_asr_model","phase":"preparing","category":"unexpected","code":"unexpected_failure","os_error_code":5}"#.to_string(),
        format!(
            r#"FRAMEQ_DIAGNOSTIC {{"version":1,"operation":"download_asr_model","phase":"preparing","category":"unexpected","code":"unexpected_failure","exception_type":"A{}"}}"#,
            "x".repeat(80)
        ),
        format!("FRAMEQ_DIAGNOSTIC {}", "x".repeat(1_001)),
    ];

    for line in invalid {
        let record = inspect_stderr_line(ProgressProtocol::AsrModelDownload, &line);
        assert_eq!(record, StderrRecord::InvalidDiagnostic);
        let rendered = format!("{record:?}");
        assert_eq!(rendered, "InvalidDiagnostic");
        assert!(!rendered.contains(secret));
    }
}

#[test]
fn diagnostic_prefix_is_reserved_independently_of_progress_route() {
    for protocol in [
        ProgressProtocol::None,
        ProgressProtocol::Worker,
        ProgressProtocol::AsrModelDownload,
    ] {
        assert!(matches!(
            inspect_stderr_line(protocol, VALID_DIAGNOSTIC),
            StderrRecord::ValidatedDiagnostic(_)
        ));
        assert_eq!(
            inspect_stderr_line(protocol, "FRAMEQ_DIAGNOSTIC {not-json"),
            StderrRecord::InvalidDiagnostic
        );
    }
}

#[test]
fn ordinary_stderr_persistence_is_capability_scoped_to_model_download() {
    let secret = "ordinary downloader host download.internal.example";
    for operation in [
        WorkerOperation::ProcessVideo,
        WorkerOperation::ProcessLocalMedia,
        WorkerOperation::RetryInsights,
        WorkerOperation::ResolveSourceIdentity,
        WorkerOperation::DownloadAsrModel,
    ] {
        let paths = test_paths(&format!("stderr-scope-{operation:?}"));
        #[cfg(windows)]
        let script = format!("[Console]::Error.WriteLine('{secret}'); exit 1");
        #[cfg(unix)]
        let script = format!("printf '%s\\n' '{secret}' >&2; exit 1");
        let outcome = WorkerLane::default()
            .run_with_hooks(
                &paths,
                watchdog_fixture_request(operation, ProgressRoute::None, script, None),
                RunnerHooks::default(),
            )
            .expect("missing terminal output is an unstructured failure");
        assert!(matches!(outcome, WorkerRunOutcome::UnstructuredFailure(_)));

        let log_path = paths
            .user_data_dir
            .join("logs")
            .join("asr-model-download.log");
        if operation == WorkerOperation::DownloadAsrModel {
            let log = std::fs::read_to_string(log_path).expect("ASR fallback log exists");
            assert!(log.contains("fallback"));
            assert!(!log.contains("download.internal.example"));
        } else {
            assert!(!log_path.exists(), "{operation:?} must not persist stderr");
        }
    }
}

#[test]
fn invalid_diagnostic_is_persisted_only_as_a_fixed_rejection() {
    let paths = test_paths("invalid-diagnostic-rejection");
    let secret = "PRIVATE_REJECTION_SENTINEL";
    #[cfg(windows)]
    let script =
        format!("[Console]::Error.WriteLine('FRAMEQ_DIAGNOSTIC {{not-json-{secret}}}'); exit 1");
    #[cfg(unix)]
    let script = format!("printf '%s\\n' 'FRAMEQ_DIAGNOSTIC {{not-json-{secret}}}' >&2; exit 1");

    let _ = WorkerLane::default()
        .run_with_hooks(
            &paths,
            watchdog_fixture_request(
                WorkerOperation::DownloadAsrModel,
                ProgressRoute::None,
                script,
                None,
            ),
            RunnerHooks::default(),
        )
        .expect("missing terminal output is an unstructured failure");

    let log = std::fs::read_to_string(
        paths
            .user_data_dir
            .join("logs")
            .join("asr-model-download.log"),
    )
    .expect("rejection log exists");
    assert!(log.contains("\"kind\":\"rejected\""));
    assert!(!log.contains(secret));
    assert!(!log.contains("not-json"));
}
