# Locus Design Guidelines

## Processing workspace

- The 2026-11-05 user-approved `build/processing-design-preview/` composition defines the active
  task surface: centered source card, current-stage copy, paper/wave illustration, workflow
  progress, three-stage timeline, compact cancellation action, and next-use guidance. Implementation
  is `features/results/ProcessingWorkspace.tsx` with its scoped stylesheet and three-language copy.
- Project actual worker progress as overall workflow progress. Measure elapsed time locally for
  the current attempt; unknown progress remains indeterminate. Render validated progress messages
  and the existing sanitized error presenter. URLs expose only platform/hostname; local files use
  their validated display names. Webpage/audio inputs have source-appropriate stages and copy.
- Cancellation confirmation invokes the existing owner and waits for the native terminal result.
  Disable the action while cancelling; a failed cancellation resumes the existing task state.
  Retry resubmits the current composer source through account/model and Collection checks.
- Automatic title generation identifies its cloud operation and one-Credit cost. Saved text stays
  readable below the task composition, using a keyed reader container that remains mounted when
  title generation completes, fails, or is cancelled. Completed/restored notes use the existing
  reading workspace without a local-completion banner. Existing title-recovery notices remain.
- Keep the existing application shell. Bundle copy locally, retain local font rendering, and honor
  reduced motion. Narrow windows scroll vertically without clipping their processing controls.

## Webpage note reading

- Home keeps its current greeting, composer and sidebar. The composer accepts existing video
  URLs, webpage URLs and native-authorized media files. Webpage routing precedes ASR readiness;
  its visible stages are Loading webpage → Extracting article → Saving note, with all three locales.
  The form and workspace accessibility labels include webpage notes. A recognized webpage input
  shows local-save and explicit-AI-billing copy; the media title-generation notice stays with media.
- Webpage submission enters the loading stage directly and uses the system WebView in an
  independent native helper. Missing/unsupported system capabilities use the existing failure
  state with translated recovery guidance. There is no webpage component preparation/download
  sheet. Startup and opening saved notes require no browser preparation.
- Webpage notes use the article reading workspace with formatted local Markdown, Copy article
  and Locate article actions. The note title, source and extraction time remain available through
  normal note information and source actions. Sidebar, Notes and Collection behavior stays shared.
- Summary, inspiration, dissection and draft retain their existing explicit AI confirmation,
  quota display and supplier disclosure. Source labels describe article text for webpage notes.
  A dissection reference opens and highlights the authoritative plain text; returning restores
  formatted reading. Media-specific playback, timestamps and transcript editing belong to media.
- A cleanup recovery state pauses data actions and exposes the existing storage recovery view.
  The application retains uncertain local material. Checking again in the same process cannot
  resume a quarantined library; controlled restart performs the ownership checks.

## Data storage settings and recovery

- Selecting a nonempty destination offers the existing migration confirmation with merge copy:
  existing relative-path filenames keep the destination file and remove the source file; missing
  files move to the destination. No duplicate list or additional duplicate confirmation is shown.
  `merging` displays real processed file/byte counts, prevents cancellation and provides continuation
  after failure. Error text describes retained recovery records without claiming removed originals
  are still present. An empty destination keeps the copy migration and optional old-copy cleanup.

- Preflight distinguishes waiting, inventory enumeration, source validation, integrity checking
  and destination checks. Unknown totals render an indeterminate indicator with actual discovered
  counts; known totals and large-file reads use measured file/byte progress. Cleanup uses its own
  title from entry, shows old-copy verification progress, then deletable files/bytes and retained
  count before confirmation. Cancelling keeps the operation frozen until real backend completion;
  stale replies cannot reopen a cancelled preview. Actual copy/delete events replace preflight
  progress, while non-cancellable commit and delete stages keep their existing controls.

- Settings → Basic contains one `数据存储位置 / 資料儲存位置 / Data storage location`
  row: title and current effective path on the left, `更改 / Change` on the right. Use 14px
  controls, 12/13px path assistance, the shared neutral sheet styles and a full-path tooltip.
  Long paths truncate within the row and wrap safely in details. The existing Cache category
  retains playback-cache management.
- Change opens the native folder picker and never submits Save configuration. Ordinary configuration
  saving manages the ASR model. Selecting a folder alone changes no active location; explicit
  migration confirmation follows the reviewed source/target inventory and space requirements.
- Preparing pauses new data actions and playback while already-started processing, title generation,
  automatic Collection membership, downloads and save/refresh work finish. Each dirty transcript,
  draft, name, Collection, setting or Inspiration Profile session supplies its own real Save and
  Discard actions. Discard needs confirmation; Cancel retains the buffer and exits preparation.
- The migration sheet uses the shared fixed header, scrollable body and reachable footer. Show actual
  source/target paths, scope, file/byte counts, required/available space, original-copy retention and
  restart requirement. Copying, integrity verification, publication and startup validation show
  genuine native progress; phase and closed errors remain separate.
- Precommit stages expose cancellation. Publication and committed states pause data access through
  restart verification. Interrupted Prepared operations reopen a real confirmation preview;
  resumable cancelled copies require explicit continuation and source revalidation. A recovered
  legacy-source ambiguity opens a native location picker without guessing the source directory.
- An installed app update completes its restart before a migration begins. Updates, normal close
  and storage restart follow native storage protection. The UI explains waiting, required restart,
  recovery and actual failure without marking an unfinished operation complete.
- Installed-update restart remains required after a failed relaunch. Ordinary close waits for the
  complete processing/title/Collection and save/refresh chains. Transcript inputs stay disabled
  during their real save, including when migration preparation has been cancelled.
- Normal/update relaunch calls guarded `restart_application`; storage completion uses its guarded
  storage restart command. Native preparation pauses new data work and releases the configuration
  process lock before restart. The process plugin is not registered.
- Locale initializes before the storage gate. Startup mounts notes, Collections and task views only
  after native Ready. Offline, invalid or replaced storage shows recovery with Check again and
  Locate existing data actions. A browser without the native bridge explains local storage
  unavailability and does not display an empty task library.
- Verified migration restores ordinary library use independently of old-copy cleanup. The optional
  cleanup action shows an exact confirmation; changed or unverified files remain and their retained
  count is visible. Source roots, external originals and fixed configuration remain protected.
