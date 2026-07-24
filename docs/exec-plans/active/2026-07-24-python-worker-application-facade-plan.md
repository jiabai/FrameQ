# Python Worker Application Facade and CLI Boundary Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Reduce the Python worker CLI to a process adapter and keep `worker_service.py` as the
stable five-function application facade backed by five private, explicitly typed use-case handlers.

**Architecture:** Add an empty-initializer `worker_application/` package whose URL, local-media,
source-identity, AI-retry, and model-download handlers own application composition. Keep production
dependency defaults in `worker_application/defaults.py`, direct-reexport the five handler functions
from `worker_service.py`, and let `cli.py` own only fixed mode parsing, bounded stdin, progress/result
rendering, facade dispatch, and process exit status. Tests import their real owners and an AST gate
closes the dependency direction.

**Tech Stack:** Python 3.12, pytest, Ruff, AST/source-boundary tests, Node packaged-worker tests,
Tauri v2 release resource generation.

**Durable design:**
`docs/design-docs/2026-07-24-python-worker-application-facade.md`

---

## Purpose / Big Picture

FrameQ's valid worker behavior remains unchanged. The Rust host still launches the same five fixed
CLI modes, sends the same bounded stdin JSON, validates the same progress events, and consumes the
same terminal result shapes. URL and local-media processing still create the same artifacts;
source-identity preflight still returns only its existing safe result; AI retry still reads and
commits the same task state; model download still uses the same environment and fixed failures.

The improvement is ownership. `cli.py` stops acting as a compatibility namespace and production
composition root. `worker_service.py` becomes a genuinely thin application facade. Each use case
has one private handler, application defaults have one explicit owner, and `TaskPaths` replaces the
remaining dynamic `object/getattr()` path bag. This is an internal refactor: no product
specification, desktop-worker contract, manifest schema, CLI flag, progress code, output shape,
network call, AI Credits behavior, or user-visible copy changes.

## Progress

- [x] 2026-07-24: Re-read current `cli.py`, `worker_service.py`, their tests, production callers,
  packaging path, architecture/security rules, and the code-audit baseline. Validation: repository
  source inspection and import/reference searches.
- [x] 2026-07-24: User selected Scheme A: retain the five-function `worker_service` facade, extract
  five private application handlers, delete test-only CLI re-exports/wrappers, and use explicit
  `TaskPaths`.
- [x] 2026-07-24: Wrote and committed the durable design plus initial audit/debt registrations on
  isolated branch `codex/python-worker-application-facade`. Commit: `ec05d7d`.
- [x] 2026-07-24: Registered this detailed TDD ExecPlan in architecture, security, audit, task, and
  active-plan indexes without changing Python production code.
- [x] 2026-07-24: Characterized the five facade signatures/required parameters, all five CLI
  dispatch paths, true contract-constant owners, and the platform-aware Bilibili short-link
  default before moving production code. Validation: focused pytest 41/41, focused Ruff, and diff
  check pass.
- [ ] Task 3: Add the private tree and extract URL processing.
- [ ] Task 4: Extract local-media processing.
- [ ] Task 5: Extract source identity and production source-resolution defaults.
- [ ] Task 6: Extract AI retry and make `TaskPaths` explicit.
- [ ] Task 7: Extract ASR model download and migrate true-owner test seams.
- [ ] Task 8: Atomically close the CLI and facade surfaces and enable the complete boundary gate.
- [ ] Task 9: Run complete verification, update durable evidence, archive the ExecPlan, and prepare
  the branch for integration.

## Surprises & Discoveries

- Evidence: `cli.py` is 282 lines, exports 40 names, and contains four `*args/**kwargs` forwarding
  wrappers. Repository production startup imports only `cli.main`; the broad surface is primarily
  a test compatibility layer.
- Evidence: `worker_service.py` is 454 lines and owns five independent use cases plus retry parsing,
  task access, artifact merging, ASR/model defaults, and failure mapping.
- Evidence: `worker_service.run_worker_once` defaults to the direct-only
  `resolve_source_request`, while the real CLI wrapper injects
  `build_default_source_resolver().resolve_request`. Removing the wrapper before moving this
  production composition would break Bilibili/Douyin/Xiaohongshu short-link behavior.
- Evidence: `TaskStoreFacade.open()` already returns a task context whose `paths` value is
  `TaskPaths`; only the AI merge/read helper annotations and `getattr()` implementation erase that
  type.
- Evidence: existing tests patch incidental globals in `cli.py` and `worker_service.py`. After
  ownership moves, CLI dispatch tests must patch `cli.worker_service_module`, while handler behavior
  tests must patch the actual handler module or use existing explicit dependency parameters.
- Evidence: canonical worker source is generated into the ignored Tauri resource mirror. New
  private modules must be verified through `scripts/tauri-dev-fresh-worker.mjs` and the Tauri
  `--no-bundle` build, never hand-edited in `app/src-tauri/resources/worker`.
- Evidence: in this restricted Windows session `uv` cannot access its user cache and pytest cannot
  create its default temp directory. The locked project interpreter plus a repository-ignored
  `--basetemp app/src-tauri/target` ran the unchanged baseline successfully: 574 passed, 2 skipped,
  with one existing `pydub/audioop` warning. Ruff also passed.

