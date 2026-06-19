# FrameQ Promo Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 45-second 4:5 Remotion promotional video for FrameQ with Chinese voiceover, synchronized captions, product-style motion graphics, and final MP4 render support.

**Architecture:** Create a standalone Remotion project under `promo/frameq-promo-video/` so promotional media work stays separate from the Tauri desktop app. Store the timeline, captions, scene ranges, and keywords in data files, render them through focused React scene components, and verify duration/caption coverage with a small Node validation script plus Remotion still checks.

**Tech Stack:** Remotion, React, TypeScript, Node.js, PowerShell Windows SAPI voice generation, local MP4 rendering via Remotion CLI.

---

## Scope Check

The approved spec describes one deliverable: a single promotional video project. It does not need to be split into multiple implementation plans. The output is testable on its own through data validation, Remotion preview, still-frame rendering, audio file generation, and final MP4 render.

## File Structure

- Create: `promo/frameq-promo-video/package.json` - project scripts and Remotion dependencies.
- Create: `promo/frameq-promo-video/README.md` - preview, voiceover, validation, and render instructions.
- Create: `promo/frameq-promo-video/src/index.ts` - Remotion entrypoint.
- Create: `promo/frameq-promo-video/src/Root.tsx` - composition registration.
- Create: `promo/frameq-promo-video/src/FrameQPromo.tsx` - top-level scene sequencing.
- Create: `promo/frameq-promo-video/src/promoData.json` - exact timeline, voiceover script, captions, keywords, and scene metadata.
- Create: `promo/frameq-promo-video/src/styles.ts` - shared visual tokens.
- Create: `promo/frameq-promo-video/src/components/CaptionTrack.tsx` - synchronized Chinese captions with keyword highlighting.
- Create: `promo/frameq-promo-video/src/components/ProductWindow.tsx` - reusable FrameQ desktop UI mockup.
- Create: `promo/frameq-promo-video/src/components/ProgressStages.tsx` - video extraction, transcription, and topic generation progress UI.
- Create: `promo/frameq-promo-video/src/components/TopicCard.tsx` - animated question cards.
- Create: `promo/frameq-promo-video/src/scenes/PainHook.tsx` - first 6-second hook.
- Create: `promo/frameq-promo-video/src/scenes/WorkflowIntro.tsx` - URL-to-workflow sequence.
- Create: `promo/frameq-promo-video/src/scenes/LocalFirst.tsx` - local-first scene.
- Create: `promo/frameq-promo-video/src/scenes/TopicIdeas.tsx` - transcript-to-topic-card scene.
- Create: `promo/frameq-promo-video/src/scenes/EndCard.tsx` - brand and CTA end card.
- Create: `promo/frameq-promo-video/scripts/validate-data.mjs` - deterministic timeline and caption validation.
- Create: `promo/frameq-promo-video/scripts/generate-voiceover.ps1` - Mandarin voiceover generation with Windows SAPI.
- Create: `promo/frameq-promo-video/public/.gitkeep` - keeps public asset folder in git.
- Modify: `.gitignore` - ignore generated Remotion render outputs.

## Task 1: Scaffold Standalone Remotion Project

**Files:**
- Create: `promo/frameq-promo-video/package.json`
- Create: `promo/frameq-promo-video/README.md`
- Create: `promo/frameq-promo-video/public/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Scaffold the Remotion project directory**

Run:

```powershell
New-Item -ItemType Directory -Force -Path promo\frameq-promo-video | Out-Null
Set-Location promo\frameq-promo-video
npx create-video@latest --yes --blank --no-tailwind .
```

Expected: a blank Remotion project is created under `promo/frameq-promo-video/`.

- [ ] **Step 2: Replace `package.json` with project-specific scripts**

Use this content:

```json
{
  "name": "frameq-promo-video",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "remotion studio src/index.ts",
    "typecheck": "tsc --noEmit",
    "validate:data": "node scripts/validate-data.mjs",
    "voiceover": "powershell -ExecutionPolicy Bypass -File scripts/generate-voiceover.ps1",
    "still:hook": "remotion still src/index.ts FrameQPromo --frame=30 --scale=0.25 out/still-hook.png",
    "still:workflow": "remotion still src/index.ts FrameQPromo --frame=300 --scale=0.25 out/still-workflow.png",
    "still:local": "remotion still src/index.ts FrameQPromo --frame=600 --scale=0.25 out/still-local.png",
    "still:topics": "remotion still src/index.ts FrameQPromo --frame=990 --scale=0.25 out/still-topics.png",
    "still:cta": "remotion still src/index.ts FrameQPromo --frame=1260 --scale=0.25 out/still-cta.png",
    "render": "remotion render src/index.ts FrameQPromo out/frameq-promo.mp4"
  },
  "dependencies": {
    "@remotion/cli": "latest",
    "remotion": "latest",
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "typescript": "latest"
  }
}
```

- [ ] **Step 3: Add generated output ignores**

Append these lines to `.gitignore`:

```gitignore
promo/**/out/
promo/**/public/voiceover.wav
```

- [ ] **Step 4: Add project README**

Create `promo/frameq-promo-video/README.md`:

```markdown
# FrameQ Promo Video

