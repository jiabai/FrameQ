# Task Workspace Visual Hierarchy

## Status

Implemented and validated on 2026-07-12. The completed implementation record is
`docs/exec-plans/completed/2026-07-12-task-workspace-visual-hierarchy-plan.md`.

## Problem

The local transcript and AI workspaces have the correct product boundary, but their visual
hierarchy is flatter than their information hierarchy. The outer workspaces, audio player,
transcript segments, and AI target cards all use similar bordered rounded surfaces. The task
banner, workspace badges, and target badges repeat status information. English eyebrow labels
duplicate the Chinese workspace titles. Two saturated primary buttons make optional cloud AI
actions visually stronger than the local transcript work surface. Finally, the active transcript
segment uses the same strong halo expected from keyboard focus, making playback position look
like an error or focus state.

## Product Intent

FrameQ should feel like a restrained desktop production tool. The saved local transcript is the
primary work surface; optional cloud AI remains clearly available without dominating it. Visual
weight must follow task scope:

1. The task banner communicates task-level local processing state.
2. Workspace headers identify the local and AI domains.
3. AI target status belongs to each independently generated target.
4. Keyboard focus, transcript editing, and audio playback position remain visually distinct.

This work changes presentation only. It must not change task identity, processing, transcript
editing or saving, AI confirmation, quota, cancellation, history restore, SourceIdentity, or the
local/cloud privacy boundary.

## Approved Direction: Restrained Hierarchy Cleanup

### 1. Surface hierarchy

- Keep the bordered, rounded, quiet-shadow outer surfaces for `LocalTranscriptWorkspace` and
  `AiGenerationWorkspace`.
- Keep the audio review player as a compact independent control surface.
- Render transcript segments inside one quiet list boundary. Individual segments have no card
  background, radius, or outer border; adjacent rows use one divider. The textarea remains an
  explicit contained editor inside its row.
- Keep summary and inspiration as independently operable semantic articles, but group them inside
  one quiet list boundary. Individual targets use a transparent background, no independent radius
  or outer border, and one divider between targets.
- Do not introduce gradients, glass surfaces, decorative shadows, or motion beyond existing
  control-state feedback.

### 2. Status ownership

- Keep the full-width task banner as the authority for local processing, completion, and failure.
- Hide the local workspace `本地完成` badge when the task banner already communicates completion.
- Keep local processing and failure badges when they provide current, actionable information.
- Remove the AI workspace `可选` badge. Keep `等待文字稿` and `生成中` because they describe an
  active availability or execution constraint.
- Keep target-level `待生成`, `已生成`, `生成中`, `正在取消`, and `生成失败` states because summary
  and inspiration have independent lifecycles.

### 3. Workspace headings

- Remove the visible `Local transcript` and `Cloud AI` eyebrow labels.
- Keep `文字稿校对` / `本地转录` and `AI 整理` as the only primary workspace headings.
- Do not replace the eyebrow labels with decorative icons. Domain meaning remains explicit through
  the Chinese headings, privacy copy, content, and semantic color.

### 4. AI action hierarchy

- Pending summary and inspiration actions use a quiet secondary-blue button treatment instead of
  the saturated, elevated global primary-button treatment.
- The final confirmation action inside the summary or inspiration confirmation flow remains the
  primary action, because that is the explicit cloud-generation decision point.
- `查看结果` remains a standard secondary action.
- A failed target uses the same quiet secondary-blue action treatment as a pending target; its
  error state and message, rather than a louder button, communicate urgency.
- Button labels, accessible names, disabled rules, target selection, preference snapshot rules,
  and quota behavior remain unchanged.

### 5. Transcript playback, edit, and focus states

- Audio playback position uses a pale blue row background and a two-pixel inset blue left accent.
- Remove the active segment's three-pixel external halo.
- Preserve the existing strong `focus-visible` ring for keyboard focus.
- Editing uses a white editor surface and explicit border distinct from the quieter playback
  position state.
- Active playback, editing, keyboard focus, disabled state, and unsaved draft state must remain
  independently observable.

## Responsive and Accessibility Requirements

- Preserve the existing 62/38 desktop layout and the sub-1100px local-first stacked layout.
- No status may be communicated by color alone.
- Removing visible labels or badges must not remove semantic region labels or accessible status
  information.
- All existing keyboard controls, focus-visible treatment, button labels, and disabled reasons
  remain available.
- Reduced-motion behavior remains unchanged; this work does not add decorative animation.

## TDD and Acceptance

Implementation proceeds in the approved order: surface hierarchy, status ownership, workspace
headings, AI action hierarchy, then transcript states. Each item starts with a focused failing
test and records the expected RED evidence before production code changes.

Required automated coverage:

- Component/CSS tests prove transcript rows no longer use independent card surfaces while outer
  workspaces and the audio player retain their boundaries.
- Component tests prove redundant completed/optional workspace badges and English eyebrows are
  absent, while actionable and target-specific states remain.
- Component/CSS tests prove pending AI actions use the dedicated quiet action class and final
  confirmation remains primary.
- CSS/browser tests prove an active transcript segment has no focus halo and editing/focus-visible
  retain distinct styles.
- Existing browser smoke continues to verify desktop columns, narrow stacking, transcript editing,
  AI confirmation, history restoration, stale-callback protection, and cancellation placement.

Final validation must include `npm --prefix app test`, `npm --prefix app run build`, the relevant
serial Chromium smoke, `python scripts/validate_agents_docs.py --level WARN`, and
`git diff --check`.

## Out of Scope

- Workflow/controller, worker, Rust/Tauri, server, quota, payment, SourceIdentity, and persistence.
- New AI targets, new confirmation steps, new animation systems, or new design dependencies.
- Reworking settings, history, onboarding, or the command input surface.
