# ASR Application Module Split Implementation Plan

**Archived:** 2026-07-21 after explicit user acceptance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Use test-driven-development for every behavior lock and ownership move.

**Goal:** Split the 676-line Python ASR application module into focused private owners while
preserving `frameq_worker.asr` as the exact stable import surface and changing no ASR, artifact,
contract, pipeline, packaging, or user-visible behavior.

**Architecture:** `worker/frameq_worker/asr.py` remains a thin module facade. A private
`asr_runtime/` package owns types/errors, registry/cache/factory policy, Qwen integration,
SenseVoice/VAD integration, and transcript artifact writing. Production callers may use only the
stable root; AST boundary tests enforce dependency direction and exact root re-export identities.

**Tech Stack:** Python 3.12, dataclasses, Protocol, pathlib/json/wave, injected fake provider models,
pytest, Ruff, Node contract/governance tests, React/Vitest, Rust/Cargo/Tauri packaging validation.

---

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ users should observe no change. URL and future local-media workflows still choose the same
ASR model, transcribe the same prepared audio, produce the same transcript text/metadata/segments,
and fail or fall back under the same conditions. Current imports from `frameq_worker.asr` continue
to work without caller changes.

The improvement is internal and reviewable: provider SDKs, optional VAD/WAV behavior, model registry
and cache policy, and transcript artifact writes each have one owner. A future provider change no
longer exposes unrelated local artifact code to accidental edits, and a future transcript-format
change does not require touching model initialization.

This plan does not implement local-media runtime behavior, change a product spec, introduce an
`ASRFacade` class, or alter any worker/desktop contract.

## Progress

- [x] 2026-07-20: Re-inspected `worker/frameq_worker/asr.py`, all production callers, focused ASR
  tests, the code-audit hotspot table, durable architecture/security rules, governance workflow,
  and the active local-media plan. Evidence: 676 physical production lines; 434-line separate test
  file; root imports used by CLI, requests, pipeline, worker service, subtitles, and tests.
- [x] 2026-07-20: Created isolated worktree `.worktrees/codex-asr-module-split-plan` on branch
  `codex/asr-module-split-plan` from clean commit `0157e81`; `main` remained untouched.
- [x] 2026-07-20: Established the pre-change baseline. Validation:
  `D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_asr.py -q` passed 18/18;
  `python scripts/validate_agents_docs.py --level WARN` reported 0 errors and 0 warnings. The only
  test warning was the existing `pydub.utils`/`audioop` Python 3.13 deprecation watch.
- [x] 2026-07-20: Recorded the proposed design and registered this active ExecPlan without modifying
  production code. Validation: `python scripts/validate_agents_docs.py --level WARN` reported 0
  errors and 0 warnings; the new-doc unfinished-marker scan, planning-only path scope check, and
  `git diff --check` passed.
- [x] 2026-07-20: Obtained explicit user approval of the design and ExecPlan before implementation.
  Evidence: the user replied `文档已确认，请进入实现` in this thread.
- [x] 2026-07-20: Added five behavior characterizations and established the expected ownership RED.
  Validation: focused ASR passed 23/23; the boundary suite failed 1/9 only because the approved six
  private files did not exist and skipped the eight dependent checks; focused Ruff passed.
- [x] 2026-07-20: Extracted types, Qwen, SenseVoice/VAD, registry/cache, and artifacts one owner at
  a time with focused GREEN evidence. The stable root is now 52 lines; private owner sizes are
  types 95, Qwen 77, SenseVoice 316, registry 113, and artifacts 132 lines.
- [x] 2026-07-20: Turned the ownership RED green. Validation: boundary 9/9, combined ASR/boundary
  32/32, fresh-process lazy-import 1/1, downstream CLI/pipeline/task-artifact 43/43, contract/
  request/CLI 86/86, and focused Ruff passed.
- [x] 2026-07-20: Passed full cross-layer and packaging validation and updated durable architecture,
  security, audit, design, and task evidence. Worker 515/515, scripts 23/23 plus installer 5/5,
  app 549/549, native Windows Rust 173/173, Ruff/rustfmt/lint/build/Tauri no-bundle, and recursive
  56-file worker mirror equality passed.
- [x] 2026-07-21: Obtained explicit implementation acceptance. The user requested a local commit
  followed by a local merge to `main`; the task and design are accepted and this plan is archived.

## Surprises & Discoveries

