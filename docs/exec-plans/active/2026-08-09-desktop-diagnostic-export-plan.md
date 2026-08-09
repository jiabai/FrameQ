# Desktop Diagnostic Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision
> Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Add a user-initiated, local-only ZIP export of the most recent seven days of safe desktop
and ASR model-download diagnostics, backed by desktop-worker contract v8 structured diagnostic
events and an ASR-download-only sanitized stderr fallback.

**Architecture:** Python classifies model-download exception chains into a closed, message-free
diagnostic event emitted on stderr. The existing Rust stderr reader remains the only consumer and
persists validated events plus bounded sanitized fallback lines only for `DownloadAsrModel`.
Rust/Tauri owns retention, export-time re-sanitization, fixed ZIP assembly, the native Save As
dialog, and a closed path-free IPC result; React owns only the two entry points and localized state.

**Tech Stack:** Python 3/pytest/Ruff, Rust/Tauri 2/serde/zip, TypeScript/React/Vitest/i18next,
shared JSON desktop-worker contract, app-local filesystem storage.

---

## Purpose / Big Picture

When ASR model preparation fails only on a user's PC, FrameQ currently provides a safe generic
error but preserves too little evidence to diagnose DNS, TLS, proxy, HTTP, permission, disk,
integrity, dependency, or startup failures remotely. After this work, the user can choose **Export
diagnostics** from the failed model-preparation sheet or Settings > Advanced and save a small ZIP.
The package contains only a closed manifest and re-sanitized recent logs. It never contains media,
transcripts, prompts, generated content, model files, machine identity, paths, URLs, credentials,
or raw exception text, and FrameQ never uploads it or starts a network probe.

## Progress

- [x] 2026-08-09: Product behavior, privacy scope, ownership, contract v8 direction, package
  contents, retention, UI, and verification strategy approved and written to the product spec and
  design document. Validation: `python scripts/validate_agents_docs.py --level ERROR` (0 errors,
  0 warnings) and `git diff --check`.
- [x] 2026-08-09: Implementation code paths inspected and this active ExecPlan created; no product
  code changed. Validation: source inspection of Rust stderr runner/diagnostics/atomic writer,
  Python model-download application/CLI/contract, frontend settings/model-guide controllers, and
  current packaging gates.
- [x] 2026-08-09: Task 1 completed and passed both independent reviews. Global desktop-worker
  contract advanced to v8; Python gained immutable, strict diagnostic event validation/rendering;
  Python-to-canonical conformance tests close drift across fields, enums, regex, bounds, and
  optional combinations. Validation: focused Python 65 passed; TypeScript contract 14 passed;
  Rust contract 1 passed; installer 7 passed; Ruff and `git diff --check` passed; spec review and
  code-quality review approved with no remaining issues.
- [x] 2026-08-10: Task 2 completed and passed both independent reviews. The worker now classifies
  model-download failures from safe type/numeric metadata, tracks only validated progress phases,
  emits exactly one closed diagnostic event on stderr, and keeps all diagnostic failures
  supplemental to the existing terminal result. Validation: focused worker tests 158 passed;
  Ruff and `git diff --check` passed; spec and code-quality reviews approved with no remaining
  issues.
- [x] 2026-08-10: Task 3 completed and passed both independent reviews. Rust now owns a fixed-path,
  atomically persisted ASR diagnostic store with strict fail-closed sanitization, bounded
  per-invocation state, seven-day retention, a 4 MiB file ceiling, and safe handling of malformed,
  oversized, linked, unreadable, or unwritable prior state. Validation: focused Rust tests 26
  passed (including atomic replacement failure preservation); `cargo fmt --check` and
  `git diff --check` passed; spec and code-quality/security reviews approved with no remaining
  issues.

## Surprises & Discoveries

- Evidence: `worker/frameq_worker/worker_application/model_download.py` catches both
  `ModelDownloadError` and broad `Exception` and returns fixed terminal failures without logging
  the causal exception. Persisting the currently observable stderr alone would therefore not solve
  most download-library failures.
- Evidence: `app/src-tauri/src/worker_runtime/runner/progress.rs` is already the sole line-by-line
  stderr consumer; valid progress refreshes the watchdog, ordinary stderr only sets a presence
  marker, and invalid progress is logged without echoing raw input. The diagnostic protocol must
  be added here, not through a second pipe reader.
- Evidence: `app/src-tauri/src/diagnostics.rs::sanitize_diagnostic_text` removes common URL and
  credential material but does not remove every local path, machine identity, task ID, or opaque
  identifier required by the new export boundary. Export needs a stricter ASR/export sanitizer and
  must treat the existing desktop log as untrusted input.
