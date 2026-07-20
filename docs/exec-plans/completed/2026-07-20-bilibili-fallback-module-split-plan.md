# Bilibili Fallback Module Split Implementation Plan

**Status:** Completed in the working tree on 2026-07-20; commit checkpoints remain intentionally
unexecuted pending explicit user authorization.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
> and Outcomes & Retrospective must be kept up to date as work proceeds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 936-line Bilibili public-video fallback into focused private Python modules while
preserving its stable root imports, public-video policy, failure semantics, progress, downloads,
artifact lifecycle, and downstream FrameQ behavior.

**Architecture:** Keep `frameq_worker.bilibili_fallback` as the sole compatibility/application
adapter and move source, playback, transport, and artifact responsibilities into a private
`frameq_worker.bilibili` package. Use ordinary functions and immutable values rather than another
facade class or a generic multi-platform downloader framework. Add characterization and AST/import
boundary tests before extraction, and keep each move independently green.

**Tech Stack:** Python 3.11+, pytest, Ruff, urllib, Brotli/gzip/zlib, existing safe download
primitives, FFmpeg command runner injection, Node mirror tests, Tauri packaged-worker build.

**Execution authority:** Commit commands below mark intended review boundaries. Execute them only
after the user authorizes local commits; otherwise stop at the corresponding verified diff. This plan
does not authorize pushing, merging, tagging, publishing, or creating a PR.

---

## Purpose / Big Picture

FrameQ users should observe no product change. A public ordinary Bilibili BV/av or safe `b23.tv`
source still tries `yt-dlp` first, then uses the existing no-cookie public API/DASH fallback, creates
one local MP4, and continues through the current media validation, audio extraction, subtitle/ASR,
History, and separately confirmed AI flows.

The change gives maintainers separately reviewable source, playback, transport, and artifact failure
boundaries. It does not add login, cookies, member/private/PGC access, DRM bypass, a quality picker,
batch download, a new worker command, a new result field, or a shared framework for the other
platform fallbacks.

## Progress

- [x] 2026-07-20: Inspected governance, architecture/security boundaries, the original Bilibili
  implementation/reference/completed plan, all repository callers, progress ownership, generated
  worker synchronization, and recent history. Validation: read-only source/import searches and the
  focused Bilibili/media/source/progress regression set passed 169/169.
- [x] 2026-07-20: Selected a stable root adapter plus private Bilibili package split by failure
  boundary; rejected a generic helpers file and a multi-platform fallback framework. Validation:
  design review is recorded in
  `docs/design-docs/2026-07-20-bilibili-fallback-module-split.md`.
- [x] 2026-07-20: Published the proposed ADR, active ExecPlan, audit/TASKS status, and governance
  entry points for review without modifying production source. Validation: governance docs report
  0 errors/0 warnings, `git diff --check` passes, document links resolve, and placeholder scans are
  empty.
- [x] 2026-07-20: Added characterization, safety, and dependency RED tests before moving production
  code. Validation: root/backup/artifact characterization passed 9/9; the focused RED run produced
  exactly 3 failures for the missing decoded-body rejection and missing five-module package, while
  the two already-satisfied dependency/progress assertions passed.
- [x] 2026-07-20: Implemented decoded-response hardening and extracted types, source, playback,
  transport, artifacts, and root composition in independently green working-tree increments; commit
  checkpoints remain intentionally unexecuted pending explicit authorization. Validation: the final
  focused boundary set passed 183/183 and Ruff passed for the full worker tree.
- [x] 2026-07-20: Completed full worker/cross-layer/package gates, recorded native/live evidence,
  updated current architecture/security/audit evidence, and archived the plan. Validation: focused
  183/183, worker 450/450, app 549/549, Rust 169/169, Node 23/23, Ruff/lint/build/rustfmt, 6/6 mirror
  hashes, Tauri no-bundle, governance 0/0, and diff checks passed; live platform smoke is explicitly
  unverified.

## Surprises & Discoveries

Evidence: `media.py` imports only `BilibiliFallbackError` and `download_bilibili_video`, while
`platform_source_resolvers.py` imports `BilibiliFallbackError` and `parse_bilibili_input`. Tests also
import the root `HttpResponse`, URL builders, and stream-selection function. The existing root module
therefore must remain a stable compatibility path even though its internals move.

