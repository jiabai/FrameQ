# Task Artifact Destination Contract Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision
> Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

> **Archive note.** This plan was written *after* the implementation landed on 2026-10-27. The
> change started from a P0 defect triage (the "two hand-aligned Python whitelists" item) and grew
> once the drift turned out to be cross-language and security-relevant, which per `WORKFLOW.md`
> should have gone through a spec and an ExecPlan first. The sequence is recorded honestly below
> so a reviewer can see which evidence existed before each decision and which was only gathered
> afterwards.

**Goal:** Make the task-artifact transaction's closed destination set one source of truth shared
by the worker and the desktop, and stop the two languages from silently rejecting each other's
journals.

**Architecture:** `contracts/task-artifact-transaction-v1.json` becomes the reference for the
closed destination set (`allowedDestinations`, `internalParents`, `artifactKeysByDestination`,
`nonArtifactDestinations`). `worker/frameq_worker/task_transaction.py` owns the Python literal
(`ARTIFACT_KEY_BY_RELATIVE_PATH`) and derives `_ALLOWED_DESTINATIONS` and `_INTERNAL_PARENTS`
from it; `worker/frameq_worker/task_store.py` imports that mapping instead of keeping its own
copy. `app/src-tauri/src/task_manifest/transaction.rs` keeps its literal arrays as a mirror and
gains `INTERNAL_PARENTS` as a named constant. Each language asserts set equality against the
contract in its own test suite, and `scripts/tests/task-artifact-transaction-contract.test.mjs`
keeps the contract internally self-consistent and compares all three literal tables.

**Languages and tools:** Python 3 (pytest, Ruff), Rust (cargo test), Node (node:test). No
server, frontend, or packaging change.

---

## Purpose / Big Picture

The worker writes the task journal; the desktop recovers it. Both sides validate every journal
entry against a closed set of task-relative destinations, and that set had quietly become six
hand-maintained copies:

| Copy | Location | Before |
| --- | --- | --- |
| Contract (nominally the source of truth) | `contracts/task-artifact-transaction-v1.json:41` | 10 |
| Python allowlist | `worker/frameq_worker/task_transaction.py:35` | 12 |
| Python internal parents | same file `:50` | 4 |
| Python artifact-key mapping | `worker/frameq_worker/task_store.py:606` | 9 |
| Rust allowlist | `app/src-tauri/src/task_manifest/transaction.rs:18` | 12 |
| Rust internal parents | same file `:392`, inlined in the cleanup loop | 4 |

The worker and the desktop had each grown two destinations the other did not know about: Rust
knew `ai/draft.md` and `ai/original/draft.md`, Python knew `ai/dissection.json` and
`ai/dissection.md`, and the contract knew neither pair.

A user only sees this when the worker crashes mid-commit. On the happy path
`commit_task_artifacts` removes its journal at the end, so the desktop never has to recover one
containing dissection. After a crash the journal survives, and
`SupportedTask::open` / `SupportedTask::scan` (`app/src-tauri/src/task_manifest/access.rs:54,93`)
call `recover_task_artifacts` before trusting any artifact. `allowed_destination` rejects
`ai/dissection.json`, recovery returns `Err`, and `scan` funnels that into
`Err(_) => ignored_count += 1` — the task disappears from History with no prompt and no error
surface. Opening the same task directly fails with the closed recovery error instead.

After this change both languages accept the same 14 destinations, the contract pins all three
tables, and a one-sided edit fails three independent test suites.

## Progress

- [x] 2026-10-27: Counted every hand-maintained destination list and diffed the Python, Rust,
  and contract literals; found six copies and a two-entry drift on each side. Validation: regex
  extraction over `contracts/task-artifact-transaction-v1.json`,
  `worker/frameq_worker/task_transaction.py`,
  `worker/frameq_worker/task_store.py`, and
  `app/src-tauri/src/task_manifest/transaction.rs` reporting
  `rust-only: ['ai/draft.md', 'ai/original/draft.md']` and
  `py-only: ['ai/dissection.json', 'ai/dissection.md']`.