- Evidence: `app/src-tauri/src/atomic_files.rs::atomic_write` already provides same-directory
  staging, regular-file/reparse-point checks, synchronized writes, exact staging cleanup, Unix
  rename, and Windows `ReplaceFileW`. ZIP export should assemble bounded bytes and reuse this owner.
- Evidence: `app/src-tauri/Cargo.lock` already resolves `zip` 4.6.1 transitively, but it is not a
  direct dependency in `app/src-tauri/Cargo.toml`; implementation must add an explicit direct
  dependency before importing its API.
- Evidence: Settings already has an Advanced category and controller-owned async notices, while
  `ModelGuideSheet` derives model-download terminal state from `useAsrModelDownload`. The export
  client/controller can be shared without adding a new global workflow state.

## Decision Log

- Decision: Persist diagnostic stderr only for semantic operation `DownloadAsrModel`; all other
  operations keep discard-and-marker behavior. Rationale: other operations may emit URLs, local
  media paths, transcripts, prompts, preferences, or generated text, while the reported support
  gap is specifically ASR model acquisition. Date/Author: 2026-08-09, User + Codex.
- Decision: Rust/Tauri owns persistence, retention, packaging, and Save As; Python emits only a
  closed structured event and receives no log path. Rationale: this covers interpreter/startup
  fallback output while retaining one filesystem and export policy owner. Date/Author: 2026-08-09,
  User + Codex.
- Decision: Export is passive, local-only, user-initiated, and covers at most seven days; there is
  no upload, connectivity test, model retry, server request, LLM call, or Credits use. Rationale:
  supportability must not silently broaden FrameQ's local-first privacy boundary. Date/Author:
  2026-08-09, User + Codex.
- Decision: Use a native Save As dialog and retain no app-local ZIP. Rationale: the user explicitly
  owns the destination and sharing decision, while source logs stay app-local under bounded
  retention. Date/Author: 2026-08-09, User + Codex.
- Decision: Advance only the global desktop-worker contract from v7 to v8; keep process-video and
  local-media request envelope versions unchanged. Rationale: the new stderr event is a shared
  desktop-worker capability but does not alter request or terminal-result shapes. Date/Author:
  2026-08-09, User + Codex.
- Decision: Reuse `atomic_files::atomic_write` for the final ZIP and use in-memory ZIP assembly
  under the 5 MiB cap. Rationale: the existing helper already owns cross-platform replacement and
  reparse-point safety, and the bounded package does not justify a second streaming transaction
  implementation. Date/Author: 2026-08-09, Codex.

## Outcomes & Retrospective

Implementation has not started. The accepted outcome is the complete behavior in
`docs/product-specs/2026-08-09-desktop-diagnostic-export.md` and the architecture in
`docs/design-docs/2026-08-09-desktop-diagnostic-export.md`. During execution, this section must
record exact worker/Rust/app/script test totals, package inspection evidence, Windows native Save
As evidence, documentation validation, packaged-worker equality, and every unavailable platform
check. Residual risk at plan creation: macOS native Save As behavior cannot be claimed from a
Windows-only implementation host and requires release-host smoke evidence.

## Context and Orientation

### Approved intent

- Product spec: `docs/product-specs/2026-08-09-desktop-diagnostic-export.md`
- Design: `docs/design-docs/2026-08-09-desktop-diagnostic-export.md`
- Existing diagnostics product baseline: `docs/product-specs/2026-07-05-desktop-diagnostics-logs.md`
- Security policy: `docs/SECURITY.md`
- Architecture map: `docs/ARCHITECTURE.md`

### Shared contract and worker

- `contracts/desktop-worker-contract.json` is the canonical v7 artifact to advance to v8.
- `worker/frameq_worker/desktop_contract.py` owns Python constants and callback types.
- `worker/frameq_worker/diagnostic_events.py` will own safe diagnostic DTO validation, rendering,
  progress-to-phase mapping, and exception classification.
- `worker/frameq_worker/worker_application/model_download.py` owns one model-download invocation
  and the broad exception boundary where the terminal diagnostic event must be emitted once.
- `worker/frameq_worker/cli.py` owns stderr rendering callbacks and stdout terminal framing.
- `worker/tests/test_contract.py`, `worker/tests/test_model_download.py`, and
  `worker/tests/test_cli.py` are the focused worker regression suites.

### Rust/Tauri

- `app/src-tauri/src/worker_runtime/runner/progress.rs` is the only stderr line parser.
- `app/src-tauri/src/worker_runtime/runner.rs` owns semantic `WorkerOperation`, reader setup, and
  terminal lifecycle.
