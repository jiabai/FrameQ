# Douyin Fallback Module Split

**Date:** 2026-07-20
**Status:** Implemented and verified; awaiting local commit authorization
**Baseline:** 98b4197

## Context

At the baseline, `worker/frameq_worker/douyin_fallback.py` is a 515-line production module behind
one stable import path. It currently owns:

- canonical video/note/slides/query ID extraction plus share-text and `v.douyin.com` resolution;
- one process-local urllib opener and `CookieJar` used across short-link, share-page, probe, and
  media requests;
- public request headers, HTTP/URL error conversion, and bounded call timeouts;
- `window._ROUTER_DATA` extraction, JSON decoding, recursive `videoInfoRes` lookup, and playable-item
  validation;
- `bit_rate` candidate extraction, `play_addr.uri` ratio probing, media-response validation,
  size-based deduplication, and deterministic candidate ordering;
- atomic candidate download, retry, previous-output preservation, and fixed failure mapping; and
- four registered progress events plus top-level fallback orchestration.

These responsibilities fail for different reasons and need different dependencies. Source parsing
needs URL and short-link policy. Share-page interpretation is deterministic untrusted-data parsing.
Stream policy combines pure candidate ranking with bounded HTTP probes. Transport owns `CookieJar`,
urllib, and filesystem effects. Keeping them together makes a page-schema change compete with
unrelated source, retry, and artifact behavior in one review unit.

The repository-observed root surface is wider than the two production consumers:

- `media.py` imports `DouyinFallbackError`, `download_douyin_video`, and `extract_aweme_id`;
- `platform_source_resolvers.py` imports `DouyinFallbackError` and
  `resolve_aweme_id_from_input`;
- `test_download_reliability.py` imports `HttpResponse`;
- `test_douyin_fallback.py` imports constants, response/candidate/error types, builders, parsers,
  stream helpers, the candidate downloader, and the public orchestration entry; and
- `test_progress_events.py` scans `douyin_fallback.py` itself for all four registered progress
  codes.

The focused Douyin/media/source/progress/download regression set passes 181 tests at the baseline.
This is an internal structural refactor. It must not change accepted inputs, fallback dispatch,
result shape, progress, errors, candidate policy, output naming, download behavior, or any
user-visible behavior.

## Requirements

The split must:

- retain `worker/frameq_worker/douyin_fallback.py` as the only production import path used by
  modules outside the private Douyin implementation;
- keep `yt-dlp` first and preserve the Douyin -> Xiaohongshu -> Bilibili strategy order in
  `media.py`;
- preserve canonical `/video/{id}`, `/note/{id}`, `/share/slides/{id}`, `modal_id`, and `aweme_id`
  extraction, share-text URL discovery, exact supported-host checks, and `v.douyin.com` resolution;
- preserve the direct-ID no-network path and one empty process-local `CookieJar` per default
  client instance without adding browser-cookie or persistent-cookie input;
- preserve fixed mobile Safari headers, current `www.iesdouyin.com` share/play URLs, 10-second
  source/page/probe timeouts, the 30-second media timeout, and current HTTP/URL error behavior;
- preserve exact Router Data marker/JSON lookup, recursive `videoInfoRes` discovery, first playable
  `item_list` entry, and fixed missing/malformed error codes;
- preserve `bit_rate` preference before ratio probing, ratio order `1080p/720p/540p/480p/360p`,
  `Range: bytes=0-1`, strict `206` plus positive `Content-Range` and video-like content-type checks,
  redirected response URL use, and Range removal before the final media request;
- preserve largest-byte-first ordering, quality-rank tie-breaking, positive-size filtering, and
  size-only candidate deduplication;
- preserve output naming as `<aweme_id>.mp4`, candidate fallback after request or safe-write
  failure, atomic replacement, and preservation of an existing completed output until success;
