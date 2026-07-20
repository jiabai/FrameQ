# Xiaohongshu Fallback Module Split Implementation Plan

**Status:** Proposed for review; production implementation has not started.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (- [ ]) syntax for tracking.

**Goal:** Split the 894-line Xiaohongshu public-video fallback into focused private Python modules
while preserving its stable root imports, public-video policy, process-local anonymous cookies,
failure semantics, progress, download lifecycle, and downstream FrameQ behavior.

**Architecture:** Keep frameq_worker.xiaohongshu_fallback as the sole compatibility/application
adapter and move source, page-state, stream-policy, and transport responsibilities into a private
frameq_worker.xiaohongshu package. Keep candidate/backup orchestration, output naming, and progress
in the root. Use ordinary functions, immutable values, and narrow Protocols instead of another
facade class or a generic multi-platform downloader framework.

**Tech Stack:** Python 3.11+, pytest, Ruff, urllib, CookieJar, gzip/Brotli/zlib, existing
download_reliability.py atomic/resumable writers, Node packaged-worker mirror tests, Tauri build.

**Execution authority:** Commit commands below mark intended review boundaries. Execute them only
after the user explicitly authorizes local commits. This plan does not authorize pushing, merging,
tagging, publishing, creating a PR, accessing account cookies, or running credentialed platform
tests.

---

## Purpose / Big Picture

FrameQ users should observe no product change. A supported public Xiaohongshu video note still tries
yt-dlp first, then uses the existing public-page fallback, creates one local MP4, and continues
through media validation, audio extraction, subtitle/ASR, History, and separately confirmed AI
flows.

The change gives maintainers separately reviewable source, untrusted-page, deterministic-stream,
and transport/filesystem boundaries. It does not add login, browser cookies, image albums, Live
Photo output, private-note access, a quality picker, batch download, a new worker command, a result
field, or a shared fallback framework.

## Progress

- [x] 2026-07-20: Inspected AGENTS.md, WORKFLOW.md, execution gates, architecture/security
  boundaries, the active local-media plan, original Xiaohongshu implementation/reference/completed
  plan, shared download reliability, all repository callers, progress ownership, and recent history.
  Validation: read-only source/import searches and the focused Xiaohongshu/download/media/source/
  progress regression set passed 191/191.
- [x] 2026-07-20: Selected a stable root adapter plus private Xiaohongshu package split by its own
  failure boundaries; rejected comments-only, generic helpers, a copied Bilibili shape, and a
  multi-platform framework. Validation: design recorded in
  docs/design-docs/2026-07-20-xiaohongshu-fallback-module-split.md.
- [x] 2026-07-20: Published the proposed design, active ExecPlan, TASKS/audit status, and governance
  entry points for user review without modifying production source. Validation: governance
  validator passed with 0 errors/0 warnings; required document paths resolved, placeholder scan was
  empty, and git diff --check passed.
- [x] 2026-07-20: Added root behavior characterization and RED module-boundary tests before moving
  production implementation. Validation: Xiaohongshu tests passed 31/31 and the expanded focused
  set passed 209/209; the boundary run produced the expected 5 failures for the absent package/
  owner modules while its production-import and root-progress assertions passed 2/2.
- [x] 2026-07-20: Extracted the shared Xiaohongshu values and protocols while preserving exact root
  identities. Validation: the identity test failed first against the duplicate root definitions,
  then the Xiaohongshu suite passed 32/32; the focused type-boundary run passed 63 tests and retained
  only the expected 5 absent-owner-module failures, and focused Ruff checks passed.
- [x] 2026-07-20: Extracted deterministic page-state handling and stream candidate policy behind
  root compatibility bindings. Validation: the Xiaohongshu behavior suite passed 32/32, focused
  Ruff checks passed, and the boundary suite advanced to 4 passing assertions with only the expected
  3 failures caused by the not-yet-created source.py and transport.py owners.
- [x] 2026-07-20: Extracted fixed headers, process-local CookieJar HTTP, Range restart, safe atomic
  writes, and download error mapping into transport.py while re-exporting the exact client identity.
  Validation: the transport/reliability/URL/media/progress set passed 190/190, focused Ruff checks
  passed, and the boundary suite advanced to 5 passing assertions with only source.py absent.
- [x] 2026-07-20: Extracted direct-ID/URL/share-text and bounded short-link policy into source.py,
  then reduced the stable root to compatibility bindings, full workflow composition, output naming,
  candidate attempts, and progress. Validation: source/import tests passed 77/77, root/boundary tests
  passed 43/43, and the complete focused set passed 222/222 with Ruff clean. Measured physical lines:
  root 169; types 52; source 182; page 163; streams 139; transport 230; empty package init 0;
  Xiaohongshu behavior tests 680 and boundary tests 102.
- [x] 2026-07-20: Completed full Windows, cross-layer, package, mirror, and governance closeout.
  Validation: worker 477/477 (one unchanged audioop warning), app 549/549, Rust 169/169 under normal
  Windows process permissions, scripts 23/23, Ruff, TypeScript/i18n lint, rustfmt, frontend build,
  Tauri no-bundle, 44/44 recursive worker mirror equality, governance 0 errors/0 warnings,
  placeholder scan empty, and git diff --check clean apart from line-ending notices. Live
  credential-free Xiaohongshu and macOS runtime smoke remain explicitly unverified.