- `app/src-tauri/src/diagnostics.rs` remains the stable crate facade.
- `app/src-tauri/src/diagnostics/worker_stderr.rs` will own ASR diagnostic persistence.
- `app/src-tauri/src/diagnostics/export.rs` will own snapshot/filter/manifest/ZIP construction.
- `app/src-tauri/src/diagnostic_export.rs` will own the native Save As Tauri command and busy state.
- `app/src-tauri/src/atomic_files.rs` owns safe same-directory atomic replacement.
- `app/src-tauri/src/asr_model.rs` can expose a narrow path-free model/cache snapshot for the
  manifest; it must not expose model bytes or filesystem paths.
- `app/src-tauri/src/lib.rs` registers modules, managed state, command, and contract constants.

### Frontend

- `app/src/diagnosticExportClient.ts` will runtime-decode the closed path-free command result.
- `app/src/features/diagnostics/useDiagnosticExport.ts` will own shared busy/notice behavior.
- `app/src/features/asrModel/ModelGuideSheet.tsx` will show the failure-only entry.
- `app/src/features/asrModel/useAsrModelDownload.ts` already owns terminal model-download state.
- `app/src/features/settings/SettingsSheet.tsx` and `useSettingsController.ts` own the permanent
  Settings > Advanced entry and its notice lifecycle.
- `app/src/i18n/asrModelResources.ts` and `settingsResources.ts` own all three locale variants.

### Packaging and governance

- `scripts/tauri-dev-fresh-worker.mjs` refreshes the packaged worker mirror.
- `scripts/tests/build-installer.test.mjs` asserts the desktop-worker contract version.
- `app/src/desktopWorkerContract.test.ts`, `app/src-tauri/src/lib.rs` tests, and
  `worker/tests/test_contract.py` enforce cross-language contract closure.
- `docs/exec-plans/active/index.md`, `TASKS.md`, and `AGENTS.md` track this active work.

## File and Interface Map

| File | Responsibility after implementation |
|---|---|
| `contracts/desktop-worker-contract.json` | Canonical v8 diagnostic prefix, fields, enums, combinations, forbidden content |
| `worker/frameq_worker/diagnostic_events.py` | Safe Python event creation/classification/rendering; no persistence |
| `worker/frameq_worker/worker_application/model_download.py` | Track current safe phase and emit one diagnostic on terminal failure |
| `worker/frameq_worker/cli.py` | Print validated diagnostic event to stderr |
| `app/src-tauri/src/diagnostics/worker_stderr.rs` | Strict Rust event parsing; fallback sanitization; 7-day/4 MiB bounded log |
| `app/src-tauri/src/worker_runtime/runner/progress.rs` | Route progress vs diagnostic vs ordinary stderr without watchdog leakage |
| `app/src-tauri/src/diagnostics/export.rs` | Re-sanitize, filter, budget, manifest, and build fixed ZIP bytes |
| `app/src-tauri/src/diagnostic_export.rs` | Busy guard, native Save As, atomic destination write, closed Tauri result |
| `app/src/diagnosticExportClient.ts` | Invoke with `{}` and runtime-decode `exported|cancelled|failed` |
| `app/src/features/diagnostics/useDiagnosticExport.ts` | Shared UI busy state and localized safe notices |
| model guide/settings files | Failure-only and permanent entry points |

## Plan of Work

### Task 1: Establish desktop-worker contract v8 and safe Python event primitives

**Files:**

- Create: `worker/frameq_worker/diagnostic_events.py`
- Create: `worker/tests/test_diagnostic_events.py`
- Modify: `contracts/desktop-worker-contract.json`
- Modify: `worker/frameq_worker/desktop_contract.py`
- Modify: `worker/tests/test_contract.py`
- Modify: `app/src/desktopWorkerContract.test.ts`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `scripts/tests/build-installer.test.mjs`

- [x] **Step 1: Add RED contract tests for v8.** Assert the new prefix, schema version, exact
  required/optional fields, closed phase/category/code sets, conditional numeric fields, invalid
  policy, and forbidden-content list while asserting request envelope constants remain 3 and 4.

  The canonical closed values are:

  ```python
  DIAGNOSTIC_PHASES = (
      "preparing", "primary_model", "vad_model", "bpe_model",
      "archive_download", "archive_validate", "cache_validate", "cache_promote",
  )
  DIAGNOSTIC_CODES = {
      "network": ("dns_resolution_failed", "connection_timeout", "connection_failed"),
      "tls": ("tls_verification_failed", "tls_handshake_failed"),
      "proxy": ("proxy_configuration_failed", "proxy_connection_failed"),
      "http": ("http_status_failed",),
      "filesystem": ("permission_denied", "disk_full", "filesystem_io_failed"),
      "integrity": ("checksum_mismatch", "archive_invalid", "cache_invalid"),
      "dependency": ("dependency_unavailable",),
      "unexpected": ("unexpected_failure",),
  }
  ```