- All storage labels, errors, status and accessibility text have Simplified Chinese, Traditional
  Chinese and US English resources. Focus remains in the active sheet; nested discard confirmation
  restores focus. Headers and footer controls remain accessible while the body scrolls at the
  existing desktop viewport sizes.

## Sidebar note actions

- Each note row has sibling open and ellipsis controls. The menu contains pin/unpin, rename,
  add to Collection, copy source, open source, note information, and red permanent deletion.
  Use a 224px white panel with 12px corners, a fine gray border and soft shadow. Match the sidebar's
  14px navigation text, use plain 16px outlined icons, 34px rows, and uniformly left-aligned labels. Separators
  divide pinning, name/Collection management, source actions, information, and deletion. The menu stays within
  the viewport and closes when its anchor disappears, scrolls, or becomes hidden.
  Dimensions use logical CSS pixels; verify the complete menu in the native window at the active
  Windows display scale. Raster-reference pixel dimensions do not determine CSS text size.
- Pinned is an independently collapsible group before Notes. Pinning preserves the ordinary
  Notes entry; unpinning removes only the pinned projection. Both use creation time ordering.
- Manual names are trimmed, single-line, at most 60 Unicode characters, and take priority across
  every note surface. Saving or cancelling a name remains available while its own draft is dirty;
  unrelated navigation and mutations respect ongoing edits, processing, and storage operations.
- Collection checkboxes show committed local membership and serialize writes. Information displays
  verified stored fields only. Local imports and unavailable canonical sources disable source actions.
- Permanent deletion shares one confirmation host across history and sidebar. It names the note,
  describes associated files, focuses Cancel, and rechecks availability and editing guards. Accepted
  deletion removes note visits; incomplete physical cleanup keeps an explicit retry notice.

## Note titles

- Before a new note is submitted, the composer explains that a transcript sample will go to the
  cloud LLM after transcription and each title attempt costs one additional AI Credit. File selection
  alone starts no generation. The disclosure is connected to the input and submit control for accessibility.
- Title generation follows local transcript persistence as a visible cancellable phase. The saved
  transcript remains readable; competing AI-generation actions are disabled until that phase finishes.
- Failed, cancelled, or interrupted title generation keeps the note available and shows a title-specific
  retry action with the cloud/cost disclosure. The request retains its captured output language.
- Saved titles are consistent in sidebar history, Notes, Collection, Artifacts, history management,
  the task toolbar, and dissection confirmation. Transcript previews remain separate. Titleless legacy
  notes keep their existing labels, and opening a view performs no title generation.

## Sidebar and Home

- Use the neutral gray persistent sidebar and toolbar with one almost-white rounded content surface.
  Keep Home, Notes, Collection, and Artifacts in that order. Simplified Chinese uses `主页`, `笔记`,
  `合集`, and `作品`; Traditional Chinese uses `主頁`, `筆記`, `合集`, and `作品`;
  English uses `Home`, `Notes`, `Collection`, and `Artifacts`.
- Home uses a local-time serif greeting, the actual account name derived from the email, and one
  156px-high media composer. The existing Locus blue artwork is a standalone transparent SVG with
  its outer whitespace cropped; never surround it with an icon tile, border, or shadow.
- Center the Home greeting and composer as one group within the content surface, with symmetric
  vertical padding and safe alignment so tall content remains reachable by scrolling. The composer
  input, file selection, recording labels, and supported-source guidance share a 15px font size.
- The file selection action uses the 18px outlined Upload icon with an upward arrow above an open tray.
- The sidebar owns the scrollable local Collection and Notes groups and bottom-fixed account menu.
  Notes and Artifacts use verified local history projections; Artifacts opens the owning task for existing
  result actions. Settings and account remain reachable through the bottom account menu.
- Home navigation preserves completed task results. Its composer can edit a separate source draft
  within the current workflow; the next explicit submission replaces the task only after account
  and model checks succeed. Back and forward preserve task and Collection identity and skip
  unavailable task visits while retaining the current workflow.
- Processing, cancellation, model preparation, transcript polishing/saving, and unsaved transcript
  edits protect task switching. A draft save carries its originating task ID; closing an unsaved
  draft requires an explicit discard decision.
- At narrow widths, collapse the sidebar to an icon rail. The task workspace switches to one column
  according to its available content width. Every action remains reachable at 720x640.
- Recording remains visibly unavailable. Supported inputs are the existing video links and local
  video/audio files. Document/image ingestion, drag/drop, clipboard files, and a new file-size limit
  are outside this change.

## Local Collection and Notes

- Collection metadata is owned by Rust and stored atomically in the current data root's `collections.json`.
  Names and membership remain local; the account service and AI do not receive them.
- The outer Collection manager owns creation, rename, and deletion. A row has an open action and
  sibling rename/delete controls. Deletion confirmation states that all notes and their media,
  transcripts, and generated files remain on the device.
- A Collection detail view shows its saved notes. Its header action is `新建笔记 / New note`, and
  its membership action below the note list or empty state is `添加笔记到合集 / Add notes to Collection`.
  Rename and delete controls belong to the outer manager.
- A note can belong to more than one Collection. Sidebar counts and detail lists project membership
  against verified local history; unavailable references never manufacture note records.
- Membership edits a grouping reference only. The Notes view and the sidebar Notes group keep the
  complete verified local history visible after a note is added to or removed from a Collection.
  Deleting a Collection leaves its notes visible in Notes.
- The add-notes chooser keeps every available note visible, including notes already in the current
  Collection, and labels those with an `已在此合集 / Already in this Collection` state. A committed
  membership change shows a local status message stating that the note stays in Notes, with an undo
  control that submits the opposite membership through the same committed path. The status clears
  when the selected Collection changes.
- Names are trimmed, non-empty, limited to 80 Unicode characters, and checked for control characters
  and case-insensitive duplicates. User-supplied names and note content remain unchanged by locale selection.
- New note opens the media composer with the originating Collection as a pending destination.
  Membership is added after a real local transcript is saved. Account/model gating, failure, and
  cancellation retain their existing behavior. A failed membership update keeps the saved note and
  offers an explicit retry; creating a note does not automatically generate AI results.
