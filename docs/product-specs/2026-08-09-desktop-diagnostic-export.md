# Desktop Diagnostic Export Spec

- Date: 2026-08-09
- Status: Approved design; implementation not started
- Related product specs:
  - `docs/product-specs/2026-07-05-desktop-diagnostics-logs.md`
  - `docs/product-specs/2026-07-27-selectable-asr-model-on-demand-download.md`
- Related design: `docs/design-docs/2026-08-09-desktop-diagnostic-export.md`

## Background

FrameQ currently maps ASR model-download failures to a safe, generic product error. The desktop
runner intentionally does not persist raw worker stderr, and the Python model-download application
converts broad third-party exceptions into `ASR_MODEL_DOWNLOAD_FAILED`. This protects local media,
transcripts, credentials, URLs, and machine paths, but it also means a failure that occurs only on a
user's PC cannot be diagnosed remotely without reproducing that machine's environment.

This feature adds a user-initiated **Export diagnostics** action. It records a narrowly scoped,
privacy-bounded diagnostic trail for ASR model download and packages the most recent seven days of
safe local evidence into a ZIP selected through the operating system Save As dialog. FrameQ does
not upload the package or initiate connectivity tests; the user decides whether and how to share
it with support.

## Goals

- Give users a direct support path after an ASR model-download failure without requiring a second
  reproduction session.
- Add a permanent export entry under Settings > Advanced for failures reported after the original
  dialog has been closed.
- Preserve actionable failure categories such as DNS, timeout, TLS, proxy, HTTP, permission, disk,
  integrity, dependency, and unexpected failure without persisting raw exception messages.
- Keep Rust/Tauri as the sole owner of diagnostic persistence, retention, sanitization, packaging,
  and the Save As destination.
- Keep the feature local-first: no automatic upload, telemetry, network probe, model retry, server
  request, LLM call, or AI Credits activity is caused by export.
- Produce a small, deterministic package that support staff can inspect without receiving media,
  transcripts, secrets, machine identity, or model files.

## Non-goals

- Do not persist general worker stderr for video processing, local-media processing, transcription,
  insight generation, transcript dissection, or any operation other than ASR model download.
- Do not create a general-purpose log browser, arbitrary-file exporter, crash-report uploader,
  telemetry pipeline, remote support session, or network test suite.
- Do not include video, audio, transcripts, prompts, generated content, task artifacts, model
  weights, app-local configuration, `.env` files, account sessions, or LLM configuration.
- Do not automatically open the logs directory or expose it as a user-editable product surface in
  the first version.
- Do not change model source order, retry, resume, cancellation, cache promotion, progress,
  watchdog, terminal-result, or product error semantics.
- Do not assign a release version in this spec.

## User Experience

### ASR model-download failure

After model preparation reaches a terminal failure or timeout, the failure sheet shows a secondary
**Export diagnostics** action alongside the existing primary retry action. The export action is not
shown while the download is active. Nearby copy states that the package does not contain media,
transcripts, keys, or model files, and that exporting does not retry the download or test the
network.

### Settings entry

Settings > Advanced contains a permanent Diagnostics section with:

- an **Export diagnostics** action;
- a statement that the package covers at most the most recent seven days; and
- a concise privacy explanation.

The first version does not add an **Open logs directory** action.

### Save and completion

Rust opens the operating system Save As dialog with a default name of
`FrameQ-diagnostics-YYYYMMDD-HHMMSS.zip`.

- Cancelling the dialog is a successful no-op and shows no error.
- Only one export may run at a time. The initiating action is disabled while export is in progress.
- Export does not cancel, pause, or otherwise interfere with a worker or model-download operation.
- Success tells the user that the package was exported and must be sent to support manually.
- Failure shows a stable message asking the user to choose another destination and retry. Raw OS
  errors and destination paths are not rendered in the UI.

The frontend receives only the closed outcome `exported`, `cancelled`, or `failed`. It does not
receive diagnostic contents or the selected absolute path.

## Package Contract

The ZIP has exactly these root entries when their source data is available:

- `diagnostics.json`
- `frameq-desktop.log`
- `asr-model-download.log`

`diagnostics.json` is always present and contains a closed schema with:

- diagnostic schema version;
- FrameQ application version;
- operating-system family and CPU architecture;
- export timestamp and included time window;
- selected public ASR model identifier;
- selected-model cache state: `ready`, `missing`, `invalid`, or `unknown`;
- included and omitted files using closed status/reason values; and
- `truncated: true|false`.

The package must not contain a username, hostname, IP address, complete local path, task ID, URL,
query string, proxy address, custom download URL, Cookie, Authorization value, token, key, `.env`
value, user content, model bytes, raw exception message, or unbounded traceback.

`frameq-desktop.log` is an export-time re-sanitized view of safe desktop lifecycle and outcome
records from the time window. `asr-model-download.log` contains validated structured ASR
model-download diagnostic records plus a bounded, re-sanitized fallback view of unstructured
stderr captured only for that operation.

