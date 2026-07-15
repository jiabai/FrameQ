# ADR-2026-07-15: Desktop i18n and AI output-language boundary

## Status

Accepted for implementation on 2026-07-15.

## Context

FrameQ needs one desktop release to support Simplified Chinese, Traditional Chinese, and US
English without weakening its local-first boundary. Today, React components and state models own
Chinese display sentences, Python worker progress carries natural-language text, and AI generation
does not receive an explicit output locale. Those three concerns make runtime language switching
incomplete and allow desktop/worker copy to drift silently.

The design must also preserve these constraints:

- Video, audio, subtitles, ASR transcripts, user-authored content, and existing AI artifacts remain
  unchanged and local by default.
- Locale resources must work offline and must not introduce a translation service.
- Existing server-managed LLM checkout and per-call AI Credits accounting remain unchanged.
- Desktop and the packaged worker ship together, so a strict breaking protocol upgrade is viable.
- Progress and diagnostics must not expose URLs, full paths, cookies, credentials, transcripts,
  prompts, or generated bodies.
- A damaged UI preference cannot prevent the desktop window from starting.

## Decision 1: Use bundled i18next resources

FrameQ will use `i18next` and `react-i18next` with locally bundled TypeScript resources for
`zh-CN`, `zh-TW`, and `en-US`. Resource keys are semantic and split by product feature. The three
locales must expose identical non-empty key sets and interpolation/plural contracts. Traditional
Chinese is an independent human-authored resource, not runtime Simplified-to-Traditional
conversion.

React presentation resolves text at render time. Domain state stores a message code plus typed
arguments, or a domain state from which copy can be selected. Resource strings do not contain
arbitrary HTML; controlled rich copy uses React components through `Trans`.

### Consequences

Positive:

- Existing React composition can update immediately through the standard provider/hook model.
- Plurals, interpolation, namespaces, and TypeScript resource typing do not need a custom runtime.
- Every supported language is available offline and produces no translation-resource network call.

Negative:

- Existing hard-coded copy and rendered-message state must be migrated deliberately.
- Key consistency and literal-text gates become release responsibilities.
- English expansion and Traditional Chinese terminology require human review.

Neutral:

- `FrameQ`, `AI Credits`, ASR, LLM, Mermaid, model names, platform brands, paths, and email
  addresses remain invariant product data rather than translation entries.

## Decision 2: Store UI preference in a dedicated app-local JSON file

The persisted preference is `{ "schemaVersion": 1, "language": "system" | SupportedLocale }` in
app-local `ui-preferences.json`. Tauri owns strict parsing, validation, and atomic writes through
`get_ui_preferences` and `save_ui_preferences`. The frontend receives `recovered: true` when JSON,
schema, or enum validation fails. A read failure does not rewrite the file; the next successful
explicit save repairs it.

The startup shell waits at most 1.5 seconds for the preference before mounting the localized app.
After timeout or failure it resolves the current system locale, ignores the late response, and
shows a non-blocking recovery notice. Rapid setting changes are serialized and tagged with an
operation sequence so stale responses cannot overwrite the latest choice. The frontend separately
tracks the most recent successfully persisted preference; failures never advance that rollback
anchor, and only a failure for the latest optimistic operation rolls UI back to the anchor.

### Consequences

Positive:

- UI preference is isolated from ASR/output `.env`, task artifacts, account state, and inspiration
  preferences.
- Schema versioning makes corrupt and future files fail safely without blocking startup.
- A failed or late read cannot produce a blank window or a surprise second locale switch.

Negative:

- The UI needs explicit optimistic-save rollback and stale-response tests.
- The desktop runtime owns one additional small app-local file and atomic-write path.

Neutral:

- Missing file is a normal first-run `system` preference, not recovery.
- Explicit locale choices ignore OS changes; `system` reacts to available `languagechange` events
  and otherwise re-resolves at next startup.

## Decision 3: Resolved UI locale drives newly confirmed AI output

FrameQ will not add a separate content-language preference. At the final confirmation action for
`summary` or `insights`, the frontend freezes the resolved UI locale and sends it as required
`output_language`. `system` itself never crosses the worker boundary. A later UI switch cannot
change an in-flight request; a later retry freezes the then-current locale.

The worker maps the three enum values to fixed prompt semantics:

- `zh-CN`: all user-visible generated content uses Simplified Chinese.
- `zh-TW`: all user-visible generated content uses Traditional Chinese (Taiwan), not Simplified
  Chinese.
- `en-US`: all user-visible generated content uses clear US English.

The instruction applies to summary text, Mermaid node labels, topic planning, and all user-visible
structured Insight fields. Artifact and JSON schema keys remain stable. Language compliance is
best-effort: FrameQ does not add language detection, automatic retries, translation, or additional
LLM calls.

### Consequences

Positive:

- One visible setting explains both UI and new-result language, while confirmation shows the exact
  effective value before Credits can be consumed.
- No translation vendor, content-language profile, or extra accounting branch is introduced.
- Existing transcript and preference data-flow permissions remain unchanged.

Negative:

- Users cannot intentionally request a content language different from their UI language in this
  version.
- A provider may occasionally ignore the instruction; users must decide whether to spend Credits
  on a retry.

Neutral:

- Existing AI results, history, caches, and task manifests are not retranslated or invalidated.
- Future draft generation must accept the same required enum, but draft implementation remains a
  separate product change.

