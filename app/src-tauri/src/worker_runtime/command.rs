use super::facade::{AsrModelDownloadJob, RuntimeComponentDownloadJob};
#[cfg(test)]
use crate::account;
use crate::llm_providers::WorkerLlmConfig;
use crate::settings::{
    legacy_local_llm_env_removals, LLM_API_KEY_ENV, LLM_BASE_URL_ENV, LLM_MODEL_ENV,
    LLM_PROVIDER_ENV, LLM_TIMEOUT_ENV, ANYSEARCH_CHECKOUT_URL_ENV, ANYSEARCH_SESSION_TOKEN_ENV,
    ANYSEARCH_SOURCE_ENV, ASR_MODEL_DOWNLOAD_SHA256_ENV, ASR_MODEL_DOWNLOAD_URL_ENV,
    LLM_CHECKOUT_REQUEST_ID_ENV, LLM_CHECKOUT_URL_ENV, LLM_SESSION_TOKEN_ENV, LLM_SOURCE_ENV,
    MODELSCOPE_ENDPOINT_ENV, SENSEVOICE_REVISION_ENV,
};
use crate::task_manifest;
use crate::{
    bundled_python_path, path_to_env_string, prepend_to_path, worker_python_bootstrap_env,
    RuntimePaths, ALLOW_REAL_ASR_ENV, CACHE_DIR_ENV, MODELSCOPE_OFFLINE_ENV, MODEL_DIR_ENV,
    OUTPUT_DIR_ENV,
    PYTORCH_RUNTIME_DIR_ENV, PYTORCH_RUNTIME_SHA256_ENV, PYTORCH_RUNTIME_URL_ENV, RESOURCE_DIR_ENV,
    USER_DATA_DIR_ENV,
};
#[cfg(test)]
use std::collections::HashMap;
use std::path::PathBuf;

const MAX_WORKER_STDIN_PAYLOAD_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_WEB_PAGE_MESSAGE_BYTES: usize = 40 * 1024 * 1024;
const STORAGE_SYSTEM_ENVIRONMENT: &[&str] = &[
    "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "USERPROFILE",
    "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES",
    "PROGRAMFILES(X86)", "COMMONPROGRAMFILES", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER", "OS", "HOME", "LANG", "TZ", "LC_ALL", "LC_CTYPE", "LC_MESSAGES",
    "LC_NUMERIC", "LC_MONETARY", "LC_TIME", "LC_COLLATE", "LC_ADDRESS", "LC_IDENTIFICATION",
    "LC_MEASUREMENT", "LC_NAME", "LC_PAPER", "LC_TELEPHONE",
];

#[derive(Clone)]
pub(super) enum WorkerInvocation {
    ProcessVideo(String),
    ProcessLocalMedia(String),
    ProcessWebPage(String),
    RetryInsights(String),
    ResolveSourceIdentity(String),
}

#[derive(Clone)]
pub(in crate::worker_runtime) struct WorkerCommandSpec {
    pub(in crate::worker_runtime) program: PathBuf,
    pub(in crate::worker_runtime) args: Vec<String>,
    pub(in crate::worker_runtime) stdin_payload: Option<String>,
    pub(in crate::worker_runtime) env: Vec<(String, String)>,
    pub(in crate::worker_runtime) clear_env: bool,
    pub(in crate::worker_runtime) env_remove: Vec<String>,
    pub(in crate::worker_runtime) current_dir: PathBuf,
}

impl WorkerCommandSpec {
    #[cfg(test)]
    pub(in crate::worker_runtime) fn env_map(&self) -> HashMap<String, String> {
        self.env.iter().cloned().collect()
    }
}

