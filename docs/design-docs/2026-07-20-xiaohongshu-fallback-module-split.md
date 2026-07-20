# Xiaohongshu Fallback Module Split

**Date:** 2026-07-20
**Status:** Implemented and accepted
**Baseline:** b46f0bb

## Context

At the baseline, worker/frameq_worker/xiaohongshu_fallback.py is an 894-line production module
behind one stable import path. It currently owns:

- direct note ID, full URL, share-text, xhslink.com short-link, redirect, and xsec_token handling;
- one process-local urllib opener and CookieJar used across short-link, page, and media requests;
- public note-page headers, status classification, gzip/Brotli/deflate decoding, and bounded text;
- window.__INITIAL_STATE__ extraction plus JavaScript-to-JSON compatibility conversion;
- note lookup, image-only classification, stream-schema compatibility, deterministic ranking, and
  primary/backup URL ordering;
- atomic or resumable media writes through download_reliability.py, Range restart, size/stall error
  mapping, and output replacement; and
- three progress events plus top-level fallback orchestration.

These responsibilities fail for different reasons and have different dependencies. Source parsing
needs URL and redirect policy. Page interpretation needs compression and bounded untrusted-data
parsing. Stream selection should be deterministic and free of I/O. Transport owns CookieJar,
urllib, Range, and filesystem effects. Keeping them together makes changes to one public-page rule
compete with unrelated download and ranking behavior in the same review.

The repository-observed root surface is wider than the two production consumers:

- media.py imports XiaohongshuFallbackError and download_xiaohongshu_video;
- platform_source_resolvers.py imports XiaohongshuFallbackError and parse_xiaohongshu_input;
- test_url_support_contract.py imports HttpResponse, the error type, and the source parser;
- test_xiaohongshu_fallback.py imports response/data types, public entry points, and three
  underscore-prefixed test seams; and
- test_progress_events.py scans xiaohongshu_fallback.py itself for all three registered progress
  codes.

The focused Xiaohongshu/download/media/source/progress regression set passes 191 tests at the
baseline. This is an internal structural refactor. It must not change accepted input, fallback
dispatch, result shape, progress, errors, output naming, download semantics, or user-visible
behavior.

## Requirements

The split must:

- retain worker/frameq_worker/xiaohongshu_fallback.py as the only production import path used by
  modules outside the private Xiaohongshu implementation;
- keep yt-dlp first and preserve the Douyin -> Xiaohongshu -> Bilibili strategy order in media.py;
- preserve direct 24-hex note IDs, supported full-note paths, share-text extraction, safe host
  checks, xhslink.com resolution, HTTP-to-HTTPS retry, redirect depth, and xsec_token forwarding;
- preserve one empty process-local CookieJar per default client instance across source, page, and
  media requests without adding browser-cookie or persistent-cookie input;
- preserve fixed navigation/media headers, timeouts, gzip/Brotli/zlib/raw-deflate compatibility,
  the 10 MiB page cap, the 256 KiB short-link-body cap, and fixed XHS error codes;
- preserve both supported stream shapes, quality-key deduplication, codec/type/weight/default/
  resolution/bitrate/size/backup-count ranking, and primary-before-backup URL ordering;
- preserve the 2 GiB media limit, 120-second no-progress limit, 256 KiB chunks, existing .part
  resume behavior, invalid-Content-Range restart, and SafeDownloadError mapping;
- preserve output naming as <note_id>.mp4 and replace an existing completed output only after a
  non-empty response has been atomically committed;
- preserve the three registered progress codes, video_extracting stage, progress values 22/30/30,
  and bounded one-based attempt/total arguments in the root orchestration module;
- keep raw submitted URLs, xsec_token, volatile media URLs, Cookie values, request headers, response
  bodies, and arbitrary exception text out of public errors, progress, diagnostics, and new test
  failure messages;
- add behavior and AST/import-boundary tests before moving production implementation; and
- add no generic multi-platform fallback framework, facade class, service locator, new product
  capability, contract field, progress code, error code, or UI change.

## Non-goals

This refactor does not:

- add image-album ZIPs, Live Photo sidecars, a stream picker, batch processing, or a download center;
- add account login, QR login, browser-cookie import, persistent cookies, CAPTCHA solving, private
  note scraping, proxy rotation, user-agent rotation, or browser fingerprint spoofing;
- change frontend URL admission, known URL-support asymmetries, SourceIdentity canonicalization, or
  the platform URL support contract;
- change media.py strategy ownership or create download_strategies.py;
- change task manifests, History, subtitle/ASR behavior, AI behavior, or local-media contract v4;
- redesign download_reliability.py or move platform-specific error mapping into it;
- claim a strict decompression peak-memory guarantee; or
- hand-edit the ignored generated Tauri worker resource mirror.

