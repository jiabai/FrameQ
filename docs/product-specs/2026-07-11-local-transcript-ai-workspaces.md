# Local Transcript and AI Workspaces

## Product Decision

Task views omit the duplicate note title from the top navigation toolbar. The note title remains
in the workspace heading. AI Synthesis starts collapsed; its heading button expands or hides it
without changing task processing or saved content.

A FrameQ task keeps one `taskId` and one local artifact set, but its completed-task
experience is divided into two domain workspaces:

- `LocalTranscriptWorkspace` owns local download/transcode/ASR progress, video and audio
  file actions, audio review, transcript correction, save, copy, and export.
- `AiGenerationWorkspace` owns AI availability and quota explanations, separate
  summary and inspiration targets, confirmation, target-local progress, errors, retry, and
  result viewing.

Webpage notes use `ArticleWorkspace` for their saved local TXT/Markdown and share the existing
AI workspace. Their schema 4 source and component lifecycle are specified in
`2026-11-01-web-page-notes.md`; media keeps this specification's transcript behavior.

This is an information-architecture change, not a worker pipeline rewrite. It must not
change server entitlement/quota behavior, SourceIdentity, stdin transport, task storage,
or ProcessSupervisor internals.

## Strict Local/AI Command Separation

- `process_video` has no AI option or compatibility field. Its frontend request, Tauri IPC
  request, worker stdin JSON, and Python `ProcessRequest` contain no `generate_insights`.
- A Tauri IPC payload or worker process request that explicitly supplies
  `generate_insights` is invalid. It must fail with a fixed, non-echoing invalid-request
  response rather than accepting, normalizing, or silently ignoring the field.
- The process-video worker never constructs an LLM client, reads LLM checkout configuration,
  enters an AI progress stage, or writes summary, mindmap, insights, or preference artifacts.
  It completes immediately after the local transcript is finalized.
- `retryInsights({ taskId, target, outputLanguage, preferenceSnapshot? })` is the only
  AI-generation command. `outputLanguage` is the actual supported UI locale frozen at final
  confirmation. Only this command may
  receive server-managed checkout configuration, consume quota, construct an AI client, and
  invoke `run_insight_generation_step` for `summary` or `insights` after explicit confirmation.
- No legacy process-video AI branch, dual-format parser, compatibility field, or silent fallback
  is supported.

## Layout and Visual Hierarchy

- A submitted task shows necessary processing, cancellation, and failure feedback above the
  workspaces. The local-completion success banner is not rendered and reserves no layout
  space, including when reopening a completed history note. Transcript review and AI generation
  move up naturally. Title-generation recovery, partial-completion errors, and AI target
  progress/retry feedback remain available in their existing regions. Rendering this state
  never starts processing or an LLM call.
- The user approved the local webpage at `http://127.0.0.1:4181/` on 2026-10-31. Its source
  under ignored `build/ui-workspace-preview/` is the selected visual reference; demonstration
  data, localStorage, dialogs, and account placeholders are not production behavior.
- The final approved webpage uses one white workspace with a shared 54px title row. The left
  title is the real note display title, using the existing user-title/generated-title/history
  priority. The right title is AI Synthesis. Remove duplicate inner workspace titles.
- Header and body share two grid tracks with a flexible local pane and an AI pane whose initial
  width is `clamp(280px, 38%, 620px)`, bounded by both panes' responsive minimum widths.
  Manual sizing replaces the initial AI width with the user's preferred proportion.
  A fine vertical divider separates the columns; neither
  column has a surrounding rounded card. Keep zero column gap, left insets 16px 24px 0 and
  right insets 20px 24px; narrow insets use 16px. Narrow windows retain the two-column layout.
  The existing sidebar and branding are preserved.
- Use 14px semibold shared titles, 14px transcript text and AI feature names; 13px
  descriptions; and 12px timestamps, status, privacy, quota, and supporting copy. Transcript
  body line-height is 1.85. Dimensions use CSS pixels and follow system display scaling.
- Player, segment list, AI list, and feature icons have no nested content-frame border,
  background tile, or shadow. Thin separators and whitespace distinguish internal regions.
  Compact actions use 32px minimum height with visible keyboard focus.