- Loading, mutation, error, and empty states remain distinct. Frontend membership changes follow
  committed native responses; async responses cannot replace a newer view or update an unmounted controller.
- Collection mutations and unsaved name edits protect navigation. Native acceptance records and
  remaining checks are maintained in [design-qa.md](../design-qa.md).

## Reliability Failure and Recovery UX

- A worker timeout or persistence-recovery failure must leave the current busy state and present one
  concise localized explanation plus the next safe action. Do not ask ordinary users to inspect
  JSON, find a PID, kill Python manually, edit task files, or choose between rollback files.
- Distinguish explicit cancellation, idle timeout, absolute execution timeout, save failure, and
  recovery failure. Do not collapse them into “unknown error” when a stable code exists.
- Process timeout offers retry/new-task behavior after the runtime confirms process-tree cleanup.
  AI timeout keeps the local transcript and previously committed target visible and lets the user
  choose whether to retry; copy must not imply an automatic retry or Credit refund.
- Model-download timeout returns to the existing downloadable/retry state and must not display a
  false completed or permanently broken model state.
- A transcript save may show success only after the complete task transaction commits. During
  automatic recovery, keep the task unavailable rather than briefly rendering a mixed revision.
- Primary guidance remains non-technical. Sanitized technical details stay in the existing collapsed
  disclosure and may show only stable codes/bounded safe diagnostics, never paths, request payloads,
  transcript text, prompts, generated text, or raw worker/OS prose.
- Persistence-recovery and worker-timeout behavior are implemented by their completed ExecPlans.
  Timeout copy must continue to use the stable localized recovery guidance; unavailable macOS
  watchdog runtime and real-Tauri interaction acceptance stay explicit residual validation rather
  than inferred passes.

## Local Media Input and Source-Aware Workspace

- Keep one input composer. Its keyboard-accessible file action opens the native single-file
  video/audio dialog directly. Cancelling the dialog changes no
  state and displays no error; choosing a file does not start processing or consume AI Credits.
- A selected file appears as a removable chip with media-kind icon, safe basename, localized size,
  and accessible remove action. Its presence makes the retained URL draft inactive; removal restores
  that draft. A replacement file replaces the chip, and locale changes clear neither source.
- The existing confirmation action and account gate start the active URL or local source. Dialog
  dismissal, chip removal, busy/disabled state, focus restoration, and composer Escape behavior work by
  keyboard and remain reachable at `720x640` in all three locales.
- Local progress is source-aware without inventing a second workflow. Video presents validation,
  copy, audio extraction/normalization, and transcription; audio presents validation, normalization,
  and transcription. Copy must consistently describe import/local processing, never remote media
  upload.
- Video completion names locally saved video, audio, and transcript. Audio completion names only
  audio and transcript, and an audio task does not render a disabled, placeholder, or unavailable
  Locate Video control.
- History rows identify local tasks using the safe basename and localized media kind, while URL tasks
  retain canonical URL presentation. Local source filenames remain user content: do not translate
  them, place them in locale resources, or send them to AI.
- Use the existing compact task workspace and artifact rows; the feature must not add decorative
  upload cards, drag/drop zones, batch queues, progress dashboards, gradients, or motion. Respect
  reduced motion and existing focus/color tokens.

## Desktop Language and AI Result Language

- Settings > Basic starts with `界面与 AI 结果语言` and offers Follow System, Simplified Chinese,
  Traditional Chinese, and English. Selection updates the visible UI immediately; only the latest
  failed save may roll back the optimistic choice and show a localized notice.
- A neutral startup shell contains only `Locus`. It must not flash one locale before the saved or
  resolved locale mounts, and preference recovery remains a non-blocking notice rather than a modal.
- The product glossary fixes `工作间 / 工作間 / Studio`, `本地文字稿 / 本機逐字稿 /
  Local Transcript`, `要点总结 / 重點摘要 / Key Summary`, and `启发灵感 / 靈感啟發 /
  Inspiration`. Traditional Chinese uses its own reviewed copy; runtime conversion is not allowed.
- `工作间` is the container. Its four tools are `要点总结 / 重點摘要 / Key Summary`,
  `文字稿解剖 / 逐字稿解剖 / Transcript Dissection`, `启发灵感 / 靈感啟發 / Inspiration`, and
  `生成文字稿 / 產生逐字稿 / Full Transcript`. The Mermaid mind map is an output of Key Summary,
  not a separate tool. In code they are the `StudioTool` union (`summary`, `dissection`, `insights`,
  `draft`); the desktop-worker contract carries the same value in its `target` field.
- Visible copy and `aria-label`/`title`/`placeholder` text resolve from feature namespaces. Progress
  and notices render from semantic codes so an on-screen message changes with the locale; raw worker
  prose is not primary UI copy.
- Summary and Inspiration confirmation surfaces show `本次输出语言` (localized) with the actual
  resolved locale name before the final action can consume AI Credits. Changing UI language after
  confirmation does not relabel the language requested by that in-flight generation.
- Known errors lead with localized actionable guidance. Allowlisted sanitized diagnostics may
  appear only inside a localized collapsed technical-details disclosure. Invalid progress events
  are dropped without changing visible state; structurally valid unknown codes use the matching
  stage/status generic fallback. Both paths record only a safe code and never render worker prose.
- At `720x640`, English expansion must wrap and scroll without horizontal overflow, clipped actions,
  or unreachable keyboard focus. Locale changes must not clear URL, ASR settings, storage confirmation, transcript
  edits, preference flows, current tasks, or existing AI results.
- `Locus`, `AI Credits`, ASR, LLM, Mermaid, model names, platform brands, paths, emails, user content,
  subtitles, transcripts, and historical AI results are not translated.

## Local Transcript and AI Workspaces

- After submission, place necessary processing, cancellation, and failure feedback before two
  domain workspaces. Omit the local-completion success banner entirely, including on restored
  history notes, so it reserves no space. Keep title and AI target progress/recovery feedback.
  The approved local webpage in `build/ui-workspace-preview/` supplies the visual parameters.
  One white workspace has a shared 54px title row and a thin vertical divider. Header and body
  share zero-gap tracks with a flexible local pane and initial AI width `clamp(280px,38%,620px)`,
  bounded by both panes' responsive minima and replaced by the preferred ratio after sizing. Narrow windows
  keep the columns. Preserve the existing sidebar and brand artwork.
