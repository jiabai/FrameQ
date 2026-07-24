# Tauri IPC Runtime Decoding Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Close the remaining FrameQ-owned Tauri command-result boundaries so untrusted runtime
values are decoded before entering React application state.

**Architecture:** Keep each Tauri client as its domain adapter and anti-corruption layer. Add one
small domain-free parsing primitive plus a stable non-echoing error type, then migrate account,
History, settings, transcript detail, and FrameQ-owned update commands from assertions or tolerant
defaults to explicit `unknown -> parse -> domain value` flows.

**Tech Stack:** React, TypeScript, Vitest, Tauri v2, Rust, repository Node governance tests.

**Durable design:**
`docs/design-docs/2026-07-24-tauri-ipc-runtime-decoding-boundary.md`

## Purpose / Big Picture

Valid FrameQ behavior should look unchanged. The improvement is visible only when the desktop
frontend receives an incompatible or malformed native response: the affected action must fail at
the client boundary with a stable safe code instead of allowing invalid account, History, settings,
transcript, or update data to mutate application state. Rejected payloads must never be reflected
into errors, logs, technical details, or UI.

This is a TypeScript boundary-hardening change. It does not change Rust wire shapes, worker
contracts, storage formats, product behavior, network paths, updater signing, local media, AI
generation, or Credits.

## Progress

- [x] 2026-07-24: Inspected the current `main` client implementations and tests, confirmed direct
  assertions or tolerant runtime normalization remain in account, History, settings, transcript
  detail, and FrameQ-owned update command results, and approved the bounded design direction.
  Validation: source inspection with `rg` and `Get-Content`; current baseline `cca6b73`.
- [x] 2026-07-24: Wrote the durable boundary decision, this active ExecPlan, and governance/audit
  registrations without changing production code. Validation: documentation gate and
  `git diff --check` recorded before review handoff.
- [x] 2026-07-24: Added `tauriIpcProtocol.ts` with stable domain error codes plus descriptor-safe
  ordinary-object and dense-array readers. Adversarial tests first failed for the missing module
  and array reader, then passed with primitives, accessors, symbols, exotic prototypes, sparse
  arrays, unknown/missing keys, reflection failure, and secret non-echo coverage.
- [x] 2026-07-24: Migrated account and complete History command results through domain parsers.
  RED tests covered malformed quotas/auth/checkout/logout and malformed list/source/artifact/error/
  transcript/Insight/delete identities before the implementations made them GREEN.
- [x] 2026-07-24: Migrated remaining settings, transcript-detail, and FrameQ-owned update command
  results. Transcript invocation no longer uses a generic runner or `invoke<T>`; all three slices
  reject malformed nested values, producer-incompatible nullability, and identity mismatches.
- [x] 2026-07-24: Added
  `scripts/tests/tauri-ipc-runtime-decoding-boundary.test.mjs` and completed verification. Evidence:
  focused App 6 files / 64 tests, full App 68 files / 637 tests, Rust 223/223, repository scripts
  27/27, lint, build, rustfmt, governance 0 errors / 0 warnings, and `git diff --check` all pass.
- [x] 2026-07-24: Recorded implementation evidence, moved the audit item and tech debt to resolved,
  updated architecture/security/task/index references, and archived this plan under `completed/`.

## Surprises & Discoveries

- Evidence: `accountClient.ts`, `historyClient.ts`, and `settingsClient.ts` already declare runners
  returning `Promise<unknown>`, so the remaining weakness is not the runner type alone; the direct
  assertions and unchecked mapping functions bypass runtime decoding.
- Evidence: `transcriptDetailClient.ts` still declares a generic
  `TranscriptDetailCommandRunner<T>` and calls `invoke<T>`, making it the clearest remaining example
  of compile-time trust being mistaken for runtime validation.
- Evidence: `historyClient.ts` already validates `source` through `parseTaskSourceSummary`, but the
  outer response, artifacts, error, transcript metadata, and Insight arrays remain unchecked. The
  migration must preserve this useful domain parser while closing the containing DTO.
- Evidence: `settingsClient.ts` already validates UI preferences and worker model/cancel terminal
  results. The plan should extend the same boundary discipline without replacing
  `workerResultProtocol.ts`.
