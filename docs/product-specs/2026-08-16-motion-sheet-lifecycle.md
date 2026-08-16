# Motion Sheet Lifecycle

## Goal

Add restrained enter/exit Motion transitions to the primary desktop Sheets while preserving FrameQ's modal focus, keyboard, inert-background, and localization behavior.

## Scope

Migrate only the five boolean/tab-controlled Sheet surfaces that already have a stable open state:

- Account;
- Settings;
- History;
- ASR model preparation;
- AI result detail.

Confirmation flows that are mounted directly from nullable objects (`summaryConfirmOpen`, `InsightPreferenceFlow`, and dissection confirmation) remain unchanged in this increment because their mount ownership needs a separate lifecycle seam.

## Lifecycle Contract

- `open=true` mounts the Sheet and animates the backdrop/panel in.
- `open=false` starts the exit animation but keeps the dialog mounted and focus-trapped.
- The dialog is unmounted only after the exit animation completes; then the existing focus manager restores focus to the original trigger.
- Reopening during an exit cancels the close visually and keeps the same dialog alive.
- Backdrop clicks, close buttons, Esc handling, disabled actions, nested History deletion confirmation, and `aria-modal` semantics remain unchanged.
- Reduced-motion users receive no transform/layout animation; opacity-only feedback may remain under Motion's user preference policy.

## Implementation Shape

- Add one `AnimatedSheet` presentation component in `features/modal/`.
- Let the component own delayed presence and call `useModalFocus` with presence rather than logical `open`.
- Keep each Sheet's content and controller logic in its existing feature file.
- Use existing `sheet-backdrop` and `sheet-panel` classes, with a short 180–220ms transition and no decorative spring/parallax.

## Acceptance Criteria

1. All five migrated Sheets render the same dialog labels, controls, notices, and localized content.
2. A closing Sheet remains in the DOM until the exit animation completes and does not release background inertness early.
3. Reopening during exit leaves the Sheet open and does not restore focus to the old trigger.
4. Existing static markup, focus integration, and keyboard tests remain valid or are updated to test the new shared boundary.
5. `npm --prefix app test`, `npm --prefix app run lint`, and `npm --prefix app run build` pass.