- [x] **Step 2: Run RED tests.** Run:

  ```powershell
  uv run pytest worker\tests\test_contract.py worker\tests\test_diagnostic_events.py -q
  npm --prefix app test -- desktopWorkerContract.test.ts
  cargo test --manifest-path app\src-tauri\Cargo.toml desktop_worker_contract_matches_tauri_constants
  node --test scripts\tests\build-installer.test.mjs
  ```

  Expected: failures report v7/missing `workerDiagnosticPrefix` or missing Python diagnostic module;
  there must be no unrelated test failure accepted as RED evidence.

- [x] **Step 3: Advance the canonical artifact and constants.** Set global contract version to 8,
  add `events.workerDiagnosticPrefix = "FRAMEQ_DIAGNOSTIC "`, and add one closed
  `diagnosticEvents` object. Keep `PROCESS_VIDEO_CONTRACT_VERSION = 3` and
  `LOCAL_MEDIA_CONTRACT_VERSION = 4` unchanged.

- [x] **Step 4: Implement Python event validation/rendering without exception text.** The public
  primitive must have a closed dataclass or typed mapping and render only validated values:

  ```python
  DIAGNOSTIC_EVENT_PREFIX = "FRAMEQ_DIAGNOSTIC "

  def render_diagnostic_event(event: DiagnosticEvent) -> str:
      validated = validate_diagnostic_event(event.to_dict())
      return f"{DIAGNOSTIC_EVENT_PREFIX}{json.dumps(validated, ensure_ascii=True)}"
  ```

  Validation rejects unknown fields, invalid category/code pairs, illegal optional-field
  combinations, and an `exception_type` outside `[A-Za-z][A-Za-z0-9_]{0,79}`. No `message` field
  or arbitrary metadata map exists.

- [x] **Step 5: Run focused GREEN tests.** Require all four commands from Step 2 to pass and record
  exact totals in Progress.

### Task 2: Classify and emit one terminal model-download diagnostic

**Files:**

- Modify: `worker/frameq_worker/diagnostic_events.py`
- Modify: `worker/frameq_worker/worker_application/model_download.py`
- Modify: `worker/frameq_worker/cli.py`
- Modify: `worker/tests/test_diagnostic_events.py`
- Modify: `worker/tests/test_model_download.py`
- Modify: `worker/tests/test_cli.py`
- Modify: `worker/tests/test_worker_service_facade.py`
- Modify: `worker/tests/test_worker_application_boundaries.py`

- [x] **Step 1: Add RED classification tests.** Build exception chains for `socket.gaierror`,
  `TimeoutError`, `ssl.SSLCertVerificationError`, `urllib.error.HTTPError`, `PermissionError`,
  `OSError(errno.ENOSPC)`, `ImportError`, archive/integrity `ModelDownloadError`, known proxy class
  names, and unknown exceptions. Assert category/code, bounded type name, legal optional fields,
  and absence of seeded URL/path/token/header/proxy/body strings.

- [x] **Step 2: Add RED application, facade, boundary, and CLI tests.** Assert a failed invocation emits exactly one
  event before the existing terminal JSON, a successful/cancelled path emits none, and stdout still
  has exactly one terminal result line. Update the exact worker-service signature assertion and
  retain the application facade/import ownership checks. The callback surface is explicit:

  ```python
  DiagnosticCallback = Callable[[DiagnosticEvent], None]

  def run_asr_model_download_once(
      ...,
      diagnostic_callback: DiagnosticCallback | None = None,
  ) -> dict[str, object]: ...
  ```

- [x] **Step 3: Run RED worker tests.** Run:

  ```powershell
  uv run pytest worker\tests\test_diagnostic_events.py worker\tests\test_model_download.py worker\tests\test_cli.py worker\tests\test_worker_service_facade.py worker\tests\test_worker_application_boundaries.py -q
  ```

  Expected: missing classifier/callback assertions fail while existing terminal framing remains
  green.

- [x] **Step 4: Implement safe classification.** Walk `__cause__`/`__context__` with a small depth
  and identity guard. Inspect only exception types, integer errno/status attributes, and existing
  safe `ModelDownloadError.code`; never inspect or serialize `str(exc)`, `repr(exc)`, `args`,
  request/response objects, headers, or bodies. Unknown input returns:

  ```python
  DiagnosticEvent(
      version=1,
      operation="download_asr_model",
      phase=current_phase,
      category="unexpected",
      code="unexpected_failure",
      exception_type=safe_exception_type(exc),
  )
  ```

- [x] **Step 5: Track phase through the existing progress callback.** Wrap the supplied progress
  callback so each validated model progress `message_code` updates a closed local phase before
  forwarding unchanged. Archive-invalid/cache-invalid known errors may refine the terminal phase
  without reading their messages. Emit once in each terminal exception branch, then return the
  exact existing public `ASR_MODEL_DOWNLOAD_FAILED` or archive-invalid result.

