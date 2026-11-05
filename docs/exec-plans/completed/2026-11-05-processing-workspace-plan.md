# Processing Workspace Implementation Plan

## Approval and source

The user approved `build/processing-design-preview/` and instructed precise integration on 2026-11-05. This request authorizes implementing the confirmed visual design. Product intent: `docs/product-specs/2026-11-05-processing-workspace.md`.

## Goal and approach

Integrate the approved central task composition into React using the existing workflow, cancellation, retry, and title controllers. Keep application navigation and saved note reading intact. A scoped stylesheet owns the reference geometry; a presentation model projects actual workflow data and safe source labels; bundled localization owns visible copy.

## Tasks

- [x] Inspect the approved reference, rules, workflow, architecture/security boundaries, current task rendering, and required gates.
- [x] Record the confirmed product intent and implementation plan before application edits.
- [x] Add failing coverage for workflow projection and React interactions: media/web stages, progress, safe source identity, cancellation wait/failure, retry and title behavior.
- [x] Implement `ProcessingWorkspace.tsx`, its small workflow projection, and scoped reference styles in `app/src/features/results/`.
- [x] Add and register `processingResources.ts` with matching three-language keys and resource checks.
- [x] Integrate the composition in `App.tsx` before the saved note workspace, removing duplicate busy/failure surfaces for the covered phases.
- [x] Run focused and full frontend tests, lint, build, documentation validation, and real-component browser geometry/interaction verification.
- [x] Record review, completed validation, and remaining native/platform limits; move this plan to completed.

## Decision log

- 2026-11-05: The approved webpage is the visual authority. Preserve the existing application shell and use scoped reference styles for the task area.
- 2026-11-05: Display numeric worker progress as workflow progress. Measure elapsed time locally; do not add backend duration fields or estimates.
- 2026-11-05: Retain immediate access to saved source text while title generation is active. Its cancellation and billing remain with the existing title controller.
- 2026-11-05: Keep the current media/webpage input boundaries and localized error presenter. The original reference's sample URLs, account data, progress values, and state switcher are excluded from production.
- 2026-11-05: Preserve the same keyed reader container during title generation and completion. A real React mount/state test verifies reader and interaction-state continuity.
- 2026-11-05: Require the retained retry source to match the failed task, including a current local selection and an unchanged normalized URL. Platform subtitles receive their own transcription copy.
- 2026-11-05: Match the original local font sequence and the final computed values of the approved reference. Keep container-aware wrapping where the existing application's sidebar changes the available width.

## Validation

- Focused workflow/component/lifecycle tests: 16 passed. Resource completeness and localization tests: 12 passed.
- Frontend lint: passed, including TypeScript and localized-copy checks.
- Final full frontend suite: 135 files, 1502 passed and one skipped.
- Production frontend build: passed. The existing large-bundle warning remains; this task does not alter chunking.
- Documentation validator: `python scripts/validate_agents_docs.py --level ERROR` passed with zero errors/warnings. It executes the same standard-library-only validator as the documented uv command.
- Real-component browser verification: 150 combinations of five viewports, three languages, and ten processing/source scenarios passed. No horizontal overflow, inaccessible footer actions, or runtime exceptions. Cancellation invokes its owner once and requires external state changes; saved text remains reachable, retries remain explicit, and reduced motion is respected.
- Reference fidelity: 25 selected nodes and 21 computed-style properties match at 1280, 1440, and 1920px, apart from the intrinsic width of the real source title. At 720/1024px the application's existing sidebar controls available width; the narrow stage strip uses container-aware padding and spacing.
- Acceptance source/report: `build/processing-component-acceptance/` (ignored); production components and styles are imported directly. Source states come from actual workflow reducers. These checks do not claim native Worker execution.
- Read-only independent review completed; source matching, subtitle copy, reader lifecycle, and scoped style rules have regression coverage or browser verification. `git diff --check` passed.
- Windows native acceptance (2026-11-05, explicitly requested video `RmnWHz8HD74`): rebuilt the current native application with `tauri build --no-bundle --debug`, submitted through the real native input, and completed a new download/ASR task. Real UI showed the new processing composition and ASR progress before returning to the saved transcript workspace. Task `20261105-071421-youtube-RmnWHz8HD74` is completed with no error, ASR engine `iic/SenseVoiceSmall-onnx`, 86:01.61 media/audio duration, 15,085 transcript words, and 300 verified timestamped segments. Automatic title generation completed. Actual artifacts and evidence are recorded in `build/processing-native-acceptance/` (ignored).
- Native runtime preparation: refreshed the ignored source/debug bundled yt-dlp package to the already-locked `2026.10.21`, verifying its wheel SHA-256 against `uv.lock`. Worker source mirror hashes match the canonical worker files. No downloader source, account checks, or security boundaries changed.
- Windows native webpage acceptance (2026-11-05): the explicitly requested WeChat article completed through the actual application input. The processing composition showed extraction at 70% and saving at 90%, then opened the saved article reader. Task `20261105-075425-web-38f1f9ba745d41bf` contains 42,777 UTF-8 bytes of plain text and 43,467 bytes of Markdown; source/title, complete article text, parsed Markdown safety, independent native integration-result equality, and session cleanup were verified. Evidence is in `build/processing-web-native-acceptance/` (ignored). Native task-identity validation is documented in the dedicated web-note acceptance plan.

## Residual risks

Windows native download/ASR and automatic title generation passed for the requested video; native extraction, saving, and reading passed for the requested webpage. Installer packaging and macOS rendering were not rerun; ASR accuracy was not evaluated sentence by sentence. Existing worker/native/server contracts are unchanged. The production build retains its existing JavaScript chunk-size warning.