- Evidence: `updateClient.ts` contains both FrameQ-owned Tauri commands and a behavior-bearing
  updater plugin handle. Only the FrameQ-owned data DTOs are suitable for the closed plain-object
  parser in this plan.
- Evidence: the current closed-worker architecture and security rules accurately describe worker
  terminal results, but they do not imply that every ordinary Tauri command result is already
  decoded.
- Evidence: the planning-session repository-script run completed 18/25 tests; all seven failures
  came from the i18n literal test group because
  `app/node_modules/typescript/lib/typescript.js` is absent in this workspace. Governance and
  whitespace gates pass independently. This is an unavailable local dependency, not passing
  implementation evidence, and the complete script suite remains mandatory after dependencies are
  present.
- Evidence: installing the existing App lockfile dependencies made the previously unavailable
  TypeScript parser available; the implementation-session repository suite then passed 27/27.
- Evidence: stricter History/account/worker-result parsing exposed stale browser mocks rather than
  production incompatibility. The shared bridge had returned list-only History fields from the
  detail command, and three handcrafted fixtures omitted required producer fields. Updating those
  mocks to project the exact Rust DTO made focused browser tests and the full App suite pass without
  weakening a decoder.
- Evidence: the first sandboxed Rust run timed out and reported runner cancellation/watchdog
  failures because Windows `taskkill /T /F` returned `Access denied`. The same focused test also
  failed or stalled from unchanged `main`; a direct probe confirmed the sandbox restriction.
  Running the focused test and complete Cargo suite with the required process-termination
  permission passed 1/1 and 223/223.
- Evidence: Rust serializes `TranscriptSegmentView.speaker: None` by omitting the field, so a
  successful response accepts absent or string `speaker`; explicit `null` is rejected even though
  the public request type can still express `null` when sending an edit.

## Decision Log

- Decision: Add `app/src/tauriIpcProtocol.ts` with a stable `IpcProtocolError` and mechanical safe
  object-reading helpers only. Rationale: property safety is cross-cutting, but DTO fields and
  semantics belong to their domain clients. Date/Author: 2026-07-24, User + Codex.
- Decision: Use one fixed non-echoing response-invalid code per domain. Rationale: controllers need
  a safe failure identity, while field/value diagnostics would increase disclosure risk and couple
  UI to decoder internals. Date/Author: 2026-07-24, User + Codex.
- Decision: Keep handwritten parsers and add no Zod/BaseClient/schema registry. Rationale: existing
  worker and local-media protocols establish the pattern, and five bounded clients do not justify a
  framework or dependency. Date/Author: 2026-07-24, User + Codex.
- Decision: Preserve `workerResultProtocol.ts`, `localMediaContract.ts`, and their established error
  codes. Rationale: these are already specialized, tested closed contracts; a broad rewrite would
  increase risk without closing the remaining gaps. Date/Author: 2026-07-24, Codex.
- Decision: Include FrameQ-owned update delivery/preferences, but exclude the updater plugin handle
  from the plain-data decoder. Rationale: the handle contains behavior owned by the typed plugin
  adapter, whereas FrameQ commands return serializable DTOs owned by this repository.
  Date/Author: 2026-07-24, Codex.
- Decision: Do not update product specs or contract version. Rationale: valid response behavior and
  wire shapes remain unchanged; this is independent consumer validation. Date/Author: 2026-07-24,
  User + Codex.
- Decision: Treat arrays as descriptor-safe dense data containers rather than using
  `Array.from(value)`. Rationale: sparse, accessor-backed, symbol/custom-property, or enormous
  length-only arrays must fail before allocation or getter evaluation. Date/Author: 2026-07-24,
  Codex.
- Decision: Fix full-suite mocks at the producer fixture boundary instead of accepting list-only
  fields or missing required result fields. Rationale: the Rust DTO is exact and the regression was
  mock drift; widening parsers would defeat the approved anti-corruption boundary.
  Date/Author: 2026-07-24, Codex.

## Outcomes & Retrospective

