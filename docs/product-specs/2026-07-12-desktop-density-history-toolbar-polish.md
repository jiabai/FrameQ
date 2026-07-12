# Desktop Density, History, and Toolbar Polish

## Status

Implemented and validated on 2026-07-12. The completed implementation record is
`docs/exec-plans/completed/2026-07-12-desktop-density-history-toolbar-polish-plan.md`.

## Problem

FrameQ's primary task workspace now has the intended domain hierarchy, but several secondary
surfaces still use inconsistent density and emphasis:

- The saved History browser screenshot shows excessive empty space because its smoke fixture
  forces the sheet to 720 px. The product should explicitly use intrinsic height for a short list
  and internal scrolling only when content reaches the existing sheet maximum.
- Small `--text-soft` copy is too pale at its current size.
- Headings use non-standard 720/760 weights, making several regions look heavier than necessary.
- Active-task sections still mix 18 px with the intended 12/16/24 vertical rhythm.
- The account chip and three independent utility buttons compete for toolbar attention instead of
  reading as one compact account control plus one utility group.

## Product Intent

FrameQ remains a restrained desktop production tool. This change improves scanning and visual
consistency without adding decoration or changing any lifecycle, data, privacy, or platform
boundary. The local transcript remains the primary work surface. History remains a task browser,
and toolbar controls retain their existing behavior and accessible names.

## Approved Direction

### 1. Intrinsic History height

- Remove the browser-smoke mutation that assigns `height: 720px` to `.history-sheet`.
- `.history-list` uses `flex: 0 1 auto`; it must not request unused vertical space when only a few
  records exist.
- The History sheet continues to inherit `max-height: min(720px, 88vh)` from the shared sheet
  surface. No new fixed height or minimum height is added.
- When content exceeds the sheet maximum, `.history-list` remains the scroll owner with
  `min-height: 0` and `overflow: auto`.
- With a short list, the final list item and sheet bottom differ only by the declared list bottom
  padding and borders. With a long list, the sheet stays within the viewport and the list has
  `scrollHeight > clientHeight`.
- Empty History remains a compact, readable empty state and does not expand the sheet.

### 2. Secondary text and heading weight

- Change `--text-soft` from `#8b8f98` to `#747982`.
- Use weight 700 for `h1` and `h2`, weight 650 for `h3`, and weight 700 for
  `.eyebrow` / `.section-label`.
- Do not change `--text`, `--text-muted`, primary, success, warning, danger, or focus colors.
- Do not perform a global search-and-replace of every historical 720/760 declaration. Only the
  shared heading and small-label hierarchy is normalized in this scope.

### 3. Vertical rhythm

- Add `--space-3: 12px`, `--space-4: 16px`, and `--space-6: 24px` at the root and use them for this scope:
  - 12 px for content inside a module;
  - 16 px between sibling modules;
  - 24 px between major active-task regions.
- `.workspace.active-layout` uses 24 px between the task banner and task-workspace layout.
- `.task-workspace-layout` remains 16 px between local and AI workspaces.
- `.task-domain-workspace` and `.transcript-review-panel` remain 12 px internally.
- History list items use 12 px list spacing and 12 px separation between their main content and
  metadata. `.history-item-main` retains its existing 8 px status/title gap because those elements
  form one information unit.
- Waiting-input, settings, account, and unrelated sheet layouts are not globally retuned.

### 4. Toolbar grouping

- Keep the account control as an icon plus the existing visible status label. Do not replace it
  with an icon-only control.
- Remove the account chip's fixed 92 px minimum width. Use a 32 px control height, 9 px horizontal
  padding, a quiet translucent surface, one subtle border, and no elevated control shadow.
- Wrap the History, Settings, and New Task icon buttons in one `.toolbar-tool-group` after the
  optional update control.
- The group uses one quiet boundary, 2 px internal gap, and 2 px padding. Its three child icon
  buttons are 32 by 32 px with transparent individual borders/backgrounds and no individual
  shadow; hover and focus-visible remain apparent on the active child.
- The optional update chip remains a separate control because it represents a temporary action,
  not a persistent utility.
- Preserve button order, click handlers, disabled state, titles, accessible names, keyboard
  reachability, and Tauri drag-region behavior.

### 5. Explicit non-goals

- Do not change the local transcript workspace height or fill short transcript space artificially.
- Do not change History DTOs, loading, restoration, task selection, strict schema checks, or
  privacy filtering.
- Do not modify worker, server, Rust/Tauri commands, payment, quota, LLM, SourceIdentity, or
  persistence.
- Do not touch unrelated concurrent workspace changes, including worker media behavior and its
  tests/specification.
- Do not add dependencies, animation systems, gradients, or decorative effects.

## Responsive and Accessibility Requirements

- The toolbar group must remain contained at supported desktop widths; account text may retain its
  natural width and must not overlap utilities.
- At narrow widths, existing toolbar behavior remains usable and no control is clipped.
- All icon buttons retain their existing accessible names and focus-visible feedback.
- History keeps its existing two-line title clamp, metadata adaptation, disabled selection
  semantics, and keyboard behavior.
- Increased secondary-text contrast must not make helper text compete with primary titles.

## TDD and Acceptance

Implementation order is History height, typography/contrast, vertical rhythm, then toolbar group.
Each change starts with a focused failing test.

Required coverage:

- CSS/component tests assert intrinsic History flex behavior and absence of a fixed/minimum sheet
  height.
- Chromium smoke uses two or three records without assigning an inline height and verifies compact
  sheet geometry. A separate large fixture verifies max-height and internal list scrolling.
- CSS tests assert the exact `--text-soft` value and 700/700/650 heading hierarchy.
- CSS tests assert the 24/16/12 active-workspace rhythm without changing short-transcript height.
- Component/CSS tests assert one toolbar utility group, preserved account text, three accessible
  child buttons, 32 px control sizes, and quiet group styling.
- Browser geometry verifies account and utility controls share a vertical center, the three utility
  buttons are equal size, and no toolbar overflow occurs.
- Existing History restore, disabled selection, task-workspace, transcript, AI, privacy, and stale
  callback tests continue to pass.

Final validation includes `npm --prefix app test`, `npm --prefix app run build`, the relevant serial
Chromium smoke with refreshed History and task-workspace screenshots,
`python scripts/validate_agents_docs.py --level WARN`, and `git diff --check`.
