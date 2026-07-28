# Selectable ASR Model and On-Demand Download Design

- Date: 2026-07-27
- Status: Approved for implementation
- Scope: closed ASR model selection, task snapshots, cache validation, and on-demand install
- Product specification:
  `docs/product-specs/2026-07-27-selectable-asr-model-on-demand-download.md`

## Context

The current desktop path has one release model, one shared readiness marker, a first-run download
guide, and a manual download action. It cannot safely distinguish the existing PyTorch cache from
an ONNX cache, nor resume one source intent after a selected-model install. This design introduces
that distinction without making startup network-dependent or putting weights in the installer.

## Closed Model Descriptor

The Rust, frontend, worker request validation, progress validation, and persisted task metadata
must agree on one closed descriptor list. A descriptor is policy, not user input: it owns the
stable ID, display label, runtime kind, cache namespace, expected readiness manifest, and approved
source family.

| ID | Label | Runtime / cache namespace | Approved source family |
|---|---|---|---|
| `iic/SenseVoiceSmall` | SenseVoiceSmall | Existing PyTorch runtime and cache | Preserve the current PyTorch source compatibility unchanged. |
| `iic/SenseVoiceSmall-onnx` | SenseVoiceSmall-ONNX (~230 MiB) | `funasr_onnx` runtime and a separate ONNX cache namespace | ModelScope `iic/SenseVoiceSmall-onnx` plus the official ModelScope ONNX FSMN VAD `iic/speech_fsmn_vad_zh-cn-16k-common-onnx`. |

Unknown IDs, model paths, revisions, download URLs, or source overrides must be rejected at the
first owning boundary. ONNX acquisition has no Hugging Face, third-party mirror, custom archive,
or runtime auto-export fallback. The existing PyTorch source behavior is deliberately not changed
by this feature.

## Task Snapshot Contract

The selected model is validated before a task is created and copied into the existing URL and
local-media worker request as the task's `asr_model` snapshot. The Rust-to-Python contract,
worker request parser, task manifest, task-history projection, and transcript metadata must carry
that same allowed ID.

The worker uses the request/manifest snapshot only; it must not re-read the mutable
`FRAMEQ_ASR_MODEL` preference while processing or restoring a task. This preserves reproducible
history and prevents a settings change during or after submission from changing an existing task.

The submission controller validates source input and account/entitlement first. It then validates
the selected descriptor and readiness:

- ready: create the normal task and start its existing processing lane;
- missing: retain a resumable source intent and start only the separate model-download lane;
- completed install: validate the same descriptor again, then submit the retained intent; and
- cancelled or failed install: discard the resumable execution attempt without creating a task,
  while retaining user-visible source intent and model selection.

No task ID, task directory, task manifest, media artifact, or process-video worker invocation may
exist before the selected model passes readiness.

## Cache Isolation, Validation, and Atomic Commit

PyTorch and ONNX caches must never share a generic marker or treat each other's files as ready.
Each descriptor owns a separate cache root and a versioned readiness manifest. Download writes to
a descriptor-private staging directory; only a complete, validated staging tree is atomically
promoted to the ready cache. Cancellation or failure removes/ignores staging data and cannot
replace a known-good ready tree.

For ONNX, the manifest must pin the approved ModelScope revision and SHA256 values for every
required asset. It must require the ONNX ASR runtime files needed by `funasr_onnx` (including
`model_quant.onnx`, `config.yaml`, `am.mvn`, and `tokens.json`), the official ONNX VAD runtime files, and
the supplementary BPE asset from the official original `iic/SenseVoiceSmall` model. The exact
file names, revisions, and SHA256 values are maintained in that manifest rather than inferred from
directory presence. Ready validation verifies the manifest identity, hashes, regular-file shape,
and required runtime files before exposing the cache as installed.

The PyTorch cache keeps its current validation and migration behavior. It must not be rewritten or
re-downloaded merely because the ONNX model is selected or installed.

## Cache Validation Root and Display Directory

The desktop status boundary exposes two related paths with intentionally different meanings:

- the descriptor-owned **cache validation root** is an internal path used to locate the version
  marker and validate the complete ASR/VAD cache; and
- the selected ASR model's **display directory** is the concrete leaf passed to that ASR runtime
  and shown as its storage location in Settings.

