# Closed Worker Terminal-Result Boundary

**Date:** 2026-07-19  
**Status:** Accepted for implementation by the user on 2026-07-19

## Context

FrameQ already validates worker requests and progress events as closed contracts, but terminal
stdout results have a weaker boundary. The Rust runtime currently scans stdout from the end and
accepts any JSON object containing `status`, while TypeScript models the Tauri return value as a
`WorkerResult` without parsing the runtime value. A malformed, stale, or operation-mismatched
producer can therefore cross Python -> Rust -> TypeScript with unknown fields or wrong nested types.

This is a protocol-integrity and privacy boundary, not only a typing improvement. Terminal values
may contain task paths, artifact paths, error details, transcript text, and generated content. Each
consumer must know which fields it is accepting, and a rejection must not echo the rejected payload.

## Decision

FrameQ will define three operation-specific terminal-result families in
`contracts/desktop-worker-contract.json` and validate them independently in Rust and TypeScript:

| Worker operation | Accepted terminal-result family |
|---|---|
| `ProcessVideo` | `TaskTerminalResult` |
| `RetryInsights` | `TaskTerminalResult` |
| `ResolveSourceIdentity` | `SourceIdentityTerminalResult` |
| `DownloadAsrModel` | `ModelDownloadTerminalResult` |

The shared contract remains the source of truth for cross-language drift tests. Rust and TypeScript
use small language-native parsers rather than treating a TypeScript annotation or a successful JSON
parse as validation. Every object is closed at every nesting level unless the contract explicitly
declares a bounded map.

## Goals

- Reject unknown fields, missing fields, wrong types, unsupported enum values, and result families
  that do not match the invoked operation.
- Validate nested artifacts, transcript metadata, structured insights, and errors rather than only
  the top-level `status` field.
- Preserve the current structured-result-first cancellation precedence and existing task outcome
  semantics.
- Return one fixed, localized-capable `WORKER_PROTOCOL_VIOLATION` failure without reflecting raw
  stdout, JSON, paths, transcript text, or generated content.
- Apply defense in depth: validate at the Rust process boundary and again at the TypeScript IPC
  boundary, including synthetic and cached values that may not have come from the Python process.
- Keep Python producers, the canonical contract, the packaged worker mirror, Rust, and TypeScript
  synchronized through focused contract tests.

## Non-goals

- This change does not implement local video/audio import or advance the request contract to v4.
- It does not introduce JSON-Schema code generation, a new schema framework, or a versioned result
  envelope.
- It does not make stable worker error codes a closed enum. Unknown safe codes remain renderable by
  the existing generic-error path.
- It does not translate, truncate, or otherwise reinterpret user transcripts or generated AI text.
- It does not redesign stdout as a streaming channel; progress and diagnostics remain on stderr.

## Contract shapes

### TaskTerminalResult

The task result has exactly these required top-level keys:

```text
status, task_id, task_dir, artifacts, text, summary,
insights, transcript, error
```

The three terminal statuses are `completed`, `partial_completed`, and `failed`.

- `completed` requires `error: null`.
- `partial_completed` and `failed` require a structured error.
- `task_id` and `task_dir` may be null only where the existing early-failure path cannot create a
  task. Non-null identifiers and paths must be strings.
- `artifacts` is a closed map whose only keys are `video`, `audio`, `transcript_txt`,
  `transcript_md`, `segments`, `summary`, `mindmap`, `insights`, `insights_md`, and
  `preference_snapshot`; every present value is a string.
- `transcript`, when present, contains exactly `source`, `language`, and `engine`. `source` is
  `asr | subtitle`; nullable metadata fields retain their current contract types.
- Each insight contains exactly `id`, `topic`, `matchReason`, `followUpQuestions`, `suitableUse`,
  and `sourceChunkId`, with the current string/string-array/nullability rules.
- An error contains exactly `code`, `message`, and `stage`. `stage` is a registered workflow stage.
  `code` accepts an uppercase safe-code grammar with a bounded length rather than a closed enum, so
  newer safe failures still reach the localized unknown-code fallback. `message` is a sanitized
  string; accepting it structurally does not authorize logging or rendering it without the existing
  error-presentation policy.