Outcome: all five reviewed FrameQ-owned Tauri client domains now treat successful command results as
runtime-untrusted, validate complete domain shapes before returning public values, and fail with one
stable non-echoing code per domain. The shared primitive remains mechanical and domain-free; worker,
local-media, UI-preference, model-download, cancellation, and behavior-bearing updater-plugin
adapters retain their specialized contracts. No Rust DTO, wire shape, dependency declaration,
storage format, network behavior, UI behavior, media workflow, account/payment action, LLM call, or
AI Credit behavior changed.

The TDD sequence caught real fixture drift in App-level mocks and kept the production decoders
strict. Complete App, native producer compatibility, repository boundary, build, lint, formatting,
governance, and whitespace evidence is green.

Residual risks are intentionally bounded: protocol errors identify the failing domain rather than
the exact field, and the static source gate enumerates the five reviewed clients, so a future Tauri
client must be deliberately added to that review set. No native manual smoke was run because the
change alters neither Rust DTOs nor user-visible flows and both complete App and Rust producer suites
passed.

## Context and Orientation

### Durable decisions and governance

- `docs/design-docs/2026-07-24-tauri-ipc-runtime-decoding-boundary.md`
- `docs/design-docs/2026-07-19-closed-worker-terminal-results.md`
- `docs/design-docs/frameq-code-audit-uml.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `TASKS.md`
- `docs/exec-plans/tech-debt-tracker.md`

### Shared and specialized TypeScript protocols

- `app/src/workerResultProtocol.ts`
- `app/src/workerResultProtocol.test.ts`
- `app/src/localMediaContract.ts`
- `app/src/localMediaContract.test.ts`
- `app/src/localMediaClient.ts`
- `app/src/localMediaClient.test.ts`
- `app/src/tauriIpcProtocol.ts`
- `app/src/tauriIpcProtocol.test.ts`

### In-scope domain clients

- `app/src/accountClient.ts`
- `app/src/accountClient.test.ts`
- `app/src/historyClient.ts`
- `app/src/historyClient.test.ts`
- `app/src/settingsClient.ts`
- `app/src/settingsClient.test.ts`
- `app/src/transcriptDetailClient.ts`
- `app/src/transcriptDetailClient.test.ts`
- `app/src/updateClient.ts`
- `app/src/updateClient.test.ts`

### Native producer references

- `app/src-tauri/src/account.rs`
- `app/src-tauri/src/history.rs`
- `app/src-tauri/src/history_deletion.rs`
- `app/src-tauri/src/settings.rs`
- `app/src-tauri/src/transcript_detail.rs`
- `app/src-tauri/src/updates.rs`

## File Responsibility Map

| File | Responsibility after implementation |
|------|-------------------------------------|
| `tauriIpcProtocol.ts` | domain-free safe data-object inspection and stable `IpcProtocolError` |
| `accountClient.ts` | account/auth/checkout command invocation, response parsing, existing domain projection |
| `historyClient.ts` | History invocation and full list/detail/delete decoding |
| `settingsClient.ts` | settings invocation and response parsing, delegating established worker result protocols |
| `transcriptDetailClient.ts` | transcript load/save invocation and complete DTO decoding |
| `updateClient.ts` | FrameQ update command DTO decoding plus existing plugin adapter behavior |
| `scripts/tests/` boundary test | prevent reintroduction of direct in-scope response assertions or `invoke<T>` |

## Plan of Work

### Task 1: Register the Approved Boundary

**Files:**

- Create:
  `docs/design-docs/2026-07-24-tauri-ipc-runtime-decoding-boundary.md`
- Create:
  `docs/exec-plans/completed/2026-07-24-tauri-ipc-runtime-decoding-plan.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`

Record that the worker terminal boundary is already closed but ordinary Tauri DTO decoding is not.
Register the active debt and link this plan. Do not modify a product spec, desktop-worker contract,
or UI design document because valid behavior and wire shapes remain unchanged.

**Validation:**

```powershell
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

### Task 2: Add Shared Defensive IPC Primitives

**Files:**

- Create: `app/src/tauriIpcProtocol.ts`
- Create: `app/src/tauriIpcProtocol.test.ts`

Start with tests for primitives, arrays, exotic prototypes, symbols, accessors, unexpected/missing
keys, and reflection failure. Include a throwing getter with a secret fixture and prove the getter
is not evaluated and the secret is absent from the stable error.

