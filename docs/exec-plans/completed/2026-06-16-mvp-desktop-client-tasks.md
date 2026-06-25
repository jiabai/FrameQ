# MVP Desktop Client Tasks Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

This plan is the implementation task ledger for the MVP FrameQ desktop client. It pairs with `2026-06-16-mvp-desktop-client-plan.md`, which carries the high-level architecture, design, and concrete step-by-step commands. The purpose of this file is to give a reviewer a dated, evidence-backed checklist of what was actually built and validated during the MVP push from `app/` and `worker/` scaffold to a real Qwen3-ASR transcript and an embedded InsightFlow retry. All items in this ledger are recorded as completed work, with the validation command that demonstrated the work and the date the line closed.

## Progress

- [x] 2026-06-16: Created project governance, product spec, and initial ExecPlan. Validation: `python scripts/validate_agents_docs.py --level ERROR`.
- [x] 2026-06-16: User confirmed the first ExecPlan and specified `uv` for the project environment. Validation: user reply "开始下一步吧".
- [x] 2026-06-16: Bootstrapped `worker/` Python package with request/result schema. Validation: `uv run pytest worker\tests` passes.
- [x] 2026-06-16: Bootstrapped `app/` Tauri + React + TypeScript scaffold. Validation: `npm --prefix app run build` passes.
- [x] 2026-06-16: Added React state model for input, processing, complete, partial complete, and failed states. Validation: `npm --prefix app test` passes.
- [x] 2026-06-16: Implemented download, `ffprobe` validation, and audio extraction service. Validation: sample URL produces a valid MP4 and a 16 kHz mono WAV in `work/`.
- [x] 2026-06-16: Implemented ASR adapter and transcript writers. Validation: fake transcriber produced non-empty `outputs/7524373044106677544_transcript.txt` and `.md`.
- [x] 2026-06-16: Embedded and adapted InsightFlow topic generation. Validation: `outputs/7524373044106677544_insights.json` contains non-empty `insights`.
- [x] 2026-06-16: Wired Tauri command to worker CLI and UI progress events. Validation: `npm --prefix app run tauri -- build --no-bundle` builds `app.exe` and worker subprocess smoke returns structured JSON.
- [x] 2026-06-16: Added Rust/Cargo to persistent PATH. Validation: `cargo -V` and `rustc -V` available from a new shell.
- [x] 2026-06-16: Completed installer bundling validation. Validation: user reported `npm --prefix app run tauri -- build` succeeds after WiX setup/cache.
- [x] 2026-06-16: Completed desktop UI manual validation. Validation: user reported `app.exe` shows FrameQ, submit reaches `ASR_MODEL_NOT_READY`, and failed state does not show the cancel button.
- [x] 2026-06-16: Ran real Qwen3-ASR inference on the sample WAV. Validation: `outputs/7524373044106677544_transcript.txt` and `.md` were produced by real ASR; model cached under `models/`.
- [x] 2026-06-16: Added copy/export interactions to the detail modal. Validation: copy uses the active tab text; export reveals the generated transcript or insights file in the system file manager.
- [x] 2026-06-16: Added model download/loading progress UI. Validation: worker emits prefixed progress JSON on stderr, Tauri forwards `worker-progress` events, and the progress pane updates stage text and percent.
- [x] 2026-06-16: Added InsightFlow retry interaction for `partial_completed`. Validation: focused worker and frontend tests cover retry through a dedicated `retry_insights_json` worker command.
- [x] 2026-06-16: Supported `.env` configuration for a real InsightFlow LLM client. Validation: focused tests cover `.env` loading, OpenAI-compatible client request/response handling, CLI client construction, and external-service warning copy.
- [x] 2026-06-17: Added true cancel semantics. Validation: cancel terminates the active worker process tree; late results no longer overwrite the UI.
- [x] 2026-06-17: Final MVP validation and residual risk closeout. Validation: real InsightFlow LLM retry smoke returned `completed` with 8 insights; full automated tests, frontend build, docs gate, and Tauri no-bundle build all pass.

## Surprises & Discoveries

- Evidence: `2026-06-16-mvp-desktop-client-plan.md` is the high-level plan with the architecture map, decision log, and concrete shell commands; this file is its task-level companion and should always be read alongside it.
- Evidence: the dev environment initially lacked Rust/Cargo on PATH, so the first `npm --prefix app run tauri -- build` failed at `cargo metadata`; the user's PATH addition is recorded as its own line because every later Tauri build depends on it.
- Evidence: WiX tooling needed manual setup/cache before `npm --prefix app run tauri -- build` could complete the installer step; without that cache, the build hangs or fails inside the Tauri bundler rather than the Rust compile.
- Evidence: the worker CLI returns `ASR_MODEL_NOT_READY` by default and only starts a real model download when `FRAMEQ_ALLOW_REAL_ASR=1` is set, so the desktop smoke can be exercised without a 600 MB model fetch.
- Evidence: progress events use a `FRAMEQ_PROGRESS ` stderr prefix so the final worker stdout stays a parseable JSON result; the Tauri side only forwards the prefixed lines to the React progress pane.
- Evidence: real Qwen3-ASR cache ended up under `models/models--Qwen--Qwen3-ASR-0.6B`, so the same `models/` directory hosts both the SenseVoice cache (added later) and the Qwen3-ASR cache without collisions.
- Evidence: retry uses a dedicated `python -m frameq_worker --retry-insights-json ...` entry point so the desktop retry button does not re-download the video or re-run ASR.
- Evidence: a real SiliconFlow retry produced 8 insights for `outputs/7524373044106677544_transcript.txt`; the smoke was a CLI retry, not a fresh manual desktop click of the retry button — the latter was marked as the only residual risk at the time.
- Evidence: the missing-InsightFlow-client unit test (`test_retry_insights_once_preserves_transcript_when_client_is_missing`) is environment-sensitive; it now uses a temporary project root so the real `.env` cannot mask the missing-client path.

