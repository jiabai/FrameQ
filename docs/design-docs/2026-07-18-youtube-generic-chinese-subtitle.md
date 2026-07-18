# ADR-2026-07-18: Exact generic Chinese subtitle support

## Status

Accepted for implementation on 2026-07-18.

## Context

YouTube video `dGzm8O95tdc` exposes an original platform subtitle with language code `zh` and VTT/SRT
formats. FrameQ currently requests only `zh-Hans,zh-CN,zh-Hant,en,ja,ko`, so an `yt-dlp --simulate`
using the production arguments selects no subtitle and the pipeline unnecessarily falls back to
local ASR.

The parser uses the same script-specific language list when ordering downloaded subtitle files.
Adding download support without adding parser priority would work only through the generic unknown
language fallback and would leave the policy duplicated inconsistently.

## Decision

Add exact `zh` to both closed lists:

```text
zh-Hans,zh-CN,zh-Hant,zh,en,ja,ko
```

The order preserves explicit Simplified/Traditional choices before generic Chinese and keeps all
Chinese captions before English, Japanese, and Korean.

Do not use `zh.*`. On the confirmed video, that expression selects the original `zh` track plus
YouTube-generated `zh-Hans-zh` and `zh-Hant-zh` translations. Exact `zh` selects one original VTT
track and avoids duplicate downloads or translated-caption ambiguity.

## Consequences

- Public YouTube/Bilibili videos whose usable Chinese caption is labeled only `zh` can skip local
  ASR and record `Platform subtitle` as the transcript source.
- Existing script-specific, English, Japanese, Korean, malformed-subtitle, and no-subtitle fallback
  behavior is unchanged.
- A future expansion to translated captions requires a separate product decision; it must not enter
  through a regex side effect.

## Verification

- Unit tests require exact `zh` in the `yt-dlp` request string.
- Parser tests require `.zh.vtt` support and script-specific-over-generic priority.
- The existing invalid/empty subtitle test continues to prove local-ASR fallback eligibility.
- A no-download `yt-dlp --simulate` against `dGzm8O95tdc` must report `zh` with selected format `vtt`.

## References

- `docs/product-specs/2026-06-16-douyin-video-transcription-client.md`
- `docs/exec-plans/active/2026-07-18-youtube-generic-chinese-subtitle-plan.md`
- `worker/frameq_worker/media.py`
- `worker/frameq_worker/subtitles.py`
