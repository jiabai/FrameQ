# Transcript Dissection Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent `dissection` AI target that turns a saved official transcript into a
strict, source-linked structural analysis while preserving local-first storage, truthful quota
semantics, atomic replacement, and safe history recovery.

**Architecture:** Extend the existing closed desktop-worker contract and reuse the
`retry_insights` operation with `target="dissection"`. Python owns deterministic UTF-8 chunking,
the bounded map/reduce/repair plan, strict report validation, and atomic JSON/Markdown artifact
commit. Rust owns task/path authority, terminal decoding, history restoration, and source-integrity
verification. React owns confirmation, target state, report rendering, stale presentation, and a
narrow byte-range locator that never treats splitter chunk IDs as ASR segment IDs.

**Tech Stack:** React/TypeScript, Tauri/Rust, Python worker, JSON contracts, Vitest, Cargo tests,
pytest, ruff, and repository governance tests.

**Durable design:**
`docs/design-docs/2026-07-31-transcript-dissection-feature.md`

**Approved product specification:**
`docs/product-specs/2026-07-31-transcript-dissection.md`

---

## Purpose / Big Picture

After this work, a user with a supported completed or partially completed task and a non-empty saved
official transcript can open a truthful confirmation sheet, see the deterministic chunk count and
worst-case quota requirement, and explicitly start a dissection. The worker sends only transcript
chunks to the configured LLM supplier, performs no more than six charged attempts, and publishes a
complete `ai/dissection.json` plus `ai/dissection.md` in one task transaction. The report explains
structure, narrative, rhetorical devices, rhythm, reusable patterns, risks, audience fit, strengths,
and weaknesses. Every segment cites one or more deterministic source chunks.

The user can reopen the report from history and locate cited text only while the current official
transcript and every cited UTF-8 byte slice still match their recorded SHA-256 values. Saving a
changed transcript retains the last successful report but marks it stale and disables source
location. Cancellation or failure never exposes a partial report and never destroys an older
successful report.

## Progress

- [x] 2026-07-31: Reviewed and corrected the durable design, added the product specification, and
  received explicit user approval to proceed with implementation planning.
- [x] 2026-07-31: Created this active ExecPlan and mapped contract, Python, Rust, frontend, history,
  persistence, security, and verification boundaries.
- [x] Task 1: Version and test the closed cross-language contract.
- [x] Task 2: Build deterministic chunks, call planning, generation, and strict validation.
- [x] Task 3: Integrate retry execution and atomic task artifacts.
- [x] Task 4: Add Rust terminal decoding, task access, integrity checks, and history recovery.
- [x] Task 5: Extend frontend protocols, workflow state, and history state.
- [x] Task 6: Add confirmation, report UI, stale handling, source location, and i18n.
- [x] Task 7: Prove quota, cancellation, privacy, compatibility, packaging, and end-to-end behavior.
- [x] 2026-08-01: Task 8 ran completion gates, synchronized durable docs, audited the scoped diff,
  recorded native/live residual evidence, and archived this plan.

## Surprises & Discoveries

- The shipped workspace currently has only `summary` and `insights` cards. `draft` is specified but
  not implemented; dissection must therefore ship as the current third card without registering or
  activating `draft`. The four-card order remains the future target state.
- Terminal worker results and artifact keys are exact closed sets in JSON, Python, Rust, and
  TypeScript. Adding a nullable structured `dissection` result requires a contract version bump and
  coordinated decoder updates; permissive compatibility parsing would weaken an existing boundary.
- `ServerManagedInsightClient.generate()` already performs one server checkout per supplier call.
  The bounded call plan belongs above that client; no new server route or worker quota callback is
  required.
- `TaskStoreFacade.finalize()` already commits artifact payloads and the manifest through the task
  journal. Dissection must enter that path as payloads, not write report files independently.
- The current splitter has deterministic IDs and a 2,000-character limit but no byte ranges or
  hashes. Source location therefore requires extending splitter metadata without confusing those
  chunk IDs with ASR segment IDs.
- History lists are manifest-only, while history detail can read validated artifacts. List rows need
  only the two generic artifact keys; report parsing and transcript integrity work stay in detail
  loading.
- Rust process-cancellation tests cannot terminate child process trees inside the managed sandbox.
  The same focused test and the complete 233-test Rust suite pass with normal Windows process
  permissions; Rust verification that exercises child-process termination must use that boundary.
- The global desktop-worker contract advances to version 5 while the independently versioned
  `process_video` and local-media request envelopes remain at versions 3 and 4 respectively.
- JavaScript string length counts UTF-16 code units while Python counts Unicode code points. The
  confirmation call-plan calculator must explicitly iterate code points or emoji-containing
  transcripts can disagree with worker admission.
