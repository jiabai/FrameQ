# Local Media File Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let FrameQ select one supported local video or audio file, create the existing normalized
WAV/transcript task, and expose it through the same History/workspace/AI lifecycle without leaking
the original path.

**Architecture:** React holds only a discriminated composer source and opaque selection token. Rust
owns native selection, path revalidation, and one task-oriented supervised worker lane. Python opens
the original path once, copies it to a generic task-owned staging file, and runs all media tools only
against task-owned paths; task manifests and History expose a closed URL/local source union.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri 2, Rust, serde, tauri-plugin-dialog, Python 3.12,
pytest, FFmpeg/ffprobe, i18next.

**Execution mode:** Inline execution in the isolated `codex/local-media-import` worktree.

---

### Task 1: Rust native selection capability

**Files:**
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/Cargo.lock`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/src/local_media_contract.rs`
- Create: `app/src-tauri/src/local_media.rs`
- Test: `app/src-tauri/src/local_media.rs`

- [ ] **Step 1: Write failing path/store tests**

Add tests that create regular MP4/MP3 files and assert selection metadata, replacement, matching-token
clear, changed size/mtime rejection, missing-file rejection, and symlink/reparse rejection:

```rust
#[test]
fn selection_store_replaces_and_clears_only_matching_token() {
    let store = LocalMediaSelectionState::default();
    let first = store.select_for_path(video_path("first.mp4")).unwrap();
    let second = store.select_for_path(video_path("second.mp4")).unwrap();
    assert_eq!(store.resolve(&first.selection_token), Err(LOCAL_MEDIA_SELECTION_INVALID));
    assert!(!store.clear(&first.selection_token));
    assert!(store.clear(&second.selection_token));
}
```

- [ ] **Step 2: Run the focused Rust test and verify RED**

Run:

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml local_media::tests
```

Expected: compile failure because `local_media` and `LocalMediaSelectionState` do not exist.

- [ ] **Step 3: Implement the selection owner and picker commands**

Implement these closed capabilities:

```rust
#[derive(Default)]
pub(crate) struct LocalMediaSelectionState {
    current: Mutex<Option<LocalMediaSelection>>,
}

#[tauri::command]
pub(crate) fn select_local_media(
    app: AppHandle,
    state: State<'_, Arc<LocalMediaSelectionState>>,
) -> Result<Option<LocalMediaSelectionView>, String>;

#[tauri::command]
pub(crate) fn clear_local_media_selection(
    state: State<'_, Arc<LocalMediaSelectionState>>,
    selection_token: String,
) -> Result<bool, String>;
```

Use `tauri-plugin-dialog` with the contract allowlists. Validate every existing path component with
`symlink_metadata`, reject links/reparse points, require a positive-size ordinary file, generate a
UUID v4 token, sanitize the basename to at most 160 characters while preserving extension, and keep
path/size/mtime only in the mutex-owned selection.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 1 focused command. Expected: all local-media selection tests pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git add app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock app/src-tauri/src/lib.rs app/src-tauri/src/local_media.rs app/src-tauri/src/local_media_contract.rs
git commit -m "feat(local-media): add native selection capability"
```

### Task 2: Task-oriented worker facade and strict local command

**Files:**
- Modify: `app/src-tauri/src/worker_runtime/mod.rs`
- Modify: `app/src-tauri/src/worker_runtime/facade.rs`
- Modify: `app/src-tauri/src/worker_runtime/command.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner/watchdog.rs`
- Modify: `app/src-tauri/src/worker_runtime/result_protocol.rs`
- Modify: `app/src-tauri/src/video_processing.rs`
- Modify: `app/src-tauri/src/video_processing/task_result.rs`
- Modify: `app/src-tauri/src/video_processing/url_processing.rs`
- Create: `app/src-tauri/src/video_processing/local_media.rs`
- Modify: `app/src-tauri/src/history_deletion.rs`
- Test: the corresponding Rust inline/private test modules

- [ ] **Step 1: Write failing facade/command/result tests**

Lock the new job policy and path secrecy:

