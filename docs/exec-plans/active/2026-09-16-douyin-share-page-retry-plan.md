# Douyin Share Page Retry Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision
> Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Make the Douyin public share page step survive the intermittent slimmed-down response by
retrying the fetch and parse up to three attempts in total, waiting a randomized 3 to 10 seconds
between attempts, and surfacing each retry through a new closed progress message code. Keep the
Windows `tauri:dev:fresh-worker` entry point reliable on constrained hosts while validating this
change by limiting its default Cargo parallelism and avoiding non-fatal debug registry writes.

**Architecture:** The retry lives in the Douyin root adapter `worker/frameq_worker/douyin_fallback.py`
as a `resolve_share_page_item` orchestration helper. It extracts the existing fetch and parse pair
into a single-attempt `_fetch_share_page_item` function, classifies `DouyinFallbackError` by code,
and reuses the already-established `_emit_progress` bridge. A `sleeper` injection point keeps the
randomized wait out of tests. The new progress code `douyin.page.retrying` is registered in the
embedded Python registry, the shared desktop-worker contract, the TypeScript protocol rules, and
the three bundled locales.

**Tech Stack:** Python 3/pytest/Ruff, shared JSON desktop-worker contract, TypeScript/Vitest/i18next.

---

## Purpose / Big Picture

The Douyin share page intermittently returns a slimmed-down document that contains no
`videoInfoRes`. Measured against a live video, roughly one response in three degraded, and the same
degradation also hit an unrelated older video ID, so it is a server-side variant rather than a
property of any single video. Before this change the worker raised `DOUYIN_ROUTER_DATA_MISSING` on
the first degraded response, and the user saw the generic Douyin stream-unavailable copy even
though the same link worked on a second submission.

After this change the worker absorbs that transient variant: it retries the same public share page
URL up to three attempts in total, waits a randomized 3 to 10 seconds between attempts, and tells
the user a retry is in progress through `douyin.page.retrying` with `attempt` and `total`. Only
after the last attempt fails does the last share page error surface, so the existing error taxonomy
and localized copy stay authoritative and no new user-facing error text is introduced.

## Progress

- [x] 2026-09-16: Verified the field failure with a live probe against the reported URL and two
  baseline video IDs, and confirmed the degradation is a share page variant and not a video-level
  restriction. Validation: direct requests through `frameq_worker.douyin` reported a degraded
  document of roughly 32 KB versus the healthy 37 to 40 KB, and the reported URL produced three
  playable streams on the successful retry.
- [x] 2026-09-16: Product spec section `2026-09-16 Douyin Share Page Retry` written to
  `docs/product-specs/2026-06-16-douyin-video-transcription-client.md`.
- [x] 2026-09-16: Retry implemented in `worker/frameq_worker/douyin_fallback.py` with
  `SHARE_PAGE_ATTEMPTS`, `SHARE_PAGE_RETRY_DELAY_RANGE_SECONDS`,
  `SHARE_PAGE_RETRYABLE_ERROR_CODES`, a `resolve_share_page_item` helper, a single-attempt
  `_fetch_share_page_item`, and a `sleeper` injection point on `download_douyin_video`.
  Validation: `uv run ruff check worker` passed.
- [x] 2026-09-16: `douyin.page.retrying` registered in all four places and the three locale
  resources. Validation: worker contract test, TypeScript contract test, protocol test, and the
  three i18n suites passed (35 tests).
- [x] 2026-09-16: Worker and frontend tests added or updated. Validation: full worker suite 858
  passed with 2 pre-existing `test_atomic_files.py` symlink failures reproduced identically on a
  detached HEAD worktree; full frontend suite 762 passed with exit code 0.
- [x] 2026-09-16: Live end-to-end confirmation against the reported URL with real network and a
  real `time.sleep`. Validation: four rounds produced one recovered retry with a measured wait of
  8.48 seconds, three playable streams on every round, and zero failures;
  `python scripts/validate_agents_docs.py --level ERROR` reported 0 errors and 0 warnings.