- Full browser tests initially failed as a group because their shared Tauri bridge still emitted v4
  terminal/history fixtures. Keeping those fixtures exact is part of the v5 contract migration; the
  UI must not weaken strict decoding to accommodate stale test data.
- A clean Task 8 pytest invocation initially failed during fixture setup because the managed process
  could not scan the user-level pytest temp root. Re-running the same full suite with a verified
  worktree-local `--basetemp` passed 661 tests; the temporary tree was then removed.
- PowerShell resolved `npm` to a policy-blocked `npm.ps1`; invoking the same installed tool through
  `npm.cmd` ran all frontend gates successfully.

## Decision Log

- Decision: Product specification approved on 2026-07-31; implementation may proceed only through
  this active ExecPlan. Rationale: the change is user-visible and crosses multiple trust boundaries.
  Date/Author: 2026-07-31, User + Codex.
- Decision: Reuse `retry_insights` with `target="dissection"`; do not add another Tauri command or
  CLI operation. Rationale: it is already the typed, cancellable, mutually exclusive AI-target lane.
  Date/Author: 2026-07-31, Codex.
- Decision: Keep `draft` absent until its own plan is implemented. Rationale: contract widening for
  dissection must not advertise an unusable target. Date/Author: 2026-07-31, Codex.
- Decision: Use a versioned deterministic plan of four chunks per map call, one reduce call, and at
  most one repair call, with a hard maximum of six attempts. Rationale: preview, admission, checkout,
  and failure semantics must be explainable and testable. Date/Author: 2026-07-31, User + Codex.
- Decision: Store splitter provenance as UTF-8 byte ranges and hashes without copied source text.
  Rationale: it enables local source location without duplicating private transcript content in the
  report artifact. Date/Author: 2026-07-31, User + Codex.
- Decision: Validate source integrity in Rust for fresh retry results and history detail; after a
  successful transcript edit, frontend state immediately marks the retained report stale. Rationale:
  Rust owns trusted task reads, while the edit event can conservatively invalidate location without
  re-hashing private content in JavaScript. Date/Author: 2026-07-31, Codex.
- Decision: Keep the manifest generic with `dissection` and `dissection_md`; add no parallel boolean,
  path, or count fields. Rationale: artifact presence already models durable availability.
  Date/Author: 2026-07-31, User + Codex.
- Decision: Preserve the previous successful report in the UI when a rerun fails or is cancelled,
  in addition to preserving it on disk. Rationale: target-scoped failure must not hide the last
  usable local artifact. Date/Author: 2026-08-01, Codex.
- Decision: Archive with live paid-supplier and native packaged cross-platform UX checks recorded
  as release residuals. Rationale: deterministic fake-supplier, browser, protocol, packaging, and
  native Windows process evidence close implementation correctness without authorizing paid calls
  or claiming unperformed physical-host acceptance. Date/Author: 2026-08-01, Codex.

## Outcomes & Retrospective

Implemented the independent `dissection` AI target end to end. Contract v5, Python bounded
map/reduce/repair generation, task-journal publication, Rust task/source validation, History
recovery, and the React confirmation/report/stale/location flows now agree on one closed schema and
one six-attempt maximum. The current UI has three targets because draft remains deliberately absent.

The most important implementation lesson was that provenance needs two different units at its two
boundaries: deterministic splitting counts Unicode code points for Python/TypeScript preview parity,
while local source verification uses UTF-8 bytes and hashes. Keeping both explicit prevented emoji
drift and avoided misusing ASR segment IDs.

Task 8 evidence: worker `661 passed, 2 skipped` with one existing `audioop` deprecation warning;
Ruff passed; Rust `233 passed` under normal Windows child-process permissions; frontend `664 passed`;
TypeScript/i18n lint, rustfmt, and production build passed; repository scripts `29 passed`; governance
ERROR/WARN reported zero violations; `git diff --check` passed. The production build retains the
existing 709.44 kB single-chunk warning. The first pytest/temp-root, Rust managed-sandbox, and
PowerShell `npm.ps1` failures were environment boundaries and were resolved by rerunning the exact
gates with a worktree basetemp, normal Windows process permission, and `npm.cmd` respectively.

No runtime server/schema, dependency, model, or configuration change was required. The scoped diff
and packaging tests contain only synthetic fixtures and fixed contract/path names; no user
transcript/report, source URL, absolute local path, token/key, or private configuration is bundled.
Remaining release evidence is a live paid-supplier/quota run and physical native packaged UX on each
supported platform. Those are explicitly unperformed residuals, not pass claims.

## Contract Invariants

The implementation must keep these values identical across JSON, Python, Rust, and TypeScript:

```json
{
  "target": "dissection",
  "artifactKeys": ["dissection", "dissection_md"],
  "artifactPaths": ["ai/dissection.json", "ai/dissection.md"],
  "callPlan": {
    "version": 1,
    "maxChunkCharacters": 2000,
    "chunksPerMapCall": 4,
    "reduceCalls": 1,
    "maxRepairCalls": 1,
    "maxTotalCalls": 6
  }
}
```

For `chunkCount > 0`, the preview and worker calculate:

```text
lowerBound = ceil(chunkCount / 4) + 1
upperBound = lowerBound + 1
admit only when upperBound <= 6 and remainingQuota >= upperBound
```

The structured report must be a complete closed object with these top-level fields:

```text
sourceTranscriptSha256
sourceLanguage
sourceChunks
overallNarrative
segments
highlights
reusableTemplate
audienceFit
strengths
weaknesses
```

`sourceChunks[]` entries contain exactly `id`, `startByte`, `endByte`, and `sha256`. Segment source
references are non-empty, deduplicated, ascending `sourceChunkIds[]`. Validation rejects unknown
fields, missing fields, empty required content, invalid enums, invalid hashes, invalid or overlapping
ranges, unknown references, over-limit arrays, invented highlight quotations, and inconsistent
language. It may perform one charged repair call; a still-invalid result fails closed with no new
artifact commit. It must never clamp or silently drop invalid content.

## Expected Main Files

| Area | Main files expected to change |
|---|---|
| Governance | `TASKS.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/SECURITY.md`, product/design statuses, and ExecPlan indexes |
| Shared contracts | `contracts/desktop-worker-contract.json`, `contracts/task-artifact-transaction-v1.json`, `scripts/tests/*.test.mjs` |
| Python domain | `worker/frameq_worker/{desktop_contract.py,models.py,requests.py}`, `insightflow/{splitter,dissection,prompt}.py`, `pipeline_runtime/dissection.py` |
| Python persistence | `worker/frameq_worker/{task_store.py,task_transaction.py}`, `worker_application/insight_retry.py` |
| Rust boundary | `app/src-tauri/src/worker_runtime/result_protocol.rs`, `video_processing/retry_insights.rs`, `video_processing/task_result.rs`, `task_manifest/{schema,access,dissection,tests}.rs`, `history.rs` |
| Frontend state | `app/src/{desktopWorkerProtocol,workerResultProtocol,workerClient,workflowState,taskWorkspaceViewModel,historyClient,taskArtifacts}.ts` and focused tests |
| Frontend feature | `app/src/features/dissection/*`, `features/results/{AiGenerationWorkspace,AiResultDetailSheet,DissectionReport}.tsx`, transcript controller/view files, `App.tsx`, `App.css`, i18n resources |

## Plan of Work

### Task 1: Version and Test the Closed Cross-Language Contract

**Files:**