- preserve the four registered progress codes, `video_extracting` stage, values 22/26/30/30,
  one-based retry arguments, and the current no-event behavior when candidate totals exceed 100;
- keep submitted URLs, volatile media URLs, cookies, request headers, response bodies, and arbitrary
  exception text out of public errors, progress, diagnostics, and new test failure messages;
- add characterization and AST/import-boundary tests before moving implementation; and
- add no generic multi-platform fallback framework, facade class, service locator, contract field,
  progress/error code, product capability, or UI change.

## Non-goals

This refactor does not:

- add image/slides export, a quality picker, batch processing, or a download center;
- add account login, browser-cookie import, persistent cookies, CAPTCHA solving, private-content
  access, proxy rotation, user-agent rotation, or browser-fingerprint spoofing;
- add new Douyin API fallbacks such as `aweme/detail` or `slidesinfo`;
- change frontend URL admission, `SourceIdentity` canonicalization, or the platform URL-support
  contract;
- change `media.py` strategy ownership or create a shared `download_strategies.py` framework;
- change task manifests, History, media validation, subtitle/ASR behavior, AI behavior, or local
  media contract v4;
- redesign `download_reliability.py`, add a new streaming protocol, or add a new media-size cap;
- correct old reference-note wording or broaden the current request-header set; or
- hand-edit the ignored generated Tauri worker resource mirror.

## Alternatives Considered

### 1. Keep the module intact and add headings/comments

This improves navigation but leaves source policy, Router Data parsing, probe policy, `CookieJar`
transport, and atomic writes in the same review unit.

**Decision:** Rejected.

### 2. Move helpers into one `douyin_helpers.py`

This lowers the root line count without creating enforceable failure or dependency boundaries. The
new helper would still mix URL grammar, untrusted JSON, HTTP probes, and filesystem writes.

**Decision:** Rejected.

### 3. Copy the Xiaohongshu or Bilibili private package mechanically

Douyin has neither Xiaohongshu's compressed JavaScript-state/backup-stream lifecycle nor Bilibili's
public metadata APIs, DASH pair, and FFmpeg merge. Its distinctive boundary is Router Data plus
ratio probes. Reusing file names is acceptable only where the responsibilities independently match;
code and platform abstractions remain separate.

**Decision:** Rejected as a method.

### 4. Create a reusable three-platform fallback framework

The platforms differ in source identity, page/API shape, cookie behavior, stream topology, artifact
assembly, and failure vocabulary. Existing `DownloadStrategy` and `download_reliability.py` already
own the genuinely shared boundaries.

**Decision:** Rejected.

### 5. Keep a stable root adapter and add a private package shaped around Douyin failures

This preserves every caller while making source, page, stream/probe policy, and transport changes
independently reviewable. Ordinary functions, immutable data, and one narrow HTTP protocol are
sufficient.

**Decision:** Selected.

## Decision

Use this private module tree:

~~~text
worker/frameq_worker/douyin_fallback.py
worker/frameq_worker/douyin/
  __init__.py
  types.py
  source.py
  page.py
  streams.py
  transport.py
~~~

The package is internal. `douyin/__init__.py` contains no compatibility re-exports; callers keep
using `frameq_worker.douyin_fallback`.

| Module | Owns | Must not own |
|---|---|---|
| `douyin_fallback.py` | stable bindings, default dependency composition, full fallback sequence, output naming, candidate ordering wrapper, retry progress, four progress codes | URL-regex internals, Router Data traversal, probe internals, raw urllib/CookieJar, atomic-write implementation |
| `douyin/types.py` | fixed error type, immutable response/candidate values, narrow HTTP client protocol | URL parsing, JSON parsing, HTTP execution, filesystem, progress |
| `douyin/source.py` | ID patterns, allowlisted host/share-text parsing, direct-ID-first short-link resolution, share-page URL construction | Router Data interpretation, candidate policy, media writes, progress |
| `douyin/page.py` | Router Data marker/JSON extraction, recursive `videoInfoRes` lookup, first playable item validation | network execution, URL redirects, stream ranking/probing, filesystem, progress |
| `douyin/streams.py` | quality constants, play URL, bit-rate normalization, ratio probing, response-header interpretation, candidate filtering/deduplication/order | CookieJar construction, urllib execution, final media writes, output naming, progress |
| `douyin/transport.py` | fixed public headers, process-local CookieJar opener, urllib GET, ordered candidate requests, Range removal, safe atomic media write, download failure mapping | source grammar, Router Data parsing, probe/quality policy, output naming, progress codes |