The contract will specify all nested required keys, enums, nullability, and
`additionalProperties: false`. User-owned transcript and generated-text fields will not receive an
arbitrary small length cap as part of this protocol hardening.

### SourceIdentityTerminalResult

This family is a closed tagged union:

- success: exactly `status: "completed"`, `source_url`, and `source_identity`;
- failure: exactly `status: "failed"` and a bounded structured error containing its safe code.

The success parser delegates the nested identity to the existing canonical `SourceIdentity`
validator after the outer shape is accepted. Task result fields and model-download fields are not
accepted for this operation.

### ModelDownloadTerminalResult

This family is a closed tagged union:

- success: exactly `status: "completed"` and the allowlisted public model identifier;
- failure: exactly `status: "failed"`, a safe bounded code, and a fixed sanitized message.

`model_dir` is removed from Python terminal stdout because Rust does not consume it and a local
filesystem path must not cross this boundary. Raw downloader, HTTP, archive, or operating-system
exception text is mapped to a fixed safe code/message before serialization.

### Stdout framing

A successful worker invocation must write exactly one non-empty UTF-8 JSON line to stdout. Progress
and diagnostics continue to use stderr. Empty output, multiple non-empty lines, invalid UTF-8,
invalid JSON, a non-object root, a mismatched operation family, or any invalid nested value is a
protocol violation.

The parser reports only an internal reason category for tests and safe diagnostics. It never embeds
the rejected line or deserializer payload in a public error or log.

## Rust ownership

A focused `worker_runtime/result_protocol.rs` module will own:

- operation-aware terminal DTOs with `serde(deny_unknown_fields)`;
- `ValidatedWorkerResult`, whose variants correspond to the three families;
- `parse_terminal_result(operation, stdout)` and semantic-invariant validation;
- fixed, non-echoing protocol errors.

`runner.rs` remains the child-process lifecycle owner. It passes the requested operation to the
result parser but does not inspect business fields itself. `WorkerRunOutcome::Structured` carries a
`ValidatedWorkerResult` instead of `serde_json::Value`.

Application modules exhaustively match the operation-specific variant. A variant mismatch is an
internal protocol violation, not an opportunity to reinterpret the JSON. The process-video and
retry-insights Tauri commands return typed task results. Cached and synthetic task results are built
through the same validated DTO boundary so they cannot bypass the IPC contract.

Terminal precedence remains:

1. A valid operation-matching structured result wins, including when cancellation raced with
   natural completion.
2. If cancellation is active and no valid terminal result exists, the outcome is `Cancelled`.
3. Invalid structured output is a protocol violation with a fixed safe error.
4. Missing output after a successful exit is a protocol violation.
5. Missing output after a nonzero exit remains an unstructured worker failure with existing safe
   process diagnostics.

## TypeScript ownership

The low-level command runner returns `Promise<unknown>`. A new focused result-protocol module parses
unknown values before `processVideo` or `retryInsights` exposes a `WorkerResult` to state or UI code.
It checks plain-object roots, exact key sets, all nested values, enums, nullability, and semantic
status/error coherence, then copies accepted data into a clean typed result.

The TypeScript parser does not stringify or log rejected values. A rejection becomes the same fixed
`WORKER_PROTOCOL_VIOLATION` task failure used by the Rust boundary. Small operation-specific parsers
also replace assertion-only casts on source/model terminal results where those values enter
TypeScript.

This second parser is intentional defense in depth: Tauri mocks, cached values, synthetic failures,
future command implementations, or a compromised IPC producer can bypass the Python stdout parser.

## Python producer changes

- `ProcessResult` remains the canonical task-result producer and must continue emitting the exact
  nine-key shape.
- Source-identity success and failure paths emit only their declared union member.
- Model download removes `model_dir`, emits only the public model ID on success, and maps exceptions
  to safe fixed code/message pairs before printing.
- The canonical worker and the Tauri packaged mirror must remain byte-identical at release gates.

Python also gains producer-side tests against the shared contract. Producer validation is useful for
early failures, but it does not replace consumer validation in Rust or TypeScript.

## Contract version