- [x] 2026-10-27: Confirmed the user-visible failure path by reading
  `app/src-tauri/src/task_manifest/access.rs:51-104` and
  `app/src-tauri/src/task_manifest/transaction.rs:496-498`, and confirmed the worker really
  commits dissection through the transaction at
  `worker/frameq_worker/pipeline_runtime/insights.py:205-225`. Validation: source read; the
  journal is only left behind after a crash because `commit_task_artifacts` ends with
  `_remove_journal_then_cleanup`.
- [x] 2026-10-27: Recorded that the existing guard was green while the sets disagreed. Validation:
  `node --test scripts/tests/task-artifact-transaction-contract.test.mjs` reported `pass 1 /
  fail 0` in the drifted state.
- [x] 2026-10-27: Extended the contract to 14 destinations and added `internalParents`,
  `artifactKeysByDestination`, and `nonArtifactDestinations`. Validation: file read back; the
  four tables reproduce each other exactly.
- [x] 2026-10-27: Moved the Python artifact-key mapping into `task_transaction.py` as
  `ARTIFACT_KEY_BY_RELATIVE_PATH` and derived `_ALLOWED_DESTINATIONS` and `_INTERNAL_PARENTS`
  from it; `task_store.py` now imports it. Validation: `uv run ruff check worker` clean and the
  new identity assertion `task_store.ARTIFACT_KEY_BY_RELATIVE_PATH is
  task_transaction.ARTIFACT_KEY_BY_RELATIVE_PATH` passing.
- [x] 2026-10-27: Widened the Rust allowlist to 14, extracted `INTERNAL_PARENTS` as a constant,
  and switched its root sentinel from `""` to `"."` so all three sources use one representation.
  Validation: `cargo test --manifest-path app/src-tauri/Cargo.toml` and a named-filter run of
  `dissection_journal`.
- [x] 2026-10-27: Replaced the one-way substring guard with bidirectional set equality, and added
  native equality assertions in `worker/tests/test_task_transaction.py` and
  `app/src-tauri/src/task_manifest/tests.rs`. Validation: both suites red on introduced drift,
  green after restore.
- [x] 2026-10-27: Added behavioural regression on both sides — the desktop recovers a worker
  journal carrying dissection (`prepared_dissection_journal_written_by_the_worker_is_recovered`)
  and the worker accepts the draft destinations (`test_commit_accepts_draft_destinations`).
  Validation: the Rust test panics at `tests.rs:100` (the recovery `.expect`) when
  `ai/dissection.*` is removed from `ALLOWED_DESTINATIONS`.
- [x] 2026-10-27: Recorded the cross-language invariant in `docs/SECURITY.md`. Validation: diff
  reviewed against the existing journal-recovery bullets at `docs/SECURITY.md:190-198`.

## Surprises & Discoveries

- Evidence: the mirror guard was `assert.ok(python.includes(value))` /
  `assert.ok(rust.includes(value))` — a one-way substring containment check. It only asserted
  "everything in the contract appears in each implementation", never the reverse, so each side
  could carry two extra destinations and the test still passed. This is why the drift survived;
  the guard was structurally incapable of catching it.
- Evidence: `contracts/task-artifact-transaction-v1.json` is read only by tests —
  `worker/tests/test_task_transaction.py:333`,
  `app/src-tauri/src/task_manifest/tests.rs:19`, and
  `scripts/tests/task-artifact-transaction-contract.test.mjs:15`. No runtime code loads it, so
  the contract being "the source of truth" was a convention, not a mechanism.
- Evidence: the Rust internal-parent list was inlined as
  `for relative in ["", "transcript", "transcript/original", "ai"]` at
  `app/src-tauri/src/task_manifest/transaction.rs:392`, missing `ai/original`, while the Python
  equivalent missed the same directory. Neither language's orphan cleanup would have reached
  staging files under `ai/original/` once draft commits through the transaction.