## Decision 4: Upgrade desktop-worker protocol strictly to contract v2

`contracts/desktop-worker-contract.json` is the shared authority and now declares
`contractVersion: 2`. The `retry_insights` stdin request requires `task_id`, `target`, and
`output_language`; its object schema closes unknown fields, types `task_id`, restricts `target` to
`summary | insights`, restricts the output-language enum, and permits an object
`preference_snapshot` only with `insights`. TypeScript, Rust, and Python must reject missing,
unsupported, target-incompatible, or additional values. No legacy default is allowed because
desktop and the embedded worker are versioned and released as one unit.

Worker progress requires `stage`, `progress`, and `message_code`, with optional `message_args`.
The shared wire-stage enum excludes `cancelling`, which remains a desktop ProcessSupervisor/UI
transition and is never accepted as Python worker progress.
Model-download progress retains `status`, `progress`, and optional `current_file`, and gains the
same code/args model. Its status is closed to `started`, `downloading`, `extracting`, `completed`,
or `cancelled`. The contract registers each known three-part `domain.action.state` code and
the allowed arguments for that code. Every model-download code fixes one status and declares
`current_file` required only for the two model-file codes and forbidden otherwise. `message_args` is
a closed object: public model IDs are enumerated, language uses a bounded safe-tag pattern, and
attempt/total are integers from 1 through 100. The separate top-level `current_file` is 1-255
characters and rejects separators, control characters, `.` and `..`. Forbidden content is explicitly
registered as `url`, `full_path`, `cookie`, `credential`, `transcript_content`, `prompt`,
`generated_content`, `request_headers`, and `preference_prose`. Producers must reject invalid events;
consumers must drop invalid events and record only the safe code.

### Consequences

Positive:

- The completed desktop will render progress in its current locale without trusting worker prose.
- Frontend and worker contract tests catch declaration drift and internal schema inconsistency.
- A small allowlist prevents accidental sensitive data from becoming UI interpolation or logs.

Negative:

- Every desktop, Rust, worker, test fixture, example, and packaged worker mirror must upgrade in
  the same release.
- Adding a distinct progress state now requires a registry and locale-resource update.
- Declaration tests do not prove runtime parsing or emission; TypeScript, Rust, and Python boundary
  validators require separate implementation tests before closeout.

Neutral:

- The existing ASR `ProcessRequest.language` remains transcription configuration and cannot stand
  in for AI output language.
- Sanitized raw errors may remain in an optional technical-details disclosure, but never replace
  localized primary guidance.

## Failure Modes and Mitigations

| Failure mode | Required behavior |
|---|---|
| Preference file missing | Start with resolved system locale; do not show recovery. |
| Preference corrupt, unknown schema, or invalid enum | Start with resolved system locale, return `recovered: true`, retain the file until a valid save. |
| Preference read exceeds 1.5 seconds | Mount once with system locale, ignore the late result, show a non-blocking notice. |
| Rapid saves resolve out of order | Serialized writes plus operation sequence prevent stale UI overwrite; only successful writes advance the persisted rollback anchor. |
| Latest save fails | Roll back to the most recent successfully persisted value, never the immediately previous optimistic choice, and show a localized error. |
| A persisted; B stale failure; C latest failure | Ignore B for UI rollback; C rolls UI back to A, while disk remains A. This sequence requires an explicit regression test. |
| Unknown progress code | When the event is otherwise structurally valid, apply its validated stage/status/progress, render the matching generic localized fallback, and record only its safe code; never apply worker prose. |
| Unsafe `message_args` | Reject/drop at the producing/parsing boundary and do not display or log the value. |
| Missing/invalid `output_language` | Fail at TypeScript/Rust/Python validation without echoing the request. |
| LLM ignores language instruction | Keep the generated result; do not auto-retry, translate, or charge an extra call. |

## Alternatives Considered

### A custom React dictionary/context

Rejected because it would recreate namespace loading, plural rules, interpolation, locale changes,
and TypeScript augmentation while making ecosystem tooling unavailable.

### Remote locale bundles or a translation API

Rejected because core settings and error copy must work offline, and remote translation would add
network, privacy, availability, and supply-chain boundaries unrelated to FrameQ's product value.

### Store language in app-local `.env`

Rejected because `.env` is already the constrained local ASR/output configuration boundary. UI
preferences need schema recovery, typed JSON, and must not become worker environment configuration.

### Store language in task manifest or account profile

Rejected because UI language is device-local and not task identity, history truth, entitlement, or
server state. Persisting it there would invite history migration and cross-device privacy scope.

### Add a separate AI content-language setting now

Rejected to avoid two coupled selectors and ambiguous confirmation behavior. The resolved UI locale
is shown before confirmation; a future product need can add a separate setting through a new spec.

### Preserve optional/missing output language for old calls

Rejected because a fallback would silently produce the wrong language and hide packaged desktop /
worker version drift. The two components ship together, so strict v2 is the safer failure mode.

### Detect or translate incorrect LLM output automatically

Rejected because detection can be unreliable and any retry/translation adds supplier calls,
latency, content exposure, and AI Credits ambiguity.

## References

- `docs/product-specs/2026-07-15-desktop-i18n-ai-output-language.md`
- `contracts/desktop-worker-contract.json`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