- Evidence: all 676 physical lines in `asr.py` are production code. Unlike recent Rust hotspots,
  moving an inline test module cannot produce a superficial size reduction; ownership must actually
  move.
- Evidence: `frameq_worker.asr` is already a de facto internal compatibility facade. Five production
  modules and several test suites import its types, constants, adapters, factory functions, and
  artifact writer, so replacing it with provider-specific imports would broaden coupling.
- Evidence: SenseVoice has two intentionally different failure paths. Optional VAD/inference/WAV
  failures return `None` and fall back; failure of the main full-audio `generate` call is wrapped as
  a terminal `ASRRuntimeError`.
- Evidence: `write_transcript_files` projects/validates a canonical source URL before it creates the
  output directory. Moving `mkdir` earlier would weaken a current no-side-effect-on-invalid-source
  property.
- Evidence: current provider exceptions are wrapped using `ASRRuntimeError(str(exc))`. That text is
  not guaranteed to be sanitized by this layer; this structural refactor must preserve the current
  error contract without adding a new log or persistence path.
- Evidence: the canonical worker source is copied recursively into an ignored Tauri resource mirror
  by the established installer/build path. Adding a private package is safe only if final validation
  compares the complete generated file set and bytes rather than hand-editing the mirror.
- Evidence: the active local-media plan has landed Contract v4 foundations but still has pending
  runtime work. It requires one shared ASR path and deliberately keeps ASR outside
  `MediaPreparationFacade`; this refactor must not implement or pre-empt that source/runtime work.
- Evidence: focused ASR tests pass on the current runtime with an existing `pydub.utils` import
  warning about `audioop`. Dependency replacement or Python 3.13 migration is separate tracked debt.
- Evidence: transcript writers use `Path.write_text` without overriding newline translation, so the
  exact `.txt` bytes end in `os.linesep` (`CRLF` on Windows), while `read_text` normalizes them.
  Characterization now locks this existing platform behavior instead of manufacturing fixed LF.
- Evidence: the isolated worktree intentionally had no ignored `app/node_modules`. The first scripts
  run therefore failed seven TypeScript-backed tests because `typescript` could not be resolved,
  not because an assertion failed. Reusing the main worktree's ignored dependency directory through
  a local junction restored the established environment; the exact command then passed 23/23.
- Evidence: the sandboxed Cargo run passed 172 tests and failed only the existing Windows
  blocked-stdin cancellation test because `taskkill` was denied. The unchanged full command passed
  173/173 under normal Windows process permissions; no runtime code was changed for the sandbox.
- Evidence: an initial ad-hoc mirror check used a .NET path helper unavailable in Windows
  PowerShell 5.1. Its non-terminating errors made its zero-file result invalid, so it was discarded.
  The corrected fail-fast comparison enumerated relative paths without that helper and verified the
  complete 56-file set and SHA-256 values.

## Decision Log

- Decision: Keep `worker/frameq_worker/asr.py` as the only supported production ASR import surface.
  Rationale: current callers need a stable composition boundary, and migrating them to private
  implementation files would increase coupling. Date/Author: 2026-07-20, User + Codex.
- Decision: Use the private package name `asr_runtime/` instead of `asr/`.
  Rationale: it avoids a file/package name collision with the stable `asr.py` module and makes the
  private implementation status explicit. Date/Author: 2026-07-20, User + Codex.
- Decision: Split by five failure/dependency owners—types, registry, Qwen, SenseVoice, artifacts—and
  keep `asr_runtime/__init__.py` empty.
  Rationale: each owner has a distinct SDK, environment, fallback, or filesystem boundary; a package
  facade or generic helper bucket is unnecessary. Date/Author: 2026-07-20, User + Codex.
- Decision: Re-export the actual private objects from the root rather than redefining classes or
  wrapper functions.
  Rationale: root imports retain exact identity and signatures. Compatibility covers root names and
  behavior, not private `__module__` metadata or pickle bytes, which FrameQ does not persist.
  Date/Author: 2026-07-20, User + Codex.
- Decision: Keep the stable root as explicit `name as name` import bindings and do not introduce an
  `__all__` migration.
  Rationale: explicit bindings satisfy lint while preserving named imports as the authoritative
  compatibility surface; changing wildcard-export policy is unrelated to this extraction.
  Date/Author: 2026-07-20, Codex.