## Decision Log

- Decision: Keep `worker_service.py` as the stable public application facade with exactly five
  functions. Rationale: production and tests already use this semantic surface, and deleting it
  would expose private handlers without simplifying the process boundary. Date/Author: 2026-07-24,
  User + Codex.
- Decision: Remove CLI compatibility re-exports and all four broad wrappers. Rationale: repository
  inspection found no production consumer, and keeping them would preserve inaccurate ownership
  and untyped call surfaces. Date/Author: 2026-07-24, User + Codex.
- Decision: Use five concrete handler modules plus one defaults module, with an empty package
  initializer. Rationale: the use cases have distinct failure and dependency boundaries; a generic
  registry, base handler, or dependency-injection framework would obscure them. Date/Author:
  2026-07-24, User + Codex.
- Decision: Move production platform resolver, transcriber, Insight client, and real-ASR default
  composition into the application package before shrinking CLI. Rationale: preserving actual CLI
  behavior matters more than preserving the identity or `repr` of an incidental wrapper. Date/Author:
  2026-07-24, User + Codex.
- Decision: Keep existing explicit dependency parameters on the five facade functions. Rationale:
  they are useful focused-test seams and part of the repository-observed callable contract; no
  additional container or protocol is required. Date/Author: 2026-07-24, User + Codex.
- Decision: Close CLI and facade surfaces atomically only after all five handlers exist. Rationale:
  intermediate commits can keep current compatibility while each extracted handler is verified;
  the final closure then has one clear RED/GREEN boundary. Date/Author: 2026-07-24, User + Codex.
- Decision: Add no product spec or worker contract revision. Rationale: this plan changes only
  internal module ownership and test imports. Date/Author: 2026-07-24, User + Codex.

## Outcomes & Retrospective

This section will be completed after implementation. It must record:

- final root/private file sizes and exact public exports;
- RED and GREEN evidence for each extraction slice;
- full Worker/Ruff/scripts/Tauri/governance results;
- packaging equality evidence;
- implementation commit hashes;
- any unrun native or real-platform checks as residual risk rather than inferred success.

## Context and Orientation

### Stable process boundary

- `worker/frameq_worker/__main__.py` imports `cli.main` and exits with its code.
- `worker/frameq_worker/cli.py` parses five mutually exclusive modes:
  `--request-stdin`, `--process-local-media-stdin`, `--retry-insights-stdin`,
  `--resolve-source-stdin`, and `--download-asr-model`.
- Request-bearing modes read at most `MAX_STDIN_REQUEST_BYTES`, reject malformed/non-object input
  without echoing it, and pass one normalized JSON string to the application facade.
- Worker progress and model-download progress go to stderr through their existing validated
  prefixes. One terminal JSON object goes to stdout.

### Stable application facade

`worker/frameq_worker/worker_service.py` must retain these exact callable names and parameter lists:

```python
def run_worker_once(
    request_json: str,
    project_root: Path | None = None,
    command_runner: CommandRunner = run_command,
    transcriber: Transcriber | None = None,
    transcriber_factory: TranscriberFactory | None = None,
    allow_real_asr: bool | None = None,
    environ: dict[str, str] | None = None,
    progress_callback: ProgressCallback | None = None,
    source_request_resolver: SourceRequestResolver = ...,
) -> dict[str, object]: ...

def run_local_media_once(
    request_json: str,
    project_root: Path | None = None,
    command_runner: CommandRunner = run_command,
    transcriber: Transcriber | None = None,
    transcriber_factory: TranscriberFactory | None = None,
    allow_real_asr: bool | None = None,
    environ: dict[str, str] | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, object]: ...

def resolve_source_identity_once(
    request_json: str,
    source_request_resolver: SourceRequestResolver = ...,
) -> dict[str, object]: ...

def retry_insights_once(
    request_json: str,
    project_root: Path | None = None,
    insight_client: InsightClient | None = None,
    insight_client_factory: InsightClientFactory | None = None,
    environ: dict[str, str] | None = None,
) -> dict[str, object]: ...

def run_asr_model_download_once(
    project_root: Path | None = None,
    environ: dict[str, str] | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, object]: ...
```

The source-resolver default may move from a function object to the application package's
platform-aware resolver method. Characterization locks parameter name, kind, optionality, and
observable behavior, not incidental callable identity.

### Existing domain owners that remain authoritative

- `requests.py`: strict request parsing and non-echoing validation.
- `pipeline.py`: stable direct-reexport surface for URL/local pipeline and insight steps.
- `task_store.py`: `TaskStoreFacade`, `TaskContext`, and `TaskPaths`.
- `platform_source_resolvers.py`: platform-aware production resolver builder.
- `asr.py`: transcriber interface/default factory and ASR model name.
- `llm.py`: server-managed Insight client construction.
- `model_download.py`: model archive/cache implementation and typed download failure.
- `desktop_contract.py` and `progress_events.py`: constants, progress callback, and event validation.

No handler may replace or duplicate these domain owners.

## Target File Responsibility Map

