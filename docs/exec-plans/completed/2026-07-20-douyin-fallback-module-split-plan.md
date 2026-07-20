# Douyin Fallback Module Split Implementation Plan

**Status:** Implemented, fully verified, and archived; awaiting local commit authorization.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 515-line Douyin public-video fallback into focused private Python modules while
preserving its stable root imports, public-link policy, process-local anonymous cookies, Router Data
and ratio-probe behavior, failures, progress, artifact lifecycle, and downstream FrameQ behavior.

**Architecture:** Keep `frameq_worker.douyin_fallback` as the sole compatibility/application
adapter and move shared types, source policy, Router Data interpretation, stream/probe policy, and
HTTP/download effects into a private `frameq_worker.douyin` package. Keep complete workflow,
output naming, candidate ordering wrapper, and all progress in the root. Use ordinary functions,
immutable values, and one narrow HTTP protocol instead of another facade class or a generic
multi-platform downloader framework.

**Tech Stack:** Python 3.11+, pytest, Ruff, urllib, CookieJar, JSON, existing
`download_reliability.py` atomic response writer, Node packaged-worker mirror tests, Tauri build.

**Execution authority:** Commit commands below mark intended review boundaries. Execute them only
after the user explicitly authorizes local commits. This plan does not authorize pushing, merging,
tagging, publishing, creating a PR, accessing account/browser cookies, or running credentialed
platform tests.

---

## Purpose / Big Picture

FrameQ users should observe no product change. A supported public Douyin video still tries `yt-dlp`
first, then uses the existing public share-page fallback, creates one local MP4, and continues
through media validation, audio extraction, ASR, History, and separately confirmed AI flows.

The change gives maintainers separately reviewable source, Router Data, stream/probe, and
transport/filesystem boundaries. It does not add login, browser cookies, slides/image output,
private-content access, a quality picker, batch download, a new worker command, a result field, or a
shared platform fallback framework.

## Progress

- [x] 2026-07-20: Inspected `AGENTS.md`, `WORKFLOW.md`, execution gates, architecture/design/security
  boundaries, both current active plans, the current Douyin implementation/product/reference,
  shared download reliability, repository callers, progress ownership, prior platform split
  designs, and recent history. Validation: read-only source/import searches; the focused
  Douyin/media/source/progress/download set passed 181/181; governance validation passed with 0
  errors and 0 warnings.
- [x] 2026-07-20: Selected a stable root adapter plus private Douyin package split by current
  failure boundaries; rejected comments-only, one helper bucket, mechanical platform copying, and a
  multi-platform framework. Validation: design recorded in
  `docs/design-docs/2026-07-20-douyin-fallback-module-split.md` against baseline `98b4197`.
- [x] 2026-07-20: Published the proposed design, active ExecPlan, TASKS/audit status, and governance
  entry points for user review without modifying production source. Validation: governance passed
  with 0 errors/0 warnings; placeholder and trailing-whitespace scans had no matches;
  `git diff --check` passed; worktree status contains exactly the six intended documentation and
  governance files.
- [x] 2026-07-20: Added root-surface, direct-ID, bit-rate-first, Range-removal, prior-output,
  fixed-failure, progress, and exact full-request-order characterization before moving production
  implementation. Validation: Douyin behavior passed 16/16 and the expanded baseline focused set
  passed 186/186.
- [x] 2026-07-20: Added the private-package owner/import/side-effect/progress AST suite and captured
  RED before extraction. Validation: initial boundary run produced the expected 16 absent-owner/
  root-residue failures and 2 already-valid assertions; no expectation was weakened.
- [x] 2026-07-20: Extracted shared types, transport, Router Data, streams, source policy, and root
  composition in independently checked increments. Validation: types behavior 52 passed;
  transport behavior 145 passed with boundary advanced to 10 passes/9 expected failures;
  page/streams behavior 136 passed with 15 passes/4 expected source failures; source behavior
  88 passed; final ownership 19/19 and focused 205/205 passed with Ruff clean.
- [x] 2026-07-20: Closed the root at 132 physical lines and measured private owners: empty init 0,
  types 38, source 87, page 61, streams 183, transport 118; behavior tests 513 and boundary tests
  212. Exact root type/client identities, four progress literals, and root-only production entry
  remain enforced.
- [x] 2026-07-20: Completed full Windows, cross-layer, package, mirror, and governance closeout.
  Validation: worker 501/501 with one unchanged `audioop` deprecation warning; app 549/549; Rust
  169/169 under normal Windows process permissions; scripts 23/23; Ruff, TypeScript/i18n lint,
  rustfmt, frontend build, Tauri release no-bundle, recursive 50/50 worker equality, governance,
  placeholder, and diff gates passed. A sandbox-only `taskkill` race reproduced on unchanged main
  and passed both focused and full Rust runs outside the sandbox. Live Douyin and macOS runtime
  smoke remain explicitly unverified.
- [x] Add missing behavior characterization and RED module-boundary tests before moving production
  implementation. Validation: exact passing behavior counts and expected boundary failures are
  recorded above.
- [x] Extract types, transport, page, streams, source, and root composition in independently green
  increments. Validation: the focused set and Ruff passed after each owner became active.
