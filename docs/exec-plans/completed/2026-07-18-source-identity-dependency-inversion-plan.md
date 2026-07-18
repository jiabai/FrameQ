# Source Identity Dependency Inversion Implementation Plan

> **For agentic workers:** Execute this plan inline and keep Progress, Decision Log, and validation
> evidence current. Sub-agents are not used for this side-conversation implementation.

**Goal:** Remove platform fallback infrastructure from the core SourceIdentity import graph without
changing source recognition, persistence, cache, or worker contract behavior.

**Architecture:** Keep `source_identity.py` pure, move transient/network orchestration to
`source_resolution.py`, bind concrete platform adapters only in `platform_source_resolvers.py`, and
inject the resolver from `cli.py` through worker service and pipeline entry points.

**Tech Stack:** Python 3.13, dataclasses, Protocol/Callable ports, pytest, Ruff, repository governance
validation.

---

## Progress

- [x] 2026-07-18: Reviewed the real import chain, existing source/privacy tests, fallback parser
  entry points, architecture/security rules, and the approved code-audit finding.
- [x] 2026-07-18: User approved pure identity core + application resolution service + injected
  platform adapter architecture.
- [x] 2026-07-18: Added import-boundary and resolver-contract tests. RED produced 5 expected
  failures: the isolated core import loaded all three fallback modules and the approved
  `source_resolution` application boundary did not yet exist.
- [x] 2026-07-18: Made `source_identity.py` pure, added the application resolver and closed platform
  adapter registry, and injected the production resolver from CLI through worker service and the
  pipeline. Focused source/import/CLI tests passed 57/57.
- [x] 2026-07-18: Completed worker, Ruff, docs, packaged-worker mirror, script, and diff gates. The
  final worker suite passed 376/376 and canonical/mirror SHA-256 comparison reported 30 files with
  zero mismatches.

## Surprises & Discoveries

- The managed shell could not use the default uv cache or pytest system temp root. Pointing
  `UV_CACHE_DIR`, `TEMP`, and `TMP` to ignored writable repository directories made the same tests
  run normally; the initial permission errors were environment-only and contained no code failure.
- Moving only the value object would not have fixed the mixed responsibility. Keeping
  `SourceIdentity` and canonicalization together became a smaller boundary once network resolution
  and transient `SourceRequest` moved out.

## Decision Log

- Decision: Keep `SourceIdentity` in `source_identity.py` and make that module pure rather than move
  the value object into general `models.py`. Rationale: DTOs may depend on a stable domain value
  object; the network/fallback responsibility is the invalid dependency. Date/Author: 2026-07-18,
  User + Codex.
- Decision: Platform adapters return untrusted resolved URLs and core parsing revalidates them.
  Rationale: infrastructure must not manufacture a persistable identity or bypass allowlisted
  canonicalization. Date/Author: 2026-07-18, User + Codex.
- Decision: Production resolver wiring belongs to `cli.py`; worker service and pipeline receive a
  callable port. Rationale: tests can use pure or fake resolvers and application code does not import
  concrete platform infrastructure. Date/Author: 2026-07-18, Codex.

## Outcomes & Retrospective

The core import chain now ends at pure source identity policy. Importing `models.py` or
`source_identity.py` does not load Douyin, Xiaohongshu, or Bilibili fallback modules, and an AST gate
also rejects fallback, HTTP-request, compression, or subprocess imports in the core modules.
Short-link resolution is a closed host registry whose adapter output is treated as untrusted and
revalidated by the pure identity parser. Production CLI processing and identity preflight share the
same injected resolver, while direct unit callers can use the no-network resolver.

External request/result JSON, canonical URLs, manifest schema, cache identity, sanitization,
fallback download order, and structured error codes are unchanged. The platform adapters still wrap
the current fallback parser entry points; extracting their internal short-link HTTP clients into
smaller infrastructure files can be considered separately and is not required for dependency
inversion.

## Files

- Modify: `worker/frameq_worker/source_identity.py`
- Create: `worker/frameq_worker/source_resolution.py`
- Create: `worker/frameq_worker/platform_source_resolvers.py`
- Modify: `worker/frameq_worker/pipeline.py`
- Modify: `worker/frameq_worker/worker_service.py`
- Modify: `worker/frameq_worker/cli.py`
- Modify: `worker/tests/test_source_identity.py`
- Create: `worker/tests/test_source_resolution.py`
- Create: `worker/tests/test_import_boundaries.py`
- Synchronize through the established worker-resource script; do not hand-edit the packaged mirror.

## TDD Execution

1. Add an isolated-process test that imports core models and asserts no platform fallback module is
   present in `sys.modules`; verify it fails on the current import chain.
2. Add resolver contract tests for direct resolution, exact short-host dispatch, revalidation of
   resolved URLs, lookalike-host rejection, and failure normalization; verify the new API is absent.
3. Make `source_identity.py` pure and implement `source_resolution.py` with the smallest API required
   by the tests.
4. Add platform adapters and inject their resolver from CLI through worker service and pipeline.
5. Migrate existing source identity tests without weakening privacy or canonicalization assertions.

## Validation

```powershell
uv run pytest worker/tests/test_import_boundaries.py worker/tests/test_source_identity.py worker/tests/test_source_resolution.py
uv run pytest worker/tests
uv run ruff check worker
python scripts/validate_agents_docs.py --level WARN
node --input-type=module -e "import { prepareFreshWorkerResource } from './scripts/tauri-dev-fresh-worker.mjs'; await prepareFreshWorkerResource();"
git diff --check
git status --short
```

## Acceptance

- `models.py` and pure identity imports load no platform fallback modules.
- Direct and short-link source identities, canonical URLs, Bilibili part handling, sanitization,
  manifest validation, cache keys, and external error codes remain unchanged.
- Only the platform adapter module imports source-resolution functions from the fallback modules.
- Production CLI paths inject the default resolver for full processing and identity preflight.

## Validation Evidence

- RED: 5 expected failures proved the three platform fallback imports and missing resolver boundary.
- Focused GREEN: 57/57 source identity, resolution, import-boundary, and CLI tests passed.
- Worker: 376/376 passed; the existing Python `audioop` deprecation warning remains.
- Ruff: all worker checks passed.
- Packaged worker: 30 canonical Python files matched 30 Tauri mirror files by SHA-256 with zero
  missing, extra, or mismatched files; the mirror script tests passed 2/2.
- Governance: `validate_agents_docs.py --level WARN` reported 0 errors and 0 warnings.
- `git diff --check` passed with line-ending notices only.