| File | Responsibility after implementation |
|------|-------------------------------------|
| `worker/frameq_worker/cli.py` | fixed mode parsing, bounded stdin validation, progress/result rendering, facade dispatch, exit code |
| `worker/frameq_worker/__main__.py` | import only `cli.main` and exit |
| `worker/frameq_worker/worker_service.py` | direct stable imports and exact five-name `__all__` |
| `worker/frameq_worker/worker_application/__init__.py` | empty private-package marker |
| `worker/frameq_worker/worker_application/defaults.py` | platform-aware resolver singleton, default transcriber/Insight factories, real-ASR environment predicate |
| `worker/frameq_worker/worker_application/url_processing.py` | URL request parse, runtime env, pipeline call, safe persistence/recovery mapping |
| `worker/frameq_worker/worker_application/local_media.py` | local-media request parse, runtime env, pipeline call, safe persistence/recovery mapping |
| `worker/frameq_worker/worker_application/source_identity.py` | source-identity JSON validation, resolver call, closed safe result |
| `worker/frameq_worker/worker_application/insight_retry.py` | retry parse, client composition, task open/preference/AI/finalize flow, typed existing-artifact merge |
| `worker/frameq_worker/worker_application/model_download.py` | model env/cache composition, download call, fixed safe terminal mapping |
| `worker/tests/test_worker_service_facade.py` | stable facade signature and exact direct-reexport characterization |
| `worker/tests/test_worker_application_boundaries.py` | exact tree, ownership, dependency, CLI/facade closure, `TaskPaths` source gate |
| existing Worker tests | behavior coverage and migrated true-owner imports/monkeypatches |

## Protected Behavior and Security Boundaries

The implementation must not change:

- any CLI flag, stdout/stderr prefix, terminal exit rule, request byte limit, or stdin failure shape;
- desktop-worker contract v4, process-video v3, local-media v4, retry, progress, or model-download
  wire bytes;
- request validation codes/messages, task IDs, paths, artifact names, manifests, or persistence
  transaction/recovery behavior;
- platform short-link normalization and safe source-identity output;
- default ASR/model cache behavior, transcriber injection, or real-ASR opt-in;
- AI target/language/preference behavior, server-managed client construction, prompt count, or
  Credits;
- model-download URL/hash/revision/endpoint environment handling and fixed sanitized failures;
- URL/path/transcript/prompt/credential non-echoing and safe logging rules.

Automated tests use fakes. They must not contact public platforms, download a model, call a live
LLM, or consume AI Credits.

## Plan of Work

### Task 1: Register the Approved Plan and Pending Boundary

**Files:**

- Create:
  `docs/exec-plans/active/2026-07-24-python-worker-application-facade-plan.md`
- Modify: `AGENTS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `TASKS.md`

**Step 1: Record the pending target without claiming implementation**

Architecture and security text must distinguish current broad files from the accepted target. The
audit must link both the durable design and this active ExecPlan. The task stays unchecked.

**Step 2: Run documentation gates**

Run:

```powershell
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Expected: governance reports zero errors and zero warnings; diff check exits 0.

**Step 3: Commit**

```powershell
git add AGENTS.md TASKS.md docs/ARCHITECTURE.md docs/SECURITY.md `
  docs/design-docs/frameq-code-audit-uml.md `
  docs/exec-plans/active/2026-07-24-python-worker-application-facade-plan.md `
  docs/exec-plans/active/index.md docs/exec-plans/tech-debt-tracker.md
git commit -m "docs(worker): plan application facade refactor"
```

### Task 2: Characterize the Public Facade and Real CLI Behavior

**Files:**

- Create: `worker/tests/test_worker_service_facade.py`
- Modify: `worker/tests/test_cli.py`
- Modify: `worker/tests/test_contract.py`

**Step 1: Write facade signature characterization**

Add one exact signature table rather than repeating loose assertions:

```python
EXPECTED_SIGNATURES = {
    "run_worker_once": (
        "request_json",
        "project_root",
        "command_runner",
        "transcriber",
        "transcriber_factory",
        "allow_real_asr",
        "environ",
        "progress_callback",
        "source_request_resolver",
    ),
    "run_local_media_once": (
        "request_json",
        "project_root",
        "command_runner",
        "transcriber",
        "transcriber_factory",
        "allow_real_asr",
        "environ",
        "progress_callback",
    ),
    "resolve_source_identity_once": (
        "request_json",
        "source_request_resolver",
    ),
    "retry_insights_once": (
        "request_json",
        "project_root",
        "insight_client",
        "insight_client_factory",
        "environ",
    ),
    "run_asr_model_download_once": (
        "project_root",
        "environ",
        "progress_callback",
    ),
}


def test_worker_service_facade_signatures_are_stable() -> None:
    for name, expected_names in EXPECTED_SIGNATURES.items():
        signature = inspect.signature(getattr(worker_service, name))
        assert tuple(signature.parameters) == expected_names
        assert all(
            parameter.kind
            in {
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
            }
            for parameter in signature.parameters.values()
        )
        assert signature.return_annotation in {
            dict[str, object],
            "dict[str, object]",
        }