pub(super) fn js_runtime_diagnostics(spec: &WorkerCommandSpec) -> String {
    let path_value = spec
        .env
        .iter()
        .find_map(|(key, value)| (key == "PATH").then_some(value.as_str()))
        .unwrap_or_default();
    let runtimes = [
        (
            "deno",
            executable_available_on_path(path_value, &["deno", "deno.exe"]),
        ),
        (
            "node",
            executable_available_on_path(path_value, &["node", "node.exe"]),
        ),
        (
            "quickjs",
            executable_available_on_path(path_value, &["qjs", "qjs.exe"]),
        ),
        (
            "bun",
            executable_available_on_path(path_value, &["bun", "bun.exe"]),
        ),
    ];
    let summary = runtimes
        .iter()
        .map(|(name, available)| {
            format!(
                "{name}:{}",
                if *available { "available" } else { "missing" }
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("js_runtimes={summary}")
}

fn executable_available_on_path(path_value: &str, binary_names: &[&str]) -> bool {
    std::env::split_paths(path_value).any(|directory| {
        binary_names
            .iter()
            .any(|binary_name| directory.join(binary_name).is_file())
    })
}

pub(super) fn build_asr_model_download_command_spec(
    paths: &RuntimePaths,
    job: &AsrModelDownloadJob,
) -> Result<WorkerCommandSpec, String> {
    let path_value = prepend_to_path(&paths.resource_dir.join("bin"))?;
    let mut env = vec![
        (
            "PYTHONPATH".to_string(),
            path_to_env_string(paths.resource_dir.join("worker")),
        ),
        ("PYTHONUTF8".to_string(), "1".to_string()),
        ("PYTHONIOENCODING".to_string(), "utf-8".to_string()),
        ("PATH".to_string(), path_value),
        (
            MODEL_DIR_ENV.to_string(),
            path_to_env_string(paths.models_root()?),
        ),
        (
            RESOURCE_DIR_ENV.to_string(),
            path_to_env_string(&paths.resource_dir),
        ),
        (
            USER_DATA_DIR_ENV.to_string(),
            path_to_env_string(&paths.user_data_dir),
        ),
    ];

    for (key, value) in [
        (ASR_MODEL_DOWNLOAD_URL_ENV, job.download_url()),
        (ASR_MODEL_DOWNLOAD_SHA256_ENV, job.download_sha256()),
        (MODELSCOPE_ENDPOINT_ENV, job.modelscope_endpoint()),
        (SENSEVOICE_REVISION_ENV, job.sensevoice_revision()),
    ] {
        if let Some(value) = value {
            env.push((key.to_string(), value.to_string()));
        }
    }

    Ok(WorkerCommandSpec {
        program: bundled_python_path(&paths.resource_dir),
        args: vec![
            "-m".to_string(),
            "worker_core".to_string(),
            "--download-asr-model".to_string(),
            "--asr-model".to_string(),
            job.asr_model().to_string(),
        ],
        stdin_payload: None,
        env,
        clear_env: false,
        env_remove: legacy_local_llm_env_removals(),
        current_dir: paths.user_data_dir.clone(),
    })
}

#[cfg(test)]
pub(super) fn build_storage_validation_command_spec(
    paths: &RuntimePaths,
    data: &crate::data_storage::DataPaths,
    import_component: bool,
) -> Result<WorkerCommandSpec, String> {
    build_storage_validation_for_component(paths, data, import_component, env!("CARGO_PKG_VERSION"))
}

pub(super) fn build_storage_validation_for_component(
    paths: &RuntimePaths,
    data: &crate::data_storage::DataPaths,
    import_component: bool,
    component_version: &str,
) -> Result<WorkerCommandSpec, String> {
    if component_version.is_empty() || component_version.len() > 80
        || matches!(component_version, "." | "..")
        || !component_version.chars().all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '+'))
    { return Err("StorageValidationFailed".into()); }
    let mut args = vec!["-m".to_string(), "worker_core.storage_validation".to_string()];
    if import_component { args.push("--import-component".to_string()); }
    let mut env = STORAGE_SYSTEM_ENVIRONMENT.iter().filter_map(|key| {
        std::env::var_os(key).map(|value| ((*key).to_string(), value.to_string_lossy().into_owned()))
    }).collect::<Vec<_>>();
    env.extend([
        ("PYTHONPATH".into(), path_to_env_string(paths.resource_dir.join("worker"))),
        ("PYTHONNOUSERSITE".into(), "1".into()),
        ("PYTHONDONTWRITEBYTECODE".into(), "1".into()),
        ("PYTHONUTF8".into(), "1".into()),
        ("PYTHONIOENCODING".into(), "utf-8".into()),
        ("PATH".into(), storage_validation_path(paths)?),
        (OUTPUT_DIR_ENV.into(), path_to_env_string(&data.output_root)),
        (CACHE_DIR_ENV.into(), path_to_env_string(&data.cache_root)),
        (MODEL_DIR_ENV.into(), path_to_env_string(&data.models_root)),
        (RESOURCE_DIR_ENV.into(), path_to_env_string(&paths.resource_dir)),
        (USER_DATA_DIR_ENV.into(), path_to_env_string(&paths.user_data_dir)),
        (PYTORCH_RUNTIME_DIR_ENV.into(), path_to_env_string(data.runtime_root.join("pytorch").join(component_version))),
        (MODELSCOPE_OFFLINE_ENV.into(), "1".into()),
        ("HF_HUB_OFFLINE".into(), "1".into()),
        ("TRANSFORMERS_OFFLINE".into(), "1".into()),
    ]);
    Ok(WorkerCommandSpec {
        program: bundled_python_path(&paths.resource_dir), args, stdin_payload: None,
        env, clear_env: true, env_remove: Vec::new(), current_dir: paths.user_data_dir.clone(),
    })
}

#[cfg(test)]
fn storage_validation_needs_system_environment(key: &str) -> bool {
    STORAGE_SYSTEM_ENVIRONMENT.contains(&key.to_ascii_uppercase().as_str())
}

fn storage_validation_path(paths: &RuntimePaths) -> Result<String, String> {
    let mut search = vec![paths.resource_dir.join("bin")];
    #[cfg(windows)]
    {
        let windows = std::env::var_os("SystemRoot").ok_or("StorageValidationFailed")?;
        let windows = PathBuf::from(windows);
        if !windows.is_absolute() { return Err("StorageValidationFailed".into()); }
        search.extend([windows.join("System32"), windows]);
    }
    #[cfg(unix)]
    search.extend(["/usr/bin", "/bin", "/usr/sbin", "/sbin"].into_iter().map(PathBuf::from));
    std::env::join_paths(search).map(|value| value.to_string_lossy().into_owned())
        .map_err(|_| "StorageValidationFailed".to_string())
}

pub(super) fn build_runtime_component_download_command_spec(
    paths: &RuntimePaths,
    job: &RuntimeComponentDownloadJob,
) -> Result<WorkerCommandSpec, String> {
    let path_value = prepend_to_path(&paths.resource_dir.join("bin"))?;
    let mut env = vec![
        (
            "PYTHONPATH".to_string(),
            path_to_env_string(paths.resource_dir.join("worker")),
        ),
        ("PYTHONUTF8".to_string(), "1".to_string()),
        ("PYTHONIOENCODING".to_string(), "utf-8".to_string()),
        ("PATH".to_string(), path_value),
        (
            MODEL_DIR_ENV.to_string(),
            path_to_env_string(paths.models_root()?),
        ),
        (
            RESOURCE_DIR_ENV.to_string(),
            path_to_env_string(&paths.resource_dir),
        ),
        (
            USER_DATA_DIR_ENV.to_string(),
            path_to_env_string(&paths.user_data_dir),
        ),
        (
            PYTORCH_RUNTIME_DIR_ENV.to_string(),
            path_to_env_string(job.component_dir()),
        ),
        (PYTORCH_RUNTIME_URL_ENV.to_string(), job.download_url().to_string()),
    ];
    if let Some(sha256) = job.download_sha256() {
        env.push((PYTORCH_RUNTIME_SHA256_ENV.to_string(), sha256.to_string()));
    }

    Ok(WorkerCommandSpec {
        program: bundled_python_path(&paths.resource_dir),
        args: vec![
            "-m".to_string(),
            "worker_core".to_string(),
            "--download-runtime-component".to_string(),
        ],
        stdin_payload: None,
        env,
        clear_env: false,
        env_remove: legacy_local_llm_env_removals(),
        current_dir: paths.user_data_dir.clone(),
    })
}

#[cfg(test)]
pub(super) fn build_worker_command_spec(
    paths: &RuntimePaths,
    invocation: WorkerInvocation,
    server_managed_llm: Option<account::ServerManagedLlmInvocation>,
) -> Result<WorkerCommandSpec, String> {
    build_worker_command_spec_with_llm(
        paths,
        invocation,
        WorkerLlmConfig::Managed(server_managed_llm),
    )
}

pub(super) fn build_worker_command_spec_with_llm(
    paths: &RuntimePaths,
    invocation: WorkerInvocation,
    llm: WorkerLlmConfig,
) -> Result<WorkerCommandSpec, String> {
    if let WorkerInvocation::ProcessWebPage(payload) = &invocation {
        return build_web_page_command_spec(paths, payload);
    }
    let uses_llm = worker_invocation_uses_server_managed_llm(&invocation);
    let (args, stdin_payload) = match invocation {
        WorkerInvocation::ProcessVideo(payload) => {
            (vec!["--request-stdin".to_string()], Some(payload))
        }
        WorkerInvocation::ProcessLocalMedia(payload) => (
            vec!["--process-local-media-stdin".to_string()],
            Some(payload),
        ),
        WorkerInvocation::RetryInsights(payload) => {
            (vec!["--retry-insights-stdin".to_string()], Some(payload))
        }
        WorkerInvocation::ResolveSourceIdentity(payload) => {
            (vec!["--resolve-source-stdin".to_string()], Some(payload))
        }
        WorkerInvocation::ProcessWebPage(_) => unreachable!("web page commands use an isolated environment"),
    };
    if stdin_payload
        .as_ref()
        .is_some_and(|payload| payload.len() > MAX_WORKER_STDIN_PAYLOAD_BYTES)
    {
        return Err("Worker request stdin payload was too large.".to_string());
    }
    let output_root = task_manifest::configured_output_root(paths)?;

    let mut env = worker_python_bootstrap_env(&paths.resource_dir)?;
    env.extend([
        (OUTPUT_DIR_ENV.to_string(), path_to_env_string(output_root)),
        (
            CACHE_DIR_ENV.to_string(),
            path_to_env_string(paths.cache_root()?),
        ),
        (
            MODEL_DIR_ENV.to_string(),
            path_to_env_string(paths.models_root()?),
        ),
        (
            RESOURCE_DIR_ENV.to_string(),
            path_to_env_string(&paths.resource_dir),
        ),
        (
            USER_DATA_DIR_ENV.to_string(),
            path_to_env_string(&paths.user_data_dir),
        ),
        (
            PYTORCH_RUNTIME_DIR_ENV.to_string(),
            path_to_env_string(paths.runtime_root()?.join("pytorch").join(env!("CARGO_PKG_VERSION"))),
        ),
        (ALLOW_REAL_ASR_ENV.to_string(), "1".to_string()),
        (MODELSCOPE_OFFLINE_ENV.to_string(), "1".to_string()),
    ]);
    let env_remove = match llm {
        WorkerLlmConfig::Managed(session) => {
            if uses_llm {
                if let Some(llm) = session {
                    env.push((LLM_SOURCE_ENV.to_string(), "server".to_string()));
                    env.push((
                        LLM_CHECKOUT_URL_ENV.to_string(),
                        format!(
                            "{}/api/desktop/llm/checkouts",
                            llm.server_base_url.trim_end_matches('/')
                        ),
                    ));
                    env.push((LLM_SESSION_TOKEN_ENV.to_string(), llm.session_token.clone()));
                    env.push((LLM_CHECKOUT_REQUEST_ID_ENV.to_string(), llm.request_id));
                    env.push((ANYSEARCH_SOURCE_ENV.to_string(), "server".to_string()));
                    env.push((
                        ANYSEARCH_CHECKOUT_URL_ENV.to_string(),
                        format!(
                            "{}/api/desktop/anysearch/checkout",
                            llm.server_base_url.trim_end_matches('/')
                        ),
                    ));
                    env.push((ANYSEARCH_SESSION_TOKEN_ENV.to_string(), llm.session_token));
                }
            }
            legacy_local_llm_env_removals()
        }
        WorkerLlmConfig::Byok { provider, anysearch } => {
            if uses_llm {
                env.push((LLM_PROVIDER_ENV.to_string(), provider.provider));
                env.push((LLM_BASE_URL_ENV.to_string(), provider.base_url));
                env.push((LLM_API_KEY_ENV.to_string(), provider.api_key));
                env.push((LLM_MODEL_ENV.to_string(), provider.model));
                env.push((
                    LLM_TIMEOUT_ENV.to_string(),
                    provider.timeout_seconds.to_string(),
                ));
                if let Some(session) = anysearch {
                    env.push((ANYSEARCH_SOURCE_ENV.to_string(), "server".to_string()));
                    env.push((
                        ANYSEARCH_CHECKOUT_URL_ENV.to_string(),
                        format!(
                            "{}/api/desktop/anysearch/checkout",
                            session.server_base_url.trim_end_matches('/')
                        ),
                    ));
                    env.push((ANYSEARCH_SESSION_TOKEN_ENV.to_string(), session.session_token));
                }
                Vec::new()
            } else {
                legacy_local_llm_env_removals()
            }
        }
    };

    Ok(WorkerCommandSpec {
        program: bundled_python_path(&paths.resource_dir),
        args: [vec!["-m".to_string(), "worker_core".to_string()], args].concat(),
        stdin_payload,
        env,
        clear_env: false,
        env_remove,
        current_dir: paths.user_data_dir.clone(),
    })
}

fn build_web_page_command_spec(
    paths: &RuntimePaths,
    payload: &str,
) -> Result<WorkerCommandSpec, String> {
    if payload.len() > MAX_WEB_PAGE_MESSAGE_BYTES {
        return Err("WEB_REQUEST_INVALID".into());
    }
    let parsed: serde_json::Value = serde_json::from_str(payload).map_err(|_| "WEB_REQUEST_INVALID")?;
    let operation_id = parsed.get("operation_id").and_then(serde_json::Value::as_str).ok_or("WEB_REQUEST_INVALID")?;
    if uuid::Uuid::parse_str(operation_id).map_or(true, |id| id.to_string() != operation_id) {
        return Err("WEB_REQUEST_INVALID".into());
    }
    let stringify = |path: &std::path::Path| {
        path.to_str().map(str::to_owned).ok_or_else(|| "WEB_STORAGE_FAILED".to_string())
    };
    let mut env: Vec<(String, String)> = STORAGE_SYSTEM_ENVIRONMENT.iter()
        .filter(|key| !matches!(**key, "HOME" | "USERPROFILE" | "LOCALAPPDATA" | "APPDATA" | "HOMEDRIVE" | "HOMEPATH" | "TEMP" | "TMP" | "TMPDIR"))
        .filter_map(|key| std::env::var(key).ok().map(|value| ((*key).into(), value))).collect();
    for key in ["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "HOMEDRIVE", "HOMEPATH"] {
        env.push((key.into(), stringify(&paths.user_data_dir)?));
    }
    env.extend([
        ("PYTHONPATH".into(), stringify(&paths.resource_dir.join("worker"))?),
        ("PYTHONUTF8".into(), "1".into()),
        ("PYTHONIOENCODING".into(), "utf-8".into()),
        ("PYTHONNOUSERSITE".into(), "1".into()),
        ("PYTHONDONTWRITEBYTECODE".into(), "1".into()),
        ("PATH".into(), storage_validation_path(paths)?),
        (OUTPUT_DIR_ENV.into(), stringify(&paths.output_root()?)?),
        (CACHE_DIR_ENV.into(), stringify(&paths.cache_root()?)?),
        (RESOURCE_DIR_ENV.into(), stringify(&paths.resource_dir)?),
        ("APP_ALLOW_REAL_ASR".into(), "0".into()),
        ("MODELSCOPE_OFFLINE".into(), "1".into()),
        ("HF_HUB_OFFLINE".into(), "1".into()),
        ("TEMP".into(), stringify(&paths.user_data_dir)?),
        ("TMP".into(), stringify(&paths.user_data_dir)?),
        ("TMPDIR".into(), stringify(&paths.user_data_dir)?),
    ]);
    Ok(WorkerCommandSpec {
        program: bundled_python_path(&paths.resource_dir),
        args: vec!["-m".into(), "worker_core".into(), "--save-web-page-stdin".into(), "--web-operation-id".into(), operation_id.into()],
        stdin_payload: Some(payload.into()), env, clear_env: true, env_remove: Vec::new(),
        current_dir: paths.user_data_dir.clone(),
    })
}

fn worker_invocation_uses_server_managed_llm(invocation: &WorkerInvocation) -> bool {
    match invocation {
        WorkerInvocation::RetryInsights(_) => true,
        WorkerInvocation::ProcessVideo(_)
        | WorkerInvocation::ProcessLocalMedia(_)
        | WorkerInvocation::ProcessWebPage(_)
        | WorkerInvocation::ResolveSourceIdentity(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_asr_model_download_command_spec, build_runtime_component_download_command_spec,
        build_storage_validation_command_spec, build_worker_command_spec,
        storage_validation_needs_system_environment, WorkerCommandSpec, WorkerInvocation,
    };
    use crate::account::ServerManagedLlmInvocation;
    use crate::worker_runtime::facade::{AsrModelDownloadJob, RuntimeComponentDownloadJob};
    use crate::{bundled_python_path, path_to_env_string, RuntimePaths};
    use std::path::PathBuf;

    fn command_test_paths() -> RuntimePaths {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../build/data-storage-acceptance")
            .join(format!("worker-command-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("user-data")).expect("create command fixture");
        let root = root.canonicalize().expect("resolve command fixture");
        RuntimePaths {
            resource_dir: root.join("resources"),
            user_data_dir: root.join("user-data"),
        }
    }

    fn assert_removes_legacy_local_llm_env(spec: &WorkerCommandSpec) {
        for key in [
            "APP_LLM_PROVIDER",
            "APP_LLM_BASE_URL",
            "APP_LLM_API_KEY",
            "APP_LLM_MODEL",
            "APP_LLM_TIMEOUT_SECONDS",
        ] {
            assert!(spec.env_remove.iter().any(|value| value == key));
        }
        for key in [
            "APP_LLM_SOURCE",
            "APP_LLM_CHECKOUT_URL",
            "APP_LLM_SESSION_TOKEN",
            "APP_LLM_CHECKOUT_REQUEST_ID",
        ] {
            assert!(!spec.env_remove.iter().any(|value| value == key));
        }
    }

    #[test]
    fn readonly_storage_probe_removes_provider_session_proxy_and_canary_environment() {
        for key in ["APP_STORAGE_VALIDATION_CANARY", "APP_LLM_SESSION_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AWS_SECRET_ACCESS_KEY", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "PYTHONHOME", "PYTHONPATH", "APP_OUTPUT_DIR", "LC_API_KEY"] {
            assert!(!storage_validation_needs_system_environment(key));
        }
        for key in ["SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "LC_CTYPE"] {
            assert!(storage_validation_needs_system_environment(key));
        }
        let paths = command_test_paths();
        let probe = build_storage_validation_command_spec(&paths, &paths.data_paths().unwrap(), false).unwrap();
        assert!(probe.clear_env);
        assert!(!probe.env.iter().any(|(key, _)| key == "APP_STORAGE_VALIDATION_CANARY"));
        assert!(probe.env.iter().all(|(key, _)| !key.contains("SESSION") && !key.contains("API_KEY") && !key.contains("PROXY")));
        assert_eq!(std::env::split_paths(probe.env_map().get("PATH").unwrap()).next(), Some(paths.resource_dir.join("bin")));
    }

    #[test]
    #[ignore = "需要预构建的真实 Python 以及 APP_STORAGE_VALIDATION_CANARY 环境变量"]
    fn packaged_python_probe_does_not_inherit_the_environment_canary() {
        use super::super::runner::{ProgressRoute, WorkerLane, WorkerOperation, WorkerRunOutcome, WorkerRunRequest};
        use super::super::result_protocol::ValidatedWorkerResult;
        assert!(std::env::var_os("APP_STORAGE_VALIDATION_CANARY").is_some());
        let mut paths = command_test_paths();
        paths.resource_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").canonicalize().expect("built resources");
        assert!(bundled_python_path(&paths.resource_dir).is_file());
        let mut command = build_storage_validation_command_spec(&paths, &paths.data_paths().unwrap(), false).unwrap();
        let source_worker = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../worker").canonicalize().expect("worker source");
        command.env.retain(|(key, _)| key != "PYTHONPATH");
        command.env.push(("PYTHONPATH".into(), path_to_env_string(source_worker)));
        command.args = vec!["-c".into(), "import os,runpy,sys; assert 'APP_STORAGE_VALIDATION_CANARY' not in os.environ; sys.argv=['storage_validation']; runpy.run_module('worker_core.storage_validation',run_name='__main__')".into()];
        let outcome = WorkerLane::default().run(&paths, WorkerRunRequest {
            operation: WorkerOperation::StorageValidation,
            command,
            progress: ProgressRoute::None,
        }).expect("run supervised real Python probe");
        let WorkerRunOutcome::Structured(ValidatedWorkerResult::StorageValidation(result)) = outcome else {
            panic!("real storage probe did not produce its validated result");
        };
        assert!(result.ready_models.is_empty());
        assert!(!result.component_imported);
    }

    #[test]
    fn managed_library_paths_reach_all_worker_commands_and_keep_fixed_configuration() {
        let paths = command_test_paths();
        std::fs::create_dir_all(&paths.resource_dir).expect("create resources");
        let target = paths.user_data_dir.parent().unwrap().join("moved-library");
        std::fs::create_dir(&target).expect("create empty target");
        let target = target.canonicalize().expect("resolve target");
        std::fs::create_dir(paths.user_data_dir.join("cache")).expect("cache fixture");
        std::fs::write(paths.user_data_dir.join("cache/preserved.bin"), b"source cache bytes").expect("cache content");
        let manager = crate::data_storage::DataStorageManager::open(paths.user_data_dir.clone(), paths.resource_dir.clone()).expect("open legacy library");
        let preview = manager.prepare(target.clone(), vec![], "test", 0).expect("prepare real migration");
        manager.start(&preview.plan_token, "test", &mut |_| {}).expect("copy real files");
        drop(manager);
        let manager = crate::data_storage::DataStorageManager::open(paths.user_data_dir.clone(), paths.resource_dir.clone()).expect("reopen switched library");
        manager.recheck().expect("validate copied library");
        assert_eq!(std::fs::read(target.join("cache/preserved.bin")).unwrap(), b"source cache bytes");
        assert_eq!(paths.output_root().unwrap(), target.join("outputs"));
        assert_eq!(paths.collections_path().unwrap(), target.join("collections.json"));

        let worker = build_worker_command_spec(&paths, WorkerInvocation::ProcessVideo("{}".into()), None).expect("worker command");
        let model = build_asr_model_download_command_spec(&paths, &AsrModelDownloadJob::new("iic/SenseVoiceSmall-onnx".into(), None, None, None, None)).expect("model command");
        let component_dir = target.join("runtime/pytorch").join(env!("CARGO_PKG_VERSION"));
        let component = build_runtime_component_download_command_spec(&paths, &RuntimeComponentDownloadJob::new(component_dir.clone(), "https://example.com/runtime.tar.gz".into(), None)).expect("component command");
        let probe = build_storage_validation_command_spec(&paths, &paths.data_paths().unwrap(), true).expect("readonly probe command");
        for command in [&worker, &model, &component, &probe] {
            assert_eq!(command.current_dir, paths.user_data_dir);
            assert_eq!(command.env_map().get("APP_USER_DATA_DIR"), Some(&path_to_env_string(&paths.user_data_dir)));
            assert_eq!(command.env_map().get("APP_MODEL_DIR"), Some(&path_to_env_string(target.join("models"))));
            assert_eq!(command.env_map().get("APP_RESOURCE_DIR"), Some(&path_to_env_string(&paths.resource_dir)));
        }
        for command in [&worker, &probe] {
            assert_eq!(command.env_map().get("APP_OUTPUT_DIR"), Some(&path_to_env_string(target.join("outputs"))));
            assert_eq!(command.env_map().get("APP_CACHE_DIR"), Some(&path_to_env_string(target.join("cache"))));
            assert_eq!(command.env_map().get("APP_PYTORCH_RUNTIME_DIR"), Some(&path_to_env_string(&component_dir)));
        }
        assert_eq!(probe.args, vec!["-m", "worker_core.storage_validation", "--import-component"]);
        assert!(probe.stdin_payload.is_none());
        assert_eq!(probe.env_map().get("PYTHONDONTWRITEBYTECODE"), Some(&"1".to_string()));
        assert!(!probe.env.iter().any(|(key, _)| key.starts_with("APP_LLM_") || key.starts_with("APP_ANYSEARCH_")));
    }

    #[test]
    fn asr_model_download_job_derives_fixed_command_and_allowlisted_overrides() {
        let paths = command_test_paths();
        let job = AsrModelDownloadJob::new(
            "iic/SenseVoiceSmall".to_string(),
            Some("https://cdn.example/sensevoice.zip".to_string()),
            Some("abc123".to_string()),
            Some("https://modelscope.example".to_string()),
            Some("revision-1".to_string()),
        );

        let spec = build_asr_model_download_command_spec(&paths, &job)
            .expect("prepare ASR download command");
        let env = spec.env_map();

        assert_eq!(spec.program, bundled_python_path(&paths.resource_dir));
        assert_eq!(
            spec.args,
            vec![
                "-m",
                "worker_core",
                "--download-asr-model",
                "--asr-model",
                "iic/SenseVoiceSmall",
            ]
        );
        assert_eq!(spec.stdin_payload, None);
        assert_eq!(spec.current_dir, paths.user_data_dir);
        assert_eq!(
            env.get("APP_MODEL_DIR"),
            Some(&path_to_env_string(paths.user_data_dir.join("models")))
        );
        assert_eq!(
            env.get("APP_ASR_MODEL_DOWNLOAD_URL"),
            Some(&"https://cdn.example/sensevoice.zip".to_string())
        );
        assert_eq!(
            env.get("APP_ASR_MODEL_DOWNLOAD_SHA256"),
            Some(&"abc123".to_string())
        );
        assert_eq!(
            env.get("APP_MODELSCOPE_ENDPOINT"),
            Some(&"https://modelscope.example".to_string())
        );
        assert_eq!(
            env.get("APP_SENSEVOICE_REVISION"),
            Some(&"revision-1".to_string())
        );
        assert_removes_legacy_local_llm_env(&spec);
    }

    #[test]
    fn runtime_component_download_spec_carries_the_component_environment() {
        let paths = command_test_paths();
        let job = RuntimeComponentDownloadJob::new(
            paths.user_data_dir.join("runtime").join("pytorch").join("0.3.9"),
            "https://github.com/jiabai/Locus/releases/download/v0.3.9/pytorch-runtime-windows-x64.zip".to_string(),
            Some("deadbeef".to_string()),
        );

        let spec = build_runtime_component_download_command_spec(&paths, &job)
            .expect("prepare runtime component download command");
        let env = spec.env_map();

        assert_eq!(
            spec.args,
            vec![
                "-m".to_string(),
                "worker_core".to_string(),
                "--download-runtime-component".to_string()
            ]
        );
        assert_eq!(spec.stdin_payload, None);
        assert_eq!(
            env.get("APP_PYTORCH_RUNTIME_URL"),
            Some(&"https://github.com/jiabai/Locus/releases/download/v0.3.9/pytorch-runtime-windows-x64.zip".to_string())
        );
        assert_eq!(
            env.get("APP_PYTORCH_RUNTIME_SHA256"),
            Some(&"deadbeef".to_string())
        );
        assert!(env
            .get("APP_PYTORCH_RUNTIME_DIR")
            .is_some_and(|value| value.ends_with("runtime/pytorch/0.3.9") || value.ends_with("runtime\\pytorch\\0.3.9")));
        for key in ["PYTHONPATH", "APP_RESOURCE_DIR", "APP_USER_DATA_DIR", "APP_MODEL_DIR"] {
            assert!(env.contains_key(key), "missing fixed key {key}");
        }
        assert_removes_legacy_local_llm_env(&spec);
    }

    #[test]
    fn asr_model_download_job_omits_optional_overrides_and_keeps_fixed_environment() {
        let paths = command_test_paths();
        let job =
            AsrModelDownloadJob::new("iic/SenseVoiceSmall".to_string(), None, None, None, None);

        let spec = build_asr_model_download_command_spec(&paths, &job)
            .expect("prepare ASR download command");
        let env = spec.env_map();

        for key in [
            "APP_ASR_MODEL_DOWNLOAD_URL",
            "APP_ASR_MODEL_DOWNLOAD_SHA256",
            "APP_MODELSCOPE_ENDPOINT",
            "APP_SENSEVOICE_REVISION",
        ] {
            assert!(!env.contains_key(key), "unexpected optional key {key}");
        }
        for key in [
            "PYTHONPATH",
            "PYTHONUTF8",
            "PYTHONIOENCODING",
            "PATH",
            "APP_MODEL_DIR",
            "APP_RESOURCE_DIR",
            "APP_USER_DATA_DIR",
        ] {
            assert!(env.contains_key(key), "missing fixed key {key}");
        }
        assert_eq!(spec.stdin_payload, None);
        assert_removes_legacy_local_llm_env(&spec);
    }

    #[test]
    fn worker_command_spec_uses_bundled_python_and_app_local_data() {
        let paths = command_test_paths();
        let request_json = r#"{"url":"https://www.douyin.com/video/7524373044106677544"}"#;

        let spec = build_worker_command_spec(
            &paths,
            WorkerInvocation::ProcessVideo(request_json.to_string()),
            None,
        )
        .expect("build worker command spec");
        let env = spec.env_map();

        assert_eq!(spec.program, bundled_python_path(&paths.resource_dir));
        assert_eq!(spec.args, vec!["-m", "worker_core", "--request-stdin"]);
        assert_eq!(spec.stdin_payload.as_deref(), Some(request_json));
        assert!(!spec.args.join(" ").contains(request_json));
        assert!(!spec.args.join(" ").contains("xsec_token"));
        assert!(!env.values().any(|value| value.contains(request_json)));
        assert!(!spec.program.to_string_lossy().contains("uv"));
        assert!(!spec.args.iter().any(|arg| arg == "uv"));
        assert_eq!(
            env.get("PYTHONPATH"),
            Some(&path_to_env_string(paths.resource_dir.join("worker")))
        );
        assert_eq!(
            env.get("APP_OUTPUT_DIR"),
            Some(&path_to_env_string(paths.user_data_dir.join("outputs")))
        );
        assert_eq!(
            env.get("APP_CACHE_DIR"),
            Some(&path_to_env_string(paths.user_data_dir.join("cache")))
        );
        assert_eq!(
            env.get("APP_MODEL_DIR"),
            Some(&path_to_env_string(paths.user_data_dir.join("models")))
        );
        assert_eq!(
            env.get("APP_RESOURCE_DIR"),
            Some(&path_to_env_string(&paths.resource_dir))
        );
        assert_eq!(env.get("APP_ALLOW_REAL_ASR"), Some(&"1".to_string()));
        assert_eq!(env.get("MODELSCOPE_OFFLINE"), Some(&"1".to_string()));
        assert_removes_legacy_local_llm_env(&spec);
        assert_eq!(spec.current_dir, paths.user_data_dir);
    }

    #[test]
    fn serialized_worker_requests_never_enter_argv_or_environment() {
        let paths = command_test_paths();
        let secret = "review-secret";
        let cases = [
            (
                WorkerInvocation::ProcessVideo(format!(
                    r#"{{"url":"https://www.xiaohongshu.com/explore/64a1b2c3d4e5f67890123456?xsec_token={secret}"}}"#
                )),
                "--request-stdin",
            ),
            (
                WorkerInvocation::ProcessLocalMedia(format!(
                    r#"{{"contract_version":4,"source_path":"C:\\Users\\{secret}\\Interview.wmv","media_kind":"video","safe_display_name":"Interview.wmv","source_extension":"wmv","asr_model":"iic/SenseVoiceSmall"}}"#
                )),
                "--process-local-media-stdin",
            ),
            (
                WorkerInvocation::ResolveSourceIdentity(format!(
                    r#"{{"url":"https://xhslink.com/demo?xsec_token={secret}"}}"#
                )),
                "--resolve-source-stdin",
            ),
            (
                WorkerInvocation::RetryInsights(
                    r#"{"task_id":"safe-task","target":"summary","output_language":"en-US"}"#
                        .to_string(),
                ),
                "--retry-insights-stdin",
            ),
        ];

        for (invocation, expected_mode) in cases {
            let spec = build_worker_command_spec(&paths, invocation, None)
                .expect("build stdin worker command");
            assert_eq!(
                spec.args,
                vec![
                    "-m".to_string(),
                    "worker_core".to_string(),
                    expected_mode.to_string()
                ]
            );
            assert!(!spec.args.iter().any(|value| value.contains(secret)));
            assert!(!spec.args.iter().any(|value| value.contains("xsec_token")));
            assert!(!spec.env.iter().any(|(_, value)| value.contains(secret)));
            assert!(!spec
                .env
                .iter()
                .any(|(_, value)| value.contains("xsec_token")));
        }
    }

    #[test]
    fn oversized_worker_stdin_payload_fails_without_echoing_content() {
        let paths = RuntimePaths {
            resource_dir: PathBuf::from("C:/Program Files/Locus/resources"),
            user_data_dir: PathBuf::from("C:/Users/demo/AppData/Local/pro.8xf.app"),
        };
        let payload = format!("review-secret{}", "x".repeat(1024 * 1024));

        let error = match build_worker_command_spec(
            &paths,
            WorkerInvocation::ProcessVideo(payload),
            None,
        ) {
            Ok(_) => panic!("oversized stdin payload unexpectedly accepted"),
            Err(error) => error,
        };

        assert_eq!(error, "Worker request stdin payload was too large.");
        assert!(!error.contains("review-secret"));
    }

    #[test]
    fn worker_command_spec_skips_server_managed_llm_for_process_video() {
        let paths = command_test_paths();
        let request_json = r#"{"url":"https://www.douyin.com/video/7524373044106677544"}"#;

        let spec = build_worker_command_spec(
            &paths,
            WorkerInvocation::ProcessVideo(request_json.to_string()),
            Some(ServerManagedLlmInvocation {
                server_base_url: "http://127.0.0.1:8787".to_string(),
                session_token: "desktop-token".to_string(),
                request_id: "llm-run-12345678".to_string(),
            }),
        )
        .expect("build worker command spec");
        let env = spec.env_map();

        assert_removes_legacy_local_llm_env(&spec);
        assert_eq!(spec.stdin_payload.as_deref(), Some(request_json));
        assert_eq!(env.get("APP_LLM_SOURCE"), None);
        assert_eq!(env.get("APP_LLM_CHECKOUT_URL"), None);
        assert_eq!(env.get("APP_LLM_SESSION_TOKEN"), None);
        assert_eq!(env.get("APP_LLM_CHECKOUT_REQUEST_ID"), None);
        assert_eq!(env.get("APP_ANYSEARCH_SOURCE"), None);
        assert_eq!(env.get("APP_ANYSEARCH_CHECKOUT_URL"), None);
        assert_eq!(env.get("APP_ANYSEARCH_SESSION_TOKEN"), None);
    }

    #[test]
    fn web_save_command_uses_bounded_pipe_and_storage_environment() {
        let paths = command_test_paths();
        let payload = serde_json::json!({
            "contract_version": 2,
            "operation_id": "00000000-0000-0000-0000-000000000001",
            "task_id": "20261102-123456-web-0123456789abcdef",
            "article": { "title": "Unicode article", "sourceUrl": "https://www.python.org/",
                "text": "文".repeat(400_000), "markdown": "# Body\r\n" },
        }).to_string();
        assert!(payload.len() > 1024 * 1024);
        let spec = build_worker_command_spec(
            &paths, WorkerInvocation::ProcessWebPage(payload.clone()), None,
        ).expect("web save payload accepted");
        assert_eq!(spec.args, vec!["-m", "worker_core", "--save-web-page-stdin",
            "--web-operation-id", "00000000-0000-0000-0000-000000000001"]);
        assert_eq!(spec.stdin_payload.as_deref(), Some(payload.as_str()));
        assert!(spec.clear_env);
        assert!(spec.env_remove.is_empty());
        assert_eq!(spec.current_dir, paths.user_data_dir);
        let env = spec.env_map();
        for key in ["APP_WEB_ENGINE_DIR", "APP_WEB_EXTRACTION_BUNDLE",
            "APP_LLM_SESSION_TOKEN", "APP_ANYSEARCH_SESSION_TOKEN"] {
            assert!(!env.contains_key(key));
        }
        assert!(!spec.args.iter().any(|value| value.contains("https://")));
        assert!(!env.values().any(|value| value.contains("https://")));
    }

    #[test]
    fn web_save_command_rejects_invalid_operation_and_oversize_payload() {
        let paths = command_test_paths();
        for payload in [
            serde_json::json!({ "operation_id": "INVALID" }).to_string(),
            serde_json::json!({ "operation_id": "00000000000000000000000000000001" }).to_string(),
            "x".repeat(super::MAX_WEB_PAGE_MESSAGE_BYTES + 1),
        ] {
            assert!(build_worker_command_spec(
                &paths, WorkerInvocation::ProcessWebPage(payload), None,
            ).is_err());
        }
    }

    #[test]
    fn worker_command_spec_includes_server_managed_llm_checkout_env_for_retry_insights() {
        let paths = command_test_paths();
        let request_json = r#"{"task_id":"20260705-153012-douyin-demo","target":"summary","output_language":"en-US"}"#;

        let spec = build_worker_command_spec(
            &paths,
            WorkerInvocation::RetryInsights(request_json.to_string()),
            Some(ServerManagedLlmInvocation {
                server_base_url: "http://127.0.0.1:8787".to_string(),
                session_token: "desktop-token".to_string(),
                request_id: "llm-run-12345678".to_string(),
            }),
        )
        .expect("build worker command spec");
        let env = spec.env_map();

        assert_removes_legacy_local_llm_env(&spec);
        assert_eq!(spec.stdin_payload.as_deref(), Some(request_json));
        assert_eq!(env.get("APP_LLM_SOURCE"), Some(&"server".to_string()));
        assert_eq!(
            env.get("APP_LLM_CHECKOUT_URL"),
            Some(&"http://127.0.0.1:8787/api/desktop/llm/checkouts".to_string())
        );
        assert_eq!(
            env.get("APP_LLM_SESSION_TOKEN"),
            Some(&"desktop-token".to_string())
        );
        assert_eq!(
            env.get("APP_LLM_CHECKOUT_REQUEST_ID"),
            Some(&"llm-run-12345678".to_string())
        );
        assert_eq!(
            env.get("APP_ANYSEARCH_SOURCE"),
            Some(&"server".to_string())
        );
        assert_eq!(
            env.get("APP_ANYSEARCH_CHECKOUT_URL"),
            Some(&"http://127.0.0.1:8787/api/desktop/anysearch/checkout".to_string())
        );
        assert_eq!(
            env.get("APP_ANYSEARCH_SESSION_TOKEN"),
            Some(&"desktop-token".to_string())
        );
    }

    fn byok_runtime() -> crate::llm_providers::ByokLlmRuntime {
        crate::llm_providers::ByokLlmRuntime {
            provider: "openai_compatible".to_string(),
            base_url: "https://api.example.com/v1".to_string(),
            api_key: "sk-BYOK-SECRET".to_string(),
            model: "deepseek-chat".to_string(),
            timeout_seconds: 30,
        }
    }

    fn byok_server_llm() -> ServerManagedLlmInvocation {
        ServerManagedLlmInvocation {
            server_base_url: "http://127.0.0.1:8787".to_string(),
            session_token: "desktop-token".to_string(),
            request_id: "llm-run-12345678".to_string(),
        }
    }

    const BYOK_ENV_KEYS: [&str; 5] = [
        "APP_LLM_PROVIDER",
        "APP_LLM_BASE_URL",
        "APP_LLM_API_KEY",
        "APP_LLM_MODEL",
        "APP_LLM_TIMEOUT_SECONDS",
    ];

    #[test]
    fn byok_retry_insights_injects_provider_env_without_removing_it() {
        let paths = command_test_paths();
        let request_json = r#"{"task_id":"byok-task","target":"summary","output_language":"en-US"}"#;
        let spec = super::build_worker_command_spec_with_llm(
            &paths,
            WorkerInvocation::RetryInsights(request_json.to_string()),
            crate::llm_providers::WorkerLlmConfig::Byok {
                provider: byok_runtime(),
                anysearch: None,
            },
        )
        .expect("build BYOK worker command spec");
        let env = spec.env_map();

        assert_eq!(env.get("APP_LLM_PROVIDER"), Some(&"openai_compatible".to_string()));
        assert_eq!(env.get("APP_LLM_BASE_URL"), Some(&"https://api.example.com/v1".to_string()));
        assert_eq!(env.get("APP_LLM_API_KEY"), Some(&"sk-BYOK-SECRET".to_string()));
        assert_eq!(env.get("APP_LLM_MODEL"), Some(&"deepseek-chat".to_string()));
        assert_eq!(env.get("APP_LLM_TIMEOUT_SECONDS"), Some(&"30".to_string()));
        assert_eq!(env.get("APP_LLM_SOURCE"), None);
        assert_eq!(env.get("APP_LLM_CHECKOUT_URL"), None);
        assert_eq!(env.get("APP_ANYSEARCH_SOURCE"), None);
        for key in BYOK_ENV_KEYS {
            assert!(
                !spec.env_remove.iter().any(|value| value == key),
                "{key} must not be removed in BYOK mode"
            );
        }
        assert!(!spec.args.iter().any(|arg| arg.contains("sk-BYOK-SECRET")));
        assert!(!spec
            .stdin_payload
            .as_deref()
            .unwrap_or_default()
            .contains("sk-BYOK-SECRET"));
    }

    #[test]
    fn byok_retry_insights_injects_anysearch_only_when_logged_in() {
        let paths = command_test_paths();
        let request_json = r#"{"task_id":"byok-task","target":"draft","output_language":"en-US"}"#;
        let spec = super::build_worker_command_spec_with_llm(
            &paths,
            WorkerInvocation::RetryInsights(request_json.to_string()),
            crate::llm_providers::WorkerLlmConfig::Byok {
                provider: byok_runtime(),
                anysearch: Some(byok_server_llm()),
            },
        )
        .expect("build BYOK worker command spec");
        let env = spec.env_map();

        assert_eq!(env.get("APP_ANYSEARCH_SOURCE"), Some(&"server".to_string()));
        assert_eq!(
            env.get("APP_ANYSEARCH_CHECKOUT_URL"),
            Some(&"http://127.0.0.1:8787/api/desktop/anysearch/checkout".to_string())
        );
        assert_eq!(env.get("APP_ANYSEARCH_SESSION_TOKEN"), Some(&"desktop-token".to_string()));
        assert_eq!(env.get("APP_LLM_SOURCE"), None);
        assert_eq!(env.get("APP_LLM_SESSION_TOKEN"), None);
    }

    #[test]
    fn byok_process_video_still_removes_legacy_llm_env() {
        let paths = command_test_paths();
        let spec = super::build_worker_command_spec_with_llm(
            &paths,
            WorkerInvocation::ProcessVideo("{}".to_string()),
            crate::llm_providers::WorkerLlmConfig::Byok {
                provider: byok_runtime(),
                anysearch: None,
            },
        )
        .expect("build BYOK process-video spec");
        for key in BYOK_ENV_KEYS {
            assert!(spec.env_remove.iter().any(|value| value == key));
        }
        assert!(!spec.env_map().contains_key("APP_LLM_API_KEY"));
    }
}