## Alternatives Considered

### 1. Keep the module intact and add headings/comments

This improves navigation but leaves source policy, untrusted-page parsing, ranking, CookieJar
transport, and filesystem effects in the same review unit.

**Decision:** Rejected.

### 2. Move most helpers into one xiaohongshu_helpers.py

This reduces the root line count but does not create enforceable failure or dependency boundaries.
The helper would still mix compression, URL policy, stream ranking, and writes.

**Decision:** Rejected.

### 3. Copy the Bilibili private-package structure exactly

Xiaohongshu has no public metadata API, separate video/audio DASH pair, or FFmpeg merge lifecycle.
It instead has one HTML/JavaScript state document, process-local anonymous cookies, and a single
video artifact. Copying playback/artifacts modules would manufacture abstractions that do not match
the platform.

**Decision:** Rejected.

### 4. Create a reusable three-platform fallback framework

The platforms differ in source identity, page/API shape, cookie behavior, stream topology, artifact
assembly, and failure vocabulary. Existing DownloadStrategy and download_reliability.py already own
the genuinely shared boundaries.

**Decision:** Rejected.

### 5. Keep a stable root adapter and add a private package shaped around Xiaohongshu failures

This preserves all callers while making source, page-state, stream-policy, and transport changes
independently reviewable. Ordinary functions, immutable data, and narrow Protocols are sufficient.

**Decision:** Selected.

## Decision

Use this private module tree:

~~~text
worker/frameq_worker/xiaohongshu_fallback.py
worker/frameq_worker/xiaohongshu/
  __init__.py
  types.py
  source.py
  page.py
  streams.py
  transport.py
~~~

The package is internal. xiaohongshu/__init__.py contains no compatibility re-exports; callers keep
using frameq_worker.xiaohongshu_fallback.

| Module | Owns | Must not own |
|---|---|---|
| xiaohongshu_fallback.py | stable bindings, default dependency composition, complete fallback sequence, candidate/backup retry sequencing, output stem, three progress events | URL grammar internals, response decompression internals, ranking internals, raw urllib/CookieJar, safe-download implementation |
| xiaohongshu/types.py | fixed error type, immutable response/source/candidate values, narrow client protocol | parsing, compression, HTTP execution, filesystem, progress |
| xiaohongshu/source.py | direct ID and note-URL parsing, host/path policy, share-text extraction, xsec_token, bounded short-link recursion and HTTPS retry, explore URL construction | note-state interpretation, stream ranking, media write, progress |
| xiaohongshu/page.py | page status policy, gzip/Brotli/deflate decode, size checks, initial-state extraction, JavaScript compatibility conversion, note lookup, image-only classification | network execution, URL redirects, stream ranking, filesystem, progress |
| xiaohongshu/streams.py | old/new stream-shape parsing, candidate normalization, quality-key deduplication, deterministic ranking, ordered URL deduplication | HTTP, CookieJar, compression, filesystem, progress |
| xiaohongshu/transport.py | fixed public headers, process-local CookieJar opener, urllib GET, response chunks, Range resume/restart, safe atomic media write, SafeDownloadError mapping | source grammar, page-state parsing, candidate ranking, output naming, progress |

There is intentionally no artifacts.py. Xiaohongshu produces one MP4 through the existing atomic
writer and does not have Bilibili's separate DASH inputs or FFmpeg merge lifecycle.

xiaohongshu_fallback.py remains a module-level application adapter, not a new facade object. It is
the only place that knows the complete sequence:

~~~text
parse source
  -> emit page progress
  -> fetch and validate public note page
  -> decode and parse initial state
  -> find note and rank video candidates
  -> reject image-only/no-stream content
  -> derive <note_id>.mp4
  -> emit saving progress
  -> try candidate primary/backup URLs
  -> emit bounded candidate retry progress
  -> return atomically committed MP4
~~~

## Compatibility Surface

The root module continues to provide these repository-observed names:

~~~python
XiaohongshuFallbackError
HttpResponse
XiaohongshuParseResult
XiaohongshuStreamCandidate
UrllibXiaohongshuHttpClient
XHS_DESKTOP_USER_AGENT
XHS_REFERER
parse_xiaohongshu_input
build_explore_url
parse_video_stream_candidates
download_xiaohongshu_video
_decode_response_body
_download_first_available_stream
_page_headers
_raise_for_page_response
~~~

The signatures of parse_xiaohongshu_input, parse_video_stream_candidates, and
download_xiaohongshu_video remain compatible with existing fake clients and callbacks. Shared
error/data/client identities are re-exported rather than redefined. The four underscore-prefixed
names remain root test seams for this refactor; retaining them does not make private child modules a
supported production API.

