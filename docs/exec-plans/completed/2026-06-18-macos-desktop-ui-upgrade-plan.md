# macOS Desktop UI Upgrade Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ's current UI is usable but reads like a centered web form. This change should make the app feel like a focused macOS desktop utility: a compact application frame, calm toolbar, clear URL command input, task monitor, result tiles, and sheet-like panels for settings/history/detail. The processing model, worker boundary, local-first rules, and security posture must remain unchanged.

## Progress

- [x] 2026-06-18: User approved the macOS desktop utility upgrade direction after UI diagnosis.
- [x] 2026-06-18: Product spec, design guidelines, and active ExecPlan updated before implementation.
- [x] 2026-06-18: Added failing frontend regression coverage for the desktop shell and sheet structure, then confirmed the expected red test.
- [x] 2026-06-18: Refactored `app/src/App.tsx` into a desktop window shell, toolbar, command panel, task monitor, result workspace, and sheet panels while preserving existing state behavior.
- [x] 2026-06-18: Replaced one-off styling in `app/src/App.css` with tokens and macOS-style component treatments.
- [x] 2026-06-18: Ran frontend tests, build, docs validation, and visual screenshot checks.
- [x] 2026-06-18: Wired the custom toolbar to Tauri window dragging and made the traffic-light controls real close/minimize/zoom buttons.
- [x] 2026-06-18: Added the missing Tauri v2 capability permissions required by the custom window chrome.
- [x] 2026-06-18: Replaced the unreliable native drag path with a manual position-update fallback and verified the running Tauri window moved.

## Surprises & Discoveries

- Evidence: The current app uses a single `App.tsx` and one large `App.css`, so the upgrade should improve structural boundaries without introducing a new UI framework.
- Evidence: Browser preview cannot execute Tauri invoke commands, but settings/history panels still open and can be visually checked with expected invoke failure notices.
- Evidence: At 720px width, the initial waiting-layout column rule overrode responsive stacking and caused horizontal overflow; the responsive rule now explicitly includes `.workspace.waiting-layout`.
- Evidence: Keeping the settings action footer inside the scrollable form made it visually cover lower fields; moving the footer outside the form while using the `form` attribute keeps submission behavior and avoids overlap.
- Evidence: `npm --prefix app run tauri dev` still showed the native Windows titlebar because `tauri.conf.json` kept the default decorated 800x600 window; web-only screenshots did not catch this.
- Evidence: The first macOS UI pass still showed an empty result workspace on the home screen, which made the first screen feel busier than the desired one-card input state.
- Evidence: After simplifying to one card, the input card width was only 560px in a 1180px desktop window, making the card feel undersized.
- Evidence: With native decorations disabled, the custom traffic lights were static spans and toolbar dragging relied only on markup; they needed explicit Tauri window API calls.
- Evidence: `core:window:default` does not include state-changing commands such as `start_dragging`, `close`, `minimize`, or `toggle_maximize`; `capabilities/default.json` needed explicit allow permissions for each custom chrome action.
- Evidence: Red/yellow/green controls worked after switching to Rust commands, but `start_dragging` still did not move the window reliably from WebView2 mouse events. A manual drag fallback moved the real dev window from `(233,110)` to `(393,174)`.

## Decision Log

- Decision: Keep the existing Tauri + React + CSS stack and existing `lucide-react` icons. Rationale: the UI can be upgraded through structure, tokens, and component states without adding heavy dependencies. Date/Author: 2026-06-18 / Codex.
- Decision: Use a light macOS utility style instead of a dark AI interface. Rationale: FrameQ is a local productivity tool with long text reading and settings/history surfaces; light neutral surfaces better support scanning. Date/Author: 2026-06-18 / Codex.
- Decision: Treat 3D/spatial visuals as out of scope. Rationale: they do not help the core URL-to-results workflow and would reduce clarity. Date/Author: 2026-06-18 / Codex.
- Decision: Keep settings actions outside the scrollable form body. Rationale: it preserves a stable sheet footer without hiding form fields. Date/Author: 2026-06-18 / Codex.
- Decision: Disable Tauri native window decorations and add a toolbar drag region. Rationale: the app chrome must be the macOS-style toolbar rather than the host OS titlebar. Date/Author: 2026-06-18 / Codex.
- Decision: Hide the result workspace while `workflow.showUrlInput` is true. Rationale: the home screen should focus on the single URL task; processing/results belong after submission. Date/Author: 2026-06-18 / Codex.
- Decision: Set the waiting-input card target width to 760px with larger padding. Rationale: the single-card home screen should feel proportionate to the default desktop window. Date/Author: 2026-06-18 / Codex.
- Decision: Keep custom chrome actions in a small `windowChrome` helper. Rationale: React rendering stays testable in browser tests while Tauri-specific window actions remain centralized. Date/Author: 2026-06-18 / Codex.
- Decision: Grant only the four required window permissions instead of broad window control. Rationale: this keeps the custom chrome functional while preserving a narrow Tauri v2 capability surface. Date/Author: 2026-06-18 / Codex.
- Decision: Use manual position updates as the primary toolbar drag behavior and keep `start_dragging` only as a fallback. Rationale: window coordinate changes are directly verifiable and do not depend on native drag timing across IPC. Date/Author: 2026-06-18 / Codex.