```rust
let request = supervisors
    .task_worker(&paths)
    .prepare_for_test(WorkerJob::process_local_media(payload.clone(), ()), |_| {
        panic!("local media must not resolve LLM material")
    })
    .unwrap();
assert_eq!(request.operation, WorkerOperation::ProcessLocalMedia);
assert_eq!(request.command.args, ["-m", "frameq_worker", "--process-local-media-stdin"]);
assert_eq!(request.command.stdin_payload.as_deref(), Some(payload.as_str()));
assert!(!request.command.args.join(" ").contains("review-secret"));
```

Also assert `ProcessLocalMedia` uses the process-media watchdog and parses the task terminal family.

- [ ] **Step 2: Run focused worker-runtime tests and verify RED**

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml worker_runtime
```

Expected: compile failures for `task_worker`, `TaskWorkerFacade`, and `ProcessLocalMedia`.

- [ ] **Step 3: Rename and extend the closed runtime**

Atomically rename:

```rust
VideoWorkerFacade -> TaskWorkerFacade
ProcessSupervisors.video -> ProcessSupervisors.task
video_worker() -> task_worker()
cancel_video() -> cancel_task()
is_video_active() -> is_task_active()
```

Add:

```rust
WorkerJob::ProcessLocalMedia { payload, progress }
WorkerInvocation::ProcessLocalMedia(String)
WorkerOperation::ProcessLocalMedia
```

Derive fixed `--process-local-media-stdin`, task-result parsing, worker progress, process-media
watchdog, and no-LLM policy. Keep public `process_video` and `cancel_process` IPC names unchanged.

- [ ] **Step 4: Implement strict `process_local_media` orchestration**

Parse the token-only request with `parse_process_local_media_ipc_request`, resolve/revalidate it in
the Rust selection store, resolve ASR settings, serialize the exact v4 stdin request, execute
`WorkerJob::ProcessLocalMedia`, and map the result through `TaskCommandContext::ProcessLocalMedia`.
Clear selection on success and invalid-source terminal codes; retain it on cancellation and retryable
processing failures.

- [ ] **Step 5: Run focused Rust tests and verify GREEN**

Run worker-runtime, video-processing, local-media, and history-deletion tests. Expected: all pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add app/src-tauri/src
git commit -m "feat(local-media): add supervised local worker command"
```

### Task 3: Python closed task-source persistence

**Files:**
- Modify: `worker/frameq_worker/task_store.py`
- Modify: `worker/frameq_worker/pipeline_runtime/transcript.py`
- Test: `worker/tests/test_task_store.py`
- Test: `worker/tests/test_pipeline.py`

- [ ] **Step 1: Write failing local task-store tests**

Assert unique local task IDs and the exact schema-v3 variant:

```python
context = store.create_local(local_request, now=fixed_now, random_id="abc123")
result = store.finalize(context, completed_result)
manifest = json.loads(context.paths.manifest_path.read_text("utf-8"))
assert manifest["source_kind"] == "local_file"
assert manifest["source_url"] == ""
assert manifest["source_identity"] is None
assert manifest["local_source"] == {
    "display_name": "Interview.wmv",
    "media_kind": "video",
    "extension": "wmv",
}
assert "review-secret" not in json.dumps(manifest)
```

Also assert URL serialization is byte-compatible apart from no required new discriminator and local
tasks reopen for transcript/AI operations.

- [ ] **Step 2: Run focused worker tests and verify RED**

```powershell
D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_task_store.py worker/tests/test_pipeline.py -q
```

Expected: failure because `create_local` and the local source model do not exist.

- [ ] **Step 3: Implement closed Python task sources**

Add:

```python
@dataclass(frozen=True)
class UrlTaskSource:
    identity: SourceIdentity

@dataclass(frozen=True)
class LocalFileTaskSource:
    display_name: str = field(repr=False)
    media_kind: LocalMediaKind
    extension: str

TaskSource = UrlTaskSource | LocalFileTaskSource
```

Make `TaskContext` own `source: TaskSource`, retain read-only compatibility properties only where
existing URL transcript code needs `source_identity`, and add the semantic `TaskStoreFacade.create_local`
method. Serialize/open URL and local variants exhaustively; never store the original path.

- [ ] **Step 4: Run focused worker tests and verify GREEN**

Run the Task 3 command. Expected: all selected tests pass.