- [x] Extract types, page state, streams, transport, source, and root composition in independently
  green increments.
- [x] Complete full worker/cross-layer/package gates, record native/live evidence, update durable
  architecture/security/audit evidence, and archive this plan.

## Surprises & Discoveries

Evidence: media.py imports only XiaohongshuFallbackError and download_xiaohongshu_video, while
platform_source_resolvers.py imports XiaohongshuFallbackError and parse_xiaohongshu_input. Tests
also import root response/data values and three underscore-prefixed seams. The root path must remain
stable even though implementation moves.

Evidence: test_progress_events.py scans xiaohongshu_fallback.py itself for
xiaohongshu.page.resolving, xiaohongshu.video.saving, and xiaohongshu.stream.retrying. Progress
sequencing belongs in the root adapter, not page or transport helpers.

Evidence: one UrllibXiaohongshuHttpClient owns a CookieJar and is reused across short-link, public
page, and media requests. This is process-local anonymous public-page state, not a login or
credential feature. Splitting source and transport must not create multiple default clients or
persist the jar.

Evidence: parse_xiaohongshu_input checks a direct 24-hex note ID before constructing the default
client. This lazy no-network path is observable and must be characterized before extraction.

Evidence: retries have two levels. Every candidate tries its primary URL and ordered backup URLs;
only after all URLs for one candidate fail may the root emit a one-based candidate retry event.
Flattening these loops would change both request order and progress semantics.

Evidence: XiaohongshuStreamCandidate.headers is currently populated with fixed media headers but is
not read by production code. Removing it during extraction would still change a repository-observed
data shape, so it remains.

Evidence: download_reliability.py already owns content type/status validation, max-size checks,
no-progress timeout, .part writes, resume validation, cleanup, and os.replace. The platform
transport should delegate to it rather than create another safe-download abstraction.

Evidence: page decoding applies the configured size check after gzip/Brotli/deflate expansion.
Compression libraries may allocate expanded output before rejection, and urllib GET obtains the
body before page-level validation. A strict streaming decompression/peak-memory guarantee is a
separate design, not something this structural plan may claim.

Evidence: the generated Tauri worker directory is an ignored mirror. New package files must be
created only in the canonical worker and synchronized through the existing refresh path; recursive
file-set and byte equality remain release gates.

Evidence: local-media contract v4 is active but has not added its runtime pipeline. This refactor
must preserve the stable root fallback import so either change can integrate without sharing a
private module. Rebase/merge order may change aggregate test totals but not Xiaohongshu behavior.

Evidence: the code-audit size table is explicitly a historical snapshot at commit 1fa2f37. Its
936-line Bilibili row is not a current-tree metric and should not be edited in isolation. Current
implemented evidence belongs in the later pressure-resolution table.

Evidence: the Windows Rust subprocess-pipe suite fails its blocked-stdin cancellation case inside
the restricted sandbox with RequestDeliveryFailed, then passes 169/169 unchanged under normal
Windows process permissions. This is an execution-environment boundary, not a Xiaohongshu code
failure; both observations are retained rather than weakening or skipping the native test.

## Decision Log

- Decision: Keep frameq_worker.xiaohongshu_fallback as the only production import path outside the
  private package. Rationale: media dispatch, source resolution, progress coverage, and contracts
  already depend on this path; root re-exports make internal movement non-breaking.
  Date/Author: 2026-07-20, User + Codex.
- Decision: Split into types, source, page, streams, and transport under one private
  xiaohongshu package. Rationale: these boundaries match Xiaohongshu-specific failure vocabularies
  and side effects; the platform has no DASH/FFmpeg artifact boundary.
  Date/Author: 2026-07-20, User + Codex.
- Decision: Add no facade class, artifacts.py, or shared three-platform framework. Rationale: the
  root module is already the needed application adapter, while DownloadStrategy and
  download_reliability.py own the genuinely shared behavior.
  Date/Author: 2026-07-20, User + Codex.
- Decision: Keep candidate/backup attempt sequencing, output naming, and all xiaohongshu.* progress
  emission in the root. Rationale: these are workflow decisions spanning stream policy and transport
  rather than responsibilities of either child.
  Date/Author: 2026-07-20, Codex.
- Decision: Preserve one default process-local CookieJar/client across one fallback invocation.
  Rationale: anonymous cookies naturally issued by the public page may be required for subsequent
  requests, but browser/persistent/account cookies remain forbidden.
  Date/Author: 2026-07-20, Codex.
- Decision: Preserve the current response-size semantics and record peak-memory behavior as residual
  risk rather than mixing a new network/decompression contract into file movement.
  Date/Author: 2026-07-20, Codex.
- Decision: Edit only the canonical worker and refresh the generated resource mirror through the
  established path. Rationale: hand-edited mirrors drift and the recursive equality gate already
  covers new private-package files.
  Date/Author: 2026-07-20, Codex.

## Outcomes & Retrospective

The 894-line hotspot is now a 169-line stable root adapter plus an empty private package initializer
and focused types (52), source (182), page (163), streams (139), and transport (230) modules. The
root retains composition, workflow, output naming, candidate/backup attempts, progress, and exact
compatibility identities; private owners contain no root/application/ASR/AI back-edges. Dedicated
behavior and boundary tests measure 680 and 102 physical lines respectively.