- [x] **Step 6: Wire CLI stderr rendering and run GREEN tests.** Add
  `print_diagnostic_event`, pass it only to `run_asr_model_download_once`, run the Step 3 suite, and
  run `uv run ruff check worker`.

### Task 3: Add Rust-owned ASR diagnostic storage and strict sanitization

**Files:**

- Create: `app/src-tauri/src/diagnostics/worker_stderr.rs`
- Modify: `app/src-tauri/src/diagnostics.rs`
- Modify: `app/src-tauri/src/runtime.rs`

- [x] **Step 1: Add RED storage tests.** Cover the fixed path
  `logs/asr-model-download.log`, structured append/read, UTC filtering, 1,000-character cap,
  adjacent duplicate collapse, 200 fallback-line cap per invocation, 4 MiB rotation, seven-day
  pruning, locked/unreadable prior log neutrality, and no recursive or arbitrary path access.

- [x] **Step 2: Add RED sanitizer tests with hostile seeds.** Include Windows/UNC/POSIX/home paths,
  app-local paths, usernames, hostnames, IPv4/IPv6, email, HTTP URLs/query strings, proxy URLs,
  environment assignments, Cookie/Authorization, token/key names, task-like IDs, long opaque
  values, controls, and multiline tracebacks. Require fixed replacement tokens and prove every
  seeded secret is absent.

- [x] **Step 3: Run RED Rust tests.** Run:

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml diagnostics::worker_stderr
  ```

  Expected: module/functions are absent.

- [x] **Step 4: Implement a narrow facade and invocation sink.** The runner-facing capability must
  expose methods, not a path or file handle:

  ```rust
  pub(crate) struct AsrDiagnosticSink { /* private bounded state */ }

  impl AsrDiagnosticSink {
      pub(crate) fn structured(&mut self, event: &ValidatedDiagnosticEvent);
      pub(crate) fn fallback_line(&mut self, line: &str);
      pub(crate) fn finish(self);
  }
  ```

  `diagnostics.rs` may construct this sink only for `DownloadAsrModel`. Disk-write failures are
  swallowed after a fixed safe marker and never affect the worker outcome.

- [x] **Step 5: Implement bounded record storage.** Use a versioned line-oriented internal format
  with UTC milliseconds, a Rust-generated invocation correlation token unrelated to task/account/
  PID/machine identity, record kind, safe payload, and count/truncation metadata. Prune by parsed
  record timestamp and size; malformed prior lines are omitted, never copied through.

- [x] **Step 6: Run GREEN storage tests and formatting.** Require focused tests green, then run
  `cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check`.

### Task 4: Parse diagnostic stderr in the existing runner without watchdog or UI leakage

**Files:**

- Modify: `app/src-tauri/src/worker_runtime/runner/progress.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner/tests/progress.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner/tests/watchdog.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner/tests/terminal.rs`
- Modify: `app/src-tauri/src/worker_runtime/runner/tests.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add RED parser tests.** Add a distinct diagnostic record variant and test a valid
  event, malformed JSON, duplicate keys, unknown fields, invalid category/code combinations,
  illegal numeric fields, overlong type/line input, and a free-form `message`. Invalid input must
  yield only `diagnostic_event_rejected`, never the raw line.

- [ ] **Step 2: Add RED lifecycle boundary tests.** Prove valid diagnostics are not emitted through
  `ProgressRoute`, do not call `record_validated_progress`, do not prevent idle timeout, and do not
  change stdout terminal classification. Prove ordinary stderr is persisted for
  `DownloadAsrModel` but not ProcessVideo, ProcessLocalMedia, RetryInsights, or ResolveSourceIdentity.

