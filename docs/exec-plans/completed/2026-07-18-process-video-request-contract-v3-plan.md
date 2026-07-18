# Process-video request contract v3 Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ continues to process the same supported public video URLs and produce the same local artifacts.
Internally, the frontend sends only the URL, Rust resolves the configured ASR model once, and the
bundled worker receives a strict v3 execution request containing only values it actually consumes.
Legacy false fields fail closed instead of being silently carried across three languages.

## Progress

- [x] 2026-07-18: Inspected the current TypeScript, Rust, Python, shared-contract, and local-media
  request definitions and confirmed that only URL and model have production consumers. Validation:
  focused `rg` evidence recorded in the design discussion and code-audit baseline.
- [x] 2026-07-18: User approved the split intent/execution design, Rust model ownership, strict v3
  schema, retired fields, and local-media v4 follow-up. Validation: explicit user instruction to
  proceed with implementation.
- [x] 2026-07-18: Published synchronized product, ADR, architecture, security, task, and local-media
  planning updates. Validation: `python scripts/validate_agents_docs.py --level WARN` passed with
  0 errors and 0 warnings; `git diff --check` passed.
- [x] 2026-07-18: Added and observed failing TypeScript, Rust, and Python contract tests. Validation:
  focused app tests failed 3 assertions on v2/five-field payloads; focused Rust tests failed 3
  assertions on URL-only IPC, legacy rejection, and exact worker serialization; focused Python tests
  failed 21 contract assertions, and the model-ownership test captured Qwen from environment instead
  of the explicit SenseVoice request.
- [x] 2026-07-18: Implemented the minimal IPC and worker request migration. Validation: focused
  frontend contract tests passed 21/21, focused Rust process-request tests passed 4/4, and focused
  Python parser/model-ownership/task tests passed 91/91 without compatibility defaults.
- [x] 2026-07-18: Ran complete app, Rust, worker, lint, build, docs, static-schema, and diff gates.
  Validation: app 491/491, Rust 143/143, worker 392/392, Ruff, TypeScript/i18n lint, Vite build,
  governance docs, and diff checks passed. The Windows cancellation fixture required running Cargo
  outside the filesystem/process sandbox so its child `taskkill` could execute; it then passed in
  both focused and complete suites.

## Surprises & Discoveries

- Evidence: `app/src-tauri/src/video_processing.rs` defines separate incoming and outgoing request
  structs but gives both the same five fields, even though this is the natural boundary for splitting
  user intent from resolved execution.
- Evidence: Rust resolves `FRAMEQ_ASR_MODEL` before model-aware cache lookup, while
  `worker/frameq_worker/worker_service.py` resolves the model from environment again. Configuration
  therefore has two owners in the current process path.
- Evidence: `docs/product-specs/2026-07-16-local-media-file-import.md` copied all three false fields
  into both proposed local IPC and worker requests, so request cleanup must precede that implementation.
- Evidence: `contracts/desktop-worker-contract.json` v2 declares AI requests and progress schemas but
  does not declare the process-video worker request shape.
- Evidence: there is no second tracked packaged-worker source mirror under `app/src-tauri/resources`;
  release packaging consumes the canonical worker tree, so no generated copy required synchronization.
- Evidence: the Windows blocked-stdin cancellation test fails after 30 seconds when process-tree
  termination is sandboxed, but passes in 0.36 seconds outside that sandbox. This is a test execution
  permission constraint, not a request-contract behavior difference.

## Decision Log

- Decision: React-to-Tauri sends only `url`; Rust-to-worker sends `contract_version`, `url`, and
  `asr_model`. Rationale: the boundaries express different concepts and must not share a false DTO.
  Date/Author: 2026-07-18, User + Codex.
- Decision: Rust is the sole processing-model configuration owner. Rationale: Rust already reads
  app-local settings and requires the same resolved model for cache matching before worker launch.
  Date/Author: 2026-07-18, User + Codex.
- Decision: Retire `language`, `output_formats`, and `insightflow_mode` with no compatibility parser.
  Rationale: desktop and worker ship together and compatibility defaults would preserve semantic
  drift. Date/Author: 2026-07-18, User + Codex.
- Decision: Advance URL processing to contract v3 and reserve local media for v4. Rationale: a
  published contract version cannot acquire another strict request later without a version change.
  Date/Author: 2026-07-18, Codex.
- Decision: Use the existing JSON contract plus cross-language tests rather than multi-language code
  generation. Rationale: the remaining adapters are tiny and boundary-specific; strict schemas and
  executable tests address drift without three new build toolchains. Date/Author: 2026-07-18, Codex.

## Outcomes & Retrospective

The false five-field request is replaced by two explicit boundaries. React sends URL-only intent,
Rust resolves and owns the app-local ASR model before cache lookup, and Python accepts only the exact
v3 execution request. Legacy, missing, additional, wrong-version, and unsupported-model payloads fail
closed with a fixed non-echoing error. The local-media design now reserves contract v4 and no longer
copies the retired fields.

Residual risk: direct callers of the Python worker using the old unversioned payload now fail by
design. Desktop and worker must continue to ship atomically. Native macOS packaging was not rerun for
this platform-neutral contract change; its next release build remains the distribution-level check.

## Context and Orientation

- Product/ADR: `docs/product-specs/2026-07-18-process-video-request-contract-v3.md` and
  `docs/design-docs/2026-07-18-process-video-request-contract-v3.md`.
- Shared schema: `contracts/desktop-worker-contract.json`.
- Frontend IPC: `app/src/workerClient.ts`, `app/src/workerClient.test.ts`, and
  `app/src/desktopWorkerContract.test.ts`.
- Rust adapter/cache/config: `app/src-tauri/src/video_processing.rs` and settings/model modules.
- Worker parser/execution: `worker/frameq_worker/requests.py`, `models.py`, `worker_service.py`,
  `pipeline.py`, and `task_store.py`.
- Follow-up scope: local-media product spec, ADR, active ExecPlan, architecture, and security docs.

## Plan of Work

1. [x] Add contract-v3 RED tests.
   - Assert frontend IPC is exactly URL-only.
   - Assert the shared schema is closed and exact.
   - Assert Rust IPC rejects legacy fields and worker serialization emits exactly three v3 fields.
   - Assert Python rejects missing, legacy, additional, wrong-version, and unsupported-model payloads.
2. [x] Split and implement Rust request ownership.
   - Rename the incoming type to user-intent semantics and keep only URL.
   - Resolve app-local ASR model into a separate immutable worker request.
   - Use the resolved request for cache model matching and bounded stdin serialization.
3. [x] Narrow the worker model and parser.
   - Replace five fields with URL plus explicit `asr_model`.
   - Validate contract v3 and remove environment override from process execution.
   - Rename pipeline/task-store consumers and preserve manifest `model` output.
4. [x] Remove frontend constants and update all fixtures/callers.
5. [x] Synchronize durable docs and local-media v4 planning.
6. [x] Run focused and complete validation, inspect the diff, and archive the completed plan.

## Validation and Acceptance

- `npm --prefix app test`
- `npm --prefix app run lint`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `uv run pytest worker/tests`
- `uv run ruff check worker`
- `python scripts/validate_agents_docs.py --level WARN`
- `git diff --check`
- Static acceptance: production request code contains no `language`, `output_formats`, or
  `insightflow_mode` fields in process-video/local-media request definitions.