- Evidence: the root-relative parent had three representations — `PurePosixPath(".")` in Python,
  `""` in Rust, and `"."` in the contract. Unifying on `"."` touched a Rust branch
  (`relative.is_empty()` became `relative == "."`), which is the only behavioural edit in the
  Rust file.
- Evidence: `task_store.py` already imported `task_transaction`, so putting the shared mapping in
  `task_transaction.py` avoids a cycle; putting it in `task_store.py` would have created one.
- Evidence: `ai/draft.md` already had a manifest artifact key — `test_draft_manifest.py:139`
  asserts `artifacts["draft"] == "ai/draft.md"` — so adding it to `artifactKeysByDestination`
  records existing behaviour rather than inventing a key.
- Evidence: `worker_runtime::runner::tests::watchdog::validated_progress_resets_idle_activity_until_normal_completion`
  and `endless_validated_progress_cannot_extend_the_absolute_deadline` fail intermittently when
  the cargo suite runs in parallel, and pass under `--test-threads=1` or when filtered by name.
  They live in `worker_runtime/runner/tests/watchdog.rs` and are unrelated to `task_manifest`.

## Decision Log

- **Decision:** the contract file stays canonical but is still not loaded at runtime. **Rationale:**
  reading a JSON contract from the packaged worker and the installed desktop adds a packaged-file
  dependency and a new failure mode to a crash-recovery path, which is the one place that must
  stay dependency-free. Set equality enforced by each language's own test suite gives the same
  guarantee without touching runtime behaviour. **Date/Author:** 2026-10-27, User + Codex.
- **Decision:** each language asserts equality in its own native tests, and the shared mjs test
  asserts the contract's internal consistency plus the three literal tables. **Rationale:** the
  mjs test was the only file seeing all three sources, yet its substring check is what let the
  drift through; native tests compare real values instead of source text, and the mjs test keeps
  the contract self-consistent so no fourth list can appear inside it. **Date/Author:**
  2026-10-27, User + Codex.
- **Decision:** the Python tables are derived, not listed twice. **Rationale:**
  `_ALLOWED_DESTINATIONS` and `_INTERNAL_PARENTS` are pure functions of
  `ARTIFACT_KEY_BY_RELATIVE_PATH` and `_NON_ARTIFACT_DESTINATIONS`, so the Python side now has
  one literal per concept — the mapping — and two derived views. Adding a destination inside
  Python is now a one-line change. **Date/Author:** 2026-10-27, User + Codex.
- **Decision:** the union (14 destinations) is the correct target, not either existing list.
  **Rationale:** both sides were already writing their respective pairs — dissection through
  `insights.py:220-221`, draft through the Rust draft path — and `README.md:92-93` documents all
  four as real outputs. Narrowing either language would break a path that currently works; the
  entries remain a closed set of known-good relative paths under the task directory, so widening
  adds no traversal surface. **Date/Author:** 2026-10-27, User + Codex.
- **Decision:** add `ai/draft.md` to the artifact-key mapping even though draft still writes
  directly. **Rationale:** the key `draft` already exists in the manifest, and leaving the
  mapping incomplete would make the future move of draft onto the transaction path fail with
  `TaskArtifactCommitError` from `_artifacts_after_payloads`. No caller changes today.
  **Date/Author:** 2026-10-27, User + Codex.
- **Decision:** no product spec was created. **Rationale:** the change fixes a defect and
  restores an invariant the repository already documents; it introduces no new user-visible
  behaviour, stage, or surface. The invariant was added to `docs/SECURITY.md` instead.
  **Date/Author:** 2026-10-27, User + Codex.

## Outcomes & Retrospective

Validation, all run on 2026-10-27 against the final tree:

- `uv run ruff check worker` — All checks passed.
- `uv run pytest worker/tests` — 1127 passed, 3 skipped.
- `cargo test --manifest-path app/src-tauri/Cargo.toml -- --test-threads=1` — 345 passed,
  0 failed (344 before this plan's new test).
- `npm --prefix app test` — 83/83 files, 859 passed.
- `node --test scripts/tests/task-artifact-transaction-contract.test.mjs` — 2 pass / 0 fail
  (was 1 pass / 0 fail while the sets disagreed).
- `node --test scripts/tests/*.test.mjs` — 49 pass / 2 fail, both pre-existing and unrelated
  (see residual risk).

Red-then-green evidence for the new guards: removing `ai/draft.md` from the Python mapping made
`test_closed_destinations_match_shared_contract` fail and removing `ai/dissection.*` from the
Rust array made `prepared_dissection_journal_written_by_the_worker_is_recovered` panic at
`tests.rs:100`; both were green again after restore.

Delivered behaviour: the desktop now recovers a worker journal that carries dissection artifacts
instead of dropping the task from History, the worker accepts the draft destinations through the
transaction, and a one-sided destination edit breaks three test suites.

Residual risk: `scripts/tests/*.test.mjs` is not wired into CI (`.github/workflows/` never
references it and there is no root `package.json`); the guard is only run by hand, which is the
same gap that let this drift survive. The two watchdog timing tests still fail intermittently
under parallel `cargo test`. `transcript/original/transcript.txt` and
`transcript/original/transcript.md` remain allowlisted with no writer anywhere in the tree —
they were left in place rather than removed, since pruning an allowlist entry is a separate
behaviour change. Draft generation still writes directly through
`worker/frameq_worker/worker_application/insight_retry.py:333` instead of the transaction; that
path's precondition is now in place but the move itself is still outstanding.

## Context and Orientation

- Contract: `contracts/task-artifact-transaction-v1.json`
- Worker (Python): `worker/frameq_worker/task_transaction.py` (owner of the shared mapping),
  `worker/frameq_worker/task_store.py` (consumer),
  `worker/frameq_worker/pipeline_runtime/insights.py` (dissection commit payloads),
  `worker/frameq_worker/worker_application/insight_retry.py` (draft direct write, unchanged)
- Desktop (Rust): `app/src-tauri/src/task_manifest/transaction.rs`,
  `app/src-tauri/src/task_manifest/access.rs` (recovery on open/scan),
  `app/src-tauri/src/task_manifest/tests.rs`
- Guards: `scripts/tests/task-artifact-transaction-contract.test.mjs`,
  `worker/tests/test_task_transaction.py`
- Docs: `docs/SECURITY.md` (journal-recovery boundary), `docs/exec-plans/index.md`
- Out of scope: the sibling P0 fix from the same session (`worker/frameq_worker/llm.py` raising
  a bare `RuntimeError` past `ai_runtime.py`'s `except InsightGenerationError`) touches no
  contract or destination table and is not covered by this plan.

## Plan of Work

1. Inventory every destination list and diff the three sources. *(done)*
2. Confirm the failure path through `access.rs` recovery. *(done)*
3. Record that the existing guard passes while the sets disagree. *(done)*
4. Extend the contract to the union and pin all four tables. *(done)*
5. Derive the Python tables from one mapping; make `task_store` consume it. *(done)*
6. Mirror in Rust and unify the root-parent representation. *(done)*
7. Replace the substring guard with bidirectional set equality in all three suites. *(done)*
8. Add behavioural regressions on both sides. *(done)*
9. Record the invariant in `docs/SECURITY.md`. *(done)*
10. Run every gate and archive. *(done)*

## Validation and Acceptance

- `uv run ruff check worker`
- `uv run pytest worker/tests`
- `cargo test --manifest-path app/src-tauri/Cargo.toml` (use `-- --test-threads=1` if the two
  watchdog timing tests fail under parallel execution)
- `npm --prefix app test`
- `node --test scripts/tests/*.test.mjs`
- `uv run python scripts/validate_agents_docs.py --level WARN`
- Manual regression: start a dissection task, kill the worker process mid-commit to leave a
  journal behind, restart the desktop, and confirm the task still appears in History and opens.