- Modify: `contracts/desktop-worker-contract.json`
- Modify only if its closed path schema requires it: `contracts/task-artifact-transaction-v1.json`
- Modify: `worker/frameq_worker/desktop_contract.py`
- Modify: `worker/frameq_worker/models.py`
- Modify: `worker/frameq_worker/requests.py`
- Modify: `worker/tests/test_contract.py`
- Modify: `worker/tests/test_models.py`
- Modify: `worker/tests/test_requests.py`
- Modify: `app/src/desktopWorkerProtocol.ts`
- Modify: `app/src/desktopWorkerContract.test.ts`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/src/worker_runtime/command.rs`
- Modify: `scripts/tests/task-artifact-transaction-contract.test.mjs`

- [x] Add RED tests that expect desktop contract version `5`, retry target `dissection`, nullable
  terminal field `dissection`, artifact keys `dissection`/`dissection_md`, fixed paths, exact report
  schemas, and the versioned call-plan constants. Run:

  ```powershell
  uv run pytest worker\tests\test_contract.py worker\tests\test_models.py worker\tests\test_requests.py -q
  npm --prefix app test -- desktopWorkerContract.test.ts
  cargo test --manifest-path app/src-tauri/Cargo.toml desktop_worker_contract
  node --test scripts/tests/task-artifact-transaction-contract.test.mjs
  ```

  Expected: new assertions fail because version 4 and the old closed sets are still present.

- [x] Change the JSON contract first, then mirror it exactly. Keep the retry wire request limited to
  `task_id`, `target`, and `output_language`; do not accept transcript text, a path, preferences, or a
  call count from the frontend.
- [x] Define Python targets exactly as:

  ```python
  RetryInsightTarget = Literal["summary", "insights", "dissection"]
  InsightGenerationTarget = Literal["all", "summary", "insights", "dissection"]
  ```

- [x] Add the nullable structured `dissection` field to every exact terminal result constructor and
  decoder. Unknown terminal fields and artifact keys must continue to fail.
- [x] Re-run the focused commands and require PASS. Commit only this coherent contract slice:

  ```powershell
  git add contracts worker/frameq_worker/desktop_contract.py worker/frameq_worker/models.py worker/frameq_worker/requests.py worker/tests app/src/desktopWorkerProtocol.ts app/src/desktopWorkerContract.test.ts app/src-tauri/src/lib.rs app/src-tauri/src/worker_runtime/command.rs scripts/tests
  git commit -m "feat: define transcript dissection contract"
  ```

### Task 2: Build Deterministic Chunks, Call Planning, Generation, and Strict Validation

**Files:**

- Modify: `worker/frameq_worker/insightflow/splitter.py`
- Create: `worker/frameq_worker/insightflow/dissection.py`
- Modify: `worker/frameq_worker/insightflow/prompt.py`
- Modify: `worker/frameq_worker/insightflow/__init__.py`
- Create: `worker/frameq_worker/pipeline_runtime/dissection.py`
- Modify: `worker/frameq_worker/pipeline_runtime/insights.py`
- Create: `worker/tests/test_dissection.py`
- Modify: `worker/tests/test_insights.py`
- Modify: `worker/tests/test_llm.py`
- Modify: `worker/tests/test_output_language.py`

- [x] Write RED splitter tests for stable IDs, 2,000-character limits, contiguous UTF-8 byte ranges,
  emoji/CJK boundaries, whole-transcript SHA-256, per-slice SHA-256, and exact reconstruction.
- [x] Extend the immutable chunk value with provenance while preserving existing consumers:

  ```python
  @dataclass(frozen=True)
  class MarkdownChunk:
      id: int
      summary: str
      content: str
      start_byte: int
      end_byte: int
      sha256: str
  ```

- [x] Write RED call-plan tests for chunk counts 1, 4, 5, 16, 17, and empty input. Assert bounds
  `2..3`, `2..3`, `3..4`, `5..6`; reject 17 chunks before any checkout. Use the same fixed corpus
  in Python and TypeScript tests so a contract-version, splitter, chunk-count, or bound drift fails
  CI before release.
- [x] Implement one pure `build_dissection_call_plan()` using the contract constants. Group at most
  four consecutive chunks per map call, make exactly one reduce call, and reserve no more than one
  repair call. Check cancellation before each checkout and after each supplier response.
- [x] Write strict parser tests for the complete schema, exact keys, bounded arrays, enums, ordered
  references, valid quotations, output language, hashes, ranges, and one-repair behavior. Include
  malicious HTML, prompt-like unknown fields, source IDs outside the snapshot, and duplicate IDs.
- [x] Implement `dissection.py` as pure domain types, parsing, validation, and Markdown projection.
  Keep raw supplier responses, prompts, transcript text, and internal summaries out of returned
  errors, progress, logs, and artifacts.
- [x] Implement map prompts that receive only their assigned transcript chunks and reduce/repair
  prompts that receive only the minimum structured intermediate data needed. Do not include video,
  audio, source URL, local paths, preferences, summary, insights, draft, or an older dissection.
- [x] Make `pipeline_runtime/dissection.py` the orchestration owner. The existing insights module may
  dispatch the target but must not absorb the new schema and validation implementation.
- [x] Run and require PASS:

  ```powershell
  uv run pytest worker\tests\test_dissection.py worker\tests\test_insights.py worker\tests\test_llm.py worker\tests\test_output_language.py -q
  uv run ruff check worker
  ```

- [x] Commit the worker domain slice (`c4ce2b2`):

  ```powershell
  git add worker/frameq_worker/insightflow worker/frameq_worker/pipeline_runtime worker/tests
  git commit -m "feat: generate bounded transcript dissections"
  ```

### Task 3: Integrate Retry Execution and Atomic Task Artifacts

**Files:**

- Modify: `worker/frameq_worker/worker_application/insight_retry.py`
- Modify: `worker/frameq_worker/task_store.py`
- Modify: `worker/frameq_worker/task_transaction.py`
- Modify: `worker/frameq_worker/insightflow/artifact_storage.py`
- Modify: `worker/tests/test_task_artifacts.py`
- Modify: `worker/tests/test_task_transaction.py`
- Modify: `worker/tests/test_cli.py`
- Modify: `worker/tests/test_worker_application_boundaries.py`

- [x] Add RED application tests proving dissection reads only the validated official
  `transcript/transcript.txt`, accepts `completed` and `partial_completed`, rejects legacy,
  quarantined, missing, invalid, and empty transcripts, and does no checkout on admission failure.
- [x] Add `TaskPaths.dissection_json` and `TaskPaths.dissection_markdown`, map them to manifest keys
  `dissection` and `dissection_md`, and add both fixed paths to transaction allowlists. Do not add a
  `has_dissection`, path, count, or report body field to the manifest.
- [x] Pass both new files as `ProcessResult.artifact_payloads` into `TaskStoreFacade.finalize()` so
  the journal atomically promotes JSON, Markdown, and manifest. Never call a standalone report
  writer before finalization.
- [x] Add failure-injection tests at each transaction boundary. A cancelled, invalid, quota-failed,
  checkout-failed, or interrupted rerun must leave a previous successful JSON, Markdown, and
  manifest mapping byte-for-byte intact; a first failure leaves none of the three visible.
- [x] Ensure result reconstruction returns a parsed `dissection` only when the authoritative JSON
  exists and is valid. Corrupt JSON must not masquerade as a successful report.
- [x] Preserve the current preference behavior: only `insights` may save its preference snapshot;
  `dissection` receives no preference payload and mutates no preference artifact.
- [x] Run and require PASS:

  ```powershell
  uv run pytest worker\tests\test_task_artifacts.py worker\tests\test_task_transaction.py worker\tests\test_cli.py worker\tests\test_worker_application_boundaries.py worker\tests\test_dissection.py -q
  uv run ruff check worker
  ```

- [x] Commit the application/persistence slice (`5f29149`):

  ```powershell
  git add worker/frameq_worker worker/tests
  git commit -m "feat: commit dissection artifacts atomically"
  ```

### Task 4: Add Rust Decoding, Task Integrity, and History Recovery

**Files:**

- Modify: `app/src-tauri/src/worker_runtime/result_protocol.rs`
- Modify: `app/src-tauri/src/video_processing/retry_insights.rs`
- Modify: `app/src-tauri/src/video_processing/task_result.rs`
- Modify: `app/src-tauri/src/video_processing/url_processing.rs`
- Modify: `app/src-tauri/src/video_processing/local_media.rs`
- Modify: `app/src-tauri/src/video_processing/url_cache.rs`
- Modify: `app/src-tauri/src/task_manifest.rs`
- Modify: `app/src-tauri/src/task_manifest/schema.rs`
- Modify: `app/src-tauri/src/task_manifest/access.rs`
- Create: `app/src-tauri/src/task_manifest/dissection.rs`
- Modify: `app/src-tauri/src/task_manifest/tests.rs`
- Modify: `app/src-tauri/src/history.rs`
- Modify: `app/src-tauri/src/history_deletion.rs`

- [x] Add RED Rust tests for exact structured decoding, size/count limits, artifact keys, terminal
  fallback shape, retry target parsing, and the absence of dissection preference fields.
- [x] Add deny-unknown-fields Rust DTOs matching the contract. Apply field length, array length,
  enum, hash, range, and reference validation before a worker result crosses the command boundary.
- [x] Add `TaskArtifact::Dissection` and `TaskArtifact::DissectionMd` with only the fixed relative
  paths. Reuse all existing canonicalization, symlink, task-root, and regular-file checks.
- [x] Implement one task-manifest dissection capability that reads the official transcript bytes,
  verifies full SHA-256, validates every source range and slice SHA-256, and returns a safe report
  view plus `source_status: "current" | "stale"`. A stale report remains readable but exposes no
  enabled locators. A structurally corrupt declared artifact returns the existing fixed safe task
  error instead of partial content or parser diagnostics.
- [x] Invoke that capability after a successful dissection retry before returning to the frontend,
  and from history-detail loading. Keep history-list loading manifest-only.
- [x] Update every cached/synthetic terminal result to include `dissection: null`; restore a valid
  existing report only through supported task access, never by unvalidated path reads.
- [x] Extend history deletion tests so both fixed dissection files are deleted with the task and no
  path supplied from a report can expand deletion scope.
- [x] Run and require PASS:

  ```powershell
  cargo fmt --manifest-path app/src-tauri/Cargo.toml --check
  cargo test --manifest-path app/src-tauri/Cargo.toml result_protocol
  cargo test --manifest-path app/src-tauri/Cargo.toml retry_insights
  cargo test --manifest-path app/src-tauri/Cargo.toml task_manifest
  cargo test --manifest-path app/src-tauri/Cargo.toml history
  ```

- [x] Commit the Rust boundary slice (`473f58f`):

  ```powershell
  git add app/src-tauri/src
  git commit -m "feat: validate and restore dissection reports"
  ```

### Task 5: Extend Frontend Protocols, Workflow State, and History State

**Files:**

- Modify: `app/src/desktopWorkerProtocol.ts`
- Modify: `app/src/workerResultProtocol.ts`
- Modify: `app/src/workerResultProtocol.test.ts`
- Modify: `app/src/workerClient.ts`
- Modify: `app/src/workflowState.ts`
- Modify: `app/src/workflowState.test.ts`
- Modify: `app/src/taskWorkspaceViewModel.ts`
- Modify: `app/src/taskWorkspaceViewModel.test.ts`
- Modify: `app/src/taskArtifacts.ts`
- Modify: `app/src/historyClient.ts`
- Modify: `app/src/historyClient.test.ts`
- Modify: `app/src/features/history/useHistoryController.ts`
- Modify: `app/src/features/workflow/useTaskProcessingController.ts`
- Modify: `app/src/features/workflow/useTaskProcessingController.test.ts`
- Create: `app/src/features/dissection/dissectionCallPlan.ts`
- Create: `app/src/features/dissection/dissectionCallPlan.test.ts`

- [x] Add RED TypeScript tests for exact result/report parsing, artifact keys, the six-call admission
  boundary, mutual exclusion, target-local errors, retry restoration, history stale status, old-task
  compatibility, and preserving a previous report across failed/cancelled reruns.
- [x] Implement the preview calculator from contract constants, using the saved transcript and the
  same deterministic splitter rules. Freeze its `chunkCount`, lower/upper bounds, and output
  language only in the Task 6 confirmation UI state. The worker independently rereads the authoritative task
  transcript and recalculates; no preview evidence, transcript text, or local path enters worker
  stdin. If the transcript changed before worker admission, the worker's stricter current result
  controls and may reject before checkout.
- [x] Widen `InsightRetryTarget` only to `"summary" | "insights" | "dissection"`; do not add
  `draft`. Add `dissection` and `dissectionStale` to workflow/history state while preserving
  exact-null behavior for old terminal results.
- [x] On successful transcript save, retain the old report, mark it stale, and disable its source
  actions immediately. A successful dissection replacement clears stale. A failed or cancelled
  rerun changes neither the old report nor its prior stale status.
- [x] Keep one active AI target globally. Start/cancel/finish/error routing must attribute only to
  dissection and must not change summary, mindmap, insights, transcript, media, or preferences.
- [x] Run and require PASS (109 focused tests plus lint):

  ```powershell
  npm --prefix app test -- workerResultProtocol.test.ts workflowState.test.ts taskWorkspaceViewModel.test.ts historyClient.test.ts useTaskProcessingController.test.ts dissectionCallPlan.test.ts
  npm --prefix app run lint
  ```

- [x] Commit the frontend state slice (`5e671f6`):

  ```powershell
  git add app/src
  git commit -m "feat: model transcript dissection state"
  ```

### Task 6: Add Confirmation, Report UI, Stale Handling, Source Location, and i18n

**Files:**

- Create: `app/src/features/dissection/useTranscriptDissectionController.ts`
- Create: `app/src/features/dissection/useTranscriptDissectionController.test.ts`
- Create: `app/src/features/dissection/TranscriptDissectionConfirmationSheet.tsx`
- Create: `app/src/features/dissection/TranscriptDissectionConfirmationSheet.test.tsx`
- Create: `app/src/features/results/DissectionReport.tsx`
- Create: `app/src/features/results/DissectionReport.test.tsx`
- Modify: `app/src/features/results/AiGenerationWorkspace.tsx`
- Modify: `app/src/features/results/AiResultDetailSheet.tsx`
- Modify: `app/src/features/results/TaskWorkspaces.test.tsx`
- Create: `app/src/features/transcript/transcriptByteRange.ts`
- Create: `app/src/features/transcript/transcriptByteRange.test.ts`
- Modify: `app/src/features/transcript/useTranscriptDocumentController.ts`
- Modify: `app/src/features/transcript/useTranscriptDetailController.ts`
- Modify: `app/src/features/transcript/TranscriptReviewPanel.tsx`
- Modify: `app/src/features/transcript/transcriptControllerBoundary.test.ts`
- Modify: `app/src/i18n/synthesisResources.ts`
- Modify: `app/src/i18n/errorResources.ts`
- Modify: `app/src/App.tsx`
- Modify: `app/src/App.css`

- [x] Add RED controller/UI tests for eligibility, quiet disabled states, confirmation without charge,
  title/character/chunk/language/call range/quota/data disclosure, insufficient quota, over-limit
  transcript, generating/cancelling/error/retry, stale banner, report bounds, copy, file location,
  source location, keyboard use, narrow screens, and all three supported UI locales.
- [x] Create a focused dissection controller rather than putting source/report concerns into the
  insights-preference owner. It may call the existing retry workflow but must never read or save
  insight preferences.
- [x] Render dissection as the current third card after summary and insights. Keep the layout ready
  for the future order summary, insights, draft, dissection without rendering an inactive draft card.
- [x] Build the confirmation sheet from the frozen preview snapshot. The final Confirm action sends
  only task ID, target, and output language; closing the sheet starts no worker and performs no
  checkout.
- [x] Render report fields as structured escaped React content. Do not use raw HTML. Enforce display
  limits of at most 8 highlights and at most 6 strengths/weaknesses even though strict protocol
  decoding should already reject larger results.
- [x] Implement byte-range conversion in the transcript feature. It receives a Rust-validated
  `startByte`/`endByte`, converts UTF-8 offsets without splitting a code point, selects/scrolls the
  matching current transcript text, and exposes all cited chunks. It must not search for or map the
  splitter `id` through ASR segment IDs.
- [x] Disable locator controls whenever Rust returns stale or the current session has saved a changed
  transcript. Preserve View, Copy, Locate File, and Redissection actions.
- [x] Add complete `zh-CN`, `zh-TW`, and `en-US` copy, including truthful supplier disclosure,
  non-refundable completed calls, stale warning, fixed safe failures, and call range formatting.
- [x] Run and require PASS (663 full frontend tests, lint, and production build):

  ```powershell
  npm --prefix app test -- useTranscriptDissectionController.test.ts TranscriptDissectionConfirmationSheet.test.tsx DissectionReport.test.tsx transcriptByteRange.test.ts transcriptControllerBoundary.test.ts TaskWorkspaces.test.tsx
  npm --prefix app run lint
  npm --prefix app run build
  ```

- [x] Commit the UI slice (`f516a19`):

  ```powershell
  git add app/src
  git commit -m "feat: add transcript dissection workspace"
  ```

### Task 7: Prove Integrated Quota, Cancellation, Privacy, Compatibility, and Packaging

**Files:**

- Modify: `worker/tests/test_dissection.py`
- Modify: `worker/tests/test_llm.py`
- Modify: `worker/tests/test_cli.py`
- Modify: `app/src-tauri/src/video_processing/retry_insights.rs`
- Modify: `app/tests/support/mockTauriBridge.ts`
- Modify: `app/tests/app-input.browser.test.ts`
- Modify: relevant `scripts/tests/*.test.mjs`

- [x] Add an integrated fake-supplier test for 1, 4, 5, and 16 chunks. Assert the exact map/reduce
  call sequence, checkout count, one optional repair, hard stop at six, and no checkout for an
  over-limit authoritative transcript, including one changed after the confirmation preview.
- [x] Test cancellation before the first checkout and between every subsequent call. Completed
  checkouts remain consumed; unstarted calls are absent; no partial artifact is committed.
- [x] Capture fake server and supplier payloads. Assert the FrameQ server receives only account,
  entitlement, quota, and checkout data; the supplier receives only required transcript-derived
  content; neither receives video/audio bytes, URL, absolute paths, preferences, other AI results,
  the final report, or secrets in logs/errors/progress.
- [x] Add browser coverage from a completed transcript through confirmation, generation, report,
  source location, transcript edit, stale state, failed redissection, successful replacement, app
  reload/history restoration, and deletion.
- [x] Prove old tasks with no dissection keys load normally, and summary/insights retry behavior and
  existing exact protocol rejection tests remain unchanged.
- [x] Verify packaged-worker contract generation includes the version-5 result shape and new Python
  modules without bundling any model, key, user configuration, transcript, or report fixture.
- [x] Run and require PASS (661 worker tests passed / 2 platform skips; 664 frontend tests passed;
  233 Rust tests passed after Task 4 with no subsequent Rust changes; 29 script tests, Ruff, TypeScript
  lint, Cargo fmt, and the production frontend build passed):

  ```powershell
  uv run pytest worker\tests -q
  uv run ruff check worker
  cargo test --manifest-path app/src-tauri/Cargo.toml
  cargo fmt --manifest-path app/src-tauri/Cargo.toml --check
  npm --prefix app test
  npm --prefix app run lint
  npm --prefix app run build
  node --test scripts/tests/*.test.mjs
  ```

- [x] Commit the integration slice (`3935c71`):

  ```powershell
  git add worker app scripts contracts
  git commit -m "test: verify transcript dissection boundaries"
  ```

### Task 8: Run Completion Gates, Update Durable Docs, and Archive

**Files:**

- Modify: `TASKS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DESIGN.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/2026-07-31-transcript-dissection-feature.md`
- Modify: `docs/product-specs/2026-07-31-transcript-dissection.md`
- Modify: `docs/exec-plans/active/index.md`
- Move after all gates pass: this file to
  `docs/exec-plans/completed/2026-07-31-transcript-dissection-plan.md`
- Modify: `docs/exec-plans/completed/index.md`

- [x] Update architecture ownership, UI behavior, privacy/data-flow rules, fixed artifacts, contract
  version, and task status. Record implementation deviations in the durable design before changing
  its status to implemented.
- [x] Run the complete validation matrix below from a clean command invocation. Do not mark a row
  complete from an earlier or partial run.
- [x] Manually inspect `git diff`, built resources, logs, errors, and fixtures for transcript/report
  content, URLs, local absolute paths, tokens, keys, and bundled private configuration.
- [x] Cover short Chinese, emoji-containing, English, 16-chunk, 17-chunk rejection, insufficient
  quota, cancellation after checkout, stale edit, restart/history, and legacy-no-dissection flows
  with deterministic worker/browser automation; record live supplier and physical native packaged
  UX as release residuals rather than claiming manual evidence.
- [x] Update Progress, Surprises & Discoveries, Decision Log, Outcomes & Retrospective, validation
  evidence, and residual risks. Archive only when all required automated gates pass and external
  manual evidence is either complete or explicitly recorded as a release residual.
- [x] Commit governance closure:

  ```powershell
  git add TASKS.md docs
  git commit -m "docs: close transcript dissection plan"
  ```

## Validation Matrix

| Gate | Command | Required result |
|---|---|---|
| Contract/Python | `uv run pytest worker\tests -q` | All tests pass; only documented pre-existing skips |
| Python lint | `uv run ruff check worker` | Exit 0 |
| Rust behavior | `cargo test --manifest-path app/src-tauri/Cargo.toml` | All tests pass |
| Rust format | `cargo fmt --manifest-path app/src-tauri/Cargo.toml --check` | Exit 0 |
| Frontend behavior | `npm --prefix app test` | All tests pass |
| Frontend lint | `npm --prefix app run lint` | Exit 0 |
| Frontend production build | `npm --prefix app run build` | Exit 0 |
| Packaging/contracts | `node --test scripts/tests/*.test.mjs` | All tests pass |
| Governance | `python scripts/validate_agents_docs.py --level WARN` | No WARN/ERROR violations attributable to this change |
| Patch hygiene | `git diff --check` | Exit 0 |

Task 8 actual results: worker 661 passed / 2 platform skips; Ruff exit 0; Rust 233 passed; rustfmt
exit 0; frontend 664 passed; lint/build exit 0; scripts 29 passed; governance 0 WARN/ERROR; diff
check exit 0. Rust child-process termination tests require normal Windows process permissions and
passed there; their managed-sandbox failure is not recorded as product evidence.

## Manual Acceptance Checklist

- [ ] The card is independent, never auto-runs, and appears third while draft is unimplemented.
- [ ] Confirmation shows exact input facts, frozen locale, bounded calls, quota, and data disclosure.
- [ ] More than six possible calls or insufficient worst-case quota starts no worker and no checkout.
- [ ] Server payloads contain no transcript/prompt/report; supplier payloads contain no unrelated
  task data; logs and safe errors disclose no private content.
- [ ] A valid report covers every specified dimension and all source actions use verified ranges.
- [ ] Editing and saving the transcript retains the report, marks it stale, and disables location.
- [ ] A cancelled or failed rerun retains the entire former successful version; success atomically
  replaces JSON, Markdown, and manifest references.
- [ ] Restart and history detail restore valid/current versus stale state correctly; old tasks remain
  readable; deletion removes both fixed artifacts.
- [ ] Summary, mindmap, insights, transcript editing, playback, URL processing, and local-media
  processing show no regression.

## Rollback, Recovery, and Idempotence

- Contract version 5 is a coordinated change. If one language layer cannot be completed, revert the
  entire version-5 slice; do not leave permissive dual decoding or a partially widened exact set.
- Re-running a dissection is idempotent with respect to paths: it always targets the two fixed files.
  Only `TaskStoreFacade.finalize()` may replace them and their manifest mappings.
- Task journal recovery must either expose the complete prior version or the complete new version.
  Tests must cover interruption before staging, during promotion, and before manifest replacement.
- A stale or corrupt report is never repaired in place during read. Stale remains viewable without
  locators; corrupt is rejected safely. A new explicit dissection is the only recovery path.
- No migration scans or rewrites old tasks. Absence of the new artifact keys means the feature has no
  result for that task.

## Scope Exclusions and Residual Risks

- No video-frame, scene, editing, audio, voice, speaker-identity, fact-checking, batch comparison,
  custom prompt, or cross-task analysis is included.
- No server API or server persistence change is planned because existing checkout already charges
  each supplier call. A server change discovered during implementation requires product/design and
  this ExecPlan to be amended before code proceeds.
- Supplier output quality remains probabilistic even with strict structural validation. Acceptance
  proves schema, provenance, limits, and safe failure—not subjective editorial correctness.
- Frontend call preview duplicates deterministic splitting logic for admission UX. Contract-version,
  chunk-count, and bound mismatch tests are mandatory safeguards against drift; the worker remains
  authoritative and must reject before checkout.
- Release evidence must explicitly distinguish automated fake-supplier coverage from any live
  supplier/quota test. No live paid call is required unless separately authorized.
- Live paid-supplier/quota behavior and physical native packaged UI checks on every supported
  platform were not run in this implementation session. Release owners must perform or explicitly
  waive those checks before claiming live-provider or cross-platform manual acceptance.
