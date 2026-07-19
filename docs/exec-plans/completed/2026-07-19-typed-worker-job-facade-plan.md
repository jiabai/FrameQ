# Typed Worker Job Facade Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ keeps exactly the same desktop behavior, worker wire formats, progress events, cancellation,
artifacts, and AI Credits behavior. Internally, every video-lane worker job is submitted through one
typed facade so an invocation cannot silently drift from its lifecycle log operation, progress
protocol, LLM credential policy, or lane when local-media processing is added.

## Progress

- [x] 2026-07-19: Inspected the current Rust runtime and confirmed that `video_processing.rs` still
  composes invocation, operation, progress route, credentials, and lane at three call sites.
  Validation: repository-wide `rg` evidence and direct review of `command.rs`, `runner.rs`,
  `video_processing.rs`, and `asr_model.rs`.
- [x] 2026-07-19: Selected the typed `WorkerJob + VideoWorkerFacade` boundary and recorded why
  factory-only and premature local-media variants are rejected. Validation: architecture review and
  `docs/design-docs/2026-07-19-typed-worker-job-facade.md`.
- [x] 2026-07-19: Created isolated worktree `codex/typed-worker-job-facade` and established the Rust
  baseline. Validation: `cargo test --manifest-path app/src-tauri/Cargo.toml` passed 146 tests.
- [x] 2026-07-19: Added and ran RED policy tests. Validation: the focused Cargo command failed only
  because `WorkerJob` and `ProcessSupervisors::video_worker` did not yet exist; the compiler reported
  one unresolved import and three missing-method errors.
- [x] 2026-07-19: Implemented the facade and migrated application callers. Validation: three focused
  facade policy tests passed, raw policy search returned no application-module matches, and all 149
  Rust tests passed outside the process-restricted sandbox.
- [x] 2026-07-19: Completed full gates and synchronized governance documents. Validation: app 62
  files / 491 tests, production build, worker 394 tests, Ruff, Node scripts 23 tests, rustfmt, docs
  0 errors / 0 warnings, and diff check passed. The build retained the existing Vite chunk-size
  warning; worker tests retained the existing Python `audioop` deprecation warning.

## Surprises & Discoveries

- Evidence: `worker_invocation_uses_server_managed_llm` already prevents credentials from entering
  non-retry command specs, but callers still choose the invocation independently from operation,
  progress, and lane. The existing protection is therefore necessary but not sufficient.
- Evidence: ASR model download has only one application call site and owns a distinct command builder
  in `asr_model.rs`; forcing it into the video job enum would mix policies rather than simplify them.
- Evidence: the approved local-media plan names `--process-local-media-stdin`, but neither contract
  v4 nor its Python CLI consumer exists. A dead Rust variant would be an untestable partial feature.

## Decision Log

- Decision: Use a closed current-job enum and a video-lane facade that derives all execution policy.
  Rationale: exhaustive matching turns future missing policy into a compile/test failure and removes
  valid-but-inconsistent request tuples from application code. Date/Author: 2026-07-19, User + Codex.
- Decision: Keep `WorkerLane` as the sole lifecycle runner and add no new spawn/wait/cancel path.
  Rationale: the existing runner already passed Windows and native macOS lifecycle acceptance; this
  change is about application policy composition only. Date/Author: 2026-07-19, Codex.
- Decision: Add `ProcessLocalMedia` only with contract v4 and its real consumer.
  Rationale: YAGNI and atomic cross-language contracts are safer than reserving executable dead code.
  Date/Author: 2026-07-19, Codex.

## Outcomes & Retrospective

Implementation is complete. Application modules submit semantic jobs, cancel/query through narrow
methods, and map typed outcomes, but cannot construct raw `WorkerRunRequest` policy or select a raw
lane. `video_processing.rs` no longer imports invocation, operation, progress, request, command
builder, lane, or account LLM execution policy. `asr_model.rs` no longer selects its operation,
progress route, or model lane; `history_deletion.rs` uses the semantic activity query.

The change preserved desktop-worker contract v3, Tauri commands, process/result adapters, progress
validation, cancellation precedence, diagnostics redaction, task artifacts, and AI Credits behavior.
The application-facing reduction removed all three raw composition sites from
`video_processing.rs`, with policy moved to the focused `worker_runtime/facade.rs` module and three
exhaustive policy tests.

Residual risk: compile-time pairing cannot prove that an opaque JSON payload matches the selected
job variant; existing strict Rust/Python request schema tests remain the authority for payload shape.
The Vite bundle-size and Python `audioop` warnings predate and are unrelated to this Rust refactor.
Native cancellation was not re-run manually because `WorkerLane`, `ProcessSupervisor`, command
transport, and Tauri IPC behavior are unchanged; the full process-lifecycle suite passed.

## Context and Orientation

- Persistent design: `docs/design-docs/2026-07-19-typed-worker-job-facade.md`.
- Existing lifecycle design: `docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md`.
- Future consumer: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`.
- Command construction: `app/src-tauri/src/worker_runtime/command.rs`.
- Lifecycle runner: `app/src-tauri/src/worker_runtime/runner.rs`.
- Runtime composition: `app/src-tauri/src/worker_runtime/mod.rs`.
- Application callers: `app/src-tauri/src/video_processing.rs`,
  `app/src-tauri/src/asr_model.rs`, and `app/src-tauri/src/history_deletion.rs`.
- Architecture audit: `docs/design-docs/frameq-code-audit-uml.md`.

## Plan of Work

1. Add RED tests for process-video, source-identity, and retry-insights job policies, including fixed
   CLI mode, operation, progress protocol, and retry-only LLM environment.
2. Add `worker_runtime/facade.rs` with the closed current `WorkerJob` enum and
   `VideoWorkerFacade::execute`.
3. Make raw invocation/run-request policy private to `worker_runtime`; keep runner outcomes and
   errors available for application result mapping.
4. Make `ProcessSupervisors` lanes private and expose semantic video facade, cancel/activity, and
   model-download execution/cancel methods.
5. Migrate `video_processing.rs`, `asr_model.rs`, and `history_deletion.rs` without changing their
   public result mapping or Tauri commands.
6. Update architecture, security, lifecycle design, code-audit UML, local-media plan, indexes, and
   task tracking; then run full verification and archive this ExecPlan.

## Validation and Acceptance

Automated gates:

- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check`
- `npm --prefix app test`
- `npm --prefix app run build`
- `uv run pytest worker/tests`
- `uv run ruff check worker`
- `node --test scripts/tests/*.test.mjs`
- `python scripts/validate_agents_docs.py --level WARN`
- `git diff --check`

Focused acceptance:

- Each current video job maps to exactly one operation, CLI mode, progress protocol, LLM policy,
  and the video lane.
- Non-retry jobs cannot receive server-managed LLM variables; retry retains current checkout values.
- Application modules do not import `WorkerInvocation`, `WorkerOperation`, `ProgressRoute`,
  `WorkerRunRequest`, or call `WorkerLane::run`.
- ASR model download still derives its fixed model progress route and separate lane through a narrow
  runtime method.
- Existing public process, retry, preflight, cancellation, deletion, model download, diagnostics,
  and privacy tests remain unchanged and pass.

Manual regression: no new UI or Tauri command is introduced, so no separate native interaction is
required. Existing native cancellation evidence remains applicable because `WorkerLane` and its
supervisor/runner implementation are unchanged.
