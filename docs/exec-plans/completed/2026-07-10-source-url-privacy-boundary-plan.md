# Source URL Privacy Boundary Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Users can keep submitting public platform links that require transient query parameters,
while FrameQ persists and displays only a stable canonical source identity. Cloud AI uses
only the official saved transcript text, including user edits, so URL metadata cannot
enter prompts through `transcript.md`.

## Progress

- [x] 2026-07-10: Read `AGENTS.md`, `WORKFLOW.md`, architecture, security, design, core beliefs, the active ExecPlans, and related product specs; mapped current URL persistence and prompt flows. Validation: targeted `rg` and source inspection across worker and Tauri.
- [x] 2026-07-10: Defined the product, architecture, security, compatibility, and migration boundaries before implementation. Validation: `docs/product-specs/2026-07-10-source-url-privacy-boundary.md` plus linked architecture/security updates.
- [x] 2026-07-10: Added worker and Tauri regressions and confirmed the original persistence/prompt leak plus short-link and history edge cases. Validation: focused pytest and cargo tests were RED before implementation and GREEN afterward.
- [x] 2026-07-10: Implemented the unified source identity, strong transcript persistence boundary, official-text prompt input, cache/history compatibility, bounded two-phase legacy migration, and sensitive task-id quarantine. Validation: focused worker/Rust tests plus recursive sentinel scans.
- [x] 2026-07-10: Completed independent security review and fixed follow-up findings for XHS query-value ID confusion, Bilibili part indexing, untrusted preflight identity reuse, stderr/path detail, legacy AI artifacts, retry safety, schema/source binding, and failed-migration retries. Validation: focused regressions and full suites.
- [x] 2026-07-10: Ran all project completion gates and recorded exact results. Validation: commands and results in Outcomes & Retrospective.
- [x] 2026-07-10: Performed final closeout review and fault injection. Fixed alternate-task transcript acceptance, retry link pre-read, standalone legacy credential leakage, and corrupt-manifest history isolation; verified idempotence plus read/write/interruption and Windows junction failures in temporary directories.
- [x] 2026-07-10: Raised `source_privacy_migration_version` to 2 so tasks already marked by the earlier cleanup are rechecked under the final supplemental-field and standalone-assignment rules.

## Surprises & Discoveries

- Evidence: the original `worker/frameq_worker/pipeline.py` sent `transcript.md` to summary and insight generation, so its Metadata block entered every related cloud prompt.
- Evidence: the original `worker/frameq_worker/task_store.py` wrote `ProcessRequest.url` directly to `frameq-task.json`, and `app/src-tauri/src/history.rs` returned that field directly to the UI.
- Evidence: Bilibili fallback represents `part_index` as zero-based for page selection, so constructing canonical identity directly from that field produced an off-by-one cache key; re-canonicalizing the resolved `full_url` avoids this duplicated interpretation.
- Evidence: an old AI result can echo URL metadata from the former Markdown prompt, and an old Xiaohongshu task id can contain a 24-character token that was mistaken for a note id. Manifest/transcript-only cleanup was therefore insufficient.
- Evidence: committing canonical manifest state before every known artifact is cleaned loses the secret values required for a later retry. The migration now preserves the original manifest until all bounded artifact rewrites succeed.
- Evidence: a same-named `transcript/transcript.txt` outside the owning task could satisfy name-only checks, and retry read the file before link validation. Exact task-root binding and read ownership now live in the AI step itself; callers no longer pass a parallel transcript body.
- Evidence: when `source_url` was absent, standalone credential assignments in preview, supplemental manifest fields, or AI artifacts were not recoverable from source-derived redaction material. Generic assignment sanitation is now applied only inside the bounded manifest/transcript-metadata/known-AI scope.

## Decision Log

- Decision: Model source input as non-serializable `download_url` plus serializable `canonical_url`, and make canonical URL generation an allowlisted platform operation. Rationale: separation at the data model and persistence boundaries prevents downstream consumers from accidentally receiving tokens. Date/Author: 2026-07-10 / User + Codex.
- Decision: Treat `transcript.txt` as the sole AI prompt transcript source and keep `transcript.md` as a human-readable artifact only. Rationale: this preserves user edits and removes URL/engine metadata before prompt assembly. Date/Author: 2026-07-10 / User + Codex.
- Decision: Migrate only manifests encountered under the configured task output root, and use conservative redaction when a stable supported identity cannot be recovered. Rationale: this removes active history/cache exposure without scanning or rewriting arbitrary user files. Date/Author: 2026-07-10 / Codex.
- Decision: Preserve the original URL only in the in-memory/process-local request path used by downloader strategies. Rationale: token-bearing links can still work while commands, errors, results, and artifacts remain safe. Date/Author: 2026-07-10 / User + Codex.
- Decision: Use a non-serializable `SourceRequest` for `download_url` and a separate schema-versioned `SourceIdentity` for persistence/equality. Rationale: type separation removes the raw URL from every manifest/result serializer by construction. Date/Author: 2026-07-10 / Codex.
- Decision: Keep exact canonical cache hits before Python launch; allow a lightweight worker identity preflight only for variants, sensitive-query forms, short links, or legacy migration. Rationale: this preserves the existing fast path while keeping platform rules in one truth source and guarantees a cache hit never enters media processing. Date/Author: 2026-07-10 / Codex.
- Decision: Treat preflight identity as cache-only advisory data and independently resolve the raw source again in a full worker on cache miss. Rationale: a preflight result must not be able to choose another task identity for persistence. Date/Author: 2026-07-10 / Codex.
- Decision: Use a two-phase bounded legacy migration for manifests, known transcript Markdown files, and known AI artifacts. Commit schema 3/canonical identity only after all rewrites succeed; otherwise preserve the raw legacy manifest for a later retry and hide the task. Rationale: retryable cleanup must retain its redaction material without exposing incomplete content. Date/Author: 2026-07-10 / Codex.
- Decision: Quarantine rather than automatically rename a legacy task whose directory id contains a recovered credential value. Rationale: renaming both output and app-local cache paths safely requires a transactional migration and coordination with concurrent readers. Date/Author: 2026-07-10 / Codex.