The boundary suite began RED with 5 expected missing-owner failures and 2 passing safety assertions.
Final focused tests pass 222/222. Full gates pass worker 477/477, app 549/549, Rust 169/169, scripts
23/23, Ruff, TypeScript/i18n lint, rustfmt, frontend build, and Tauri no-bundle release build. The
canonical and packaged worker trees match across 44 filtered files with no missing, extra, or
SHA-256-mismatched files. The unchanged audioop deprecation and Vite chunk-size warnings remain.

Public Xiaohongshu page/state/CDN behavior can still drift outside FrameQ. No stable
credential-free live sample or macOS runtime was exercised in this implementation session, so those
remain explicit residual risks. No login, browser-cookie input, CAPTCHA bypass, proxying, generic
platform framework, extra facade, contract, or UI behavior was added to compensate.

## Context and Orientation

Design and governance:

- docs/design-docs/2026-07-20-xiaohongshu-fallback-module-split.md
- docs/design-docs/frameq-code-audit-uml.md
- docs/ARCHITECTURE.md
- docs/SECURITY.md
- WORKFLOW.md
- docs/EXECUTION_GATES.md
- AGENTS.md
- TASKS.md

Existing product/security intent:

- docs/product-specs/2026-06-16-douyin-video-transcription-client.md
- docs/references/easydownload-xiaohongshu-fallback.md
- docs/exec-plans/completed/2026-06-27-xiaohongshu-video-fallback-completion-plan.md
- docs/design-docs/2026-07-18-source-identity-dependency-boundary.md
- docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md

Canonical worker:

- worker/frameq_worker/xiaohongshu_fallback.py
- worker/frameq_worker/download_reliability.py
- worker/frameq_worker/media.py
- worker/frameq_worker/platform_source_resolvers.py
- worker/frameq_worker/source_resolution.py
- worker/frameq_worker/progress_events.py

Current tests and contracts:

- worker/tests/test_xiaohongshu_fallback.py
- worker/tests/test_download_reliability.py
- worker/tests/test_media.py
- worker/tests/test_media_preparation.py
- worker/tests/test_url_support_contract.py
- worker/tests/test_source_resolution.py
- worker/tests/test_progress_events.py
- worker/tests/test_import_boundaries.py
- contracts/platform-url-support-contract.json
- contracts/desktop-worker-contract.json
- scripts/tests/tauri-dev-fresh-worker.test.mjs

Planned canonical modules:

- worker/frameq_worker/xiaohongshu/__init__.py
- worker/frameq_worker/xiaohongshu/types.py
- worker/frameq_worker/xiaohongshu/source.py
- worker/frameq_worker/xiaohongshu/page.py
- worker/frameq_worker/xiaohongshu/streams.py
- worker/frameq_worker/xiaohongshu/transport.py

## Planned File Responsibilities

| File | Responsibility |
|---|---|
| xiaohongshu_fallback.py | stable bindings, dependency composition, page/stream/download workflow, output naming, nested attempt order, three progress events |
| xiaohongshu/types.py | shared fixed error, immutable response/source/candidate values, narrow client protocols |
| xiaohongshu/source.py | input/host/path/xsec_token parsing, explore URL, bounded short-link policy |
| xiaohongshu/page.py | response/status/decompression bounds, initial-state conversion, note lookup and image-only policy |
| xiaohongshu/streams.py | old/new stream schema, normalization, quality deduplication, ranking, URL ordering |
| xiaohongshu/transport.py | public headers, process-local CookieJar urllib client, response chunks, Range restart, safe media writes and error mapping |
| test_xiaohongshu_fallback.py | behavior characterization through the stable root import |
| test_xiaohongshu_module_boundaries.py | file ownership, import direction, side-effect ownership and root-only production/progress boundary |

## Plan of Work

### Task 1: Lock current root behavior before extraction

**Files:**

- Modify: worker/tests/test_xiaohongshu_fallback.py
- Verify: worker/tests/test_url_support_contract.py
- Verify: worker/tests/test_media.py
- Verify: worker/tests/test_source_resolution.py

- [x] **Step 1: Add a stable root-surface and direct-ID laziness test**

Import the module as one object and lock the repository-observed root surface:

~~~python
from frameq_worker import xiaohongshu_fallback


def test_xiaohongshu_root_compatibility_surface_is_stable() -> None:
    expected = {
        "XiaohongshuFallbackError",
        "HttpResponse",
        "XiaohongshuParseResult",
        "XiaohongshuStreamCandidate",
        "UrllibXiaohongshuHttpClient",
        "XHS_DESKTOP_USER_AGENT",
        "XHS_REFERER",
        "parse_xiaohongshu_input",
        "build_explore_url",
        "parse_video_stream_candidates",
        "download_xiaohongshu_video",
        "_decode_response_body",
        "_download_first_available_stream",
        "_page_headers",
        "_raise_for_page_response",
    }
    assert expected <= set(dir(xiaohongshu_fallback))
~~~

Add a constructor that raises and monkeypatch the root default client. Parsing NOTE_ID must still
return without constructing it:

~~~python
def test_direct_note_id_does_not_construct_http_client(monkeypatch) -> None:
    class UnexpectedClient:
        def __init__(self) -> None:
            raise AssertionError("direct note ID must not construct a client")

    monkeypatch.setattr(
        xiaohongshu_fallback,
        "UrllibXiaohongshuHttpClient",
        UnexpectedClient,
    )
    assert xiaohongshu_fallback.parse_xiaohongshu_input(NOTE_ID).note_id == NOTE_ID
