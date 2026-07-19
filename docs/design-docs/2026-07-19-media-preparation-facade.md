# Media Preparation Facade

- Date: 2026-07-19
- Status: Accepted and implemented for the current URL source
- Related plan: `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`

## Context

`run_worker_pipeline` previously coordinated URL download and platform fallbacks, downloaded-file
selection, ffprobe validation, task-owned video copying, FFmpeg audio extraction/reuse, subtitle
discovery, progress emission, and task finalization directly. Adding local video and audio at that
layer would make the pipeline understand every source-specific media subsystem and duplicate failure
policy.

## Decision

`worker/frameq_worker/media_preparation.py` is the single media-preparation facade. The current
closed input is `UrlMediaSource`; local variants are added only together with desktop-worker contract
v4 and the real local-media CLI consumer.

The facade returns:

```python
PreparedMedia(
    video_path: Path | None,
    audio_path: Path,
    subtitle_candidate: SubtitleTranscript | None,
)
```

The subtitle candidate is already parsed rather than exposing a cache path. This prevents the
pipeline from rescanning the download directory or depending on subtitle-file naming and parsing.
Local video and audio variants will always return `subtitle_candidate=None` under the approved local
media specification.

For URL sources, the facade owns:

- URL download and existing platform fallback dispatch;
- downloaded-file selection and stream validation;
- copying the validated video into the task media directory;
- extracting or reusing the official task audio artifact;
- subtitle discovery and parsing; and
- media-preparation progress plus typed, sanitized preparation failures.

Official task video and WAV files are installed through the atomic artifact-commit boundary in
`docs/design-docs/2026-07-19-worker-atomic-artifact-commit.md`. The facade writes media-tool-compatible
same-directory staging files, validates them before replacement, and returns only committed paths.
Raw filesystem and media-tool failures remain chained causes behind fixed safe preparation errors.

`run_worker_pipeline` owns the application flow around the facade. It creates and finalizes the task
through `TaskStoreFacade`, writes a prepared subtitle as the official transcript or invokes ASR with
`PreparedMedia.audio_path`, and completes the task result. The media facade must not import ASR,
InsightFlow, AI clients, or `TaskStoreFacade`, and it must not write a task manifest.

## Future Local Sources

Contract v4 will add real `LocalVideoSource` and `LocalAudioSource` variants atomically with their
parser and CLI consumer. Their implementation must preserve the approved rules:

- local video returns a task-owned generic video artifact plus normalized WAV;
- local audio returns `video_path=None` plus normalized WAV;
- both local variants ignore subtitles;
- the complete local path never enters argv, progress, result, error, log, manifest, prompt, or UI;
- partial artifacts are validated before manifest registration.

No unused local source variant is reserved by this refactor. This keeps the facade exhaustive and
testable while contract v3 remains the only production process request.

## Consequences

- The pipeline no longer imports or directly calls download, probe, audio-extraction, or video-copy
  primitives.
- Existing URL artifacts, progress codes, subtitle-first behavior, failure mapping, ASR behavior,
  task manifests, and result DTOs remain unchanged.
- An interrupted copy or audio extraction cannot make a partial official media path visible or
  registerable; a previous valid official artifact remains intact until replacement commits.
- Media preparation can evolve by source without absorbing transcription, AI, or persistence.
- `PreparedMedia.video_path` is optional now so the output contract already tells downstream code
  that audio-only tasks own no video; the local input variants themselves remain deferred to v4.

## Verification

- Facade tests prove task-owned video/audio preparation, progress-stage preservation, absence of
  manifest writes, and the pipeline import boundary.
- Scope tests reject ASR, InsightFlow, and task-persistence ownership in the facade module.
- The full worker suite passes with existing URL and subtitle behavior unchanged.
