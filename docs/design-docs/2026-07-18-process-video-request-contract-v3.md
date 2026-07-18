# ADR-2026-07-18: Split process intent from resolved worker execution

## Status

Accepted for implementation on 2026-07-18.

## Context

`ProcessVideoRequest` currently appears in TypeScript, two Rust structs, and a Python dataclass/parser.
Three fields are transported without being consumed, while the frontend-supplied model is replaced by
Rust settings and then may be replaced again by Python environment configuration. Matching DTOs do
not provide a meaningful contract when ownership and behavior are ambiguous.

FrameQ bundles desktop and worker together, Rust already owns app-local settings and model-aware cache
lookup, and the worker pipeline needs only a source URL and the resolved ASR model.

## Decision 1: Treat IPC intent and worker execution as separate contracts

The React-to-Tauri command request contains only `url`. Rust uses a distinct internal worker request
containing `contract_version`, `url`, and `asr_model`. The two types must not share a misleading name
or be reused across boundaries.

This preserves strict `deny_unknown_fields` IPC handling while removing execution configuration from
presentation code.

## Decision 2: Resolve processing configuration once in Rust

Rust reads app-local ASR settings, validates the supported model, and constructs an immutable resolved
worker request before cache lookup and serialization. Cache matching and worker execution use that
same value.

Python validates `asr_model` but does not override it from environment configuration in the process
path. Worker environment remains responsible for runtime locations and other non-request resources.
Standalone adapters may construct a resolved request explicitly; they must not weaken the desktop
wire parser with defaults.

## Decision 3: Use a strict shared schema and executable boundary tests

The existing desktop-worker contract advances to v3 and declares the complete worker request schema.
The language-specific structs remain small boundary adapters; adding three code-generation toolchains
for one small internal request would cost more than it removes.

Shared schema assertions plus TypeScript IPC tests, Rust serialization/deserialization tests, and
Python parser/consumer tests are the drift gate. A field may enter a request only when its owner,
validator, executable consumer, failure behavior, and tests are named.

## Decision 4: Retire fields instead of manufacturing semantics

`language`, `output_formats`, and `insightflow_mode` are deleted. The pipeline will not read them only
to justify their existence. Future ASR hints, export choices, or processing modes require separately
specified behavior and versioned fields.

## Decision 5: Reserve local-media contract v4

The approved local-media design remains an independent command because URL identity and local-path
privacy have different validation. Its frontend request is reduced to the opaque selection token and
its future worker request carries only validated source fields plus `asr_model`. Local media advances
the desktop-worker contract from v3 to v4.

## Consequences

Positive:

- Every process request field has real semantics and a named owner.
- UI language, transcript language, AI output language, ASR model, and LLM model cannot be confused
  through a generic request field.
- Model-aware cache reuse and worker execution cannot silently use different configuration sources.
- Future local-media work starts from a clean request boundary.

Negative:

- Desktop, Rust, Python, tests, docs, and the packaged worker mirror must change atomically.
- Direct worker callers must send the explicit v3 request instead of relying on defaults.
- Adding a future request option requires a contract-version decision and consumption test.

Neutral:

- Task manifest schema and persisted History data do not change.
- Existing completed caches remain readable because cache matching continues to use source identity
  and resolved ASR model.
