# Worker Stdin Request Transport ExecPlan

> This ExecPlan is a living document. Progress, discoveries, decisions, and validation evidence must be updated throughout implementation.

## Goal

Remove raw source URLs and serialized request payloads from production worker argv and environment variables by moving desktop-to-worker requests to a one-shot stdin pipe without weakening source identity, cache/history, AI-input, or process-tree cancellation boundaries.

## Architecture

`WorkerCommandSpec` will separate fixed argv from an optional in-memory stdin payload. The shared Rust spawn helper will configure a piped stdin only for payload-bearing invocations, spawn in the existing Windows/Unix process boundary, write the payload, close stdin, and fail with a fixed sanitized error if delivery fails. The Python CLI will expose explicit stdin request modes with bounded JSON-object parsing; fixed no-payload commands remain flags. Existing services continue to receive the same serialized request strings, so SourceIdentity and persistence behavior stay unchanged.

## Progress

- [x] 2026-07-10: Verified clean `40f7fcc`, read governance, architecture/security, technical debt, and the source URL privacy spec; inspected Rust worker command construction, process supervision, video/preflight/retry call sites, Python CLI, and tests.
- [x] 2026-07-10: Updated the product spec and created this active ExecPlan before implementation.
- [x] 2026-07-10: Added Rust red tests for fixed argv/env and worker CLI red tests for stdin process requests. Evidence: Rust exposed the full `xsec_token=review-secret` JSON in `--request-json`; Python rejected `--request-stdin` as unsupported.
- [x] 2026-07-10: Implemented fixed stdin mode flags, in-memory `stdin_payload`, 1 MiB desktop/worker bounds, fixed parsing/delivery failures, and removal of URL-bearing JSON argv CLI modes.
- [x] 2026-07-10: Added real-child probes for stdin EOF delivery, argv/environment absence, sanitized write failure with child reaping, and cancellation after request delivery. Focused Rust worker-command tests passed (18 tests).
- [x] 2026-07-10: Added process/preflight/retry stdin CLI tests and malformed/oversized non-echoing failures. Focused worker CLI/source/pipeline/AI tests passed (90 tests).
- [x] 2026-07-10: Routed cache preflight, process-video, and retry through supervised stdin delivery; verified success, fixed failure, blocked-write cancellation, cache/history/source persistence, and prompt leakage boundaries.
- [x] 2026-07-10: Synchronized architecture/security/debt/task records and ran the complete repository gates plus packaged-worker parity. Implementation is uncommitted and this plan remains active pending user confirmation.

## TDD Tasks

### Task 1: Rust command boundary

- [ ] Assert `ProcessVideo` and `ResolveSourceIdentity` specs contain only `-m frameq_worker` plus a fixed stdin mode flag, with the sensitive JSON only in `stdin_payload` and absent from all environment values and log details.
- [ ] Run the focused Rust tests and record the expected failure against current JSON argv construction.
- [ ] Add `stdin_payload: Option<String>` to `WorkerCommandSpec` and map serialized invocations to fixed stdin flags.
- [ ] Re-run focused tests to green.

### Task 2: Real child and delivery lifecycle

- [ ] Add a real subprocess probe that reports booleans proving the secret arrived through stdin but not argv/environment; it must never print the secret.
- [ ] Add a deterministic failing-writer test that proves delivery errors use fixed text without payload echo.
- [ ] Run the tests red, then implement piped-stdin write-and-close in the shared spawn helper; on failure terminate the controlled child/process group and return the sanitized error.
- [ ] Re-run the probe plus existing supervisor cancellation tests.

### Task 3: Worker CLI stdin contract

- [ ] Add tests for process-video, source-identity, and retry stdin modes, plus empty/malformed/oversized payloads that return fixed structured failures without echoing fixture secrets.
- [ ] Run the focused worker tests and record the expected missing-mode failures.
- [ ] Add one bounded JSON-object stdin reader and fixed per-mode failure mapping; keep model download and migration as no-payload flags.
- [ ] Re-run worker CLI and source privacy tests.

### Task 4: Call-site and leak regression