Evidence: `worker/tests/test_progress_events.py` scans `bilibili_fallback.py` itself for all five
registered producer codes. Keeping progress sequencing in the root adapter preserves both the true
application owner and the current producer-source gate.

Evidence: the current fallback's successful path removes complete video/audio `.m4s` inputs only
after final replacement. Failure paths remove `.part` and merge staging files but retain already
completed `.m4s` inputs and preserve any previous final MP4. A broad cleanup helper would silently
change useful partial-artifact behavior.

Evidence: `select_dash_stream_pair(data, duration_seconds)` accepts but does not use
`duration_seconds`. Repository callers/tests still use that signature, so assigning new semantics or
removing the argument is not part of a file split.

Evidence: the response decoder rejects a compressed body larger than the configured limit before
decompression but does not recheck the expanded body. The design isolates a decoded-body cap under
the existing fixed `BILIBILI_VIDEO_INFO_UNAVAILABLE` failure before code movement so the safety
change remains reviewable separately.

Evidence: the packaged worker directory is an ignored generated mirror. The existing refresh-path
test recursively compares relative files and bytes, so the new private package must be created only
in the canonical worker and synchronized through the established script.

Evidence: `media.py` already has the only cross-platform `DownloadStrategy` table and
`download_reliability.py` already owns generic atomic/resumable response writing. No additional
platform framework is needed to split Bilibili-specific policy.

Evidence: this Windows sandbox denies the default user-level uv cache and pytest temporary/cache
directories. Focused implementation tests therefore use the repository's existing `.venv` Python
and Ruff, disable pytest's cache provider, and place `--basetemp` under the session's writable
scratch root. This changes test plumbing only, not dependencies or behavior.

Evidence: source and playback parsing both require bounded decoding/header helpers, while private
children are forbidden from importing the root adapter. `transport.py` was therefore introduced in
Task 5 with only those pure helpers, then completed with urllib and resumable streaming in Task 6.
This preserves the planned final dependency graph without a temporary back-edge.

Evidence: the first root wrapper constructed `UrllibBilibiliHttpClient` before the extracted source
parser could take its direct BV/av fast path. A dedicated regression test reproduced the drift; the
root now performs the same direct-ID check before client construction, restoring the original lazy
behavior.

Evidence: the sandboxed Rust run passed 168/169 but the existing blocked-stdin cancellation fixture
received `RequestDeliveryFailed` before it could exercise cancellation. Re-running the complete
suite with normal Windows subprocess permissions passed 169/169, confirming an environment
restriction rather than a Bilibili or Rust regression.

## Decision Log

- Decision: Keep `frameq_worker.bilibili_fallback` as the only production import path outside the
  private package. Rationale: media dispatch, source resolution, progress source coverage, and tests
  already depend on this path; compatibility re-exports make internal moves non-breaking.
  Date/Author: 2026-07-20, User + Codex.
- Decision: Split into `types`, `source`, `playback`, `transport`, and `artifacts` modules under one
  private `bilibili/` package. Rationale: these modules align with distinct failure vocabularies and
  side-effect boundaries rather than generic helper categories. Date/Author: 2026-07-20, Codex.
- Decision: Add no facade class or shared three-platform downloader framework. Rationale: the root
  module is already the needed application adapter, while cross-platform common behavior already
  lives in `DownloadStrategy` and `download_reliability.py`. Date/Author: 2026-07-20, User + Codex.
- Decision: Keep all `bilibili.*` progress emission in the root adapter. Rationale: progress belongs
  to workflow sequencing, not pure parser/transport/artifact helpers, and the producer-source gate
  already enforces that ownership. Date/Author: 2026-07-20, Codex.
- Decision: Correct decoded-body size enforcement in a separate pre-extraction change using the
  existing response limit and error code. Rationale: the compressed-body-only check is a bounded
  security gap; isolating it avoids hiding behavior hardening inside mechanical movement.
  Date/Author: 2026-07-20, Codex.
- Decision: Preserve completed `.m4s` inputs on acquisition/merge failure and remove them on success.
  Rationale: this is the current documented partial-artifact behavior; broader cleanup is a product
  decision, not a module split. Date/Author: 2026-07-20, Codex.