The familiar `types/source/page/streams/transport` names are retained because those are the actual
Douyin responsibilities, not because the Xiaohongshu implementation is being copied. Douyin
modules share no private code with another platform and no common platform package is introduced.

`douyin_fallback.py` remains a module-level application adapter, not a new facade object. It is the
only place that knows the complete sequence:

~~~text
resolve aweme ID with one client
  -> emit page progress
  -> request the public share page
  -> parse Router Data and select the first playable item
  -> emit probe progress
  -> prefer bit-rate candidates or probe ratios
  -> reject no-stream content
  -> derive <aweme_id>.mp4
  -> emit saving progress
  -> sort candidates and try each through transport
  -> emit bounded retry progress from the root
  -> return atomically committed MP4
~~~

## Compatibility Surface

The root module continues to provide these repository-observed names:

~~~python
DOUYIN_MOBILE_USER_AGENT
PLAY_QUALITIES
DouyinFallbackError
DouyinStreamCandidate
HttpResponse
UrllibDouyinHttpClient
extract_aweme_id
resolve_aweme_id_from_input
parse_share_page_router_data
collect_stream_candidates
select_stream_candidates
download_first_available_candidate
download_douyin_video
build_share_page_url
build_play_url
~~~

The signatures remain compatible with current fake clients, output paths, timeouts, and callbacks.
The error, response, candidate, and concrete client classes are re-exported rather than redefined,
so callers see one identity for each shared type. Function implementations may move, but callers do
not import private package paths.

The root `download_first_available_candidate` remains a compatibility/application wrapper. It
sorts through `select_stream_candidates`, supplies a root-owned retry callback to transport, and
keeps every `douyin.stream.retrying` code literal in the root. Transport receives already ordered
candidates and never emits progress.

The root path constructs one `UrllibDouyinHttpClient` for `download_douyin_video` and passes it to
source resolution, the share page, ratio probes, and the final media request. The standalone
`resolve_aweme_id_from_input` preserves its own default-client behavior and checks a direct ID before
constructing that client.

## Failure Ownership

| Failure family | Owning boundary | Stable codes |
|---|---|---|
| source syntax/host/ID | `source.py` and root decision | `DOUYIN_ID_PARSE_FAILED` |
| short-link/public request transport | `source.py` plus `transport.py` | `DOUYIN_SHARE_PAGE_UNAVAILABLE` |
| share-page status/body | root orchestration | `DOUYIN_SHARE_PAGE_UNAVAILABLE` |
| Router Data marker/JSON/item lookup | `page.py` | `DOUYIN_ROUTER_DATA_MISSING`, `DOUYIN_ROUTER_DATA_MALFORMED` |
| bit-rate/probe/selection policy | `streams.py` and root decision | `DOUYIN_NO_PLAYABLE_STREAM` |
| candidate acquisition/atomic write | `transport.py` | `DOUYIN_STREAM_DOWNLOAD_FAILED` |

Child modules raise only `DouyinFallbackError` with the existing fixed English internal messages.
They do not attach submitted URLs, response bodies, cookies, headers, volatile media URLs, local
paths, or arbitrary exception text. `media.py` remains the only conversion into the `CommandResult`
consumed by the worker pipeline.

## Cookie, Probe, and Artifact Lifecycle