- [ ] Update video processing, cache-only preflight, AI retry, migration/model-download constructors, and tests to the new command spec without introducing fallback argv/env transport.
- [ ] Exercise successful stdin delivery, worker structured failure, cancellation, cache reuse, history, artifacts, diagnostic summaries, and AI prompt captures using `review-secret`.
- [ ] Scan command specs, outputs, logs, errors, manifests, transcript artifacts, history DTOs, cache keys, and captured prompts for the raw URL, `xsec_token`, and token value.

### Task 5: Documentation and gates

- [x] Update architecture/security/task/debt records, closing only the argv exposure debt and preserving any OS/crash-memory residual risk.
- [x] Run all project gates required by AGENTS/WORKFLOW and this task, record counts, and leave the green worktree uncommitted for user confirmation. Archive this plan after the user confirms the handoff/commit decision.

## Decisions

- Decision: Use fixed per-request stdin mode flags rather than a generic mode value embedded in the payload. Rationale: argv remains non-sensitive and auditable while the worker dispatch stays explicit. Date: 2026-07-10.
- Decision: Route retry JSON through the same stdin mechanism even though it normally contains no source URL. Rationale: one serialized-request transport invariant avoids future accidental secret-bearing argv fields. Date: 2026-07-10.
- Decision: Read one bounded JSON object and close stdin before waiting. Rationale: prevents inherited interactive stdin, unbounded memory use, and `wait_with_output` deadlock. Date: 2026-07-10.
- Decision: Do not change ProcessSupervisor ownership or signal semantics. Rationale: request transport and process lifecycle remain separate boundaries. Date: 2026-07-10.

## Discoveries

- The old logger carried a defensive redaction branch for three JSON argv flags. Once those flags were removed from command construction and CLI parsing, the branch became dead compatibility code and was removed so logs consume only fixed arguments.
- A real child reading stdin to EOF is a stronger closure test than inspecting the command spec alone: it proves `wait_with_output` is not retaining the request pipe.
- The first implementation wrote stdin before the caller recorded the PID in `ProcessSupervisor`; a blocked pipe could therefore make a concurrent cancel briefly observe no worker. A failing real-child test drove `spawn_supervised_worker_command`, which registers the PID/PGID before delivery and maps a matching cancellation during delivery to a confirmed cancelled result. Cache preflight, process-video, and retry now all use that boundary.
- A privileged local memory/crash-dump observation remains the only transport privacy residual and is tracked separately.

## Validation

- `cargo test --manifest-path app\src-tauri\Cargo.toml` — 90 passed.
- `uv run pytest worker\tests` — 249 passed; one existing Python 3.13 `audioop` deprecation warning.
- `uv run ruff check worker` — passed.
- `npm --prefix app test` — 31 files / 205 tests passed on the final isolated run. An earlier high-load parallel run and one immediate standalone rerun timed out at different existing Chrome conditions; no test timeout or UI code was changed.
- `npm --prefix app run build` — passed.
- `npm --prefix server test` — 12 files / 57 tests passed; WeChat remains default-disabled and no real provider API was used.
- `npm --prefix server run build` — passed.
- `node --test scripts\tests\*.test.mjs` — 7 passed.
- `python scripts\validate_agents_docs.py --level WARN` — passed with 0 errors and 0 warnings.
- `git diff --check` — passed; line-ending notices are informational and no whitespace errors were reported.
- Packaged/source worker parity — 26 Python files on each side, 0 file-set differences, 0 SHA-256 mismatches.
- `git status --short` — captured at final handoff; only the scoped uncommitted implementation, tests, spec, ExecPlan, and governance updates are present.

## Outcome

Production desktop worker invocations no longer place serialized requests or raw source URLs in argv or environment variables. The raw request exists only in the frontend/Tauri request object, `WorkerCommandSpec.stdin_payload`, the one-shot OS pipe, and worker memory until the downloader call finishes. All durable identity, cache matching, history, transcript metadata, and AI inputs remain canonical/source-safe. Payload-bearing workers are supervised before delivery, stdin is closed before output waiting, and cancellation during a blocked write returns the matching cancelled terminal state.

## Residual Risks

- Same-user memory inspection and crash dumps may still observe the raw request while it exists in desktop/worker memory or an OS pipe buffer; this change removes command-line and environment exposure, not privileged local memory inspection.
- Unix process-group delivery remains conditionally tested on Unix and must retain its existing release-host validation requirement.
