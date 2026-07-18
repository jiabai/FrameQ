# Source Identity Dependency Boundary

## Status

Approved for implementation on 2026-07-18.

## Problem

`models.py` needs the persistable `SourceIdentity` value object, but the current
`source_identity.py` also imports the Douyin, Xiaohongshu, and Bilibili fallback modules.
Those modules own HTTP clients, compression, downloads, progress reporting, and subprocess
execution. Importing a core result DTO therefore pulls platform infrastructure into the core
dependency graph.

The DTO-to-value-object dependency is valid. The violation is that the value-object module also
owns network resolution.

## Decision

Use three explicit layers:

1. `source_identity.py` is a pure core module. It owns `SourceIdentity`, direct URL/ID parsing,
   canonical URL construction, manifest validation, and persistence validation. It may use pure
   standard-library parsing but must not import platform fallbacks or perform network I/O.
2. `source_resolution.py` is an application service. It owns transient `SourceRequest`, source-text
   sanitization, the short-link resolver port, and the direct-then-short-link resolution sequence.
3. `platform_source_resolvers.py` is the infrastructure composition adapter. It binds the closed
   short-link host registry to platform implementations and normalizes platform-specific failures.

`cli.py` is the production composition root. It builds the default platform resolver and injects a
`SourceRequestResolver` callable into `worker_service.py`; `worker_service.py` passes the callable
to the pipeline and identity-preflight use cases. Core and application modules never construct a
platform adapter.

## Data Flow

1. Attempt pure direct identity parsing from the submitted source.
2. If the source is not direct, extract URL candidates and select a resolver only by an exact,
   closed short-link hostname.
3. Give the adapter only the selected short URL, not the complete share text.
4. Treat the adapter result as untrusted and pass it back through pure direct identity parsing.
5. Construct `SourceRequest` with the original process-local download URL and the validated
   persistable identity.

Platform adapters return a resolved URL candidate rather than a trusted `SourceIdentity`. This
keeps allowlisted host, stable-ID, canonicalization, and persistence policy in one pure boundary.

## Error And Security Rules

- Manifest parsing, canonical persistence checks, and error sanitization never perform network I/O.
- Platform exceptions do not cross the adapter boundary; callers continue to receive the existing
  `SourceIdentityError` and external `SOURCE_IDENTITY_UNAVAILABLE` behavior.
- Raw source URLs remain process-local and retain the existing no-log/no-persistence contract.
- Lookalike hosts and unsafe resolved URLs must fail after pure revalidation.
- The short-link registry is closed production configuration, not a user-extensible plugin system.

## Scope

This refactor does not change supported platforms, accepted direct/short URL forms, canonical URLs,
manifest schema, cache keys, worker JSON, progress codes, result shapes, or downloader fallback
order. Splitting every download fallback into a new package is outside this change; the platform
adapter is the only module allowed to bridge to current fallback resolution functions.

## Gates

- An isolated import test proves importing `frameq_worker.models` and
  `frameq_worker.source_identity` does not load any `*_fallback` module.
- Pure identity tests run with no resolver and no network capability.
- Resolution contract tests inject fake adapters and prove exact-host selection, unsafe-result
  rejection, and source sanitization.
- Existing worker tests and Ruff pass without changing external behavior.