Implement only the approved surface:

```ts
export type IpcProtocolErrorCode =
  | "ACCOUNT_IPC_RESPONSE_INVALID"
  | "HISTORY_IPC_RESPONSE_INVALID"
  | "SETTINGS_IPC_RESPONSE_INVALID"
  | "TRANSCRIPT_IPC_RESPONSE_INVALID"
  | "UPDATE_IPC_RESPONSE_INVALID";

export class IpcProtocolError extends Error {
  readonly code: IpcProtocolErrorCode;
}
```

Add domain-free helpers that return accepted own data values without evaluating accessors. Do not
add field names, logging, payload/cause parameters, schema registration, generic client behavior, or
a dependency.

**Validation:**

```powershell
npm --prefix app test -- tauriIpcProtocol.test.ts
```

### Task 3: Decode Account Command Results

**Files:**

- Modify: `app/src/accountClient.ts`
- Modify: `app/src/accountClient.test.ts`

Write malformed-response tests first for account status, begin/complete auth, activation refresh,
checkout, checkout status, and logout unit response. Then replace every assertion with a
domain-owned parser receiving `unknown`.

Validate all required fields, nullable timestamps/email/server error, finite non-negative integer
quota and amount fields, booleans, and current identity relationships. Preserve existing camelCase
public return values. Replace unchecked fallback defaults with validation followed by legitimate
optional handling only where the Rust DTO is actually optional.

Any decoder failure throws `IpcProtocolError("ACCOUNT_IPC_RESPONSE_INVALID")`. A native command
rejection is not remapped.

**Validation:**

```powershell
npm --prefix app test -- accountClient.test.ts tauriIpcProtocol.test.ts
```

### Task 4: Decode Complete History Results

**Files:**

- Modify: `app/src/historyClient.ts`
- Modify: `app/src/historyClient.test.ts`

Add valid producer fixtures plus an adversarial matrix for:

- the History list array and each list item;
- source variants through the existing `parseTaskSourceSummary`;
- terminal status;
- the closed optional artifact key set;
- error code/stage/message;
- transcript metadata;
- Insight arrays and follow-up questions; and
- delete response task identity and `deleted: true`.

Decode outer and nested shapes before mapping. Keep `historyItemToWorkerResult` as a pure conversion
from an already validated `HistoryItem`. A malformed native success response uses
`HISTORY_IPC_RESPONSE_INVALID`; native `HISTORY_DELETE_FAILED` remains a command rejection and is
not swallowed.

**Validation:**

```powershell
npm --prefix app test -- historyClient.test.ts workerResultProtocol.test.ts
```

### Task 5: Decode Remaining Settings Results

**Files:**

- Modify: `app/src/settingsClient.ts`
- Modify: `app/src/settingsClient.test.ts`

Add domain parsers for:

- `get_llm_config` / `save_llm_config`;
- `get_audio_review_cache_usage` / `clear_audio_review_cache`; and
- `check_first_run`.

Validate string paths as strings without claiming TypeScript path authority, model arrays element by
element, finite non-negative integer byte counts, and first-run booleans. Keep UI preferences and
worker model/cancel parsers on their existing specialized paths. Align their thrown errors with the
stable existing codes; do not force them into the new settings domain code.

All newly migrated settings DTO failures use
`IpcProtocolError("SETTINGS_IPC_RESPONSE_INVALID")`.

**Validation:**

```powershell
npm --prefix app test -- settingsClient.test.ts workerResultProtocol.test.ts
```

### Task 6: Decode Transcript Load and Save Results

**Files:**

- Modify: `app/src/transcriptDetailClient.ts`
- Modify: `app/src/transcriptDetailClient.test.ts`

Change the runner to:

```ts
export type TranscriptDetailCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<unknown>;
```

Remove `invoke<T>`. Parse load and save responses before returning them. Validate exact keys,
task ID, text, nullable audio paths, backup flag, closed artifacts, and every segment. Segment IDs
and text are strings; millisecond values are finite non-negative integers with `end_ms >= start_ms`;
optional speaker is absent, string, or null as defined by the current producer.