## Decision Log

- Decision: Pair this task ledger with `2026-06-16-mvp-desktop-client-plan.md` instead of folding the task list into the high-level plan. Rationale: keeps the high-level plan stable while this file acts as the dated, evidence-backed task history; the two can evolve at different cadences. Date/Author: 2026-06-17 / Codex.
- Decision: Record each MVP task with the date it closed, what was done, and the exact validation command that proved it. Rationale: a future reviewer or recovery session needs a one-line answer to "what ran and how do I re-run it"; the bullet format mirrors the policy used in `TASKS.md`. Date/Author: 2026-06-17 / Codex.
- Decision: Treat real ASR as opt-in through `FRAMEQ_ALLOW_REAL_ASR=1` for the duration of MVP smoke testing. Rationale: the desktop smoke should not silently trigger a 600 MB model download; the worker defaults to `ASR_MODEL_NOT_READY` so the failure mode is observable. Date/Author: 2026-06-16 / Codex.
- Decision: Keep development LLM configuration in project `.env` and commit only `.env.example`. Rationale: local setup is simple while API keys stay outside git; environment variables can still override `.env` for CI or packaged runs. Date/Author: 2026-06-16 / User + Codex.
- Decision: Use SiliconFlow with `deepseek-ai/DeepSeek-V3.2` for the real InsightFlow smoke rather than introducing provider-specific aliases. Rationale: SiliconFlow exposes an OpenAI-compatible Chat Completions API, and the existing OpenAI-compatible provider contract already covers it. Date/Author: 2026-06-17 / Codex.

## Outcomes & Retrospective

All MVP tasks closed. The desktop client can submit a Douyin URL, see live progress, cancel mid-flight, retry InsightFlow from `partial_completed`, and copy or export the resulting transcript and insights. The real LLM smoke produced 8 insights from a SiliconFlow-backed DeepSeek-V3.2 call. The single residual risk at closeout was that the final real LLM smoke was a CLI retry, not a fresh manual desktop click of the retry button; that gap is out of scope for this plan and was carried forward into `TASKS.md` rather than re-opened here.

## Context and Orientation

- `2026-06-16-mvp-desktop-client-plan.md` — high-level MVP plan, architecture map, decision log, and concrete shell commands. The authoritative source for "what the MVP is".
- `TASKS.md` — current recovery checkpoint; the dated ledger in this plan was folded back into `TASKS.md` after the MVP closed.
- `worker/frameq_worker/cli.py` — orchestrates download, media validation, audio extraction, ASR, and InsightFlow.
- `worker/frameq_worker/asr.py` — Qwen3-ASR adapter and transcript writers.
- `worker/frameq_worker/insightflow/` — embedded topic generation module.
- `worker/frameq_worker/llm.py` — OpenAI-compatible InsightFlow LLM client and default `temperature`.
- `app/src-tauri/src/lib.rs` — Tauri commands for processing, progress, cancel, and retry.
- `app/src/App.tsx` and `app/src/workflow.ts` — React UI state machine and detail modal.
- `douyin_video_download_solution.md` and `docs/product-specs/2026-06-16-douyin-video-transcription-client.md` — product and technical source documents.
- `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/SECURITY.md` — module boundaries, UI rules, and security boundaries.

## Plan of Work

1. Bootstrap project governance, product spec, and the first ExecPlan; get explicit user confirmation.
2. Bootstrap `worker/` Python package and `app/` Tauri React TypeScript scaffold; add the React workflow state model.
3. Implement download, `ffprobe` validation, and `ffmpeg` audio extraction; produce the first valid MP4 and 16 kHz mono WAV.
4. Implement the ASR adapter and transcript writers; use a fake transcriber for fast iteration and switch to real Qwen3-ASR once the model cache is in place.
5. Embed and adapt InsightFlow topic generation; map a missing LLM client to `partial_completed`.
6. Wire Tauri commands, the worker CLI subprocess, the progress event stream, cancel, retry, copy, and export.
7. Add `.env`-driven OpenAI-compatible LLM configuration and run the first real SiliconFlow smoke.
8. Close MVP with true cancel semantics, a final validation pass, and a residual risk note in `TASKS.md`.

## Validation and Acceptance

- `python scripts/validate_agents_docs.py --level ERROR` passes.
- `uv run pytest worker\tests` passes.
- `npm --prefix app test` passes.
- `npm --prefix app run build` passes.
- `npm --prefix app run tauri -- build --no-bundle` produces `app.exe` from a fresh shell with Rust on PATH.
- `npm --prefix app run tauri -- build` (full bundle) succeeds after WiX setup/cache, as reported by the user.
- Real Qwen3-ASR produces a non-empty transcript for the sample WAV; transcript is written to `outputs/...transcript.txt` and `.md`.
- Embedded InsightFlow produces non-empty `outputs/...insights.json` with at least one `insights` entry.
- Real SiliconFlow retry of `partial_completed` returns `completed` with 8 insights for the sample transcript.
- Manual desktop smoke: FrameQ title, submit reaches `ASR_MODEL_NOT_READY` by default, failed state hides the cancel button.
- Manual desktop smoke: cancel mid-flight terminates the worker process tree and late results do not overwrite the UI.