For `iic/SenseVoiceSmall`, the cache validation root remains the app-local `models` directory and
the display directory is `models/iic/SenseVoiceSmall` beneath it. For
`iic/SenseVoiceSmall-onnx`, the cache validation root is the app-local `models/onnx` namespace and
the display directory is `models/iic/SenseVoiceSmall-onnx` beneath that namespace. Platform-native
absolute paths are returned to the UI.

VAD assets remain sibling runtime dependencies and are validated through the cache root; they are
not represented as the selected ASR model's storage directory. Availability checks must therefore
use the cache validation root, while the status projection returned to the UI uses the display
directory. This separation prevents a present ASR leaf from hiding a missing marker or VAD asset,
and prevents the UI from presenting a shared cache ancestor as though it were the selected model.

## Python Runtime Boundary

The ONNX transcriber uses `funasr_onnx` directly with explicit local ASR and VAD directories:

- construct the direct SenseVoiceSmall ONNX runner with `quantize=True` and
  `textnorm='withitn'`;
- construct/use the direct FSMN VAD runner only when the validated ONNX VAD cache is ready; and
- decode the `batch_size=1` `funasr_onnx.Fsmn_vad` contract from
  `list[list[list[int]]]`, shaped as `[[[start_ms, end_ms], ...]]]`, into one ordered interval list
  at the ONNX provider
  boundary, without reusing the PyTorch `AutoModel` VAD-result decoder;
- pass each prepared VAD audio block to the ONNX ASR runner in an independent call, preserving
  block order and timing in the transcript;
- treat VAD inference exceptions, invalid provider shapes, normalized-WAV read failures, unusable
  slices, block runtime failures, and an all-empty block result as terminal typed ASR failures; and
- never pass the original audio path to SenseVoiceSmall-ONNX as a full-audio compatibility call.

The ONNX path must not import or invoke `funasr.AutoModel`, use `funasr` export utilities, create
an ONNX model at runtime, or fall back to PyTorch/another ASR provider. Existing PyTorch
SenseVoice normalization, transcript artifacts, and source compatibility remain owned by their
current path. The detailed correction to the original compatibility boundary is recorded in
`docs/design-docs/2026-07-29-onnx-vad-result-contract-hardening.md`.

## Rust, Download Lane, and Source Security

Rust owns preference validation, selected-model availability checks, task-intent retention,
download lifecycle mapping, and serialization into the existing typed worker request. The existing
dedicated model-download lane remains separate from processing-task lanes and retains its
cancellation, watchdog, progress, and terminal-result responsibilities. Python owns only
descriptor-constrained fetch, staging validation, atomic promotion, and local ONNX/PyTorch runtime
loading.

The UI cannot supply a model URL, path, checksum, executable, or worker arguments. Download
policy is selected from the closed descriptor, and model-download logs expose only safe public
source/model identities and failure classes. No model-download request carries video, audio,
transcript, account secret, LLM credential, browser cookie, or signed source URL.

## Compatibility and Failure Invariants

- `iic/SenseVoiceSmall` stays the default and preserves current persisted/cache source
  compatibility.
- Existing valid PyTorch tasks and histories remain readable and continue using their stored
  `asr_model` value.
- Startup performs no automatic model download. Installed models require no network activity to
  transcribe.
- ONNX VAD preparation and block inference failures are fail-closed. There is no full-audio ONNX
  compatibility path, so a provider-contract mismatch cannot allocate full-length logits.
- Missing-model install is not a processing task. It blocks new submission and model changes until
  it reaches a terminal state.
- Failed validation, corrupt files, source failures, cancellation, or offline state never mark an
  ONNX cache ready and never silently substitute another model.
- Settings can display status and choose a model when idle, but cannot provide an independent
  download action.

## Verification Strategy

Implementation needs focused tests for the whitelist across TypeScript/Rust/Python, frozen request
and task-manifest snapshots, cache isolation, atomic promotion, SHA256/required-file rejection,
official-source-only ONNX acquisition, direct `funasr_onnx` construction, mandatory segmented VAD
inference, and the complete URL/local-media resume, cancel, failure, and offline flows.
Contract/progress schema tests must reject stale single-model assumptions and unknown model IDs.
Rust status tests must also assert the exact PyTorch and ONNX display leaves independently from
availability tests that exercise the complete cache validation root.
