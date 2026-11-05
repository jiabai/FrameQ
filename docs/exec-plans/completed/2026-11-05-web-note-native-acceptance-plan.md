# Web Note Native Acceptance Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Complete the user-requested public WeChat article through the native application, saving its full extracted article and opening the saved note. Keep the existing anonymous WebView session, local storage ownership, and atomic-save rules.

## Progress

- [x] 2026-11-05: Inspect the native extraction, task identity, save receipt, and Worker contracts. Validation: the actual system WebView extracted 42,777 UTF-8 bytes from the requested article.
- [x] 2026-11-05: Add a real-system integration test for the requested address and confirm the timestamp format against the installed time library. Validation: native extraction and source validation succeeded; the standalone library check identified the required standard year range.
- [x] 2026-11-05: Use the supported version 2 date-format description and add a deterministic timestamp regression test. Validation: `cargo test --manifest-path app/src-tauri/Cargo.toml web_page -- --nocapture` passed 17 tests, with 13 opt-in native/network tests ignored by default.
- [x] 2026-11-05: Rebuild the native application and submit the address through its actual Windows input. Validation: `tauri build --no-bundle --debug` passed; the UI showed 70% extraction, 90% saving, and the saved article reader for task `20261105-075425-web-38f1f9ba745d41bf`.
- [x] 2026-11-05: Verify complete saved text, Markdown, history reopening, and session cleanup. Validation: the final real-system integration test passed with title, final-section, author-biography, and END assertions; `verify-artifacts.mjs` confirmed matching 42,777-byte TXT and Markdown body across independent native runs, valid schema-4 metadata, and an empty native-session cache.
- [x] 2026-11-05: Complete script and documentation checks, record acceptance, and archive this plan. Validation: JavaScript scripts 55 passed; Python scripts 1 passed; documentation validator and `git diff --check` passed.

## Surprises & Discoveries

Evidence: the installed `time` 0.3.49 library formats the fixed timestamp correctly with format-description version 2 and standard calendar years. The existing task-identity shape requires four-digit years and zero-padded fields.

## Decision Log

Decision: Keep `YYYYMMDD-HHMMSS-web-16hex` task identities and use the supported version 2 format description. Rationale: this uses the current time library's standard calendar-year formatter without changing Cargo features or the persisted task contract. Date/Author: 2026-11-05, Codex.

Decision: Run the supplied address through both the real native integration test and the actual application input. Rationale: the former exposes precise component errors, while the latter verifies the user's complete flow. Date/Author: 2026-11-05, User + Codex.

## Outcomes & Retrospective

The requested article completes native loading, extraction, atomic saving, and reader display. The actual saved title is “Harness 已经很准了，为什么还需要一个 Agent Native Database”; its TXT contains 17,469 Unicode characters (42,777 UTF-8 bytes), and Markdown contains 43,467 bytes. Manifest status is completed with no error; model and transcript are null. The independent real native integration test also reopens identical TXT/Markdown content. Markdown parsing found no executable HTML, image nodes, or unsafe URL protocols. The application remains open on the saved article. All listed local checks passed. Residual risk: macOS and installer packaging were not rerun; the existing frontend large-chunk build warning remains.

## Context and Orientation

- Spec: `docs/product-specs/2026-11-01-web-page-notes.md`.
- Native operation and tests: `app/src-tauri/src/web_page.rs`, `app/src-tauri/src/web_page/tests.rs`.
- Native receipt: `app/src-tauri/src/web_page/session.rs`.
- Worker save: `worker/frameq_worker/web_page_storage.py`.
- Local evidence: `build/processing-web-native-acceptance/` (ignored).

## Plan of Work

Factor the production timestamp-to-task-identity operation into a small function, use the supported version 2 date-format description, and exercise the same function with a fixed UTC date. Run the exact supplied article through the existing real native extraction and persistence path. Rebuild and submit the article in the actual desktop application, then compare the article files, manifest, and reader state.

## Concrete Steps

- `cargo test --manifest-path app/src-tauri/Cargo.toml web_page -- --nocapture`
- `cargo test --manifest-path app/src-tauri/Cargo.toml real_system_webview_requested_wechat_note_is_saved_and_reopened -- --ignored --nocapture`
- `npm --prefix app run tauri -- build --no-bundle --debug`
- `python scripts/validate_agents_docs.py --level ERROR`
- `git diff --check`

## Validation and Acceptance

The generated identity matches the existing timestamp and hexadecimal-suffix contract. The supplied public article produces a completed web-page task, exact TXT/Markdown content when reopened, no ASR result, and a fully released native session. The actual desktop application displays the saved article after submission.

## Idempotence and Recovery

Each real submission creates a separate snapshot. Integration tests use unique directories under the ignored project build directory. Normal app submissions use the configured data root and retain the existing ownership checks and transaction recovery.

## Artifacts and Notes

Record actual task IDs, article sizes, native accessibility evidence, and validation output under `build/processing-web-native-acceptance/`. Do not include article content in source-controlled diagnostics.

## Interfaces and Dependencies

No protocol or dependency change. Keep the existing system WebView helper, bundled Python save process, task manifest schema, local history, and cancellation behavior.
