# Process-video request contract v3

## Problem

The current URL-processing request is mirrored across React, Rust, and Python with five fields.
Only the source URL and configured ASR model affect processing. `language`, `output_formats`, and
`insightflow_mode` are transported and parsed but have no execution semantics. The frontend also
sends a hard-coded model even though Rust replaces it from app-local settings before cache lookup
and worker launch.

This creates a false cross-language contract: tests preserve matching field names without proving
that each field owns real behavior.

## Goals

- Make the React-to-Tauri request express user intent only.
- Make the Rust-to-worker request contain only resolved execution inputs.
- Give Rust sole ownership of desktop ASR-model configuration for processing.
- Reject missing, legacy, unknown, or invalid worker fields without echoing source input.
- Record the exact worker request schema in the shared desktop-worker contract and verify both
  serializers/parsers against it.
- Remove the false fields before local-media processing introduces another request boundary.

## Non-goals

- Changing URL support, source identity, cache reuse, subtitle selection, media download, ASR output,
  task artifacts, AI generation, History, cancellation, or account behavior.
- Adding an ASR language hint or user-selectable output formats.
- Adding local-media import in this change.
- Introducing Protobuf, a runtime schema service, or multi-language model generation.
- Supporting independently upgraded desktop and worker binaries; they remain one bundled release.

## Request boundaries

React sends only the submitted URL to Tauri:

```ts
type ProcessVideoIpcRequest = {
  url: string;
};
```

Rust preserves the submitted URL, resolves the configured ASR model, performs model-aware cache lookup, and
sends a strict execution request through bounded worker stdin:

```ts
type ProcessVideoWorkerRequestV3 = {
  contract_version: 3;
  url: string;
  asr_model: "iic/SenseVoiceSmall";
};
```

The worker request is closed. Every field is required and additional fields are rejected. Python
validates `contract_version`, a non-empty URL string, and supported `asr_model`, then treats the request as the
execution truth. It must not override `asr_model` from `FRAMEQ_ASR_MODEL` during process execution.

## Retired fields

- `language` is removed. Transcript language remains detected metadata. UI language and confirmed AI
  output language remain separate existing contracts. A future ASR hint must use a new closed
  `asr_language_hint` field and have an executable consumer before it enters the wire schema.
- `output_formats` is removed. FrameQ continues to create its fixed transcript artifacts. A future
  export-format choice belongs to an export capability, not this processing request.
- `insightflow_mode` is removed. `process_video` remains transcript-only and confirmed AI generation
  continues through `retry_insights`.
- Frontend `model` is removed. The worker field is renamed `asr_model` to distinguish it from LLM
  configuration.

## Contract ownership and gates

`contracts/desktop-worker-contract.json` advances from v2 to v3 and becomes the canonical worker
request schema. TypeScript verifies the IPC payload and schema declaration, Rust verifies exact
worker serialization, and Python verifies exact parsing and rejection behavior.

Acceptance requires:

- the frontend invocation is exactly `{ request: { url } }`;
- Rust rejects additional IPC fields and serializes exactly `contract_version`, `url`, and
  `asr_model`;
- the model resolved from app-local settings is the same model used for cache matching and worker
  execution;
- Python rejects missing, legacy, additional, wrong-version, and unsupported-model payloads with a
  fixed non-echoing error;
- pipeline/transcriber/task-manifest tests prove that `url` and `asr_model` are consumed; and
- searches of production request code contain none of the three retired field names.

## Local-media follow-up

The unimplemented local-media request must not copy the retired fields. Its React-to-Tauri request
contains only the opaque selection token. Its future worker request contains contract version,
validated source metadata/path, and resolved `asr_model`. Because this change consumes desktop-worker
contract v3, local media will advance the contract from v3 to v4.

## Security and recovery

Raw URLs remain transient credential-bearing input and continue to cross only React-to-Tauri IPC and
bounded worker stdin. Invalid-request messages must not contain the URL, model configuration source,
payload, parser details, credentials, or local paths. A contract mismatch fails before source
resolution, download, cache mutation, or task creation. The user can retry after installing a
synchronized desktop build; there is no compatibility fallback to the retired payload.
