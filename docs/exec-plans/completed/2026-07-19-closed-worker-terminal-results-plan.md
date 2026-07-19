# Closed Worker Terminal Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Reject malformed, additional, wrong-typed, and operation-mismatched worker terminal
results at both the Rust stdout and TypeScript IPC boundaries without echoing rejected content.

**Architecture:** The canonical v3 contract declares three closed terminal-result families. Python
continues to produce results, Rust parses exactly one stdout JSON line into operation-specific typed
DTOs, and TypeScript independently parses unknown Tauri task results before they reach workflow
state. Cached and synthetic Rust task results pass through the same final DTO.

**Tech Stack:** JSON contract, Python 3/pytest, Rust/Serde/Cargo, TypeScript 5, Tauri IPC, Vitest.

---

## Purpose / Big Picture

Valid processing, AI retry, source preflight, model download, cache reuse, and cancellation keep the
same product behavior. An invalid worker or IPC result fails closed with a fixed protocol code and
never exposes rejected JSON, paths, transcript, generated content, or exception text. This work
formalizes current contract v3 and leaves local-media contract v4 untouched.

## Progress

- [x] 2026-07-19: Confirmed the permissive Rust stdout scan, assertion-only TypeScript task/model
  values, Python producer families, cancellation precedence, and contract-v4 ownership. Validation:
  focused source review plus passing baseline app 21 focused tests, worker contract 11 tests, Rust
  runner 12 tests, docs ERROR gate, and a clean isolated branch.
- [x] 2026-07-19: Recorded and received user approval for the operation-specific defense-in-depth
  design. Validation: commit `6f99e52` and user response `设计通过`.
- [x] 2026-07-19: Registered closed result schemas and safe Python producers after expected RED
  failures for missing schema, leaked `model_dir`/exception text, and the wrong source failure family.
  Validation: Python contract 12/12, TypeScript contract 10/10, and Python CLI/model 35/35 passed.
- [x] 2026-07-19: Added the Rust operation-specific terminal-result parser after an expected RED
  compile failure for the absent API. Validation: result-protocol tests 8/8 and `cargo fmt --check`
  passed; dead-code warnings are expected until Task 4 connects the parser to the runner.
- [x] 2026-07-19: Replaced permissive Rust stdout parsing and raw application `Value` consumption.
  Validation: result protocol 8/8, runner 12/12, video 18/18, model 7/7, and full Rust 157/157
  passed with `cargo fmt --check` and `git diff --check` clean.
- [x] 2026-07-19: Parsed unknown task/model/cancel IPC values in TypeScript and copied accepted
  values into closed results. Validation: focused 127/127, full app 540/540, lint, and production
  build passed; the existing Vite chunk-size warning remains.
- [x] 2026-07-19: Completed full gates, updated measured results, and archived this plan. Validation:
  worker 411/411, Rust 157/157, app 540/540, scripts 23/23, Ruff, lint/build, rustfmt, packaged
  worker equality, governance, and diff gates passed.

## Surprises & Discoveries

- Evidence: `runner.rs` uses `String::from_utf8_lossy`, scans stdout lines in reverse, and accepts the
  first JSON value with any `status` key. Its error includes a stdout preview that the fixed protocol
  failure no longer needs.
- Evidence: model results include unused `model_dir`; `ModelDownloadError.message` and `str(exc)` may
  include URLs, hashes, local paths, or archive members.
- Evidence: `stdin_failure_result("resolve_source_identity")` emits the task family, so source stdin
  failure must change before operation-specific parsing can be enabled.
- Evidence: Rust child-process tests print ad-hoc result fields. They must emit a complete task result
  and use child exit status for privacy assertions.
- Evidence: the restricted sandbox cannot terminate one Windows child-tree fixture; the exact runner
  suite passes outside it in 0.29 seconds.