45-second 4:5 Remotion promotional video for FrameQ.

## Commands

```powershell
npm install
npm run validate:data
npm run voiceover
npm run dev
npm run still:hook
npm run still:workflow
npm run still:local
npm run still:topics
npm run still:cta
npm run render
```

The final render is written to `out/frameq-promo.mp4`.
The generated local voiceover is written to `public/voiceover.wav` and is intentionally ignored by git.
```

- [ ] **Step 5: Commit scaffold**

Run:

```powershell
git add .gitignore promo\frameq-promo-video\package.json promo\frameq-promo-video\README.md promo\frameq-promo-video\public\.gitkeep
git commit -m "chore: scaffold FrameQ promo video project"
```

Expected: commit succeeds.

## Task 2: Add Timeline Data and Deterministic Validation

**Files:**
- Create: `promo/frameq-promo-video/src/promoData.json`
- Create: `promo/frameq-promo-video/scripts/validate-data.mjs`

- [ ] **Step 1: Create a failing data validation script**

Create `scripts/validate-data.mjs`:

```javascript
import fs from "node:fs";
import path from "node:path";

const dataPath = path.join(process.cwd(), "src", "promoData.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("Missing src/promoData.json");
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const expected = {
  fps: 30,
  width: 1080,
  height: 1350,
  durationInFrames: 1350,
};

for (const [key, value] of Object.entries(expected)) {
  if (data.composition?.[key] !== value) {
    throw new Error(`composition.${key} must be ${value}`);
  }
}

if (!Array.isArray(data.scenes) || data.scenes.length !== 5) {
  throw new Error("Expected exactly 5 scenes");
}

if (!Array.isArray(data.captions) || data.captions.length !== 5) {
  throw new Error("Expected exactly 5 caption groups");
}

for (const scene of data.scenes) {
  if (scene.startFrame < 0 || scene.endFrame > expected.durationInFrames) {
    throw new Error(`Scene ${scene.id} is outside composition bounds`);
  }
  if (scene.endFrame <= scene.startFrame) {
    throw new Error(`Scene ${scene.id} has invalid frame range`);
  }
}

for (let index = 1; index < data.scenes.length; index += 1) {
  const previous = data.scenes[index - 1];
  const current = data.scenes[index];
  if (previous.endFrame !== current.startFrame) {
    throw new Error(`Scene ${previous.id} must end where ${current.id} starts`);
  }
}

if (data.scenes[0].startFrame !== 0) {
  throw new Error("First scene must start at frame 0");
}

if (data.scenes[data.scenes.length - 1].endFrame !== expected.durationInFrames) {
  throw new Error("Last scene must end at frame 1350");
}

const requiredKeywords = ["本地优先", "文字稿", "启发话题点", "轻量分发"];
for (const keyword of requiredKeywords) {
  if (!data.keywords.includes(keyword)) {
    throw new Error(`Missing keyword: ${keyword}`);
  }
}

console.log("promo data ok");
```

- [ ] **Step 2: Run validation to verify it fails**

Run:

```powershell
npm run validate:data
```

Expected: FAIL with `Missing src/promoData.json`.

- [ ] **Step 3: Add timeline and script data**

Create `src/promoData.json`:

```json
{
  "composition": {
    "id": "FrameQPromo",
    "fps": 30,
    "width": 1080,
    "height": 1350,
    "durationInFrames": 1350
  },
  "keywords": ["本地优先", "文字稿", "启发话题点", "轻量分发"],
  "voiceover": [
    "刷到一条有价值的视频，却没时间反复听、手动整理？",
    "把链接交给 FrameQ，它会把公开视频处理成可阅读、可复用的文字稿。",
    "视频、音频和文字稿默认留在本机。本地优先，整理内容更安心。",
    "不止转文字，它还能从文字稿里提炼启发话题点，帮你快速找到下一篇内容、下一场讨论、下一个思考角度。",
    "FrameQ，把公开视频变成文字稿和灵感入口。安装轻，启动快，开始整理你的第一条视频。"
  ],
  "scenes": [
    { "id": "pain-hook", "label": "痛点钩子", "startFrame": 0, "endFrame": 180 },
    { "id": "workflow-intro", "label": "FrameQ 出场", "startFrame": 180, "endFrame": 450 },
    { "id": "local-first", "label": "本地优先", "startFrame": 450, "endFrame": 840 },
    { "id": "topic-ideas", "label": "话题点生成", "startFrame": 840, "endFrame": 1140 },
    { "id": "end-card", "label": "轻 CTA", "startFrame": 1140, "endFrame": 1350 }
  ],
  "captions": [
    {
      "startFrame": 0,
      "endFrame": 180,
      "text": "刷到一条有价值的视频，却没时间反复听、手动整理？",
      "highlight": "手动整理"
    },
    {
      "startFrame": 180,
      "endFrame": 450,
      "text": "把链接交给 FrameQ，它会把公开视频处理成可阅读、可复用的文字稿。",
      "highlight": "文字稿"
    },
    {
      "startFrame": 450,
      "endFrame": 840,
      "text": "视频、音频和文字稿默认留在本机。本地优先，整理内容更安心。",
      "highlight": "本地优先"
    },
    {
      "startFrame": 840,
      "endFrame": 1140,
      "text": "不止转文字，它还能从文字稿里提炼启发话题点，帮你快速找到下一篇内容、下一场讨论、下一个思考角度。",
      "highlight": "启发话题点"
    },
    {
      "startFrame": 1140,
      "endFrame": 1350,
      "text": "FrameQ，把公开视频变成文字稿和灵感入口。安装轻，启动快，开始整理你的第一条视频。",
      "highlight": "轻"
    }
  ],
  "topicCards": [
    "这个视频可以延展成哪篇选题？",
    "观众最容易被哪个观点打动？",
    "下一场讨论可以从哪里开始？"
  ]
}
```

- [ ] **Step 4: Run validation to verify it passes**

Run:

```powershell
npm run validate:data
```

Expected: PASS and prints `promo data ok`.

- [ ] **Step 5: Commit data validation**

Run:

```powershell
git add promo\frameq-promo-video\src\promoData.json promo\frameq-promo-video\scripts\validate-data.mjs
git commit -m "test: validate promo video timeline data"
```

Expected: commit succeeds.

## Task 3: Generate Chinese Voiceover Asset

**Files:**
- Create: `promo/frameq-promo-video/scripts/generate-voiceover.ps1`
- Generated ignored file: `promo/frameq-promo-video/public/voiceover.wav`

- [ ] **Step 1: Add Windows SAPI voiceover script**

Create `scripts/generate-voiceover.ps1`:

```powershell
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Speech

$projectRoot = Split-Path -Parent $PSScriptRoot
$dataPath = Join-Path $projectRoot "src\promoData.json"
$publicDir = Join-Path $projectRoot "public"
$outputPath = Join-Path $publicDir "voiceover.wav"

New-Item -ItemType Directory -Force -Path $publicDir | Out-Null

$data = Get-Content -Raw -Encoding UTF8 $dataPath | ConvertFrom-Json
$script = ($data.voiceover -join "`n`n")

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }
$mandarinVoice = $voices |
  Where-Object {
    $_.Culture.Name -match "^zh" -or
    $_.Name -match "Huihui|Yaoyao|Kangkang|Xiaoxiao|Yunxi|Yunyang|Xiaochen|Xiaoyi|Chinese|Mandarin"
  } |
  Select-Object -First 1

