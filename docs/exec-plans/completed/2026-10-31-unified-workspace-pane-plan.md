# Unified Workspace and AI Pane Plan

## Purpose / Big Picture

Implement the user's final confirmed webpage and pane animation from the current files in
`build/ui-workspace-preview/`. One workspace shares note/AI headings, a thin divider, and a
stationary AI toggle. The user authorized this final style and effect on 2026-10-31.

## Progress

- [x] Inspect the latest approved files, real components, shared title derivation, and rules.
- [x] Update product specification and record the confirmed presentation/state boundaries.
- [x] Add the mounted layout container, accessible toggle, and three-locale labels/tests.
- [x] Integrate the real note title and existing components; remove duplicate inner headings.
- [x] Implement shared-grid animation, divider, narrow layout, and reduced motion.
- [x] Run relevant/full frontend checks, native build, real renderer layout/input/motion checks.
- [x] Synchronize durable design/QA documentation and record exact acceptance scope.

## Context and Orientation

- `App.tsx` already computes the real `pageTitle` with manual/generated/history priority.
- `TaskWorkspaceLayout.tsx` will own only view expansion state and two always-mounted slots.
- `LocalTranscriptWorkspace` and `AiGenerationWorkspace` retain actual model/controller props;
  their internal headings are replaced by necessary save/processing status feedback.
- `App.css` and shell CSS own the actual grid, column overflow, spacing, and CSS transitions.
- Existing confirmation sheets, playback/edit/save controllers, quota, and provider calls remain
  outside the visibility container and keep their current ownership.

## Implementation Steps

1. Add a shared title row and body grid under `.task-workspace-surface`. Use matching tracks
   `minmax(0,1fr) minmax(0,clamp(280px,38%,620px))`; collapse the second track to `minmax(0,0px)`.
2. Place the 30px toggle absolutely in the shared title row. Keep localized labels, linked
   controls ID, `aria-expanded`, hidden title/content `aria-hidden`/`inert`, and focus recovery.
   Always render both ReactNode slots; use one boolean and no transition timers/unmounts.
3. Pass `pageTitle` from App and the existing real workspace elements as slots. Keep save,
   waiting, processing, failure, quota, and recovery feedback; remove duplicated inner titles.
4. Match the latest sample's 54px row, fine divider, borderless columns, padding, 14px shared
   headings, 220ms grid/slide and 150ms opacity transitions. Keep narrow columns, shrinking
   transcript scroll area and accessible local overflow; preserve native vertical chaining.
5. Disable all pane and toggle/icon transitions for reduced motion. Test rapid reversals,
   stationary button position, maintained mounted nodes, and keyboard/assistive exclusion.

## Validation and Acceptance

- Run container/component/resource/controller regressions, full frontend tests, lint, and
  production/native no-bundle build. Add no new mock, fake IPC, provider, or demonstration state.
- In the actual release WebView2, use temporary CSS viewports 1734x907, 1180x760, and 720x640.
  Check shared titles, divider, no duplicate headings/column cards, typography/overflow,
  stationary toggle, actual CSS animation/reversal, reduced motion, inert/AX/keyboard behavior,
  real edit-state identity and wheel/control reachability. Do not write user text or generate AI.
- The user explicitly authorized this FrameQ screenshot acceptance. Inspect the actual native
  workspace and menu after numeric/input checks. Record CSS viewport emulation distinctly from
  physical native-window resizing; restore temporary settings and close the loopback debugging
  endpoint before normal application startup.
- Run applicable Node/Python script gates, document governance, and `git diff --check`.
  No worker/server/Rust business changes, release, branch, or Git commit are required.

## Decision Log

- 2026-10-31, User: Confirm the latest unified webpage and tested collapse/expand animation.
- The final selected source keeps two columns in narrow windows and reserves no separate
  card frames. Its current declarations govern presentation.
- Hiding AI preserves component/controller state, active operations, and results. It performs
  no cancellation, generation, save, account update, or new persistent preference write.
- The user answered the pending screenshot question with “允许本次截图验收”; native visual
  inspection is authorized for this acceptance.

## Surprises & Discoveries

- Shared grids must keep two compatible tracks to reverse animations continuously.
- Short layouts require transcript min-height/overflow management to keep footer controls reachable.

## Outcomes & Retrospective

- Focused component/style/resource checks: 74 passed. Full frontend regression: 117 files /
  1317 tests passed. Final stylesheet verification: 25 passed. TypeScript/i18n lint passed.
- Node script gates: 51 passed; Python script gate: 1 passed. Document governance passed
  with 0 errors and 0 warnings. The final Windows native no-bundle build passed and embeds
  `index-Cp30j6iA.js` / `index-BDPhu_nx.css`.
- Actual release WebView2 checks passed at CSS viewports 1734x907, 1180x760, and 720x640:
  shared real title, two columns, fixed toggle, 220ms grid/slide and 150ms fade, state/audio/edit
  preservation, hidden AX and keyboard exclusion, and 18 real wheel checks. Trusted click
  intervals 121.4/116.4/162.4ms reversed running CSS transitions continuously.
- Reduced motion passed exact zero-duration pane/toggle/icon transitions, no running related
  animation, and immediate committed geometry/visibility.
- Authorized native screenshots passed normal/maximized workspace, sidebar, collapsed/expanded
  AI, and complete left-aligned seven-row menu inspection. Escape visibly restored menu focus.
- Viewport/media overrides and playback/scroll/editor state were restored. Temporary loopback
  debugging was closed before starting the final executable normally.
- No macOS run, other-monitor/200% scaling check, paid generation, fresh media processing, or
  transcript-save acceptance was performed. No new worker/server/native business behavior
  was introduced by this layout pass; their full platform suites were not repeated.