```

Also assert only `request_json` is required for request-bearing functions and no five functions
have `*args`/`**kwargs`.

**Step 2: Characterize production defaults at the behavior level**

Before moving composition:

- keep the existing short Bilibili link test through the CLI-owned wrapper;
- add a URL-processing test that uses the platform-aware default and proves its fake parser is
  called;
- keep/increase coverage for injected `source_request_resolver`, `transcriber_factory`,
  `insight_client_factory`, and `allow_real_asr`;
- assert the five CLI modes dispatch one normalized JSON string, the expected project root, and the
  correct progress callback;
- keep the structured-failure exit rule: worker task failures exit 0, failed model download exits 1.

Do not assert `DEFAULT_SOURCE_RESOLVER` object identity; it is intentionally moving.

**Step 3: Move contract constants to their real owner in tests**

Change `test_contract.py` to import all contract/environment constants from
`frameq_worker.desktop_contract`, and import `DEFAULT_ASR_MODEL` from `frameq_worker.asr`. Remove
`import frameq_worker.cli as cli` and the compatibility `getattr(cli, "CACHE_DIR_ENV")` assertion.
The test remains green because this is a test-owner correction, not production movement.

**Step 4: Run focused characterization**

Run:

```powershell
uv run pytest worker/tests/test_worker_service_facade.py worker/tests/test_cli.py `
  worker/tests/test_contract.py
```

Expected: all tests pass against the current broad implementation. This is a characterization
GREEN, not a refactor RED.

Current restricted-session equivalent:

```powershell
& 'D:\Github\FrameQ\.venv\Scripts\python.exe' -m pytest `
  worker/tests/test_worker_service_facade.py worker/tests/test_cli.py worker/tests/test_contract.py `
  --basetemp app/src-tauri/target
```

**Step 5: Commit**

```powershell
git add worker/tests/test_worker_service_facade.py worker/tests/test_cli.py `
  worker/tests/test_contract.py
git commit -m "test(worker): characterize application facade"
```

### Task 3: Establish the Private Tree and Extract URL Processing

**Files:**

- Create: `worker/frameq_worker/worker_application/__init__.py`
- Create: `worker/frameq_worker/worker_application/defaults.py`
- Create: `worker/frameq_worker/worker_application/url_processing.py`
- Create: `worker/frameq_worker/worker_application/local_media.py`
- Create: `worker/frameq_worker/worker_application/source_identity.py`
- Create: `worker/frameq_worker/worker_application/insight_retry.py`
- Create: `worker/frameq_worker/worker_application/model_download.py`
- Create: `worker/tests/test_worker_application_boundaries.py`
- Modify: `worker/frameq_worker/worker_service.py`
- Modify: `worker/tests/test_worker_service_facade.py`
- Modify: `worker/tests/test_task_artifacts.py`

**Step 1: Write the exact private-tree RED**

The first test in `test_worker_application_boundaries.py` must run even before the tree exists.
Dependent checks skip until it is complete:

```python
EXPECTED_PRIVATE_FILES = {
    "__init__.py",
    "defaults.py",
    "insight_retry.py",
    "local_media.py",
    "model_download.py",
    "source_identity.py",
    "url_processing.py",
}


def test_worker_application_private_tree_matches_design() -> None:
    assert _private_python_files() == EXPECTED_PRIVATE_FILES
    assert (PRIVATE_ROOT / "__init__.py").read_text(encoding="utf-8").strip() == ""
```

Run:

```powershell
uv run pytest worker/tests/test_worker_application_boundaries.py -k private_tree
```

Expected RED: actual set is empty and differs from `EXPECTED_PRIVATE_FILES`.

**Step 2: Add empty skeleton modules**

Create the exact seven-file package. `__init__.py` must be empty and must never re-export a handler.
The five not-yet-extracted handler files may be empty during this task. `defaults.py` begins with
production dependency composition:

```python
DEFAULT_SOURCE_RESOLVER = build_default_source_resolver()


def should_allow_real_asr(environ: dict[str, str] | None = None) -> bool:
    env = environ if environ is not None else os.environ
    return env.get("FRAMEQ_ALLOW_REAL_ASR") == "1"
```

It may directly expose imported `build_asr_transcriber` and `build_insight_client_from_env` to its
sibling handlers, but `worker_application/__init__.py` stays empty.

Rerun the private-tree test. Expected GREEN.

**Step 3: Write URL ownership/re-export RED**

Add tests that expect:

```python
def test_worker_service_reexports_url_handler_object() -> None:
    assert worker_service.run_worker_once is url_processing.run_worker_once
```

Add an AST assertion that `run_worker_once` is owned by `url_processing.py`, and add focused
behavior tests that patch `url_processing.run_worker_pipeline` rather than the facade root.

Run:

```powershell
uv run pytest worker/tests/test_worker_service_facade.py `
  worker/tests/test_worker_application_boundaries.py `
  worker/tests/test_task_artifacts.py -k "run_worker_once or url"
```

Expected RED: `url_processing.run_worker_once` is absent and the current function is defined in
`worker_service.py`.

**Step 4: Move URL composition with no behavior change**

Move the existing URL function body and its narrowly required imports to
`worker_application/url_processing.py`. Its public callable retains the characterized parameters
and uses:

```python
source_request_resolver: SourceRequestResolver = (
    DEFAULT_SOURCE_RESOLVER.resolve_request
)
```

Use `defaults.build_asr_transcriber` and `defaults.should_allow_real_asr`. Do not copy pipeline,
request, source, persistence, or failure logic into `defaults.py`.

Replace the root definition temporarily with a direct import:

```python
from frameq_worker.worker_application.url_processing import run_worker_once
```

The other four use cases remain in `worker_service.py` until their own tasks.

**Step 5: Run focused and whole Worker regression**

Run:

```powershell
uv run pytest worker/tests/test_worker_service_facade.py `
  worker/tests/test_worker_application_boundaries.py `
  worker/tests/test_cli.py worker/tests/test_task_artifacts.py