- [x] Complete full worker/cross-layer/package gates, record native/live evidence, update durable
  architecture/security/audit evidence, and archive this plan.

## Surprises & Discoveries

Evidence: `media.py` imports `DouyinFallbackError`, `download_douyin_video`, and
`extract_aweme_id`, while `platform_source_resolvers.py` imports the error and
`resolve_aweme_id_from_input`. Tests additionally import `HttpResponse`, the candidate type,
constants, builders, parsers, selection, and candidate-download helpers. The root path must remain
stable even though implementation moves.

Evidence: `test_progress_events.py` scans `douyin_fallback.py` itself for
`douyin.page.resolving`, `douyin.stream.probing`, `douyin.video.saving`, and
`douyin.stream.retrying`. Progress sequencing and every code literal therefore remain in the root
adapter, not in source, stream, or transport helpers.

Evidence: one `UrllibDouyinHttpClient` owns one `CookieJar` and is reused across ID resolution, the
share page, ratio probes, and final media download in `download_douyin_video`. The standalone source
resolver checks a direct ID before constructing its default client. Both lifetime and lazy behavior
are observable and must be characterized before extraction.

Evidence: candidate acquisition has two distinct phases. `collect_stream_candidates` prefers
declared `bit_rate` entries and probes the fixed five ratios only when none survive. Final download
then sorts/deduplicates again and strips the probe `Range` header. Combining probe and download
transport would obscure this policy and risks sending `Range: bytes=0-1` during the real download.

Evidence: `select_stream_candidates` deduplicates by positive byte size, not URL or quality, after a
stable largest-size/quality-rank sort. Equal-size candidates therefore keep the higher-ranked first
entry. This is current product behavior and not an optimization opportunity inside the split.

Evidence: `write_http_response_atomically` already validates status/content type/body, writes a
destination-adjacent `.part`, and replaces only on success. Douyin transport should delegate to it
rather than invent another file-commit abstraction. The fallback currently does not use resumable
streaming, and this structural change must not claim or add it.

Evidence: a failed candidate request or `SafeDownloadError` is intentionally swallowed so the next
candidate can run; the fixed final error keeps the last exception only as an in-process cause. New
public errors, progress, logs, or assertion messages must not stringify that cause or a volatile
media URL.

Evidence: the generated Tauri worker directory is an ignored mirror. New package files must be
created only in the canonical worker and synchronized through the existing refresh path; recursive
file-set and byte equality remain release gates.

Evidence: active local-media work has completed contract v4 types but not its runtime pipeline. This
refactor must preserve the stable root fallback import so both work streams can integrate without
depending on each other's private modules. Rebase/merge order may change total test counts but not
Douyin behavior.

## Decision Log

- Decision: Keep `frameq_worker.douyin_fallback` as the only production import path outside the
  private package. Rationale: media dispatch, source resolution, progress coverage, and tests
  already depend on this path; root re-exports make internal movement non-breaking.
  Date/Author: 2026-07-20, User + Codex.
- Decision: Split into `types`, `source`, `page`, `streams`, and `transport` under one private
  `douyin` package. Rationale: these boundaries match current source, Router Data, probe/policy, and
  side-effect failure vocabularies; matching some Xiaohongshu filenames does not create shared code
  or copied platform semantics. Date/Author: 2026-07-20, User + Codex.
- Decision: Add no facade class, artifacts module, or shared three-platform framework. Rationale:
  the root module is already the application adapter, while `DownloadStrategy` and
  `download_reliability.py` own genuinely shared behavior. Date/Author: 2026-07-20, User + Codex.
- Decision: Keep candidate-order compatibility wrapping, output naming, and all `douyin.*` progress
  emission in the root. Rationale: these are workflow decisions spanning stream policy and
  transport, not responsibilities of either child. Date/Author: 2026-07-20, Codex.
- Decision: Preserve one default process-local `CookieJar`/client across one fallback invocation and
  direct-ID lazy resolution. Rationale: anonymous public-page cookies may be needed by later
  requests, while browser/persistent/account cookies remain forbidden. Date/Author: 2026-07-20,
  Codex.
- Decision: Preserve current request URLs, headers, timeouts, body handling, full-body atomic write,
  and failure messages. Rationale: changing transport policy while moving code would prevent
  reviewers from distinguishing behavior change from structural extraction. Date/Author:
  2026-07-20, Codex.
- Decision: Edit only the canonical worker and refresh the generated resource mirror through the
  established path. Rationale: hand-edited mirrors drift and the recursive equality gate already
  covers new private-package files. Date/Author: 2026-07-20, Codex.

## Outcomes & Retrospective

The approved design is implemented without changing the public product or worker contract. The
515-line hotspot became a 132-line stable root and five private owners aligned to source, Router
Data, stream/probe, and transport failures. The root still exposes every repository-observed name,
constructs one default client, owns the complete workflow and output naming, sorts before transport,
and emits all four registered progress codes. No facade class or cross-platform framework was
introduced.

Characterization and owner-boundary RED preceded movement. The completed focused suite passes
205/205, the full worker suite 501/501, App 549/549, normal-permission Windows Rust 169/169, and
scripts 23/23. Static/lint/build/package/governance gates are clean, and all 50 canonical worker
files match the generated Tauri resource mirror recursively. The only Python warning is the
unchanged third-party `audioop` deprecation notice.

