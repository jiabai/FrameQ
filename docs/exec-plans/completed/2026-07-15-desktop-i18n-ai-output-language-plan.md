# Desktop i18n and AI output language Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

FrameQ users can switch the desktop UI among Simplified Chinese, Traditional Chinese, and US
English, or follow the operating-system language. The setting works offline, applies immediately,
survives restart, and does not reset local work. Before a user confirms Key Summary or Inspiration,
the confirmation surface shows the actual language that the new AI result will request. Existing
video, audio, subtitles, ASR transcripts, history, and AI artifacts remain unchanged. The feature
adds no translation service, automatic language retry, LLM call, or AI Credits charge.

## Progress

- [x] 2026-07-15: Added failing frontend and worker contract tests, observed the expected v1 failures,
  then raised the shared contract to strict v2 with required AI output language and structured
  progress registries. Validation: `npm --prefix app test -- src/desktopWorkerContract.test.ts`
  passed 8/8; `uv run pytest worker\tests\test_contract.py -q` passed 9/9 after RED results of
  4/8 and 4/9 failures respectively.
- [x] 2026-07-15: Audited synthetic Rust model-download cancellation and top-level file-name
  semantics, then added `model.download.cancelled` and moved basename-only validation to
  `current_file` without a duplicate message arg; the five emitted model statuses are also a closed
  enum. Validation: focused Vitest and pytest produced expected 2-test RED and then 1-test RED cycles,
  each followed by passing 8/8 and 9/9 suites after the matching contract update.
- [x] 2026-07-15: Published the product spec, ADR, governance index entries, and draft-language future
  requirement. Validation: `python scripts/validate_agents_docs.py --level WARN` passed with 0 errors
  and 0 warnings; `git diff --check` passed.
- [x] 2026-07-15: Applied specification-review corrections for persisted-value rollback, active-plan
  discovery, History chrome/content scope, and the complete progress-event sensitive-content denylist.
  Validation: denylist tests first produced expected RED results of Vitest 1 failed / 7 passed and
  pytest 1 failed / 8 passed; after the contract update Vitest passed 8/8, pytest passed 9/9,
  governance validation reported 0 errors / 0 warnings, and `git diff --check` passed.
- [x] 2026-07-15: Closed the AI request declaration, added typed/ranged progress argument schemas,
  and made model-download code/status/current-file rules a discriminated declaration. Validation:
  contract tests first produced expected RED results of Vitest 4 failed / 5 passed and pytest
  4 failed / 6 passed, then passed 9/9 and 10/10 after the shared JSON update.
- [x] 2026-07-15: Added bundled i18next resources, locale resolution and formatting, neutral bounded
  startup, app-local preference recovery, system-locale observation, and sequenced optimistic saves.
  Validation: focused startup/locale suites passed, Rust preference tests are included in 133/133,
  and `npm --prefix app run build` passed.
- [x] 2026-07-15: Migrated app-owned UI, accessibility, progress, notifications, known errors, and
  optional allowlisted technical details to render-time semantic localization. Added three-locale
  resource parity and production AST/CJK gates. Validation: `npm --prefix app test` passed 488/488,
  `node --test scripts/tests/*.test.mjs` passed 22/22, and the production literal gate passed.
- [x] 2026-07-15: Threaded mandatory confirmation-time `output_language` through TypeScript, Rust,
  Python, summary, Mermaid, topic planning, and structured Insight prompts without adding detection,
  translation, retry, or supplier calls. Validation: Rust 133/133 and worker 363/363 passed; fake
  clients and the browser command ledger covered all three locales and frozen/current retry behavior.
- [x] 2026-07-15: Closed final concurrency, contract, accessibility, and security reviews, including
  terminal ASR cancellation, account/history/update request ordering, sanitized update warnings,
  shared worker-stage parity, all-dialog focus management, and accessible update/ASR/task progress.
  Validation: all focused regressions, full app tests, browser focus smoke, build, Ruff, rustfmt, and
  diff checks passed.