- Decision: Preserve current non-atomic transcript artifact writes.
  Rationale: transactional multi-file output would change failure/recovery behavior and needs a
  separate design, not a structural extraction. Date/Author: 2026-07-20, User + Codex.
- Decision: Do not create or update a product specification for this refactor.
  Rationale: no user-visible behavior, contract, schema, model selection, file shape, or packaging
  policy changes. Date/Author: 2026-07-20, User + Codex.
- Decision: Modify only canonical worker sources; never hand-edit the ignored packaged mirror.
  Rationale: the installer/build path owns mirror refresh, and recursive equality is the packaging
  gate. Date/Author: 2026-07-20, User + Codex.

## Outcomes & Retrospective

Implementation was accepted on 2026-07-21. The 676-line mixed module became
a 52-line stable root plus five private owners: types 95, Qwen 77, SenseVoice 316, registry 113, and
artifacts 132 physical lines. The empty initializer and AST/import gates make ownership, root-only
production access, lazy SDK loading, provider-to-registry direction, and exclusive low-level effects
executable constraints rather than documentation alone.

Five new behavior characterizations protect unsupported-model errors, provider exception causes,
optional VAD fallback, exact no-stem artifacts, and validation-before-directory-creation. The
boundary test moved from the intended missing-tree RED to 9/9 GREEN; focused ASR/boundary is 32/32,
and full worker validation is 515/515. Cross-layer app, Rust, scripts, build, lint, governance, and
packaging gates pass without contract, UI, server, manifest, local-media runtime, model lifecycle,
or dependency changes. The ignored packaged worker was refreshed through the established path and
matches all 56 canonical files byte-for-byte.

No real model smoke was run. Residual risk is limited to third-party SDK behavior that depends on
implementation module metadata and real packaged-model inference not exercised by fake adapters.
The existing Python 3.13 `pydub`/`audioop` and Vite chunk-size warnings remain separate debt.

## Context and Orientation

- Approved design: `docs/design-docs/2026-07-20-asr-module-split.md`.
- Stable compatibility root: `worker/frameq_worker/asr.py`.
- Private implementation owners: `worker/frameq_worker/asr_runtime/`.
- Existing focused behavior tests: `worker/tests/test_asr.py` (18 passing at baseline).
- New ownership tests: `worker/tests/test_asr_module_boundaries.py`.
- Stable production consumers:
  - `worker/frameq_worker/cli.py`;
  - `worker/frameq_worker/requests.py`;
  - `worker/frameq_worker/pipeline.py`;
  - `worker/frameq_worker/worker_service.py`; and
  - `worker/frameq_worker/subtitles.py`.
- Cross-suite type consumers include `worker/tests/test_cli.py`, `test_contract.py`,
  `test_pipeline.py`, and `test_task_artifacts.py`.
- Canonical packaging copy path: `scripts/build-installer.mjs` and its existing worker-resource
  equality tests.
- Durable boundaries to preserve: `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and
  `docs/design-docs/frameq-code-audit-uml.md`.
- Independent pending feature: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`.

## Target File Responsibility Map

| File | Responsibility after implementation |
|---|---|
| `worker/frameq_worker/asr.py` | stable root imports/re-exports only; no provider, VAD, cache, source-identity, JSON, Markdown, or filesystem implementation |
| `worker/frameq_worker/asr_runtime/__init__.py` | empty package marker; no public re-exports |
| `worker/frameq_worker/asr_runtime/types.py` | error hierarchy, transcript DTOs, protocol/type aliases/model spec, shared provider-result text coercion and fixed dependency guidance |
| `worker/frameq_worker/asr_runtime/registry.py` | default/cache constants, ordered specs, model resolution/display/family, project cache policy, ModelScope cache environment, adapter factories |
| `worker/frameq_worker/asr_runtime/qwen.py` | Qwen model ID, adapter, lazy `qwen_asr` import/model creation, provider call and error/empty-result mapping |
| `worker/frameq_worker/asr_runtime/sensevoice.py` | SenseVoice model/VAD constants and tag pattern, adapter, lazy `funasr` import, normalization/segments, optional VAD path, WAV decode/slice, full-audio fallback |
| `worker/frameq_worker/asr_runtime/artifacts.py` | transcription composition, source validation, filenames, transcript Markdown, JSON sidecar, stale-sidecar removal |
| `worker/tests/test_asr.py` | behavior characterization independent of implementation module placement |
| `worker/tests/test_asr_module_boundaries.py` | exact file/symbol/import ownership and stable-root identity gates |

