# Installer Distribution Runtime ExecPlan

## Goal

Make FrameQ installable for ordinary Windows and macOS users without requiring Python, uv, ffmpeg, yt-dlp, repo layout, or manual environment variables.

## Decisions

- Bundle SenseVoice Small as the only release-exposed ASR model.
- Keep Qwen adapter code but hide Qwen from release UI until separately packaged and verified.
- Use Tauri resource directory for read-only bundled runtime files.
- Use Tauri app-local data directory for `.env`, `outputs`, `work`, `history.json`, and writable model/cache data.
- Build unsigned internal installer packages first; public release signing/notarization remains a release gate.

## Implementation Tasks

- Update governance and product specs for bundled core ASR model distribution.
- Add tests for release runtime command construction, app-local config/history paths, worker work/output env behavior, and release-visible ASR model list.
- Replace Rust repo-root/`uv` worker spawning with bundled Python/resource-dir spawning.
- Redirect config, history, outputs, work, and model cache to app-local data.
- Add first-run command/UI path for missing LLM configuration.
- Add build-installer scripts and Tauri resource packaging entries for Windows and macOS.
- Run automated gates and document packaging checks that require clean Windows/macOS machines.

## Progress

- [x] Governance/spec/ExecPlan created.
- [x] Release runtime tests added.
- [x] Rust runtime implementation updated.
- [x] Worker directory/env behavior updated.
- [x] UI first-run and ASR visibility updated.
- [x] Installer resource scripts/config added.
- [x] Automated verification completed.
- [ ] Clean Windows/macOS install-machine packaging validation completed with real bundled runtime/model assets.

## Validation

- `python scripts/validate_agents_docs.py --level WARN`
- `uv run ruff check worker`
- `uv run pytest worker\tests`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app\src-tauri\Cargo.toml`

## Validation Results

2026-06-18 automated gates passed:

- `python scripts/validate_agents_docs.py --level WARN`
- `uv run ruff check worker`
- `uv run pytest worker\tests`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app\src-tauri\Cargo.toml`
- PowerShell parser check for `scripts/build-installer.ps1`
- `npm --prefix app run tauri -- build --no-bundle`

Remaining external release checks require real Python standalone archives, ffmpeg/ffprobe archives, the SenseVoice Small model directory, target Windows/macOS machines, and signing/notarization credentials.
