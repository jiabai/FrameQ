# Local Transcript and AI Workspaces

## Product Decision

A FrameQ task keeps one `taskId` and one local artifact set, but its completed-task
experience is divided into two domain workspaces:

- `LocalTranscriptWorkspace` owns local download/transcode/ASR progress, video and audio
  file actions, audio review, transcript correction, save, copy, and export.
- `AiGenerationWorkspace` owns AI availability, quota and privacy explanations, separate
  summary and inspiration targets, confirmation, target-local progress, errors, retry, and
  result viewing.

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

- A submitted task shows one full-width task-status banner above the workspaces. Once the
  local transcript is usable, the banner says that video, audio, and transcript are saved
  locally and must not imply media upload.
- At viewport widths of at least 1100 px, the workspaces align at the top in an approximate
  62/38 split. The AI workspace has a minimum readable width of about 360 px.
- Below 1100 px, they stack in the fixed order local transcript then AI generation. The
  transcript editor and AI confirmation content must not be compressed horizontally.
- Both workspaces use the same restrained panel level: existing raised surface, border,
  quiet shadow, and large radius tokens. They use 16 px internal padding, 12 px internal
  rhythm, 20-22 px headings, 14-16 px body copy, and controls at least 40 px high.
- No gradient background, glass layer stack, decorative animation, ornamental 3D, or new
  visual-effects dependency is introduced. Motion is limited to hover, progress, and state
  transitions and respects reduced motion.

## Local Transcript Workspace

- The title is `文字稿校对` or `本地转录`, and the region has an accessible label.
- Local processing progress contains only download/media preparation and transcription.
  AI generation is not presented as a third local step.
- The compact audio review bar precedes the video/audio file action row. Long paths are
  truncated and retain an accessible full label or title.
- `TranscriptReviewPanel` is extracted from the existing transcript detail implementation
  and rendered directly in the local workspace. Existing segment playback, direct editing,
  save, path validation, original backup, and stale-save protection are reused rather than
  copied.
- Transcript content scrolls inside its own bounded region. Edit/save/copy/export actions
  remain in a stable footer. Video and audio are compact file actions, not large result cards.
- During AI generation, playback, scrolling, and local file location remain available, but
  transcript editing and save are disabled with the explanation `AI 正在使用已保存版本`.
- A usable transcript remains fully available in `partial_completed`; an AI failure is not
  rendered as a local transcript failure.

## AI Generation Workspace

- The title is `智能提炼`, with the persistent explanation `确认后仅发送文字稿片段，视频和音频不会上传`.
- Before a usable saved transcript exists, the workspace is quiet and says it is waiting
  for the transcript. Local processing controls remain in the local workspace.
- Summary and inspirations are two compact, independent target cards. Each shows target
  status, availability/Credits blocker, actual-call Credits explanation, and its own confirm,
  retry, progress, error, and view action.
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

- Video, audio, raw source URL, complete transcript, task manifest, and local preference
  files are never sent to FrameQ server.
- Only after explicit target confirmation may the worker send allowed chunks from the
  saved official `transcript/transcript.txt` to the administrator-configured LLM supplier.
- Inspiration may additionally send the confirmed compact preference snapshot. Summary
  and its mindmap must not receive that snapshot.
- UI status, errors, accessibility labels, and screenshots must not expose raw or sensitive
  source URLs.

## Acceptance Criteria

- Workflow/view-model tests prove local completion unlocks AI, local progress excludes AI,
  the active target is typed, summary has no snapshot, and inspiration preserves its
  snapshot contract.
- Component and browser tests cover desktop columns, narrow stacking, the local-completion
  banner, AI unavailable/quota exhausted states, both confirmation flows, AI-time transcript
  read-only behavior, target-local errors, and cancellation placement/semantics.
- History tests prove both workspaces share one restored task and stale operation/save
  callbacks cannot overwrite it.
- Existing source privacy, stdin transport, quota, strict History vNext, cancellation, and
  partial-artifact preservation tests remain green.