The following production files remain unchanged throughout the refactor:

- `worker/frameq_worker/cli.py`;
- `worker/frameq_worker/requests.py`;
- `worker/frameq_worker/pipeline.py`;
- `worker/frameq_worker/worker_service.py`;
- `worker/frameq_worker/subtitles.py`;
- all `contracts/`, `app/`, and `server/` production sources; and
- task manifest, media preparation, progress, model download, and local-media runtime sources.

## Stable Target Interfaces

The internal modules expose only what the stable root and adjacent private modules require. The
implementation may refine private annotations, but it may not weaken ownership or change public
root signatures.

```python
# asr_runtime/types.py
class ASRError(RuntimeError): ...
class ASRDependencyError(ASRError): ...
class ASRRuntimeError(ASRError): ...
class ASREmptyTranscriptError(ASRRuntimeError): ...
class ASRUnsupportedModelError(ASRRuntimeError): ...

@dataclass(frozen=True)
class TranscriptSegment: ...

@dataclass(frozen=True)
class Transcript: ...

@dataclass(frozen=True)
class TranscriptArtifacts: ...

class Transcriber(Protocol): ...
ModelFactory = Callable[..., Any]

@dataclass(frozen=True)
class AsrModelSpec: ...

def extract_provider_text(results: object) -> str: ...
def missing_dependency_message(exc: ModuleNotFoundError, runtime_name: str) -> str: ...
```

The two formerly private helpers receive non-underscore names only inside the private package so
provider modules can share them. They are not added to the stable root surface.

```python
# asr_runtime/registry.py
def supported_asr_model_names() -> list[str]: ...
def resolve_asr_model_name(model_name: str | None) -> str: ...
def asr_model_display_name(model_name: str) -> str: ...
def asr_model_family(model_name: str) -> str: ...
def resolve_model_cache_dir(project_root: Path, environ: dict[str, str] | None = None) -> Path: ...
def configure_modelscope_cache_dir(cache_dir: str | PathLike[str] | Path) -> Path: ...
def build_qwen_asr_transcriber(...) -> QwenAsrTranscriber: ...
def build_sensevoice_transcriber(...) -> SenseVoiceTranscriber: ...
def build_asr_transcriber(...) -> Transcriber: ...
```

```python
# asr_runtime/artifacts.py
def transcribe_and_write(
    audio_path: Path,
    output_dir: Path,
    output_stem: str,
    transcriber: Transcriber,
    language: str = "Chinese",
    model: str = DEFAULT_ASR_MODEL,
    source_identity: SourceIdentity | None = None,
) -> TranscriptArtifacts: ...

def write_transcript_files(
    text: str,
    output_dir: Path,
    output_stem: str,
    model: str | None = None,
    metadata: TranscriptMetadata | None = None,
    segments: tuple[TranscriptSegment, ...] = (),
) -> TranscriptArtifacts: ...
```

`QwenAsrTranscriber` and `SenseVoiceTranscriber` preserve their current constructors and
`transcribe` signatures exactly. The stable root imports/re-exports these definitions and every
repository-observed constant/function named in the design.

## Plan of Work

### Task 1: Lock Behavior Gaps and Establish the Ownership RED

**Files:**

- Modify: `worker/tests/test_asr.py`
- Create: `worker/tests/test_asr_module_boundaries.py`

- [x] Add `test_unknown_model_keeps_stable_error_contract`. Assert the exact exception type,
  `ASR_MODEL_UNSUPPORTED` code, and current `Unsupported ASR model: <value>` message.
- [x] Add `test_provider_failures_keep_runtime_error_contract` using injected Qwen and SenseVoice
  fake models whose main call raises a deterministic exception. Assert `ASRRuntimeError`, code
  `ASR_RUNTIME_ERROR`, exact current message, and preserved `__cause__` without logging it.
- [x] Add `test_sensevoice_vad_failure_falls_back_to_full_audio_generate`. Use a fake model exposing
  VAD/inference whose VAD path raises, plus a successful `generate`; assert the final transcript and
  one full-audio call instead of a public error.
- [x] Add `test_no_stem_artifacts_keep_paths_metadata_and_bytes`. Assert `transcript.txt`,
  `transcript.md`, optional `segments.json`, current Chinese Markdown header/metadata ordering,
  UTF-8 content, JSON indentation, `ensure_ascii=False`, and trailing newlines.