- [ ] **Step 5: Commit Task 3**

```powershell
git add worker/frameq_worker/task_store.py worker/frameq_worker/pipeline_runtime/transcript.py worker/tests/test_task_store.py worker/tests/test_pipeline.py
git commit -m "feat(local-media): persist closed local task sources"
```

### Task 4: Python staging, probe, normalization, and CLI pipeline

**Files:**
- Modify: `worker/frameq_worker/media_preparation.py`
- Modify: `worker/frameq_worker/pipeline_runtime/orchestration.py`
- Modify: `worker/frameq_worker/pipeline.py`
- Modify: `worker/frameq_worker/worker_service.py`
- Modify: `worker/frameq_worker/cli.py`
- Test: `worker/tests/test_media_preparation.py`
- Test: `worker/tests/test_pipeline.py`
- Test: `worker/tests/test_cli.py`

- [ ] **Step 1: Write failing staging and media-kind tests**

Use a recording `CommandRunner` and sensitive original path. Assert:

```python
prepared = facade.prepare(LocalMediaSource(request), task_context)
assert all("review-secret" not in arg for command in commands for arg in command)
assert prepared.audio_path == task_context.paths.audio_path
assert prepared.video_path == task_context.paths.video_path_for_extension("wmv")
```

Cover video+audio requirements, audio cover art, missing streams, copy failure, WAV validation,
audio staging cleanup, video byte preservation, and registered progress events.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_media_preparation.py worker/tests/test_pipeline.py worker/tests/test_cli.py -q
```

Expected: failure because `LocalMediaSource`, local pipeline, and CLI mode do not exist.

- [ ] **Step 3: Implement generic task-owned staging**

Add `LocalMediaSource` to `MediaPreparationFacade`. Copy with Python file objects in bounded chunks
to a unique generic task path whose basename contains no source name. Probe/FFmpeg receive only that
path. Validate video+audio for video and audio for audio (ignore cover art as video).

For video, atomically promote the validated stage to `media/video.<source_extension>` and normalize
from that official artifact. For audio, normalize from stage and remove it on success/failure.
Validate the official WAV as 16 kHz mono signed 16-bit PCM before commit.

- [ ] **Step 4: Add local orchestration and CLI consumption**

Implement:

```python
def run_local_media_once(request_json: str, ...) -> dict[str, object]

def run_local_media_pipeline(
    request: ProcessLocalMediaRequest,
    project_root: Path,
    ...
) -> ProcessResult
```

Register `--process-local-media-stdin`, reuse bounded stdin/progress/ASR behavior, never invoke source
resolvers/subtitle discovery/LLM, and map all exceptions to existing fixed local-media codes.

- [ ] **Step 5: Run focused and full worker gates**

Run the Task 4 command, then:

```powershell
D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests -q
D:\Github\FrameQ\.venv\Scripts\python.exe -m ruff check worker
```

Expected: all worker tests pass and Ruff reports no errors.

- [ ] **Step 6: Commit Task 4**

```powershell
git add worker
git commit -m "feat(local-media): process local sources through task staging"
```

### Task 5: Rust manifest and History source union

**Files:**
- Modify: `app/src-tauri/src/task_manifest/schema.rs`
- Modify: `app/src-tauri/src/task_manifest/access.rs`
- Modify: `app/src-tauri/src/task_manifest/tests.rs`
- Modify: `app/src-tauri/src/task_manifest.rs`
- Modify: `app/src-tauri/src/history.rs`
- Test: the corresponding Rust test modules

- [ ] **Step 1: Write failing schema/History tests**

Create local video/audio manifests and assert the closed projection:

```rust
assert_eq!(
    history[0].source,
    TaskSourceSummary::LocalFile {
        display_name: "Interview.wmv".to_string(),
        media_kind: LocalMediaKind::Video,
    }
);
```

Assert missing/extra/unsafe local metadata, nonempty URL, non-null identity, unknown `source_kind`,
absolute paths, controls, bidi text, and wrong kind/extension all fail closed without mutation.

- [ ] **Step 2: Run focused Rust tests and verify RED**

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml task_manifest
cargo test --manifest-path app/src-tauri/Cargo.toml history
```

