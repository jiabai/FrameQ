# Sidebar Note Actions Implementation Plan

> After technical-plan confirmation, use subagent-driven development or executing-plans in the
> existing workspace. Preserve current UI and LLM-title changes. Work directly on main; no Git
> rollback or unsolicited commit.

## Goal and approval

Implement the seven-action sidebar menu, independent Pinned section, manual display names,
safe source/information actions, and confirmed permanent deletion with durable cleanup.
Spec: `docs/product-specs/2026-10-31-sidebar-note-actions.md`.

Requirements, Pinned semantics, and this written technical plan were confirmed by the user on
2026-10-31. Implementation is authorized under `WORKFLOW.md`.

## Architecture and interfaces

Rust owns a small settings sidecar inside each verified task directory, protected by the same
TaskLease used by processing and edits. History projects settings and per-note settings errors.
React composes a reusable note row, one viewport-bounded menu, and shared action sheets through
a task-bound controller. Existing Collection and deletion APIs remain integration boundaries.

The internal settings file is not an artifact/export:

```json
{
  "schema_version": 1,
  "task_id": "<verified task ID>",
  "pinned": false,
  "display_title": null
}
```

Closed requests update only the requested field after re-reading current settings:

```ts
set_note_pinned({ request: { task_id, pinned } })
rename_note({ request: { task_id, title } })
// Committed response:
{ task_id, note_metadata: { pinned, display_title } }
```

`get_note_info({request:{task_id}})` returns the verified fields in the spec.
`open_note_source({request:{task_id}})` revalidates canonical identity and invokes the native
opener. Clipboard copy obtains the current safe source from the information response. History
list/detail add closed `note_metadata` and `note_metadata_error` fields. Invalid sidecars keep
the note readable/deletable, report their error, and disable pin/rename without overwriting bytes.

Worker contract v10 and Python ProcessResult remain unchanged: the worker does not own these
settings. Current workflow state preserves the user override separately from generated titles.

## Progress

- [x] Read RULES.md, WORKFLOW.md, and the current sidebar/history/title/Collection/deletion modules.
- [x] Record confirmed menu order, independent Pinned semantics, and excluded feature code.
- [x] Inspect task ownership, manifest writers, source privacy, deletion guarantees, and UI guards.
- [x] Write product specification, technical tasks, and verification requirements.
- [x] 2026-10-31: The user confirmed this written technical plan and authorized implementation.
- [x] Implement and verify native settings persistence and history projections.
- [x] Implement and verify shared title precedence, sources, and real information.
- [x] Implement and verify sidebar rows, menu, Pinned group, rename, and Collection sheets.
- [x] Implement and verify shared delete confirmation and durable physical cleanup.
- [x] Run final gates/build and record actual acceptance evidence and remaining limits.

## Task 1: Task-owned settings

Files: new `app/src-tauri/src/task_manifest/note_metadata.rs`, new
`app/src-tauri/src/note_actions.rs`, `task_manifest.rs`, `task_manifest/access.rs`, `history.rs`,
`lib.rs`, and native tests beside these owners.

- [x] Add strict schema/version/task-ID validation and shared single-line/60-character title rules.
- [x] Distinguish absent legacy settings from malformed existing files. Preserve invalid bytes;
  return bounded NOTE_* invalid/unavailable/busy/read/write/storage errors without raw exceptions.
- [x] Add TaskEditSession pin/title methods using fixed filenames, no-follow/link checks, and
  `atomic_files::atomic_write`. Each command reads current settings and changes one field.
- [x] Project settings/error separately in list/detail; do not register sidecars as artifacts or
  include them in worker requests, account traffic, exports, or diagnostics.
- [x] Test actual write/reopen, interleaved updates, task mismatch, busy lease, file locks, directory
  links/hard links, and preservation through Python finalize and existing Rust title/transcript/draft writes.

## Task 2: Strict clients and shared title precedence

Files: new `app/src/noteActionsClient.ts` and tests, `historyClient.ts`, `workflowState.ts`,
`useTaskProcessingController.ts`, `useHistoryController.ts`, `shellNavigation.ts`, `HistorySheet.tsx`,
`App.tsx`, and dissection title projection.

- [x] Decode closed native DTOs, preserving the distinction between missing settings and read failure.
- [x] Apply user title > committed LLM title > existing fallback in every shared title consumer,
  including current toolbar and history/deletion descriptions.
- [x] Preserve user settings through title/AI completion, cancellation, history restore, and cached
  URL reuse. Apply committed changes only to matching task IDs in history and active workflow.
- [x] Invalidate earlier list/detail requests before applying mutations, then refresh real history.
  A late pre-rename response cannot restore an older title or pin state.
- [x] Test all title surfaces, legacy records, three locales, restart projection, and no checkout
  triggered by menu/history actions. Existing LLM provider behavior remains unchanged.