if ($mandarinVoice) {
  $synth.SelectVoice($mandarinVoice.Name)
  Write-Host "Using voice: $($mandarinVoice.Name)"
} else {
  Write-Warning "No Mandarin Windows voice found. Using default installed voice."
}

$synth.Rate = 1
$synth.Volume = 100
$synth.SetOutputToWaveFile($outputPath)
$synth.Speak($script)
$synth.SetOutputToDefaultAudioDevice()
$synth.Dispose()

$file = Get-Item $outputPath
if ($file.Length -lt 1024) {
  throw "Generated voiceover is unexpectedly small: $($file.Length) bytes"
}

Write-Host "Voiceover written to $outputPath"
```

- [ ] **Step 2: Generate the voiceover**

Run:

```powershell
npm run voiceover
```

Expected: PASS and creates `public/voiceover.wav`. If the warning says no Mandarin voice was found, install a Mandarin Windows voice and rerun before final render.

- [ ] **Step 3: Verify generated file size**

Run:

```powershell
Get-Item promo\frameq-promo-video\public\voiceover.wav | Select-Object FullName, Length
```

Expected: `Length` is greater than `1024`.

- [ ] **Step 4: Commit voiceover script**

Run:

```powershell
git add promo\frameq-promo-video\scripts\generate-voiceover.ps1
git commit -m "feat: add promo voiceover generation script"
```

Expected: commit succeeds. Do not commit `public/voiceover.wav`.

## Task 4: Implement Composition Shell, Tokens, and Captions

**Files:**
- Create/Modify: `promo/frameq-promo-video/src/index.ts`
- Create/Modify: `promo/frameq-promo-video/src/Root.tsx`
- Create: `promo/frameq-promo-video/src/styles.ts`
- Create: `promo/frameq-promo-video/src/FrameQPromo.tsx`
- Create: `promo/frameq-promo-video/src/components/CaptionTrack.tsx`

- [ ] **Step 1: Register the Remotion root**

Create `src/index.ts`:

```typescript
import {registerRoot} from "remotion";
import {Root} from "./Root";