Expected: compile or assertion failure because local schema and `source` DTO do not exist.

- [ ] **Step 3: Implement the closed manifest source**

Add strict `LocalSourceManifest` and serializable:

```rust
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum TaskSourceSummary {
    Url { url: String },
    LocalFile {
        #[serde(rename = "displayName")]
        display_name: String,
        #[serde(rename = "mediaKind")]
        media_kind: LocalMediaKind,
    },
}
```

Make `source_privacy_ready` exhaustive over legacy/current URL and `local_file`; keep unknown variants
unsupported. Expose the source only through `SupportedTask`.

- [ ] **Step 4: Replace History URL fields**

Replace list/detail `url` with `source: TaskSourceSummary`; preserve task-root reads, scan isolation,
deletion, transcript, and AI behavior.

- [ ] **Step 5: Run focused and full Rust gates**

Run Task 5 focused tests, then the full native-permission Rust suite. Expected: all pass.

- [ ] **Step 6: Commit Task 5**

```powershell
git add app/src-tauri/src/task_manifest.rs app/src-tauri/src/task_manifest app/src-tauri/src/history.rs
git commit -m "feat(local-media): expose closed task source history"
```

### Task 6: TypeScript client, workflow state, and controller unions

**Files:**
- Create: `app/src/localMediaClient.ts`
- Create: `app/src/localMediaClient.test.ts`
- Modify: `app/src/workerClient.ts`
- Modify: `app/src/workerClient.test.ts`
- Modify: `app/src/historyClient.ts`
- Modify: `app/src/historyClient.test.ts`
- Modify: `app/src/workflowState.ts`
- Modify: `app/src/workflow.test.ts`
- Modify: `app/src/features/workflow/useTaskProcessingController.ts`
- Modify: `app/src/features/workflow/useTaskProcessingController.test.ts`
- Modify: tests constructing `WorkflowState` or History DTOs

- [ ] **Step 1: Write failing client/union tests**

Lock:

```ts
type TaskSubmission =
  | { kind: "url"; url: string }
  | { kind: "local_media"; selectionToken: string };

type TaskSourceSummary =
  | { kind: "url"; url: string }
  | { kind: "local_file"; displayName: string; mediaKind: LocalMediaKind };
```

Test exact picker/clear/process IPC ledgers, invalid response rejection, local submit dispatch, URL
regression, History restore, cancellation retention, success/invalid-source token clearing, stale
operation suppression, and AI retry source preservation.

- [ ] **Step 2: Run focused App tests and verify RED**

```powershell
npm.cmd --prefix app test -- --run src/localMediaClient.test.ts src/workerClient.test.ts src/historyClient.test.ts src/workflow.test.ts src/features/workflow/useTaskProcessingController.test.ts
```

Expected: failures for missing local client and URL-only workflow fields.

- [ ] **Step 3: Implement strict clients and state**

Add `selectLocalMedia`, `clearLocalMediaSelection`, and `processLocalMedia`; validate selection
through `parseLocalMediaSelectionView` and process input through `parseProcessLocalMediaRequest`.

Replace `WorkflowState.url/submittedUrl/showUrlInput` with:

```ts
composerSource: TaskComposerSource;
taskSource: TaskSourceSummary | null;
```

Make `startProcessing`, cancellation, progress, result merge, History restore, and AI retry preserve
the source invariants.

- [ ] **Step 4: Move DOM events out of the application controller**

Expose `submitTask(submission, account, openAccountPanel)` and dispatch exhaustively to
`processVideo` or `processLocalMedia`. The React form adapter alone calls `preventDefault`.

- [ ] **Step 5: Run focused and full App tests**

Run Task 6 focused tests, then `npm.cmd --prefix app test`. Expected: all tests pass.

- [ ] **Step 6: Commit Task 6**

```powershell
git add app/src
git commit -m "feat(local-media): model workflow sources as closed unions"
```

