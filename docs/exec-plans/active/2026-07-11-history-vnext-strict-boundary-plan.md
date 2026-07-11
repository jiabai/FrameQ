# History vNext Strict Boundary ExecPlan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
> Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Replace legacy-compatible history with a strict current-task library. History opens quickly from
safe schema v3 manifests, loads full content only after a user selects one supported task, and
never starts Python or mutates unsupported legacy directories. Users retain physical custody of
old files but FrameQ does not display, migrate, reuse, edit, retry, or delete them.

## Progress

- [x] 2026-07-11: Read governance, source-identity/history specs, active/completed plans,
  architecture, security, debt, and current dirty History UI diff. Validation: targeted `rg`,
  `git status --short`, and source inspection.
- [x] 2026-07-11: Recorded the strict vNext product/security/architecture decision and withdrew
  automatic legacy migration direction. Validation: `python scripts/validate_agents_docs.py
  --level WARN` before implementation.
- [x] 2026-07-11: Added failing Rust/TypeScript/Python tests for strict eligibility, list/detail DTO
  separation, no worker spawn, stale detail ordering, and legacy rejection. Validation: focused
  Rust failed on legacy acceptance/artifact traversal, Vitest failed because detail API was absent,
  and pytest failed because migration CLI still executed.
- [x] 2026-07-11: Implemented the strict task predicate, Rust list/detail commands, controller
  sequencing, and complete Rust/Python migration-path removal. Validation: Cargo 90/90, app
  216/216, worker 217/217, and ruff passed.
- [x] 2026-07-11: Ran leakage probes, temporary-directory counts/timing, and complete project
  gates without mutating outputs/cache. Validation: controlled probe reported supported=1,
  ignored=1, list=1.687ms, selected large detail=12.094ms. A read-only manifest probe against
  the configured workspace output root reported supported=0, ignored=0, list=0.076ms; all
  commands below passed.
- [x] 2026-07-11: Cross-change native acceptance opened the real app-local history repeatedly
  through fresh-worker Tauri dev. The current strict reader reported supported=5, ignored=1,
  list=1-7ms and selected detail=4-37ms; no Python worker process was created and the ignored
  legacy task never appeared. Source/packaged worker parity was 26/26 files with zero SHA-256
  mismatches.

## Surprises & Discoveries

- Evidence: `app/src-tauri/src/history.rs` currently invokes a Python migration worker and reads
  transcript, summary, and insights for every list row.
- Evidence: `app/src-tauri/src/video_processing.rs` and `transcript_detail.rs` invoke migration
  before cache/history-adjacent product reads; `worker_command.rs` exposes
  `WorkerInvocation::MigrateSourceData`.
- Evidence: initial inspection found an executable migration chain and compatibility readers in
  `worker/frameq_worker/cli.py`, `worker_service.py`, `task_store.py`, and
  `source_identity.py`; production `rg` now finds none of those migration symbols.
- Evidence: the current dirty worktree contains six History card layout/test/design files. This
  plan must preserve those edits and avoid conflating layout with the new data contract.
- Evidence: initial migration removal reduced worker collection from 249 to 217, but adversarial
  review found 13 non-migration SourceIdentity cases had also been compressed away. Those cases
  were restored. The final 230-vs-249 net reduction is exactly 19 tests: 21 obsolete migration
  execution/mutation cases removed and two strict non-migration replacements added. Canonical
  platform variants, short-link revalidation, transient download URL, strict manifest/link
  rejection, retry, stdin, prompt, and persistence coverage all run in the final suite.
- Evidence: a temporary probe with roughly 1.8MB of selected transcript/summary data confirmed
  the list response contains only manifest preview/summary fields and does not contain artifact
  body sentinels.

## Decision Log

- Decision: Accept only exact schema v3 plus the current privacy marker and a present canonical
  SourceIdentity. Rationale: current-safe provenance must be proven rather than inferred from old
  fields. Date/Author: 2026-07-11 / User + Codex.
- Decision: Keep unsupported legacy directories byte-for-byte untouched and product-isolated.
  Rationale: automatic repair can expose or duplicate sensitive data, while deletion would exceed
  product authority. Date/Author: 2026-07-11 / User + Codex.
