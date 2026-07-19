use super::runner::WorkerOperation;
use crate::task_manifest;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

pub(crate) const WORKER_PROTOCOL_VIOLATION: &str = "WORKER_PROTOCOL_VIOLATION";
pub(crate) const WORKER_PROTOCOL_MESSAGE: &str = "Worker result violated the terminal protocol.";
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const DEFAULT_ASR_MODEL: &str = "iic/SenseVoiceSmall";
const MODEL_DOWNLOAD_FAILED_MESSAGE: &str = "ASR model download failed.";
const MODEL_ARCHIVE_INVALID_MESSAGE: &str = "Downloaded ASR model archive was invalid.";

#[cfg(test)]
pub(crate) const TASK_RESULT_FIELDS: &[&str] = &[
    "status",
    "task_id",
    "task_dir",
    "artifacts",
    "text",
    "summary",
    "insights",
    "transcript",
    "error",
];
pub(crate) const TASK_ARTIFACT_KEYS: &[&str] = &[
    "video",
    "audio",
    "transcript_txt",
    "transcript_md",
    "segments",
    "summary",
    "mindmap",
    "insights",
    "insights_md",
    "preference_snapshot",
];
#[cfg(test)]
pub(crate) const TASK_INSIGHT_FIELDS: &[&str] = &[
    "id",
    "topic",
    "matchReason",
    "followUpQuestions",
    "suitableUse",
    "sourceChunkId",
];
#[cfg(test)]
pub(crate) const TASK_TERMINAL_STATUSES: &[&str] = &["completed", "partial_completed", "failed"];

#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct TerminalOperationFamilies {
    process_video: &'static str,
    retry_insights: &'static str,
    resolve_source_identity: &'static str,
    download_asr_model: &'static str,
}

#[cfg(test)]
pub(crate) const TERMINAL_OPERATION_FAMILIES: TerminalOperationFamilies =
    TerminalOperationFamilies {
        process_video: "task",
        retry_insights: "task",
        resolve_source_identity: "sourceIdentity",
        download_asr_model: "modelDownload",
    };

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskTerminalStatus {
    Completed,
    PartialCompleted,
    Failed,
}