- Both columns have no surrounding border, corner radius, or shadow. Left padding is
  16px 24px 0, right padding is 20px 24px, with 16px horizontal narrow insets. Player, segment
  list, feature list, and icons use whitespace and horizontal separators with no content frame.
- Use explicit CSS-pixel typography: shared note/AI titles 14px semibold; transcript text and AI
  feature names 14px; descriptions 13px; timestamps, state and supporting copy 12px.
  Transcript body line-height is 1.85. Actions are compact with at least 32px height, and
  segment edit controls are 24px with hover/focus visibility. Preserve visible keyboard focus.
- The local workspace places a compact audio bar first, a compact video/audio file-action
  row second, a bounded scrolling transcript segment review in the body, and a stable
  edit/save/copy/export footer. Media and transcript are not three large cards.
- Vertical wheel input over transcript whitespace, text, or time controls scrolls the available
  owner. The transcript scrolls internally first and chains to available column overflow at
  its upper/lower boundary. Allow its minimum height to shrink in short windows so fixed
  controls and required notices remain reachable. Preserve textarea scrolling, focus, and playback.
- Transcript segments use adjacent dividers. Playback uses a pale row background with an inset left accent, editing uses a
  contained white editor, and the external focus halo is reserved for keyboard focus.
- The local state row displays loading/saving/dirty state when needed and is absent for a
  normally saved transcript, including its container/spacing. Source metadata remains
  available. Player, lightweight file toolbar, and copy/save footer stay accessible in two columns.
- The AI workspace begins with actual balance and per-call charging guidance once, above
  four rows: summary, dissection, inspiration, and draft. Each retains its real status,
  confirm/retry/view actions, progress, errors, stale-result and seed guidance. Icons have no
  surrounding tile; names and states share a row. Existing confirmation and billing semantics apply.
- The workspace omits the persistent privacy paragraph and its top spacing. Privacy disclosures
  remain in generation confirmations with existing authorization and billing behavior.
- The shared left title uses the real note title and existing manual/generated/history priority.
  The shared right title uses the localized Studio name; inner workspace titles are omitted.
- Studio starts collapsed. Task navigation omits the duplicate note title in the outer toolbar.
- A fixed 30px PanelRightClose/Open button at the title row's right edge controls AI visibility,
  with localized show/hide labels, aria-expanded/controls, and focus recovery. The title and full
  AI pane keep their mounted state but become inert/aria-hidden while collapsed. Hiding never
  cancels or starts processing, writes a preference, or changes results/edits/playback.
- Both grids interpolate the second track to zero over 220ms; AI title/content fade over
  150ms and move 10px right over 220ms with delayed visibility hiding. The button stays fixed.
  Fast reversal continues from the current animation position. Reduced motion disables all
  pane and its toggle/icon transitions and switches immediately.
- The thin body divider has a transparent 12px pointer target with col-resize feedback. Dragging
  and keyboard sizing update both grids immediately. Both panes normally retain 280px; with
  less than 560px available they share the width equally and resizing is disabled. A local
  preferred proportion survives narrow/wide changes and whole-pane hiding/showing.
- The vertical separator controls the local pane and exposes its actual width percentage and
  bounds. ArrowLeft/Right move the boundary 10px; Home/End select local minimum/maximum.
  Pointer capture ends on release/cancel/lost capture, blur, resizing, and pane hiding. Escape
  during dragging restores the starting proportion. Other endings retain the last legal width.
- Workspace copy uses the current locale.
  Ready local and optional AI workspace badges are omitted; processing, failure,
  waiting, generating, and target-level lifecycle state stay available in their regions.
  Collapsing the AI region hides its presentation while retaining these states and operations.
- Pending and retry AI target actions use a quiet scoped secondary-blue treatment. The final
  confirmation-sheet submit remains the primary action.
- AI generation leaves the local workspace readable and playable while disabling transcript
  edit/save with `AI 正在使用已保存版本`. A target failure stays in that target card.
- `文字稿解剖` never auto-runs. Its confirmation shows frozen transcript facts, output language,
  deterministic call range, worst-case Credits, and the exact cloud-text disclosure. A generated
  card exposes only `查看结果`; its detail sheet renders the structured report, supports
  copy/export/`重新解剖`, and locates cited text only when Rust
  verified the current transcript and UTF-8 source ranges. Saving an edit keeps the former report
  visible as stale and disables location; a failed rerun also keeps that report available.
- AI copy says confirmation sends transcript fragments only and never implies video/audio upload.
- Do not use gradient backgrounds, glass stacks, decorative motion, equal-height filler,
  or a global loading card. Colors express state only: restrained success/local file colors,
  existing primary blue for AI actions, and restrained danger for errors. Respect reduced
  motion.

## Shared Client Surfaces

- Client confirmation, preference, result, draft, settings, account, model, history, and note
  sheets share `features/modal/sheets.css`. Use white surfaces, neutral 1px borders, 12px
  corners and one restrained shadow. Backdrops use a neutral tint without blur or gradients.
- Body text, actions, and form controls use 14px; sheet titles use 16px/600; section headings
  use 14px/600; descriptions use 13px and supporting text 12px. Preserve system font/scaling.
- Header, scrolling body, and footer are independent flex children. Content shrinks naturally;
  controls remain reachable in short windows. Standard insets are 20px horizontal/16px vertical,
  narrowing to 16px horizontally; buttons are at least 32px high with 30px icon controls.
- Facts, account/quota information, settings states, preferences, history, inspirations and
  dissection sections use labels, values, whitespace and dividers. Retain real option-group,
  table, code, editor and selected/disabled boundaries without nested decorative frames.
- Draw each region boundary once. Terminal facts, groups and list items omit trailing
  dividers and extra bottom padding/margins before the footer or panel edge. Preserve dividers
  between real content sections and rows, including account rows that become stacked in narrow
  windows. Multi-column groups omit the whole final row's trailing edges.
- Existing legal paths use `.sheet-path` for one-line ellipsis with the full original accessible
  text. Privacy, authorization, billing, error and progress explanations remain fully wrapping.
