use crate::data_storage::DataPaths;
use crate::{ProcessSupervisors, RuntimePaths};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StorageValidationBaseline {
    schema_version: u8,
    ready_models: Vec<String>,
    component_state: String,
    #[serde(deserialize_with = "required_fingerprint")]
    component_fingerprint: Option<String>,
    component_version: String,
    supported_task_ids: Vec<String>,
    collections: crate::collections::CollectionsView,
    ready_components: Vec<ReadyComponent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ready_web_engine: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadyComponent { version: String, fingerprint: String }

fn required_fingerprint<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

impl StorageValidationBaseline {
    fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1
            || self.ready_models.len() > 2
            || self.ready_models.iter().any(|value| !crate::SUPPORTED_ASR_MODELS.contains(&value.as_str()))
            || self.ready_models.iter().collect::<std::collections::HashSet<_>>().len() != self.ready_models.len()
            || !["ready", "missing", "stale", "ungated", "unavailable"].contains(&self.component_state.as_str())
            || self.component_fingerprint.as_ref().is_some_and(|value| value.trim().is_empty() || value.len() > 256)
            || self.component_state == "ready" && self.component_fingerprint.is_none()
            || self.component_version.trim().is_empty()
            || self.component_version.len() > 80
        {
            return Err("ControlInvalid".to_string());
        }
        if self.supported_task_ids.windows(2).any(|pair| pair[0] >= pair[1]) {
            return Err("ControlInvalid".to_string());
        }
        crate::collections::validate_storage_snapshot(&self.collections)
            .map_err(|_| "ControlInvalid".to_string())?;
        if self.ready_components.len() > 256
            || self.ready_components.windows(2).any(|pair| pair[0].version >= pair[1].version)
            || self.ready_components.iter().any(|component| component.version.is_empty()
                || component.version.len() > 80 || matches!(component.version.as_str(), "." | "..")
                || !component.version.chars().all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '+'))
                || component.fingerprint.trim().is_empty() || component.fingerprint.len() > 256)
        { return Err("ControlInvalid".into()); }
        if self.ready_web_engine.as_ref().is_some_and(|value| value.is_empty() || value.len() > 160
            || !value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.')))
        { return Err("ControlInvalid".into()); }
        Ok(())
    }
}

pub(crate) fn capture_for_sources(
    paths: &RuntimePaths,
    data: &DataPaths,
    legacy_sources: &[PathBuf],
    supervisors: &ProcessSupervisors,
    should_cancel: &dyn Fn() -> bool,
) -> Result<StorageValidationBaseline, String> {
    check_cancel(should_cancel)?;
    crate::web_page::recover_workspaces(paths).map_err(|_| "TaskRecoveryFailed".to_string())?;
    let mut roots = vec![data.data_root.join("outputs")];
    if data.output_root.is_absolute() { roots.push(data.output_root.clone()); }
    roots.extend_from_slice(legacy_sources);
    let supported_task_ids = supported_tasks_from_roots(&roots)?;
    let collections = crate::collections::read_for_storage_validation(&data.collections_path)
        .map_err(|_| "VerificationFailed".to_string())?;
    let inspected = inspect_with_cancellation(paths, data, supervisors, false, env!("CARGO_PKG_VERSION"), should_cancel)?;
    let component_state = if inspected.component_state == "ready" {
        match inspect_with_cancellation(paths, data, supervisors, true, env!("CARGO_PKG_VERSION"), should_cancel) {
            Ok(imported) if imported.component_imported && imported.component_fingerprint == inspected.component_fingerprint => "ready".to_string(),
            _ => "unavailable".to_string(),
        }
    } else {
        inspected.component_state
    };
    check_cancel(should_cancel)?;
    let mut ready_components = Vec::new();
    let component_root = data.runtime_root.join("pytorch");
    if component_root.try_exists().map_err(|_| "VerificationFailed".to_string())? {
        let mut versions = std::fs::read_dir(&component_root).map_err(|_| "VerificationFailed".to_string())?
            .map(|entry| entry.map_err(|_| "VerificationFailed".to_string())).collect::<Result<Vec<_>, _>>()?;
        if versions.len() > 256 { return Err("ControlLimit".into()); }
        versions.sort_by_key(|entry| entry.file_name());
        for version in versions {
            check_cancel(should_cancel)?;
            if !version.file_type().map_err(|_| "VerificationFailed".to_string())?.is_dir() { continue; }
            let name = version.file_name().into_string().map_err(|_| "VerificationFailed".to_string())?;
            if name.is_empty() || name.len() > 80 || matches!(name.as_str(), "." | "..")
                || !name.chars().all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '+')) { continue; }
            let _directory = crate::safe_filesystem::open_directory(&version.path()).map_err(|_| "VerificationFailed".to_string())?;
            let status = inspect_with_cancellation(paths, data, supervisors, false, &name, should_cancel)?;
            if status.component_state != "ready" { continue; }
            if let Ok(imported) = inspect_with_cancellation(paths, data, supervisors, true, &name, should_cancel) {
                if imported.component_imported && imported.component_fingerprint == status.component_fingerprint {
                    ready_components.push(ReadyComponent { version: name, fingerprint: imported.component_fingerprint.ok_or("VerificationFailed")? });
                }
            }
            check_cancel(should_cancel)?;
        }
    }
    check_cancel(should_cancel)?;
    if crate::web_page::recovery_required(paths) { return Err("TaskRecoveryFailed".into()); }
    Ok(StorageValidationBaseline {
        schema_version: 1,
        ready_models: inspected.ready_models,
        component_state,
        component_fingerprint: inspected.component_fingerprint,
        component_version: env!("CARGO_PKG_VERSION").to_string(),
        supported_task_ids,
        collections,
        ready_components,
        ready_web_engine: None,
    })
}

