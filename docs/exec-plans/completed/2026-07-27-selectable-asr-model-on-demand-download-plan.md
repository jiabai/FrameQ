# Selectable ASR Model and On-Demand Download Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Offer the existing PyTorch SenseVoiceSmall and a ModelScope-only SenseVoiceSmall-ONNX
selection, downloading only the model selected for a submitted task and then resuming that original
URL or local-media intent.

**Architecture:** A closed model descriptor is validated in the desktop app, frozen into the typed
worker request and task metadata, and checked before a task exists. Descriptor-private staged
caches validate pinned files and SHA256 values before atomic promotion. Rust owns submission intent
and the existing separate download lane; Python owns constrained model acquisition and direct ASR
runtime construction.

**Tech Stack:** React/TypeScript, Tauri/Rust, Python worker, ModelScope, `funasr_onnx`, Vitest,
Cargo tests, pytest, ruff, and repository governance tests.

**Durable design:**
`docs/design-docs/2026-07-27-selectable-asr-model-on-demand-download.md`

---

## Purpose / Big Picture

FrameQ must launch without downloading a model. Users select either the existing default
`iic/SenseVoiceSmall` PyTorch model or `iic/SenseVoiceSmall-onnx` labeled
`SenseVoiceSmall-ONNX (~230 MiB)`. A ready selection starts normally. A missing selection invokes
only the model-install lane; after atomic validation it resumes the held URL/local-media intent.
Cancellation, failure, corruption, and offline state create no task and never silently change the
selection.

## Progress

- [x] 2026-07-27: Created the approved product specification, durable design, and this active
  ExecPlan; updated required governance docs and indices to replace startup automatic-download
  wording with selected-model on-demand acquisition.
- [x] 2026-07-27: Added the closed two-model descriptor to the Rust/Python/TypeScript contract,
  settings validation, per-model status command, model-download job, and frozen URL/local-media
  worker requests.
- [x] 2026-07-27: Added per-model ONNX cache validation, pinned ModelScope asset hashes, staged
  atomic promotion, direct `funasr_onnx`/`onnxruntime` provider, and packaging dependencies.
- [x] 2026-07-27: Replaced startup/manual model acquisition with submission-gated readiness,
  download progress/cancellation, and automatic URL/local-media continuation.
- [x] 2026-07-27: Ran automated validation and recorded manual/platform residual risks below;
  this plan is ready for archive.

## Surprises & Discoveries

- Current release code exposes only `iic/SenseVoiceSmall`, uses one readiness marker, starts a
  first-run download guide, and offers manual download controls. These are intentional migration
  targets, not implementation evidence for this plan.
- The existing typed URL/local-media requests and task manifests already contain `asr_model`; the
  implementation must widen their closed whitelist rather than add a second mutable model field.
- The existing model-download worker lane is already separate from task lanes. It must carry a
  selected descriptor rather than remain a global default-model installer.
- `funasr_onnx==0.4.2` has a different model layout from `funasr`: the ONNX ASR, ONNX FSMN VAD,
  and original SenseVoice BPE asset each need their own verified cache entry.
- On this Windows development machine a full Rust library test process can remain resident after
  the harness has started, locking its executable. Isolated-target focused suites compile and pass;
  the test-runner behavior is recorded as a local verification limitation, not treated as a code
  failure.

## Decision Log

- Decision: retain `iic/SenseVoiceSmall` as the default and preserve its source compatibility.
  Rationale: backward compatibility for existing settings, caches, tasks, and user expectations.
  Date/Author: 2026-07-27, User + Codex.
- Decision: the ONNX model uses only official ModelScope `iic/SenseVoiceSmall-onnx` and official
  ModelScope ONNX VAD, with no Hugging Face, mirror, custom archive, or auto-export fallback.
  Rationale: a closed, auditable supply chain. Date/Author: 2026-07-27, User + Codex.
- Decision: a missing selected model installs only after a valid source/account submission and
  resumes that held intent after a second readiness check. Rationale: no startup download and no
  premature task artifacts. Date/Author: 2026-07-27, User + Codex.
- Decision: settings expose selection and status but no standalone Download action. Rationale:
  model acquisition is contextual to a validated user task. Date/Author: 2026-07-27, User + Codex.
- Decision: the Rust worker command receives an allowlisted model ID and Python receives a frozen
  request snapshot; neither settings nor a worker environment value is reread after submission.
  Rationale: settings changes cannot switch an already accepted task. Date/Author: 2026-07-27,
  Codex.
- Decision: package smoke tests import both `funasr_onnx` and `onnxruntime` on Windows/macOS build
  paths. Rationale: lock-file presence alone does not prove bundled-runtime availability.
  Date/Author: 2026-07-27, Codex.

## Outcomes & Retrospective

Implemented the selectable ASR path. `iic/SenseVoiceSmall` remains the default PyTorch-compatible
model; `iic/SenseVoiceSmall-onnx` has a separate `models/onnx` ready layout and is available only
after ASR/VAD/BPE hashes and required files validate. Its downloader accepts only official
ModelScope assets, atomically promotes a complete cache, and never obtains `model.pt`.