- Primary actions use solid blue, discard/deletion use explicit danger colors, and keyboard
  focus remains visible. Disclosure content and all business gates retain their ownership.
- Draft generation confirmation uses the shared AnimatedSheet/focus lifecycle. Draft close and
  regeneration use application confirmation sheets; cancel preserves the buffer/dirty state,
  saving blocks destructive routing, and stale task candidates cannot affect another note.
- Modal background inert state is shared by active owners, including overlapping exit/entry
  animations. Escape and focus return through the active layer without enabling its background.
- AI/draft fullscreens preserve data and editor modes. Long Markdown tables/code scroll inside
  their own boundaries; toolbar actions wrap in narrow windows and keep stable sizing.

## Desktop Density, History, and Toolbar

- Active-task layout follows a 24/16/12 rhythm: 24 px between major regions, 16 px between sibling
  workspaces, and 12 px inside domain modules. Tightly related status/title pairs may use 8 px.
- Shared `h1`/`h2` headings use weight 700, `h3` uses 650, and small eyebrow/section labels use no
  more than 700. `--text-soft` must remain readable at 0.72-0.78rem without competing with primary
  copy.
- History sheets use intrinsic height for short lists and the shared sheet max-height for long
  lists. Only `.history-list` scrolls when content exceeds the available height; tests must not
  assign a fixed sheet height to manufacture layout evidence.
- The account control is fixed at the sidebar bottom. Notes exposes saved local notes, its section plus
  starts a new note, and Settings remains in the bottom account menu. The temporary update
  action remains separate from persistent navigation.
- Short transcript content does not change the local workspace height strategy and must not be
  padded with decorative or equal-height filler.
- A History row with deletion support is a neutral card container containing sibling restore and
  delete buttons; interactive controls must never be nested. The 32px delete icon remains visually
  quiet until hover/focus and uses a native disabled state with readable reason copy during active
  processing, AI generation, cancellation, transcript save, or deletion.
- Permanent deletion always opens a focused confirmation dialog. Cancel receives initial focus;
  the red destructive action states `永久删除`, and the copy names video, audio, transcript, AI
  results, playback cache, immediate disk release, and irreversibility. Escape closes only the
  confirmation dialog.

## 2026-07-10 History Restore While Processing

- The history panel may stay open during a running, retrying, or cancelling task, but its task rows are visibly read-only native disabled buttons with a short explanation. Disabled rows must not be reachable as selectable controls by keyboard.
- The UI must not silently cancel a current task when a user views history. A history task can be restored only after the current task reaches a stable terminal state.
- Restoring a history task closes task-specific detail and AI-preference flows and clears transient notices before presenting the selected task. The result workspace must never visually combine artifacts or text from two tasks.

## 2026-07-05 Diagnostics UX

- The main task workflow should not add a new diagnostic panel for normal use.
- Failure copy remains concise and actionable in the existing result workspace.
- Local desktop logs are support evidence, not a result tile, export action, or task artifact.
- When a support flow asks for diagnostics later, it should point to the app-local log path rather than asking users to inspect bundled resources.

## 2026-07-05 Task Library and Artifact UX

- Result tiles should represent artifacts within the current task, not independent loose files.
- The primary locate action should reveal the task folder or the selected manifest artifact inside that folder.
- History should read as a task library: each row represents one processed source URL, with status, preview, artifact availability, and task folder context.
- Re-submitting the exact same URL may restore the newest usable local task immediately instead of showing another full download/transcription run.
- During active processing, the toolbar new-task/reset button must be disabled. The task monitor cancel button is the only control that may terminate the running worker.
- The UI should not mention or expose legacy flat output compatibility. New tasks always use the task folder layout.
- Export/location actions should use saved manifest artifacts. Unsaved transcript edits should still prompt the user to save before locating the official transcript.

## 2026-07-05 Subtitle Source UX

- Subtitle-first transcript reuse should be invisible in the main single-link workflow: no subtitle picker, no platform-specific tab, and no raw `.vtt` / `.srt` result card.
- During `视频转译中`, worker progress copy may say `正在检测平台字幕`, `已检测到字幕，跳过 ASR`, or `未检测到字幕，开始 ASR` while staying inside the existing transcription stage.
- The `完整文字稿` detail view may show a compact source line such as `来源：平台字幕（zh-Hans）` or `来源：本地 ASR`. It should not claim whether the subtitle was manual, automatic, or translated.
- Video, audio, and transcript entries locate their saved local files; the transcript entry also
  opens the readable transcript, and locating it is blocked while edits are unsaved; AI整理 shows
  summary, dissection, insights, and draft.

## 2026-07-03 Transcript Audio Review UX

- The inline `TranscriptReviewPanel` should omit keyword search. Its primary review tools are audio playback, block selection, direct editing, save, copy, export, and locating the saved transcript file.
- Place the native audio player at the top of the transcript detail content when a validated audio file exists. Keep it compact and persistent above the scrolling transcript blocks.
- Segment blocks should have stable height behavior, clear hover affordance, one primary selected/highlighted state, and a distinct editing state. Highlight should never depend on speaker count or speaker label.
- Segment blocks whose text is empty after trimming are hidden from the review list once they are not
  being edited. Their timing and segment records remain in controller state and persistence so audio
  alignment is not silently rewritten; an actively edited empty block remains visible until editing ends.
- Clicking a non-editing transcript block seeks to that segment and starts audio. Playback should advance the highlight to the next segment and keep the active block visible without abrupt layout shifts.
- Clicking a position inside the transcript text seeks to an estimated position within that segment's start/end interval; because the current contract has no word-level timestamps, this is proportional text-position mapping rather than word-accurate alignment. Clicking the segment time still starts at the segment start.
- Entering edit mode pauses playback and visually locks the edited block. Saving should show concise success feedback and resume audio only when it was playing before edit.
- Old tasks without segment timing should show a full-text editor and audio player when possible, with click-to-seek affordances hidden or disabled.
- If audio is unavailable, show a quiet local-file status while preserving text editing and save actions.
- Copy should use the current draft text. Export/location should use the saved official transcript and, when unsaved changes exist, prompt the user to save first.
- Settings describes audio playback copies as a rebuildable cache in the current data location. Its Cache category clears only that playback subtree and retains original task files; changing data location migrates it with other application data.

