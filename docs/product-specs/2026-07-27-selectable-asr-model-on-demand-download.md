# Selectable ASR Models and On-Demand Download

- Date: 2026-07-27
- Status: Approved for implementation
- Scope: desktop ASR selection, availability, and model-install behavior
- Supersedes: the first-run automatic model-download behavior in the model-acquisition portions of
  `2026-06-18-installer-distribution.md`

## Purpose

FrameQ keeps model weights out of the installer while allowing a user to choose the local ASR
runtime that a task will use. Opening the app must not start a model download or require a network
connection.

## Supported Models

| Stored model ID | User label | Runtime | Download policy |
|---|---|---|---|
| `iic/SenseVoiceSmall` | SenseVoiceSmall | Existing PyTorch path | Default and backward-compatible. Its existing source compatibility remains unchanged. |
| `iic/SenseVoiceSmall-onnx` | SenseVoiceSmall-ONNX (~230 MiB) | ONNX | Download only from official ModelScope `iic/SenseVoiceSmall-onnx` and the official ModelScope ONNX VAD. |

The selected ID is restricted to this closed list. The ONNX option must not use Hugging Face, a
third-party mirror, an auto-exported model, or a fallback to another source. Model weights, LLM
keys, cloud LLM models, and user-private configuration remain outside the installer.

## Submission and Download Flow

1. The user submits a URL or a selected local-media source. FrameQ validates the source and the
   account/entitlement gates first, then validates the selected model ID and snapshots it for the
   intended task.
2. If that model is installed and passes its readiness check, FrameQ creates and starts the normal
   task with the snapshot. Later settings changes cannot alter that task's ASR runtime.
3. If the snapshot model is missing, FrameQ opens the model-download experience instead. This is a
   separate install operation: it creates no processing worker task, task ID, task manifest, media
   cache, or partial source artifact.
4. A successful install revalidates the same selected model, then automatically continues the
   original URL or local-media submission using its snapshot. The user does not need to select the
   source again.
5. Cancelled or failed installation preserves the selected model and the original source intent,
   but creates no processing worker task. The user may retry the submission or choose another
   installed model after the install operation has ended.

While a model install is active, model selection and new task submission are blocked. The UI must
show install progress, cancellation, and a concise actionable failure state; it must not silently
start a second install or submit a task with another model.

## Settings and Startup

- Startup only loads local settings and checks local model readiness. It does not automatically
  download either model.
- Settings show the two selectable models and their local status (for example, installed or not
  installed). Settings do not offer a manual Download action.
- For the selected model, Settings labels its storage location with that ASR model's concrete
  runtime directory, not the shared model-cache root. For the default PyTorch model this is the
  `models/iic/SenseVoiceSmall` leaf under the PyTorch cache; for the ONNX model this is the
  `models/iic/SenseVoiceSmall-onnx` leaf under the ONNX cache.
- The displayed ASR directory is informational. Readiness checks continue to validate the complete
  descriptor-owned cache, including its version marker, ASR assets, and separate VAD assets; the
  displayed leaf must not narrow or replace that validation boundary.
- Choosing a model remains a local preference. The model used by a submitted task is the validated
  task snapshot, not a later read of the preference.

## Offline and Failure Behavior

- An installed, validated model starts normally while offline; ASR stays local.
- ONNX transcription requires the official ONNX VAD result to be decoded into usable speech
  blocks and invokes the ONNX ASR runner once per block. The ONNX path never submits the original
  audio as one full-audio inference, including when VAD inference fails, the provider result shape
  is invalid, normalized PCM audio cannot be read, or segment slicing produces no usable blocks.
- A valid ONNX VAD result with no detected speech is an empty-transcript failure. A malformed VAD
  result or any VAD/block runtime failure is an ASR runtime failure. These failures are terminal
  for the task and must not silently switch models or retry through another ONNX input shape.
- If the selected model is missing while offline, FrameQ explains that installation requires a
  connection and leaves the source intent and selection intact. It must not automatically switch
  to the PyTorch model or create a task.
- Download cancellation, network failure, source-validation failure, checksum failure, or an
  incomplete cache leaves the model unavailable. Incomplete files are not treated as installed and
  no task resumes.
- Model-download diagnostics may identify the public model ID, source host, retry/failure class,
  and safe progress information. They must not expose credentials, cookies, signed URLs, request
  headers, or raw downloader output.

## Acceptance Criteria

- A clean install opens without network activity for model acquisition and without ASR weights in
  the installer.
- `iic/SenseVoiceSmall` remains the default selection and existing cached PyTorch behavior remains
  compatible.
- `iic/SenseVoiceSmall-onnx` is labeled `SenseVoiceSmall-ONNX (~230 MiB)` and is obtainable only
  from its official ModelScope ASR and ONNX-VAD sources.
- Installed selections proceed to a normal URL or local-media task; missing selections install
  first, revalidate, and then continue the original intent automatically.
- The official batched ONNX VAD result shape is decoded into ordered speech intervals, and every
  resulting block is passed to SenseVoiceSmall-ONNX as one audio `ndarray` per call.
- VAD preparation and block inference failures are reported without any full-audio ONNX retry;
  tests cover the real nested-list VAD result shape and every pre-block failure boundary.
- Cancelled, failed, or offline missing-model attempts preserve the selection and source intent,
  create no processing worker task, and never silently change models.
- Settings show model status only for acquisition; no startup automatic download or manual
  settings download action remains.
- Settings reports the selected ASR model's concrete runtime directory rather than a shared cache
  ancestor, while installed/missing status still covers every required ASR, VAD, marker, and
  manifest asset owned by that model descriptor.
