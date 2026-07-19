# Worker Atomic Artifact Commit

- Date: 2026-07-19
- Status: Implemented
- Related plan: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`

## Context

`MediaPreparationFacade` currently copies a validated download directly to the official task video
path and asks FFmpeg to write directly to the official WAV path. `TaskStoreFacade` writes
`frameq-task.json` and the preference snapshot directly and discovers artifacts through file
existence. A disk, decoder, permission, or process failure can therefore leave a truncated file at a
name that the task lifecycle treats as authoritative.

The local-media specification already requires partial media to remain unregistered until
validation. The same invariant is required for the current URL flow before contract v4 adds more
media producers.

## Decision

Introduce one small worker-owned atomic-file module with two responsibilities:

1. stage an externally produced or copied file beside its destination, preserve the destination
   suffix for media tools, flush the completed staging file, and install it with `os.replace`; and
2. serialize and atomically write UTF-8 text through the same-directory staging/replace sequence.

Media preparation follows this sequence for each official artifact:

```text
produce task-local staging file
-> flush/fsync staging bytes
-> ffprobe staging file
-> validate required streams, duration, and nonzero size
-> os.replace staging file into the official task path
```

The video and audio files are independent per-file commits, not a simulated multi-file transaction.
A failure preparing audio may leave an already validated video available, but it must never install
or register a partial WAV. Existing valid official files remain untouched until their replacement is
ready.

`TaskStoreFacade` serializes the complete manifest or preference snapshot before opening a staging
file, flushes and syncs it, and atomically replaces the destination. A failed update therefore keeps
the previous JSON intact; a failed first write leaves no authoritative JSON file. The manifest is
the final commit record for the task result.

Artifact registration accepts only committed ordinary files at known official paths. Staging names
are unique, hidden, task-local, and outside the artifact allowlist. Cleanup is best effort; a
leftover staging file is never promoted by existence scanning.

## Failure and Privacy Semantics

- Copy, staging, sync, validation, and replace failures become fixed `MediaPreparationError` codes
  and safe messages. Raw `OSError`, FFmpeg, ffprobe, source URL, and local path text do not enter the
  public result.
- Staging files are removed on every handled failure. Cleanup failure does not replace the primary
  error and does not make the file authoritative.
- `os.replace` always uses paths in the same directory. All Python file handles are closed before
  replacement so Windows can apply its normal replacement semantics.
- A successful replace is atomic visibility, while `fsync` of the staging file provides byte
  durability before installation. Parent-directory sync is attempted only where the platform
  supports opening and syncing directories.
- Cancellation and failed tasks may retain already committed artifacts under existing product
  behavior, but partial staging files are never returned or registered.

## Scope

This change hardens the current URL `MediaPreparationFacade`, task manifest, and preference snapshot.
It does not add local source variants, contract v4, new progress codes, transcript/AI artifact
transactions, a cleanup daemon, or a cross-file transaction protocol.

## Verification

- RED/GREEN tests cover copy, FFmpeg, validation, sync/replace, cleanup, and existing-file
  preservation failures.
- Manifest and preference-snapshot tests prove a failed replacement keeps the previous valid JSON.
- Artifact tests prove staging files and non-ordinary official paths are not registered.
- The focused and complete worker suites, Ruff, governance validation, and `git diff --check` are
  required before handoff.