The ONNX provider directly constructs `funasr_onnx.SenseVoiceSmall` and `Fsmn_vad` with
`quantize=True` and `textnorm="withitn"`; static boundaries prove it neither imports nor invokes
`funasr.AutoModel`. The Tauri request contract freezes the selected model for both URL and
local-media processing. Settings show status and selection only; submitting a task checks the
selection, obtains the missing model in the existing download lane, then resumes only after a
second readiness check. Cancellation/failure leaves the input intact and creates no task.

Validation on 2026-07-27:

- `uv run ruff check worker` — passed.
- `pytest worker/tests -q` — 608 passed, 2 skipped.
- Targeted Rust unit suites — 44 passed across ASR cache/status, URL snapshot, local-media
  snapshot, model-download command, and progress-contract groups; `cargo fmt --check` passed.
- `npm --prefix app test`, `npm --prefix app run lint`, and `npm --prefix app run build` — passed.
- `node --test scripts/tests/*.test.mjs` — 27 passed.
- `python scripts/validate_agents_docs.py --level WARN` and `git diff --check` — passed.

Residual release evidence: this workstation did not perform a live ModelScope download or
transcription against the 230 MiB model, nor produce/test packaged Windows x64, macOS x64, or
macOS arm64 artifacts. Packaging smoke checks now import both ONNX dependencies on all three build
paths. The full Rust library harness is locally affected by a resident Windows test executable;
focused isolated-target suites above passed and no Rust assertion/compile failure was observed.

## Expected Main Files

| Area | Main files expected to change |
|---|---|
| Governance | `AGENTS.md`, `TASKS.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/SECURITY.md`, the new product spec/design/ExecPlan, and their indexes |
| Contract and Rust | `contracts/desktop-worker-contract.json`, `app/src-tauri/src/asr_model.rs`, `settings.rs`, `video_processing.rs`, `worker_runtime/{command,facade,mod}.rs`, and Rust contract/runtime tests |
| Python | `worker/frameq_worker/{asr.py,requests.py,desktop_contract.py,model_download.py,progress_events.py}`, `asr_runtime/{registry,sensevoice}.py`, `worker_application/model_download.py`, task-store/pipeline owners, and focused tests |
| Frontend | `app/src/{App.tsx,workflow.ts,settingsClient.ts,workerClient.ts,desktopWorkerProtocol.ts}`, `features/asrModel/*`, `i18n/asrModelResources.ts`, contract tests, and workflow/UI tests |

## Plan of Work

### Task 1: Align the Descriptor and Typed Contract — Complete

- [x] Define the exact two-entry descriptor/whitelist in every contract-owning layer.
- [x] Keep `iic/SenseVoiceSmall` the default; reject all unknown IDs.
- [x] Extend URL and local-media request, manifest/history, and progress schemas consistently.
- [x] Add RED/GREEN tests proving task model snapshots do not reread mutable settings.

### Task 2: Implement Secure Per-Model Acquisition — Complete

- [x] Preserve PyTorch cache/source compatibility under its existing descriptor.
- [x] Implement an isolated ONNX staging/ready cache and pinned manifest with required runtime
  files, the official original-model BPE asset, and SHA256 validation.
- [x] Download ONNX ASR and ONNX VAD only from their specified official ModelScope IDs.
- [x] Atomically promote only a full verified cache; prove cancellation/failure cannot create ready
  state or damage an existing cache.

### Task 3: Implement Direct ONNX Transcription — Complete

- [x] Add direct `funasr_onnx` SenseVoiceSmall construction with `quantize=True` and
  `textnorm='withitn'`.
- [x] Use direct FSMN VAD when ready; allow only a VAD-to-direct-full-audio ONNX fallback.
- [x] Prove no `funasr.AutoModel`, export path, runtime conversion, or provider/model fallback is
  reachable from the ONNX path.

### Task 4: Add Submission-Gated Install and Resume — Complete

- [x] Validate source and account gates, validate/snapshot the selected model, then check readiness
  before creating a processing task.
- [x] Hold one URL/local-media intent while the separate model-install lane runs; block model
  changes and new submissions during the install.
- [x] On success, revalidate and automatically continue the held intent. On cancel/failure/offline,
  preserve selection/intent but create no task, manifest, media cache, or process-video worker.

### Task 5: Replace the Frontend Entry Points — Complete

- [x] Remove automatic first-run download and manual settings download behavior.
- [x] Show model selection/status in settings and the submit-triggered install sheet with progress,
  cancellation, safe error, and automatic resume.
- [x] Cover ready, missing, cancelled, failed, offline, local-media, URL, and blocked-control
  states in frontend tests.

### Task 6: Verify and Close Governance — Complete with recorded external residuals

- [x] Run the required automated gates and inspect the final diff for no bundled weights, no new
  external source, no leaked download diagnostics, and no task before model readiness.
- [x] Record the clean-install and offline manual checks as external release evidence not run on
  this workstation; no automated test claims otherwise.
- [x] Record evidence, residual risks, and completion outcome before archiving this ExecPlan.

## Validation Commands

```powershell
uv run pytest worker\tests
uv run ruff check worker
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo fmt --manifest-path app/src-tauri/Cargo.toml --check
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
node --test scripts/tests/*.test.mjs
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Manual validation must additionally prove: no model network request at startup; either installed
model runs offline; missing ONNX offline creates no task; ONNX receives only its official
ModelScope ASR/VAD requests; cancel/fail retains the selected model; and a successful install
automatically resumes both URL and local-media intents.
