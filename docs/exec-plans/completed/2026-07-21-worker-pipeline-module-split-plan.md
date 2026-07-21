# Worker Pipeline Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Use superpowers:test-driven-development for characterization and ownership
> gates, and use superpowers:verification-before-completion before claiming completion. Steps use
> checkbox (`- [x]`) syntax for tracking.

**Goal:** Split the Python worker pipeline hotspot into private shared, transcript, insights, and
URL-orchestration owners behind the unchanged `frameq_worker.pipeline` import surface without
changing requests, task lifecycle, artifacts, progress, AI calls, or product behavior.

**Architecture:** `worker/frameq_worker/pipeline.py` becomes a direct-re-export-only compatibility
root under 100 physical lines. An empty-initializer `pipeline_runtime/` package owns four closed
responsibilities: shared path/progress/failure policy, subtitle/ASR stages, official-transcript AI
generation, and URL task orchestration. Existing production callers keep importing the stable root;
AST and object-identity tests enforce the private dependency direction.

**Tech Stack:** Python 3.13, pytest, Ruff, dataclasses and pathlib, existing FrameQ ASR/media/task
facades, InsightFlow adapters, Node governance tests, Vitest/TypeScript regressions, Rust/Tauri
packaging validation.

---

> This ExecPlan is a living document. Progress, Surprises & Discoveries, Decision Log, and Outcomes
> & Retrospective must be updated as implementation proceeds. Do not create commits, merge, push,
> or clean up the worktree without separate user authorization.

## Purpose / Big Picture

FrameQ users should observe no difference. A URL process request must still create one task, enter
media preparation through `MediaPreparationFacade`, prefer a usable platform subtitle, fall back to
the same ASR path, emit the same progress events, and finalize the same artifacts and failures.
Separately confirmed summary and inspiration retries must still read only the official local
`transcript.txt`, use the selected output language, preserve successful partial artifacts, and let
`worker_service` perform the retry finalization.

The improvement is internal: process-video orchestration and AI generation become independently
reviewable and structurally unable to import each other's low-level dependencies. This plan does
not add local video/audio import, change contract v4 or process request v3, alter task schema,
change CLI compatibility, add a facade class, or update a product specification.

## Progress

- [x] 2026-07-21: Confirmed the preceding task-manifest split had been merged and pushed, and chose
  `worker/frameq_worker/pipeline.py` as the next physical ownership hotspot.
- [x] 2026-07-21: User selected scope A: a behavior-neutral private-module split that preserves the
  stable root, exact callable/type identities, eager compatibility imports, and all current runtime
  behavior while excluding local-media and CLI cleanup.
- [x] 2026-07-21: Created isolated worktree
  `.worktrees/codex-pipeline-module-split-plan` on branch
  `codex/pipeline-module-split-plan` from synchronized `main` at `fd81f10`. Validation: `.worktrees`
  is ignored and the main worktree was not modified.
- [x] 2026-07-21: Inspected all 589 lines of `pipeline.py`, stable callers in `cli.py` and
  `worker_service.py`, pipeline/task/media/CLI tests, the ASR private-module precedent, architecture,
  security, workflow, active local-media plan, and the current code audit.
- [x] 2026-07-21: Established a focused behavior baseline. Validation:
  `D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline.py
  worker/tests/test_task_artifacts.py worker/tests/test_media_preparation.py
  worker/tests/test_cli.py -q` passed 51/51 in 6.29 seconds.
- [x] 2026-07-21: Recorded and user-approved the detailed design, including exact owner symbols,
  dependency rules, failure/progress compatibility, packaging rules, and exclusions.
- [x] 2026-07-21: Registered this active ExecPlan and changed the design status to accepted without
  modifying production code.
- [x] 2026-07-21: User reviewed and explicitly approved this ExecPlan, authorizing production/test
  implementation in the isolated worktree. Validation: explicit user confirmation in the active
  thread.
- [x] 2026-07-21: Task 1 added five missing behavior characterizations plus the final ownership
  gate. Validation: `test_pipeline.py` passed 19/19; the four-file focused suite passed 56/56; the
  exact-tree test failed for the intended missing-`pipeline_runtime` reason; Ruff and diff checks
  passed.
- [x] Tasks 2-5 move shared, transcript, insights, and orchestration ownership while the stable
  behavior suite remains green after every move.
  - [x] 2026-07-21: Task 2 moved shared path/progress/failure policy into `shared.py`; focused
    behavior passed 56/56, the ownership suite retained the intended one RED plus ten skips, and
    Ruff passed after restoring the still-needed transitional `WorkerError` root import.
  - [x] 2026-07-21: Task 3 moved subtitle/ASR behavior and progress-argument helpers into
    `transcript.py`. Validation: transcript tests passed 19/19, the four-file focused suite passed
    56/56, Ruff passed, and the ownership RED narrowed to the two absent final owners.
  - [x] 2026-07-21: Task 4 moved exact official-transcript validation/read and target-scoped AI
    result mapping into `insights.py`. Validation: pipeline/task AI tests passed 27/27, the four-file
    focused suite passed 56/56, Ruff passed, and the ownership RED now names only the absent
    `orchestration.py` owner.
  - [x] 2026-07-21: Task 5 moved URL task/media/finalization composition into `orchestration.py`,
    reduced the stable root to 39 physical lines, and updated the media-facade AST target.
    Validation: ownership RED/GREEN gate passed 11/11, focused behavior passed 56/56, Ruff and diff
    checks passed, and AST comparison found zero mismatches across all 17 moved definitions.
