# Workspace Splitter Plan

## Purpose / Big Picture

Implement the user-approved draggable divider between the transcript and AI panes. Retain the
unified workspace, real controllers, fixed toggle, and 220ms collapse/expand effect.

## Progress

- [x] Inspect the current layout and record the confirmed splitter behavior.
- [x] Add responsive width calculations, pointer capture, keyboard controls, and localized ARIA.
- [x] Preserve immediate manual sizing and the existing animated whole-pane toggle.
- [x] Run frontend checks, native build, and real renderer pointer/keyboard/resize acceptance.
- [x] Synchronize final design/architecture/QA records and close this plan.

## Implementation

- Keep a preferred AI proportion in component-local state. CSS clamps it to two 280px minimum
  panes; below 560px total width both receive half and resizing is disabled. Retain the preferred
  proportion through narrow/wide changes and hide/show. Do not persist a new preference.
- Place a transparent 12px separator over the body-grid boundary. Preserve the existing thin
  line, col-resize cursor, visible keyboard focus, and touch-action:none on this handle alone.
- Capture the primary pointer; move the shared header/body boundary immediately. Release or
  cancel on pointerup/cancel/lostcapture, blur, whole-pane hiding, and viewport/container resizing.
  Escape during dragging restores the pre-drag proportion. Other endings keep the last width.
- Expose a vertical separator controlling the local pane, with actual local-width percentage,
  localized accessible labels, ArrowLeft/Right 10px steps, Home minimum, and End maximum.
- Disable grid transitions during manual sizing. Toggle restores the existing 220ms motion.
  Keep both pane children mounted and preserve original focus, edit, playback, and AI ownership.

## Validation

- Pure width/range/keyboard tests, existing mounted-layout and workspace regressions, CSS and
  localization checks, full frontend tests, lint, and Windows native no-bundle build.
- Actual release WebView2: trusted mouse/touch pointer capture, external release/cancellation,
  keyboard bounds, narrow/wide and active-drag resize, immediate widths, collapse restoration,
  and actual mounted content/audio/edit-state preservation. No provider calls or user-text saves.
- Document governance and diff checks. Temporary loopback debugging must close before normal
  application startup. New splitter behavior uses numeric/input acceptance without screenshots.

## Decision Log

- The user confirmed the draggable divider and authorized sending the request to this thread.
- Resize changes layout only. It does not open a note, modify transcript text, or start AI work.

## Outcomes & Retrospective

Focused component/style/localization regression passed 73 tests; pure width calculations passed
3 tests. Full frontend regression passed 118 files / 1320 tests. TypeScript/i18n lint, Windows
native no-bundle build, Node script gates (51 tests), Python script gate (1 test), and document
governance (0 errors / 0 warnings) passed. Final embedded assets are `index-DexeIJDl.js` and
`index-DAxYD1L4.css`.

Real release WebView2 acceptance passed trusted external pointer release, touch cancellation,
Escape restoration, actual Tab focus loss, keyboard 10px steps/Home/End, width bounds, active-drag
resize, a 482px equal/disabled layout, and preferred-ratio restoration across narrow/wide and
hide/show changes. Actual edit content, business nodes, balance, and nonzero paused playback
were preserved. Focused motion checks proved 220ms grid animations after manual sizing,
stationary toggle/synchronized columns, and exact zero-motion immediate endpoints under reduce.

The renderer restored native dimensions/DPR, zero touch points, AI expansion, zero scrolls and
paused-zero playback, with no editor/dialog/drag. The temporary debugging process and listener
closed before normal executable startup. Evidence is linked from `design-qa.md` under ignored
`build/ui-workspace-acceptance/`.

No new screenshots, macOS acceptance, paid provider call, fresh processing, or transcript save
was performed for this divider. No native/worker/server business behavior changed in this pass.