Residual risk: Douyin public pages, Router Data fields, short-link behavior, anonymous cookies,
ratio endpoints, risk control, and media CDN behavior can change outside FrameQ. Deterministic fake
clients cannot prove live availability. No live network or macOS runtime check is claimed. The
fallback still has no explicit page-body cap or resumable final download; this structural change
preserves those facts rather than expanding scope. Local commit, merge, push, and publication remain
separate user-authorized actions.

## Context and Orientation

Design and governance:

- `docs/design-docs/2026-07-20-douyin-fallback-module-split.md`
- `docs/design-docs/frameq-code-audit-uml.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN.md`
- `docs/SECURITY.md`
- `WORKFLOW.md`
- `docs/EXECUTION_GATES.md`
- `AGENTS.md`
- `TASKS.md`

Existing product/security intent:

- `docs/product-specs/2026-06-16-douyin-video-transcription-client.md`
- `docs/references/easydownload-douyin-fallback.md`
- `docs/exec-plans/completed/2026-06-25-douyin-share-page-fallback-plan.md`
- `docs/design-docs/2026-07-18-source-identity-dependency-boundary.md`
- `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`

Canonical worker:

- `worker/frameq_worker/douyin_fallback.py`
- `worker/frameq_worker/download_reliability.py`
- `worker/frameq_worker/media.py`
- `worker/frameq_worker/platform_source_resolvers.py`
- `worker/frameq_worker/source_resolution.py`
- `worker/frameq_worker/progress_events.py`

Current tests and contracts:

- `worker/tests/test_douyin_fallback.py`
- `worker/tests/test_download_reliability.py`
- `worker/tests/test_media.py`
- `worker/tests/test_url_support_contract.py`
- `worker/tests/test_source_resolution.py`
- `worker/tests/test_progress_events.py`
- `worker/tests/test_import_boundaries.py`
- `contracts/platform-url-support-contract.json`
- `contracts/desktop-worker-contract.json`
- `scripts/tests/tauri-dev-fresh-worker.test.mjs`

Planned canonical modules:

- `worker/frameq_worker/douyin/__init__.py`
- `worker/frameq_worker/douyin/types.py`
- `worker/frameq_worker/douyin/source.py`
- `worker/frameq_worker/douyin/page.py`
- `worker/frameq_worker/douyin/streams.py`
- `worker/frameq_worker/douyin/transport.py`

## Planned File Responsibilities

| File | Responsibility |
|---|---|
| `douyin_fallback.py` | stable bindings, default dependency composition, complete page/probe/download workflow, output naming, candidate-order wrapper, four progress events |
| `douyin/types.py` | shared fixed error, immutable response/candidate values, narrow HTTP client protocol |
| `douyin/source.py` | input/host/share-text/ID parsing, direct-ID-first short-link resolution, share-page URL |
| `douyin/page.py` | Router Data marker/JSON traversal and first playable-item validation |
| `douyin/streams.py` | quality constants, play URL, bit-rate candidates, ratio probes, header parsing, size deduplication and ordering |
| `douyin/transport.py` | public headers, process-local CookieJar urllib client, ordered final requests, Range removal, atomic write and fixed final error |
| `test_douyin_fallback.py` | behavior characterization through the stable root import |
| `test_douyin_module_boundaries.py` | file ownership, import direction, side-effect ownership and root-only production/progress boundary |

## Plan of Work

### Task 0: Publish the approved design and active plan for review

**Files:**

- Create: `docs/design-docs/2026-07-20-douyin-fallback-module-split.md`
- Create: `docs/exec-plans/active/2026-07-20-douyin-fallback-module-split-plan.md`
- Modify: `AGENTS.md`
- Modify: `TASKS.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`

- [x] **Step 1: Register the design and active plan**

Add the design and plan to the existing governance entry points. Keep the existing release and
local-media plans active; this refactor is a third independent entry, not a replacement.

- [x] **Step 2: Record an unchecked refactoring task and proposed audit state**

The task must say that production source is unchanged and acceptance requires stable root imports,
fixed progress/errors/candidate policy, private-module AST gates, full regression, and packaged
worker equality. The audit row must link the proposed design without moving Douyin into the
resolved table.

- [x] **Step 3: Run planning-document gates**

Run:

```powershell
python scripts\validate_agents_docs.py --level WARN
rg -n "T[B]D|T[O]DO|implement[ ]later|fill[ ]in" docs\design-docs\2026-07-20-douyin-fallback-module-split.md docs\exec-plans\active\2026-07-20-douyin-fallback-module-split-plan.md
git diff --check
git status --short
```

Expected: governance reports `0 errors, 0 warnings`; the placeholder scan has no matches; diff check
passes; status lists only the six documentation/governance files above.

- [x] **Step 4: Stop for user review**

Do not add Python modules or tests. Present the design and ExecPlan paths, validation evidence, and
the unimplemented status to the user.

### Task 1: Lock current root behavior before extraction

**Files:**

- Modify: `worker/tests/test_douyin_fallback.py`
- Test: `worker/tests/test_douyin_fallback.py`

- [x] **Step 1: Add direct-ID, root-surface, and shared-client characterization**