- [x] Task 6 completes full regression, generated-worker parity, durable docs, acceptance, and plan
  archival.
  - [x] 2026-07-21: Full implementation regression passed: Worker 531/531, App 549/549, normal
    Windows Rust 175/175, scripts 23/23, Ruff, app lint/build, rustfmt, and Tauri release
    `--no-bundle`. The generated worker matched the canonical 61-file tree with zero missing,
    extra, or mismatched files.
  - [x] 2026-07-21: Updated architecture, security, code-audit, local-media dependency context, and
    design/plan results with measured owner sizes and residual risks. The local-media plan remains
    at its unimplemented Rust selection step.
  - [x] 2026-07-21: Final review strengthened the ownership gate to reject duplicate symbol owners,
    extra root exports, and absolute-path sibling back edges. The combined boundary/pipeline/progress
    suite passed 121/121, the fresh full Worker suite remained 531/531, and final Ruff, governance,
    whitespace, scope, and recursive 61/61 mirror checks passed.
  - [x] 2026-07-22: User accepted the implementation and authorized a local commit plus
    fast-forward merge to `main`. TASKS and active/completed indexes were synchronized before
    integration. Push, tag, PR, branch deletion, and worktree deletion remain unauthorized and
    outside this plan.

## Surprises & Discoveries

- Evidence: the root is not one workflow. `run_worker_pipeline` is the URL process application flow,
  while `run_insight_generation_step` is called only by the separately confirmed retry flow in
  `worker_service.py`. Physical co-location currently weakens a dependency boundary already present
  in product behavior.
- Evidence: `cli.py` and `worker_service.py` import six pipeline-owned symbols from the stable root,
  and tests import additional stage helpers. Direct re-exports are therefore required; changing
  callers to private modules would create a second application surface.
- Evidence: the existing 51-test focused baseline already covers successful ASR/subtitle task
  artifacts, safe progress arguments, official-transcript path rejection, target-scoped AI output,
  partial AI artifacts, no-AI process behavior, model readiness, task manifests, and source privacy.
  Task 1 adds only the missing orchestration failure-order and subtitle/read-fallback assertions.
- Evidence: root imports are currently eager. This refactor preserves that behavior intentionally;
  lazy CLI imports are a separate compatibility decision and no startup-performance claim is made.
- Evidence: the first baseline command using `D:\Github\FrameQ\.uv-cache` was denied by Windows
  while opening `.uv-cache\sdists-v9\.git`. The identical tests passed through the project's
  existing `.venv`; this is an environment-permission observation, not a code failure.
- Evidence: after shared extraction, the first focused run exposed that `WorkerError` was still
  needed by the not-yet-moved transcript/insights functions. Restoring that transitional root import
  returned all 56 focused tests to green; it will disappear when those owners move.
- Evidence: the canonical worker source is under `worker/frameq_worker`. The Tauri resource worker
  is an ignored generated mirror and must be refreshed through
  `prepareFreshWorkerResource`, never edited by hand.
- Evidence: the first full worker suite found one stale source-ownership assertion in
  `test_progress_events.py` that still inspected `pipeline.py`. Updating that test to the real
  producer `pipeline_runtime/transcript.py` made the isolated assertion and the fresh 531-test suite
  pass; no production behavior changed.
- Evidence: the restricted Rust run passed 174/175 and failed only
  `blocked_stdin_delivery_remains_cancellable` because Windows process termination was denied. The
  identical complete command passed 175/175 under normal Windows permissions, matching the
  repository's documented cancellation-test environment requirement.
- Evidence: app validation reused the main worktree's already-installed dependencies through a
  worktree-only `app/node_modules` junction. The junction was verified against its exact target and
  removed non-recursively after validation; the main dependency directory remained intact and no
  dependency manifest or lockfile changed.

## Decision Log

- Decision: Keep `frameq_worker.pipeline` as the sole stable production import surface and use
  direct imports from four private owners. Rationale: callers remain source-compatible and
  type/function identities do not fork. Date/Author: 2026-07-21, User + Codex.
- Decision: Use an empty `pipeline_runtime/__init__.py` and no facade class, registry, executor, or
  plugin abstraction. Rationale: the missing boundary is physical ownership, not another runtime
  coordination object. Date/Author: 2026-07-21, User + Codex.