### Task 7: Composer, History presentation, localization, and browser smoke

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/App.css`
- Modify: `app/src/taskWorkspaceViewModel.ts`
- Modify: `app/src/features/history/HistorySheet.tsx`
- Modify: `app/src/i18n/workflowResources.ts`
- Modify: `app/src/i18n/historyResources.ts`
- Modify: `app/src/i18n/progressResources.ts`
- Modify: relevant component/i18n tests
- Modify: `tests/app-input.browser.test.ts`

- [ ] **Step 1: Write failing UI/i18n/browser tests**

Cover the attachment menu, picker cancellation, local chip, localized size, remove/replace, retained
URL draft, keyboard focus/Escape/outside click, local video/audio completion copy, source-aware
History labels, no audio Locate Video action, and `720x640` overflow.

- [ ] **Step 2: Run focused UI tests and verify RED**

```powershell
npm.cmd --prefix app test -- --run src/features/history/HistorySheet.test.tsx src/taskWorkspaceViewModel.test.ts src/i18n/resources.test.ts
```

Expected: missing source-aware UI and locale keys.

- [ ] **Step 3: Implement the one-composer UI**

Add a left `+` button and one-item attachment menu. Render either the URL input or removable local
chip from `composerSource.kind`; selection never auto-submits. Keep confirmation/account behavior,
focus restoration, disabled state, and existing compact visual language.

- [ ] **Step 4: Implement source-aware History/workspace copy**

Use safe local display names without translation, localized media-kind labels, audio-only completion
copy, and artifact-presence-based actions. Add identical key sets for `zh-CN`, `zh-TW`, and `en-US`.

- [ ] **Step 5: Run App build and browser smoke**

```powershell
npm.cmd --prefix app test
npm.cmd --prefix app run lint
npm.cmd --prefix app run build
npm.cmd --prefix app test -- --run tests/app-input.browser.test.ts
```

Expected: all tests/lint/build pass.

- [ ] **Step 6: Commit Task 7**

```powershell
git add app/src tests/app-input.browser.test.ts
git commit -m "feat(local-media): add localized file import composer"
```

### Task 8: Packaged worker, cross-language gates, and closeout

**Files:**
- Modify through supported synchronization: `app/src-tauri/resources/worker/frameq_worker/**`
- Modify: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`
- Modify: `TASKS.md`
- Modify: architecture/security/audit documents only where implementation evidence changes

- [ ] **Step 1: Refresh packaged worker through the repository script**

Discover and run the existing canonical-to-resource synchronization command; do not hand-edit the
ignored mirror.

- [ ] **Step 2: Run cross-language and privacy gates**

Verify contract parity, mirror byte equality, original-path absence in frontend/argv/env/results/
progress/errors/logs/manifests/prompts, all allowlists, and URL/ASR/AI Credits regressions.

- [ ] **Step 3: Run the complete automated gate**

```powershell
npm.cmd --prefix app test
npm.cmd --prefix app run lint
npm.cmd --prefix app run build
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests -q
D:\Github\FrameQ\.venv\Scripts\python.exe -m ruff check worker
node --test scripts/tests/*.test.mjs
python scripts/validate_agents_docs.py --level WARN
npm.cmd --prefix app run tauri -- build --no-bundle
git diff --check
```

Expected: every command exits zero. Run Rust outside the restricted process sandbox on Windows so
the existing `taskkill` fixtures can execute.

- [ ] **Step 4: Record native evidence and residual risk**

Record Windows MP4/WMV/MP3/WAV evidence if fixtures and a Tauri window are available. Keep macOS,
unavailable codecs, or unavailable real-device evidence explicitly unverified.

- [ ] **Step 5: Update living documents and commit**

Mark only actually verified checkboxes, record exact counts, keep the ExecPlan active if any required
native acceptance is unavailable, and commit:

```powershell
git add TASKS.md docs app/src-tauri/resources/worker
git commit -m "docs(local-media): record implementation verification"
```

## Self-Review

- Spec coverage: Tasks 1-7 cover picker/token lifecycle, strict IPC, one supervisor lane, generic
  staging, media validation/normalization, manifest/History, closed frontend unions, UI/i18n, and
  AI/URL regressions. Task 8 covers packaging, privacy, and native residual evidence.
- Placeholder scan: no implementation step relies on `TBD`, `TODO`, or an unspecified error policy.
- Type consistency: command intent uses `local_media`; persisted/history source uses `local_file`;
  both use camelCase in frontend IPC/views and snake_case in Python/manifest wire data.