uv run pytest worker/tests
uv run ruff check worker
```

Expected: focused and full Worker tests pass; Ruff exits 0.

**Step 6: Commit**

```powershell
git add worker/frameq_worker/worker_application worker/frameq_worker/worker_service.py `
  worker/tests/test_worker_application_boundaries.py `
  worker/tests/test_worker_service_facade.py worker/tests/test_task_artifacts.py
git commit -m "refactor(worker): extract URL application handler"
```

### Task 4: Extract Local-Media Processing

**Files:**

- Modify: `worker/frameq_worker/worker_application/local_media.py`
- Modify: `worker/frameq_worker/worker_service.py`
- Modify: `worker/tests/test_worker_application_boundaries.py`
- Modify: `worker/tests/test_worker_service_facade.py`
- Modify: `worker/tests/test_cli.py`

**Step 1: Write local-media ownership RED**

Add:

```python
def test_worker_service_reexports_local_media_handler_object() -> None:
    assert worker_service.run_local_media_once is local_media.run_local_media_once
```

Add a focused behavior test proving invalid JSON and invalid strict local-media payloads continue
to return only `LOCAL_MEDIA_VALIDATION_FAILED`, without request/path echo.

Run the focused tests. Expected RED: handler function is absent and the facade still owns it.

**Step 2: Move the implementation**

Move `run_local_media_once` and only its imports to `worker_application/local_media.py`. Preserve:

- `project_root or Path.cwd()`;
- combined JSON/request validation failure;
- runtime environment loading;
- `command_runner`, `transcriber`, `transcriber_factory`, `allow_real_asr`, and progress injection;
- recovery versus commit failure mapping;
- `result.to_dict()` shape.

Direct-import the handler from `worker_service.py`; do not add a wrapper.

**Step 3: Run focused and complete Worker gates**

Run:

```powershell
uv run pytest worker/tests/test_worker_service_facade.py `
  worker/tests/test_worker_application_boundaries.py worker/tests/test_cli.py `
  -k "local_media or facade"
uv run pytest worker/tests
uv run ruff check worker
```

Expected: all pass.

**Step 4: Commit**

```powershell
git add worker/frameq_worker/worker_application/local_media.py `
  worker/frameq_worker/worker_service.py worker/tests/test_worker_application_boundaries.py `
  worker/tests/test_worker_service_facade.py worker/tests/test_cli.py
git commit -m "refactor(worker): extract local media application handler"
```

### Task 5: Extract Source Identity and Platform Defaults

**Files:**

- Modify: `worker/frameq_worker/worker_application/defaults.py`
- Modify: `worker/frameq_worker/worker_application/source_identity.py`
- Modify: `worker/frameq_worker/worker_service.py`
- Modify: `worker/tests/test_worker_application_boundaries.py`
- Modify: `worker/tests/test_worker_service_facade.py`
- Modify: `worker/tests/test_cli.py`

**Step 1: Write resolver ownership/default RED**

Add direct identity expectation:

```python
def test_worker_service_reexports_source_identity_handler_object() -> None:
    assert (
        worker_service.resolve_source_identity_once
        is source_identity.resolve_source_identity_once
    )
```

Add behavior tests that monkeypatch
`frameq_worker.platform_source_resolvers.parse_bilibili_input` and call the stable facade without
passing a resolver. The `b23.tv` fixture must resolve to its canonical Bilibili URL. Retain a
separate injected-resolver test.

Expected RED: the private handler is absent; if only the current raw facade default is exercised,
the short-link default does not match real CLI behavior.

**Step 2: Move identity handling**

Move JSON parsing, URL validation, `SourceIdentityError` mapping, and safe completed result into
`worker_application/source_identity.py`. Default the resolver to:

```python
source_request_resolver: SourceRequestResolver = (
    DEFAULT_SOURCE_RESOLVER.resolve_request
)
```

Keep only canonical `source_url` plus `source_identity` in success. Never echo failed raw input.
Direct-import the function from `worker_service.py`.

**Step 3: Verify URL and identity share the same production resolver owner**

The source-boundary test must assert that only `defaults.py` imports
`build_default_source_resolver` and only URL/source-identity handlers import
`DEFAULT_SOURCE_RESOLVER`. `cli.py` must stop importing it in Task 8, not earlier if intermediate
compatibility still needs the wrapper.

**Step 4: Run tests**

```powershell
uv run pytest worker/tests/test_worker_service_facade.py `
  worker/tests/test_worker_application_boundaries.py worker/tests/test_cli.py `
  -k "source_identity or short or facade"
uv run pytest worker/tests
uv run ruff check worker
```

Expected: all pass and short-link output remains non-echoing.

**Step 5: Commit**

```powershell
git add worker/frameq_worker/worker_application/defaults.py `
  worker/frameq_worker/worker_application/source_identity.py `
  worker/frameq_worker/worker_service.py worker/tests/test_worker_application_boundaries.py `
  worker/tests/test_worker_service_facade.py worker/tests/test_cli.py
git commit -m "refactor(worker): extract source identity handler"
```