- Decision: Keep process orchestration unable to import AI modules and keep AI generation unable to
  import ASR, media, source resolution, or task persistence. Rationale: these flows have different
  confirmation, privacy, failure, and Credits boundaries. Date/Author: 2026-07-21, User + Codex.
- Decision: Preserve current eager imports and repository-observed pipeline symbols only. Rationale:
  CLI surface cleanup and incidental dependency attributes are outside scope; wrappers would change
  identity and obscure the move-only proof. Date/Author: 2026-07-21, User + Codex.
- Decision: Use explicit `name as name` import aliases for stable-root symbols that are re-exported
  but not called by the root itself. Rationale: this is the existing ASR root convention, keeps
  Ruff's F401 gate green, and preserves direct object identity without wrappers or assignments.
  Date/Author: 2026-07-21, Codex.
- Decision: Add the final exact-tree ownership test before any production movement and keep it RED
  until all four owners exist. Rationale: behavior tests must stay green during each move while the
  intended structural gap remains visible. Date/Author: 2026-07-21, Codex.
- Decision: Do not implement any active local-media plan step in this branch. Rationale: new local
  paths, source variants, FFmpeg behavior, task schema, and UI would destroy attribution of a
  behavior-neutral refactor. Date/Author: 2026-07-21, User + Codex.

## Outcomes & Retrospective

Implementation and automated verification were accepted by the user on 2026-07-22. The former
589-line behavior owner is now a 39-line stable direct-reexport root. Private production owners are
`shared.py` 68 lines, `transcript.py` 250 lines, `insights.py` 152 lines, and `orchestration.py` 159
lines, with an empty initializer. Five behavior characterizations preceded movement; the structural
tree test stayed intentionally RED until the fourth owner landed. Final characterization passed
56/56, ownership/identity/dependency gates passed 11/11, and baseline AST comparison found no
mismatch across 17 moved definitions.

Full gates passed Worker 531/531, App 549/549, normal-Windows Rust 175/175, and scripts 23/23, plus
Ruff, lint/build, rustfmt, Tauri release `--no-bundle`, governance, and diff checks. Recursive
packaging comparison found 61 canonical and 61 mirrored files with zero missing, extra, or changed
hashes. Scope inspection found no production change in contracts, requests/models, task/manifest,
ASR/media/task/source owners, CLI/worker service, app/server, dependencies, product specs, or local
media runtime.

Residual risks: no real public download, local ASR model, cloud LLM/Credits, packaged-binary ASR/LLM,
or native desktop end-to-end smoke was run. Python `__module__`/pickling behavior is not exercised,
although FrameQ does not persist or compare these objects that way. Static import gates protect the
current dependency direction but do not replace behavioral and security review for future semantic
changes. Existing `audioop` deprecation and Vite chunk-size warnings are unrelated and non-blocking.

## Context and Orientation

- Accepted design: `docs/design-docs/2026-07-21-worker-pipeline-module-split.md`.
- Current stable root: `worker/frameq_worker/pipeline.py`; behavior owners are under
  `worker/frameq_worker/pipeline_runtime/`.
- Stable application callers: `worker/frameq_worker/cli.py` and
  `worker/frameq_worker/worker_service.py`.
- Existing lower boundaries: `worker/frameq_worker/media_preparation.py`,
  `worker/frameq_worker/task_store.py`, and `worker/frameq_worker/asr.py`.
- Current behavior tests: `worker/tests/test_pipeline.py`,
  `worker/tests/test_task_artifacts.py`, `worker/tests/test_media_preparation.py`, and
  `worker/tests/test_cli.py`.
- Ownership-test precedent: `worker/tests/test_asr_module_boundaries.py`.
- Generated worker refresh path: `scripts/tauri-dev-fresh-worker.mjs`; generated destination:
  `app/src-tauri/resources/worker/frameq_worker/`.
- Active future feature: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`.
- Durable architecture/security: `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and
  `docs/design-docs/frameq-code-audit-uml.md`.

## Target File Responsibility Map

| File | Responsibility after implementation |
|---|---|
| `worker/frameq_worker/pipeline.py` | direct re-exports of all current supported pipeline-owned names; no definitions or behavior; fewer than 100 physical lines |
| `worker/frameq_worker/pipeline_runtime/__init__.py` | empty private-package marker |
| `worker/frameq_worker/pipeline_runtime/shared.py` | `TranscriberFactory`, output/cache path resolution, typed failed result, and progress emission |
| `worker/frameq_worker/pipeline_runtime/transcript.py` | subtitle write/fallback, ASR factory/cache preparation, ASR transcription/result mapping, and safe progress args |
| `worker/frameq_worker/pipeline_runtime/insights.py` | exact official-transcript validation/read, summary/insight target generation, partial artifact/error mapping |
| `worker/frameq_worker/pipeline_runtime/orchestration.py` | `PipelineContext`, URL source/task creation, media facade entry, transcript selection, and task finalization |
| `worker/tests/test_pipeline_module_boundaries.py` | exact tree, owner, object-identity, dependency-direction, and no-private-caller gates |