- [x] Strengthen source-identity characterization with a not-yet-created output directory. Supply an
  invalid persistence identity, assert the current fixed failure, and assert the output directory
  still does not exist.
- [x] Run the focused behavior suite before any production movement:

  ```powershell
  uv run pytest worker/tests/test_asr.py -q
  ```

  Require the baseline 18 tests plus the new characterization tests to pass.
- [x] Create AST/path-based boundary tests that require:
  - exactly `__init__.py`, `types.py`, `registry.py`, `qwen.py`, `sensevoice.py`, and `artifacts.py`;
  - an empty initializer;
  - the approved owner symbols in each file;
  - no low-level provider/VAD/artifact symbols remaining in root `asr.py`;
  - exact stable-root identity for errors, DTOs, protocol, adapters, registry/artifact functions,
    plus exact constant values and supported-model order;
  - a stable-root import in a fresh Python process does not load `qwen_asr`, `funasr`, or `numpy`;
  - no production import of `frameq_worker.asr_runtime.*` outside the private package;
  - no private back-edge into the root or application orchestration; and
  - the exclusive SDK/environment/source-identity import ownership from the design.
- [x] Run only the new suite and require RED solely because the approved `asr_runtime/` files are
  absent:

  ```powershell
  uv run pytest worker/tests/test_asr_module_boundaries.py -q
  ```

  Record the missing target package/file assertion as the expected RED. A syntax, import,
  dependency, or behavior failure is not an acceptable RED.

### Task 2: Extract ASR Types, Errors, and Shared Provider Contract Helpers

**Files:**

- Create: `worker/frameq_worker/asr_runtime/__init__.py`
- Create: `worker/frameq_worker/asr_runtime/types.py`
- Modify: `worker/frameq_worker/asr.py`
- Test: `worker/tests/test_asr.py`
- Test: `worker/tests/test_asr_module_boundaries.py`

- [x] Add an empty package initializer with no imports or `__all__`.
- [x] Move the five exception classes without changing inheritance or `code` values.
- [x] Move `TranscriptSegment`, its conditional `speaker` JSON projection, `Transcript`,
  `TranscriptArtifacts`, `Transcriber`, `ModelFactory`, and `AsrModelSpec` without changing fields,
  defaults, frozen semantics, or annotations.
- [x] Move `_extract_text` and `_missing_dependency_message` as private-package shared contract
  helpers named `extract_provider_text` and `missing_dependency_message`; preserve exact accepted
  result containers and dependency guidance.
- [x] Re-export the actual errors/data/protocol/type objects from `frameq_worker.asr`. Do not create
  subclasses, duplicate dataclasses, aliases to wrappers, or compatibility shims with new
  signatures.
- [x] Temporarily update the still-root provider implementations to import/use these objects. Do not
  move registry, provider, VAD, or artifact behavior in the same step.
- [x] Run:

  ```powershell
  uv run pytest worker/tests/test_asr.py -q
  uv run pytest worker/tests/test_cli.py worker/tests/test_pipeline.py worker/tests/test_task_artifacts.py -q
  uv run ruff check worker/frameq_worker/asr.py worker/frameq_worker/asr_runtime/types.py worker/tests/test_asr.py worker/tests/test_asr_module_boundaries.py
  ```

  Require all behavior/import consumers to pass. The complete boundary suite may remain RED only
  for the still-missing approved owner modules.

### Task 3: Extract the Qwen Provider Adapter

**Files:**

- Create: `worker/frameq_worker/asr_runtime/qwen.py`
- Modify: `worker/frameq_worker/asr.py`
- Test: `worker/tests/test_asr.py`
- Test: `worker/tests/test_asr_module_boundaries.py`

- [x] Move `QWEN_ASR_MODEL` and `QwenAsrTranscriber` intact, importing only pathlib/typing plus the
  required objects from `types.py`.
- [x] Keep the default `qwen_asr` import inside `_load_default_model`; importing the module must not
  import or initialize the SDK.
- [x] Preserve lazy single-instance model caching, `from_pretrained` arguments, transcribe call
  shape, text trimming, empty-result error, missing dependency guidance, and runtime exception
  cause.
- [x] Re-export the provider constant value and actual adapter class from the root. Keep registry
  factory functions in the root temporarily until Task 5 so each behavior move has one
  responsibility.