### Task 6: Extract AI Retry and Make Task Paths Explicit

**Files:**

- Modify: `worker/frameq_worker/worker_application/insight_retry.py`
- Modify: `worker/frameq_worker/worker_service.py`
- Modify: `worker/tests/test_worker_application_boundaries.py`
- Modify: `worker/tests/test_worker_service_facade.py`
- Modify: `worker/tests/test_task_artifacts.py`
- Modify: `worker/tests/test_output_language.py`

**Step 1: Write handler ownership and typed-path RED**

Add direct re-export expectation and an AST/type assertion:

```python
def test_insight_retry_helpers_require_task_paths() -> None:
    module = importlib.import_module(
        "frameq_worker.worker_application.insight_retry"
    )
    for name in {
        "merge_existing_ai_artifacts",
        "read_existing_summary",
        "read_existing_insights",
    }:
        parameter = inspect.signature(getattr(module, name)).parameters["paths"]
        assert parameter.annotation in {TaskPaths, "TaskPaths"}

    source = INSIGHT_RETRY_PATH.read_text(encoding="utf-8")
    assert "getattr(paths" not in source
```

Expected RED: the functions are absent from the private module and current helpers accept
`paths: object`.

**Step 2: Move the complete retry use case**

Move the following into `worker_application/insight_retry.py` as one failure boundary:

- `InsightClientFactory`;
- `retry_insights_once`;
- `merge_existing_ai_artifacts`;
- `read_existing_summary`;
- `read_existing_insights`;
- `failed_insight_retry_result`.

Use the actual task path type:

```python
def merge_existing_ai_artifacts(
    paths: TaskPaths,
    result: ProcessResult,
) -> ProcessResult:
    ...


def read_existing_summary(paths: TaskPaths) -> str:
    summary_path = paths.summary_path
    ...


def read_existing_insights(paths: TaskPaths) -> list[Insight]:
    insights_path = paths.insights_json_path
    ...
```

Default client composition comes from `defaults.build_insight_client_from_env`. Preserve every
existing result status/code/message, official transcript path, target/language/preference input,
artifact merge rule, and task transaction/recovery mapping.

Direct-import only `retry_insights_once` into `worker_service.py`; helpers remain private to the
handler module.

**Step 3: Run AI/persistence regression**

```powershell
uv run pytest worker/tests/test_worker_service_facade.py `
  worker/tests/test_worker_application_boundaries.py `
  worker/tests/test_task_artifacts.py worker/tests/test_output_language.py `
  -k "retry or insight or summary or output_language or facade"
uv run pytest worker/tests
uv run ruff check worker
```

Expected: all pass; fake Insight clients observe the same prompt count and output-language values.

**Step 4: Commit**

```powershell
git add worker/frameq_worker/worker_application/insight_retry.py `
  worker/frameq_worker/worker_service.py worker/tests/test_worker_application_boundaries.py `
  worker/tests/test_worker_service_facade.py worker/tests/test_task_artifacts.py `
  worker/tests/test_output_language.py
git commit -m "refactor(worker): extract insight retry application handler"
```

### Task 7: Extract ASR Model Download and Migrate the Test Seam

**Files:**

- Modify: `worker/frameq_worker/worker_application/model_download.py`
- Modify: `worker/frameq_worker/worker_service.py`
- Modify: `worker/tests/test_worker_application_boundaries.py`
- Modify: `worker/tests/test_worker_service_facade.py`
- Modify: `worker/tests/test_model_download.py`

**Step 1: Write model-download ownership RED**

Add:

```python
def test_worker_service_reexports_model_download_handler_object() -> None:
    assert (
        worker_service.run_asr_model_download_once
        is model_download_handler.run_asr_model_download_once
    )
```

Update the three terminal-result tests to patch the true owner:

```python
import frameq_worker.worker_application.model_download as model_download_handler
from frameq_worker.worker_service import run_asr_model_download_once

monkeypatch.setattr(
    model_download_handler,
    "download_asr_model_cache",
    fake_download,
)
```

Expected RED before the move: the private handler has no entry and patching it cannot influence the
facade implementation.

**Step 2: Move model download**

Move constants, `_safe_model_download_failure`, and `run_asr_model_download_once` to the handler.
Preserve:

- `load_project_env`;
- default `<project>/models` path;
- optional URL/hash/revision/endpoint forwarding;
- progress callback;
- archive-invalid versus generic safe failure;
- third-party exception suppression;
- success model name.

Direct-import only `run_asr_model_download_once` from the facade.

**Step 3: Run focused and complete gates**

```powershell
uv run pytest worker/tests/test_model_download.py `
  worker/tests/test_worker_service_facade.py `
  worker/tests/test_worker_application_boundaries.py
uv run pytest worker/tests
uv run ruff check worker
```

Expected: all pass and no secret fixture appears in terminal results.

**Step 4: Commit**

```powershell
git add worker/frameq_worker/worker_application/model_download.py `
  worker/frameq_worker/worker_service.py worker/tests/test_model_download.py `
  worker/tests/test_worker_application_boundaries.py `
  worker/tests/test_worker_service_facade.py