The root parse_xiaohongshu_input binding remains a small dependency-composition wrapper. It passes
the default-client factory into source.py so the direct 24-hex note-ID branch still returns before
constructing a network client, while source.py never imports the root adapter.

The currently unused XiaohongshuStreamCandidate.headers value remains populated with the same fixed
media headers. Removing the field is a separate compatibility decision.

## Failure Ownership

| Failure family | Owning boundary | Stable codes |
|---|---|---|
| source syntax/host/note ID | source.py | XHS_URL_INVALID, XHS_ID_PARSE_FAILED |
| short-link request/redirect/body | source.py with page/transport helpers | XHS_SHORT_LINK_RESOLUTION_FAILED |
| public page status/request | page.py and transport.py | XHS_PAGE_UNAVAILABLE, XHS_NOTE_NOT_FOUND, XHS_NOTE_BLOCKED, XHS_RATE_LIMITED |
| response decode/state | page.py | XHS_RESPONSE_DECODE_FAILED, XHS_RESPONSE_TOO_LARGE, XHS_INITIAL_STATE_MISSING, XHS_INITIAL_STATE_MALFORMED |
| note/stream policy | page.py, streams.py, and root decision | XHS_NOTE_NOT_FOUND, XHS_IMAGE_ONLY, XHS_NO_PLAYABLE_STREAM |
| stream acquisition | transport.py and root attempt loop | XHS_VIDEO_TOO_LARGE, XHS_DOWNLOAD_STALLED, XHS_STREAM_DOWNLOAD_FAILED |

Child modules raise only XiaohongshuFallbackError with the existing fixed English internal messages.
They do not attach submitted URLs, xsec_token, response bodies, cookies, headers, media URLs, local
paths, or arbitrary exception text. media.py remains the only conversion into the CommandResult
consumed by the worker pipeline.

## Cookie and Artifact Lifecycle

The default root path constructs one UrllibXiaohongshuHttpClient for one fallback invocation. Its
empty CookieJar may accept anonymous cookies naturally issued by public pages and reuse them for the
remaining requests in that invocation. It is never initialized from a browser or disk and is not
serialized, logged, returned, or shared across worker invocations.

The split preserves this artifact state table:

| Terminal point | Existing completed MP4 | .part file | Result |
|---|---|---|---|
| source/page/state/selection failure | untouched | none | fixed XHS failure |
| failed stream attempt | untouched | removed by safe writer | next backup/candidate |
| all stream attempts fail | untouched | removed | fixed mapped XHS failure |
| invalid resume response | untouched | stale part removed, one non-Range retry | continue or fixed failure |
| successful atomic write | atomically replaced | removed | committed <note_id>.mp4 |

The refactor must not unlink or truncate an existing final MP4 before the shared safe writer has a
valid non-empty replacement. It also must not broaden cleanup to arbitrary files or directories.

## Dependency Direction

~~~mermaid
flowchart TD
  Media["media.py / DownloadStrategy"] --> Root["xiaohongshu_fallback.py / stable adapter"]
  Resolver["platform_source_resolvers.py"] --> Root
  Root --> Source["xiaohongshu/source.py"]
  Root --> Page["xiaohongshu/page.py"]
  Root --> Streams["xiaohongshu/streams.py"]
  Root --> Transport["xiaohongshu/transport.py"]
  Source --> Page
  Source --> Transport
  Source --> Types["xiaohongshu/types.py"]
  Page --> Types
  Streams --> Types
  Transport --> Types
  Transport --> Reliability["download_reliability.py"]
~~~

No private Xiaohongshu module imports media.py, pipeline.py, media_preparation.py, source identity,
task storage, ASR, AI, or the root compatibility module. Production modules outside the root do not
import frameq_worker.xiaohongshu.*. This prevents cycles and keeps the root the only application
composition point.

## Security and Operational Constraints

- Only public or user-authorized Xiaohongshu video-note inputs remain in scope.
- xsec_token is transient request material. It may be forwarded to the public note page in memory
  but must not enter canonical SourceIdentity, manifests, History, progress, errors, logs, AI, or
  FrameQ server requests.
- The default CookieJar is empty and process-local. No new parameter, environment variable, file,
  setting, browser integration, or diagnostic may carry cookie material.
- Full volatile media URLs may exist in worker memory only for ranking and download. Tests must use
  synthetic hosts and returned failures must retain fixed codes/messages.
- page.py preserves the current post-decompression size checks. Compression libraries may allocate
  expanded output before rejection, and urllib GET currently reads the bounded-use page response
  before page-level validation; this refactor does not claim a strict peak-memory bound.
