# Desktop Sidebar and Home Plan

This ExecPlan is a living document. Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective are updated as work proceeds.

## Purpose / Big Picture

Implement the approved FrameQ Home design in the existing Tauri application, keeping local processing and confirmed AI generation connected to their current controllers.

## Progress

- [x] 2026-10-30: Inspect RULES.md, WORKFLOW.md, visual references, desktop shell, history, media input, account types, and architecture/security boundaries.
- [x] 2026-10-30: Record the approved appearance, existing behavior, and additional capability decisions in the product specification.
- [x] Implement borderless FrameQ artwork, sidebar/toolbar, account menu, and responsive Home surface.
- [x] Restyle the real media composer with selection/removal, submission, and expansion behavior.
- [x] Connect Notes and Artifacts to real history, refresh history, and protect current tasks during navigation.
- [x] Run focused behavior tests, frontend lint/build, appropriate regression checks, and document validation. Validation: 90 frontend test files / 910 tests passed; TypeScript and i18n literal gate passed; frontend build and Windows Tauri no-bundle build passed; Node scripts 51 passed; Python scripts 1 passed; document governance 0 errors / 0 warnings.
- [x] Verify rendered Home geometry at 1734x907 and 720x640. Browser interactions preserve the URL draft through Notes/back, navigate Notes/Artifacts, and expand the composer to 400px and restore it with Escape. No horizontal document overflow at 720x640.
- [x] Capture the actual production Home and create reference/current comparison artifacts under `build/ui-redesign/`.
- [x] Verify native Collection creation, rename, adding an existing note, persistence across restart, opening the saved note, returning to the Collection, and removing membership.
- [x] Verify the production browser UI with 12 cases that use the actual signed-out and unavailable native-service states, without an injected IPC bridge, including stable pointer targeting across fresh page mounts.
- [x] 2026-10-30: User authorized persistent local Collections; recording stays deferred; additional source types, drag/drop, and a new file-size limit are excluded.
- [x] Implement Rust-owned atomic collection persistence and verified task membership commands. All 367 Rust tests passed sequentially with native child-process termination permissions, including real filesystem preservation checks.
- [x] Implement collection manager, sidebar history, task membership editing, and collection-aware navigation in three locales.
- [x] Verify Collection lifecycle against actual filesystem storage, including invalid names, stale task references, concurrent writes, and deletion preserving task artifacts.
- [x] 2026-10-31: Apply the confirmed `合集 / Collection` and `笔记 / Notes` terminology throughout shell copy.
- [x] Move Collection rename/delete actions to the outer manager and use New note / Add notes to Collection inside a Collection, with the membership action below the note content.
- [x] Connect a new note's real completed transcript to its originating Collection and verify account/model blocking, failed/cancelled processing, duplicate/stale results, membership failure/retry, deletion, and unmount boundaries in model/controller/component tests.
- [x] 2026-10-31: Frontend regression passed 98 files / 1039 tests, including 12 production-browser cases. Frontend lint, production build, document governance (0 errors / 0 warnings), and `git diff --check` passed.
- [x] 2026-10-31: Remove the top-right Settings button and its callback; retain bottom-left account-menu Settings. Dedicated toolbar/component and 14 real production-browser cases verify keyboard access, narrow layouts, focus restoration, and the remaining toolbar controls. The rebuilt native Home has no Settings button in its toolbar.
- [x] Rebuild the Windows application with `npm --prefix app run tauri -- build --no-bundle`, verify the executable contains the current production asset (`index-D57spE8D.js`), and launch that exact executable. Native accessibility confirms the revised sidebar glossary and preserved Collection names/counts; rendered component tests verify detail/outer-manager action placement and callbacks.

## Surprises & Discoveries

- Current input contracts support URL and a single local audio/video file. Recording, text/Markdown/image ingestion, and file drag/drop have no implementation.
- Collections uses a dedicated app-local metadata file. History supplies verified task identities and user artifact availability.
- Account has an email and authorization status, but no profile name or avatar. The display name can derive from the actual email; signed-out users receive localized guest copy.
- Existing history loads on sheet opening. A persistent sidebar needs a separate refresh entry point with stale-request protection.

## Decision Log