## 2026-06-29 YouTube Download UX

- YouTube support is invisible inside the existing single-link workflow: no YouTube tab, platform picker, stream picker, playlist queue, login prompt, or cookie prompt.
- The input accepts public YouTube watch links, `youtu.be` short links, and Shorts links, while rejecting playlist-only, channel, handle, music, lookalike-host, unsupported-scheme, and empty-short-link inputs before processing.
- Failure copy for `YOUTUBE_*` errors should say the content is not publicly accessible or no playable stream is available, then ask the user to retry with another public video.
- UI copy must not direct users to import cookies, log in to YouTube, solve CAPTCHA, or bypass age/member/private restrictions.
- Mermaid mindmap behavior is unchanged: YouTube transcripts may later generate a local `.mmd` file during AI整理, but the UI still only shows summary and insight content.

## 2026-06-25 Douyin Download Fallback UX

- Douyin share page fallback is invisible by default: the user still submits one URL and sees the existing `视频提取中` stage.
- Worker progress copy may mention `正在解析公开视频分享页`, `正在探测可用视频流`, and `正在保存最高质量视频` when the fallback path is active.
- MVP should not show a stream picker or ask the user to choose a resolution during processing. The default policy is to preserve the highest-quality local video by selecting the largest validated stream.
- If the largest stream fails and the worker retries a smaller candidate, progress copy should remain low-noise and say that Locus is retrying another available video stream.
- If all fallback candidates fail, the failure copy should explain that the public share page or playable media stream was unavailable, and should ask the user to retry with a public, authorized link.

## Account and Entitlement UI

- The toolbar exposes account status as a compact utility control, not as a marketing banner.
- Update availability appears as a compact toolbar utility only when action is needed; it must not replace the task monitor or interrupt URL input.
- Login and activation-code monthly pass flows use sheet-style panels consistent with settings/history.
- Browser deep-link return from login must restore and focus the existing desktop window so the account sheet is visible without the user hunting for Locus.
- Account copy must clearly distinguish local processing from server-side account and entitlement verification.
- Submitting a URL is blocked only when the user is not signed in or does not have an active entitlement; missing LLM config or exhausted LLM quota must not block local video/audio/ASR processing.
- Retrying summary or inspiration generation opens the account sheet and does not start worker processing when the user is not entitled, LLM config is missing, or LLM quota is exhausted.
- The account sheet shows remaining LLM API-call uses when the user is signed in.
- Desktop settings must not expose insight LLM provider, base URL, API key, model, or timeout; those fields are administrator-managed.
- Desktop settings should expose the app-local `.env` path for non-LLM local settings and provide a locate-file action.
- Desktop settings should include an `应用更新` section with manual check, low-noise status copy, progress, `一键升级`, `稍后提醒`, and `重启完成更新` actions.
- Update installation waits for worker processing, model/component downloads and storage maintenance. Storage preparation waits for an already-running update and requires an installed update's restart before migration.
- The account sheet shows email login, activation-code monthly pass redemption, monthly pass expiry, and remaining LLM API-call uses in a stable layout.
- Successful activation-code redemption opens or extends the monthly pass and returns the user to the existing processing workflow without changing the local-first worker UI stages.
- The desktop UI exposes no purchase entry. Monthly passes are opened and extended with activation codes; the unused WeChat purchase channel was removed on 2026-11-08.

## Admin Web Compensation UI

- Admin Web should expose manual compensation as a compact support operation, not as a public pricing or sales surface.
- User rows should make current entitlement expiry, quota limit, used quota, and remaining quota easy to scan before adjustment.
- Compensation controls must require a reason and should support a short optional note for bug ID, release version, or support context.
- Additive operations should be visually distinct: "延长天数" and "增加 LLM API 调用次数" should not look like destructive overwrite controls.
- After saving, the row should show the refreshed expiry and remaining quota, plus a short success or validation message.
- Recent adjustment history should be visible to the administrator so repeated compensation can be spotted before applying another change.

<!-- 由 vibe-coding-launcher 生成。 -->

## Product Shape

Locus 是安静、清晰、可扫描的工具型桌面应用。首屏直接展示 URL 输入，不做营销式首页。

## Interaction States

UI 必须围绕以下状态组织：

| 状态 | 展示原则 |
|------|----------|
| `等待输入` | Home 内容区显示问候语与紧凑媒体输入区域，提供链接输入、选择文件、展开和明确提交操作；显示已有合集来源时保留新笔记的目标合集 |
| `正在取消` | 保留当前任务、URL、阶段进度和结果区，取消按钮显示“正在取消”并禁用；等待 worker 或模型下载给出真实终态 |
| `视频提取中` | 隐藏输入区，展示下载、校验和音频提取进度 |
| `视频转译中` | 展示 ASR 进度、当前 ASR 模型识别文案，以及模型缓存/加载状态 |
| `工作间生成中` | 左侧继续展示可阅读、可回听但不可编辑的已保存文字稿；右侧对应工具卡片显示生成中 |
| `文字稿完成` | 直接展示文字稿校对工作区和工作间；保留需要处理的错误与恢复提示 |
| `部分完成` | 保留文字稿和已成功生成的 AI 产物，要点总结/灵感卡片展示失败态和重试入口 |
| `失败` | 展示结构化错误原因、重试入口和可修改 URL 路径 |

## UI Rules

