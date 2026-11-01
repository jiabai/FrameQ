# FrameQ Client Design QA

final result: implemented; native acceptance remains partial

## Evidence and state

- Visual references are the supplied screenshots and the approved final design image `exec-0223687d-5ddc-4377-9c99-f661d84011d0.png`, 1734x907 pixels.
- The production Home capture is [home-production.png](build/ui-redesign/home-production.png). The recorded comparison artifact is [home-comparison.png](build/ui-redesign/home-comparison.png). These local evidence files are stored under the ignored `build/` directory.
- Browser evidence uses the actual signed-out account and unavailable native services. Native Collection evidence uses the Windows application, its real local history, and committed metadata.
- The implemented surfaces include Home, Notes, Collection, Artifacts, the account menu, the outer Collection manager, and Collection note details.

## Required surfaces

- Typography: serif greeting with local system fonts, system UI body type, localized copy, ellipsized history titles, and wrapping for long account names.
- Layout: measured 277.44px sidebar; composer 972x156px at x515.72/y282.17 in the 1734x907 viewport. At 720x640 the rail is 66px and composer 614x156px; document width equals viewport width.
- Colors: neutral gray shell, almost-white rounded working area, restrained gray borders, and existing blue brand artwork.
- Assets: existing project SVG artwork is tracked under `app/src/assets/frameq-mark.svg`, with outer whitespace cropped. Both symbols have no tile, border, or shadow.
- Terminology: Simplified Chinese uses `合集` and `笔记`, Traditional Chinese uses `合集` and `筆記`, and English uses `Collection` and `Notes`. User-supplied Collection names and note content remain unchanged.
- Collection management is implemented with Rust-owned atomic app-local persistence. The outer manager owns create, rename, and delete actions. Collection details provide `新建笔记 / New note` at the top right and `添加笔记到合集 / Add notes to Collection` below the note list or empty state.
- File helper copy names the supported video/audio inputs. Recording is deferred and visibly unavailable. Additional source types, drag/drop, clipboard files, and a new 50MB limit are outside this change.

## Verified interactions

- Twelve production browser cases passed against the built frontend without an injected IPC bridge. They cover the shell and real signed-out state, URL-draft retention through navigation, explicit account gating, unavailable native file/history states, composer expansion and Escape, keyboard account/settings access, narrow-window geometry, artwork, Collection name validation/failure recovery, and stable pointer targeting across fresh page mounts.
- Native Windows interaction verified Collection creation and rename, adding an existing note with count `1`, application restart with that membership retained, opening the note and returning to its Collection, and removing the membership with count `0`.
- The current Windows executable was rebuilt and launched from `app/src-tauri/target/release/app.exe`. Its embedded asset names match the current production build (`index-C7xJ9uFt.js`, `index-CzcoOzq5.css`). Native accessibility confirms `合集`, `笔记`, `新建合集`, `新建笔记`, independent note-menu controls, and note counts; existing user-authored Collection names and memberships remain present.
- Component and model checks cover Collection manager actions, detail actions, membership projection, localized copy, task/Collection navigation identity, unavailable visits, busy/dirty guards, and async operation ownership.

## Current behavior

- Sidebar navigation is left-aligned, account access stays at the bottom, and the media composer uses scoped typography and restrained styling.
- Home navigation retains the source draft and current completed task. Back/forward preserve task and Collection identity and skip unavailable task visits. The composer expands to 400px at the recorded desktop size and returns to 156px with Escape and focus restoration.
- Collection state changes follow committed native responses. A saved note can belong to more than one Collection; counts show only notes available in verified local history.
- The note menu uses a 224px white panel with 12px corners, 14px labels matching sidebar navigation,
  plain 16px icons, 34px rows, 12px row insets, full-width separators, and uniform left alignment.
  Seven single-line rows form a 284px panel. CSS dimensions are logical pixels and are checked
  separately from Windows display scaling. Native screenshot inspection is authorized for this
  menu-density correction.
- Pinned entries form a separate group; ordinary Notes retains every note. Manual names are
  local task settings with priority over generated titles. Permanent deletion retains durable
  cleanup intent and protects same-name replacements; real filesystem/process tests cover it.