Validate that returned task identity matches the requested task before controller state can change.
Decoder failures use `TRANSCRIPT_IPC_RESPONSE_INVALID` and never include transcript or path data.

**Validation:**

```powershell
npm --prefix app test -- transcriptDetailClient.test.ts
```

### Task 7: Decode FrameQ-Owned Update Command Results

**Files:**

- Modify: `app/src/updateClient.ts`
- Modify: `app/src/updateClient.test.ts`

Make the delivery runner and preference runner return `Promise<unknown>`. Add exact decoders for
`get_update_delivery`, `get_update_preferences`, and `save_update_preferences`. Validate nullable
preference fields and finite non-negative postponed timestamps according to the Rust DTO. Do not
silently normalize malformed values to defaults.

Keep the updater plugin check/download handle and normalized plugin progress events behind their
existing typed adapter. Do not attempt to clone or plain-object-decode the behavior-bearing handle.
Decoder failures for FrameQ command DTOs use `UPDATE_IPC_RESPONSE_INVALID`.

**Validation:**

```powershell
npm --prefix app test -- updateClient.test.ts
```

### Task 8: Prevent Boundary Regression and Run Complete Verification

**Files:**

- Create or modify a focused file under `scripts/tests/` following current repository-test naming
  and fixture style.
- Modify in-scope client tests only if full-suite evidence reveals a legitimate compatibility gap.

Add a source-boundary test that:

- enumerates the reviewed Tauri client files explicitly;
- rejects generic `invoke<T>` at those command-result boundaries;
- rejects direct response assertions matching the old `as ...Response` pattern;
- requires runner result types to be `Promise<unknown>`; and
- does not ban unrelated ordinary TypeScript assertions globally.

Run the focused tests after each slice, then:

```powershell
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
cargo test --manifest-path app/src-tauri/Cargo.toml
node --test scripts/tests/*.test.mjs
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Inspect failures rather than weakening closed shapes to make fixtures pass. If a current Rust
producer legitimately differs, update the domain parser and valid fixture together and record the
discovery here; change Rust only when the current producer is itself inconsistent with its
documented response.

### Task 9: Record Evidence and Archive

**Files:**

- Modify: this ExecPlan
- Move this plan from `active/` to `completed/`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`

Fill every Progress item with dated commands and counts, update Discoveries and Decisions, replace
the planning retrospective with actual outcomes and residual risks, mark the audit item resolved,
remove the open debt row, and archive only after all required gates pass.

## Validation and Acceptance

### Required automated evidence

```powershell
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
cargo test --manifest-path app/src-tauri/Cargo.toml
node --test scripts/tests/*.test.mjs
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

### Behavioral acceptance

- Valid account, History, settings, transcript, and update fixtures return the same public values as
  before.
- Malformed responses fail before controller/application state mutation.
- Native command rejections retain their existing semantic errors.
- Worker terminal results, local-media selection, UI preferences, model download, and cancellation
  retain their established specialized behavior.
- No account, payment, update download, local media, LLM, or AI Credit call is required.

### Structural acceptance

- All in-scope runners return `Promise<unknown>`.
- No in-scope command result relies on `invoke<T>`, direct response assertions, or malformed-value
  defaulting.
- Shared primitives contain no domain DTO fields and clients retain domain parser ownership.
- The boundary gate is explicit and does not impose a repository-wide assertion ban.

### Security acceptance

- Accessors, symbols, exotic prototypes, unknown fields, and malformed nested data fail closed.
- Error objects expose only the stable domain code.
- Secret-bearing fixture values do not appear in error messages, causes, enumerable fields, logs, or
  snapshots.
- Rust remains the authority for session, task, filesystem, and updater-signature trust.

### Manual evidence

No native manual smoke is required solely for parser implementation if the complete App and Rust
producer suites pass and wire shapes do not change. If implementation changes a Rust DTO or exposes
an existing producer mismatch, run the corresponding real Tauri flow and record the host/platform;
an unavailable host is a residual risk, not an implicit pass.

## Final Acceptance

The work is complete only after all five domain boundaries reject malformed runtime values with
stable non-echoing errors, valid behavior remains unchanged, the source-boundary regression test and
all required gates pass, evidence is recorded here, the audit/debt entries are closed, and this plan
is archived.