Production files outside the private tree remain unchanged except the stable root and the existing
media AST test. In particular, no implementation diff is allowed in contracts, models, requests,
ASR, media preparation, task store, source resolution, CLI, worker service, app/server production,
dependency manifests, product specs, or local-media runtime.

## Stable Root Shape

The final `worker/frameq_worker/pipeline.py` must be equivalent to this direct import surface, with
Ruff-only formatting differences:

```python
from __future__ import annotations

from frameq_worker.pipeline_runtime.insights import (
    run_insight_generation_step as run_insight_generation_step,
)
from frameq_worker.pipeline_runtime.orchestration import (
    PipelineContext as PipelineContext,
)
from frameq_worker.pipeline_runtime.orchestration import (
    complete_transcript_stage as complete_transcript_stage,
)
from frameq_worker.pipeline_runtime.orchestration import (
    prepare_pipeline_context as prepare_pipeline_context,
)
from frameq_worker.pipeline_runtime.orchestration import (
    run_worker_pipeline as run_worker_pipeline,
)
from frameq_worker.pipeline_runtime.shared import (
    TranscriberFactory as TranscriberFactory,
)
from frameq_worker.pipeline_runtime.shared import emit_progress as emit_progress
from frameq_worker.pipeline_runtime.shared import failed_result as failed_result
from frameq_worker.pipeline_runtime.shared import resolve_cache_dir as resolve_cache_dir
from frameq_worker.pipeline_runtime.shared import resolve_output_dir as resolve_output_dir
from frameq_worker.pipeline_runtime.transcript import (
    prepare_asr_transcriber_stage as prepare_asr_transcriber_stage,
)
from frameq_worker.pipeline_runtime.transcript import (
    run_asr_transcript_stage as run_asr_transcript_stage,
)
from frameq_worker.pipeline_runtime.transcript import (
    run_asr_transcript_step as run_asr_transcript_step,
)
from frameq_worker.pipeline_runtime.transcript import (
    run_prepared_subtitle_transcript_step as run_prepared_subtitle_transcript_step,
)
from frameq_worker.pipeline_runtime.transcript import (
    write_prepared_subtitle_stage as write_prepared_subtitle_stage,
)
```

The explicit `name as name` import form declares an intentional re-export to Ruff; it is not a
second definition. Do not add wrappers, assignments outside import statements, `__getattr__`, lazy
import machinery, or a root `__all__` solely to manufacture another surface. Imported objects
themselves are the compatibility API.

## Plan of Work

### Task 1: Lock Missing Behavior Edges and Record the Ownership RED

**Files:**

- Modify: `worker/tests/test_pipeline.py`
- Create: `worker/tests/test_pipeline_module_boundaries.py`

- [x] Extend the stable-root imports in `test_pipeline.py` with
  `run_prepared_subtitle_transcript_step` and `run_worker_pipeline`. Import
  `MediaPreparationError`, `MediaPreparationFacade`, `ProcessRequest`, `SourceIdentityError`, and
  `SourceRequest` from their existing owner modules; do not import a future private pipeline child.
- [x] Add the following behavior characterizations before moving production code:

  ```python
  def test_empty_prepared_subtitle_returns_none_for_asr_fallback(tmp_path: Path) -> None:
      result = run_prepared_subtitle_transcript_step(
          subtitle=SubtitleTranscript(text=" ", language="zh-Hans", segments=()),
          output_dir=tmp_path / "task" / "transcript",
          output_stem="",
          source_identity=SourceIdentity(
              platform="youtube",
              stable_id="dQw4w9WgXcQ",
              canonical_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          ),
      )

      assert result is None


  def test_missing_official_transcript_returns_safe_not_found(tmp_path: Path) -> None:
      result = run_insight_generation_step(
          transcript_txt_path=tmp_path / "task" / "transcript" / "transcript.txt",
          output_dir=tmp_path / "task" / "ai",
          output_stem="",
          client=FakeInsightClient(),
          output_language="en-US",
      ).to_dict()

      assert result["status"] == "partial_completed"
      assert result["text"] == ""
      assert result["error"] == {
          "code": "TRANSCRIPT_TEXT_NOT_FOUND",
          "message": "Official transcript text could not be read.",
          "stage": "insights_generating",
      }


  def test_source_identity_failure_creates_no_task(tmp_path: Path) -> None:
      def reject_source(_url: str) -> SourceRequest:
          raise SourceIdentityError("must not be echoed")

      result = run_worker_pipeline(
          request=ProcessRequest(
              url="https://example.test/review-secret",
              asr_model="iic/SenseVoiceSmall",
          ),
          project_root=tmp_path,
          command_runner=lambda _command: pytest.fail("media must not run"),
          transcriber=None,
          allow_real_asr=False,
          environ={},
          source_request_resolver=reject_source,
      ).to_dict()

      assert result == {
          "status": "failed",
          "task_id": None,
          "task_dir": None,
          "artifacts": {},
          "text": "",
          "summary": "",
          "insights": [],
          "transcript": None,
          "error": {
              "code": "SOURCE_IDENTITY_UNAVAILABLE",
              "message": "Could not identify a supported stable video source.",
              "stage": "video_extracting",
          },
      }
      assert not (tmp_path / "outputs").exists()
  ```