- Evidence: Rust's test harness writes its own progress to child stdout, so self-spawned successful
  fixtures violate the new one-line terminal protocol. Operation fixtures now use quiet platform
  shells that emit only the terminal result; lifecycle-only self-spawned fixtures remain unchanged.
- Evidence: the production Vite build still reports the pre-existing warning that the main minified
  chunk exceeds 500 kB; this result parser adds no new runtime dependency.
- Evidence: the first full worker run reached 281 passing tests but 130 setup errors because the
  machine's default pytest temp directory denied access. Re-running with a writable explicit
  `--basetemp` and disabled cache provider passed 411/411; no assertion failure was hidden.
- Evidence: Windows PowerShell lacks the .NET `Path.GetRelativePath` API used by the first mirror
  comparison attempt. A cross-platform Node SHA-256 comparison replaced that invalid harness and
  verified all 32 files with zero forbidden cache entries or mismatches.

## Decision Log

- Decision: Keep contract version 3 and add `terminalResults`. Rationale: desktop and bundled worker
  ship atomically; local media owns request contract v4. Date/Author: 2026-07-19, User + Codex.
- Decision: Accept unknown task error codes only when they match
  `^[A-Z][A-Z0-9_]{0,63}$`. Rationale: safe forward compatibility preserves generic localized
  guidance without accepting arbitrary strings. Date/Author: 2026-07-19, User + Codex.
- Decision: Allow model failures only fixed public messages and never serialize `model_dir`.
  Rationale: no consumer needs path/URL/hash/archive-member details. Date/Author: 2026-07-19,
  User + Codex.
- Decision: Use native validators plus shared drift tests, not runtime JSON-Schema dependencies or a
  generated envelope. Rationale: this yields typed application values and semantic checks with a
  smaller compatible migration. Date/Author: 2026-07-19, User + Codex.
- Decision: Execute inline in the isolated worktree. Rationale: this side conversation forbids
  subagents and the user approved implementation. Date/Author: 2026-07-19, Codex.

## Outcomes & Retrospective

Implemented the canonical v3 `terminalResults` registry, safe Python producer changes, strict Rust
stdout framing and operation DTOs, exhaustive Rust application mapping, and independent TypeScript
IPC parsing. Invalid values now fail with fixed non-echoing errors; valid task, source, model,
cancellation, cached, and synthetic behavior remains covered.

Fresh closeout evidence: worker 411/411 with one Python 3.13 `audioop` deprecation warning; Ruff
clean; scripts 23/23; app 540/540 plus lint and production build; Rust 157/157 plus rustfmt; and 32
canonical/packaged worker files matched by relative path and SHA-256 with no Python cache files. The
production build retains the pre-existing >500 kB main-chunk warning. The local pytest command needs
an explicit writable `--basetemp` on this machine because its default temp ACL is broken.

Residual risks: native validators can drift if future shape changes bypass the required shared
contract/key tests. Structurally valid large transcript/AI strings retain existing IPC/resource
behavior; this work introduces no arbitrary user-content cap. macOS process-group behavior was not
freshly rerun because this change preserves that lifecycle and it remains covered by the existing
hosted release gate.

## Context and Orientation

- Design: `docs/design-docs/2026-07-19-closed-worker-terminal-results.md`.
- Contract: `contracts/desktop-worker-contract.json`.
- Python: `worker/frameq_worker/models.py`, `worker/frameq_worker/worker_service.py`,
  `worker/frameq_worker/cli.py`, `worker/tests/test_contract.py`, `worker/tests/test_cli.py`, and
  `worker/tests/test_model_download.py`.
- Rust protocol/lifecycle: `app/src-tauri/src/worker_runtime/result_protocol.rs` (new),
  `app/src-tauri/src/worker_runtime/runner.rs`, and `app/src-tauri/src/worker_runtime/mod.rs`.
- Rust consumers: `app/src-tauri/src/video_processing.rs` and `app/src-tauri/src/asr_model.rs`.
- TypeScript: `app/src/workerResultProtocol.ts` (new), `app/src/workerClient.ts`,
  `app/src/settingsClient.ts`, `app/src/workerErrorCopy.ts`, and their focused tests.