- [ ] **Step 3: Run RED runner tests.** Run:

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime::runner::tests
  ```

- [ ] **Step 4: Implement strict Rust event decoding.** Use a custom serde map visitor or
  equivalent duplicate-aware decoder with `deny_unknown_fields` semantics. Do not parse into a
  generic map that silently accepts duplicate keys. Validate against the same v8 enums and field
  combinations as Python.

- [ ] **Step 5: Pass semantic operation and optional sink to `read_stderr`.** The routing shape is:

  ```rust
  match inspect_stderr_line(protocol, &line) {
      StderrRecord::ValidatedProgress(payload) => {
          watchdog.record_validated_progress();
          progress.emit(payload);
      }
      StderrRecord::ValidatedDiagnostic(event) => sink.structured(&event),
      StderrRecord::Diagnostic => sink.fallback_line(&line),
      StderrRecord::InvalidDiagnostic => sink.rejected(),
      StderrRecord::InvalidProgress(detail) => record_fixed_progress_rejection(detail),
      StderrRecord::Empty => {}
  }
  ```

  For non-model operations the sink is a no-op/absent capability; do not condition on frontend
  route names alone.

- [ ] **Step 6: Run focused GREEN tests.** Run the Step 3 command and the existing lifecycle,
  watchdog, progress, and terminal focused suites. Record exact totals and any environment-only
  failure without weakening assertions.

### Task 5: Build the fixed, bounded ZIP and native Tauri export command

**Files:**

- Create: `app/src-tauri/src/diagnostics/export.rs`
- Create: `app/src-tauri/src/diagnostic_export.rs`
- Modify: `app/src-tauri/src/diagnostics.rs`
- Modify: `app/src-tauri/src/asr_model.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/Cargo.lock`

- [ ] **Step 1: Add a direct bounded ZIP dependency.** Add `zip = { version = "4.6.1",
  default-features = false, features = ["deflate"] }` and let Cargo update only the direct package
  dependency edge; do not accept unrelated dependency upgrades.

- [ ] **Step 2: Add RED manifest/export tests.** Assert exact root entries, mandatory
  `diagnostics.json`, closed schema, supported model/cache enums, fixed omission reasons,
  seven-day filtering, export-time desktop-log re-sanitization, malformed source omission,
  newest-first truncation, truthful `truncated`, completed ZIP <= 5 MiB, and no source directory
  traversal or link/reparse following.

- [ ] **Step 3: Add RED destination tests.** Cover cancellation, process-local busy rejection,
  same-directory staging via `atomic_write`, pre-existing destination replacement/preservation on
  injected failure, exact staging cleanup, no app-local ZIP, and path-free results.

- [ ] **Step 4: Run RED tests.** Run:

  ```powershell
  cargo test --manifest-path app\src-tauri\Cargo.toml diagnostics::export
  cargo test --manifest-path app\src-tauri\Cargo.toml diagnostic_export
  ```

- [ ] **Step 5: Implement the manifest and ZIP assembler.** The output DTO is closed and contains
  no arbitrary strings beyond app version and supported public model IDs:

  ```rust
  #[derive(Serialize)]
  struct DiagnosticManifest {
      schema_version: u8,
      app_version: String,
      os: DiagnosticOs,
      arch: DiagnosticArch,
      exported_at_unix_ms: u64,
      window_start_unix_ms: u64,
      selected_model: SupportedDiagnosticModel,
      cache_status: CacheStatus,
      files: Vec<ManifestFileStatus>,
      truncated: bool,
  }
  ```

  Read only Rust-constructed source paths, reject links/reparse points, parse and re-sanitize every
  source record, and iteratively remove oldest eligible records if final compressed bytes exceed
  5 MiB.

- [ ] **Step 6: Expose a path-free model snapshot.** Add a narrow helper in `asr_model.rs` that
  returns only supported model enum/ID and `ready|missing|invalid|unknown`; reuse existing cache
  checks without returning display/cache paths or reading model bytes into memory.

- [ ] **Step 7: Implement the Tauri command and state.** Register an
  `Arc<DiagnosticExportState>`, open `app.dialog().file().set_file_name(...).add_filter(...)`
  through the blocking Save As API, convert the selected `FilePath` internally, assemble bounded
  bytes, and call `atomic_files::atomic_write`. Return a value, not raw rejected-Promise details:

  ```rust
  #[derive(Serialize)]
  #[serde(tag = "status", rename_all = "snake_case")]
  pub(crate) enum DiagnosticExportResult {
      Exported,
      Cancelled,
      Failed { code: &'static str },
  }
  ```

- [ ] **Step 8: Run GREEN tests and dependency review.** Require both focused suites green, run
  full `cargo test`, `cargo fmt --check`, and inspect `Cargo.lock` to confirm no unrelated upgrade.

### Task 6: Add closed frontend IPC decoding and shared export state

**Files:**

- Create: `app/src/diagnosticExportClient.ts`
- Create: `app/src/diagnosticExportClient.test.ts`
- Create: `app/src/features/diagnostics/useDiagnosticExport.ts`
- Create: `app/src/features/diagnostics/useDiagnosticExport.test.ts`
- Modify: `app/src/features/settings/useSettingsController.ts`
- Modify: `app/src/features/settings/useSettingsController.test.ts`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Add RED IPC decoder tests.** Accept only exact closed objects:

  ```ts
  type DiagnosticExportResult =
    | { status: "exported" }
    | { status: "cancelled" }
    | { status: "failed"; code: "DIAGNOSTIC_EXPORT_FAILED" };
  ```

  Reject unknown/missing fields, unknown statuses/codes, arrays, primitives, getters throwing,
  symbols, and path/content fields. Assert runner invocation is exactly
  `runner("export_diagnostics", {})`.

- [ ] **Step 2: Add RED hook/controller tests.** Assert one in-flight call, cancellation no notice,
  success/failure safe `UiMessage`, duplicate click suppression, and no interaction with model
  download cancellation/progress state. Settings uses the same shared action and busy state.

- [ ] **Step 3: Run RED frontend tests.** Run:

  ```powershell
  npm --prefix app test -- diagnosticExportClient.test.ts useDiagnosticExport.test.ts useSettingsController.test.ts
  ```

- [ ] **Step 4: Implement client and hook.** Runtime-decode with the existing
  `tauriIpcProtocol` helpers; map command rejection or malformed response to the same fixed failed
  state without echoing error text. Expose `{ exportDiagnostics, diagnosticExportBusy,
  diagnosticExportNotice }` to both surfaces.

- [ ] **Step 5: Integrate the settings controller and App composition.** Do not add the destination
  path, logs, or ZIP bytes to React state. Keep the export busy flag separate from settings save/
  load so an export does not submit the settings form.

- [ ] **Step 6: Run focused GREEN tests.** Require Step 3 green and run `npm --prefix app run lint`.

### Task 7: Add both localized user entry points

**Files:**

- Modify: `app/src/features/asrModel/ModelGuideSheet.tsx`
- Modify: `app/src/features/asrModel/ModelGuideSheet.test.tsx`
- Modify: `app/src/features/asrModel/useAsrModelDownload.ts` only for a narrow terminal-failure
  predicate if the current phase is insufficient
- Modify: `app/src/features/asrModel/useAsrModelDownload.test.ts`
- Modify: `app/src/features/settings/SettingsSheet.tsx`
- Modify: `app/src/features/settings/SettingsSheet.i18n.test.tsx`
- Modify: `app/src/i18n/asrModelResources.ts`
- Modify: `app/src/i18n/settingsResources.ts`
- Modify: `app/src/App.css`

- [ ] **Step 1: Add RED model-guide tests.** In each locale, a terminal `failed`/timeout state shows
  **Export diagnostics**, retry remains primary, and privacy copy says no media/transcripts/keys/
  model files and no retry/network test. Running, cancelling, completed, and ordinary missing
  states do not show the failure export action.

- [ ] **Step 2: Add RED Settings > Advanced tests.** In each locale, permanently render a
  Diagnostics card with seven-day and privacy copy plus the export action. Do not add **Open logs
  directory**. Assert the button is `type="button"`, disables while exporting, and does not submit
  `settings-form`.

- [ ] **Step 3: Run RED UI tests.** Run:

  ```powershell
  npm --prefix app test -- ModelGuideSheet.test.tsx SettingsSheet.i18n.test.tsx useAsrModelDownload.test.ts
  ```

- [ ] **Step 4: Implement reviewed `zh-CN`, `zh-TW`, and `en-US` copy and controls.** Use existing
  button/card classes where possible; add only narrowly named diagnostic styles. Success copy tells
  the user to send the ZIP manually; failure asks for another destination; cancellation is silent.

- [ ] **Step 5: Run GREEN UI and accessibility regressions.** Require Step 3 green, then run all
  app tests, lint, and production build. Inspect focus order, `aria-live` notice behavior, disabled
  state, and small-window layout.

### Task 8: Synchronize packaging/docs and execute complete acceptance gates

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/product-specs/2026-08-09-desktop-diagnostic-export.md` status only after acceptance
- Modify: `docs/design-docs/2026-08-09-desktop-diagnostic-export.md` status only after acceptance
- Modify: `AGENTS.md`
- Modify: `TASKS.md`
- Modify: `docs/exec-plans/active/index.md`
- Move after complete acceptance:
  `docs/exec-plans/active/2026-08-09-desktop-diagnostic-export-plan.md` to
  `docs/exec-plans/completed/2026-08-09-desktop-diagnostic-export-plan.md`
- Modify after move: `docs/exec-plans/completed/index.md`

- [ ] **Step 1: Refresh and compare the packaged worker.** Run the established mirror command and
  compare canonical and resource package recursively by file set and bytes:

  ```powershell
  node --input-type=module -e "import { prepareFreshWorkerResource } from './scripts/tauri-dev-fresh-worker.mjs'; await prepareFreshWorkerResource();"
  git diff --no-index -- worker\frameq_worker app\src-tauri\resources\worker\frameq_worker
  ```

  Expected: the comparison emits no diff after refresh. Do not hand-edit the resource mirror.

- [ ] **Step 2: Update architecture and security truth.** Record contract v8, the diagnostic
  prefix/non-watchdog channel, Rust ownership, ASR-only fallback persistence, retention/size caps,
  fixed export allowlist, forbidden data, export-time re-sanitization, and no-upload/no-probe
  boundary. Do not describe unimplemented behavior as released before gates pass.

- [ ] **Step 3: Run complete automated gates.** Execute every command in Validation and Acceptance,
  record exact totals/warnings/environment failures in Progress, and fix in-scope regressions before
  claiming acceptance.

- [ ] **Step 4: Perform Windows real-host smoke.** Verify Save As success, cancellation, replacing
  an existing ordinary ZIP, failure at an unusable destination, no source-log deletion, no
  app-local ZIP, package contents/size/manifest, absence of seeded forbidden data, and one
  representative model-download failure. Inspect network activity to confirm export itself starts
  no DNS/HTTP request.

- [ ] **Step 5: Close documentation and plan lifecycle.** Run governance WARN validation and diff
  checks, update spec/design status only when implementation is accepted, fill Outcomes with exact
  evidence and residual risks, move this plan to completed, and synchronize active/completed
  indexes, TASKS, and AGENTS. macOS native dialog evidence remains explicit until run on macOS.

## Validation and Acceptance

### Focused RED/GREEN commands

```powershell
uv run pytest worker\tests\test_contract.py worker\tests\test_diagnostic_events.py worker\tests\test_model_download.py worker\tests\test_cli.py -q
uv run ruff check worker
cargo test --manifest-path app\src-tauri\Cargo.toml diagnostics
cargo test --manifest-path app\src-tauri\Cargo.toml worker_runtime::runner::tests
cargo test --manifest-path app\src-tauri\Cargo.toml diagnostic_export
npm --prefix app test -- desktopWorkerContract.test.ts diagnosticExportClient.test.ts useDiagnosticExport.test.ts ModelGuideSheet.test.tsx SettingsSheet.i18n.test.tsx useSettingsController.test.ts
node --test scripts\tests\build-installer.test.mjs scripts\tests\tauri-dev-fresh-worker.test.mjs
```

### Full repository gates

```powershell
node --test scripts\tests\*.test.mjs
uv run pytest worker\tests
uv run ruff check worker
cargo test --manifest-path app\src-tauri\Cargo.toml
cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
python scripts\validate_agents_docs.py --level WARN
node --input-type=module -e "import { prepareFreshWorkerResource } from './scripts/tauri-dev-fresh-worker.mjs'; await prepareFreshWorkerResource();"
git diff --no-index -- worker\frameq_worker app\src-tauri\resources\worker\frameq_worker
git diff --check
```

The recursive worker comparison uses exit code 0 as equality. If `git diff --no-index` returns 1,
inspect and correct the mirror before continuing; do not treat it as a harmless diff.

### Automated acceptance assertions

- Global desktop-worker contract is exactly v8 in canonical JSON, Python, Rust, TypeScript tests,
  installer scripts, and packaged worker; process-video remains v3 and local-media remains v4.
- Python emits at most one valid, message-free diagnostic event on terminal ASR model-download
  failure and preserves existing progress/stdout terminal results.
- Rust persists validated events and bounded sanitized ordinary stderr only for
  `DownloadAsrModel`; diagnostics never emit UI progress or refresh the watchdog.
- Source logs obey seven-day, 4 MiB, 1,000-character, 200-line, and duplicate-collapse limits.
- ZIP contains only the fixed root entries, is <= 5 MiB, always has a truthful closed manifest,
  re-sanitizes source records, and contains none of the forbidden seeded strings.
- Tauri command accepts no frontend payload and returns no path/content; frontend rejects malformed
  or expanded responses.
- Export does not invoke worker/model/server/LLM/network code and retains no app-local ZIP.
- Both UI entry points, busy/cancel/success/failure states, and all three locales pass.

### Manual/native acceptance

On a Windows packaged or native Tauri build:

1. Trigger a controlled ASR model-download failure containing seeded path/URL/token material in a
   test-only exception fixture or isolated test build.
2. Confirm the failure sheet shows retry plus **Export diagnostics**, while active download does
   not show that failure action.
3. Cancel Save As and confirm no notice/error/file.
4. Export to a normal directory and inspect all ZIP entries and `diagnostics.json`.
5. Confirm no media, transcript, model, `.env`, account, path, host, IP, URL, proxy, token, task ID,
   raw exception, or traceback content is present.
6. Repeat from Settings > Advanced without a fresh failure; confirm export still succeeds.
7. Inject destination failure and concurrent-click behavior; confirm stable UI failure, no stale
   `.part`, and preservation of any prior destination file.
8. Observe that export itself performs no DNS, HTTP, server, LLM, Credits, or model activity.

macOS native Save As and replacement behavior must be smoke-tested on a real macOS host before a
release claims three-platform native acceptance. If that host is unavailable during implementation,
record the gap verbatim in Outcomes and the release plan/notes.