- [x] Run:

  ```powershell
  uv run pytest worker/tests/test_asr.py -q -k "qwen or provider_failures or dependency"
  uv run pytest worker/tests/test_asr.py -q
  uv run ruff check worker/frameq_worker/asr.py worker/frameq_worker/asr_runtime/qwen.py worker/frameq_worker/asr_runtime/types.py
  ```

  Require exact constructor/provider/error characterization to remain green.

### Task 4: Extract SenseVoice, Normalization, VAD, and WAV Ownership

**Files:**

- Create: `worker/frameq_worker/asr_runtime/sensevoice.py`
- Modify: `worker/frameq_worker/asr.py`
- Test: `worker/tests/test_asr.py`
- Test: `worker/tests/test_asr_module_boundaries.py`

- [x] Move `SENSEVOICE_SMALL_MODEL`, both SenseVoice VAD constants, `SenseVoiceTranscriber`, tag
  pattern, language mapping, tag cleaning, sentence-info and timing coercion, segment extraction,
  VAD extraction/merge/inference, PCM WAV decoding, and audio slicing into `sensevoice.py`.
- [x] Keep `funasr.AutoModel` inside the default loader and optional `numpy`/
  `funasr.utils.vad_utils.merge_vad` inside the VAD path. Do not promote them to eager imports.
- [x] Preserve model kwargs and precedence: the constructor always provides the existing VAD model
  and maximum segment time, then accepts current caller overrides exactly as today.
- [x] Preserve full-audio generate kwargs, language mapping, tag removal, sentence filtering,
  speaker normalization, segment IDs/order/timing, text joins, and empty-result behavior.
- [x] Preserve the broad optional-VAD fallback boundary. Missing optional imports and any VAD,
  merge, WAV, slicing, or block inference exception return `None`; they do not become public errors.
- [x] Re-export the public model/VAD constant values listed in the design and the actual adapter from
  root, leaving registry/cache functions for Task 5. Keep the tag pattern private. The provider
  module must not import `registry.py`.
- [x] Run:

  ```powershell
  uv run pytest worker/tests/test_asr.py -q -k "sensevoice or vad or provider_failures or dependency"
  uv run pytest worker/tests/test_asr.py -q
  uv run ruff check worker/frameq_worker/asr.py worker/frameq_worker/asr_runtime/sensevoice.py worker/frameq_worker/asr_runtime/types.py
  ```

  Require both successful segmented VAD and fallback-to-full-audio paths to pass.

### Task 5: Extract Model Registry, Cache Policy, and Factory Selection

**Files:**

- Create: `worker/frameq_worker/asr_runtime/registry.py`
- Modify: `worker/frameq_worker/asr.py`
- Test: `worker/tests/test_asr.py`
- Test: `worker/tests/test_contract.py`
- Test: `worker/tests/test_asr_module_boundaries.py`

- [x] Move `DEFAULT_ASR_MODEL`, both cache environment constants, `SUPPORTED_ASR_MODELS`,
  enumeration, resolution/display/family functions, project cache resolution, ModelScope cache
  setup, and all three adapter factory functions. Import provider model/VAD constants from
  `qwen.py` and `sensevoice.py`; never create the reverse dependency.
- [x] Preserve the exact supported order, default model, display/family values, unsupported-model
  error text, path handling, directory creation timing, POSIX cache values, and environment
  mutation.
- [x] Import the two concrete adapters from their private modules and return the same class instances
  with the same kwargs. Do not add a plugin registry, service locator, provider discovery, or
  fallback between models.
- [x] Re-export the actual spec tuple/functions and exact constant values from root so contract and
  production callers remain unchanged.
- [x] Run:

  ```powershell
  uv run pytest worker/tests/test_asr.py -q -k "model or cache or factory or unknown"
  uv run pytest worker/tests/test_contract.py worker/tests/test_requests.py worker/tests/test_cli.py -q
  uv run pytest worker/tests/test_asr.py -q
  uv run ruff check worker/frameq_worker/asr.py worker/frameq_worker/asr_runtime/registry.py worker/frameq_worker/asr_runtime/qwen.py worker/frameq_worker/asr_runtime/sensevoice.py
  ```

  Require stable default/contract imports and exact factory behavior.

### Task 6: Extract Transcript Artifact Writing

**Files:**