- [x] Add task-storage and media-failure characterizations using the same stable root. The storage
  test points `OUTPUT_DIR_ENV` at an ordinary file and requires `TASK_STORAGE_UNAVAILABLE` with no
  task identity. The media test uses this exact shape:

  ```python
  def test_media_failure_finalizes_the_created_task(
      tmp_path: Path,
      monkeypatch: pytest.MonkeyPatch,
  ) -> None:
      identity = SourceIdentity(
          platform="douyin",
          stable_id="7524373044106677544",
          canonical_url="https://www.douyin.com/video/7524373044106677544",
      )
      source_request = SourceRequest(identity.canonical_url, identity)

      def fail_media(*_args: object, **_kwargs: object) -> object:
          raise MediaPreparationError("VIDEO_DOWNLOAD_FAILED", "safe media failure")

      monkeypatch.setattr(MediaPreparationFacade, "prepare", fail_media)
      result = run_worker_pipeline(
          request=ProcessRequest(
              url=identity.canonical_url,
              asr_model="iic/SenseVoiceSmall",
          ),
          project_root=tmp_path,
          command_runner=lambda _command: pytest.fail("runner must not be called"),
          transcriber=None,
          allow_real_asr=False,
          environ={},
          source_request_resolver=lambda _url: source_request,
      ).to_dict()

      assert result["status"] == "failed"
      assert result["task_id"] is not None
      assert result["error"] == {
          "code": "VIDEO_DOWNLOAD_FAILED",
          "message": "safe media failure",
          "stage": "video_extracting",
      }
      task_dir = Path(str(result["task_dir"]))
      manifest = json.loads(
          (task_dir / "frameq-task.json").read_text(encoding="utf-8")
      )
      assert manifest["status"] == "failed"
      assert manifest["error"] == result["error"]
  ```

  Import `json` and `OUTPUT_DIR_ENV` for these tests. The command runner and ASR must not be called.
- [x] Run behavior RED/GREEN independently of the structural gate:

  ```powershell
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline.py -q
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline.py worker/tests/test_task_artifacts.py worker/tests/test_media_preparation.py worker/tests/test_cli.py -q
  ```

  Expected: new characterizations and all 51 baseline tests pass before production movement.
- [x] Create `test_pipeline_module_boundaries.py` with the exact tree and owner map below. Use an
  autouse fixture like the ASR precedent so only the exact-tree test runs until the complete tree
  exists:

  ```python
  EXPECTED_PRIVATE_FILES = {
      "__init__.py",
      "insights.py",
      "orchestration.py",
      "shared.py",
      "transcript.py",
  }

  EXPECTED_OWNER_SYMBOLS = {
      "shared.py": {
          "TranscriberFactory",
          "emit_progress",
          "failed_result",
          "resolve_cache_dir",
          "resolve_output_dir",
      },
      "transcript.py": {
          "_asr_model_args",
          "_subtitle_language_args",
          "prepare_asr_transcriber_stage",
          "run_asr_transcript_stage",
          "run_asr_transcript_step",
          "run_prepared_subtitle_transcript_step",
          "write_prepared_subtitle_stage",
      },
      "insights.py": {"run_insight_generation_step"},
      "orchestration.py": {
          "PipelineContext",
          "complete_transcript_stage",
          "prepare_pipeline_context",
          "run_worker_pipeline",
      },
  }

  @pytest.fixture(autouse=True)
  def _skip_dependent_checks_until_private_tree_exists(
      request: pytest.FixtureRequest,
  ) -> None:
      if request.node.name == "test_pipeline_runtime_private_tree_matches_design":
          return
      if _private_python_files() != EXPECTED_PRIVATE_FILES:
          pytest.skip("approved private pipeline module tree is not complete yet")


  def test_pipeline_runtime_private_tree_matches_design() -> None:
      assert _private_python_files() == EXPECTED_PRIVATE_FILES
      assert (PRIVATE_PIPELINE_ROOT / "__init__.py").read_text(
          encoding="utf-8"
      ).strip() == ""
  ```

