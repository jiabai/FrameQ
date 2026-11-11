# Desktop Sidebar and Home

## Status

Confirmed visual target, existing workflow integration, and persistent local Collections management.

## Visual target

- The approved FrameQ Home image uses a neutral gray sidebar and toolbar surrounding one large almost-white rounded content surface.
- The sidebar contains Home, Notes, Collection, and Artifacts, followed by separate Collection and Notes history groups. Simplified Chinese labels use `主页`, `笔记`, `合集`, and `作品`; Traditional Chinese uses `主頁`, `筆記`, `合集`, and `作品`; English uses `Home`, `Notes`, `Collection`, and `Artifacts`. New Note and Search are absent from the sidebar header.
- The account control stays at the bottom with an avatar, display name, email, and account menu. Account information comes from the current account; the illustration's Aaron and email are sample content.
- Home contains a serif greeting, the supplied blue FrameQ symbol, and one wide composer. Its height is approximately 70% of the original reference composer. Preserve the selected compact composition, ample empty space, and restrained typography.
- Center the greeting and composer together horizontally and vertically within the Home content surface. When the group exceeds the available height, keep its beginning reachable by scrolling. The input, file selection, and recording labels use the same 15px font size as the supported-source guidance at all window sizes.
- Both brand symbols show only the blue artwork. No rounded-square tile, outline, or shadow surrounds the symbols.

## Existing capabilities

- Home accepts supported public or authorized video links and a single local video or audio file, reusing the Rust-owned media selection token and current account/model checks.
- Choosing a file does not start processing. A selected file can be removed, restoring the retained URL draft. Submission remains explicit and keyboard accessible.
- Notes presents actual local history and opens the existing task workspace. Processing, transcript editing, saved files, AI confirmation, cancellation, recovery, deletion confirmation, and export remain available.
- Artifacts groups existing user-facing artifacts by their parent task. Opening an entry restores that task through the current history detail boundary; raw paths and internal manifest files are not displayed.
- The sidebar refreshes from local history on startup and after stable task changes. Loading, empty, and unavailable states are distinct. Failed reads never manufacture history records.
- Account, Settings, and updates remain reachable. Localized application copy supports Simplified Chinese, Traditional Chinese, and English. Navigation titles and related guidance use the product glossary in the selected language.
- Settings opens from the bottom-left account menu. The top toolbar retains navigation, update, and window controls.

## Interaction requirements

- Navigation preserves the current workflow and draft state. Navigating to Home does not silently reset the task. Starting another task uses the existing guarded reset action.
- Active processing, cancellation, model download, transcript save, and unsaved edits prevent destructive task switching. The visible processing workspace remains available throughout a busy operation.
- Sidebar collapse is reversible and keyboard accessible. At 720×640 the sidebar starts collapsed; all content and actions remain reachable without horizontal overflow. Large screens use the approved sidebar proportions.
- Back and forward controls navigate actual visited application views. Disabled controls expose their state. Home, Notes, and Artifacts do not create cloud requests or trigger AI generation.
- The composer supports expansion and restoration. Local file errors use the existing localized recovery messages.

## Local Collection

- Collections are app-local metadata owned by Rust and stored atomically in `collections.json` under app-local data. No collection names or memberships are sent to the account service or AI.
- Users can create, rename, and delete a collection, and add or remove an existing local task. A task can belong to multiple collections.
- Membership changes only a grouping reference. The Notes view and the sidebar Notes group always project the complete verified local history; adding a note to a Collection never removes it from those lists, and removing it from a Collection never deletes the note. Deleting a Collection keeps every note visible in the Notes view.
- The add-notes chooser lists every available local note, including notes already in the current Collection. Already-included notes stay in the chooser with a visible state label. After a membership change commits, the Collection view states that the note stays in Notes and offers an undo action for that change. The confirmation is local, makes no account or AI request, and clears when the selected Collection changes.
- Collection names are trimmed, non-empty, at most 80 Unicode characters, and reject control characters and case-insensitive duplicates. Opaque collection IDs never derive from user names or paths.
- Collection membership uses verified task IDs. Stale references to deleted or unavailable tasks do not create visible task records or prevent access to other collections. Reading collections projects memberships against current verified local history.
- Deleting a collection removes only its grouping metadata. It never deletes, moves, or modifies task/media/result files. The UI states this explicitly before confirmation.
- The sidebar shows real collection history and note counts. Collection opens the outer manager; selecting a sidebar collection opens its actual note list. Back and forward preserve collection identity.
- Create, rename, and delete Collection actions belong to the outer manager. Every list row has an independent open action and sibling rename/delete actions; interactive controls are never nested.
- Inside a Collection, the primary header action is `新建笔记 / New note`. The empty/list membership action is `添加笔记到合集 / Add notes to Collection`. Collection rename/delete actions do not appear inside its note view.
- New note opens the existing media composer and retains the originating Collection as a local pending destination. A successfully saved local transcript is added to that Collection after real task completion. Account/model gating and failed/cancelled processing never create an invented note or membership. No AI generation starts automatically.
- Keyboard access, cancellation, loading, errors, and busy/dirty navigation guards remain available in all three locales. User-supplied Collection names and note contents are preserved verbatim.
- Mutations are serialized in Rust. Read/validation/write failure keeps the previously committed metadata unchanged and returns stable non-sensitive error codes. Frontend state updates only after the committed response; late responses and unmounts are protected.

## Input scope

- Home keeps the existing supported video links and local audio/video inputs.
- Recording remains deferred and is shown as unavailable.
- Plain text, Markdown, image/OCR, drag/drop, clipboard-file import, and a new 50MB limit are outside this change.

## Acceptance

- The Home composition follows the approved reference, with borderless blue symbols, compact composer, four sidebar destinations, two history groups, and bottom account control.
- Existing URL/local media submission and task result operations retain their lifecycle and privacy boundaries.
- History, navigation guards, account display, locale changes, keyboard access, and narrow-window layout have executable verification.
- No worker/server contracts, model download policy, billing rules, or media upload boundaries change.
- Collection creation, rename, membership changes, persistence across reload, duplicate/invalid names, stale task references, and deletion preserving task files have executable verification using actual local storage.
- Executable verification covers a membership change leaving the note in the Notes view, the already-included state appearing in the add-notes chooser, and the confirmation with its undo action in all three locales.