- Packaging: `scripts/tauri-dev-fresh-worker.mjs` and `scripts/build-installer.mjs` copy canonical
  Python sources; the Tauri resource worker is an ignored generated mirror.

## File Structure

- Create `app/src-tauri/src/worker_runtime/result_protocol.rs` for framing, strict DTOs, semantic
  checks, typed variants, fixed parse categories, and Rust/contract drift tests.
- Create `app/src/workerResultProtocol.ts` for task and worker-related Tauri response parsing without
  logging or stringifying rejected data.
- Create `app/src/workerResultProtocol.test.ts` for direct positive/negative parser tables.
- Modify the canonical contract, Python producer/service tests, Rust runner/consumers/tests,
  TypeScript clients/tests/error mapping, and governance/index files listed above.

## Plan of Work

1. Add failing shared-contract tests, then register exact v3 terminal-result schemas.
2. Add failing Python source/model tests, then remove paths/raw exceptions and correct source stdin.
3. Add failing Rust parser tests, then implement exact framing, DTOs, semantics, and typed variants.
4. Preserve runner cancellation precedence and migrate task/source/model adapters to typed results.
5. Add failing TypeScript parser/gateway tests, then parse task/model/cancel values before use.
6. Run full gates, audit the scoped diff, record evidence, and archive the ExecPlan.

## Task 1: Canonical terminal-result contract

**Files:**
- Modify: `worker/tests/test_contract.py`
- Modify: `app/src/desktopWorkerContract.test.ts`
- Modify: `contracts/desktop-worker-contract.json`

- [x] **Step 1: Write failing contract assertions**

```python
terminal = load_contract()["terminalResults"]
assert terminal["stdout"] == {
    "encoding": "utf-8",
    "nonEmptyLineCount": 1,
    "diagnosticsChannel": "stderr",
    "invalidPayloadPolicy": "reject_without_echo",
}
assert terminal["operations"] == {
    "process_video": "task",
    "retry_insights": "task",
    "resolve_source_identity": "sourceIdentity",
    "download_asr_model": "modelDownload",
}
assert terminal["safeErrorCode"] == {
    "type": "string", "minLength": 1, "maxLength": 64,
    "pattern": r"^[A-Z][A-Z0-9_]{0,63}$",
}
```

TypeScript asserts the same framing/operation map and checks that the task required keys, artifact
properties, insight properties, terminal statuses, and model-message enum are internally closed.
Task 5 adds the parser-to-contract drift comparison after parser constants exist.

- [x] **Step 2: Run tests and verify RED**

```powershell
D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker\tests\test_contract.py -q
npm.cmd test -- --run src\desktopWorkerContract.test.ts
```

Expected: both suites fail because `terminalResults` is absent.

- [x] **Step 3: Add the registry and full schemas**

```json
{
  "stdout": {
    "encoding": "utf-8",
    "nonEmptyLineCount": 1,
    "diagnosticsChannel": "stderr",
    "invalidPayloadPolicy": "reject_without_echo"
  },
  "operations": {
    "process_video": "task",
    "retry_insights": "task",
    "resolve_source_identity": "sourceIdentity",
    "download_asr_model": "modelDownload"
  },
  "safeErrorCode": {
    "type": "string",
    "minLength": 1,
    "maxLength": 64,
    "pattern": "^[A-Z][A-Z0-9_]{0,63}$"
  }
}
```

Under `schemas`, declare all nine task fields, the ten artifact properties, six insight fields,
transcript/error objects, terminal status and workflow-stage enums, null unions, exact
`additionalProperties: false`, and status/error coherence constraints. Source identity and model
download use exact `oneOf` success/failure objects. Model messages are restricted to
`ASR model download failed.` and `Downloaded ASR model archive was invalid.`.

