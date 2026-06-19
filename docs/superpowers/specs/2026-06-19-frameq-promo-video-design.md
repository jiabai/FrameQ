# FrameQ Promo Video Design

Date: 2026-06-19

## Summary

Create a 45-second FrameQ promotional video for 4:5 social/feed placement. The video should attract users who need to turn authorized public videos into reusable notes, transcripts, and topic ideas. It will use Chinese voiceover, synchronized Chinese captions, product-style motion graphics, and a clear call to action.

Approved creative route: "从视频到选题灵感".

## Goals

- Promote FrameQ through four core selling points:
  - 本地优先
  - 公开视频转写
  - 话题点生成
  - 轻量分发
- Make the value understandable within the first 6 seconds.
- Show enough product workflow to feel credible, not just decorative.
- Include Chinese spoken narration and large synchronized Chinese captions.
- Produce a Remotion composition that can be previewed and rendered to MP4.

## Non-Goals

- Do not present SenseVoice Small first-run download as a core marketing message.
- Do not imply FrameQ can process private, restricted, or unauthorized videos.
- Do not use Douyin/TikTok logos or protected brand assets in the video.
- Do not promise that cloud LLM usage is local; the local-first claim applies to default video/audio/transcript handling.
- Do not turn the video into a full tutorial or documentation walkthrough.

## Format

- Aspect ratio: 4:5
- Resolution: 1080 x 1350
- Duration: 45 seconds
- FPS: 30
- Language: Mandarin Chinese
- Output target: social/feed MP4

## Audience

Primary audience:

- Content creators
- Operators and marketers
- Researchers and knowledge workers
- People who collect, summarize, discuss, or repurpose public video content

The video should feel useful and trustworthy rather than hype-heavy. The first impression should be: "This can save me from manually replaying and organizing videos."

## Narrative Timeline

| Time | Scene | Voiceover | Visual Direction |
| --- | --- | --- | --- |
| 0-6s | Pain hook | 刷到一条有价值的视频，却没时间反复听、手动整理？ | Fast-moving generic video cards and scattered text fragments. Stop on one public video link. |
| 6-15s | FrameQ appears | 把链接交给 FrameQ，它会把公开视频处理成可阅读、可复用的文字稿。 | Link enters a FrameQ desktop window. URL input, submit action, and workflow stages animate in. |
| 15-28s | Local-first value | 视频、音频和文字稿默认留在本机。本地优先，整理内容更安心。 | Local folder, transcript document, and subtle lock/local device indicators. Keep the claim precise. |
| 28-38s | Topic ideas | 不止转文字，它还能从文字稿里提炼启发话题点，帮你快速找到下一篇内容、下一场讨论、下一个思考角度。 | Transcript lines transform into 3-4 question cards. Highlight useful keywords and open-ended questions. |
| 38-45s | CTA | FrameQ，把公开视频变成文字稿和灵感入口。安装轻，启动快，开始整理你的第一条视频。 | Product name, four selling-point tags, clean CTA end card. |

## Voiceover Script

```text
刷到一条有价值的视频，却没时间反复听、手动整理？

把链接交给 FrameQ，它会把公开视频处理成可阅读、可复用的文字稿。

视频、音频和文字稿默认留在本机。本地优先，整理内容更安心。

不止转文字，它还能从文字稿里提炼启发话题点，帮你快速找到下一篇内容、下一场讨论、下一个思考角度。

FrameQ，把公开视频变成文字稿和灵感入口。安装轻，启动快，开始整理你的第一条视频。
```

## Caption System

- Captions should be large enough for mobile feed viewing.
- Each subtitle line should stay within the safe center area and avoid lower-edge clipping.
- Highlight keywords with accent colors:
  - 本地优先
  - 文字稿
  - 启发话题点
  - 轻量分发
- Captions should follow voiceover timing rather than appearing as static paragraphs.

## Visual Style

- Overall tone: polished, clean, product-led, trustworthy.
- Backgrounds: light neutral surfaces with restrained depth.
- Accent colors:
  - Cyan/blue for video-to-text workflow
  - Green for local-first confidence
  - Orange for topic inspiration and CTA
- Avoid large decorative gradients, generic AI sci-fi visuals, and excessive glow.
- Use animated product UI mockups instead of real platform logos.
- Use 8px or smaller card radius for product UI mockups unless the simulated mobile/feed frame needs rounded device corners.

## Motion Design

- First 6 seconds: quick cuts, kinetic text, and converging fragments.
- Middle: smoother product-flow animation, with stage progress and document transformation.
- Topic section: transcript lines lift into question cards, creating a clear "text becomes ideas" moment.
- End card: brief hold for brand recall and CTA.

Motion should support clarity. Avoid continuous background movement that competes with captions.

## Remotion Architecture

Implementation location:

- Create the Remotion project under `promo/frameq-promo-video/`.
- Keep the promotional video code separate from the Tauri app in `app/`.
- Store generated render outputs under `promo/frameq-promo-video/out/`, which should be ignored if it contains large generated MP4 files.

Composition:

- `FrameQPromo`
- 1080 x 1350
- 45 seconds at 30fps

Suggested component structure:

- `FrameQPromo.tsx`: top-level composition and scene sequencing.
- `scenes/PainHook.tsx`: public video cards, scattered notes, hook caption.
- `scenes/WorkflowIntro.tsx`: FrameQ window, URL input, workflow stages.
- `scenes/LocalFirst.tsx`: local file/transcript metaphor and local-first message.
- `scenes/TopicIdeas.tsx`: transcript-to-topic-card transformation.
- `scenes/EndCard.tsx`: FrameQ product name, core tags, CTA.
- `components/CaptionTrack.tsx`: timed Chinese captions with keyword highlights.
- `components/ProductWindow.tsx`: reusable FrameQ desktop window mockup.
- `components/ProgressStages.tsx`: video extraction, transcription, topic generation stages.
- `components/TopicCard.tsx`: animated question cards.

Audio:

- Include a Mandarin Chinese voiceover asset synchronized to the 45-second timeline.
- Preferred source: generate the voiceover from a local installed Mandarin Windows speech voice when available.
- If local Mandarin speech is unavailable and generated TTS requires a provider, keep credentials outside the repository and document the command used.
- The Remotion composition should still preview without crashing if the voiceover asset is temporarily absent, but final render must include audio.

## Content Boundaries

- Mention "公开视频" rather than implying universal video access.
- Marketing copy must not encourage bypassing platform restrictions.
- The local-first message must be worded as default behavior for video, audio, and transcript files.
- If cloud LLM usage appears visually, it must not be framed as local-only. This first promotional video should keep the LLM detail out of the main story.

## Verification

Before considering implementation complete:

- Remotion preview starts successfully.
- A still frame check confirms the composition is nonblank at key frames:
  - 1s hook
  - 10s product workflow
  - 20s local-first
  - 33s topic ideas
  - 42s CTA
- Captions do not overlap product UI or leave the visible frame.
- The final MP4 render includes Chinese voiceover audio.
- Video duration is exactly 45 seconds or within one frame of 45 seconds.
- The end card clearly shows FrameQ and the four selling-point tags.

## Approved Decisions

- Format: 4:5 information-feed video.
- Duration: 45 seconds.
- Creative route: "从视频到选题灵感".
- Core selling points: 本地优先、公开视频转写、话题点生成、轻量分发.
- SenseVoice Small first-run download is not a primary marketing message.