## Outcomes & Retrospective

Delivered a single worker-owned canonicalization boundary, safe transcript/manifest
serialization, cache-only source preflight, canonical cache/history matching, pure-text AI
inputs, retry-from-edited-text behavior, diagnostic redaction, and bounded legacy cleanup.
The regression fixture proves a Xiaohongshu `xsec_token=review-secret` reaches the download
command while the task tree, worker result, history, and all four captured prompt calls omit
the raw URL, key, and value.

Validation results:

- `uv run pytest worker\tests` — 244 passed; one upstream `pydub/audioop` deprecation warning.
- `uv run ruff check worker` — passed.
- `npm --prefix app test` — 28 files / 187 tests passed.
- `npm --prefix app run build` — passed.
- `cargo test --manifest-path app\src-tauri\Cargo.toml` — 83 passed.
- `node --test scripts\tests\*.test.mjs` — 7 passed.
- `python scripts\validate_agents_docs.py --level WARN` — 0 errors, 0 warnings.
- `git diff --check` — passed (Git emitted only line-ending conversion notices).
- Packaged-worker parity check — all 26 Python source files matched by SHA-256.

Residual risk: the transient raw source still exists in local child-process command
arguments during cache preflight/full processing, so same-user process inspection or crash
dumps can observe it. Quarantined legacy output/cache directory names can still physically
contain a token and require manual deletion; they are not returned or reused. Historical
desktop logs, exported copies, user-managed backups, arbitrary files, and transcript body
text are outside automatic migration. These items are recorded in the shared tech-debt
tracker.

## Context and Orientation

- Product contract: `docs/product-specs/2026-07-10-source-url-privacy-boundary.md`
- Architecture and security: `docs/ARCHITECTURE.md`, `docs/SECURITY.md`
- Worker request/pipeline: `worker/frameq_worker/models.py`, `worker/frameq_worker/pipeline.py`, `worker/frameq_worker/worker_service.py`
- Worker persistence: `worker/frameq_worker/task_store.py`, `worker/frameq_worker/asr.py`
- Platform parsing: `worker/frameq_worker/*_fallback.py`, `worker/frameq_worker/media.py`
- Desktop cache/history: `app/src-tauri/src/video_processing.rs`, `app/src-tauri/src/task_manifest.rs`, `app/src-tauri/src/history.rs`
- Desktop diagnostics/frontend contracts: `app/src-tauri/src/diagnostics.rs`, `app/src/workerClient.ts`, `app/src/historyClient.ts`, `contracts/desktop-worker-contract.json`, `contracts/platform-url-support-contract.json`
- Packaged worker mirror: `app/src-tauri/resources/worker/frameq_worker/` (generated from the source worker; do not hand-edit)
- Regression tests: `worker/tests/`, Rust module tests under `app/src-tauri/src/`

## Plan of Work

1. Add central `SourceRequest` and `SourceIdentity` types with platform allowlisted
   canonicalization, short-link resolution hooks, safe legacy conversion, and explicit
   identity serialization/equality.
2. Add failing tests that prove download receives the raw URL while all persistence,
   history, prompt, error, and log boundaries exclude its sensitive values.
3. Carry SourceIdentity through task creation; persist only its canonical URL and use the
   same identity for transcript metadata and reusable-task matching.
4. Switch all AI generation and retry paths to the official saved transcript text.
5. Canonicalize and rewrite eligible old task manifests at bounded load boundaries;
   clean declared/conventional task-local transcript Markdown and AI artifacts with a
   two-phase commit, and hide or quarantine tasks when safe migration is not possible.
6. Run focused checks, review the diff for scattered rules or raw URL serialization, then
   run every required completion gate.

## Validation and Acceptance

- `uv run pytest worker\tests`
- `uv run ruff check worker`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app\src-tauri\Cargo.toml`
- `python scripts\validate_agents_docs.py --level WARN`
- `git diff --check`
- Manual/fixture evidence: submit a Xiaohongshu URL containing
  `xsec_token=review-secret`, capture downloader input and all AI prompts, then recursively
  scan the task output and history payload for the raw URL, parameter name, and secret.
- Conformance matrix: direct and equivalent forms for all four platforms, effective
  Bilibili parts, resolved short links, userinfo/fragment inputs, parseable/unparseable
  legacy manifests, downloader stderr that echoes a sentinel URL, edited transcript retry,
  and packaged-worker mirror parity.