~~~

- [x] **Step 2: Characterize page/status/decode and state policy**

Add a parameterized response-status test for 404, 401, 403, 429, empty/non-2xx responses and assert
only the current fixed codes:

~~~python
@pytest.mark.parametrize(
    ("status", "body", "code"),
    [
        (404, b"x", "XHS_NOTE_NOT_FOUND"),
        (401, b"x", "XHS_NOTE_BLOCKED"),
        (403, b"x", "XHS_NOTE_BLOCKED"),
        (429, b"x", "XHS_RATE_LIMITED"),
        (500, b"x", "XHS_PAGE_UNAVAILABLE"),
        (200, b"", "XHS_PAGE_UNAVAILABLE"),
    ],
)
def test_page_status_mapping_is_fixed(status: int, body: bytes, code: str) -> None:
    response = HttpResponse(status=status, headers={}, body=body, url="https://example.invalid")
    with pytest.raises(XiaohongshuFallbackError) as exc_info:
        xiaohongshu_fallback._raise_for_page_response(response)
    assert exc_info.value.code == code
    assert "example.invalid" not in str(exc_info.value)
~~~

Add gzip, Brotli, zlib-deflate, raw-deflate, malformed-compression, raw-too-large, and
expanded-too-large cases. Keep XHS_RESPONSE_DECODE_FAILED and XHS_RESPONSE_TOO_LARGE unchanged and
assert no URL, encoding header, or body fragment appears in the exception.

Add state fixtures for undefined, void 0, trailing commas, incomplete braces, non-object JSON,
missing note, image-only note, list-shaped streams, and codec-map streams.

- [x] **Step 3: Characterize ranking, nested retry order, atomic preservation, and Range restart**

Add deterministic candidate assertions:

~~~python
assert [candidate.quality_key for candidate in candidates] == ["hd_115", "hd_259"]
assert candidates[0].backup_urls == ["https://cdn.example/h265-backup.mp4"]
assert candidates[0].headers == {
    "User-Agent": xiaohongshu_fallback.XHS_DESKTOP_USER_AGENT,
    "Referer": xiaohongshu_fallback.XHS_REFERER,
    "Accept": "*/*",
}
~~~

Use a fake client to prove nested URL order is primary, backup, then next candidate. With an existing
output file and every attempt failing, assert:

~~~python
assert client.calls == [primary, backup, next_candidate]
assert output_path.read_bytes() == b"previous mp4"
assert not output_path.with_name(f"{output_path.name}.part").exists()
assert exc_info.value.code == "XHS_STREAM_DOWNLOAD_FAILED"
~~~

For UrllibXiaohongshuHttpClient.download_to_path, replace _download_request_to_path with a fake that
first raises SafeDownloadError("DOWNLOAD_CONTENT_RANGE_INVALID", "...") and then succeeds. Start
with a .part file and assert offsets are [partial_size, 0], the stale part is removed before the
second call, and the retry omits Range.

- [x] **Step 4: Run the characterization set**

Run:

~~~powershell
uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_download_reliability.py worker\tests\test_media.py worker\tests\test_media_preparation.py worker\tests\test_url_support_contract.py worker\tests\test_source_resolution.py worker\tests\test_progress_events.py -q
~~~

Expected before new tests: 191 passed. Expected after adding characterization: every test passes;
record the new exact total in Progress before extraction.

- [ ] **Step 5: Commit the characterization tests**

~~~powershell
git add worker\tests\test_xiaohongshu_fallback.py
git commit -m "test: characterize xiaohongshu fallback boundaries"
~~~

### Task 2: Establish RED private-module and ownership tests

**Files:**

- Create: worker/tests/test_xiaohongshu_module_boundaries.py

- [x] **Step 1: Define the planned package and AST import helper**

Create:

~~~python
import ast
from pathlib import Path

WORKER_PACKAGE = Path(__file__).parents[1] / "frameq_worker"
ROOT = WORKER_PACKAGE / "xiaohongshu_fallback.py"
PRIVATE_MODULES = {
    "types": WORKER_PACKAGE / "xiaohongshu" / "types.py",
    "source": WORKER_PACKAGE / "xiaohongshu" / "source.py",
    "page": WORKER_PACKAGE / "xiaohongshu" / "page.py",
    "streams": WORKER_PACKAGE / "xiaohongshu" / "streams.py",
    "transport": WORKER_PACKAGE / "xiaohongshu" / "transport.py",
}
FORBIDDEN_PRIVATE_PREFIXES = (
    "frameq_worker.xiaohongshu_fallback",
    "frameq_worker.media",
    "frameq_worker.media_preparation",
    "frameq_worker.pipeline",
    "frameq_worker.source_identity",
    "frameq_worker.source_resolution",
    "frameq_worker.task_store",
    "frameq_worker.asr",
    "frameq_worker.insightflow",
)


def imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
    return modules
~~~

- [x] **Step 2: Add file, back-edge, owner, and production-import assertions**

Require every private file plus an empty __init__.py. Reject forbidden back-edges from every child.
Require only page.py to import brotli/gzip/zlib/json, only transport.py to import urllib.request,
CookieJar, and download_reliability, and forbid network/filesystem/progress imports from streams.py.