registerRoot(Root);
```

- [ ] **Step 2: Register the `FrameQPromo` composition**

Create `src/Root.tsx`:

```tsx
import {Composition} from "remotion";
import data from "./promoData.json";
import {FrameQPromo} from "./FrameQPromo";

export const Root = () => {
  return (
    <Composition
      id={data.composition.id}
      component={FrameQPromo}
      durationInFrames={data.composition.durationInFrames}
      fps={data.composition.fps}
      width={data.composition.width}
      height={data.composition.height}
    />
  );
};
```

- [ ] **Step 3: Add shared visual tokens**

Create `src/styles.ts`:

```typescript
export const colors = {
  ink: "#101827",
  muted: "#526071",
  panel: "#ffffff",
  panelSoft: "#f8fafc",
  line: "#d7dee8",
  blue: "#0ea5e9",
  blueSoft: "#e0f2fe",
  green: "#16a34a",
  greenSoft: "#dcfce7",
  orange: "#f97316",
  orangeSoft: "#ffedd5",
  bg: "#eef3f7",
};

export const fontFamily =
  'Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';

export const shadow = "0 30px 70px rgba(15, 23, 42, 0.16)";
```

- [ ] **Step 4: Add caption track**

Create `src/components/CaptionTrack.tsx`:

```tsx
import React from "react";
import {interpolate, useCurrentFrame} from "remotion";
import data from "../promoData.json";
import {colors, fontFamily} from "../styles";

type Caption = (typeof data.captions)[number];

const splitHighlight = (caption: Caption) => {
  const index = caption.text.indexOf(caption.highlight);
  if (index === -1) {
    return [caption.text, "", ""];
  }
  return [
    caption.text.slice(0, index),
    caption.highlight,
    caption.text.slice(index + caption.highlight.length),
  ];
};