## Outcomes & Retrospective

Implemented the macOS desktop utility upgrade without changing worker behavior. The app now renders a desktop window frame with traffic-light controls, compact toolbar, stage badge, URL command panel, task monitor, result workspace, result tiles, and sheet-style detail/history/settings panels. The waiting-input screen now shows only the `粘贴视频链接` card; the task monitor and result workspace appear after submission. The Tauri main window now disables native decorations, uses a larger centered desktop window size, and lets the custom toolbar act as the drag region. The custom traffic-light controls now call Tauri close, minimize, and maximize/restore actions. The visual system now uses CSS tokens for neutral surfaces, semantic badges, borders, radii, focus states, and reduced-motion-aware transitions.

Added browser regression tests and focused window chrome unit tests that first failed on the old UI and then passed after implementation. Visual checks captured waiting, processing, settings, and 720px compact states in `work/ui-upgrade/`; the compact view has no horizontal overflow.

Validation passed: `npm --prefix app test`, `npm --prefix app run build`, `npm --prefix app run tauri -- build --no-bundle`, `python scripts/validate_agents_docs.py --level WARN`, and `git diff --check`. `npm --prefix app run tauri dev` was launched after the Tauri window fix.

## Context and Orientation

- `docs/DESIGN.md` defines the state-specific UI rules and new macOS desktop direction.
- `app/src/workflow.ts` owns the workflow state model, progress step derivation, result cards, and error formatting.
- `app/src/App.tsx` currently renders the app shell, URL input, progress panel, result area, detail modal, history modal, and settings modal.
- `app/src/App.css` currently owns all visual styling and will be converted to a token-driven desktop UI system.
- `app/tests/app-input.browser.test.ts` already validates browser mounting, input behavior, and scrollable modal bodies.

## Plan of Work

1. Documentation and tests:
   - Update product/design docs and active plan.
   - Add browser tests that expect the macOS-style desktop frame, toolbar, command panel, result workspace, and sheet structure.
   - Run the focused frontend test and confirm the new test fails before production changes.
2. App structure:
   - Add semantic wrapper sections for window frame, toolbar, command panel, process monitor, result workspace, detail sheet, history sheet/list, and settings sheet/form.
   - Preserve existing workflow state transitions, Tauri client calls, copy/export behavior, history restore behavior, and settings save behavior.
3. Visual system:
   - Define CSS variables for surfaces, text, borders, semantic colors, radii, shadows, spacing, and motion.
   - Restyle buttons, inputs, badges, progress timeline, result tiles, sheets, history rows, and settings groups.
   - Add visible hover, press, disabled, and focus states with reduced-motion support.
4. Validation:
   - Run `npm --prefix app test`.
   - Run `npm --prefix app run build`.
   - Run `python scripts/validate_agents_docs.py --level WARN`.
   - Capture desktop and compact screenshots and inspect for layout, text overflow, visual hierarchy, and panel scroll behavior.

## Validation and Acceptance

- Waiting input state shows a macOS-style app frame, toolbar, URL command panel, and quiet result workspace.
- Processing state hides URL input and shows a task monitor with timeline, progress, worker message, and cancel action only while processing.
- Completed and partial-completed states show two result tiles with clear open/retry affordances.
- Settings/history/detail panels remain internally scrollable and use sheet-like structure.
- Existing frontend workflow tests still pass.
- Web build succeeds.
- Docs validation passes at WARN level.