- No gradient background, glass layer stack, decorative animation, ornamental 3D, or new
  visual-effects dependency is introduced. Motion is limited to hover, progress, and state
  transitions and respects reduced motion.

## Local Transcript Workspace

- The local region retains its localized accessible label. Its visible title appears once
  as the real note title in the shared row, with local save/processing state inside the region.
- Local processing progress contains only download/media preparation and transcription.
  AI generation is not presented as a third local step.
- The compact audio review bar precedes the video/audio file action row. Long paths are
  truncated and retain an accessible full label or title.
- File-location actions preserve Windows extended drive and UNC path semantics for default
  and migrated storage, including long paths; failures disclose neither raw native errors nor
  private paths and do not infer that a file is missing from a file-manager failure.
- Local status displays loading, saving, and unsaved changes when needed. A normally saved
  transcript omits the entire status row and its reserved space. The audio player has no
  surrounding card. Segment edit buttons appear
  on hover or keyboard focus and stay visible while editing. The existing controllers own all
  playback, file location, transcript mutation, save, copy, and export actions.
- `TranscriptReviewPanel` is extracted from the existing transcript detail implementation
  and rendered directly in the local workspace. Existing segment playback, direct editing,
  save, path validation, original backup, and stale-save protection are reused rather than
  copied.
- Transcript content scrolls inside its bounded region and the edit/save/copy/export footer
  stays accessible. At an inner scroll boundary, vertical wheel input continues to an available
  ancestor scroll region. Segment whitespace, body text, and time controls must allow native
  wheel input. Short/narrow layouts may shrink the transcript scroll region and provide local
  column overflow so notices and actions remain reachable. Video/audio stay compact actions.
- During AI generation, playback, scrolling, and local file location remain available, but
  transcript editing and save are disabled with the explanation `AI 正在使用已保存版本`.
- A usable transcript remains fully available in `partial_completed`; an AI failure is not
  rendered as a local transcript failure.

## AI Generation Workspace

- A fixed 30px panel-icon button sits at right:16px/top:12px of the shared title row,
  separate from native window controls. PanelRightClose hides the AI column and title;
  PanelRightOpen restores them. Local content fills the released width and the button's
  coordinates remain unchanged. Labels are localized Show/Hide AI Synthesis, with
  `aria-expanded` and `aria-controls` linked to the actual AI region.
- Keep both child workspaces mounted while hidden. Immediately apply `inert` and `aria-hidden`
  to AI content and its title, move AI focus to the toggle when necessary, and keep local edit,
  playback, active generation, results, and quota unchanged. Hiding is a view action only.
- Both header/body grids animate their second track to zero over 220ms using
  `cubic-bezier(.22,.61,.36,1)`. The AI title/content fade over 150ms and translate 10px to the
  right over 220ms, with delayed visibility hiding. Reverse from the current animated position
  on rapid input; use no timer-driven unmount or resetting transition state.
- `prefers-reduced-motion: reduce` switches immediately, including toggle/icon color feedback.

- The divider is adjustable through a transparent 12px hit area with a horizontal resize cursor.
  Pointer dragging adjusts both title/body columns immediately, without transition lag. Each
  pane normally keeps at least 280px; below 560px total available width both use half, resizing
  is disabled, and the preferred proportion is retained for wider layouts.
- A vertical keyboard separator exposes the actual local-pane width percentage and bounds.
  Left/Right move the boundary 10px; Home minimizes the local pane and End maximizes it.
  Pointer capture ends on release, cancellation, lost capture, blur, resize, or hiding AI.
  Escape during dragging restores its initial proportion. Other endings retain the last width.
- Collapsing hides the separator and AI pane; reopening restores the last preferred proportion
  within current bounds. The ratio stays local to the mounted workspace and writes no preference.

- The `智能提炼` title appears once in the shared row. The region keeps its accessible label.
  Its top content starts with balance and per-call charging guidance, without a persistent
  privacy paragraph or its spacing. Generation confirmation retains privacy, authorization,
  and billing disclosures in all three interface languages.
