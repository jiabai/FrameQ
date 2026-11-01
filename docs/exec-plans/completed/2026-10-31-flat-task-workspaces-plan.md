# Flat Task Workspaces Plan

This ExecPlan records implementation and verification of the user-approved local webpage.

## Purpose / Big Picture

Apply the approved `build/ui-workspace-preview/style.css` appearance to the real transcript
and AI workspaces. Keep the existing account, transcript, media, generation, cancellation,
and persistence controllers. The user confirmed the webpage and instructed implementation
on 2026-10-31; routine component/style choices are within that authorization.

## Progress

- [x] Read RULES.md, WORKFLOW.md, execution gates, current components, and the selected source.
- [x] Update the product specification with frames, typography, spacing, responsive layout,
  real-state ownership, charging disclosure, and scrolling requirements.
- [x] Apply flat transcript/workspace CSS and truthful local save-state presentation.
- [x] Consolidate real balance/disclosure in the AI workspace; retain all four real targets.
- [x] Verify component/business regressions, lint/build, numeric layout, real wheel input,
  and available native behavior without initiating provider calls.
- [x] Update durable design/QA documentation and record evidence and remaining limits.

## Context and Orientation

- `app/src/App.css` owns existing transcript/player/workspace rules. Update their actual
  declarations instead of accumulating contradictory overrides.
- `app/src/features/shell/shell.css` owns available-width stacking and shell-specific insets.
- `LocalTranscriptWorkspace.tsx` and `TranscriptReviewPanel.tsx` retain real transcript controls.
- `AiGenerationWorkspace.tsx` projects four targets and their actual callbacks and feedback.
- The selected webpage is an ignored design artifact. Its sample content, accounts,
  localStorage editing, notifications, and generation dialogs must not enter production.

## Implementation Steps

1. Replace content-frame tokens with the selected 12px radius, 20px padding, 16px gap,
   `minmax(0, 1.64fr) minmax(330px, 1fr)` columns, and scoped explicit pixel typography.
   Remove internal player/list/icon frames and shadows; preserve semantic input borders.
2. Keep bounded transcript scrolling and stable player/toolbar/footer in normal two columns.
   At available width <=800px retain the existing growing transcript and outer-page scrolling,
   with native vertical chaining. No wheel interception or synthetic scroll forwarding.
3. Present one actual account balance plus charging explanation before AI rows. Keep every
   target's confirmation/retry/view/cancel, errors, blockers, stale-result and seed feedback.
4. Show local save/dirty/saving state from the actual controller. Use existing localized copy
   when accurate; add reviewed three-locale resources only where needed.

## Validation and Acceptance

- Run relevant React/view-model/transcript/AI/title/confirmation tests, then frontend regression,
  `npm --prefix app run lint`, and the production/native no-bundle build.
- Check real production styles and components at 1734x907, 1180x760, and 720x640. Record
  font sizes, external/internal boundaries, readable widths, horizontal overflow, scroll travel,
  and footer/control reachability. Real wheel events must establish scrolling/chaining.
- Use available native accessibility/input for existing saved results. Respect RULES.md:
  proactive visual inspection is prohibited; record any native verification limitation
  precisely instead of replacing it with fake IPC or provider success.
- Run document governance and `git diff --check`; scripts gates apply if their sources change.
  No worker/Rust/server boundary, provider call, user-note deletion, release, or Git commit is needed.

## Decision Log

- 2026-10-31, User: Confirm the local webpage style and implement it in the main application.
- Preserve existing independent Pinned, LLM titles, note menus, Collections, hidden success
  banner, and account-menu Settings. No new top-right Settings, conversation, or share feature.
- Real application state and controller ownership take precedence over demonstration behavior.
- The stacked transcript retains its existing outer-page scroll ownership; the selected
  visual treatment does not reintroduce wheel containment at inner boundaries.

## Surprises & Discoveries

- Available content width determines the column breakpoint. The transcript remains bounded
  in two columns and grows within the outer page in the stacked layout.
- The existing three-locale Credits balance and per-call cost resources support a single
  truthful disclosure above all four targets without introducing another charging contract.

## Outcomes & Retrospective

- Frontend regression: 116 files / 1310 tests passed. Final typography/icon adjustments also
  passed the 25 focused stylesheet checks. Frontend TypeScript/i18n lint passed.
- Script gates: Node 51 passed; Python 1 passed. Document governance passed with 0 errors
  and 0 warnings. Final Windows no-bundle release build passed; embedded asset names are
  `index-DgfFx3x5.js` and `index-UR34XmhF.css`.
- Real release WebView2 CSS viewports 1734x907, 1180x760, 720x640, and 1734x640 passed exact
  typography/inset/gap/radius, two-frame, and horizontal-overflow checks. Twelve actual browser
  wheel checks proved the proper owner; the short wide case proved upper/lower chaining.
  Copy/save and the last AI row/actions were reachable at every size.
- Actual edit entry/Escape preserved text and focus; actual summary confirmation/Escape
  retained language/privacy/charging disclosures and balance. No generation or save was started.
  Runtime CSSOM border 1px and native DPR 1.75 physical-pixel quantization were verified separately.
- Temporary viewport/media/scroll state was restored, audio paused, and no dialog/editor remained.
  The temporary loopback debug process was closed and the application restarted normally.
- Evidence and exact scope are in `design-qa.md` and ignored
  `build/ui-workspace-acceptance/native-layout-results.json`. No screenshot, physical window
  resize, macOS run, fresh processing, or paid-provider acceptance was performed. Unchanged
  native/worker business code did not require repeating its complete platform suites.