- 2026-10-30, User: Implement the selected image. New Note and Search stay removed, composer remains compact, and brand marks have no surrounding tile or border.
- 2026-10-30, User: Questions requiring confirmation wait until the user returns. Work that depends only on the confirmed visual target and existing product behavior continues.
- 2026-10-30, Codex: Work directly in the existing application on main, following the repository workflow. Existing media and worker contracts remain unchanged.
- 2026-10-30, User: Implement local collection CRUD and task membership. Recording stays deferred; additional input types and a new size restriction are excluded.
- 2026-10-31, User: Collection is `合集` in Chinese and `Collection` in English; Notes is `笔记`. Inside a Collection, use `新建笔记` and `添加笔记到合集`; rename/delete operate only in the outer manager.
- 2026-10-30, Codex: Use Product Design image-to-code, writing-plans, and subagent-driven development. Existing application files take precedence over prototype template initialization.

## Context and Orientation

- Spec: `docs/product-specs/2026-10-30-desktop-sidebar-home.md`.
- Integration: `app/src/App.tsx`, `app/src/App.css`, `app/src/features/window/`, `app/src/features/history/`, `app/src/features/workflow/`.
- New shell: `app/src/features/shell/` for presentation, navigation models, and styles.
- Localization: `app/src/i18n/resources.ts`, `shellResources.ts`, `workflowResources.ts`.
- Official artwork: `app/src-tauri/icons/Square310x310Logo.png`; derive the borderless mark from the existing project artwork.

## Plan of Work

1. Add behavior tests for navigation history, busy/dirty guards, history titles, and visible artifact projection. Test real pure models and actual rendered components without introducing mocked IPC responses.
2. Build independent shell and composer components with explicit callbacks. Keep file selection in the existing token-based boundary and keep all visible capability claims truthful.
3. Add non-modal history refresh, integrate application views, preserve task state on view changes, and retain existing deletion and AI confirmation sheets.
4. Replace decorative shell surfaces with the approved neutral styling. Verify Home and active task layouts at 1734×907 and 720×640 in all supported locales.
5. Run frontend checks, document governance, and relevant existing regression tests. Record actual results and any unavailable native platform verification.

## Validation and Acceptance

- Focused shell/composer/history tests, including keyboard selection and safe navigation state.
- `npm --prefix app run lint`, `npm --prefix app run build`, `npm --prefix app test`.
- `uv run python scripts/validate_agents_docs.py --level ERROR`, `git diff --check`.
- If script-consuming source changes affect script gates, run `node --test scripts/tests/*.test.mjs` and `python -m pytest scripts/tests`.
- Rendered comparison uses the approved latest image; native download/ASR/LLM actions must not be inferred from browser preview results.

## Outcomes & Retrospective

The confirmed layout, existing-capability integration, and local Collection persistence are implemented. Native Windows verification used real account and history data: Collection creation and rename, adding a saved note, restarting with membership retained, opening the note, returning to the Collection, and removing membership all completed successfully. Rust tests verify metadata writes and preservation of task/media/result files against actual filesystem storage.

The browser production build uses actual signed-out/unavailable native-service states, without injecting sample history or account data. Recorded geometry: sidebar 277.44px, composer 972x156 at x515.72/y282.17 in the 1734x907 viewport; the 720x640 viewport uses a 66px rail and a 614x156 composer with no horizontal document overflow.

The current Collection revision uses the confirmed glossary and separates outer management from note-level actions. New note uses the existing media submission controller, captures only its originating Collection, and attaches only an actually completed local transcript. Failed membership retains the saved note and retries membership without repeating processing. Matching note deletion, accepted history restore, explicit new-note reset, and sign-out clear the corresponding pending context.

All three previously residual native checks were closed on 2026-11-08 (evidence in `design-qa.md`). Revised detail-action activation (13 assertions) and native Collection deletion with task/media/result preservation (14 assertions) were verified through scripted native pointer and keyboard input on the Windows native build, with real Rust IPC writes and byte-level filesystem comparison. The `New note` → real web-page processing → automatic membership chain was verified by the user in a manual desktop session: the public article `https://mp.weixin.qq.com/s/uwOUu8X3OLQERlkv75mfrQ` completed as `web_page` task `20261108-145629-web-602ecab8a8b14291`, and the originating Collection went from 0 to 1 with that task id committed to `collections.json`; no AI generation or paid provider call was involved. The membership-retry failure path was never triggered and remains covered by component tests only.

The native build was rebuilt with `tauri build --no-bundle` on 2026-11-08 (9m37s, exit 0) so the executable, article extractor, and system WebView host all come from the same source revision. Before that rebuild, the 11-05 executable carried mixed-version bundled resources and rejected every web session with `WEB_STORAGE_FAILED` plus a `recovery_required` data-access state; clearing the orphaned `.frameq-system-webviews` workspace and rebuilding restored `dataAccess=ready`. These are host build-artifact issues, not product regressions. The current changes do not require a release, Git commit, server change, or worker/media-contract change.