- Create: `worker/frameq_worker/asr_runtime/artifacts.py`
- Modify: `worker/frameq_worker/asr.py`
- Test: `worker/tests/test_asr.py`
- Test: `worker/tests/test_task_artifacts.py`
- Test: `worker/tests/test_pipeline.py`
- Test: `worker/tests/test_asr_module_boundaries.py`

- [x] Move `transcribe_and_write`, `write_transcript_files`, and Markdown formatting into
  `artifacts.py` with only the necessary types, registry default, metadata, source identity, JSON,
  and pathlib dependencies.
- [x] Preserve operation order: reject blank text; create/accept metadata; validate canonical source
  persistence; then create the output directory and write official files.
- [x] Preserve exact stem/no-stem filenames, `.txt` newline, Markdown header and metadata order,
  canonical source URL rule, JSON wrapper/indentation/Unicode/newline, segment serialization, stale
  sidecar deletion, and returned paths/text.
- [x] Preserve direct multi-file writes. Do not introduce temporary files, rollback, transaction
  claims, or new error wrapping in this structural task.
- [x] Re-export the actual functions from root.
- [x] Run:

  ```powershell
  uv run pytest worker/tests/test_asr.py -q -k "artifact or transcript_files or source_identity or no_stem"
  uv run pytest worker/tests/test_task_artifacts.py worker/tests/test_pipeline.py -q
  uv run pytest worker/tests/test_asr.py -q
  uv run ruff check worker/frameq_worker/asr.py worker/frameq_worker/asr_runtime/artifacts.py worker/frameq_worker/asr_runtime/types.py
  ```

  Require byte/path/source-validation characterization to remain green.

### Task 7: Finish the Stable Root and Turn the Boundary Suite Green

**Files:**

- Modify: `worker/frameq_worker/asr.py`
- Modify: `worker/tests/test_asr_module_boundaries.py`
- Verify: all files under `worker/frameq_worker/asr_runtime/`

- [x] Remove all remaining implementation from `asr.py`; retain only explicit
  imports/re-exports of the approved public surface.
- [x] Do not add a new `__all__` migration or alter `cli.py` exports. Existing Python import
  behavior, including named imports, remains authoritative.
- [x] Require `asr.py` to remain below 120 physical lines and contain no imports of `json`, `os`,
  `re`, `wave`, `funasr`, `numpy`, `qwen_asr`, `TranscriptMetadata`, `SourceIdentity`, or
  `canonical_url_for_persistence`.
- [x] Require exact root/private identity for all errors, DTOs, protocol/spec types, adapters, spec
  tuple, registry/cache/factory functions, and artifact functions; require exact values for every
  public constant and exact supported-model order.
- [x] Require no production caller bypasses root and no private module imports root or application
  orchestration.
- [x] Run the prior expected RED and require GREEN:

  ```powershell
  uv run pytest worker/tests/test_asr_module_boundaries.py -q
  uv run pytest worker/tests/test_asr.py worker/tests/test_asr_module_boundaries.py -q
  uv run ruff check worker/frameq_worker/asr.py worker/frameq_worker/asr_runtime worker/tests/test_asr.py worker/tests/test_asr_module_boundaries.py
  ```

- [x] Run the fresh-process stable-root import characterization:

  ```powershell
  uv run pytest worker/tests/test_asr_module_boundaries.py -q -k "stable_root_import"
  ```

  Require the subprocess import to succeed and report that no provider SDK module was loaded; no
  model download/provider call may occur.

