# YouTube Rejection Reason Codes Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision
> Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Split HTTP 403 and HTTP 429 out of the generic `YOUTUBE_DOWNLOAD_FAILED` bucket so each
reaches the user with an accurate reason code and copy that names the real cause.

**Architecture:** `worker/frameq_worker/media.py` owns the classification. Two branches are added
to `classify_youtube_download_failure`, producing `YOUTUBE_RATE_LIMITED` for HTTP 429 and
`YOUTUBE_STREAM_FORBIDDEN` for a 403 that carries no more specific marker. The existing single
retry now covers both `YOUTUBE_DOWNLOAD_FAILED` and `YOUTUBE_STREAM_FORBIDDEN`, while
`YOUTUBE_RATE_LIMITED` returns immediately. The reason code set in
`app/src/safeTechnicalDetails.ts`, the message map in `app/src/workerErrorCopy.ts`, and the three
localized `errorResources.ts` blocks are extended in parallel.

**Languages and tools:** Python 3 with pytest and Ruff, TypeScript with Vitest and i18next.

---

## Purpose / Big Picture

On 2026-09-19 a YouTube player change made the bundled `yt-dlp 2026.7.4` receive expired media
URLs, and every download failed with `HTTP Error 403: Forbidden` on a healthy connection. The user
saw "The public YouTube video could not be downloaded. Check your connection and try again," which
points at the one component that was working.

The v0.3.8 release corrected the root cause by moving the lockfile to `yt-dlp 2026.8.19` and left
this classification gap as tracked debt. The gap survives an up-to-date extractor: regional blocks,
account risk checks, and CDN rejections still return 403, and 429 still returns for ordinary rate
limiting, including the subtitle request that the v0.3.8 verification log recorded.

After this change a 403 whose stderr carries no other recognizable marker reports
`YOUTUBE_STREAM_FORBIDDEN` with copy about a rejected or expired stream, and a 429 reports
`YOUTUBE_RATE_LIMITED` with copy that asks for a later retry.

## Progress

- [x] 2026-10-20: Added the 429 and 403 branches to `classify_youtube_download_failure` and extended
  the retry predicate to cover `YOUTUBE_STREAM_FORBIDDEN`.
- [x] 2026-10-20: Extended the TypeScript reason code set, the message map, and the three locales.
- [x] 2026-10-20: Added worker and frontend cases, including two ordering guards: a 429 that carries
  cookie advice stays `YOUTUBE_RATE_LIMITED`, and a risk-check 403 that carries a sign-in marker
  stays `YOUTUBE_LOGIN_REQUIRED`.
- [x] 2026-10-20: Ran Ruff, worker pytest, app tests, app lint, and the docs governance gate.
- [x] 2026-10-20: Moved the debt entry to resolved and recorded the `yt-dlp` version check.

## Surprises & Discoveries

- The upstream stable `yt-dlp` on PyPI is `2026.8.19`, the exact version already in `uv.lock`.
  There is nothing to upgrade as of 2026-10-20, so the stale-pin debt stays a notification problem
  rather than a version problem.
- The existing retry test uses a 403 as its transient-failure sample, which confirms that a single
  retry after a media-stream rejection is deliberate behavior. A 403 can arise from a direct link
  expiring between the format resolution and the media fetch, so the retry path is kept.

## Decision Log

- **429 is classified before the login branch.** `yt-dlp` appends cookie advice to a 429 failure,
  and the login branch matches `cookie`. Classifying 429 after that branch would report a rate limit
  as a sign-in requirement and send the user toward a public-link remedy that cannot help.
- **403 is classified after the private/unavailable branch.** A YouTube risk-check 403 usually reads
  `Sign in to confirm you're not a bot`, which the login branch already covers with accurate copy.
  Only a 403 without a more specific marker reaches the new code.
- **403 keeps one retry, 429 does not.** A rejected media fetch can be a direct link that expired
  between format resolution and download, and a second run resolves a fresh link. A 429 is an active
  rate limit, and an immediate retry deepens it.
- **No product spec section.** The product intent is unchanged: a failed download still reports a
  failed download. This change corrects which reason code a failure carries, which is the debt the
  v0.3.8 spec deferred in writing.

## Outcomes & Retrospective

Both codes are reachable from real `yt-dlp` stderr text and from the retry path. The generic bucket
now only receives failures that match no known marker, so its copy is accurate again. Ordering
guards make the two precedence decisions explicit in tests.

Validation: worker `test_media.py` 34 passed, worker full suite 857 passed with two environment-bound
symbolic-link failures in `test_atomic_files.py` that predate this change, app `workerErrorCopy`
63 passed, app full suite 767 of 768 with one known timing-sensitive failure in
`tests/app-input.browser.test.ts` that passes on its own, Ruff clean, app lint clean, docs governance
0 errors and 0 warnings.