- [x] In the same file, add AST/importlib tests that prove:

  - each `EXPECTED_OWNER_SYMBOLS` member has exactly one top-level physical owner;
  - root top-level statements are only `from __future__` and direct imports, with no function,
    class, assignment, or annotated-assignment definitions, and root length is below 100 lines;
  - every stable root name is `is` the corresponding private object;
  - no child imports `frameq_worker.pipeline`, `cli`, or `worker_service`;
  - `shared.py` imports only `Transcriber` from `frameq_worker.asr` and no ASR behavior;
  - `transcript.py` is the only ASR behavior owner and imports no media/AI/orchestration module;
  - `insights.py` imports no ASR/media/source/task/shared/transcript/orchestration module;
  - `orchestration.py` imports no InsightFlow/LLM/output-language/insights module;
  - only `orchestration.py` imports `media_preparation`, `source_resolution`, and
    `TaskStoreFacade`, while transcript is limited to the `TaskContext` contract; and
  - canonical production modules outside the private tree import no `pipeline_runtime` child.

  Object identity mapping must use the stable names in the design, for example:

  ```python
  owner_exports = {
      "shared": EXPECTED_OWNER_SYMBOLS["shared.py"],
      "transcript": EXPECTED_OWNER_SYMBOLS["transcript.py"]
      - {"_asr_model_args", "_subtitle_language_args"},
      "insights": EXPECTED_OWNER_SYMBOLS["insights.py"],
      "orchestration": EXPECTED_OWNER_SYMBOLS["orchestration.py"],
  }
  public = importlib.import_module("frameq_worker.pipeline")
  for owner, names in owner_exports.items():
      private = importlib.import_module(f"frameq_worker.pipeline_runtime.{owner}")
      for name in names:
          assert getattr(public, name) is getattr(private, name)
  ```

- [x] Run and record the intentional RED:

  ```powershell
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline_module_boundaries.py::test_pipeline_runtime_private_tree_matches_design -q
  ```

  Expected: fail only because `pipeline_runtime/` and its exact files do not yet exist. Do not
  weaken, xfail, or permanently skip the exact-tree test.
- [x] Run Ruff and diff checks. Do not commit without separate user authorization.

### Task 2: Extract Shared Pipeline Policy

**Files:**

- Create: `worker/frameq_worker/pipeline_runtime/__init__.py`
- Create: `worker/frameq_worker/pipeline_runtime/shared.py`
- Modify: `worker/frameq_worker/pipeline.py`

- [x] Create an empty initializer. Move `TranscriberFactory`, `resolve_output_dir`,
  `resolve_cache_dir`, `failed_result`, and `emit_progress` verbatim into `shared.py`.
- [x] Use only these dependency categories in `shared.py`:

  ```python
  from collections.abc import Callable
  from pathlib import Path

  from frameq_worker.asr import Transcriber
  from frameq_worker.desktop_contract import CACHE_DIR_ENV, OUTPUT_DIR_ENV, ProgressCallback
  from frameq_worker.models import JobStage, ProcessResult, WorkerError
  from frameq_worker.progress_events import build_worker_progress_event

  TranscriberFactory = Callable[[str, Path], Transcriber]
  ```

  Do not import ASR providers, model registry/cache, artifacts, task store, media, transcript, AI,
  CLI, worker service, or orchestration.
- [x] Remove the moved definitions/imports from root and direct-import their five objects from
  `pipeline_runtime.shared`. The still-root-owned stages must continue resolving these imported
  globals with no wrapper or changed call order.
- [x] Run:

  ```powershell
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline.py worker/tests/test_task_artifacts.py worker/tests/test_media_preparation.py worker/tests/test_cli.py -q
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline_module_boundaries.py -q
  D:\Github\FrameQ\.venv\Scripts\python.exe -m ruff check worker
  ```

  Expected: behavior green; exact-tree test remains the single intentional RED because three owner
  files are still absent; dependent ownership tests skip.

### Task 3: Extract Subtitle and ASR Transcript Stages

**Files:**

- Create: `worker/frameq_worker/pipeline_runtime/transcript.py`
- Modify: `worker/frameq_worker/pipeline.py`

- [x] Move these implementations verbatim, including catches, event order/progress values, safe
  argument normalization, artifact keys, and exact error messages:

  - `run_asr_transcript_step`
  - `run_prepared_subtitle_transcript_step`
  - `write_prepared_subtitle_stage`
  - `prepare_asr_transcriber_stage`
  - `run_asr_transcript_stage`
  - `_subtitle_language_args`
  - `_asr_model_args`

- [x] Import shared policy from `.shared`; import only the existing stable ASR surface, transcript
  DTOs, `TaskContext`, source identity, and progress normalizers. Do not import media preparation,
  source resolution, InsightFlow, LLM, output language, worker service, or orchestration.
- [x] Remove moved definitions/dead imports from root and direct-import the five stable transcript
  exports from `pipeline_runtime.transcript`. Root-owned orchestration must call those exact imported
  objects.
- [x] Run the four-file focused suite, then:

  ```powershell
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline.py -q
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline_module_boundaries.py -q
  D:\Github\FrameQ\.venv\Scripts\python.exe -m ruff check worker
  ```

  Expected: all behavior green; exact-tree test remains RED only because `insights.py` and
  `orchestration.py` are absent.

### Task 4: Extract Official-Transcript AI Generation

**Files:**

- Create: `worker/frameq_worker/pipeline_runtime/insights.py`
- Modify: `worker/frameq_worker/pipeline.py`