git commit -m "refactor(worker): extract model download application handler"
```

### Task 8: Atomically Close the CLI and Stable Facade

**Files:**

- Modify: `worker/frameq_worker/cli.py`
- Modify: `worker/frameq_worker/worker_service.py`
- Modify: `worker/frameq_worker/__main__.py` only if formatting/import proof requires it
- Modify: `worker/tests/test_cli.py`
- Modify: `worker/tests/test_contract.py`
- Modify: `worker/tests/test_task_artifacts.py`
- Modify: `worker/tests/test_worker_service_facade.py`
- Modify: `worker/tests/test_worker_application_boundaries.py`

**Step 1: Complete the source-boundary RED**

The final gate must prove all of the following:

```python
EXPECTED_FACADE_SYMBOLS = {
    "run_worker_once",
    "run_local_media_once",
    "resolve_source_identity_once",
    "retry_insights_once",
    "run_asr_model_download_once",
}
```

- `worker_service.__all__` is exactly the ordered five-name list approved in the design;
- every facade symbol is the exact object from its handler module;
- facade AST contains only `from __future__`, direct imports, and one exact `__all__` assignment,
  and stays below 80 lines;
- `cli.py` defines no `__all__`;
- no function in `cli.py` has `ast.arguments.vararg` or `kwarg`;
- CLI imports no `asr`, `llm`, `media_preparation`, `pipeline`, `requests`,
  `platform_source_resolvers`, or handler module;
- CLI imports only stdlib, `worker_service` as a module, desktop event prefixes, and progress
  validators;
- only `worker_service.py` imports the five use-case handler modules in production code;
- handlers import no sibling use-case handler and have no back-edge to `cli.py` or
  `worker_service.py`;
- only `defaults.py` owns production factory/resolver composition;
- `insight_retry.py` uses `TaskPaths` and no `getattr(paths, ...)`;
- `__main__.py` imports only `cli.main`.

Run:

```powershell
uv run pytest worker/tests/test_worker_application_boundaries.py
```

Expected RED: current CLI still has broad imports, `__all__`, and wrappers; current facade still
contains implementation.

**Step 2: Reduce `worker_service.py` to direct imports**

The whole file becomes:

```python
from __future__ import annotations

from frameq_worker.worker_application.insight_retry import retry_insights_once
from frameq_worker.worker_application.local_media import run_local_media_once
from frameq_worker.worker_application.model_download import (
    run_asr_model_download_once,
)
from frameq_worker.worker_application.source_identity import (
    resolve_source_identity_once,
)
from frameq_worker.worker_application.url_processing import run_worker_once

__all__ = [
    "run_worker_once",
    "run_local_media_once",
    "resolve_source_identity_once",
    "retry_insights_once",
    "run_asr_model_download_once",
]
```

Do not retain helper aliases, type aliases, constants, or wrappers.

**Step 3: Reduce `cli.py` to the process adapter**

Keep:

- stdlib `argparse`, `json`, `sys`, `Sequence`, `TextIOBase`, and `Path`;
- `from frameq_worker import worker_service as worker_service_module`;
- the two event prefixes and progress validators;
- `MAX_STDIN_REQUEST_BYTES`, `StdinRequestError`, bounded request read, stdin failure result;
- result/progress render and print helpers;
- argparse, mode selection, dispatch, one terminal print, exit status.

Replace every wrapper call with module-qualified facade dispatch:

```python
result = worker_service_module.run_worker_once(...)
```

Delete CLI `__all__`, `DEFAULT_SOURCE_RESOLVER`, all four forwarding wrappers, and every ASR/LLM/
request/pipeline/media helper import.

**Step 4: Migrate CLI tests to real owners**

In `test_cli.py`:

- keep `import frameq_worker.cli as cli` for `main`, `sys`, and
  `MAX_STDIN_REQUEST_BYTES`;
- import render helpers directly from `cli.py`;
- import event prefixes from `desktop_contract.py`;
- import application functions from `worker_service.py`;
- patch `cli.worker_service_module.run_worker_once`,
  `run_local_media_once`, `retry_insights_once`, `resolve_source_identity_once`, and
  `run_asr_model_download_once` in dispatch tests.

In `test_task_artifacts.py`, patch
`frameq_worker.worker_application.url_processing.run_worker_pipeline` when testing the URL handler,
not the stable facade root.

**Step 5: Run boundary and full Worker gates**

```powershell
uv run pytest worker/tests/test_worker_application_boundaries.py `
  worker/tests/test_worker_service_facade.py worker/tests/test_cli.py `
  worker/tests/test_contract.py worker/tests/test_task_artifacts.py
uv run pytest worker/tests
uv run ruff check worker
```

Expected: boundary, focused behavior, full Worker, and Ruff all pass.

**Step 6: Commit**

```powershell
git add worker/frameq_worker/cli.py worker/frameq_worker/worker_service.py `
  worker/frameq_worker/__main__.py worker/tests/test_cli.py worker/tests/test_contract.py `
  worker/tests/test_task_artifacts.py worker/tests/test_worker_service_facade.py `
  worker/tests/test_worker_application_boundaries.py
git commit -m "refactor(worker): close CLI application boundary"
```

### Task 9: Complete Validation, Evidence, and Plan Archival

**Files:**