## Task 3: Safe sources and information

Files: `note_actions.rs`, SourceIdentity accessors as needed, `noteActionsClient.ts`, new
`features/notes/NoteInfoSheet.tsx`, source helper tests, and localized resources.

- [x] Implement task-ID-only information/open-source commands using verified saved canonical identity.
- [x] Preserve privacy/quarantine rules and required YouTube v/Bilibili p identity parameters. Never
  start source resolution, restore signed parameters, or accept frontend URLs/paths.
- [x] Await real clipboard/opener results. Disable both source items for local imports or missing
  safe identities; report success/failure only after actual results.
- [x] Show verified spec fields and omit unknown duration/size/modification fields. Test local imports,
  quarantined/invalid URLs, late task identity changes, and malformed information DTOs.

## Task 4: Note row, menu, and Pinned group

Files: `DesktopSidebar.tsx`, `sidebar.css`, new `SidebarNoteRow.tsx`, new `SidebarNoteMenu.tsx`,
and their tests. Reuse existing line icons and neutral styling.

- [x] Render sibling open/ellipsis controls with unique IDs for each Pinned/Notes instance.
- [x] Add Pinned before Notes, use verified state/current time sort, retain all ordinary Notes, hide
  the empty Pinned group, and keep its collapse state independent.
- [x] Portal one controlled menu outside sidebar clipping; measure/clamp it and close on anchor
  scroll/removal, outside input, resize, collapse, or accepted action.
- [x] Implement exactly seven actions, grouping, icons, disabled reasons, and red deletion styling.
  Add Enter/Space, arrows, Home/End, Escape, Tab, and originating-trigger focus restoration.
- [x] Verify duplicate task identity, unpin fallback focus, long titles, 720x640, and three locales.

## Task 5: Forms, membership, and action ownership

Files: new `features/notes/useNoteActionsController.ts`, `NoteRenameSheet.tsx`,
`NoteCollectionsSheet.tsx`, `App.tsx`, and existing common sheet/focus helpers.

- [x] Capture task ID, section, and trigger per action. Define read-only/mutating availability and
  recheck busy/dirty/deletion guards on submit/confirm.
- [x] Keep rename draft/error after failure. Cancel writes nothing. Dirty state blocks unrelated
  navigation without disabling the form's own Save/Cancel.
- [x] Read actual Collections and committed membership; serialize existing setMembership writes,
  preserve checkbox focus, and handle empty/loading/error/unavailable states.
- [x] Verify late mutation/info/source responses and deletion cannot alter another note or revive removed rows.

## Task 6: Permanent deletion and pending cleanup

Files: `history_deletion.rs`, new `history_deletion/intent.rs` and `storage.rs`, `collections.rs`,
`lib.rs`, history client/controller, shared `HistoryDeleteConfirmation.tsx`, and `App.tsx`.

- [x] Extract confirmation to a root host shared by history/sidebar independently of historyOpen.
  Name the note/files, focus Cancel, and recheck busy/dirty/stale-task guards at confirmation.
- [x] Reuse deletion/task locks and verified-tree checks. Add deletion-specific no-follow directory
  identity checks using the Windows volume/file-ID and Unix device/inode patterns in diagnostics/export.rs.
- [x] Prevalidate task/cache/Collection storage and fixed roots. Persist a bounded prepared intent
  with operation UUID, task ID, root/directory identities, and phase; derive all paths natively.
- [x] Atomically move only the main task directory into same-volume internal staging. Verify its
  identity before/after movement. This successful move accepts deletion.
- [x] If movement fails with original identity unchanged and no staged target, clear the prepared
  intent and return ordinary failure; cache and Collections remain unchanged.
- [x] After acceptance, stage associated task caches, remove the exact task ID from freshly read
  Collection memberships under COLLECTIONS_LOCK, atomically save them, permanently remove verified
  staged trees, and finish the intent. Pin/name settings disappear with their task directory.
- [x] Distinguish complete deletion from cleanup_pending in the closed result. Pending cleanup keeps
  the note unavailable, retains a retry/journal, and clears matching navigation and title/Collection intents.
- [x] Recovery handles only matching staged identities. Prepared + unchanged original + no stage
  is discarded as unstarted; a matching stage covers rename-before-phase-write crashes. Never delete
  a same-name replacement or use arbitrary journal paths. Root changes, conflicts, links, malformed
  or oversized journals fail closed. Protect pending task identities from conflicting mutations.
- [x] Add real filesystem/process checks for pre-acceptance move failure, crash windows, cache and
  Collection write failure, locked staged files, partial removal with missing manifest, repeated restart
  recovery, replaced directories/roots, links, and preservation of unrelated notes and concurrent memberships.
  Do not claim cross-directory/JSON deletion atomicity.

## Verification and delivery

- Run focused native/pure/React checks, then app test/lint/build and full sequential Rust tests with
  permissions required by the existing real watchdog fixtures.