- Decision: Edit only the canonical worker and refresh the generated resource mirror through the
  existing synchronization path. Rationale: hand-edited mirrors drift; recursive equality is already
  a release gate. Date/Author: 2026-07-20, Codex.

## Outcomes & Retrospective

The 936-line hotspot is now a 137-line stable root adapter plus a 907-line total private
implementation split across types, source, playback, transport, and artifacts. Root compatibility
bindings, direct-ID laziness, five progress events, fallback order, deterministic stream policy,
backup order, partial/complete artifact lifecycle, previous MP4 preservation, and final replacement
are covered by characterization and dependency tests. No facade class, shared multi-platform
framework, UI behavior, worker contract, result field, credential path, or AI behavior was added.

Automated evidence: focused 183/183, worker 450/450, app 549/549, Rust 169/169 under normal Windows
subprocess permissions, and Node scripts 23/23; Ruff, TypeScript lint, production build, rustfmt,
six private-package mirror hashes, and Tauri no-bundle release build pass. The generated worker is
ignored and was refreshed only through the canonical synchronization path.

Residual risk: public Bilibili APIs/CDNs and codec availability can change independently of FrameQ.
Fake clients and deterministic fixtures cannot prove current live availability. The decoded-body cap
is an intentional hardening change and must remain isolated from the structural commits; rejecting
expanded output after decompression does not prove a strict compression-library peak-memory bound.
The later Xiaohongshu and Douyin audits must not copy this shape without their own responsibility
analysis.

## Context and Orientation

Design and governance:

- `docs/design-docs/2026-07-20-bilibili-fallback-module-split.md`
- `docs/design-docs/frameq-code-audit-uml.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `AGENTS.md`
- `TASKS.md`

Existing product/security intent:

- `docs/product-specs/2026-06-16-douyin-video-transcription-client.md`
- `docs/references/easydownload-bilibili-fallback.md`
- `docs/exec-plans/completed/2026-06-27-bilibili-public-video-fallback-plan.md`
- `docs/design-docs/2026-07-18-source-identity-dependency-boundary.md`

Canonical worker:

- `worker/frameq_worker/bilibili_fallback.py`
- `worker/frameq_worker/media.py`
- `worker/frameq_worker/download_reliability.py`
- `worker/frameq_worker/platform_source_resolvers.py`
- `worker/frameq_worker/source_resolution.py`
- `worker/frameq_worker/progress_events.py`

Current tests and contracts:

- `worker/tests/test_bilibili_fallback.py`
- `worker/tests/test_bilibili_module_boundaries.py` (created by this plan)
- `worker/tests/test_media.py`
- `worker/tests/test_url_support_contract.py`
- `worker/tests/test_source_resolution.py`
- `worker/tests/test_progress_events.py`
- `worker/tests/test_import_boundaries.py`
- `contracts/platform-url-support-contract.json`
- `scripts/tests/tauri-dev-fresh-worker.test.mjs`

Planned canonical modules:

- `worker/frameq_worker/bilibili/__init__.py`
- `worker/frameq_worker/bilibili/types.py`
- `worker/frameq_worker/bilibili/source.py`
- `worker/frameq_worker/bilibili/playback.py`
- `worker/frameq_worker/bilibili/transport.py`
- `worker/frameq_worker/bilibili/artifacts.py`

## Planned File Responsibilities

| File | Responsibility |
|---|---|
| `bilibili_fallback.py` | stable imports/re-exports, client/runner defaults, page/output composition, five progress events |
| `bilibili/types.py` | shared error and immutable data/port values; no side effects |
| `bilibili/source.py` | input/host/ordinary-video/part parsing and bounded short-link policy |
| `bilibili/playback.py` | public API URL/response policy and deterministic DASH selection |
| `bilibili/transport.py` | fixed headers, bounded decoding, urllib GET, safe resumable streaming |
| `bilibili/artifacts.py` | URL-attempt order, `.m4s` acquisition, FFmpeg merge, staging cleanup primitives |
| `test_bilibili_fallback.py` | behavior characterization through the stable root import |
| `test_bilibili_module_boundaries.py` | file ownership, import direction, and root-only compatibility boundary |

## Plan of Work

### Task 1: Lock existing public behavior before extraction

**Files:**

- Modify: `worker/tests/test_bilibili_fallback.py`

- [x] **Step 1: Add a root compatibility characterization test**

Add a test that imports the module rather than private children and verifies the repository-observed
surface remains bound:

```python
def test_bilibili_root_compatibility_surface_is_stable() -> None:
    expected = {
        "BilibiliFallbackError",
        "HttpResponse",
        "CommandResult",
        "BilibiliParseResult",
        "BilibiliPage",
        "BilibiliVideoInfo",
        "BilibiliDashSelection",
        "UrllibBilibiliHttpClient",
        "parse_bilibili_input",
        "build_video_info_url",
        "build_playurl_url",
        "select_dash_stream_pair",
        "download_bilibili_video",
    }
    assert expected <= set(dir(bilibili_fallback))