The default root path constructs one `UrllibDouyinHttpClient` for one fallback invocation. Its
empty `CookieJar` may accept anonymous cookies naturally issued by public requests and reuse them
for subsequent requests in that invocation. It is never initialized from a browser or disk and is
not serialized, logged, returned, or shared across worker invocations.

Ratio probes are metadata acquisition, not artifact writes. They use the same client, fixed public
headers plus `Range: bytes=0-1`, and accept only a `206` response with a positive total and a
video-like content type. The candidate records the final response URL and fixed headers without
the probe Range header.

The split preserves this artifact state table:

| Terminal point | Existing completed MP4 | `.part` file | Result |
|---|---|---|---|
| source/page/Router Data/selection failure | untouched | none | fixed Douyin failure |
| failed candidate request | untouched | none | next candidate |
| failed safe-write attempt | untouched | removed by atomic writer | next candidate |
| all candidates fail | untouched | removed | fixed `DOUYIN_STREAM_DOWNLOAD_FAILED` |
| successful atomic write | atomically replaced | removed | committed `<aweme_id>.mp4` |

The refactor must not unlink or truncate an existing final MP4 before the shared writer has a valid
non-empty replacement. It also must not broaden cleanup to arbitrary files or directories.

## Dependency Direction

~~~mermaid
flowchart TD
  Media["media.py / DownloadStrategy"] --> Root["douyin_fallback.py / stable adapter"]
  Resolver["platform_source_resolvers.py"] --> Root
  Root --> Source["douyin/source.py"]
  Root --> Page["douyin/page.py"]
  Root --> Streams["douyin/streams.py"]
  Root --> Transport["douyin/transport.py"]
  Source --> Transport
  Source --> Types["douyin/types.py"]
  Page --> Types
  Streams --> Transport
  Streams --> Types
  Transport --> Types
  Transport --> Reliability["download_reliability.py"]
~~~

No private Douyin module imports `media.py`, `pipeline.py`, `media_preparation.py`, source identity,
task storage, ASR, AI, or the root compatibility module. Production modules outside the root do not
import `frameq_worker.douyin.*`. This prevents cycles and keeps the root the only application
composition point.

## Security and Operational Constraints

- Only public or user-authorized Douyin video inputs remain in scope.
- The default `CookieJar` is empty and process-local. No new parameter, environment variable, file,
  setting, browser integration, or diagnostic may carry cookie material.
- Submitted/share/media URLs may exist in worker memory only for the current resolution and
  download. New tests use synthetic hosts; returned failures retain fixed codes/messages.
- `source.py` retains exact host checking and finite work: it follows only URLs returned by one
  bounded client request per candidate short link and scans bounded response bytes already returned
  by the client. This refactor does not add recursive crawling or arbitrary redirect targets.
- `page.py` parses only the in-memory share-page body and keeps current JSON-decoder behavior. This
  refactor does not add a new body-size or peak-memory guarantee.
- `transport.py` continues using urllib request objects and the shared atomic writer without shell
  execution. No submitted value becomes a command, executable, environment key, or filesystem path.
- The canonical worker is edited only under `worker/frameq_worker`. The ignored Tauri resource
  mirror is refreshed through the established synchronization path and compared recursively by
  file set and bytes.
- Active local-media work may touch media preparation concurrently, but it must continue consuming
  only the stable root fallback path. This split adds no local-media variant and must rerun full
  worker and packaged-mirror gates after rebasing or merging.

## Implementation Order

1. Characterize root imports/type identity, direct-ID lazy client construction, one-client reuse,
   HTTP error mapping, exact Router Data behavior, bit-rate preference, ratio probe order, ranking,
   Range removal, previous-output preservation, retries, progress, and caller paths.
2. Add RED AST/import-boundary tests for the proposed private package and root-only progress and
   production-entry ownership.