- Before a usable saved transcript exists, the workspace is quiet and says it is waiting
  for the transcript. Local processing controls remain in the local workspace.
- Summary and inspiration remain independent targets, each retaining its own status,
  availability blocker, confirmation, retry, progress, error, and result-view action.
- The four current feature rows (summary, dissection, inspiration, and draft) use plain icons,
  a shared name/status line, short descriptions, and compact real actions. Privacy and the
  real account balance appear once above the list; per-call charging and confirmation remain
  explicit. Target errors, retained results, stale-result guidance, quota blockers, and
  cancellation remain available. No rendering/layout change initiates an LLM call.
- Summary is labelled `要点总结（同时生成思维导图文件）`. Summary still generates
  summary plus the hidden/local Mermaid file. There is no independent mindmap target or
  cloud-generation button.
- Inspiration alone may open the preference flow and send a preference snapshot. Summary always
  invokes `retryInsights({ taskId, target: "summary", outputLanguage })` and must never carry a
  snapshot. Both targets require the confirmation-time `outputLanguage` under contract v2.
- Each target keeps its existing independent confirmation. Opening a flow consumes no
  Credits; confirmed generation consumes one Credit per actual supplier API-call attempt.
  The UI calls the balance `AI Credits` and explicitly states that one confirmed generation
  may consume multiple Credits; it must never describe the balance as a number of available
  generation actions. No multi-select or batch generation is introduced.
- AI result viewing may use a lightweight target-specific sheet or inline preview, but it
  must not share a tab container with transcript review.

## Typed State and Cancellation

- Frontend task state contains a typed `activeAiTarget: "summary" | "insights" | null`, or
  an equivalent typed controller state. UI behavior must not infer the target from status copy.
- Local progress and AI target status are separate view-model projections. While the
  underlying worker-compatible stage is AI generation, the local projection remains ready
  when its transcript is usable.
- Target-local failures retain the failed target identity so `partial_completed` attributes
  the error only to summary or inspiration.
- There remains one underlying cancellation action. Its visible control is placed in the
  local workspace for local processing and in the AI workspace for AI generation. Existing
  Cancelling and confirmed-terminal ProcessSupervisor semantics remain unchanged.

## Task Identity and History

- Both workspaces are projections of one complete workflow task. `taskId`, task directory,
  artifacts, transcript, summary, and insights must never be merged across tasks.
- History restoration continues through the workflow controller only. A restored detail is
  installed before either workspace renders its task data, and both workspaces expose the
  same task identity.
- Operation-id guards and expected-task transcript-save guards remain mandatory. Late
  processing, AI, detail-load, or save callbacks from an older task cannot update either
  workspace after restoration.
- Processing, AI retry, and Cancelling continue to make history selection read-only.

## Privacy and Data Flow

- Video, audio, raw source URL, complete transcript/article, task manifest, and local preference
  files are never sent to FrameQ server.
- Only after explicit target confirmation may the worker send allowed chunks from the
  saved official source TXT to the administrator-configured LLM supplier. SourceText selects
  `transcript/transcript.txt` for media or `article/article.txt` for webpage notes, with the
  existing per-target splitting and checkout rules.
- Inspiration may additionally send the confirmed compact preference snapshot. Summary
  and its mindmap must not receive that snapshot.
- UI status, errors, accessibility labels, and screenshots must not expose raw or sensitive
  source URLs.

## Acceptance Criteria

- Workflow/view-model tests prove local completion unlocks AI, local progress excludes AI,
  the active target is typed, summary has no snapshot, and inspiration preserves its
  snapshot contract.
- Component and browser tests cover shared desktop/narrow columns, collapse state and animation,
  fixed toggle coordinates, mounted-state preservation, hidden accessibility, absence of the local-completion
  banner without layout space, AI unavailable/quota exhausted states, both confirmation flows, AI-time transcript
  read-only behavior, target-local errors, and cancellation placement/semantics.
- History tests prove both workspaces share one restored task and stale operation/save
  callbacks cannot overwrite it.
- Existing source privacy, stdin transport, quota, strict History vNext, cancellation, and
  partial-artifact preservation tests remain green.
