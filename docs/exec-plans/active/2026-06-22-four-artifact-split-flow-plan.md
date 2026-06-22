# Four Artifact Split Flow Plan

## Goal

Expose video, audio, transcript, and insight outputs in the desktop result workspace while splitting the local media/transcript flow from the LLM insight-generation flow.

## Progress

- [x] Update product, architecture, and design docs for four result artifacts and the two-confirmation workflow.
- [x] Add frontend regression coverage for `generate_insights=false`, four result cards, media path preservation, and history restoration.
- [x] Update the workflow state model, worker client, and UI result cards for video/audio location and insight confirmation.
- [x] Update Tauri fallback result shape and skip server-managed LLM checkout env for transcript-only processing.
- [x] Run final validation gates and record outcomes.

## Decisions

- The homepage `确认` starts only video download, WAV extraction, and ASR transcription.
- Video and audio are viewed by locating their local files; no in-app media player is added.
- Audio remains in the configured work directory and is not copied to `outputs/`.
- Insight generation starts only after a second confirmation from the result workspace.
- Account/month-card gating still applies before both flows, but only insight generation requests server-managed LLM checkout and consumes one insight quota use.

## Verification

- `npm --prefix app test` — passed, 56 tests.
- `npm --prefix app run build` — passed.
- `cargo test --manifest-path app/src-tauri/Cargo.toml` — passed, 25 tests.
- `uv run pytest worker\tests` — passed, 76 tests.
- `python scripts\validate_agents_docs.py --level WARN` — passed, 0 errors and 0 warnings.
