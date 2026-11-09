# Locus

<div align="center">

**The open-source, local-first answer to Google NotebookLM — for video and web sources.**

<sub>开源版 Google NotebookLM · 本地优先 · 视频与网页即来源</sub>

Paste a video link, a web page, or a local media file. Locus keeps it on your machine, transcribes it, and turns it into a searchable notebook with summaries, mindmaps, and grounded insight prompts.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue?style=flat-square)](LICENSE)
[![Open Source · NotebookLM alternative](https://img.shields.io/badge/Open%20Source-NotebookLM%20alternative-7c3aed?style=flat-square)](#locus-vs-google-notebooklm)

</div>

---

## Overview

**Locus is an open-source alternative to Google NotebookLM.** NotebookLM turns the documents you upload into a grounded notebook; Locus does the same job for the sources NotebookLM cannot handle well — video links, web pages, and local media — and does the heavy lifting on your own machine instead of in a cloud pipeline.

> 一句话：**把视频、网页和本地音视频变成你的本地笔记库**——转写、摘要、思维导图、要点与解剖都在本机完成，只有你确认的 AI 步骤才会把文字发出去。

> [!NOTE]
> Latest stable release: **v0.5.1** (Windows x64, macOS Intel, macOS Apple Silicon), published 2026-11-09. See [GitHub Releases](https://github.com/jiabai/FrameQ/releases). Licensed under **Apache-2.0**; the desktop client, worker, and server all live in this repository.

```text
video link / web page / local media file
  -> download or system WebView extraction -> ffprobe -> 16 kHz mono audio
  -> SenseVoice Small local transcription -> saved local note
  -> optional, separately confirmed: summary / mindmap / insights / dissection / draft
```

> [!IMPORTANT]
> Locus is for public videos, videos you own, or videos you are authorized to process. It does not bypass platform login walls, CAPTCHA, DRM, copyright restrictions, or privacy boundaries.

## Download

Grab the newest installer from **[GitHub Releases → latest](https://github.com/jiabai/FrameQ/releases/latest)**.

| Platform | Asset |
| --- | --- |
| Windows x64 | `FrameQ_0.5.1_x64-setup.exe` (plus `.sig` for the in-app updater) |
| macOS Apple Silicon | `FrameQ_0.5.1_aarch64.dmg` |
| macOS Intel | `FrameQ_0.5.1_x64.dmg` |

Installer assets keep the `FrameQ_` prefix until the first release published under the new name. Releases also carry `latest.json` for the Windows updater and on-demand `pytorch-runtime-*.zip` components. macOS builds are ad-hoc signed, not notarized: the first launch needs a one-time **System Settings → Privacy & Security → Open Anyway**.

## Locus vs Google NotebookLM

| | Google NotebookLM | Locus |
| --- | --- | --- |
| License / hosting | Proprietary, cloud-only | **Apache-2.0**, an app you install and run |
| Sources | Uploaded documents, some video URLs | Video links, public web pages, local media files |
| Where media is processed | Uploaded to Google | **On your machine** — media, transcripts, model caches stay local |
| Transcription | Cloud ASR | **SenseVoice Small, local** |
| Grounded artifacts | Overviews, mindmaps, reports, study aids | Summary, Mermaid mindmap, insight topics, transcript dissection, platform-style draft |
| Source-grounded chat | Yes, with citations | **Not yet** — Locus generates artifacts, not follow-up answers |
| Multi-source synthesis | Many sources in one notebook | One source per note; collections group notes but do not cross-analyze |

Honest boundary: Locus is not a feature-for-feature clone. It covers the *source → transcript → notebook → grounded artifacts* path and adds local media processing; it does not ship an audio overview, a chat surface, or cross-document reasoning.

## What it does

- One home composer for three inputs: a public/authorized video link, a public web page, or one local video/audio file.
- Local notebook with a sidebar (Home / Notes / Collections / Artifacts), pinned notes, search, rename, collections, and export.
- Video download through `yt-dlp` with focused Douyin / Xiaohongshu / Bilibili fallbacks and a 20-minute per-download budget; valid Xiaohongshu platform subtitles are reused instead of running ASR.
- Web pages loaded in a system WebView and saved as local Markdown with source URL and extraction time.
- Selectable local ASR models (SenseVoiceSmall-ONNX default; PyTorch optional with an on-demand ~140 MB runtime).
- Separately confirmed AI steps — summary, mindmap, insight topics, transcript dissection, platform-style draft — through server-managed LLM checkout and quota. A failed AI step leaves the transcript intact and can be retried alone.
- Automatic LLM note titles, a per-user Web dashboard with email-OTP login, and a local-only diagnostic export.
- Windows installer preflight for free space and writability, with a step log at `%TEMP%\install.log`.

One source at a time; this is a local notebook, not a general downloader or batch queue. Platform links may still fail when they are private, expired, region-blocked, login-gated, or otherwise unavailable. Full capability and artifact lists live in [docs/product-specs/](docs/product-specs/) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Why Locus

| Principle | What it means |
| --- | --- |
| Local-first | Videos, audio, transcripts, model caches, and history stay on your machine. |
| Open source | Apache-2.0; desktop client, worker, and server in one repository; the AI steps can be skipped entirely. |
| Notebook, not a downloader | Every source becomes a reusable local note instead of a one-off export. |
| Two-stage AI | Download and transcription run first; each AI step needs a separate confirmation and quota check. |

## Quick Start

```powershell
uv sync --dev
npm --prefix app install
npm --prefix server install
npm --prefix app run tauri -- dev
```

Before claiming a change is complete, run the full gate set (see [docs/EXECUTION_GATES.md](docs/EXECUTION_GATES.md)):

```powershell
uv run python scripts/validate_agents_docs.py --level WARN
uv run ruff check worker
uv run pytest worker/tests
npm --prefix app test
npm --prefix app run build
npm --prefix server test
npm --prefix server run build
cargo test --manifest-path app/src-tauri/Cargo.toml
```

Build without packaging an installer with `npm --prefix app run tauri -- build --no-bundle`; the executable lands at `app/src-tauri/target/release/app.exe`. Local state lives in `%LOCALAPPDATA%\pro.8xf.app`.

## Repository Map

| Path | Role |
| --- | --- |
| `app/` | Tauri + React + TypeScript desktop client |
| `worker/worker_core/` | Python worker: download, media validation, ASR, intelligent extraction |
| `server/` | Fastify account, entitlement, and LLM-checkout service |
| `contracts/` | Cross-language task and artifact contracts |
| `deploy/` | Production runbook plus Nginx and systemd reference configs |
| `site/` | Marketing site (gitignored, deployed separately) |
| `docs/` | Product specs, design docs, security, execution plans |
| `AGENTS.md` / `WORKFLOW.md` / `TASKS.md` | Collaboration map, workflow rules, task ledger |

## Security Boundary

- Only public, owned, or authorized sources; no login-wall, CAPTCHA, DRM, or privacy bypasses.
- Only explicitly confirmed AI steps may send transcript text to the server-managed LLM provider. The account service never receives media, transcripts, insights, cookies, model caches, or local history.
- Real `.env` files, SQLite databases, backups, logs, model caches, outputs, and secrets stay out of git.

Full boundary: [docs/SECURITY.md](docs/SECURITY.md).

## Documentation

| Topic | Where |
| --- | --- |
| Product specs | [docs/product-specs/](docs/product-specs/) |
| Architecture and design | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DESIGN.md](docs/DESIGN.md) |
| Security | [docs/SECURITY.md](docs/SECURITY.md) |
| Execution plans and hard gates | [docs/exec-plans/](docs/exec-plans/) · [docs/EXECUTION_GATES.md](docs/EXECUTION_GATES.md) |
| Server deployment | [deploy/README.md](deploy/README.md) · [deploy/server-deployment.md](deploy/server-deployment.md) |
| Release workflow | [.github/workflows/desktop-release.yml](.github/workflows/desktop-release.yml) |
