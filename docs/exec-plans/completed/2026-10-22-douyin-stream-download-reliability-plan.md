# Douyin Stream Download Reliability Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision
> Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Stop the Douyin fallback stream download from presenting as a frozen task: stream
chunks to disk, enforce a no-progress budget, resume a stalled candidate from its byte offset,
and let the processing UI advance while bytes arrive.

**Architecture:** `worker/frameq_worker/download_reliability.py` gains an end-of-stream
completeness check (`DOWNLOAD_INCOMPLETE`) and keeps the `.part` file for stall and incomplete
outcomes. `worker/frameq_worker/douyin/transport.py` replaces the in-memory
`write_http_response_atomically` path with `write_http_stream_atomically`, adds a
`download_to_path` client method with a `Range` resume header, and reworks
`download_ordered_candidates` to give each candidate one original attempt plus one resume retry
before switching. `worker/frameq_worker/douyin_fallback.py` forwards a downloaded-bytes callback
and `worker/frameq_worker/media.py` maps it onto the existing `douyin.video.saving` progress
event with an in-stage dynamic percentage.

**Languages and tools:** Python 3 with pytest and Ruff. No frontend or Rust changes are required
by this plan.

---

## Purpose / Big Picture

On 2026-10-22 a v0.4.1 desktop user submitted a Douyin share link and the UI sat on
"Extracting Video" for 13 minutes. Diagnosis with py-spy, netstat, and process IO counters showed
the worker process blocked inside `UrllibDouyinHttpClient.get` on `response.read()` for the first
candidate stream, reconnecting from zero after each mid-stream cut, and finally reading about
596 MB for a 75 MB video. The task did complete, but with zero feedback during the download.

Three defects combine into that experience:

1. The Douyin fallback is the only media path still using the whole-body
   `write_http_response_atomically` flow. Xiaohongshu and Bilibili already stream to disk.
2. A cut stream either raises `IncompleteRead` (discarding all received bytes and restarting the
   candidate from zero) or hangs inside a single `recv` when the CDN or the local proxy keeps the
   TCP connection established without delivering data. The 30-second socket timeout does not fire
   in the hanging case.
3. The download stage emits no byte-level progress, so the UI cannot distinguish a slow download
   from a dead one.

After this change a stalled transfer is abandoned after 60 seconds without new bytes, retried
once from its byte offset via the CDN's byte-range support, and then handed to the next candidate.
The completeness check prevents a truncated response from being promoted as the final video file.
The UI advances through the existing progress channel while bytes arrive.

## Progress

- [x] 2026-10-22: Confirmed with live requests that `douyinvod.com` honors `Range` with correct
  `206` and `Content-Range` responses, and reproduced an `IncompleteRead` cut at 69.5 MB of a
  75.4 MB transfer with the existing whole-body read path.
- [x] 2026-10-22: Extended `write_http_stream_atomically` with the completeness check and the
  keep-part-on-stall behavior.
- [x] 2026-10-22: Rewrote the Douyin stream transport around `download_to_path` with resume and
  per-candidate retry.
- [x] 2026-10-22: Wired the byte progress callback into the existing `douyin.video.saving`
  progress event.
- [x] 2026-10-22: Updated worker tests for the new client surface.
- [x] 2026-10-22: Ran Ruff, worker pytest, and the docs governance gate.

## Surprises & Discoveries

- The first Range probe run itself hit an `http.client.IncompleteRead` after 69,540,712 bytes of
  a 75,395,272-byte response, with the connection cut roughly 4.8 MB short. The same probe on a
  freshly generated stream URL completed all 75,395,272 bytes. Mid-stream cuts are frequent
  enough to reproduce inside a single working session.
- Live requests confirmed `Accept-Ranges: bytes`, a correct `206` with
  `Content-Range: bytes 0-1023/75395272` for a bounded range, and a correct `206` for an open
  range starting at 1 MiB. The CDN supports resume; the worker simply never asked.
- The Rust watchdog was not touched. Its idle budget is refreshed by progress events, and the
  Python-side no-progress budget now bounds the worst case (three candidates, two attempts each,
  60 seconds per stall) to roughly six minutes before the existing failure path reports. Reworking
  watchdog budgets for a scenario the worker no longer produces would add supervision complexity
  without a reachable failure.

## Decision Log

- **Completeness is checked against the response, against the candidate size.** The share page
  declares `data_size` per candidate, but the transfer authority is the response's own
  `Content-Length` or `Content-Range` total. `write_http_stream_atomically` raises
  `DOWNLOAD_INCOMPLETE` when the stream ends before the declared total, regardless of which
  platform uses it.
- **Stall and incomplete outcomes keep the `.part` file; everything else deletes it.** A stalled
  or short transfer leaves valid bytes that the resume retry consumes. Validation failures such as
  a wrong status or content type leave nothing worth keeping.
- **One resume retry per candidate, then move on.** A second stall on the same candidate is
  strong evidence the CDN route is unhealthy; burning more attempts on it delays the fallback
  candidates. Switching candidates deletes the partial file because its bytes belong to the
  previous URL.
- **Byte progress rides the existing `douyin.video.saving` message code.** Adding a new message
  code or message arguments would extend the closed progress contract across the contract JSON,
  the Rust validator, the Python registry, and three locales. The processing UI already renders
  the in-stage `progress` number, so mapping received bytes onto that number delivers the visible
  feedback without touching the contract.
- **The `get`-based whole-body path is removed from the stream download.** Keeping both paths
  would leave the unreliable one as dead code that tests would exercise instead of the production
  path. Tests provide a client that implements `download_to_path`, the same shape the bilibili
  tests use.
- **`_without_range_header` is retired.** Candidate headers from the share page carry no `Range`
  header, and resume now constructs its own header explicitly, so the defensive strip has no
  remaining caller.

## Outcomes & Retrospective

Validation: Ruff clean; worker full suite 1021 passed and 2 skipped; docs governance gate 0
errors and 0 warnings. A real Douyin download through the new path completed a 75,395,272-byte
video in 4.7 seconds and emitted the expected event sequence
(`douyin.page.resolving` 22, `douyin.stream.probing` 26, `douyin.video.saving` 30, then the
byte-driven 31, 32, 33 steps).

The packaged-runtime acceptance ran against `app/src-tauri/target/release/resources` after
installing the `uv.lock` dependency set into the bundled interpreter (`yt-dlp 2026.10.21`,
`onnxruntime 1.28.0`). The worker produced a 75,395,272-byte `media/video.mp4`, byte-identical
to the source video, and reached `ASR_MODEL_NOT_READY` at `video_transcribing` only because the
harness does not configure a model directory; the download, stream validation, and audio
extraction stages all passed.

Shipped in v0.4.2 (https://github.com/jiabai/FrameQ/releases/tag/v0.4.2, tag target `950377c`,
Desktop Release run `39814037035` green on all three platform jobs).

Residual risk: the 60-second no-progress budget, the one-resume-per-candidate policy, and the
8 MB progress interval are reasoned defaults rather than field-calibrated values. The packaged
interpreter inside `app/src-tauri/resources/python` still carries stale dependencies until the
installer build reinstalls them, which is why the acceptance had to install the lock set first.