- `要点总结` 的独立 AI 详情 sheet 必须通过经净化的 GitHub Flavored Markdown 渲染器展示 `summary.md`；不得渲染 Markdown 中的原始 HTML 或 Mermaid 源码。
- 主按钮文案固定为 `确认`。
- 处理和完成态不再显示 URL 输入区域。
- 完成态主界面以同一 taskId 展示两个领域工作区：左侧直接承载视频/音频操作与文字稿校对，右侧承载工作间里的四件工具 `要点总结`、`文字稿解剖`、`启发灵感`、`生成文字稿`，各自是一张独立的工具卡片。
- 文字稿直接在左侧工作区审阅，不进入共享 Tab；AI 结果可打开各自的轻量详情 sheet，不与文字稿共用容器。
- AI 详情 sheet 内部内容独立滚动，支持 `Esc` 关闭。
- AI 详情 sheet 与 `生成文字稿` 结果 sheet 都提供全屏切换：展开后接近视口尺寸，再次点击恢复常规尺寸，关闭 sheet 时重置。
- 复制按钮只复制当前工作区或当前 AI 详情的文本；无内容时置灰。文字稿校对区底部的「复制当前内容」复制编辑器里的当前文本，包含尚未保存的修改。文字稿工具栏的「复制文字稿」复制磁盘上 `transcript.txt` 的内容，与编辑器里未保存的修改无关；存在有效的整理稿（`transcript/polished.txt`，且其记录的原稿摘要仍匹配）时优先复制整理稿。该按钮在无整理稿时显示为「整理文字稿」，点击直接开始 LLM 中度整理（修正识别错误、删除口头语与无意义重复、按语义分段，不改事实不换实词；未登录或额度不足时先打开账号面板），整理中禁用校对区编辑并显示忙碌态。校对区保存成功后重新判定整理稿状态，按钮在同一次保存内回到「整理文字稿」。
- 导出按钮在对应 artifact 生成前置灰；启用后定位当前任务目录中的正式 artifact。文字稿校对面板不设导出入口：定位 `transcript.txt` 只由工具栏的「定位文字稿」承担，面板底部只保留「复制当前内容」与「保存」。
- 进度区优先展示 worker 事件中的具体阶段文案；没有事件时回退到当前阶段默认文案。
- 任一 AI target 待生成或失败时，点击卡片先打开各自确认流程；`要点总结` 确认后只生成总结和隐藏 Mermaid mindmap，`启发灵感` 确认后只生成灵感，`文字稿解剖` 确认后只生成结构化解剖报告。它们都不重新下载视频、重新提取音频或重新转写。Mermaid 文本只写入本地文件，不在 UI 中展示或渲染。
- 取消任务只在处理中显示；点击后先显示“正在取消”并保留当前任务和 operation ID，直到 worker 或模型下载确认取消后才返回输入态并保留刚提交的 URL。
- 取消信号发送失败时必须恢复可观察的原处理态并显示简明错误；自然完成或失败与取消竞争时，真实终态优先显示，不能被“正在取消”覆盖。
- 左下账号菜单提供设置入口；设置面板管理本机 ASR、数据存储位置和固定 `.env` 配置文件位置，AI 结果 LLM 由服务端管理员配置。
- 顶部工具区提供历史入口；历史面板展示最近任务列表，支持查看可用结果和定位输出文件。
- 设置基础页包含 ASR 模型、数据存储位置和本机配置文件路径；release UI 显示 SenseVoiceSmall 与 SenseVoiceSmall-ONNX 的安装状态，但不提供独立下载入口。缺失模型在用户提交已验证任务时显示下载进度，成功后自动继续原任务。
- 设置面板必须提示：这里只管理本机配置；AI 整理确认面板负责提示文字稿片段会发送到管理员配置的云端 LLM 服务。
- 设置面板和历史面板内容必须在弹窗内部独立滚动，不能因字段或记录过多而被裁切。
- 数据存储位置显示原生返回的当前有效根；必要时补充旧输出来源。更改经过预检、明确确认、复制核对、原子保存和重启验证，完整保留已有资料与任务身份。普通「保存配置」不写入目录。

## Visual Direction

- 工具型桌面应用优先信息密度、清晰层级和稳定布局。
- 避免装饰性 hero、卡片堆叠、纯氛围图和大面积单色渐变。
- 固定格式控件应设置稳定尺寸，避免状态文案导致布局跳动。

## Desktop Window and Workspace Direction

- 应用外层采用浅灰侧边栏、紧凑 toolbar 和近白色圆角内容区；任务状态与结果显示在内容区中。
- Tauri 主窗口应使用自定义 chrome：禁用原生 decorations，由应用内 toolbar 承担窗口标题栏视觉，并设置可拖拽区域。
- toolbar 空白区域必须能触发 Tauri 窗口拖拽，窗口控制按钮分别接入关闭、最小化和最大化/还原窗口动作。
- 自定义 chrome 所需的 Tauri v2 capability 必须显式授予最小窗口权限：`core:window:allow-start-dragging`、`core:window:allow-close`、`core:window:allow-minimize` 和 `core:window:allow-toggle-maximize`。
- Windows/WebView2 下拖动应包含手动 fallback：按下 toolbar 时记录窗口和鼠标屏幕坐标，移动时通过本项目 Rust command 设置窗口位置，避免 `start_dragging` IPC 时机不稳定导致无法拖动。
- toolbar 左侧提供侧边栏收起、返回和前进按钮及当前页面名称，右侧提供更新与窗口控制；设置入口位于侧边栏底部的账号菜单。
- 等待输入态使用 156px 高的媒体输入区域，底部提供选择文件、当前不可用的录制语音与展开操作；有效输入可通过带有 `确认` 无障碍名称的箭头按钮明确提交。
- Home 保留衬线问候语和独立蓝色品牌符号；隐私、本地处理和云端 LLM 提示放在设置面板或任务过程文案中。
- 首页输入框不展示单独的 `视频 URL` 可见 label；使用 placeholder 和无障碍名称表达输入含义。
- 提交链接或本地媒体、恢复已有本地笔记后，显示对应任务的实际结果；等待输入时保留清晰的媒体输入区域。
- 媒体输入区域最大宽度为 972px；720x640 窗口使用 66px 侧边栏图标区域，内容与全部操作保持可访问。
- 处理态将必要状态反馈放在结果工作区上方；完成态直接展示结果工作区。
- 处理态使用 task monitor：阶段 timeline、百分比、worker 事件文案和取消按钮必须在同一信息层级内可扫描。
- 完成态使用同一个工作区和细竖线分栏，共享标题行显示真实笔记标题、工作间及固定的收起按钮。窄窗口保持左右分栏；收起后左栏占满宽度，工作间保持挂载和业务状态，约 220 毫秒平滑收起并支持快速反向切换。共享标题、正文与功能名 14px，功能说明 13px，时间与辅助信息 12px。成功完成提示不渲染元素，也不占用布局空间；处理中、取消中、失败和部分完成的必要反馈继续显示。
- 设置面板沿用主界面的白色平面分区、细线、紧凑表单、本地隐私提示、内部滚动和独立底部操作区。
- 历史面板使用紧凑列表：状态 badge、摘要、时间、输出目录和结果数量/错误码必须可快速扫描。
- 历史卡片主标题必须区分文字稿预览与来源 URL fallback，最多显示两行；卡片按内容自然高度排列，单行标题不得为视觉等高预留第二行空白。截断内容仍需通过原生可访问文本和 `title` 保留完整值。
- 历史卡片元信息在宽布局固定为“时间 / 可省略输出目录 / 结果数量或错误码”三列；窄布局将输出目录移到第二行，状态和结果项不得因长路径或长标题溢出、重叠或漂移。
- 视觉 token 优先使用浅中性背景、系统字体、1px 边框、低阴影、短反馈动画和清晰 focus ring。
- 不使用装饰性 3D、背景大渐变、漂浮色块、营销 hero 或会削弱工具可读性的强氛围图。