Import the root module itself and add a client whose `get` fails if a direct ID performs I/O:

```python
import frameq_worker.douyin_fallback as douyin_fallback


class NoRequestClient:
    def get(self, *args: object, **kwargs: object) -> HttpResponse:
        raise AssertionError("direct aweme ID must not make an HTTP request")


def test_direct_aweme_id_resolution_is_network_free() -> None:
    assert (
        douyin_fallback.resolve_aweme_id_from_input(
            "https://www.douyin.com/video/7653372612151692594",
            http_client=NoRequestClient(),
        )
        == "7653372612151692594"
    )
```

Add an explicit required-root-name assertion for every name in the design compatibility surface.
Extend the full-flow fake-client test to assert the same client receives the share page, all five
ratio probes, and the final candidate request in exact order.

- [x] **Step 2: Characterize declared bit-rate preference and final Range removal**

Add a `bit_rate` fixture with two valid candidates and a fake client that rejects any probe URL.
Assert `collect_stream_candidates` performs no request, retains current width/height/header values,
orders largest bytes first, and deduplicates equal sizes. In final download, assert the request does
not contain a case-insensitive `Range` header even if the candidate does.

```python
assert all(key.lower() != "range" for key in client.calls[0][1])
```

- [x] **Step 3: Characterize old-output preservation and fixed final failure**

Create `<aweme_id>.mp4` with sentinel bytes, fail one candidate at request time and another through
an invalid empty media response, then assert:

```python
with pytest.raises(DouyinFallbackError) as exc_info:
    download_first_available_candidate(
        aweme_id="7653372612151692594",
        candidates=[request_failure, invalid_response],
        output_dir=tmp_path,
        http_client=client,
        progress_callback=events.append,
    )

assert exc_info.value.code == "DOUYIN_STREAM_DOWNLOAD_FAILED"
assert output_path.read_bytes() == b"existing completed video"
assert not output_path.with_name(f"{output_path.name}.part").exists()
```

Use only synthetic `cdn.example` URLs and do not include those URLs in exception assertions.

- [x] **Step 4: Run the characterization set**

Run:

```powershell
uv run pytest worker/tests/test_douyin_fallback.py -q
uv run pytest worker/tests/test_douyin_fallback.py worker/tests/test_media.py worker/tests/test_source_resolution.py worker/tests/test_url_support_contract.py worker/tests/test_progress_events.py worker/tests/test_download_reliability.py -q
```

Expected: all existing and new behavior tests pass before production code moves; record exact counts
in Progress.

- [ ] **Step 5: Commit the characterization tests only if authorized**

```powershell
git add worker/tests/test_douyin_fallback.py docs/exec-plans/active/2026-07-20-douyin-fallback-module-split-plan.md
git commit -m "test: characterize douyin fallback boundaries"
```

### Task 2: Establish RED private-module and ownership tests

**Files:**

- Create: `worker/tests/test_douyin_module_boundaries.py`
- Test: `worker/tests/test_douyin_module_boundaries.py`

- [x] **Step 1: Define planned files and an AST import helper**

```python
from __future__ import annotations

import ast
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[1] / "frameq_worker"
ROOT_MODULE = WORKER_ROOT / "douyin_fallback.py"
PACKAGE_ROOT = WORKER_ROOT / "douyin"
PLANNED_MODULES = {
    "types.py",
    "source.py",
    "page.py",
    "streams.py",
    "transport.py",
}


def imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    result: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            result.add(node.module)
    return result
```

- [x] **Step 2: Add file, back-edge, side-effect, progress, and production-import assertions**

Assert all planned files plus an empty `__init__.py` exist; no child imports
`frameq_worker.douyin_fallback`, application/task/ASR/AI modules, or another platform package; only
`transport.py` imports `urllib.request`, `http.cookiejar`, or
`frameq_worker.download_reliability`; only the root contains `douyin.*` progress literals; and no
production module outside the root imports `frameq_worker.douyin.*`.

Also assert `page.py` has no urllib/filesystem/progress imports and package `__init__.py` has no
imports or `__all__` compatibility surface.

- [x] **Step 3: Run RED and record exact causes**

Run:

```powershell
uv run pytest worker/tests/test_douyin_module_boundaries.py -q
```

Expected: assertions for absent private files and their future owners fail. Any assertion about the
current root-only production import and progress ownership that can already pass should pass. Record
the exact failing/passing count in Progress; do not weaken expected ownership to make RED green.

- [ ] **Step 4: Commit the RED boundary test only if authorized**

```powershell
git add worker/tests/test_douyin_module_boundaries.py docs/exec-plans/active/2026-07-20-douyin-fallback-module-split-plan.md
git commit -m "test: define douyin module ownership"
```

### Task 3: Extract shared types without changing root identities

**Files:**

- Create: `worker/frameq_worker/douyin/__init__.py`
- Create: `worker/frameq_worker/douyin/types.py`
- Modify: `worker/frameq_worker/douyin_fallback.py`
- Modify: `worker/tests/test_douyin_fallback.py`
- Test: `worker/tests/test_douyin_fallback.py`
- Test: `worker/tests/test_douyin_module_boundaries.py`

- [x] **Step 1: Create an empty package initializer**

Create a zero-export `douyin/__init__.py`. It must not import child modules or define `__all__`.

