# Build MVP Douyin Video Transcription Desktop Client

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

完成后，用户可以在桌面客户端中粘贴一个抖音视频 URL，并获得本地视频文件、完整文字稿和启发话题点。用户能通过 UI 看到处理进度、复制结果并导出文件。

## Progress

- [x] 2026-06-16: App shell scaffolded and initial UI states render. Validation: `npm --prefix app test`, `npm --prefix app run build`.
- [x] 2026-06-16: Python worker scaffolded with structured request/result schema. Validation: `uv run pytest worker\tests`.
- [x] 2026-06-16: Download, media validation, and audio extraction pipeline works for the sample URL. Validation: sample URL created `outputs/7524373044106677544.mp4`; `probe_media_file` reported valid video/audio; `extract_audio` created 16 kHz mono WAV.
- [x] 2026-06-16: ASR transcript pipeline writes `.txt` and `.md` outputs. Validation: fake transcriber created non-empty transcript files; `qwen-asr` package is installed and adapter import/API was verified, but real model inference has not run.
- [x] 2026-06-16: Embedded InsightFlow topic generation writes `.json` and `.md` outputs. Validation: fake InsightFlow client created non-empty `outputs/7524373044106677544_insights.json` and `.md`; missing client maps to `partial_completed`.
- [x] 2026-06-16: Tauri command connects UI to the worker CLI and can reach a structured result or failure. Validation: `npm --prefix app test`, `npm --prefix app run build`, worker CLI subprocess smoke test, and `npm --prefix app run tauri -- build --no-bundle`.
- [x] 2026-06-16: Desktop smoke validation completed by user. Validation: `app.exe` showed FrameQ, submitting a URL reached the expected `ASR_MODEL_NOT_READY` structured failure, and failed state did not show cancel.
- [x] 2026-06-16: Installer bundle validation completed by user after WiX setup/cache. Validation: user reported `npm --prefix app run tauri -- build` succeeds.
- [ ] 2026-06-16: Desktop polish remains: true cancel semantics, retry, and copy/export paths.
- [ ] 2026-06-16: Focused validation passes and residual risks are documented.

## Surprises & Discoveries

- Evidence: `douyin_video_download_solution.md` records that the sample URL download produced a valid MP4 with HEVC video, AAC audio, 1024x576 resolution, and about 271.3 seconds duration.
- Evidence: Development machine has `uv 0.11.3`, Node `v24.5.0`, npm `11.7.0`, and FFmpeg available; `cargo` is not currently on PATH, so full Tauri/Rust build is blocked until Rust tooling is installed.
- Evidence: `npm --prefix app run tauri -- build` fails at `cargo metadata` with `program not found`, confirming the desktop build blocker is Rust/Cargo rather than the JS app.
- Evidence: Real sample URL download created `outputs/7524373044106677544.mp4` with HEVC video, AAC audio, 1280x720 resolution, 271.3 seconds duration, and 8,864,763 bytes.
- Evidence: `extract_audio` created `work/7524373044106677544.wav` as `pcm_s16le`, 16 kHz, 1 channel.
- Evidence: `qwen-asr==0.0.6` and `modelscope==1.37.1` installed through `uv`; `qwen_asr` exposes `Qwen3ASRModel`.
- Evidence: fake ASR integration wrote non-empty `outputs/7524373044106677544_transcript.txt` and `.md`; real Qwen model weights have not been downloaded or executed yet.
- Evidence: embedded `worker/insightflow/` module writes `insights.json` and `insights.md` from a fake LLM client and maps missing LLM config to `partial_completed`.
- Evidence: worker CLI now runs download, media validation, and audio extraction before ASR; by default it returns `ASR_MODEL_NOT_READY` instead of starting a large model download unless `FRAMEQ_ALLOW_REAL_ASR=1` is set.
- Evidence: `npm --prefix app run tauri -- build --no-bundle` builds `D:\Github\FrameQ\app\src-tauri\target\release\app.exe` when `~\.cargo\bin` is prepended to PATH.
- Evidence: user reported Rust/Cargo are now on persistent PATH and full `npm --prefix app run tauri -- build` succeeds after WiX setup/cache.
- Evidence: user manually launched `app.exe` and confirmed UI behavior: FrameQ title, processing flow, expected `ASR_MODEL_NOT_READY`, and no cancel button in failed state.

## Decision Log