Scan production Python files outside the package and allow frameq_worker.xiaohongshu.* imports only
from xiaohongshu_fallback.py. Require all three progress codes and build_worker_progress_event to
remain in the root.

~~~python
def test_private_modules_have_no_application_back_edges() -> None:
    for path in PRIVATE_MODULES.values():
        imports = imported_modules(path)
        assert not {
            name
            for name in imports
            if name.startswith(FORBIDDEN_PRIVATE_PREFIXES)
        }


def test_progress_and_production_entry_stay_in_root() -> None:
    source = ROOT.read_text(encoding="utf-8")
    assert "build_worker_progress_event" in source
    assert "xiaohongshu.page.resolving" in source
    assert "xiaohongshu.video.saving" in source
    assert "xiaohongshu.stream.retrying" in source
~~~

- [x] **Step 3: Run RED and record exact causes**

Run:

~~~powershell
uv run pytest worker\tests\test_xiaohongshu_module_boundaries.py -q
~~~

Expected: FAIL because xiaohongshu/__init__.py and the five planned private modules do not exist.
Assertions already satisfied by the current root should pass. Record the exact failure count in
Progress before changing production code.

- [ ] **Step 4: Commit the RED boundary test**

~~~powershell
git add worker\tests\test_xiaohongshu_module_boundaries.py
git commit -m "test: lock xiaohongshu module split boundary"
~~~

### Task 3: Extract shared types without changing identity

**Files:**

- Create: worker/frameq_worker/xiaohongshu/__init__.py
- Create: worker/frameq_worker/xiaohongshu/types.py
- Modify: worker/frameq_worker/xiaohongshu_fallback.py
- Modify: worker/tests/test_xiaohongshu_fallback.py

- [x] **Step 1: Create the private package with no public package surface**

Create an empty xiaohongshu/__init__.py. Do not re-export root APIs from the package.

- [x] **Step 2: Move the fixed error and immutable values to types.py**

Move the existing definitions unchanged and add only narrow structural Protocols needed by child
modules:

~~~python
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


class XiaohongshuFallbackError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes
    url: str


@dataclass(frozen=True)
class XiaohongshuParseResult:
    note_id: str
    full_url: str = ""
    xsec_token: str = ""


@dataclass(frozen=True)
class XiaohongshuStreamCandidate:
    quality_key: str
    url: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    backup_urls: list[str] = field(default_factory=list)
    video_codec: str = ""
    video_bitrate: int = 0
    stream_type: int = 0
    weight: int = 0
    default_stream: int = 0
    headers: dict[str, str] = field(default_factory=dict)


class XiaohongshuHttpClient(Protocol):
    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> HttpResponse: ...


class XiaohongshuDownloadClient(XiaohongshuHttpClient, Protocol):
    def download_to_path(
        self,
        url: str,
        destination: Path,
        *,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 30.0,
        max_bytes: int | None = None,
        no_progress_timeout_seconds: float | None = None,
    ) -> int: ...
~~~

- [x] **Step 3: Re-export the exact identities from the stable root**

Replace duplicate root definitions with imports from xiaohongshu.types. Keep every current root name
bound.

- [x] **Step 4: Prove identity and run focused tests**

Add:

~~~python
from frameq_worker.xiaohongshu import types as private_types


def test_root_reexports_shared_xiaohongshu_type_identities() -> None:
    assert xiaohongshu_fallback.XiaohongshuFallbackError is private_types.XiaohongshuFallbackError
    assert xiaohongshu_fallback.HttpResponse is private_types.HttpResponse
    assert xiaohongshu_fallback.XiaohongshuParseResult is private_types.XiaohongshuParseResult
    assert (
        xiaohongshu_fallback.XiaohongshuStreamCandidate
        is private_types.XiaohongshuStreamCandidate
    )
~~~

Run:

~~~powershell
uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_url_support_contract.py worker\tests\test_xiaohongshu_module_boundaries.py -q
uv run ruff check worker\frameq_worker\xiaohongshu worker\frameq_worker\xiaohongshu_fallback.py worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py
~~~

Expected: behavior/type tests pass; boundary tests still fail only for the four not-yet-created
owner modules.

- [ ] **Step 5: Commit the type boundary**

~~~powershell
git add worker\frameq_worker\xiaohongshu worker\frameq_worker\xiaohongshu_fallback.py worker\tests\test_xiaohongshu_fallback.py
git commit -m "refactor: extract xiaohongshu fallback types"
~~~

### Task 4: Extract deterministic page-state and stream policy

**Files:**

- Create: worker/frameq_worker/xiaohongshu/page.py
- Create: worker/frameq_worker/xiaohongshu/streams.py
- Modify: worker/frameq_worker/xiaohongshu_fallback.py
- Modify: worker/tests/test_xiaohongshu_fallback.py

- [x] **Step 1: Move page status, decoding, and initial-state functions as one group**

page.py must own these operations and no network execution:

~~~python
def raise_for_page_response(response: HttpResponse) -> None: ...
def decode_response_body(response: HttpResponse, max_bytes: int = XHS_MAX_HTML_BYTES) -> str: ...
def extract_initial_state(body: str) -> dict[str, object]: ...
def extract_braced_object(text: str, start_index: int) -> str: ...
def js_to_json(raw: str) -> str: ...
def lookup_note(state: Mapping[str, object], note_id: str) -> Mapping[str, object]: ...
def is_image_only_note(note_obj: Mapping[str, object]) -> bool: ...
~~~