- [x] **Step 4: Run focused tests and verify GREEN**

Run both Step 2 commands. Expected: focused contract tests pass.

- [x] **Step 5: Commit**

```powershell
git add contracts\desktop-worker-contract.json worker\tests\test_contract.py app\src\desktopWorkerContract.test.ts
git commit -m "contract(worker): close terminal result schemas"
```

## Task 2: Safe Python terminal producers

**Files:**
- Modify: `worker/tests/test_model_download.py`
- Modify: `worker/tests/test_cli.py`
- Modify: `worker/frameq_worker/worker_service.py`
- Modify: `worker/frameq_worker/cli.py`

- [x] **Step 1: Write failing producer privacy tests**

```python
def test_model_download_result_never_exposes_path_or_exception(monkeypatch, tmp_path):
    secret = "review-secret"
    monkeypatch.setattr(
        worker_service,
        "download_asr_model_cache",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError(secret)),
    )
    result = worker_service.run_asr_model_download_once(
        project_root=tmp_path,
        environ={"FRAMEQ_MODEL_DIR": str(tmp_path / secret)},
    )
    assert result == {
        "status": "failed",
        "code": "ASR_MODEL_DOWNLOAD_FAILED",
        "message": "ASR model download failed.",
    }
    assert secret not in repr(result)
```

Add archive-error, success-without-`model_dir`, and source-stdin-failure exact-shape cases.

- [x] **Step 2: Run tests and verify RED**

```powershell
D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker\tests\test_model_download.py worker\tests\test_cli.py -q
```

Expected: failures expose `model_dir`, exception text, and a task-shaped source failure.

- [x] **Step 3: Implement fixed mappings**

```python
def _safe_model_download_failure(code: str) -> tuple[str, str]:
    if code == "ASR_MODEL_ARCHIVE_INVALID":
        return code, "Downloaded ASR model archive was invalid."
    return "ASR_MODEL_DOWNLOAD_FAILED", "ASR model download failed."
```

Return only status/code/fixed message on failure and status/model on success. Make
`stdin_failure_result("resolve_source_identity")` return exactly
`{"status": "failed", "error": {"code": "WORKER_STDIN_INVALID"}}`; retain full task failures for
process/retry.

- [x] **Step 4: Run focused tests and verify GREEN**

Run Step 2. Expected: all focused tests pass without the secret in output.

- [x] **Step 5: Commit**

```powershell
git add worker\frameq_worker\worker_service.py worker\frameq_worker\cli.py worker\tests\test_model_download.py worker\tests\test_cli.py
git commit -m "fix(worker): sanitize terminal result producers"
```

## Task 3: Rust operation-specific result parser

**Files:**
- Create: `app/src-tauri/src/worker_runtime/result_protocol.rs`
- Modify: `app/src-tauri/src/worker_runtime/mod.rs`

- [x] **Step 1: Create the test module and write failing parser tests**

```rust
let parsed = parse_terminal_result(
    WorkerOperation::ProcessVideo,
    valid_task_json().as_bytes(),
).expect("valid task result");
assert!(matches!(parsed, ValidatedWorkerResult::Task(_)));

for invalid in invalid_task_fixtures() {
    assert_eq!(
        parse_terminal_result(WorkerOperation::ProcessVideo, invalid.as_bytes()),
        Err(TerminalResultError::Invalid),
    );
}
```

Fixtures cover unknown top-level/artifact/transcript/insight/error fields, wrong types, non-safe
integers, invalid status/source/stage/code, status-error incoherence, invalid UTF-8, empty output,
two non-empty lines, operation mismatch, source URL/identity mismatch, and model `model_dir`/message.
Create the file with this test module and register `mod result_protocol;` in `worker_runtime/mod.rs`,
but leave the production types/functions absent for the RED compile.

- [x] **Step 2: Run tests and verify RED**