- [x] **Step 2: Move the fixed error and immutable values into `types.py`**

Use this complete shared shape:

```python
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Protocol


class DouyinFallbackError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class DouyinStreamCandidate:
    quality: str
    url: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes
    url: str


class DouyinHttpClient(Protocol):
    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> HttpResponse:
        pass
```

- [x] **Step 3: Re-export exact shared identities from the stable root**

Replace duplicate root class definitions with imports from `frameq_worker.douyin.types`. Add tests
using `is`, not only `isinstance`, to prove the root aliases are the exact child identities.

- [x] **Step 4: Prove identity and run focused tests**

Run:

```powershell
uv run pytest worker/tests/test_douyin_fallback.py worker/tests/test_download_reliability.py worker/tests/test_url_support_contract.py -q
uv run pytest worker/tests/test_douyin_module_boundaries.py -q
uv run ruff check worker/frameq_worker/douyin/types.py worker/frameq_worker/douyin_fallback.py worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py
```

Expected: behavior/identity tests pass; only not-yet-created owner assertions remain RED.

- [ ] **Step 5: Commit the type boundary only if authorized**

```powershell
git add worker/frameq_worker/douyin worker/frameq_worker/douyin_fallback.py worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py docs/exec-plans/active/2026-07-20-douyin-fallback-module-split-plan.md
git commit -m "refactor: extract douyin shared types"
```

### Task 4: Extract fixed HTTP and candidate-download transport

**Files:**

- Create: `worker/frameq_worker/douyin/transport.py`
- Modify: `worker/frameq_worker/douyin_fallback.py`
- Modify: `worker/tests/test_douyin_fallback.py`
- Test: `worker/tests/test_douyin_fallback.py`
- Test: `worker/tests/test_download_reliability.py`
- Test: `worker/tests/test_douyin_module_boundaries.py`

- [x] **Step 1: Move fixed headers and the concrete CookieJar client**

Move `DOUYIN_MOBILE_USER_AGENT`, `_public_headers`, and `UrllibDouyinHttpClient` into transport.
Keep the exact `urllib.request.build_opener(HTTPCookieProcessor(cookie_jar))`, GET method, 10-second
default, HTTPError-as-response behavior, and URLError mapping. Export `public_headers` as a private-
package helper and re-export the constant/client identity from the root.

- [x] **Step 2: Add an ordered-candidate transport function with no progress vocabulary**

Use a narrow callback that carries indexes only:

```python
from collections.abc import Callable, Sequence
from pathlib import Path

CandidateFailed = Callable[[int, int], None]


def download_ordered_candidates(
    aweme_id: str,
    candidates: Sequence[DouyinStreamCandidate],
    output_dir: Path,
    http_client: DouyinHttpClient,
    timeout_seconds: float = 30.0,
    on_candidate_failed: CandidateFailed | None = None,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{aweme_id}.mp4"
    last_error: Exception | None = None
    total = len(candidates)

    for index, candidate in enumerate(candidates):
        try:
            response = http_client.get(
                candidate.url,
                headers=_without_range_header(candidate.headers),
                timeout_seconds=timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001 - try next public candidate
            last_error = exc
            if on_candidate_failed is not None and index < total - 1:
                on_candidate_failed(index, total)
            continue

        try:
            write_http_response_atomically(response, output_path)
        except SafeDownloadError as exc:
            last_error = exc
            if on_candidate_failed is not None and index < total - 1:
                on_candidate_failed(index, total)
            continue

        return output_path

    raise DouyinFallbackError(
        "DOUYIN_STREAM_DOWNLOAD_FAILED",
        "All Douyin fallback streams failed to download.",
    ) from last_error
```

Move the existing request/`write_http_response_atomically` attempt loop into this function. Add the
private `_without_range_header` helper by moving the current case-insensitive implementation. It must
notify only after a failed non-final candidate, retain `last_error` as the fixed error's cause, and raise the exact fixed
`DOUYIN_STREAM_DOWNLOAD_FAILED` message. It must not sort candidates, emit progress, log, or include
URLs/paths in the error.

- [x] **Step 3: Keep the root compatibility wrapper responsible for sorting and retry progress**

Root `download_first_available_candidate` must call `select_stream_candidates` first and pass a
callback that applies the existing `1 <= attempt <= total <= 100` guard before emitting
`douyin.stream.retrying`. Preserve the public signature and output-directory behavior.

- [x] **Step 4: Run transport, reliability, media, progress, and boundary tests**

Run:

```powershell
uv run pytest worker/tests/test_douyin_fallback.py worker/tests/test_download_reliability.py worker/tests/test_media.py worker/tests/test_progress_events.py -q
uv run pytest worker/tests/test_douyin_module_boundaries.py -q
uv run ruff check worker/frameq_worker/douyin/transport.py worker/frameq_worker/douyin_fallback.py worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py
```

Expected: all behavior tests pass; boundary assertions advance so only page/streams/source owners
remain absent.

- [ ] **Step 5: Commit the transport boundary only if authorized**

```powershell
git add worker/frameq_worker/douyin/transport.py worker/frameq_worker/douyin_fallback.py worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py docs/exec-plans/active/2026-07-20-douyin-fallback-module-split-plan.md
git commit -m "refactor: extract douyin transport"
```