- Decision: Use Tauri + React + TypeScript + Python ASR Worker. Rationale: lightweight desktop shell, mature UI ecosystem, and direct access to Python ASR tooling. Date/Author: 2026-06-16 / Codex, from accepted ADR-001.
- Decision: Use `Qwen/Qwen3-ASR-0.6B` as default ASR model. Rationale: Chinese-focused quality with lower resource demand than 1.7B. Date/Author: 2026-06-16 / Codex, from accepted ADR-002.
- Decision: Copy and embed only the required InsightFlow modules into this repo. Rationale: desktop app must be independently packaged and cannot depend on a local reference path. Date/Author: 2026-06-16 / Codex, from accepted ADR-003.
- Decision: Manage the project Python environment with `uv` and create a project-local `.venv`. Rationale: user explicitly requested `uv` for this project while noting a separate development-machine environment at `D:\Code\.venv`. Date/Author: 2026-06-16 / User + Codex.
- Decision: Keep real ASR disabled by default in the CLI until model cache/download UX is implemented. Rationale: desktop smoke tests should not silently download large model weights; explicit opt-in is available through `FRAMEQ_ALLOW_REAL_ASR=1`. Date/Author: 2026-06-16 / Codex.

## Outcomes & Retrospective

In progress. Completed the project-local `uv` worker scaffold, structured request/result schema, worker CLI facade, Tauri React TypeScript scaffold, workflow state model, first-pass UI shell, the real download/media/audio extraction path for the sample URL, the ASR adapter/transcript writer contract, embedded InsightFlow topic generation with file outputs, and the Tauri command bridge to the worker CLI. Tauri release application build and installer bundling have been validated, with installer success reported by the user after WiX setup/cache. Real Qwen model inference remains unverified and is behind `FRAMEQ_ALLOW_REAL_ASR=1`.

## Context and Orientation

- `douyin_video_download_solution.md` is the source product and technical design.
- `docs/product-specs/2026-06-16-douyin-video-transcription-client.md` defines user-visible scope and acceptance.
- `docs/ARCHITECTURE.md` defines planned module boundaries.
- `docs/DESIGN.md` defines UI states and interaction rules.
- `docs/SECURITY.md` defines content, local data, secrets, and external service boundaries.
- `TASKS.md` stores the current recovery checkpoint; detailed execution tasks are in `2026-06-16-mvp-desktop-client-tasks.md`.

## Plan of Work

1. Bootstrap `app/` with Tauri + React + TypeScript and render the input, processing, completion, partial-completion, and failure states.
2. Bootstrap `worker/` with request/result schema, structured errors, logging, and filesystem layout helpers.
3. Implement download, `ffprobe` validation, and `ffmpeg` audio extraction for a single URL.
4. Add ASR adapter for `Qwen/Qwen3-ASR-0.6B`, with model path configuration and low-resource failure handling.
5. Copy and adapt required InsightFlow modules into `worker/insightflow/`, returning `insights` instead of user-facing “questions”.
6. Wire Tauri command to worker execution, progress updates, cancel/retry behavior, result cards, detail modal, copy, and export.
7. Add focused tests and manual validation notes for the sample URL flow.

## Concrete Steps

Workdir: project root.

1. Create the app shell:

```powershell
npm create tauri-app@latest app -- --template react-ts
```

Expected output: `app/` exists with a React TypeScript Tauri project.

2. Install app dependencies and verify the scaffold:

```powershell
npm --prefix app install
npm --prefix app run build
```

Expected output: dependency install succeeds and build exits with code 0.

3. Create the worker environment with `uv`:

```powershell
uv venv .venv
uv sync --dev
```

Expected output: `.venv/` exists and project dependencies install without error.

4. Add worker MVP dependencies after confirming package availability:

```powershell
uv add yt-dlp
uv add --dev pytest ruff
```

Expected output: packages install without error.

5. Implement worker services under `worker/` and run focused tests:

```powershell
uv run pytest worker\\tests
```

Expected output: focused worker tests pass.

6. Validate docs and frontend build before claiming the MVP complete:

```powershell
python scripts/validate_agents_docs.py --level WARN
npm --prefix app run build
```

Expected output: document validation has 0 errors and app build exits with code 0.

## Validation and Acceptance

- Documentation: `python scripts/validate_agents_docs.py --level ERROR` returns 0 errors.
- Frontend: `npm --prefix app run build` returns 0 after app scaffold exists.
- Worker tests: `uv run pytest worker\tests` returns 0 after worker tests exist.
- Media pipeline: sample URL produces MP4, valid `ffprobe` JSON, and 16 kHz mono WAV.
- ASR pipeline: transcript `.txt` and `.md` are non-empty.
- Real ASR model: `Qwen3ASRModel` loads and transcribes the sample WAV after model weights are available.
- Insight pipeline: insights `.json` contains a non-empty `insights` array, or UI enters `部分完成` while preserving transcript.
- Desktop behavior: user can submit URL, see progress, cancel during processing, open result details, copy text, and export files.