- transport.py must continue using urllib request objects and shared safe writers without shell
  execution. No submitted value becomes a command, executable, environment key, or filesystem path.
- The canonical worker is edited only under worker/frameq_worker. The ignored Tauri resource mirror
  is refreshed through the established synchronization path and recursively compared by file set
  and bytes.
- The active local-media contract-v4 implementation may touch media preparation concurrently, but
  it must continue consuming only the stable root fallback path. This split adds no local-media
  variant and must re-run full worker and packaged-mirror gates after rebasing or merging.

## Implementation Order

1. Characterize root imports/type identity, direct-ID lazy client construction, response/status
   failures, page decoding/state parsing, candidate ranking, primary/backup ordering, old-output
   preservation, Range restart, progress, and caller paths.
2. Add RED AST/import-boundary tests for the proposed private package and root-only progress/
   production entry ownership.
3. Extract shared immutable types and re-export them from the root.
4. Extract page-state and stream-policy functions, keeping them deterministic and I/O-free.
5. Extract CookieJar/urllib/safe-download transport, preserving headers, timeouts, resume/restart,
   fixed error mapping, and atomic replacement.
6. Extract source parsing and short-link policy, preserving direct-ID laziness and transient
   xsec_token behavior.
7. Reduce the root to compatibility composition, workflow sequence, candidate attempts, output
   naming, and progress.
8. Run focused/full/cross-layer/package gates, update architecture/security/audit evidence with
   measured results, and archive the dedicated ExecPlan.

Each extraction must keep the focused set green. Any change to accepted inputs, known URL-support
asymmetries, Cookie lifetime, error code/message, progress tuple, stream ranking, attempt order,
output path, atomic replacement, fallback order, or root import path stops implementation and
returns the change to design review.

## Acceptance

- xiaohongshu_fallback.py contains stable bindings, dependency composition, complete fallback
  orchestration, output naming, candidate attempt sequencing, and progress only.
- Private modules match the responsibility/dependency table; AST tests reject back-edges and direct
  production imports outside the root.
- All repository-observed root imports remain valid, with one shared error/data/client type identity.
- The baseline focused set remains green and new characterization/boundary tests pass.
- URL support, source resolution, fallback dispatch/order, anonymous-cookie lifetime, page decoding,
  state parsing, ranking, progress tuples, error codes, .part/Range behavior, prior-MP4 preservation,
  and final output remain unchanged.
- Ruff, complete worker tests, app/Rust/script regression gates, packaged-worker equality, Tauri
  no-bundle build, governance validation, and git diff --check pass.
- Optional live smoke uses one stable public video note without credentials. If no stable sample or
  network is available, the plan records this as unverified rather than weakening automated or
  security boundaries.

## Implementation Evidence

The accepted implementation keeps a 169-line stable root adapter and an empty private-package
initializer. Physical child-module counts are: types.py 52, source.py 182, page.py 163, streams.py
139, and transport.py 230. The dedicated behavior test is 680 lines and the AST/import-boundary
test is 102 lines. Production callers still import only frameq_worker.xiaohongshu_fallback; the
private package has no compatibility exports or child-to-root/application back-edges.

TDD evidence began with the expected 5 failing / 2 passing ownership assertions while the proposed
modules were absent. Shared type/client identities, direct-ID lazy construction, fixed page status
and decode failures, JavaScript state compatibility, ranked candidate headers/order, prior-MP4
preservation, and invalid-Range restart are now characterized. The completed focused set passes
222/222. Full gates pass worker 477/477, app 549/549, Rust 169/169, and scripts 23/23, together with
Ruff, TypeScript/i18n lint, rustfmt, frontend production build, and Tauri no-bundle release build.
The Rust subprocess-pipe suite first exposed one sandbox-only request-delivery failure; the same
unchanged suite passed 169/169 with normal Windows process permissions.

The canonical worker and generated Tauri resource mirror contain the same 44 filtered source files,
with zero missing, extra, or SHA-256-mismatched files. The existing Python audioop deprecation and
Vite chunk-size warnings remain unchanged. No credential-free live Xiaohongshu sample or macOS
runtime was exercised in this implementation session, so current public-page/CDN availability and
platform-specific live behavior remain release residual risks rather than claimed acceptance.

## Residual Risk

Xiaohongshu public pages, JavaScript state fields, short-link behavior, cookies, risk control, and
media CDN behavior can change independently of FrameQ. Fake clients and deterministic fixtures
cannot prove current live availability. Structural extraction does not solve decompression
peak-memory behavior or eliminate platform-specific maintenance; it makes those policies separately
reviewable. Douyin must receive its own audit after this change rather than inheriting this package
shape automatically.