### Task 5: Extract Router Data and stream/probe policy

**Files:**

- Create: `worker/frameq_worker/douyin/page.py`
- Create: `worker/frameq_worker/douyin/streams.py`
- Modify: `worker/frameq_worker/douyin_fallback.py`
- Modify: `worker/tests/test_douyin_fallback.py`
- Test: `worker/tests/test_douyin_fallback.py`
- Test: `worker/tests/test_douyin_module_boundaries.py`

- [x] **Step 1: Move Router Data interpretation as one pure group**

Move `parse_share_page_router_data` and `_find_video_info_res` into `page.py`. Preserve marker
lookup, first `=` and `{`, `JSONDecoder.raw_decode`, recursive dict/list traversal, first-item
selection, exact error codes/messages, and no response/network ownership. Re-export
`parse_share_page_router_data` from the root.

- [x] **Step 2: Move stream selection and ratio probing as one policy group**

Move `PLAY_QUALITIES`, `QUALITY_RANK`, `CONTENT_RANGE_TOTAL_PATTERN`, `build_play_url`,
`collect_stream_candidates`, `select_stream_candidates`, `_collect_bit_rate_candidates`,
`_probe_play_addr_candidates`, and their pure parsing/header helpers into `streams.py`.

Keep this dependency-facing API:

```python
def collect_stream_candidates(
    item: Mapping[str, object],
    http_client: DouyinHttpClient,
    timeout_seconds: float = 10.0,
) -> list[DouyinStreamCandidate]:
    video = item.get("video")
    if not isinstance(video, Mapping):
        raise DouyinFallbackError(
            "DOUYIN_NO_PLAYABLE_STREAM",
            "Douyin item has no video.",
        )

    candidates = _collect_bit_rate_candidates(video)
    if not candidates:
        candidates = _probe_play_addr_candidates(
            video,
            http_client,
            timeout_seconds,
        )

    return select_stream_candidates(candidates)
```

Use `transport.public_headers` for fixed request/candidate headers. Preserve bit-rate-first behavior,
exact five-probe order, redirected response URLs, strict response acceptance, and size-only dedupe.
Re-export the constant and three public functions from the root.

- [x] **Step 3: Prove pure-page and stream/probe ownership**

Extend tests for nested `videoInfoRes`, malformed Router Data, bit-rate no-probe behavior, ratio
request order/headers, media content-type rejection, equal-size tie behavior, and the absence of
filesystem/progress imports from `page.py` and `streams.py`.

- [x] **Step 4: Run page/stream behavior and boundary tests**

Run:

```powershell
uv run pytest worker/tests/test_douyin_fallback.py worker/tests/test_url_support_contract.py worker/tests/test_progress_events.py -q
uv run pytest worker/tests/test_douyin_module_boundaries.py -q
uv run ruff check worker/frameq_worker/douyin/page.py worker/frameq_worker/douyin/streams.py worker/frameq_worker/douyin_fallback.py worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py
```

Expected: behavior tests pass; only source ownership remains RED.

- [ ] **Step 5: Commit the page/stream boundaries only if authorized**

```powershell
git add worker/frameq_worker/douyin/page.py worker/frameq_worker/douyin/streams.py worker/frameq_worker/douyin_fallback.py worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py docs/exec-plans/active/2026-07-20-douyin-fallback-module-split-plan.md
git commit -m "refactor: extract douyin page and stream policy"
```

### Task 6: Extract source and short-link policy

**Files:**

- Create: `worker/frameq_worker/douyin/source.py`
- Modify: `worker/frameq_worker/douyin_fallback.py`
- Modify: `worker/tests/test_douyin_fallback.py`
- Test: `worker/tests/test_douyin_fallback.py`
- Test: `worker/tests/test_source_resolution.py`
- Test: `worker/tests/test_url_support_contract.py`
- Test: `worker/tests/test_douyin_module_boundaries.py`

- [x] **Step 1: Move source constants and pure URL/ID parsing**

Move all ID/URL patterns, supported-host checks, trailing-punctuation stripping,
`extract_aweme_id`, `_extract_douyin_urls`, and `build_share_page_url` into `source.py`. Preserve
exact host suffix rules and URL ordering.

- [x] **Step 2: Move direct-ID-first short-link resolution**

Move `resolve_aweme_id_from_input` with its current behavior:

```python
def resolve_aweme_id_from_input(
    raw_input: str,
    http_client: DouyinHttpClient | None = None,
) -> str | None:
    direct_id = extract_aweme_id(raw_input)
    if direct_id:
        return direct_id

    client = http_client or UrllibDouyinHttpClient()
    for candidate_url in _extract_douyin_urls(raw_input):
        candidate_id = extract_aweme_id(candidate_url)
        if candidate_id:
            return candidate_id
        if not _is_douyin_short_link(candidate_url):
            continue
        try:
            response = client.get(
                candidate_url,
                headers=public_headers(),
                timeout_seconds=10.0,
            )
        except DouyinFallbackError:
            continue
        resolved_id = extract_aweme_id(response.url)
        if resolved_id:
            return resolved_id
        body = response.body.decode("utf-8", errors="replace") if response.body else ""
        for embedded_url in _extract_douyin_urls(body):
            embedded_id = extract_aweme_id(embedded_url)
            if embedded_id:
                return embedded_id
    return None
```