### Task 8: Full Regression, Packaging, and Documentation Closeout

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/2026-07-20-asr-module-split.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md` only if measured evidence changes tracked debt
- Modify: `TASKS.md`
- Modify: `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`
- Move after acceptance:
  `docs/exec-plans/active/2026-07-20-asr-module-split-plan.md` to
  `docs/exec-plans/completed/2026-07-20-asr-module-split-plan.md`

- [x] Run full Python validation:

  ```powershell
  uv run pytest worker/tests -q
  uv run ruff check worker
  ```

- [x] Run contract/governance scripts:

  ```powershell
  node --test scripts/tests/*.test.mjs
  node --test scripts/tests/build-installer.test.mjs
  python scripts/validate_agents_docs.py --level WARN
  ```

- [x] Run app and Rust regressions even though production app/Rust sources are out of scope:

  ```powershell
  npm --prefix app test
  npm --prefix app run lint
  npm --prefix app run build
  cargo test --manifest-path app/src-tauri/Cargo.toml
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  npm --prefix app run tauri -- build --no-bundle
  ```

  If the known Windows blocked-stdin process test is denied by the sandbox, reproduce that exact
  permission-only failure and rerun the same Cargo command in the established native environment;
  do not change runtime code to accommodate the sandbox.
- [x] Refresh the ignored Tauri worker resource only through the established build/copy path when
  required by packaging validation. Run the existing recursive mirror test and require the complete
  relative file set and bytes to match canonical `worker/frameq_worker`, including the new private
  package. Do not stage generated resources.
- [x] Run final scope and whitespace gates:

  ```powershell
  git diff --check
  git status --short
  ```

  Require production changes to be limited to canonical `asr.py`, `asr_runtime/`, and tests. Reject
  changes to contracts, app/server production, other worker application modules, task manifests,
  model-download behavior, local-media runtime, or dependency lockfiles.
- [x] Update durable architecture with the stable ASR module facade, private owner tree, and
  dependency direction. Update security with lazy SDK boundaries, no-new-log rule, source validation
  before filesystem mutation, and canonical/generated worker ownership.
- [x] Update the code audit with measured final sizes, resolved hotspot ownership, test counts, and
  exact evidence. Do not mark the item resolved before implementation gates pass.
- [x] Change the design status to implemented/accepted, complete Progress/Surprises/Decisions/
  Outcomes with measured evidence, mark the TASKS item complete, move this plan to `completed/`, and
  update all indexes only after user acceptance.
- [x] Do not commit, merge, push, tag, create a PR, or delete the worktree without explicit user
  authorization.

## Test and Acceptance Matrix

| Area | Automated evidence | Acceptance |
|---|---|---|
| stable imports | `test_asr_module_boundaries.py`, CLI/pipeline/task artifact suites | all current production imports remain rooted at `frameq_worker.asr`; definition/function identities and constant values/order hold |
| registry/cache | focused ASR characterization | order/default/names/families/errors/cache paths/environment are unchanged |
| Qwen | injected fake factory/model tests | lazy load, args, text/empty/dependency/runtime semantics unchanged |
| SenseVoice full audio | injected fake model tests | fixed model/generate args, language, cleaning, sentences and errors unchanged |
| SenseVoice VAD | fake VAD/WAV/import/failure matrix | success preserves segments; every optional failure still falls back |
| artifacts | ASR/task artifact/pipeline tests | pre-write source validation, filenames, Markdown/JSON bytes and stale removal unchanged |
| ownership | AST/path boundary suite | five private owners, empty initializer, no bypass/back-edge, exclusive low-level dependencies |
| packaging | existing recursive worker mirror test and Tauri no-bundle build | canonical and generated file sets/bytes agree; private package is bundled |
| cross-layer regression | full worker/app/Rust/scripts/gov/build gates | no contract, UI, task, local-media, AI, server or model lifecycle regression |

## Manual and Residual Validation

No real ASR model is downloaded or loaded by the automated plan. Injected fake models cover the
provider API contract and failure behavior deterministically. A real SenseVoice transcription smoke
against an already installed local model is optional release evidence, not a condition for this
structural refactor. Qwen is retained in worker code but is not the current desktop release path.

If real-model smoke is not run, record these residual risks explicitly:

- third-party SDK runtime introspection may depend on implementation module metadata not exercised
  by fake models, although current adapters pass ordinary class instances and functions;
- native packaged-worker import discovery must rely on the Tauri no-bundle build and recursive
  mirror equality rather than a downloaded-model inference; and
- the existing `pydub`/`audioop` Python 3.13 compatibility warning remains separate debt.

No cloud LLM, AI Credit, network model download, or user media is required for acceptance.

## Rollback and Recovery

The extraction is behavior-preserving and is implemented in an isolated worktree. During
implementation, keep behavior green after each owner move. If a step changes behavior:

1. stop at that owner;
2. compare the moved implementation against the baseline version at `0157e81`;
3. restore the exact operation order/signature/error behavior for that owner;
4. rerun its focused characterization and boundary subset; and
5. continue only after the focused suite is green.

Do not roll back by weakening tests, introducing compatibility wrappers with different identities,
changing callers to private imports, or broadening exception handling. Do not use destructive Git
reset/checkout commands. No persistent data migration exists, so source rollback is sufficient.