- [x] 2026-07-15: Refreshed the packaged worker mirror, completed browser and native Windows
  acceptance, and ran every automated gate. Validation: 28 canonical/mirror source files matched by
  SHA-256; browser smoke passed 25/25 including English at `720×640` and modal keyboard focus; Tauri `--no-bundle` produced the
  release executable; native WebView2 verified system Simplified Chinese, live Traditional Chinese /
  English switching, restart persistence, and modal focus isolation/restoration before restoring the
  preference to `system`.

## Surprises & Discoveries

- Evidence: `worker/frameq_worker/pipeline.py` and the three platform fallback modules currently emit
  21 distinct natural-language processing progress states. Python model download emits 9 distinct
  states and Rust synthesizes a tenth cancellation event at `app/src-tauri/src/asr_model.rs`; the v2
  registry must cover all 31 before natural language is removed.
- Evidence: model download already exposes `current_file`, while worker progress exposes only
  `stage/message/progress`. The v2 shape therefore preserves model `status/current_file`, constrains
  top-level `current_file` to a basename, and does not duplicate it inside `message_args`.
- Evidence: `ProcessRequest.language` already exists for transcription behavior. It is semantically
  different from AI output language and must not be renamed or reused.
- Evidence: `model.vad.downloading` represents the public VAD companion model
  `iic/speech_fsmn_vad_zh-cn-16k-common-pytorch`, so the safe `model` enum must contain both that ID
  and `iic/SenseVoiceSmall`; a SenseVoice-only enum would make the planned emitter invalid.
- Evidence: `app/src/desktopWorkerContract.test.ts` and `worker/tests/test_contract.py` currently read
  the shared JSON and prove declaration shape, regex examples, and registry consistency only. They do
  not prove that TypeScript consumers, Rust forwarding/synthetic emitters, or Python producers/parsers
  enforce the schema. The completed runtime boundary and emission-validator suites therefore remain
  required gates in addition to the JSON consistency tests.
- Evidence: project governance requires plans to retain dated Progress evidence, Decisions,
  Validation, and residual risk through completion; those sections are populated before archival.
- Evidence: the final Windows release WebView2 smoke resolved `system` to `zh-CN`, rendered the real
  bundled app without horizontal overflow, switched to `zh-TW` and `en-US`, and restored a persisted
  `zh-TW` preference on restart. The smoke restored `ui-preferences.json` to `system` afterward.
- Evidence: this execution host is Windows. macOS native locale resolution and layout could not be
  observed here and is recorded as unverified rather than inferred from shared tests.

## Decision Log

- Decision: Support exactly `zh-CN`, `zh-TW`, and `en-US`, plus the persisted preference `system`.
  Rationale: a closed enum enables complete bundled resources and strict cross-language tests; other
  system locales have a deterministic English fallback. Date/Author: 2026-07-15, User + Codex.
- Decision: Use bundled `i18next + react-i18next` resources and an independent Traditional Chinese
  dictionary. Rationale: offline rendering, plural/interpolation support, and established React
  change-language semantics are preferable to a custom dictionary or runtime conversion.
  Date/Author: 2026-07-15, User + Codex.
- Decision: Persist only `{schemaVersion: 1, language}` in app-local `ui-preferences.json` and expose
  recovery only in the Tauri view model. Rationale: UI locale is device-local, not ASR `.env`, task,
  account, server, or inspiration-profile state. Date/Author: 2026-07-15, User + Codex.
- Decision: Roll back a failed latest optimistic selection to the most recent successfully persisted
  value, not the immediately prior UI selection. Rationale: in A-persisted, B-stale-failure,
  C-latest-failure ordering, B never reached disk, so only A can restore UI/disk consistency.
  Date/Author: 2026-07-15, User + Codex.
- Decision: Freeze the resolved UI locale at final AI confirmation and require it as
  `output_language`. Rationale: confirmation makes the charge-affecting result language visible and
  keeps in-flight requests deterministic without a second content-language setting.
  Date/Author: 2026-07-15, User + Codex.