Move gzip, html-state JSON, re, zlib, and brotli imports with these functions. Preserve fixed error
codes/messages and case-insensitive response-header lookup. Keep the current post-decompression
size check and short-link max_bytes behavior exactly.

Bind root test seams:

~~~python
_decode_response_body = decode_response_body
_raise_for_page_response = raise_for_page_response
~~~

- [x] **Step 2: Move stream normalization and ranking as one deterministic group**

streams.py owns:

~~~python
def parse_video_streams(
    note_obj: Mapping[str, object],
    *,
    candidate_headers: Mapping[str, str],
) -> list[XiaohongshuStreamCandidate]: ...

def collect_download_urls(primary_url: str, backup_urls: list[str]) -> list[str]: ...
~~~

Move candidate parsing, score, codec/type ranks, quality-key construction, mapping/string/integer
helpers, and URL deduplication. Do not import urllib, pathlib, CookieJar, download_reliability, or
progress_events.

Root parse_video_stream_candidates remains the compatibility wrapper:

~~~python
def parse_video_stream_candidates(
    state: Mapping[str, object],
    note_id: str,
) -> list[XiaohongshuStreamCandidate]:
    note_obj = lookup_note(state, note_id)
    return parse_video_streams(note_obj, candidate_headers=_media_headers())
~~~

- [x] **Step 3: Run page/stream behavior and partial boundary tests**

Run:

~~~powershell
uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py -q
uv run ruff check worker\frameq_worker\xiaohongshu worker\frameq_worker\xiaohongshu_fallback.py
~~~

Expected: all page/state/ranking behavior passes; boundary tests fail only for transport.py and
source.py if those files are not yet present.

- [ ] **Step 4: Commit the pure policy boundaries**

~~~powershell
git add worker\frameq_worker\xiaohongshu\page.py worker\frameq_worker\xiaohongshu\streams.py worker\frameq_worker\xiaohongshu_fallback.py worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py
git commit -m "refactor: extract xiaohongshu page and stream policy"
~~~

### Task 5: Extract CookieJar, HTTP, and safe-download transport

**Files:**

- Create: worker/frameq_worker/xiaohongshu/transport.py
- Modify: worker/frameq_worker/xiaohongshu_fallback.py
- Modify: worker/tests/test_xiaohongshu_fallback.py
- Verify: worker/tests/test_download_reliability.py

- [x] **Step 1: Move fixed transport constants and header builders**

transport.py owns the existing user agent, base referer, video size/chunk/stall constants,
case-insensitive header lookup, page_headers, and media_headers. Preserve every current header value
and the optional internal extra-header merge behavior. Root binds _page_headers and constants needed
by existing tests.

- [x] **Step 2: Move UrllibXiaohongshuHttpClient without changing CookieJar lifetime**

Move the class and response-chunk/partial-size helpers unchanged. The constructor still creates one
empty CookieJar when none is injected. get keeps the current fixed page-request mapping.
download_to_path keeps:

~~~text
existing .part size -> Range request
  valid 206/Content-Range -> append and atomically replace
  DOWNLOAD_CONTENT_RANGE_INVALID -> remove stale .part -> retry once without Range
  other SafeDownloadError -> preserve fixed mapping at the root/transport boundary
~~~

Do not add browser stores, persistence, external header input, logging, or a second client.

- [x] **Step 3: Move one-URL media write and fixed error mapping**

transport.py exports:

~~~python
def download_stream_to_path(
    stream_url: str,
    output_path: Path,
    http_client: XiaohongshuHttpClient,
) -> int: ...

def map_download_error(error: Exception | None) -> XiaohongshuFallbackError: ...
~~~

Preserve the custom-client fallback to get plus write_http_response_atomically. Keep
XHS_VIDEO_TOO_LARGE, XHS_DOWNLOAD_STALLED, and XHS_STREAM_DOWNLOAD_FAILED mappings exact.

- [x] **Step 4: Run transport, reliability, URL-contract, and media tests**

Run:

~~~powershell
uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_download_reliability.py worker\tests\test_url_support_contract.py worker\tests\test_media.py worker\tests\test_progress_events.py -q
uv run ruff check worker
~~~

Expected: all selected tests pass; source.py may remain the only missing boundary file.

- [ ] **Step 5: Commit the transport boundary**

~~~powershell
git add worker\frameq_worker\xiaohongshu\transport.py worker\frameq_worker\xiaohongshu_fallback.py worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py
git commit -m "refactor: extract xiaohongshu transport"
~~~

### Task 6: Extract source and short-link policy

**Files:**

- Create: worker/frameq_worker/xiaohongshu/source.py
- Modify: worker/frameq_worker/xiaohongshu_fallback.py
- Modify: worker/tests/test_xiaohongshu_fallback.py
- Verify: worker/tests/test_url_support_contract.py
- Verify: worker/tests/test_source_resolution.py

- [x] **Step 1: Move source constants and pure URL parsing**

