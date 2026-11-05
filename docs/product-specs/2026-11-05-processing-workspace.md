# Processing Workspace

## Confirmed intent

The user approved the local `build/processing-design-preview/` webpage on 2026-11-05 and explicitly requested faithful integration into the desktop application. Its central task composition, spacing, colors, illustration, progress track, stage timeline, footer action, and next-use guidance are the visual reference.

## User experience

- During media processing, one centered workspace replaces the separate status banner and empty transcript workspace. It contains the note heading, safe source identity, current action, decorative paper/audio illustration, actual workflow progress, and three visible stages: media preparation, transcription, and cloud title generation.
- Preparing/downloading copy follows validated progress messages. Percentages describe overall workflow progress; unknown progress is indeterminate. Elapsed time is measured locally for the current processing attempt. There is no estimated remaining time or fabricated transcript increment.
- Platform subtitle detection and reuse have matching copy within the transcription stage. They do not claim that local speech recognition is running.
- The active stage and completed/pending stages use the reference's blue/green/neutral treatment. Cancelling remains visible until the existing controller receives the native terminal result. The cancel button is disabled during cancellation. Cancellation failure restores the active operation and its existing guidance.
- The reference's cancel confirmation is presented before invoking the existing cancel action. Title cancellation explains that the local transcript is retained. No confirmation or timer can manufacture a native cancellation result.
- Local failure presents the existing localized error guidance and sanitized technical details. Retry uses the existing submission checks, account/model checks and Collection submission path; editing the input uses the existing new-task action.
- Direct retry requires the retained composer to match the failed source. A released local-file selection or changed URL leaves the input-editing action available without submitting a different source under the failed task's identity.
- Once the local transcript is saved, it remains available in the existing reading workspace. During automatic title generation, the reference's processing composition displays above it, with cloud and one-Credit disclosure and a title-specific cancel action. Title failures and retries retain the existing notice and billing checks.
- Webpage and local audio inputs use source-appropriate copy and real stages. Webpages retain their three existing extraction stages and do not acquire an automatic media-title stage.
- Source rendering shows a safe platform/hostname or validated local display name. Raw URL credentials, query strings, local paths, and internal task identifiers are absent from the composition.
- Summary, mind map, and inspiration remain separately confirmed actions. The next-use area is informative; it does not start cloud work.

## Visual scope

- Preserve the current application sidebar, navigation, account identity, toolbar, and finished note reader.
- Port the approved central composition directly, including its responsive geometry and reduced-motion treatment. Preview controls and sample content belong to the reference webpage only.
- Bundle all copy for Simplified Chinese, Traditional Chinese, and English. Use the application's local font environment; rendering must not require a remote font request.
- Content and controls remain reachable at 720×640; long source names and English translations wrap without horizontal overflow.

## Acceptance

1. The real processing component reproduces the approved reference's central DOM and visual parameters.
2. Actual progress, source rendering, media/webpage stage mapping, cancellation, cancellation failure, local failure, title generation, and saved-note transitions have executable coverage using the real state projection and React rendering.
3. Frontend checks and documentation validation pass. Browser geometry verification uses the real component and stylesheet at representative desktop and narrow sizes.
4. Native worker contracts, data storage, account requests, LLM checkout, and process ownership stay with the existing controllers.