- Decision: Make desktop-worker contract v2 a closed request declaration and incompatible with
  missing, invalid, target-incompatible, or additional language-request fields. Rationale: desktop
  and packaged worker ship together; permissive parsing or silent defaults would hide version drift
  and produce wrong-language paid results. Date/Author: 2026-07-15, User + Codex.
- Decision: Treat LLM language adherence as best-effort prompt semantics with no output detection,
  automatic retry, translation, or extra supplier call. Rationale: preserve transparent AI Credits,
  latency, and content-exposure boundaries. Date/Author: 2026-07-15, User + Codex.
- Decision: Permit sanitized raw errors only in an optional localized technical-details disclosure.
  Rationale: retain support diagnostics without making provider prose the primary UI or exposing
  sensitive request data. Date/Author: 2026-07-15, User + Codex.

## Outcomes & Retrospective

Implementation is complete. FrameQ now bundles independent Simplified Chinese, Traditional Chinese,
and US English resources; persists only the device-local language preference; localizes app-owned
chrome and semantic runtime messages; enforces strict Contract v2 across TypeScript, Rust, and Python;
and freezes the resolved output language at summary or Inspiration confirmation. The packaged worker
mirror matches its canonical source, all automated gates pass, and the Windows release WebView2 smoke
covered native startup, live switching, and restart persistence.

Residual risk: real LLM providers may ignore best-effort language instructions, so no automatic
detection, retry, translation, or extra charge is introduced. A macOS host was unavailable, so native
macOS locale/window behavior remains unverified. The real-provider three-language smoke was not run
to avoid consuming Credits. Vite still reports the pre-existing warning that the main minified chunk
is larger than 500 kB. A strict v2 desktop paired manually with an old external worker intentionally
fails instead of inferring a language.

## Context and Orientation

- Product intent: `docs/product-specs/2026-07-15-desktop-i18n-ai-output-language.md` and
  `docs/product-specs/2026-07-12-generate-draft-from-inspiration.md`.
- Persistent decisions: `docs/design-docs/2026-07-15-desktop-i18n-and-ai-output-language.md`.
- Shared protocol: `contracts/desktop-worker-contract.json`, `app/src/desktopWorkerContract.test.ts`,
  and `worker/tests/test_contract.py`.
- Frontend composition: `app/src/main.tsx`, `app/src/App.tsx`, `app/src/workerClient.ts`,
  `app/src/settingsClient.ts`, `app/src/workflowState.ts`, and `app/src/features/`.
- Desktop commands and worker bridge: `app/src-tauri/src/lib.rs`,
  `app/src-tauri/src/video_processing.rs`, `app/src-tauri/src/asr_model.rs`, and app-local settings
  modules.
- Canonical worker: `worker/frameq_worker/`; packaged Tauri mirror must be refreshed only through the
  repository's existing synchronization script.
- AI prompts: `worker/frameq_worker/insightflow/` plus the retry parsing/service boundary in
  `worker/frameq_worker/worker_service.py`.
- Governance: `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/SECURITY.md`, `TASKS.md`, and this active
  plan.

## Plan of Work

1. [x] Lock shared protocol intent through RED/GREEN contract tests.
   - Add `contractVersion: 2` without deleting existing contract sections.
   - Declare a closed request object with typed task ID, target/output enums, insights-only optional
     preference object, and no additional properties.
   - Register structured worker/model progress fields, all current message codes, typed/ranged closed
     args, discriminated model status/current-file rules, and invalid-event policy.
2. [x] Establish the localization runtime.
   - Add `i18next` and `react-i18next`.
   - Add typed, feature-namespaced `zh-CN`, `zh-TW`, and `en-US` resources and the approved glossary.
   - Add locale normalization, system mapping, formatting helpers, and `<html lang>` synchronization.
3. [x] Implement app-local preference storage and startup.
   - Add strict Rust DTOs and atomic `ui-preferences.json` read/write commands.
   - Cover missing, corrupt, unknown-schema, invalid-enum, and save-failure behavior, including
     A persisted / B stale failure / C latest failure ending with UI and disk at A.
   - Mount through the neutral bootstrap shell after success or the bounded 1.5-second fallback.
   - Sequence optimistic setting saves so stale results cannot replace the latest choice.