- The main agent opened the actual release executable and inspected the revised menu in native
  screenshots at normal size and the minimum resizable window. All seven labels and the final
  deletion item were fully visible. End and Home visibly moved focus to the last and first menu
  rows; Escape closed the menu and visibly restored focus to the originating ellipsis.
- Windows AppliedDPI is 168 (175%). These native checks used the active display configuration;
  independent 200% page zoom and other monitors were not exercised. No application CSS/native
  code applies a menu-specific zoom or transform. The menu's rendered proportions match its
  logical dimensions and surrounding sidebar text.
- Creating a note from a Collection retains its destination through the existing media workflow. Membership is attempted after the local note is saved; a failed membership update leaves the note saved and offers a retry.
- A completed local transcript renders no success-banner element or reserved spacing. This
  applies both when processing finishes and when an already saved note first renders. Existing
  local processing/failure feedback, title progress/recovery, and AI target states remain in
  their own regions. The display decision reads the view model and starts no operation.
- A normally saved transcript also omits its compact saved-state row and container; loading,
  saving, dirty, processing, and error feedback remain available. AI top content starts with
  balance and cost guidance, with no persistent privacy paragraph or its 12px separation.
  Generation-confirmation privacy, authorization, and billing disclosures remain in place.

## Unified task workspace acceptance

- The final approved webpage under `build/ui-workspace-preview/` supplies one white workspace,
  a shared 54px title row, and a fine vertical divider. Header/body share zero-gap tracks
  `minmax(0,1fr) minmax(0,clamp(280px,38%,620px))`. Neither column has an outer card border,
  radius, or shadow. The shared left title uses the real note title; the right title is localized.
  Shared titles/body/feature names use 14px, descriptions 13px, and supporting copy 12px.
- A real saved note was opened in the current release Windows WebView2 without injected IPC,
  demonstration state, or provider substitution. Temporary CSS viewports 1734x907, 1180x760,
  and 720x640 all retained two columns without horizontal document overflow. Shared headings,
  insets, divider, borderless internals, and real save state were checked numerically.
- The stationary 30px toggle controls both the AI title and full pane. Header/body grid tracks
  and AI displacement animate for 220ms; opacity animates for 150ms. The toggle coordinates
  and note-title origin remain fixed. Trusted native-input click intervals of 121.4, 116.4,
  and 162.4ms reversed running transitions in the three viewports; browser reverse durations
  were 169.653, 169.491, and 196.199ms, with intermediate widths and an expanded final state.
- Reduced motion makes the header, body grid, AI heading, AI pane, toggle, and toggle SVG
  transitions exactly zero seconds. Both directions reach final visibility/geometry on the
  first committed frame with no running pane or toggle transitions.
- Both real workspace nodes, audio engine, edit content, AI state, and balance remain mounted
  across toggles. Actual range-keyboard input established a paused nonzero position of one
  second, which survived switching. Actual edit entry retained the original transcript; Escape
  closed it. No user text was saved or exported, no processing/provider operation was started,
  and the displayed balance remained 491 AI Credits.
- Hidden AI content immediately becomes inert and aria-hidden. Seven checked AI accessibility
  nodes were unexposed, and twelve actual Tab inputs per viewport excluded hidden AI controls.
  The controller/component regressions also cover focus recovery from within the hidden pane.
- Eighteen actual wheel checks over transcript headers, text, and time controls passed across
  expanded/collapsed states and three viewports. Copy/save and the last AI row/actions remained
  reachable. Native wheel input supplied this evidence; direct scroll assignments were not used.
- Numeric/input evidence is under ignored `build/ui-workspace-acceptance/`:
  [layout/input results](build/ui-workspace-acceptance/unified-layout-results.json) and
  [motion frames](build/ui-workspace-acceptance/unified-motion-frames.json).
- After explicit user authorization, the main agent inspected actual native screenshots in a
  normal and maximized Windows window, with the sidebar expanded/collapsed and AI pane
  expanded/collapsed. The shared title, divider, released local width, stationary toggle,
  border-free brand artwork, and complete seven-row menu were visible. Menu labels share
  the same left starting position; Escape closes the menu and visibly restores ellipsis focus.
- Temporary viewport/media settings were cleared, native DPR 1.75 restored, scroll positions
  returned to the top, and audio paused at zero with no editor/dialog. The temporary process
  was closed and loopback port 9334 confirmed closed before ordinary application startup.