export const CaptionTrack = () => {
  const frame = useCurrentFrame();
  const caption = data.captions.find(
    (item) => frame >= item.startFrame && frame < item.endFrame,
  );

  if (!caption) {
    return null;
  }

  const [before, highlighted, after] = splitHighlight(caption);
  const opacity = interpolate(
    frame,
    [caption.startFrame, caption.startFrame + 12, caption.endFrame - 10, caption.endFrame],
    [0, 1, 1, 0],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"},
  );

  return (
    <div
      style={{
        position: "absolute",
        left: 84,
        right: 84,
        bottom: 82,
        minHeight: 148,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        opacity,
        fontFamily,
        fontSize: 48,
        fontWeight: 850,
        lineHeight: 1.22,
        letterSpacing: 0,
        color: colors.ink,
        textWrap: "balance",
        textShadow: "0 2px 0 rgba(255,255,255,0.75)",
      }}
    >
      <span>
        {before}
        {highlighted ? <span style={{color: colors.orange}}>{highlighted}</span> : null}
        {after}
      </span>
    </div>
  );
};
```

- [ ] **Step 5: Add top-level shell with label-only scenes**

Create `src/FrameQPromo.tsx`:

```tsx
import React from "react";
import {AbsoluteFill, Audio, Sequence, staticFile} from "remotion";
import data from "./promoData.json";
import {CaptionTrack} from "./components/CaptionTrack";
import {colors, fontFamily} from "./styles";

const LabelScene = ({label}: {label: string}) => (
  <AbsoluteFill
    style={{
      alignItems: "center",
      justifyContent: "center",
      background: colors.bg,
      color: colors.ink,
      fontFamily,
      fontSize: 72,
      fontWeight: 900,
    }}
  >
    {label}
  </AbsoluteFill>
);