fn check_cancel(should_cancel: &dyn Fn() -> bool) -> Result<(), String> {
    if should_cancel() { Err("Cancelled".into()) } else { Ok(()) }
}

fn inspect_with_cancellation(
    paths: &RuntimePaths,
    data: &DataPaths,
    supervisors: &ProcessSupervisors,
    import_component: bool,
    version: &str,
    should_cancel: &dyn Fn() -> bool,
) -> Result<crate::worker_runtime::StorageValidationTerminalResult, String> {
    check_cancel(should_cancel)?;
    let result = supervisors.run_storage_validation_for_component(paths, data, import_component, version);
    check_cancel(should_cancel)?;
    result
}

pub(crate) fn verify(
    paths: &RuntimePaths,
    data: &DataPaths,
    baseline: &StorageValidationBaseline,
    supervisors: &ProcessSupervisors,
) -> Result<(), String> {
    baseline.validate()?;
    crate::web_page::recover_workspaces(paths).map_err(|_| "VerificationFailed".to_string())?;
    verify_library(data, baseline)?;
    let import_component = baseline.component_state == "ready"
        && baseline.component_version == env!("CARGO_PKG_VERSION");
    let inspected = supervisors.run_storage_validation(paths, data, import_component)?;
    if baseline.ready_models.iter().any(|model| !inspected.ready_models.contains(model))
        || import_component && (!inspected.component_imported || inspected.component_fingerprint != baseline.component_fingerprint)
    {
        return Err("VerificationFailed".to_string());
    }
    for component in &baseline.ready_components {
        let imported = supervisors.run_storage_validation_for_component(paths, data, true, &component.version)?;
        if !imported.component_imported || imported.component_fingerprint.as_deref() != Some(component.fingerprint.as_str()) {
            return Err("VerificationFailed".into());
        }
    }
    Ok(())
}

fn supported_tasks_from_roots(roots: &[PathBuf]) -> Result<Vec<String>, String> {
    let mut identities = BTreeSet::new();
    let mut task_ids = BTreeSet::new();
    for root in roots {
        if !root.try_exists().map_err(|_| "VerificationFailed".to_string())? { continue; }
        let identity = crate::safe_filesystem::identity(root).map_err(|_| "VerificationFailed".to_string())?;
        if !identities.insert((identity.volume, identity.file)) { continue; }
        let tasks = crate::task_manifest::SupportedTask::scan_read_only(root)
            .map_err(|_| "VerificationFailed".to_string())?.into_tasks();
        task_ids.extend(tasks.iter().map(|task| task.task_id().to_string()));
    }
    Ok(task_ids.into_iter().collect())
}