- Modify: `AGENTS.md`
- Modify: `TASKS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify:
  `docs/exec-plans/active/2026-07-24-python-worker-application-facade-plan.md`
- Move:
  `docs/exec-plans/active/2026-07-24-python-worker-application-facade-plan.md`
  to
  `docs/exec-plans/completed/2026-07-24-python-worker-application-facade-plan.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`

**Step 1: Run complete Python validation**

Canonical commands:

```powershell
uv run pytest worker/tests
uv run ruff check worker
```

Restricted-session equivalents when the same cache restriction remains:

```powershell
& 'D:\Github\FrameQ\.venv\Scripts\python.exe' -m pytest worker/tests `
  --basetemp app/src-tauri/target
& 'D:\Github\FrameQ\.venv\Scripts\ruff.exe' check worker
```

Expected: all Worker tests pass with only already-recorded warnings; Ruff exits 0.

**Step 2: Verify generator and recursive packaged-worker equality**

Run:

```powershell
node --test scripts/tests/*.test.mjs
npm --prefix app run tauri -- build --no-bundle
```

Expected:

- every repository script test passes;
- the source/mirror comparison includes all seven new `worker_application` files with identical
  relative paths and bytes;
- Tauri release `--no-bundle` succeeds;
- no tracked generated mirror file is hand-edited.

**Step 3: Run governance and whitespace gates**

```powershell
python scripts/validate_agents_docs.py --level WARN
git diff --check
git status --short
```

Expected: zero governance errors/warnings, clean whitespace, and only intentional tracked changes
before the final documentation commit.

**Step 4: Update durable evidence**

- Change architecture/security text from accepted/pending to implemented.
- Update both affected Python UML nodes and call edges to show CLI -> facade -> five handlers.
- Move the high-priority debt item to resolved with exact test counts and residual risks.
- Check the task, update `AGENTS.md`, and move the ExecPlan from active to completed indexes.
- Fill `Outcomes & Retrospective` and every Progress checkbox with actual command evidence and
  commit hashes. Do not predeclare a platform or network check as passed.

**Step 5: Re-run documentation gates**

```powershell
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Expected: both pass.

**Step 6: Commit**

```powershell
git add AGENTS.md TASKS.md docs/ARCHITECTURE.md docs/SECURITY.md `
  docs/design-docs/frameq-code-audit-uml.md docs/exec-plans/active/index.md `
  docs/exec-plans/completed/index.md docs/exec-plans/tech-debt-tracker.md `
  docs/exec-plans/completed/2026-07-24-python-worker-application-facade-plan.md
git commit -m "docs(worker): record application facade refactor"
```

## Validation Matrix

| Boundary | Evidence |
|----------|----------|
| Five callable contracts | exact signature characterization and exact direct-object re-export |
| CLI transport | five mode dispatch tests, bounded stdin tests, progress/result rendering, exit status |
| URL behavior | request parsing, platform-aware short-link default, injected resolver, persistence failures |
| Local media | strict v4 request, path non-echoing, pipeline injection, persistence failures |
| Source identity | invalid JSON/payload, safe canonical result, platform short link, injected resolver |
| AI retry | invalid request, task open, preference save, output language, merge, finalize/recovery/commit |
| Typed paths | `TaskPaths` annotations plus direct-field implementation and no dynamic `getattr` |
| Model download | environment forwarding, success, archive-invalid, generic non-echoing failure |
| Dependency direction | exact private tree, root-only imports, no sibling/back-edge, empty initializer |
| Packaging | Node recursive file/byte comparison plus Tauri release `--no-bundle` |
| Repository governance | docs validator, active/completed indexes, task/debt/audit evidence, diff check |

## Rollback, Recovery, and Idempotence

- Every extraction is committed separately after focused and full Worker GREEN. If a later slice
  fails, revert only that slice rather than restoring the broad CLI wholesale.
- Intermediate commits retain the five stable facade callables. CLI closure happens only after all
  handlers exist, avoiding a half-migrated production entry.
- Handler extraction moves code without changing persisted schemas. No data migration, cleanup, or
  irreversible filesystem action is part of this plan.
- Tests use temporary task roots and fake external dependencies. Rerunning them must not consume AI
  Credits, download a real model, or contact public platforms.
- The Tauri worker mirror is regenerated by the supported build path. Delete no canonical source
  file and do not manually reconcile generated mirror drift.
- If `uv`/pytest user-cache permissions fail, use the locked project venv and repository-ignored
  basetemp shown above. Record the environment workaround separately from code/test results.

## Scope Exclusions and Residual Risks

- No CLI flag, protocol version, result/progress code, manifest schema, UI behavior, or product copy
  is added or removed.
- No generic `BaseHandler`, application registry, service locator, dependency-injection container,
  or additional Python dependency is introduced.
- No pipeline, ASR runtime, media preparation, platform fallback, task store, or InsightFlow
  internal refactor is included.
- Real platform pages can change independently. Automated short-link tests use deterministic fakes;
  existing real-platform smoke remains a separate release risk.
- A real ASR model download, live LLM call, and native end-to-end media run are not required for this
  ownership-only change. If not run, they must remain explicitly unverified.
- The existing Python 3.12 `pydub/audioop` deprecation warning is unrelated and remains separate
  tracked debt.