This work formalizes the current v3 terminal-result behavior and does not increment
`contractVersion`. The desktop executable and bundled worker are one atomic release unit, and the
accepted task/source/model result families already exist. Removing the unused `model_dir` is a
privacy reduction, not a new consumer capability. The active local-media plan retains ownership of
the future request-contract v4 transition.

Any future result-shape change must update the canonical contract, Python producer, Rust parser,
TypeScript parser, packaged mirror, and drift tests in one release. An independently deployed worker
would require a versioned result envelope; that deployment model remains outside the current
product boundary.

## Failure behavior

| Condition | Rust outcome | Public behavior |
|---|---|---|
| Exact valid result for operation | typed structured result | current success/partial/failure flow |
| Valid JSON for another operation | protocol violation | generic localized failure + safe code |
| Unknown/missing field or wrong type | protocol violation | generic localized failure + safe code |
| Invalid status/error combination | protocol violation | generic localized failure + safe code |
| Multiple stdout JSON lines | protocol violation | generic localized failure + safe code |
| No result while cancellation owns the lane | cancelled | current cancellation behavior |
| No result after zero exit | protocol violation | generic localized failure + safe code |
| No result after nonzero exit | unstructured failure | current sanitized process failure |

No branch includes raw stdout or rejected JSON in UI text, technical details, telemetry, or logs.

## Verification strategy

Implementation proceeds test-first.

### Shared contract and Python

- Assert the three operation-to-result-family mappings and every closed nested key set.
- Accept canonical task completed/partial/failed, source success/failure, and model success/failure
  fixtures.
- Reject additional/missing keys, wrong types, invalid enums, unsafe codes, and incoherent statuses.
- Assert model results never contain `model_dir` or raw third-party exception text.
- Assert canonical and packaged workers remain byte-identical.

### Rust

- Replace permissive parser tests with operation-specific table tests.
- Cover multiple lines, invalid UTF-8/JSON, non-object roots, family mismatch, every unknown nested
  field class, wrong types, invalid enums, unsafe codes, and status/error invariants.
- Preserve existing cancellation-race and exit-precedence tests.
- Verify application modules cannot consume the wrong `ValidatedWorkerResult` variant.

### TypeScript

- Pass canonical fixtures for all task terminal statuses.
- Reject unknown top-level and nested fields, arrays/objects in scalar positions, invalid statuses,
  unsafe error codes, bad insight arrays, and invalid transcript/artifact maps.
- Prove both real invoke results and injected runner/mock results cross the parser.
- Preserve workflow behavior for valid completed, partial, failed, cached, and synthetic results.

### Gates

- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check`
- `uv run pytest worker/tests`
- `uv run ruff check worker`
- `node --test scripts/tests/*.test.mjs`
- `python scripts/validate_agents_docs.py --level WARN`
- `git diff --check`

## Alternatives considered

### Runtime JSON Schema validation everywhere

Rejected for this increment. It would add schema-runtime dependencies and error-sanitization work in
three languages without removing the need for typed application DTOs and semantic invariants.

### One generated, versioned result envelope

Deferred. Code generation and an envelope are attractive if the worker becomes independently
deployable, but they broaden the release and migration design. The current bundled worker and
desktop ship atomically, so native strict parsers plus drift tests close the immediate boundary.

### Validate only in Rust

Rejected. TypeScript receives values from mocks, cache/synthetic paths, and the IPC boundary; its
compile-time type does not validate any of them at runtime.

### Close the error-code enum

Rejected. FrameQ intentionally gives unknown safe error codes generic localized guidance. Closing
the structural result does not require silently discarding a newer safe diagnostic code.

## Residual risks

- Native validators can drift from the JSON contract; cross-language fixtures and exact-key drift
  tests are the required control.
- User transcript and generated text can be large. This design validates their types but does not
  introduce new size policy; IPC/resource limits remain separate work.
- A compromised process can still emit a structurally valid false result. Authenticating a local
  bundled child process is outside this boundary; package integrity and controlled process launch
  remain the relevant controls.
- Independently upgrading only the desktop or only the worker is unsupported under the current
  atomic-bundle deployment model.