```

- [x] **Step 2: Characterize backup ordering and artifact preservation**

Add fake-client tests that prove:

```python
assert client.download_calls == [primary_video, backup_video, primary_audio]
assert existing_output.read_bytes() == b"previous mp4"
assert video_temp_path.read_bytes() == b"video bytes"
assert audio_temp_path.read_bytes() == b"audio bytes"
assert not merge_temp_path.exists()
assert not video_part_path.exists()
assert not audio_part_path.exists()
```

Use one merge-failure case and one successful backup-URL case. Assert only fixed Bilibili error codes;
do not assert or expose raw CDN URL text in the error message.

- [x] **Step 3: Run the characterization suite**

Run:

```powershell
uv run pytest worker\tests\test_bilibili_fallback.py -q
```

Expected: PASS. These tests describe current behavior and must be green before any move.

- [ ] **Step 4: Commit the characterization tests**

```powershell
git add worker\tests\test_bilibili_fallback.py
git commit -m "test: characterize bilibili fallback boundaries"
```

### Task 2: Establish RED safety and module-boundary tests

**Files:**

- Modify: `worker/tests/test_bilibili_fallback.py`
- Create: `worker/tests/test_bilibili_module_boundaries.py`

- [x] **Step 1: Add the decoded-body limit regression test**

Construct a small gzip body that expands beyond `BILIBILI_MAX_RESPONSE_BYTES` and require the fixed
failure:

```python
def test_decode_response_rejects_oversized_expanded_body() -> None:
    expanded = b"x" * (bilibili_fallback.BILIBILI_MAX_RESPONSE_BYTES + 1)
    response = bilibili_fallback.HttpResponse(
        status=200,
        headers={"Content-Encoding": "gzip"},
        body=gzip.compress(expanded),
        url="https://api.bilibili.com/demo",
    )
    with pytest.raises(bilibili_fallback.BilibiliFallbackError) as exc_info:
        bilibili_fallback._decode_response_body(response)
    assert exc_info.value.code == "BILIBILI_VIDEO_INFO_UNAVAILABLE"
    assert "api.bilibili.com" not in str(exc_info.value)
```

- [x] **Step 2: Add the proposed private-module ownership test**

Create an AST test that initially requires these files:

```python
PRIVATE_MODULES = {
    "types": WORKER_PACKAGE / "bilibili" / "types.py",
    "source": WORKER_PACKAGE / "bilibili" / "source.py",
    "playback": WORKER_PACKAGE / "bilibili" / "playback.py",
    "transport": WORKER_PACKAGE / "bilibili" / "transport.py",
    "artifacts": WORKER_PACKAGE / "bilibili" / "artifacts.py",
}
```

Require that production modules outside `bilibili_fallback.py` do not import
`frameq_worker.bilibili.*`, and reject imports of `media`, `pipeline`, `media_preparation`, task
storage, ASR, AI, or the root compatibility module from private children. Also require the root to
contain all five registered `bilibili.*` progress codes.

- [x] **Step 3: Run RED tests and record the reasons**

Run:

```powershell
uv run pytest worker\tests\test_bilibili_fallback.py::test_decode_response_rejects_oversized_expanded_body worker\tests\test_bilibili_module_boundaries.py -q
```

Expected: FAIL because decoded size is not rechecked and the private package does not exist. No
production code should be changed before this RED evidence is recorded in Progress.

- [ ] **Step 4: Commit the RED tests**

```powershell
git add worker\tests\test_bilibili_fallback.py worker\tests\test_bilibili_module_boundaries.py
git commit -m "test: lock bilibili module split boundary"
```

### Task 3: Fix decoded-response size enforcement separately

**Files:**

- Modify: `worker/frameq_worker/bilibili_fallback.py`
- Test: `worker/tests/test_bilibili_fallback.py`

- [x] **Step 1: Add one fixed size-check helper around decompression**

Keep the existing limit and error code:

```python
def _require_bounded_response_body(body: bytes, max_bytes: int) -> None:
    if len(body) > max_bytes:
        raise BilibiliFallbackError(
            "BILIBILI_VIDEO_INFO_UNAVAILABLE",
            "Bilibili response exceeded the safety limit.",
        )
