# LLM Note Titles

## Status

Automatic LLM title generation follows transcription and consumes one additional AI Credit. The Home composer omits the title-generation disclosure paragraph.

## User-visible behavior

- A newly created URL or local-media note automatically generates its title after the authoritative transcript has been saved successfully.
- The Home composer does not display the automatic-title cloud-call and extra-Credit paragraph in Simplified Chinese, Traditional Chinese, or English. Controls do not reference the removed paragraph through accessibility descriptions.
- The title uses the UI language captured at submission. Changing the interface language during processing does not change that request's output language or translate an already saved title.
- The title is a concise description grounded in the transcript: normally 12–24 Chinese characters or at most 10 English words. The persisted value is trimmed, non-empty, single-line plain text with at most 60 Unicode characters. The model receives an explicit title-delivery schema; empty, malformed, over-limit, or control-character output fails validation without an automatic repair call.
- Title generation is a visible processing step with cancellation. The note is considered fully complete only after this step succeeds. Notes with an already saved transcript remain available if title generation fails, is cancelled, or cannot start because quota is unavailable.
- Title failure displays a localized explanation and an explicit retry action. Retrying performs one new managed call with its own checkout identifier and the same cost disclosure. A failed attempt never invents a generated title or removes the transcript.
- Once committed, one saved title appears consistently in the sidebar, Notes, Collection note lists, Artifacts groups, task toolbar, and history-management/deletion descriptions. Transcript preview remains separate from the title.
- Existing notes are not bulk-renamed or charged when the app starts or history refreshes. Reopening a note, editing a transcript, and reusing an existing URL task do not automatically generate another title. Existing notes without a generated title retain their current display behavior.

## Billing and privacy

- A title attempt performs at most one supplier LLM call. The existing managed provider checks out configuration once for that call and consumes one AI Credit under the current success/failure billing rules. There is no automatic retry, corrective agent turn, or extra finishing call.
- Local transcription can finish when no AI Credits remain. Quota failure prevents the title call and is shown as a title-specific failure with the saved transcript preserved.
- Use the configured LLM provider and existing credential/checkout mechanism. No new provider, server endpoint, pricing rule, or server payload containing note content is introduced.
- Only a bounded transcript-derived sample and title instructions go directly to the supplier. Sample selection covers the beginning, middle, and end deterministically, with at most 12,000 Unicode characters in total. Source URLs, local file names/paths, video/audio, account details, preferences, and unrelated AI artifacts are excluded from the prompt.
- Generated titles and generation-state metadata remain in the local task manifest. Titles, transcript samples, prompts, raw exceptions, and supplier responses are excluded from account-server requests and diagnostics.

## Persistence and compatibility

- Store the title as optional validated task metadata, not a task ID, directory name, file name, or derivative of the media path. Renaming a title never moves task files or changes Collection membership.
- The optional `note_title` object contains exactly `text`, `status`, `output_language`, and `error_code`. Status is `generating`, `completed`, `failed`, or `cancelled`; completed state requires a validated title and no error. Failure or cancellation can retain the last committed text. Interrupted generation is retryable after restart without an automatic call.
- Preserve task schema version 3 compatibility by accepting an absent title in existing manifests. Present-but-invalid title metadata is rejected explicitly. Existing finalization, summary generation, transcript saves, and draft saves preserve a previously committed title.
- Publish a validated title and its completed metadata atomically through the existing task mutation owner. A storage error or cancellation preserves the last committed task state and is reported visibly.
- Extend the versioned desktop-worker contract, Rust result/history projections, and TypeScript decoders together. Closed-shape validation remains enforced at every current boundary.
- Bind progress and completion to the originating task and active operation. Late responses, a second submission, navigation, cancellation, and remounting cannot rename another note or trigger duplicate checkout.
- A task-owned cancellation record can be committed before title-worker admission without a checkout. Its expected metadata must still match; otherwise the current committed state is returned without modification.

## Acceptance

- A real new local-media note and a real new URL note each show the disclosure, save the transcript, perform one title attempt, show progress, and persist the title across app restart.
- Simplified Chinese, Traditional Chinese, and English all show the correct title language and disclosure. Every note-title surface agrees on the persisted value.
- Offline validation covers absent legacy metadata, empty/over-limit/control-character output, invalid result shapes, and title preservation through unrelated task updates.
- Actual filesystem checks prove that failed replacement, cancellation, linked paths, and stale task identity cannot damage transcripts, existing titles, artifacts, or Collection membership.
- Quota failure and supplier failure leave a usable transcript and explicit title retry state. Opening or refreshing history never performs a checkout.
- Real-provider verification reports actual calls and AI Credits used; unavailable external verification remains explicitly unverified. No mocked provider, invented generated output, or injected native bridge counts as end-to-end evidence.
