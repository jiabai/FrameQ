# Motion UI Enhancement

## Goal

Use the installed `motion@13.1.0` package to make important FrameQ state changes easier to follow without turning the desktop client into a decorative animation surface.

## Scope

This first increment covers only presentation-layer motion for:

- the local processing stage list and task status banner;
- the real ASR model-download progress bar;
- AI target status changes and height changes;
- history-row removal and list reflow.
- the input workspace entering after a user starts a new task from the toolbar.

It does not change the workflow state model, worker protocol, Tauri IPC, download semantics, progress values, localization contracts, or persistence behavior. Modal enter/exit motion is intentionally deferred until the existing modal focus lifecycle has a dedicated integration design.

## Interaction Rules

- Motion expresses a semantic state change; it must not invent progress or delay a real terminal state.
- Frequent worker progress updates use short tweened transitions. They do not use long springs or looping decorative effects.
- Only the active local processing stage shows an active motion signal. Completed and pending stages remain visually stable.
- AI target rows may animate layout changes when status copy, errors, or actions appear/disappear, but transcript and generated text remain static.
- History items use stable task IDs and animate removal/reflow only after the existing delete action has been confirmed.
- The new-task reset uses a single short ease-out entry for the input workspace: opacity from 0 to 1 and a small upward movement, without delaying workflow reset or changing task state.
- All Motion transforms and layout animations respect the user/system reduced-motion preference. Existing CSS spinner and reduced-motion behavior remain authoritative for non-Motion loaders.
- Existing `aria-live`, `role="status"`, focus, keyboard, and localization behavior must remain unchanged.

## Implementation Shape

- Add a small shared Motion configuration at the React root with `reducedMotion="user"`.
- Use `AnimatePresence` only for semantic content entering/leaving and `layout` for bounded layout reflow.
- Keep motion props local to the affected components; do not move domain state or controller logic into animation callbacks.
- Use existing CSS tokens and durations where possible, with a default state-change duration around 180–220ms.

## Acceptance Criteria

1. Stage changes retain the existing semantic markup and only the active stage shows the loader.
2. The ASR progress bar animates to the supplied real percentage and remains accessible as a progressbar.
3. AI target status changes preserve actions, errors, and target identity while animating layout changes.
4. Confirmed history deletion removes the correct item and remaining rows reflow without using array indexes as keys.
5. `npm --prefix app test`, `npm --prefix app run lint`, and `npm --prefix app run build` pass.
6. No worker, Rust, Tauri IPC, task state, or persistence files are changed.
7. The new-task input workspace mounts with a short Motion entry after the toolbar reset, while the initial application mount does not replay that reset-specific entry.
8. The new-task entry remains understandable and non-blocking with reduced motion enabled; the workspace is immediately usable.
