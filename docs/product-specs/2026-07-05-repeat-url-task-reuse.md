# Repeat URL Task Reuse

## Purpose

Submitting the same public video URL repeatedly should not download and
transcribe the same media again when FrameQ already has a usable local task for
that source.

## User Experience

- Users still paste the URL and use the same single-link workflow.
- If a previous completed or partial-completed task exists for the exact source
  URL and its transcript artifact still exists, FrameQ restores that task result
  immediately.
- Failed, cancelled, missing-artifact, corrupted, or different-model tasks are
  not reused; FrameQ starts a new processing run in those cases.
- Reuse is local-only. No server lookup, account login, cookie import, or remote
  media check is introduced.

## Acceptance

- Reusing an existing URL does not spawn the Python worker and does not run
  `yt-dlp` again.
- The restored result keeps the original task id, task folder, transcript,
  summary, insights, and manifest-relative artifacts.
- A broken old task manifest or deleted artifact must not block processing a new
  URL.
- Desktop diagnostics may record a cache-hit event with task id/status, but must
  keep the same log redaction rules as normal worker diagnostics.