Move direct note patterns, acceptable/short hosts, share-text URL extraction, trailing punctuation,
note path parsing, xsec_token extraction, build_explore_url, and HTTP-to-HTTPS attempts into
source.py. Preserve only /explore/<24-hex> and /discovery/item/<24-hex> note paths and continue
rejecting lookalike hosts and unsupported schemes.

- [x] **Step 2: Move bounded short-link resolution with the same injected client**

Move recursive candidate handling, resolve_short_link, Location/urljoin, embedded-note URL fallback,
and depth enforcement. Give source.py one internal composition-friendly entry:

~~~python
def parse_xiaohongshu_source(
    raw_input: str,
    *,
    http_client: XiaohongshuHttpClient | None,
    client_factory: Callable[[], XiaohongshuHttpClient],
) -> XiaohongshuParseResult: ...
~~~

It checks the direct ID before calling client_factory. source.py may call
page.decode_response_body and transport.page_headers but must not perform raw urllib.request
operations.

The stable root wrapper remains:

~~~python
def parse_xiaohongshu_input(
    raw_input: str,
    http_client: XiaohongshuHttpClient | None = None,
) -> XiaohongshuParseResult:
    return parse_xiaohongshu_source(
        raw_input,
        http_client=http_client,
        client_factory=UrllibXiaohongshuHttpClient,
    )
~~~

This preserves the direct-ID check before default client construction and lets the constructor
monkeypatch characterization remain meaningful. download_xiaohongshu_video must pass its one
already-created client so short-link, page, and media requests share the same CookieJar.

- [x] **Step 3: Re-export source entry points and prove no-network/canonical behavior**

The root must bind parse_xiaohongshu_input and build_explore_url. Run:

~~~powershell
uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_url_support_contract.py worker\tests\test_source_resolution.py worker\tests\test_import_boundaries.py -q
uv run ruff check worker
~~~

Expected: direct ID, full URL, share text, xsec_token, Location, embedded URL, HTTPS retry, depth,
lookalike-host, and canonical SourceIdentity tests pass. Core import tests must still prove that
source_identity.py does not load platform fallback infrastructure.

- [ ] **Step 4: Commit the source boundary**

~~~powershell
git add worker\frameq_worker\xiaohongshu\source.py worker\frameq_worker\xiaohongshu_fallback.py worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py
git commit -m "refactor: extract xiaohongshu source policy"
~~~

### Task 7: Close the stable root adapter and make ownership tests GREEN

**Files:**

- Modify: worker/frameq_worker/xiaohongshu_fallback.py
- Modify: worker/tests/test_xiaohongshu_module_boundaries.py
- Modify: worker/tests/test_xiaohongshu_fallback.py

- [x] **Step 1: Keep only compatibility composition and full workflow in the root**

The root must:

1. create or accept one client;
2. parse the source with that same client;
3. emit page resolving at 22;
4. fetch and validate the page;
5. decode state, find the note, and parse ranked candidates;
6. choose fixed image-only/no-stream failures;
7. create output_dir and <note_id>.mp4;
8. emit video saving at 30;
9. try each candidate primary/backup URL in order;
10. emit bounded candidate retry at 30 only between candidates; and
11. return only the atomically committed output path.

Keep _download_first_available_stream and progress helpers in the root. Do not move progress into a
child and do not add a facade class.

- [x] **Step 2: Remove duplicate implementation and verify imports/identities**

Every moved implementation must have one owner. Root re-exports shared identities/functions instead
of redefining them. Private __init__.py remains empty. Production media.py and
platform_source_resolvers.py remain unchanged and continue importing only the root.

- [x] **Step 3: Make all AST/import ownership tests GREEN**

Run:

~~~powershell
uv run pytest worker\tests\test_xiaohongshu_module_boundaries.py worker\tests\test_import_boundaries.py -q
~~~

Expected: PASS. Inspect failures rather than weakening forbidden import lists or allowing direct
private production imports.

- [x] **Step 4: Run the complete focused boundary set**

Run:

~~~powershell
uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py worker\tests\test_download_reliability.py worker\tests\test_media.py worker\tests\test_media_preparation.py worker\tests\test_url_support_contract.py worker\tests\test_source_resolution.py worker\tests\test_progress_events.py worker\tests\test_import_boundaries.py -q
uv run ruff check worker
~~~

Expected: every test passes. Record the exact focused total, root/private physical line counts, and
remaining imports in Progress and Outcomes.

- [ ] **Step 5: Commit the root closeout**

~~~powershell
git add worker\frameq_worker\xiaohongshu_fallback.py worker\frameq_worker\xiaohongshu worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py
git commit -m "refactor: split xiaohongshu fallback by failure boundary"
~~~

### Task 8: Prove full regression and canonical packaging

**Files:**