- [x] 2026-09-16: Windows desktop startup hardened after reproducing native build failure from
  page-file exhaustion and a non-fatal debug deep-link registry access error. The fresh-worker
  launcher now defaults Windows Cargo builds to one job unless overridden, and Windows debug
  Tauri startup skips `register_all()` while release behavior remains unchanged. Added Node and
  Rust regression tests and verified the real launcher reached a responsive `app.exe` with HTTP
  200 from the Vite dev server.

## Surprises & Discoveries

- The degradation is not deterministic per video. Re-requesting the same URL moved between the
  degraded and healthy document, and a repository test fixture video ID also degraded once. This
  is why the design retries the request instead of blacklisting an ID or changing the parse.
- Live confirmation on the reported URL showed the degradation correlates with a cold HTTP session.
  The client keeps a cookie jar, so the first request of a fresh session was the one that degraded,
  and every request after it, including the immediate retry, returned the healthy document. Four
  live rounds produced one retry with a measured wait of 8.48 seconds, three playable streams on
  every round, and zero failures. The retry therefore covers exactly the cold-start case the user
  hit, and the randomized wait also gives the first response's cookies time to land.
- The repository already had two disjoint retry concepts. `douyin.stream.retrying` covers failing
  over between already-probed stream candidates, and it does not re-request anything. The share
  page gap was a separate, unretried step, so the new code needed its own code and its own message.
- `worker/tests/test_atomic_files.py` has two symlink tests that fail on this Windows host both
  before and after the change. A detached HEAD worktree reproduced the same two failures, so they
  are environmental and out of scope.

## Decision Log

- Decision: total attempts is three.
  Rationale: the observed degradation rate is roughly one in three, so two retries reduce the
  visible failure rate to a low single-digit percentage while keeping the worst-case added latency
  at roughly 20 seconds. `SHARE_PAGE_ATTEMPTS` is a module constant so the value stays easy to tune.
- Decision: the wait is `random.uniform(3.0, 10.0)` seconds drawn per wait.
  Rationale: the interval is randomized rather than fixed as requested, and a float draw avoids a
  predictable per-second rhythm across concurrent tasks.
- Decision: the progress event is emitted before the wait, not after.
  Rationale: the user's only other signal is the previously emitted `douyin.page.resolving`, so the
  retry event must land before the pause to keep the task from looking stalled.
- Decision: retries are classified by the closed code set rather than by catching all
  `DouyinFallbackError`.
  Rationale: `DOUYIN_NO_PLAYABLE_STREAM` and `DOUYIN_ID_PARSE_FAILED` are not transient, and
  retrying them would only delay an unavoidable failure.
- Decision: the randomized wait is a worker-internal detail and is not persisted or reported.
  Rationale: it carries no diagnostic value, and keeping it out preserves the existing privacy
  boundary between the worker and the account service.

## Outcomes & Retrospective

Delivered as specified. The share page step is now resilient to the observed transient variant, the
retry is visible in the UI, and every existing behavior outside the share page is unchanged.

Two follow-ups remain open and are not part of this plan. First, three attempts remains a judgment
call under a randomized server-side variant; if field reports continue, the constant is the single
place to raise. Second, the share page parse path still has no diagnostic event, so repeated
retries are invisible in exported diagnostics. That was intentionally left out to keep this change
inside the existing closed progress contract.

## Validation

- `uv run ruff check worker` passed.
- `uv run pytest worker/tests` reported 858 passed and 2 pre-existing `test_atomic_files.py`
  failures, both reproduced on a detached HEAD worktree.
- `npm --prefix app test` reported 76 files and 762 tests passed with exit code 0.
- `python scripts/validate_agents_docs.py --level ERROR` passed.
- Live network probe against the reported URL: four rounds, one recovered retry, measured wait
  8.48 seconds inside the 3 to 10 second range, three playable streams per round, zero failures.