3. Extract shared immutable types and the HTTP protocol, then re-export exact identities.
4. Extract fixed headers, process-local CookieJar HTTP, ordered candidate acquisition, and atomic
   write/error mapping into transport without moving progress.
5. Extract deterministic Router Data interpretation and stream/probe policy.
6. Extract source parsing and short-link policy while preserving direct-ID laziness and one-client
   reuse.
7. Reduce the root to compatibility composition, full workflow, output naming, candidate ordering,
   retry progress, and the other three stage events.
8. Run focused/full/cross-layer/package gates, update architecture/security/audit evidence with
   measured results, and archive the dedicated ExecPlan.

Each extraction must keep the focused set green. Any change to accepted inputs, host policy,
`CookieJar` lifetime, request headers/URLs/timeouts, error code/message, progress tuple, Router Data
selection, probe order/validation, candidate order/deduplication, output path, atomic replacement,
fallback order, or root import path stops implementation and returns the change to design review.

## Acceptance

- `douyin_fallback.py` contains stable bindings, default dependency composition, full workflow,
  output naming, candidate-order wrapper, retry/stage progress, and no raw HTTP/JSON/filesystem
  implementation.
- Private modules match the responsibility and dependency tables; AST tests reject back-edges,
  side-effect drift, progress drift, and direct production imports outside the root.
- All repository-observed root imports remain valid, with one shared error/response/candidate/client
  identity.
- The 181-test baseline focused set remains green and new characterization/boundary tests pass.
- URL support, source resolution, fallback dispatch/order, anonymous-cookie lifetime, Router Data,
  candidate extraction/probing/ranking, progress tuples, fixed errors, prior-MP4 preservation, and
  final output remain unchanged.
- Ruff, complete worker tests, app/Rust/script regression gates, recursive packaged-worker equality,
  Tauri no-bundle build, governance validation, and `git diff --check` pass.
- Optional live smoke uses one stable public video without credentials. If no stable sample or
  network is available, the plan records this as unverified rather than weakening automated or
  security boundaries.

## Implementation Evidence

The approved boundary is implemented in the canonical worker. The stable root is 132 physical
lines; the private package contains an empty initializer plus `types.py` 38, `source.py` 87,
`page.py` 61, `streams.py` 183, and `transport.py` 118 physical lines. The behavior suite is 513
lines and the AST/import-boundary suite is 212 lines. These measurements describe review units;
they are not themselves the quality gate.

Characterization preceded extraction, and the first private-boundary run failed only for the absent
planned owners. The completed focused set passes 205/205, including exact root identities,
direct-ID laziness, one-client request order, Router Data, bit-rate/probe policy, Range removal,
fixed failures, retry progress, previous-output preservation, and all ownership gates. The full
worker suite passes 501/501 with one unchanged Python `audioop` deprecation warning; Ruff is clean.

Cross-layer evidence passes App 549/549, Rust 169/169 under normal Windows process permissions,
scripts 23/23, TypeScript/i18n lint, frontend build, rustfmt, and Tauri release `--no-bundle`.
The sandboxed Windows cancellation fixture reproduced the same `taskkill` permission race on the
unchanged main tree; the isolated fixture and complete Rust suite both passed outside the sandbox.
The generated worker mirror matches all 50 canonical files recursively and includes the private
Douyin package.

No credential-free live Douyin fallback or macOS runtime smoke was run. Public-page/CDN drift and
platform-specific runtime behavior therefore remain explicit residual risks rather than inferred
passes.

## Residual Risk

Douyin public share pages, Router Data fields, short-link behavior, anonymous cookies, ratio probe
endpoints, risk control, and media CDN behavior can change independently of FrameQ. Fake clients and
deterministic fixtures cannot prove current live availability. Structural extraction does not add a
strict page-body limit, resumable media download, or media validation inside this fallback; those
remain current downstream/shared behaviors. The refactor makes platform policies separately
reviewable without claiming to eliminate platform maintenance.