impl TaskTerminalStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::PartialCompleted => "partial_completed",
            Self::Failed => "failed",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskErrorStage {
    WaitingInput,
    VideoExtracting,
    VideoTranscribing,
    InsightsGenerating,
    Completed,
    PartialCompleted,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TaskInsight {
    pub(crate) id: u64,
    pub(crate) topic: String,
    pub(crate) match_reason: String,
    pub(crate) follow_up_questions: Vec<String>,
    pub(crate) suitable_use: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub(crate) source_chunk_id: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskTranscriptSource {
    Asr,
    Subtitle,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TaskTranscript {
    pub(crate) source: TaskTranscriptSource,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub(crate) language: Option<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub(crate) engine: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TaskError {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) stage: TaskErrorStage,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TaskTerminalResult {
    pub(crate) status: TaskTerminalStatus,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub(crate) task_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub(crate) task_dir: Option<String>,
    pub(crate) artifacts: HashMap<String, String>,
    pub(crate) text: String,
    pub(crate) summary: String,
    pub(crate) insights: Vec<TaskInsight>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub(crate) transcript: Option<TaskTranscript>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub(crate) error: Option<TaskError>,
}

impl TaskTerminalResult {
    pub(crate) fn from_value(value: serde_json::Value) -> Result<Self, TerminalResultError> {
        let result = serde_json::from_value(value).map_err(|_| TerminalResultError::Invalid)?;
        validate_task_result(result)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SourceIdentityFailure {
    pub(crate) code: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum SourceIdentityTerminalResult {
    Completed {
        source_url: String,
        source_identity: task_manifest::SourceIdentity,
    },
    Failed {
        error: SourceIdentityFailure,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ModelDownloadTerminalResult {
    Completed { model: String },
    Failed { code: String, message: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ValidatedWorkerResult {
    Task(TaskTerminalResult),
    SourceIdentity(SourceIdentityTerminalResult),
    ModelDownload(ModelDownloadTerminalResult),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TerminalResultError {
    Missing,
    Invalid,
}

pub(crate) fn parse_terminal_result(
    operation: WorkerOperation,
    stdout: &[u8],
) -> Result<ValidatedWorkerResult, TerminalResultError> {
    let text = std::str::from_utf8(stdout).map_err(|_| TerminalResultError::Invalid)?;
    let mut lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
    let line = lines.next().ok_or(TerminalResultError::Missing)?;
    if lines.next().is_some() {
        return Err(TerminalResultError::Invalid);
    }

    match operation {
        WorkerOperation::ProcessVideo | WorkerOperation::RetryInsights => {
            let result = serde_json::from_str(line).map_err(|_| TerminalResultError::Invalid)?;
            validate_task_result(result).map(ValidatedWorkerResult::Task)
        }
        WorkerOperation::ResolveSourceIdentity => {
            parse_source_identity_result(line).map(ValidatedWorkerResult::SourceIdentity)
        }
        WorkerOperation::DownloadAsrModel => {
            parse_model_download_result(line).map(ValidatedWorkerResult::ModelDownload)
        }
    }
}

fn validate_task_result(
    result: TaskTerminalResult,
) -> Result<TaskTerminalResult, TerminalResultError> {
    let error_is_coherent = match result.status {
        TaskTerminalStatus::Completed => result.error.is_none(),
        TaskTerminalStatus::PartialCompleted | TaskTerminalStatus::Failed => result.error.is_some(),
    };
    let artifacts_are_known = result
        .artifacts
        .keys()
        .all(|key| TASK_ARTIFACT_KEYS.contains(&key.as_str()));
    let insights_are_safe = result.insights.iter().all(|insight| {
        insight.id <= MAX_SAFE_INTEGER
            && insight
                .source_chunk_id
                .is_none_or(|source_chunk_id| source_chunk_id <= MAX_SAFE_INTEGER)
    });
    let error_is_safe = result
        .error
        .as_ref()
        .is_none_or(|error| is_safe_error_code(&error.code));

    if error_is_coherent && artifacts_are_known && insights_are_safe && error_is_safe {
        Ok(result)
    } else {
        Err(TerminalResultError::Invalid)
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RawSourceIdentityTerminalResult {
    Completed(RawSourceIdentityCompleted),
    Failed(RawSourceIdentityFailed),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSourceIdentityCompleted {
    status: String,
    source_url: String,
    source_identity: RawSourceIdentity,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSourceIdentityFailed {
    status: String,
    error: RawSourceIdentityFailure,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSourceIdentityFailure {
    code: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSourceIdentity {
    version: u64,
    platform: SourcePlatform,
    stable_id: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    effective_part: Option<u64>,
    canonical_url: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum SourcePlatform {
    Douyin,
    Xiaohongshu,
    Bilibili,
    Youtube,
}

impl SourcePlatform {
    fn as_str(self) -> &'static str {
        match self {
            Self::Douyin => "douyin",
            Self::Xiaohongshu => "xiaohongshu",
            Self::Bilibili => "bilibili",
            Self::Youtube => "youtube",
        }
    }
}

fn parse_source_identity_result(
    line: &str,
) -> Result<SourceIdentityTerminalResult, TerminalResultError> {
    let raw: RawSourceIdentityTerminalResult =
        serde_json::from_str(line).map_err(|_| TerminalResultError::Invalid)?;
    match raw {
        RawSourceIdentityTerminalResult::Completed(completed) => {
            if completed.status != "completed" || completed.source_identity.version != 1 {
                return Err(TerminalResultError::Invalid);
            }
            let identity = task_manifest::SourceIdentity {
                version: completed.source_identity.version,
                platform: completed.source_identity.platform.as_str().to_string(),
                stable_id: completed.source_identity.stable_id,
                effective_part: completed.source_identity.effective_part,
                canonical_url: completed.source_identity.canonical_url,
            };
            if completed.source_url != identity.canonical_url || !identity.is_safe() {
                return Err(TerminalResultError::Invalid);
            }
            Ok(SourceIdentityTerminalResult::Completed {
                source_url: completed.source_url,
                source_identity: identity,
            })
        }
        RawSourceIdentityTerminalResult::Failed(failed) => {
            if failed.status != "failed" || !is_safe_error_code(&failed.error.code) {
                return Err(TerminalResultError::Invalid);
            }
            Ok(SourceIdentityTerminalResult::Failed {
                error: SourceIdentityFailure {
                    code: failed.error.code,
                },
            })
        }
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RawModelDownloadTerminalResult {
    Completed(RawModelDownloadCompleted),
    Failed(RawModelDownloadFailed),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawModelDownloadCompleted {
    status: String,
    model: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawModelDownloadFailed {
    status: String,
    code: String,
    message: String,
}

fn parse_model_download_result(
    line: &str,
) -> Result<ModelDownloadTerminalResult, TerminalResultError> {
    let raw: RawModelDownloadTerminalResult =
        serde_json::from_str(line).map_err(|_| TerminalResultError::Invalid)?;
    match raw {
        RawModelDownloadTerminalResult::Completed(completed) => {
            if completed.status != "completed" || completed.model != DEFAULT_ASR_MODEL {
                return Err(TerminalResultError::Invalid);
            }
            Ok(ModelDownloadTerminalResult::Completed {
                model: completed.model,
            })
        }
        RawModelDownloadTerminalResult::Failed(failed) => {
            if failed.status != "failed"
                || !is_safe_error_code(&failed.code)
                || !matches!(
                    failed.message.as_str(),
                    MODEL_DOWNLOAD_FAILED_MESSAGE | MODEL_ARCHIVE_INVALID_MESSAGE
                )
            {
                return Err(TerminalResultError::Invalid);
            }
            Ok(ModelDownloadTerminalResult::Failed {
                code: failed.code,
                message: failed.message,
            })
        }
    }
}

fn is_safe_error_code(code: &str) -> bool {
    let bytes = code.as_bytes();
    (1..=64).contains(&bytes.len())
        && bytes[0].is_ascii_uppercase()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || *byte == b'_')
}

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_terminal_result, ModelDownloadTerminalResult, SourceIdentityTerminalResult,
        TerminalResultError, ValidatedWorkerResult, TASK_ARTIFACT_KEYS, TASK_INSIGHT_FIELDS,
        TASK_RESULT_FIELDS, TASK_TERMINAL_STATUSES, TERMINAL_OPERATION_FAMILIES,
    };
    use crate::worker_runtime::runner::WorkerOperation;
    use serde_json::{json, Value};
    use std::collections::BTreeSet;

    #[test]
    fn task_operations_accept_only_complete_closed_task_results() {
        for operation in [
            WorkerOperation::ProcessVideo,
            WorkerOperation::RetryInsights,
        ] {
            let stdout = serde_json::to_vec(&valid_task_value()).expect("serialize task fixture");
            let parsed = parse_terminal_result(operation, &stdout).expect("valid task result");

            assert!(matches!(parsed, ValidatedWorkerResult::Task(_)));
        }

        let mut safe_unknown_code = valid_task_value();
        safe_unknown_code["status"] = json!("partial_completed");
        safe_unknown_code["error"] = json!({
            "code": "FUTURE_SAFE_CODE_2",
            "message": "A safe future failure.",
            "stage": "insights_generating"
        });
        assert!(matches!(
            parse_terminal_result(
                WorkerOperation::RetryInsights,
                &serde_json::to_vec(&safe_unknown_code).expect("serialize partial fixture"),
            ),
            Ok(ValidatedWorkerResult::Task(_))
        ));
    }

    #[test]
    fn task_results_reject_unknown_nested_fields_and_wrong_types() {
        let invalid_values = [
            mutate_task(|value| value["extra"] = json!("secret")),
            mutate_task(|value| value["artifacts"]["unknown"] = json!("secret")),
            mutate_task(|value| value["transcript"]["extra"] = json!(true)),
            mutate_task(|value| value["insights"][0]["extra"] = json!(true)),
            mutate_task(|value| {
                value["error"] = json!({
                    "code": "SAFE_CODE",
                    "message": "safe",
                    "stage": "video_extracting",
                    "extra": true
                })
            }),
            mutate_task(|value| value["artifacts"]["audio"] = json!(7)),
            mutate_task(|value| value["insights"][0]["id"] = json!("1")),
            mutate_task(|value| value["insights"][0]["id"] = json!(9_007_199_254_740_992_u64)),
            mutate_task(|value| value["insights"][0]["followUpQuestions"] = json!([1])),
            mutate_task(|value| value["insights"][0]["sourceChunkId"] = json!(-1)),
            mutate_task(|value| value["transcript"]["source"] = json!("generated")),
            mutate_task(|value| value["status"] = json!("running")),
        ];

        for value in invalid_values {
            assert_eq!(
                parse_terminal_result(
                    WorkerOperation::ProcessVideo,
                    &serde_json::to_vec(&value).expect("serialize invalid task"),
                ),
                Err(TerminalResultError::Invalid),
            );
        }
    }

    #[test]
    fn task_results_reject_unsafe_codes_and_incoherent_status_errors() {
        let invalid_values = [
            mutate_task(|value| {
                value["status"] = json!("failed");
                value["error"] = json!({
                    "code": "unsafe.code",
                    "message": "unsafe",
                    "stage": "video_extracting"
                });
            }),
            mutate_task(|value| {
                value["status"] = json!("failed");
                value["error"] = Value::Null;
            }),
            mutate_task(|value| {
                value["error"] = json!({
                    "code": "UNEXPECTED_ERROR",
                    "message": "unexpected",
                    "stage": "video_extracting"
                });
            }),
            mutate_task(|value| {
                value["status"] = json!("partial_completed");
                value["error"] = json!({
                    "code": "SAFE_CODE",
                    "message": "safe",
                    "stage": "cancelling"
                });
            }),
        ];

        for value in invalid_values {
            assert_eq!(
                parse_terminal_result(
                    WorkerOperation::ProcessVideo,
                    &serde_json::to_vec(&value).expect("serialize incoherent task"),
                ),
                Err(TerminalResultError::Invalid),
            );
        }
    }

    #[test]
    fn stdout_framing_requires_one_nonempty_utf8_json_line() {
        assert_eq!(
            parse_terminal_result(WorkerOperation::ProcessVideo, b" \r\n\t"),
            Err(TerminalResultError::Missing),
        );
        assert_eq!(
            parse_terminal_result(WorkerOperation::ProcessVideo, &[0xff, 0xfe]),
            Err(TerminalResultError::Invalid),
        );
        assert_eq!(
            parse_terminal_result(WorkerOperation::ProcessVideo, b"not-json"),
            Err(TerminalResultError::Invalid),
        );
        let line = serde_json::to_string(&valid_task_value()).expect("serialize task line");
        let multiple = format!("{line}\n{line}\n");
        assert_eq!(
            parse_terminal_result(WorkerOperation::ProcessVideo, multiple.as_bytes()),
            Err(TerminalResultError::Invalid),
        );
    }

    #[test]
    fn source_identity_results_are_closed_and_semantically_safe() {
        let completed = valid_source_identity_value();
        let parsed = parse_terminal_result(
            WorkerOperation::ResolveSourceIdentity,
            &serde_json::to_vec(&completed).expect("serialize source identity"),
        )
        .expect("valid source identity result");
        assert!(matches!(
            parsed,
            ValidatedWorkerResult::SourceIdentity(SourceIdentityTerminalResult::Completed { .. })
        ));

        let failed = json!({
            "status": "failed",
            "error": {"code": "SOURCE_IDENTITY_UNAVAILABLE"}
        });
        assert!(matches!(
            parse_terminal_result(
                WorkerOperation::ResolveSourceIdentity,
                &serde_json::to_vec(&failed).expect("serialize source failure"),
            ),
            Ok(ValidatedWorkerResult::SourceIdentity(
                SourceIdentityTerminalResult::Failed { .. }
            ))
        ));

        let invalid_values = [
            mutate_source(|value| value["extra"] = json!(true)),
            mutate_source(|value| value["source_identity"]["extra"] = json!(true)),
            mutate_source(|value| {
                value["source_url"] = json!("https://www.youtube.com/watch?v=aaaaaaaaaaa")
            }),
            mutate_source(|value| value["source_identity"]["platform"] = json!("unknown")),
            json!({"status": "failed", "error": {"code": "unsafe.code"}}),
        ];
        for value in invalid_values {
            assert_eq!(
                parse_terminal_result(
                    WorkerOperation::ResolveSourceIdentity,
                    &serde_json::to_vec(&value).expect("serialize invalid source"),
                ),
                Err(TerminalResultError::Invalid),
            );
        }
    }

    #[test]
    fn model_download_results_are_closed_and_use_fixed_messages() {
        let completed = json!({"status": "completed", "model": "iic/SenseVoiceSmall"});
        assert!(matches!(
            parse_terminal_result(
                WorkerOperation::DownloadAsrModel,
                &serde_json::to_vec(&completed).expect("serialize model success"),
            ),
            Ok(ValidatedWorkerResult::ModelDownload(
                ModelDownloadTerminalResult::Completed { .. }
            ))
        ));

        for message in [
            "ASR model download failed.",
            "Downloaded ASR model archive was invalid.",
        ] {
            let failed = json!({
                "status": "failed",
                "code": "FUTURE_SAFE_MODEL_CODE",
                "message": message
            });
            assert!(matches!(
                parse_terminal_result(
                    WorkerOperation::DownloadAsrModel,
                    &serde_json::to_vec(&failed).expect("serialize model failure"),
                ),
                Ok(ValidatedWorkerResult::ModelDownload(
                    ModelDownloadTerminalResult::Failed { .. }
                ))
            ));
        }

        let invalid_values = [
            json!({
                "status": "completed",
                "model": "iic/SenseVoiceSmall",
                "model_dir": "C:/review-secret"
            }),
            json!({"status": "completed", "model": "other/model"}),
            json!({
                "status": "failed",
                "code": "ASR_MODEL_DOWNLOAD_FAILED",
                "message": "raw review-secret exception"
            }),
            json!({
                "status": "failed",
                "code": "unsafe.code",
                "message": "ASR model download failed."
            }),
        ];
        for value in invalid_values {
            assert_eq!(
                parse_terminal_result(
                    WorkerOperation::DownloadAsrModel,
                    &serde_json::to_vec(&value).expect("serialize invalid model"),
                ),
                Err(TerminalResultError::Invalid),
            );
        }
    }

    #[test]
    fn operation_mismatch_is_rejected_instead_of_reinterpreted() {
        let task = serde_json::to_vec(&valid_task_value()).expect("serialize task");
        let source = serde_json::to_vec(&valid_source_identity_value()).expect("serialize source");

        assert_eq!(
            parse_terminal_result(WorkerOperation::ResolveSourceIdentity, &task),
            Err(TerminalResultError::Invalid),
        );
        assert_eq!(
            parse_terminal_result(WorkerOperation::ProcessVideo, &source),
            Err(TerminalResultError::Invalid),
        );
    }

    #[test]
    fn rust_registry_matches_the_canonical_terminal_contract() {
        let contract: Value = serde_json::from_str(include_str!(
            "../../../../contracts/desktop-worker-contract.json"
        ))
        .expect("parse desktop worker contract");
        let terminal = &contract["terminalResults"];

        assert_eq!(terminal["operations"], json!(TERMINAL_OPERATION_FAMILIES));
        assert_eq!(
            terminal["schemas"]["task"]["required"],
            json!(TASK_RESULT_FIELDS)
        );
        assert_eq!(
            terminal["schemas"]["task"]["properties"]["status"]["enum"],
            json!(TASK_TERMINAL_STATUSES)
        );
        let contract_artifacts = terminal["schemas"]["task"]["properties"]["artifacts"]
            ["properties"]
            .as_object()
            .expect("artifact properties")
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        assert_eq!(
            contract_artifacts,
            TASK_ARTIFACT_KEYS.iter().copied().collect::<BTreeSet<_>>()
        );
        let contract_insights = terminal["schemas"]["task"]["properties"]["insights"]["items"]
            ["properties"]
            .as_object()
            .expect("insight properties")
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        assert_eq!(
            contract_insights,
            TASK_INSIGHT_FIELDS.iter().copied().collect::<BTreeSet<_>>()
        );
    }

    fn valid_task_value() -> Value {
        json!({
            "status": "completed",
            "task_id": "safe-task",
            "task_dir": "C:/safe/tasks/safe-task",
            "artifacts": {
                "audio": "media/audio.wav",
                "transcript_txt": "transcript/transcript.txt"
            },
            "text": "transcript",
            "summary": "summary",
            "insights": [{
                "id": 1,
                "topic": "topic",
                "matchReason": "match",
                "followUpQuestions": ["next"],
                "suitableUse": "notes",
                "sourceChunkId": 2
            }],
            "transcript": {
                "source": "asr",
                "language": "zh",
                "engine": "SenseVoice"
            },
            "error": null
        })
    }

    fn valid_source_identity_value() -> Value {
        json!({
            "status": "completed",
            "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "source_identity": {
                "version": 1,
                "platform": "youtube",
                "stable_id": "dQw4w9WgXcQ",
                "effective_part": null,
                "canonical_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            }
        })
    }

    fn mutate_task(mutate: impl FnOnce(&mut Value)) -> Value {
        let mut value = valid_task_value();
        mutate(&mut value);
        value
    }

    fn mutate_source(mutate: impl FnOnce(&mut Value)) -> Value {
        let mut value = valid_source_identity_value();
        mutate(&mut value);
        value
    }
}
