# Sidebar Note Actions and Pinned Notes

## Status

The user confirmed the menu requirements and independent Pinned section on 2026-10-31.
The user confirmed the written technical plan on 2026-10-31 and authorized implementation.

## Sidebar and menu

- Every visible sidebar note has a trailing ellipsis button. Opening the note and opening its
  menu use independent sibling controls with their own accessible names and keyboard targets.
- Use the current neutral style, rounded corners, line icons, and dividers. The exact order is:

| Simplified Chinese | Traditional Chinese | English |
| --- | --- | --- |
| 固定到侧边栏 / 取消固定 | 固定到側邊欄 / 取消固定 | Pin to sidebar / Unpin |
| 重命名 | 重新命名 | Rename |
| 添加到合集 | 加入合集 | Add to Collection |
| 复制来源链接 | 複製來源連結 | Copy source link |
| 打开来源 | 開啟來源 | Open source |
| 笔记信息 | 筆記資訊 | Note information |
| 直接删除 | 直接刪除 | Delete permanently |

- Use a compact desktop menu with the reference's white surface, fine gray border, soft shadow,
  plain outlined icons, and left-aligned labels. At 100% page zoom use a 224px panel, 12px corners,
  14px text matching navigation text, 16px icons, and 34px rows. Use 12px horizontal row padding,
  a 10px icon-to-label gap, 4px vertical panel padding, and full-width dividers with 4px vertical
  separation. Measure logical CSS pixels independently from Windows display scaling. Pin has its own first group,
  followed by Rename/Collection, source actions, information, and deletion. The final action uses
  red text and a deletion icon.
- Conversation and sharing features are excluded from implementation. Add no related hidden
  control, placeholder, handler, API, localization entry, or dependency.
- Render one controlled menu outside the sidebar's scrolling/clipping region. Clamp its measured
  position to the viewport and allow internal scrolling. Close it on outside input, anchor scroll
  or removal, sidebar collapse, and viewport changes.
- Enter/Space opens the menu. Support arrows, Home/End, Escape, and Tab. Escape returns focus
  to the originating ellipsis; actions retain the exact task ID and originating section.

## Independent Pinned section

- Add `已固定 / 已固定 / Pinned` immediately above ordinary Notes, with its own collapse control.
  Hide this section when no verified pinned notes exist.
- Pinning adds a second entry in Pinned. Ordinary Notes continues to contain the same note.
  Both entries use one task ID, title, metadata, and action state.
- Unpinning removes only the Pinned entry. It preserves the note, files, title, and memberships.
  If its anchor disappears, return focus to the same note's ordinary Notes control when available.
- Both groups use the current creation-time sort and task ID as a deterministic tie-breaker.
  Pin state survives restart and history refresh. Expanding the collapsed sidebar restores note access.

## Manual names and persistence

- Rename sets a local user display-title override. All title surfaces use this priority: user
  title, committed LLM title, then existing transcript/source fallback. Include the active toolbar,
  history/deletion descriptions, Collection, Artifacts, and dissection confirmation.
- The saved value is trimmed, non-empty, single-line, and at most 60 Unicode characters. Reject
  control, format, surrogate, line-separator, and paragraph-separator characters. It never names a path.
- Store native-owned settings in the task's `frameq-note-metadata.json`, with exactly
  `schema_version`, `task_id`, `pinned`, and `display_title`. Legacy absence means unpinned/no override.
- Invalid settings are reported and preserved. They do not hide the saved note or its deletion
  action; pin/rename remain unavailable until settings can be read safely.
- LLM retries, cancellation, manifest reconstruction, transcript saves, and artifact writes preserve
  the sidecar. Menu actions perform no LLM call and consume no AI Credits.
- Rename failure retains its draft and error. Cancel discards only unsaved form input and restores
  focus. Dirty forms guard unrelated navigation while their own Save and Cancel remain usable.

## Collections, sources, and information

- Add to Collection shows real existing Collections and committed memberships. Reuse current
  local commands, serialize writes, and update only from committed responses. Distinguish loading,
  empty, unavailable Collection, read/write failure, and cancellation.
- Source actions re-read the verified saved SourceIdentity canonical URL. Never use a composer
  draft, abbreviated title URL, local path, or internal note link. Keep existing canonical platform
  parameters and privacy/quarantine rules; never reconstruct signed parameters, cookies, or credentials.
- Copy awaits clipboard success. Open invokes the native opener using a task ID; frontend code
  submits no arbitrary URL. Neither action starts worker source resolution.
- Local-file notes and notes without a safe canonical URL keep both source items disabled with
  a localized reason.
- Information shows verified existing fields: current title and origin, creation time, source
  type and safe URL/filename, processing/title state, known transcript language/engine, Collection
  names, available artifact types, and task ID. Omit unknown fields. Do not invent duration, size,
  modification time, or author data, or expose internal settings/manifests as artifacts.

## Permanent deletion and recovery

- Direct Delete opens an explicit confirmation naming the note and explaining permanent removal
  of local media, transcript, generated results, and task caches. Initial focus is Cancel. There
  is no recycle-bin or user restore feature.
- Reuse the history-deletion command, task ownership, safe-tree checks, playback release, and
  navigation invalidation. Recheck processing, model download, saves, drafts, dirty edits, Collection
  mutations, and task identity at confirmation time.
- Remove only the selected task's settings, files, caches, pin state, and persisted Collection
  references. Preserve all other notes and memberships.
- Use a deletion-specific journal and same-volume internal staging. Deletion is accepted only
  after the verified main task directory moves into staging. Before that point, failure preserves
  the original note and leaves cache/Collection state unchanged.
- After acceptance, cleanup failures return `cleanup_pending`, keep the note unavailable, and
  retain an explicit retry/restart continuation of the already confirmed cleanup. Do not report
  complete deletion or an ordinary unstarted failure while cleanup remains.
- Recover only matching staged directory identities within validated roots. Prepared intent with
  unchanged original identity and no stage means deletion did not start: discard that intent and
  preserve the original. A same-name replacement is never a deletion target. Normal history reads
  never batch-prune missing task IDs.

## Acceptance

- Verify three locales, exact seven-action order, independent controls, keyboard/focus, menu
  clipping/scrolling, 720x640, collapsed state, duplicate Pinned/Notes rows, and unpin focus.
- Use real filesystem checks for restart, interleaved pin/rename, unrelated writer preservation,
  busy ownership, links, failed replacement, deletion acceptance/recovery, persisted reference
  cleanup, and other-note preservation.
- Verify title precedence through actual history/current-task flows and source privacy at the
  native boundary. Treat actual UI, storage, and unavailable-service checks according to their
  real scope. Add no fake provider or injected native success as end-to-end proof, and do not
  permanently delete existing user notes for verification.