## Personalized Insight Preferences UX

- `启发灵感` 个性化入口遵循 `docs/product-specs/2026-07-06-personalized-insight-preferences.md`。
- `我的灵感档案` 是一次性、本地持久的长期背景设置；首次使用启发灵感时可设置或跳过，之后不在每次生成中重复询问。当前档案严格只包含角色、职业领域、年龄/阶段、城市语境、性别/视角和常用平台六项，不展示表达风格或避免方向。
- `本次生成偏好` 固定为 6 步逐步选择：本次目标、使用场景、关注角度、目标受众、表达风格、避免方向。
- 表达风格和避免方向只在本次 6 步生成偏好中出现；设置页、档案表单、档案摘要和确认页长期背景区不得重复这些标签。
- 6 步生成偏好全部使用选项控件，不能出现自由文本输入。
- 每一步只呈现当前选择问题、选项、返回和下一步动作，避免在一个面板里堆完整表单。
- 本次生成偏好 Step 1-5 必须选择，未选择时 `下一步` 禁用；Step 6 `避免方向` 可跳过，未选择时 `完成选择` 仍可用。
- 启发灵感确认页先以较强层级展示 `本次生成偏好`，再以安静的次级分组展示六项 `长期背景`；常用平台与本次使用场景语义不同，可以同时出现。确认页同时展示额度消耗和云端 LLM 数据提示；额度文案应说明 `1 次额度 = 1 次云端 LLM API 调用尝试`，本次生成会按实际 LLM 调用次数扣除，而不是按一次确认固定扣 1 次；已发起的 LLM 调用失败、超时、不可解析或导致部分失败时，对应额度不自动返还，`换个方向` 后再次确认会按新的调用次数再次扣除。
- 生成后的灵感详情应展示 `灵感`、`匹配理由`、`启发问题` 和 `适合用途`，而不是只展示问题列表。
- `换个方向` 只重新打开本次 6 步生成偏好，不重复要求用户填写长期档案。
- 设置面板提供 `编辑灵感档案` 和 `清空灵感档案`，并说明该档案仅保存在本机；清空只影响未来生成，不改变已保存的完整生成默认偏好或历史任务快照。

## Error Copy

错误信息必须可行动：说明失败阶段、失败原因、用户能否重试，以及是否保留了已有产物。

## Server Web Pages Design System

Server 端渲染页面（`loginPage.ts` / `dashboardPage.ts` / `adminPage.ts`，对应 `/login` `/dashboard` `/admin`）是独立的设计系统子域：**不得从 `design-system/globals.css` 或 `site/` 导入 token，server 网页只使用本节的 `var(--fq-*)` 集**。规范核心是一组共享模块，而非在每个页面内联样式。

### 共享模块（唯一来源）

- `server/src/designTokens.ts`
  - `designTokenCss()`：输出 `:root { --fq-* }` 块，是全部颜色/字体/圆角/阴影/focus 的唯一真相来源。主色固定为品牌蓝 `--fq-primary: #0066cc`（与 `design-system/globals.css` 文档值一致）。
  - `basePageCss()`：输出共享元素底样式（`*` / `body` / `input` / `button` / focus ring）。
  - 每个页面 `<style>` 顶部必须注入 `${designTokenCss()} ${basePageCss()}`，并删除页面内各自的 `:root` / `*` / `body` / `input` / `button` 重复底样式。
- `server/src/pageChrome.ts`
  - `brandChromeCss()`：输出 `.brand-row` / `.brand-mark` / `.eyebrow`。
  - `renderBrandMark()`：渲染装饰性 `FQ` 品牌 tile（`aria-hidden="true"`，产品名由标题承担）。
  - `renderFrameHeader({ title, eyebrow?, subtitle?, titleId?, rightHtml?, wrapperClass? })`：渲染标准 `<header>`（品牌行 + 可选右侧动作槽）。四个页面 header 必须全部改调它，不得再手写品牌行。

### 硬规则

- **单一调色板**：新页面/区块一律消费 `var(--fq-*)`，禁止引入第二套颜色字面量（尤其不得混用 Ant Design 蓝 `#1668dc`、近黑按钮 `#171717` 等历史值）。
- **主操作色统一**：login / dashboard / admin 的主操作按钮均为 `--fq-primary`，跨页不得变色。
- **无装饰渐变 / 3D / 漂浮色块**：延续桌面与营销站规则，`admin` 登录页不得再使用 `linear-gradient` 氛围底。
- **字体栈统一**：经 `--fq-font` 注入，禁止在单页写死 `-apple-system` 等局部字体栈。
- **表格可读性**：长列表使用 `.table-wrap--scroll`（`max-height` + `overflow:auto` + sticky `thead th`）；斑马纹与行 hover 由 token 驱动，不得逐表硬编码。
- **隐私优先**：server 网页不加载 analytics / 第三方字体 / tracking，与营销站一致。

### 变更契约

修改 server 网页样式时，先改 `designTokens.ts` / `pageChrome.ts`，再回填页面；不要反向在页面里新增字面量。新增 server 页面必须 `import` 这两个模块，不得重建内联 `:root`。
