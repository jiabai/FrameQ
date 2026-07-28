# ONNX VAD Result Contract Hardening Design

- Date: 2026-07-29
- Status: Approved for implementation
- Scope: SenseVoiceSmall-ONNX VAD decoding, segmented inference, and terminal failure behavior
- Related product specification:
  `docs/product-specs/2026-07-27-selectable-asr-model-on-demand-download.md`
- Supersedes: the pre-block full-audio compatibility exception documented on 2026-07-28

## Context

The first segmented-inference hardening changed SenseVoiceSmall-ONNX from one
`list[ndarray]` ASR call to one ASR call per prepared block. It retained `None` from segmentation
preparation as authorization to invoke the original audio path through a full-audio ONNX call.

The retained boundary was unsafe because the ONNX adapter reused the PyTorch
`_extract_vad_segments` helper. That helper accepts the `funasr.AutoModel` result
`[{"value": [[start_ms, end_ms], ...]}]`, while the bundled `funasr_onnx 0.4.2`
`Fsmn_vad` returns one batch as `[[[start_ms, end_ms], ...]]]`. The real ONNX result therefore
decoded to zero intervals, segmentation returned `None`, and a 95-minute source entered the
full-audio ONNX path.

An executable probe against the current bundled runtime and official VAD sample established the
contract: the raw result and first element were both lists, the raw preview contained nested
`[start_ms, end_ms]` pairs, and the shared PyTorch decoder returned zero intervals.

The first real 95-minute acceptance then exposed a second, independent long-audio boundary:
`Fsmn_vad` is an offline adapter. Before its internal inference loop, it extracts features for the
complete waveform. The retained audio attempted to allocate a float64 feature matrix with shape
`(570380, 400)`, approximately 1.70 GiB, and failed before any ASR block could run. Removing the ASR
fallback was necessary but insufficient; the VAD provider must also receive bounded audio chunks.

A follow-up probe against the same bundled `funasr_onnx 0.4.2` runtime confirmed that
`Fsmn_vad_online` accepts sequential mono float32 chunks with one persistent `param_dict`. Its
results use absolute stream milliseconds and endpoint sentinels: `[start_ms, -1]` opens an interval,
`[-1, end_ms]` closes one, and `[start_ms, end_ms]` may contain a complete interval. Ten-second
chunks reproduced ordered speech intervals on a retained real-audio prefix without a whole-audio
feature allocation.

## Decision

SenseVoiceSmall-ONNX requires VAD segmentation. The ONNX adapter has no full-audio compatibility
path. It must either produce a transcript from independently inferred VAD blocks or return a typed
terminal ASR failure.

The ONNX provider module owns a dedicated streaming VAD-event collector. It passes consecutive
ten-second mono float32 views to `Fsmn_vad_online`, reuses one provider state dictionary for the
entire stream, and sets `is_final=True` only on the last non-empty chunk. The chunk size is an
application-owned memory bound, not an ASR segment duration.

For `batch_size=1`, each provider call must return exactly one outer batch whose contents are
ordered endpoint pairs. `-1` is accepted only as the provider sentinel for a missing start or end.
The collector carries one pending start across chunks, emits only complete intervals with
`end_ms > start_ms`, rejects duplicate starts, ends without a pending start, backwards/overlapping
intervals, malformed events, and a start still open after the final call. A structurally invalid
stream is a provider-contract runtime failure rather than an empty VAD result.

An empty, structurally valid batch means VAD detected no speech and becomes
`ASR_EMPTY_TRANSCRIPT`. It does not authorize ASR inference.

## Runtime Data Flow

1. Build or reuse the local quantized ONNX ASR and online VAD runners.
2. Read the normalized PCM WAV into one mono float32 array.
3. Invoke `Fsmn_vad_online` over consecutive ten-second views with one persistent state dictionary
   and a final marker on the last view.
4. Collect the real `batch_size=1` endpoint-event stream into complete ordered intervals.
5. Slice ordered VAD intervals into audio-array views and matching timing pairs.
6. Invoke `SenseVoiceSmall` once for each block, passing one `ndarray` per call.
7. Normalize non-empty block text and assemble ordered transcript segments.
8. Return a terminal typed failure on any failed boundary; never invoke ASR with the original
   audio path or a list of blocks.

The existing PyTorch SenseVoiceSmall path keeps its own `AutoModel` VAD dictionary decoder and
best-effort fallback behavior. This change is ONNX-only.

## Failure Semantics

| Condition | Result | ASR invoked? |
|---|---|---|
| VAD provider raises | `ASR_RUNTIME_ERROR` with ONNX VAD context | No |
| Normalized PCM WAV cannot be read | `ASR_RUNTIME_ERROR` with audio-preparation context | No |
| VAD event shape/state or completed interval is invalid | `ASR_RUNTIME_ERROR` with fixed contract context | No |
| Final VAD stream contains no speech interval | `ASR_EMPTY_TRANSCRIPT` | No |
| Intervals produce no usable audio blocks | `ASR_RUNTIME_ERROR` with slicing context | No |
| ASR block raises | `ASR_RUNTIME_ERROR` with block position | Only preceding/current blocks |
| Every ASR block is text-empty | `ASR_EMPTY_TRANSCRIPT` | Once per block |

These errors preserve the existing worker error-code and task-manifest schema. Provider failures
remain visible only through the existing technical-detail surface and must not contain source
URLs, cookies, credentials, request headers, or audio contents.

## Test Strategy

Focused tests must:

- feed start/end events across multiple VAD chunks and prove one persistent provider state, one
  final marker, ordered interval assembly, and bounded chunk input;
- prove two completed intervals cause two ordered ASR calls, each with one audio block;
- prove the ASR runner never receives the original audio path or a `list[ndarray]`;
- cover VAD provider exceptions, malformed outer/batch/event shapes, invalid endpoint state,
  incomplete final state, valid no-speech output, normalized-WAV read failure, unusable slice
  output, block failure, and all-empty block text;
- assert the expected typed error and zero full-audio retries for every failure path; and
- retain the source guard that the ONNX provider does not import or call PyTorch `AutoModel`.

Verification also runs the streaming collector against the bundled `funasr_onnx` VAD and retained
real audio.
Final operational acceptance runs the previously failing 95-minute task audio through the local
ONNX transcriber, confirms multiple per-block calls complete without a full-audio allocation, and
produces a non-empty segmented transcript. If that source exposes a separate model/provider
failure, the plan remains active until the new root cause is identified and resolved or explicitly
approved as an external residual risk.

## Non-Goals

- Do not change PyTorch SenseVoiceSmall behavior.
- Do not add a duration threshold or preserve a short-audio ONNX full-input path.
- Do not change ASR model acquisition, task manifests, transcript artifacts, UI error codes, or
  worker/Rust contracts.
- Do not add another ASR provider or automatic model fallback.