- Focused checks passed 74 tests; full frontend regression passed 117 files / 1317 tests.
  Final stylesheet verification passed 25 tests. Lint, Windows native no-bundle build, Node 51 /
  Python 1 script gates, document governance, and difference checks passed. Existing title,
  menu, Collection, account, edit/save, confirmation, cancellation, and recovery coverage remains.
- CSS viewport emulation is distinct from the normal/maximized native screenshot inspection;
  arbitrary physical window sizes and other monitors were not exercised in this pass. No macOS,
  paid provider call, fresh media processing, or transcript-save acceptance was performed.
  Native/worker business code was unchanged by this layout pass; their full suites were not repeated.

## Adjustable divider acceptance

- The body divider preserves its fine-line appearance and provides a transparent 12px target.
  Both title/body grids use the user-adjusted ratio. Manual pointer and keyboard changes have
  zero grid-transition duration, so actual widths follow input immediately.
- Real release WebView2 input established a 45% AI share, moved the captured mouse outside
  the workspace, and released it without changing the note. Trusted pointer capture, external
  release, actual touch cancellation, Escape restoration, and Tab-triggered focus loss passed.
  Each ending released capture and left no drag cursor or selection state.
- Actual ArrowLeft/Right input moved the boundary 10px; Home/End reached the local minimum/
  maximum. Both panes respected 280px limits. The separator reports the actual local width and
  bounds as localized percentages rounded to one decimal, controlling the real local-pane ID.
- Resizing the viewport during dragging ended capture and applied the retained proportion.
  At 720x640, the collapsed sidebar left a 646px workspace; expanding it left 482px. The latter
  split equally, disabled separator input/Tab access, and retained the preference for wider space.
  Returning to a wider viewport or expanding AI restored the preferred legal width.
- Real workspace/audio/AI nodes, original edit text, balance, target states, and save admission
  survived all operations. A nonzero paused playback position remained unchanged. No transcript
  was written, no processing was started, and no provider or additional preference was used.
- After actual keyboard sizing, both collapse and expansion produced synchronized 220ms
  header/body grid transitions with intermediate widths and a stationary toggle. Expansion
  restored the adjusted width. Reduced motion produced exact zero-duration pane/toggle
  transitions and the correct endpoint on the first committed frame in both directions.
- Evidence is [splitter results](build/ui-workspace-acceptance/splitter-results.json) and
  [motion results](build/ui-workspace-acceptance/splitter-motion-results.json), with
  [restored native state](build/ui-workspace-acceptance/splitter-restored-native.json).
  The final check found native DPR 1.75, touch simulation disabled, AI expanded, no editor,
  dialog, or drag state, audio paused at zero, and all four scroll owners at zero.
  The temporary process then closed, port 9334 was verified closed, and the executable
  started normally without debugging arguments.
- Full frontend regression passed 118 files / 1320 tests; lint, native no-bundle build, Node 51 /
  Python 1 script checks and document governance passed. This divider acceptance used numeric
  measurements and trusted browser input in actual release WebView2. No new screenshots,
  macOS run, paid generation, fresh processing, or transcript-save acceptance was performed.

## Workspace copy and spacing acceptance

- Normal saved transcripts have no saved-state span, local status container, or empty status
  row. The actual review is the first content child, starting at the existing 16px local inset.
  Loading/saving/dirty and processing/error feedback remain in the components.
- The AI workspace contains no persistent privacy paragraph. Credits are its first content
  child with zero offset and zero top padding; their 15px bottom padding, real balance, cost
  guidance, and all four feature rows remain. Three-language component/resource checks passed.
- The actual summary confirmation retained the LLM/Mermaid privacy disclosure, multiple-Credits
  guidance, and output language; Escape closed it without generation. A short real divider drag
  and one collapse/expand preserved actual business nodes, paused audio, target state, and balance.
- [Native numeric/input evidence](build/ui-workspace-acceptance/workspace-copy-trim-results.json)
  records both absent rows and exact spacing. Final state had AI expanded, no textarea/editor,
  dialog, dirty notice, or generation, save disabled, audio paused at zero, and all scrolls zero.
  The temporary debugging process/port closed before the executable started normally.