- [x] Move `run_insight_generation_step` verbatim, including `os.path.isjunction` fallback, exact
  official-path/link checks, UTF-8 `.strip()`, target ordering, first-error retention, successful
  partial artifacts, result status, transcript preservation, and messages.
- [x] Its imports are limited to `os`, `Path`, InsightFlow generation/errors/client, result and
  preference/transcript types, and `OutputLanguage`. It must not import any ASR, media, media
  preparation, source identity/resolution, task store, shared/transcript/orchestration, CLI, or
  worker-service module.
- [x] Remove moved imports/definition from root and direct-import the function from
  `pipeline_runtime.insights`. Confirm `worker_service.retry_insights_once` remains unchanged and
  still imports only the stable root.
- [x] Run:

  ```powershell
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline.py worker/tests/test_task_artifacts.py -q
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline_module_boundaries.py -q
  D:\Github\FrameQ\.venv\Scripts\python.exe -m ruff check worker
  ```

  Expected: AI/path/preference/partial-artifact behavior green; the exact-tree test remains RED only
  because `orchestration.py` is absent.

### Task 5: Extract URL Orchestration and Turn the Root Green

**Files:**

- Create: `worker/frameq_worker/pipeline_runtime/orchestration.py`
- Modify: `worker/frameq_worker/pipeline.py`
- Modify: `worker/tests/test_media_preparation.py`
- Modify if needed for exact assertions only: `worker/tests/test_pipeline_module_boundaries.py`

- [x] Move `PipelineContext`, `prepare_pipeline_context`, `complete_transcript_stage`, and
  `run_worker_pipeline` verbatim. Preserve exception order, task creation before media work,
  exactly-once finalization branches, subtitle-before-ASR selection, and all argument defaults.
- [x] Import path/failure/transcriber contracts from `.shared` and transcript stages from
  `.transcript`; import the existing media-preparation facade/source/error, source resolution,
  source identity error, models, media `CommandRunner` contract, and task facade/context. Do not
  import `.insights`, InsightFlow, LLM, output-language policy, retry DTOs, CLI, or worker service.
- [x] Replace the root with the exact stable shape in this plan. Confirm it has no top-level
  definition/assignment, remains below 100 physical lines, and all 15 stable names resolve by
  identity to their approved owner.
- [x] Update
  `test_media_preparation.py::test_pipeline_enters_media_subsystem_only_through_facade` so its AST
  target is `pipeline_runtime/orchestration.py`. Additionally import the stable root and assert:

  ```python
  public_pipeline = importlib.import_module("frameq_worker.pipeline")
  private_orchestration = importlib.import_module(
      "frameq_worker.pipeline_runtime.orchestration"
  )
  assert public_pipeline.run_worker_pipeline is private_orchestration.run_worker_pipeline
  ```

  Keep the existing prohibitions on direct download, audio extraction, probe, and subtitle discovery
  calls; do not merely move the old string assertion.
- [x] Run the complete new gate and focused behavior:

  ```powershell
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline_module_boundaries.py -q
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests/test_pipeline.py worker/tests/test_task_artifacts.py worker/tests/test_media_preparation.py worker/tests/test_cli.py -q
  D:\Github\FrameQ\.venv\Scripts\python.exe -m ruff check worker
  ```

  Expected: the previously RED exact-tree test and every dependent owner/dependency test are GREEN;
  all behavior tests remain green. Treat any object-identity mismatch, caller private import, or
  changed error/progress result as a stop condition.
- [x] Inspect `git diff -- worker/frameq_worker worker/tests` and compare every moved implementation
  against baseline `fd81f10`. Only imports/physical location and new tests may differ.