Keep one GET per supported short-link candidate, fixed public headers/timeout, redirect URL before
body URL inspection, swallowed fixed fallback errors, and `None` for unresolved input. Do not add
recursive link following, new hosts, or raw-error reporting.

- [x] **Step 3: Re-export source entry points and prove production callers remain root-only**

Root re-exports `extract_aweme_id`, `resolve_aweme_id_from_input`, and `build_share_page_url`.
`media.py` and `platform_source_resolvers.py` remain unchanged. Run identity/source tests and the AST
production-import assertion.

- [x] **Step 4: Run source, URL contract, media, and boundary tests**

Run:

```powershell
uv run pytest worker/tests/test_douyin_fallback.py worker/tests/test_source_resolution.py worker/tests/test_url_support_contract.py worker/tests/test_media.py -q
uv run pytest worker/tests/test_douyin_module_boundaries.py -q
uv run ruff check worker/frameq_worker/douyin/source.py worker/frameq_worker/douyin_fallback.py worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py
```

Expected: source behavior passes and every private owner file exists; any remaining boundary failure
must describe root closeout rather than a missing module.

- [ ] **Step 5: Commit the source boundary only if authorized**

```powershell
git add worker/frameq_worker/douyin/source.py worker/frameq_worker/douyin_fallback.py worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py docs/exec-plans/active/2026-07-20-douyin-fallback-module-split-plan.md
git commit -m "refactor: extract douyin source policy"
```

### Task 7: Close the stable root adapter and make ownership tests GREEN

**Files:**

- Modify: `worker/frameq_worker/douyin_fallback.py`
- Modify: `worker/tests/test_douyin_fallback.py`
- Modify: `worker/tests/test_douyin_module_boundaries.py`
- Test: `worker/tests/test_douyin_fallback.py`
- Test: `worker/tests/test_douyin_module_boundaries.py`

- [x] **Step 1: Keep only compatibility bindings and full workflow in the root**

The root import block must re-export the documented surface from private owners. Its executable
code is limited to `download_first_available_candidate`, `download_douyin_video`, `_emit_progress`,
and the bounded retry-progress adapter. `download_douyin_video` must retain this sequence:

```python
client = http_client or UrllibDouyinHttpClient()
aweme_id = resolve_aweme_id_from_input(url, http_client=client)
if aweme_id is None:
    raise DouyinFallbackError(
        "DOUYIN_ID_PARSE_FAILED",
        "Could not extract Douyin video ID from URL.",
    )

_emit_progress(progress_callback, "douyin.page.resolving", 22)
share_response = client.get(
    build_share_page_url(aweme_id),
    headers=public_headers(),
    timeout_seconds=10.0,
)
```

Then preserve the exact share-page status/body check, Router Data call, probe/saving events,
no-candidate error, output directory, timeout defaults, and candidate wrapper call.

- [x] **Step 2: Remove duplicate implementation and verify imports/identities**

Remove root-owned regex, JSON traversal, header parsing, concrete HTTP, candidate internals, and
atomic-write helpers only after their owners are green. Assert root aliases for the four shared
classes are exact child identities and every documented function remains callable from the root.

- [x] **Step 3: Make all AST/import ownership tests GREEN**

Run:

```powershell
uv run pytest worker/tests/test_douyin_module_boundaries.py -q
```

Expected: every owner, back-edge, side-effect, root-progress, empty-package, and root-only
production-import assertion passes.

- [x] **Step 4: Run the complete focused boundary set**

Run:

```powershell
uv run pytest worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py worker/tests/test_media.py worker/tests/test_source_resolution.py worker/tests/test_url_support_contract.py worker/tests/test_progress_events.py worker/tests/test_download_reliability.py -q
uv run ruff check worker/frameq_worker/douyin_fallback.py worker/frameq_worker/douyin worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py
```

Expected: all focused tests and Ruff pass. Record exact counts and physical module lines in
Progress; do not use a line-count target as the acceptance gate.

- [ ] **Step 5: Commit the root closeout only if authorized**

```powershell
git add worker/frameq_worker/douyin_fallback.py worker/frameq_worker/douyin worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py docs/exec-plans/active/2026-07-20-douyin-fallback-module-split-plan.md
git commit -m "refactor: split douyin fallback by failure boundary"
```

### Task 8: Prove full regression and canonical packaging

**Files:**

- Modify when refreshed by the established generator: `app/src-tauri/resources/worker/frameq_worker/**`
- Modify: `docs/exec-plans/active/2026-07-20-douyin-fallback-module-split-plan.md`

- [x] **Step 1: Run complete Python and cross-layer suites**

Run:

```powershell
uv run pytest worker/tests
uv run ruff check worker
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
node --test scripts/tests/*.test.mjs
```

Expected: all suites pass. Record exact counts and distinguish unchanged warnings from failures.
The Windows subprocess/cancellation suite may require normal host process permissions; if sandbox
permissions cause a reproducible false failure, rerun the identical command outside the sandbox and
record both observations without changing runtime code.

- [x] **Step 2: Refresh and verify the packaged worker through the established path**