4. [x] Migrate UI and runtime messages.
   - Move App, settings, account, history, model download, transcript, AI workspace, preferences,
     updates, notifications, and accessibility copy into namespaces.
   - Replace rendered-message state with semantic message codes/domain state.
   - Localize known errors and expose only sanitized raw detail in the optional disclosure.
5. [x] Implement structured progress end to end.
   - Replace Python worker and model-download prose with contract-registered codes/args.
   - Add Python producer and Rust synthetic/forwarding validators that reject invalid events before
     emission, including code/status/current-file and per-key schema checks.
   - Add TypeScript consumer validation that drops invalid events, records only the safe code, and
     deterministically retains the last valid stage-level localized copy.
   - Add runtime tests for Python emitters, Rust cancellation/forwarding, and TypeScript consumers;
     JSON declaration tests alone do not satisfy this step.
6. [x] Implement AI output language end to end.
   - Show effective locale in summary and insights confirmation surfaces.
   - Freeze it at final confirmation and pass it through TypeScript, Rust stdin DTO, and Python.
   - Mirror the closed request schema in TypeScript, Rust, and Python and test rejection of missing,
     illegal, target-incompatible, and additional fields without compatibility defaults.
   - Apply fixed enum-derived semantics to summary, Mermaid, topic planner, and Insight prompts.
7. [x] Add automated coverage and synchronize packaged worker code.
   - Add locale parity, interpolation, literal/CJK, startup/save concurrency, layout, contract, prompt,
     and no-regression tests.
   - Refresh the Tauri worker mirror with the existing sync path and prove canonical/mirror equality.
8. [x] Complete native acceptance and governance closeout.
   - Exercise three-language switching, restart, keyboard navigation, and `720x640` layout in Tauri.
   - Record supported Windows/macOS locale evidence and clearly mark any unavailable host unverified.
   - Run all gates, update Progress/Outcomes, archive the plan, and update active/completed indexes.

## Validation and Acceptance

Automated gates:

- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check`
- `uv run pytest worker/tests`
- `uv run ruff check worker`
- `node --test scripts/tests/*.test.mjs`
- `python scripts/validate_agents_docs.py --level WARN`
- `npm --prefix app run tauri -- build --no-bundle`
- `git diff --check`

Focused acceptance must prove:

- Every locale has the same non-empty key/interpolation/plural contract and production JSX has no
  unapproved user-visible literals.
- `system` mapping, startup timeout, corrupt preference recovery, rapid save ordering, and latest-save
  rollback behave deterministically without resetting local drafts; A persisted / B stale failure /
  C latest failure leaves both UI and disk at A.
- Three locales render the primary app, settings, account, history, transcript, AI workspace, and
  confirmation panels at `720x640` without horizontal overflow or unreachable actions.
- Runtime Python/Rust producers emit only registered code/status/current-file/arg combinations;
  TypeScript drops invalid events and records only the safe code. JSON consistency tests are necessary
  but not sufficient evidence.
- All three output-language values pass actual TypeScript/Rust/Python request boundaries;
  missing/invalid/target-incompatible/additional fields fail, and fake LLM tests see the correct fixed
  semantics for summary, mindmap, planner, and Insights.
- Switching language does not change ASR, subtitle selection, official transcripts, prior history,
  task manifests, caches, or the number of supplier API calls / AI Credits uses.

Manual native acceptance:

- In a real Tauri window, switch among Simplified Chinese, Traditional Chinese, and English; verify
  immediate UI/`html lang`, keyboard focus, confirmation output language, and restart persistence.
- On available Windows and macOS hosts, verify `system` resolution. An unavailable platform is recorded
  as unverified, not passed.
- Optional real-provider three-language smoke may be recorded as release evidence but must not be an
  automated gate or consume Credits without explicit authorization.