```powershell
$env:CARGO_TARGET_DIR='D:\Github\FrameQ\app\src-tauri\target'
cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime::result_protocol::tests
```

Expected: compilation fails because the module/API is absent.

- [x] **Step 3: Implement strict framing and DTOs**

```rust
pub(crate) const WORKER_PROTOCOL_VIOLATION: &str = "WORKER_PROTOCOL_VIOLATION";

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum TerminalResultError { Missing, Invalid }

#[derive(Debug, PartialEq)]
pub(crate) enum ValidatedWorkerResult {
    Task(TaskTerminalResult),
    SourceIdentity(SourceIdentityTerminalResult),
    ModelDownload(ModelDownloadTerminalResult),
}

pub(crate) fn parse_terminal_result(
    operation: WorkerOperation,
    stdout: &[u8],
) -> Result<ValidatedWorkerResult, TerminalResultError>;
```

Use strict UTF-8, exactly one trimmed non-empty line, operation-selected Serde DTOs, and
`#[serde(deny_unknown_fields)]`. Validate artifact allowlist, JavaScript-safe insight integers,
64-byte safe codes, terminal status/error coherence, fixed model messages, safe source identity, and
`source_url == canonical_url`.

- [x] **Step 4: Run focused parser tests and verify GREEN**

Run Step 2. Expected: result-protocol tests pass; runner fixtures are completed in Task 4.

- [x] **Step 5: Commit**

```powershell
git add app\src-tauri\src\worker_runtime\result_protocol.rs app\src-tauri\src\worker_runtime\mod.rs
git commit -m "feat(worker): parse typed terminal results"
```

## Task 4: Rust typed application adapters