```

Call it once before decompression and once after gzip/Brotli/deflate decompression, before UTF-8
decoding. Do not include the response URL, encoding header, body, or exception text in the error.

- [x] **Step 2: Run the focused safety and current behavior tests**

```powershell
uv run pytest worker\tests\test_bilibili_fallback.py -q
uv run ruff check worker\frameq_worker\bilibili_fallback.py worker\tests\test_bilibili_fallback.py
```

Expected: PASS.

- [ ] **Step 3: Commit the isolated hardening**

```powershell
git add worker\frameq_worker\bilibili_fallback.py worker\tests\test_bilibili_fallback.py
git commit -m "fix: bound decoded bilibili responses"
```

### Task 4: Extract shared Bilibili types without changing identity

**Files:**

- Create: `worker/frameq_worker/bilibili/__init__.py`
- Create: `worker/frameq_worker/bilibili/types.py`
- Modify: `worker/frameq_worker/bilibili_fallback.py`
- Test: `worker/tests/test_bilibili_fallback.py`
- Test: `worker/tests/test_bilibili_module_boundaries.py`

- [x] **Step 1: Create a private package with no public re-export surface**

`bilibili/__init__.py` contains only a module docstring:

```python
"""Private Bilibili fallback implementation boundaries."""
```

- [x] **Step 2: Move the shared error/data values into `types.py`**

Move, without field/default changes:

```python
BilibiliFallbackError
HttpResponse
CommandResult
BilibiliParseResult
BilibiliPage
BilibiliVideoInfo
BilibiliDashSelection
```

Add only the narrow structural request-client protocol needed by source/playback code:

```python
class BilibiliRequestClient(Protocol):
    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> HttpResponse: ...