- Focused checks passed 76 tests; full frontend regression passed 118 files / 1320 tests.
  Lint, Windows native no-bundle build, Node 51 / Python 1 script checks, document governance,
  and diff checks passed. No new screenshots, macOS run, paid generation, or transcript save
  was performed for these two presentation changes.

## Shared client surface acceptance — 2026-11-01

- All approved confirmation, preference, result, draft, settings, account, model, history and
  note dialogs now use the shared white surface, neutral borders, 12px corners and restrained
  outer shadow. Body, form and action text is 14px, dialog titles 16px/600, section titles
  14px/600, and helper text 12/13px. Headers and action areas remain separate from scrolling
  content; paths alone use single-line ellipsis with their complete accessible value/title.
- Both draft discard decisions use the application confirmation dialog. Task identity, local
  or persisted edits, saving, stale candidates and cancellation retain their guards. Shared
  inert ownership supports overlapping dialog exits. Closing dialogs contain Escape and
  restore focus to a valid active origin. Regression checks cover these state boundaries.
- [Scope and restoration manifest](build/ui-surface-acceptance/scope-limit-manifest.json)
  records actual release WebView2 inspection using real stored notes and trusted input.
  The primary matrix contains 60 settings, 84 read-only dialog and 96 task-surface cases,
  totaling 240. These cover zh-CN, zh-TW and en-US at renderer CSS sizes 1734×907,
  1180×760, 720×640 and 1734×640. There were 87 actual wheel checks. Numeric evidence
  confirms the font scales, border, corners, no gradient/blur, no nested shadows, contained
  geometry and reachable actions.
- The actual native window was 1180×761 at DPR1.75; neither its physical geometry nor OS
  scaling was changed. The four sizes and extra DPR1 check are explicitly renderer emulation.
  At DPR1.75 the authored 1px border resolves to 0.571429 CSS pixels.
- The 240-case matrix ran with `index-BzY0Evyn.js` and `index-BpbwL3_c.css`. The surface
  unification build embedded `index-Cfe5bItx.js` and the identical CSS. That build's
  [account evidence](build/ui-surface-acceptance/account-final.json) has 12 independently
  opened three-language/four-size cases: real Tab/Shift+Tab loops, trusted Escape, origin
  focus restoration and background inert restoration all pass.
  [Final representative evidence](build/ui-surface-acceptance/final-verify.json) covers
  summary confirmation, long-title rename and history at native/narrow sizes, plus eight
  summary normal/fullscreen toolbar and wheel checks.
- Real content comprised three notes, a 12,532-character/533-segment transcript, titles up
  to 180 characters, saved summaries of 1138/1215 characters and a displayed path of 140
  characters. The six-field unsaved inspiration profile, summary/dissection confirmations,
  two saved summaries, five settings categories, active account, history/delete cancellation,
  rename, Collection membership and information dialogs were reachable without content writes.
- A real paused position of one second persisted through dialogs, divider dragging,
  collapse/expand and viewport changes. Transcript, balance, action admission, task states and
  mounted audio/review/AI nodes remained unchanged. Reduced-motion preservation also passed.
  Final state restored zh-CN, Home, expanded sidebar, native viewport/DPR, zero scroll,
  zero dialogs/inert/editors and paused audio at zero. The debugging process exited and port
  9334 closed; the final executable then started normally without debugging.
- Full frontend regression passed 124 files / 1377 tests. Lint, Node 51 / Python 1 script
  checks, Windows native no-bundle build, document governance and diff checks passed.
  Worker/server/Rust business logic was unchanged in this pass; their complete suites were
  not rerun. The native build compiled the existing Rust code.
- Native coverage remains partial for the six generation-preference steps/final inspiration
  confirmation because current profile setup requires a write/skip; saved inspiration,
  dissection and draft results, draft editing and both discard confirmations because actual
  artifacts are absent; model preparation/download/failure states; missing signed-out,
  exhausted-balance, busy and failure states; and actual Markdown tables/code/Mermaid because
  saved summaries contain none. Component regression does not establish native display
  acceptance of these states. No paid generation, download, profile save, rename/membership
  mutation, transcript/draft save/export or deletion was performed. macOS, other displays,
  OS scaling changes and screenshot/pixel comparison remain unverified for this pass.

## Divider boundary acceptance — 2026-11-01