Run:

```powershell
node --input-type=module -e "import { prepareFreshWorkerResource } from './scripts/tauri-dev-fresh-worker.mjs'; await prepareFreshWorkerResource();"
node --test scripts/tests/tauri-dev-fresh-worker.test.mjs
npm --prefix app run tauri -- build --no-bundle
```

Expected: the generated mirror contains the new private package, recursive relative-file and byte
equality pass, and the Tauri no-bundle release build succeeds. Never hand-edit the mirror.

- [x] **Step 3: Run governance, placeholder, link, and diff gates**

Run:

```powershell
python scripts/validate_agents_docs.py --level WARN
rg -n "T[B]D|T[O]DO|implement[ ]later|fill[ ]in" docs/design-docs/2026-07-20-douyin-fallback-module-split.md docs/exec-plans/active/2026-07-20-douyin-fallback-module-split-plan.md
git diff --check
git status --short
```

Expected: zero governance errors/warnings, no placeholder matches, clean diff formatting, and only
the intended implementation/test/documentation/mirror files.

- [x] **Step 4: Record optional live evidence truthfully**

If a stable credential-free public Douyin video and network are available, run one live fallback
smoke without browser cookies and record date, platform, selected candidate metadata, final MP4
validation, and sanitized outcome. Otherwise write that live public-page/CDN availability is
unverified. A live smoke is optional and must not weaken or delay deterministic gates.

### Task 9: Update durable evidence and archive the plan

**Files:**

- Modify: `docs/design-docs/2026-07-20-douyin-fallback-module-split.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `AGENTS.md`
- Modify: `TASKS.md`
- Move: `docs/exec-plans/active/2026-07-20-douyin-fallback-module-split-plan.md`
  to `docs/exec-plans/completed/2026-07-20-douyin-fallback-module-split-plan.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`

- [x] **Step 1: Replace proposed language with measured implementation evidence**

Record root/child/test line counts, exact focused/full totals, root import identities, failure and
artifact invariants, mirror counts, warnings, native-host evidence, and live-smoke status. Do not
claim that line count alone proves design quality.

- [x] **Step 2: Update architecture and security ownership**

Add the implemented stable-root/private-owner dependency direction, root-only production entry,
empty process-local CookieJar, volatile URL/error restrictions, atomic previous-output behavior,
and AST/mirror gates. Preserve the existing product/security prohibitions.

- [x] **Step 3: Update the audit without rewriting its historical baseline**

Move the Douyin responsibility row into the resolved-evidence table with measured results, and
replace the hotspot question with a maintenance note. Historical size snapshots remain labeled by
their original commit and are not silently rewritten.

- [x] **Step 4: Archive and validate closeout**

Move the plan to completed, update indexes/TASKS/AGENTS, run governance and diff gates again, and
leave the branch uncommitted until the user explicitly authorizes a local commit.

## Validation and Acceptance

Focused implementation gates:

```powershell
uv run pytest worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py worker/tests/test_media.py worker/tests/test_source_resolution.py worker/tests/test_url_support_contract.py worker/tests/test_progress_events.py worker/tests/test_download_reliability.py -q
uv run ruff check worker/frameq_worker/douyin_fallback.py worker/frameq_worker/douyin worker/tests/test_douyin_fallback.py worker/tests/test_douyin_module_boundaries.py
```

Complete gates:

```powershell
uv run pytest worker/tests
uv run ruff check worker
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
node --test scripts/tests/*.test.mjs
python scripts/validate_agents_docs.py --level WARN
node --input-type=module -e "import { prepareFreshWorkerResource } from './scripts/tauri-dev-fresh-worker.mjs'; await prepareFreshWorkerResource();"
npm --prefix app run tauri -- build --no-bundle
git diff --check
git status --short
```

Automated acceptance must prove:

- all repository-observed root names remain available and shared error/response/candidate/client
  identities are exact;
- direct canonical IDs remain network-free and one injected/default client spans short-link,
  page, probe, and final media requests;
- exact source hosts/ID forms, Router Data parsing, `bit_rate` preference, ratio order, probe
  validation, redirected URL use, Range removal, size deduplication, candidate order, and fixed
  timeouts remain unchanged;
- all four progress tuples and bounded retry arguments remain root-owned and unchanged;
- all fixed error codes/messages, candidate fallback, `.part` cleanup, prior-MP4 preservation, and
  successful atomic replacement remain unchanged;
- AST gates prove private-module ownership, no child-to-root/application/ASR/AI back-edge, no
  package compatibility exports, transport-only low-level side effects, and root-only production
  imports/progress;
- canonical and generated packaged worker trees match recursively by file set and bytes; and
- URL processing, SourceIdentity resolution, media preparation, local-media contract v4, ASR,
  History, AI, UI, and Credits behavior remain unchanged.

Manual/optional acceptance:

1. If a stable credential-free public sample is available, exercise the real fallback after a
   controlled `yt-dlp` failure and validate the resulting MP4 with existing media inspection.
2. Confirm no browser cookies, login material, CAPTCHA solving, proxying, or private-content access
   is requested or introduced.
3. Record Windows and macOS live coverage separately. An unavailable platform or current public
   endpoint remains explicitly unverified rather than inferred from fake-client tests.