- Run worker sidecar-preservation checks; run worker/ruff gates if their source changes. New temporary
  files stay under ignored build/. Add no fake provider or injected native success evidence.
- Run Node/Python script gates when their boundaries change, document governance, and git diff --check.
  Update DESIGN, ARCHITECTURE, SECURITY, and this plan with final behavior and actual results.
- Build using npm --prefix app run tauri -- build --no-bundle and verify source/resource consistency,
  available native menu flows, real settings persistence, and restart. Permanent-deletion verification
  uses isolated disposable fixtures; do not delete existing user notes or start supplier calls.
- Report passed, skipped/unavailable checks and residual risks. No release or Git commit is requested.

## Decisions and verification record

- 2026-10-31, User: Confirmed seven actions and independent Pinned entries; ordinary Notes retains all notes.
- 2026-10-31, User: Conversation/sharing features are excluded from code, not merely hidden.
- Planning: Use a task-owned sidecar so manifest reconstruction and LLM retries preserve user settings.
  Reuse native SourceIdentity, Collection commands, and deletion ownership.
- 2026-10-31, User: Confirmed the written implementation plan.
- Native settings/information: 11 focused command tests and the single-line title rules passed
  against real files, locks, junctions, and hard links. Pure protocol/React admission/workflow
  checks and 20 real Python TaskStore preservation cases passed without provider calls.
- Real controller/form integration and sidebar/menu/form/resource checks passed. All frontend
  type and i18n literal checks passed; production frontend build completed. Node script gates:
  51 passed; Python script gate: 1 passed; document governance: 0 errors, 0 warnings.
- 2026-10-31, User: Match the newly supplied menu image and left-align its text. Use its white
  panel, rounded corners, fine border/shadow, plain outlined icons, desktop row density, and full-width
  separators. The existing seven actions and deletion behavior remain the approved scope.
- Final frontend verification after the reference-menu styling: 115 files / 1,300 tests passed;
  `npm --prefix app run build` completed and the worker resource mirror is byte-identical to source.
  The menu stylesheet was checked together with the real App stylesheet for left-aligned labels
  and plain icons. No screenshot or vision-based verification was performed.
- Final native verification: 414 / 414 tests passed sequentially on Windows with permission for
  real test-process tree cleanup. The final deletion owner has 28 focused filesystem/process cases,
  including persistent Accepted classification after a successful move and later identity failure.
- Pending identities are protected after TaskLease acquisition for settings, transcript/draft
  reads/writes, AI retries, title cancellation, and URL/identity cache reuse. Collection writes check
  pending identity under their own lock. Prepared/unmoved tasks stay visible in list projection.
- All five nullable identity fields are required in the persisted intent. Missing fields, changed
  roots, stage replacements, malformed journals, and linked files fail closed without deleting a
  replacement. Actual restart-style reads and abrupt subprocess exit are covered by real fixtures.
- `npm --prefix app run tauri -- build --no-bundle` passed. The exact release executable at
  `app/src-tauri/target/release/app.exe` was reopened; its embedded frontend assets are
  `index-5r7HTVk7.js` and `index-BC33vv9b.css`. Native accessibility confirms the local history,
  Collection names/counts, independent note menu triggers, and empty Home after startup.
- Live OS clipboard/opener actions and mutating menu flows remain unverified in a native
  window. Native menu opening, density, boundary visibility, and keyboard/focus behavior are
  verified below. Real native file/command boundaries passed their tests. Unix/macOS-specific
  filesystem behavior was not executed in this Windows environment.
  No provider calls or user-note deletions occurred. No installer, release, or Git commit was created.

## Desktop menu density verification

- The menu uses a 224px panel, 14px text matching sidebar navigation, 16px icons, 34px rows,
  12px horizontal insets, and 12px corners. Four separators retain the confirmed action groups.
- The Windows profile reports AppliedDPI 168 (175% display scaling). The main agent inspected
  the actual native menu and the user's screenshot. Production CSS specifies menu text/icon sizes
  explicitly; there is no menu-specific transform, CSS zoom, or native zoom code.
- The stylesheet regression compares menu text with navigation text and row density with account
  actions. Focused menu tests: 23 passed. TypeScript and i18n literal checks passed.
- Updated native no-bundle build passed, and the exact executable was launched. The main agent
  inspected the actual menu beside sidebar text at normal window size, then used the native
  system Size operation to reach both minimum dimensions. After expanding the collapsed sidebar,
  the lowest visible note's menu remained fully inside the window with all seven rows visible.
- End/Home visibly focused the last/first row; Escape closed the menu and visibly restored the
  originating ellipsis focus. These checks use native input and screenshots, not a simulated bridge.
- The active Windows display profile uses 175% scaling. An independent 200% WebView page zoom
  and additional monitors remain unverified. No local note, Collection membership, or quota changed.
