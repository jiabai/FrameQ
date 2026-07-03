# Transcript Audio Review Editor ExecPlan

## Purpose

Turn the `完整文字稿` detail tab into a local audio review and correction surface. The user should be able to play the extracted audio, jump by transcript block, see playback-following highlight, edit text safely, and save the corrected transcript as the official file used by later AI整理.

This is a local-first feature. It must not upload transcript/audio data, add remote media lookup, or expose arbitrary file playback/writes.

## Progress

- [x] 2026-07-03: Product, architecture, security, and design boundaries documented before runtime work.
- [x] Worker emits optional transcript segment sidecar from valid SenseVoice/FunASR sentence timing.
- [x] Tauri exposes constrained transcript detail load/save commands.
- [x] Frontend removes transcript search and adds audio review/editor interaction.
- [x] Validation commands pass or residual risks are documented.

## Surprises

- 2026-07-03: `npm --prefix app run lint` is listed in the plan, but `app/package.json` does not define a `lint` script. Other frontend validation (`npm test`, `npm run build`, and Tauri no-bundle build) passed.

## Decision Log

- 2026-07-03: v1 uses segment-level timing only. No word-level timestamping, character-ratio timing, automatic split/merge, or old-task backfill.
- 2026-07-03: `speaker` is metadata only. Single-speaker, missing-speaker, and multi-speaker transcripts use the same time-based seek/highlight behavior.
- 2026-07-03: Saving edits updates the official transcript artifacts. Unsaved drafts may be copied, but export/location targets saved files and should ask the user to save first.
- 2026-07-03: Old tasks without segments degrade to audio plus full-text editing where possible, without click-to-seek.

## Plan of Work

1. Worker contract
   - Add `TranscriptSegment` data shape `{ id, start_ms, end_ms, text, speaker? }`.
   - Extract valid segments from SenseVoice/FunASR `sentence_info`.
   - Drop invalid/empty timing rows. If no valid segments remain, do not create a sidecar.
   - Write `<stem>_transcript_segments.json` next to transcript outputs when segments exist.

2. Tauri local IO boundary
   - Add `load_transcript_detail({ transcript_path, audio_path })`.
   - Return transcript text, optional segments, validated audio path, and original-backup status.
   - Add `save_transcript_edit({ transcript_path, text, segments })`.
   - Validate transcript/audio paths, reject unrelated files, create original backup once, write `.txt`/`.md`/segments, and update local history preview.

3. Frontend detail view
   - Remove keyword search and filtered transcript state from the detail modal.
   - Load transcript detail data when `完整文字稿` opens.
   - Render a compact native audio player above transcript content when audio is available.
   - Render segment blocks when segments exist; otherwise render a full-text editor.
   - Implement click-to-seek/play, timeupdate highlight following, edit pause, save, and resume-if-previously-playing.
   - Make copy use draft text and export/location require saved official text when dirty.

4. Compatibility and recovery
   - Keep old tasks readable/editable without segment metadata.
   - Keep audio-missing tasks editable.
   - Show recoverable errors for invalid paths, missing files, failed saves, and malformed sidecars.

## Validation

- Documentation
  - `python scripts\validate_agents_docs.py --level WARN`
  - `git diff --check`
- Worker
  - Segment sidecar is written for valid `sentence_info`.
  - Single speaker, missing speaker, and multiple speaker metadata all use timing only.
  - Invalid timing rows are dropped; all-invalid timing produces no sidecar.
  - `uv run pytest worker\tests`
  - `uv run ruff check worker`
- Tauri
  - Load reads transcript, optional sidecar, optional audio, and backup status.
  - Save creates original backup once and writes `.txt`, `.md`, sidecar, and history preview.
  - Path traversal, non-transcript file, unrelated audio, and empty text fail recoverably.
  - `cargo test --manifest-path app\src-tauri\Cargo.toml`
- Frontend
  - Search box no longer renders in transcript detail.
  - Audio player renders for validated audio.
  - Segment click seeks, plays, and highlights.
  - Playback crossing segment boundaries updates the single primary highlight.
  - Edit pauses audio and save resumes when audio was previously playing.
  - Old tasks without segments show audio/full-text editing without click-to-seek.
  - `npm --prefix app test`
  - `npm --prefix app run build`
