# Motion Confirmation Flow Lifecycle

## Goal

Extend the shared Motion Sheet lifecycle to the three confirmation flows that are currently owned by nullable state: summary generation confirmation, Inspiration Profile / generation preferences, and transcript dissection confirmation.

## Scope

- Summary generation confirmation rendered by `App.tsx`.
- `InsightPreferenceFlow` rendered from the nullable preference-flow state.
- `TranscriptDissectionConfirmationSheet` rendered from the nullable dissection preview.

No workflow state, controller transition, quota, persistence, worker, Rust, Tauri IPC, or localization behavior changes are included.

## Lifecycle Contract

- The parent keeps each presentation component mounted while the logical state is absent.
- `AnimatedSheet` receives the logical `open` boolean and owns delayed unmount plus focus restoration.
- Nullable flows retain their last renderable `flow` or `preview` snapshot during exit so the panel never disappears before the animation completes.
- Backdrop clicks, close buttons, global Escape handling, disabled confirmation actions, `aria-modal`, and existing focus ownership remain unchanged.
- Opening a different flow after a close uses the new state immediately; the retained snapshot is only a close-animation fallback.

## Implementation Shape

- Reuse `AnimatedSheet`; do not create a second modal animation abstraction.
- Remove local `useModalFocus` ownership from the migrated confirmation surfaces.
- Render the summary confirmation shell unconditionally in `App.tsx` with `open={summaryConfirmOpen}`.
- Render the nullable preference and dissection components unconditionally; each component resolves `current ?? retained` content before rendering the shared shell.
- Keep existing sheet classes and content markup; Motion owns only the shell opacity/transform lifecycle.

## Acceptance Criteria

1. All three confirmation flows render the existing localized copy and controls through `AnimatedSheet`.
2. Closing a nullable flow preserves its last content until the exit animation completes.
3. Existing modal focus coverage points to the shared focus owner, with the History nested delete confirmation remaining independent.
4. No domain or persistence behavior changes.
5. App tests, lint, build, docs validation, and whitespace checks pass.