- Terminal summary/draft facts, inspiration introduction/summary groups, the final two profile
  fields, final account blocks and final inspiration/advanced settings blocks omit their
  trailing divider and extra bottom padding. Facts followed by actual disclosure/preferences,
  model information followed by progress, and update states followed by actions retain their
  information boundaries. Narrow account quota rows retain the separator between the two rows.
- History, note Collection choices and note information draw only row separators. Terminal
  information rows and rename guidance omit extra trailing padding/margin. Inspiration result
  lists and the actual final row of the dissection report omit trailing edges; the dissection
  single-column rule retains internal row separators. The outer Collection membership editor
  keeps its parent section divider and omits the child list's terminal divider.
- Related regression passed 18 files / 224 tests (160 shared-surface and 64 Collection checks).
  Lint, Node 51 / Python 1 script checks and the final Windows no-bundle build passed. The
  executable embeds `index-C7xJ9uFt.js` / `index-CzcoOzq5.css`. This CSS-only follow-up did not
  rerun the complete frontend, worker, server or Rust suites.
- [Final native boundary evidence](build/ui-surface-acceptance/divider-after.json) and
  [scope manifest](build/ui-surface-acceptance/divider-scope-manifest.json) record the final
  `C7xJ9uFt` / `CzcoOzq5` release build: 60 three-language groups across the four CSS sizes,
  totaling 240 cases (228 dialogs/settings and 12 outer Collection membership cases), 75 real
  wheel checks and 303 initial/end-of-scroll readings. Empty bands with duplicate region
  boundaries: zero. Seven internal row dividers clipped near fixed headers/footers during
  scrolling were identified as normal content boundaries and retained.
- Summary's terminal fact has zero bottom border and zero bottom padding; its footer keeps
  one 0.571429 CSS-pixel border at native DPR1.75 and body bottom inset stays 16px. Earlier
  facts, all six dissection preview rows followed by disclosure, the first four profile
  fields, interior history/information rows and Collection membership rows retain their
  separators. The outer Collection parent/list terminal boundary contains exactly one line;
  every membership checkbox remains unchanged.
- Native geometry was 1180×761/DPR1.75. The four sizes remain renderer emulation rather than
  OS resizing/scaling. Transcript, balance, action admission, audio identity/position/pause
  and save availability remained unchanged during reversible dialog checks. End state restored
  zh-CN, Home, expanded sidebar, original viewport/DPR, zero scroll/dialogs/inert/editors;
  the debugging process/port closed before the executable restarted normally.
- [Production signed-out browser evidence](build/ui-surface-acceptance/divider-signed-out-browser.json)
  records 12 actual three-language/four-CSS-viewport cases at DPR1 without an injected bridge.
  Keyboard loops, Escape, origin focus and inert restoration, contained geometry and no
  horizontal overflow passed. The real unavailable-native-service notice follows the account
  card, so the card/notice information separator and footer border remain. A terminal signed-out
  card without that notice was unavailable and is not claimed as runtime-verified. The harness
  restored its original language and closed the isolated headless browser and preview service.
- Source review covers every approved client surface and the outer Collection membership
  container. Native unavailable states remain: the six later inspiration steps/final confirm,
  saved inspiration/dissection/draft content and discard dialogs, model runtime/download/failure,
  absent account/busy/failure states, actual tables/code/Mermaid, macOS and other displays/OS
  scaling. Their rules and related component regression do not replace native acceptance.
  No screenshots or pixel comparison, generation, download or user-content writes were used.

## Remaining acceptance

- Activation of the revised detail actions has not been verified through native input. Their placement, outer-manager ownership, callbacks, focus restoration, and failure behavior are verified with rendered component tests.
- Native Collection deletion and the resulting preservation of task/media/result files have not been exercised through the desktop UI.
- The Collection `New note` workflow through real processing, automatic membership after completion, and membership-retry feedback has not been exercised natively.
- Complete native file selection, processing, cancellation, and edited-result acceptance remains separate from browser checks of unavailable native services.
- Full frontend regression at shared-surface completion passed 124 files / 1377 tests; the earlier native Rust suite passed 414 tests.
  Frontend lint, production/native no-bundle builds, document governance, and difference checks
  passed. Native menu opening, density, minimum-window visibility, and keyboard navigation are
  verified. Clipboard/opener actions, mutating menu flows, and macOS behavior remain unverified.