**Files:**
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `app/src-tauri/src/worker_runtime/result_protocol.rs`
- Modify: `app/src-tauri/src/worker_runtime/mod.rs`
- Modify: `app/src-tauri/src/video_processing.rs`
- Modify: `app/src-tauri/src/asr_model.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [x] **Step 1: Update runner/application tests for typed outcomes**

Child fixtures emit all nine task fields; privacy children use process exit status rather than extra
JSON fields. Add assertions that protocol errors map to `WORKER_PROTOCOL_VIOLATION` task failures,
source results yield only source variants, and model results yield only model variants.

- [x] **Step 2: Run tests and verify RED**

```powershell
$env:CARGO_TARGET_DIR='D:\Github\FrameQ\app\src-tauri\target'
cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime::runner::tests
cargo test --manifest-path app\src-tauri\Cargo.toml video_processing::tests
cargo test --manifest-path app\src-tauri\Cargo.toml asr_model::tests
```

Expected: old `serde_json::Value` matches/adapters fail.

- [x] **Step 3: Normalize every application result**

First route terminal classification through the parser and change `WorkerRunOutcome::Structured` to
carry `ValidatedWorkerResult`:

```rust
match parse_terminal_result(operation, &output.stdout) {
    Ok(result) => return Ok(WorkerRunOutcome::Structured(result)),
    Err(_) if terminal_phase == Some(ProcessPhase::Cancelling) => {
        return Ok(WorkerRunOutcome::Cancelled)
    }
    Err(TerminalResultError::Invalid) => return Err(WorkerRunError::protocol_violation()),
    Err(TerminalResultError::Missing) if output.status.success() => {
        return Err(WorkerRunError::protocol_violation())
    }
    Err(TerminalResultError::Missing) => {}
}
```

Use the fixed detail `Worker result violated the terminal protocol.`. Then migrate runner fixtures
and every application consumer in the same working change so the crate never commits a mismatched
outcome type.

Process/retry Tauri commands return `TaskTerminalResult`. Worker task variants pass through directly;
cached and synthetic `ProcessVideoResult` values serialize and parse through the same strict DTO.
Protocol violations become typed task failures with the fixed code, empty safe message, and caller
stage/status. Source preflight exhaustively matches source completed/failed variants. Model download
exhaustively matches model completed/failed variants and exposes only the fixed message.

- [x] **Step 4: Run focused and full Rust tests**

Run Step 2 outside the restricted process sandbox, then:

```powershell
cargo test --manifest-path app\src-tauri\Cargo.toml
cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
```

Expected: zero failures and no format diff.

- [x] **Step 5: Commit**

```powershell
git add app\src-tauri\src\worker_runtime app\src-tauri\src\video_processing.rs app\src-tauri\src\asr_model.rs
git commit -m "refactor(worker): consume validated terminal results"
```

## Task 5: TypeScript task and worker-related result parsers

**Files:**
- Create: `app/src/workerResultProtocol.test.ts`
- Create: `app/src/workerResultProtocol.ts`
- Modify: `app/src/workerClient.test.ts`
- Modify: `app/src/workerClient.ts`
- Modify: `app/src/settingsClient.test.ts`
- Modify: `app/src/settingsClient.ts`
- Modify: `app/src/workerErrorCopy.test.ts`
- Modify: `app/src/workerErrorCopy.ts`

`workerResultProtocol.ts` owns and exports `AsrModelDownloadResult` and the shared
`CancelProcessResult`; `settingsClient.ts` and `workerClient.ts` re-export those types. This avoids a
runtime import cycle while keeping one parser/type definition for both cancel commands.

- [x] **Step 1: Write direct and gateway RED tests**

Direct parser tables accept completed/partial/failed and safe unknown codes. They reject class/Date
objects, every nested unknown field, unknown artifacts, wrong scalars, unsafe integers, bad
transcript/status/stage/code, and incoherent error presence. Gateway regression:

```typescript
const result = await processVideo(URL, async () => ({
  status: "completed", secret: "review-secret",
}));
expect(result.error).toEqual({
  code: "WORKER_PROTOCOL_VIOLATION",
  message: "",
  stage: "video_extracting",
});
expect(JSON.stringify(result)).not.toContain("review-secret");
```

Retry expects `partial_completed`, its submitted task ID, and `insights_generating`. Settings tests
reject malformed/additional/incoherent model and cancel results with fixed non-echoing exceptions.
Error-copy test maps `WORKER_PROTOCOL_VIOLATION` to `errors.worker.processFailed`.
The direct suite also compares exported task/artifact/insight/status constants with
`terminalResults.schemas.task` so parser and contract drift fails in the same app test.

- [x] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- --run src\workerResultProtocol.test.ts src\workerClient.test.ts src\settingsClient.test.ts src\workerErrorCopy.test.ts
```

Expected: parser is absent, invalid task values pass through, settings casts accept malformed values,
and the protocol code uses generic copy.

- [x] **Step 3: Implement exact plain-object parsers**

```typescript
export function parseWorkerResult(value: unknown): WorkerResult | null;
export function parseAsrModelDownloadResult(value: unknown): AsrModelDownloadResult | null;
export function parseCancelProcessResult(value: unknown): CancelProcessResult | null;
```

Use own-property exact-key checks, plain prototypes, allowlists, `Number.isSafeInteger`, contract
enums/nullability, safe-code regex, semantic pairs, and clean copies. Never stringify/log rejected
values. Model pairs are completed/true, cancelled/false, already_available/false. Cancel requires
exact status/error, null error for non-failed and string error for failed.

- [x] **Step 4: Enforce parsers at gateways**

Change low-level task/cancel runners to `Promise<unknown>`. Parse process/retry results and map null
to the fixed task failure. Preserve thrown-Tauri mapping and progress cleanup. Parse settings
download/cancel values and throw only `INVALID_ASR_MODEL_DOWNLOAD_RESPONSE` or
`INVALID_CANCEL_PROCESS_RESPONSE`. Register the protocol error code to existing worker-process copy.

- [x] **Step 5: Run focused and full app gates**