export const FrameQPromo = () => {
  return (
    <AbsoluteFill style={{background: colors.bg}}>
      {data.scenes.map((scene) => (
        <Sequence
          key={scene.id}
          from={scene.startFrame}
          durationInFrames={scene.endFrame - scene.startFrame}
        >
          <LabelScene label={scene.label} />
        </Sequence>
      ))}
      <Audio src={staticFile("voiceover.wav")} volume={1} />
      <CaptionTrack />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 6: Run validation and typecheck**

Run:

```powershell
npm run validate:data
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 7: Commit composition shell**

Run:

```powershell
git add promo\frameq-promo-video\src
git commit -m "feat: add promo composition shell"
```

Expected: commit succeeds.

## Task 5: Implement Product UI Components and Scenes

**Files:**
- Create: `promo/frameq-promo-video/src/components/ProductWindow.tsx`
- Create: `promo/frameq-promo-video/src/components/ProgressStages.tsx`
- Create: `promo/frameq-promo-video/src/components/TopicCard.tsx`
- Create: `promo/frameq-promo-video/src/scenes/PainHook.tsx`
- Create: `promo/frameq-promo-video/src/scenes/WorkflowIntro.tsx`
- Create: `promo/frameq-promo-video/src/scenes/LocalFirst.tsx`
- Create: `promo/frameq-promo-video/src/scenes/TopicIdeas.tsx`
- Create: `promo/frameq-promo-video/src/scenes/EndCard.tsx`
- Modify: `promo/frameq-promo-video/src/FrameQPromo.tsx`

- [ ] **Step 1: Add reusable product window**

Create `src/components/ProductWindow.tsx`:

```tsx
import React from "react";
import {colors, fontFamily, shadow} from "../styles";

export const ProductWindow = ({children}: {children: React.ReactNode}) => (
  <div
    style={{
      width: 850,
      border: `1px solid ${colors.line}`,
      borderRadius: 8,
      background: "rgba(255,255,255,0.96)",
      boxShadow: shadow,
      overflow: "hidden",
      fontFamily,
    }}
  >
    <div
      style={{
        height: 54,
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "0 20px",
        borderBottom: `1px solid ${colors.line}`,
        background: "#fbfdff",
      }}
    >
      <span style={{width: 12, height: 12, borderRadius: 999, background: "#ef4444"}} />
      <span style={{width: 12, height: 12, borderRadius: 999, background: "#f59e0b"}} />
      <span style={{width: 12, height: 12, borderRadius: 999, background: "#22c55e"}} />
      <strong style={{marginLeft: 12, color: colors.ink, fontSize: 20}}>FrameQ</strong>
    </div>
    <div style={{padding: 28}}>{children}</div>
  </div>
);
```

- [ ] **Step 2: Add progress stages**

Create `src/components/ProgressStages.tsx`:

```tsx
import React from "react";
import {interpolate, useCurrentFrame} from "remotion";
import {colors} from "../styles";

const stages = ["视频提取", "视频转译", "话题点生成"];

export const ProgressStages = ({startFrame = 0}: {startFrame?: number}) => {
  const frame = useCurrentFrame() - startFrame;
  return (
    <div style={{display: "grid", gap: 14}}>
      {stages.map((stage, index) => {
        const active = interpolate(frame, [index * 34, index * 34 + 18], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div key={stage} style={{display: "flex", alignItems: "center", gap: 14}}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                background: active > 0.95 ? colors.green : colors.blueSoft,
                border: `1px solid ${active > 0.95 ? colors.green : "#93c5fd"}`,
              }}
            />
            <div style={{flex: 1}}>
              <div style={{fontSize: 24, fontWeight: 800, color: colors.ink}}>{stage}</div>
              <div style={{height: 8, marginTop: 8, background: "#e5e7eb", borderRadius: 999}}>
                <div
                  style={{
                    width: `${Math.round(active * 100)}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: active > 0.95 ? colors.green : colors.blue,
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 3: Add topic card**

Create `src/components/TopicCard.tsx`:

```tsx
import React from "react";
import {colors, fontFamily} from "../styles";

export const TopicCard = ({text, index}: {text: string; index: number}) => (
  <div
    style={{
      width: 760,
      minHeight: 116,
      border: `1px solid ${colors.line}`,
      borderRadius: 8,
      background: index % 2 === 0 ? colors.orangeSoft : colors.blueSoft,
      padding: "24px 28px",
      fontFamily,
      fontSize: 32,
      fontWeight: 820,
      lineHeight: 1.3,
      color: colors.ink,
      boxShadow: "0 16px 36px rgba(15, 23, 42, 0.09)",
    }}
  >
    {text}
  </div>
);
```

- [ ] **Step 4: Add five scenes**

Create the scene files with these responsibilities:

```tsx
// src/scenes/PainHook.tsx
import React from "react";
import {AbsoluteFill, interpolate, useCurrentFrame} from "remotion";
import {colors, fontFamily} from "../styles";

export const PainHook = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 24, 120], [1.06, 1, 0.96], {extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{background: colors.bg, fontFamily, padding: 92}}>
      <div style={{fontSize: 84, fontWeight: 950, lineHeight: 1.04, color: colors.ink}}>
        好内容刷过去，
        <br />
        灵感也跟着散了？
      </div>
      <div style={{marginTop: 60, transform: `scale(${scale})`, transformOrigin: "left top"}}>
        {["公共视频链接", "语音片段", "评论观点", "选题灵感"].map((text, index) => (
          <div
            key={text}
            style={{
              marginTop: 18,
              width: 650 - index * 54,
              borderRadius: 8,
              background: index === 0 ? colors.blueSoft : "#fff",
              border: `1px solid ${colors.line}`,
              padding: "22px 26px",
              fontSize: 30,
              fontWeight: 800,
              color: colors.ink,
            }}
          >
            {text}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
```

```tsx
// src/scenes/WorkflowIntro.tsx
import React from "react";
import {AbsoluteFill} from "remotion";
import {ProductWindow} from "../components/ProductWindow";
import {ProgressStages} from "../components/ProgressStages";
import {colors, fontFamily} from "../styles";

export const WorkflowIntro = () => (
  <AbsoluteFill style={{alignItems: "center", justifyContent: "center", background: colors.bg, fontFamily}}>
    <ProductWindow>
      <div style={{fontSize: 30, fontWeight: 850, color: colors.ink, marginBottom: 18}}>
        粘贴视频链接
      </div>
      <div style={{border: `1px solid ${colors.line}`, borderRadius: 8, padding: "20px 22px", color: colors.muted, fontSize: 24}}>
        https://example.com/video/public-7524...
      </div>
      <div style={{marginTop: 28}}>
        <ProgressStages />
      </div>
    </ProductWindow>
  </AbsoluteFill>
);
```

```tsx
// src/scenes/LocalFirst.tsx
import React from "react";
import {AbsoluteFill} from "remotion";
import {colors, fontFamily} from "../styles";

export const LocalFirst = () => (
  <AbsoluteFill style={{background: colors.bg, fontFamily, padding: 92}}>
    <div style={{fontSize: 76, fontWeight: 950, lineHeight: 1.08, color: colors.ink}}>
      默认留在本机，
      <br />
      整理更安心。
    </div>
    <div style={{display: "grid", gap: 18, marginTop: 70}}>
      {["视频文件 .mp4", "转写音频 .wav", "完整文字稿 .md"].map((text) => (
        <div key={text} style={{width: 720, border: `1px solid ${colors.line}`, borderRadius: 8, background: "#fff", padding: "26px 30px", fontSize: 34, fontWeight: 850, color: colors.ink}}>
          {text}
        </div>
      ))}
    </div>
    <div style={{position: "absolute", right: 92, top: 450, width: 190, height: 190, borderRadius: 8, background: colors.greenSoft, border: `1px solid ${colors.green}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 88}}>
      ✓
    </div>
  </AbsoluteFill>
);
```

```tsx
// src/scenes/TopicIdeas.tsx
import React from "react";
import {AbsoluteFill} from "remotion";
import data from "../promoData.json";
import {TopicCard} from "../components/TopicCard";
import {colors, fontFamily} from "../styles";

export const TopicIdeas = () => (
  <AbsoluteFill style={{background: colors.bg, fontFamily, padding: 78, paddingTop: 96}}>
    <div style={{fontSize: 70, fontWeight: 950, color: colors.ink, lineHeight: 1.08}}>
      不止转文字，
      <br />
      还提炼话题点。
    </div>
    <div style={{display: "grid", gap: 18, marginTop: 56}}>
      {data.topicCards.map((text, index) => (
        <TopicCard key={text} text={text} index={index} />
      ))}
    </div>
  </AbsoluteFill>
);
```

```tsx
// src/scenes/EndCard.tsx
import React from "react";
import {AbsoluteFill} from "remotion";
import data from "../promoData.json";
import {colors, fontFamily} from "../styles";

export const EndCard = () => (
  <AbsoluteFill style={{background: "#ffffff", fontFamily, padding: 92, justifyContent: "center"}}>
    <div style={{fontSize: 102, fontWeight: 980, color: colors.ink, lineHeight: 1}}>FrameQ</div>
    <div style={{fontSize: 44, fontWeight: 850, color: colors.muted, marginTop: 24}}>
      把公开视频变成文字稿和灵感入口
    </div>
    <div style={{display: "flex", flexWrap: "wrap", gap: 16, marginTop: 58}}>
      {data.keywords.map((keyword) => (
        <div key={keyword} style={{border: `1px solid ${colors.line}`, borderRadius: 8, padding: "16px 20px", background: colors.panelSoft, fontSize: 30, fontWeight: 850, color: colors.ink}}>
          {keyword}
        </div>
      ))}
    </div>
  </AbsoluteFill>
);
```

- [ ] **Step 5: Wire final scenes into `FrameQPromo.tsx`**

Replace the label-only scene shell with the scene components:

```tsx
import React from "react";
import {AbsoluteFill, Audio, Sequence, staticFile} from "remotion";
import data from "./promoData.json";
import {CaptionTrack} from "./components/CaptionTrack";
import {PainHook} from "./scenes/PainHook";
import {WorkflowIntro} from "./scenes/WorkflowIntro";
import {LocalFirst} from "./scenes/LocalFirst";
import {TopicIdeas} from "./scenes/TopicIdeas";
import {EndCard} from "./scenes/EndCard";
import {colors} from "./styles";

const sceneMap = {
  "pain-hook": PainHook,
  "workflow-intro": WorkflowIntro,
  "local-first": LocalFirst,
  "topic-ideas": TopicIdeas,
  "end-card": EndCard,
};

export const FrameQPromo = () => {
  return (
    <AbsoluteFill style={{background: colors.bg}}>
      {data.scenes.map((scene) => {
        const Scene = sceneMap[scene.id as keyof typeof sceneMap];
        return (
          <Sequence
            key={scene.id}
            from={scene.startFrame}
            durationInFrames={scene.endFrame - scene.startFrame}
          >
            <Scene />
          </Sequence>
        );
      })}
      <Audio src={staticFile("voiceover.wav")} volume={1} />
      <CaptionTrack />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 6: Run validation and typecheck**

Run:

```powershell
npm run validate:data
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 7: Commit scenes**

Run:

```powershell
git add promo\frameq-promo-video\src
git commit -m "feat: build FrameQ promo video scenes"
```

Expected: commit succeeds.

## Task 6: Verify Still Frames and Render MP4

**Files:**
- Generated ignored files: `promo/frameq-promo-video/out/*.png`
- Generated ignored file: `promo/frameq-promo-video/out/frameq-promo.mp4`

- [ ] **Step 1: Run all validation gates**

Run:

```powershell
npm run validate:data
npm run typecheck
npm run voiceover
npm run still:hook
npm run still:workflow
npm run still:local
npm run still:topics
npm run still:cta
```

Expected:

- Data validation prints `promo data ok`.
- Typecheck passes.
- Voiceover generation writes `public/voiceover.wav`.
- Still images are created in `out/`.

- [ ] **Step 2: Inspect still images**

Open or inspect:

```text
promo/frameq-promo-video/out/still-hook.png
promo/frameq-promo-video/out/still-workflow.png
promo/frameq-promo-video/out/still-local.png
promo/frameq-promo-video/out/still-topics.png
promo/frameq-promo-video/out/still-cta.png
```

Expected:

- Each image is nonblank.
- Captions remain inside the visible frame.
- Captions do not cover essential product UI.
- CTA frame clearly shows `FrameQ` and all four selling-point tags.

- [ ] **Step 3: Render final MP4**

Run:

```powershell
npm run render
```

Expected: `out/frameq-promo.mp4` exists.

- [ ] **Step 4: Verify final duration and audio stream**

Run:

```powershell
ffprobe -v error -show_entries format=duration:stream=codec_type -of json promo\frameq-promo-video\out\frameq-promo.mp4
```

Expected:

- `format.duration` is approximately `45.0`.
- At least one stream has `"codec_type": "audio"`.
- At least one stream has `"codec_type": "video"`.

- [ ] **Step 5: Commit final source changes**

Run:

```powershell
git status --short
```

Expected: generated `out/` files and `public/voiceover.wav` are ignored. Commit any source-only final adjustments:

```powershell
git add promo\frameq-promo-video
git commit -m "feat: add FrameQ promo video render source"
```

Expected: commit succeeds.

## Task 7: Final Project Verification

**Files:**
- Read: `docs/superpowers/specs/2026-06-19-frameq-promo-video-design.md`
- Read: `promo/frameq-promo-video/README.md`

- [ ] **Step 1: Verify spec coverage**

Check the implementation against these approved decisions:

```text
Format: 4:5, 1080x1350
Duration: 45 seconds
Core selling points: 本地优先、公开视频转写、话题点生成、轻量分发
Creative route: 从视频到选题灵感
Chinese voiceover: included in final MP4
SenseVoice Small first-run download: not a primary marketing message
```

Expected: all decisions are reflected in source or rendered output.

- [ ] **Step 2: Run repository-level lightweight docs gate**

Run:

```powershell
python scripts\validate_agents_docs.py --level WARN
```

Expected: `验证完成: 0 个错误, 0 个警告`.

- [ ] **Step 3: Report final artifact**

Report these paths:

```text
promo/frameq-promo-video/out/frameq-promo.mp4
promo/frameq-promo-video/out/still-hook.png
promo/frameq-promo-video/out/still-workflow.png
promo/frameq-promo-video/out/still-local.png
promo/frameq-promo-video/out/still-topics.png
promo/frameq-promo-video/out/still-cta.png
```

Expected: the user can open the MP4 locally and review the final promotional video.

## Self-Review

- Spec coverage: covered by tasks for 4:5 format, 45-second duration, Chinese voiceover, captions, product UI scenes, local-first wording, topic cards, end-card selling tags, and render verification.
- Incomplete-marker scan: no open incomplete markers are present in this plan.
- Type consistency: composition ID is consistently `FrameQPromo`; data keys are consistently `composition`, `keywords`, `voiceover`, `scenes`, `captions`, and `topicCards`; scene IDs match the `sceneMap` keys.