- Verify: worker/**
- Verify: app/**
- Verify: app/src-tauri/**
- Verify: scripts/tests/**
- Generated/ignored verification only: app/src-tauri/resources/worker/frameq_worker/**

- [x] **Step 1: Run complete Python and cross-layer suites**

Run:

~~~powershell
uv run pytest worker\tests
uv run ruff check worker
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
cargo test --manifest-path app\src-tauri\Cargo.toml
cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
node --test scripts\tests\*.test.mjs
~~~

Expected: all suites pass. Existing Python audioop deprecation and Vite chunk-size warnings may be
recorded as unchanged warnings; any new failure blocks closeout.

- [x] **Step 2: Refresh and verify the packaged worker through the established path**

Run:

~~~powershell
npm --prefix app run tauri -- build --no-bundle
~~~

Then compare the canonical root plus all six private-package files against the generated resource
mirror by relative file set and SHA-256. Do not edit generated files directly.

- [x] **Step 3: Run governance, placeholder, link, and diff gates**

Run:

~~~powershell
python scripts\validate_agents_docs.py --level WARN
rg -n "T[B]D|T[O]DO|fill[ ]in|implement[ ]later" docs\design-docs\2026-07-20-xiaohongshu-fallback-module-split.md docs\exec-plans\completed\2026-07-20-xiaohongshu-fallback-module-split-plan.md
git diff --check
git status --short
~~~

Expected: 0 governance errors/warnings, no unresolved placeholders, no whitespace errors, and only
intended source/test/docs plus ignored generated outputs.

### Task 9: Update durable evidence and archive the plan

**Files:**

- Modify: docs/design-docs/2026-07-20-xiaohongshu-fallback-module-split.md
- Modify: docs/design-docs/frameq-code-audit-uml.md
- Modify: docs/ARCHITECTURE.md
- Modify: docs/SECURITY.md
- Modify: TASKS.md
- Modify: AGENTS.md
- Move: docs/exec-plans/active/2026-07-20-xiaohongshu-fallback-module-split-plan.md
  -> docs/exec-plans/completed/2026-07-20-xiaohongshu-fallback-module-split-plan.md
- Modify: docs/exec-plans/active/index.md
- Modify: docs/exec-plans/completed/index.md

- [x] **Step 1: Replace proposed language with measured implementation evidence**

Record final physical/production/test line counts, exact module ownership, dependency results,
focused/full totals, packaged-worker equality, native test environment, and live evidence. Mark the
design Implemented and accepted only after every required automated gate passes.

- [x] **Step 2: Update the audit without rewriting its historical baseline**

Keep the 1fa2f37 size snapshot intact. Add Xiaohongshu to the later resolved-pressure table with
current measured evidence, and split the remaining Douyin fallback into its own future audit row.
Do not claim all platform fallbacks are resolved.

- [x] **Step 3: Update architecture/security ownership and archive**

Document the stable root/private package boundary, empty process-local CookieJar rule, xsec_token
transience, root-only progress, transport-only download side effects, and atomic output preservation.
Move the plan to completed and update both indexes.

- [x] **Step 4: Validate closeout and request commit authority**

~~~powershell
python scripts\validate_agents_docs.py --level WARN
git diff --check
~~~

Expected: 0 errors, 0 warnings, and no whitespace errors. Stop with a verified diff unless the user
separately authorizes local commit/merge/push actions.

## Validation and Acceptance

Required automated gates:

~~~powershell
uv run pytest worker\tests\test_xiaohongshu_fallback.py worker\tests\test_xiaohongshu_module_boundaries.py worker\tests\test_download_reliability.py worker\tests\test_media.py worker\tests\test_media_preparation.py worker\tests\test_url_support_contract.py worker\tests\test_source_resolution.py worker\tests\test_progress_events.py worker\tests\test_import_boundaries.py -q
uv run pytest worker\tests
uv run ruff check worker
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
cargo test --manifest-path app\src-tauri\Cargo.toml
cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
node --test scripts\tests\*.test.mjs
python scripts\validate_agents_docs.py --level WARN
npm --prefix app run tauri -- build --no-bundle
git diff --check
~~~

Focused acceptance must prove:

- every stable root import and shared type/client identity remains available;
- direct note ID, full note URL, discovery-item URL, share text, xsec_token, xhslink Location,
  embedded URL, HTTPS retry, depth limit, invalid scheme, lookalike host, and unsupported path
  behavior is unchanged;
- page status, gzip/Brotli/zlib/raw-deflate, response-size, initial-state, JavaScript conversion,
  missing/malformed note, image-only, and no-stream failures retain fixed codes without content
  echo;
- both stream schemas, quality deduplication, codec/type ranking, candidate order, primary/backup
  order, and fixed candidate headers remain unchanged;
- process-local anonymous cookies remain one-invocation memory only and no credential path is added;
- Range resume/restart, maximum size, no-progress, .part cleanup, previous final MP4 preservation,
  successful replacement, and fixed output stem remain unchanged;
- the three progress tuples remain exact and raw URL/token/cookie/header/body content never enters
  progress or public errors;
- media.py fallback order/dispatch, source resolution, URL support, worker results, ASR path, and app
  error rendering remain unchanged;
- private dependency rules pass with no root/application back-edge; and
- canonical worker and generated Tauri mirror contain identical root/private-package bytes.

Manual/optional acceptance:

1. If one stable public Xiaohongshu video note and network are available, process one full explore
   URL, one xhslink short link, and one share-text source through the existing FrameQ workflow.
2. Confirm one MP4 reaches existing ffprobe/audio/ASR processing and no Xiaohongshu-specific UI,
   image artifact, cookie prompt, or new result field appears.
3. Inspect logs/errors for absence of xsec_token, cookies, volatile CDN URLs, raw headers, response
   bodies, complete submitted URLs, and arbitrary exception text.
4. If live platform acceptance is unavailable or unstable, record it as unverified. Do not
   compensate with browser cookies, login, CAPTCHA handling, proxying, or weakened tests.