- Decision: Split manifest-only list from selected-task detail. Rationale: list latency and privacy
  should not scale with artifact size, and one click should authorize reading only one supported
  task. Date/Author: 2026-07-11 / User + Codex.
- Decision: Sequence detail requests in `useHistoryController` and install only through
  `useTaskProcessingController`. Rationale: IPC ordering must not bypass the existing operation-id
  task ownership boundary. Date/Author: 2026-07-11 / Codex.

## Outcomes & Retrospective

History vNext now lists only current safe schema v3 manifests in Rust, loads one selected detail on
demand, sequences stale detail responses, and rejects old tasks across cache/transcript/retry.
Tauri and Python no longer contain a migration invocation or CLI mode. Cross-change gates passed:
Cargo 92, app 230 plus production build, worker 230 plus ruff, server 57 plus build, scripts 9, docs,
and diff checks. Native fresh-worker acceptance confirmed five supported and one ignored app-local
task with no Python process on list/detail. Residual risk: unsupported physical legacy directories may retain sensitive
content until the user backs them up or deletes them manually; FrameQ deliberately provides no
automatic scanner or cleanup path.

## Context and Orientation

- Product/security: `docs/product-specs/2026-07-11-history-vnext-strict-boundary.md`,
  `docs/product-specs/2026-07-10-source-url-privacy-boundary.md`, `docs/SECURITY.md`.
- Rust manifest/history: `app/src-tauri/src/task_manifest.rs`, `history.rs`,
  `transcript_detail.rs`, `video_processing.rs`, `worker_command.rs`, `lib.rs`.
- Frontend: `app/src/historyClient.ts`, `features/history/useHistoryController.ts`,
  `features/workflow/useTaskProcessingController.ts`, `App.tsx`, and their tests.
- Python removal boundary: `worker/frameq_worker/cli.py`, `worker_service.py`, `task_store.py`,
  `source_identity.py`, and worker tests.
- Existing unrelated dirty UI work: `app/src/App.css`, `App.css.test.ts`,
  `features/history/HistorySheet.tsx`, `HistorySheet.test.tsx`,
  `tests/app-input.browser.test.ts`, `docs/DESIGN.md`.

## Plan of Work

1. Write Rust failures proving list ignores v1/v2, missing marker, quarantine, corruption, invalid
   SourceIdentity, and links; list returns manifest-only DTOs even with missing/large artifacts;
   detail reads exactly one selected current task.
2. Write command-spec failures proving migration invocation no longer exists and repeated history
   listing has no worker dependency. Add strict cache/transcript/retry legacy rejection tests.
3. Write TypeScript failures for list/detail DTO separation, latest-selection sequencing, active
   workflow rejection, and stale response isolation.
4. Write Python failures that remove the migration CLI and require strict current manifests before
   retry/task-context reads.
5. Implement one strict Rust manifest eligibility predicate and use it before all product reads.
   Split `get_history` and `get_history_detail` without artifact reads in the list path.
6. Update the frontend client/controller contract so selection awaits the latest detail and only
   then forwards a complete task to the workflow controller.
7. Delete Rust and Python migration invocations, CLI mode, compatibility helpers, and tests whose
   only purpose was automatic legacy mutation. Preserve current-task SourceIdentity creation.
8. Run temporary-directory leakage/count/timing probes and full gates; update this plan's progress,
   discoveries, outcomes, and validation evidence.

## Validation and Acceptance

- `cargo test --manifest-path app\src-tauri\Cargo.toml`
- `npm --prefix app test`
- `npm --prefix app run build`
- `uv run pytest worker\tests`
- `uv run ruff check worker`
- `npm --prefix server test`
- `npm --prefix server run build`
- `node --test scripts\tests\*.test.mjs`
- `python scripts\validate_agents_docs.py --level WARN`
- `git diff --check`
- `git status --short`

All filesystem fixtures must use temporary roots. Final evidence reports supported and ignored
counts plus list/detail elapsed time without printing ignored task ids, paths, URLs, or fields.