If no ASR failure has been recorded, export still succeeds with `diagnostics.json` and any safe
desktop records that are available. An unavailable or unreadable source log is represented in the
manifest by a closed omission reason; its raw read error is not included. Failure to write a valid
destination ZIP is a failed export.

## Retention and Size Limits

- Each persisted diagnostic payload is sanitized and limited to 1,000 characters.
- Unstructured fallback stderr is limited to 200 lines per ASR model-download invocation, with
  repeated adjacent lines collapsed.
- The ASR model-download log is limited to 4 MiB and drops records older than seven days.
- The final ZIP is limited to 5 MiB. If needed, the exporter keeps the newest eligible records
  first and sets `truncated: true`.
- Source logs remain in app-local data after export. FrameQ retains no app-local copy of the ZIP.
- A destination-side staging file is created beside the selected ZIP, atomically replaces the
  destination only after success, and is cleaned up after cancellation or failure.

## Diagnostic Event Contract

The worker may emit one machine-readable event on stderr when ASR model download terminates in
failure:

```text
FRAMEQ_DIAGNOSTIC {"version":1,"operation":"download_asr_model","phase":"primary_model","category":"network","code":"connection_timeout","exception_type":"ReadTimeout"}
```

This advances the global desktop-worker contract from v7 to v8. Existing URL/local-media request
envelopes, stdout terminal results, progress event prefixes, model-download progress events, and
public Tauri result shapes remain unchanged.

The event schema is strict and closed:

- `version`: exactly `1`;
- `operation`: exactly `download_asr_model` in this version;
- `phase`: a closed model-download phase such as preparation, primary model, VAD, BPE, archive
  validation, cache validation, or cache promotion;
- `category`: `network`, `tls`, `proxy`, `http`, `filesystem`, `integrity`, `dependency`, or
  `unexpected`;
- `code`: a closed stable failure code within that category;
- `exception_type`: an optional bounded exception class identifier; and
- optional bounded numeric `http_status` and `os_error_code` fields.

The event has no free-form message field. It must not include a URL, host, path, header, proxy,
credential, exception text, or traceback. If safe classification is impossible, the worker emits
`category=unexpected` and `code=unexpected_failure`.

Rust validates the prefix, JSON structure, field set, enum membership, numeric bounds, and string
lengths before persistence. An invalid event is not persisted verbatim; Rust records only the
fixed summary `diagnostic_event_rejected`. Diagnostic events do not reach UI state, count as
worker activity, refresh the idle watchdog, or alter terminal classification.

To cover startup, import, and interpreter failures that cannot emit a structured event, Rust may
persist bounded sanitized ordinary stderr only when the semantic operation is
`DownloadAsrModel`. All other worker operations keep the current discard-and-marker policy.

## Privacy and Security Requirements

- Rust/Tauri owns the log directory, file handles, retention, sanitization, export assembly, and
  Save As dialog. Python receives no app-local log path and does not write diagnostic files.
- The Tauri command accepts no source path, destination path, log text, URL, upload endpoint, or
  network-probe argument from JavaScript.
- The frontend cannot read the package or source logs through IPC.
- Existing desktop logs are treated as untrusted input and sanitized again during export.
- Export never uploads data. Sharing the resulting ZIP is an explicit action outside FrameQ.
- Diagnostic collection must fail closed: uncertain text is omitted or replaced by a fixed code,
  not retained for convenience.

## Error Semantics

- The public export failure code is `DIAGNOSTIC_EXPORT_FAILED`.
- Save-dialog cancellation maps to `cancelled`, not an error.
- Missing source logs do not fail export when a valid manifest can still be produced.
- Destination creation, staging, ZIP finalization, atomic replacement, or cleanup failures must
  never be reported as `exported`.
- Diagnostic collection failures do not replace or mask the original ASR model-download result.

## Acceptance Criteria

- A user can export from both a terminal ASR model-download failure and Settings > Advanced.
- The exported package covers no more than seven days and obeys the fixed entry, manifest, 5 MiB,
  sanitization, and forbidden-content contracts.
- Representative DNS, timeout, TLS, proxy, HTTP, filesystem, integrity, dependency, and unexpected
  failures produce useful closed diagnostic classifications.
- Seeded secrets, URLs, user names, paths, task IDs, media text, and traceback content cannot cross
  worker event validation, persistence, re-sanitization, or ZIP assembly tests.
- Non-model-download worker stderr remains unpersisted.
- Export produces no network activity, server request, LLM call, AI Credits use, model retry, or
  retained app-local ZIP.
- Save cancellation is silent; concurrent export is rejected or serialized safely; partial files
  are cleaned up; unavailable logs are represented safely.
- Simplified Chinese, Traditional Chinese, and US English copy is complete.
- Windows Save As, cancellation, failure destination, and ASR failure flows receive real-host smoke
  coverage. Any unavailable macOS native-dialog evidence is documented as a release residual.