### Task 6: Full Validation, Generated Worker, Durable Docs, and Acceptance

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/2026-07-21-worker-pipeline-module-split.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`
- Modify: `docs/exec-plans/active/index.md`
- Move only after implementation acceptance:
  `docs/exec-plans/active/2026-07-21-worker-pipeline-module-split-plan.md` to
  `docs/exec-plans/completed/2026-07-21-worker-pipeline-module-split-plan.md`
- Update: `docs/exec-plans/completed/index.md`
- Generated, ignored, never hand-edited:
  `app/src-tauri/resources/worker/frameq_worker/**`

- [x] Run the full Python gates and record exact counts/warnings:

  ```powershell
  D:\Github\FrameQ\.venv\Scripts\python.exe -m pytest worker/tests -q
  D:\Github\FrameQ\.venv\Scripts\python.exe -m ruff check worker
  ```

- [x] Run cross-layer regression even though contracts/app/Rust are protected scope:

  ```powershell
  npm --prefix app test
  npm --prefix app run lint
  npm --prefix app run build
  cargo test --manifest-path app/src-tauri/Cargo.toml
  cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
  node --test scripts/tests/*.test.mjs
  ```

  If a known Windows process/cancellation test is denied only by sandbox process permissions,
  reproduce and record that exact failure, then rerun the identical command in the established
  normal Windows environment. Do not change runtime behavior to accommodate the sandbox.
- [x] Refresh and validate the ignored packaged worker through the supported path:

  ```powershell
  node --input-type=module -e "import { prepareFreshWorkerResource } from './scripts/tauri-dev-fresh-worker.mjs'; await prepareFreshWorkerResource();"
  node --test scripts/tests/tauri-dev-fresh-worker.test.mjs
  npm --prefix app run tauri -- build --no-bundle
  ```

  Compare canonical and generated worker recursively by relative file set and SHA-256/bytes. Require
  the new `pipeline_runtime/` files and zero missing, extra, or mismatched files. Do not stage the
  ignored generated mirror.
- [x] Update architecture with the stable root/private owner graph and process-versus-AI dependency
  boundary. Update security with official-transcript validation ownership, no-new-log/input path,
  root-only production imports, and generated-worker ownership.
- [x] Update the code audit only after measurements pass: replace the unresolved 589-line pipeline
  hotspot with final root/owner line counts and evidence. Do not claim that all future orchestration
  debt or `App.tsx` is resolved.
- [x] Update the active local-media plan to reference the actual private owner paths while leaving
  its next unimplemented Rust selection step and every local-media checkbox unchanged.
- [x] Complete this plan's Progress, Discoveries, Decisions, Outcomes, exact validation counts, and
  residual risks. Mark the TASKS item complete and archive/register the plan only after the user
  accepts the implementation.
- [x] Run final governance, placeholder, scope, and whitespace gates:

  ```powershell
  python scripts/validate_agents_docs.py --level WARN
  rg -n "T[B]D|T[O]DO|implement[ ]later|fill[ ]in" docs/design-docs/2026-07-21-worker-pipeline-module-split.md docs/exec-plans/completed/2026-07-21-worker-pipeline-module-split-plan.md
  git diff --check
  git status --short
  ```

  Require intended changes only: canonical pipeline root/private package, focused tests, durable
  docs/indexes, and this plan. Reject changes to contracts, requests/models, task/manifest schema,
  ASR/media/task/source behavior owners, CLI/worker-service production, app/server production,
  dependency manifests/lockfiles, product specs, or local-media runtime.
- [x] Do not commit, merge, push, tag, create a PR, or delete the worktree without explicit user
  authorization after all gates and acceptance. The user authorized only a local commit and merge
  on 2026-07-22; push, tag, PR, branch deletion, and worktree deletion remain out of scope.

## Test and Acceptance Matrix

| Area | Automated evidence | Acceptance |
|---|---|---|
| stable imports | new boundary suite plus CLI/worker-service tests | all 15 approved names remain available at `frameq_worker.pipeline` and are exact private objects |
| source/task/media orchestration | new characterization plus task/media/CLI suites | source/storage/media/ASR failures and finalization order remain exact; process path never imports/calls AI |
| subtitle/ASR | pipeline, task artifact, CLI, ASR suites | subtitle fallback, progress order/args, cache/factory behavior, artifacts and errors unchanged |
| AI retry | pipeline/task artifact/output-language/preference suites | exact official transcript only; target/language/preferences/partial artifacts and call count unchanged |
| ownership | `test_pipeline_module_boundaries.py` | exact four-owner tree, empty initializer, root under 100 lines, no back edges/private callers |
| packaging | refresh script test, recursive byte/hash comparison, Tauri no-bundle | private package is bundled and canonical/generated worker trees are identical |
| cross-layer | full worker/app/Rust/scripts/lint/build/governance gates | no contract, UI, task schema, server, dependency, or local-media regression |

## Manual and Residual Validation

No real public-video download, local ASR model, cloud LLM, AI Credit, or user media is required for
this structural refactor. Deterministic fake runners/transcribers/clients and existing packaged
build checks are authoritative for behavior preservation.

If no native end-to-end desktop smoke is run, record these residual risks explicitly:

- Python runtime behavior dependent on implementation `__module__` metadata or pickling is not
  exercised, although FrameQ does not persist or compare these functions/classes that way;
- Tauri packaging is proven by generated-worker parity and no-bundle build rather than a real ASR or
  LLM execution from the packaged binary; and
- process and AI dependency gates are static import/ownership guards, so future semantic changes
  still require behavioral tests and security review.

## Rollback and Recovery

Implementation occurs in the isolated worktree. After each owner move, behavior tests must be
green. If a step changes behavior:

1. stop at that owner;
2. compare the moved symbols against `fd81f10:worker/frameq_worker/pipeline.py`;
3. restore exact statement, catch, call, event, and finalization order in the new owner;
4. rerun that owner's focused behavior plus boundary subset; and
5. continue only after behavior is green and the structural RED/GREEN state matches the planned
   phase.

Do not recover by weakening tests, importing private children from callers, adding wrappers with
different identities, broadening exception handling, mixing in local-media behavior, or using
destructive Git reset/checkout commands. This plan adds no data migration, so source rollback is
sufficient.