```powershell
npm.cmd test -- --run src\workerResultProtocol.test.ts src\workerClient.test.ts src\settingsClient.test.ts src\workerErrorCopy.test.ts
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: zero failures; record any pre-existing Vite bundle warning.

- [x] **Step 6: Commit**

```powershell
git add app\src\workerResultProtocol.ts app\src\workerResultProtocol.test.ts app\src\workerClient.ts app\src\workerClient.test.ts app\src\settingsClient.ts app\src\settingsClient.test.ts app\src\workerErrorCopy.ts app\src\workerErrorCopy.test.ts
git commit -m "feat(app): validate worker IPC results"
```

## Task 6: Full validation and closeout

**Files:**
- Modify: `docs/design-docs/2026-07-19-closed-worker-terminal-results.md`
- Modify: `docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md` only if its tracked finding is present
- Modify: `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `TASKS.md`, `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`, `docs/exec-plans/completed/index.md`
- Move: this plan from `active/` to `completed/`

- [x] **Step 1: Run complete worker/script gates**

```powershell
D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker\tests
D:\Github\FrameQ\.venv\Scripts\python.exe -m ruff check worker
node --test scripts\tests\*.test.mjs
```

- [x] **Step 2: Run complete app/Rust gates fresh**

```powershell
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
$env:CARGO_TARGET_DIR='D:\Github\FrameQ\app\src-tauri\target'
cargo test --manifest-path app\src-tauri\Cargo.toml
cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
```

Run child-process Rust fixtures outside the restricted sandbox.

- [x] **Step 3: Verify canonical/resource worker equality**

Invoke `prepareFreshWorkerResource` without starting Tauri, then compare canonical and generated
worker relative file sets plus SHA-256 hashes. Require no `.pyc`, `.pyo`, or `__pycache__` entry.

- [x] **Step 4: Update living evidence and archive**

Re-read every approved design goal/non-goal, record exact counts/warnings/risks here, mark the TASKS
item complete, update lifecycle ownership language and the audit finding if present, mark the design
Implemented, move this plan to completed, and update both indexes plus AGENTS.

- [x] **Step 5: Run governance/diff gates**

```powershell
python scripts\validate_agents_docs.py --level WARN
git diff --check
git status --short
git diff --stat
git diff
```

Expected: 0 docs errors/warnings, a scoped diff, and no live credentials/user content in fixtures.

- [x] **Step 6: Commit closeout**

```powershell
git add AGENTS.md TASKS.md docs contracts worker app scripts
git commit -m "docs(worker): close terminal result hardening"
```

## Validation and Acceptance

- `npm --prefix app test`
- `npm --prefix app run lint`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check`
- `D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests`
- `D:\Github\FrameQ\.venv\Scripts\python.exe -m ruff check worker`
- `node --test scripts/tests/*.test.mjs`
- `python scripts/validate_agents_docs.py --level WARN`
- canonical/resource worker relative-file and SHA-256 equality
- `git diff --check`

Behavioral acceptance:

- Valid task/source/model results and cancellation/cache behavior remain unchanged.
- Unknown or missing fields, wrong types/enums, invalid semantics, multiple stdout lines, and
  operation mismatches are rejected by Rust.
- Invalid process/retry IPC values are rejected again by TypeScript and become only
  `WORKER_PROTOCOL_VIOLATION`, never rejected content.
- Valid structured output wins a cancellation race; cancellation wins when no valid result exists;
  missing nonzero output remains an unstructured process failure.
- Cached and synthetic task results pass through the same strict task DTO.
- Model results contain no `model_dir`, raw URL/path/hash/member, or exception text.
- Safe unknown task codes reach generic localized handling; unsafe codes are rejected.
- Contract remains v3 and local-media v4 behavior/files remain untouched.

No separate manual UI regression is required because no UI interaction changes. Windows
process-tree behavior is exercised by the real child-process suite outside the restricted sandbox;
macOS process-group behavior remains an existing hosted release gate and is not claimed as freshly
run locally.