```

- [x] **Step 3: Re-export the moved identities from the stable root**

Import the exact class objects into `bilibili_fallback.py`; do not duplicate wrapper subclasses or
dataclasses. Define `__all__` with the compatibility names listed in Task 1.

- [x] **Step 4: Prove type identity and focused behavior**

Add assertions such as:

```python
assert bilibili_fallback.BilibiliFallbackError is bilibili_types.BilibiliFallbackError
assert bilibili_fallback.HttpResponse is bilibili_types.HttpResponse
```

Run:

```powershell
uv run pytest worker\tests\test_bilibili_fallback.py worker\tests\test_url_support_contract.py worker\tests\test_bilibili_module_boundaries.py -q
uv run ruff check worker\frameq_worker\bilibili worker\frameq_worker\bilibili_fallback.py worker\tests\test_bilibili_fallback.py worker\tests\test_bilibili_module_boundaries.py
```

Expected: behavior tests PASS; the boundary test may still fail only for child modules not yet
created. Record that expected intermediate state.

- [ ] **Step 5: Commit the type boundary**

```powershell
git add worker\frameq_worker\bilibili\__init__.py worker\frameq_worker\bilibili\types.py worker\frameq_worker\bilibili_fallback.py worker\tests\test_bilibili_fallback.py worker\tests\test_bilibili_module_boundaries.py
git commit -m "refactor: extract bilibili fallback types"
```

### Task 5: Extract source and playback policy

**Files:**

- Create: `worker/frameq_worker/bilibili/source.py`
- Create: `worker/frameq_worker/bilibili/playback.py`
- Modify: `worker/frameq_worker/bilibili_fallback.py`
- Modify: `worker/tests/test_bilibili_module_boundaries.py`
- Test: `worker/tests/test_bilibili_fallback.py`
- Test: `worker/tests/test_url_support_contract.py`
- Test: `worker/tests/test_source_resolution.py`

- [x] **Step 1: Move the source boundary as one behavior-preserving group**

Move the source constants and these functions to `source.py`:

```text
parse_bilibili_input
_parse_direct_id
_parse_bilibili_url_candidate
_parse_bilibili_video_url
_parse_part_index
_resolve_short_link
_resolve_short_link_once
_short_link_attempts
_extract_bilibili_urls
_is_bilibili_short_link
_is_bilibili_short_host
_is_acceptable_bilibili_host
_is_bilibili_host
```

Keep the current error precedence, recursion limit, direct-ID fast path, URL cleanup, and client
injection. Bind `parse_bilibili_input` back into the root module.

- [x] **Step 2: Run source-focused tests before the next move**

```powershell
uv run pytest worker\tests\test_bilibili_fallback.py worker\tests\test_url_support_contract.py worker\tests\test_source_resolution.py worker\tests\test_cli.py -q
```

Expected: PASS with no real network access.

- [x] **Step 3: Move public API and DASH policy as one deterministic group**

Move to `playback.py`:

```text
build_video_info_url
build_playurl_url
select_dash_stream_pair
parse_view_response
parse_playurl_response
_json_response
_api_data
_video_stream_score
_audio_stream_score
_collect_dash_urls
_collect_download_urls
_raise_if_drm
_quality_name
_as_mapping
_get_str
_get_strs
_get_int
```

Use non-underscore names only where the root orchestrator must call the function. Preserve
camelCase/snake_case compatibility, URL order/deduplication, codec ranking, API/login/DRM mapping,
and the accepted unused `duration_seconds` argument.

- [x] **Step 4: Re-export builders and stream selection and run focused tests**

```powershell
uv run pytest worker\tests\test_bilibili_fallback.py worker\tests\test_media.py worker\tests\test_url_support_contract.py worker\tests\test_source_resolution.py -q
uv run ruff check worker\frameq_worker\bilibili worker\frameq_worker\bilibili_fallback.py
```

Expected: PASS.

- [ ] **Step 5: Commit the policy boundaries**

```powershell
git add worker\frameq_worker\bilibili\source.py worker\frameq_worker\bilibili\playback.py worker\frameq_worker\bilibili_fallback.py worker\tests\test_bilibili_fallback.py worker\tests\test_bilibili_module_boundaries.py
git commit -m "refactor: isolate bilibili source and playback policy"
```

### Task 6: Extract HTTP and safe-stream transport

**Files:**

- Create: `worker/frameq_worker/bilibili/transport.py`
- Modify: `worker/frameq_worker/bilibili/source.py`
- Modify: `worker/frameq_worker/bilibili/playback.py`
- Modify: `worker/frameq_worker/bilibili_fallback.py`
- Test: `worker/tests/test_bilibili_fallback.py`
- Test: `worker/tests/test_download_reliability.py`
- Test: `worker/tests/test_bilibili_module_boundaries.py`

- [x] **Step 1: Move transport constants and side effects**

Move `UrllibBilibiliHttpClient`, fixed page/API/media headers, bounded body decoding, response chunk
iteration, partial-size lookup, and safe resumable streaming into `transport.py`. Keep:

```python
request = urllib.request.Request(url, headers=headers, method="GET")
```

and continue using `write_http_stream_atomically`/`write_http_response_atomically`. Preserve one
restart without Range only for `DOWNLOAD_CONTENT_RANGE_INVALID` with a prior partial.

- [x] **Step 2: Bind the client and response decoder through stable/internal imports**

The root re-exports `UrllibBilibiliHttpClient`. Source and playback import only the narrow transport
helpers they need; transport imports no source/playback/artifact/root module.

Move the decoded-size regression test from the root private helper to
`frameq_worker.bilibili.transport` at this step. The stable root does not need to re-export internal
decoder functions or size constants after extraction.

- [x] **Step 3: Run transport and cross-contract tests**

```powershell
uv run pytest worker\tests\test_bilibili_fallback.py worker\tests\test_download_reliability.py worker\tests\test_url_support_contract.py worker\tests\test_bilibili_module_boundaries.py -q
uv run ruff check worker\frameq_worker\bilibili worker\frameq_worker\bilibili_fallback.py worker\tests
```

Expected: PASS except that the boundary test may still report only the not-yet-created artifacts
module. No command may access the public network.

- [ ] **Step 4: Commit the transport boundary**

```powershell
git add worker\frameq_worker\bilibili\transport.py worker\frameq_worker\bilibili\source.py worker\frameq_worker\bilibili\playback.py worker\frameq_worker\bilibili_fallback.py worker\tests\test_bilibili_fallback.py worker\tests\test_bilibili_module_boundaries.py
git commit -m "refactor: isolate bilibili transport"
```

### Task 7: Extract artifact and FFmpeg effects, then close the root

**Files:**

- Create: `worker/frameq_worker/bilibili/artifacts.py`
- Modify: `worker/frameq_worker/bilibili_fallback.py`
- Modify: `worker/tests/test_bilibili_module_boundaries.py`
- Test: `worker/tests/test_bilibili_fallback.py`
- Test: `worker/tests/test_media.py`
- Test: `worker/tests/test_progress_events.py`

- [x] **Step 1: Move candidate download and merge primitives**

Move these effects to `artifacts.py`:

```text
download_first_available_url
download_url_to_path
merge_dash_files
run_command
```

Keep fixed `BILIBILI_DASH_DOWNLOAD_FAILED` and `BILIBILI_FFMPEG_MERGE_FAILED` errors and the exact
FFmpeg list argument order. Do not return or append raw URL, path, command, stdout, stderr, or caught
exception text.

- [x] **Step 2: Keep workflow sequencing and progress in the root**

The root `download_bilibili_video` must still emit exactly:

```python
(
    ("bilibili.metadata.resolving", 22),
    ("bilibili.stream.probing", 26),
    ("bilibili.video.downloading", 30),
    ("bilibili.audio.downloading", 32),
    ("bilibili.media.merging", 34),
)
```

The root derives the selected page and output stem, calls focused modules, performs final
`os.replace`, and invokes artifact cleanup primitives with the lifecycle table from the design.

- [x] **Step 3: Make the dependency test fully GREEN**

Require:

```python
assert_private_modules_exist()
assert_no_private_module_imports_root_or_application_layers()
assert_only_root_is_imported_by_media_and_platform_resolvers()
assert_root_owns_all_bilibili_progress_codes()
```

Do not assert an exact line count. Assert forbidden responsibilities/imports instead.

- [x] **Step 4: Run the complete focused boundary set**

```powershell
uv run pytest worker\tests\test_bilibili_fallback.py worker\tests\test_bilibili_module_boundaries.py worker\tests\test_media.py worker\tests\test_url_support_contract.py worker\tests\test_source_resolution.py worker\tests\test_progress_events.py -q
uv run ruff check worker
```

Expected: PASS. Compare the result with the 169-test baseline and record the new exact total.

- [ ] **Step 5: Commit the artifact/root boundary**

```powershell
git add worker\frameq_worker\bilibili\artifacts.py worker\frameq_worker\bilibili_fallback.py worker\tests\test_bilibili_fallback.py worker\tests\test_bilibili_module_boundaries.py
git commit -m "refactor: split bilibili fallback by failure boundary"
```

### Task 8: Prove canonical packaging and full regression behavior

**Files:**

- Modify only if a gate requires it: `scripts/tests/tauri-dev-fresh-worker.test.mjs`
- Generated/ignored during validation: `app/src-tauri/resources/worker/frameq_worker/`

- [x] **Step 1: Run complete Python and cross-layer suites**

```powershell
uv run pytest worker\tests
uv run ruff check worker
npm --prefix app test
cargo test --manifest-path app\src-tauri\Cargo.toml
node --test scripts\tests\*.test.mjs
```

Expected: every command exits 0. Run Rust with normal Windows process permissions if the existing
blocked-stdin cancellation fixture is denied by the sandbox.

- [x] **Step 2: Refresh and verify the packaged worker through the established path**

```powershell
node --input-type=module -e "import { prepareFreshWorkerResource } from './scripts/tauri-dev-fresh-worker.mjs'; await prepareFreshWorkerResource();"
npm --prefix app run tauri -- build --no-bundle
```

Expected: the canonical and generated worker trees contain identical filtered relative files and
bytes, including every `bilibili/*.py` module, and the Tauri build exits 0. Do not stage the generated
mirror.

- [x] **Step 3: Run final formatting/governance/diff gates**

```powershell
npm --prefix app run lint
npm --prefix app run build
cargo fmt --manifest-path app\src-tauri\Cargo.toml -- --check
python scripts\validate_agents_docs.py --level WARN
git diff --check
git status --short
```

Expected: all commands exit 0; status contains only reviewed canonical source/test/doc changes.

### Task 9: Update current evidence and archive the plan

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/2026-07-20-bilibili-fallback-module-split.md`
- Modify: `docs/design-docs/frameq-code-audit-uml.md`
- Modify: `TASKS.md`
- Modify: `AGENTS.md`
- Move: `docs/exec-plans/active/2026-07-20-bilibili-fallback-module-split-plan.md`
  -> `docs/exec-plans/completed/2026-07-20-bilibili-fallback-module-split-plan.md`
- Modify: `docs/exec-plans/active/index.md`
- Modify: `docs/exec-plans/completed/index.md`

- [x] **Step 1: Replace planned architecture language with measured implementation evidence**

Record final physical/production/test line counts, exact module ownership, dependency gate results,
focused/full test totals, packaged-worker equality, and any unavailable native/live evidence. Mark the
design `Implemented and accepted` only after all gates pass.

- [x] **Step 2: Move the audit row from active pressure to resolved evidence**

Do not claim all platform fallbacks are resolved. Record Bilibili only; leave Xiaohongshu and Douyin
as independent future audits.

- [x] **Step 3: Archive the ExecPlan and run governance validation again**

```powershell
python scripts\validate_agents_docs.py --level WARN
git diff --check
```

Expected: 0 errors, 0 warnings, and no whitespace errors.

- [x] **Step 4: Commit implementation closeout**

```powershell
git add AGENTS.md TASKS.md docs worker
git commit -m "refactor: split bilibili fallback by failure boundary"
```

## Validation and Acceptance

Required automated gates:

```powershell
uv run pytest worker\tests\test_bilibili_fallback.py worker\tests\test_bilibili_module_boundaries.py worker\tests\test_media.py worker\tests\test_url_support_contract.py worker\tests\test_source_resolution.py worker\tests\test_progress_events.py -q
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
```

Focused acceptance must prove:

- every stable root import and type identity remains available;
- direct BV/av, ordinary URL, share text, `?p=N`, `b23.tv`, redirect, lookalike-host, unsupported
  content, malformed API, login, missing part, no stream, and DRM behavior is unchanged;
- decoded responses over the existing limit fail with the fixed safe code;
- API URL/query/header/timeouts, DASH field compatibility/ranking, URL deduplication, and backup order
  remain unchanged;
- Range resume/restart, max-size, no-progress, `.part`, completed `.m4s`, merge staging, previous final
  MP4, successful replacement, and cleanup semantics match the design table;
- the five progress tuples remain exact and raw response/URL/command/output content does not enter
  progress or public errors;
- `media.py` fallback order/dispatch, source resolution, URL support contract, subtitle/ASR path,
  worker results, and app error rendering remain unchanged;
- private module dependency rules pass with no root/application back-edge; and
- the generated Tauri worker contains the complete private package and matches canonical bytes.

Manual/optional acceptance:

1. If a stable public ordinary Bilibili video and network are available, process one direct BV URL,
   one `b23.tv` URL, and one `?p=2` source through the existing FrameQ workflow. Use no credentials.
2. Confirm a normal MP4 reaches existing ffprobe/audio/ASR processing and no Bilibili-specific UI or
   new result field appears.
3. Inspect logs/errors for absence of cookies, SESSDATA, volatile CDN URLs, raw headers, FFmpeg
   stdout/stderr, and arbitrary exception text.
4. If live platform acceptance is unavailable or unstable, record it as unverified residual risk;
   do not compensate with login, cookies, proxying, DRM bypass, or weakened tests.