fn verify_library(data: &DataPaths, baseline: &StorageValidationBaseline) -> Result<(), String> {
    let supported = supported_tasks_from_roots(std::slice::from_ref(&data.output_root))?;
    let collections = crate::collections::read_for_storage_validation(&data.collections_path)
        .map_err(|_| "VerificationFailed".to_string())?;
    if supported != baseline.supported_task_ids || collections != baseline.collections {
        return Err("VerificationFailed".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored_note(output: &std::path::Path, id: &str) {
        let task = output.join("tasks").join(id);
        std::fs::create_dir_all(&task).unwrap();
        let manifest = serde_json::json!({
            "schema_version": 3, "source_privacy_migration_version": 2, "task_id": id,
            "created_at": "2026-11-01T00:00:00Z", "source_kind": "local_file", "source_url": "",
            "source_identity": null,
            "local_source": {"display_name":"recording.wav","media_kind":"audio","extension":"wav"},
            "platform":"local", "status":"completed", "artifacts":{}, "error":null, "text_preview":"", "insights_count":0,
        });
        std::fs::write(task.join("task.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    }

    #[test]
    fn source_task_scan_merges_default_and_explicit_legacy_roots_without_exposing_opaque_data() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-acceptance")
            .join(format!("task-validation-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let first = root.join("outputs");
        let second = root.join("legacy-outputs");
        stored_note(&first, "default-note");
        stored_note(&second, "legacy-note");
        std::fs::create_dir_all(first.join("tasks/opaque-note")).unwrap();
        std::fs::write(first.join("tasks/opaque-note/legacy.txt"), b"preserved opaque data").unwrap();
        let actual = supported_tasks_from_roots(&[first.clone(), second, first.clone()]).unwrap();
        assert_eq!(actual, ["default-note", "legacy-note"]);
        assert_eq!(std::fs::read(first.join("tasks/opaque-note/legacy.txt")).unwrap(), b"preserved opaque data");
    }

    #[test]
    fn readonly_library_validation_keeps_opaque_collection_references() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-acceptance")
            .join(format!("collection-validation-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let collection = crate::collections::CollectionsView {
            schema_version: 1,
            collections: vec![crate::collections::CollectionView {
                id: uuid::Uuid::new_v4().to_string(), name: "Preserved collection".into(),
                task_ids: vec!["existing-opaque-note".into()],
            }],
        };
        let collection_path = root.join("collections.json");
        let content = serde_json::to_vec(&collection).unwrap();
        std::fs::write(&collection_path, &content).unwrap();
        let baseline = StorageValidationBaseline {
            schema_version: 1, ready_models: vec![], component_state: "ungated".into(), component_fingerprint: None,
            component_version: env!("CARGO_PKG_VERSION").into(), supported_task_ids: vec![], collections: collection,
            ready_components: vec![],
            ready_web_engine: None,
        };
        let data = DataPaths { data_root: root.clone(), output_root: root.join("outputs"), cache_root: root.join("cache"), models_root: root.join("models"), runtime_root: root.join("runtime"), collections_path: collection_path.clone() };
        verify_library(&data, &baseline).unwrap();
        assert_eq!(std::fs::read(&collection_path).unwrap(), content);
        std::fs::write(&collection_path, br#"{"schemaVersion":1,"collections":[]}"#).unwrap();
        assert_eq!(verify_library(&data, &baseline), Err("VerificationFailed".into()));
        std::fs::write(&collection_path, br#"{"schemaVersion":2,"collections":[]}"#).unwrap();
        assert!(crate::collections::read_for_storage_validation(&collection_path).is_err());
    }

    #[test]
    #[ignore = "需要预构建的真实 Python，以生产核验器完成笔记业务迁移验收"]
    fn supported_notes_titles_sidecars_originals_and_collections_roundtrip() {
        use crate::task_manifest::{SupportedTask, TaskArtifact, TaskArtifactMutation, NoteTitle, NoteTitleStatus};
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-acceptance")
            .join(format!("supported-note-roundtrip-{}", uuid::Uuid::new_v4()));
        for part in ["config", "legacy", "target"] { std::fs::create_dir_all(root.join(part)).unwrap(); }
        let root = root.canonicalize().unwrap();
        let config = root.join("config");
        let outputs = config.join("outputs");
        let legacy = root.join("legacy");
        let target = root.join("target");
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").canonicalize().unwrap();
        let paths = RuntimePaths { resource_dir: resources.clone(), user_data_dir: config.clone() };
        stored_note(&outputs, "default-note");
        stored_note(&legacy, "legacy-note");
        let article_dir = outputs.join("tasks/web-note");
        std::fs::create_dir_all(article_dir.join("article")).unwrap();
        let article_text = "第一段网页正文。\r\n\r\n第二段网页正文。\n";
        let article_markdown = "# 迁移网页标题\n\n第一段网页正文。\n\n第二段网页正文。\n";
        std::fs::write(article_dir.join("article/article.txt"), article_text).unwrap();
        std::fs::write(article_dir.join("article/article.md"), article_markdown).unwrap();
        std::fs::write(article_dir.join("task.json"), serde_json::to_vec(&serde_json::json!({
            "schema_version":4,"source_privacy_migration_version":2,"task_id":"web-note",
            "created_at":"2026-11-01T08:00:00Z","source_kind":"web_page",
            "source_url":"https://example.com/article?id=12","source_identity":null,
            "platform":"web","status":"completed","model":null,"transcript":null,
            "web_source":{"title":"迁移网页标题","extracted_at":"2026-11-01T08:00:00Z"},
            "artifacts":{"article_txt":"article/article.txt","article_md":"article/article.md"},
            "text_preview":"第一段网页正文。","error":null,"insights_count":0
        })).unwrap()).unwrap();
        let mut article = SupportedTask::open(&outputs, "web-note").unwrap().into_edit_session();
        article.set_note_pinned(true).unwrap();
        article.set_note_display_title("手动网页标题").unwrap();
        drop(article);
        let text = "今天讨论如何保存笔记和原稿。\n";
        let mut task = SupportedTask::open(&outputs, "default-note").unwrap();
        task.save_note_title(NoteTitle { text: Some("自动生成的笔记标题".into()), status: NoteTitleStatus::Completed, output_language: "zh-CN".into(), error_code: None }).unwrap();
        let mut edit = task.into_edit_session();
        edit.set_artifact(TaskArtifact::TranscriptTxt, "transcript/transcript.txt").unwrap();
        edit.set_artifact(TaskArtifact::Draft, "ai/draft.md").unwrap();
        edit.set_text_preview(text.into());
        crate::task_manifest::commit_task_artifacts(edit.task_dir(), vec![
            TaskArtifactMutation::replace("transcript/transcript.txt", text.as_bytes().to_vec()),
            TaskArtifactMutation::replace("transcript/original/transcript.txt", "原始转译正文。\n".as_bytes().to_vec()),
            TaskArtifactMutation::replace("ai/draft.md", "# 已保存草稿\n正文。\n".as_bytes().to_vec()),
            TaskArtifactMutation::replace("ai/original/draft.md", "# 草稿原稿\n".as_bytes().to_vec()),
            TaskArtifactMutation::manifest(edit.encoded_manifest().unwrap()),
        ]).unwrap();
        edit.set_note_pinned(true).unwrap();
        edit.set_note_display_title("手动命名的笔记").unwrap();
        drop(edit);
        std::fs::create_dir_all(outputs.join("tasks/opaque-note")).unwrap();
        std::fs::write(outputs.join("tasks/opaque-note/legacy.bin"), b"opaque preserved bytes").unwrap();
        let collections = crate::collections::CollectionsView { schema_version: 1, collections: vec![crate::collections::CollectionView {
            id: uuid::Uuid::new_v4().to_string(), name: "迁移验收合集".into(),
            task_ids: vec!["default-note".into(), "legacy-note".into(), "web-note".into(), "opaque-note".into()],
        }] };
        std::fs::write(config.join("collections.json"), serde_json::to_vec(&collections).unwrap()).unwrap();
        let supervisors = ProcessSupervisors::default();
        let manager = crate::data_storage::DataStorageManager::open(config.clone(), resources.clone()).unwrap();
        let preview = manager.prepare_with_validation(target.clone(), vec![legacy.clone()], "notes", 0, &mut || Ok(()), &mut |data, sources| {
            let baseline = capture_for_sources(&paths, data, sources, &supervisors, &|| false).map_err(|code| crate::data_storage::StorageError::new(&code))?;
            assert_eq!(baseline.supported_task_ids, ["default-note", "legacy-note", "web-note"]);
            assert_eq!(baseline.collections, collections);
            serde_json::to_value(baseline).map_err(|_| crate::data_storage::StorageError::new("ControlInvalid"))
        }).unwrap();
        manager.start(&preview.plan_token, "notes", &mut |_| {}).unwrap();
        drop(manager);
        let manager = crate::data_storage::DataStorageManager::open(config, resources).unwrap();
        manager.recheck_with_validator(&mut |data, value| {
            let baseline = serde_json::from_value(value.clone()).unwrap();
            verify(&paths, data, &baseline, &supervisors).map_err(|code| crate::data_storage::StorageError::new(&code))
        }).unwrap();
        let data = paths.data_paths().unwrap();
        let history = crate::history::load_history_from_output_root(&data.output_root).unwrap();
        assert_eq!(history.len(), 3);
        let request = serde_json::from_value(serde_json::json!({"task_id":"default-note"})).unwrap();
        let detail = crate::history::load_history_detail_from_output_root(&data.output_root, request).unwrap();
        assert_eq!(detail.text, text.trim());
        assert_eq!(detail.note_title.unwrap().text.as_deref(), Some("自动生成的笔记标题"));
        let metadata = detail.note_metadata.unwrap();
        assert!(metadata.pinned);
        assert_eq!(metadata.display_title.as_deref(), Some("手动命名的笔记"));
        let view = crate::collections::get_collections_from_paths_for_test(&paths).unwrap();
        assert_eq!(view.collections[0].task_ids, ["default-note", "legacy-note", "web-note"]);
        assert_eq!(crate::collections::read_for_storage_validation(&data.collections_path).unwrap(), collections);
        for relative in ["transcript/transcript.txt", "transcript/original/transcript.txt", "ai/draft.md", "ai/original/draft.md", "app-note-metadata.json"] {
            assert_eq!(std::fs::read(outputs.join("tasks/default-note").join(relative)).unwrap(), std::fs::read(data.output_root.join("tasks/default-note").join(relative)).unwrap());
        }
        assert_eq!(std::fs::read(data.output_root.join("tasks/opaque-note/legacy.bin")).unwrap(), b"opaque preserved bytes");
        let article = SupportedTask::open(&data.output_root, "web-note").unwrap();
        assert_eq!(article.read_source_text().unwrap().raw_bytes, article_text.as_bytes());
        assert_eq!(article.read_article_markdown().unwrap(), article_markdown);
        drop(article);
        let article_detail = crate::history::load_history_detail_from_output_root(&data.output_root,
            serde_json::from_value(serde_json::json!({"task_id":"web-note"})).unwrap()).unwrap();
        assert_eq!(article_detail.text, article_text);
        assert!(article_detail.note_metadata.as_ref().unwrap().pinned);
        assert_eq!(article_detail.note_metadata.unwrap().display_title.as_deref(), Some("手动网页标题"));
        for relative in ["article/article.txt", "article/article.md", "task.json", "app-note-metadata.json"] {
            assert_eq!(std::fs::read(article_dir.join(relative)).unwrap(), std::fs::read(data.output_root.join("tasks/web-note").join(relative)).unwrap());
        }
        std::fs::write(root.join("note-roundtrip-result.json"), serde_json::to_vec_pretty(&serde_json::json!({
            "supportedIds":["default-note","legacy-note","web-note"], "rawCollectionReferences":4, "visibleCollectionReferences":3,
            "automaticTitlePreserved":true,"manualTitlePreserved":true,"pinnedPreserved":true,"transcriptAndOriginalsPreserved":true,
            "articleBytesAndMetadataPreserved":true,
        })).unwrap()).unwrap();
        println!("supported-note evidence: {}", root.display());
    }

    #[test]
    #[ignore = "需要隔离目录中的真实公开模型/组件副本及预构建 Python"]
    fn real_public_model_library_migrates_and_reopens_with_validated_baseline() {
        let root = PathBuf::from(std::env::var_os("APP_STORAGE_ACCEPTANCE_ROOT").expect("isolated acceptance root")).canonicalize().unwrap();
        let allowed = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-acceptance").canonicalize().unwrap();
        assert!(root.starts_with(&allowed) && root != allowed);
        let config = root.join("config");
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").canonicalize().unwrap();
        let target = root.join("target");
        let paths = RuntimePaths { resource_dir: resources.clone(), user_data_dir: config.clone() };
        assert!(!config.join(".env").exists());
        assert!(!config.join("auth").exists());
        let supervisors = ProcessSupervisors::default();
        let manager = crate::data_storage::DataStorageManager::open(config.clone(), resources.clone()).unwrap();
        let preview = manager.prepare_with_validation(target.clone(), vec![], "acceptance", 0, &mut || Ok(()), &mut |data, roots| {
            let baseline = capture_for_sources(&paths, data, roots, &supervisors, &|| false).map_err(|code| crate::data_storage::StorageError::new(&code))?;
            assert!(baseline.ready_models.contains(&"iic/SenseVoiceSmall-onnx".to_string()));
            std::fs::write(root.join("source-baseline.json"), serde_json::to_vec_pretty(&baseline).unwrap()).unwrap();
            serde_json::to_value(baseline).map_err(|_| crate::data_storage::StorageError::new("ControlInvalid"))
        }).expect("prepare real public cache migration");
        manager.start(&preview.plan_token, "acceptance", &mut |_| {}).expect("copy and verify real public cache");
        assert_eq!(manager.state().data_access, "restart_required");
        drop(manager);
        finish_public_model_acceptance(&root, &paths, &supervisors, preview.total_files, preview.total_bytes);
    }

    #[test]
    #[ignore = "使用现有隔离真实模型迁移记录，正式恢复实际I/O中断"]
    fn resume_real_public_model_library_after_actual_io_interruption() {
        let root = PathBuf::from(std::env::var_os("APP_STORAGE_ACCEPTANCE_ROOT").expect("isolated acceptance root")).canonicalize().unwrap();
        let allowed = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/data-storage-acceptance").canonicalize().unwrap();
        assert!(root.starts_with(&allowed) && root != allowed);
        let paths = RuntimePaths {
            resource_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").canonicalize().unwrap(),
            user_data_dir: root.join("config"),
        };
        let manager = crate::data_storage::DataStorageManager::open(paths.user_data_dir.clone(), paths.resource_dir.clone()).unwrap();
        let state = manager.state();
        let operation = state.operation.expect(&format!("actual interrupted operation: access={} error={:?}", state.data_access, state.last_error));
        assert_eq!(operation.phase, "copying");
        let mut last_phase = String::new();
        let mut last_batch = u64::MAX;
        manager.resume(&operation.operation_id, state.generation, "acceptance-recovery", &mut |state| {
            if let Some(operation) = state.operation {
                let batch = operation.completed_files / 4000;
                if operation.phase != last_phase || batch != last_batch {
                    println!("actual recovery: {} {}/{}", operation.phase, operation.completed_files, operation.total_files);
                    last_phase = operation.phase;
                    last_batch = batch;
                }
            }
        }).expect("resume exact durable migration with retained originals");
        drop(manager);
        finish_public_model_acceptance(&root, &paths, &ProcessSupervisors::default(), operation.total_files, operation.total_bytes);
    }

    fn finish_public_model_acceptance(root: &std::path::Path, paths: &RuntimePaths, supervisors: &ProcessSupervisors, total_files: u64, total_bytes: u64) {
        let config = paths.user_data_dir.clone();
        let target = root.join("target");
        let resources = paths.resource_dir.clone();
        let manager = crate::data_storage::DataStorageManager::open(config.clone(), resources).unwrap();
        let state = manager.recheck_with_validator(&mut |data, value| {
            let baseline: StorageValidationBaseline = serde_json::from_value(value.clone()).unwrap();
            verify(paths, data, &baseline, supervisors).map_err(|code| crate::data_storage::StorageError::new(&code))
        }).expect("reopen and validate actual model caches");
        assert_eq!(state.data_access, "ready");
        let data = paths.data_paths().unwrap();
        assert_eq!(data.data_root, target);
        assert!(!config.join(".env").exists());
        assert!(!target.join(".env").exists());
        assert!(config.join("models/onnx").is_dir());
        assert!(target.join("runtime/pytorch/0.4.2/site-packages").is_dir());
        let audio = root.join("zh_16k.wav");
        let request = crate::local_media_contract::serialize_process_local_media_worker_request(
            &audio, crate::local_media_contract::LocalMediaKind::Audio,
            "zh_16k.wav", "wav", "iic/SenseVoiceSmall-onnx",
        ).unwrap();
        let outcome = supervisors.task_worker(paths).execute(crate::worker_runtime::WorkerJob::process_local_media(request, ()))
            .expect("prepare actual worker ASR request").expect("run actual worker ASR");
        let crate::worker_runtime::WorkerRunOutcome::Structured(crate::worker_runtime::ValidatedWorkerResult::Task(result)) = outcome else {
            panic!("actual ASR did not return a validated task result");
        };
        std::fs::write(root.join("asr-result.json"), serde_json::to_vec_pretty(&result).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(result.status).unwrap(), "completed");
        assert!(!result.text.trim().is_empty());
        let output_root = data.output_root.canonicalize().unwrap();
        assert!(result.task_dir.as_ref().is_some_and(|value| PathBuf::from(value).canonicalize().is_ok_and(|task| task.starts_with(&output_root))));
        std::fs::write(root.join("migration-result.json"), serde_json::to_vec_pretty(&serde_json::json!({
            "dataAccess": state.data_access, "files": total_files, "bytes": total_bytes,
            "target": crate::path_to_env_string(&data.data_root), "sourceRetained": true,
        })).unwrap()).unwrap();
    }

    #[test]
    fn durable_baseline_rejects_incomplete_or_incoherent_records() {
        let valid = serde_json::json!({
            "schemaVersion": 1,
            "readyModels": [],
            "componentState": "missing",
            "componentFingerprint": null,
            "componentVersion": "0.4.3",
            "supportedTaskIds": [],
            "collections": {"schemaVersion":1,"collections":[]},
            "readyComponents": []
        });
        let baseline: StorageValidationBaseline = serde_json::from_value(valid.clone()).unwrap();
        assert!(baseline.validate().is_ok());
        assert!(serde_json::to_value(&baseline).unwrap().get("readyWebEngine").is_none());
        let mut legacy = valid.clone();
        legacy["readyWebEngine"] = serde_json::json!("chromium-141.0.7390.37-playwright-1.56.1");
        let legacy_baseline: StorageValidationBaseline = serde_json::from_value(legacy.clone()).unwrap();
        assert!(legacy_baseline.validate().is_ok());
        assert_eq!(serde_json::to_value(legacy_baseline).unwrap(), legacy);
        for field in ["schemaVersion", "readyModels", "componentState", "componentFingerprint", "componentVersion", "supportedTaskIds", "collections", "readyComponents"] {
            let mut record = valid.clone();
            record.as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<StorageValidationBaseline>(record).is_err());
        }
        for (field, value) in [
            ("schemaVersion", serde_json::json!(2)),
            ("readyModels", serde_json::json!(["iic/SenseVoiceSmall", "iic/SenseVoiceSmall"])),
            ("componentState", serde_json::json!("ready")),
            ("componentFingerprint", serde_json::json!(" ")),
            ("componentVersion", serde_json::json!("")),
            ("readyWebEngine", serde_json::json!("../outside")),
        ] {
            let mut record = valid.clone();
            record[field] = value;
            let baseline: StorageValidationBaseline = serde_json::from_value(record).unwrap();
            assert_eq!(baseline.validate(), Err("ControlInvalid".to_string()));
        }
    }
}
